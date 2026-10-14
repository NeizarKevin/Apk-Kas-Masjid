# Verifikasi migrasi

Dibangun dari remote `main` commit `48d3f02258d1a6526c66f5b0bb82b46e746bb541`, branch `migration/standalone-node`.

## Cakupan

- Build TypeScript dan 76 tes otomatis, termasuk regresi 44 tes lama. Regresi zona waktu memastikan nomor tanggal kalender Sheet tetap sama dengan pengaturan workbook lama.
- Adapter: jurnal tunggal, write A:F, formula sebagai teks, PHBI null, metadata, UUID, checkpoint, template, target ID lama, checksum, dan izin.
- Layanan: retry bersamaan, restart, respons hilang sesudah commit, koreksi tanggal lama, PDF gagal setelah simpan, sumber berubah, signature, dan PHBI terpisah.
- Koreksi: edit/hapus/pulihkan pada baris yang sama, note cadangan, alasan dan riwayat, UUID perubahan setelah respons putus, konflik versi, larangan perpindahan dana, proteksi checkpoint, dan kompatibilitas parser Apps Script lama. Browser juga menguji pencarian serta retry perubahan setelah reload.
- Keamanan: endpoint anonim, CSRF/Origin, PKCE/state, email berbeda, rotasi sesi, token terenkripsi terikat pemilik, request size, Host, CSP akhir baris Windows.
- Chromium nyata pada 390 × 844 dan 1280 × 900: login/logout, form, PHBI, UUID sesudah respons diputus, teks literal, pratinjau tiga halaman, dan delapan halaman rincian panjang dengan header lanjutan.
- Semua halaman PDF contoh dirender dan diperiksa visual. PDF publik asli juga diperiksa baca saja: tiga halaman A4, isi cocok dengan jurnal dan checkpoint saat pembacaan. Snapshot dan nominal asli disimpan privat di luar Git.

## Batas bukti

OAuth Client web sudah dibuat dan dipasang pada konfigurasi lokal privat. Login Google pemilik, verifikasi seluruh target asli, pembacaan kas/PHBI, penyimpanan token terenkripsi, dan pembacaan ulang dari proses baru sudah diuji. Zona waktu workbook lama dipertahankan; tanggal kalender dibaca dari serial Sheets tanpa menggeser hari.

Ekspor native melalui workbook laporan asli dan upload ke PDF pratinjau privat lama berhasil. Ketiga halaman A4 diperiksa isi serta visualnya. Hash snapshot jurnal sumber, checksum PDF publik, dan izinnya sama sebelum/sesudah pengujian. Tidak ada transaksi contoh yang ditulis ke sumber asli.

Write transaksi/edit/hapus/pulihkan pada sumber asli dan pergantian PDF publik belum dilakukan. Publikasi otomatis backend masih dimatikan; Apps Script lama tetap dipertahankan sampai cutover. Hosting belum dipilih. OAuth masih berstatus Testing; izin offline dapat kedaluwarsa setelah tujuh hari dan perlu dihubungkan ulang.

Mock bukan bukti API Google menerima penulisan transaksi produksi. Uji mutasi browser menggunakan demo dan PDF sintetis; koneksi nyata diuji untuk baca data dan pratinjau privat. Pekerja demo terbukti membuat PDF tanpa sesi browser; jadwal lima menit pada hosting tetap harus diuji setelah deployment. Dockerfile disiapkan untuk satu proses dengan volume; pengujian container memerlukan daemon Docker aktif.

Ulangi `npm test` dan `npm run test:browser`. Artefak berada di `test-results/`, diabaikan Git. Ikuti koneksi OAuth dan cutover dalam README serta DEPLOYMENT sebelum menggunakan data asli.
