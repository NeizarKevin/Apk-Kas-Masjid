const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve,sep}=require('node:path');
const crypto=require('node:crypto');
async function fixture(t,automatic=false) {
  const [{loadConfig},{DemoAdapter},{CashService},changes]=await Promise.all(['config','demo','service','changes'].map(name=>import('../../dist/'+name+'.js')));
  const dir=await fs.mkdtemp(join(tmpdir(),'kas-change-'));t.after(async()=>{assert.ok(resolve(dir).startsWith(resolve(tmpdir())+sep+'kas-change-'));await fs.rm(dir,{recursive:true,force:true});});
  const cfg={...loadConfig({DEMO_MODE:'true',STATE_DIR:dir}),automatic},adapter=new DemoAdapter(cfg),published=[];
  adapter.render=async()=>Buffer.from('mock PDF');adapter.publish=async(bytes,preview)=>{published.push(preview);return '/api/pdf/public';};
  const service=new CashService(cfg,adapter,async()=>({pageCount:3,pages:[]}));
  const view=async(description)=>{const dashboard=await service.getDashboard('MASJID','2026-10');return dashboard.transactions.find(tx=>tx.description===description);};
  const request=(tx,action,extra={})=>({id:crypto.randomUUID(),key:tx.key,revision:tx.revision,action,reason:'Koreksi sesuai bukti',...extra});
  return {cfg,adapter,service,view,request,changes,published};
}
test('Edit updates the exact transaction and audit history; simultaneous retries keep one operation',async t=>{
  const {adapter,service,view,request,published}=await fixture(t,true),tx=await view('Contoh biaya kebersihan');
  const correction=request(tx,'edit',{input:{fund:'MASJID',type:'out',code:'K2',date:'2026-10-10',description:'Biaya kebersihan terkoreksi',amount:60000}});
  const responses=await Promise.all([service.changeTransaction(correction),service.changeTransaction(correction)]);
  assert.deepEqual(responses.map(r=>r.duplicate),[false,true]);
  assert.equal(responses[0].report.state,'READY');assert.equal(published.length,0);
  const corrected=await view('Biaya kebersihan terkoreksi');assert.equal(corrected.amount,60000);assert.equal(corrected.code,'K2');assert.equal(corrected.changes.length,1);assert.equal(corrected.changes[0].before.amount,50000);
  const source=await adapter.source();assert.equal(source.report.expense,60000);assert.equal(source.report.ending,1190000);
  assert.equal((await service.refreshPublicPdf()).state,'PUBLISHED');assert.equal(published.length,1);
  await assert.rejects(service.changeTransaction({...correction,reason:'Different request'}),/ID perubahan/);
});
test('Delete is recoverable, keeps the same row and UUID, and excludes cash from the active report',async t=>{
  const {cfg,adapter,service,view,request}=await fixture(t);
  const id=crypto.randomUUID();await service.saveTransaction({id,fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:'Transaksi hapus uji',amount:123});
  const tx=await view('Transaksi hapus uji'),source=await adapter.source();
  const row=source.book.sheets[0].data[0].rowData[Number(tx.key.split(':')[1])-1];row.values[2].note='Catatan manual tambahan';
  await fs.writeFile(join(cfg.stateDir,'demo-sheet.json'),JSON.stringify(source.book));
  const fresh=await view('Transaksi hapus uji'),deletion=request(fresh,'delete');await service.changeTransaction(deletion);
  const removed=await service.getDashboard('MASJID','2026-10');assert.equal(removed.income,250000);assert.equal(removed.deletedTransactions.length,1);assert.equal(removed.deletedTransactions[0].key,tx.key);
  assert.equal((await service.resolvePendingRequest(id)).saved,true);
  await assert.rejects(service.saveTransaction({id,fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:'Transaksi hapus uji',amount:123}),/sudah dihapus/);
  await service.changeTransaction(request(removed.deletedTransactions[0],'restore'));
  const restored=await view('Transaksi hapus uji');assert.equal(restored.key,tx.key);assert.equal(restored.amount,123);assert.equal(restored.changes.length,2);
  const current=await adapter.source();assert.equal(current.report.income,250123);assert.equal(current.journal.notes[Number(tx.key.split(':')[1])-1][2],'Catatan manual tambahan');
});
test('A lost mutation response is resolved and retried without applying another change',async t=>{
  const {adapter,service,view,request}=await fixture(t),tx=await view('Contoh biaya kebersihan'),change=adapter.change.bind(adapter);
  let drop=true;adapter.change=async request=>{await change(request);if(drop){drop=false;throw new Error('response lost');}};
  const correction=request(tx,'edit',{input:{fund:'MASJID',type:'out',code:'K1',date:'2026-10-10',description:tx.description,amount:75000}});
  await assert.rejects(service.changeTransaction(correction),/response lost/);
  assert.equal((await service.resolveChange(correction.id)).changed,true);
  assert.equal((await service.changeTransaction(correction)).duplicate,true);
  assert.equal((await view(tx.description)).changes.length,1);
});
test('Stale revisions, wrong funds, header rows, and transactions included in a physical count are refused',async t=>{
  const {cfg,adapter,service,view,request}=await fixture(t),tx=await view('Contoh biaya kebersihan');
  await assert.rejects(service.changeTransaction(request(tx,'edit',{input:{fund:'PHBI',type:'out',code:'K1',date:tx.date,description:tx.description,amount:50}})),/Jenis dana/);
  await assert.rejects(service.changeTransaction(request({...tx,key:cfg.journalId+':1'},'delete')),/tidak tersedia/);
  const edit=request(tx,'edit',{input:{fund:'MASJID',type:'out',code:'K1',date:tx.date,description:tx.description,amount:51}});await service.changeTransaction(edit);
  await assert.rejects(service.changeTransaction(request(tx,'delete')),/berubah sejak/);
  const source=await adapter.source(),checkpoint=source.book.sheets.find(sheet=>sheet.properties.sheetId===cfg.syncId);
  checkpoint.data[0].rowData[1].values[0].userEnteredValue={stringValue:'2026-10-14'};
  await fs.writeFile(join(cfg.stateDir,'demo-sheet.json'),JSON.stringify(source.book));
  const closed=await view(tx.description);assert.equal(closed.editable,false);await assert.rejects(service.changeTransaction(request(closed,'delete')),/hitung fisik/);
});
test('Tombstones reserve rows and stay compatible with the original Apps Script ledger',async t=>{
  const {adapter,service,view,request}=await fixture(t),tx=await view('Contoh biaya kebersihan');await service.changeTransaction(request(tx,'delete'));
  await service.saveTransaction({id:crypto.randomUUID(),fund:'MASJID',type:'in',code:'K1',date:'2026-10-11',description:'Baris baru',amount:1});
  const next=await view('Baris baru');assert.equal(Number(next.key.split(':')[1]),Number(tx.key.split(':')[1])+1);
  const source=await adapter.source(),{gas}=require('../helpers.cjs').loadGas();
  const old=gas.cashReadLedger_([source.journal],'2026-10-08','Asia/Jakarta');assert.equal(old.transactions.some(tx=>tx.description==='Contoh biaya kebersihan'),false);
  assert.equal(old.transactions.length,source.transactions.length);
});
test('PHBI corrections remain separate and audit text never enters the public report signature',async t=>{
  const {service,adapter,request}=await fixture(t);await service.saveTransaction({id:crypto.randomUUID(),fund:'PHBI',type:'in',code:'K1',date:'2026-10-09',description:'Contoh PHBI',amount:100});
  const tx=(await service.getDashboard('PHBI','2026-10')).transactions[0];await service.changeTransaction(request(tx,'edit',{input:{fund:'PHBI',type:'in',code:'K1',date:tx.date,description:tx.description,amount:250}}));
  assert.equal((await service.getDashboard('PHBI','2026-10')).balance,500250);
  const {signature}=await import('../../dist/accounting.js'),source=await adapter.source();assert.equal(source.report.income,250000);assert.equal(source.report.ending,1200000);assert.equal(source.checkpoints.PHBI.holders.K2,null);assert.equal(typeof signature(source.report),'string');
});
