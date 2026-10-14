const assert=require('node:assert/strict');
const {mkdtemp,mkdir,readFile,rm,writeFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');

async function run() {
  const dir=await mkdtemp(join(tmpdir(),'kas-browser-')),origin='http://localhost:3017';
  const evidence=resolve('test-results');await mkdir(evidence,{recursive:true});
  const server=spawn(process.execPath,['dist/main.js','--demo'],{env:{...process.env,PORT:'3017',APP_ORIGIN:origin,STATE_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let serverOutput='';server.stdout.on('data',d=>serverOutput+=d);server.stderr.on('data',d=>serverOutput+=d);
  let browser;
  try {
    for(let attempt=0;;attempt++) {
      try {if((await fetch(origin+'/healthz')).ok)break;}catch{}
      if(attempt>=100)throw new Error('Server belum berjalan: '+serverOutput);
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    browser=await chromium.launch({headless:true});
    const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/net::ERR_FAILED|401|favicon|Failed to fetch/.test(m.text()))errors.push(m.text());});
    await page.goto(origin);await page.waitForSelector('#loginPanel:not([hidden])');
    assert.equal(await page.locator('#submitButton').isDisabled(),true);
    assert.equal((await context.request.get(origin+'/api/dashboard')).status(),401);
    await page.locator('#loginLink').click();await page.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif');
    assert.equal(await page.locator('#currentBalance').textContent(),'Rp1.200.000');
    assert.equal(await page.locator('#demoBanner').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(evidence,'mobile.png'),fullPage:true});
    await page.locator('#fund').selectOption('PHBI');await page.waitForFunction(()=>document.getElementById('currentBalance').textContent==='Rp500.000');
    assert.match(await page.locator('#balanceNote').textContent(),/belum dihitung/);
    await page.locator('#fund').selectOption('MASJID');await page.waitForFunction(()=>document.getElementById('currentBalance').textContent==='Rp1.200.000');
    await page.locator('#description').fill('=Literal browser test');await page.locator('#amount').fill('100.001');
    const ids=[];let drop=true;
    await page.route('**/api/transactions',async route=>{
      ids.push(route.request().postDataJSON().id);
      const response=await route.fetch();
      if(drop){drop=false;await route.abort('failed');}else await route.fulfill({response});
    });
    await page.locator('#submitButton').click();await page.waitForFunction(()=>document.getElementById('submitButton').textContent==='Kirim ulang transaksi',{},{timeout:120000});
    await page.locator('#submitButton').click();await page.waitForFunction(()=>document.getElementById('submitButton').textContent==='Simpan transaksi'&&!document.getElementById('submitButton').disabled,{},{timeout:120000});
    assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.match(await page.locator('#notice').textContent(),/Tidak ada pencatatan ganda/);
    assert.equal(await page.locator('#currentBalance').textContent(),'Rp1.300.001');
    const dashboard=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();
    assert.equal(dashboard.transactions.filter(tx=>tx.description==='=Literal browser test').length,1);
    assert.equal(dashboard.report.state,'UNCHANGED');
    await page.getByText('Opsi laporan',{exact:true}).click();await page.locator('#previewPdf').click();
    await page.waitForSelector('#previewLink:not([hidden])',{timeout:120000});
    const preview=await context.request.get(origin+'/api/pdf/preview');assert.equal(preview.status(),200);
    await writeFile(join(evidence,'preview-demo.pdf'),await preview.body());
    const audit=JSON.parse(await readFile(join(dir,'preview-audit.json'),'utf8'));assert.equal(audit.pageCount,3);assert.equal(audit.pages.length,3);
    await page.locator('#historySearch').fill('literal');assert.equal(await page.locator('#history .transaction').count(),1);await page.locator('#historySearch').fill('');
    const changeIds=[];let dropChange=true;
    await page.route('**/api/changes',async route=>{changeIds.push(route.request().postDataJSON().id);const response=await route.fetch();if(dropChange){dropChange=false;await route.abort('failed');}else await route.fulfill({response});});
    await page.getByRole('button',{name:'Edit =Literal browser test',exact:true}).click();await page.locator('#changeAmount').fill('125.001');await page.locator('#changeReason').fill('Koreksi sesuai kuitansi uji');await page.locator('#changeSubmit').click();
    await page.waitForFunction(()=>document.getElementById('changeSubmit').textContent==='Kirim ulang perubahan',{},{timeout:120000});
    await page.reload();await page.waitForFunction(()=>document.getElementById('changeDialog').open && document.getElementById('changeSubmit').textContent==='Kirim ulang perubahan');
    assert.equal(await page.locator('#changeAmount').inputValue(),'125001');
    await page.locator('#changeSubmit').click();await page.waitForFunction(()=>!document.getElementById('changeDialog').open && !document.getElementById('submitButton').disabled,{},{timeout:120000});
    assert.equal(changeIds[0],changeIds[1]);assert.equal(await page.locator('#currentBalance').textContent(),'Rp1.325.001');
    const corrected=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();assert.equal(corrected.transactions.find(tx=>tx.description==='=Literal browser test').changes.length,1);
    await page.getByRole('button',{name:'Hapus =Literal browser test',exact:true}).click();await page.locator('#changeCancel').click();assert.equal(await page.locator('#currentBalance').textContent(),'Rp1.325.001');
    await page.getByRole('button',{name:'Hapus =Literal browser test',exact:true}).click();await page.locator('#changeReason').fill('Duplikat pada bukti uji');await page.locator('#changeSubmit').click();await page.waitForFunction(()=>!document.getElementById('changeDialog').open && document.getElementById('currentBalance').textContent==='Rp1.200.000',{},{timeout:120000});
    await page.locator('#deletedCount').click();await page.getByRole('button',{name:'Pulihkan =Literal browser test',exact:true}).click();await page.locator('#changeReason').fill('Pulihkan sesuai bukti yang benar');await page.locator('#changeSubmit').click();await page.waitForFunction(()=>!document.getElementById('changeDialog').open && document.getElementById('currentBalance').textContent==='Rp1.325.001',{},{timeout:120000});
    assert.equal(await page.locator('#deletedSection').isVisible(),false);
    // Real print pagination with long descriptions, multiple months and repeated table headings.
    const [{renderDemoPdf,inspectPdf},m]=await Promise.all([import('../../dist/pdf.js'),import('../../dist/model.js')]);
    const tx=Array.from({length:75},(_,i)=>({date:i<40?'2026-10-09':'2026-11-09',description:'Contoh rincian '+i+' '+('keterangan panjang '.repeat(i%3===0?20:1)),amount:100+i,type:i%2?'in':'out',fund:'MASJID',code:'K1',sheetId:1,row:i+2,meta:null}));
    const report=m.cashNewPeriodReport_(tx,{date:'2026-10-08',amount:1000000,holders:{K1:800000,K2:200000,K3:0}}),longPdf=await renderDemoPdf(report),longAudit=await inspectPdf(longPdf,report);
    assert.ok(longAudit.pageCount>3);await writeFile(join(evidence,'pagination-demo.pdf'),longPdf);
    await page.setViewportSize({width:1280,height:900});await page.screenshot({path:join(evidence,'desktop.png'),fullPage:true});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    await page.locator('#logout').click();await page.waitForSelector('#loginPanel:not([hidden])');
    assert.equal((await context.request.get(origin+'/api/dashboard')).status(),401);
    await context.close();
    // The process worker publishes at startup without any logged-in browser.
    assert.ok((await readFile(join(dir,'public.pdf'))).length>1000);
    await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({mobile:true,desktop:true,login:true,logout:true,csrfCoveredByHttpTests:true,lostResponseUuidRetry:true,changeRetryAcrossReload:true,editDeleteRestore:true,historySearch:true,phbiSeparated:true,literalText:true,previewPages:audit.pageCount,paginationPages:longAudit.pageCount,pageErrors:errors,workerWithoutBrowser:true},null,2));
    console.log('Browser smoke passed: mobile, desktop, login/logout, UUID retry across reload, edit/delete/restore, history search, PHBI, literal text, 3-page preview, '+longAudit.pageCount+'-page pagination, worker without browser.');
  } finally {
    await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
