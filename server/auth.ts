import {randomBytes,timingSafeEqual} from 'node:crypto';
import {OAuth2Client} from 'google-auth-library';
import type {Credentials} from 'google-auth-library';
import type {Express,Request,Response,NextFunction} from 'express';
import {TokenStore,AppState} from './state.js';
import type {Adapter,Config} from './types.js';

interface Session {id: string; csrf: string; expires: number; owner: boolean; oauth?: {state:string;verifier:string;expires:number}}
const random = () => randomBytes(32).toString('base64url');
export const equalSecret = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class OwnerAuth {
  readonly client: OAuth2Client;
  private sessions = new Map<string,Session>();
  private tokens: Credentials = {};
  private store: TokenStore;
  private state: AppState;
  private tokenSave: Promise<unknown> = Promise.resolve();
  constructor(private cfg: Config,state=new AppState(cfg)) {
    this.client = new OAuth2Client(cfg.clientId,cfg.clientSecret,cfg.origin + '/auth/callback');
    this.store = new TokenStore(cfg.stateDir,cfg.encryptionKey);this.state=state;
    this.client.on('tokens',tokens => {
      this.tokens={...this.tokens,...tokens};
      this.tokenSave=this.tokenSave.catch(()=>{}).then(()=>this.saveTokens());
      void this.tokenSave.catch(()=>console.error('Token Google tidak dapat disimpan. Periksa penyimpanan privat.'));
    });
  }
  async initialize() {
    await this.flush();
    if (!this.cfg.demo) {
      const stored=await (this.state.redis ? this.state.read<{owner:string;credentials:Credentials}|null>('google-credentials',null) : this.store.load<{owner:string;credentials:Credentials}>());
      if (stored && stored.owner !== this.cfg.owner) throw new Error('Pemilik konfigurasi berubah. Hubungkan OAuth pemilik yang benar pada volume privat baru.');
      this.tokens=stored?.credentials || {};this.client.setCredentials(this.tokens);
    }
  }
  private saveTokens() {const value={owner:this.cfg.owner,credentials:this.tokens};return this.state.redis ? this.state.write('google-credentials',value) : this.store.save(value);}
  async flush() {await this.tokenSave;}
  private async saveSession(session: Session) {
    if (this.state.redis) await this.state.write('session:'+session.id,session,Math.max(1,Math.ceil((session.expires-Date.now())/1000)));
    else this.sessions.set(session.id,session);
  }
  private async deleteSession(id: string) {if (this.state.redis) await this.state.remove('session:'+id);else this.sessions.delete(id);}
  get connected() {return this.cfg.demo || !!this.tokens.refresh_token;}
  private async session(req: Request, res: Response, create = false) {
    const id = /(?:^|;\s*)kas_session=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    let session = id && /^[A-Za-z0-9_-]{43}$/.test(id) ? (this.state.redis ? await this.state.read<Session|undefined>('session:'+id,undefined) : this.sessions.get(id)) : undefined;
    if (session && session.expires < Date.now()) {await this.deleteSession(session.id);session=undefined;}
    if (!session && create) {
      if (this.state.redis) {
        const count=await this.state.redis.eval<[],number>("local n=redis.call('incr',KEYS[1]);if n==1 then redis.call('expire',KEYS[1],900) end;return n",[this.state.key('login-rate')],[]);
        if (count > 100) throw new Error('Terlalu banyak percobaan login. Coba kembali 15 menit lagi.');
      }
      for (const [key,value] of this.sessions) if (value.expires < Date.now()) this.sessions.delete(key);
      if (this.sessions.size >= 1000) throw new Error('Terlalu banyak sesi. Coba kembali nanti.');
      session={id:random(),csrf:random(),expires:Date.now()+10*60*1000,owner:false};
      await this.saveSession(session);
      this.cookie(res,session.id);
    }
    return session;
  }
  private cookie(res: Response,id: string) {
    res.cookie('kas_session',id,{httpOnly:true,sameSite:'lax',secure:this.cfg.origin.startsWith('https://'),path:'/',maxAge:12*60*60*1000});
  }
  routes(app: Express, adapter: Adapter) {
    app.get('/api/session',async(req,res) => {
      const session = await this.session(req,res);
      res.json({authenticated:!!session?.owner,csrf:session?.owner ? session.csrf : null,demo:this.cfg.demo,connected:this.connected});
    });
    app.get('/auth/login',async (req,res) => {
      const session = (await this.session(req,res,true))!;
      if (this.cfg.demo) {
        const old = session.id;
        await this.deleteSession(old);session.id=random();session.csrf=random();session.owner=true;session.expires=Date.now()+12*60*60*1000;
        await this.saveSession(session);this.cookie(res,session.id);res.redirect('/');return;
      }
      const pkce = await this.client.generateCodeVerifierAsync();
      session.oauth={state:random(),verifier:pkce.codeVerifier,expires:Date.now()+10*60*1000};
      await this.saveSession(session);
      res.redirect(this.client.generateAuthUrl({access_type:'offline',scope:['openid','email','https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive'],
        state:session.oauth.state,code_challenge:pkce.codeChallenge,code_challenge_method:'S256' as any,prompt:this.connected && req.query.reconnect !== '1' ? 'select_account' : 'consent',login_hint:this.cfg.owner}));
    });
    app.get('/auth/callback',async (req,res) => {
      const session = await this.session(req,res), pending = session?.oauth;
      if (!pending || pending.expires < Date.now() || typeof req.query.state !== 'string' || !equalSecret(req.query.state,pending.state) || typeof req.query.code !== 'string') {res.status(400).send('Login kedaluwarsa atau tidak valid. Mulai lagi dari halaman aplikasi.');return;}
      const code=req.query.code;
      delete session!.oauth;await this.saveSession(session!);
      try {
        const authenticated=await this.state.run(async()=>{
        // Exchange on an isolated client: never persist tokens before checking the owner's ID token.
        const exchange = new OAuth2Client(this.cfg.clientId,this.cfg.clientSecret,this.cfg.origin + '/auth/callback');
        const {tokens} = await exchange.getToken({code,codeVerifier:pending.verifier});
        if (!tokens.id_token) throw new Error('Identitas akun Google belum tersedia.');
        const ticket = await exchange.verifyIdToken({idToken:tokens.id_token,audience:this.cfg.clientId}), identity=ticket.getPayload();
        if (!identity?.email_verified || identity.email?.toLowerCase() !== this.cfg.owner) return null;
        if (!tokens.refresh_token && !this.tokens.refresh_token) throw new Error('Izin offline belum diberikan. Hubungkan ulang dengan persetujuan Google.');
        // A fresh grant must not inherit the previous Testing token's expiry metadata.
        const credentials={...tokens,refresh_token:tokens.refresh_token || this.tokens.refresh_token};
        exchange.setCredentials(credentials);
        // Verify the configured original files with the same transport and credentials before accepting the connection.
        this.client.setCredentials(credentials);
        try {await adapter.verifyTargets();}
        catch (error) {this.client.setCredentials(this.tokens);throw error;}
        this.tokens=credentials;await this.saveTokens();
        await this.deleteSession(session!.id);
        const authenticated: Session={id:random(),csrf:random(),expires:Date.now()+12*60*60*1000,owner:true};
        await this.saveSession(authenticated);return authenticated;
        });
        if (!authenticated) {res.status(403).send('Aplikasi hanya untuk akun pemilik.');return;}
        this.cookie(res,authenticated.id);res.redirect('/');
      } catch {res.status(400).send('Koneksi Google belum berhasil. Periksa OAuth, API, akun pemilik, dan hak akses file asli, lalu login kembali.');}
    });
    app.post('/auth/logout',this.requireOwner,this.csrf,async(req,res) => {
      const session=await this.session(req,res);if (session) await this.deleteSession(session.id);
      res.clearCookie('kas_session',{path:'/'});res.json({ok:true});
    });
  }
  requireOwner = async(req: Request,res: Response,next: NextFunction) => {
    if (!(await this.session(req,res))?.owner) {res.status(401).json({error:'Masuk dengan akun Google pemilik terlebih dahulu.'});return;}
    next();
  };
  csrf = async(req: Request,res: Response,next: NextFunction) => {
    const session=await this.session(req,res), token=req.get('X-CSRF-Token') || '';
    if (!session?.owner || req.get('Origin') !== this.cfg.origin || !equalSecret(token,session.csrf)) {res.status(403).json({error:'Sesi permintaan tidak valid. Muat ulang aplikasi.'});return;}
    next();
  };
}
