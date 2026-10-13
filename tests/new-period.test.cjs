const test = require('node:test');
const assert = require('node:assert/strict');
const {loadGas,tx,json} = require('./helpers.cjs');
const baseline = {date:'2026-10-08',amount:1000,holders:{K1:800,K2:200,K3:0}};

test('A new period starts at counted cash and does not convert a historical difference into income',() => {
  const {gas:g}=loadGas();
  const all=[tx('2026-05-01',100),tx('2026-05-02',20,'out'),tx('2026-10-08',250)];
  const before=JSON.stringify(all), report=g.cashNewPeriodReport_(all,baseline);
  assert.equal(report.opening,1000); assert.equal(report.income,0); assert.equal(report.expense,0);
  assert.equal(report.ending,1000); assert.equal(report.startDate,'2026-10-08');
  assert.equal(report.incomeCount,0); assert.equal(report.expenseCount,0);
  assert.equal(JSON.stringify(all),before);
  assert.equal(g.cashReconcileCheckpoint_(report,report.incoming.concat(report.outgoing),baseline).ok,true);
});
test('Same-day post-count receipts are included once; pre-count boxes remain in the archive',() => {
  const {gas:g}=loadGas();
  const all=[tx('2026-10-08',250),tx('2026-10-08',50,'in',{meta:{afterSync:true,checkpointKey:g.cashCheckpointKey_(baseline)}}),tx('2026-10-09',25,'out')];
  const report=g.cashNewPeriodReport_(all,baseline);
  assert.equal(report.income,50); assert.equal(report.expense,25); assert.equal(report.ending,1025);
  assert.equal(report.incomeCount,1); assert.equal(report.expenseCount,1);
  assert.equal(report.latest,'2026-10-09');
});
test('Later counts validate against the frozen opening instead of silently resetting it again',() => {
  const {gas:g}=loadGas();
  const report=g.cashNewPeriodReport_([tx('2026-10-09',100),tx('2026-10-10',25,'out')],baseline);
  const current={date:'2026-10-10',amount:1075,holders:{K1:875,K2:200,K3:0}};
  assert.equal(report.opening,1000);
  assert.equal(g.cashReconcileCheckpoint_(report,report.incoming.concat(report.outgoing),current).ok,true);
  const mismatch=g.cashReconcileCheckpoint_(report,report.incoming.concat(report.outgoing),{...current,amount:1090});
  assert.equal(mismatch.ok,false); assert.equal(mismatch.difference,15);
});
test('Empty periods keep month, zero subtotal and total sections for future template reuse',() => {
  const {gas:g}=loadGas(); const report=g.cashNewPeriodReport_([],baseline);
  for (const type of ['in','out']) {
    const rows=json(g.cashDetailRows_(report,type));
    assert.deepEqual(rows.map(row => row.kind),['month','empty','subtotal','blank','total']);
    assert.equal(rows[2].values[2],0); assert.equal(rows.at(-1).values[2],0);
    assert.equal(JSON.stringify(rows).includes('K1'),false);
  }
});
test('A second count on opening day does not hide later transactions from the fixed report period',() => {
  const {gas:g}=loadGas();
  const second={date:baseline.date,amount:1050,holders:{K1:850,K2:200,K3:0}};
  const all=[tx(baseline.date,50,'in',{meta:{afterSync:true,checkpointKey:g.cashCheckpointKey_(baseline)}}),
    tx(baseline.date,30,'in',{meta:{afterSync:true,checkpointKey:g.cashCheckpointKey_(second),reportBaselineKey:g.cashCheckpointKey_(baseline)}})];
  const report=g.cashNewPeriodReport_(all,baseline);
  assert.equal(report.income,80); assert.equal(report.ending,1080); assert.equal(report.incomeCount,2);
  assert.equal(g.cashReconcileCheckpoint_(report,report.incoming.concat(report.outgoing),second).ok,true);
});
test('Fresh configuration uses the new period, validates its baseline and preserves optional historical mode',() => {
  const settings={SOURCE_SPREADSHEET_ID:'source_private',REPORT_SPREADSHEET_ID:'report_private',PUBLIC_PDF_ID:'same_public_pdf',REPORT_BASELINE:JSON.stringify(baseline)};
  assert.equal(loadGas(settings).gas.cashConfig_().mode,'NEW_PERIOD');
  assert.deepEqual(json(loadGas(settings).gas.cashConfig_().baseline),baseline);
  assert.equal(loadGas({...settings,REPORT_MODE:'HISTORICAL'}).gas.cashConfig_().mode,'HISTORICAL');
  assert.throws(() => loadGas({...settings,REPORT_BASELINE:JSON.stringify({...baseline,amount:1010})}).gas.cashConfig_(),/saldo awal/);
});
