import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createCipheriv, createDecipheriv, randomBytes,createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {Redis} from '@upstash/redis';
import type {Config} from './types.js';
import lockfile from 'proper-lockfile';

export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {return JSON.parse(await readFile(path, 'utf8')) as T;}
  catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error;}
}
export async function atomicJson(path: string, value: unknown) {
  const temp = path + '.' + randomBytes(8).toString('hex') + '.tmp';
  await writeFile(temp, JSON.stringify(value), {mode:0o600});
  await rename(temp, path);
}
export class TokenStore {
  constructor(private dir: string, private secret: string) {}
  async save(value: unknown) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(this.secret,'base64'), iv);
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    await atomicJson(join(this.dir,'google-token.json'), {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:bytes.toString('base64')});
  }
  async load<T>(): Promise<T | null> {
    const value = await readJson<{iv:string;tag:string;data:string} | null>(join(this.dir,'google-token.json'),null);
    if (!value) return null;
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(this.secret,'base64'),Buffer.from(value.iv,'base64'));
    decipher.setAuthTag(Buffer.from(value.tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8')) as T;
  }
}
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }
}
const leaseContext = new AsyncLocalStorage<{deadline:number;uncertain:boolean}>();
export function assertLease() {
  const lease=leaseContext.getStore();
  if (lease && Date.now() >= lease.deadline) throw new Error('Waktu operasi habis. Periksa status kiriman sebelum mencoba lagi.');
}
export function uncertainWrite() {const lease=leaseContext.getStore();if (lease) lease.uncertain=true;}
// A lease outlives the 300s function limit plus the 90s maximum Google request.
export class AppState {
  readonly redis: Redis | null;
  private prefix: string;
  private queue=new SerialQueue();
  constructor(private cfg: Config,redis?: Redis) {
    this.redis=redis || (cfg.redisUrl ? new Redis({url:cfg.redisUrl,token:cfg.redisToken,retry:false,automaticDeserialization:false,signal:()=>AbortSignal.timeout(10000)}) : null);
    this.prefix='kas:'+createHash('sha256').update(cfg.sourceId).digest('hex').slice(0,24)+':';
  }
  key(name: string) {return this.prefix+name;}
  async read<T>(name: string,fallback: T): Promise<T> {
    if (!this.redis) return readJson(join(this.cfg.stateDir,name),fallback);
    const raw=await this.redis.get<string>(this.key(name));
    if (!raw) return fallback;
    const value=JSON.parse(raw),decipher=createDecipheriv('aes-256-gcm',Buffer.from(this.cfg.encryptionKey,'base64'),Buffer.from(value.iv,'base64'));
    decipher.setAAD(Buffer.from(this.key(name)));decipher.setAuthTag(Buffer.from(value.tag,'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8')) as T;
  }
  async write(name: string,value: unknown,ttl?: number) {
    if (!this.redis) return atomicJson(join(this.cfg.stateDir,name),value);
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(this.cfg.encryptionKey,'base64'),iv);
    cipher.setAAD(Buffer.from(this.key(name)));
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    const raw=JSON.stringify({iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
    if (ttl) await this.redis.set(this.key(name),raw,{ex:ttl});else await this.redis.set(this.key(name),raw);
  }
  async remove(name: string) {if (this.redis) await this.redis.del(this.key(name));}
  run<T>(operation:()=>Promise<T>): Promise<T> {
    return this.queue.run(async()=>{
      if (!this.redis) return operation();
      const key=this.key('operation-lock'),owner=randomBytes(32).toString('hex');
      if (await this.redis.set(key,owner,{nx:true,ex:600}) !== 'OK') throw new Error('Pembukuan sedang diproses. Tunggu sebentar lalu periksa kembali.');
      const lease={deadline:Date.now()+240000,uncertain:false};
      try {return await leaseContext.run(lease,operation);}
      finally {
        // A lost write response may still be executing at Google; retain the lease until expiry.
        if (!lease.uncertain) await this.redis.eval("if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",[key],[owner]);
      }
    });
  }
}
export async function acquireProcessLock(dir: string) {
  await mkdir(dir, {recursive:true,mode:0o700});
  const path = join(dir,'process');
  await writeFile(path,'single-process', {flag:'a',mode:0o600});
  // A second server using the same durable volume is refused, including after restart.
  return lockfile.lock(path, {stale:60000, update:10000, retries:0});
}
