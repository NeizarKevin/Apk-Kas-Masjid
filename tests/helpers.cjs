const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

function loadGas(initial = {}) {
  const properties = {...initial};
  const store = {
    getProperties: () => ({...properties}), getProperty: key => properties[key] ?? null,
    setProperty: (key,value) => { properties[key] = String(value); },
    setProperties: values => { Object.assign(properties,values); }
  };
  const context = vm.createContext({
    console, PropertiesService: {getScriptProperties: () => store},
    Utilities: {
      DigestAlgorithm: {SHA_256:'sha256',MD5:'md5'}, Charset: {UTF_8:'utf8'},
      base64Encode: bytes => Buffer.from(bytes.map(b => (b+256)%256)).toString('base64'),
      computeDigest: (algorithm,value) => Array.from(crypto.createHash(algorithm).update(typeof value === 'string' ? value : Buffer.from(value.map(b => (b+256)%256))).digest()),
      formatDate: date => new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)
    },
    Session: {getActiveUser: () => ({getEmail: () => 'owner@example.test'}),getEffectiveUser: () => ({getEmail: () => 'owner@example.test'})},
    LockService: {getScriptLock: () => ({waitLock(){},tryLock(){return true;},releaseLock(){}})}
  });
  ['Model.gs','Code.gs','Report.gs'].forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname,'..','apps-script',file),'utf8'),context,{filename:file}));
  context.cashToday_ = () => '2026-10-09';
  return {gas:context,properties};
}
function tx(date,amount,type='in',extra={}) {return {date,amount,type,fund:'MASJID',code:'K1',description:'Transaksi uji',...extra};}
function json(value) {return JSON.parse(JSON.stringify(value));}
function fakePdf(width=595.28,height=841.89,pages=3) {
  return Array.from(Buffer.from('%PDF-1.7\n' + Array.from({length:pages},(_,i) => `${i+1} 0 obj\n<< /Type /Page /MediaBox [0 0 ${width} ${height}] >>\nendobj\n`).join('') + ' '.repeat(1200) + '\n%%EOF'));
}
module.exports = {loadGas,tx,json,fakePdf};
