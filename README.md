# Kas Masjid Al-Barokah

Aplikasi administrasi bendahara dengan backend Node.js + TypeScript dan antarmuka Midnight yang responsif untuk HP dan desktop. UI dan API dilayani pada origin yang sama. Google Sheet asli tetap sumber pembukuan; PDF publik diperbarui pada File ID lama sehingga tautan dan QR tetap sama.

Aplikasi online: **https://kas-masjid-albarokah.vercel.app**. Masuk memakai akun Google pemilik. Konfigurasi hosting memakai Vercel Hobby, Redis Free, dan QStash Free; detail kuota serta pemulihan ada pada [panduan deployment](docs/DEPLOYMENT.md).

## Jalankan dan coba

Gunakan Node.js **24.x**. Dari direktori repo:

```sh
npm ci
npx playwright install chromium webkit
npm run demo
```

Buka **http://localhost:3000**, lalu **Buka demo aplikasi**. Demo memakai saldo dan transaksi sintetis, menyimpan contoh di `.state-demo`, dan tidak menghubungi Google. Tersedia input kas masjid/PHBI, pemasukan/pengeluaran, K1/K2/K3, draf suara, riwayat, pratinjau PDF, serta publikasi contoh. Hentikan server dengan Ctrl+C.

```sh
npm test             # build + regresi lama + tes backend
npm run test:browser # browser HP/desktop + respons hilang + PDF
npm run test:layout  # WebKit/Chromium, lebar kontrol, tanggal, dialog
npm run test:voice   # alur suara dengan peristiwa SpeechRecognition tiruan
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
- Login berlaku 12 jam; centang **Ingat saya selama 7 hari** hanya di perangkat pribadi agar tidak perlu login setiap membuka ikon home screen. Pilihan disimpan dalam sesi OAuth, bukan dipercaya dari query callback. Keluar langsung mencabut sesi, termasuk sesi 7 hari.
- Simpan dikonfirmasi dengan baca ulang sebelum `saved:true`, tanpa menunggu ekspor atau publikasi PDF. Edit/hapus/pulihkan memakai alur yang sama. Status PDF menampilkan laporan yang menunggu pembaruan; kegagalan PDF ditampilkan terpisah dan tidak menggandakan transaksi.
- **Edit, Hapus, dan Pulihkan** tersedia pada rincian transaksi. Perubahan harus disertai alasan, memakai pemeriksaan versi baris, dan mempunyai UUID sendiri untuk kirim ulang yang aman. Riwayat tersimpan dalam note baris Sheet yang sama; tidak menambah database pembukuan kedua. Hapus mengosongkan A:F serta menyimpan cadangan privat pada note, tanpa menghapus atau menggeser baris. Tombstone tetap menahan UUID dan posisi baris agar transaksi yang dihapus tidak muncul kembali akibat retry.
- Jangan mengisi ulang baris yang dihapus langsung di Sheet sambil meninggalkan note cadangannya. Aplikasi menahan operasi jika isi manual bertentangan dengan penanda dihapus, lalu menunjukkan lokasi baris untuk dicocokkan. Jika koneksi gagal saat membuka koreksi tertunda, gunakan **Muat ulang**; jika sesi habis, masuk kembali untuk melanjutkan UUID yang sama.
- Transaksi yang sudah termasuk hitung fisik terbaru dikunci dari koreksi aplikasi. Cocokkan langsung di Sheet agar angka hitungan fisik tidak berubah diam-diam. Dana transaksi tidak dipindah melalui edit. Gunakan pencarian dan penyaring jenis transaksi untuk menemukan rincian bulan yang dipilih.
- Checkpoint baru memeriksa saldo buku terhadap uang fisik. Selisih menahan PDF; backend tidak mengubah baseline atau membuat penyesuaian otomatis.
- Tanggal kalender dibaca/ditulis sebagai serial Sheets tanpa pergeseran zona waktu. Pengaturan zona waktu workbook lama dipertahankan; batas tanggal hari ini pada aplikasi memakai Asia/Jakarta.
- Saat aktif, server memeriksa pembukuan dan memperbarui PDF sekitar lima menit, baik dari simpan aplikasi maupun edit manual di Sheet. Tombol **Perbarui PDF** tersedia jika perlu segera. Pada hosting gratis, QStash memanggil backend Vercel dan Redis menyimpan status, token, sesi, serta lock bersama. Signature yang sama melewati ekspor ulang. Browser dan komputer pengguna boleh ditutup.

## Input suara

Buka **Isi dengan suara** pada Transaksi Baru, lalu **Mulai**. Ucapkan satu transaksi dan tunggu hasilnya, atau tekan **Hentikan**. Teks sementara tidak mengubah form. Periksa nominal, dana, jenis, tanggal, bendahara, dan keterangan pada pratinjau; perbaiki kolom **Ucapan / hasil dikte**, lalu **Periksa teks** jika perlu. **Gunakan draf** mengganti isian form, kemudian **Simpan transaksi** tetap harus ditekan secara terpisah.

Contoh: “Infaq Jumat satu juta lima ratus ribu kemarin bendahara Kevin” atau “Pengeluaran PHBI konsumsi 250 ribu bendahara Wawan”. Nominal menerima angka lengkap, `1.250.000`, `1,5 juta`, `2 jt 350 rb`, dan gabungan kata hingga miliar. Angka jumlah barang dipertahankan dalam keterangan. Ucapkan nominal akhir untuk satu transaksi; ucapan dengan beberapa nominal atau format ambigu perlu diperjelas, bukan dihitung otomatis. Pecahan Rupiah, nominal negatif/tidak aman, tanggal invalid/masa depan, serta metadata yang bertentangan ditahan. Nominal yang tidak terbaca mengosongkan jumlah saat draf diterapkan agar nilai lama tidak terpakai.

K1/K2/K3 dan “ka satu/kode dua” dikenali. Nama pemegang dapat disebut di awal kalimat atau bersama “bendahara/pemegang uang”; nama donor dalam keterangan tidak otomatis menjadi bendahara. Dana, jenis, tanggal, dan bendahara yang tidak disebut mengikuti form dan ditandai dalam pratinjau. “Kemarin” mengikuti kalender Jakarta dari server. Perubahan form setelah pratinjau meminta pemeriksaan ulang. Memilih dana lain lewat draf memuat dashboard dana tersebut sebelum menerapkan isian.

Jika suara browser tidak tersedia, gunakan mikrofon keyboard iPhone pada kolom ucapan, atau ketik/tempel teks lalu **Periksa teks**. [Safari memakai layanan pengenalan Siri](https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/) dan akses dapat bergantung pada pengaturan perangkat/izin browser. Audio dapat diproses penyedia browser; aplikasi tidak merekam atau menyimpan audio di server. Fitur ini tidak menjanjikan pengenalan offline atau akurasi transkripsi sempurna. Perekaman berhenti saat aplikasi ditinggalkan, dan kegagalan/timeout memberi petunjuk untuk mencoba kembali. Kiriman yang belum terkonfirmasi harus diselesaikan sebelum memakai suara.

## Hapus beberapa transaksi

Pada **Rincian bulan ini**, klik **Pilih banyak**. Centang transaksi atau **Pilih semua hasil (maks. 50)**, lalu **Hapus terpilih**. Pilihan mengikuti dana, bulan, pencarian, dan jenis yang terlihat; mengganti filter mengosongkan pilihan. Transaksi yang termasuk hitung fisik terakhir tetap terkunci. Periksa daftar dan isi alasan sebelum konfirmasi. Setiap catatan dapat dikembalikan melalui **Transaksi dihapus → Pulihkan**.

Penghapusan diproses satu per satu dengan UUID dan versi baris masing-masing. Hasil yang sudah terkonfirmasi tetap berlaku saat dijeda atau terhenti. Jika koneksi putus atau aplikasi dimuat ulang, pilih **Lanjutkan penghapusan** untuk meneruskan kiriman yang sama. **Batalkan sisa** memeriksa status terakhir sebelum melepas antrean; hasil yang sudah terhapus tidak otomatis dipulihkan. Jika transaksi berubah di Sheet saat mengantre, proses berhenti agar versi terbaru tidak tertimpa. Antrean yang belum selesai disimpan di browser perangkat ini; lanjutkan atau batalkan sebelum menghapus data browser maupun mencatat transaksi lain.

## Impor CSV

Klik **Impor CSV** pada kartu Transaksi Baru, lalu **Unduh template CSV**. Template hanya berisi header: `Tanggal;Dana;Jenis;Bendahara;Keterangan;Jumlah`. Isi di Excel/Google Sheets dan simpan sebagai **CSV UTF-8**. File `.xlsx`, foto, dan PDF belum diterima. Tanggal menerima `DD/MM/YYYY` atau `YYYY-MM-DD`; dana `MASJID`/`PHBI`; jenis `Pemasukan`/`Pengeluaran`; bendahara `K1`/`K2`/`K3`; jumlah Rupiah bulat seperti `50000` atau `50.000`. Pemisah koma dan titik koma didukung; isi kolom yang mengandung pemisah harus dikutip sesuai CSV.

Maksimal 50 transaksi dan 64 KB per file. Pratinjau memeriksa aturan pembukuan yang sama tanpa menulis ke Sheet. Baris invalid tidak dapat dipilih. Baris dengan tanggal/dana/jenis/bendahara/keterangan/nominal identik terhadap jurnal aktif atau baris sebelumnya ditandai dan tidak dipilih otomatis; transaksi nyata yang memang sama boleh dipilih secara eksplisit.

Impor menyimpan transaksi terpilih satu per satu melalui endpoint simpan yang sudah terverifikasi, dengan progres, jeda, dan UUID per baris. Impor bukan transaksi atomik satu file: transaksi yang sudah terkonfirmasi tetap ada jika proses berhenti. Daftar yang belum selesai disimpan privat di browser agar reload atau respons hilang dapat dilanjutkan dengan UUID yang sama. Gunakan **Lanjutkan impor**, jangan memulai kiriman pengganti. **Batalkan sisa impor** memeriksa status kiriman yang belum terkonfirmasi terlebih dahulu; transaksi yang sudah tersimpan tidak dihapus. PDF mengikuti jadwal biasa.

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
| `server/changes.ts` | Edit/hapus/pulihkan, versi baris, dan riwayat perubahan |
| `server/google.ts`, `server/workbook.ts` | Adapter Google dan template |
| `server/service.ts` | Dashboard, simpan, serialisasi, publikasi |
| `server/auth.ts`, `server/state.ts` | OAuth, CSRF, token, volume, lock |
| `server/main.ts`, `server/cloud.ts`, `api/index.js` | Server lokal atau function Vercel |
| `apps-script/`, `index.html` | Versi lama untuk regresi dan rollback |
| `tests/standalone/` | Tes backend dan browser baru |

Server melayani UI baru dari `public/`. Membuka HTML lama atau menerbitkan HTML saja tidak menjalankan backend. Secret, token, ID privat, baseline, handoff, dan snapshot asli tidak boleh masuk repo publik.

Audit terbaru dan cara mengulang pengujian: [docs/AUDIT.md](docs/AUDIT.md). Uji pemulihan koneksi/sesi tersedia melalui `npm run test:recovery`.
