const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const vm=require('node:vm');
const source=readFileSync(join(__dirname,'../../public/index.html'),'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
const context=vm.createContext({});vm.runInContext(source.slice(0,source.indexOf('function initRecognition')),context);
const parse=text=>context.parseVoiceText(text,'2026-10-15');

test('Voice Rupiah parses complete compounds, decimal scales and formatted integers',()=>{
  for(const [words,expected] of [['satu juta lima ratus ribu',1500000],['enam ratus tiga puluh tujuh ribu enam ratus',637600],['1,5 juta',1500000],['1.25 juta',1250000],['1.250.000',1250000],['2 jt 350 rb',2350000],['satu setengah juta',1500000],['setengah juta',500000],['dua miliar lima ratus juta',2500000000],['seribu lima ratus',1500],['lima ratus rupiah',500],['100rb',100000],['125000',125000]]){
    const result=parse('Pemasukan infaq Jumat '+words);assert.equal(result.jumlah,expected,words);assert.equal(result.keterangan,'Infaq Jumat',words);assert.equal(result.issues.length,0,words);
  }
});
test('Voice keeps item counts and meaningful descriptions separate from money',()=>{
  let result=parse('K3 beli 3 lampu sebesar 150 ribu tanggal 10 Oktober 2026');assert.equal(result.jumlah,150000);assert.equal(result.keterangan,'Beli 3 lampu');assert.equal(result.kode,'K3');assert.equal(result.tanggal,'2026-10-10');assert.equal(result.tipe,'out');
  result=parse('Beli 3 lampu');assert.equal(result.jumlah,null);assert.match(result.keterangan,/3 lampu/);
  result=parse('Donasi dari Kevin 100 ribu');assert.equal(result.kode,null);assert.equal(result.keterangan,'Donasi dari Kevin');
});
test('Ambiguous, negative, fractional Rupiah and unsafe numbers never become a plausible partial amount',()=>{
  for(const words of ['100 ribu dan 200 ribu','dua juta lima ratus','-50000','25,50','9007199254740992','1,250','seratus dua ratus ribu']){
    const result=parse('Pengeluaran listrik sebesar '+words);assert.equal(result.jumlah,null,words);assert.ok(result.issues.length,words);
  }
});
test('Voice dates use the supplied Jakarta calendar and validate explicit dates',()=>{
  for(const [words,date] of [['kemarin','2026-10-14'],['hari ini','2026-10-15'],['tanggal sepuluh Oktober 2026','2026-10-10'],['tanggal dua belas','2026-10-12'],['10/10/2026','2026-10-10'],['2026-10-09','2026-10-09']]){
    const result=parse('Infaq 50 ribu '+words);assert.equal(result.tanggal,date,words);assert.equal(result.jumlah,50000,words);assert.equal(result.issues.length,0,words);
  }
  assert.ok(parse('Infaq 50 ribu tanggal 31 Februari 2026').issues.length);
  assert.ok(parse('Infaq 50 ribu besok').issues.length);
  assert.ok(parse('Infaq 50 ribu kemarin tanggal 10 Oktober 2026').issues.length);
  let result=parse('Infaq 50 ribu tanggal sepuluh Oktober dua ribu dua puluh enam');assert.equal(result.tanggal,'2026-10-10');assert.equal(result.jumlah,50000);assert.equal(result.issues.length,0);
  result=parse('Infaq tanggal sepuluh Oktober dua ribu dua puluh enam');assert.equal(result.jumlah,null);assert.equal(result.tanggal,'2026-10-10');
  assert.ok(parse('Infaq 50 ribu tanggal salah').issues.length);
});
test('Voice recognizes explicit fund and holder while refusing conflicting metadata',()=>{
  for(const [words,code] of [['ka satu','K1'],['K 2','K2'],['kode tiga','K3'],['bendahara Kevin','K1'],['bendahara Arum','K2'],['bendahara Ming Ming','K2'],['bendahara Wawan','K3']])assert.equal(parse(words+' infaq 100 ribu').kode,code,words);
  assert.equal(parse('Pengeluaran PHBI konsumsi 250 ribu bendahara Wawan').dana,'PHBI');
  assert.equal(parse('Pengeluaran PHBI konsumsi 250 ribu bendahara Wawan').tipe,'out');
  assert.equal(parse('Pemasukan kas masjid infaq 100 ribu').dana,'MASJID');
  assert.equal(parse('Pemasukan dana masjid infaq 100 ribu').dana,'MASJID');
  assert.equal(parse('Pengeluaran kas PHBI konsumsi 100 ribu').keterangan,'Konsumsi');
  for(const text of ['K1 K2 infaq 100 ribu','Pemasukan pengeluaran 100 ribu','Dana PHBI kas masjid 100 ribu'])assert.ok(parse(text).issues.length,text);
  assert.equal(parse('Catatan kegiatan 100 ribu').tipe,null);
});
