function cashPublishLocked_() {
  var cfg = cashConfig_(), state = cashSource_(cfg), report = state.report;
  if (report.latest > cashToday_()) throw new Error('Ada transaksi bertanggal setelah hari ini. Periksa tanggal sumber sebelum menerbitkan.');
  if (!state.reconciliation.ok)
    return cashStatus_({state: 'BLOCKED',
      message: 'PDF ditahan: saldo buku pada sinkronisasi berbeda dari kas fisik ' +
        cashRupiah_(state.reconciliation.difference) + '. Cocokkan transaksi sebelum menerbitkan.',
      reconciliation: state.reconciliation});
  var props = PropertiesService.getScriptProperties(), signature = cashSha_(cashReportSignature_(report));
  if (signature === props.getProperty('LAST_PUBLISHED_HASH'))
    return cashStatus_({state: 'UNCHANGED', message: 'Belum ada perubahan laporan sejak pembaruan terakhir.',
      updatedAt: props.getProperty('LAST_PUBLISHED_AT'), latest: report.latest});
  var target = Drive.Files.get(cfg.pdfId, {
    fields: 'id,mimeType,modifiedTime,capabilities(canEdit)', supportsAllDrives: true});
  if (target.id !== cfg.pdfId || target.mimeType !== 'application/pdf' ||
      !target.capabilities || !target.capabilities.canEdit)
    throw new Error('Target PDF lama tidak dapat diperbarui oleh akun ini.');
  var layout = cashWriteWorkbook_(cfg, report);
  cashVerifyWorkbook_(cfg, report, layout);
  var blob = cashExportPdf_(cfg);
  cashVerifyPdfBytes_(blob.getBytes());
  // Manual edits do not respect ScriptLock, so re-read the source before replacing the PDF.
  var finalState = cashSource_(cfg);
  if (!finalState.reconciliation.ok ||
      cashSha_(cashReportSignature_(finalState.report)) !== signature)
    throw new Error('Data sumber berubah saat PDF diproses. PDF lama dipertahankan; pemeriksaan berikutnya akan mengulang.');
  var updated = Drive.Files.update({mimeType: 'application/pdf'}, cfg.pdfId, blob, {
    fields: 'id,mimeType,size,modifiedTime,md5Checksum,webViewLink', supportsAllDrives: true});
  var readback = Drive.Files.get(cfg.pdfId, {
    fields: 'id,mimeType,size,modifiedTime,md5Checksum,webViewLink', supportsAllDrives: true});
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes())
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  if (updated.id !== cfg.pdfId || readback.id !== cfg.pdfId ||
      readback.mimeType !== 'application/pdf' || Number(readback.size) !== blob.getBytes().length ||
      readback.md5Checksum !== digest || readback.modifiedTime === target.modifiedTime)
    throw new Error('Upload selesai tetapi verifikasi PDF gagal. Periksa versi Drive sebelum menyatakan selesai.');
  var timestamp = new Date().toISOString();
  props.setProperties({LAST_PUBLISHED_HASH: signature, LAST_PUBLISHED_AT: timestamp, REPORT_DIRTY: 'false'});
  return cashStatus_({state: 'PUBLISHED', message: 'Laporan kas publik berhasil diperbarui.',
    updatedAt: timestamp, latest: report.latest, income: report.income, expense: report.expense,
    net: report.net, ending: report.ending, incomeCount: report.incomeCount,
    expenseCount: report.expenseCount, pdfUrl: readback.webViewLink || null});
}
function cashWriteWorkbook_(cfg, report) {
  var book = SpreadsheetApp.openById(cfg.reportId);
  var names = ['Laporan Arus Kas', 'Rincian Penerimaan Kas', 'Rincian Pengeluaran Kas'];
  var visible = book.getSheets().filter(function (s) { return !s.isSheetHidden(); });
  if (visible.length !== names.length || visible.some(function (s) { return names.indexOf(s.getName()) < 0; }))
    throw new Error('Workbook publik harus hanya menampilkan tiga tab laporan yang disetujui.');
  var summary = book.getSheetByName(names[0]);
  var labels = summary.getRange(1, 1, summary.getMaxRows(), 1).getDisplayValues().map(function (r) { return r[0]; });
  var headerIndex = labels.indexOf('Bulan'), noteIndex = labels.indexOf('CATATAN LAPORAN');
  if (headerIndex < 0 || noteIndex <= headerIndex + 1)
    throw new Error('Struktur ringkasan template berubah.');
  var first = headerIndex + 2, count = 0;
  while (/^\S+\s+\d{4}$/.test(labels[first - 1 + count] || '')) count++;
  if (!count) throw new Error('Contoh baris pergerakan kas bulanan tidak ditemukan.');
  var delta = report.months.length - count;
  if (delta > 0) summary.insertRowsBefore(first + count, delta);
  else if (delta < 0) summary.deleteRows(first + report.months.length, -delta);
  summary.getRange(first, 1, 1, 8).copyFormatToRange(summary, 1, 8, first, first + report.months.length - 1);
  var area = summary.getRange(first, 1, report.months.length, 8);
  area.breakApart().clearContent();
  report.months.forEach(function (month, i) {
    var row = first + i;
    [1, 3, 5, 7].forEach(function (column) { summary.getRange(row, column, 1, 2).merge(); });
    summary.getRange(row, 3).setValue(month.income);
    summary.getRange(row, 5).setValue(month.expense);
    summary.getRange(row, 7).setValue(month.ending);
  });
  SpreadsheetApp.flush();
  // SpreadsheetApp parses "Oktober 2026" as a date in an Indonesian workbook.
  // Write labels as typed strings so the readback sees the literal month name.
  Sheets.Spreadsheets.batchUpdate({requests: report.months.map(function (month, i) {
    return {updateCells: {range: {sheetId: summary.getSheetId(), startRowIndex: first + i - 1,
      endRowIndex: first + i, startColumnIndex: 0, endColumnIndex: 1},
      rows: [{values: [{userEnteredValue: {stringValue: month.label}}]}], fields: 'userEnteredValue'}};
  })}, cfg.reportId);
  var period = cashDateLabel_(report.startDate) + ' - ' + cashDateLabel_(report.latest);
  summary.getRange('A3').setValue('Periode ' + period);
  summary.getRange('A8').setValue(report.mode === 'NEW_PERIOD' ?
    'Saldo kas awal setelah sinkronisasi ' + cashDateLabel_(report.openingDate) : 'Saldo kas awal per 30 April 2026');
  summary.getRange('G8:G12').setValues([[report.opening], [report.income], [-report.expense], [report.net], [report.ending]]);
  summary.getRange('A11').setValue(report.net < 0 ? 'Penurunan bersih kas' : 'Kenaikan bersih kas');
  summary.getRange('A12').setValue('Saldo kas akhir per ' + cashDateLabel_(report.latest));
  summary.getRange(noteIndex + delta + 2, 1).setValue(
    report.mode === 'NEW_PERIOD' ?
      'Periode baru dimulai dari hasil hitung fisik kas masjid setelah sinkronisasi ' + cashDateLabel_(report.openingDate) +
      ' sebesar ' + cashRupiah_(report.opening) + '. Infaq yang dibuka sebelum sinkronisasi sudah termasuk saldo awal. ' +
      'Histori sebelumnya tetap tersimpan dalam pembukuan. Dana PHBI dicatat terpisah.' :
      'Saldo awal mengacu pada saldo kas per 30 April 2026 sebesar ' + cashRupiah_(report.opening) +
      '. Penerimaan dan pengeluaran dihitung ulang dari pembukuan kas masjid. Dana PHBI dicatat terpisah.');
  var incomeLayout = cashWriteDetails_(cfg, book.getSheetByName(names[1]), report, 'in', period);
  var expenseLayout = cashWriteDetails_(cfg, book.getSheetByName(names[2]), report, 'out', period);
  SpreadsheetApp.flush();
  return {summaryId: summary.getSheetId(), summaryFirst: first, summaryCount: report.months.length,
    income: incomeLayout, expense: expenseLayout};
}
function cashCaptureStyle_(range) {
  return {backgrounds: range.getBackgrounds(), fonts: range.getFontFamilies(),
    sizes: range.getFontSizes(), colors: range.getFontColors(), weights: range.getFontWeights(),
    align: range.getHorizontalAlignments(), vertical: range.getVerticalAlignments(),
    numbers: range.getNumberFormats()};
}
function cashApplyStyle_(range, s) {
  range.setBackgrounds(s.backgrounds).setFontFamilies(s.fonts).setFontSizes(s.sizes)
    .setFontColors(s.colors).setFontWeights(s.weights).setHorizontalAlignments(s.align)
    .setVerticalAlignments(s.vertical).setNumberFormats(s.numbers).setWrap(true);
}
function cashWriteDetails_(cfg, sheet, report, type, period) {
  if (!sheet) throw new Error('Tab rincian laporan tidak ditemukan.');
  var existing = sheet.getRange(1, 1, sheet.getMaxRows(), 3).getDisplayValues();
  var subtotal = existing.findIndex(function (r) { return /^Subtotal /.test(r[1] || ''); });
  var total = existing.findIndex(function (r) { return /^TOTAL /.test(r[1] || ''); });
  if (subtotal < 0 || total < 0) throw new Error('Format subtotal template berubah.');
  var styles = {month: cashCaptureStyle_(sheet.getRange(5, 1, 1, 3)),
    subtotal: cashCaptureStyle_(sheet.getRange(subtotal + 1, 1, 1, 3)),
    total: cashCaptureStyle_(sheet.getRange(total + 1, 1, 1, 3))};
  var rows = cashDetailRows_(report, type), lastRow = rows.length + 4;
  if (lastRow > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), lastRow - sheet.getMaxRows());
  sheet.getRange(5, 1, sheet.getMaxRows() - 4, 3).breakApart().clearContent();
  sheet.getRange(6, 1, 1, 3).copyFormatToRange(sheet, 1, 3, 5, lastRow);
  sheet.getRange(5, 1, rows.length, 3).setWrap(true);
  sheet.getRange('A2').setValue('Masjid Al-Barokah Taskombang - Periode ' + period);
  SpreadsheetApp.flush();
  var cells = rows.map(function (row) {
    return {values: row.values.map(function (value) {
      return {userEnteredValue: typeof value === 'number' ? {numberValue: value} : {stringValue: value}};
    })};
  });
  // Literal strings also protect the report workbook from formula-like descriptions.
  Sheets.Spreadsheets.batchUpdate({requests: [{updateCells: {
    range: {sheetId: sheet.getSheetId(), startRowIndex: 4, endRowIndex: lastRow,
      startColumnIndex: 0, endColumnIndex: 3}, rows: cells, fields: 'userEnteredValue'}}]}, cfg.reportId);
  rows.forEach(function (row, i) {
    if (styles[row.kind]) cashApplyStyle_(sheet.getRange(i + 5, 1, 1, 3), styles[row.kind]);
    if (row.kind === 'month') sheet.getRange(i + 5, 1, 1, 3).merge();
  });
  if (sheet.getMaxRows() > lastRow) sheet.deleteRows(lastRow + 1, sheet.getMaxRows() - lastRow);
  sheet.setFrozenRows(4);
  sheet.autoResizeRows(5, rows.length);
  return {id: sheet.getSheetId(), name: sheet.getName(), lastRow: lastRow, rows: rows};
}
function cashVerifyWorkbook_(cfg, report, layout) {
  var ranges = ["'Laporan Arus Kas'!G8:G12",
    "'Laporan Arus Kas'!A" + layout.summaryFirst + ':H' + (layout.summaryFirst + layout.summaryCount - 1),
    "'" + layout.income.name + "'!A5:C" + layout.income.lastRow,
    "'" + layout.expense.name + "'!A5:C" + layout.expense.lastRow];
  var response = Sheets.Spreadsheets.get(cfg.reportId, {ranges: ranges,
    fields: 'sheets(properties(sheetId),data(startRow,startColumn,rowData(values(effectiveValue,userEnteredValue))))'});
  function grid(id, startRow, startColumn) {
    var sh = response.sheets.filter(function (s) { return s.properties.sheetId === id; })[0];
    var data = (sh.data || []).filter(function (d) {
      return (d.startRow || 0) === startRow && (d.startColumn || 0) === startColumn;
    })[0];
    if (!data) throw new Error('Rentang hasil laporan tidak dapat dibaca.');
    return (data.rowData || []).map(function (r) { return (r.values || []).map(cashScalar_); });
  }
  var amounts = grid(layout.summaryId, 7, 6).map(function (r) { return r[0]; });
  if (JSON.stringify(amounts) !== JSON.stringify([report.opening, report.income, -report.expense, report.net, report.ending]))
    throw new Error('Ringkasan workbook tidak sama dengan sumber.');
  var monthly = grid(layout.summaryId, layout.summaryFirst - 1, 0);
  if (monthly.length !== report.months.length) throw new Error('Jumlah bulan tidak cocok.');
  monthly.forEach(function (r, i) {
    var m = report.months[i];
    if (r[0] !== m.label || r[2] !== m.income || r[4] !== m.expense || r[6] !== m.ending)
      throw new Error('Rekonsiliasi bulan ' + m.label + ' gagal.');
  });
  [layout.income, layout.expense].forEach(function (detail) {
    var actual = grid(detail.id, 4, 0);
    if (actual.length !== detail.rows.length) throw new Error('Jumlah baris rincian tidak cocok.');
    actual.forEach(function (r, i) {
      var expected = detail.rows[i].values;
      for (var c = 0; c < 3; c++)
        if ((r[c] === undefined ? '' : r[c]) !== expected[c]) throw new Error('Rincian berbeda pada ' + detail.name + ' baris ' + (i + 5) + '.');
    });
  });
}
function cashExportPdf_(cfg) {
  SpreadsheetApp.flush();
  var url = 'https://docs.google.com/spreadsheets/d/' + cfg.reportId +
    '/export?format=pdf&size=A4&portrait=true&fitw=true&scale=2&sheetnames=false&printtitle=false' +
    '&pagenum=CENTER&gridlines=false&fzr=true&top_margin=0.35&bottom_margin=0.35&left_margin=0.35&right_margin=0.35';
  var response = UrlFetchApp.fetch(url, {headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    muteHttpExceptions: true});
  if (response.getResponseCode() !== 200) throw new Error('Ekspor PDF gagal (HTTP ' + response.getResponseCode() + ').');
  return response.getBlob().setContentType('application/pdf').setName('LAPORAN ARUS KAS MASJID AL-BAROKAH - PUBLIK.pdf');
}
function cashVerifyPdfBytes_(bytes) {
  if (!bytes || bytes.length < 1000 || String.fromCharCode.apply(null, bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('Hasil ekspor bukan PDF yang valid.');
  // Google Sheets PDFs expose page dictionaries. Fail closed if the dimensions cannot be checked.
  var chunks = [], chunkSize = 4096;
  for (var i = 0; i < bytes.length; i += chunkSize)
    chunks.push(String.fromCharCode.apply(null, bytes.slice(i, i + chunkSize).map(function (b) { return (b + 256) % 256; })));
  var text = chunks.join(''), boxes = [], regex = /\/MediaBox\s*\[\s*([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s+([\d.-]+)\s*\]/g, match;
  while ((match = regex.exec(text))) boxes.push([Number(match[3]) - Number(match[1]), Number(match[4]) - Number(match[2])]);
  if (!boxes.length || boxes.some(function (b) { return Math.abs(b[0] - 595.28) > 3 || Math.abs(b[1] - 841.89) > 3; }))
    throw new Error('Ukuran halaman PDF tidak dapat dipastikan A4 portrait. PDF lama dipertahankan.');
  if ((text.match(/\/Type\s*\/Page\b/g) || []).length < 3)
    throw new Error('PDF harus memuat ringkasan dan kedua bagian rincian.');
}
