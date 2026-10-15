# Audit aplikasi, 15 Oktober 2026

Audit mencakup alur UI → API → Sheets → laporan/PDF, akses pemilik, OAuth/sesi, enkripsi/shared lock, pemulihan kiriman, impor, koreksi/hapus/pulihkan, input suara, tampilan HP/desktop, konfigurasi deployment, dan dependensi. Beban yang dituju tetap satu pemilik dengan beberapa sesi browser, maksimal 50 transaksi per antrean, serta pemeriksaan server lima menit. Tidak menambah layanan atau dependensi.

## Temuan dan perbaikan

| Prioritas | Pemicu dan akibat sebelumnya | Perbaikan dan bukti |
| --- | --- | --- |
| P1 | Baris yang sudah dihapus di aplikasi diisi kembali langsung di Sheet, sementara note cadangannya tertinggal. Baris dapat tampil sebagai aktif sekaligus dihapus; pemulihan berikutnya berpotensi menimpa isi manual. | Pembacaan sumber menolak konflik ini dengan lokasi A:F yang tepat, termasuk formula yang menghasilkan teks kosong. Pencatatan, koreksi, dan publikasi berhenti sampai isi/note dicocokkan di Sheet. Uji MASJID dan PHBI memastikan sumber tidak berubah dan tidak ada publikasi. |
| P1 | Pemeriksaan nominal PDF memakai pencarian potongan teks: `1.500.000` dapat dianggap memenuhi nominal `500.000`. PDF usang dengan saldo akhir sama bisa lolos. | Nominal harus ditemukan sebagai angka utuh. PDF sintetis dengan angka salah ditolak; kontrol dengan angka benar, PDF demo tiga/delapan halaman, dan PDF asli tiga halaman lolos. |
| P2 | Koreksi tertunda dipulihkan setelah pemuatan dashboard; kegagalan baca pertama membuat dialog tidak dapat dibuka lagi hanya dengan tombol Muat ulang. | Identitas koreksi dipulihkan terlebih dahulu, kemudian dialog dibuka setelah data segar tersedia. Uji 503 saat pembukaan → Muat ulang → periksa status tidak mengirim mutasi. |
| P2 | Respons 401 di dialog koreksi menampilkan login di belakang modal yang tidak boleh ditutup karena kiriman belum terkonfirmasi. Indikator koneksi masih terlihat aktif. | Respons 401 menutup dialog, menampilkan login, dan mengunci pencatatan. Draf/UUID tetap tersimpan. Uji masuk kembali dan kirim ulang memakai UUID yang sama serta satu perubahan tersimpan. |
| P2 | Koneksi putus saat Keluar menghasilkan promise rejection tanpa pesan yang dapat ditindaklanjuti. | Timeout dan penanganan kegagalan menampilkan instruksi mencoba kembali. Uji memastikan sesi tidak dinyatakan sudah keluar saat permintaan gagal. |
| P3 | Memilih bulan lampau masih menampilkan label “bulan ini”, meskipun nominal sudah mengikuti filter. | Label pemasukan, pengeluaran, dan rincian menyebut bulan/tahun pilihan. Uji September 2026 menghasilkan rincian dan nominal periode tersebut. |

Uji baru untuk pemulihan dashboard, konflik baris yang dihapus, dan pencocokan nominal PDF gagal pada implementasi sebelum diperbaiki. Perbaikan berada pada kode bersama yang dipakai semua pemanggil, tanpa perubahan saldo pembukaan atau ID Sheet/PDF/QR.

## Verifikasi

- `npm test`: build TypeScript dan **99 tes lulus**, termasuk 44 regresi Apps Script lama.
- `npm run test:browser`: Chromium, alur login/simpan/retry/edit/hapus/pulihkan, impor, hapus banyak, PDF tiga halaman dan delapan halaman, serta lebar 320/390/768/1280/1440 px.
- `npm run test:layout`: **24 kombinasi WebKit/Chromium**, locale en-US/id-ID dan viewport HP/landscape/desktop; batas kontrol, tanggal, filter bulan, dropdown, serta footer dialog.
- `npm run test:voice`: WebKit/Chromium dengan pengenal suara tiruan; pratinjau/penerapan/simpan terpisah, angka/tanggal, PHBI, fallback, izin/koneksi, timeout, dan callback lama.
- `npm run test:recovery`: WebKit/Chromium; gagal baca awal, koreksi tertunda, sesi kedaluwarsa di modal, login ulang dengan UUID yang sama, label periode, dan kegagalan logout. Tidak ada galat JavaScript tak tertangani.
- `npm audit` dan `npm audit --omit=dev`: **0 kerentanan yang tercatat** pada dependensi terpasang saat audit; ini bukan jaminan terhadap kerentanan yang belum terungkap.
- Sumber asli diperiksa baca saja: akses target cocok, rekonsiliasi berhasil, hash jurnal sebelum/sesudah sama, checksum PDF publik cocok, dan ketiga halaman A4 lolos pemeriksaan nominal yang diperketat. Tidak ada transaksi dummy, edit, hapus, pulihkan, atau impor pada jurnal produksi.

Artefak otomatis disimpan di `test-results/` yang diabaikan Git. Snapshot/audit sumber asli tetap privat di luar repo publik. Pemeriksaan deployment mencocokkan commit, HTML, CSP, endpoint anonim, dan log server setelah rilis.

## Batas

Mikrofon, izin Siri, keyboard/pemilih tanggal UIKit, dan instalasi home screen belum diuji pada iPhone fisik. Browser WebKit di Windows tidak menggantikan pemeriksaan tersebut. Uji mutasi memakai demo/mock; penulis manual di Sheet tidak mengikuti lock backend, sehingga edit tepat setelah pemeriksaan terakhir masih merupakan batas integrasi Sheets. Paket gratis memiliki kuota tanpa SLA. Tidak ada jaminan bahwa pengujian ini menemukan seluruh kemungkinan bug.
