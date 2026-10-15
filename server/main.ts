import {existsSync} from 'node:fs';
import {loadConfig} from './config.js';
import {acquireProcessLock} from './state.js';
import {OwnerAuth} from './auth.js';
import {GoogleAdapter} from './google.js';
import {DemoAdapter} from './demo.js';
import {createApp} from './app.js';

if (process.argv.includes('--demo')) process.env.DEMO_MODE='true';
if (existsSync('.env') && process.env.DEMO_MODE !== 'true') process.loadEnvFile('.env');
const cfg=loadConfig(),release=await acquireProcessLock(cfg.stateDir),auth=new OwnerAuth(cfg);
await auth.initialize();
const adapter=cfg.demo ? new DemoAdapter(cfg) : new GoogleAdapter(cfg,auth.client,fetch,()=>auth.flush());
const {app,service}=await createApp(cfg,adapter,auth);
const host=cfg.demo || new URL(cfg.origin).protocol === 'http:' ? '127.0.0.1' : '0.0.0.0';
const server=app.listen(cfg.port,host,()=>console.log(`Kas Masjid ${cfg.demo ? '(DEMO: data sintetis)' : ''} berjalan di ${cfg.origin}`));
// Single always-running server; no browser or Apps Script trigger is needed.
let polling=false;
const poll=async()=>{
  if (!cfg.automatic || !auth.connected || polling) return;
  polling=true;
  try {const status=await service.refreshPublicPdf();if (status.state === 'ERROR' || status.state === 'BLOCKED') console.error('Pemeriksaan PDF:',status.state);}
  catch {console.error('Pemeriksaan PDF gagal. Lihat status di aplikasi.');}
  finally {polling=false;}
};
const timer=setInterval(poll,5*60*1000);
void poll();
let stopping=false;
const shutdown=()=>{
  if (stopping) return;stopping=true;clearInterval(timer);
  server.close(async()=>{await release();process.exit(0);});
};
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
