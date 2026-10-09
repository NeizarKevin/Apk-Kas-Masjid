// Pure accounting rules. No Google writes happen in this file.
var CASH_HEADERS_ = ['tanggal', 'kode', 'keterangan'];
var CASH_CODES_ = ['K1', 'K2', 'K3'];
var CASH_MONTHS_ = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
var CASH_NOTE_PREFIX_ = 'KAS_APP_V1 ';

function emptyCashCell_(value) { return value === '' || value === null || value === undefined; }
function cashHeader_(value) { return String(value || '').trim().toLowerCase(); }
function cashMoney_(value, allowZero) {
  if (typeof value === 'string') {
    var clean = value.trim().replace(/^Rp\s*/i, '');
    if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,00)?$/.test(clean))
      throw new Error('Nominal Rupiah tidak valid: ' + value);
    value = Number(clean.replace(/\./g, '').replace(/,00$/, ''));
  }
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1))
    throw new Error('Nominal harus berupa Rupiah bulat yang ' + (allowZero ? 'tidak negatif.' : 'lebih dari nol.'));
  return value;
}
function cashIso_(value, timeZone) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    if (isNaN(value.getTime())) throw new Error('Tanggal tidak valid.');
    value = typeof Utilities !== 'undefined'
      ? Utilities.formatDate(value, timeZone || 'Asia/Jakarta', 'yyyy-MM-dd')
      : value.toISOString().slice(0, 10);
  } else if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('Tanggal transaksi harus berupa tanggal tanpa waktu.');
    value = new Date((value - 25569) * 86400000).toISOString().slice(0, 10);
  }
  var text = String(value || '').trim(), match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) text = match[3] + '-' + match[2] + '-' + match[1];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Gunakan tanggal yang valid.');
  var date = new Date(text + 'T00:00:00Z');
  if (isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text)
    throw new Error('Tanggal tidak ada dalam kalender: ' + text);
  return text;
}
function cashSerial_(iso) { return Date.parse(cashIso_(iso) + 'T00:00:00Z') / 86400000 + 25569; }
function cashDateLabel_(iso) {
  var p = cashIso_(iso).split('-');
  return p[2] + ' ' + CASH_MONTHS_[Number(p[1]) - 1] + ' ' + p[0];
}
function cashMonthLabel_(key) {
  return CASH_MONTHS_[Number(key.slice(5, 7)) - 1] + ' ' + key.slice(0, 4);
}
function cashRupiah_(value) {
  var sign = value < 0 ? '-' : '';
  return sign + 'Rp' + String(Math.abs(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
function cashMeta_(note) {
  if (!String(note || '').startsWith(CASH_NOTE_PREFIX_)) return null;
  try { return JSON.parse(note.slice(CASH_NOTE_PREFIX_.length)); }
  catch (e) { throw new Error('Catatan identitas transaksi aplikasi rusak.'); }
}
function cashStream_(header) {
  // RAW/legacy tables contain both flows. Never count their duplicate history.
  if (header.slice(4).some(function (value) { return !emptyCashCell_(value); })) return null;
  var h = header.slice(0, 4).map(cashHeader_);
  if (!CASH_HEADERS_.every(function (x, i) { return x === h[i]; })) return null;
  return h[3] === 'pemasukan' ? 'in' : h[3] === 'pengeluaran' ? 'out' : null;
}
function cashReadLedger_(snapshots, startDate, timeZone) {
  var transactions = [], streams = [], seenIds = {};
  snapshots.forEach(function (sheet) {
    var type = cashStream_(sheet.rows[0] || []);
    if (!type) return;
    if (sheet.fund && sheet.fund !== 'MASJID') return;
    if (!sheet.fund && /\b(PHBI|RAMADHAN|RAMADAN)\b/i.test(sheet.title))
      throw new Error('Tetapkan dana tab ' + sheet.title + ' sebelum dimasukkan ke laporan masjid.');
    var dates = [], memoAmountNext = false;
    sheet.rows.slice(1).forEach(function (row, i) {
      var rowNumber = i + 2;
      if (row.every(emptyCashCell_)) { memoAmountNext = false; return; }
      // Existing cash-count memo in the expense tab is not an expense.
      var noTransactionCells = [row[0], row[2], row[3]].every(emptyCashCell_);
      if (type === 'out' && noTransactionCells && /^Kas real K[123]\b/i.test(String(row[1] || ''))) {
        memoAmountNext = true; return;
      }
      if (type === 'out' && memoAmountNext && noTransactionCells && typeof row[1] === 'number') {
        cashMoney_(row[1], true); memoAmountNext = false; return;
      }
      memoAmountNext = false;
      try {
        var date = cashIso_(row[0], timeZone);
        var description = String(row[2] || '').trim();
        if (!description) throw new Error('Keterangan kosong.');
        var amount = cashMoney_(row[3], false);
        var meta = cashMeta_((sheet.notes && sheet.notes[i + 1] || [])[0]);
        if (meta && meta.id) {
          if (seenIds[meta.id]) throw new Error('ID transaksi aplikasi terulang.');
          seenIds[meta.id] = true;
        }
        dates.push(date);
        if (date < startDate) return;
        transactions.push({date: date, code: String(row[1] || '').trim(),
          description: description, amount: amount, type: type, fund: 'MASJID',
          sheetId: sheet.id, sheetTitle: sheet.title, row: rowNumber, meta: meta});
      } catch (error) {
        throw new Error(sheet.title + '!A' + rowNumber + ':D' + rowNumber + ': ' + error.message);
      }
    });
    dates.sort();
    streams.push({id: sheet.id, title: sheet.title, type: type, index: sheet.index,
      firstDate: dates[0] || null, lastDate: dates[dates.length - 1] || null});
  });
  ['in', 'out'].forEach(function (type) {
    var periods = streams.filter(function (s) { return s.type === type && s.firstDate; })
      .sort(function (a, b) { return a.firstDate.localeCompare(b.firstDate); });
    for (var i = 1; i < periods.length; i++)
      if (periods[i].firstDate <= periods[i - 1].lastDate)
        throw new Error('Periode sumber bertumpuk: ' + periods[i - 1].title + ' dan ' + periods[i].title + '.');
    if (!streams.some(function (s) { return s.type === type; }))
      throw new Error('Tab ' + (type === 'in' ? 'pemasukan' : 'pengeluaran') + ' dengan header lengkap tidak ditemukan.');
  });
  transactions.sort(cashSort_);
  return {transactions: transactions, streams: streams};
}
function cashSort_(a, b) {
  return a.date.localeCompare(b.date) || a.type.localeCompare(b.type) ||
    a.description.localeCompare(b.description) || a.amount - b.amount ||
    (a.sheetId || 0) - (b.sheetId || 0) || (a.row || 0) - (b.row || 0);
}
function cashBuildReport_(transactions, opening, startDate) {
  opening = cashMoney_(opening, true);
  var rows = transactions.filter(function (tx) { return tx.fund === 'MASJID' && tx.date >= startDate; });
  var latest = rows.reduce(function (last, tx) { return tx.date > last ? tx.date : last; }, startDate);
  var months = [], key = startDate.slice(0, 7), lastKey = latest.slice(0, 7), balance = opening;
  while (key <= lastKey) {
    var list = rows.filter(function (tx) { return tx.date.slice(0, 7) === key; });
    var income = list.filter(function (tx) { return tx.type === 'in'; }).reduce(cashSum_, 0);
    var expense = list.filter(function (tx) { return tx.type === 'out'; }).reduce(cashSum_, 0);
    balance += income - expense;
    if (!Number.isSafeInteger(balance)) throw new Error('Saldo melewati batas angka aman.');
    months.push({key: key, label: cashMonthLabel_(key), income: income, expense: expense, ending: balance});
    var parts = key.split('-').map(Number);
    parts[1] += 1; if (parts[1] === 13) { parts[0] += 1; parts[1] = 1; }
    key = String(parts[0]) + '-' + String(parts[1]).padStart(2, '0');
  }
  var incoming = rows.filter(function (tx) { return tx.type === 'in'; });
  var outgoing = rows.filter(function (tx) { return tx.type === 'out'; });
  var totalIncome = incoming.reduce(cashSum_, 0), totalExpense = outgoing.reduce(cashSum_, 0);
  if (months.reduce(function (s, m) { return s + m.income; }, 0) !== totalIncome ||
      months.reduce(function (s, m) { return s + m.expense; }, 0) !== totalExpense ||
      opening + totalIncome - totalExpense !== balance)
    throw new Error('Rekonsiliasi ringkasan dan rincian gagal.');
  return {opening: opening, startDate: startDate, latest: latest, income: totalIncome,
    expense: totalExpense, net: totalIncome - totalExpense, ending: balance,
    incomeCount: incoming.length, expenseCount: outgoing.length,
    incoming: incoming, outgoing: outgoing, months: months};
}
function cashSum_(sum, tx) {
  var value = sum + tx.amount;
  if (!Number.isSafeInteger(value)) throw new Error('Total nominal melewati batas angka aman.');
  return value;
}
function cashCheckpointKey_(checkpoint) {
  return JSON.stringify([checkpoint.date, checkpoint.amount, checkpoint.holders]);
}
function cashIsAfterCheckpoint_(tx, checkpoint) {
  return tx.date > checkpoint.date || (tx.date === checkpoint.date && tx.meta &&
    tx.meta.checkpointKey === cashCheckpointKey_(checkpoint) && tx.meta.afterSync === true);
}
function cashReconcileCheckpoint_(report, transactions, checkpoint) {
  var before = transactions.filter(function (tx) {
    return tx.fund === 'MASJID' && tx.date >= report.startDate &&
      tx.date <= checkpoint.date && !cashIsAfterCheckpoint_(tx, checkpoint);
  });
  var book = report.opening + before.reduce(function (s, tx) {
    return s + (tx.type === 'in' ? tx.amount : -tx.amount);
  }, 0);
  return {ok: book === checkpoint.amount, date: checkpoint.date, book: book,
    actual: checkpoint.amount, difference: checkpoint.amount - book};
}
function cashValidateInput_(input, today, checkpoint) {
  if (!input || typeof input !== 'object') throw new Error('Transaksi tidak valid.');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(String(input.id || ''))) throw new Error('ID kiriman tidak valid.');
  if (['MASJID', 'PHBI'].indexOf(input.fund) < 0) throw new Error('Pilih jenis dana.');
  if (['in', 'out'].indexOf(input.type) < 0) throw new Error('Pilih pemasukan atau pengeluaran.');
  if (CASH_CODES_.indexOf(input.code) < 0) throw new Error('Pilih bendahara yang menerima atau membayar.');
  var date = cashIso_(input.date);
  if (date < checkpoint.date) throw new Error('Transaksi sebelum sinkronisasi perlu dicocokkan di Sheet terlebih dahulu.');
  if (date > today) throw new Error('Tanggal transaksi tidak boleh melewati hari ini.');
  var description = String(input.description || '').trim();
  if (!description || description.length > 500) throw new Error('Keterangan wajib diisi, maksimal 500 karakter.');
  return {id: String(input.id), fund: input.fund, type: input.type, code: input.code,
    date: date, description: description, amount: cashMoney_(input.amount, false)};
}
function cashSameInput_(a, b) {
  return ['id', 'fund', 'type', 'code', 'date', 'description', 'amount'].every(function (key) { return a[key] === b[key]; });
}
function cashReportSignature_(report) {
  return JSON.stringify([report.startDate, report.opening,
    report.incoming.map(cashVisible_), report.outgoing.map(cashVisible_)]);
}
function cashVisible_(tx) { return [tx.date, tx.description, tx.amount]; }
function cashDetailRows_(report, type) {
  var rows = [], kind = type === 'in' ? 'income' : 'expense';
  var all = type === 'in' ? report.incoming : report.outgoing;
  report.months.forEach(function (month) {
    var list = all.filter(function (tx) { return tx.date.slice(0, 7) === month.key; });
    if (!list.length) return;
    rows.push({kind: 'month', values: [month.label, '', '']});
    list.forEach(function (tx) { rows.push({kind: 'transaction', values: [cashDateLabel_(tx.date), tx.description, tx.amount]}); });
    rows.push({kind: 'subtotal', values: ['', 'Subtotal ' + month.label, month[kind]]});
    rows.push({kind: 'blank', values: ['', '', '']});
  });
  rows.push({kind: 'total', values: ['', type === 'in' ? 'TOTAL PENERIMAAN KAS' : 'TOTAL PENGELUARAN KAS', report[kind]]});
  return rows;
}
