const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {join,resolve,sep}=require('node:path');
const {tmpdir}=require('node:os');
const header='Tanggal;Dana;Jenis;Bendahara;Keterangan;Jumlah';
const row='09/10/2026;MASJID;Pemasukan;K1;Impor contoh;50.000';
async function fixture(t){
  const [{loadConfig},{DemoAdapter},{CashService},imports]=await Promise.all(['config','demo','service','import'].map(x=>import('../../dist/'+x+'.js')));
  const dir=await fs.mkdtemp(join(tmpdir(),'kas-import-'));t.after(()=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'kas-import-'));return fs.rm(dir,{recursive:true,force:true});});
  const cfg={...loadConfig({DEMO_MODE:'true',STATE_DIR:dir}),automatic:true},adapter=new DemoAdapter(cfg),service=new CashService(cfg,adapter);
  return {adapter,service,imports};
}
test('CSV preview normalizes dates, funds, types and Rupiah without writing any source or PDF',async t=>{
  const {adapter,service}=await fixture(t),before=JSON.stringify(await adapter.source());
  adapter.append=async()=>assert.fail('preview wrote cash');adapter.render=async()=>assert.fail('preview exported a PDF');
  const result=await service.previewImport('\ufeff'+header+'\r\n'+row+'\r\n2026-10-10;phbi;pengeluaran;k2;Konsumsi;Rp 20.000,00\r\n');
  assert.equal(result.rows.length,2);assert.equal(result.rows[0].input.amount,50000);assert.equal(result.rows[0].input.date,'2026-10-09');
  assert.equal(result.rows[1].input.fund,'PHBI');assert.equal(result.rows[1].input.type,'out');assert.equal(result.rows[1].input.code,'K2');assert.equal(result.rows[1].input.amount,20000);
  assert.equal(JSON.stringify(await adapter.source()),before);
});
test('CSV handles comma/semicolon separators, quoted newlines, escaped quotes and literal formula text',async t=>{
  const {service}=await fixture(t);
  const comma=header.replaceAll(';',',')+'\r\n2026-10-09,MASJID,in,K1,"=Contoh, ""aman""\nbaris kedua",50000';
  const result=await service.previewImport(comma);assert.equal(result.rows[0].input.description,'=Contoh, "aman"\nbaris kedua');
  assert.equal(result.rows[0].error,undefined);
});
test('Preview flags existing and repeated rows but still gives legitimate repeats independent IDs',async t=>{
  const {service}=await fixture(t);let result=await service.previewImport(header+'\n'+row+'\n'+row);
  assert.equal(result.rows[0].duplicate,false);assert.equal(result.rows[1].duplicate,true);assert.notEqual(result.rows[0].input.id,result.rows[1].input.id);
  await service.saveTransaction(result.rows[0].input);result=await service.previewImport(header+'\n'+row);assert.equal(result.rows[0].duplicate,true);
});
test('Invalid money, dates, funds, descriptions and columns are reported per row before any save',async t=>{
  const {service}=await fixture(t);
  for(const invalid of [row.replace('50.000','50,50'),row.replace('09/10/2026','31/02/2026'),row.replace('09/10/2026','01/10/2026'),row.replace('09/10/2026','01/01/2099'),row.replace('MASJID','UNKNOWN'),row.replace('K1','K9'),row.replace('Impor contoh',''),row.replace('50.000','9007199254740993'),row+';extra']){
    const result=await service.previewImport(header+'\n'+invalid);assert.equal(result.rows[0].input,undefined);assert.ok(result.rows[0].error,invalid);
  }
});
test('Malformed CSV, wrong headers, binary files, oversize files and more than 50 rows are refused',async t=>{
  const {service}=await fixture(t);
  for(const csv of [null,header,header+'\n"unclosed',header+'\n"2026-10-09"oops;MASJID;in;K1;X;1','Wrong\n'+row,header+'\n\0'+row,'x'.repeat(65537),header+'\n'+Array(51).fill(row).join('\n')]) await assert.rejects(async()=>service.previewImport(csv));
});
test('Imported rows use the ordinary verified save and UUID retry; PHBI stays out of the masjid report',async t=>{
  const {adapter,service}=await fixture(t),preview=await service.previewImport(header+'\n'+row+'\n'+row.replace('MASJID','PHBI'));
  const append=adapter.append.bind(adapter);let drop=true;
  adapter.append=async(...args)=>{await append(...args);if(drop){drop=false;throw Error('response lost');}};
  await assert.rejects(service.saveTransaction(preview.rows[0].input),/response lost/);
  assert.equal((await service.saveTransaction(preview.rows[0].input)).duplicate,true);
  await service.saveTransaction(preview.rows[1].input);
  const source=await adapter.source();assert.equal(source.report.income,300000);
  assert.equal((await service.getDashboard('PHBI','2026-10')).balance,550000);
});
