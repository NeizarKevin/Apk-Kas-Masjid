const test = require('node:test');
const assert = require('node:assert/strict');
const {loadGas, json} = require('./helpers.cjs');
const header = ['Tanggal','Kode','Keterangan','Pemasukan','Pengeluaran','Timestamp'];
const opening = {date:'2026-10-08',amount:1000,holders:{K1:800,K2:200,K3:0}};
function journal(rows, notes=[]) { return {id:20,title:'Apk Kas Masjid',journal:true,fund:'MASJID',rows:[header,...rows],notes:[[],...notes]}; }

test('A configured combined journal reads both flows while archived split tables stay excluded', () => {
  const {gas:g}=loadGas();
  const ledger=g.cashReadLedger_([
    journal([['2026-10-08','K1','Box before count',250,'',''],['2026-10-09','K1','Income',100,'',''],['2026-10-09','K2','Expense','',25,'']]),
    {id:1,title:'Archived income',fund:'MASJID_ARCHIVE',rows:[['Tanggal','Kode','Keterangan','Pemasukan'],['2026-10-09','K1','Income',100]]},
    {id:2,title:'Archived expense',fund:'MASJID_ARCHIVE',rows:[['Tanggal','Kode','Keterangan','Pengeluaran'],['2026-10-09','K2','Expense',25]]}
  ],'2026-05-01');
  assert.equal(ledger.transactions.length,3);
  assert.deepEqual(json(ledger.streams.map(s=>s.type)),['in','out']);
  const report=g.cashNewPeriodReport_(ledger.transactions,opening);
  assert.equal(report.income,100);assert.equal(report.expense,25);assert.equal(report.ending,1075);
  assert.equal(report.incomeCount,1);assert.equal(report.expenseCount,1);
});

test('Journal rejects both-filled, empty, negative and damaged headers; timestamp-only leftovers are not money', () => {
  const {gas:g}=loadGas();
  for (const amounts of [[100,25],['',''],[-100,'']])
    assert.throws(()=>g.cashReadLedger_([journal([['2026-10-09','K1','Entry',...amounts,'']])],'2026-05-01'));
  const empty=g.cashReadLedger_([journal([['','','','','','2026-05-15T00:00:00Z']])],'2026-05-01');
  assert.equal(empty.transactions.length,0);assert.equal(empty.streams.length,2);
  const bad=journal([]);bad.rows[0]=['Tanggal','Kode','Keterangan','Jumlah'];
  assert.throws(()=>g.cashReadLedger_([bad],'2026-05-01'),/Header jurnal/);
});

test('Migration retains same-day post-count identity and request id so retries cannot add it again', () => {
  const {gas:g}=loadGas();
  const meta={id:'11111111-1111-4111-8111-111111111111',fund:'MASJID',type:'in',date:'2026-10-08',code:'K1',description:'After count',amount:50,afterSync:true,checkpointKey:g.cashCheckpointKey_(opening),reportBaselineKey:g.cashCheckpointKey_(opening)};
  const ledger=g.cashReadLedger_([journal([['2026-10-08','K1','After count',50,'','2026-10-08T12:00:00Z']],[[g.CASH_NOTE_PREFIX_+JSON.stringify(meta)]])],'2026-05-01');
  assert.equal(g.cashNewPeriodReport_(ledger.transactions,opening).ending,1050);
  assert.equal(g.cashFindRequest_({ledger,phbiTransactions:[]},meta.id).id,meta.id);
  assert.throws(()=>g.cashReadLedger_([journal([['2026-10-09','K1','Same id',50,'',''],['2026-10-09','K1','Same id','',50,'']],[[g.CASH_NOTE_PREFIX_+JSON.stringify(meta)],[g.CASH_NOTE_PREFIX_+JSON.stringify(meta)]])],'2026-05-01'),/terulang/);
});

test('Source selects only the marked journal even when old split tabs still contain duplicate history', () => {
  const {gas:g}=loadGas();
  const phbi={id:3,title:'RAW PHBI',rows:[['Tanggal','Kode','Keterangan','Pemasukan','Pengeluaran','Sumber']]};
  const sync={id:4,title:'REKAP CHAT 2022-2026',rows:[['Tanggal','Dana','K1','K2','K3','Total'],['2026-10-08','Kas Masjid',800,200,0,1000],['2026-10-08','PHBI',300,'','',300]]};
  const inOld={id:1,title:'Income',rows:[['Tanggal','Kode','Keterangan','Pemasukan'],['2026-10-09','K1','Income',100]]};
  const outOld={id:2,title:'Expense',rows:[['Tanggal','Kode','Keterangan','Pengeluaran'],['2026-10-09','K1','Expense',25]]};
  const j=journal([['2026-10-09','K1','Income',100,'',''],['2026-10-09','K1','Expense','',25,'']]);
  const snapshots=[inOld,outOld,phbi,sync,j];
  const metadata={properties:{timeZone:'Asia/Jakarta'},sheets:snapshots.map(s=>({properties:{sheetId:s.id,title:s.title,sheetType:'GRID',gridProperties:{rowCount:20,columnCount:8}},developerMetadata:s.id===20?[{metadataKey:'KAS_JOURNAL',metadataValue:'MASJID'}]:[]}))};
  g.Sheets={Spreadsheets:{get:()=>metadata}};
  let selected;
  g.cashReadGrids_=(cfg,props,widths,onlyHeader)=>{
    if(!onlyHeader){selected=props.map(p=>p.sheetId);assert.equal(widths[20],6);}
    return props.map(p=>{const s=snapshots.find(s=>s.id===p.sheetId);return {...s,rows:onlyHeader?[s.rows[0]]:s.rows};});
  };
  const cfg={sourceId:'source_private',phbiId:3,syncId:4,journalId:null,startDate:'2026-05-01',opening:1000,mode:'NEW_PERIOD',baseline:opening,phbiBaseline:{date:'2026-10-08',amount:300,holders:{K1:300,K2:null,K3:null}},expectedStartDate:'2026-10-08',writeInId:1,writeOutId:2};
  const state=g.cashSource_(cfg);
  assert.deepEqual(json(selected),[3,4,20]);assert.equal(state.report.ending,1075);
  assert.equal(g.cashDestination_(state,'in').id,20);assert.equal(g.cashDestination_(state,'out').id,20);
  assert.equal(state.phbiTransactions.length,0);
  metadata.sheets[0].developerMetadata=[{metadataKey:'KAS_JOURNAL',metadataValue:'MASJID'}];
  assert.throws(()=>g.cashSource_(cfg),/Lebih dari satu jurnal/);
});

test('Cash flows use the next A:F journal row even when wallet formulas occupy rows farther down', () => {
  const {gas:g}=loadGas();let write;
  g.Sheets={Spreadsheets:{get:()=>({sheets:[{data:[{rowData:[{values:[]}]}]}]}),batchUpdate:p=>{write=p.requests.find(r=>r.updateCells||r.appendCells);}}};
  const state={cfg:{sourceId:'source_private',journalId:20,writeInId:1,writeOutId:2,phbiId:3},ledger:{streams:[{id:20,title:'Apk Kas Masjid',type:'in',journal:true},{id:20,title:'Apk Kas Masjid',type:'out',journal:true}]},grids:[journal([['2026-10-09','K1','Existing row',50,'','']])],metadata:{sheets:[{properties:{sheetId:20,gridProperties:{rowCount:1000,columnCount:26}}}]},checkpoints:{MASJID:opening,PHBI:{date:'2026-10-08',amount:300,holders:{K1:300,K2:null,K3:null}}},reportBaseline:opening};
  for(const type of ['in','out']) {
    const entry={id:'22222222-2222-4222-8222-222222222222',fund:'MASJID',type,code:'K1',date:'2026-10-09',description:'=literal description',amount:75};
    g.cashAppend_(state,entry);const cells=write.updateCells.rows[0].values;
    assert.equal(write.updateCells.range.sheetId,20);assert.equal(cells.length,6);
    assert.equal(write.updateCells.range.startRowIndex,2);
    assert.equal(cells[type==='in'?3:4].userEnteredValue.numberValue,75);
    assert.equal(cells[type==='in'?4:3].userEnteredValue.stringValue,'');
    assert.equal(cells[2].userEnteredValue.stringValue,'=literal description');
    assert.equal(cells[5].userEnteredValue.stringValue,g.cashMeta_(cells[0].note).createdAt);
  }
  state.phbi={title:'RAW PHBI'};state.grids.push({id:3,rows:[header]});state.phbiBaseline=state.checkpoints.PHBI;
  g.cashAppend_(state,{id:'33333333-3333-4333-8333-333333333333',fund:'PHBI',type:'out',code:'K1',date:'2026-10-09',description:'Separate PHBI',amount:25});
  assert.equal(write.appendCells.sheetId,3);assert.equal(write.appendCells.rows[0].values[4].userEnteredValue.numberValue,25);
});

test('A full journal grows its row grid before writing the next transaction in the same batch', () => {
  const {gas:g}=loadGas();let requests;
  g.Sheets={Spreadsheets:{get:()=>({sheets:[{data:[{rowData:[{values:[]}]}]}]}),batchUpdate:p=>{requests=p.requests;}}};
  const j=journal([['2026-10-09','K1','Existing row',50,'','']]);
  const state={cfg:{sourceId:'source_private',journalId:20},metadata:{sheets:[{properties:{sheetId:20,gridProperties:{rowCount:2}}}]},ledger:{streams:[{id:20,title:j.title,type:'out',journal:true}]},grids:[j],checkpoints:{MASJID:opening},reportBaseline:opening};
  g.cashAppend_(state,{id:'44444444-4444-4444-8444-444444444444',fund:'MASJID',type:'out',code:'K1',date:'2026-10-09',description:'New row',amount:25});
  assert.deepEqual(json(requests[0]),{appendDimension:{sheetId:20,dimension:'ROWS',length:1}});
  assert.equal(requests[1].updateCells.range.startRowIndex,2);
});
