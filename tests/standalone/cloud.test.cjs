const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
class RedisFake {
  data=new Map();expires=new Map();
  async get(key){return this.data.get(key) ?? null;}
  async set(key,value,options={}){if(options.nx && this.data.has(key)) return null;this.data.set(key,value);if(options.ex)this.expires.set(key,options.ex);return 'OK';}
  async del(key){return this.data.delete(key)?1:0;}
  async eval(script,keys,args){if(script.includes("redis.call('incr'")){const n=Number(this.data.get(keys[0])||0)+1;this.data.set(keys[0],n);return n;}if(this.data.get(keys[0])!==args[0])return 0;return this.del(keys[0]);}
}
async function fixture(){
  const [{loadConfig},state]=await Promise.all([import('../../dist/config.js'),import('../../dist/state.js')]);
  const cfg={...loadConfig({DEMO_MODE:'true'}),encryptionKey:crypto.randomBytes(32).toString('base64')};
  const redis=new RedisFake();return {cfg,redis,state,a:new state.AppState(cfg,redis),b:new state.AppState(cfg,redis)};
}
test('Shared state encrypts sessions, survives instances, expires sessions and rejects tampering or key substitution',async()=>{
  const {a,b,redis}=await fixture();await a.write('session:test',{owner:true,token:'synthetic_secret'},600);
  assert.deepEqual(await b.read('session:test',null),{owner:true,token:'synthetic_secret'});
  const key=a.key('session:test'),raw=await redis.get(key);assert.equal(raw.includes('synthetic_secret'),false);assert.equal(redis.expires.get(key),600);
  redis.data.set(a.key('session:other'),raw);await assert.rejects(b.read('session:other',null));
  const damaged=JSON.parse(raw);damaged.data=Buffer.from('corrupt').toString('base64');redis.data.set(key,JSON.stringify(damaged));await assert.rejects(b.read('session:test',null));
  await a.remove('session:test');assert.equal(await b.read('session:test',null),null);
});
test('Two server instances serialize operations; lost write responses retain the lease and never release a successor lock',async()=>{
  const {a,b,redis,state}=await fixture();let release,entered;const started=new Promise(r=>entered=r);
  const active=a.run(async()=>{entered();await new Promise(r=>release=r);});await started;
  await assert.rejects(b.run(async()=>assert.fail('concurrent mutation')),/sedang diproses/);release();await active;
  assert.equal(await b.run(async()=>42),42);assert.equal(await redis.get(a.key('operation-lock')),null);
  await a.run(async()=>{redis.data.set(a.key('operation-lock'),'successor');});assert.equal(await redis.get(a.key('operation-lock')),'successor');
  await redis.del(a.key('operation-lock'));
  await assert.rejects(a.run(async()=>{state.uncertainWrite();throw Error('response lost');}),/response lost/);
  assert.ok(await redis.get(a.key('operation-lock')));assert.equal(redis.expires.get(a.key('operation-lock')),600);
  await assert.rejects(b.run(async()=>assert.fail()),/sedang diproses/);
});
test('Deadline and Redis failures refuse new writes',async()=>{
  const {a,redis,state}=await fixture(),now=Date.now;
  try {await a.run(async()=>{Date.now=()=>now()+240001;assert.throws(state.assertLease,/Waktu operasi habis/);});}finally{Date.now=now;}
  redis.set=async()=>{throw Error('offline');};let writes=0;await assert.rejects(a.run(async()=>writes++),/offline/);assert.equal(writes,0);
});
test('Owner session survives a different function instance; logout revokes it everywhere and expired sessions cannot authenticate',async t=>{
  const {cfg,redis,a,b}=await fixture();const [{OwnerAuth},{createApp},{DemoAdapter}]=await Promise.all(['auth','app','demo'].map(x=>import('../../dist/'+x+'.js')));
  const auth1=new OwnerAuth(cfg,a),auth2=new OwnerAuth(cfg,b);const {app}=await createApp(cfg,new DemoAdapter(cfg),auth1);
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
  cfg.origin='http://127.0.0.1:'+server.address().port;
  const login=await fetch(cfg.origin+'/auth/login',{redirect:'manual'}),cookie=login.headers.getSetCookie().at(-1).split(';')[0];
  const session=await (await fetch(cfg.origin+'/api/session',{headers:{Cookie:cookie}})).json();assert.equal(session.authenticated,true);
  let allowed=false;await auth2.requireOwner({headers:{cookie}}, {status(){throw Error('denied');}},()=>allowed=true);assert.equal(allowed,true);
  const logout=await fetch(cfg.origin+'/auth/logout',{method:'POST',headers:{Cookie:cookie,Origin:cfg.origin,'X-CSRF-Token':session.csrf}});assert.equal(logout.status,200);
  let denied;await auth2.requireOwner({headers:{cookie}},{status(s){denied=s;return this;},json(){}},()=>assert.fail());assert.equal(denied,401);
  const id=crypto.randomBytes(32).toString('base64url');await a.write('session:'+id,{id,csrf:'test',expires:0,owner:true},600);
  await auth2.requireOwner({headers:{cookie:'kas_session='+id}},{status(s){denied=s;return this;},json(){}},()=>assert.fail());assert.equal(denied,401);
});
test('Scheduled endpoint requires a secret and does no work before cutover; cloud config fails closed',async t=>{
  const [{loadConfig},{OwnerAuth},{createApp}]=await Promise.all(['config','auth','app'].map(x=>import('../../dist/'+x+'.js')));
  const cfg={...loadConfig({DEMO_MODE:'true'}),automatic:false,cronSecret:crypto.randomBytes(32).toString('hex')};let polls=0;
  const adapter={verifyTargets:async()=>assert.fail()},service={refreshPublicPdf:async()=>{polls++;return {state:'UNCHANGED'};}};
  const {app}=await createApp(cfg,adapter,new OwnerAuth(cfg),service);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));cfg.origin='http://127.0.0.1:'+server.address().port;
  const call=token=>fetch(cfg.origin+'/api/internal/poll',{method:'POST',headers:{Authorization:token}});
  assert.equal((await call('Bearer wrong')).status,401);assert.equal(polls,0);
  assert.equal((await call('Bearer '+cfg.cronSecret)).status,200);assert.equal(polls,0);
  cfg.automatic=true;assert.equal((await call('Bearer '+cfg.cronSecret)).status,200);assert.equal(polls,1);
  service.refreshPublicPdf=async()=>({state:'ERROR'});assert.equal((await call('Bearer '+cfg.cronSecret)).status,503);
  assert.throws(()=>loadConfig({DEMO_MODE:'true',VERCEL:'1'}),/Hosting membutuhkan/);
});

test('OAuth waits for the shared lease release before issuing an owner cookie or redirect',async t=>{
  const {cfg,a,redis}=await fixture();Object.assign(cfg,{demo:false,clientId:'test',clientSecret:'test',owner:'owner@example.test'});
  const [{OAuth2Client},{OwnerAuth},{createApp}]=await Promise.all([import('google-auth-library'),import('../../dist/auth.js'),import('../../dist/app.js')]);
  const getToken=OAuth2Client.prototype.getToken,verify=OAuth2Client.prototype.verifyIdToken;
  OAuth2Client.prototype.getToken=async()=>({tokens:{id_token:'synthetic',refresh_token:'synthetic'}});OAuth2Client.prototype.verifyIdToken=async()=>({getPayload:()=>({email:cfg.owner,email_verified:true})});
  t.after(()=>{OAuth2Client.prototype.getToken=getToken;OAuth2Client.prototype.verifyIdToken=verify;});
  const auth=new OwnerAuth(cfg,a),{app}=await createApp(cfg,{verifyTargets:async()=>{}},auth);const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));cfg.origin='http://127.0.0.1:'+server.address().port;
  const login=await fetch(cfg.origin+'/auth/login',{redirect:'manual'}),cookie=login.headers.getSetCookie().at(-1).split(';')[0],state=new URL(login.headers.get('location')).searchParams.get('state');
  redis.eval=async()=>{throw Error('release unavailable');};
  const result=await fetch(cfg.origin+'/auth/callback?state='+state+'&code=synthetic',{headers:{Cookie:cookie},redirect:'manual'});
  assert.equal(result.status,400);assert.equal(result.headers.get('location'),null);assert.equal(result.headers.get('set-cookie'),null);assert.match(await result.text(),/Koneksi Google belum berhasil/);
});
