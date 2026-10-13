// Deploy privately (MYSELF). File IDs belong in Script Properties, never in the HTML.
function cashConfig_() {
  var p = PropertiesService.getScriptProperties(), data = p.getProperties();
  ['SOURCE_SPREADSHEET_ID', 'REPORT_SPREADSHEET_ID', 'PUBLIC_PDF_ID'].forEach(function (key) {
    if (!/^[\w-]{10,}$/.test(data[key] || '')) throw new Error('Isi Script Property ' + key + ' terlebih dahulu.');
  });
  if (data.SOURCE_SPREADSHEET_ID === data.REPORT_SPREADSHEET_ID)
    throw new Error('Workbook laporan harus berbeda dari sumber transaksi.');
  var mode = data.REPORT_MODE || 'NEW_PERIOD', baseline = null, phbiBaseline = null;
  if (['NEW_PERIOD', 'HISTORICAL'].indexOf(mode) < 0) throw new Error('REPORT_MODE tidak valid.');
  try {
    if (data.REPORT_BASELINE) baseline = cashValidateBaseline_(JSON.parse(data.REPORT_BASELINE), false);
    if (data.PHBI_REPORT_BASELINE) phbiBaseline = cashValidateBaseline_(JSON.parse(data.PHBI_REPORT_BASELINE), true);
  } catch (error) { throw new Error('Konfigurasi saldo awal periode baru rusak: ' + error.message); }
  return {sourceId: data.SOURCE_SPREADSHEET_ID, reportId: data.REPORT_SPREADSHEET_ID,
    pdfId: data.PUBLIC_PDF_ID, opening: 6147200, startDate: '2026-05-01',
    mode: mode, baseline: baseline, phbiBaseline: phbiBaseline,
    expectedStartDate: cashIso_(data.NEW_PERIOD_START_DATE || '2026-10-08'),
    phbiId: data.PHBI_SHEET_ID ? Number(data.PHBI_SHEET_ID) : null,
    syncId: data.SYNC_SHEET_ID ? Number(data.SYNC_SHEET_ID) : null,
    writeInId: data.WRITE_INCOME_SHEET_ID ? Number(data.WRITE_INCOME_SHEET_ID) : null,
    writeOutId: data.WRITE_EXPENSE_SHEET_ID ? Number(data.WRITE_EXPENSE_SHEET_ID) : null};
}
function cashOwner_() {
  var expected = PropertiesService.getScriptProperties().getProperty('OWNER_EMAIL');
  var active = Session.getActiveUser().getEmail(), effective = Session.getEffectiveUser().getEmail();
  if (!expected || !active || active !== expected || effective !== expected)
    throw new Error('Aplikasi hanya dapat dipakai akun pemilik yang sudah dikonfigurasi.');
}
function cashToday_() { return Utilities.formatDate(new Date(), 'Asia/Jakarta', 'yyyy-MM-dd'); }
function cashSha_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
function cashScalar_(cell) {
  if (cell.effectiveValue && cell.effectiveValue.errorValue)
    throw new Error('Formula sumber bermasalah: ' + cell.effectiveValue.errorValue.message);
  var v = cell.effectiveValue || cell.userEnteredValue || {};
  if (v.numberValue !== undefined) return v.numberValue;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.boolValue !== undefined) return v.boolValue;
  if (v.formulaValue) throw new Error('Hasil formula belum tersedia.');
  return '';
}
function cashReadGrids_(cfg, properties, widths, onlyHeader) {
  var ranges = properties.map(function (p) {
    var width = Math.min(onlyHeader ? 8 : (widths[p.sheetId] || 4), p.gridProperties.columnCount);
    var rows = onlyHeader ? 1 : p.gridProperties.rowCount;
    if (rows > 20000) throw new Error('Tab ' + p.title + ' terlalu panjang; gunakan tab periode baru.');
    return "'" + p.title.replace(/'/g, "''") + "'!A1:" + String.fromCharCode(64 + width) + rows;
  });
  var result = Sheets.Spreadsheets.get(cfg.sourceId, {ranges: ranges, includeGridData: true,
    fields: 'sheets(properties(sheetId,title,index),data(startRow,startColumn,rowData(values(effectiveValue,userEnteredValue,note))))'});
  return (result.sheets || []).map(function (sheet) {
    var grid = (sheet.data || [])[0] || {};
    return {id: sheet.properties.sheetId, title: sheet.properties.title, index: sheet.properties.index,
      rows: (grid.rowData || []).map(function (row) { return (row.values || []).map(cashScalar_); }),
      notes: (grid.rowData || []).map(function (row) { return (row.values || []).map(function (c) { return c.note || ''; }); })};
  });
}
function cashSource_(cfg) {
  // Use fresh API reads: Apps Script's SpreadsheetApp read cache can miss API writes.
  var metadata = Sheets.Spreadsheets.get(cfg.sourceId, {
    fields: 'spreadsheetId,properties(timeZone),sheets(properties,developerMetadata)'});
  var properties = metadata.sheets.filter(function (s) { return s.properties.sheetType === 'GRID'; })
    .map(function (s) { return s.properties; });
  function uniqueTitle(title) {
    var found = properties.filter(function (p) { return p.title === title; });
    if (found.length !== 1) throw new Error('Tetapkan ID tab ' + title + ' pada Script Properties.');
    return found[0].sheetId;
  }
  cfg.phbiId = cfg.phbiId === null ? uniqueTitle('RAW PHBI') : cfg.phbiId;
  cfg.syncId = cfg.syncId === null ? uniqueTitle('REKAP CHAT 2022-2026') : cfg.syncId;
  var headers = cashReadGrids_(cfg, properties, {}, true);
  var matched = headers.filter(function (s) { return cashStream_(s.rows[0] || []); });
  matched.forEach(function (snapshot) {
    var native = metadata.sheets.filter(function (s) { return s.properties.sheetId === snapshot.id; })[0];
    var funds = (native.developerMetadata || []).filter(function (m) { return m.metadataKey === 'KAS_DANA'; });
    if (funds.length > 1) throw new Error('Metadata dana tab ' + snapshot.title + ' ambigu.');
    snapshot.fund = funds.length ? funds[0].metadataValue : null;
  });
  var widths = {}; widths[cfg.phbiId] = 6; widths[cfg.syncId] = 8;
  var selected = properties.filter(function (p) {
    return p.sheetId === cfg.phbiId || p.sheetId === cfg.syncId ||
      matched.some(function (s) { return s.id === p.sheetId; });
  });
  if (!selected.some(function (p) { return p.sheetId === cfg.phbiId; }) ||
      !selected.some(function (p) { return p.sheetId === cfg.syncId; }))
    throw new Error('Tab PHBI atau sinkronisasi yang dikonfigurasi sudah tidak tersedia.');
  var grids = cashReadGrids_(cfg, selected, widths, false);
  var transactionsGrids = grids.filter(function (g) { return matched.some(function (s) { return s.id === g.id; }); });
  transactionsGrids.forEach(function (g) {
    g.fund = matched.filter(function (s) { return s.id === g.id; })[0].fund;
  });
  var ledger = cashReadLedger_(transactionsGrids, cfg.startDate, metadata.properties.timeZone);
  var phbi = grids.filter(function (g) { return g.id === cfg.phbiId; })[0];
  if ((phbi.rows[0] || []).slice(0, 6).map(cashHeader_).join('|') !==
      'tanggal|kode|keterangan|pemasukan|pengeluaran|sumber')
    throw new Error('Header RAW PHBI berubah. Tidak ada transaksi yang ditulis.');
  var sync = grids.filter(function (g) { return g.id === cfg.syncId; })[0];
  var checkpoints = cashCheckpoints_(sync.rows, metadata.properties.timeZone);
  var phbiTxs = cashPhbiRows_(phbi, metadata.properties.timeZone);
  if (cfg.mode === 'NEW_PERIOD' && ((!cfg.baseline && checkpoints.MASJID.date !== cfg.expectedStartDate) ||
      (!cfg.phbiBaseline && checkpoints.PHBI.date !== cfg.expectedStartDate)))
    throw new Error('Saldo awal yang disetujui belum dipasang. Isi snapshot REPORT_BASELINE dan PHBI_REPORT_BASELINE; jangan memulai ulang dari hitungan berikutnya.');
  var baseline = cfg.baseline || checkpoints.MASJID;
  var report = cfg.mode === 'NEW_PERIOD' ? cashNewPeriodReport_(ledger.transactions, baseline) :
    cashBuildReport_(ledger.transactions, cfg.opening, cfg.startDate);
  if (cfg.mode === 'NEW_PERIOD' && checkpoints.MASJID.date < baseline.date)
    throw new Error('Tanggal sinkronisasi sumber lebih awal dari saldo awal laporan.');
  var reportTransactions = report.incoming.concat(report.outgoing);
  return {cfg: cfg, metadata: metadata, grids: grids, ledger: ledger, phbi: phbi,
    checkpoints: checkpoints, phbiTransactions: phbiTxs, report: report,
    reportBaseline: baseline, phbiBaseline: cfg.phbiBaseline || checkpoints.PHBI,
    reconciliation: cashReconcileCheckpoint_(report, reportTransactions, checkpoints.MASJID)};
}
function cashCheckpoints_(rows, timeZone) {
  var start = -1;
  rows.forEach(function (row, i) {
    if (row.slice(0, 6).map(cashHeader_).join('|') === 'tanggal|dana|k1|k2|k3|total') start = i + 1;
  });
  if (start < 0) throw new Error('Saldo awal hasil sinkronisasi belum ditemukan.');
  var result = {};
  rows.slice(start, start + 2).forEach(function (row) {
    var fund = /^kas masjid$/i.test(String(row[1])) ? 'MASJID' :
      /^phbi\b/i.test(String(row[1])) ? 'PHBI' : null;
    if (!fund) throw new Error('Baris hasil sinkronisasi tidak valid.');
    var holders = {};
    CASH_CODES_.forEach(function (code, i) { holders[code] = emptyCashCell_(row[i + 2]) ? null : cashMoney_(row[i + 2], true); });
    var amount = cashMoney_(row[5], true);
    if (Object.keys(holders).reduce(function (s, code) { return s + (holders[code] || 0); }, 0) !== amount)
      throw new Error('Total uang fisik hasil sinkronisasi tidak sama dengan pembagian bendahara.');
    if (fund === 'MASJID' && CASH_CODES_.some(function (code) { return holders[code] === null; }))
      throw new Error('Saldo awal K1, K2, dan K3 kas masjid belum lengkap.');
    result[fund] = {date: cashIso_(row[0], timeZone), amount: amount, holders: holders};
  });
  if (!result.MASJID || !result.PHBI) throw new Error('Saldo awal masjid dan PHBI harus terpisah.');
  return result;
}
function cashPhbiRows_(grid, timeZone) {
  var result = [], seen = {};
  grid.rows.slice(1).forEach(function (row, i) {
    if (row.every(emptyCashCell_)) return;
    try {
      var incoming = emptyCashCell_(row[3]) ? 0 : cashMoney_(row[3], true);
      var outgoing = emptyCashCell_(row[4]) ? 0 : cashMoney_(row[4], true);
      if ((incoming > 0) === (outgoing > 0)) throw new Error('Isi satu jenis arus kas saja.');
      var description = String(row[2] || '').trim();
      if (!description) throw new Error('Keterangan kosong.');
      var meta = cashMeta_((grid.notes[i + 1] || [])[0]);
      if (meta && seen[meta.id]) throw new Error('ID kiriman PHBI terulang.');
      if (meta) seen[meta.id] = true;
      result.push({date: cashIso_(row[0], timeZone), code: String(row[1] || ''), description: description,
        amount: incoming || outgoing, type: incoming ? 'in' : 'out', fund: 'PHBI', meta: meta,
        sheetId: grid.id, sheetTitle: grid.title, row: i + 2});
    } catch (e) { throw new Error(grid.title + '!A' + (i + 2) + ':F' + (i + 2) + ': ' + e.message); }
  });
  return result.sort(cashSort_);
}
function cashDestination_(state, type) {
  var configured = type === 'in' ? state.cfg.writeInId : state.cfg.writeOutId;
  var candidates = state.ledger.streams.filter(function (s) { return s.type === type; });
  if (configured !== null) {
    var exact = candidates.filter(function (s) { return s.id === configured; });
    if (exact.length !== 1) throw new Error('Tab tujuan transaksi tidak lagi sesuai header yang diperlukan.');
    return exact[0];
  }
  var populated = candidates.filter(function (s) { return s.lastDate; })
    .sort(function (a, b) { return b.lastDate.localeCompare(a.lastDate); });
  if (!populated.length && candidates.length !== 1) throw new Error('Pilih ID tab tujuan transaksi pada Script Properties.');
  return populated[0] || candidates[0];
}
function cashFindRequest_(state, id) {
  var all = state.ledger.transactions.concat(state.phbiTransactions);
  var found = all.filter(function (tx) { return tx.meta && tx.meta.id === id; });
  if (found.length > 1) throw new Error('ID kiriman ditemukan lebih dari sekali. Periksa Sheet.');
  if (!found.length) return null;
  var tx = found[0], actual = {id: id, fund: tx.fund, type: tx.type, code: tx.code,
    date: tx.date, description: tx.description, amount: tx.amount};
  if (!cashSameInput_(actual, tx.meta)) throw new Error('Transaksi sebelumnya sudah diubah di Sheet; periksa sebelum mengirim ulang.');
  return actual;
}
function cashAppend_(state, tx) {
  var cfg = state.cfg, checkpoint = state.checkpoints[tx.fund];
  var dest = tx.fund === 'PHBI' ? {id: cfg.phbiId, title: state.phbi.title} : cashDestination_(state, tx.type);
  var grid = state.grids.filter(function (g) { return g.id === dest.id; })[0];
  var width = tx.fund === 'PHBI' ? 6 : 4, exemplar = grid.rows.length;
  while (exemplar > 1 && !grid.rows[exemplar - 1][0]) exemplar--;
  var formatResponse = Sheets.Spreadsheets.get(cfg.sourceId, {
    ranges: ["'" + dest.title.replace(/'/g, "''") + "'!A" + Math.max(2, exemplar) + ':' +
      String.fromCharCode(64 + width) + Math.max(2, exemplar)],
    fields: 'sheets(data(rowData(values(userEnteredFormat,dataValidation))))'});
  var sample = (((formatResponse.sheets || [])[0] || {}).data || [])[0] || {};
  var styles = ((sample.rowData || [])[0] || {}).values || [];
  var meta = Object.assign({}, tx, {createdAt: new Date().toISOString(), afterSync: true,
    checkpointKey: cashCheckpointKey_(checkpoint), reportBaselineKey: cashCheckpointKey_(
      tx.fund === 'PHBI' ? (state.phbiBaseline || checkpoint) : (state.reportBaseline || checkpoint))});
  var values = tx.fund === 'PHBI'
    ? [cashSerial_(tx.date), tx.code, tx.description, tx.type === 'in' ? tx.amount : '',
      tx.type === 'out' ? tx.amount : '', 'Aplikasi kas / ' + tx.id]
    : [cashSerial_(tx.date), tx.code, tx.description, tx.amount];
  var cells = values.map(function (v, i) {
    var c = {userEnteredValue: typeof v === 'number' ? {numberValue: v} : {stringValue: v},
      userEnteredFormat: styles[i] && styles[i].userEnteredFormat || {}};
    if (styles[i] && styles[i].dataValidation) c.dataValidation = styles[i].dataValidation;
    if (i === 0) {
      c.note = CASH_NOTE_PREFIX_ + JSON.stringify(meta);
      c.userEnteredFormat.numberFormat = {type: 'DATE', pattern: 'dd/mm/yyyy'};
    }
    return c;
  });
  // Typed stringValue keeps a description beginning "=" as literal text, not a formula.
  Sheets.Spreadsheets.batchUpdate({requests: [{appendCells: {sheetId: dest.id,
    rows: [{values: cells}], fields: 'userEnteredValue,userEnteredFormat,dataValidation,note'}}]}, cfg.sourceId);
}
function cashStatus_(status) {
  PropertiesService.getScriptProperties().setProperty('REPORT_STATUS', JSON.stringify(status));
  return status;
}
function cashExtendFilter_(cfg, saved) {
  var response = Sheets.Spreadsheets.get(cfg.sourceId, {
    fields: 'sheets(properties(sheetId),basicFilter)'});
  var sheet = response.sheets.filter(function (s) { return s.properties.sheetId === saved.sheetId; })[0];
  var filter = sheet && sheet.basicFilter;
  if (filter && filter.range && filter.range.endRowIndex !== undefined && filter.range.endRowIndex < saved.row) {
    // Keep all existing criteria, filter specs and sort settings.
    filter.range.endRowIndex = saved.row;
    Sheets.Spreadsheets.batchUpdate({requests: [{setBasicFilter: {filter: filter}}]}, cfg.sourceId);
  }
}
function doGet() {
  cashOwner_();
  return HtmlService.createHtmlOutputFromFile('Index').setTitle('Kas Masjid Al-Barokah')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
function getDashboard(fund, month) {
  cashOwner_();
  fund = fund === 'PHBI' ? 'PHBI' : 'MASJID';
  month = /^\d{4}-\d{2}$/.test(month || '') ? month : cashToday_().slice(0, 7);
  var state = cashSource_(cashConfig_()), checkpoint = state.checkpoints[fund];
  var all = fund === 'MASJID' ? state.ledger.transactions : state.phbiTransactions;
  var visible = state.cfg.mode === 'NEW_PERIOD' ? all.filter(function (tx) {
    return cashIsAfterReportBaseline_(tx, fund === 'MASJID' ? state.reportBaseline : state.phbiBaseline);
  }) : all;
  var selected = visible.filter(function (tx) { return tx.date.slice(0, 7) === month; });
  var after = all.filter(function (tx) { return cashIsAfterCheckpoint_(tx, checkpoint); });
  var balance = checkpoint.amount + after.reduce(function (s, tx) { return s + (tx.type === 'in' ? tx.amount : -tx.amount); }, 0);
  var rawStatus = PropertiesService.getScriptProperties().getProperty('REPORT_STATUS');
  var status = rawStatus ? JSON.parse(rawStatus) : {state: 'SETUP', message: 'Otomatisasi PDF belum diaktifkan.'};
  if (!state.reconciliation.ok) status = {state: 'BLOCKED',
    message: 'Saldo buku dan hitungan fisik belum cocok. PDF publik tetap versi terakhir.',
    reconciliation: state.reconciliation};
  else if (status.state === 'BLOCKED') status = {state: 'READY',
    message: 'Saldo awal dan pembukuan periode ini sudah cocok. Laporan siap diperbarui.'};
  var file = Drive.Files.get(state.cfg.pdfId, {fields: 'id,mimeType,webViewLink,modifiedTime', supportsAllDrives: true});
  if (file.id !== state.cfg.pdfId || file.mimeType !== 'application/pdf') throw new Error('Target publik harus file PDF yang sudah ada.');
  return {today: cashToday_(), month: month, fund: fund, checkpoint: checkpoint,
    income: selected.filter(function (tx) { return tx.type === 'in'; }).reduce(cashSum_, 0),
    expense: selected.filter(function (tx) { return tx.type === 'out'; }).reduce(cashSum_, 0),
    balance: balance, bookBalance: fund === 'MASJID' ? state.report.ending : null,
    transactions: selected.slice().sort(cashSort_).reverse().map(function (tx) {
      return {date: tx.date, code: tx.code, description: tx.description, type: tx.type, amount: tx.amount};
    }), report: status, pdfUrl: file.webViewLink || null, pdfUpdatedAt: file.modifiedTime,
    reportStartDate: state.report.startDate, reportOpening: state.report.opening,
    automatic: PropertiesService.getScriptProperties().getProperty('AUTO_PUBLISH_ENABLED') === 'true'};
}
function saveTransaction(input) {
  cashOwner_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var state = cashSource_(cashConfig_());
    var tx = cashValidateInput_(input, cashToday_(), state.checkpoints[input && input.fund || 'MASJID']);
    var existing = cashFindRequest_(state, tx.id);
    if (existing && !cashSameInput_(existing, tx)) throw new Error('ID kiriman yang sama tidak boleh dipakai untuk transaksi berbeda.');
    if (!existing) {
      cashAppend_(state, tx);
      var savedState = cashSource_(state.cfg);
      var readback = cashFindRequest_(savedState, tx.id);
      if (!readback || !cashSameInput_(readback, tx)) throw new Error('Penyimpanan belum dapat diverifikasi. Kirim ulang dengan ID yang sama.');
    }
    var warning = null;
    try {
      var verifiedState = savedState || state;
      var savedRow = verifiedState.ledger.transactions.concat(verifiedState.phbiTransactions)
        .filter(function (row) { return row.meta && row.meta.id === tx.id; })[0];
      cashExtendFilter_(state.cfg, savedRow);
    } catch (e) { warning = 'Transaksi tersimpan; rentang filter Sheet belum diperbarui: ' + e.message; }
    var publication;
    try {
      publication = PropertiesService.getScriptProperties().getProperty('AUTO_PUBLISH_ENABLED') === 'true'
        ? cashPublishLocked_() : {state: 'SETUP', message: 'Transaksi tersimpan. Otomatisasi PDF belum diaktifkan.'};
    } catch (e) { publication = cashStatus_({state: 'ERROR', message: 'Transaksi tersimpan. PDF belum diperbarui: ' + e.message}); }
    return {saved: true, duplicate: !!existing, id: tx.id, report: publication, warning: warning};
  } finally { lock.releaseLock(); }
}
function refreshPublicPdf() {
  cashOwner_();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try { return cashPublishLocked_(); }
  catch (e) { return cashStatus_({state: 'ERROR', message: 'PDF belum diperbarui: ' + e.message}); }
  finally { lock.releaseLock(); }
}
function resolvePendingRequest(id) {
  cashOwner_();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var saved = cashFindRequest_(cashSource_(cashConfig_()), String(id || ''));
    return {id: id, saved: !!saved, transaction: saved};
  } finally { lock.releaseLock(); }
}
function previewPublicPdf() {
  cashOwner_();
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var cfg = cashConfig_(), state = cashSource_(cfg);
    if (!state.reconciliation.ok) return {ready: false, report: cashStatus_({state: 'BLOCKED',
      message: 'Pratinjau ditahan sampai saldo buku dan hitungan fisik cocok.', reconciliation: state.reconciliation})};
    if (state.report.latest > cashToday_()) throw new Error('Periksa tanggal transaksi sumber.');
    var signature = cashSha_(cashReportSignature_(state.report));
    var layout = cashWriteWorkbook_(cfg, state.report);
    cashVerifyWorkbook_(cfg, state.report, layout);
    var blob = cashExportPdf_(cfg); cashVerifyPdfBytes_(blob.getBytes());
    var current = cashSource_(cfg);
    if (!current.reconciliation.ok || cashSha_(cashReportSignature_(current.report)) !== signature)
      throw new Error('Sumber berubah saat pratinjau diproses. Muat ulang.');
    var preview = cashSavePrivatePreview_(cfg, blob);
    return {ready: true, pdfUrl: preview.webViewLink, id: preview.id, latest: state.report.latest};
  } finally { lock.releaseLock(); }
}
function cashSavePrivatePreview_(cfg, blob) {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('PRIVATE_PREVIEW_PDF_ID');
  var fields = 'id,mimeType,size,md5Checksum,webViewLink,permissions(type,role,emailAddress)';
  function verifyPrivate(file) {
    if (!file || file.id === cfg.pdfId || file.mimeType !== 'application/pdf' ||
        !file.permissions || !file.permissions.length || file.permissions.some(function (permission) {
          return permission.type !== 'user' || permission.role !== 'owner' ||
            permission.emailAddress !== p.getProperty('OWNER_EMAIL');
        })) throw new Error('Pratinjau harus berupa PDF privat milik akun aplikasi. Periksa izin file pratinjau.');
  }
  var result;
  if (id) {
    if (id === cfg.pdfId) throw new Error('File pratinjau tidak boleh sama dengan PDF publik.');
    verifyPrivate(Drive.Files.get(id, {fields: fields, supportsAllDrives: true}));
    result = Drive.Files.update({mimeType: 'application/pdf'}, id, blob, {fields: fields, supportsAllDrives: true});
  } else {
    result = Drive.Files.create({name: 'PRATINJAU LAPORAN KAS AL-BAROKAH - PRIVAT.pdf',
      mimeType: 'application/pdf', description: 'Pratinjau untuk pemeriksaan bendahara sebelum laporan publik diperbarui.'},
      blob, {fields: fields});
    id = result.id;
  }
  var saved = Drive.Files.get(id, {fields: fields, supportsAllDrives: true});
  verifyPrivate(saved);
  var md5 = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes())
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
  if (result.id !== id || saved.id !== id || Number(saved.size) !== blob.getBytes().length ||
      saved.md5Checksum !== md5 || !/^https:\/\/drive\.google\.com\//.test(saved.webViewLink || ''))
    throw new Error('Pratinjau belum dapat diverifikasi. PDF publik tetap versi sebelumnya.');
  p.setProperty('PRIVATE_PREVIEW_PDF_ID', id);
  return saved;
}
function configureApp() {
  var active = Session.getActiveUser().getEmail(), effective = Session.getEffectiveUser().getEmail();
  if (!active || active !== effective) throw new Error('Jalankan configureApp dari editor dengan akun pemilik.');
  var p = PropertiesService.getScriptProperties();
  if (p.getProperty('OWNER_EMAIL') && p.getProperty('OWNER_EMAIL') !== active) throw new Error('Pemilik aplikasi sudah ditetapkan.');
  var state = cashSource_(cashConfig_());
  var target = Drive.Files.get(state.cfg.pdfId, {fields: 'id,mimeType,capabilities(canEdit)', supportsAllDrives: true});
  if (target.mimeType !== 'application/pdf' || !target.capabilities || !target.capabilities.canEdit)
    throw new Error('Akun ini harus dapat mengedit PDF publik yang sudah ada.');
  var workbook = SpreadsheetApp.openById(state.cfg.reportId);
  ['Laporan Arus Kas', 'Rincian Penerimaan Kas', 'Rincian Pengeluaran Kas'].forEach(function (title) {
    if (!workbook.getSheetByName(title)) throw new Error('Template laporan tidak memiliki tab ' + title + '.');
  });
  p.setProperties({OWNER_EMAIL: active, PHBI_SHEET_ID: String(state.cfg.phbiId), SYNC_SHEET_ID: String(state.cfg.syncId),
    WRITE_INCOME_SHEET_ID: String(cashDestination_(state, 'in').id),
    WRITE_EXPENSE_SHEET_ID: String(cashDestination_(state, 'out').id)});
  if (state.cfg.mode === 'NEW_PERIOD') {
    p.setProperty('REPORT_MODE', 'NEW_PERIOD');
    if (!state.cfg.baseline) p.setProperty('REPORT_BASELINE', JSON.stringify(state.reportBaseline));
    if (!state.cfg.phbiBaseline) p.setProperty('PHBI_REPORT_BASELINE', JSON.stringify(state.phbiBaseline));
  }
  if (!p.getProperty('AUTO_PUBLISH_ENABLED')) p.setProperty('AUTO_PUBLISH_ENABLED', 'false');
  return cashStatus_({state: state.reconciliation.ok ? 'READY' : 'BLOCKED',
    message: state.reconciliation.ok ? 'Konfigurasi terverifikasi. Aktifkan otomatisasi setelah memeriksa pratinjau PDF.' :
      'Konfigurasi terverifikasi; selisih saldo perlu dicocokkan sebelum PDF dapat terbit.',
    reconciliation: state.reconciliation});
}
function activateAutomation() {
  cashOwner_();
  var cfg = cashConfig_(), p = PropertiesService.getScriptProperties();
  var handlers = ['cashReportOnEdit_', 'cashReportWatcher_'];
  var installed = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  if (installed.indexOf(handlers[0]) < 0) ScriptApp.newTrigger(handlers[0]).forSpreadsheet(cfg.sourceId).onEdit().create();
  if (installed.indexOf(handlers[1]) < 0) ScriptApp.newTrigger(handlers[1]).timeBased().everyMinutes(5).create();
  p.setProperty('AUTO_PUBLISH_ENABLED', 'true');
  return refreshPublicPdf();
}
function disableAutomation() {
  cashOwner_();
  PropertiesService.getScriptProperties().setProperty('AUTO_PUBLISH_ENABLED', 'false');
  return cashStatus_({state: 'SETUP', message: 'Otomatisasi dinonaktifkan. Transaksi tetap dapat dicatat.'});
}
function cashReportOnEdit_(event) {
  var cfg = cashConfig_();
  if (!event || !event.source || event.source.getId() !== cfg.sourceId) return;
  // Wait for the scheduled watcher: never publish while a user is editing several cells.
  PropertiesService.getScriptProperties().setProperty('REPORT_DIRTY', 'true');
}
function cashReportWatcher_() {
  if (PropertiesService.getScriptProperties().getProperty('AUTO_PUBLISH_ENABLED') !== 'true') return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try { cashPublishLocked_(); }
  catch (e) { cashStatus_({state: 'ERROR', message: 'PDF belum diperbarui: ' + e.message}); }
  finally { lock.releaseLock(); }
}
