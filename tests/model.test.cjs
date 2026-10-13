const test = require('node:test');
const assert = require('node:assert/strict');
const {loadGas,tx,json} = require('./helpers.cjs');

test('Rupiah and dates accept Indonesian formatting and reject invalid or unsafe values',() => {
  const {gas:g} = loadGas();
  assert.equal(g.cashMoney_('Rp637.600',false),637600);
  assert.equal(g.cashMoney_('1.000,00',false),1000);
  [0,-1,1.5,Number.MAX_SAFE_INTEGER+1,'1,50','=100','1.00'].forEach(value => assert.throws(() => g.cashMoney_(value,false)));
  assert.equal(g.cashIso_(g.cashSerial_('2026-10-08')),'2026-10-08');
  assert.equal(g.cashIso_('08/10/2026'),'2026-10-08');
  assert.equal(g.cashIso_(new Date('2026-10-08T18:00:00Z'),'Asia/Jakarta'),'2026-10-09');
  ['2026-02-30','2026-13-01','8/10/26'].forEach(value => assert.throws(() => g.cashIso_(value)));
});
test('Only split transaction headers count; raw and combined histories are excluded',() => {
  const {gas:g} = loadGas();
  assert.equal(g.cashStream_(['Tanggal','Kode','Keterangan','Pemasukan']),'in');
  assert.equal(g.cashStream_(['Tanggal','Kode','Keterangan','Pengeluaran','','']),'out');
  ['Sumber','Timestamp','Total ALL'].forEach(last => assert.equal(g.cashStream_(['Tanggal','Kode','Keterangan','Pemasukan','Pengeluaran',last]),null));
});
test('New period names are discovered by header and real repeated transactions are preserved',() => {
  const {gas:g} = loadGas();
  const ledger = g.cashReadLedger_([
    {id:1,title:'Periode lama',rows:[['Tanggal','Kode','Keterangan','Pemasukan'],['2026-05-01','K1','Infaq',100],['2026-05-01','K1','Infaq',100]]},
    {id:2,title:'PEMASUKAN OKT-DES 26',rows:[['Tanggal','Kode','Keterangan','Pemasukan'],['2026-10-09','K2','Infaq',200]]},
    {id:3,title:'Biaya rutin',rows:[['Tanggal','Kode','Keterangan','Pengeluaran'],['2026-05-02','K3','Lampu',40]]}
  ],'2026-05-01','Asia/Jakarta');
  const report = g.cashBuildReport_(ledger.transactions,1000,'2026-05-01');
  assert.equal(report.income,400); assert.equal(report.expense,40); assert.equal(report.ending,1360);
  assert.equal(report.incomeCount,3); assert.equal(report.months.length,6);
  assert.deepEqual(json(report.months[1]),{key:'2026-06',label:'Juni 2026',income:0,expense:0,ending:1160});
});
test('Overlapping period tabs and duplicated app IDs fail without deduplicating legitimate income',() => {
  const {gas:g} = loadGas();
  const input = {id:1,title:'Masuk A',rows:[['Tanggal','Kode','Keterangan','Pemasukan'],['2026-05-01','K1','Infaq',100]]};
  const expense = {id:3,title:'Keluar',rows:[['Tanggal','Kode','Keterangan','Pengeluaran']]};
  assert.throws(() => g.cashReadLedger_([input,{...input,id:2,title:'Salinan'},expense],'2026-05-01'),/bertumpuk/);
  const note = g.CASH_NOTE_PREFIX_ + JSON.stringify({id:'request'});
  assert.throws(() => g.cashReadLedger_([{...input,rows:[...input.rows,input.rows[1]],notes:[[],[note],[note]]},expense],'2026-05-01'),/ID transaksi aplikasi terulang/);
});
test('Known cash-count memo is excluded, but other malformed rows block reconciliation',() => {
  const {gas:g} = loadGas();
  const inTab = {id:1,title:'Masuk',rows:[['Tanggal','Kode','Keterangan','Pemasukan']]};
  const outTab = {id:2,title:'Keluar',rows:[['Tanggal','Kode','Keterangan','Pengeluaran'],['2026-05-01','K1','Belanja',25],[],['','Kas real K1 14 Sep 26','',''],['',1000,'','']]};
  assert.equal(g.cashReadLedger_([inTab,outTab],'2026-05-01').transactions.length,1);
  assert.throws(() => g.cashReadLedger_([inTab,{...outTab,rows:[...outTab.rows,['','tak dikenal','','']]}],'2026-05-01'),/Keluar!A6:D6/);
});
test('Checkpoint includes pre-sync boxes once and recognizes new same-day app entries',() => {
  const {gas:g} = loadGas();
  const checkpoint = {date:'2026-10-08',amount:1100,holders:{K1:900,K2:200,K3:0}};
  const all = [tx('2026-10-08',100),tx('2026-10-08',50,'in',{meta:{afterSync:true,checkpointKey:g.cashCheckpointKey_(checkpoint)}}),tx('2026-10-09',20,'out')];
  const report = g.cashBuildReport_(all,1000,'2026-05-01');
  assert.equal(g.cashReconcileCheckpoint_(report,all,checkpoint).ok,true);
  const after = all.filter(row => g.cashIsAfterCheckpoint_(row,checkpoint));
  assert.equal(checkpoint.amount + after.reduce((s,row) => s + (row.type==='in'?row.amount:-row.amount),0),1130);
  const nextCount = {...checkpoint,amount:1150,holders:{K1:950,K2:200,K3:0}};
  assert.equal(g.cashIsAfterCheckpoint_(all[1],nextCount),false);
});
test('Physical mismatch is reported as a difference and never invented as income',() => {
  const {gas:g} = loadGas();
  const all = [tx('2026-05-01',100)]; const report = g.cashBuildReport_(all,1000,'2026-05-01');
  const result = g.cashReconcileCheckpoint_(report,all,{date:'2026-10-08',amount:1200,holders:{K1:1200,K2:0,K3:0}});
  assert.deepEqual(json(result),{ok:false,date:'2026-10-08',book:1100,actual:1200,difference:100});
  assert.equal(report.income,100);
});
test('Input requires a responsible holder, known fund, valid UUID, and dates after synchronization',() => {
  const {gas:g} = loadGas();
  const valid = {id:'11111111-1111-4111-a111-111111111111',fund:'MASJID',type:'in',code:'K1',date:'2026-10-09',description:' Infaq ',amount:100};
  const checkpoint = {date:'2026-10-08'};
  assert.equal(g.cashValidateInput_(valid,'2026-10-09',checkpoint).description,'Infaq');
  [{id:'-'.repeat(36)},{fund:'OTHER'},{code:''},{date:'2026-10-10'},{date:'2026-10-07'},{amount:0},{description:''}].forEach(change => assert.throws(() => g.cashValidateInput_({...valid,...change},'2026-10-09',checkpoint)));
});
test('Public report excludes codes and PHBI, with matching detail subtotals',() => {
  const {gas:g} = loadGas();
  const all = [tx('2026-05-01',100),tx('2026-05-02',20,'out'),tx('2026-05-01',900,'in',{fund:'PHBI'})];
  const report = g.cashBuildReport_(all,1000,'2026-05-01');
  const changed = g.cashBuildReport_(all.map(row => ({...row,code:'K3'})),1000,'2026-05-01');
  assert.equal(g.cashReportSignature_(report),g.cashReportSignature_(changed));
  assert.equal(report.income,100); assert.equal(report.expense,20);
  const rows = json(g.cashDetailRows_(report,'in'));
  assert.equal(rows.filter(row => row.kind === 'subtotal')[0].values[2],100);
  assert.equal(rows.at(-1).values[2],100); assert.equal(JSON.stringify(rows).includes('K1'),false);
});
