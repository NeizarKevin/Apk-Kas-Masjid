# Verifikasi migrasi

Dibangun dari remote `main` commit `48d3f02258d1a6526c66f5b0bb82b46e746bb541`, branch `migration/standalone-node`.

## Cakupan

- Build TypeScript dan 92 tes otomatis, termasuk regresi 44 tes lama. Regresi zona waktu memastikan nomor tanggal kalender Sheet tetap sama dengan pengaturan workbook lama.
- Adapter: jurnal tunggal, write A:F, formula sebagai teks, PHBI null, metadata, UUID, checkpoint, template, target ID lama, checksum, dan izin.
- Layanan: retry bersamaan, restart, respons hilang sesudah commit, koreksi tanggal lama, simpan/koreksi tanpa ekspor PDF, kegagalan dan pemulihan pekerja PDF, status menunggu sesudah restart, sumber berubah, signature, dan PHBI terpisah.
- Koreksi: edit/hapus/pulihkan pada baris yang sama, note cadangan, alasan dan riwayat, UUID perubahan setelah respons putus, konflik versi, larangan perpindahan dana, proteksi checkpoint, dan kompatibilitas parser Apps Script lama. Browser juga menguji pencarian serta retry perubahan setelah reload.
- Keamanan: endpoint anonim, CSRF/Origin, PKCE/state, email berbeda, rotasi sesi, token terenkripsi terikat pemilik, request size, Host, CSP akhir baris Windows. Sesi 12 jam dan opsi 7 hari diuji dengan waktu maju; callback tidak dapat mengubah pilihan durasi, TTL mengikuti sesi, dan logout mencabut sesi di instance lain.
- Chromium nyata pada 390 × 844 dan 1280 × 900: login/logout, centang opsi 7 hari, buka ulang memakai cookie tersimpan tanpa login, form, PHBI, UUID sesudah respons diputus, status PDF menunggu, pembaruan PDF manual, teks literal, pratinjau tiga halaman, dan delapan halaman rincian panjang dengan header lanjutan. Pembukaan ulang ini simulasi browser; instalasi home screen di HP pengguna belum diuji langsung.
- Semua halaman PDF contoh dirender dan diperiksa visual. PDF publik asli juga diperiksa baca saja: tiga halaman A4, isi cocok dengan jurnal dan checkpoint saat pembacaan. Snapshot dan nominal asli disimpan privat di luar Git.

## Batas bukti

OAuth Client web sudah dibuat dan dipasang pada konfigurasi lokal privat. Login Google pemilik, verifikasi seluruh target asli, pembacaan kas/PHBI, penyimpanan token terenkripsi, dan pembacaan ulang dari proses baru sudah diuji. Zona waktu workbook lama dipertahankan; tanggal kalender dibaca dari serial Sheets tanpa menggeser hari.

Ekspor native melalui workbook laporan asli dan upload ke PDF pratinjau privat lama berhasil. Ketiga halaman A4 diperiksa isi serta visualnya. Hash snapshot jurnal sumber, checksum PDF publik, dan izinnya sama sebelum/sesudah pengujian. Tidak ada transaksi contoh yang ditulis ke sumber asli.

Aplikasi produksi berjalan di **https://kas-masjid-albarokah.vercel.app** pada Vercel Hobby, Redis Free, dan QStash Free. Login Google pemilik, pembacaan kas/PHBI, ekspor native melalui template asli, audit render tiga halaman di Vercel, dan upload PDF publik pada ID lama berhasil. Pemeriksaan terpisah melalui API membuktikan jurnal sumber tidak berubah, saldo cocok, checksum PDF sesuai, izin publik tetap sama, dan arsip privat cocok dengan PDF sebelumnya.

OAuth berstatus In production. Persetujuan offline pemilik diperbarui; respons grant baru tidak menyertakan batas refresh token tujuh hari. Kredensial disimpan terenkripsi di Redis dan cadangan lokal privat. Sesi tetap tersedia setelah deployment berubah. Backend menolak email selain pemilik; Google tetap dapat menampilkan peringatan aplikasi pribadi belum diverifikasi.

`disableAutomation` lama berhasil dijalankan. Dua trigger kas lama telah dihapus dengan izin pemilik; daftar trigger proyek menunjukkan nol. Deployment web app versi 15 diarsipkan untuk rollback. Project, kode, ledger, workbook laporan, arsip, dan PDF tidak dihapus. Server lokal pengujian dihentikan agar tidak menjadi penulis kedua.

Jadwal QStash setelah cutover berhasil mengirim HTTP 200 pada 14 Oktober 2026 pukul 22:20 WIB saat halaman aplikasi ditutup. Status bersama berubah menjadi UNCHANGED: backend membaca sumber, mengenali laporan yang sama, dan melewati ekspor ulang. Browser maupun server lokal tidak dibutuhkan oleh pemeriksaan ini.

## Pengujian shared state

Enam tes tambahan mencakup enkripsi record yang terikat nama, manipulasi ciphertext, TTL sesi, dua instance memperebutkan lock, penolakan write saat Redis gagal/deadline lewat, lease yang dipertahankan saat respons write hilang, sesi lintas instance, logout bersama, endpoint jadwal dengan secret, konfigurasi cloud yang menolak mode tidak aman, serta respons OAuth sesudah lock dilepas. Regresi OAuth juga memastikan grant baru tidak mewarisi metadata kedaluwarsa token Testing sebelumnya.

## Batas pengujian

Antarmuka Midnight diperiksa pada Chromium dengan lebar 320, 390, 768, 1280, dan 1440 piksel: posisi form/riwayat, batas kontrol, angka besar dan keterangan panjang, serta tombol dialog tetap berada dalam viewport termasuk layar 320 × 650. Susunan desktop memakai dua kolom; HP satu kolom tanpa penempatan grid paksa yang mendahulukan riwayat. Dialog memiliki satu area isi yang bergulir dan footer tindakan tetap terlihat.

Hapus banyak diuji pada data demo: pilih hasil pencarian, pengosongan pilihan saat filter berubah, pembatalan sebelum konfirmasi tanpa write, batas 50 dan baris terkunci, UUID yang sama setelah respons commit hilang dan reload, alasan tersimpan, dua tombstone tanpa riwayat ganda, pemulihan satu transaksi, jeda, konflik versi karena edit lain saat antrean berjalan, serta pemeriksaan status sebelum membatalkan sisa. Konflik menghasilkan satu HTTP 400 yang memang diharapkan dalam tes; tidak ada galat JavaScript. Tidak ada transaksi asli yang dihapus untuk pengujian.

Impor CSV diuji dengan pratinjau tanpa write, UTF-8 BOM, kutipan/newline, pemisah koma/titik koma, tanggal dan Rupiah, data invalid, batas ukuran/baris, kandidat duplikat, PHBI, respons simpan hilang, dan UUID saat retry. Endpoint template/pratinjau menolak akses anonim serta CSRF/Origin salah; batas JSON yang lebih besar hanya berlaku pada pratinjau impor. Browser HP/desktop juga membuktikan pratinjau tanpa write, kandidat duplikat tidak dicentang otomatis, teks literal, retry dengan UUID yang sama sesudah reload, jeda/lanjut, pembatalan sesudah respons hilang, dan PHBI terpisah. Tidak ada CSV contoh yang diimpor ke pembukuan produksi.

Tidak ada transaksi dummy, edit nominal, hapus, atau pemulihan yang dilakukan pada jurnal asli. Mutasi tersebut diuji dengan data sintetis dan mock API; penulisan Sheets nyata diuji melalui workbook laporan asli, tanpa mengubah pembukuan kas. Perubahan manual pada jurnal produksi tidak dibuat hanya untuk pengujian.

Paket gratis mempunyai kuota dan tidak menjamin SLA. Jika layanan berhenti, periksa dashboard Vercel/Upstash dan koneksi Google; jangan mengubah saldo pembukaan atau mengaktifkan layanan berbayar sebagai perbaikan otomatis.

Ulangi `npm test` dan `npm run test:browser`. Artefak sintetis berada di `test-results/`, diabaikan Git. Snapshot, konfigurasi, token, audit file asli, serta ID privat tidak masuk repository atau ZIP sumber.
