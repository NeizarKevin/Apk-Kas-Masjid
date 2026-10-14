# Deployment Kas Masjid

Aplikasi dapat berjalan sebagai satu server lokal/container dengan volume, atau sebagai function Vercel dengan Redis dan pemanggil jadwal QStash. Semua mode membaca Sheet dan menulis PDF pada ID asli yang sama.

## Hosting gratis

URL produksi: **https://kas-masjid-albarokah.vercel.app**. Gunakan URL ini untuk login; URL deployment sementara tidak menjadi OAuth redirect.

- Vercel **Hobby**, Node.js **24.x**, function di Singapore, durasi maksimum 300 detik.
- Upstash Redis **Free**, Singapore, tanpa eviction: hanya token, sesi, status/audit publikasi, dan lock; transaksi tetap di Sheet. Seluruh nilai privat memakai AES-256-GCM dengan kunci server dan nama record sebagai AAD.
- Upstash QStash **Free**, satu jadwal `kas-masjid-report-five-minutes`, cron `*/5 * * * *`, POST ke `/api/internal/poll`, timeout 295 detik, **retries 0**. Paket yang diprovisikan pada 14 Oktober 2026 membatasi 500 pengiriman/hari; jadwal normal memakai 288. Pemeriksaan berikutnya menangani kegagalan sementara.
- Tidak memakai kartu, trial berbayar, pay-as-you-go, atau upgrade otomatis. Kuota gratis dan kebijakan penyedia dapat berubah; jika habis, layanan dapat berhenti sampai reset. Jangan mengaktifkan upgrade sebagai perbaikan otomatis.

`vercel.json` membangun TypeScript lalu menyertakan HTML, worker/font PDF.js, dan canvas native Linux. Tidak ada Chromium pada jalur PDF produksi: Google mengekspor template, PDF.js/canvas memeriksa hasilnya.

## Konfigurasi privat

Isi variabel `.env.example` dengan target asli dan baseline handoff. Untuk Vercel tambahkan `KV_REST_API_URL`, `KV_REST_API_TOKEN`, dan `CRON_SECRET` acak minimal 32 karakter pada **Production saja**. `VERCEL=1` disediakan platform; aplikasi menolak startup tanpa shared state lengkap. `PUBLIC_PDF_ID` adalah ID PDF jamaah yang sudah publik dan dapat disimpan sebagai Config; credential, token, baseline, dan ID privat disimpan sebagai Secret. Jangan meletakkan nilai dalam argumen CLI, Git, log, atau screenshot.

`APP_ORIGIN` harus URL HTTPS final. OAuth client Web application memakai redirect `<APP_ORIGIN>/auth/callback`; redirect localhost dapat dipertahankan untuk pemulihan lokal. Backend memeriksa ID token/email pemilik sebelum menerima sesi atau token. Consent Google berstatus **In production** dan koneksi offline perlu diperbarui sesudah keluar dari Testing. Aplikasi pribadi yang belum diverifikasi Google masih dapat menampilkan peringatan saat login; akses backend tetap dibatasi pemilik.

Jadwal QStash mengirim `Authorization: Bearer <CRON_SECRET>` melalui header forwarding privat. Endpoint tanpa secret menolak akses. Jadwal tidak mengirim isi transaksi. `AUTO_PUBLISH_ENABLED=false` membuat pemanggilan jadwal tidak menyentuh Google, sehingga instalasi dapat diuji sebelum cutover. Lihat log pengiriman QStash untuk membedakan jadwal sukses, HTTP gagal, atau kuota habis.

Untuk aplikasi pribadi dengan satu pemilik, Google mengizinkan penggunaan tanpa proses verifikasi publik; peringatan login dapat tetap tampil. Lihat [pengecualian personal use Google](https://support.google.com/cloud/answer/13464323).

Token dan sesi Redis tetap tersedia lintas invocation/deployment. Nama record sesi memakai hash identitas cookie; isi sesi dienkripsi. Sesi berakhir setelah 12 jam atau logout; logout mencabut sesi di semua function. Cadangkan kunci enkripsi serta konfigurasi secara privat. Jika Redis atau kunci hilang, hubungkan ulang Google; jangan mengubah transaksi atau baseline untuk memulihkan akses.

Semua operasi dibatasi satu lock Redis per sumber. Lock berlaku 600 detik, lebih lama dari batas function 300 detik ditambah request Google maksimal 90 detik. Operasi berhenti mengirim request baru setelah 240 detik. Respons write yang terputus mempertahankan lock sampai kedaluwarsa; periksa UUID kiriman sebelum mengirim ulang. Jangan jalankan Apps Script atau aplikasi lain sebagai penulis/penerbit bersamaan.

Deploy setelah tes: `vercel deploy --prod --scope <team>`. Uji `/healthz`, `/api/session`, penolakan endpoint anonim, login pemilik, serta pratinjau native dari URL produksi. Secret hanya dipasang untuk Production; preview tidak boleh memakai target asli secara diam-diam.

## Lokal dan container

Gunakan Node.js 24.x, `npm ci`, `npx playwright install chromium`, lalu `npm run demo`. Demo hanya mendengarkan localhost dan memakai `.state-demo` sintetis.

Untuk data asli: siapkan `.env`, `npm run build`, `npm start`, lalu login pemilik. Tanpa Redis, jalankan **satu proses** dan volume `STATE_DIR` persisten. Token terenkripsi tetap ada setelah restart; sesi browser lokal berakhir saat restart. Proses sendiri melakukan polling lima menit jika publikasi aktif.

Docker: `docker build -t kas-masjid .`. Jalankan satu container non-root dengan konfigurasi privat, volume `/data`, restart policy `unless-stopped`, dan reverse proxy HTTPS. Jangan gunakan demo pada hosting publik. Proxy harus mempertahankan Host sesuai `APP_ORIGIN`. Tanpa Redis, volume yang berbeda tidak memberikan lock bersama.

## Cutover

1. Apps Script lama tetap aktif untuk rollback selama pembangunan. Saat menguji write backend baru, hentikan input di aplikasi lama agar kedua runtime tidak berlomba memilih baris.
2. Hubungkan OAuth pemilik dan pastikan verifikasi read-only semua ID, header, metadata, tanggal kalender, hak edit, dan izin PDF berhasil.
3. Biarkan `AUTO_PUBLISH_ENABLED=false`. Buat pratinjau pada file privat lama; periksa semua halaman dan bandingkan hasil pembukuan.
4. Uji transaksi nyata yang memang akan dicatat, termasuk baca ulang dan UUID retry. Jangan memasukkan transaksi dummy ke Sheet produksi. Rekonsiliasi transaksi di Sheet asli.
5. Jika hasil sesuai, aktifkan publikasi di server (`AUTO_PUBLISH_ENABLED=true`) dan hentikan publikasi/trigger Apps Script lama lewat `disableAutomation`. Jangan biarkan dua penerbit PDF berjalan bersamaan. Aplikasi lama dan versi deployment tetap tersedia untuk rollback.
   Untuk memakai edit/hapus/pulihkan, hentikan penggunaan form input Apps Script lama. Parser lama tetap membaca baris aktif yang sama, tetapi mekanisme retry lama tidak mengenali penanda transaksi yang dihapus oleh backend baru.
6. Periksa PDF lewat QR lama, izin, checksum, periode, rincian, dan arsip privat. Tutup browser, edit transaksi yang memang perlu dikoreksi di Sheet, lalu pastikan jadwal server mendeteksi perubahan.

Sheet dan Drive tidak memiliki transaksi atomik lintas layanan; edit manual tepat setelah pemeriksaan terakhir bisa muncul pada polling berikutnya. Backend menahan publikasi saat sumber berubah selama ekspor atau saldo tidak cocok. Jangan mengubah baseline untuk menutup selisih.

Rollback: matikan publikasi server baru, hentikan input baru, dan pulihkan deployment versi 15 dari daftar Archived pada Manage deployments. Jalankan `activateAutomation` hanya setelah backend baru benar-benar berhenti menerbitkan. Fungsi ini membuat kembali dua trigger lama. Catatan KAS_APP_V1 tetap kompatibel; tidak perlu memindahkan transaksi atau mengubah QR.
