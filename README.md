# Kas Masjid Al-Barokah

Aplikasi administrasi bendahara dengan backend Node.js + TypeScript dan antarmuka hijau dari aplikasi lama. UI dan API dilayani pada origin yang sama. Google Sheet asli tetap sumber pembukuan; PDF publik diperbarui pada File ID lama sehingga tautan dan QR tetap sama.

## Jalankan dan coba

Gunakan Node.js **22.16 atau lebih baru**. Dari direktori repo:

```sh
npm ci
npx playwright install chromium
npm run demo
```

Buka **http://localhost:3000**, lalu **Buka demo aplikasi**. Demo memakai saldo dan transaksi sintetis, menyimpan contoh di `.state-demo`, dan tidak menghubungi Google. Tersedia input kas masjid/PHBI, pemasukan/pengeluaran, K1/K2/K3, draf suara, riwayat, pratinjau PDF, serta publikasi contoh. Hentikan server dengan Ctrl+C.

```sh
npm test             # build + regresi lama + tes backend
npm run test:browser # browser HP/desktop + respons hilang + PDF
```

PDF dan screenshot tes berada di `test-results/` dan diabaikan Git. Tes memakai data sintetis dan mock Google; ini tidak membuktikan kredensial, ekspor Google, atau penulisan produksi sudah aktif.

## Hubungkan file asli satu kali

1. Salin `.env.example` menjadi `.env`. Isi **ID asli dan baseline yang dibekukan** dari handoff privat. Jangan membuat Sheet/PDF pengganti atau mencari target berdasarkan judul. Checkout lokal yang disiapkan dapat memiliki `.env` privat berisi target; file itu tidak masuk Git atau ZIP sumber.
2. Di [Google Cloud Console](https://console.cloud.google.com/), pilih proyek Google milik pemilik. Aktifkan **Google Sheets API** dan **Google Drive API**. Konfigurasikan **Google Auth Platform** untuk penggunaan pemilik sendiri, serta email pemilik sebagai test user jika masih Testing.
3. Buat **OAuth Client → Web application**, tambahkan redirect URI **http://localhost:3000/auth/callback**, lalu download JSON ke komputer. Sesuaikan origin dan redirect dengan HTTPS final saat hosting dipilih. Jangan memakai OAuth Client milik browser atau aplikasi lain.
4. Impor JSON secara lokal:

   ```sh
   npm run setup:google -- "D:/Downloads/client_secret_your_app.json"
   ```

   Alat ini menulis secret ke `.env` lokal tanpa mencetak secret atau meminta token di chat. Jika `.env` masih contoh, isi target dan baseline sebelum menjalankan server.

5. Periksa `OWNER_EMAIL`, `APP_ORIGIN`, `STATE_DIR`, serta `TOKEN_ENCRYPTION_KEY`. Untuk pemasangan baru, buat kunci 32 byte dengan `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"` lalu simpan langsung di konfigurasi privat. Jangan mengganti kunci pada volume yang sudah menyimpan token.
6. Jalankan `npm run build`, `npm start`, lalu **Masuk dengan Google**. Server memeriksa ID token pemilik, izin offline, dan akses tepat ke semua target asli sebelum menerima koneksi. Token refresh disimpan terenkripsi dan terikat email pemilik. Login browser/Apps Script lama tidak menyediakan kredensial backend baru.
7. Mulai dengan `AUTO_PUBLISH_ENABLED=false`. Klik **Pratinjau**, periksa seluruh halaman PDF privat lama, lalu ikuti [cutover dan rollback](docs/DEPLOYMENT.md) sebelum publikasi otomatis.

OAuth eksternal berstatus Testing dapat memiliki refresh token yang kedaluwarsa setelah tujuh hari. Periksa konfigurasi consent untuk penggunaan pribadi jangka panjang. Gunakan **Hubungkan ulang Google** jika izin offline kedaluwarsa atau dicabut; alur ini meminta persetujuan baru. Rujukan: [ketentuan token Google](https://developers.google.com/identity/protocols/oauth2#expiration) dan [OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server).

Baseline memakai JSON `{ "date": "YYYY-MM-DD", "amount": 1000000, "holders": { "K1": 800000, "K2": 200000, "K3": 0 } }` dengan **angka asli dari handoff privat**, bukan contoh ini. PHBI yang belum dikonfirmasi tetap `null`. Baseline tidak diganti oleh checkpoint yang lebih baru.

## Perilaku

- Mode `NEW_PERIOD` dibuka 8 Oktober 2026. Transaksi manual hari pembukaan sudah termasuk hitung fisik; input aplikasi sesudah sinkronisasi memakai `afterSync` dan key baseline yang cocok.
- Kas masjid memakai **satu jurnal aktif** dengan metadata `KAS_JOURNAL=MASJID`, header `Tanggal | Kode | Keterangan | Pemasukan | Pengeluaran | Timestamp`. PHBI tetap di `RAW PHBI`. Arsip tidak dijumlahkan lagi.
- Jurnal dibaca A:F dan ditulis pada range baris berikutnya melalui `updateCells`. Formula I:Z tidak menggeser pencatatan. Tanggal manual dengan timestamp kosong tetap didukung.
- Notes `KAS_APP_V1 ` menyimpan UUID serta metadata bersama nilai dalam satu batch. Respons putus memakai UUID yang sama. Dua transaksi nyata yang identik tetap diterima dengan ID berbeda. Keterangan berawalan `=` ditulis sebagai teks literal.
- K1/K2/K3 adalah pemegang uang, bukan akun login. Semua endpoint data/write/pratinjau dibatasi pemilik. Perubahan memerlukan CSRF serta Origin yang cocok; cookie HttpOnly, SameSite=Lax, Secure pada HTTPS.
- Simpan dikonfirmasi dengan baca ulang sebelum `saved:true`. Kegagalan PDF ditampilkan terpisah dan tidak menggandakan transaksi.
- Checkpoint baru memeriksa saldo buku terhadap uang fisik. Selisih menahan PDF; backend tidak mengubah baseline atau membuat penyesuaian otomatis.
- Saat aktif, satu proses server memeriksa edit manual sekitar lima menit dan memperbarui PDF setelah simpan. Signature yang sama melewati ekspor ulang. Server dan volume harus selalu hidup; browser boleh ditutup.

## PDF dan keamanan data

Adapter memakai tiga tab serta gaya workbook laporan lama, menulis lewat Sheets API, lalu membaca ulang ringkasan, saldo bulanan, rincian, dan subtotal. Ekspor native Google Sheets memakai OAuth server; aplikasi dan pekerja PDF tidak memanggil endpoint, runtime, atau trigger Apps Script.

PDF diperiksa A4 portrait, tiga bagian, periode, keterangan, nominal, serta batas teks. Seluruh halaman dirender lewat PDF.js/canvas. Sumber dibaca ulang sesudah ekspor untuk menahan hasil usang. Pemeriksaan otomatis melengkapi pemeriksaan visual pratinjau pertama dan saat struktur template berubah.

PDF lama dicadangkan ke folder arsip privat, lalu kontennya diganti lewat [Drive files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update) pada ID lama. ID, MIME type, ukuran, checksum, modified time, dan izin dibaca ulang. Izin tidak diperluas. Pratinjau memakai file privat yang sudah ada.

Nilai dan notes ditulis bersama lewat [Sheets batchUpdate](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate). Edit manual dan Apps Script tidak mengikuti lock backend; hindari dua penulis aplikasi saat uji dan dua publisher saat cutover. Lihat [deployment](docs/DEPLOYMENT.md) dan [bukti serta batas verifikasi](docs/VERIFICATION.md).

## Struktur

| Lokasi | Isi |
| --- | --- |
| `public/index.html` | UI mandiri, fetch API, login, retry, suara |
| `server/model.ts` | Port aturan pembukuan murni dari model lama |
| `server/accounting.ts` | Snapshot, identitas kiriman, write A:F |
| `server/google.ts`, `server/workbook.ts` | Adapter Google dan template |
| `server/service.ts` | Dashboard, simpan, serialisasi, publikasi |
| `server/auth.ts`, `server/state.ts` | OAuth, CSRF, token, volume, lock |
| `server/main.ts` | HTTP dan polling lima menit |
| `apps-script/`, `index.html` | Versi lama untuk regresi dan rollback |
| `tests/standalone/` | Tes backend dan browser baru |

Server melayani UI baru dari `public/`. Membuka HTML lama atau menerbitkan HTML saja tidak menjalankan backend. Secret, token, ID privat, baseline, handoff, dan snapshot asli tidak boleh masuk repo publik.
