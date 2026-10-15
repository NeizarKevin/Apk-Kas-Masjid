const {test}=require('node:test');
const assert=require('node:assert/strict');
test('New PDF gates reject non-PDF, non-A4 and incomplete rendered reports',async()=>{
  const {inspectPdf}=await import('../../dist/pdf.js'),{PDFDocument}=await import('pdf-lib');
  await assert.rejects(inspectPdf(Buffer.from('<html>failed</html>'),{}),/bukan PDF/);
  const letter=await PDFDocument.create();for(let i=0;i<3;i++)letter.addPage([612,792]);
  await assert.rejects(inspectPdf(Buffer.from(await letter.save({useObjectStreams:false})),{}),/A4/);
  const empty=await PDFDocument.create();for(let i=0;i<3;i++)empty.addPage([595.28,841.89]);
  const report={opening:100,income:0,expense:0,ending:100,startDate:'2026-10-08',latest:'2026-10-08',incoming:[],outgoing:[],months:[{label:'Oktober 2026'}]};
  const bytes=Buffer.from(await empty.save({useObjectStreams:false}));
  // Padding does not make a blank PDF a complete cash report.
  await assert.rejects(inspectPdf(Buffer.concat([bytes,Buffer.alloc(1000,32)]),report),/tidak lengkap/);
});

test('PDF amounts must be complete numbers; 1.500.000 cannot stand in for 500.000',async()=>{
  const {inspectPdf}=await import('../../dist/pdf.js'),{PDFDocument}=await import('pdf-lib'),m=await import('../../dist/model.js');
  const report=m.cashNewPeriodReport_([{fund:'MASJID',date:'2026-10-09',type:'in',description:'Infaq',amount:500000},{fund:'MASJID',date:'2026-10-10',type:'out',description:'Listrik',amount:50000}],{date:'2026-10-08',amount:1000000,holders:{K1:1000000,K2:0,K3:0}});
  const bytes=async wrong=>{
    const pdf=await PDFDocument.create();
    const pages=[['LAPORAN ARUS KAS','08 Oktober 2026 - 10 Oktober 2026','Oktober 2026','Rp1.000.000',wrong?'Rp1.500.000':'Rp500.000',wrong?'Rp1.050.000':'Rp50.000','Rp1.450.000'],['RINCIAN PENERIMAAN KAS','Infaq',wrong?'Rp1.500.000':'Rp500.000'],['RINCIAN PENGELUARAN KAS','Listrik',wrong?'Rp1.050.000':'Rp50.000']];
    for(const lines of pages){const page=pdf.addPage([595.28,841.89]);lines.forEach((text,i)=>page.drawText(text,{x:40,y:780-i*30,size:12}));}
    return Buffer.from(await pdf.save({useObjectStreams:false}));
  };
  assert.equal((await inspectPdf(await bytes(false),report)).pageCount,3);
  await assert.rejects(inspectPdf(await bytes(true),report),/tidak lengkap|tidak sama/);
});
