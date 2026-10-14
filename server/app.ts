import express from 'express';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {OwnerAuth} from './auth.js';
import {CashService} from './service.js';
import type {Adapter,Config} from './types.js';

export async function createApp(cfg: Config,adapter: Adapter,auth: OwnerAuth,service = new CashService(cfg,adapter)) {
  const app=express(), html=await readFile(resolve('public/index.html'),'utf8');
  const script=/<script>([\s\S]*?)<\/script>/.exec(html)?.[1] || '';
  // HTML parsing normalizes CRLF before the browser evaluates the CSP hash.
  const scriptHash=createHash('sha256').update(script.replace(/\r\n?/g,'\n')).digest('base64');
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    res.set({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
      'Content-Security-Policy':`default-src 'self'; script-src 'self' 'sha256-${scriptHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
      'Permissions-Policy':'camera=(), geolocation=(), microphone=(self)'});
    if (cfg.origin.startsWith('https://')) res.set('Strict-Transport-Security','max-age=31536000');
    if (req.get('Host') !== new URL(cfg.origin).host) {res.status(400).json({error:'Host aplikasi tidak valid.'});return;}
    next();
  });
  app.use(express.json({limit:'16kb'}));
  auth.routes(app,adapter);
  app.get('/',(_req,res)=>res.type('html').send(html));
  app.get('/healthz',(_req,res)=>res.json({ok:true}));
  app.get('/api/dashboard',auth.requireOwner,async(req,res)=>res.json(await service.getDashboard(String(req.query.fund || 'MASJID'),String(req.query.month || ''))));
  app.post('/api/transactions',auth.requireOwner,auth.csrf,async(req,res)=>res.json(await service.saveTransaction(req.body)));
  app.get('/api/transactions/:id',auth.requireOwner,async(req,res)=>res.json(await service.resolvePendingRequest(String(req.params.id))));
  app.post('/api/changes',auth.requireOwner,auth.csrf,async(req,res)=>res.json(await service.changeTransaction(req.body)));
  app.get('/api/changes/:id',auth.requireOwner,async(req,res)=>res.json(await service.resolveChange(String(req.params.id))));
  app.post('/api/pdf/preview',auth.requireOwner,auth.csrf,async(_req,res)=>res.json(await service.previewPublicPdf()));
  app.post('/api/pdf/refresh',auth.requireOwner,auth.csrf,async(_req,res)=>res.json(await service.refreshPublicPdf()));
  if (cfg.demo) app.get('/api/pdf/:kind',auth.requireOwner,async(req,res)=>{
    if (!['public','preview'].includes(String(req.params.kind))) {res.sendStatus(404);return;}
    try {res.type('pdf').send(await readFile(join(cfg.stateDir,req.params.kind + '.pdf')));}
    catch {res.status(404).send('PDF demo belum dibuat. Gunakan Pratinjau atau Perbarui PDF.');}
  });
  app.use((error: Error, _req: express.Request,res: express.Response,_next: express.NextFunction)=>res.status(400).json({error:error.message || 'Permintaan gagal. Coba kembali.'}));
  return {app,service};
}
