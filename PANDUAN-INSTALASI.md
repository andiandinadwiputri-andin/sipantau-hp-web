# Panduan Instalasi SIPANTAU-HP
### Backend: Google Apps Script (REST API) • Frontend: GitHub Pages
**Lapas Kelas IIB Nabire**

```
  HP / Laptop petugas
        │  https://USERNAME.github.io/sipantau-hp/      ← FRONTEND (GitHub Pages)
        ▼
  fetch() POST (JSON, token sesi di body)
        │
        ▼
  https://script.google.com/macros/s/…/exec           ← BACKEND (Google Apps Script)
        │
        ▼
  Google Sheets (database) • Drive (foto, label, laporan) • Gmail • Fonnte (WhatsApp)
```

Berkas yang Anda terima:

| Berkas | Untuk | Cara pakai |
|---|---|---|
| `Kode.gs` | Backend — inti (login, scan, izin, laporan, router API) | Disalin-tempel ke editor Apps Script |
| `Notifikasi.gs` | Backend — antrean WA (Fonnte) & email, blast per batch | File baru di editor Apps Script |
| `CRM.gs` | Backend — CRM Kontak (nama · email · WhatsApp) | File baru di editor Apps Script |
| `Migrasi.gs` | Backend — import data app lama, backup & pemulihan | File baru di editor Apps Script |
| `appsscript.json` | Backend | Disalin-tempel ke manifes Apps Script |
| `sipantau-hp-web.zip` | Frontend | Diekstrak, lalu di-push ke GitHub |
| `PANDUAN-INSTALASI.md` | Panduan | Dokumen ini |

> Gunakan **akun Google resmi instansi** untuk backend, supaya data tetap milik lapas bila operator berganti.

---

## BAGIAN A — BACKEND (Google Apps Script)

### A1. Buat proyek
1. Buka **https://script.google.com**, lalu pilih **Proyek baru**. Beri nama `SIPANTAU-HP API`.
2. Buka **⚙️ Setelan proyek**:
   - Zona waktu: **(GMT+09:00) Jayapura**
   - Centang **Tampilkan file manifes "appsscript.json"**
3. Kembali ke **Editor** dan siapkan lima file:
   - `Code.gs`: ganti namanya menjadi **`Kode`**, hapus isinya, lalu tempel seluruh isi **`Kode.gs`**.
   - Klik **＋ → Skrip**, beri nama **`Notifikasi`**, tempel isi **`Notifikasi.gs`**.
   - Klik **＋ → Skrip**, beri nama **`CRM`**, tempel isi **`CRM.gs`**.
   - Klik **＋ → Skrip**, beri nama **`Migrasi`**, tempel isi **`Migrasi.gs`**.
   - `appsscript.json`: ganti seluruh isinya dengan isi **`appsscript.json`**.
4. Tekan **💾 Simpan**. Urutan file di editor tidak berpengaruh.

> Versi ini **tidak membutuhkan** file `Index`, `Stylesheet`, atau `JavaScript` di Apps Script. Tampilannya kini ada di GitHub Pages.

### A2. Jalankan setup — SEKALI SAJA
1. Pilih fungsi **`setupAppEnvironment`**, lalu tekan **▶ Jalankan**.
2. Pilih **Tinjau izin**, pilih akun, lalu **Lanjutan → Buka SIPANTAU-HP API (tidak aman) → Izinkan**. Peringatan ini wajar untuk skrip buatan sendiri.
3. Buka **Log eksekusi** dan pastikan muncul tanda ✅. Setup membuat:
   - Spreadsheet `DB_SIPANTAU_HP` beserta semua sheet.
   - Folder Drive `SIPANTAU-HP` (Foto_HP, Label_QR, Laporan, Aset, Backup). Folder bersifat privat.
   - Akun uji coba dengan sandi `Nabire#2026`: `ADMIN001`, `P2U001`, `PIMP001`, `PTG001`, `MGG-001`. Semua akun wajib ganti sandi saat login pertama.

> ⚠️ Jangan jalankan `setupAppEnvironment` dua kali. Jika terlanjur, hapus folder dan spreadsheet duplikat di Drive.

### A3. Deploy sebagai Web App (API)
1. Pilih **Terapkan → Deployment baru**. Klik ⚙️, lalu pilih **Aplikasi web**.
2. Isi pengaturannya:
   - **Jalankan sebagai:** **Saya**
   - **Yang memiliki akses:** **Siapa saja** (*Anyone*)
3. Tekan **Terapkan**, lalu **salin URL Web App** yang berakhiran `/exec`.
4. Uji API: buka `URL_EXEC?action=ping` di browser. Jika berhasil, muncul `{"success":true,...,"message":"SIPANTAU-HP API aktif"}`.

> Akses **"Siapa saja"** wajib, karena situs GitHub Pages memanggil API tanpa login Google. Data tetap aman: setiap permintaan diperiksa token login NIP + kata sandi, peran, dan daftar fungsi yang diizinkan di server.
>
> ⚠️ **Setiap kali file `.gs` diubah**, buat versi baru: **Terapkan → Kelola deployment → ✏️ → Versi: Versi baru → Terapkan**. Dengan cara ini URL `/exec` tetap sama.

### A4. Sudah memasang versi sebelumnya? (upgrade)
1. Ganti isi `Kode.gs`, lalu tambahkan file `Notifikasi`, `CRM`, `Migrasi` (lihat A1). **Jangan** menjalankan `setupAppEnvironment` lagi.
2. Buat **Versi baru** pada deployment yang sama (lihat A3). URL `/exec` tidak berubah.
3. Sheet dan kolom baru (`AntrianNotif`, `BlastWA`, `CRM_Kontak`, `CRM_Interaksi`, `Arsip_Audit_Lama`, kolom `StatusWA`/`CekWAAt` di Petugas) **dibuat otomatis** pada permintaan pertama. Data lama tidak disentuh.
4. Di aplikasi: **Pengaturan → Pasang / perbarui trigger**. Trigger lama otomatis diganti dengan tiga trigger baru (lihat C6).
5. Push frontend baru ke GitHub (lihat B7), lalu naikkan `VERSI` di `js/config.js` agar browser memuat file terbaru.

---

## BAGIAN B — FRONTEND (GitHub Pages)

### B1. Isi alamat backend
1. Ekstrak **`sipantau-hp-web.zip`** (klik kanan → **Extract All**). Hasilnya folder **`sipantau-hp-web`**.
2. Buka **`sipantau-hp-web\js\config.js`** dengan Notepad dan ganti baris berikut:

```js
GAS_URL: 'https://script.google.com/macros/s/GANTI_DENGAN_ID_DEPLOYMENT_ANDA/exec',
```

   dengan URL `/exec` dari langkah A3. Simpan file.

### B2. Pastikan Anda berada di folder yang BENAR
Folder tempat menjalankan `git init` adalah **`sipantau-hp-web`**. Isinya harus seperti ini:

```
sipantau-hp-web\          ← ✅ git init DI SINI
├── index.html            ← wajib terlihat di baris atas saat "dir"
├── README.md
├── manifest.webmanifest
├── icon.svg / icon-192.png / icon-512.png
├── css\style.css
└── js\config.js, js\app.js
```

Cara membuka terminal tepat di folder itu (Windows): buka folder `sipantau-hp-web` di File Explorer, klik address bar, ketik **`powershell`**, lalu tekan Enter. Kemudian jalankan `dir`. **`index.html` harus terlihat.** Jika yang terlihat malah folder `sipantau-hp-web`, ketik `cd sipantau-hp-web` terlebih dahulu.

> File backend (`Kode.gs`, `appsscript.json`) **tidak boleh** ada di folder ini.

### B3. Install Git & buat akun GitHub (sekali saja)
1. Install Git dari **https://git-scm.com/download/win** (pengaturan default). Cek dengan `git --version`.
2. Daftar di **https://github.com**. Username Anda menjadi bagian alamat situs: `username.github.io`.
3. Atur identitas (sekali seumur komputer):
   ```bash
   git config --global user.name "Nama Anda"
   git config --global user.email "email-akun-github@contoh.com"
   ```

### B4. Buat repository di GitHub
Di github.com, pilih **+ → New repository**, lalu isi:
- Nama: `sipantau-hp`
- Visibilitas: **Public** (wajib untuk Pages gratis; aman karena frontend tidak berisi kata sandi)
- **Jangan** centang README / .gitignore / license.

### B5. Push pertama kali (dari folder `sipantau-hp-web`)
```bash
git init
git add .
git commit -m "Upload pertama SIPANTAU-HP"
git branch -M main
git remote add origin https://github.com/USERNAME/sipantau-hp.git
git push -u origin main
```

- Perhatikan **titik** pada `git add .`.
- Saat diminta **Password**, tempel **Personal Access Token**, bukan password akun:
  1. Buka **https://github.com/settings/tokens**.
  2. Pilih **Generate new token (classic)**.
  3. Centang **repo**, lalu pilih **Generate**.
  4. Salin token `ghp_…`.
- Saat menempel token, **layar tetap kosong**. Ini normal; tekan Enter saja.
- Tanda berhasil: `Writing objects: 100%` dan `* [new branch] main -> main`.

### B6. Aktifkan GitHub Pages
Buka repo di github.com, lalu **Settings → Pages**:

| Kolom | Nilai |
|---|---|
| Source | **Deploy from a branch** |
| Branch | **main** / **(root)** → Save |
| Enforce HTTPS | ✅ **wajib** (kamera scanner hanya jalan di HTTPS) |

Tunggu 1–2 menit hingga muncul: **"Your site is live at https://USERNAME.github.io/sipantau-hp/"**.

### B7. Update di kemudian hari
Setiap mengubah file frontend, jalankan dari folder `sipantau-hp-web`:
```bash
git add .
git commit -m "Keterangan perubahan"
git push
```
Jika situs masih menampilkan versi lama, naikkan angka `VERSI` di `js/config.js` (mis. `'2'` → `'3'`), push lagi, lalu tekan **Ctrl+Shift+R**.

---

## BAGIAN C — PENGATURAN AWAL (di aplikasi)
Buka situs GitHub Pages, lalu login sebagai **`ADMIN001` / `Nabire#2026`** dan ganti sandi. Setelah itu buka menu **Pengaturan**:

1. **URL Web App / halaman**: isi dengan alamat **GitHub Pages** (`https://USERNAME.github.io/sipantau-hp/`). Alamat ini dipakai sebagai tautan di pesan WA dan email.
2. **Logo**: unggah logo Kemenimipas, Pemasyarakatan, dan LABIRE.
3. **WhatsApp (Fonnte) & Email** — di menu **WhatsApp & Notifikasi → Konfigurasi** (lihat Bagian E):
   1. Daftar di **fonnte.com**.
   2. Buka **Device**, tambahkan nomor WA instansi, lalu **Connect** (pindai QR dari HP dinas).
   3. Salin **Token**, tempel di kolom **Token baru**, lalu **Simpan konfigurasi**. Tekan **Cek perangkat** untuk memastikan status *Terhubung*.
   4. Tekan **Uji** WhatsApp dan **Uji** email.
4. Isi **URL aplikasi untuk {link}** (tombol **Pakai alamat halaman ini**).
5. Isi **No. WA Pos P2U**, **Nama/NIP Ka. KPLP & Kasi Kamtib**, lalu tekan **Simpan pengaturan**.
6. Kembali ke **Pengaturan**, tekan **Pasang / perbarui trigger** dan pastikan ketiganya berstatus **Aktif**:
   - **Pekerja otomatis tiap 1 menit**: mengirim antrean WA/email, memeriksa peringatan tiap 5 menit, sinkron CRM, dan deteksi nomor WA baru;
   - **Laporan harian 08.15**;
   - **Backup mingguan** (Minggu 23.00).
7. Lengkapi data petugas:
   - **Data Petugas → Impor massal** untuk ±74 petugas. Pimpinan wajib memiliki No. WA dan email.
   - **Data HP & Label QR**: daftarkan HP beserta fotonya, lalu **Cetak label**.
8. **Nonaktifkan akun uji coba** sebelum aplikasi dipakai resmi.

### Pemakaian di HP P2U (Pintu 2)
- Buka situs di **Chrome Android**, lalu pilih **⋮ → Tambahkan ke layar utama**. Aplikasi akan terbuka layar penuh seperti aplikasi biasa.
- Login P2U, lalu tekan **Aktifkan Kamera** dan izinkan akses kamera. Arahkan kamera ke stiker QR di HP atau ke kartu QR petugas.
- Bila kamera bermasalah, gunakan salah satu cadangan:
  - **Foto QR** (QR dibaca dari foto);
  - ketik ID HP / NIP / nama / IMEI di kolom input manual;
  - pemindai barcode USB/Bluetooth.

---

## BAGIAN E — WhatsApp, Notifikasi & CRM

**Cara kerja:** setiap kejadian (HP dititipkan, izin diajukan, peringatan batas ambil, dst.) hanya menulis pesan ke sheet **AntrianNotif**. Pekerja otomatis mengirimnya tiap 1 menit. Karena itu tombol di aplikasi tetap instan, dan transaksi tidak pernah gagal hanya karena WA/email gagal. Pesan yang gagal dicoba ulang hingga 3 kali.

**Menu WhatsApp & Notifikasi** (Admin & Pimpinan) punya tiga tab:

| Tab | Fungsi |
|---|---|
| **Blast WA** | Pilih penerima dari CRM (segmen, regu, status WA, tag) atau tempel nomor manual. **Deteksi nomor WA** mengecek 50 nomor per putaran. Tulis pesan dengan variabel `{nama} {nip} {regu} {jabatan} {institusi} {link}` dan lihat pratinjaunya. Pilih **10/20/50 pesan per batch** dan jeda (mis. `3-8` detik acak). Blast tetap berjalan walau aplikasi ditutup. Tersedia tombol **Kirim batch berikutnya** dan **Hentikan**. |
| **Antrean kirim** | Status setiap pesan (Antre / Terkirim / Gagal / Batal) beserta respons Fonnte, **Proses antrean sekarang**, dan **Ulangi yang gagal**. |
| **Konfigurasi** (Admin) | Saklar utama WA & email, token Fonnte (ditampilkan tersamar), cek perangkat, uji kirim, ukuran batch & jeda bawaan, serta tabel **Kejadian × kanal**: centang WA/Email per kejadian dan ubah templatenya. |

**Menu CRM Kontak** menyatukan **Nama · Email · WhatsApp** semua petugas, disinkronkan otomatis dari Data Petugas (paling lambat 30 menit, atau langsung lewat **Sinkron sekarang**), ditambah kontak manual dari **Import CSV**.
- **Pilah data:** filter per segmen (Pimpinan/Admin/P2U/Petugas/BKO/Magang/Manual), status WA, tag, dan kualitas data.
- **Aksi massal:** pilih beberapa kontak untuk **Blast WA**, **Deteksi WA**, tambah/hapus tag, atau opt-out. Kontak opt-out tidak pernah masuk blast, tetapi notifikasi tugas tetap terkirim.
- **Laci detail kontak:** ubah nama, WA, atau email (Data Petugas ikut diperbarui), lihat linimasa pesan, dan catat interaksi (telepon, kunjungan, catatan).
- **Kebersihan data:** **Duplikat → Gabung** untuk menyatukan kontak ganda, dan **Ekspor CSV**.

## BAGIAN F — Migrasi Data Lama & Backup

Menu **Migrasi & Backup** (Admin):

**Import dari app lama:**
- **Sumber hanya dibaca.** Spreadsheet sumber tidak pernah diubah dan harus milik akun Google yang sama dengan backend.
- **Aman diulang.** Data dicocokkan per NIP, ID HP, ID izin, dan ID log, jadi tidak ada baris dobel. NIP dan IMEI yang diawali angka 0 tetap utuh.
- **Langkahnya:**
  1. Tempel URL spreadsheet lama.
  2. Centang data yang ingin dipindahkan.
  3. Tekan **Pindai (dry-run)** untuk melihat jumlah data yang akan ditambah, diperbarui, atau dilewati, beserta peringatannya. Belum ada data yang ditulis pada tahap ini.
  4. Tekan **Jalankan import**.
- **Opsi "Timpa data yang sudah ada"** mati secara bawaan, sehingga koreksi yang sudah dibuat di app ini tidak tertimpa.
- **Log audit lama** diarsipkan ke sheet `Arsip_Audit_Lama` agar rantai hash audit app ini tetap utuh.

**Cutover (hari pindah):**
1. Lakukan import pertama, lalu cek data dan uji login satu akun petugas.
2. Tepat sebelum pindah, **jalankan import sekali lagi** (delta) untuk menangkap titip/ambil terbaru dari app lama.
3. Umumkan alamat baru lewat **Blast WA**. Semua petugas perlu login ulang karena sesi lama tidak ikut pindah.

**Backup:**
- **Buat cadangan sekarang** menyalin seluruh database ke folder Drive `SIPANTAU-HP/Backup`. Backup mingguan otomatis berjalan setiap Minggu pukul 23.00, dan hanya N cadangan terakhir yang disimpan (bawaan 12, dapat diatur 3–60).
- **Unduh .xlsx** tersedia untuk database saat ini maupun untuk cadangan mana pun.
- **Pulihkan** mengisi formulir import dengan file cadangan dan opsi timpa aktif. Tekan **Pindai** dulu, lalu **Jalankan import**. Pemulihan mengembalikan data yang hilang dan menyamakan data yang ada. Data yang dibuat setelah tanggal cadangan **tidak** dihapus.

**Kecepatan (instant UX):**
- **Layar langsung tampil dari data terakhir di perangkat**, lalu diperbarui di latar. Data layar pertama ikut terkirim saat login.
- **Menu yang sering dibuka diambil sekaligus** saat aplikasi menganggur.
- **Tahan sinyal lemah:** permintaan baca diulang otomatis bila sinyal putus. Aksi simpan aman diulang tanpa membuat transaksi ganda.
- **Tombol Kembali di HP** berpindah antar-menu.

---

## BAGIAN D — Pemecahan Masalah

| Gejala | Penyebab & solusi |
|---|---|
| Kotak merah **"Backend belum terhubung"** di layar login | `GAS_URL` di `js/config.js` belum diisi. Isi, lalu `git add .` → `git commit -m "isi GAS_URL"` → `git push`. |
| "Tidak dapat terhubung ke server" | URL `/exec` salah, atau akses deployment bukan **Siapa saja**. Cek dengan membuka `URL_EXEC?action=ping`. |
| "Respons server bukan JSON" | URL yang ditempel adalah URL editor, bukan URL `/exec`. Atau akses deployment masih "Hanya saya". |
| Perubahan `Kode.gs` tidak berlaku | Belum dibuat **Versi baru** pada deployment (lihat A3). |
| Situs GitHub **404** | `index.html` tidak berada di root repo; kemungkinan `git init` dijalankan di folder induk. Jalankan ulang dari folder `sipantau-hp-web` dengan `git push -u origin main --force`. |
| Tampilan polos tanpa warna | Folder `css/` atau `js/` tidak ikut terunggah. Selalu push lewat terminal, jangan "Upload files" di web GitHub. |
| `Password authentication is not supported` | Gunakan Personal Access Token (lihat B5). |
| Kamera ditolak | Klik ikon gembok di bilah alamat → **Kamera → Izinkan**, lalu muat ulang. Pastikan alamat diawali `https://`. |
| Akun terkunci | Akun terkunci setelah 5 kali salah sandi. Tunggu 15 menit, atau minta Admin **Reset sandi**. |
| WA tidak terkirim | Buka **WhatsApp & Notifikasi → Antrean kirim** untuk melihat respons Fonnte. Tekan **Cek perangkat** dan pastikan berstatus *Terhubung*. Pastikan saklar WA dan kejadiannya tercentang di **Konfigurasi**. |
| Pesan berstatus **Antre** terus | Trigger **Pekerja otomatis** belum aktif. Buka **Pengaturan → Pasang / perbarui trigger**, atau tekan **Proses antrean sekarang**. |
| "Deteksi nomor WA gagal" | Paket Fonnte Anda belum mendukung fitur *validate*. Blast tetap bisa dikirim tanpa deteksi. |
| Import: "Spreadsheet tidak bisa dibuka" | Pastikan URL/ID benar dan spreadsheet milik akun Google yang sama dengan backend. |
| Menu baru tidak muncul setelah update | Naikkan `VERSI` di `js/config.js`, push, lalu tekan **Ctrl+Shift+R**. |
