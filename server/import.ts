import {randomUUID} from 'node:crypto';
import * as m from './model.js';
import type {Input,Source,Transaction} from './types.js';

export const CSV_TEMPLATE='\ufeffTanggal;Dana;Jenis;Bendahara;Keterangan;Jumlah\r\n';
export interface ImportRow {row:number;input?:Input;error?:string;duplicate?:boolean}
export function parseImportCsv(value: unknown): string[][] {
  if (typeof value !== 'string' || Buffer.byteLength(value,'utf8')>65536 || /[\0\ufffd]/.test(value)) throw Error('Gunakan CSV UTF-8, maksimal 64 KB.');
  const text=value.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n'),header=text.split('\n',1)[0];
  const delimiter=header.includes(';') ? ';' : ',',rows:string[][]=[];
  let cells:string[]=[],cell='',quoted=false,closed=false;
  const endCell=()=>{cells.push(cell);cell='';closed=false;};
  const endRow=()=>{endCell();if(cells.some(x=>x.trim()))rows.push(cells);cells=[];if(rows.length>51)throw Error('Maksimal 50 transaksi per file. Pecah file menjadi beberapa bagian.');};
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(quoted){if(char==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=char;continue;}
    if(char===delimiter){endCell();continue;}
    if(char==='\n'){endRow();continue;}
    if(closed){if(char===' ' || char==='\t')continue;throw Error('CSV tidak valid: ada teks setelah tanda kutip penutup.');}
    if(char==='"'){if(cell)throw Error('CSV tidak valid: tanda kutip harus mengapit seluruh isi kolom.');quoted=true;}else cell+=char;
  }
  if(quoted)throw Error('CSV tidak valid: tanda kutip belum ditutup.');
  endRow();
  if(rows.shift()?.map(x=>x.trim().toLowerCase()).join(';')!=='tanggal;dana;jenis;bendahara;keterangan;jumlah')throw Error('Kolom CSV tidak sesuai. Unduh dan gunakan template impor.');
  if(!rows.length)throw Error('CSV belum berisi transaksi. Isi template terlebih dahulu.');
  return rows;
}
const matchingKey=(tx:Input|Transaction)=>JSON.stringify([tx.date,tx.fund,tx.type,tx.code,tx.description.trim(),tx.amount]);
export function previewImportRows(rows:string[][],source:Source,today:string): ImportRow[] {
  const seen=new Set(source.transactions.concat(source.phbiTransactions).map(matchingKey));
  return rows.map((cells,index)=>{
    try{
      if(cells.length!==6)throw Error('Baris harus memiliki 6 kolom. Apit keterangan dengan tanda kutip jika berisi pemisah.');
      const [rawDate,rawFund,rawType,rawCode,description,rawAmount]=cells.map(x=>x.trim());
      const amount=rawAmount.replace(/^Rp\s*/i,'');
      if(!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,00)?$/.test(amount))throw Error('Jumlah harus Rupiah bulat, misalnya 50000 atau 50.000.');
      const match=/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(rawDate);
      const date=match ? `${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}` : rawDate;
      const fund=rawFund.toUpperCase() as Input['fund'],kind=rawType.toLowerCase();
      const tx=m.cashValidateInput_({id:randomUUID(),date,fund,type:kind==='pemasukan' ? 'in' : kind==='pengeluaran' ? 'out' : kind,code:rawCode.toUpperCase(),description,amount:Number(amount.replace(/,00$/,'').replace(/\./g,''))},today,source.checkpoints[fund]) as Input;
      const key=matchingKey(tx),duplicate=seen.has(key);seen.add(key);
      return {row:index+2,input:tx,duplicate};
    }catch(error){return {row:index+2,error:(error as Error).message};}
  });
}
