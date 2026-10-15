import {join} from 'node:path';
import {writeFile} from 'node:fs/promises';
import {appendPlan,buildSource} from './accounting.js';
import {atomicJson,readJson} from './state.js';
import {renderDemoPdf} from './pdf.js';
import * as m from './model.js';
import {changePlan} from './changes.js';
import type {Adapter,ChangeRequest,Config,GoogleObject,Input,Report,Source,Transaction} from './types.js';

export function demoBook(cfg: Config): GoogleObject {
  const value = (v: string | number) => ({userEnteredValue:typeof v === 'number' ? {numberValue:v} : {stringValue:v}});
  const sheet = (id: number,title: string,rows: (string|number)[][]) => ({properties:{sheetId:id,title,index:id,sheetType:'GRID',gridProperties:{rowCount:100,columnCount:8}},data:[{rowData:rows.map(row => ({values:row.map(value)}))}]});
  const journal: GoogleObject = sheet(cfg.journalId,'Jurnal demo',[['Tanggal','Kode','Keterangan','Pemasukan','Pengeluaran','Timestamp'],['2026-10-09','K1','Contoh infaq Jumat',250000,'',''],['2026-10-10','K1','Contoh biaya kebersihan','',50000,'']]);
  journal.developerMetadata = [{metadataKey:'KAS_JOURNAL',metadataValue:'MASJID'}];
  return {spreadsheetId:cfg.sourceId,properties:{timeZone:'Asia/Jakarta'},sheets:[journal,
    sheet(cfg.phbiId,'RAW PHBI',[['Tanggal','Kode','Keterangan','Pemasukan','Pengeluaran','Sumber']]),
    sheet(cfg.syncId,'Checkpoint demo',[['Tanggal','Dana','K1','K2','K3','Total'],[cfg.baseline.date,'Kas Masjid',cfg.baseline.holders.K1!,cfg.baseline.holders.K2!,0,cfg.baseline.amount],[cfg.phbiBaseline.date,'PHBI',cfg.phbiBaseline.amount,'','',cfg.phbiBaseline.amount]])]};
}
export class DemoAdapter implements Adapter {
  constructor(private cfg: Config) {}
  async source() {return buildSource(await readJson(join(this.cfg.stateDir,'demo-sheet.json'),demoBook(this.cfg)),this.cfg);}
  async verifyTargets() {await this.source();}
  async append(source: Source, tx: Input) {
    const book = structuredClone(source.book);
    for (const request of appendPlan(source,tx,this.cfg)) {
      const sheet = book.sheets.find((s: GoogleObject) => s.properties.sheetId === (request.updateCells?.range.sheetId ?? request.appendDimension?.sheetId));
      if (request.appendDimension) sheet.properties.gridProperties.rowCount += request.appendDimension.length;
      if (request.updateCells) sheet.data[0].rowData[request.updateCells.range.startRowIndex] = request.updateCells.rows[0];
    }
    await atomicJson(join(this.cfg.stateDir,'demo-sheet.json'),book);
  }
  async extendFilter(_saved: Transaction) {}
  async change(request: ChangeRequest) {
    const source=await this.source(),plan=changePlan(source,request,this.cfg);
    for (const entry of plan.requests) {
      const update=entry.updateCells,sheet=source.book.sheets.find((sheet: GoogleObject)=>sheet.properties.sheetId===update.range.sheetId);
      const old=sheet.data[0].rowData[update.range.startRowIndex];
      sheet.data[0].rowData[update.range.startRowIndex]={values:update.rows[0].values.map((value: GoogleObject,i: number)=>({...old.values?.[i],...value}))};
    }
    if (plan.requests.length) await atomicJson(join(this.cfg.stateDir,'demo-sheet.json'),source.book);
  }
  async render(report: Report) {return renderDemoPdf(report);}
  async publish(bytes: Buffer, preview: boolean) {
    await writeFile(join(this.cfg.stateDir,preview ? 'preview.pdf' : 'public.pdf'),bytes,{mode:0o600});
    return preview ? '/api/pdf/preview' : '/api/pdf/public';
  }
}
