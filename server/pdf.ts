import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PDFDocument} from 'pdf-lib';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {chromium} from 'playwright';
import * as m from './model.js';
import type {Report} from './types.js';

const normalized = (text: string) => text.normalize('NFKC').replace(/[\s\u200b]+/g,'').toLowerCase();
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function inspectPdf(bytes: Buffer, report: Report) {
  if (bytes.length < 1000 || bytes.subarray(0,5).toString() !== '%PDF-') throw new Error('Hasil ekspor bukan PDF.');
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() < 3 || pdf.getPageCount() > 200 || pdf.getPages().some(page => Math.abs(page.getWidth()-595.28)>3 || Math.abs(page.getHeight()-841.89)>3)) throw new Error('PDF wajib A4 portrait dengan tiga bagian lengkap.');
  Object.assign(globalThis,{DOMMatrix,ImageData,Path2D});
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({data:new Uint8Array(bytes),useSystemFonts:true,standardFontDataUrl:resolve('node_modules/pdfjs-dist/standard_fonts') + '/'});
  const document = await loading.promise;
  let text = '';
  const pages: {number:number;renderHash:string}[] = [];
  try {
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number), viewport = page.getViewport({scale:1});
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) {
          text += item.str + ' ';
          if (item.str.trim() && (item.transform[4] < -2 || item.transform[4] + item.width > viewport.width+2 || item.transform[5] < -2 || item.transform[5] > viewport.height+2)) throw new Error('Teks PDF melewati tepi halaman.');
        }
      }
      const canvas = createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));
      await page.render({canvasContext:canvas.getContext('2d') as any,viewport,canvas:canvas as any}).promise;
      pages.push({number,renderHash:createHash('sha256').update(canvas.toBuffer('image/png')).digest('hex')});
      page.cleanup();
    }
    const actual = normalized(text);
    const amounts = [report.opening,report.income,report.expense,report.ending,...report.incoming.concat(report.outgoing).map(tx => tx.amount)];
    const expected = ['LAPORAN ARUS KAS','RINCIAN PENERIMAAN KAS','RINCIAN PENGELUARAN KAS',m.cashDateLabel_(report.startDate),m.cashDateLabel_(report.latest),...report.months.map(month => month.label),...report.incoming.concat(report.outgoing).map(tx => tx.description),...amounts.map(value => Math.abs(value).toLocaleString('id-ID'))];
    if (expected.some(value => !actual.includes(normalized(value)))) throw new Error('Isi PDF tidak lengkap atau tidak sama dengan laporan.');
    return {pageCount:document.numPages,pages};
  } finally {await loading.destroy();}
}
export function demoReportHtml(report: Report) {
  const period = m.cashDateLabel_(report.startDate) + ' - ' + m.cashDateLabel_(report.latest);
  const details = (type: 'in' | 'out') => `<section><h1>RINCIAN ${type === 'in' ? 'PENERIMAAN' : 'PENGELUARAN'} KAS</h1><p>Masjid Al-Barokah Taskombang - Periode ${period}</p><table><thead><tr><th>Tanggal</th><th>Keterangan</th><th>Jumlah (Rp)</th></tr></thead><tbody>${m.cashDetailRows_(report,type).map((row: {kind:string;values:(string | number)[]}) => `<tr class="${row.kind}">${row.values.map(value => `<td>${escape(typeof value === 'number' ? m.cashRupiah_(value) : value)}</td>`).join('')}</tr>`).join('')}</tbody></table></section>`;
  return `<!doctype html><html lang="id"><meta charset="utf-8"><style>@page{size:A4 portrait;margin:14mm}body{font:11px Arial;color:#14251b}h1{font-size:20px;text-align:center}p{line-height:1.7;text-align:center}section+section{break-before:page}table{width:100%;border-collapse:collapse;table-layout:fixed}td,th{padding:9px;border-bottom:1px solid #d5dfd7;overflow-wrap:anywhere}td:last-child,th:last-child{text-align:right;width:25%}td:first-child{width:25%}thead{display:table-header-group;background:#e0ede2}tr{break-inside:avoid}.month{background:#eaf4ea;font-weight:bold}.subtotal{background:#f4f4f4;font-weight:bold}.total{background:#235435;color:white;font-weight:bold}.bar{background:#235435;color:#fff;padding:12px}.note{margin-top:24px;text-align:left}</style><section><h1>LAPORAN ARUS KAS</h1><h1>MASJID AL-BAROKAH TASKOMBANG</h1><p>Periode ${period}</p><p class="bar">STATEMENT OF CASH FLOWS</p><table>${[['Saldo kas awal setelah sinkronisasi ' + m.cashDateLabel_(report.startDate),report.opening],['Penerimaan kas',report.income],['Pengeluaran kas',-report.expense],['Perubahan bersih kas',report.net],['Saldo kas akhir',report.ending]].map(([label,amount])=>`<tr><td colspan="2">${escape(label!)}</td><td>${m.cashRupiah_(amount)}</td></tr>`).join('')}</table><h2>Pergerakan kas bulanan</h2><table><thead><tr><th>Bulan</th><th>Penerimaan</th><th>Pengeluaran</th><th>Saldo akhir</th></tr></thead><tbody>${report.months.map(month=>`<tr><td>${month.label}</td><td>${m.cashRupiah_(month.income)}</td><td>${m.cashRupiah_(month.expense)}</td><td>${m.cashRupiah_(month.ending)}</td></tr>`).join('')}</tbody></table><p class="note">CATATAN LAPORAN<br>Data sintetis untuk pengujian aplikasi. Saldo awal dibekukan setelah hitung fisik; penerimaan sebelum sinkronisasi sudah termasuk pembukaan.</p></section>${details('in')}${details('out')}</html>`;
}
export async function renderDemoPdf(report: Report) {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.setContent(demoReportHtml(report));
    return await page.pdf({format:'A4',printBackground:true,preferCSSPageSize:true});
  } finally {await browser.close();}
}
