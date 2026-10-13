const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const html = fs.readFileSync(path.join(__dirname,'..','apps-script','Index.html'),'utf8');
const client = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const tick = () => new Promise(resolve => setImmediate(resolve));
function clientApp({dropResponse=false,preview=false}={}) {
  const nodes = {}, storage = new Map(), requests = [], stored = new Map();
  function node() {return {value:'',textContent:'',className:'',hidden:false,disabled:false,children:[],events:{},setAttribute(name,value){this[name]=value;},removeAttribute(name){delete this[name];},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},addEventListener(name,handler){this.events[name]=handler;}};}
  for (const id of html.matchAll(/\bid="([^"]+)"/g)) nodes[id[1]] = node();
  nodes.fund.value='MASJID'; nodes.code.value='K1';
  const report={state:'BLOCKED',message:'PDF ditahan sampai saldo cocok.',reconciliation:{ok:false,date:'2026-10-08',book:900,actual:1000,difference:100}};
  const dashboard=(fund,month) => ({fund:fund||'MASJID',month:month||'2026-10',today:'2026-10-09',income:100,expense:25,balance:1075,
    checkpoint:{date:'2026-10-08',amount:1000,holders:{K1:800,K2:200,K3:0}},transactions:[{date:'2026-10-09',description:'<img src=x onerror=bad()>',code:'K1',amount:100,type:'in'}],report,automatic:true,pdfUrl:'https://drive.google.com/file/d/test_pdf/view'});
  let success,failure;
  const runner = new Proxy({}, {get:(_,name) => {
    if (name === 'withSuccessHandler') return callback => {success=callback;return runner;};
    if (name === 'withFailureHandler') return callback => {failure=callback;return runner;};
    return (...args) => {
      const ok=success,fail=failure; requests.push({name,args});
      queueMicrotask(() => {
        if (name === 'getDashboard') return ok(dashboard(...args));
        if (name === 'saveTransaction') {
          const input={...args[0]},duplicate=stored.has(input.id); stored.set(input.id,input);
          if (dropResponse) {dropResponse=false; return fail({message:'Respons hilang'});}
          return ok({saved:true,duplicate,id:input.id,report});
        }
        if (name === 'resolvePendingRequest') return ok({id:args[0],saved:stored.has(args[0])});
        if (name === 'refreshPublicPdf') return ok(report);
        throw new Error('Unexpected RPC '+String(name));
      });
    };
  }});
  const context={document:{getElementById:id => nodes[id],createElement:node},localStorage:{getItem:key => storage.get(key)||null,setItem:(key,value) => storage.set(key,value),removeItem:key => storage.delete(key)},crypto,queueMicrotask,console};
  if (!preview) context.google={script:{run:runner}};
  const sandbox=vm.createContext(context);
  vm.runInContext(client,sandbox);
  return {nodes,storage,requests,stored,sandbox};
}
test('Client waits for an acknowledgment and retries the same UUID after losing a response',async () => {
  const app=clientApp({dropResponse:true}); await tick();
  assert.equal(app.nodes.submitButton.disabled,false);
  app.nodes.description.value='Infaq'; app.nodes.amount.value='100.000';
  await app.nodes.transactionForm.events.submit({preventDefault(){}});
  assert.match(app.nodes.notice.textContent,/Respons hilang/);
  assert.equal(app.nodes.submitButton.textContent,'Kirim ulang transaksi');
  const id=JSON.parse(app.storage.get('kas-masjid-pending-v1')).id;
  await app.nodes.transactionForm.events.submit({preventDefault(){}});
  const saves=app.requests.filter(call => call.name === 'saveTransaction');
  assert.equal(saves.length,2); assert.equal(saves[0].args[0].id,id); assert.equal(saves[1].args[0].id,id);
  assert.equal(app.stored.size,1); assert.equal(app.storage.size,0);
  assert.equal(app.nodes.amount.value,''); assert.match(app.nodes.notice.textContent,/Tidak ada pencatatan ganda/);
  assert.equal(app.nodes.reportState.textContent,'Ditahan');
});
test('Client displays descriptions as literal text and can resolve an unacknowledged request',async () => {
  const app=clientApp({dropResponse:true}); await tick();
  const description=app.nodes.history.children[0].children[0].children[0];
  assert.equal(description.textContent,'<img src=x onerror=bad()>');
  assert.equal(description.children.length,0);
  app.nodes.description.value='Infaq'; app.nodes.amount.value='100';
  await app.nodes.transactionForm.events.submit({preventDefault(){}});
  await app.nodes.checkPending.events.click();
  assert.equal(app.storage.size,0); assert.equal(app.stored.size,1);
  assert.match(app.nodes.notice.textContent,/sudah tersimpan/);
});
test('Standalone HTML is a read-only preview and cannot report a successful save',() => {
  const app=clientApp({preview:true});
  assert.equal(app.nodes.submitButton.disabled,true); assert.equal(app.requests.length,0);
  assert.match(app.nodes.connection.textContent,/Belum terhubung/);
  assert.equal(app.nodes.openApp.hidden,false);
  assert.match(app.nodes.openApp.href,/AKfycbwEz_VEAhjja-S2xt0mq6KEAEj4PP44JB6UFtD7uP1dg54JowROb1tKa6PHLqT60GVi\/exec$/);
  assert.equal(html.includes('new Image('),false);
  assert.equal(html.includes('sendToSheet'),false);
});
test('Voice input keeps code and date separate from the amount',() => {
  const app=clientApp({preview:true});
  let parsed=vm.runInContext("parseVoiceText('K1 infaq jumat lima ratus ribu tanggal 9 oktober 2026')",app.sandbox);
  assert.equal(parsed.kode,'K1'); assert.equal(parsed.jumlah,500000); assert.equal(parsed.tanggal,'2026-10-09');
  parsed=vm.runInContext("parseVoiceText('K3 bayar listrik 125.000 tanggal 10 oktober 2026')",app.sandbox);
  assert.equal(parsed.kode,'K3'); assert.equal(parsed.tipe,'out'); assert.equal(parsed.jumlah,125000);
});
test('The repository entry and Apps Script use the same original interface',() => {
  assert.equal(fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8'),html);
  assert.match(html,/class="topbar"/); assert.match(html,/Input Suara/);
  assert.equal(html.includes('deleteItem'),false);
});
