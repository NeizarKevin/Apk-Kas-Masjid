# Menjalankan server terus-menerus

Backend, sesi pemilik, antrian tulis, dan polling lima menit berjalan dalam satu proses Node.js. Browser boleh ditutup. Server dan volume token harus tetap hidup; hosting yang tidur atau fungsi serverless tidak cocok untuk mode ini.

## Lokal

Gunakan Node.js 22.16 atau lebih baru. Jalankan `npm ci`, `npx playwright install chromium`, `npm run demo`. Demo hanya mendengarkan localhost, memakai data sintetis, dan menyimpan data di `.state-demo`; tidak membutuhkan OAuth.

Untuk file asli: siapkan `.env`, `npm run build`, `npm start`, lalu login pemilik. Token terenkripsi disimpan di `STATE_DIR`. Cadangkan volume dan `TOKEN_ENCRYPTION_KEY` secara privat; keduanya diperlukan untuk koneksi offline. Restart server mengakhiri sesi browser, tetapi koneksi Google dan polling tetap pulih dari volume.

## Hosting

Belum ada penyedia hosting yang dipilih atau dipasang. Pilih mesin atau container yang selalu hidup, satu proses/replica, penyimpanan lokal persisten, dan reverse proxy HTTPS. Pastikan kebijakan biaya, tidur otomatis, CPU/memori untuk render PDF, dan volume layanan yang dipilih sebelum cutover. Polling dilakukan proses sendiri sekitar lima menit; bukan janji cron paket gratis.

Dockerfile menyediakan build server produksi. Build: `docker build -t kas-masjid .`. Jalankan satu container dengan `.env` privat, volume persisten `/data`, restart policy `unless-stopped`, dan port di belakang reverse proxy. Jangan gunakan demo pada hosting publik. Dockerfile produksi tidak memasang Chromium karena PDF asli diekspor dari Google; render audit memakai PDF.js dan canvas.

`APP_ORIGIN` harus URL HTTPS final dan OAuth redirect harus sama persis dengan `<APP_ORIGIN>/auth/callback`. Proxy harus mempertahankan header Host dan hanya meneruskan permintaan untuk domain aplikasi. Cookie bersifat HttpOnly, SameSite=Lax, Secure pada HTTPS; semua perubahan meminta token CSRF dan Origin yang cocok. Pemeriksaan `/healthz` perlu header Host sesuai APP_ORIGIN.

Penguncian proses di STATE_DIR menolak server kedua pada volume yang sama. Volume terpisah tidak memberikan penguncian bersama: jangan menjalankan beberapa replica/worker atau proses otomatisasi lain yang menulis file asli. Jika perlu skala tersebut, implementasikan penguncian bersama terlebih dahulu.

## Cutover

1. Apps Script lama tetap aktif untuk rollback selama pembangunan. Saat menguji write backend baru, hentikan input di aplikasi lama agar kedua runtime tidak berlomba memilih baris.
2. Hubungkan OAuth pemilik dan pastikan verifikasi read-only semua ID, header, metadata, zona waktu, hak edit, dan izin PDF berhasil.
3. Biarkan `AUTO_PUBLISH_ENABLED=false`. Buat pratinjau pada file privat lama; periksa semua halaman dan bandingkan hasil pembukuan.
4. Uji transaksi nyata yang memang akan dicatat, termasuk baca ulang dan UUID retry. Jangan memasukkan transaksi dummy ke Sheet produksi. Rekonsiliasi transaksi di Sheet asli.
5. Jika hasil sesuai, aktifkan publikasi di server (`AUTO_PUBLISH_ENABLED=true`) dan hentikan publikasi/trigger Apps Script lama lewat `disableAutomation`. Jangan biarkan dua penerbit PDF berjalan bersamaan. Aplikasi lama dan versi deployment tetap tersedia untuk rollback.
6. Periksa PDF lewat QR lama, izin, checksum, periode, rincian, dan arsip privat. Tutup browser, edit transaksi yang memang perlu dikoreksi di Sheet, lalu pastikan polling server mendeteksi perubahan.

Sheet dan Drive tidak memiliki transaksi atomik lintas layanan; edit manual tepat setelah pemeriksaan terakhir bisa muncul pada polling berikutnya. Backend menahan publikasi saat sumber berubah selama ekspor atau saldo tidak cocok. Jangan mengubah baseline untuk menutup selisih.

Rollback: matikan publikasi server baru, hentikan input baru, dan aktifkan lagi aplikasi/otomatisasi lama yang sesuai. Catatan KAS_APP_V1 tetap kompatibel; tidak perlu memindahkan transaksi atau mengubah QR.
