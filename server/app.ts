import express from 'express';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {OwnerAuth,equalSecret} from './auth.js';
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
  if (cfg.redisUrl) app.use(async(_req,_res,next)=>{await auth.initialize();next();});
  auth.routes(app,adapter);
  app.get('/',(_req,res)=>res.type('html').send(html));
  app.get('/privacy',(_req,res)=>res.type('html').send(`<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privasi · Kas Masjid</title><style>body{font:16px/1.7 system-ui;background:#f0f4f0;color:#0f1f14;max-width:720px;margin:48px auto;padding:24px}h1{line-height:1.2;color:#1a7a3f}a{color:#1a7a3f}section{background:white;padding:28px;border-radius:20px}</style><section><a href="/">← Kembali ke aplikasi</a><h1>Privasi Kas Masjid</h1><p>Aplikasi pembukuan Masjid Al-Barokah Taskombang digunakan oleh pemilik yang ditetapkan. Login Google memakai identitas email untuk memeriksa akses pemilik.</p><p>Izin Sheets dan Drive digunakan untuk membaca dan memperbarui buku kas, template laporan, PDF publik, pratinjau privat, dan arsip yang telah dikonfigurasi. Data transaksi tetap tersimpan di Google Sheets milik pengelola. Hanya laporan kas yang disetujui dipublikasikan melalui tautan PDF jamaah yang sudah ada.</p><p>Backend di Vercel memproses data untuk menjalankan pembukuan. Token Google, sesi, dan status operasi disimpan terenkripsi di Upstash Redis. Upstash QStash mengirim pemeriksaan berkala tanpa isi transaksi. Backend tidak menjual data, menggunakannya untuk iklan, atau mengirimnya ke model AI. Dikte opsional memakai pengenalan suara dari browser; audio dapat diproses oleh penyedia browser.</p><p>Sesi pemilik berakhir setelah 12 jam atau saat keluar. Token offline dipakai untuk pemeriksaan laporan saat browser ditutup. Pemilik dapat mencabut izin melalui pengaturan koneksi akun Google; pengelola dapat menghapus token dan sesi dari penyimpanan aplikasi.</p><p>Untuk koreksi pembukuan, penghapusan akses, atau pertanyaan privasi, hubungi pengelola kas Masjid Al-Barokah Taskombang. Terakhir diperbarui: 14 Oktober 2026.</p></section></html>`));
  app.get('/healthz',(_req,res)=>res.json({ok:true}));
  app.post('/api/internal/poll',async(req,res)=>{
    if (!cfg.cronSecret || !equalSecret(req.get('Authorization') || '','Bearer '+cfg.cronSecret)) {res.sendStatus(401);return;}
    if (!cfg.automatic) {res.status(200).json({state:'SETUP'});return;}
    if (!auth.connected) {res.status(503).json({state:'DISCONNECTED'});return;}
    const status=await service.refreshPublicPdf();
    res.status(status.state === 'ERROR' ? 503 : 200).json({state:status.state});
  });
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
