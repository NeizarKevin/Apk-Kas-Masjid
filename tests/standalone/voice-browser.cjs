const assert=require('node:assert/strict');
const {mkdtemp,mkdir,rm,writeFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {spawn}=require('node:child_process');
const {chromium,webkit,devices}=require('playwright');
async function run(){
  const dir=await mkdtemp(join(tmpdir(),'kas-voice-')),origin='http://localhost:3019',evidence=resolve('test-results');await mkdir(evidence,{recursive:true});
  const server=spawn(process.execPath,['dist/main.js','--demo'],{env:{...process.env,PORT:'3019',APP_ORIGIN:origin,STATE_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',browser;server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
  const passed=[];
  try{
    const deadline=Date.now()+30000;for(;;){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}if(Date.now()>deadline)throw Error('Demo startup failed: '+output);await new Promise(resolve=>setTimeout(resolve,100));}
    for(const [name,engine] of [['webkit',webkit],['chromium',chromium]]){
      browser=await engine.launch({headless:true});const context=await browser.newContext({...devices['iPhone 13']}),page=await context.newPage(),errors=[],writes=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        window.__speechMode='normal';window.__voiceTimers=new Map();let timerId=900000;const timeout=window.setTimeout.bind(window),clear=window.clearTimeout.bind(window);
        window.setTimeout=(fn,ms,...args)=>{if([5000,15000,45000].includes(ms)){const id=++timerId;window.__voiceTimers.set(id,{fn,ms});return id;}return timeout(fn,ms,...args);};window.clearTimeout=id=>{if(!window.__voiceTimers.delete(id))clear(id);};
        window.__expireVoice=ms=>{const [id,timer]=[...window.__voiceTimers].find(([,timer])=>timer.ms===ms)||[];if(!timer)throw Error('Missing voice timer '+ms);window.__voiceTimers.delete(id);timer.fn();};
        class MockRecognition{constructor(){window.__recognizer=this;}start(){if(window.__speechMode==='throw')throw Error('Not available');if(window.__speechMode!=='silent')this.onstart?.();}stop(){this.onend?.();}abort(){this.onerror?.({error:'aborted'});}}
        window.SpeechRecognition=window.__MockRecognition=MockRecognition;window.webkitSpeechRecognition=undefined;
        window.__say=(text,final=true)=>{const result=[{transcript:text}];result.isFinal=final;window.__recognizer.onresult({results:[result]});};
      });
      await page.route('**/api/transactions',async route=>{writes.push(route.request().postDataJSON());await route.continue();});
      await page.goto(origin);await page.locator('#loginLink').click();await page.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif');
      const view=async fund=>(await (await context.request.get(origin+'/api/dashboard?fund='+fund+'&month=2026-10')).json());
      const before=await view('MASJID');await page.locator('#voicePanel>summary').click();await page.locator('#description').fill('Draf lama');await page.locator('#amount').fill('222');await page.locator('#code').selectOption('K3');
      await page.locator('#voice-btn').click();assert.equal(await page.locator('#submitButton').isDisabled(),true);assert.equal(await page.locator('#fund').isDisabled(),true);
      assert.deepEqual(await page.evaluate(()=>({lang:__recognizer.lang,interim:__recognizer.interimResults,continuous:__recognizer.continuous})),{lang:'id-ID',interim:true,continuous:false});
      await page.evaluate(()=>__say('Infaq Jumat satu juta',false));assert.equal(await page.locator('#description').inputValue(),'Draf lama');assert.equal(await page.locator('#amount').inputValue(),'222');assert.equal(await page.locator('#voiceApply').isDisabled(),true);
      await page.evaluate(()=>__say('Infaq Jumat satu juta lima ratus ribu kemarin bendahara Kevin'));assert.equal(await page.locator('#voiceApply').isDisabled(),false);assert.equal(writes.length,0);assert.equal(await page.locator('#amount').inputValue(),'222');assert.match(await page.locator('#voice-result').textContent(),/Rp1.500.000/);
      await page.locator('#voiceApply').click();assert.equal(await page.locator('#description').inputValue(),'Infaq Jumat');assert.equal(await page.locator('#amount').inputValue(),'1500000');assert.equal(await page.locator('#code').inputValue(),'K1');assert.equal(writes.length,0);
      await page.locator('#submitButton').click();await page.waitForFunction(()=>document.getElementById('description').value===''&&!document.getElementById('submitButton').disabled);assert.equal(writes.length,1);assert.equal(writes[0].amount,1500000);assert.equal((await view('MASJID')).balance,before.balance+1500000);
      await page.locator('#voiceTranscript').fill('Pengeluaran sebesar 100 ribu dan 200 ribu');await page.locator('#voiceParse').click();assert.equal(await page.locator('#voiceApply').isDisabled(),true);
      await page.locator('#amount').fill('99999');await page.locator('#voiceTranscript').fill('Beli 3 lampu');await page.locator('#voiceParse').click();await page.locator('#voiceApply').click();assert.equal(await page.locator('#amount').inputValue(),'');assert.equal(await page.locator('#description').inputValue(),'Beli 3 lampu');await page.locator('#submitButton').click();assert.equal(writes.length,1);
      await page.locator('#resetForm').click();
      await page.evaluate(()=>{window.SpeechRecognition=undefined;});await page.locator('#voice-btn').click();assert.match(await page.locator('#voiceNotice').textContent(),/keyboard/);
      await page.locator('#voiceTranscript').fill('Pengeluaran PHBI konsumsi 250 ribu bendahara Wawan');await page.locator('#voiceParse').click();await page.locator('#code').selectOption('K2');await page.locator('#voiceApply').click();assert.match(await page.locator('#voiceNotice').textContent(),/Form berubah/);assert.equal(await page.locator('#fund').inputValue(),'MASJID');
      const phbiBefore=await view('PHBI');let failDashboard=true;
      await page.route('**/api/dashboard?*',async route=>{if(failDashboard&&new URL(route.request().url()).searchParams.get('fund')==='PHBI'){failDashboard=false;await route.fulfill({status:503,json:{error:'Koneksi uji terputus'}});}else await route.continue();});
      await page.locator('#voiceApply').click();await page.waitForFunction(()=>document.getElementById('voiceNotice').textContent.includes('Dana belum dapat dimuat'));assert.equal(await page.locator('#submitButton').isDisabled(),true);assert.equal(await page.locator('#refreshData').isDisabled(),false);
      await page.locator('#refreshData').click();await page.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif'&&!document.getElementById('submitButton').disabled);await page.unroute('**/api/dashboard?*');
      await page.locator('#voiceApply').click();assert.match(await page.locator('#voiceNotice').textContent(),/Form berubah/);
      await page.locator('#voiceApply').click();await page.waitForFunction(()=>document.getElementById('fund').value==='PHBI'&&!document.getElementById('submitButton').disabled);assert.equal(await page.locator('#code').inputValue(),'K3');assert.equal(writes.length,1);
      await page.locator('#submitButton').click();await page.waitForFunction(()=>document.getElementById('description').value===''&&!document.getElementById('submitButton').disabled);assert.equal(writes.at(-1).fund,'PHBI');assert.equal((await view('PHBI')).balance,phbiBefore.balance-250000);assert.equal((await view('MASJID')).balance,before.balance+1500000);
      await page.evaluate(()=>{window.SpeechRecognition=window.__MockRecognition;});
      for(const [error,message] of [['not-allowed','izin'],['network','koneksi'],['no-speech','suara']]){await page.locator('#voice-btn').click();await page.evaluate(error=>{window.__staleRecognizer=__recognizer;__recognizer.onerror({error});},error);assert.match((await page.locator('#voiceNotice').textContent()).toLowerCase(),new RegExp(message));assert.equal(await page.locator('#voice-btn').isDisabled(),false);await page.evaluate(()=>{const result=[{transcript:'Infaq 9 juta'}];result.isFinal=true;__staleRecognizer.onresult({results:[result]});});assert.equal(await page.locator('#amount').inputValue(),'');}
      await page.evaluate(()=>{window.__speechMode='throw';});await page.locator('#voice-btn').click();assert.match(await page.locator('#voiceNotice').textContent(),/belum dapat dimulai/);assert.equal(await page.locator('#submitButton').isDisabled(),false);
      await page.evaluate(()=>{window.__speechMode='silent';});await page.locator('#voice-btn').click();await page.evaluate(()=>__expireVoice(15000));assert.match(await page.locator('#voiceNotice').textContent(),/belum mulai/);assert.equal(await page.locator('#fund').isDisabled(),false);
      await page.evaluate(()=>{window.__speechMode='normal';});await page.locator('#voice-btn').click();await page.evaluate(()=>__expireVoice(45000));assert.match(await page.locator('#voiceNotice').textContent(),/Waktu perekaman/);
      await page.locator('#voice-btn').click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});assert.match(await page.locator('#voiceNotice').textContent(),/aplikasi ditinggalkan/);assert.equal(await page.locator('#submitButton').isDisabled(),false);
      await page.locator('#voiceTranscript').fill('Infaq <img src=x> sebesar 10 ribu');await page.locator('#voiceParse').click();assert.equal(await page.locator('#voice-result img').count(),0);assert.match(await page.locator('#voice-result').textContent(),/<img src=x>/);
      for(const text of ['Infaq 100 ribu besok','Infaq 100 ribu tanggal 31 Februari 2026']){await page.locator('#voiceTranscript').fill(text);await page.locator('#voiceParse').click();assert.equal(await page.locator('#voiceApply').isDisabled(),true);}
      await page.locator('#voiceTranscript').fill('Pengeluaran PHBI konsumsi 250 ribu bendahara Wawan');await page.locator('#voiceParse').click();
      await page.setViewportSize({width:320,height:650});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.locator('#voicePanel').screenshot({path:join(evidence,'voice-'+name+'.png'),scale:'css'});
      assert.equal(writes.length,2);assert.deepEqual(errors,[]);passed.push(name);await context.close();await browser.close();browser=null;
    }
    await writeFile(join(evidence,'voice-checks.json'),JSON.stringify({engines:passed,interimDoesNotOverwrite:true,explicitPreviewApply:true,noAutomaticSave:true,compoundMoney:true,missingAmountClearsOldAmount:true,ambiguousBlocked:true,contextChangeReview:true,phbiSeparated:true,permissionAndNetworkErrors:true,lateEventsIgnored:true,startAndListeningTimeouts:true,backgroundAborts:true,keyboardFallback:true,literalText:true,invalidDateBlocked:true,limitation:'SpeechRecognition events are mocked; no physical microphone or iPhone transcription accuracy tested.'},null,2));
    console.log('Voice browser checks passed: '+passed.join('/')+'; preview/apply/save, compound money, PHBI, manual fallback, errors/timeouts/background, stale callbacks, literal text, invalid dates, mobile layout.');
  }finally{await browser?.close();server.kill();if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
