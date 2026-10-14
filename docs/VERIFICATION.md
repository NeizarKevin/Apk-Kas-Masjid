# Verifikasi migrasi

Dibangun dari remote `main` commit `48d3f02258d1a6526c66f5b0bb82b46e746bb541`, branch `migration/standalone-node`.

## Cakupan

- Build TypeScript dan 75 tes otomatis, termasuk regresi 44 tes lama.
- Adapter: jurnal tunggal, write A:F, formula sebagai teks, PHBI null, metadata, UUID, checkpoint, template, target ID lama, checksum, dan izin.
- Layanan: retry bersamaan, restart, respons hilang sesudah commit, koreksi tanggal lama, PDF gagal setelah simpan, sumber berubah, signature, dan PHBI terpisah.
- Koreksi: edit/hapus/pulihkan pada baris yang sama, note cadangan, alasan dan riwayat, UUID perubahan setelah respons putus, konflik versi, larangan perpindahan dana, proteksi checkpoint, dan kompatibilitas parser Apps Script lama. Browser juga menguji pencarian serta retry perubahan setelah reload.
- Keamanan: endpoint anonim, CSRF/Origin, PKCE/state, email berbeda, rotasi sesi, token terenkripsi terikat pemilik, request size, Host, CSP akhir baris Windows.
- Chromium nyata pada 390 × 844 dan 1280 × 900: login/logout, form, PHBI, UUID sesudah respons diputus, teks literal, pratinjau tiga halaman, dan delapan halaman rincian panjang dengan header lanjutan.
- Semua halaman PDF contoh dirender dan diperiksa visual. PDF publik asli juga diperiksa baca saja: tiga halaman A4, isi cocok dengan jurnal dan checkpoint saat pembacaan. Snapshot dan nominal asli disimpan privat di luar Git.

## Batas bukti

OAuth Client backend belum tersedia. Login OAuth nyata, write sumber asli, perubahan workbook asli, upload pratinjau asli, dan pergantian PDF publik belum dilakukan. Apps Script lama tetap dipertahankan. Hosting belum dipilih.

Mock bukan bukti API Google menerima request produksi. Browser menggunakan demo dan PDF sintetis. Pekerja demo terbukti membuat PDF tanpa sesi browser; jadwal lima menit pada hosting tetap harus diuji setelah deployment. Dockerfile disiapkan untuk satu proses dengan volume; pengujian container memerlukan daemon Docker aktif.

Ulangi `npm test` dan `npm run test:browser`. Artefak berada di `test-results/`, diabaikan Git. Ikuti koneksi OAuth dan cutover dalam README serta DEPLOYMENT sebelum menggunakan data asli.
