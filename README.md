# SIPANTAU-HP — Frontend (GitHub Pages)

Sistem Pengawasan & Penitipan HP Petugas **Lapas Kelas IIB Nabire**.

Folder ini adalah **frontend statis** (HTML/CSS/JS) yang di-host di GitHub Pages. Semua data diambil dari **backend Google Apps Script** (REST API JSON) lewat `fetch()`.

```
(folder ini = root repository)
├── index.html            ← halaman aplikasi (SPA)
├── manifest.webmanifest  ← agar bisa "Tambahkan ke layar utama" di HP
├── icon.svg, icon-192.png, icon-512.png
├── .nojekyll
├── css/
│   └── style.css
└── js/
    ├── config.js         ← ⚠️ ISI GAS_URL DI SINI
    ├── app.js            ← logika aplikasi (instant UX: cache, retry, router #/menu)
    └── admin.js          ← modul WhatsApp & Notifikasi, CRM Kontak, Migrasi & Backup (dimuat saat dibuka)
```

## Satu-satunya yang wajib diubah
Buka `js/config.js`, lalu ganti `GAS_URL` dengan URL Web App `/exec` dari Google Apps Script.

## Memperbarui situs
```bash
git add .
git commit -m "Perubahan ..."
git push
```

Panduan lengkap: lihat `PANDUAN-INSTALASI.md`.
