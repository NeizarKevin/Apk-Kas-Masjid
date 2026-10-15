import {createHash} from 'node:crypto';
import * as m from './model.js';
import type {Baseline, Config, GoogleObject, Input, Report, Snapshot, Source, Transaction} from './types.js';

export const todayJakarta = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const signature = (report: Report) => createHash('sha256').update(m.cashReportSignature_(report)).digest('hex');
export function scalar(cell: GoogleObject): string | number | boolean {
  if (cell.effectiveValue?.errorValue) throw new Error('Formula sumber bermasalah.');
  const value = cell.effectiveValue || cell.userEnteredValue || {};
  if (value.formulaValue) throw new Error('Hasil formula belum tersedia.');
  return value.numberValue ?? value.stringValue ?? value.boolValue ?? '';
}
export function snapshot(sheet: GoogleObject, width: number): Snapshot {
  const data = (sheet.data || []).find((grid: GoogleObject) => (grid.startRow || 0) === 0 && (grid.startColumn || 0) === 0);
  if (!data) throw new Error('Rentang sumber tidak ditemukan.');
  const cells: GoogleObject[][] = (data.rowData || []).map((row: GoogleObject) => Array.from({length:width},(_,i) => row.values?.[i] || {}));
  return {id:sheet.properties.sheetId,title:sheet.properties.title,index:sheet.properties.index,cells,
    rows:cells.map(row => row.map(scalar)),notes:cells.map(row => row.map(cell => cell.note || ''))};
}
export function buildSource(book: GoogleObject, cfg: Config): Source {
  if (book.spreadsheetId !== cfg.sourceId) throw new Error('ID sumber tidak sesuai.');
  // Sheets calendar date serials have no time zone; keep the original workbook setting.
  const marked = book.sheets.filter((sheet: GoogleObject) => sheet.developerMetadata?.some((meta: GoogleObject) => meta.metadataKey === 'KAS_JOURNAL' && meta.metadataValue === 'MASJID'));
  if (marked.length !== 1 || marked[0].properties.sheetId !== cfg.journalId) throw new Error('ID jurnal tidak cocok dengan metadata KAS_JOURNAL=MASJID.');
  const get = (id: number, width: number) => {
    const found = book.sheets.find((sheet: GoogleObject) => sheet.properties.sheetId === id);
    if (!found) throw new Error('Tab sumber yang dikonfigurasi tidak tersedia.');
    return snapshot(found,width);
  };
  const journal = {...get(cfg.journalId,6),journal:true,fund:'MASJID' as const}, phbi = get(cfg.phbiId,6), sync = get(cfg.syncId,8);
  const fundMetadata = marked[0].developerMetadata.filter((meta: GoogleObject) => meta.metadataKey === 'KAS_DANA');
  if (fundMetadata.length > 1 || fundMetadata.some((meta: GoogleObject) => meta.metadataValue !== 'MASJID')) throw new Error('Metadata dana jurnal tidak sesuai.');
  if (phbi.rows[0]?.slice(0,6).map(m.cashHeader_).join('|') !== 'tanggal|kode|keterangan|pemasukan|pengeluaran|sumber') throw new Error('Header RAW PHBI berubah.');
  for (const grid of [journal,phbi]) grid.notes.slice(1).forEach((notes,index)=>{
    const row=index+1;
    if (m.cashMeta_(notes[0])?.deleted && (grid.rows[row].some(value=>!m.emptyCashCell_(value)) || grid.cells[row].some(cell=>cell.userEnteredValue?.formulaValue))) {
      throw new Error(`Baris transaksi dihapus telah diisi kembali: ${grid.title}!A${row+1}:F${row+1}. Cocokkan isi dan catatan identitas di Sheet sebelum melanjutkan.`);
    }
  });
  const transactions = m.cashReadLedger_([journal],cfg.baseline.date,'Asia/Jakarta').transactions as Transaction[];
  const phbiTransactions = m.cashPhbiRows_(phbi,'Asia/Jakarta') as Transaction[];
  const checkpoints = m.cashCheckpoints_(sync.rows,'Asia/Jakarta') as Record<'MASJID' | 'PHBI',Baseline>;
  if (checkpoints.MASJID.date < cfg.baseline.date || checkpoints.PHBI.date < cfg.phbiBaseline.date) throw new Error('Checkpoint lebih awal dari saldo pembukaan.');
  const report = m.cashNewPeriodReport_(transactions,cfg.baseline) as Report;
  const reconciliation = m.cashReconcileCheckpoint_(report,report.incoming.concat(report.outgoing),checkpoints.MASJID);
  const allIds = [journal,phbi].flatMap(grid => grid.notes.slice(1).map(notes => m.cashMeta_(notes[0])?.id)).filter(Boolean);
  if (new Set(allIds).size !== allIds.length) throw new Error('ID kiriman ditemukan lebih dari sekali.');
  return {book,journal,phbi,transactions,phbiTransactions,checkpoints,report,reconciliation};
}
export function findRequest(source: Source, id: string): Input | null {
  const tx = source.transactions.concat(source.phbiTransactions).find(tx => tx.meta?.id === id);
  if (!tx) {
    const removed=[source.journal,source.phbi].flatMap(grid=>grid.notes.slice(1).map(notes=>m.cashMeta_(notes[0]))).find(meta=>meta?.id===id && meta.deleted);
    if (removed) return {id,fund:removed.fund,type:removed.type,code:removed.code,date:removed.date,description:removed.description,amount:removed.amount};
    if ([source.journal,source.phbi].some(grid => grid.notes.slice(1).some(notes => m.cashMeta_(notes[0])?.id === id))) throw new Error('ID kiriman sudah ada di luar periode aktif. Periksa koreksi transaksi di Sheet sebelum mengirim ulang.');
    return null;
  }
  const actual: Input = {id,fund:tx.fund,type:tx.type,code:tx.code,date:tx.date,description:tx.description,amount:tx.amount};
  if (!m.cashSameInput_(actual,tx.meta)) throw new Error('Transaksi sebelumnya sudah diubah di Sheet; periksa sebelum mengirim ulang.');
  return actual;
}
export function appendPlan(source: Source, tx: Input, cfg: Config, now = new Date().toISOString()) {
  const grid = tx.fund === 'MASJID' ? source.journal : source.phbi;
  let next = grid.rows.length;
  while (next > 1 && grid.rows[next-1].every(m.emptyCashCell_) && grid.notes[next-1].every(m.emptyCashCell_)) next--;
  const checkpoint = source.checkpoints[tx.fund];
  const meta = {...tx,createdAt:now,afterSync:true,checkpointKey:m.cashCheckpointKey_(checkpoint),
    reportBaselineKey:m.cashCheckpointKey_(tx.fund === 'MASJID' ? cfg.baseline : cfg.phbiBaseline)};
  const values = [m.cashSerial_(tx.date),tx.code,tx.description,tx.type === 'in' ? tx.amount : '',tx.type === 'out' ? tx.amount : '',tx.fund === 'MASJID' ? now : 'Aplikasi kas / ' + tx.id];
  const cells = values.map((value,i) => {
    const format = structuredClone(grid.cells[Math.max(1,next-1)]?.[i]?.userEnteredFormat || {});
    if (i === 0) format.numberFormat = {type:'DATE',pattern:'dd/mm/yyyy'};
    return {userEnteredValue:typeof value === 'number' ? {numberValue:value} : {stringValue:value},userEnteredFormat:format,
      dataValidation:grid.cells[Math.max(1,next-1)]?.[i]?.dataValidation,
      ...(i === 0 ? {note:'KAS_APP_V1 ' + JSON.stringify(meta)} : {})};
  });
  const capacity = source.book.sheets.find((sheet: GoogleObject) => sheet.properties.sheetId === grid.id).properties.gridProperties.rowCount;
  const requests: GoogleObject[] = [];
  if (next >= capacity) requests.push({appendDimension:{sheetId:grid.id,dimension:'ROWS',length:next-capacity+1}});
  requests.push({updateCells:{range:{sheetId:grid.id,startRowIndex:next,endRowIndex:next+1,startColumnIndex:0,endColumnIndex:6},rows:[{values:cells}],fields:'userEnteredValue,userEnteredFormat,dataValidation,note'}});
  return requests;
}
