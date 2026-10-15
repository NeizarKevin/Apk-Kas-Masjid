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
    assert.equal(await page.locator('#rememberDevice').isChecked(),false);
    await page.locator('#rememberDevice').check();assert.equal(await page.locator('#loginLink').getAttribute('href'),'/auth/login?remember=1');
    await page.locator('#rememberDevice').uncheck();assert.equal(await page.locator('#loginLink').getAttribute('href'),'/auth/login');
    await page.locator('#rememberDevice').check();
    await page.locator('#loginLink').click();await page.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif');
    const cookie=(await context.cookies()).find(c=>c.name==='kas_session');assert.ok(cookie.expires>Date.now()/1000+6*24*60*60);
    const reopened=await browser.newContext({storageState:await context.storageState()}),homeScreen=await reopened.newPage();
    await homeScreen.goto(origin);await homeScreen.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif');
    assert.equal(await homeScreen.locator('#loginPanel').isVisible(),false);await reopened.close();
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
    assert.equal(dashboard.report.state,'READY');assert.match(await page.locator('#reportMessage').textContent(),/5 menit/);
    await page.getByText('Opsi laporan',{exact:true}).click();await page.locator('#refreshPdf').click();
    await page.waitForFunction(()=>!document.getElementById('submitButton').disabled && ['Diperbarui','Sudah sesuai'].includes(document.getElementById('reportState').textContent),{},{timeout:120000});
    await page.locator('#previewPdf').click();
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
    // CSV import previews without writing, excludes matches, and resumes the original UUID after a lost response and reload.
    await page.unroute('**/api/transactions');
    await page.locator('#openImport').click();
    const csv='Tanggal;Dana;Jenis;Bendahara;Keterangan;Jumlah\n'+corrected.transactions.find(tx=>tx.description==='=Literal browser test').date+';MASJID;in;K1;=Literal browser test;125001\n2026-10-10;MASJID;Pemasukan;K1;=CSV <img src=x>;100\n2026-10-10;PHBI;Pemasukan;K2;Impor PHBI;200\n2026-10-10;MASJID;Pemasukan;K1;Salah;25,50';
    await page.locator('#importFile').setInputFiles({name:'contoh-impor.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.waitForFunction(()=>document.getElementById('importSummary').textContent.includes('2 dipilih')).catch(async error=>{console.error('Import preview:',await page.locator('#importNotice').textContent(),await page.locator('#importSummary').textContent(),await page.locator('#importRows').textContent());throw error;});
    assert.equal(await page.locator('#import-row-0').isChecked(),false);assert.equal(await page.locator('#import-row-3').isDisabled(),true);
    assert.equal(await page.locator('#importRows img').count(),0);
    assert.equal((await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json()).balance,1325001);
    const importIds=[];let lostImport=true;
    await page.route('**/api/transactions',async route=>{importIds.push(route.request().postDataJSON().id);const response=await route.fetch();if(lostImport){lostImport=false;await route.abort('failed');}else await route.fulfill({response});});
    await page.locator('#importSubmit').click();await page.waitForFunction(()=>document.getElementById('importNotice').textContent.includes('Impor terhenti')&&!document.getElementById('importSubmit').disabled);
    await page.reload();await page.waitForFunction(()=>document.getElementById('importDialog').open && document.getElementById('importNotice').textContent.includes('sebelumnya'));
    await page.locator('#importSubmit').click();await page.waitForFunction(()=>document.getElementById('importNotice').textContent.includes('Impor selesai: 2'));
    assert.equal(importIds.length,3);assert.equal(importIds[0],importIds[1]);assert.notEqual(importIds[1],importIds[2]);
    assert.equal(await page.evaluate(()=>localStorage.getItem('kas-masjid-demo-import-pending-v1')),null);
    await page.locator('#importClose').click();await page.waitForFunction(()=>document.getElementById('currentBalance').textContent==='Rp1.325.101');
    await page.setViewportSize({width:390,height:844});await page.locator('#openImport').click();
    await page.locator('#importFile').setInputFiles({name:'ulang.csv',mimeType:'text/csv',buffer:Buffer.from(csv)});
    await page.waitForFunction(()=>document.getElementById('importSummary').textContent.includes('0 dipilih'));
    assert.equal(await page.locator('#importSubmit').isDisabled(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:join(evidence,'import-mobile.png'),fullPage:true});await page.locator('#importClose').click();
    await page.locator('#fund').selectOption('PHBI');await page.waitForFunction(()=>document.getElementById('currentBalance').textContent==='Rp500.200');
    await page.locator('#openImport').click();lostImport=true;
    const cancelCsv='Tanggal;Dana;Jenis;Bendahara;Keterangan;Jumlah\n2026-10-10;MASJID;in;K1;Impor terkonfirmasi sebelum batal;10\n2026-10-10;MASJID;in;K1;Sisa yang dibatalkan;20';
    await page.locator('#importFile').setInputFiles({name:'batal.csv',mimeType:'text/csv',buffer:Buffer.from(cancelCsv)});
    await page.waitForFunction(()=>document.getElementById('importSummary').textContent.includes('2 dipilih'));
    await page.locator('#importSubmit').click();await page.waitForFunction(()=>document.getElementById('importNotice').textContent.includes('Impor terhenti')&&!document.getElementById('importDiscard').disabled);
    await page.locator('#importDiscard').click();await page.waitForFunction(()=>!document.getElementById('importDialog').open);
    assert.match(await page.locator('#notice').textContent(),/1 transaksi/);
    const cancelled=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();assert.equal(cancelled.balance,1325111);assert.equal(cancelled.transactions.some(tx=>tx.description==='Sisa yang dibatalkan'),false);
    await page.unroute('**/api/transactions');let pauseOnce=true;
    await page.route('**/api/transactions',async route=>{const response=await route.fetch();if(pauseOnce){pauseOnce=false;await page.locator('#importStop').click();}await route.fulfill({response});});
    await page.locator('#openImport').click();
    await page.locator('#importFile').setInputFiles({name:'jeda.csv',mimeType:'text/csv',buffer:Buffer.from(cancelCsv.replace('Impor terkonfirmasi sebelum batal','Impor jeda pertama').replace('Sisa yang dibatalkan','Impor jeda kedua'))});
    await page.waitForFunction(()=>document.getElementById('importSummary').textContent.includes('2 dipilih'));
    await page.locator('#importSubmit').click();await page.waitForFunction(()=>document.getElementById('importNotice').textContent.includes('Impor dijeda')&&!document.getElementById('importSubmit').disabled);
    assert.match(await page.locator('#importSummary').textContent(),/1 tersimpan/);
    await page.locator('#importSubmit').click();await page.waitForFunction(()=>document.getElementById('importNotice').textContent.includes('Impor selesai: 2'));await page.locator('#importClose').click();
    // Bulk deletion is bounded to filtered, editable rows and survives a committed response being lost.
    await page.unroute('**/api/changes');
    const beforeBulk=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();
    await page.locator('#fund').selectOption('MASJID');await page.waitForFunction(()=>document.getElementById('formFund').textContent==='Dana: Kas masjid');
    await page.locator('#selectMode').click();await page.locator('#selectAll').check();assert.ok(await page.locator('#history input:checked').count()>2);
    await page.locator('#historySearch').fill('Impor jeda');assert.equal(await page.locator('#history input:checked').count(),0);assert.equal(await page.locator('#deleteSelected').isDisabled(),true);
    await page.locator('#selectAll').check();assert.equal(await page.locator('#history input:checked').count(),2);
    await page.locator('#deleteSelected').click();await page.locator('#bulkClose').click();
    assert.equal((await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json()).balance,beforeBulk.balance);
    await page.locator('#deleteSelected').click();await page.locator('#bulkReason').fill('Hapus dua catatan contoh yang ganda');
    const bulkIds=[];let lostBulk=true;
    await page.route('**/api/changes',async route=>{bulkIds.push(route.request().postDataJSON().id);const response=await route.fetch();if(lostBulk){lostBulk=false;await route.abort('failed');}else await route.fulfill({response});});
    await page.locator('#bulkSubmit').click();await page.waitForFunction(()=>document.getElementById('bulkNotice').textContent.includes('Penghapusan terhenti')&&!document.getElementById('bulkSubmit').disabled);
    assert.equal(await page.locator('#submitButton').isDisabled(),true);await page.reload();
    await page.waitForFunction(()=>document.getElementById('bulkDialog').open && document.getElementById('bulkNotice').textContent.includes('sebelumnya'));
    assert.equal(await page.locator('#bulkReason').inputValue(),'Hapus dua catatan contoh yang ganda');assert.equal(await page.locator('#bulkReason').isDisabled(),true);
    await page.locator('#bulkSubmit').click();await page.waitForFunction(()=>document.getElementById('bulkNotice').textContent.includes('Selesai: 2')&&!document.getElementById('bulkClose').disabled);
    assert.equal(bulkIds.length,3);assert.equal(bulkIds[0],bulkIds[1]);assert.notEqual(bulkIds[1],bulkIds[2]);
    assert.equal(await page.evaluate(()=>localStorage.getItem('kas-masjid-demo-bulk-delete-v1')),null);
    const afterBulk=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();assert.equal(afterBulk.balance,beforeBulk.balance-30);
    assert.equal(afterBulk.deletedTransactions.filter(tx=>tx.description.startsWith('Impor jeda')).length,2);assert.ok(afterBulk.deletedTransactions.filter(tx=>tx.description.startsWith('Impor jeda')).every(tx=>tx.changes.length===1));
    assert.equal(afterBulk.transactions.filter(tx=>!tx.description.startsWith('Impor jeda')).length,beforeBulk.transactions.length-2);
    await page.locator('#bulkClose').click();await page.locator('#deletedCount').click();
    await page.getByRole('button',{name:'Pulihkan Impor jeda pertama',exact:true}).click();await page.locator('#changeReason').fill('Pulihkan transaksi pilihan sesuai bukti');await page.locator('#changeSubmit').click();
    await page.waitForFunction(()=>!document.getElementById('changeDialog').open&&!document.getElementById('submitButton').disabled);
    assert.equal((await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json()).balance,beforeBulk.balance-20);
    // Stop on a stale row revision; cancelling the remainder resolves the last attempted ID first.
    await page.locator('#openImport').click();
    await page.locator('#importFile').setInputFiles({name:'bulk-konflik.csv',mimeType:'text/csv',buffer:Buffer.from('Tanggal;Dana;Jenis;Bendahara;Keterangan;Jumlah\n2026-10-10;MASJID;in;K1;Bulk konflik A;300\n2026-10-10;MASJID;in;K1;Bulk konflik B;400')});
    await page.waitForFunction(()=>document.getElementById('importSummary').textContent.includes('2 dipilih'));await page.locator('#importSubmit').click();await page.waitForFunction(()=>document.getElementById('importNotice').textContent.includes('Impor selesai: 2'));await page.locator('#importClose').click();
    const conflictStart=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();
    await page.locator('#historySearch').fill('Bulk konflik');await page.locator('#selectMode').click();await page.locator('#selectAll').check();await page.locator('#deleteSelected').click();await page.locator('#bulkReason').fill('Pembersihan catatan contoh');
    await page.unroute('**/api/changes');let intervened=false,conflicted;
    const session=await (await context.request.get(origin+'/api/session')).json();
    await page.route('**/api/changes',async route=>{
      const req=route.request().postDataJSON(),response=await route.fetch();
      if(!intervened){intervened=true;const other=conflictStart.transactions.find(tx=>tx.description.startsWith('Bulk konflik')&&tx.key!==req.key);conflicted=other;
        const changed=await context.request.post(origin+'/api/changes',{headers:{'X-CSRF-Token':session.csrf,Origin:origin},data:{id:crypto.randomUUID(),key:other.key,revision:other.revision,action:'edit',reason:'Bukti baru datang saat antrean berjalan',input:{fund:other.fund,type:other.type,code:other.code,date:other.date,description:other.description+' diperiksa',amount:other.amount}}});assert.equal(changed.status(),200);
        await page.locator('#bulkStop').click();
      }await route.fulfill({response});
    });
    await page.locator('#bulkSubmit').click();await page.waitForFunction(()=>document.getElementById('bulkNotice').textContent.includes('Penghapusan dijeda')&&!document.getElementById('bulkSubmit').disabled);
    assert.match(await page.locator('#bulkSummary').textContent(),/1 dihapus/);
    await page.locator('#bulkSubmit').click();await page.waitForFunction(()=>document.getElementById('bulkNotice').textContent.includes('Penghapusan terhenti')&&!document.getElementById('bulkDiscard').disabled);
    assert.match(await page.locator('#bulkNotice').textContent(),/Transaksi berubah sejak dibuka/);
    assert.deepEqual(errors,['Failed to load resource: the server responded with a status of 400 (Bad Request)']);errors.length=0;
    await page.locator('#bulkDiscard').click();await page.waitForFunction(()=>!document.getElementById('bulkDialog').open);
    const conflictEnd=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();assert.equal(conflictEnd.balance,conflictStart.balance-(700-conflicted.amount));assert.ok(conflictEnd.transactions.some(tx=>tx.key===conflicted.key&&tx.description.endsWith('diperiksa')));assert.match(await page.locator('#notice').textContent(),/1 transaksi/);
    await page.unroute('**/api/changes');await page.locator('#historySearch').fill('');
    // Responsive bounds include real controls, large balances and a long literal description.
    await page.evaluate(()=>{document.getElementById('notice').hidden=true;document.getElementById('deletedSection').open=false;});
    const responsive=[];
    for(const width of [320,390,768,1280,1440]){
      await page.setViewportSize({width,height:900});
      const bounds=await page.evaluate(()=>{
        const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom};};
        const outside=Array.from(document.querySelectorAll('input:not([type=checkbox]),select,textarea,.sum-card,.card,.history-card')).filter(el=>el.getClientRects().length).filter(el=>{const r=el.getBoundingClientRect();return r.x<0||r.right>innerWidth+1;}).map(el=>el.id||el.className);
        return {overflow:document.documentElement.scrollWidth>innerWidth,outside,entry:rect('entry'),history:rect('records'),report:rect('report')};
      });
      assert.equal(bounds.overflow,false,'Overflow at '+width);assert.deepEqual(bounds.outside,[],'Clipped controls at '+width);
      if(width>=900){assert.ok(bounds.entry.right<=bounds.history.x);assert.ok(Math.abs(bounds.entry.y-bounds.history.y)<1);}else assert.ok(bounds.entry.bottom<bounds.history.y);
      responsive.push(width);
      await page.locator('#selectMode').click();await page.locator('#selectAll').check();await page.locator('#deleteSelected').click();
      const footer=await page.locator('#bulkSubmit').boundingBox();assert.ok(footer.y>=0&&footer.y+footer.height<=900,'Bulk action outside viewport at '+width);
      await page.screenshot({path:join(evidence,'bulk-'+width+'.png')});await page.locator('#bulkClose').click();await page.locator('#selectMode').click();
    }
    await page.evaluate(()=>{document.getElementById('currentBalance').textContent='Rp999.999.999.999';document.getElementById('totalIncome').textContent='Rp999.999.999.999';document.getElementById('history').querySelector('.description').textContent='DeskripsiSangatPanjang'.repeat(24);});
    await page.setViewportSize({width:320,height:650});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#openImport').click();let footer=await page.locator('#importSubmit').boundingBox();assert.ok(footer.y>=0&&footer.y+footer.height<=650);await page.locator('#importClose').click();
    await page.reload();await page.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif');
    // Fifty is the selection cap; checkpoint-protected rows cannot be selected even by select-all.
    await page.route('**/api/dashboard?*',async route=>{const response=await route.fetch(),data=await response.json(),tx=data.transactions[0];data.transactions=Array.from({length:52},(_,i)=>({...tx,key:'999:'+(i+2),description:'Pilihan batas '+i,editable:i!==51,changes:[]}));await route.fulfill({response,json:data});});
    await page.locator('#refreshData').click();await page.waitForFunction(()=>document.getElementById('historyCount').textContent.includes('52 dari 52'));
    await page.locator('#selectMode').click();await page.locator('#selectAll').check();assert.equal(await page.locator('#history input:checked').count(),50);assert.equal(await page.getByRole('checkbox',{name:'Pilih Pilihan batas 51',exact:true}).isDisabled(),true);
    await page.getByRole('checkbox',{name:'Pilih Pilihan batas 50',exact:true}).click();assert.equal(await page.locator('#history input:checked').count(),50);assert.match(await page.locator('#notice').textContent(),/Maksimal 50/);
    await page.locator('#selectAll').uncheck();assert.equal(await page.locator('#history input:checked').count(),0);
    await page.unroute('**/api/dashboard?*');await page.reload();await page.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif');
    await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(evidence,'midnight-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(evidence,'midnight-mobile.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    await page.locator('#logout').click();await page.waitForSelector('#loginPanel:not([hidden])');
    assert.equal((await context.request.get(origin+'/api/dashboard')).status(),401);
    await context.close();
    // The process worker publishes at startup without any logged-in browser.
    assert.ok((await readFile(join(dir,'public.pdf'))).length>1000);
    await writeFile(join(evidence,'browser-checks.json'),JSON.stringify({mobile:true,desktop:true,midnight:true,responsive,bulkFilteredSelection:true,bulkRetryAcrossReload:true,bulkRestore:true,bulkPause:true,bulkConflict:true,bulkCancelAfterResolve:true,dialogFooterVisible:true,login:true,logout:true,rememberDevice:true,reopenWithoutLogin:true,deferredPdf:true,manualPdfRefresh:true,csvPreview:true,csvDuplicateWarnings:true,csvRetryAcrossReload:true,csvPhbiSeparated:true,csrfCoveredByHttpTests:true,lostResponseUuidRetry:true,changeRetryAcrossReload:true,editDeleteRestore:true,historySearch:true,phbiSeparated:true,literalText:true,previewPages:audit.pageCount,paginationPages:longAudit.pageCount,pageErrors:errors,workerWithoutBrowser:true},null,2));
    console.log('Browser smoke passed: Midnight at '+responsive.join('/')+'px, bulk selection/cap/locked rows, delete/retry/reload/restore/pause/conflict/cancel, visible dialog actions, CSV, remembered login, PHBI, deferred/manual PDF, 3-page preview, '+longAudit.pageCount+'-page pagination, worker without browser.');
  } finally {
    await browser?.close();server.kill();await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});
  }
}
run().catch(error=>{console.error(error);process.exitCode=1;});
