const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const modules=Promise.all(['config','demo','google','accounting','workbook'].map(name=>import('../../dist/'+name+'.js')));
const cell=v=>({userEnteredValue:typeof v === 'number' ? {numberValue:v} : {stringValue:v},userEnteredFormat:{textFormat:{fontFamily:'Arial'},wrapStrategy:'WRAP'}});
function template(cfg) {
  const summary=Array.from({length:27},()=>({values:Array.from({length:8},()=>cell(''))}));
  summary[0].values[0]=cell('LAPORAN ARUS KAS');summary[15].values[0]=cell('Bulan');summary[16].values[0]=cell('Oktober 2026');summary[22].values[0]=cell('CATATAN LAPORAN');
  const detail=title=>[{values:[cell(title)]},{values:[cell('Periode lama')]},{values:[]},{values:[cell('Tanggal'),cell('Keterangan'),cell('Jumlah (Rp)')]},{values:[cell('Oktober 2026'),cell(''),cell('')]},{values:[cell(''),cell('Belum ada transaksi'),cell('')]},{values:[cell(''),cell('Subtotal Oktober 2026'),cell(0)]},{values:[cell(''),cell(''),cell('')]},{values:[cell(''),cell('TOTAL RINCIAN'),cell(0)]}];
  return {spreadsheetId:cfg.reportId,properties:{timeZone:'Asia/Jakarta'},sheets:['Laporan Arus Kas','Rincian Penerimaan Kas','Rincian Pengeluaran Kas'].map((title,i)=>({properties:{sheetId:cfg.reportSheetIds[i],title,index:i,sheetType:'GRID',gridProperties:{rowCount:i===0?27:9,columnCount:i===0?8:3}},data:[{rowData:i===0?summary:detail(title)}]}))};
}
function apply(book,requests) {
  for(const r of requests) {
    const spec=Object.values(r)[0],id=spec.range?.sheetId || spec.sheetId || spec.properties?.sheetId || spec.destination?.sheetId;
    const sheet=book.sheets.find(s=>s.properties.sheetId===id),rows=sheet?.data[0].rowData;
    if(r.insertDimension){rows.splice(spec.range.startIndex,0,...Array.from({length:spec.range.endIndex-spec.range.startIndex},()=>({values:[]})));sheet.properties.gridProperties.rowCount+=spec.range.endIndex-spec.range.startIndex;}
    if(r.deleteDimension){rows.splice(spec.range.startIndex,spec.range.endIndex-spec.range.startIndex);sheet.properties.gridProperties.rowCount-=spec.range.endIndex-spec.range.startIndex;}
    if(r.appendDimension) sheet.properties.gridProperties.rowCount+=spec.length;
    if(r.updateCells) {
      for(let i=spec.range.startRowIndex;i<spec.range.endRowIndex;i++) {
        rows[i]||={values:[]};
        for(let c=spec.range.startColumnIndex;c<spec.range.endColumnIndex;c++) {
          const value=spec.rows?.[i-spec.range.startRowIndex]?.values[c-spec.range.startColumnIndex] || {};
          rows[i].values[c]={...rows[i].values[c],...value};if(!value.userEnteredValue)delete rows[i].values[c].userEnteredValue;
        }
      }
    }
  }
}
async function fixture() {
  const [{loadConfig},{demoBook},{GoogleAdapter},{buildSource}]=await modules,cfg=loadConfig({DEMO_MODE:'true'});
  const source=demoBook(cfg),reportBook=template(cfg),calls=[],bytes=Buffer.from('%PDF-synthetic-output');let updated=false,sharedPreview=false,wrongChecksum=false,sharedArchive=false;
  const file=id=>({id,mimeType:id===cfg.sourceId||id===cfg.reportId?'application/vnd.google-apps.spreadsheet':id===cfg.archiveId?'application/vnd.google-apps.folder':'application/pdf',capabilities:{canEdit:true},size:updated?bytes.length:1234,md5Checksum:wrongChecksum?'wrong':crypto.createHash('md5').update(bytes).digest('hex'),modifiedTime:updated?'new':'old',webViewLink:'https://drive.google.com/file/d/'+id+'/view',permissions:[{id:'owner',type:'user',role:'owner'},...(id===cfg.pdfId||(id===cfg.previewId&&sharedPreview)||(id==='archive_copy'&&sharedArchive)?[{id:'public',type:'anyone',role:'reader',allowFileDiscovery:false}]:[])]});
  const fetcher=async(url,options={})=>{
    calls.push({url,options});const u=new URL(url),method=options.method||'GET';let body;
    if(u.hostname==='sheets.googleapis.com') {
      const target=url.includes(cfg.sourceId)?source:reportBook;
      if(method==='POST'){apply(target,JSON.parse(options.body).requests);body={replies:[]};}else body=structuredClone(target);
    }else if(u.pathname.endsWith('/export'))return new Response(bytes,{headers:{'content-type':'application/pdf'}});
    else if(u.pathname.endsWith('/copy'))body={id:'archive_copy'};
    else if(method==='PATCH'){updated=true;body=file(cfg.pdfId);}
    else body=file(u.pathname.split('/').at(-1));
    return new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
  };
  const adapter=new GoogleAdapter(cfg,{getAccessToken:async()=>({token:'test_token'})},fetcher);
  return {cfg,source,reportBook,calls,bytes,adapter,getReport:()=>buildSource(source,cfg).report,setSharedPreview:()=>sharedPreview=true,setWrongChecksum:()=>wrongChecksum=true,setSharedArchive:()=>sharedArchive=true};
}
test('REST adapter verifies original targets, ignores I:Z, writes literal A:F and reuses the template export',async()=>{
  const {cfg,calls,adapter}=await fixture();await adapter.verifyTargets();
  const source=await adapter.source(),tx={id:crypto.randomUUID(),fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:'=SUM(A1)',amount:100};
  await adapter.append(source,tx);assert.equal((await adapter.source()).report.income,250100);
  const write=calls.find(c=>c.options.method==='POST'&&c.url.includes(cfg.sourceId)),request=JSON.parse(write.options.body).requests.at(-1);
  assert.equal(request.updateCells.range.endColumnIndex,6);assert.equal(request.updateCells.range.startRowIndex,3);assert.equal(request.updateCells.rows[0].values[2].userEnteredValue.stringValue,'=SUM(A1)');
  const report=(await adapter.source()).report;await adapter.render(report);
  const exportCall=calls.find(c=>c.url.includes('/export?'));assert.match(exportCall.url,/size=A4/);assert.match(exportCall.url,/fzr=true/);
  const ranges=calls.filter(c=>c.url.includes('includeGridData=true')&&c.url.includes(cfg.sourceId)).flatMap(c=>new URL(c.url).searchParams.getAll('ranges'));
  assert.ok(ranges.some(r=>/Jurnal demo.*A1:F100/.test(r)));assert.equal(ranges.some(r=>/I:Z/.test(r)),false);
});
test('Template readback is verified and mismatch prevents export',async()=>{
  const {adapter,reportBook,getReport,calls}=await fixture();
  const [{},{},{},{},{workbookPlan,verifyWorkbook}]=await modules;
  const cfg=(await fixture()).cfg,report=getReport(),plan=workbookPlan(reportBook,cfg,report);apply(reportBook,plan.requests);verifyWorkbook(reportBook,cfg,report,plan);
  reportBook.sheets[0].data[0].rowData[7].values[6]=cell(0);
  assert.throws(()=>verifyWorkbook(reportBook,cfg,report,plan),/Ringkasan/);
  assert.equal(calls.some(c=>c.url.includes('/export?')),false);
});
test('An intervening manual row is preserved by rereading the source before the exact range write',async()=>{
  const {adapter,source,cfg}=await fixture(),before=await adapter.source();
  const manual={values:['2026-10-10','K1','Manual baru',77,'',''].map(cell)};
  source.sheets[0].data[0].rowData.push(manual);
  await adapter.append(before,{id:crypto.randomUUID(),fund:'MASJID',type:'in',code:'K1',date:'2026-10-10',description:'Aplikasi baru',amount:100});
  const fresh=await adapter.source();assert.equal(fresh.report.income,250177);
  assert.equal(fresh.transactions.find(tx=>tx.description==='Manual baru').row,4);
  assert.equal(fresh.transactions.find(tx=>tx.description==='Aplikasi baru').row,5);
});
test('Publication archives privately, updates the same PDF ID and verifies checksum and unchanged permissions',async()=>{
  const {adapter,bytes,cfg,calls}=await fixture(),url=await adapter.publish(bytes,false);
  assert.ok(url.includes(cfg.pdfId));const upload=calls.find(c=>c.options.method==='PATCH');assert.ok(upload.url.includes(cfg.pdfId));assert.equal(upload.options.headers['Content-Type'],'application/pdf');
  const archive=calls.find(c=>c.url.includes('/copy'));assert.equal(JSON.parse(archive.options.body).parents[0],cfg.archiveId);
  const bad=await fixture();bad.setWrongChecksum();await assert.rejects(bad.adapter.publish(bad.bytes,false),/verifikasi/);
});
test('Shared preview or archive is rejected before any public replacement',async()=>{
  const preview=await fixture();preview.setSharedPreview();await assert.rejects(preview.adapter.publish(preview.bytes,true),/privat/);assert.equal(preview.calls.some(c=>c.options.method==='PATCH'),false);
  const archive=await fixture();archive.setSharedArchive();await assert.rejects(archive.adapter.publish(archive.bytes,false),/Arsip/);assert.equal(archive.calls.some(c=>c.options.method==='PATCH'),false);
});
module.exports={template,apply};
