import {loadConfig} from './config.js';
import {OwnerAuth} from './auth.js';
import {GoogleAdapter} from './google.js';
import {createApp} from './app.js';

const cfg=loadConfig();
if (!cfg.cloud) throw new Error('Entry point ini hanya untuk hosting Vercel.');
const auth=new OwnerAuth(cfg);
await auth.initialize();
export const {app}=await createApp(cfg,new GoogleAdapter(cfg,auth.client,fetch,()=>auth.flush()),auth);
