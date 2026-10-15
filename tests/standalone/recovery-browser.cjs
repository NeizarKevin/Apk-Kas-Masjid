const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {mkdtemp,mkdir,rm,writeFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {chromium,webkit,devices}=require('playwright');

async function run(){
  const [{loadConfig},{DemoAdapter},{OwnerAuth},{createApp}]=await Promise.all(['config','demo','auth','app'].map(name=>import('../../dist/'+name+'.js')));
  const dir=await mkdtemp(join(tmpdir(),'kas-recovery-')),evidence=resolve('test-results');await mkdir(evidence,{recursive:true});
  const cfg={...loadConfig({DEMO_MODE:'true',STATE_DIR:dir}),automatic:false},adapter=new DemoAdapter(cfg);
  const {app,service}=await createApp(cfg,adapter,new OwnerAuth(cfg)),server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  cfg.origin='http://127.0.0.1:'+server.address().port;
  let browser;const passed=[];
  try{
    for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
      browser=await engine.launch({headless:true});const context=await browser.newContext({...devices['iPhone 13']}),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      await context.request.get(cfg.origin+'/auth/login');
      const tx=(await service.getDashboard('MASJID','2026-10')).transactions.find(tx=>tx.description==='Contoh biaya kebersihan');
      const draft={id:randomUUID(),key:tx.key,revision:tx.revision,action:'edit',reason:'Perbaikan bukti saat koneksi putus',fund:'MASJID',month:'2026-10',view:tx,input:{fund:'MASJID',type:'out',code:'K1',date:tx.date,description:tx.description,amount:51000}};
      await page.addInitScript(draft=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('kas-masjid-demo-change-pending-v1',JSON.stringify(draft));sessionStorage.setItem('seeded','1');}},draft);
      let fail=true,writes=0;
      await page.route('**/api/dashboard?*',async route=>{if(fail){fail=false;await route.fulfill({status:503,json:{error:'Dashboard uji terputus'}});}else await route.continue();});
      await page.route('**/api/changes',async route=>{writes++;await route.continue();});
      await page.goto(cfg.origin);await page.waitForFunction(()=>!document.getElementById('refreshData').disabled);
      assert.equal(await page.locator('#submitButton').isDisabled(),true);
      await page.locator('#refreshData').click();
      await page.waitForFunction(()=>document.getElementById('changeDialog').open,{},{timeout:3000});
      assert.equal(await page.locator('#changeAmount').inputValue(),'51000');assert.equal(writes,0);
      await page.locator('#changeCheck').click();await page.waitForFunction(()=>!document.getElementById('changeDialog').open&&!document.getElementById('submitButton').disabled);
      assert.equal(await page.evaluate(()=>localStorage.getItem('kas-masjid-demo-change-pending-v1')),null);assert.equal(writes,0);

      // An expired session must reveal login even when an unconfirmed correction owns a modal.
      await page.getByRole('button',{name:'Edit Contoh biaya kebersihan',exact:true}).click();await page.locator('#changeAmount').fill('51000');await page.locator('#changeReason').fill('Koreksi setelah sesi berakhir');
      await page.route('**/api/changes',route=>route.fulfill({status:401,json:{error:'Sesi uji kedaluwarsa'}}));
      await page.locator('#changeSubmit').click();await page.waitForSelector('#loginPanel:not([hidden])');
      assert.equal(await page.locator('#changeDialog').evaluate(el=>el.open),false,'Login must not be hidden behind the pending modal');
      assert.equal(await page.locator('#connection').textContent(),'Belum masuk');
      const retained=await page.evaluate(()=>JSON.parse(localStorage.getItem('kas-masjid-demo-change-pending-v1')));assert.ok(retained.id);assert.equal(retained.input.amount,51000);
      await page.unroute('**/api/changes');await page.route('**/api/changes',async route=>{writes++;assert.equal(route.request().postDataJSON().id,retained.id);await route.continue();});
      await page.locator('#loginLink').click();await page.waitForFunction(()=>document.getElementById('changeDialog').open);await page.locator('#changeSubmit').click();
      await page.waitForFunction(()=>!document.getElementById('changeDialog').open&&!document.getElementById('submitButton').disabled);assert.equal(writes,1);
      assert.equal((await service.getDashboard('MASJID','2026-10')).transactions.find(row=>row.key===tx.key).amount,51000);

      await page.locator('#month').fill('2026-09');await page.locator('#month').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('incomePeriod').textContent.includes('September 2026'));
      assert.match(await page.locator('#incomePeriod').textContent(),/September 2026/);assert.match(await page.locator('#historyPeriod').textContent(),/September 2026/);
      assert.equal(await page.locator('#totalIncome').textContent(),'Rp0');
      // A failed logout must leave an actionable message and the session intact.
      await page.route('**/auth/logout',route=>route.abort('failed'));await page.locator('#logout').click();await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Keluar belum berhasil'));
      assert.equal((await context.request.get(cfg.origin+'/api/session')).ok(),true);assert.equal(await page.locator('#accountRow').isVisible(),true);
      assert.deepEqual(errors,[]);passed.push(name);await context.close();await browser.close();browser=null;
      // Reset this synthetic correction for the second engine's independent check.
      await rm(join(dir,'demo-sheet.json'),{force:true});
    }
    await writeFile(join(evidence,'recovery-checks.json'),JSON.stringify({engines:passed,initialDashboardFailureRecovery:true,sessionExpiryRevealsLogin:true,correctionUuidRetained:true,selectedMonthLabels:true,offlineLogoutFeedback:true,pageErrors:[]},null,2));
    console.log('Recovery checks passed: '+passed.join(', ')+', failed initial read, pending correction, expired-session login, same UUID after login, selected-month labels, failed logout.');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
