# Kas Masjid: input transaksi dan pembaruan PDF

Versi Apps Script untuk memasukkan transaksi dari HP, menyimpannya di Google Sheet utama, lalu memperbarui isi PDF publik yang sudah digunakan QR masjid. Tidak memerlukan website laporan baru. PDF tetap memakai file ID dan tautan yang sama.

Antarmuka hijau dan input suara aplikasi lama tetap menjadi dasar. `index.html` dan `apps-script/Index.html` sekarang identik. Data bersama dibaca melalui deployment Apps Script lama; halaman GitHub menyediakan tombol untuk membuka aplikasi Google. Form hanya aktif setelah data server berhasil dimuat. Riwayat lokal lama tidak dipakai untuk menghitung saldo atau dikirim ulang secara otomatis.

## Perilaku

- Pilih kas masjid atau PHBI, pemasukan atau pengeluaran, tanggal, K1/K2/K3, keterangan, dan jumlah.
- Kas masjid ditambahkan ke tab pemasukan/pengeluaran terpisah. PHBI ditambahkan ke tabel RAW PHBI dan tidak dimasukkan ke PDF kas masjid.
- Periode baru memakai hasil hitung fisik saat sinkronisasi sebagai saldo awal. Hanya transaksi sesudah hitungan tersebut yang masuk rincian aplikasi dan PDF; semua baris lama tetap disimpan di Sheet sebagai arsip. Saldo awal dibekukan saat konfigurasi, sehingga hitungan fisik berikutnya tidak mengubah awal laporan secara diam-diam.
- Selisih lama tidak dibukukan sebagai pemasukan. Validasi transaksi, total laporan, dan pencocokan terhadap hitungan fisik berikutnya tetap berjalan; selisih baru menahan PDF sampai dicocokkan. Mode historis sejak Mei masih tersedia melalui `REPORT_MODE=HISTORICAL`, bila memang diminta.
- Penyimpanan memakai ID kiriman dan baca ulang server. Kirim ulang sesudah respons terputus tidak menambah transaksi yang sama dua kali. Keterangan ditulis sebagai teks literal, termasuk jika diawali `=`.
- Saat otomatisasi aktif, input aplikasi memproses laporan setelah transaksi tersimpan. Perubahan langsung di Sheet diperiksa sekitar setiap 5 menit. Jadwal Google dapat bergeser; pembaruan tidak dijanjikan tepat pada detik tertentu.
- Laporan yang tidak berubah tidak diekspor ulang. Kode bendahara hanya untuk pembukuan internal dan tidak muncul dalam rincian PDF publik.
- `Drive.Files.update` mengganti konten PDF yang sama. Tidak membuat file publik, mengubah izin berbagi, atau mengganti QR.

## Pemasangan satu kali

Gunakan akun Google yang dapat mengedit Sheet sumber, workbook laporan, dan PDF publik.

1. Gunakan proyek **Kas Masjid API** yang deployment-nya sudah dipakai `index.html`. Cocokkan deployment ID dengan `SCRIPT_URL` sebelum mengubahnya. Cadangkan kode lama dan catat versi deployment aktif untuk rollback. Jangan membuat proyek atau deployment pengganti.
2. Ganti handler lama di `Code.gs` dengan tiga file kode `Model.gs`, `Code.gs`, dan `Report.gs`, serta tambahkan file HTML `Index`. Ketiga file `.gs` juga boleh digabung dalam satu `Code.gs`. Jangan menyisakan dua fungsi `doGet`. Versi deployment lama tetap tersimpan sampai deployment yang cocok diperbarui.
3. Tampilkan manifest melalui **Project Settings → Show appsscript.json** dan salin `apps-script/appsscript.json`. Manifest mengaktifkan layanan Google Sheets v4 dan Google Drive v3. Jika menggunakan proyek Google Cloud standar, aktifkan kedua API pada proyek tersebut.
4. Isi **Script Properties** berikut dengan ID file asli yang digunakan pembukuan. Jangan masukkan ID file ke HTML atau repositori publik. URL deployment aplikasi lama adalah pintu masuk, bukan kredensial. Token OAuth tidak boleh disimpan di repo.

| Property | Nilai |
| --- | --- |
| `SOURCE_SPREADSHEET_ID` | ID Google Sheet pembukuan utama |
| `REPORT_SPREADSHEET_ID` | ID workbook template laporan publik |
| `PUBLIC_PDF_ID` | ID PDF lama yang dituju QR; jangan gunakan PDF baru |

5. Jalankan `configureApp` dari editor dan selesaikan izin Google. Fungsi ini memeriksa sumber, saldo sinkronisasi, template, dan hak edit PDF, tanpa mengganti PDF. Akun yang menjalankan menjadi pemilik aplikasi. Pada pemasangan baru, `REPORT_MODE=NEW_PERIOD` menjadi default dan saldo fisik disimpan di `REPORT_BASELINE` serta `PHBI_REPORT_BASELINE`; jangan mengisi nominal baru ke tabel pemasukan untuk mewakili saldo awal.

Tanggal awal yang disetujui untuk pemasangan ini adalah 8 Oktober 2026 (`NEW_PERIOD_START_DATE=2026-10-08`). Jika Sheet sudah memiliki hitungan fisik yang lebih baru saat pemasangan pertama, masukkan snapshot saldo 8 Oktober ke `REPORT_BASELINE` dan `PHBI_REPORT_BASELINE` dari blok arsip sinkronisasi yang sesuai. Konfigurasi akan berhenti jika hanya hitungan terbaru yang tersedia, agar awal periode tidak bergeser tanpa permintaan.
6. **Deploy → Manage deployments**, pilih deployment yang ID-nya persis sama dengan `SCRIPT_URL`, lalu **Edit → New version**. Pilih **Execute as: Me** dan **Who has access: Only myself**. Perbarui deployment itu sehingga URL aplikasi lama tetap sama. Buka URL tersebut dengan akun yang sama. Aplikasi versi ini khusus akun pemilik; pilihan K1/K2/K3 menentukan pemegang uang dan bukan izin masuk akun bendahara lain.
7. Periksa bahwa tanggal dan nominal saldo awal adalah hasil hitung fisik yang disetujui. Selisih periode lama tidak menjadi penghalang pada mode periode baru. Jika pencocokan sesudah awal periode baru berstatus **Ditahan**, periksa transaksi berdasarkan bukti, lalu muat ulang aplikasi.
8. Klik **Pratinjau**, lalu buka PDF pratinjau. Periksa semua halaman: A4 portrait, nominal, subtotal, transaksi terakhir, periode, dan tabel tidak terpotong. Pratinjau memakai satu file PDF privat di Drive yang dipakai ulang melalui `PRIVATE_PREVIEW_PDF_ID`. Izin pemilik dan checksum diperiksa; file ini tidak sama dengan PDF publik dan tidak dibagikan ke jamaah.
9. Setelah pratinjau sesuai, jalankan `activateAutomation` sekali dari editor. Fungsi ini memasang pemeriksaan berkala dan trigger edit secara idempotent, serta menjalankan pembaruan pertama dengan validasi yang sama. Periksa PDF publik lewat tautan aplikasi. Tambahkan URL aplikasi ke layar utama HP jika diinginkan.

Otorisasi Google dan deployment adalah langkah terpisah dari pengujian kode. Menambahkan kode ke GitHub tidak mengaktifkan aplikasi atau trigger Google.

## Sumber dan periode baru

Setiap pemeriksaan membaca header seluruh tab. Tabel transaksi masjid yang diterima mempunyai empat header `Tanggal | Kode | Keterangan | Pemasukan` atau `Tanggal | Kode | Keterangan | Pengeluaran`. Tabel gabungan/RAW dengan kedua kolom arus kas tidak dihitung lagi. Tab periode baru dengan struktur ini otomatis ikut laporan; periode bertumpuk ditahan agar data tidak dihitung dua kali.

`configureApp` menyimpan ID tab tujuan input, sehingga penggantian nama tab tidak merusak pencatatan. Jika membuat tab periode baru untuk menerima input aplikasi, ubah `WRITE_INCOME_SHEET_ID` dan `WRITE_EXPENSE_SHEET_ID` ke ID tab baru setelah memastikan headernya. Jika ingin satu tab pemasukan dan satu tab pengeluaran yang terus memanjang, tidak perlu membuat periode baru.

Property opsional `PHBI_SHEET_ID` dan `SYNC_SHEET_ID` diisi dari tab RAW PHBI dan REKAP CHAT saat konfigurasi pertama. Tab sinkronisasi harus memiliki blok terbaru `Tanggal | Dana | K1 | K2 | K3 | Total`, diikuti baris kas masjid dan PHBI. Saldo PHBI bendahara lain yang belum dihitung tetap kosong; aplikasi menjelaskan bahwa saldo tersebut baru mencakup uang yang dikonfirmasi.

Untuk pemisahan dana pada tab dengan header empat kolom, developer metadata `KAS_DANA` dapat ditetapkan ke `MASJID` atau `PHBI`. Tab bernama PHBI/Ramadhan tanpa penanda dana tidak boleh ikut laporan masjid.

## Sinkronisasi dan koreksi

- Histori lama tetap tersimpan. Pembagian uang antarbendahara pada sinkronisasi tidak dianggap pemasukan/pengeluaran masjid.
- Infaq kotak yang dibuka sebelum hitung fisik sudah termasuk saldo awal dan tidak dihitung lagi sebagai pemasukan periode baru. Jika belum ada transaksi baru, bagian rincian menampilkan pesan kosong, subtotal nol, dan total nol; saldo kas tetap sebesar uang fisik, bukan nol.
- `REPORT_BASELINE` dan `PHBI_REPORT_BASELINE` adalah konfigurasi privat di Apps Script. Jangan menghapus atau mengubahnya setiap kali sinkronisasi. Perubahan itu berarti memulai periode lain dan harus diminta secara khusus.
- Transaksi sebelum tanggal hitung fisik perlu dicocokkan langsung di Sheet. Form aplikasi menerima tanggal sinkronisasi sampai hari ini.
- Input aplikasi pada hari sinkronisasi diberi penanda bahwa transaksi terjadi sesudah hitung fisik. Transaksi manual di Sheet pada tanggal yang sama dianggap sudah termasuk hitungan fisik, kecuali penandanya dibuat oleh aplikasi. Catat transaksi sesudah hitung fisik pada hari yang sama melalui aplikasi agar tidak rancu.
- Jangan menyalin catatan ID kiriman saat menduplikasi baris. Dua transaksi nyata dengan tanggal, keterangan, dan nominal sama tetap dihitung sebagai dua transaksi; hanya ID aplikasi yang sama ditolak.
- Jika respons simpan terputus, gunakan **Kirim ulang transaksi**. **Periksa kiriman sebelumnya** memastikan kiriman sudah/belum tersimpan di server sebelum form dapat diperbaiki.
- Koreksi transaksi tersimpan dilakukan di Sheet, bukan dengan menghapus riwayat lokal aplikasi. Pemeriksaan berikutnya mendeteksi perubahan isi laporan.
- `disableAutomation` menghentikan publikasi otomatis. Pencatatan transaksi tetap tersedia; trigger yang tertinggal akan berhenti sebelum bekerja.

## Validasi sebelum publikasi

Total detail, total ringkasan, saldo setiap bulan, dan saldo akhir direkonsiliasi. Workbook laporan dibaca ulang dari API dan dibandingkan dengan model. PDF harus memiliki header PDF, ukuran A4 portrait, dan minimal tiga halaman untuk tiga bagian. Sumber dibaca ulang sebelum unggah untuk mendeteksi edit selama proses. Sesudah unggah, aplikasi memeriksa file ID, MIME type, ukuran, MD5, dan waktu perubahan.

Kegagalan sebelum unggah mempertahankan PDF publik. Kegagalan verifikasi sesudah unggah ditandai sebagai error, bukan klaim sukses; periksa versi file di Drive. Perubahan manual yang terjadi persis setelah pemeriksaan terakhir dapat tertangkap pada pemeriksaan berikutnya, karena Google Sheets dan Drive tidak menyediakan satu transaksi atomik lintas layanan.

Export memakai gaya template laporan yang ada dan hanya tiga tab laporan publik. Kode tidak mengedit, memindahkan, atau menghapus transaksi sumber yang sudah ada; hanya menambahkan transaksi yang dikirim pengguna dan memperluas rentang filter tanpa mengubah kriterianya.

## Tampilan ringkas

Pilihan dana dan bulan berada di header. Ringkasan memakai nominal Rupiah lengkap; saldo tidak dihitung dari perangkat lokal. Form pemasukan/pengeluaran, K1/K2/K3, dan input suara memakai antarmuka lama. Kontrol pratinjau privat dan pembaruan manual berada di **Opsi laporan**. Suara mengisi draf saja; pengguna memeriksa nominal lalu menekan simpan. Dukungan mikrofon bergantung pada browser dan iframe Google; input manual selalu tersedia.

## Pengujian

Jalankan `npm test` atau `node --test tests/*.test.cjs` dengan Node.js 20 atau lebih baru. Tes menggunakan data sintetis dan mock Google, tanpa menulis ke Sheet/PDF asli. Cakupan meliputi parsing data, pemisahan sumber, saldo bulan, checkpoint, deduplikasi kiriman, retry client, teks literal, validasi PDF, pengaman selisih saldo, perubahan sumber selama ekspor, serta pembaruan file ID yang sama.

Pengujian browser Google Apps Script, otorisasi, ekspor Google yang sebenarnya, dan penampilan PDF seluruh halaman harus dilaksanakan saat pemasangan. Tes mock tidak menggantikan pemeriksaan tersebut.
