const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {loadGas,json}=require('../helpers.cjs');
const modules=Promise.all(['config','demo','accounting','model'].map(name=>import('../../dist/'+name+'.js')));
const input=extra=>({id:crypto.randomUUID(),fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:'Infaq uji',amount:100,...extra});

test('Ported accounting matches the original opening-day, baseline and checkpoint rules',async()=>{
  const [{loadConfig},{demoBook},{buildSource},m]=await modules;
  const cfg=loadConfig({DEMO_MODE:'true'}),source=buildSource(demoBook(cfg),cfg),{gas}=loadGas();
  const transactions=[...source.transactions,{...source.transactions[0],date:cfg.baseline.date,amount:12,meta:{afterSync:true,reportBaselineKey:m.cashCheckpointKey_(cfg.baseline)}},{...source.transactions[0],date:cfg.baseline.date,amount:999,meta:null}];
  assert.deepEqual(json(m.cashNewPeriodReport_(transactions,cfg.baseline)),json(gas.cashNewPeriodReport_(transactions,cfg.baseline)));
  const report=m.cashNewPeriodReport_(transactions,cfg.baseline);
  assert.equal(report.income,250012);assert.equal(report.ending,1200012);
  assert.equal(m.cashIso_(new Date('2026-10-08T18:30:00Z'),'Asia/Jakarta'),'2026-10-09');
});
test('Source only reads the active journal and preserves unknown PHBI wallets',async()=>{
  const [{loadConfig},{demoBook},{buildSource}]=await modules;
  const cfg=loadConfig({DEMO_MODE:'true'}),book=demoBook(cfg);
  book.sheets.push({properties:{sheetId:999,title:'ARSIP PEMASUKAN',index:4},data:[{rowData:[]} ]});
  const source=buildSource(book,cfg);
  assert.equal(source.report.income,250000);assert.equal(source.report.expense,50000);assert.equal(source.report.ending,1200000);
  assert.equal(source.checkpoints.PHBI.holders.K2,null);assert.equal(source.checkpoints.PHBI.holders.K3,null);
  book.sheets[0].developerMetadata[0].metadataValue='OTHER';assert.throws(()=>buildSource(book,cfg),/metadata/);
});
test('Writes use the next exact A:F range, typed strings, UUID notes, and grow a full grid',async()=>{
  const [{loadConfig},{demoBook},{buildSource,appendPlan}]=await modules;
  const cfg=loadConfig({DEMO_MODE:'true'}),book=demoBook(cfg);
  // Remote A:F read excludes far-right formulas; blank row notes still reserve their rows.
  book.sheets[0].data[0].rowData.push({values:[{note:'Catatan manual'}]},...Array.from({length:10},()=>({values:[]})));
  book.sheets[0].properties.gridProperties.rowCount=4;
  const source=buildSource(book,cfg),tx=input({description:'=IMPORTXML("x")'}),requests=appendPlan(source,tx,cfg,'2026-10-09T01:00:00Z');
  assert.equal(requests[0].appendDimension.length,1);
  const update=requests[1].updateCells;
  assert.deepEqual(update.range,{sheetId:cfg.journalId,startRowIndex:4,endRowIndex:5,startColumnIndex:0,endColumnIndex:6});
  assert.deepEqual(update.rows[0].values[2].userEnteredValue,{stringValue:tx.description});
  const meta=JSON.parse(update.rows[0].values[0].note.slice('KAS_APP_V1 '.length));
  assert.equal(meta.id,tx.id);assert.equal(meta.afterSync,true);assert.ok(meta.checkpointKey);assert.ok(meta.reportBaselineKey);
  const phbi=appendPlan(source,input({fund:'PHBI'}),cfg).at(-1).updateCells;
  assert.equal(phbi.range.sheetId,cfg.phbiId);assert.equal(phbi.range.startRowIndex,1);
});
test('Source and input validation reject malformed money, ambiguous UUIDs and changed headers',async()=>{
  const [{loadConfig},{demoBook},{buildSource},m]=await modules;
  const cfg=loadConfig({DEMO_MODE:'true'}),book=demoBook(cfg);
  book.sheets[0].data[0].rowData[1].values[4]={userEnteredValue:{numberValue:1}};
  assert.throws(()=>buildSource(book,cfg),/satu kolom/);
  for(const amount of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1]) assert.throws(()=>m.cashValidateInput_(input({amount}),'2026-10-14',cfg.baseline));
  assert.throws(()=>m.cashValidateInput_(input({date:'2026-10-07'}),'2026-10-14',cfg.baseline),/sinkronisasi/);
  assert.throws(()=>m.cashValidateInput_(input({date:'2026-10-15'}),'2026-10-14',cfg.baseline),/hari ini/);
});
