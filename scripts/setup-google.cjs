const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline/promises');

async function main() {
  const prompt=readline.createInterface({input:process.stdin,output:process.stdout});
  try {
    const path=process.argv[2] || await prompt.question('Lokasi file JSON OAuth Client (Web application): ');
    const client=JSON.parse(fs.readFileSync(path.trim().replace(/^"|"$/g,''),'utf8')).web;
    if (!client?.client_id || !client.client_secret) throw new Error('Gunakan OAuth Client bertipe Web application.');
    let text=fs.existsSync('.env') ? fs.readFileSync('.env','utf8') : fs.readFileSync('.env.example','utf8');
    const origin=text.match(/^APP_ORIGIN=(.+)$/m)?.[1].replace(/^['"]|['"]$/g,'') || 'http://localhost:3000';
    if (!client.redirect_uris?.includes(origin + '/auth/callback')) throw new Error('Tambahkan redirect URI ' + origin + '/auth/callback pada OAuth Client lalu download JSON lagi.');
    const set=(name,value)=>{
      if (/[\r\n']/.test(value)) throw new Error('Format konfigurasi tidak valid.');
      const line=name + "='" + value + "'";
      text=new RegExp('^'+name+'=.*$','m').test(text) ? text.replace(new RegExp('^'+name+'=.*$','m'),()=>line) : text + '\n' + line + '\n';
    };
    set('GOOGLE_CLIENT_ID',client.client_id);set('GOOGLE_CLIENT_SECRET',client.client_secret);
    if (/^TOKEN_ENCRYPTION_KEY=replace_/m.test(text)) set('TOKEN_ENCRYPTION_KEY',crypto.randomBytes(32).toString('base64'));
    const temp='.env.setup.tmp';fs.writeFileSync(temp,text,{mode:0o600});fs.renameSync(temp,'.env');
    console.log('Konfigurasi OAuth disimpan privat di .env. Isi target asli dan saldo pembukaan bila belum ada, lalu npm start dan Masuk dengan Google.');
  } finally {prompt.close();}
}
main().catch(()=>{console.error('Konfigurasi gagal. Periksa file JSON Web OAuth dan redirect URI; secret tidak dicetak.');process.exitCode=1;});
