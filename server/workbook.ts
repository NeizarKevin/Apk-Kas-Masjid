import * as m from './model.js';
import {scalar} from './accounting.js';
import type {Config, GoogleObject, Report} from './types.js';

const names = ['Laporan Arus Kas','Rincian Penerimaan Kas','Rincian Pengeluaran Kas'];
export const gridRange = (sheetId: number, row: number, rows: number, columns: number, column = 0) => ({sheetId,startRowIndex:row,endRowIndex:row+rows,startColumnIndex:column,endColumnIndex:column+columns});
export const typed = (value: string | number) => ({userEnteredValue:typeof value === 'number' ? {numberValue:value} : {stringValue:value}});
const update = (sheetId: number, row: number, values: (string | number)[][], column = 0) => ({updateCells:{range:gridRange(sheetId,row,values.length,values[0].length,column),rows:values.map(values => ({values:values.map(typed)})),fields:'userEnteredValue'}});
export function templateSheets(book: GoogleObject, cfg: Config) {
  const visible = book.sheets.filter((sheet: GoogleObject) => !sheet.properties.hidden);
  if (book.spreadsheetId !== cfg.reportId || visible.length !== 3 || visible.some((sheet: GoogleObject,i: number) => sheet.properties.sheetId !== cfg.reportSheetIds[i] || sheet.properties.title !== names[i])) throw new Error('ID, urutan, atau tab template laporan berubah.');
  return cfg.reportSheetIds.map(id => book.sheets.find((sheet: GoogleObject) => sheet.properties.sheetId === id));
}
function cells(sheet: GoogleObject): GoogleObject[][] {return (sheet.data?.[0]?.rowData || []).map((row: GoogleObject) => row.values || []);}
export function workbookPlan(book: GoogleObject, cfg: Config, report: Report) {
  const [summary,income,expense] = templateSheets(book,cfg);
  const values = cells(summary).map(row => row.map(scalar)), labels = values.map(row => row[0]);
  const header = labels.indexOf('Bulan'), note = labels.indexOf('CATATAN LAPORAN'), first = header+1;
  if (header < 12 || note <= first) throw new Error('Struktur ringkasan template berubah.');
  let count = 0;
  while (/^\S+\s+\d{4}$/.test(String(labels[first+count] || ''))) count++;
  if (!count) throw new Error('Contoh bulan template tidak tersedia.');
  const delta = report.months.length-count, summaryId = summary.properties.sheetId;
  const requests: GoogleObject[] = [];
  if (delta > 0) requests.push({insertDimension:{range:{sheetId:summaryId,dimension:'ROWS',startIndex:first+count,endIndex:first+count+delta},inheritFromBefore:true}});
  if (delta < 0) requests.push({deleteDimension:{range:{sheetId:summaryId,dimension:'ROWS',startIndex:first+report.months.length,endIndex:first+count}}});
  const monthRange = gridRange(summaryId,first,report.months.length,8);
  requests.push({unmergeCells:{range:monthRange}});
  // Reuse the template's existing row styles rather than designing a replacement.
  requests.push({copyPaste:{source:gridRange(summaryId,first,1,8),destination:monthRange,pasteType:'PASTE_FORMAT'}});
  requests.push(update(summaryId,first,report.months.map(month => [month.label,'',month.income,'',month.expense,'',month.ending,''])));
  report.months.forEach((month,i) => {
    for (const column of [0,2,4,6]) requests.push({mergeCells:{range:gridRange(summaryId,first+i,1,2,column),mergeType:'MERGE_ALL'}});
  });
  const period = m.cashDateLabel_(report.startDate) + ' - ' + m.cashDateLabel_(report.latest);
  requests.push(update(summaryId,2,[['Periode ' + period]]));
  requests.push(update(summaryId,7,[['Saldo kas awal setelah sinkronisasi ' + m.cashDateLabel_(report.openingDate)]]));
  requests.push(update(summaryId,10,[[report.net < 0 ? 'Penurunan bersih kas' : 'Kenaikan bersih kas']]));
  requests.push(update(summaryId,11,[['Saldo kas akhir per ' + m.cashDateLabel_(report.latest)]]));
  requests.push(update(summaryId,7,[report.opening,report.income,-report.expense,report.net,report.ending].map(value => [value]),6));
  requests.push(update(summaryId,note+delta+1,[['Periode dimulai dari hasil hitung fisik setelah sinkronisasi ' + m.cashDateLabel_(report.openingDate) + ' sebesar ' + m.cashRupiah_(report.opening) + '. Infaq sebelum sinkronisasi sudah termasuk saldo awal. Histori sebelumnya tetap tersimpan dalam pembukuan.']]));
  const details = [income,expense].map((sheet,i) => {
    const id = sheet.properties.sheetId, old = cells(sheet), rows = m.cashDetailRows_(report,i === 0 ? 'in' : 'out') as {kind:string;values:(string|number)[]}[];
    const subtotal = old.find(row => /^Subtotal /.test(String(scalar(row[1] || {})))), total = old.find(row => /^TOTAL /.test(String(scalar(row[1] || {}))));
    if (!subtotal || !total || !old[4] || !old[5]) throw new Error('Contoh gaya rincian template berubah.');
    const last = rows.length+4, capacity = sheet.properties.gridProperties.rowCount;
    if (last > capacity) requests.push({appendDimension:{sheetId:id,dimension:'ROWS',length:last-capacity}});
    const area = gridRange(id,4,Math.max(capacity,last)-4,3);
    requests.push({unmergeCells:{range:area}});
    requests.push({updateCells:{range:area,fields:'userEnteredValue'}});
    rows.forEach((row,j) => {
      const style = row.kind === 'month' ? old[4] : row.kind === 'subtotal' ? subtotal : row.kind === 'total' ? total : old[5];
      const formatted = Array.from({length:3},(_,column) => ({...typed(row.values[column]),userEnteredFormat:{...style[column]?.userEnteredFormat,wrapStrategy:'WRAP'}}));
      requests.push({updateCells:{range:gridRange(id,j+4,1,3),rows:[{values:formatted}],fields:'userEnteredValue,userEnteredFormat'}});
      if (row.kind === 'month') requests.push({mergeCells:{range:gridRange(id,j+4,1,3),mergeType:'MERGE_ALL'}});
    });
    requests.push(update(id,1,[['Masjid Al-Barokah Taskombang - Periode ' + period]]));
    if (capacity > last) requests.push({deleteDimension:{range:{sheetId:id,dimension:'ROWS',startIndex:last,endIndex:capacity}}});
    requests.push({updateSheetProperties:{properties:{sheetId:id,gridProperties:{frozenRowCount:4}},fields:'gridProperties.frozenRowCount'}});
    requests.push({autoResizeDimensions:{dimensions:{sheetId:id,dimension:'ROWS',startIndex:4,endIndex:last}}});
    return {id,rows,last};
  });
  return {requests,first,details};
}
export function verifyWorkbook(book: GoogleObject, cfg: Config, report: Report, plan: ReturnType<typeof workbookPlan>) {
  const [summary] = templateSheets(book,cfg), data = cells(summary).map(row => row.map(scalar));
  if (JSON.stringify(data.slice(7,12).map(row => row[6])) !== JSON.stringify([report.opening,report.income,-report.expense,report.net,report.ending])) throw new Error('Ringkasan workbook tidak sama dengan sumber.');
  report.months.forEach((month,i) => {
    const row = data[plan.first+i];
    if (!row || row[0] !== month.label || row[2] !== month.income || row[4] !== month.expense || row[6] !== month.ending) throw new Error('Rekonsiliasi bulan gagal.');
  });
  for (const detail of plan.details) {
    const sheet = book.sheets.find((sheet: GoogleObject) => sheet.properties.sheetId === detail.id), rows = cells(sheet);
    if (sheet.properties.gridProperties.rowCount !== detail.last) throw new Error('Ada baris rincian di luar laporan.');
    detail.rows.forEach((row,i) => {
      for (let column = 0; column < 3; column++) if (scalar(rows[i+4]?.[column] || {}) !== row.values[column]) throw new Error('Rincian workbook berbeda dari sumber.');
    });
  }
}
