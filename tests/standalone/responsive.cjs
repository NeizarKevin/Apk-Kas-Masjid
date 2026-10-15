const assert=require('node:assert/strict');
const {mkdtemp,mkdir,rm,writeFile}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join,resolve}=require('node:path');
const {spawn}=require('node:child_process');
const {chromium,webkit,devices}=require('playwright');

async function run(){
  const dir=await mkdtemp(join(tmpdir(),'kas-layout-')),origin='http://localhost:3018',evidence=resolve('test-results');
  await mkdir(evidence,{recursive:true});
  const server=spawn(process.execPath,['dist/main.js','--demo'],{env:{...process.env,PORT:'3018',APP_ORIGIN:origin,STATE_DIR:dir},stdio:['ignore','pipe','pipe'],windowsHide:true});
  let output='',browser;server.stdout.on('data',data=>output+=data);server.stderr.on('data',data=>output+=data);
  const results=[];
  try{
    const deadline=Date.now()+30000;
    for(;;){try{if((await fetch(origin+'/healthz')).ok)break;}catch{}if(Date.now()>deadline)throw Error('Demo startup failed: '+output);await new Promise(resolve=>setTimeout(resolve,100));}
    for(const [engine,launcher] of [['webkit',webkit],['chromium',chromium]]){
      browser=await launcher.launch({headless:true});
      for(const locale of ['en-US','id-ID']){
        const context=await browser.newContext({...devices['iPhone 13'],locale}),page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(origin);await page.locator('#loginLink').click();await page.waitForFunction(()=>document.getElementById('connection').textContent==='Demo aktif');
        for(const [width,height] of [[320,650],[375,812],[390,844],[430,932],[844,390],[1280,900]]){
          await page.setViewportSize({width,height});
          const bounds=await page.evaluate(()=>{
            const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width};};
            const controls=Array.from(document.querySelectorAll('input:not([type=checkbox]),select,textarea')).filter(el=>el.getClientRects().length);
            return {overflow:document.documentElement.scrollWidth>innerWidth,escaped:controls.filter(el=>{const r=rect(el),p=rect(el.closest('.form-group')||el.parentElement);return r.x<p.x-1||r.right>p.right+1||r.right>innerWidth;}).map(el=>el.id),dropdowns:Array.from(document.querySelectorAll('select')).map(el=>{const style=getComputedStyle(el);return {id:el.id,size:style.backgroundSize,repeat:style.backgroundRepeat};}),datePadding:controls.filter(el=>['date','month'].includes(el.type)).map(el=>[getComputedStyle(el).paddingLeft,getComputedStyle(el).paddingRight]),date:rect(document.getElementById('date')),code:rect(document.getElementById('code')),fund:rect(document.getElementById('fund')),month:rect(document.getElementById('month'))};
          });
          const label=engine+' '+locale+' '+width+'x'+height;
          assert.equal(bounds.overflow,false,label+' horizontal overflow');assert.deepEqual(bounds.escaped,[],label+' controls escape their fields');
          for(const dropdown of bounds.dropdowns){assert.ok(dropdown.size.split(',').every(layer=>layer.trim()==='5px 5px'),label+' '+dropdown.id+' dropdown arrow must stay small: '+dropdown.size);assert.ok(dropdown.repeat.split(',').every(layer=>layer.trim()==='no-repeat'),label+' '+dropdown.id+' arrow must not tile');}
          assert.ok(bounds.datePadding.every(sides=>sides.every(value=>value==='0px')),label+' iOS date padding workaround regressed');
          if(width<=600){assert.ok(bounds.date.bottom<=bounds.code.y,label+' date/holder must stack');assert.ok(bounds.fund.bottom<=bounds.month.y,label+' fund/month must stack');}
          else assert.ok(bounds.date.right<=bounds.code.x,label+' date overlaps holder');
          results.push({engine,locale,width,height});
        }
        await page.setViewportSize({width:390,height:844});
        await page.locator('#fund').selectOption('PHBI');await page.waitForFunction(()=>document.getElementById('formFund').textContent==='Dana: PHBI');
        await page.locator('#fund').selectOption('MASJID');await page.waitForFunction(()=>document.getElementById('formFund').textContent==='Dana: Kas masjid');
        await page.locator('#date').fill('2026-10-10');await page.locator('#code').selectOption('K2');await page.locator('#description').fill('Tanggal utuh di '+engine+' '+locale);await page.locator('#amount').fill('100');await page.locator('#submitButton').click();await page.waitForFunction(()=>document.getElementById('description').value===''&&!document.getElementById('submitButton').disabled);
        const data=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json(),tx=data.transactions.find(tx=>tx.description==='Tanggal utuh di '+engine+' '+locale);assert.equal(tx.date,'2026-10-10');assert.equal(tx.code,'K2');
        await page.getByRole('button',{name:'Edit '+tx.description,exact:true}).click();await page.locator('#changeDate').fill('2026-10-11');await page.locator('#changeReason').fill('Memeriksa kontrol tanggal pada HP');
        assert.equal(await page.evaluate(()=>{const d=document.getElementById('changeDate').getBoundingClientRect(),c=document.getElementById('changeCode').getBoundingClientRect();return d.bottom<=c.y&&d.right<=innerWidth;}),true);
        await page.locator('#changeSubmit').click();await page.waitForFunction(()=>!document.getElementById('changeDialog').open&&!document.getElementById('submitButton').disabled);
        const changed=await (await context.request.get(origin+'/api/dashboard?fund=MASJID&month=2026-10')).json();assert.equal(changed.transactions.find(row=>row.key===tx.key).date,'2026-10-11');
        await page.locator('#month').fill('2026-11');await page.locator('#month').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('historyCount').textContent==='0 dari 0 transaksi');
        await page.locator('#month').fill('2026-10');await page.locator('#month').dispatchEvent('change');await page.waitForFunction(()=>document.getElementById('historyCount').textContent!=='0 dari 0 transaksi');
        await page.locator('#openImport').click();await page.setViewportSize({width:320,height:650});
        let footer=await page.locator('#importSubmit').boundingBox();assert.ok(footer.y>=0&&footer.y+footer.height<=650);await page.locator('#importClose').click();
        await page.locator('#selectMode').click();await page.locator('#selectAll').check();await page.locator('#deleteSelected').click();footer=await page.locator('#bulkSubmit').boundingBox();assert.ok(footer.y>=0&&footer.y+footer.height<=650);await page.locator('#bulkClose').click();await page.locator('#selectMode').click();
        await page.setViewportSize({width:390,height:844});await page.locator('#entry').scrollIntoViewIfNeeded();await page.screenshot({path:join(evidence,engine+'-'+locale+'-form.png')});
        await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:join(evidence,engine+'-'+locale+'-page.png'),fullPage:true});
        assert.deepEqual(errors,[]);await context.close();
      }
      await browser.close();browser=null;
    }
    await writeFile(join(evidence,'responsive-checks.json'),JSON.stringify({results,dateSaveAndEdit:true,monthFilter:true,dialogFooters:true,pageErrors:[],limitation:'Playwright WebKit on Windows; native iOS UIKit date picker and physical home-screen app are not available.'},null,2));
    console.log('Responsive checks passed: '+results.length+' WebKit/Chromium viewport and locale cases, field bounds, date save/edit, month filter, import/bulk dialog actions.');
  }finally{await browser?.close();server.kill();if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
