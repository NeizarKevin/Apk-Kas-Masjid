import {OAuth2Client} from 'google-auth-library';
import {createHash} from 'node:crypto';
import {appendPlan,buildSource,findRequest,todayJakarta} from './accounting.js';
import {cashValidateInput_,cashSameInput_} from './model.js';
import {changePlan} from './changes.js';
import {templateSheets,workbookPlan,verifyWorkbook} from './workbook.js';
import type {Adapter,ChangeRequest,Config,GoogleObject,Input,Report,Source,Transaction} from './types.js';

const fields = 'spreadsheetId,properties(timeZone),sheets(properties,developerMetadata,basicFilter,data(startRow,startColumn,rowData(values(effectiveValue,userEnteredValue,userEnteredFormat,dataValidation,note))))';
export class GoogleAdapter implements Adapter {
  constructor(private cfg: Config, private auth: OAuth2Client, private fetcher: typeof fetch = fetch) {}
  async request(url: string, options: RequestInit = {}): Promise<any> {
    const token = await this.auth.getAccessToken();
    if (!token.token) throw new Error('Hubungkan akun Google pemilik terlebih dahulu.');
    const response = await this.fetcher(url,{...options,signal:AbortSignal.timeout(90000),headers:{Authorization:'Bearer ' + token.token,...options.headers}});
    if (!response.ok) throw new Error(`Google API gagal (HTTP ${response.status}). Periksa izin file dan koneksi Google.`);
    return response.headers.get('content-type')?.includes('application/json') ? response.json() : Buffer.from(await response.arrayBuffer());
  }
  private async metadata(id: string) {return this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?fields=spreadsheetId,properties(timeZone),sheets(properties,developerMetadata,basicFilter)`);}
  private async book(id: string, selections: {id:number;width:number}[]) {
    const metadata = await this.metadata(id), params = new URLSearchParams({fields,includeGridData:'true'});
    for (const selection of selections) {
      const sheet = metadata.sheets.find((sheet: GoogleObject) => sheet.properties.sheetId === selection.id)?.properties;
      if (!sheet || sheet.sheetType !== 'GRID' || sheet.gridProperties.rowCount > 20000 || sheet.gridProperties.columnCount < selection.width) throw new Error('Tab sumber tidak tersedia atau melampaui batas pemeriksaan.');
      params.append('ranges',`'${sheet.title.replace(/'/g,"''")}'!A1:${String.fromCharCode(64+selection.width)}${sheet.gridProperties.rowCount}`);
    }
    return this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}?${params}`);
  }
  async source() {return buildSource(await this.book(this.cfg.sourceId,[{id:this.cfg.journalId,width:6},{id:this.cfg.phbiId,width:6},{id:this.cfg.syncId,width:8}]),this.cfg);}
  private async batch(id: string, requests: GoogleObject[]) {await this.request(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(id)}:batchUpdate`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})});}
  async file(id: string) {return this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,mimeType,size,md5Checksum,modifiedTime,webViewLink,capabilities(canEdit),permissions(id,type,role,allowFileDiscovery)`);}
  private assertPdf(file: GoogleObject, id: string, preview: boolean) {
    if (file.id !== id || file.mimeType !== 'application/pdf' || !file.capabilities?.canEdit || !Array.isArray(file.permissions)) throw new Error('Target PDF lama atau izinnya tidak dapat diverifikasi.');
    const publicPermissions = file.permissions.filter((permission: GoogleObject) => permission.type === 'anyone');
    if (preview ? file.permissions.some((permission: GoogleObject) => permission.role !== 'owner') : publicPermissions.length !== 1 || publicPermissions[0].role !== 'reader' || publicPermissions[0].allowFileDiscovery !== false) throw new Error(preview ? 'File pratinjau wajib privat dan hanya milik pemilik.' : 'Izin tautan PDF publik berubah.');
  }
  async verifyTargets() {
    const source = await this.source();
    if (source.book.spreadsheetId !== this.cfg.sourceId) throw new Error('Sumber tidak sesuai.');
    templateSheets(await this.reportBook(),this.cfg);
    this.assertPdf(await this.file(this.cfg.pdfId),this.cfg.pdfId,false);
    this.assertPdf(await this.file(this.cfg.previewId),this.cfg.previewId,true);
    for (const id of [this.cfg.sourceId,this.cfg.reportId]) {
      const file = await this.file(id);
      if (file.id !== id || file.mimeType !== 'application/vnd.google-apps.spreadsheet' || !file.capabilities?.canEdit) throw new Error('Hak edit workbook asli belum tersedia.');
    }
    const archive = await this.file(this.cfg.archiveId);
    if (archive.id !== this.cfg.archiveId || archive.mimeType !== 'application/vnd.google-apps.folder' || !archive.capabilities?.canEdit || archive.permissions?.some((p: GoogleObject) => p.role !== 'owner')) throw new Error('Folder arsip wajib privat dan dapat diedit pemilik.');
  }
  async append(_source: Source, tx: Input) {
    // Re-read before choosing the row so intervening manual additions are preserved.
    const fresh=await this.source(),existing=findRequest(fresh,tx.id);
    if (existing) {
      if (!cashSameInput_(existing,tx)) throw new Error('ID kiriman sudah dipakai oleh transaksi berbeda.');
      return;
    }
    cashValidateInput_(tx,todayJakarta(),fresh.checkpoints[tx.fund]);
    await this.batch(this.cfg.sourceId,appendPlan(fresh,tx,this.cfg));
  }
  async change(request: ChangeRequest) {
    const plan=changePlan(await this.source(),request,this.cfg);
    if (plan.requests.length) await this.batch(this.cfg.sourceId,plan.requests);
  }
  async extendFilter(saved: Transaction) {
    const book = await this.metadata(this.cfg.sourceId), filter = book.sheets.find((sheet: GoogleObject) => sheet.properties.sheetId === saved.sheetId)?.basicFilter;
    if (filter?.range.endRowIndex !== undefined && filter.range.endRowIndex < saved.row) {
      filter.range.endRowIndex = saved.row;
      // setBasicFilter can reapply sort settings; don't risk moving source transactions.
      if (filter.sortSpecs?.length) throw new Error('Perluas filter yang memiliki urutan aktif secara manual di Sheet.');
      await this.batch(this.cfg.sourceId,[{setBasicFilter:{filter}}]);
    }
  }
  private reportBook() {return this.book(this.cfg.reportId,this.cfg.reportSheetIds.map((id,i) => ({id,width:i === 0 ? 8 : 3})));}
  async render(report: Report) {
    const book = await this.reportBook(), plan = workbookPlan(book,this.cfg,report);
    await this.batch(this.cfg.reportId,plan.requests);
    verifyWorkbook(await this.reportBook(),this.cfg,report,plan);
    // Reuse the old Google template export with the owner's server OAuth token; no Apps Script runtime.
    const params = new URLSearchParams({format:'pdf',size:'A4',portrait:'true',fitw:'true',scale:'2',sheetnames:'false',printtitle:'false',pagenum:'CENTER',gridlines:'false',fzr:'true',top_margin:'0.35',bottom_margin:'0.35',left_margin:'0.35',right_margin:'0.35'});
    return await this.request(`https://docs.google.com/spreadsheets/d/${encodeURIComponent(this.cfg.reportId)}/export?${params}`) as Buffer;
  }
  async publish(bytes: Buffer, preview: boolean) {
    const id = preview ? this.cfg.previewId : this.cfg.pdfId, before = await this.file(id);
    this.assertPdf(before,id,preview);
    const permissions = (file: GoogleObject) => JSON.stringify(file.permissions.map((p: GoogleObject) => [p.id,p.type,p.role,p.allowFileDiscovery ?? false]).sort());
    if (!preview) {
      const folder = await this.file(this.cfg.archiveId);
      if (folder.mimeType !== 'application/vnd.google-apps.folder' || !folder.capabilities?.canEdit || !Array.isArray(folder.permissions) || folder.permissions.some((p: GoogleObject) => p.role !== 'owner')) throw new Error('Folder arsip tidak lagi privat. PDF publik dipertahankan.');
      // Keep a private recoverable copy before changing the public content.
      const archive = await this.request(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/copy?ignoreDefaultVisibility=true&fields=id,parents,mimeType,permissions(type,role)`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Arsip laporan ' + new Date().toISOString(),parents:[this.cfg.archiveId]})});
      const readback = await this.file(archive.id);
      if (readback.mimeType !== 'application/pdf' || readback.permissions?.some((p: GoogleObject) => p.role !== 'owner')) throw new Error('Arsip privat belum dapat diverifikasi; PDF publik dipertahankan.');
    }
    const updated = await this.request(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(id)}?uploadType=media&supportsAllDrives=true&fields=id,mimeType,size,md5Checksum,modifiedTime`,{method:'PATCH',headers:{'Content-Type':'application/pdf'},body:new Uint8Array(bytes)});
    const after = await this.file(id);
    this.assertPdf(after,id,preview);
    if (updated.id !== id || Number(after.size) !== bytes.length || after.md5Checksum !== createHash('md5').update(bytes).digest('hex') || after.modifiedTime === before.modifiedTime || permissions(before) !== permissions(after)) throw new Error('Upload selesai tetapi verifikasi PDF/izin gagal. Periksa versi Drive.');
    return after.webViewLink || `https://drive.google.com/file/d/${id}/view`;
  }
}
