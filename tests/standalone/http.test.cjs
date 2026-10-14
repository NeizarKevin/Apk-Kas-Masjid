const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const crypto=require('node:crypto');
async function fixture(t,live=false) {
  const [{loadConfig},{DemoAdapter},{OwnerAuth},{createApp}]=await Promise.all(['config','demo','auth','app'].map(name=>import('../../dist/'+name+'.js')));
  const dir=await mkdtemp(join(tmpdir(),'kas-http-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const cfg={...loadConfig({DEMO_MODE:'true',STATE_DIR:dir}),automatic:false,...(live ? {demo:false,owner:'owner@example.test',clientId:'test_client',clientSecret:'test_secret',encryptionKey:crypto.randomBytes(32).toString('base64')} : {})};
  const auth=new OwnerAuth(cfg);await auth.initialize();const adapter=new DemoAdapter(cfg);
  const {app}=await createApp(cfg,adapter,auth);const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin='http://127.0.0.1:'+server.address().port;cfg.origin=origin;
  const login=await fetch(origin+'/auth/login',{redirect:'manual'}),cookie=login.headers.getSetCookie().at(-1).split(';')[0];
  return {cfg,origin,cookie,login,auth,adapter};
}
test('Every data, preview and write endpoint rejects anonymous requests; owner mutations enforce CSRF and Origin',async t=>{
  const {origin,cookie}=await fixture(t);
  for(const [path,method] of [['/api/dashboard','GET'],['/api/transactions/x','GET'],['/api/transactions','POST'],['/api/changes','POST'],['/api/changes/x','GET'],['/api/pdf/preview','POST'],['/api/pdf/refresh','POST'],['/api/pdf/public','GET']]) assert.equal((await fetch(origin+path,{method})).status,401,path);
  const session=await (await fetch(origin+'/api/session',{headers:{Cookie:cookie}})).json();assert.equal(session.authenticated,true);
  const tx={id:crypto.randomUUID(),fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:'=Literal text',amount:123};
  const request=headers=>fetch(origin+'/api/transactions',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...headers},body:JSON.stringify(tx)});
  assert.equal((await request({Origin:origin})).status,403);
  assert.equal((await request({Origin:'https://attacker.test','X-CSRF-Token':session.csrf})).status,403);
  assert.equal((await fetch(origin+'/api/changes',{method:'POST',headers:{Cookie:cookie,Origin:origin,'Content-Type':'application/json'},body:'{}'})).status,403);
  const saved=await request({Origin:origin,'X-CSRF-Token':session.csrf});assert.equal(saved.status,200);assert.equal((await saved.json()).saved,true);
  const again=await request({Origin:origin,'X-CSRF-Token':session.csrf});assert.equal((await again.json()).duplicate,true);
  assert.equal((await fetch(origin+'/api/dashboard',{headers:{Cookie:cookie}})).status,200);
  const logout=await fetch(origin+'/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin,'X-CSRF-Token':session.csrf}});assert.equal(logout.status,200);
  assert.equal((await fetch(origin+'/api/dashboard',{headers:{Cookie:cookie}})).status,401);
});
test('OAuth uses offline access and PKCE; invalid state is rejected before token exchange',async t=>{
  const {origin,cookie,login}=await fixture(t,true),url=new URL(login.headers.get('location'));
  assert.equal(url.searchParams.get('access_type'),'offline');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('state'));assert.ok(url.searchParams.get('code_challenge'));
  assert.equal((await fetch(origin+'/auth/callback?state=wrong&code=fake',{headers:{Cookie:cookie}})).status,400);
  assert.equal((await fetch(origin+'/api/dashboard',{headers:{Cookie:cookie}})).status,401);
});
test('A verified Google account with a different email never gets a session or persisted offline token',async t=>{
  const {OAuth2Client}=await import('google-auth-library');
  const getToken=OAuth2Client.prototype.getToken,verify=OAuth2Client.prototype.verifyIdToken;
  OAuth2Client.prototype.getToken=async()=>({tokens:{id_token:'synthetic',refresh_token:'must_not_persist'}});
  OAuth2Client.prototype.verifyIdToken=async()=>({getPayload:()=>({email:'other@example.test',email_verified:true})});
  t.after(()=>{OAuth2Client.prototype.getToken=getToken;OAuth2Client.prototype.verifyIdToken=verify;});
  const {cfg,origin,cookie,login}=await fixture(t,true),state=new URL(login.headers.get('location')).searchParams.get('state');
  const result=await fetch(origin+'/auth/callback?state='+state+'&code=fake',{headers:{Cookie:cookie}});assert.equal(result.status,403);
  assert.equal((await fetch(origin+'/api/session',{headers:{Cookie:cookie}}).then(r=>r.json())).authenticated,false);
  await assert.rejects(require('node:fs/promises').readFile(join(cfg.stateDir,'google-token.json')),/ENOENT/);
});
test('Security headers restrict scripts, frames and caching; request size and Host are constrained',async t=>{
  const {origin,cookie}=await fixture(t),response=await fetch(origin);
  assert.match(response.headers.get('content-security-policy'),/sha256-/);assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const html=await response.text();assert.equal(html.includes('google.script.run'),false);assert.equal(html.includes('script.google.com'),false);assert.equal(/onclick=/.test(html),false);
  const browserScript=/<script>([\s\S]*?)<\/script>/.exec(html)[1].replace(/\r\n?/g,'\n');
  assert.ok(response.headers.get('content-security-policy').includes(crypto.createHash('sha256').update(browserScript).digest('base64')),'CSP must hash the browser-normalized script on Windows');
  assert.equal((await fetch(origin+'/api/transactions',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({x:'x'.repeat(20000)})})).status,400);
  const status=await new Promise((resolve,reject)=>require('node:http').get(origin,{headers:{Host:'attacker.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject));
  assert.equal(status,400);
});
test('Owner OAuth rotates the session, stores encrypted owner-bound tokens and verifies target access first',async t=>{
  const {OAuth2Client}=await import('google-auth-library');
  const getToken=OAuth2Client.prototype.getToken,verify=OAuth2Client.prototype.verifyIdToken;
  OAuth2Client.prototype.getToken=async()=>({tokens:{id_token:'synthetic',refresh_token:'offline_test_token'}});
  OAuth2Client.prototype.verifyIdToken=async()=>({getPayload:()=>({email:'owner@example.test',email_verified:true})});
  t.after(()=>{OAuth2Client.prototype.getToken=getToken;OAuth2Client.prototype.verifyIdToken=verify;});
  const {cfg,origin,cookie,login,adapter,auth}=await fixture(t,true),state=new URL(login.headers.get('location')).searchParams.get('state');
  const {TokenStore}=await import('../../dist/state.js');
  await new TokenStore(cfg.stateDir,cfg.encryptionKey).save({owner:cfg.owner,credentials:{refresh_token:'old_testing_token',refresh_token_expires_in:604800}});await auth.initialize();
  let verified=0;adapter.verifyTargets=async()=>{verified++;};
  const result=await fetch(origin+'/auth/callback?state='+state+'&code=fake',{headers:{Cookie:cookie},redirect:'manual'});assert.equal(result.status,302);assert.equal(verified,1);
  const authenticated=result.headers.getSetCookie().at(-1).split(';')[0];assert.notEqual(authenticated,cookie);
  assert.equal((await fetch(origin+'/api/session',{headers:{Cookie:authenticated}}).then(r=>r.json())).authenticated,true);
  assert.equal((await fetch(origin+'/api/session',{headers:{Cookie:cookie}}).then(r=>r.json())).authenticated,false);
  const stored=await new TokenStore(cfg.stateDir,cfg.encryptionKey).load();
  assert.equal(stored.owner,cfg.owner);assert.equal(stored.credentials.refresh_token,'offline_test_token');
  assert.equal(stored.credentials.refresh_token_expires_in,undefined);
  const {OwnerAuth}=await import('../../dist/auth.js');await assert.rejects(new OwnerAuth({...cfg,owner:'changed@example.test'}).initialize(),/Pemilik konfigurasi berubah/);
});
