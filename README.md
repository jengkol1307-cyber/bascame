# Basecamp Pendakian

Fondasi aplikasi pengelolaan informasi pendakian dengan Next.js, Firebase, Google Drive melalui Apps Script, dan deployment Vercel dari GitHub.

## Menjalankan lokal

Gunakan Node.js 22 atau lebih baru.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Isi `.env.local` dengan konfigurasi Firebase dan GAS sebelum menggunakan login, dashboard, atau unggah dokumen. Halaman publik dapat dibuka tanpa kredensial.

## Firebase

1. Buat project Firebase; aktifkan Email/Password di Authentication, Firestore, dan Realtime Database.
2. Masukkan konfigurasi aplikasi web Firebase ke variabel `NEXT_PUBLIC_FIREBASE_*`.
3. Buat service account untuk Firebase Admin dan simpan seluruh JSON sebagai `FIREBASE_SERVICE_ACCOUNT_JSON`. Jangan pernah mengekspos atau memasukkan file service account ke Git.
4. Deploy `firestore.rules` ke Firestore dan `database.rules.json` ke Realtime Database. Rules client secara default menolak akses yang tidak diizinkan; operasi Admin SDK berjalan di server.
5. Jangan pernah menetapkan role dari browser. Role diberikan server menggunakan Firebase custom claims; endpoint operasional memeriksa role dan `basecampId`, sedangkan operasi Admin SDK tidak dilindungi oleh Firestore Rules.

Realtime Database disiapkan untuk status operasional cepat. Firestore menyimpan data aplikasi utama dan metadata dokumen; file dokumen tetap privat di Google Drive.

### Role staf dan akun Basecamp

Role internal menggunakan custom claim `role`:

- `superadmin`: membuat Basecamp dan akun Admin Basecamp.
- `basecamp_admin`: akses operasional penuh hanya untuk satu Basecamp dan mengelola stafnya.
- `registration_operator`: membaca serta memproses pendaftaran.
- `treasurer`: mencatat tagihan, pembayaran, refund, dan membaca transaksi.
- `field_officer`: melihat manifest dengan data minimum serta check-in/check-out.
- `information_manager`: mengelola informasi gunung, status, kuota, dan pengumuman.

Setiap akun staf terikat ke satu `basecampId`. Superadmin membuat Basecamp dari dashboard; Admin Basecamp menambahkan staf melalui **Manajemen akun staf**. Admin menetapkan sandi sementara, yang tidak disimpan di Firestore. Sesi tidak dibuat sampai staf menggantinya saat login pertama. Akses staf dicabut dari menu yang sama.

Claim lama `role: "admin"` tetap dianggap sebagai admin platform penuh untuk kompatibilitas. Jangan gunakan role lama tersebut untuk akun pengelola Basecamp baru; buat akun `basecamp_admin` dari dashboard superadmin. Setelah custom claim akun lama diubah, pemilik akun perlu masuk kembali agar token diperbarui.

Permintaan operasional tersedia melalui `/api/registrations`, `/api/finance`, dan `/api/basecamp/information`. Pendaftaran dan transaksi baru harus terkait dengan Basecamp yang sama. Firestore Rules menolak penulisan langsung; akses dilakukan lewat route handler yang melakukan otorisasi server.

### Menyiapkan akun superadmin pertama

Simpan service account di `.env.local` dan tambahkan `SUPERADMIN_PASSWORD` (Firebase mewajibkan setidaknya 6 karakter; gunakan sandi unik yang kuat di luar pengujian). Jalankan `npm run bootstrap:superadmin`. Script membuat atau memperbarui akun `dionyyr@gmail.com`, menetapkan display name/username `superadmin` dan custom claim `role: "superadmin"`, serta menulis profil `/users/{uid}` di Firestore. Script juga memperbarui sandi akun jika akun tersebut sudah ada. Setelah berhasil, hapus `SUPERADMIN_PASSWORD` dari `.env.local`; pengguna perlu keluar lalu masuk kembali agar custom claim baru masuk ke token.

## Google Drive dan Apps Script

1. Buat folder Google Drive privat untuk dokumen pendakian.
2. Buat project Google Apps Script dan salin isi `GAS/Code.gs` ke file `Code.gs`. Jika Apps Script sudah pernah di-deploy, setelah menempel kode baru buat **New version** dan edit deployment Web app agar menggunakan versi itu (URL Web app tetap dapat sama).
3. Di **Project Settings → Script Properties**, tambahkan `DRIVE_FOLDER_ID` (ID folder Drive) dan `SHARED_SECRET` (rahasia acak panjang).
4. Deploy sebagai **Web app**, jalankan sebagai akun pemilik Drive, dan izinkan akses web app. Endpoint dilindungi token bersama; simpan token hanya di server.
5. Atur `GAS_WEB_APP_URL` dan `GAS_SHARED_SECRET` pada `.env.local`. Pastikan nilai Script Property `SHARED_SECRET` sama. File yang diterima dibatasi ke PDF/JPEG/PNG maksimal 3 MB. API memverifikasi sesi Firebase, menyimpan file secara privat, dan mencatat metadata pemilik di Firestore. Deployment GAS terbaru mendukung daftar, unduh, dan hapus dokumen secara terotorisasi melalui server.

## GitHub → Vercel

Workflow `.github/workflows/vercel.yml` menjalankan lint dan build Vercel untuk push ke `main` dan pull request, lalu mengirim production/preview deployment melalui Vercel CLI. Tambahkan repository secrets berikut:

- `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`

Tambahkan semua variabel aplikasi dari `.env.example` pada **Vercel Project → Settings → Environment Variables** untuk environment Production dan Preview yang digunakan. Vercel CLI membangun dan mengirim prebuilt deployment; variabel runtime Firebase Admin dan GAS harus tersedia di konfigurasi project Vercel. Jangan masukkan service account atau rahasia GAS ke variabel `NEXT_PUBLIC_*`.

Buat project Vercel terlebih dahulu agar ID project dan organisasi tersedia. Jika project juga mengaktifkan integrasi GitHub bawaan Vercel, nonaktifkan salah satu mekanisme deploy agar tidak membuat deployment ganda.

## Ruang lingkup fondasi

- Halaman publik Basecamp dan contoh kartu status gunung.
- Pendaftaran/masuk Firebase Authentication dengan sesi cookie HttpOnly yang diverifikasi server menggunakan Firebase Admin.
- Login menerima email atau username yang terdaftar pada profil Firestore.
- Dashboard pendaki dan dashboard staf berbasis role; data staf dibatasi pada satu Basecamp.
- Pengelolaan Basecamp, pembuatan akun staf dengan sandi sementara, penggantian sandi wajib saat login pertama, dan pencabutan akses.
- Endpoint pendaftaran, pencatatan keuangan, dan pengelolaan informasi yang memeriksa role pada server.
- Unggah dokumen privat ke Drive melalui GAS dengan metadata di Firestore.
- Rules awal Firestore dan Realtime Database serta workflow GitHub Actions untuk Vercel.

Kartu gunung di halaman utama masih berupa contoh antarmuka. Data gunung yang dikelola staf tersedia pada halaman pendakian dan API publik; pengelola tetap bertanggung jawab memperbarui kondisi jalur dari sumber resmi.
