const test = require('node:test');
const assert = require('node:assert/strict');
const {loadGas,tx} = require('./helpers.cjs');

test('Report month labels survive Indonesian date parsing as literal strings',() => {
  const {gas:g} = loadGas();
  const cells=Array.from({length:27},()=>Array(8).fill(''));
  cells[16][0]='Bulan'; cells[17][0]='Oktober 2026'; cells[19][0]='CATATAN LAPORAN';
  let parsedAsDate=0;
  function range(row,col,height=1,width=1) {
    if (typeof row==='string') {
      const match=row.match(/^([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
      return range(Number(match[2]),match[1].charCodeAt(0)-64,Number(match[4]||match[2])-Number(match[2])+1,(match[3]||match[1]).charCodeAt(0)-match[1].charCodeAt(0)+1);
    }
    const r={getDisplayValues:()=>Array.from({length:height},(_,i)=>cells[row-1+i].slice(col-1,col-1+width)),
      copyFormatToRange(){},breakApart:()=>r,merge:()=>r,
      clearContent(){for(let i=0;i<height;i++)for(let j=0;j<width;j++)cells[row-1+i][col-1+j]='';return r;},
      setValue(value){if(/^Oktober 2026$/.test(String(value))){value=46296;parsedAsDate++;}cells[row-1][col-1]=value;return r;},
      setValues(values){values.forEach((v,i)=>v.forEach((value,j)=>{cells[row-1+i][col-1+j]=value;}));return r;}};
    return r;
  }
  const summary={getRange:range,getMaxRows:()=>cells.length,getSheetId:()=>11,getName:()=> 'Laporan Arus Kas',isSheetHidden:()=>false};
  const income={getName:()=> 'Rincian Penerimaan Kas',isSheetHidden:()=>false},expense={getName:()=> 'Rincian Pengeluaran Kas',isSheetHidden:()=>false};
  const sheets=[summary,income,expense];
  g.SpreadsheetApp={openById:()=>({getSheets:()=>sheets,getSheetByName:name=>sheets.find(s=>s.getName()===name)}),flush(){}};
  g.cashWriteDetails_=()=>({});
  g.Sheets={Spreadsheets:{batchUpdate(body,id){
    assert.equal(id,'report_private');
    body.requests.forEach(request=>{
      const u=request.updateCells;
      u.rows.forEach((r,i)=>r.values.forEach((cell,j)=>{
        const v=cell.userEnteredValue;
        cells[u.range.startRowIndex+i][u.range.startColumnIndex+j]=v.stringValue ?? v.numberValue;
      }));
    });
  }}};
  const baseline={date:'2026-10-08',amount:1000,holders:{K1:800,K2:200,K3:0}};
  const report=g.cashNewPeriodReport_([tx('2026-10-09',125),tx('2026-10-10',25,'out')],baseline);
  g.cashWriteWorkbook_({reportId:'report_private'},report);
  assert.equal(cells[17][0],'Oktober 2026');
  assert.equal(cells[17][2],125); assert.equal(cells[17][4],25); assert.equal(cells[17][6],1100);
  assert.equal(parsedAsDate,0);
});
