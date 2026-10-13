const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {loadGas,tx,json,fakePdf} = require('./helpers.cjs');
const request = {id:'11111111-1111-4111-a111-111111111111',fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:'Infaq uji',amount:100};

function setup() {
  const {gas:g,properties} = loadGas({OWNER_EMAIL:'owner@example.test',SOURCE_SPREADSHEET_ID:'source_private',REPORT_SPREADSHEET_ID:'report_private',PUBLIC_PDF_ID:'same_public_pdf',AUTO_PUBLISH_ENABLED:'true',REPORT_MODE:'HISTORICAL'});
  const cfg = g.cashConfig_();
  const rows = [tx('2026-05-01',3000),tx('2026-05-02',1000,'out')];
  const checkpoint = {date:'2026-10-08',amount:6149200,holders:{K1:6149000,K2:200,K3:0}};
  const state = () => {
    const report = g.cashBuildReport_(rows,cfg.opening,cfg.startDate);
    return {cfg,ledger:{transactions:rows},phbiTransactions:[],checkpoints:{MASJID:checkpoint},report,
      reconciliation:g.cashReconcileCheckpoint_(report,rows,checkpoint)};
  };
  g.cashSource_ = state;
  return {g,properties,cfg,rows,checkpoint,state};
}
function publisherMocks(g,cfg) {
  const calls = [], bytes = fakePdf(), blob = {getBytes:() => bytes}; let reads = 0;
  const md5 = crypto.createHash('md5').update(Buffer.from(bytes)).digest('hex');
  g.Drive = {Files:{
    get: (id) => {
      calls.push(['get',id]); reads++;
      return reads===1 ? {id,mimeType:'application/pdf',modifiedTime:'old',capabilities:{canEdit:true}} : {id,mimeType:'application/pdf',modifiedTime:'new',size:bytes.length,md5Checksum:md5,webViewLink:'https://drive.google.com/file/d/same_public_pdf/view'};
    },
    update: (metadata,id,media) => { calls.push(['update',id]); assert.equal(id,cfg.pdfId); assert.equal(media,blob); return {id}; },
    create: () => {throw new Error('Must not create a new public file');}
  }};
  g.cashWriteWorkbook_ = () => {calls.push(['writeReport']); return {};};
  g.cashVerifyWorkbook_ = () => calls.push(['readbackReport']);
  g.cashExportPdf_ = () => {calls.push(['export']); return blob;};
  return {calls,bytes};
}
test('Retrying an acknowledged or lost-response request does not append twice',() => {
  const {g,rows} = setup(); let writes=0;
  g.cashAppend_ = (_,input) => {writes++; rows.push({...input,meta:{...input},sheetId:1,row:4});};
  g.cashExtendFilter_ = (_,saved) => assert.equal(saved.row,4);
  g.cashPublishLocked_ = () => ({state:'BLOCKED',message:'Saldo perlu dicocokkan'});
  assert.equal(g.saveTransaction(request).saved,true);
  assert.equal(g.saveTransaction(request).duplicate,true);
  assert.equal(writes,1);
  assert.throws(() => g.saveTransaction({...request,amount:200}),/transaksi berbeda/);
});
test('A publishing error reports a saved transaction and keeps retry idempotent',() => {
  const {g,rows} = setup();
  g.cashAppend_ = (_,input) => rows.push({...input,meta:{...input},sheetId:1,row:4});
  g.cashExtendFilter_ = () => {};
  g.cashPublishLocked_ = () => {throw new Error('Export timeout');};
  const result = g.saveTransaction(request);
  assert.equal(result.saved,true); assert.equal(result.report.state,'ERROR');
  assert.equal(g.saveTransaction(request).duplicate,true);
});
test('Edited source transactions cannot silently pass an old request id',() => {
  const {g,rows} = setup();
  rows.push({...request,amount:200,meta:request});
  assert.throws(() => g.saveTransaction(request),/sudah diubah di Sheet/);
});
test('A failed readback leaves the request unacknowledged for safe retry',() => {
  const {g} = setup(); g.cashAppend_ = () => {};
  assert.throws(() => g.saveTransaction(request),/belum dapat diverifikasi/);
});
test('Unknown active user is rejected before any write',() => {
  const {g} = setup(); g.Session.getActiveUser = () => ({getEmail:() => ''});
  assert.throws(() => g.saveTransaction(request),/akun pemilik/);
});
test('A baseline mismatch blocks workbook writes, export and PDF replacement',() => {
  const {g,cfg,checkpoint} = setup(); checkpoint.amount += 100;
  const {calls} = publisherMocks(g,cfg);
  const result = g.cashPublishLocked_();
  assert.equal(result.state,'BLOCKED'); assert.equal(result.reconciliation.difference,100);
  assert.deepEqual(calls,[]);
});
test('An unchanged public signature does not regenerate the PDF',() => {
  const {g,cfg,properties,state} = setup();
  properties.LAST_PUBLISHED_HASH = g.cashSha_(g.cashReportSignature_(state().report));
  const {calls} = publisherMocks(g,cfg);
  assert.equal(g.cashPublishLocked_().state,'UNCHANGED'); assert.deepEqual(calls,[]);
});
test('Validated publication updates the same Drive id and verifies bytes and checksum',() => {
  const {g,cfg,properties} = setup(); const {calls} = publisherMocks(g,cfg);
  const result = g.cashPublishLocked_();
  assert.equal(result.state,'PUBLISHED'); assert.equal(result.ending,6149200);
  assert.deepEqual(calls.map(row => row[0]),['get','writeReport','readbackReport','export','update','get']);
  assert.equal(calls.find(row => row[0]==='update')[1],'same_public_pdf');
  assert.ok(properties.LAST_PUBLISHED_HASH); assert.equal(properties.REPORT_DIRTY,'false');
});
test('Failed report validation never overwrites public PDF',() => {
  const {g,cfg} = setup(); const {calls} = publisherMocks(g,cfg);
  g.cashVerifyWorkbook_ = () => {throw new Error('Subtotal mismatch');};
  assert.throws(() => g.cashPublishLocked_(),/Subtotal mismatch/);
  assert.equal(calls.some(row => row[0]==='update'),false);
});
test('A manual source edit during export aborts PDF replacement',() => {
  const {g,cfg,rows} = setup(); const {calls,bytes} = publisherMocks(g,cfg);
  g.cashExportPdf_ = () => {rows.push(tx('2026-10-09',100)); return {getBytes:() => bytes};};
  assert.throws(() => g.cashPublishLocked_(),/sumber berubah/);
  assert.equal(calls.some(row => row[0]==='update'),false);
});
test('Preview verifies the report and returns a private URL without replacing the public PDF',() => {
  const {g,cfg} = setup(); const {calls} = publisherMocks(g,cfg);
  g.cashSavePrivatePreview_=(target,blob)=>{
    assert.equal(target.pdfId,cfg.pdfId); assert.ok(blob.getBytes().length>1000);
    return {id:'private_preview',webViewLink:'https://drive.google.com/file/d/private_preview/view'};
  };
  const result = g.previewPublicPdf();
  assert.equal(result.ready,true); assert.equal(result.id,'private_preview');
  assert.equal(result.pdfUrl,'https://drive.google.com/file/d/private_preview/view');
  assert.deepEqual(calls.map(row => row[0]),['writeReport','readbackReport','export']);
});
test('A verified private preview is created once and reused without public sharing',() => {
  const {g,properties,cfg}=setup(), bytes=fakePdf(), blob={getBytes:()=>bytes}, calls=[];
  const privateFile={id:'private_preview',mimeType:'application/pdf',size:bytes.length,
    md5Checksum:crypto.createHash('md5').update(Buffer.from(bytes)).digest('hex'),
    webViewLink:'https://drive.google.com/file/d/private_preview/view',
    permissions:[{type:'user',role:'owner',emailAddress:'owner@example.test'}]};
  g.Drive={Files:{create(metadata,media){calls.push('create');assert.equal(metadata.permissions,undefined);assert.equal(metadata.parents,undefined);assert.equal(media,blob);return privateFile;},
    get(id){assert.equal(id,'private_preview');return privateFile;},
    update(metadata,id,media){calls.push('update');assert.equal(id,'private_preview');assert.equal(media,blob);return privateFile;}}};
  assert.equal(g.cashSavePrivatePreview_(cfg,blob).id,'private_preview');
  assert.equal(properties.PRIVATE_PREVIEW_PDF_ID,'private_preview');
  assert.equal(g.cashSavePrivatePreview_(cfg,blob).id,'private_preview');
  assert.deepEqual(calls,['create','update']);
});
test('Preview refuses a shared file or the public PDF before any replacement',() => {
  const {g,properties,cfg}=setup(), blob={getBytes:()=>fakePdf()};let writes=0;
  properties.PRIVATE_PREVIEW_PDF_ID=cfg.pdfId;
  g.Drive={Files:{get(){return {id:'private_preview',mimeType:'application/pdf',permissions:[{type:'anyone',role:'reader'}]};},update(){writes++;},create(){writes++;}}};
  assert.throws(()=>g.cashSavePrivatePreview_(cfg,blob),/tidak boleh sama/);
  properties.PRIVATE_PREVIEW_PDF_ID='private_preview';
  assert.throws(()=>g.cashSavePrivatePreview_(cfg,blob),/PDF privat/);
  assert.equal(writes,0);
});
test('Future transactions cannot be published',() => {
  const {g,cfg,rows} = setup(); rows.push(tx('2026-10-10',100)); const {calls} = publisherMocks(g,cfg);
  assert.throws(() => g.cashPublishLocked_(),/setelah hari ini/); assert.deepEqual(calls,[]);
});
test('PDF gates reject HTML, Letter paper, missing page dictionaries and missing sections',() => {
  const {gas:g} = loadGas();
  g.cashVerifyPdfBytes_(fakePdf());
  assert.throws(() => g.cashVerifyPdfBytes_(Array.from(Buffer.from('<html>error</html>'))),/bukan PDF/);
  assert.throws(() => g.cashVerifyPdfBytes_(fakePdf(612,792)),/A4 portrait/);
  assert.throws(() => g.cashVerifyPdfBytes_(Array.from(Buffer.from('%PDF-'+ ' '.repeat(1200)))),/A4 portrait/);
  assert.throws(() => g.cashVerifyPdfBytes_(fakePdf(595.28,841.89,2)),/kedua bagian/);
});
test('Append uses typed strings and stores complete idempotency metadata atomically',() => {
  const {gas:g} = loadGas(); const requests=[];
  g.Sheets = {Spreadsheets:{get:() => ({sheets:[{data:[{rowData:[{values:[]}]}]}]}),batchUpdate:(body,id) => {requests.push({body,id});}}};
  const input = {...request,description:'=IMPORTXML("https://example.test","//x")'};
  const state = {cfg:{sourceId:'source_private',writeInId:1,writeOutId:2},checkpoints:{MASJID:{date:'2026-10-08',amount:1000,holders:{K1:1000,K2:0,K3:0}}},ledger:{streams:[{id:1,title:'Masuk',type:'in'}]},grids:[{id:1,rows:[['Tanggal','Kode','Keterangan','Pemasukan'],['2026-10-08','K1','Infaq',100]]}]};
  g.cashAppend_(state,input);
  const append = requests[0].body.requests[0].appendCells;
  assert.equal(append.sheetId,1); assert.equal(append.rows[0].values[2].userEnteredValue.stringValue,input.description);
  assert.equal(append.rows[0].values[2].userEnteredValue.formulaValue,undefined);
  const meta = g.cashMeta_(append.rows[0].values[0].note);
  assert.equal(meta.id,input.id); assert.equal(meta.amount,100); assert.equal(meta.afterSync,true);
});
test('Filter extension preserves existing criteria and never rewrites transactions',() => {
  const {gas:g} = loadGas(); const calls=[];
  const filter = {range:{sheetId:9,startRowIndex:0,endRowIndex:20,startColumnIndex:0,endColumnIndex:6},criteria:{1:{hiddenValues:['K2']}}};
  g.Sheets = {Spreadsheets:{get:() => ({sheets:[{properties:{sheetId:9},basicFilter:filter}]}),batchUpdate:(request) => calls.push(request)}};
  g.cashExtendFilter_({sourceId:'source_private'},{sheetId:9,row:21});
  assert.deepEqual(json(calls[0].requests[0].setBasicFilter.filter.criteria),{1:{hiddenValues:['K2']}});
  assert.equal(calls[0].requests[0].setBasicFilter.filter.range.endRowIndex,21);
  assert.equal(calls[0].requests.length,1);
});
