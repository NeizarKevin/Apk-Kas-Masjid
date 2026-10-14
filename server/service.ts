import {join} from 'node:path';
import {readJson,atomicJson,SerialQueue} from './state.js';
import {findRequest,signature,todayJakarta} from './accounting.js';
import {inspectPdf} from './pdf.js';
import * as m from './model.js';
import type {Adapter,Config,Fund,Input,Source,Status} from './types.js';

interface Publication {hash?: string; updatedAt?: string; status: Status}
const setup: Status = {state:'SETUP',message:'Pratinjau tersedia. Publikasi otomatis belum diaktifkan.'};
export class CashService {
  private queue = new SerialQueue();
  private statusPath: string;
  constructor(readonly cfg: Config, readonly adapter: Adapter, private audit = inspectPdf) {this.statusPath=join(cfg.stateDir,'report-status.json');}
  private publication() {return readJson<Publication>(this.statusPath,{status:setup});}
  private async status(status: Status) {
    const saved = await this.publication();
    await atomicJson(this.statusPath,{...saved,status});
    return status;
  }
  private blocked(source: Source): Status | null {
    return source.reconciliation.ok ? null : {state:'BLOCKED',message:'PDF ditahan: saldo buku dan hitungan fisik berbeda. Cocokkan transaksi di Sheet.',reconciliation:source.reconciliation};
  }
  getDashboard(fund: string, month: string) {
    return this.queue.run(async () => {
      if (!['MASJID','PHBI'].includes(fund)) throw new Error('Pilih jenis dana.');
      const today = todayJakarta();
      month ||= today.slice(0,7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Bulan tidak valid.');
      const source = await this.adapter.source(), checkpoint = source.checkpoints[fund as Fund];
      const all = fund === 'MASJID' ? source.transactions : source.phbiTransactions;
      const visible = all.filter(tx => m.cashIsAfterReportBaseline_(tx,fund === 'MASJID' ? this.cfg.baseline : this.cfg.phbiBaseline));
      const selected = visible.filter(tx => tx.date.slice(0,7) === month);
      const balance = checkpoint.amount + all.filter(tx => m.cashIsAfterCheckpoint_(tx,checkpoint)).reduce((sum,tx)=>sum+(tx.type === 'in' ? tx.amount : -tx.amount),0);
      if (!Number.isSafeInteger(balance)) throw new Error('Saldo melewati batas angka aman.');
      let report = this.blocked(source) || (await this.publication()).status;
      if (source.reconciliation.ok && report.state === 'BLOCKED') report = {state:'READY',message:'Saldo buku sesuai. Laporan siap diperbarui.'};
      return {today,month,fund,checkpoint,balance,bookBalance:fund === 'MASJID' ? source.report.ending : null,
        income:selected.filter(tx=>tx.type === 'in').reduce(m.cashSum_,0),expense:selected.filter(tx=>tx.type === 'out').reduce(m.cashSum_,0),
        transactions:selected.slice().sort(m.cashSort_).reverse().map(({date,code,description,type,amount})=>({date,code,description,type,amount})),report,
        pdfUrl:this.cfg.demo ? '/api/pdf/public' : `https://drive.google.com/file/d/${this.cfg.pdfId}/view`,
        automatic:this.cfg.automatic,demo:this.cfg.demo,reportStartDate:source.report.startDate,reportOpening:source.report.opening};
    });
  }
  saveTransaction(input: unknown) {
    return this.queue.run(async () => {
      await this.adapter.verifyTargets();
      const source = await this.adapter.source();
      const raw = input as Input;
      const tx = m.cashValidateInput_(raw,todayJakarta(),source.checkpoints[raw?.fund || 'MASJID']) as Input;
      const existing = findRequest(source,tx.id);
      if (existing && !m.cashSameInput_(existing,tx)) throw new Error('ID kiriman tidak boleh dipakai untuk transaksi berbeda.');
      let verified = source;
      if (!existing) {
        await this.adapter.append(source,tx);
        verified = await this.adapter.source();
        const saved = findRequest(verified,tx.id);
        if (!saved || !m.cashSameInput_(saved,tx)) throw new Error('Penyimpanan belum terverifikasi. Kirim ulang dengan ID yang sama.');
      }
      let warning: string | null = null;
      try {await this.adapter.extendFilter(verified.transactions.concat(verified.phbiTransactions).find(row=>row.meta?.id === tx.id)!);}
      catch {warning='Transaksi tersimpan. Rentang filter Sheet perlu diperiksa.';}
      let report: Status;
      try {report=this.cfg.automatic ? await this.publishLocked(false) : setup;}
      catch (error) {report=await this.status({state:'ERROR',message:'Transaksi tersimpan. PDF belum diperbarui: ' + (error as Error).message});}
      return {saved:true,duplicate:!!existing,id:tx.id,report,warning};
    });
  }
  resolvePendingRequest(id: string) {
    return this.queue.run(async () => {
      if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) throw new Error('ID kiriman tidak valid.');
      const transaction = findRequest(await this.adapter.source(),id);
      return {id,saved:!!transaction,transaction};
    });
  }
  private async publishLocked(preview: boolean) {
    await this.adapter.verifyTargets();
    const source = await this.adapter.source(), blocked = this.blocked(source);
    if (blocked) return this.status(blocked);
    if (source.report.latest > todayJakarta()) throw new Error('Ada transaksi bertanggal setelah hari ini.');
    const hash = signature(source.report), published = await this.publication();
    if (!preview && published.hash === hash) return this.status({state:'UNCHANGED',message:'Laporan sudah sesuai; isi tidak berubah.',updatedAt:published.updatedAt});
    const bytes = await this.adapter.render(source.report);
    const audit = await this.audit(bytes,source.report);
    const current = await this.adapter.source();
    if (!current.reconciliation.ok || signature(current.report) !== hash) throw new Error('Sumber berubah saat ekspor. PDF lama dipertahankan.');
    const pdfUrl = await this.adapter.publish(bytes,preview);
    await atomicJson(join(this.cfg.stateDir,preview ? 'preview-audit.json' : 'public-audit.json'),audit);
    if (preview) return {state:'READY' as const,message:'Pratinjau privat siap.',pdfUrl};
    const updatedAt = new Date().toISOString(), status: Status = {state:'PUBLISHED',message:'Laporan kas publik berhasil diperbarui.',updatedAt};
    await atomicJson(this.statusPath,{hash,updatedAt,status});
    return status;
  }
  refreshPublicPdf() {
    return this.queue.run(async () => {
      try {return await this.publishLocked(false);}
      catch (error) {return this.status({state:'ERROR',message:'PDF belum diperbarui: ' + (error as Error).message});}
    });
  }
  previewPublicPdf() {
    return this.queue.run(async () => {
      const report = await this.publishLocked(true);
      return 'pdfUrl' in report ? {ready:true,pdfUrl:report.pdfUrl,latest:(await this.adapter.source()).report.latest} : {ready:false,report};
    });
  }
}
