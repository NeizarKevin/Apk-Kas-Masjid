import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
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
export async function acquireProcessLock(dir: string) {
  await mkdir(dir, {recursive:true,mode:0o700});
  const path = join(dir,'process');
  await writeFile(path,'single-process', {flag:'a',mode:0o600});
  // A second server using the same durable volume is refused, including after restart.
  return lockfile.lock(path, {stale:60000, update:10000, retries:0});
}
