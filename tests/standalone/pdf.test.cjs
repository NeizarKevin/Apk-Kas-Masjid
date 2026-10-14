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
