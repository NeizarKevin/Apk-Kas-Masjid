const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const crypto=require('node:crypto');
const modules=Promise.all(['config','demo','service','state','accounting'].map(name=>import('../../dist/'+name+'.js')));
const input=extra=>({id:crypto.randomUUID(),fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:'Uji kiriman',amount:100,...extra});
async function fixture(t,automatic=false) {
  const [{loadConfig},{DemoAdapter},{CashService}]=await modules;
  const dir=await mkdtemp(join(tmpdir(),'kas-service-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const cfg={...loadConfig({DEMO_MODE:'true',STATE_DIR:dir}),automatic},adapter=new DemoAdapter(cfg);
  const rendered=[],published=[];
  adapter.render=async report=>{rendered.push(report);return Buffer.from('test bytes');};
  adapter.publish=async(bytes,preview)=>{published.push({bytes,preview});return '/api/pdf/'+(preview?'preview':'public');};
  const service=new CashService(cfg,adapter,async()=>({pageCount:3,pages:[]}));
  return {cfg,adapter,service,rendered,published,CashService};
}
test('Concurrent retry and process restart preserve UUID idempotency while legitimate repeats remain',async t=>{
  const {cfg,adapter,service,CashService}=await fixture(t),tx=input();
  const responses=await Promise.all([service.saveTransaction(tx),service.saveTransaction(tx)]);
  assert.deepEqual(responses.map(r=>r.duplicate),[false,true]);
  const restarted=new CashService(cfg,adapter);assert.equal((await restarted.saveTransaction(tx)).duplicate,true);
  await restarted.saveTransaction({...tx,id:crypto.randomUUID()});
  assert.equal((await adapter.source()).report.income,250200);
  await assert.rejects(service.saveTransaction({...tx,amount:101}),/ID kiriman/);
});
test('A network failure after commit retries the old UUID instead of adding cash twice',async t=>{
  const {adapter,service}=await fixture(t),tx=input(),append=adapter.append.bind(adapter);
  let drop=true;adapter.append=async(...args)=>{await append(...args);if(drop){drop=false;throw new Error('response lost');}};
  await assert.rejects(service.saveTransaction(tx),/response lost/);
  assert.equal((await service.resolvePendingRequest(tx.id)).saved,true);
  assert.equal((await service.saveTransaction(tx)).duplicate,true);
  assert.equal((await adapter.source()).report.income,250100);
});
test('PDF failure acknowledges a verified save and never creates another transaction',async t=>{
  const {adapter,service}=await fixture(t,true),tx=input();adapter.render=async()=>{throw new Error('export failed');};
  const result=await service.saveTransaction(tx);
  assert.equal(result.saved,true);assert.equal(result.report.state,'ERROR');
  assert.equal((await service.saveTransaction(tx)).duplicate,true);
  assert.equal((await adapter.source()).report.income,250100);
});
test('An edited old request moved before the opening cannot be inserted again',async t=>{
  const {cfg,service}=await fixture(t),tx=input();await service.saveTransaction(tx);
  const path=join(cfg.stateDir,'demo-sheet.json'),book=JSON.parse(await require('node:fs/promises').readFile(path,'utf8'));
  const row=book.sheets[0].data[0].rowData.find(row=>row.values[0].note?.includes(tx.id));
  row.values[0].userEnteredValue={stringValue:'2026-10-07'};
  await require('node:fs/promises').writeFile(path,JSON.stringify(book));
  await assert.rejects(service.saveTransaction(tx),/di luar periode/);
});
test('A checkpoint mismatch blocks export; changed sources abort publication',async t=>{
  const {adapter,service,rendered,published}=await fixture(t,true),source=adapter.source.bind(adapter);
  adapter.source=async()=>({...await source(),reconciliation:{ok:false,date:'2026-10-09',book:100,actual:110,difference:10}});
  assert.equal((await service.refreshPublicPdf()).state,'BLOCKED');assert.equal(rendered.length,0);assert.equal(published.length,0);
  adapter.source=source;
  adapter.render=async()=>{await adapter.append(await source(),input());return Buffer.from('stale');};
  const result=await service.refreshPublicPdf();assert.equal(result.state,'ERROR');assert.match(result.message,/Sumber berubah/);assert.equal(published.length,0);
});
test('Unchanged signatures skip export; preview never publishes the public file',async t=>{
  const {service,rendered,published}=await fixture(t,true);
  assert.equal((await service.refreshPublicPdf()).state,'PUBLISHED');assert.equal((await service.refreshPublicPdf()).state,'UNCHANGED');
  assert.equal(rendered.length,1);assert.equal(published.length,1);
  const result=await service.previewPublicPdf();assert.equal(result.ready,true);assert.equal(published.at(-1).preview,true);
});
test('Dashboard keeps PHBI separate and rejects invalid month/fund values',async t=>{
  const {service}=await fixture(t);
  const masjid=await service.getDashboard('MASJID','2026-10'),phbi=await service.getDashboard('PHBI','2026-10');
  assert.equal(masjid.balance,1200000);assert.equal(phbi.balance,500000);assert.equal(phbi.checkpoint.holders.K2,null);
  await assert.rejects(service.getDashboard('ANY','2026-10'));
  await assert.rejects(service.getDashboard('MASJID','2026-99'));
});
test('Encrypted offline tokens and process lock survive restarts and refuse a second server',async t=>{
  const [,,, {TokenStore,acquireProcessLock}]=await modules;
  const dir=await mkdtemp(join(tmpdir(),'kas-state-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const secret=crypto.randomBytes(32).toString('base64'),store=new TokenStore(dir,secret);
  await store.save({refresh_token:'synthetic_token'});assert.deepEqual(await new TokenStore(dir,secret).load(),{refresh_token:'synthetic_token'});
  const text=await require('node:fs/promises').readFile(join(dir,'google-token.json'),'utf8');assert.equal(text.includes('synthetic_token'),false);
  await assert.rejects(new TokenStore(dir,crypto.randomBytes(32).toString('base64')).load());
  const release=await acquireProcessLock(dir);await assert.rejects(acquireProcessLock(dir),/already being held/);await release();
  const after=await acquireProcessLock(dir);await after();
});
