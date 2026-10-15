import {createHash,randomUUID} from 'node:crypto';
import * as m from './model.js';
import {todayJakarta} from './accounting.js';
import type {ChangeEvent,ChangeRequest,Config,GoogleObject,Input,Source,Transaction,TransactionMeta} from './types.js';

const hash=(value: unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function rowReference(source: Source,key: string) {
  if (!/^\d+:\d+$/.test(key)) throw new Error('Identitas baris tidak valid.');
  const [id,row]=key.split(':').map(Number),grid=[source.journal,source.phbi].find(grid=>grid.id===id);
  if (!grid || !Number.isSafeInteger(row) || row<2 || row>grid.rows.length) throw new Error('Baris transaksi tidak tersedia. Muat ulang data.');
  const meta=m.cashMeta_(grid.notes[row-1]?.[0]) as TransactionMeta | null;
  const revision=hash([grid.cells[row-1].map(cell=>cell.userEnteredValue || cell.effectiveValue || {}),grid.notes[row-1]]);
  const tx=source.transactions.concat(source.phbiTransactions).find(tx=>tx.sheetId===id && tx.row===row);
  return {grid,row,meta,tx,revision};
}
export function changeReceipt(source: Source,id: string) {
  for (const grid of [source.journal,source.phbi]) for (let row=1;row<grid.notes.length;row++) {
    const meta=m.cashMeta_(grid.notes[row]?.[0]) as TransactionMeta | null;
    const event=meta?.changes?.find(event=>event.id===id);
    if (event) return {event,key:`${grid.id}:${row+1}`};
  }
  return null;
}
const fields=(tx: Omit<Input,'id'>): Omit<Input,'id'>=>({fund:tx.fund,type:tx.type,code:tx.code,date:tx.date,description:tx.description,amount:tx.amount});
export function validatedChange(input: unknown): ChangeRequest {
  const raw=input as ChangeRequest;
  if (!raw || !uuid.test(raw.id || '') || !['edit','delete','restore'].includes(raw.action) || !/^\d+:\d+$/.test(raw.key || '') || !/^[a-f0-9]{64}$/.test(raw.revision || '')) throw new Error('Permintaan perubahan tidak valid.');
  const reason=String(raw.reason || '').trim();
  if (reason.length<3 || reason.length>300) throw new Error('Isi alasan perubahan, 3–300 karakter.');
  if (raw.action==='edit' && (!raw.input || typeof raw.input !== 'object')) throw new Error('Isi koreksi transaksi.');
  return {id:raw.id,key:raw.key,revision:raw.revision,action:raw.action,reason,...(raw.action==='edit' ? {input:fields(raw.input!)} : {})};
}
export function changePlan(source: Source,request: ChangeRequest,cfg: Config) {
  const receipt=changeReceipt(source,request.id),requestHash=hash(request);
  if (receipt) {
    if (receipt.key!==request.key || receipt.event.requestHash!==requestHash) throw new Error('ID perubahan sudah dipakai untuk permintaan berbeda.');
    return {requests:[] as GoogleObject[],duplicate:true};
  }
  const {grid,row,meta,tx,revision}=rowReference(source,request.key);
  if (revision!==request.revision) throw new Error('Transaksi berubah sejak dibuka. Muat ulang dan periksa versi terbaru sebelum mengoreksi.');
  const fund=grid.id===cfg.journalId ? 'MASJID' : 'PHBI';
  const current=meta?.deleted ? meta : tx;
  if (!current || current.fund!==fund || !m.cashIsAfterReportBaseline_(current,fund==='MASJID' ? cfg.baseline : cfg.phbiBaseline)) throw new Error('Hanya transaksi dalam periode aktif yang dapat diubah.');
  if (!m.cashIsAfterCheckpoint_(current,source.checkpoints[fund])) throw new Error('Transaksi sudah termasuk hitung fisik terakhir. Koreksi dengan pencocokan langsung di Sheet.');
  if (request.action==='restore' ? !meta?.deleted : !tx || meta?.deleted) throw new Error('Status transaksi berubah. Muat ulang data.');
  const id=meta?.id || randomUUID(),now=new Date().toISOString();
  const next=request.action==='edit' ? m.cashValidateInput_({...request.input,id},todayJakarta(),source.checkpoints[fund]) as Input : {...fields(current),id};
  if (next.fund!==fund) throw new Error('Jenis dana tidak dapat dipindah lewat koreksi.');
  const event: ChangeEvent={id:request.id,action:request.action,at:now,actor:cfg.owner,reason:request.reason,requestHash,before:fields(current),...(request.action==='edit' ? {after:fields(next)} : {})};
  const note: TransactionMeta={...meta,...next,createdAt:meta?.createdAt || now,afterSync:meta?.afterSync ?? false,
    checkpointKey:meta?.checkpointKey || '',reportBaselineKey:meta?.reportBaselineKey || '',changes:[...(meta?.changes || []),event],
    ...(!meta && grid.notes[row-1]?.[0] ? {originalNote:grid.notes[row-1][0]} : {})};
  let values: GoogleObject[];
  if (request.action==='delete') {
    note.deleted=true;
    note.backup=grid.cells[row-1].map(cell=>structuredClone(cell.userEnteredValue || cell.effectiveValue || {}));
    values=Array.from({length:6},()=>({stringValue:''}));
  } else if (request.action==='restore') {
    if (!note.backup || note.backup.length!==6) throw new Error('Cadangan transaksi dihapus tidak lengkap. Periksa Sheet.');
    values=note.backup;delete note.deleted;delete note.backup;
  } else {
    values=[m.cashSerial_(next.date),next.code,next.description,next.type==='in' ? next.amount : '',next.type==='out' ? next.amount : ''].map(value=>typeof value==='number' ? {numberValue:value} : {stringValue:value});
    values.push(structuredClone(grid.cells[row-1][5]?.userEnteredValue || grid.cells[row-1][5]?.effectiveValue || {}));
  }
  const serialized='KAS_APP_V1 '+JSON.stringify(note);
  if (serialized.length>45000) throw new Error('Riwayat perubahan baris terlalu panjang. Arsipkan lewat pengelola sebelum mengoreksi lagi.');
  return {duplicate:false,requests:[{updateCells:{range:{sheetId:grid.id,startRowIndex:row-1,endRowIndex:row,startColumnIndex:0,endColumnIndex:6},
    rows:[{values:values.map((userEnteredValue,i)=>({userEnteredValue,note:i===0 ? serialized : grid.notes[row-1][i] || ''}))}],fields:'userEnteredValue,note'}}]};
}
export function transactionView(source: Source,tx: Transaction) {
  const key=`${tx.sheetId}:${tx.row}`;
  return {...fields(tx),key,revision:rowReference(source,key).revision,editable:!!m.cashIsAfterCheckpoint_(tx,source.checkpoints[tx.fund]),changes:tx.meta?.changes || []};
}
export function deletedViews(source: Source,cfg: Config,fund: string,month: string) {
  const grid=fund==='MASJID' ? source.journal : source.phbi;
  return grid.notes.flatMap((notes,index)=>{
    const meta=m.cashMeta_(notes[0]) as TransactionMeta | null;
    if (!meta?.deleted || meta.fund!==fund || meta.date?.slice(0,7)!==month || !m.cashIsAfterReportBaseline_(meta,fund==='MASJID' ? cfg.baseline : cfg.phbiBaseline)) return [];
    const key=`${grid.id}:${index+1}`;
    return [{...fields(meta),key,revision:rowReference(source,key).revision,editable:!!m.cashIsAfterCheckpoint_(meta,source.checkpoints[meta.fund]),changes:meta.changes || []}];
  });
}
