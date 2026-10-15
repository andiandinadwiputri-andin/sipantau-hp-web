'use strict';
/* ============================================================
   SIPANTAU-HP — Logika Klien (Single Page Application)
   - Frontend statis di GitHub Pages, backend Google Apps Script sebagai REST API
   - Semua data via fetch() POST text/plain → {fn, args}; token sesi di body (bukan URL)
   - Konfigurasi URL backend ada di js/config.js
   - Scan QR: kamera (html5-qrcode), foto QR, input manual & pemindai USB
   - Instant UX: cache SWR per user (localStorage), data layar pertama ikut login,
     retry baca + idempotensi tulis (reqId), router hash (#/menu), pustaka dimuat saat perlu,
     prefetch batch saat idle, polling hanya saat tab terlihat
   ============================================================ */

// ════════════════════════════════════════════════════════
// 1. STATE & KONFIGURASI
// ════════════════════════════════════════════════════════
const AppState = {
  token: null, user: null, info: null, page: null, navSeq: 0,
  timers: [], charts: [], cache: {},
  scanner: null, scannerOn: false, kameraList: [], kameraIdx: -1, kameraTadi: false,
  lastCode: '', lastCodeAt: 0, sibukScan: false, hasilScan: null,
  pilihPetugas: new Set(), pilihHp: new Set(), fotoBaru: '',
  fRiwayat: null, fAudit: null, lap: null, tabIzin: 'aktif', tabAudit: 'audit'
};
const KUNCI_TOKEN = 'sphp_token';
const KONFIG = window.SIPANTAU_CONFIG || {};
const GAS_URL = String(KONFIG.GAS_URL || '').trim();
const API_TIMEOUT_MS = Number(KONFIG.API_TIMEOUT_MS) || 90000;
const URL_SIAP = /^https:\/\/script\.google\.com\/(a\/macros\/[^/]+|macros)\/s\/[\w-]+\/exec$/.test(GAS_URL) && GAS_URL.indexOf('GANTI_DENGAN') === -1;
const PUBLIK = ['login', 'getInfoAplikasi'];
const DAFTAR_REGU = ['Regu 1', 'Regu 2', 'Regu 3', 'Regu 4', 'Non-Regu', 'Magang'];
const LABEL_PERAN = { ADMIN: 'Admin Kamtib/KPLP', P2U: 'Petugas P2U', PIMPINAN: 'Pimpinan', PETUGAS: 'Petugas' };

const MENU = {
  dashboard: { label: 'Ringkasan Hari Ini', pendek: 'Ringkasan', ikon: 'bi-speedometer2', peran: ['ADMIN', 'P2U', 'PIMPINAN'], grup: 'Operasional' },
  scan: { label: 'Scan Pintu 2 (P2U)', pendek: 'Scan', ikon: 'bi-qr-code-scan', peran: ['ADMIN', 'P2U'], grup: 'Operasional' },
  izin: { label: 'Izin Bawa HP', pendek: 'Izin', ikon: 'bi-file-earmark-check', peran: ['ADMIN', 'P2U', 'PIMPINAN', 'PETUGAS'], grup: 'Operasional' },
  riwayat: { label: 'Riwayat & Pencarian', pendek: 'Riwayat', ikon: 'bi-clock-history', peran: ['ADMIN', 'P2U', 'PIMPINAN'], grup: 'Operasional' },
  laporan: { label: 'Laporan & Grafik', pendek: 'Laporan', ikon: 'bi-file-earmark-bar-graph', peran: ['ADMIN', 'P2U', 'PIMPINAN'], grup: 'Laporan' },
  audit: { label: 'Log Audit & Notifikasi', pendek: 'Audit', ikon: 'bi-shield-lock', peran: ['ADMIN', 'PIMPINAN'], grup: 'Laporan' },
  notifikasi: { label: 'WhatsApp & Notifikasi', pendek: 'WA', ikon: 'bi-whatsapp', peran: ['ADMIN', 'PIMPINAN'], grup: 'Komunikasi', modul: 'admin' },
  crm: { label: 'CRM Kontak', pendek: 'CRM', ikon: 'bi-person-lines-fill', peran: ['ADMIN', 'PIMPINAN'], grup: 'Komunikasi', modul: 'admin' },
  petugas: { label: 'Data Petugas', pendek: 'Petugas', ikon: 'bi-people', peran: ['ADMIN'], grup: 'Data Master' },
  hp: { label: 'Data HP & Label QR', pendek: 'Data HP', ikon: 'bi-phone', peran: ['ADMIN'], grup: 'Data Master' },
  pengaturan: { label: 'Pengaturan', pendek: 'Atur', ikon: 'bi-gear', peran: ['ADMIN'], grup: 'Sistem' },
  migrasi: { label: 'Migrasi & Backup', pendek: 'Backup', ikon: 'bi-database-gear', peran: ['ADMIN'], grup: 'Sistem', modul: 'admin' },
  hpSaya: { label: 'HP Saya', pendek: 'HP Saya', ikon: 'bi-person-badge', peran: ['ADMIN', 'P2U', 'PIMPINAN', 'PETUGAS'], grup: 'Akun' }
};
const URUTAN_MENU = {
  ADMIN: ['dashboard', 'scan', 'izin', 'riwayat', 'laporan', 'audit', 'notifikasi', 'crm', 'petugas', 'hp', 'pengaturan', 'migrasi', 'hpSaya'],
  P2U: ['scan', 'dashboard', 'izin', 'riwayat', 'laporan', 'hpSaya'],
  PIMPINAN: ['dashboard', 'izin', 'riwayat', 'laporan', 'audit', 'notifikasi', 'crm', 'hpSaya'],
  PETUGAS: ['hpSaya', 'izin']
};
// Bottom nav HP: maks. 4 menu + tombol "Menu" (UI/UX: bottom nav ≤ 5)
const MENU_BAWAH = {
  ADMIN: ['dashboard', 'scan', 'hp', 'izin'],
  P2U: ['scan', 'dashboard', 'izin', 'riwayat'],
  PIMPINAN: ['dashboard', 'izin', 'riwayat', 'laporan'],
  PETUGAS: ['hpSaya', 'izin']
};
const LANDING = { ADMIN: 'dashboard', P2U: 'scan', PIMPINAN: 'dashboard', PETUGAS: 'hpSaya' };

const LABEL_STATUS = {
  TERTAHAN: ['Tertahan di loker', 'bs-navy'], TERLAMBAT: ['Lewat batas', 'bs-red-solid'], BERIZIN_DI_DALAM: ['Berizin di dalam', 'bs-gold'],
  SELESAI: ['Selesai', 'bs-green'], SELESAI_TERLAMBAT: ['Selesai (terlambat)', 'bs-red'],
  DI_LUAR: ['Di luar / siap titip', 'bs-gray'], DITITIPKAN: ['Dititipkan', 'bs-navy'], DIBAWA_BERIZIN: ['Dibawa berizin', 'bs-gold'],
  MENUNGGU: ['Menunggu', 'bs-gold'], DISETUJUI: ['Disetujui', 'bs-green'], DITOLAK: ['Ditolak', 'bs-red'],
  KEDALUWARSA: ['Kedaluwarsa', 'bs-gray'], DIBATALKAN: ['Dibatalkan', 'bs-gray'],
  TERKIRIM: ['Terkirim', 'bs-green'], GAGAL: ['Gagal', 'bs-red'], NONAKTIF: ['Nonaktif', 'bs-gray'], AKTIF: ['Aktif', 'bs-green']
};
const WARNA_KATEGORI = { SCAN: 'bs-navy', AUTENTIKASI: 'bs-gray', KEAMANAN: 'bs-red', MASTER: 'bs-navy', IZIN: 'bs-gold', LAPORAN: 'bs-green', PENGATURAN: 'bs-gray', SISTEM: 'bs-gold', NOTIFIKASI: 'bs-green', MIGRASI: 'bs-gold' };

// Registri aksi (event delegation — tanpa onclick berisi data pengguna)
const AKSI = {}, UBAH = {}, KETIK = {}, KIRIM = {}, HALAMAN = {}, SEGARKAN = {};

// ════════════════════════════════════════════════════════
// 2. UTILITAS UMUM
// ════════════════════════════════════════════════════════
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function simpanLokal(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* mode privat */ } }
function ambilLokal(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function inisial(nama) { return String(nama || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase(); }
function basi(seq) { return seq !== AppState.navSeq; }
function geraklah() { return !matchMedia('(prefers-reduced-motion: reduce)').matches; }
function layarSentuh() { return matchMedia('(pointer: coarse)').matches; }

// ── Tanggal & waktu (selalu WIT / Asia/Jayapura) ──
const _fmtWIT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jayapura', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const _fmtPanjang = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jayapura', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
function bagianWIT(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return null;
  const p = {};
  _fmtWIT.formatToParts(d).forEach(x => { p[x.type] = x.value; });
  if (p.hour === '24') p.hour = '00';
  return p;
}
function fmt(v, mode) {
  const p = bagianWIT(v);
  if (!p) return '-';
  switch (mode) {
    case 'jam': return p.hour + ':' + p.minute;
    case 'jamDetik': return p.hour + ':' + p.minute + ':' + p.second;
    case 'tgl': return p.day + '/' + p.month + '/' + p.year;
    case 'tglJam': return p.day + '/' + p.month + ' ' + p.hour + ':' + p.minute;
    case 'iso': return p.year + '-' + p.month + '-' + p.day;
    case 'lokal': return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute;
    default: return p.day + '/' + p.month + '/' + p.year + ' ' + p.hour + ':' + p.minute;
  }
}
function tglPanjang(v) { try { return _fmtPanjang.format(v ? new Date(v) : new Date()); } catch (e) { return fmt(v, 'tgl'); } }
function hariIni() { return fmt(new Date(), 'iso'); }
function tambahHari(iso, n) { const a = iso.split('-').map(Number); return new Date(Date.UTC(a[0], a[1] - 1, a[2] + n)).toISOString().slice(0, 10); }
function witKeIso(v) { return v ? new Date(v + ':00+09:00').toISOString() : ''; }
function durasi(m) {
  m = Math.max(0, Math.round(Number(m) || 0));
  const j = Math.floor(m / 60), mm = m % 60;
  if (j >= 24) return Math.floor(j / 24) + 'h ' + (j % 24) + 'j';
  return j ? j + 'j ' + String(mm).padStart(2, '0') + 'm' : mm + ' mnt';
}
function selisihMenit(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }

function perangkat() {
  const ua = navigator.userAgent || '';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Lainnya';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' :
    /Firefox\//.test(ua) ? 'Firefox' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return os + ' • ' + br + ' • ' + screen.width + 'x' + screen.height;
}

// ── Komponen HTML kecil ──
function badge(st) { const x = LABEL_STATUS[st] || [st || '-', 'bs-gray']; return '<span class="bs ' + x[1] + '">' + esc(x[0]) + '</span>'; }
function badgePeran(p) { return '<span class="bs role-' + esc(p) + '">' + esc(p) + '</span>'; }
function kosong(ikon, teks) { return '<div class="empty-state"><i class="bi ' + ikon + '" aria-hidden="true"></i>' + esc(teks) + '</div>'; }
function memuat(teks) { return '<div class="empty-state"><div class="spinner-border spinner-border-sm text-secondary" role="status"></div><div class="mt-2">' + esc(teks || 'Memuat…') + '</div></div>'; }
function kepala(judul, desc, kanan) {
  return '<div class="page-head"><div class="min-w-0"><h2>' + judul + '</h2>' + (desc ? '<p class="desc">' + desc + '</p>' : '') + '</div>' +
    (kanan ? '<div class="d-flex flex-wrap gap-2">' + kanan + '</div>' : '') + '</div>';
}
function kpi(kelas, ikon, label, nilai, sub, extra) {
  return '<div class="kpi ' + kelas + '" ' + (extra || '') + '><div class="lbl"><span>' + esc(label) + '</span><i class="bi ' + ikon + '" aria-hidden="true"></i></div>' +
    '<div class="val">' + esc(nilai) + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
}
function pager(total, page, size, act) {
  const maks = Math.max(1, Math.ceil(total / size));
  return '<div class="pager p-2 border-top"><span class="me-auto text-secondary-x small">' + total + ' data • hal. ' + page + '/' + maks + '</span>' +
    '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="' + act + '" data-hal="' + (page - 1) + '" ' + (page <= 1 ? 'disabled' : '') + ' aria-label="Halaman sebelumnya"><i class="bi bi-chevron-left"></i></button>' +
    '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="' + act + '" data-hal="' + (page + 1) + '" ' + (page >= maks ? 'disabled' : '') + ' aria-label="Halaman berikutnya"><i class="bi bi-chevron-right"></i></button></div>';
}
function opsi(list, terpilih, kosongLabel) {
  return (kosongLabel !== undefined ? '<option value="">' + esc(kosongLabel) + '</option>' : '') +
    list.map(x => { const v = Array.isArray(x) ? x[0] : x, l = Array.isArray(x) ? x[1] : x; return '<option value="' + esc(v) + '"' + (String(v) === String(terpilih) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
}

// ════════════════════════════════════════════════════════
// 3. KOMUNIKASI SERVER (fetch → GAS REST API)
// ════════════════════════════════════════════════════════
let _sibuk = 0;
function setSibuk(d) { _sibuk = Math.max(0, _sibuk + d); const b = $('#busyBar'); if (b) b.classList.toggle('on', _sibuk > 0); }
function buatGalat(pesan, kode) { const e = new Error(pesan); e.code = kode || ''; return e; }
const jeda = ms => new Promise(r => setTimeout(r, ms));

/** Fungsi BACA → aman di-retry otomatis (3×). Harus sinkron dengan backend. */
const FN_BACA = new Set(['getInfoAplikasi', 'cekToken', 'batch', 'getDashboard', 'getIzin', 'getHpSaya', 'getRiwayat', 'getPetugasList', 'getHpList',
  'getLaporan', 'getAudit', 'getNotifLog', 'getPengaturan', 'getFotoHP', 'notifConfig', 'notifQueue', 'waBlastList', 'waDevice', 'waAudience',
  'crmList', 'crmStats', 'crmDetail', 'crmDuplikat', 'getDaftarBackup', 'getDataLabel']);
/** Fungsi TULIS → membawa reqId; backend menyimpan hasilnya 6 jam sehingga retry tidak menggandakan transaksi (= API_TULIS backend). */
const FN_TULIS = new Set(['eksekusiTransaksi', 'simpanPetugas', 'ubahStatusPetugas', 'resetSandiPetugas', 'imporPetugas', 'simpanHp',
  'ubahStatusHp', 'ajukanIzin', 'putuskanIzin', 'batalkanIzin', 'simpanPengaturan', 'simpanTokenFonnte', 'unggahLogo', 'gantiSandi',
  'notifConfigSave', 'notifRetry', 'waBlastCreate', 'waBlastStop', 'crmSave', 'crmBulk', 'crmInteraksi', 'crmImport', 'crmMerge',
  'importData', 'buatBackup', 'aturBackup']);

/** Pengukur performa: ketik Perf.table() di console → total vs waktu server (ms) per panggilan. */
const Perf = {
  rows: [],
  add(fn, total, server) {
    this.rows.push({ fn: fn, total: total, server: server == null ? null : server, jaringan: server == null ? null : total - server, pada: new Date().toLocaleTimeString() });
    if (this.rows.length > 200) this.rows.shift();
  },
  table() { console.table(this.rows.slice(-30)); }
};
window.Perf = Perf;

function buatReqId() {
  try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* abaikan */ }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}
function tungguOnline(maks) {
  if (navigator.onLine !== false) return Promise.resolve();
  return new Promise(res => {
    const selesai = () => { clearTimeout(t); window.removeEventListener('online', selesai); res(); };
    const t = setTimeout(selesai, maks || 30000);
    window.addEventListener('online', selesai);
  });
}

/**
 * Satu permintaan ke backend GAS (REST API).
 * WAJIB Content-Type text/plain agar tidak memicu CORS preflight (GAS tidak menjawab OPTIONS).
 */
async function panggilServer(fn, params, o) {
  o = o || {};
  if (!URL_SIAP) throw buatGalat('URL backend belum diatur. Isi GAS_URL di js/config.js dengan URL Web App /exec.', 'KONFIG');
  const batas = o.timeout || API_TIMEOUT_MS;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), batas);
  const body = { fn: fn, args: params };
  if (o.reqId) body.reqId = o.reqId;
  let res;
  try {
    res = await fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
      cache: 'no-store',
      signal: ctrl.signal
    });
  } catch (err) {
    if (err && err.name === 'AbortError') throw buatGalat('Server terlalu lama merespons (> ' + Math.round(batas / 1000) + ' detik). Coba lagi.', 'JARINGAN');
    throw buatGalat(navigator.onLine === false ? 'Perangkat sedang offline. Periksa koneksi internet.' : 'Tidak dapat terhubung ke server. Periksa koneksi internet, atau pastikan GAS_URL benar dan Web App di-deploy dengan akses "Siapa saja".', 'JARINGAN');
  } finally { clearTimeout(t); }
  const teks = await res.text();
  try { return JSON.parse(teks); } catch (e) {
    // Halaman galat Google (HTML) saat server sibuk → boleh dicoba lagi
    throw buatGalat(res.ok ? 'Respons server bukan JSON. Pastikan GAS_URL adalah URL /exec dan akses deployment "Siapa saja" (Anyone).' : 'Server membalas HTTP ' + res.status + '.', 'JARINGAN');
  }
}

/** Panggilan dengan retry: baca 3× (25/40/40 dtk), tulis ber-reqId 2× (90 dtk), lainnya 1×. */
async function panggilTahan(fn, params) {
  const baca = FN_BACA.has(fn), tulis = FN_TULIS.has(fn);
  const reqId = tulis ? buatReqId() : '';
  const batas = baca ? [25000, 40000, 40000] : tulis ? [API_TIMEOUT_MS, API_TIMEOUT_MS] : [API_TIMEOUT_MS];
  let galat = null;
  for (let i = 0; i < batas.length; i++) {
    if (i) { await tungguOnline(30000); await jeda(700 * i * i); }
    const t0 = performance.now();
    try {
      const res = await panggilServer(fn, params, { timeout: batas[i], reqId: reqId });
      Perf.add(fn, Math.round(performance.now() - t0), res && res.ms);
      return res;
    } catch (e) {
      galat = e;
      if (e.code !== 'JARINGAN') throw e;
    }
  }
  throw galat;
}

/**
 * Panggil fungsi server. Token otomatis disisipkan sebagai argumen pertama (kecuali fungsi publik).
 * o.diam = tanpa bilah proses (dipakai pembaruan latar & prefetch).
 */
async function apiOpsi(o, fn, ...args) {
  const params = PUBLIK.indexOf(fn) >= 0 ? args : [AppState.token].concat(args);
  if (!o.diam) setSibuk(1);
  let res;
  try { res = await panggilTahan(fn, params); } finally { if (!o.diam) setSibuk(-1); }
  if (!res) throw buatGalat('Tidak ada respons dari server.');
  if (res.success) {
    if (FN_TULIS.has(fn)) AppState.tulisTerakhir = Date.now();   // semua cache layar dianggap perlu disegarkan
    return res;
  }
  if (res.code === 'AUTH') sesiBerakhir(res.message);
  else if (res.code === 'GANTI_SANDI') tampilLayar('gantiSandi');
  throw buatGalat(res.message || 'Terjadi kesalahan.', res.code);
}
function api(fn, ...args) { return apiOpsi({}, fn, ...args); }

// ── Cache perangkat (stale-while-revalidate), namespace per NIP + versi skema ──
const LS_PREFIX = 'sphp:v2:';
const Store = {
  get(k, d) { try { const v = localStorage.getItem(LS_PREFIX + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) {
    let s;
    try { s = JSON.stringify(v); } catch (e) { return; }
    try { localStorage.setItem(LS_PREFIX + k, s); }
    catch (e) {
      // Kuota penuh → buang cache milik user lain / versi lama, coba sekali lagi
      try {
        const milik = LS_PREFIX + kunciUser('');
        Object.keys(localStorage).filter(x => (x.indexOf('sphp:') === 0 && x.indexOf(LS_PREFIX) !== 0) || (x.indexOf(LS_PREFIX + 'u:') === 0 && x.indexOf(milik) !== 0)).forEach(x => localStorage.removeItem(x));
        localStorage.setItem(LS_PREFIX + k, s);
      } catch (e2) { /* tetap jalan tanpa cache */ }
    }
  },
  del(k) { try { localStorage.removeItem(LS_PREFIX + k); } catch (e) { /* abaikan */ } },
  hapusUser() { try { const m = LS_PREFIX + kunciUser(''); Object.keys(localStorage).filter(x => x.indexOf(m) === 0).forEach(x => localStorage.removeItem(x)); } catch (e) { /* abaikan */ } }
};
function kunciUser(k) { return 'u:' + ((AppState.user && AppState.user.nip) || 'anon') + ':' + k; }
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h + ':' + s.length; }
function simpanCache(kunci, data) { Store.set(kunciUser(kunci), { t: Date.now(), h: hashStr(JSON.stringify(data)), data: data }); }
function ambilCache(kunci) { return Store.get(kunciUser(kunci), null); }
/** Batas kesegaran (ms): dalam rentang ini data cache dipakai tanpa ke server sama sekali. */
const SEGAR = { getDashboard: 20000, getHpSaya: 30000, getIzin: 20000, getPetugasList: 120000, getHpList: 60000, getPengaturan: 300000,
  notifConfig: 120000, crmStats: 60000, waBlastList: 10000, getDaftarBackup: 60000, notifQueue: 10000 };

/**
 * SWR: tampilkan cache seketika → segarkan di latar → render ulang HANYA bila data berubah.
 * render(data, dariCache) maksimal dipanggil 2×. Gagal jaringan + ada cache = tetap tampil (dengan pemberitahuan).
 */
async function swr(kunci, fn, args, render, opt) {
  opt = opt || {};
  const c = ambilCache(kunci);
  if (c) render(c.data, true);
  const segar = opt.segar !== undefined ? opt.segar : (SEGAR[fn] || 30000);
  if (c && !opt.paksa && Date.now() - c.t < segar && c.t > (AppState.tulisTerakhir || 0)) return c.data;
  try {
    const r = await apiOpsi({ diam: !!c }, fn, ...(args || []));
    const h = hashStr(JSON.stringify(r.data));
    Store.set(kunciUser(kunci), { t: Date.now(), h: h, data: r.data });
    if (!c || c.h !== h) render(r.data, false);
    return r.data;
  } catch (e) {
    if (!c) throw e;
    if (e.code === 'JARINGAN' && !AppState.infoOffline) { AppState.infoOffline = true; toast('Mode luring', 'Menampilkan data tersimpan terakhir. ' + e.message, 'warning'); setTimeout(() => { AppState.infoOffline = false; }, 60000); }
    else if (e.code !== 'JARINGAN') tanganiGalat(e);
    return c.data;
  }
}

/** Render ulang tanpa kehilangan isian form, fokus & posisi kursor milik pengguna. */
function pertahankanForm(root, fn) {
  const nilai = {};
  $$('input[id], select[id], textarea[id]', root).forEach(el => { nilai[el.id] = el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value; });
  const aktif = document.activeElement && root.contains(document.activeElement) ? document.activeElement.id : '';
  let sel = null;
  try { if (aktif) sel = [document.activeElement.selectionStart, document.activeElement.selectionEnd]; } catch (e) { sel = null; }
  fn();
  Object.keys(nilai).forEach(id => {
    const el = document.getElementById(id);
    if (!el || !root.contains(el) || el.type === 'file') return;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = nilai[id]; else if (el.value !== nilai[id]) el.value = nilai[id];
  });
  if (aktif) { const el = document.getElementById(aktif); if (el) { el.focus(); try { if (sel && sel[0] != null) el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* abaikan */ } } }
}

// ── Pustaka dimuat saat dibutuhkan (lazy) → halaman pertama lebih ringan ──
const PUSTAKA = {
  chart: ['https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js', () => window.Chart],
  scanner: ['https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js', () => window.Html5Qrcode],
  qr: ['https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js', () => window.QRCode],
  admin: ['js/admin.js?v=' + (KONFIG.VERSI || '2'), () => window.SIPANTAU_ADMIN]
};
const _pustaka = {};
function muatPustaka(nama) {
  const p = PUSTAKA[nama];
  if (!p) return Promise.reject(new Error('Pustaka tidak dikenal: ' + nama));
  if (p[1]()) return Promise.resolve();
  if (_pustaka[nama]) return _pustaka[nama];
  _pustaka[nama] = new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = p[0]; sc.async = true;
    if (/^https:/.test(p[0])) sc.crossOrigin = 'anonymous';
    sc.onload = () => (p[1]() ? res() : rej(new Error('Pustaka ' + nama + ' tidak lengkap.')));
    sc.onerror = () => { delete _pustaka[nama]; sc.remove(); rej(new Error('Gagal memuat pustaka ' + nama + '. Periksa koneksi internet lalu coba lagi.')); };
    document.head.appendChild(sc);
  });
  return _pustaka[nama];
}
function saatIdle(fn, ms) { (window.requestIdleCallback ? (f => requestIdleCallback(f, { timeout: ms || 3000 })) : (f => setTimeout(f, ms || 1500)))(fn); }

function tanganiGalat(e, judul) {
  if (!e || e.code === 'AUTH' || e.code === 'GANTI_SANDI') return;
  toast(judul || 'Gagal', e.message || String(e), 'danger');
}
async function denganTombol(btn, fn) {
  if (!btn || btn.disabled) return btn ? undefined : fn();
  const asli = btn.innerHTML;
  btn.disabled = true;
  btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="spinner-inline" aria-hidden="true"></span> Memproses…';
  try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = asli; }
}

// ════════════════════════════════════════════════════════
// 4. TOAST, MODAL, KONFIRMASI, UNDUHAN
// ════════════════════════════════════════════════════════
function toast(judul, pesan, tipe) {
  const el = $('#appToast');
  el.className = 'toast t-' + (tipe || 'info');
  $('#toastTitle').textContent = judul;
  $('#toastBody').textContent = pesan;
  bootstrap.Toast.getOrCreateInstance(el, { delay: tipe === 'danger' ? 7000 : 4000 }).show();
}

/** Modal serbaguna. sheet=true → muncul dari bawah (bottom sheet) di layar HP. */
function bukaModal(o) {
  const m = $('#modalUmum');
  const tampil = m.classList.contains('show');
  m.querySelector('.modal-dialog').className = 'modal-dialog modal-dialog-centered modal-dialog-scrollable' + (o.ukuran ? ' modal-' + o.ukuran : '');
  m.classList.toggle('sheet', !!o.sheet);
  $('#modalUmumTitle').innerHTML = o.judul || '';
  $('#modalUmumBody').innerHTML = o.isi || '';
  const foot = $('#modalUmumFoot');
  foot.innerHTML = o.kaki || '<button type="button" class="btn btn-soft" data-bs-dismiss="modal">Tutup</button>';
  foot.classList.toggle('hidden', o.kaki === false);
  const inst = bootstrap.Modal.getOrCreateInstance(m);
  if (o.onTampil) { if (tampil) setTimeout(o.onTampil, 0); else m.addEventListener('shown.bs.modal', o.onTampil, { once: true }); }
  if (!tampil) inst.show();
  return inst;
}
function tutupModal() {
  return new Promise(res => {
    const m = $('#modalUmum');
    const i = bootstrap.Modal.getInstance(m);
    if (!i || !m.classList.contains('show')) { res(); return; }
    m.addEventListener('hidden.bs.modal', () => res(), { once: true });
    i.hide();
  });
}

/** Konfirmasi (opsional dengan isian catatan). Resolve {ok, nilai} atau null jika batal. */
function konfirmasi(o) {
  return new Promise(resolve => {
    const m = $('#modalKonfirmasi');
    $('#konfJudul').textContent = o.judul || 'Konfirmasi';
    $('#konfPesan').innerHTML = o.pesan || '';
    const wrap = $('#konfInputWrap'), inp = $('#konfInput');
    wrap.classList.toggle('hidden', !o.input);
    inp.value = (o.input && o.input.nilai) || '';
    inp.classList.remove('is-invalid');
    if (o.input) {
      $('#konfInputLabel').textContent = o.input.label || 'Catatan';
      inp.placeholder = o.input.placeholder || '';
    }
    const ok = $('#konfOk');
    ok.className = 'btn ' + (o.okKelas || 'btn-navy');
    ok.textContent = o.okTeks || 'Ya, lanjutkan';
    let hasil = null;
    const inst = bootstrap.Modal.getOrCreateInstance(m);
    ok.onclick = () => {
      if (o.input && o.input.wajib && inp.value.trim().length < (o.input.min || 1)) { inp.classList.add('is-invalid'); inp.focus(); return; }
      hasil = { ok: true, nilai: inp.value.trim() };
      inst.hide();
    };
    m.addEventListener('hidden.bs.modal', () => resolve(hasil), { once: true });
    m.addEventListener('shown.bs.modal', () => (o.input ? inp : ok).focus(), { once: true });
    inst.show();
  });
}

function base64KeBlob(b64, mime) {
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
function unduhBlob(blob, nama) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = nama; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function selCsv(v) { let s = String(v === null || v === undefined ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; }
function unduhCsv(nama, header, rows) {
  const isi = '﻿' + [header].concat(rows).map(r => r.map(selCsv).join(';')).join('\r\n');
  unduhBlob(new Blob([isi], { type: 'text/csv;charset=utf-8' }), nama);
  toast('Ekspor selesai', nama + ' (' + rows.length + ' baris) diunduh. Buka dengan Excel / Google Sheets.', 'success');
}

/** Pratinjau PDF hasil server: tombol unduh + tautan cadangan Google Drive (andal di HP & iframe) */
function tampilPdf(res, judul) {
  const url = URL.createObjectURL(base64KeBlob(res.base64, 'application/pdf'));
  $('#previewJudul').textContent = judul;
  $('#previewIsi').innerHTML = '<div class="placeholder-card"><i class="bi bi-file-earmark-pdf" aria-hidden="true"></i><div class="fw-bold">' + esc(res.namaFile) +
    '</div><div class="small mt-1">PDF berkop resmi siap dicetak. Tekan <b>Unduh</b> untuk menyimpan.</div>' +
    (res.url ? '<a class="btn btn-soft btn-sm mt-3" href="' + esc(res.url) + '" target="_blank" rel="noopener"><i class="bi bi-google"></i> Buka salinan di Google Drive</a>' : '') + '</div>';
  const a = $('#previewUnduh');
  a.classList.remove('hidden');
  a.href = url; a.setAttribute('download', res.namaFile);
  bootstrap.Modal.getOrCreateInstance($('#modalPreview')).show();
}
function zoomGambar(src, judul) {
  $('#previewJudul').textContent = judul || 'Foto HP';
  $('#previewIsi').innerHTML = '<img src="' + esc(src) + '" alt="' + esc(judul || 'Foto') + '" style="max-width:100%;max-height:72vh;border-radius:12px">';
  const a = $('#previewUnduh');
  a.classList.remove('hidden');
  a.href = src; a.setAttribute('download', (judul || 'foto').replace(/[^\w-]+/g, '_') + '.jpg');
  bootstrap.Modal.getOrCreateInstance($('#modalPreview')).show();
}
async function salinTeks(teks) {
  try { await navigator.clipboard.writeText(teks); toast('Disalin', 'Teks disalin ke papan klip.', 'success'); return; } catch (e) { /* fallback */ }
  const t = document.createElement('textarea');
  t.value = teks; t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); toast('Disalin', 'Teks disalin ke papan klip.', 'success'); } catch (e) { toast('Gagal menyalin', 'Salin teks secara manual.', 'warning'); }
  t.remove();
}

// ── Gambar: perkecil di browser sebelum dikirim (hemat kuota & cepat di 4G) ──
function bacaFile(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Gagal membaca file.')); r.readAsDataURL(file); }); }
function muatGambar(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('File bukan gambar yang valid.')); i.src = src; }); }
function ukuranDataUrl(d) { return Math.ceil((d.length - d.indexOf(',') - 1) * 3 / 4); }
async function perkecilGambar(file, maks, mime, kualitas, batasByte) {
  const img = await muatGambar(await bacaFile(file));
  let ukuran = maks, q = kualitas, hasil = '';
  for (let i = 0; i < 8; i++) {
    const sk = Math.min(1, ukuran / Math.max(img.width, img.height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(img.width * sk)); cv.height = Math.max(1, Math.round(img.height * sk));
    const ctx = cv.getContext('2d');
    if (mime === 'image/jpeg') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height); }
    ctx.drawImage(img, 0, 0, cv.width, cv.height);
    hasil = cv.toDataURL(mime, q);
    if (ukuranDataUrl(hasil) <= batasByte) return hasil;
    if (mime === 'image/jpeg' && q > 0.45) q -= 0.1; else ukuran = Math.round(ukuran * 0.8);
  }
  return hasil;
}
function dataUrlKeFile(d, nama) {
  const m = d.match(/^data:([^;]+);base64,(.+)$/);
  return new File([base64KeBlob(m[2], m[1])], nama, { type: m[1] });
}

// ── QR: dibuat di browser (qrcodejs) + margin putih agar mudah dibaca kamera ──
function buatQrDataUrl(teks, ukuran) {
  if (!window.QRCode) throw new Error('Pustaka pembuat QR belum termuat. Periksa koneksi internet lalu muat ulang halaman.');
  ukuran = ukuran || 300;
  const w = $('#qrWork');
  w.innerHTML = '';
  new QRCode(w, { text: teks, width: ukuran, height: ukuran, colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.M });
  const src = w.querySelector('canvas');
  let hasil = '';
  if (src) {
    const pad = Math.round(ukuran * 0.08);
    const cv = document.createElement('canvas');
    cv.width = cv.height = ukuran + pad * 2;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, pad, pad);
    hasil = cv.toDataURL('image/png');
  } else {
    const img = w.querySelector('img');
    hasil = img ? img.src : '';
  }
  w.innerHTML = '';
  return hasil;
}

// ── Suara & getar umpan balik scan ──
let _audio = null;
function siapkanAudio() {
  try {
    if (!_audio) _audio = new (window.AudioContext || window.webkitAudioContext)();
    if (_audio.state === 'suspended') _audio.resume();
  } catch (e) { _audio = null; }
}
function bunyi(jenis) {
  try {
    siapkanAudio();
    if (!_audio) return;
    const pola = jenis === 'gagal' ? [[240, 0, 0.18], [170, 0.22, 0.3]] : jenis === 'ok' ? [[660, 0, 0.1], [990, 0.12, 0.16]] : [[1300, 0, 0.08]];
    const t0 = _audio.currentTime;
    pola.forEach(p => {
      const o = _audio.createOscillator(), g = _audio.createGain();
      o.type = jenis === 'gagal' ? 'square' : 'sine';
      o.frequency.value = p[0];
      g.gain.setValueAtTime(0.0001, t0 + p[1]);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + p[1] + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p[1] + p[2]);
      o.connect(g); g.connect(_audio.destination);
      o.start(t0 + p[1]); o.stop(t0 + p[1] + p[2] + 0.03);
    });
  } catch (e) { /* abaikan */ }
}
function getar(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* abaikan */ } }

// ── Grafik ──
function warnaGrafik() {
  const gelap = document.documentElement.getAttribute('data-theme') === 'dark';
  return { navy: gelap ? '#7F9CF5' : '#13254A', green: '#1E8A3A', red: '#C62828', gold: '#E5B219', gray: gelap ? '#64748B' : '#94A3B8' };
}
function aturChartDefault() {
  if (!window.Chart) return;
  const s = getComputedStyle(document.documentElement);
  Chart.defaults.color = s.getPropertyValue('--text-secondary').trim() || '#5B6475';
  Chart.defaults.borderColor = s.getPropertyValue('--border-color').trim() || '#E2E6EE';
  Chart.defaults.font.family = 'Inter, system-ui, sans-serif';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
}
function buatChart(canvas, cfg) {
  if (!canvas || !window.Chart) return null;
  aturChartDefault();
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: geraklah() ? { duration: 300 } : false }, cfg.options || {});
  const ch = new Chart(canvas, cfg);
  AppState.charts.push(ch);
  return ch;
}
function hancurkanChart() { AppState.charts.forEach(c => { try { c.destroy(); } catch (e) { /* abaikan */ } }); AppState.charts = []; }

// ════════════════════════════════════════════════════════
// 5. LAYAR, TEMA, NAVIGASI (SPA ROUTER — URL TIDAK PERNAH BERUBAH)
// ════════════════════════════════════════════════════════
function sembunyikanLoading() { const o = $('#loadingOverlay'); if (!o) return; o.style.opacity = '0'; setTimeout(() => o.remove(), 300); }

function tampilLayar(nama) {
  $('#screenLogin').classList.toggle('hidden', nama !== 'login');
  $('#screenGantiSandi').classList.toggle('hidden', nama !== 'gantiSandi');
  $('#appShell').classList.toggle('hidden', nama !== 'app');
  if (nama !== 'app') bersihkanHalaman();
  if (nama === 'login') setTimeout(() => { const n = $('#loginNip'); if (n && !n.value) n.focus(); else if ($('#loginSandi')) $('#loginSandi').focus(); }, 80);
  if (nama === 'gantiSandi') setTimeout(() => $('#gsLama').focus(), 80);
}

function terapkanTema(t) {
  document.documentElement.setAttribute('data-theme', t);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#0B1222' : '#13254A');
  if (window.Chart && AppState.charts.length) { aturChartDefault(); AppState.charts.forEach(c => { try { c.update(); } catch (e) { /* abaikan */ } }); }
}
function toggleDarkMode() {
  const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  simpanLokal('theme', t);
  terapkanTema(t);
}
function toggleSidebar() {
  const s = $('#sidebar'), o = $('#sidebarOverlay');
  const on = !s.classList.contains('show');
  s.classList.toggle('show', on); o.classList.toggle('show', on);
  if (on) { const a = s.querySelector('a.active') || s.querySelector('a'); if (a) a.focus(); }
}
function closeSidebar() { $('#sidebar').classList.remove('show'); $('#sidebarOverlay').classList.remove('show'); }

function renderInfo() {
  const i = AppState.info || {};
  renderLogo(i.logos || {});
  if (i.instansi) $('#loginInstansi').textContent = i.instansi;
  document.title = (i.appName || 'SIPANTAU-HP') + ' | ' + (i.instansi || 'Lapas Kelas IIB Nabire');
}
function renderLogo(logos) {
  const slot = [['logoKemenimipas', 'Kemenimipas', 'bi-bank2'], ['logoPemasyarakatan', 'Pemasyarakatan', 'bi-shield-check'], ['logoLapas', 'Lapas Nabire', 'bi-building']];
  const html = slot.map(s => logos[s[0]] ? '<img src="' + esc(logos[s[0]]) + '" alt="Logo ' + s[1] + '">' :
    '<span class="logo-placeholder" role="img" aria-label="Logo ' + s[1] + ' belum diunggah" title="Logo ' + s[1] + ' belum diunggah"><i class="bi ' + s[2] + '" aria-hidden="true"></i></span>').join('');
  $$('[data-logos]').forEach(el => { el.innerHTML = html; });
}

function renderNav() {
  const peran = AppState.user.peran;
  let grup = '', html = '';
  (URUTAN_MENU[peran] || []).forEach(id => {
    const m = MENU[id];
    if (m.grup !== grup) { grup = m.grup; html += '<li class="nav-group">' + esc(grup) + '</li>'; }
    html += '<li><a href="#" data-nav="' + id + '"><i class="bi ' + m.ikon + '" aria-hidden="true"></i><span>' + esc(m.label) +
      '</span><span class="badge nav-badge hidden" data-badge="' + id + '"></span></a></li>';
  });
  $('#sidebarNav').innerHTML = html;
  $('#bottomNav .wrap').innerHTML = (MENU_BAWAH[peran] || []).map(id => {
    const m = MENU[id];
    return '<button type="button" data-nav="' + id + '" aria-label="' + esc(m.label) + '"><i class="bi ' + m.ikon + '" aria-hidden="true"></i><span>' +
      esc(m.pendek) + '</span><span class="dot hidden" data-badge="' + id + '"></span></button>';
  }).join('') + '<button type="button" data-act="bukaMenu" aria-label="Menu lainnya"><i class="bi bi-grid-3x3-gap" aria-hidden="true"></i><span>Menu</span></button>';
}
function setBadge(id, n) { $$('[data-badge="' + id + '"]').forEach(b => { b.textContent = n > 99 ? '99+' : (n || ''); b.classList.toggle('hidden', !n); }); }

function masukAplikasi(user, boot) {
  AppState.user = user;
  benihBoot(boot);
  $('#sbNama').textContent = user.nama;
  $('#sbPeran').textContent = (LABEL_PERAN[user.peran] || user.peran) + (user.regu ? ' • ' + user.regu : '');
  $('#sbAvatar').textContent = inisial(user.nama);
  renderNav();
  tampilLayar('app');
  const dariHash = halamanDariHash();
  const awal = dariHash && MENU[dariHash] && MENU[dariHash].peran.indexOf(user.peran) >= 0 ? dariHash : ((boot && boot.halaman) || LANDING[user.peran] || 'hpSaya');
  navigateTo(awal, { ganti: true });
  saatIdle(prefetchPeran, 2500);
}

/** Data layar pertama yang ikut jawaban login/cekToken → disimpan ke cache agar layar pertama tampil tanpa panggilan kedua. */
function benihBoot(boot) {
  if (!boot || !AppState.user) return;
  if (boot.dash) simpanCache('getDashboard', boot.dash);
  if (boot.hpSaya) simpanCache('getHpSaya', boot.hpSaya);
}

/** Prefetch saat idle: data menu yang paling sering dibuka per peran → 1 panggilan batch. */
const PREFETCH = {
  ADMIN: ['getIzin', 'getPetugasList', 'getHpList', 'getPengaturan', 'getHpSaya'],
  PIMPINAN: ['getIzin', 'getHpSaya', 'crmStats'],
  P2U: ['getIzin', 'getHpSaya'],
  PETUGAS: ['getIzin']
};
async function prefetchPeran() {
  const u = AppState.user;
  if (!u || document.hidden) return;
  const daftar = (PREFETCH[u.peran] || []).filter(fn => { const c = ambilCache(fn); return !c || Date.now() - c.t > (SEGAR[fn] || 30000); });
  if (u.peran === 'ADMIN' || u.peran === 'PIMPINAN') muatPustaka('admin').catch(() => {});
  if (!daftar.length) return;
  try {
    const r = await apiOpsi({ diam: true }, 'batch', daftar.map(fn => ({ fn: fn })));
    if (!AppState.user || AppState.user.nip !== u.nip) return;
    Object.keys(r.data || {}).forEach(fn => { const x = r.data[fn]; if (x && x.success) simpanCache(fn, x.data); });
  } catch (e) { /* prefetch tidak kritis */ }
}

// ── Router hash: #/menu → tombol Kembali HP & tautan langsung berfungsi ──
function halamanDariHash() { const m = /^#\/([A-Za-z]+)/.exec(location.hash || ''); return m ? m[1] : ''; }
function aturHash(page, ganti) {
  const h = '#/' + page;
  if (location.hash === h) return;
  try { history[ganti ? 'replaceState' : 'pushState'](null, '', h); } catch (e) { location.hash = h; }
}

function sesiBerakhir(pesan) {
  if (!AppState.user && !AppState.token) return;
  AppState.token = null; AppState.user = null;
  simpanLokal(KUNCI_TOKEN, null);
  Store.del('userTerakhir');
  hapusHash();
  tampilLayar('login');
  toast('Sesi berakhir', pesan || 'Silakan login kembali.', 'warning');
}

function bersihkanHalaman() {
  AppState.timers.forEach(t => clearInterval(t));
  AppState.timers = [];
  hancurkanChart();
  if (AppState.scanner || AppState.scannerOn) stopKamera();
  AppState.hasilScan = null;
  AppState.kameraTadi = false;
}
function pasangTimer(fn, ms) { AppState.timers.push(setInterval(() => { if (!document.hidden) fn(); }, ms)); }

/**
 * Navigasi SPA: satu-satunya cara berpindah halaman.
 * Tidak memakai window.location / window.open / ?page= (aman di dalam iframe).
 */
async function navigateTo(page, o) {
  const u = AppState.user;
  if (!u) return;
  if (!MENU[page] || MENU[page].peran.indexOf(u.peran) === -1) page = LANDING[u.peran] || 'hpSaya';
  bersihkanHalaman();
  const seq = ++AppState.navSeq;
  AppState.page = page;
  if (!(o && o.dariRiwayat)) aturHash(page, o && o.ganti);
  $('#pageTitle').textContent = MENU[page].label;
  $$('[data-nav]').forEach(a => {
    const on = a.dataset.nav === page;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  closeSidebar();
  const c = $('#app-container');
  c.innerHTML = memuat('Memuat ' + MENU[page].label.toLowerCase() + '…');
  window.scrollTo(0, 0);
  try {
    if (!HALAMAN[page] && MENU[page].modul) await muatPustaka(MENU[page].modul);
    if (basi(seq)) return;
    await HALAMAN[page](c, o || {}, seq);
  } catch (e) {
    if (!basi(seq)) c.innerHTML = kosong('bi-exclamation-triangle', e.message || 'Gagal memuat halaman.');
    tanganiGalat(e);
  }
}
AKSI.muatUlang = () => { const p = AppState.page; if (SEGARKAN[p]) SEGARKAN[p](); else navigateTo(p); };
AKSI.bukaMenu = () => toggleSidebar();
AKSI.tutupSidebar = () => closeSidebar();
AKSI.tema = () => toggleDarkMode();
AKSI.keluar = () => handleLogout();

// ════════════════════════════════════════════════════════
// 6. LOGIN, GANTI SANDI, LOGOUT
// ════════════════════════════════════════════════════════
async function onLogin(e) {
  e.preventDefault();
  const nip = $('#loginNip').value.trim(), sandi = $('#loginSandi').value;
  if (!nip || !sandi) { toast('Lengkapi data', 'NIP dan kata sandi wajib diisi.', 'warning'); (nip ? $('#loginSandi') : $('#loginNip')).focus(); return; }
  siapkanAudio();
  await denganTombol(e.target.querySelector('button[type="submit"]'), async () => {
    try {
      const r = await api('login', nip, sandi, perangkat());
      AppState.token = r.data.token;
      simpanLokal(KUNCI_TOKEN, r.data.token);
      AppState.user = r.data.user;
      $('#loginSandi').value = '';
      AppState.tulisTerakhir = 0;
      ingatUser(r.data);
      if (r.data.wajibGanti) {
        $('#gsLama').value = sandi;
        tampilLayar('gantiSandi');
        toast('Keamanan akun', 'Anda masih memakai kata sandi bawaan. Silakan buat kata sandi baru.', 'warning');
      } else {
        masukAplikasi(r.data.user, r.data.boot);
        toast('Selamat datang', r.data.user.nama + ' — ' + (LABEL_PERAN[r.data.user.peran] || ''), 'success');
      }
    } catch (err) {
      toast('Login gagal', err.message, 'danger');
      $('#loginSandi').select();
    }
  });
}

async function onGantiSandi(e) {
  e.preventDefault();
  const lama = $('#gsLama').value, baru = $('#gsBaru').value, ulang = $('#gsUlang').value;
  [$('#gsBaru'), $('#gsUlang')].forEach(x => x.classList.remove('is-invalid'));
  if (baru.length < 8 || !/[A-Za-z]/.test(baru) || !/\d/.test(baru)) {
    $('#gsBaru').classList.add('is-invalid'); $('#gsBaru').focus();
    toast('Kata sandi lemah', 'Minimal 8 karakter dan harus berisi huruf serta angka.', 'warning'); return;
  }
  if (baru !== ulang) { $('#gsUlang').classList.add('is-invalid'); $('#gsUlang').focus(); toast('Tidak sama', 'Ulangi kata sandi baru dengan benar.', 'warning'); return; }
  await denganTombol(e.target.querySelector('button[type="submit"]'), async () => {
    try {
      const r = await api('gantiSandi', lama, baru);
      ['#gsLama', '#gsBaru', '#gsUlang'].forEach(s => { $(s).value = ''; });
      if (r.data.token) { AppState.token = r.data.token; simpanLokal(KUNCI_TOKEN, r.data.token); }
      ingatUser({ user: r.data.user, wajibGanti: false });
      masukAplikasi(r.data.user, r.data.boot);
      toast('Berhasil', r.message, 'success');
    } catch (err) { tanganiGalat(err, 'Gagal mengganti sandi'); }
  });
}

function hapusHash() { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* abaikan */ } }
function handleLogout() {
  const t = AppState.token;
  bersihkanHalaman();
  if (AppState.user) Store.hapusUser();
  Store.del('userTerakhir');   // perangkat bersama: data user tidak tertinggal
  AppState.token = null; AppState.user = null; AppState.cache = {};
  simpanLokal(KUNCI_TOKEN, null);
  hapusHash();
  tampilLayar('login');
  if (t) panggilServer('logout', [t]).catch(() => {});
}

// ════════════════════════════════════════════════════════
// 7. HALAMAN: SCAN PINTU 2 (FITUR INTI P2U)
// ════════════════════════════════════════════════════════
const AKSI_HP = {
  TITIP: { kelas: 'titip', ikon: 'bi-box-arrow-in-down', teks: 'Titipkan', sub: 'Simpan di loker P2U', f: 'F1' },
  AMBIL: { kelas: 'ambil', ikon: 'bi-box-arrow-up', teks: 'Serahkan Kembali', sub: 'Petugas keluar / lepas dinas', f: 'F2' },
  BERIZIN_MASUK: { kelas: 'izin', ikon: 'bi-patch-check', teks: 'Catat Masuk Berizin', sub: 'HP boleh dibawa masuk', f: 'F3' },
  BERIZIN_KELUAR: { kelas: 'izin', ikon: 'bi-door-open', teks: 'Catat Keluar (Izin)', sub: 'HP dibawa keluar', f: 'F3' }
};
const JUDUL_SUKSES = { TITIP: 'HP DITITIPKAN', AMBIL: 'HP DISERAHKAN KEMBALI', BERIZIN_MASUK: 'MASUK BERIZIN TERCATAT', BERIZIN_KELUAR: 'KELUAR BERIZIN TERCATAT' };

const TOMBOL_GELAP = 'style="background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.18)"';

HALAMAN.scan = async (c, o, seq) => {
  c.innerHTML =
    '<div class="notice"><i class="bi bi-exclamation-triangle-fill" style="color:var(--gold-dark)" aria-hidden="true"></i><div><b>WAJIB:</b> seluruh petugas menitipkan HP di Pos P2U Pintu 2 (Pintu CCTV) sebelum masuk area dalam. ' +
    'Pindai stiker QR di HP atau kartu QR petugas, cocokkan foto & IMEI, lalu tekan tombol aksi.</div></div>' +
    '<div class="scan-grid">' +
    '<div class="min-w-0">' +
    '<section class="scanner-card" aria-label="Pemindai kamera">' +
    '<div class="d-flex justify-content-between align-items-center gap-2">' +
    '<span class="chip"><span class="live-dot" id="camDot" style="background:#94a3b8;animation:none"></span><span id="camChip">Kamera mati</span></span>' +
    '<div class="d-flex gap-1">' +
    '<button type="button" class="btn btn-icon-sm" ' + TOMBOL_GELAP + ' data-act="senter" id="btnSenter" aria-label="Nyalakan senter" disabled><i class="bi bi-lightning-charge"></i></button>' +
    '<button type="button" class="btn btn-icon-sm" ' + TOMBOL_GELAP + ' data-act="gantiKamera" aria-label="Ganti kamera"><i class="bi bi-arrow-repeat"></i></button>' +
    '</div></div>' +
    '<h2 class="h6 fw-bold mt-2 mb-0">Pindai QR Label HP / Kartu Petugas</h2>' +
    '<p class="small mb-0" style="color:#c8d0e0">Arahkan kamera ke stiker QR di belakang HP.</p>' +
    '<div class="reader-box"><div id="reader"></div>' +
    '<span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>' +
    '<div class="laser hidden" id="laser"></div>' +
    '<div class="reader-idle" id="readerIdle"><i class="bi bi-qr-code-scan" aria-hidden="true"></i><div class="t">Kamera belum aktif</div>' +
    '<button type="button" class="btn btn-gold" data-act="mulaiKamera"><i class="bi bi-camera-video"></i> Aktifkan Kamera</button></div>' +
    '</div>' +
    '<div class="scan-actions">' +
    '<button type="button" class="btn btn-gold" data-act="toggleKamera" id="btnKamera"><i class="bi bi-camera-video"></i> Aktifkan Kamera</button>' +
    '<button type="button" class="btn" ' + TOMBOL_GELAP + ' data-act="fotoQr"><i class="bi bi-image"></i> Foto QR</button>' +
    '<input type="file" accept="image/*" capture="environment" id="inputFotoQr" data-chg="fotoQr" hidden>' +
    '</div>' +
    '<div class="small mt-2" id="scanStatus" style="color:#c8d0e0" aria-live="polite">Tips: jika kamera tidak bisa dibuka (izin ditolak / browser lama), gunakan <b>Foto QR</b> atau input manual.</div>' +
    '</section>' +
    '<form class="cardx cardx-body mt-3" id="formManual" data-submit="manual" autocomplete="off">' +
    '<label class="form-label" for="manualInput">Input manual / pemindai barcode USB</label>' +
    '<div class="input-group"><span class="input-group-text"><i class="bi bi-search" aria-hidden="true"></i></span>' +
    '<input id="manualInput" class="form-control mono" placeholder="ID HP, NIP, nama, atau 4 digit IMEI" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="search">' +
    '<button class="btn btn-navy" type="submit">Proses</button></div>' +
    '<div class="form-text">Tekan Enter untuk memproses. Pemindai USB/Bluetooth otomatis mengetik di kolom ini.</div>' +
    '</form>' +
    '</div>' +
    '<div class="min-w-0">' +
    '<div id="scanResult" aria-live="polite" tabindex="-1">' + kartuSiap() + '</div>' +
    '<div class="mini-stats mt-3" id="miniStats">' + miniStats(null) + '</div>' +
    '<section class="cardx mt-3"><div class="cardx-head"><h6><i class="bi bi-exclamation-triangle" style="color:var(--red)" aria-hidden="true"></i> Atensi &amp; HP di loker</h6>' +
    '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="muatStatScan" aria-label="Muat ulang daftar"><i class="bi bi-arrow-clockwise"></i></button></div>' +
    '<div class="cardx-body py-1" id="atensiList">' + memuat() + '</div></section>' +
    '</div></div>';

  muatStatScan();
  pasangTimer(() => muatStatScan(), 60000);
  if (!layarSentuh()) setTimeout(() => { const m = $('#manualInput'); if (m) m.focus(); }, 100);
  // Kamera otomatis menyala bila sebelumnya pernah diizinkan di perangkat ini
  if (ambilLokal('sphp_cam') === '1') mulaiKamera();
};
SEGARKAN.scan = () => muatStatScan();
AKSI.muatStatScan = () => muatStatScan();

function kartuSiap() {
  return '<div class="placeholder-card"><i class="bi bi-upc-scan" aria-hidden="true"></i><div class="fw-bold">Siap memindai</div>' +
    '<div class="small">Foto HP, pemilik, merek, warna &amp; 4 digit IMEI tampil di sini.' +
    (layarSentuh() ? '' : '<br>Pintasan: <kbd>F1</kbd> Titipkan • <kbd>F2</kbd> Serahkan • <kbd>F3</kbd> Izin • <kbd>Esc</kbd> Pindai lagi') + '</div></div>';
}
function miniStats(k) {
  k = k || {};
  const v = x => (x === undefined ? '–' : x);
  return '<div class="ms"><b>' + v(k.titip) + '</b><span>Dititip</span></div>' +
    '<div class="ms"><b style="color:var(--green)">' + v(k.ambil) + '</b><span>Diambil</span></div>' +
    '<div class="ms navy"><b>' + v(k.tertahan) + '</b><span>Di loker</span></div>' +
    '<div class="ms red"><b>' + v(k.terlambat) + '</b><span>Lewat batas</span></div>';
}

async function muatStatScan() {
  try {
    await swr('getDashboard', 'getDashboard', [], tampilStatScan, { paksa: !!AppState.cache.dash });
  } catch (e) { /* senyap: data ringkas tidak kritis */ }
}
function tampilStatScan(d) {
  {
    AppState.cache.dash = d;
    setBadge('izin', d.kpi.izinMenunggu);
    if (AppState.page !== 'scan') return;
    const ms = $('#miniStats'); if (ms) ms.innerHTML = miniStats(d.kpi);
    const el = $('#atensiList'); if (!el) return;
    const daftar = d.terbuka.slice().sort((a, b) => (b.terlambat - a.terlambat) || (b.menitLewat - a.menitLewat) || (new Date(a.batas) - new Date(b.batas)));
    el.innerHTML = daftar.length ? daftar.slice(0, 8).map(itemAtensi).join('') +
      (daftar.length > 8 ? '<div class="text-center small py-2"><a href="#" data-nav="dashboard">Lihat semua (' + daftar.length + ')</a></div>' : '') :
      kosong('bi-check2-circle', 'Tidak ada HP di loker. Semua aman.');
  }
}
function itemAtensi(x) {
  const tagKelas = x.terlambat ? 'red' : (x.jenis === 'BERIZIN' ? 'gold' : '');
  const ket = x.terlambat ? '<span style="color:var(--red);font-weight:700">Lewat batas ' + durasi(x.menitLewat) + '</span> (batas ' + fmt(x.batas, 'jam') + ')' :
    'Batas ambil ' + fmt(x.batas, 'jam') + ' • dititip ' + durasi(x.durasiMenit);
  return '<div class="list-item"><span class="tag-loker ' + tagKelas + '">' + esc(x.idHp) + '</span>' +
    '<div class="grow"><div class="fw-semibold truncate">' + esc(x.nama) + '</div>' +
    '<div class="cell-sub truncate">' + esc(x.regu) + ' • ' + esc(x.merek) + (x.jenis === 'BERIZIN' ? ' • berizin' : '') + '</div>' +
    '<div class="cell-sub">' + ket + '</div></div>' +
    '<button type="button" class="btn btn-sm ' + (x.terlambat ? 'btn-red' : 'btn-soft') + '" data-act="panggil" data-idlog="' + esc(x.idLog) + '">Panggil</button></div>';
}

// ── Kamera (html5-qrcode) ──
function statusScan(teks) { const el = $('#scanStatus'); if (el) el.innerHTML = teks; }
function uiKamera(on) {
  const b = $('#btnKamera');
  if (b) b.innerHTML = on ? '<i class="bi bi-stop-circle"></i> Matikan Kamera' : '<i class="bi bi-camera-video"></i> Aktifkan Kamera';
  const idle = $('#readerIdle'); if (idle) idle.classList.toggle('hidden', on);
  const l = $('#laser'); if (l) l.classList.toggle('hidden', !on);
  const chip = $('#camChip'); if (chip) chip.textContent = on ? 'Kamera P2U aktif' : 'Kamera mati';
  const dot = $('#camDot'); if (dot) { dot.style.background = on ? '#34d399' : '#94a3b8'; dot.style.animation = on ? '' : 'none'; }
  const s = $('#btnSenter'); if (s && !on) s.disabled = true;
}
async function mulaiKamera() {
  if (AppState.scannerOn || AppState.page !== 'scan' || !$('#reader')) return;
  siapkanAudio();
  statusScan('<span class="spinner-inline"></span> Membuka kamera…');
  if (!window.Html5Qrcode) {
    try { await muatPustaka('scanner'); } catch (e) { statusScan('Pustaka pemindai gagal dimuat.'); toast('Pemindai', e.message, 'danger'); return; }
    if (AppState.scannerOn || AppState.page !== 'scan' || !$('#reader')) return;
  }
  try {
    const cfg = { verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } };
    if (window.Html5QrcodeSupportedFormats) cfg.formatsToSupport = [Html5QrcodeSupportedFormats.QR_CODE];
    const sc = new Html5Qrcode('reader', cfg);
    AppState.scanner = sc;
    const sumber = (AppState.kameraIdx >= 0 && AppState.kameraList[AppState.kameraIdx]) ? AppState.kameraList[AppState.kameraIdx].id : { facingMode: 'environment' };
    await sc.start(sumber, {
      fps: 12,
      qrbox: (w, h) => { const s = Math.max(160, Math.floor(Math.min(w, h) * 0.72)); return { width: s, height: s }; },
      aspectRatio: 1.0
    }, onDecode, () => {});
    if (AppState.scanner !== sc || AppState.page !== 'scan') { try { await sc.stop(); sc.clear(); } catch (e) { /* abaikan */ } return; }
    AppState.scannerOn = true;
    simpanLokal('sphp_cam', '1');
    uiKamera(true);
    statusScan('<i class="bi bi-check-circle" style="color:#34d399"></i> Kamera aktif — arahkan ke QR. Bunyi &amp; getar menandakan QR terbaca.');
    try {
      const t = sc.getRunningTrackCameraCapabilities().torchFeature();
      const s = $('#btnSenter'); if (s) s.disabled = !t.isSupported();
    } catch (e) { /* senter tidak didukung */ }
  } catch (err) {
    AppState.scanner = null; AppState.scannerOn = false;
    uiKamera(false);
    galatKamera(err);
  }
}
async function stopKamera() {
  const sc = AppState.scanner;
  AppState.scanner = null; AppState.scannerOn = false;
  if (sc) {
    try { if (sc.isScanning || (sc.getState && sc.getState() >= 2)) await sc.stop(); } catch (e) { /* abaikan */ }
    try { sc.clear(); } catch (e) { /* abaikan */ }
  }
  if (AppState.page === 'scan') { uiKamera(false); statusScan('Kamera dimatikan. Tekan <b>Aktifkan Kamera</b> untuk memindai lagi.'); }
}
function jedaKamera() { const sc = AppState.scanner; try { if (sc && sc.getState && sc.getState() === 2) sc.pause(true); } catch (e) { /* abaikan */ } }
function lanjutKamera() { const sc = AppState.scanner; try { if (sc && sc.getState && sc.getState() === 3) sc.resume(); } catch (e) { /* abaikan */ } }
function galatKamera(err) {
  const p = String((err && (err.name || err.message)) || err);
  let teks;
  if (/NotAllowed|Permission|denied/i.test(p)) teks = 'Izin kamera ditolak. Izinkan kamera lewat ikon gembok di bilah alamat browser (Setelan situs → Kamera → Izinkan), lalu muat ulang halaman.';
  else if (/NotFound|Overconstrained|not found|no camera/i.test(p)) teks = 'Kamera tidak ditemukan pada perangkat ini. Gunakan input manual atau pemindai barcode USB.';
  else if (/NotReadable|TrackStart|Could not start|in use/i.test(p)) teks = 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera lain lalu coba lagi.';
  else if (/secure|https|insecure/i.test(p)) teks = 'Kamera hanya dapat dibuka melalui koneksi HTTPS.';
  else teks = 'Kamera tidak dapat dibuka (' + esc(p).slice(0, 120) + ').';
  statusScan('<i class="bi bi-exclamation-triangle" style="color:var(--gold)"></i> ' + teks + ' Alternatif: tombol <b>Foto QR</b> atau input manual.');
  toast('Kamera', teks.replace(/<[^>]+>/g, ''), 'warning');
}
AKSI.mulaiKamera = () => mulaiKamera();
AKSI.toggleKamera = () => (AppState.scannerOn ? stopKamera() : mulaiKamera());
AKSI.gantiKamera = async () => {
  try {
    if (!AppState.kameraList.length) AppState.kameraList = await Html5Qrcode.getCameras();
    if (AppState.kameraList.length < 2) { toast('Kamera', 'Hanya satu kamera yang terdeteksi.', 'info'); return; }
    AppState.kameraIdx = (AppState.kameraIdx + 1) % AppState.kameraList.length;
    await stopKamera();
    await mulaiKamera();
    const k = AppState.kameraList[AppState.kameraIdx];
    toast('Kamera', k.label || ('Kamera ' + (AppState.kameraIdx + 1)), 'info');
  } catch (e) { galatKamera(e); }
};
AKSI.senter = async (el) => {
  const sc = AppState.scanner;
  if (!sc || !AppState.scannerOn) return;
  try {
    const t = sc.getRunningTrackCameraCapabilities().torchFeature();
    if (!t.isSupported()) { toast('Senter', 'Perangkat ini tidak mendukung senter kamera dari browser.', 'warning'); return; }
    const on = !t.value();
    await t.apply(on);
    el.style.background = on ? 'var(--gold)' : 'rgba(255,255,255,.12)';
    el.style.color = on ? 'var(--navy-dark)' : '#fff';
    el.setAttribute('aria-pressed', on ? 'true' : 'false');
  } catch (e) { toast('Senter', 'Senter tidak dapat diaktifkan.', 'warning'); }
};
AKSI.fotoQr = () => { siapkanAudio(); const i = $('#inputFotoQr'); if (i) { i.value = ''; i.click(); } };
UBAH.fotoQr = async (el) => {
  const file = el.files && el.files[0];
  if (!file) return;
  statusScan('<span class="spinner-inline"></span> Membaca QR dari foto…');
  try {
    const kecil = dataUrlKeFile(await perkecilGambar(file, 1400, 'image/jpeg', 0.92, 2000 * 1024), 'qr.jpg');
    await muatPustaka('scanner');
    const pembaca = new Html5Qrcode('readerFile', { verbose: false });
    let kode;
    try { kode = await pembaca.scanFile(kecil, false); } finally { try { pembaca.clear(); } catch (e) { /* abaikan */ } }
    statusScan('<i class="bi bi-check-circle" style="color:#34d399"></i> QR terbaca dari foto.');
    onDecode(kode);
  } catch (e) {
    bunyi('gagal');
    statusScan('<i class="bi bi-exclamation-triangle" style="color:var(--gold)"></i> QR tidak terbaca dari foto. Foto lebih dekat, tidak buram, dan cukup cahaya.');
    toast('Foto QR', 'QR tidak terbaca. Pastikan label terlihat jelas & tidak buram.', 'warning');
  }
};

function onDecode(teks) {
  const kode = String(teks || '').trim();
  if (!kode || AppState.sibukScan) return;
  const now = Date.now();
  if (kode === AppState.lastCode && now - AppState.lastCodeAt < 3000) return;
  AppState.lastCode = kode; AppState.lastCodeAt = now;
  jedaKamera();
  bunyi('scan'); getar(60);
  prosesKode(kode);
}
async function prosesKode(kode) {
  AppState.sibukScan = true;
  const w = $('#scanResult');
  if (w) w.innerHTML = '<div class="placeholder-card">' + memuat('Memeriksa data…') + '</div>';
  gulirKeHasil();
  try {
    const r = await api('prosesScan', kode, perangkat());
    if (AppState.page !== 'scan') return;
    renderHasilScan(r.data);
  } catch (e) {
    if (AppState.page === 'scan' && $('#scanResult')) {
      $('#scanResult').innerHTML = '<div class="result-card warn"><div class="result-body text-center">' + kosong('bi-exclamation-circle', e.message) +
        '<button type="button" class="btn btn-soft w-100" data-act="scanLagi"><i class="bi bi-arrow-repeat"></i> Pindai lagi</button></div></div>';
    }
    tanganiGalat(e);
  } finally { AppState.sibukScan = false; }
}
function gulirKeHasil() {
  const w = $('#scanResult');
  if (!w || !matchMedia('(max-width: 991.98px)').matches) return;
  w.scrollIntoView({ behavior: geraklah() ? 'smooth' : 'auto', block: 'start' });
}

function renderHasilScan(d) {
  const w = $('#scanResult');
  if (!w) return;
  AppState.hasilScan = null;
  if (d.tipe === 'HP') {
    AppState.hasilScan = d.item;
    w.innerHTML = kartuHp(d.item, d.manual);
    if (d.item.logTerbuka && d.item.logTerbuka.terlambat) { bunyi('gagal'); getar([200, 80, 200]); }
  } else if (d.tipe === 'TIDAK_SAH') {
    bunyi('gagal'); getar([300, 100, 300]);
    w.innerHTML = '<div class="result-card bad flash-bad"><div class="result-body"><div class="bad-banner"><i class="bi bi-x-octagon-fill" aria-hidden="true"></i>' +
      '<h3>LABEL TIDAK SAH</h3><div>' + esc(d.alasan) + '</div><div class="mono small mt-1">Kode: ' + esc(d.kode) + '</div></div>' +
      '<p class="small text-secondary-x mt-2 mb-2">Kejadian ini tercatat di log audit. Tahan HP dan laporkan ke Kasi Kamtib / Ka. KPLP.</p>' +
      '<button type="button" class="btn btn-soft w-100" data-act="scanLagi"><i class="bi bi-arrow-repeat"></i> Pindai berikutnya</button></div></div>';
    setTimeout(() => { if (AppState.page === 'scan' && !AppState.hasilScan) lanjutKamera(); }, 2500);
  } else if (d.tipe === 'PETUGAS' || d.tipe === 'DAFTAR') {
    AppState.cache.daftarScan = d.items || [];
    const p = d.petugas;
    const head = d.tipe === 'PETUGAS' ? '<div class="d-flex align-items-center gap-2 mb-2"><span class="avatar">' + esc(inisial(p.nama)) + '</span><div class="min-w-0"><div class="fw-bold truncate">' +
      esc(p.nama) + '</div><div class="cell-sub mono">' + esc(p.nip) + ' • ' + esc(p.regu) + (p.bko ? ' • BKO' : '') + '</div></div></div>' :
      '<div class="small text-secondary-x mb-2">Ditemukan ' + d.items.length + ' HP untuk pencarian "<b>' + esc(d.q) + '</b>". Pilih HP yang sesuai:</div>';
    w.innerHTML = '<div class="result-card ok"><div class="result-head"><span>' + (d.tipe === 'PETUGAS' ? 'Kartu Petugas Terbaca' : 'Hasil Pencarian') + '</span><span>' + d.items.length + ' HP</span></div>' +
      '<div class="result-body">' + head + (d.items.length ? d.items.map((it, i) =>
        '<div class="list-item"><span class="tag-loker">' + esc(it.id) + '</span><div class="grow"><div class="fw-semibold truncate">' + esc(it.merek) + ' — ' + esc(it.warna) + '</div>' +
        '<div class="cell-sub">' + (d.tipe === 'DAFTAR' ? esc(it.pemilik.nama) + ' • ' : '') + 'IMEI ****' + esc(it.imei4) + ' • ' + badge(it.status) + '</div></div>' +
        '<button type="button" class="btn btn-sm btn-navy" data-act="pilihHpScan" data-i="' + i + '">Pilih</button></div>').join('') :
        kosong('bi-phone', 'Petugas ini belum memiliki HP terdaftar.')) +
      '<button type="button" class="btn btn-soft w-100 mt-2" data-act="scanLagi"><i class="bi bi-arrow-repeat"></i> Pindai lagi</button></div></div>';
    if (d.items.length === 1) AKSI.pilihHpScan({ dataset: { i: '0' } });
  } else {
    bunyi('gagal');
    w.innerHTML = '<div class="result-card warn"><div class="result-body text-center">' + kosong('bi-search', 'Tidak ada HP aktif yang cocok dengan "' + (d.q || '') + '".') +
      '<button type="button" class="btn btn-soft w-100" data-act="scanLagi"><i class="bi bi-arrow-repeat"></i> Pindai lagi</button></div></div>';
  }
}
AKSI.pilihHpScan = (el) => {
  const it = (AppState.cache.daftarScan || [])[Number(el.dataset.i)];
  if (!it) return;
  AppState.hasilScan = it;
  $('#scanResult').innerHTML = kartuHp(it, true);
  muatFotoLazy($('#scanResult'));
};

function kartuHp(it, manual) {
  const p = it.pemilik || {}, lt = it.logTerbuka, iz = it.izin;
  const kelas = !it.aktif || (lt && lt.terlambat) ? 'bad' : iz ? 'warn' : 'ok';
  const foto = it.foto ? '<img src="' + esc(it.foto) + '" class="hp-photo" alt="Foto ' + esc(it.merek) + '" data-act="zoomFoto" role="button" tabindex="0">' :
    '<div class="hp-photo" role="img" aria-label="Foto HP" ' + (it.punyaFoto ? 'data-foto-hp="' + esc(it.id) + '"' : '') + '><i class="bi bi-phone" aria-hidden="true"></i></div>';
  let info = '';
  if (lt) {
    info += '<div class="small mt-2 ' + (lt.terlambat ? 'fw-bold' : '') + '" style="' + (lt.terlambat ? 'color:var(--red)' : '') + '"><i class="bi bi-clock-history" aria-hidden="true"></i> ' +
      (lt.jenis === 'BERIZIN' ? 'Masuk berizin' : 'Dititip') + ' ' + fmt(lt.waktuTitip, 'jam') + ' WIT • ' + esc(lt.durasi) + ' • Batas ' + fmt(lt.batas, 'tglJam') +
      (lt.terlambat ? ' — <span class="bs bs-red-solid">LEWAT BATAS</span>' : '') + '</div>';
  }
  if (iz) {
    info += '<div class="izin-banner"><b><i class="bi bi-patch-check-fill" aria-hidden="true"></i> BERIZIN — BOLEH DIBAWA</b> s/d ' + fmt(iz.sampai, 'tglJam') + ' WIT<br>' +
      '<span class="small">Keperluan: ' + esc(iz.alasan) + ' • Disetujui ' + esc(iz.peranPenyetuju) + ' • No. ' + esc(iz.id) + '</span></div>';
  }
  if (manual) info += '<div class="notice mt-2 mb-0 py-2"><i class="bi bi-hand-index-thumb" aria-hidden="true"></i><div class="small">Hasil input manual — <b>wajib cocokkan HP fisik</b> (merek, warna, IMEI) dengan data ini.</div></div>';

  let aksi = '';
  if (!it.aktif) {
    aksi = '<div class="bad-banner mt-3"><i class="bi bi-slash-circle" aria-hidden="true"></i><h3>HP NONAKTIF</h3><div>HP ini sudah dinonaktifkan. Hubungi Admin.</div></div>';
  } else if (it.aksi && it.aksi.length) {
    if (it.aksi.indexOf('AMBIL') >= 0) {
      aksi += '<fieldset class="mt-3"><legend class="form-label mb-1">Diambil oleh</legend><div class="seg" role="radiogroup">' +
        '<input type="radio" name="diambilOleh" id="olehPemilik" value="PEMILIK" checked data-chg="olehAmbil"><label for="olehPemilik"><i class="bi bi-person-check" aria-hidden="true"></i> Pemilik</label>' +
        '<input type="radio" name="diambilOleh" id="olehLain" value="ORANG_LAIN" data-chg="olehAmbil"><label for="olehLain"><i class="bi bi-people" aria-hidden="true"></i> Orang lain</label>' +
        '</div></fieldset><div id="wrapCatatanAmbil" class="hidden mt-2"><label class="form-label" for="catatanAmbil">Alasan &amp; nama pengambil (wajib)</label>' +
        '<textarea class="form-control" id="catatanAmbil" rows="2" placeholder="Contoh: Diambil Bripda Yohanes atas perintah Kasi Kamtib karena pemilik dinas luar"></textarea>' +
        '<div class="form-text">Pengambilan oleh orang lain otomatis dilaporkan ke Pimpinan.</div></div>';
    }
    aksi += '<div class="big-actions">' + it.aksi.map(a => {
      const x = AKSI_HP[a];
      return '<button type="button" class="btn-big ' + x.kelas + '" data-act="transaksi" data-aksi="' + a + '"><i class="bi ' + x.ikon + '" aria-hidden="true"></i>' +
        esc(x.teks) + '<small>' + esc(x.sub) + (layarSentuh() ? '' : ' • ' + x.f) + '</small></button>';
    }).join('') + '</div>';
  }
  return '<div class="result-card ' + kelas + '"><div class="result-head"><span>Hasil scan • ' + esc(it.id) + '</span>' + badge(it.status) + '</div>' +
    '<div class="result-body"><div class="d-flex gap-3 align-items-start">' + foto +
    '<div class="hp-meta min-w-0 flex-grow-1"><div class="nm">' + esc(p.nama) + '</div>' +
    '<div class="cell-sub mono">' + esc(p.nip) + '</div>' +
    '<div class="kv"><span>Regu</span><span>' + esc(p.regu || '-') + (p.bko ? ' • BKO' : '') + '</span>' +
    '<span>Jabatan</span><span>' + esc(p.jabatan || '-') + '</span>' +
    '<span>HP</span><span class="fw-semibold">' + esc(it.merek) + '</span>' +
    '<span>Warna</span><span>' + esc(it.warna) + '</span>' +
    '<span>IMEI</span><span><span class="imei-chip">****' + esc(it.imei4) + '</span></span></div></div></div>' +
    info + aksi +
    '<button type="button" class="btn btn-soft w-100 mt-3" data-act="scanLagi"><i class="bi bi-arrow-repeat"></i> Batal / pindai HP lain</button></div></div>';
}
UBAH.olehAmbil = () => {
  const lain = $('#olehLain') && $('#olehLain').checked;
  const w = $('#wrapCatatanAmbil');
  if (w) { w.classList.toggle('hidden', !lain); if (lain) $('#catatanAmbil').focus(); }
};
AKSI.zoomFoto = (el) => zoomGambar(el.getAttribute('src'), 'Foto ' + (AppState.hasilScan ? AppState.hasilScan.id : 'HP'));
AKSI.scanLagi = () => siapScanBerikut();
function siapScanBerikut() {
  AppState.hasilScan = null;
  const w = $('#scanResult'); if (w) w.innerHTML = kartuSiap();
  lanjutKamera();
  if (!layarSentuh()) { const m = $('#manualInput'); if (m) m.focus(); }
  else if (AppState.scannerOn) { const rb = $('.reader-box'); if (rb && matchMedia('(max-width: 991.98px)').matches) rb.scrollIntoView({ behavior: geraklah() ? 'smooth' : 'auto', block: 'center' }); }
}
AKSI.transaksi = async (el) => {
  const it = AppState.hasilScan;
  if (!it) return;
  const aksi = el.dataset.aksi;
  let diambilOleh = 'PEMILIK', catatan = '';
  if (aksi === 'AMBIL') {
    const r = $('input[name="diambilOleh"]:checked');
    diambilOleh = r ? r.value : 'PEMILIK';
    catatan = ($('#catatanAmbil') && $('#catatanAmbil').value.trim()) || '';
    if (diambilOleh === 'ORANG_LAIN' && catatan.length < 5) {
      $('#catatanAmbil').classList.add('is-invalid'); $('#catatanAmbil').focus();
      toast('Catatan wajib', 'Isi alasan dan nama orang yang mengambil HP.', 'warning'); return;
    }
  }
  await denganTombol(el, async () => {
    try {
      const r = await api('eksekusiTransaksi', { idHp: it.id, aksi: aksi, diambilOleh: diambilOleh, catatan: catatan, perangkat: perangkat() });
      bunyi('ok'); getar([80, 60, 80]);
      const w = $('#scanResult');
      if (w) {
        w.innerHTML = '<div class="result-card ok flash-ok"><div class="result-body"><div class="ok-banner"><i class="bi bi-check-circle-fill" aria-hidden="true"></i>' +
          '<h3>' + esc(JUDUL_SUKSES[aksi] || 'BERHASIL') + '</h3><div>' + esc(r.message) + '</div><div class="small mt-1">' + esc(it.pemilik.nama) + ' • ' + esc(it.merek) + '</div></div>' +
          '<button type="button" class="btn btn-navy w-100 mt-3" data-act="scanLagi"><i class="bi bi-qr-code-scan"></i> Pindai berikutnya</button></div></div>';
      }
      AppState.hasilScan = null;
      muatStatScan();
      setTimeout(() => { if (AppState.page === 'scan' && !AppState.hasilScan && !AppState.sibukScan) siapScanBerikut(); }, 2200);
    } catch (e) {
      bunyi('gagal'); getar([200, 100, 200]);
      if (e.code === 'GANDA') toast('Scan ganda diabaikan', e.message, 'warning'); else tanganiGalat(e, 'Transaksi gagal');
    }
  });
};
KIRIM.manual = () => {
  const i = $('#manualInput');
  const v = i.value.trim();
  if (!v) { i.focus(); return; }
  i.value = '';
  AppState.lastCode = ''; // input manual boleh diulang
  siapkanAudio();
  jedaKamera();
  prosesKode(v);
};

// ── Panggil petugas (bottom sheet) ──
AKSI.panggil = (el) => {
  const d = AppState.cache.dash;
  const x = d && d.terbuka.find(t => t.idLog === el.dataset.idlog);
  if (!x) return;
  const pesan = '[SIPANTAU-HP LAPAS NABIRE]\nYth. ' + x.nama + ',\nHP Anda (' + x.idHp + ' — ' + x.merek + ', IMEI ****' + x.imei4 + ') ' +
    (x.jenis === 'BERIZIN' ? 'masih tercatat dibawa masuk' : 'masih dititipkan di Pos P2U Pintu 2') + ' sejak ' + fmt(x.waktuTitip, 'jam') + ' WIT' +
    (x.terlambat ? ' dan telah melewati batas ' + fmt(x.batas, 'jam') + ' WIT (' + durasi(x.menitLewat) + ')' : '') +
    '.\nMohon segera ke Pos P2U Pintu 2 untuk serah terima.\n— ' + AppState.user.nama + ' (' + (LABEL_PERAN[AppState.user.peran] || '') + ')';
  AppState.cache.pesanPanggil = pesan;
  const isi = '<div class="result-card ' + (x.terlambat ? 'bad' : 'warn') + ' mb-3"><div class="result-body">' +
    '<div class="d-flex align-items-center gap-2 mb-2"><span class="tag-loker ' + (x.terlambat ? 'red' : '') + '">' + esc(x.idHp) + '</span><div class="min-w-0"><div class="fw-bold truncate">' + esc(x.nama) + '</div>' +
    '<div class="cell-sub mono">' + esc(x.nip) + ' • ' + esc(x.regu) + '</div></div></div>' +
    '<dl class="kv-list mb-0"><dt>HP</dt><dd>' + esc(x.merek) + ' (' + esc(x.warna) + ') • IMEI ****' + esc(x.imei4) + '</dd>' +
    '<dt>Dititip</dt><dd>' + fmt(x.waktuTitip) + ' WIT</dd><dt>Batas ambil</dt><dd>' + fmt(x.batas) + ' WIT</dd>' +
    '<dt>Status</dt><dd>' + (x.terlambat ? '<span class="bs bs-red-solid">Lewat ' + durasi(x.menitLewat) + '</span>' : badge(x.jenis === 'BERIZIN' ? 'BERIZIN_DI_DALAM' : 'TERTAHAN')) + '</dd></dl></div></div>' +
    (x.wa ? '<div class="d-grid gap-2"><a class="btn btn-green py-2" href="https://wa.me/' + esc(x.wa) + '?text=' + encodeURIComponent(pesan) + '" target="_blank" rel="noopener"><i class="bi bi-whatsapp"></i> Kirim pesan WhatsApp</a>' +
      '<a class="btn btn-navy py-2" href="tel:+' + esc(x.wa) + '"><i class="bi bi-telephone"></i> Telepon +' + esc(x.wa) + '</a></div>' :
      '<div class="notice mb-0"><i class="bi bi-info-circle" aria-hidden="true"></i><div class="small">Nomor WA petugas ini belum terdaftar. Minta Admin melengkapi data petugas.</div></div>') +
    '<div class="section-title mt-3">Pratinjau pesan</div><pre class="small p-2 rounded mb-2" style="white-space:pre-wrap;background:var(--bg-muted);font-family:inherit">' + esc(pesan) + '</pre>' +
    '<button type="button" class="btn btn-soft w-100" data-act="salinPesan"><i class="bi bi-clipboard"></i> Salin pesan</button>' +
    '<p class="small text-secondary-x mt-2 mb-0">Peringatan otomatis WhatsApp (Fonnte) &amp; email ke Pimpinan dikirim oleh sistem menjelang dan saat batas shift.</p>';
  bukaModal({ judul: '<i class="bi bi-megaphone" aria-hidden="true"></i> Panggil Petugas', isi: isi, sheet: true });
};
AKSI.salinPesan = () => salinTeks(AppState.cache.pesanPanggil || '');

// ════════════════════════════════════════════════════════
// 8. HALAMAN: DASHBOARD (RINGKASAN HARI INI)
// ════════════════════════════════════════════════════════
HALAMAN.dashboard = async (c, o, seq) => {
  const muat = (paksa) => swr('getDashboard', 'getDashboard', [], d => { if (!basi(seq)) renderDashboard(c, d); }, { paksa: paksa });
  await muat(false);
  pasangTimer(() => muat(true).catch(() => {}), 60000);
  SEGARKAN.dashboard = () => muat(true).catch(tanganiGalat);
};

function renderDashboard(c, d) {
  AppState.cache.dash = d;
  if (!window.Chart) muatPustaka('chart').then(() => { if (AppState.page === 'dashboard' && AppState.cache.dash === d) renderDashboard(c, d); }).catch(() => {});
  setBadge('izin', d.kpi.izinMenunggu);
  hancurkanChart();
  const k = d.kpi;
  const kanan = '<span class="small text-secondary-x align-self-center"><span class="live-dot me-1"></span>Diperbarui ' + fmt(d.waktu, 'jamDetik') + ' WIT</span>' +
    '<button type="button" class="btn btn-soft btn-sm" data-act="muatUlang"><i class="bi bi-arrow-clockwise"></i> Muat ulang</button>' +
    (MENU.scan.peran.indexOf(AppState.user.peran) >= 0 ? '<button type="button" class="btn btn-gold btn-sm" data-nav="scan"><i class="bi bi-qr-code-scan"></i> Buka Scanner</button>' : '');
  const baris = d.terbuka.map(x => {
    const st = x.terlambat ? 'TERLAMBAT' : (x.jenis === 'BERIZIN' ? 'BERIZIN_DI_DALAM' : 'TERTAHAN');
    return '<tr class="' + (x.terlambat ? 'row-red' : x.jenis === 'BERIZIN' ? 'row-gold' : '') + '">' +
      '<td><span class="tag-loker ' + (x.terlambat ? 'red' : x.jenis === 'BERIZIN' ? 'gold' : '') + '">' + esc(x.idHp) + '</span></td>' +
      '<td><div class="cell-main">' + esc(x.nama) + '</div><div class="cell-sub mono">' + esc(x.nip) + ' • ' + esc(x.regu) + '</div></td>' +
      '<td><div>' + esc(x.merek) + '</div><div class="cell-sub mono">IMEI ****' + esc(x.imei4) + ' • ' + esc(x.warna) + '</div></td>' +
      '<td class="mono">' + fmt(x.waktuTitip, 'jam') + '</td>' +
      '<td><div class="mono fw-semibold">' + durasi(x.durasiMenit) + '</div>' + (x.terlambat ? '<div class="cell-sub" style="color:var(--red)">+' + durasi(x.menitLewat) + ' lewat</div>' : '') + '</td>' +
      '<td class="mono">' + fmt(x.batas, 'tglJam') + '</td>' +
      '<td>' + badge(st) + '</td>' +
      '<td class="text-end"><button type="button" class="btn btn-sm ' + (x.terlambat ? 'btn-red' : 'btn-soft') + '" data-act="panggil" data-idlog="' + esc(x.idLog) + '">Panggil</button></td></tr>';
  }).join('');
  const maksShift = Math.max(1, d.perShift.Pagi || 0, d.perShift.Siang || 0, d.perShift.Malam || 0);
  const barShift = ['Pagi', 'Siang', 'Malam'].map(s => '<div class="mb-2"><div class="d-flex justify-content-between small"><span>Shift ' + s + '</span><b>' + (d.perShift[s] || 0) + '</b></div>' +
    '<div class="progress" style="height:8px;background:var(--bg-muted)" role="progressbar" aria-label="Shift ' + s + '" aria-valuenow="' + (d.perShift[s] || 0) + '" aria-valuemin="0" aria-valuemax="' + maksShift + '">' +
    '<div class="progress-bar" style="width:' + Math.round((d.perShift[s] || 0) / maksShift * 100) + '%;background:var(--navy-light)"></div></div></div>').join('');

  c.innerHTML = kepala('Ringkasan Hari Ini', esc(tglPanjang(d.waktu)) + ' • Shift ' + esc(d.shift.nama) + ' (' + fmt(d.shift.mulai, 'jam') + '–' + fmt(d.shift.selesai, 'jam') + ' WIT)', kanan) +
    (k.terlambat ? '<div class="notice" style="background:var(--red-soft);border-left-color:var(--red)"><i class="bi bi-exclamation-octagon-fill" style="color:var(--red)" aria-hidden="true"></i><div><b>' + k.terlambat +
      ' HP melewati batas ambil.</b> Segera hubungi pemilik atau periksa ke area dalam. Peringatan otomatis telah/akan dikirim ke Pimpinan via WhatsApp &amp; email.</div></div>' : '') +
    '<div class="row g-3 mb-3">' +
    '<div class="col-6 col-md-4 col-xl-2">' + kpi('navy', 'bi-phone', 'Dititip hari ini', k.titip, 'Akumulasi semua shift') + '</div>' +
    '<div class="col-6 col-md-4 col-xl-2">' + kpi('green', 'bi-check2-circle', 'Sudah diambil', k.ambil, 'Tuntas serah terima') + '</div>' +
    '<div class="col-6 col-md-4 col-xl-2">' + kpi('', 'bi-lock', 'Masih di loker', k.tertahan, 'Tersimpan di Pos P2U') + '</div>' +
    '<div class="col-6 col-md-4 col-xl-2">' + kpi(k.terlambat ? 'red' : '', 'bi-exclamation-octagon', 'Lewat batas', k.terlambat, k.terlambat ? 'Perlu tindak lanjut' : 'Nihil') + '</div>' +
    '<div class="col-6 col-md-4 col-xl-2">' + kpi('gold', 'bi-patch-check', 'Dibawa berizin', k.berizin, k.izinAktif + ' izin aktif') + '</div>' +
    '<div class="col-6 col-md-4 col-xl-2"><a href="#" data-nav="izin" class="d-block text-decoration-none h-100" style="color:inherit" aria-label="Buka izin menunggu persetujuan">' +
    kpi('gold', 'bi-hourglass-split', 'Izin menunggu', k.izinMenunggu, 'Ketuk untuk meninjau') + '</a></div>' +
    '</div>' +
    '<div class="row g-3 mb-3">' +
    '<div class="col-xl-8"><section class="cardx h-100"><div class="cardx-head"><h6><i class="bi bi-box-seam" aria-hidden="true"></i> HP masih di loker / di dalam <span class="bs bs-navy ms-1">' + d.terbuka.length + '</span></h6>' +
    '<span class="small text-secondary-x">Urut dari yang paling lama</span></div>' +
    (baris ? '<div class="table-wrap" style="max-height:440px"><table class="tablex"><thead><tr><th>ID</th><th>Pemilik</th><th>HP</th><th>Titip</th><th>Lama</th><th>Batas</th><th>Status</th><th></th></tr></thead><tbody>' + baris + '</tbody></table></div>' :
      kosong('bi-check2-circle', 'Tidak ada HP yang tertahan. Semua aman.')) + '</section></div>' +
    '<div class="col-xl-4 d-flex flex-column gap-3"><div class="insight-card"><h6><i class="bi bi-lightbulb" aria-hidden="true"></i> Analisis Otomatis</h6><ul>' +
    d.insight.map(t => '<li>' + esc(t.replace(/⚠️\s*/g, '')) + '</li>').join('') + '</ul></div>' +
    '<section class="cardx"><div class="cardx-head"><h6>Penitipan per shift (hari ini)</h6></div><div class="cardx-body">' + barShift + '</div></section></div>' +
    '</div>' +
    '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-bar-chart" aria-hidden="true"></i> Tren 7 hari terakhir</h6></div><div class="cardx-body"><div class="chart-box"><canvas id="chart7" aria-label="Grafik titip, ambil, dan terlambat 7 hari terakhir" role="img"></canvas></div></div></section>';

  const w = warnaGrafik();
  buatChart($('#chart7'), {
    type: 'bar',
    data: {
      labels: d.grafik.map(g => g.label),
      datasets: [
        { label: 'Dititip', data: d.grafik.map(g => g.titip), backgroundColor: w.navy, borderRadius: 6 },
        { label: 'Diambil', data: d.grafik.map(g => g.ambil), backgroundColor: w.green, borderRadius: 6 },
        { label: 'Terlambat', data: d.grafik.map(g => g.terlambat), type: 'line', borderColor: w.red, backgroundColor: w.red, tension: 0.3, pointRadius: 4 }
      ]
    },
    options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } }
  });
}

// ════════════════════════════════════════════════════════
// 9. HALAMAN: DATA PETUGAS (ADMIN)
// ════════════════════════════════════════════════════════
HALAMAN.petugas = async (c, o, seq) => {
  AppState.pilihPetugas = new Set();
  c.innerHTML = kepala('Data Petugas', 'Kelola akun petugas, peran, regu jaga, dan kartu QR cadangan. Kata sandi awal akun baru: <span class="mono">Nabire#2026</span> (wajib diganti).',
    '<button type="button" class="btn btn-gold btn-sm" data-act="formPetugas"><i class="bi bi-person-plus"></i> Tambah</button>' +
    '<button type="button" class="btn btn-soft btn-sm" data-act="imporPetugas"><i class="bi bi-file-earmark-spreadsheet"></i> Impor massal</button>' +
    '<button type="button" class="btn btn-navy btn-sm" data-act="cetakKartuPilih" id="btnCetakKartu" disabled><i class="bi bi-qr-code"></i> Cetak kartu (<span id="nPilihPetugas">0</span>)</button>') +
    '<div class="cardx mb-3"><div class="cardx-body row g-2">' +
    '<div class="col-12 col-md-5"><label class="visually-hidden" for="fPetCari">Cari petugas</label><input type="search" class="form-control" id="fPetCari" data-inp="filterPetugas" placeholder="Cari nama, NIP, jabatan…"></div>' +
    '<div class="col-4 col-md-2"><label class="visually-hidden" for="fPetRegu">Regu</label><select class="form-select" id="fPetRegu" data-chg="filterPetugas">' + opsi(DAFTAR_REGU, '', 'Semua regu') + '</select></div>' +
    '<div class="col-4 col-md-2"><label class="visually-hidden" for="fPetPeran">Peran</label><select class="form-select" id="fPetPeran" data-chg="filterPetugas">' + opsi(Object.keys(LABEL_PERAN), '', 'Semua peran') + '</select></div>' +
    '<div class="col-4 col-md-3"><label class="visually-hidden" for="fPetStatus">Status</label><select class="form-select" id="fPetStatus" data-chg="filterPetugas">' + opsi([['aktif', 'Aktif'], ['nonaktif', 'Nonaktif'], ['tanpaHp', 'Belum punya HP'], ['wajibGanti', 'Belum ganti sandi']], 'aktif', 'Semua status') + '</select></div>' +
    '</div></div>' +
    '<section class="cardx"><div id="tblPetugas">' + memuat() + '</div></section>';
  await muatPetugas(seq);
};
SEGARKAN.petugas = () => muatPetugas(AppState.navSeq, true).catch(tanganiGalat);
async function muatPetugas(seq, paksa) {
  await swr('getPetugasList', 'getPetugasList', [], d => {
    if (basi(seq) || !$('#tblPetugas')) return;
    AppState.cache.petugas = d;
    renderTabelPetugas();
  }, { paksa: paksa });
}
UBAH.filterPetugas = () => renderTabelPetugas();
KETIK.filterPetugas = () => renderTabelPetugas();
function renderTabelPetugas() {
  const el = $('#tblPetugas');
  if (!el) return;
  const q = ($('#fPetCari').value || '').trim().toUpperCase(), rg = $('#fPetRegu').value, pr = $('#fPetPeran').value, st = $('#fPetStatus').value;
  const list = (AppState.cache.petugas || []).filter(p => {
    if (rg && p.regu !== rg) return false;
    if (pr && p.peran !== pr) return false;
    if (st === 'aktif' && !p.aktif) return false;
    if (st === 'nonaktif' && p.aktif) return false;
    if (st === 'tanpaHp' && (p.jumlahHp || !p.aktif)) return false;
    if (st === 'wajibGanti' && !p.wajibGanti) return false;
    if (q && (p.nama + ' ' + p.nip + ' ' + p.jabatan).toUpperCase().indexOf(q) === -1) return false;
    return true;
  }).sort((a, b) => a.nama.localeCompare(b.nama));
  const semua = list.length && list.every(p => AppState.pilihPetugas.has(p.nip));
  el.innerHTML = list.length ? '<div class="table-wrap"><table class="tablex"><thead><tr>' +
    '<th><input type="checkbox" class="form-check-input chk" data-chg="pilihSemuaPetugas" aria-label="Pilih semua" ' + (semua ? 'checked' : '') + '></th>' +
    '<th>Nama &amp; NIP</th><th>Jabatan</th><th>Regu</th><th>Peran</th><th>Kontak</th><th>HP</th><th>Status</th><th class="text-end">Aksi</th></tr></thead><tbody>' +
    list.map(p => '<tr class="' + (p.aktif ? '' : 'opacity-75') + '">' +
      '<td><input type="checkbox" class="form-check-input chk" data-chg="pilihPetugas" value="' + esc(p.nip) + '" aria-label="Pilih ' + esc(p.nama) + '" ' + (AppState.pilihPetugas.has(p.nip) ? 'checked' : '') + '></td>' +
      '<td><div class="cell-main">' + esc(p.nama) + '</div><div class="cell-sub mono">' + esc(p.nip) + '</div></td>' +
      '<td>' + esc(p.jabatan || '-') + (p.boleh === 'Ya' ? '<div><span class="bs bs-gold">Boleh ajukan izin</span></div>' : '') + '</td>' +
      '<td>' + esc(p.regu) + (p.bko === 'Ya' ? ' <span class="bs bs-gray">BKO</span>' : '') + '</td>' +
      '<td>' + badgePeran(p.peran) + '</td>' +
      '<td class="small">' + (p.wa ? '<div class="mono"><i class="bi bi-whatsapp" aria-hidden="true"></i> ' + esc(p.wa) + '</div>' : '<span class="text-secondary-x">-</span>') + (p.email ? '<div class="truncate" style="max-width:180px">' + esc(p.email) + '</div>' : '') + '</td>' +
      '<td>' + (p.jumlahHp ? '<span class="bs bs-navy">' + p.jumlahHp + ' HP</span>' : '<span class="bs bs-red">Belum</span>') + '</td>' +
      '<td>' + badge(p.aktif ? 'AKTIF' : 'NONAKTIF') + (p.wajibGanti ? '<div class="cell-sub">Sandi bawaan</div>' : '') + '</td>' +
      '<td class="text-end text-nowrap">' +
      '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="formPetugas" data-nip="' + esc(p.nip) + '" aria-label="Ubah ' + esc(p.nama) + '" title="Ubah"><i class="bi bi-pencil"></i></button> ' +
      '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="cetakKartu" data-nip="' + esc(p.nip) + '" aria-label="Cetak kartu QR" title="Cetak kartu QR"><i class="bi bi-qr-code"></i></button> ' +
      '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="resetSandi" data-nip="' + esc(p.nip) + '" aria-label="Reset kata sandi" title="Reset kata sandi"><i class="bi bi-key"></i></button> ' +
      '<button type="button" class="btn btn-sm ' + (p.aktif ? 'btn-soft' : 'btn-green') + ' btn-icon-sm" data-act="statusPetugas" data-nip="' + esc(p.nip) + '" aria-label="' + (p.aktif ? 'Nonaktifkan' : 'Aktifkan') + '" title="' + (p.aktif ? 'Nonaktifkan' : 'Aktifkan') + '"><i class="bi ' + (p.aktif ? 'bi-person-dash' : 'bi-person-check') + '"></i></button>' +
      '</td></tr>').join('') + '</tbody></table></div><div class="p-2 small text-secondary-x border-top">Menampilkan ' + list.length + ' dari ' + (AppState.cache.petugas || []).length + ' petugas</div>' :
    kosong('bi-people', 'Tidak ada petugas yang cocok dengan filter.');
  perbaruiPilihPetugas();
}
function perbaruiPilihPetugas() {
  const n = AppState.pilihPetugas.size;
  if ($('#nPilihPetugas')) $('#nPilihPetugas').textContent = n;
  if ($('#btnCetakKartu')) $('#btnCetakKartu').disabled = !n;
}
UBAH.pilihPetugas = (el) => { if (el.checked) AppState.pilihPetugas.add(el.value); else AppState.pilihPetugas.delete(el.value); perbaruiPilihPetugas(); };
UBAH.pilihSemuaPetugas = (el) => {
  $$('[data-chg="pilihPetugas"]').forEach(x => { x.checked = el.checked; if (el.checked) AppState.pilihPetugas.add(x.value); else AppState.pilihPetugas.delete(x.value); });
  perbaruiPilihPetugas();
};

AKSI.formPetugas = (el) => {
  const nip = el.dataset.nip;
  const p = nip ? (AppState.cache.petugas || []).find(x => x.nip === nip) : null;
  const v = p || { nip: '', nama: '', jabatan: '', regu: 'Regu 1', bko: 'Tidak', peran: 'PETUGAS', boleh: 'Tidak', wa: '', email: '' };
  const isi = '<form id="formPetugas" data-submit="simpanPetugas" novalidate><div class="row g-3">' +
    '<div class="col-md-6"><label class="form-label" for="pNip">NIP / Nomor induk *</label><input class="form-control mono" id="pNip" value="' + esc(v.nip) + '" ' + (p ? 'readonly' : '') + ' required placeholder="199408122017011002 atau MGG-001" autocapitalize="characters">' +
    '<div class="form-text">Tanpa spasi. Anak magang: MGG-001, MGG-002, dst.</div></div>' +
    '<div class="col-md-6"><label class="form-label" for="pNama">Nama lengkap *</label><input class="form-control" id="pNama" value="' + esc(v.nama) + '" required autocomplete="off"></div>' +
    '<div class="col-md-6"><label class="form-label" for="pJabatan">Jabatan</label><input class="form-control" id="pJabatan" value="' + esc(v.jabatan) + '" placeholder="Contoh: Anggota Regu Jaga"></div>' +
    '<div class="col-md-6"><label class="form-label" for="pRegu">Regu *</label><select class="form-select" id="pRegu">' + opsi(DAFTAR_REGU, v.regu) + '</select></div>' +
    '<div class="col-md-6"><label class="form-label" for="pPeran">Peran aplikasi *</label><select class="form-select" id="pPeran">' +
    opsi([['PETUGAS', 'PETUGAS — petugas & magang'], ['P2U', 'P2U — penjaga Pintu 2 (scan, setujui izin)'], ['PIMPINAN', 'PIMPINAN — Kalapas / Kasi Kamtib / Ka. KPLP'], ['ADMIN', 'ADMIN — operator Kamtib/KPLP']], v.peran) + '</select></div>' +
    '<div class="col-md-6"><label class="form-label" for="pWa">No. WhatsApp</label><input class="form-control mono" id="pWa" value="' + esc(v.wa) + '" inputmode="tel" placeholder="6281234567890">' +
    '<div class="form-text">Wajib untuk P2U &amp; Pimpinan (menerima peringatan).</div></div>' +
    '<div class="col-md-6"><label class="form-label" for="pEmail">Email</label><input type="email" class="form-control" id="pEmail" value="' + esc(v.email) + '" inputmode="email" placeholder="nama@kemenimipas.go.id">' +
    '<div class="form-text">Wajib untuk Pimpinan.</div></div>' +
    '<div class="col-md-6 d-flex flex-column justify-content-end gap-2">' +
    '<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="pBko" ' + (v.bko === 'Ya' ? 'checked' : '') + '><label class="form-check-label" for="pBko">Status BKO</label></div>' +
    '<div class="form-check form-switch"><input class="form-check-input" type="checkbox" role="switch" id="pBoleh" ' + (v.boleh === 'Ya' ? 'checked' : '') + '><label class="form-check-label" for="pBoleh">Boleh mengajukan izin bawa HP (pejabat)</label></div>' +
    '</div></div></form>';
  bukaModal({
    judul: p ? '<i class="bi bi-pencil-square"></i> Ubah Data Petugas' : '<i class="bi bi-person-plus"></i> Tambah Petugas',
    isi: isi,
    kaki: '<button type="button" class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button type="submit" form="formPetugas" class="btn btn-navy" data-mode="' + (p ? 'ubah' : 'baru') + '" id="btnSimpanPetugas"><i class="bi bi-save"></i> Simpan</button>',
    ukuran: 'lg',
    onTampil: () => (p ? $('#pNama') : $('#pNip')).focus()
  });
};
KIRIM.simpanPetugas = async () => {
  const btn = $('#btnSimpanPetugas');
  const data = {
    mode: btn.dataset.mode, nip: $('#pNip').value.trim().toUpperCase().replace(/\s/g, ''), nama: $('#pNama').value.trim(), jabatan: $('#pJabatan').value.trim(),
    regu: $('#pRegu').value, peran: $('#pPeran').value, wa: $('#pWa').value.trim(), email: $('#pEmail').value.trim(),
    bko: $('#pBko').checked ? 'Ya' : 'Tidak', boleh: $('#pBoleh').checked ? 'Ya' : 'Tidak', perangkat: perangkat()
  };
  const wajib = [['pNip', data.nip], ['pNama', data.nama]];
  if (data.peran === 'P2U' || data.peran === 'PIMPINAN') wajib.push(['pWa', data.wa]);
  if (data.peran === 'PIMPINAN') wajib.push(['pEmail', data.email]);
  let gagal = null;
  wajib.forEach(w => { const el = $('#' + w[0]); el.classList.toggle('is-invalid', !w[1]); if (!w[1] && !gagal) gagal = el; });
  if (gagal) { gagal.focus(); toast('Lengkapi data', 'Kolom bertanda wajib belum diisi.', 'warning'); return; }
  await denganTombol(btn, async () => {
    try {
      const r = await api('simpanPetugas', data);
      await tutupModal();
      toast('Tersimpan', r.message, 'success');
      SEGARKAN.petugas();
    } catch (e) { tanganiGalat(e); }
  });
};
AKSI.resetSandi = async (el) => {
  const p = (AppState.cache.petugas || []).find(x => x.nip === el.dataset.nip);
  if (!p) return;
  const ok = await konfirmasi({ judul: 'Reset Kata Sandi', pesan: 'Reset kata sandi <b>' + esc(p.nama) + '</b> ke kata sandi bawaan <span class="mono">Nabire#2026</span>? Petugas wajib menggantinya saat login, dan sesi aktifnya akan diakhiri.', okTeks: 'Reset sandi', okKelas: 'btn-gold' });
  if (!ok) return;
  try { const r = await api('resetSandiPetugas', p.nip); toast('Berhasil', r.message, 'success'); SEGARKAN.petugas(); } catch (e) { tanganiGalat(e); }
};
AKSI.statusPetugas = async (el) => {
  const p = (AppState.cache.petugas || []).find(x => x.nip === el.dataset.nip);
  if (!p) return;
  const ok = await konfirmasi({
    judul: p.aktif ? 'Nonaktifkan Petugas' : 'Aktifkan Petugas',
    pesan: p.aktif ? 'Nonaktifkan <b>' + esc(p.nama) + '</b>? Akun tidak bisa login, namun data &amp; riwayat tetap tersimpan (soft-delete).' : 'Aktifkan kembali akun <b>' + esc(p.nama) + '</b>?',
    okTeks: p.aktif ? 'Nonaktifkan' : 'Aktifkan', okKelas: p.aktif ? 'btn-red' : 'btn-green'
  });
  if (!ok) return;
  try { const r = await api('ubahStatusPetugas', p.nip, !p.aktif); toast('Berhasil', r.message, 'success'); SEGARKAN.petugas(); } catch (e) { tanganiGalat(e); }
};
AKSI.imporPetugas = () => {
  bukaModal({
    judul: '<i class="bi bi-file-earmark-spreadsheet"></i> Impor Massal Petugas',
    isi: '<ol class="small ps-3"><li class="mb-2">Buka sheet <b>Impor_Petugas</b>: <span id="linkImpor">' + memuat('Menyiapkan tautan…').replace('empty-state', 'd-inline') + '</span></li>' +
      '<li class="mb-2">Tempel data mulai baris 2 dengan kolom: <span class="mono">NIP, Nama, Jabatan, Regu, Status_BKO, Peran, Boleh_Ajukan_Izin, No_WA, Email</span>.</li>' +
      '<li class="mb-2">Regu: <span class="mono">Regu 1–4, Non-Regu, Magang</span>. Peran: <span class="mono">PETUGAS, P2U, PIMPINAN, ADMIN</span>. Kosong = PETUGAS / Non-Regu.</li>' +
      '<li>Tekan <b>Proses Impor</b>. NIP yang sudah terdaftar dilewati. Semua akun baru memakai sandi bawaan <span class="mono">Nabire#2026</span>.</li></ol><div id="hasilImpor"></div>',
    kaki: '<button type="button" class="btn btn-soft" data-bs-dismiss="modal">Tutup</button><button type="button" class="btn btn-navy" data-act="prosesImpor"><i class="bi bi-upload"></i> Proses Impor</button>',
    ukuran: 'lg',
    onTampil: async () => {
      try {
        const r = await api('getUrlSheetImpor');
        const l = $('#linkImpor');
        if (l) l.innerHTML = '<a href="' + esc(r.data.url) + '" target="_blank" rel="noopener" class="btn btn-sm btn-soft"><i class="bi bi-box-arrow-up-right"></i> Buka sheet Impor_Petugas</a>';
      } catch (e) { const l = $('#linkImpor'); if (l) l.textContent = 'Buka spreadsheet DB_SIPANTAU_HP › tab Impor_Petugas.'; }
    }
  });
};
AKSI.prosesImpor = async (el) => {
  await denganTombol(el, async () => {
    try {
      const r = await api('imporPetugas');
      $('#hasilImpor').innerHTML = '<div class="notice mb-0" style="background:var(--green-soft);border-left-color:var(--green)"><i class="bi bi-check-circle" style="color:var(--green)"></i><div><b>' + esc(r.message) + '</b>' +
        (r.data.galat && r.data.galat.length ? '<ul class="small mb-0 mt-1">' + r.data.galat.map(g => '<li>' + esc(g) + '</li>').join('') + '</ul>' : '') + '</div></div>';
      SEGARKAN.petugas();
    } catch (e) { tanganiGalat(e); }
  });
};
AKSI.cetakKartu = (el) => cetakLabel('KARTU', [el.dataset.nip]);
AKSI.cetakKartuPilih = () => cetakLabel('KARTU', Array.from(AppState.pilihPetugas));

// ── Cetak label / kartu QR (QR dibuat di browser → PDF A4 di server) ──
async function cetakLabel(jenis, ids) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) { toast('Pilih data', 'Centang minimal satu data terlebih dahulu.', 'warning'); return; }
  const nama = jenis === 'HP' ? 'label QR HP' : 'kartu QR petugas';
  const ok = await konfirmasi({
    judul: jenis === 'HP' ? 'Cetak Label QR HP' : 'Cetak Kartu Petugas',
    pesan: '<b>' + ids.length + ' ' + nama + '</b> akan dibuat sebagai PDF A4 (3 kolom, ±6×4 cm).' +
      '<div class="form-check mt-3"><input type="checkbox" class="form-check-input" id="chkGantiKode"><label class="form-check-label small" for="chkGantiKode">' +
      '<b>Ganti kode keamanan</b> — label/kartu lama otomatis <b>tidak berlaku</b> (untuk label rusak, hilang, atau HP ganti pemilik).</label></div>',
    okTeks: 'Buat PDF'
  });
  if (!ok) return;
  const ganti = !!($('#chkGantiKode') && $('#chkGantiKode').checked);
  toast('Memproses', 'Menyiapkan ' + ids.length + ' ' + nama + '…', 'info');
  try {
    const [r] = await Promise.all([api('getDataLabel', jenis, ids, ganti), muatPustaka('qr')]);
    const items = r.data.map(x => Object.assign({}, x, { qr: buatQrDataUrl(x.kode, 300) }));
    const pdf = await api('buatPdfLabel', jenis, items);
    tampilLabel(jenis, items, pdf.data);
  } catch (e) { tanganiGalat(e, 'Gagal membuat label'); }
}
function tampilLabel(jenis, items, pdf) {
  const hp = jenis === 'HP';
  $('#previewJudul').textContent = (hp ? 'Label QR HP' : 'Kartu QR Petugas') + ' — ' + items.length + ' item';
  $('#previewIsi').innerHTML = '<div class="notice text-start"><i class="bi bi-printer" aria-hidden="true"></i><div class="small">PDF <b>' + esc(pdf.namaFile) +
    '</b> siap dicetak. Cetak dengan skala <b>100% / Actual size</b> di kertas stiker A4, lalu tempel di bagian belakang HP. ' +
    (pdf.url ? '<a href="' + esc(pdf.url) + '" target="_blank" rel="noopener">Buka salinan di Google Drive</a>.' : '') + '</div></div>' +
    '<div class="label-grid">' + items.map(x => '<div class="label-mini"><img src="' + x.qr + '" alt="QR ' + esc(x.id) + '"><div class="min-w-0">' +
      '<div class="k">' + (hp ? 'ID HP' : 'NIP') + '</div><div class="v mono">' + esc(x.id) + '</div>' +
      '<div class="k">' + (hp ? 'Pemilik' : 'Nama') + '</div><div class="v truncate">' + esc(x.nama) + '</div>' +
      (hp ? '<div class="k">Perangkat</div><div class="v truncate">' + esc(x.merek) + '</div><span class="imei">IMEI ****' + esc(x.imei4) + '</span>' :
        '<div class="k">Regu</div><div class="v">' + esc(x.regu) + '</div>') + '</div></div>').join('') + '</div>';
  const a = $('#previewUnduh');
  a.classList.remove('hidden');
  a.href = URL.createObjectURL(base64KeBlob(pdf.base64, 'application/pdf'));
  a.setAttribute('download', pdf.namaFile);
  bootstrap.Modal.getOrCreateInstance($('#modalPreview')).show();
}

// ════════════════════════════════════════════════════════
// 10. HALAMAN: DATA HP & LABEL QR (ADMIN)
// ════════════════════════════════════════════════════════
HALAMAN.hp = async (c, o, seq) => {
  AppState.pilihHp = new Set();
  c.innerHTML = kepala('Data HP &amp; Label QR', 'Daftarkan HP petugas beserta foto &amp; 4 digit IMEI, lalu cetak stiker QR.',
    '<button type="button" class="btn btn-gold btn-sm" data-act="formHp"><i class="bi bi-plus-circle"></i> Daftarkan HP</button>' +
    '<button type="button" class="btn btn-navy btn-sm" data-act="cetakLabelPilih" id="btnCetakLabel" disabled><i class="bi bi-printer"></i> Cetak label (<span id="nPilihHp">0</span>)</button>') +
    '<div id="hpRingkas" class="row g-3 mb-3"></div>' +
    '<div class="cardx mb-3"><div class="cardx-body row g-2">' +
    '<div class="col-12 col-md-6"><label class="visually-hidden" for="fHpCari">Cari HP</label><input type="search" class="form-control" id="fHpCari" data-inp="filterHp" placeholder="Cari ID HP, pemilik, merek, IMEI…"></div>' +
    '<div class="col-6 col-md-3"><label class="visually-hidden" for="fHpStatus">Status</label><select class="form-select" id="fHpStatus" data-chg="filterHp">' + opsi([['DI_LUAR', 'Di luar'], ['DITITIPKAN', 'Dititipkan'], ['DIBAWA_BERIZIN', 'Dibawa berizin']], '', 'Semua status') + '</select></div>' +
    '<div class="col-6 col-md-3"><label class="visually-hidden" for="fHpAktif">Aktif</label><select class="form-select" id="fHpAktif" data-chg="filterHp">' + opsi([['aktif', 'HP aktif'], ['nonaktif', 'HP nonaktif']], 'aktif', 'Semua') + '</select></div>' +
    '</div></div>' +
    '<section class="cardx"><div id="tblHp">' + memuat() + '</div></section>';
  await muatHp(seq);
};
SEGARKAN.hp = () => muatHp(AppState.navSeq, true).catch(tanganiGalat);
async function muatHp(seq, paksa) {
  await swr('getHpList', 'getHpList', [], d => { if (!basi(seq) && $('#hpRingkas')) renderHpRingkas(d); }, { paksa: paksa });
}
function renderHpRingkas(data) {
  const r = { data: data };
  AppState.cache.hpList = r.data;
  const aktif = r.data.hp.filter(h => h.aktif);
  const punya = new Set(aktif.map(h => h.nip));
  const total = r.data.petugas.length, ada = r.data.petugas.filter(p => punya.has(p.nip)).length;
  const pct = total ? Math.round(ada / total * 100) : 0;
  $('#hpRingkas').innerHTML =
    '<div class="col-6 col-md-3">' + kpi('navy', 'bi-phone', 'HP aktif', aktif.length, r.data.hp.length - aktif.length + ' nonaktif') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('', 'bi-lock', 'Sedang dititip', aktif.filter(h => h.status === 'DITITIPKAN').length, 'Di loker P2U') + '</div>' +
    '<div class="col-12 col-md-6"><div class="kpi"><div class="lbl"><span>Petugas sudah punya HP terdaftar</span><i class="bi bi-people" aria-hidden="true"></i></div>' +
    '<div class="val">' + ada + ' <small class="fs-6 text-secondary-x">/ ' + total + ' petugas aktif</small></div>' +
    '<div class="progress mt-2" style="height:8px;background:var(--bg-muted)" role="progressbar" aria-label="Cakupan pendaftaran HP" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:' + pct + '%;background:var(--green)"></div></div>' +
    '<div class="sub mt-1">' + pct + '% tercakup • ' + (total - ada) + ' petugas belum mendaftarkan HP</div></div></div>';
  renderTabelHp();
}
UBAH.filterHp = () => renderTabelHp();
KETIK.filterHp = () => renderTabelHp();
function renderTabelHp() {
  const el = $('#tblHp');
  if (!el || !AppState.cache.hpList) return;
  const q = ($('#fHpCari').value || '').trim().toUpperCase(), st = $('#fHpStatus').value, ak = $('#fHpAktif').value;
  const list = AppState.cache.hpList.hp.filter(h => {
    if (st && h.status !== st) return false;
    if (ak === 'aktif' && !h.aktif) return false;
    if (ak === 'nonaktif' && h.aktif) return false;
    if (q && [h.id, h.nama, h.nip, h.merek, h.warna, h.imei4].join(' ').toUpperCase().indexOf(q) === -1) return false;
    return true;
  });
  const semua = list.length && list.every(h => AppState.pilihHp.has(h.id));
  el.innerHTML = list.length ? '<div class="table-wrap"><table class="tablex"><thead><tr>' +
    '<th><input type="checkbox" class="form-check-input chk" data-chg="pilihSemuaHp" aria-label="Pilih semua" ' + (semua ? 'checked' : '') + '></th>' +
    '<th>ID</th><th>Pemilik</th><th>Perangkat</th><th>IMEI</th><th>Foto</th><th>Status</th><th class="text-end">Aksi</th></tr></thead><tbody>' +
    list.map(h => '<tr class="' + (h.aktif ? '' : 'opacity-75') + '">' +
      '<td><input type="checkbox" class="form-check-input chk" data-chg="pilihHp" value="' + esc(h.id) + '" aria-label="Pilih ' + esc(h.id) + '" ' + (AppState.pilihHp.has(h.id) ? 'checked' : '') + '></td>' +
      '<td><span class="tag-loker">' + esc(h.id) + '</span></td>' +
      '<td><div class="cell-main">' + esc(h.nama || '(pemilik tidak ditemukan)') + '</div><div class="cell-sub mono">' + esc(h.nip) + ' • ' + esc(h.regu) + '</div></td>' +
      '<td><div>' + esc(h.merek) + '</div><div class="cell-sub">' + esc(h.warna) + '</div></td>' +
      '<td><span class="imei-chip">****' + esc(h.imei4) + '</span></td>' +
      '<td>' + (h.punyaFoto ? '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="lihatFotoHp" data-id="' + esc(h.id) + '" aria-label="Lihat foto ' + esc(h.id) + '"><i class="bi bi-image"></i></button>' : '<span class="bs bs-red">Belum</span>') + '</td>' +
      '<td>' + badge(h.status) + (h.aktif ? '' : ' ' + badge('NONAKTIF')) + '</td>' +
      '<td class="text-end text-nowrap">' +
      '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="formHp" data-id="' + esc(h.id) + '" aria-label="Ubah" title="Ubah"><i class="bi bi-pencil"></i></button> ' +
      '<button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="cetakLabelSatu" data-id="' + esc(h.id) + '" aria-label="Cetak label" title="Cetak label"><i class="bi bi-qr-code"></i></button> ' +
      '<button type="button" class="btn btn-sm ' + (h.aktif ? 'btn-soft' : 'btn-green') + ' btn-icon-sm" data-act="statusHp" data-id="' + esc(h.id) + '" aria-label="' + (h.aktif ? 'Nonaktifkan' : 'Aktifkan') + '" title="' + (h.aktif ? 'Nonaktifkan' : 'Aktifkan') + '"><i class="bi ' + (h.aktif ? 'bi-slash-circle' : 'bi-check-circle') + '"></i></button>' +
      '</td></tr>').join('') + '</tbody></table></div><div class="p-2 small text-secondary-x border-top">Menampilkan ' + list.length + ' dari ' + AppState.cache.hpList.hp.length + ' HP</div>' :
    kosong('bi-phone', 'Belum ada HP yang cocok. Tekan "Daftarkan HP" untuk menambah.');
  perbaruiPilihHp();
}
function perbaruiPilihHp() {
  const n = AppState.pilihHp.size;
  if ($('#nPilihHp')) $('#nPilihHp').textContent = n;
  if ($('#btnCetakLabel')) $('#btnCetakLabel').disabled = !n;
}
UBAH.pilihHp = (el) => { if (el.checked) AppState.pilihHp.add(el.value); else AppState.pilihHp.delete(el.value); perbaruiPilihHp(); };
UBAH.pilihSemuaHp = (el) => {
  $$('[data-chg="pilihHp"]').forEach(x => { x.checked = el.checked; if (el.checked) AppState.pilihHp.add(x.value); else AppState.pilihHp.delete(x.value); });
  perbaruiPilihHp();
};
AKSI.cetakLabelPilih = () => cetakLabel('HP', Array.from(AppState.pilihHp));
AKSI.cetakLabelSatu = (el) => cetakLabel('HP', [el.dataset.id]);
AKSI.lihatFotoHp = async (el) => {
  try {
    const r = await api('getFotoHP', el.dataset.id);
    if (r.data.foto) zoomGambar(r.data.foto, 'Foto ' + r.data.id); else toast('Foto', 'Foto belum tersedia.', 'info');
  } catch (e) { tanganiGalat(e); }
};
AKSI.statusHp = async (el) => {
  const h = AppState.cache.hpList.hp.find(x => x.id === el.dataset.id);
  if (!h) return;
  const ok = await konfirmasi({
    judul: h.aktif ? 'Nonaktifkan HP' : 'Aktifkan HP',
    pesan: h.aktif ? 'Nonaktifkan <b>' + esc(h.id) + '</b> (' + esc(h.merek) + ' milik ' + esc(h.nama) + ')? Label QR-nya tidak akan berlaku lagi saat dipindai.' : 'Aktifkan kembali <b>' + esc(h.id) + '</b>?',
    okTeks: h.aktif ? 'Nonaktifkan' : 'Aktifkan', okKelas: h.aktif ? 'btn-red' : 'btn-green'
  });
  if (!ok) return;
  try { const r = await api('ubahStatusHp', h.id, !h.aktif); toast('Berhasil', r.message, 'success'); SEGARKAN.hp(); } catch (e) { tanganiGalat(e); }
};

AKSI.formHp = (el) => {
  const id = el.dataset.id;
  const L = AppState.cache.hpList || { hp: [], petugas: [] };
  const h = id ? L.hp.find(x => x.id === id) : null;
  AppState.fotoBaru = '';
  const isi = '<form id="formHp" data-submit="simpanHp" novalidate><div class="row g-3">' +
    '<div class="col-md-7">' +
    '<div class="mb-3"><label class="form-label" for="hpPemilik">Petugas pemilik *</label>' +
    '<input type="search" class="form-control mb-2" id="hpCariPemilik" data-inp="cariPemilik" placeholder="Saring nama / NIP…" aria-label="Saring daftar petugas">' +
    '<select class="form-select" id="hpPemilik" data-chg="infoPemilik">' + opsiPemilik(L.petugas, '', h ? h.nip : '') + '</select>' +
    '<div class="form-text" id="hpPemilikInfo"></div></div>' +
    '<div class="mb-3"><label class="form-label" for="hpMerek">Merek &amp; tipe HP *</label><input class="form-control" id="hpMerek" value="' + esc(h ? h.merek : '') + '" placeholder="Contoh: Samsung Galaxy A54 / iPhone 13"></div>' +
    '<div class="mb-3"><label class="form-label" for="hpWarna">Warna / casing *</label><input class="form-control" id="hpWarna" value="' + esc(h ? h.warna : '') + '" placeholder="Contoh: Hitam, case silikon biru"></div>' +
    '<div class="p-3 rounded" style="background:var(--blue-soft)"><label class="form-label" for="hpImei">4 digit terakhir IMEI *</label>' +
    '<input class="form-control imei-input" id="hpImei" value="' + esc(h ? h.imei4 : '') + '" inputmode="numeric" maxlength="4" pattern="\\d{4}" autocomplete="off" placeholder="0000" data-inp="imei">' +
    '<div class="form-text">Cek IMEI di HP pemilik: buka aplikasi Telepon, ketik <b class="mono">*#06#</b>.</div></div>' +
    '</div>' +
    '<div class="col-md-5 text-center"><div class="form-label text-start">Foto fisik HP</div>' +
    '<div class="photo-preview mx-auto" id="hpFotoPrev">' + (h && h.punyaFoto ? memuat('Memuat foto…') : '<i class="bi bi-camera fs-1" aria-hidden="true"></i>') + '</div>' +
    '<div class="d-grid gap-2 mt-2">' +
    '<button type="button" class="btn btn-navy" data-act="pilihFoto" data-target="hpFotoKamera"><i class="bi bi-camera"></i> Ambil foto</button>' +
    '<button type="button" class="btn btn-soft" data-act="pilihFoto" data-target="hpFotoGaleri"><i class="bi bi-images"></i> Pilih dari galeri</button>' +
    '<input type="file" accept="image/*" capture="environment" id="hpFotoKamera" data-chg="fotoHp" hidden>' +
    '<input type="file" accept="image/*" id="hpFotoGaleri" data-chg="fotoHp" hidden></div>' +
    '<div class="form-text" id="hpFotoInfo">Tampak belakang HP (warna &amp; casing terlihat). Otomatis diperkecil ≤ 500 KB.</div></div>' +
    '</div></form>';
  bukaModal({
    judul: h ? '<i class="bi bi-pencil-square"></i> Ubah HP ' + esc(h.id) : '<i class="bi bi-phone"></i> Daftarkan HP Petugas',
    isi: isi,
    kaki: '<button type="button" class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button type="submit" form="formHp" class="btn btn-green" id="btnSimpanHp" data-id="' + esc(h ? h.id : '') + '"><i class="bi bi-save"></i> ' + (h ? 'Simpan perubahan' : 'Simpan &amp; buat label') + '</button>',
    ukuran: 'lg',
    onTampil: async () => {
      UBAH.infoPemilik();
      if (h && h.punyaFoto) {
        try { const r = await api('getFotoHP', h.id); const p = $('#hpFotoPrev'); if (p) p.innerHTML = r.data.foto ? '<img src="' + esc(r.data.foto) + '" alt="Foto HP">' : '<i class="bi bi-camera fs-1"></i>'; } catch (e) { /* abaikan */ }
      }
    }
  });
};
function opsiPemilik(petugas, filter, terpilih) {
  const f = (filter || '').toUpperCase();
  const list = petugas.filter(p => !f || (p.nama + ' ' + p.nip).toUpperCase().indexOf(f) >= 0 || p.nip === terpilih);
  return '<option value="">— Pilih petugas (' + list.length + ') —</option>' + list.map(p => '<option value="' + esc(p.nip) + '"' + (p.nip === terpilih ? ' selected' : '') + '>' + esc(p.nama) + ' — ' + esc(p.nip) + ' (' + esc(p.regu) + ')</option>').join('');
}
KETIK.cariPemilik = (el) => {
  const s = $('#hpPemilik');
  const v = s.value;
  s.innerHTML = opsiPemilik(AppState.cache.hpList.petugas, el.value, v);
  if (!s.value && s.options.length === 2) s.selectedIndex = 1;
  UBAH.infoPemilik();
};
UBAH.infoPemilik = () => {
  const s = $('#hpPemilik'), info = $('#hpPemilikInfo');
  if (!s || !info) return;
  const n = AppState.cache.hpList.hp.filter(h => h.nip === s.value && h.aktif).length;
  info.textContent = s.value ? (n ? 'Petugas ini sudah memiliki ' + n + ' HP terdaftar (boleh lebih dari satu).' : 'Belum ada HP terdaftar untuk petugas ini.') : '';
};
KETIK.imei = (el) => { el.value = el.value.replace(/\D/g, '').slice(0, 4); el.classList.toggle('is-valid', el.value.length === 4); el.classList.remove('is-invalid'); };
AKSI.pilihFoto = (el) => { const i = $('#' + el.dataset.target); if (i) { i.value = ''; i.click(); } };
UBAH.fotoHp = async (el) => {
  const f = el.files && el.files[0];
  if (!f) return;
  const info = $('#hpFotoInfo');
  info.innerHTML = '<span class="spinner-inline" style="border-color:var(--border-color);border-top-color:var(--navy)"></span> Memperkecil foto…';
  try {
    const d = await perkecilGambar(f, 640, 'image/jpeg', 0.72, 450 * 1024);
    AppState.fotoBaru = d;
    $('#hpFotoPrev').innerHTML = '<img src="' + d + '" alt="Pratinjau foto HP">';
    info.textContent = 'Foto siap (' + Math.round(ukuranDataUrl(d) / 1024) + ' KB). Akan disimpan privat di Google Drive.';
  } catch (e) { info.textContent = e.message; toast('Foto', e.message, 'warning'); }
};
KIRIM.simpanHp = async () => {
  const btn = $('#btnSimpanHp');
  const data = { id: btn.dataset.id || '', nip: $('#hpPemilik').value, merek: $('#hpMerek').value.trim(), warna: $('#hpWarna').value.trim(), imei4: $('#hpImei').value.trim(), foto: AppState.fotoBaru || '', perangkat: perangkat() };
  const cek = [['hpPemilik', !!data.nip], ['hpMerek', !!data.merek], ['hpWarna', !!data.warna], ['hpImei', /^\d{4}$/.test(data.imei4)]];
  let gagal = null;
  cek.forEach(x => { const el = $('#' + x[0]); el.classList.toggle('is-invalid', !x[1]); if (!x[1] && !gagal) gagal = el; });
  if (gagal) { gagal.focus(); toast('Lengkapi data', 'Pemilik, merek, warna, dan 4 digit IMEI (tepat 4 angka) wajib diisi.', 'warning'); return; }
  if (!data.id && !data.foto && btn.dataset.tanpaFoto !== '1') {
    // Tidak memakai modal bertumpuk (fokus Bootstrap bisa terkunci) → konfirmasi lewat klik kedua
    btn.dataset.tanpaFoto = '1';
    $('#hpFotoInfo').innerHTML = '<span style="color:var(--red);font-weight:600"><i class="bi bi-exclamation-triangle"></i> Foto HP belum diambil.</span> Foto membantu P2U mencocokkan HP fisik. Tekan <b>Simpan</b> sekali lagi untuk menyimpan tanpa foto.';
    toast('Foto belum ada', 'Ambil foto HP, atau tekan Simpan lagi untuk melanjutkan tanpa foto.', 'warning');
    return;
  }
  await denganTombol(btn, async () => {
    try {
      const r = await api('simpanHp', data);
      AppState.fotoBaru = '';
      await tutupModal();
      toast('Tersimpan', r.message, 'success');
      await muatHp(AppState.navSeq);
      if (!data.id && r.data && r.data.id) cetakLabel('HP', [r.data.id]);
    } catch (e) { tanganiGalat(e); }
  });
};

// ════════════════════════════════════════════════════════
// 11. HALAMAN: IZIN BAWA HP
// ════════════════════════════════════════════════════════
HALAMAN.izin = async (c, o, seq) => {
  await swr('getIzin', 'getIzin', [], d => { if (!basi(seq)) pertahankanForm(c, () => renderIzin(c, d)); });
};
SEGARKAN.izin = async () => {
  const seq = AppState.navSeq, c = $('#app-container');
  try { await swr('getIzin', 'getIzin', [], d => { if (!basi(seq) && AppState.page === 'izin') pertahankanForm(c, () => renderIzin(c, d)); }, { paksa: true }); } catch (e) { tanganiGalat(e); }
};

function statusIzinTampil(z) {
  const now = Date.now();
  if (z.status === 'DISETUJUI' && new Date(z.mulai).getTime() > now) return 'TERJADWAL';
  return z.status;
}
function renderIzin(c, d) {
  AppState.cache.izin = d;
  const menunggu = d.daftar.filter(z => z.status === 'MENUNGGU');
  setBadge('izin', d.penyetuju ? menunggu.length : 0);
  const peran = AppState.user.peran;
  let kiri = '';
  if (d.bolehAjukan) {
    const now = new Date(Date.now() + (5 - (new Date().getMinutes() % 5)) * 60000);
    const mulai = fmt(now, 'lokal'), sampai = fmt(new Date(now.getTime() + 4 * 3600000), 'lokal');
    kiri = '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-plus-circle" aria-hidden="true"></i> Ajukan Izin Bawa HP</h6><span class="bs bs-gold">Maks. ' + d.maksJam + ' jam</span></div>' +
      '<form class="cardx-body" id="formIzin" data-submit="ajukanIzin" novalidate>' +
      (d.hpSaya.length ? '' : '<div class="notice"><i class="bi bi-info-circle"></i><div class="small">Anda belum memiliki HP terdaftar. Hubungi Admin Kamtib untuk pendaftaran.</div></div>') +
      '<div class="mb-3"><label class="form-label" for="izHp">HP yang dibawa *</label><select class="form-select" id="izHp">' +
      opsi(d.hpSaya.map(h => [h.id, h.id + ' — ' + h.merek + ' (IMEI ****' + h.imei4 + ')']), d.hpSaya.length === 1 ? d.hpSaya[0].id : '', '— Pilih HP —') + '</select></div>' +
      '<div class="mb-3"><label class="form-label" for="izAlasan">Keperluan dinas *</label><textarea class="form-control" id="izAlasan" rows="3" maxlength="500" placeholder="Contoh: Sidang TPP online, input rekam medis SDP, inspeksi khusus blok…" data-inp="hitungAlasan"></textarea>' +
      '<div class="form-text d-flex justify-content-between"><span>Minimal 10 karakter, jelaskan keperluannya.</span><span id="izHitung">0/500</span></div></div>' +
      '<div class="row g-2 mb-2"><div class="col-6"><label class="form-label" for="izMulai">Mulai (WIT) *</label><input type="datetime-local" class="form-control" id="izMulai" value="' + mulai + '" data-chg="durasiIzin"></div>' +
      '<div class="col-6"><label class="form-label" for="izSampai">Selesai (WIT) *</label><input type="datetime-local" class="form-control" id="izSampai" value="' + sampai + '" data-chg="durasiIzin"></div></div>' +
      '<div class="small mb-3" id="izDurasi" aria-live="polite">Durasi: 4j 00m</div>' +
      '<div class="notice small py-2"><i class="bi bi-bell" aria-hidden="true"></i><div>Pengajuan dikirim ke Pimpinan &amp; P2U lewat WhatsApp/email. HP wajib dibawa keluar sebelum izin berakhir.</div></div>' +
      '<button type="submit" class="btn btn-green w-100 py-2" id="btnAjukanIzin" ' + (d.hpSaya.length ? '' : 'disabled') + '><i class="bi bi-send"></i> Kirim Pengajuan</button>' +
      '</form></section>';
  }
  let pending = '';
  if (d.penyetuju) {
    pending = '<section class="cardx mb-3" style="border-color:var(--gold)"><div class="cardx-head" style="background:var(--amber-soft)"><h6><i class="bi bi-hourglass-split" aria-hidden="true"></i> Menunggu Persetujuan</h6><span class="bs bs-gold">' + menunggu.length + ' pengajuan</span></div><div class="cardx-body">' +
      (peran === 'P2U' ? '<div class="small text-secondary-x mb-2"><i class="bi bi-info-circle"></i> Persetujuan oleh P2U otomatis dilaporkan ke Pimpinan. Anda tidak dapat memutuskan izin milik sendiri.</div>' : '') +
      (menunggu.length ? menunggu.map(kartuIzinPending).join('') : kosong('bi-check2-all', 'Tidak ada pengajuan yang menunggu.')) + '</div></section>';
  }
  const tab = AppState.tabIzin;
  c.innerHTML = kepala('Izin Membawa HP', 'Pejabat yang berhak dapat membawa HP ke area dalam dengan izin digital yang disetujui Pimpinan / P2U.',
    '<button type="button" class="btn btn-soft btn-sm" data-act="muatUlang"><i class="bi bi-arrow-clockwise"></i> Muat ulang</button>') +
    '<div class="row g-3">' + (kiri ? '<div class="col-lg-5">' + kiri + '</div>' : '') + '<div class="' + (kiri ? 'col-lg-7' : 'col-12') + '">' + pending +
    '<section class="cardx"><div class="cardx-head"><div class="nav-tabs-x" role="tablist">' +
    [['aktif', 'Aktif & terjadwal'], ['menunggu', 'Menunggu'], ['semua', 'Semua riwayat']].map(t => '<button type="button" role="tab" aria-selected="' + (tab === t[0]) + '" class="' + (tab === t[0] ? 'active' : '') + '" data-act="tabIzin" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') +
    '</div><input type="search" class="form-control form-control-sm" style="max-width:220px" id="izCari" data-inp="filterIzin" placeholder="Cari nama / no. izin…" aria-label="Cari izin"></div>' +
    '<div id="tblIzin"></div></section></div></div>';
  renderTabelIzin();
}
function kartuIzinPending(z) {
  const id = esc(z.id);
  return '<div class="border rounded-3 p-3 mb-3" style="border-color:var(--border-color)!important">' +
    '<div class="d-flex justify-content-between gap-2 flex-wrap"><div class="d-flex gap-2 align-items-center min-w-0"><span class="avatar">' + esc(inisial(z.nama)) + '</span><div class="min-w-0"><div class="fw-bold truncate">' + esc(z.nama) + '</div>' +
    '<div class="cell-sub mono">' + esc(z.nip) + '</div></div></div><div class="text-end small"><div class="mono fw-semibold">' + id + '</div><div class="text-secondary-x">Diajukan ' + fmt(z.diajukan, 'tglJam') + '</div></div></div>' +
    '<div class="row g-2 mt-2 small"><div class="col-sm-6"><div class="p-2 rounded" style="background:var(--bg-muted)"><div class="text-secondary-x">Perangkat</div><b>' + esc(z.merek) + '</b><div class="mono">' + esc(z.idHp) + ' • IMEI ****' + esc(z.imei4) + '</div></div></div>' +
    '<div class="col-sm-6"><div class="p-2 rounded" style="background:var(--bg-muted)"><div class="text-secondary-x">Masa berlaku (WIT)</div><b>' + fmt(z.mulai, 'tglJam') + ' – ' + fmt(z.sampai, 'tglJam') + '</b><div>Durasi ' + durasi(selisihMenit(z.mulai, z.sampai)) + '</div></div></div></div>' +
    '<div class="small mt-2"><span class="text-secondary-x">Keperluan:</span> ' + esc(z.alasan) + '</div>' +
    (z.milikSendiri ? '<div class="notice small py-2 mt-2 mb-0"><i class="bi bi-person-x"></i><div>Ini pengajuan Anda sendiri — harus diputuskan oleh penyetuju lain.</div></div>' :
      '<label class="form-label mt-2" for="cat-' + id + '">Catatan / instruksi (wajib jika ditolak)</label><input class="form-control form-control-sm" id="cat-' + id + '" placeholder="Contoh: Disetujui, HP tidak boleh diserahkan ke WBP">' +
      '<div class="d-flex gap-2 mt-2"><button type="button" class="btn btn-green flex-fill" data-act="putuskanIzin" data-k="SETUJU" data-id="' + id + '"><i class="bi bi-check-circle"></i> Setujui</button>' +
      '<button type="button" class="btn btn-soft" style="color:var(--red)" data-act="putuskanIzin" data-k="TOLAK" data-id="' + id + '"><i class="bi bi-x-circle"></i> Tolak</button></div>') +
    '</div>';
}
AKSI.tabIzin = (el) => { AppState.tabIzin = el.dataset.tab; $$('[data-act="tabIzin"]').forEach(b => { const on = b === el; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); }); renderTabelIzin(); };
KETIK.filterIzin = () => renderTabelIzin();
function renderTabelIzin() {
  const el = $('#tblIzin'), d = AppState.cache.izin;
  if (!el || !d) return;
  const q = (($('#izCari') || {}).value || '').trim().toUpperCase();
  const now = Date.now();
  const list = d.daftar.filter(z => {
    if (AppState.tabIzin === 'aktif' && !(z.status === 'DISETUJUI' && new Date(z.sampai).getTime() >= now)) return false;
    if (AppState.tabIzin === 'menunggu' && z.status !== 'MENUNGGU') return false;
    if (q && (z.nama + ' ' + z.id + ' ' + z.nip + ' ' + z.idHp).toUpperCase().indexOf(q) === -1) return false;
    return true;
  });
  el.innerHTML = list.length ? '<div class="table-wrap"><table class="tablex"><thead><tr><th>No. izin</th><th>Pemohon</th><th>HP</th><th>Masa berlaku</th><th>Status</th><th>Penyetuju</th><th class="text-end">Aksi</th></tr></thead><tbody>' +
    list.map(z => {
      const st = statusIzinTampil(z);
      const bisaBatal = d.bolehBatalkan && (z.status === 'MENUNGGU' || z.status === 'DISETUJUI');
      return '<tr><td><div class="mono fw-semibold">' + esc(z.id) + '</div><div class="cell-sub">' + fmt(z.diajukan, 'tglJam') + '</div></td>' +
        '<td><div class="cell-main">' + esc(z.nama) + '</div><div class="cell-sub mono">' + esc(z.nip) + '</div></td>' +
        '<td><div>' + esc(z.merek) + '</div><div class="cell-sub mono">' + esc(z.idHp) + ' • ****' + esc(z.imei4) + '</div></td>' +
        '<td class="mono small">' + fmt(z.mulai, 'tglJam') + '<br>' + fmt(z.sampai, 'tglJam') + '</td>' +
        '<td>' + (st === 'TERJADWAL' ? '<span class="bs bs-navy">Terjadwal</span>' : badge(st)) + (z.statusHp === 'DIBAWA_BERIZIN' && z.status === 'DISETUJUI' ? '<div class="cell-sub">HP di dalam</div>' : '') + '</td>' +
        '<td class="small">' + (z.penyetuju ? esc(z.penyetuju) + '<div class="cell-sub">' + esc(z.peranPenyetuju) + '</div>' : '-') + '</td>' +
        '<td class="text-end text-nowrap"><button type="button" class="btn btn-sm btn-soft btn-icon-sm" data-act="detailIzin" data-id="' + esc(z.id) + '" aria-label="Detail izin" title="Detail"><i class="bi bi-eye"></i></button>' +
        (bisaBatal ? ' <button type="button" class="btn btn-sm btn-soft btn-icon-sm" style="color:var(--red)" data-act="batalkanIzin" data-id="' + esc(z.id) + '" aria-label="Batalkan izin" title="Batalkan"><i class="bi bi-x-octagon"></i></button>' : '') +
        '</td></tr>';
    }).join('') + '</tbody></table></div>' :
    kosong('bi-file-earmark-check', AppState.tabIzin === 'aktif' ? 'Tidak ada izin aktif saat ini.' : 'Tidak ada data izin.');
}
KETIK.hitungAlasan = (el) => { const h = $('#izHitung'); if (h) h.textContent = el.value.length + '/500'; el.classList.remove('is-invalid'); };
UBAH.durasiIzin = () => {
  const a = $('#izMulai').value, b = $('#izSampai').value, el = $('#izDurasi');
  if (!a || !b || !el) return;
  const m = selisihMenit(witKeIso(a), witKeIso(b));
  const maks = (AppState.cache.izin || {}).maksJam || 24;
  el.innerHTML = m <= 0 ? '<span style="color:var(--red)">Waktu selesai harus setelah waktu mulai.</span>' :
    m > maks * 60 ? '<span style="color:var(--red)">Durasi ' + durasi(m) + ' melebihi batas ' + maks + ' jam.</span>' : 'Durasi: ' + durasi(m);
};
KIRIM.ajukanIzin = async () => {
  const data = { idHp: $('#izHp').value, alasan: $('#izAlasan').value.trim(), mulai: witKeIso($('#izMulai').value), sampai: witKeIso($('#izSampai').value), perangkat: perangkat() };
  const maks = AppState.cache.izin.maksJam;
  const m = data.mulai && data.sampai ? selisihMenit(data.mulai, data.sampai) : 0;
  if (!data.idHp) { $('#izHp').classList.add('is-invalid'); $('#izHp').focus(); toast('Lengkapi', 'Pilih HP yang akan dibawa.', 'warning'); return; }
  if (data.alasan.length < 10) { $('#izAlasan').classList.add('is-invalid'); $('#izAlasan').focus(); toast('Lengkapi', 'Keperluan dinas minimal 10 karakter.', 'warning'); return; }
  if (m <= 0 || m > maks * 60) { $('#izSampai').focus(); toast('Periksa waktu', 'Durasi izin harus lebih dari 0 dan maksimal ' + maks + ' jam.', 'warning'); return; }
  await denganTombol($('#btnAjukanIzin'), async () => {
    try { const r = await api('ajukanIzin', data); toast('Terkirim', r.message, 'success'); AppState.tabIzin = 'menunggu'; await SEGARKAN.izin(); } catch (e) { tanganiGalat(e); }
  });
};
AKSI.putuskanIzin = async (el) => {
  const id = el.dataset.id, k = el.dataset.k;
  const z = AppState.cache.izin.daftar.find(x => x.id === id);
  if (!z) return;
  const inp = document.getElementById('cat-' + id);
  let catatan = inp ? inp.value.trim() : '';
  let ok;
  if (k === 'TOLAK') {
    ok = await konfirmasi({ judul: 'Tolak Izin ' + id, pesan: 'Tolak pengajuan <b>' + esc(z.nama) + '</b>? Pemohon akan diberi tahu lewat WhatsApp/email.', input: { label: 'Alasan penolakan (wajib)', nilai: catatan, wajib: true, min: 3 }, okTeks: 'Tolak izin', okKelas: 'btn-red' });
    if (ok) catatan = ok.nilai;
  } else {
    ok = await konfirmasi({
      judul: 'Setujui Izin ' + id,
      pesan: 'Setujui <b>' + esc(z.nama) + '</b> membawa <b>' + esc(z.merek) + '</b> (' + esc(z.idHp) + ') pada ' + fmt(z.mulai, 'tglJam') + ' – ' + fmt(z.sampai, 'tglJam') + ' WIT?' +
        (AppState.user.peran === 'P2U' ? '<div class="small mt-2 text-secondary-x">Persetujuan Anda akan dilaporkan otomatis ke Pimpinan.</div>' : ''),
      okTeks: 'Setujui', okKelas: 'btn-green'
    });
  }
  if (!ok) return;
  try { const r = await api('putuskanIzin', id, k, catatan); toast('Berhasil', r.message, 'success'); await SEGARKAN.izin(); } catch (e) { tanganiGalat(e); }
};
AKSI.batalkanIzin = async (el) => {
  const z = AppState.cache.izin.daftar.find(x => x.id === el.dataset.id);
  if (!z) return;
  const ok = await konfirmasi({ judul: 'Batalkan Izin ' + z.id, pesan: 'Batalkan izin <b>' + esc(z.nama) + '</b>? Jika HP masih di dalam, sistem akan segera mengirim peringatan.', input: { label: 'Alasan pembatalan (wajib)', wajib: true, min: 3 }, okTeks: 'Batalkan izin', okKelas: 'btn-red' });
  if (!ok) return;
  try { const r = await api('batalkanIzin', z.id, ok.nilai); toast('Dibatalkan', r.message, 'success'); await SEGARKAN.izin(); } catch (e) { tanganiGalat(e); }
};
AKSI.detailIzin = (el) => {
  const z = AppState.cache.izin.daftar.find(x => x.id === el.dataset.id);
  if (!z) return;
  const st = statusIzinTampil(z);
  const aktif = z.status === 'DISETUJUI' && new Date(z.mulai).getTime() <= Date.now() && new Date(z.sampai).getTime() >= Date.now();
  bukaModal({
    judul: '<i class="bi bi-file-earmark-check"></i> Izin ' + esc(z.id),
    isi: (aktif ? '<div class="ok-banner mb-3"><i class="bi bi-patch-check-fill"></i><h3>IZIN AKTIF</h3><div class="small">Berlaku s/d ' + fmt(z.sampai) + ' WIT. Tunjukkan HP di Pos P2U Pintu 2 — status izin terbaca otomatis saat label dipindai.</div></div>' : '') +
      '<dl class="kv-list"><dt>Status</dt><dd>' + (st === 'TERJADWAL' ? '<span class="bs bs-navy">Terjadwal</span>' : badge(st)) + '</dd>' +
      '<dt>Pemohon</dt><dd>' + esc(z.nama) + ' <span class="mono small">(' + esc(z.nip) + ')</span></dd>' +
      '<dt>Perangkat</dt><dd>' + esc(z.merek) + ' • ' + esc(z.idHp) + ' • IMEI ****' + esc(z.imei4) + '</dd>' +
      '<dt>Keperluan</dt><dd>' + esc(z.alasan) + '</dd>' +
      '<dt>Berlaku</dt><dd>' + fmt(z.mulai) + ' – ' + fmt(z.sampai) + ' WIT (' + durasi(selisihMenit(z.mulai, z.sampai)) + ')</dd>' +
      '<dt>Diajukan</dt><dd>' + fmt(z.diajukan) + ' WIT</dd>' +
      '<dt>Diputuskan</dt><dd>' + (z.penyetuju ? esc(z.penyetuju) + ' (' + esc(z.peranPenyetuju) + ') • ' + fmt(z.waktuPutus) : '-') + '</dd>' +
      '<dt>Catatan</dt><dd>' + esc(z.catatan || '-') + '</dd></dl>',
    sheet: true
  });
};

// ════════════════════════════════════════════════════════
// 12. HALAMAN: RIWAYAT & PENCARIAN
// ════════════════════════════════════════════════════════
HALAMAN.riwayat = async (c, o, seq) => {
  if (!AppState.fRiwayat) AppState.fRiwayat = { q: '', dari: tambahHari(hariIni(), -6), sampai: hariIni(), regu: '', shift: '', status: '', page: 1, pageSize: 20 };
  const f = AppState.fRiwayat;
  c.innerHTML = kepala('Riwayat &amp; Pencarian', 'Cari berdasarkan nama, NIP, ID HP, atau 4 digit IMEI. Klik baris untuk detail &amp; foto.') +
    '<form class="cardx mb-3" id="formRiwayat" data-submit="cariRiwayat"><div class="cardx-body row g-2 align-items-end">' +
    '<div class="col-12 col-lg-3"><label class="form-label" for="rwQ">Kata kunci</label><input type="search" class="form-control" id="rwQ" value="' + esc(f.q) + '" placeholder="Nama / NIP / ID HP / IMEI"></div>' +
    '<div class="col-6 col-lg-2"><label class="form-label" for="rwDari">Dari</label><input type="date" class="form-control" id="rwDari" value="' + esc(f.dari) + '"></div>' +
    '<div class="col-6 col-lg-2"><label class="form-label" for="rwSampai">Sampai</label><input type="date" class="form-control" id="rwSampai" value="' + esc(f.sampai) + '"></div>' +
    '<div class="col-4 col-lg-1"><label class="form-label" for="rwRegu">Regu</label><select class="form-select" id="rwRegu">' + opsi(DAFTAR_REGU, f.regu, 'Semua') + '</select></div>' +
    '<div class="col-4 col-lg-1"><label class="form-label" for="rwShift">Shift</label><select class="form-select" id="rwShift">' + opsi(['Pagi', 'Siang', 'Malam'], f.shift, 'Semua') + '</select></div>' +
    '<div class="col-4 col-lg-1"><label class="form-label" for="rwStatus">Status</label><select class="form-select" id="rwStatus">' +
    opsi([['TERTAHAN', 'Tertahan'], ['TERLAMBAT', 'Lewat batas'], ['BERIZIN_DI_DALAM', 'Berizin di dalam'], ['SELESAI', 'Selesai'], ['SELESAI_TERLAMBAT', 'Selesai terlambat']], f.status, 'Semua') + '</select></div>' +
    '<div class="col-12 col-lg-2 d-flex gap-2"><button type="submit" class="btn btn-navy flex-fill"><i class="bi bi-search"></i> Cari</button>' +
    '<button type="button" class="btn btn-soft" data-act="eksporRiwayat" aria-label="Ekspor CSV" title="Ekspor CSV / Excel"><i class="bi bi-download"></i></button></div>' +
    '</div></form><section class="cardx" id="hasilRiwayat">' + memuat() + '</section>';
  await muatRiwayat(seq);
};
SEGARKAN.riwayat = () => muatRiwayat(AppState.navSeq).catch(tanganiGalat);
function bacaFilterRiwayat() {
  const f = AppState.fRiwayat;
  f.q = $('#rwQ').value.trim(); f.dari = $('#rwDari').value; f.sampai = $('#rwSampai').value;
  f.regu = $('#rwRegu').value; f.shift = $('#rwShift').value; f.status = $('#rwStatus').value;
}
KIRIM.cariRiwayat = () => { bacaFilterRiwayat(); AppState.fRiwayat.page = 1; muatRiwayat(AppState.navSeq).catch(tanganiGalat); };
AKSI.halRiwayat = (el) => { AppState.fRiwayat.page = Number(el.dataset.hal); muatRiwayat(AppState.navSeq).catch(tanganiGalat); };
async function muatRiwayat(seq) {
  const el = $('#hasilRiwayat');
  if (el) el.innerHTML = memuat('Mencari…');
  const r = await api('getRiwayat', AppState.fRiwayat);
  if (basi(seq) || !$('#hasilRiwayat')) return;
  const d = r.data;
  AppState.cache.riwayat = d.rows;
  $('#hasilRiwayat').innerHTML = d.rows.length ? '<div class="table-wrap"><table class="tablex"><thead><tr><th>Titip (WIT)</th><th>Pemilik</th><th>HP</th><th>Ambil</th><th>Durasi</th><th>Status</th><th>P2U</th><th>Catatan</th></tr></thead><tbody>' +
    d.rows.map((x, i) => '<tr style="cursor:pointer" data-act="detailLog" data-i="' + i + '" tabindex="0" class="' + (x.status === 'TERLAMBAT' ? 'row-red' : '') + '">' +
      '<td class="text-nowrap"><div class="mono fw-semibold">' + fmt(x.waktuTitip, 'tglJam') + '</div><div class="cell-sub">Shift ' + esc(x.shift) + (x.jenis === 'BERIZIN' ? ' • berizin' : '') + '</div></td>' +
      '<td><div class="cell-main">' + esc(x.nama) + '</div><div class="cell-sub mono">' + esc(x.nip) + ' • ' + esc(x.regu) + '</div></td>' +
      '<td><span class="tag-loker">' + esc(x.idHp) + '</span><div class="cell-sub mt-1">' + esc(x.merek) + ' • ****' + esc(x.imei4) + '</div></td>' +
      '<td class="mono text-nowrap">' + (x.waktuAmbil ? fmt(x.waktuAmbil, 'tglJam') + (x.diambilOleh === 'ORANG_LAIN' ? '<div class="cell-sub" style="color:var(--red)">orang lain</div>' : '') : '<span class="text-secondary-x">—</span>') + '</td>' +
      '<td class="mono">' + (x.durasi !== '' ? durasi(x.durasi) : '-') + '</td>' +
      '<td>' + badge(x.status) + '</td>' +
      '<td class="small">' + esc(x.p2uTitip) + (x.p2uAmbil ? '<div class="cell-sub">ambil: ' + esc(x.p2uAmbil) + '</div>' : '') + '</td>' +
      '<td class="small" style="max-width:220px">' + esc(x.catatan || '') + '</td></tr>').join('') + '</tbody></table></div>' + pager(d.total, d.page, d.pageSize, 'halRiwayat') :
    kosong('bi-search', 'Tidak ada riwayat yang cocok dengan filter.');
}
AKSI.detailLog = async (el) => {
  const x = (AppState.cache.riwayat || [])[Number(el.dataset.i)];
  if (!x) return;
  bukaModal({
    judul: '<i class="bi bi-clock-history"></i> Riwayat ' + esc(x.idHp),
    isi: '<div class="d-flex gap-3 align-items-start flex-wrap"><div class="hp-photo" id="fotoDetailLog" role="img" aria-label="Foto HP">' + (x.punyaFoto ? '<span class="spinner-border spinner-border-sm"></span>' : '<i class="bi bi-phone"></i>') + '</div>' +
      '<dl class="kv-list flex-grow-1 mb-0"><dt>Pemilik</dt><dd>' + esc(x.nama) + ' <span class="mono small">(' + esc(x.nip) + ')</span></dd><dt>Regu</dt><dd>' + esc(x.regu) + '</dd>' +
      '<dt>HP</dt><dd>' + esc(x.merek) + ' • ' + esc(x.warna) + ' • IMEI ****' + esc(x.imei4) + '</dd><dt>Jenis</dt><dd>' + esc(x.jenis) + ' • Shift ' + esc(x.shift) + '</dd>' +
      '<dt>Titip</dt><dd>' + fmt(x.waktuTitip) + ' WIT oleh ' + esc(x.p2uTitip) + '</dd><dt>Batas</dt><dd>' + fmt(x.batas) + ' WIT</dd>' +
      '<dt>Ambil</dt><dd>' + (x.waktuAmbil ? fmt(x.waktuAmbil) + ' WIT oleh ' + esc(x.p2uAmbil) + (x.diambilOleh === 'ORANG_LAIN' ? ' <span class="bs bs-red">orang lain</span>' : '') : '—') + '</dd>' +
      '<dt>Durasi</dt><dd>' + (x.durasi !== '' ? durasi(x.durasi) : '-') + '</dd><dt>Status</dt><dd>' + badge(x.status) + '</dd><dt>Catatan</dt><dd>' + esc(x.catatan || '-') + '</dd></dl></div>',
    ukuran: 'lg', sheet: true,
    onTampil: async () => {
      if (!x.punyaFoto) return;
      try {
        const r = await api('getFotoHP', x.idHp);
        const f = $('#fotoDetailLog');
        if (f && r.data.foto) f.outerHTML = '<img src="' + esc(r.data.foto) + '" class="hp-photo" alt="Foto ' + esc(x.idHp) + '">';
      } catch (e) { /* abaikan */ }
    }
  });
};
AKSI.eksporRiwayat = async (el) => {
  bacaFilterRiwayat();
  await denganTombol(el, async () => {
    try {
      const r = await api('getRiwayat', Object.assign({}, AppState.fRiwayat, { page: 1, pageSize: 5000 }));
      const f = AppState.fRiwayat;
      unduhCsv('Riwayat_SIPANTAU-HP_' + (f.dari || 'awal') + '_sd_' + (f.sampai || 'kini') + '.csv',
        ['Waktu Titip (WIT)', 'Shift', 'Jenis', 'Nama', 'NIP', 'Regu', 'ID HP', 'Merek', 'Warna', 'IMEI 4', 'Batas Ambil', 'Waktu Ambil', 'Diambil Oleh', 'Durasi (menit)', 'Status', 'P2U Titip', 'P2U Ambil', 'Catatan'],
        r.data.rows.map(x => [fmt(x.waktuTitip), x.shift, x.jenis, x.nama, x.nip, x.regu, x.idHp, x.merek, x.warna, x.imei4, fmt(x.batas), x.waktuAmbil ? fmt(x.waktuAmbil) : '', x.diambilOleh, x.durasi, x.status, x.p2uTitip, x.p2uAmbil, x.catatan]));
    } catch (e) { tanganiGalat(e); }
  });
};

// ════════════════════════════════════════════════════════
// 13. HALAMAN: LAPORAN & GRAFIK
// ════════════════════════════════════════════════════════
HALAMAN.laporan = async (c, o, seq) => {
  const p2u = AppState.user.peran === 'P2U';
  if (!AppState.lap) AppState.lap = { jenis: 'HARIAN', harian: hariIni(), bulanan: hariIni().slice(0, 7) };
  if (p2u) AppState.lap.jenis = 'HARIAN';
  const L = AppState.lap;
  c.innerHTML = kepala('Laporan &amp; Grafik', 'Rekap titip/ambil per shift &amp; regu, atensi keterlambatan, izin, dan cetak PDF berkop resmi.') +
    '<form class="cardx mb-3" id="formLaporan" data-submit="tampilLaporan"><div class="cardx-body d-flex flex-wrap gap-2 align-items-end">' +
    '<div class="nav-tabs-x" role="tablist">' + ['HARIAN', 'BULANAN'].filter(j => !p2u || j === 'HARIAN').map(j =>
      '<button type="button" role="tab" aria-selected="' + (L.jenis === j) + '" class="' + (L.jenis === j ? 'active' : '') + '" data-act="jenisLaporan" data-j="' + j + '">' + (j === 'HARIAN' ? 'Harian' : 'Bulanan') + '</button>').join('') + '</div>' +
    '<div><label class="form-label" for="lapNilai">' + (L.jenis === 'HARIAN' ? 'Tanggal' : 'Bulan') + '</label>' +
    '<input type="' + (L.jenis === 'HARIAN' ? 'date' : 'month') + '" class="form-control" id="lapNilai" value="' + esc(L.jenis === 'HARIAN' ? L.harian : L.bulanan) + '" max="' + (L.jenis === 'HARIAN' ? hariIni() : hariIni().slice(0, 7)) + '"></div>' +
    '<button type="submit" class="btn btn-navy"><i class="bi bi-bar-chart"></i> Tampilkan</button>' +
    '<button type="button" class="btn btn-gold" data-act="pdfLaporan"><i class="bi bi-file-earmark-pdf"></i> Cetak PDF</button>' +
    '<button type="button" class="btn btn-soft" data-act="csvLaporan"><i class="bi bi-download"></i> Ekspor CSV</button>' +
    (p2u ? '<span class="small text-secondary-x">P2U dapat melihat laporan harian.</span>' : '') +
    '</div></form><div id="isiLaporan">' + memuat('Menyusun laporan…') + '</div>';
  await muatLaporan(seq);
};
SEGARKAN.laporan = () => muatLaporan(AppState.navSeq).catch(tanganiGalat);
AKSI.jenisLaporan = (el) => { AppState.lap.jenis = el.dataset.j; navigateTo('laporan'); };
function nilaiLaporan() {
  const L = AppState.lap, v = $('#lapNilai') ? $('#lapNilai').value : '';
  if (v) { if (L.jenis === 'HARIAN') L.harian = v; else L.bulanan = v; }
  return L.jenis === 'HARIAN' ? L.harian : L.bulanan;
}
KIRIM.tampilLaporan = () => muatLaporan(AppState.navSeq).catch(tanganiGalat);
async function muatLaporan(seq) {
  const L = AppState.lap, nilai = nilaiLaporan();
  const box = $('#isiLaporan');
  if (box) box.innerHTML = memuat('Menyusun laporan…');
  const r = await api('getLaporan', L.jenis, nilai);
  if (basi(seq) || !$('#isiLaporan')) return;
  renderLaporan(r.data);
}
function renderLaporan(d) {
  AppState.cache.laporan = d;
  if (!window.Chart) muatPustaka('chart').then(() => { if (AppState.page === 'laporan' && AppState.cache.laporan === d && $('#isiLaporan')) renderLaporan(d); }).catch(() => {});
  hancurkanChart();
  const t = d.total, bulanan = d.jenis === 'BULANAN';
  const reguAda = Object.keys(d.perRegu).filter(k => d.perRegu[k].titip);
  const atensi = d.atensi.length ? '<div class="table-wrap"><table class="tablex"><thead><tr><th>Nama &amp; NIP</th><th>Regu</th><th>HP</th><th>Titip</th><th>Ambil</th><th>Lewat batas</th><th>Keterangan</th></tr></thead><tbody>' +
    d.atensi.map(a => '<tr class="' + (a.lewatMenit ? 'row-red' : '') + '"><td><div class="cell-main">' + esc(a.nama) + '</div><div class="cell-sub mono">' + esc(a.nip) + '</div></td><td>' + esc(a.regu) + '</td>' +
      '<td>' + esc(a.merek) + '<div class="cell-sub mono">' + esc(a.idHp) + ' • ****' + esc(a.imei4) + '</div></td><td class="mono">' + fmt(a.waktuTitip, bulanan ? 'tglJam' : 'jam') + '</td>' +
      '<td class="mono">' + (a.waktuAmbil ? fmt(a.waktuAmbil, bulanan ? 'tglJam' : 'jam') : '<span class="bs bs-red">Belum</span>') + '</td>' +
      '<td class="mono fw-bold" style="color:var(--red)">' + (a.lewatMenit ? '+' + durasi(a.lewatMenit) : '-') + '</td>' +
      '<td class="small">' + (a.orangLain ? '<span class="bs bs-red">Diambil orang lain</span> ' : '') + esc(a.catatan) + '</td></tr>').join('') + '</tbody></table></div>' :
    kosong('bi-check2-circle', 'Nihil — seluruh HP diambil tepat waktu.');
  const izin = d.izin.length ? '<div class="table-wrap"><table class="tablex"><thead><tr><th>Pemegang izin</th><th>Perangkat</th><th>Keperluan</th><th>Masa berlaku</th><th>Penyetuju</th><th>Status</th></tr></thead><tbody>' +
    d.izin.map(z => '<tr><td><div class="cell-main">' + esc(z.nama) + '</div><div class="cell-sub">' + esc(z.jabatan) + '</div></td><td>' + esc(z.merek) + '<div class="cell-sub mono">****' + esc(z.imei4) + '</div></td>' +
      '<td class="small" style="max-width:240px">' + esc(z.alasan) + '</td><td class="mono small">' + fmt(z.mulai, 'tglJam') + '<br>' + fmt(z.sampai, 'tglJam') + '</td>' +
      '<td class="small">' + esc(z.penyetuju) + '<div class="cell-sub">' + esc(z.peranPenyetuju) + '</div></td><td>' + badge(z.status) + '</td></tr>').join('') + '</tbody></table></div>' :
    kosong('bi-file-earmark', 'Tidak ada izin bawa HP pada periode ini.');

  $('#isiLaporan').innerHTML = '<h3 class="h6 fw-bold mb-3"><i class="bi bi-calendar3" aria-hidden="true"></i> Periode: ' + esc(d.judulPeriode) + ' (WIT)</h3>' +
    '<div class="row g-3 mb-3">' +
    '<div class="col-6 col-md-3 col-xl">' + kpi('navy', 'bi-phone', 'HP dititip', t.titip, 'Total periode') + '</div>' +
    '<div class="col-6 col-md-3 col-xl">' + kpi('green', 'bi-check2-circle', 'Diambil', t.ambil, '') + '</div>' +
    '<div class="col-6 col-md-3 col-xl">' + kpi('', 'bi-lock', 'Masih di loker', t.masih, '') + '</div>' +
    '<div class="col-6 col-md-3 col-xl">' + kpi(t.terlambat ? 'red' : '', 'bi-alarm', 'Terlambat', t.terlambat, 'Diambil orang lain: ' + t.orangLain) + '</div>' +
    '<div class="col-6 col-md-3 col-xl">' + kpi(t.labelTidakSah ? 'red' : '', 'bi-x-octagon', 'Label tidak sah', t.labelTidakSah, 'Percobaan label palsu/lama') + '</div>' +
    '<div class="col-6 col-md-3 col-xl">' + kpi('gold', 'bi-patch-check', 'Izin digunakan', d.izin.length, '') + '</div>' +
    '<div class="col-12 col-md-6 col-xl">' + kpi(d.disiplin >= 95 ? 'green' : d.disiplin >= 85 ? 'gold' : 'red', 'bi-award', 'Tingkat disiplin', d.disiplin + '%', 'HP diambil tepat waktu') + '</div>' +
    '</div>' +
    '<div class="row g-3 mb-3">' +
    '<div class="col-lg-6"><section class="cardx h-100"><div class="cardx-head"><h6>Rekap per shift</h6></div><div class="cardx-body"><div class="chart-box"><canvas id="chShift" role="img" aria-label="Grafik rekap per shift"></canvas></div></div></section></div>' +
    '<div class="col-lg-6"><section class="cardx h-100"><div class="cardx-head"><h6>Rekap per regu</h6></div><div class="cardx-body">' + (reguAda.length ? '<div class="chart-box"><canvas id="chRegu" role="img" aria-label="Grafik rekap per regu"></canvas></div>' : kosong('bi-bar-chart', 'Belum ada data.')) + '</div></section></div>' +
    (bulanan ? '<div class="col-lg-7"><section class="cardx h-100"><div class="cardx-head"><h6>Penitipan per hari</h6></div><div class="cardx-body"><div class="chart-box"><canvas id="chHari" role="img" aria-label="Grafik penitipan per hari"></canvas></div></div></section></div>' +
      '<div class="col-lg-5"><section class="cardx h-100"><div class="cardx-head"><h6>Tren pelanggaran 6 bulan</h6></div><div class="cardx-body"><div class="chart-box"><canvas id="chTren" role="img" aria-label="Grafik tren keterlambatan 6 bulan"></canvas></div></div></section></div>' : '') +
    '</div>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-exclamation-triangle" style="color:var(--red)" aria-hidden="true"></i> Atensi: HP tertahan / terlambat / diambil orang lain</h6><span class="bs bs-red">' + d.atensi.length + '</span></div>' + atensi + '</section>' +
    '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-file-earmark-check" aria-hidden="true"></i> Izin membawa HP ke dalam</h6><span class="bs bs-gold">' + d.izin.length + '</span></div>' + izin + '</section>';

  const w = warnaGrafik();
  const ds3 = (src, keys) => [
    { label: 'Titip', data: keys.map(k => src[k].titip), backgroundColor: w.navy, borderRadius: 6 },
    { label: 'Ambil', data: keys.map(k => src[k].ambil), backgroundColor: w.green, borderRadius: 6 },
    { label: 'Terlambat', data: keys.map(k => src[k].terlambat), backgroundColor: w.red, borderRadius: 6 }
  ];
  const opsiBar = { scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }, plugins: { legend: { position: 'bottom' } } };
  const shiftKeys = ['Pagi', 'Siang', 'Malam'].filter(k => d.perShift[k]);
  buatChart($('#chShift'), { type: 'bar', data: { labels: shiftKeys.map(k => 'Shift ' + k), datasets: ds3(d.perShift, shiftKeys) }, options: opsiBar });
  if (reguAda.length) buatChart($('#chRegu'), { type: 'bar', data: { labels: reguAda, datasets: ds3(d.perRegu, reguAda) }, options: opsiBar });
  if (bulanan) {
    buatChart($('#chHari'), {
      type: 'line',
      data: { labels: d.perHari.map(h => h.tanggal.slice(8) + '/' + h.tanggal.slice(5, 7)), datasets: [
        { label: 'Titip', data: d.perHari.map(h => h.titip), borderColor: w.navy, backgroundColor: w.navy, tension: 0.3 },
        { label: 'Terlambat', data: d.perHari.map(h => h.terlambat), borderColor: w.red, backgroundColor: w.red, tension: 0.3 }] },
      options: opsiBar
    });
    buatChart($('#chTren'), {
      type: 'bar',
      data: { labels: d.tren.map(x => x.label), datasets: [
        { label: 'Titip', data: d.tren.map(x => x.titip), backgroundColor: w.gray, borderRadius: 6 },
        { label: 'Terlambat', data: d.tren.map(x => x.terlambat), type: 'line', borderColor: w.red, backgroundColor: w.red, tension: 0.3 }] },
      options: opsiBar
    });
  }
}
AKSI.pdfLaporan = async (el) => {
  const L = AppState.lap, nilai = nilaiLaporan();
  await denganTombol(el, async () => {
    try { const r = await api('buatPdfLaporan', L.jenis, nilai); tampilPdf(r.data, 'Laporan ' + (L.jenis === 'HARIAN' ? 'Harian ' : 'Bulanan ') + nilai); } catch (e) { tanganiGalat(e, 'Gagal membuat PDF'); }
  });
};
AKSI.csvLaporan = () => {
  const d = AppState.cache.laporan;
  if (!d) { toast('Belum ada data', 'Tampilkan laporan terlebih dahulu.', 'warning'); return; }
  const rows = [];
  ['Pagi', 'Siang', 'Malam'].forEach(k => { const o = d.perShift[k] || {}; rows.push(['REKAP SHIFT', 'Shift ' + k, o.titip || 0, o.ambil || 0, o.masih || 0, o.terlambat || 0, '', '', '']); });
  Object.keys(d.perRegu).forEach(k => { const o = d.perRegu[k]; if (o.titip) rows.push(['REKAP REGU', k, o.titip, o.ambil, o.masih, o.terlambat, '', '', '']); });
  d.perHari.forEach(h => rows.push(['REKAP HARIAN', h.tanggal, h.titip, h.ambil, '', h.terlambat, '', '', '']));
  d.atensi.forEach(a => rows.push(['ATENSI', a.nama + ' (' + a.nip + ')', a.regu, a.idHp + ' ' + a.merek, fmt(a.waktuTitip), a.waktuAmbil ? fmt(a.waktuAmbil) : 'BELUM', a.lewatMenit, a.orangLain ? 'Diambil orang lain' : '', a.catatan]));
  d.izin.forEach(z => rows.push(['IZIN', z.nama, z.jabatan, z.idHp + ' ' + z.merek, fmt(z.mulai), fmt(z.sampai), z.penyetuju + ' (' + z.peranPenyetuju + ')', z.status, z.alasan]));
  unduhCsv('Laporan_' + d.jenis + '_' + d.nilai + '.csv', ['Bagian', 'Uraian', 'Titip/Regu', 'Ambil/HP', 'Masih/Waktu', 'Terlambat/Ambil', 'Lewat (menit)/Penyetuju', 'Keterangan', 'Catatan'], rows);
};

// ════════════════════════════════════════════════════════
// 14. HALAMAN: LOG AUDIT & NOTIFIKASI
// ════════════════════════════════════════════════════════
HALAMAN.audit = async (c, o, seq) => {
  if (!AppState.fAudit) AppState.fAudit = { q: '', kategori: '', dari: tambahHari(hariIni(), -6), sampai: hariIni(), page: 1, pageSize: 25 };
  const f = AppState.fAudit, tab = AppState.tabAudit;
  c.innerHTML = kepala('Log Audit &amp; Notifikasi', 'Jejak seluruh aksi penting (tidak dapat diubah dari aplikasi, dilindungi rantai hash SHA-256) dan log pengiriman WhatsApp/email.',
    '<button type="button" class="btn btn-gold btn-sm" data-act="verifikasiAudit"><i class="bi bi-shield-check"></i> Verifikasi integritas</button>') +
    '<div id="hasilVerif"></div>' +
    '<div class="nav-tabs-x mb-3" role="tablist" style="width:max-content;max-width:100%">' +
    [['audit', 'Log Audit Sistem'], ['notif', 'Log Notifikasi WA &amp; Email']].map(t => '<button type="button" role="tab" aria-selected="' + (tab === t[0]) + '" class="' + (tab === t[0] ? 'active' : '') + '" data-act="tabAudit" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
    (tab === 'audit' ?
      '<form class="cardx mb-3" id="formAudit" data-submit="cariAudit"><div class="cardx-body row g-2 align-items-end">' +
      '<div class="col-12 col-md-4"><label class="form-label" for="auQ">Kata kunci</label><input type="search" class="form-control" id="auQ" value="' + esc(f.q) + '" placeholder="NIP, nama pelaku, aksi, detail…"></div>' +
      '<div class="col-12 col-md-2"><label class="form-label" for="auKat">Kategori</label><select class="form-select" id="auKat">' + opsi(Object.keys(WARNA_KATEGORI), f.kategori, 'Semua') + '</select></div>' +
      '<div class="col-6 col-md-2"><label class="form-label" for="auDari">Dari</label><input type="date" class="form-control" id="auDari" value="' + esc(f.dari) + '"></div>' +
      '<div class="col-6 col-md-2"><label class="form-label" for="auSampai">Sampai</label><input type="date" class="form-control" id="auSampai" value="' + esc(f.sampai) + '"></div>' +
      '<div class="col-12 col-md-2 d-flex gap-2"><button type="submit" class="btn btn-navy flex-fill"><i class="bi bi-search"></i> Cari</button>' +
      '<button type="button" class="btn btn-soft" data-act="eksporAudit" aria-label="Ekspor CSV" title="Ekspor CSV"><i class="bi bi-download"></i></button></div></div></form>' +
      '<section class="cardx" id="hasilAudit">' + memuat() + '</section>' :
      '<div id="hasilNotif">' + memuat() + '</div>');
  if (tab === 'audit') await muatAudit(seq); else await muatNotif(seq);
};
SEGARKAN.audit = () => (AppState.tabAudit === 'audit' ? muatAudit(AppState.navSeq) : muatNotif(AppState.navSeq)).catch(tanganiGalat);
AKSI.tabAudit = (el) => { AppState.tabAudit = el.dataset.tab; navigateTo('audit'); };
function bacaFilterAudit() { const f = AppState.fAudit; f.q = $('#auQ').value.trim(); f.kategori = $('#auKat').value; f.dari = $('#auDari').value; f.sampai = $('#auSampai').value; }
KIRIM.cariAudit = () => { bacaFilterAudit(); AppState.fAudit.page = 1; muatAudit(AppState.navSeq).catch(tanganiGalat); };
AKSI.halAudit = (el) => { AppState.fAudit.page = Number(el.dataset.hal); muatAudit(AppState.navSeq).catch(tanganiGalat); };
async function muatAudit(seq) {
  const el = $('#hasilAudit');
  if (el) el.innerHTML = memuat();
  const r = await api('getAudit', AppState.fAudit);
  if (basi(seq) || !$('#hasilAudit')) return;
  const d = r.data;
  $('#hasilAudit').innerHTML = d.rows.length ? '<div class="table-wrap"><table class="tablex"><thead><tr><th>Waktu (WIT)</th><th>Pelaku</th><th>Kategori</th><th>Aksi &amp; detail</th><th>Perubahan</th><th>Perangkat</th></tr></thead><tbody>' +
    d.rows.map(a => '<tr class="' + (/GAGAL|TIDAK_SAH|DIKUNCI/.test(a.aksi) ? 'row-red' : '') + '">' +
      '<td class="mono text-nowrap"><div class="fw-semibold">' + fmt(a.waktu, 'jamDetik') + '</div><div class="cell-sub">' + fmt(a.waktu, 'tgl') + '</div></td>' +
      '<td><div class="d-flex gap-2 align-items-center"><span class="avatar" style="width:30px;height:30px;font-size:.65rem">' + esc(inisial(a.nama)) + '</span><div class="min-w-0"><div class="cell-main truncate" style="max-width:160px">' + esc(a.nama) + '</div><div class="cell-sub mono">' + esc(a.nip) + ' • ' + esc(a.peran) + '</div></div></div></td>' +
      '<td><span class="bs ' + (WARNA_KATEGORI[a.kategori] || 'bs-gray') + '">' + esc(a.kategori) + '</span></td>' +
      '<td><div class="fw-semibold">' + esc(a.aksi.replace(/_/g, ' ')) + '</div><div class="cell-sub" style="max-width:320px">' + esc(a.detail) + '</div></td>' +
      '<td class="small mono">' + (a.sebelum || a.sesudah ? '<span style="color:var(--red)">' + esc(a.sebelum || '–') + '</span> → <span style="color:var(--green)">' + esc(a.sesudah || '–') + '</span>' : '-') + '</td>' +
      '<td class="cell-sub" style="max-width:180px">' + esc(a.perangkat || '-') + '</td></tr>').join('') + '</tbody></table></div>' + pager(d.total, d.page, d.pageSize, 'halAudit') :
    kosong('bi-shield', 'Tidak ada entri log yang cocok.');
}
AKSI.eksporAudit = async (el) => {
  bacaFilterAudit();
  await denganTombol(el, async () => {
    try {
      const r = await api('getAudit', Object.assign({}, AppState.fAudit, { page: 1, pageSize: 5000 }));
      unduhCsv('Audit_SIPANTAU-HP_' + AppState.fAudit.dari + '_sd_' + AppState.fAudit.sampai + '.csv',
        ['Waktu (WIT)', 'NIP', 'Nama', 'Peran', 'Kategori', 'Aksi', 'Detail', 'Sebelum', 'Sesudah', 'Perangkat'],
        r.data.rows.map(a => [fmt(a.waktu, 'tgl') + ' ' + fmt(a.waktu, 'jamDetik'), a.nip, a.nama, a.peran, a.kategori, a.aksi, a.detail, a.sebelum, a.sesudah, a.perangkat]));
    } catch (e) { tanganiGalat(e); }
  });
};
AKSI.verifikasiAudit = async (el) => {
  await denganTombol(el, async () => {
    try {
      const r = await api('verifikasiAudit');
      const ok = r.data.valid;
      $('#hasilVerif').innerHTML = '<div class="notice" style="background:' + (ok ? 'var(--green-soft)' : 'var(--red-soft)') + ';border-left-color:' + (ok ? 'var(--green)' : 'var(--red)') + '">' +
        '<i class="bi ' + (ok ? 'bi-shield-check' : 'bi-shield-exclamation') + '" style="color:' + (ok ? 'var(--green)' : 'var(--red)') + '"></i><div><b>' + esc(r.message) + '</b>' +
        (ok ? '' : '<div class="small">Seseorang mengubah/menghapus baris Audit_Log langsung di Google Sheets. Laporkan ke Pimpinan.</div>') + '</div></div>';
      toast(ok ? 'Log audit utuh' : 'PERINGATAN INTEGRITAS', r.message, ok ? 'success' : 'danger');
    } catch (e) { tanganiGalat(e); }
  });
};
async function muatNotif(seq) {
  const r = await api('getNotifLog');
  if (basi(seq) || !$('#hasilNotif')) return;
  const list = r.data, ok = list.filter(n => n.status === 'TERKIRIM').length, wa = list.filter(n => n.kanal === 'WA').length;
  $('#hasilNotif').innerHTML = '<div class="row g-3 mb-3">' +
    '<div class="col-6 col-md-3">' + kpi('navy', 'bi-send', 'Total (200 terakhir)', list.length, '') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('green', 'bi-whatsapp', 'WhatsApp', wa, 'via Fonnte') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('', 'bi-envelope', 'Email', list.length - wa, 'via Gmail') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi(list.length - ok ? 'red' : 'green', 'bi-check2-all', 'Berhasil', (list.length ? Math.round(ok / list.length * 100) : 100) + '%', (list.length - ok) + ' gagal') + '</div></div>' +
    (list.length ? list.map(n => '<div class="feed-item ' + (n.status === 'TERKIRIM' ? 'ok' : 'bad') + '"><div class="d-flex justify-content-between gap-2 flex-wrap">' +
      '<div class="d-flex gap-2 align-items-center"><span class="bs ' + (n.kanal === 'WA' ? 'bs-green' : 'bs-navy') + '"><i class="bi ' + (n.kanal === 'WA' ? 'bi-whatsapp' : 'bi-envelope') + '"></i> ' + esc(n.kanal) + '</span>' + badge(n.status) + '</div>' +
      '<span class="meta mono">' + fmt(n.waktu) + ' WIT</span></div><div class="fw-semibold small mt-1">' + esc(n.ringkasan) + '</div>' +
      '<div class="meta text-break">Penerima: ' + esc(n.penerima) + '</div>' +
      (n.respon ? '<details class="meta mt-1"><summary>Respons gateway</summary><code class="d-block text-break">' + esc(n.respon) + '</code></details>' : '') + '</div>').join('') :
      kosong('bi-bell-slash', 'Belum ada notifikasi terkirim.'));
}

// ════════════════════════════════════════════════════════
// 15. HALAMAN: PENGATURAN (ADMIN)
// ════════════════════════════════════════════════════════
const FORM_CFG = [
  { grup: 'Jam Shift & Aturan Batas Ambil (WIT)', ikon: 'bi-clock', field: [
    ['jamShiftPagi', 'Pergantian ke Shift Pagi', 'time'], ['jamShiftSiang', 'Pergantian ke Shift Siang', 'time'], ['jamShiftMalam', 'Pergantian ke Shift Malam', 'time'],
    ['jamPulangKantor', 'Jam pulang kantor (Non-Regu & Magang)', 'time'], ['menitPeringatan', 'Peringatan pertama (menit sebelum batas)', 'number'],
    ['toleransiDatangMenit', 'Toleransi datang lebih awal (menit)', 'number'], ['maksJamIzin', 'Durasi maksimal izin bawa HP (jam)', 'number']] },
  { grup: 'Penerima Peringatan Tambahan', ikon: 'bi-bell', field: [
    ['waPosP2U', 'No. WA HP dinas Pos P2U', 'tel'], ['emailTambahan', 'Email penerima tambahan (pisahkan koma)', 'text']] },
  { grup: 'Identitas Instansi & Laporan', ikon: 'bi-building', field: [
    ['appName', 'Nama aplikasi', 'text'], ['instansi', 'Nama instansi', 'text'], ['alamatInstansi', 'Alamat (kop laporan)', 'text'],
    ['appUrl', 'URL Web App / halaman Blogger (dipakai di pesan WA)', 'url'], ['laporanHarianOtomatis', 'Kirim laporan harian PDF otomatis 08.15 WIT', 'select'],
    ['namaKaKPLP', 'Nama Ka. KPLP (penanda tangan)', 'text'], ['nipKaKPLP', 'NIP Ka. KPLP', 'text'],
    ['namaKasiKamtib', 'Nama Kasi Adm. Kamtib (penanda tangan)', 'text'], ['nipKasiKamtib', 'NIP Kasi Adm. Kamtib', 'text']] }
];
const SLOT_LOGO = [['logoKemenimipas', 'Kementerian Imigrasi & Pemasyarakatan'], ['logoPemasyarakatan', 'Pemasyarakatan'], ['logoLapas', 'Lapas Nabire (LABIRE)']];
const TRIGGER_WAJIB = [['pekerjaOtomatis', 'Pekerja otomatis tiap 1 menit (antrean WA/email, peringatan 5 menit, sinkron CRM)'], ['kirimLaporanHarianOtomatis', 'Laporan harian 08.15'], ['backupMingguan', 'Backup mingguan (Minggu 23.00)']];

HALAMAN.pengaturan = async (c, o, seq) => {
  await swr('getPengaturan', 'getPengaturan', [], d => { if (!basi(seq)) pertahankanForm(c, () => renderPengaturan(c, d)); }, { paksa: !!o.paksa });
};
function renderPengaturan(c, d) {
  {
  AppState.cache.pengaturan = d;
  const fieldHtml = (f) => {
    const k = f[0], v = d.nilai[k] || '', ket = d.keterangan[k] || '';
    let input;
    if (f[2] === 'select') input = '<select class="form-select" id="cfg_' + k + '">' + opsi(['Ya', 'Tidak'], v) + '</select>';
    else input = '<input class="form-control' + (f[2] === 'tel' ? ' mono' : '') + '" id="cfg_' + k + '" type="' + (f[2] === 'tel' ? 'text' : f[2]) + '" value="' + esc(v) + '"' +
      (f[2] === 'number' ? ' min="1" inputmode="numeric"' : '') + (f[2] === 'tel' ? ' inputmode="tel" placeholder="6281234567890"' : '') + '>';
    return '<div class="col-md-6"><label class="form-label" for="cfg_' + k + '">' + esc(f[1]) + '</label>' + input + (ket && ket !== f[1] ? '<div class="form-text">' + esc(ket) + '</div>' : '') + '</div>';
  };
  const trig = TRIGGER_WAJIB.map(t => '<li class="d-flex justify-content-between align-items-center py-1"><span>' + t[1] + '</span>' + (d.triggers.indexOf(t[0]) >= 0 ? '<span class="bs bs-green">Aktif</span>' : '<span class="bs bs-red">Belum</span>') + '</li>').join('');
  c.innerHTML = kepala('Pengaturan Sistem', 'Jam shift, penerima peringatan, identitas instansi, logo kop, dan otomasi.',
    '<button type="button" class="btn btn-green btn-sm" data-act="simpanPengaturan"><i class="bi bi-save"></i> Simpan pengaturan</button>') +
    '<div class="row g-3">' +
    '<div class="col-xl-8">' +
    FORM_CFG.map(g => '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi ' + g.ikon + '" aria-hidden="true"></i> ' + esc(g.grup) + '</h6></div><div class="cardx-body row g-3">' + g.field.map(fieldHtml).join('') + '</div></section>').join('') +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-images" aria-hidden="true"></i> Logo Kop &amp; Header</h6></div><div class="cardx-body"><div class="row g-3">' +
    SLOT_LOGO.map(s => '<div class="col-sm-4"><div class="logo-slot"><div id="logoPrev_' + s[0] + '">' + (d.logos[s[0]] ? '<img src="' + esc(d.logos[s[0]]) + '" alt="Logo ' + esc(s[1]) + '">' : '<span class="logo-placeholder" style="background:var(--bg-muted);color:var(--text-secondary);border-color:var(--border-color)"><i class="bi bi-image"></i></span>') + '</div>' +
      '<div class="small fw-semibold mt-2">' + esc(s[1]) + '</div>' +
      '<button type="button" class="btn btn-sm btn-soft mt-2" data-act="pilihLogo" data-slot="' + s[0] + '"><i class="bi bi-upload"></i> Unggah</button>' +
      '<input type="file" accept="image/png,image/jpeg,image/webp" id="fileLogo_' + s[0] + '" data-chg="logo" data-slot="' + s[0] + '" hidden></div></div>').join('') +
    '</div><div class="form-text mt-2">PNG transparan disarankan. Otomatis diperkecil (≈200 px) dan dipakai di layar login, header, label QR &amp; kop laporan PDF.</div></div></section>' +
    '<div class="d-grid d-md-flex justify-content-md-end mb-3"><button type="button" class="btn btn-green px-4" data-act="simpanPengaturan"><i class="bi bi-save"></i> Simpan pengaturan</button></div>' +
    '</div>' +
    '<div class="col-xl-4">' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-whatsapp" style="color:var(--green)" aria-hidden="true"></i> WhatsApp, Email &amp; CRM</h6>' + (d.fonnteTerisi ? '<span class="bs bs-green">Token terpasang</span>' : '<span class="bs bs-red">Token belum diatur</span>') + '</div><div class="cardx-body">' +
    '<p class="small mb-3">Token Fonnte, saklar WA/Email per kejadian, uji kirim, blast WA per batch, dan antrean pengiriman kini dikelola di menu <b>WhatsApp &amp; Notifikasi</b>. Data kontak (nama · email · WA) ada di <b>CRM Kontak</b>.</p>' +
    '<div class="d-grid gap-2"><button type="button" class="btn btn-green btn-sm" data-nav="notifikasi"><i class="bi bi-whatsapp"></i> Buka WhatsApp &amp; Notifikasi</button>' +
    '<button type="button" class="btn btn-soft btn-sm" data-nav="crm"><i class="bi bi-person-lines-fill"></i> Buka CRM Kontak</button></div>' +
    '<div class="form-text mt-2">Kuota email harian tersisa: ' + esc(d.kuotaEmail) + '</div></div></section>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-robot" aria-hidden="true"></i> Otomasi (Trigger)</h6></div><div class="cardx-body"><ul class="list-unstyled small mb-3">' + trig + '</ul>' +
    '<div class="d-grid gap-2"><button type="button" class="btn btn-gold btn-sm" data-act="pasangTrigger"><i class="bi bi-lightning"></i> Pasang / perbarui trigger</button>' +
    '<button type="button" class="btn btn-soft btn-sm" data-act="cekSekarang"><i class="bi bi-play-circle"></i> Jalankan pemeriksaan peringatan sekarang</button></div></div></section>' +
    '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-database" aria-hidden="true"></i> Data</h6></div><div class="cardx-body d-grid gap-2">' +
    '<a class="btn btn-soft btn-sm" href="' + esc(d.spreadsheetUrl) + '" target="_blank" rel="noopener"><i class="bi bi-table"></i> Buka Spreadsheet DB_SIPANTAU_HP</a>' +
    (d.folderUrl ? '<a class="btn btn-soft btn-sm" href="' + esc(d.folderUrl) + '" target="_blank" rel="noopener"><i class="bi bi-folder2-open"></i> Buka Folder Drive SIPANTAU-HP</a>' : '') +
    '<button type="button" class="btn btn-soft btn-sm" data-nav="migrasi"><i class="bi bi-database-gear"></i> Migrasi data lama &amp; Backup</button>' +
    '<div class="form-text">Jangan mengubah sheet Audit_Log secara manual — rantai hash akan putus dan terdeteksi.</div></div></section>' +
    '</div></div>';
  }
}
AKSI.simpanPengaturan = async (el) => {
  const data = {};
  FORM_CFG.forEach(g => g.field.forEach(f => { const i = $('#cfg_' + f[0]); if (i) data[f[0]] = i.value.trim(); }));
  await denganTombol(el, async () => {
    try {
      const r = await api('simpanPengaturan', data);
      toast('Tersimpan', r.message, 'success');
      try { const i = await api('getInfoAplikasi'); AppState.info = i.data; renderInfo(); } catch (e) { /* abaikan */ }
    } catch (e) { tanganiGalat(e); }
  });
};
AKSI.simpanFonnte = async (el) => {
  const t = $('#fonnteToken').value.trim();
  if (!t) { $('#fonnteToken').focus(); toast('Token kosong', 'Tempel token Fonnte terlebih dahulu.', 'warning'); return; }
  await denganTombol(el, async () => { try { const r = await api('simpanTokenFonnte', t); toast('Tersimpan', r.message, 'success'); navigateTo('pengaturan', { paksa: true }); } catch (e) { tanganiGalat(e); } });
};
AKSI.hapusFonnte = async () => {
  const ok = await konfirmasi({ judul: 'Hapus token Fonnte', pesan: 'Peringatan WhatsApp akan berhenti (hanya email). Lanjutkan?', okTeks: 'Hapus token', okKelas: 'btn-red' });
  if (!ok) return;
  try { const r = await api('simpanTokenFonnte', ''); toast('Dihapus', r.message, 'success'); navigateTo('pengaturan', { paksa: true }); } catch (e) { tanganiGalat(e); }
};
AKSI.ujiWA = async (el) => {
  const n = $('#ujiNomor').value.trim();
  if (!n) { $('#ujiNomor').focus(); return; }
  await denganTombol(el, async () => { try { const r = await api('ujiWA', n); toast('WA terkirim', r.message, 'success'); } catch (e) { tanganiGalat(e, 'Uji WA gagal'); } });
};
AKSI.ujiEmail = async (el) => {
  const m = $('#ujiEmail').value.trim();
  if (!m) { $('#ujiEmail').focus(); return; }
  await denganTombol(el, async () => { try { const r = await api('ujiEmail', m); toast('Email terkirim', r.message, 'success'); } catch (e) { tanganiGalat(e, 'Uji email gagal'); } });
};
AKSI.pasangTrigger = async (el) => {
  await denganTombol(el, async () => { try { const r = await api('pasangTrigger'); toast('Trigger aktif', r.message, 'success'); navigateTo('pengaturan', { paksa: true }); } catch (e) { tanganiGalat(e); } });
};
AKSI.cekSekarang = async (el) => {
  await denganTombol(el, async () => { try { const r = await api('jalankanCekSekarang'); toast('Selesai', r.message, 'success'); } catch (e) { tanganiGalat(e); } });
};
AKSI.pilihLogo = (el) => { const i = $('#fileLogo_' + el.dataset.slot); if (i) { i.value = ''; i.click(); } };
UBAH.logo = async (el) => {
  const f = el.files && el.files[0], slot = el.dataset.slot;
  if (!f) return;
  try {
    let d = await perkecilGambar(f, 220, 'image/png', 1, 65 * 1024);
    if (ukuranDataUrl(d) > 68 * 1024) d = await perkecilGambar(f, 200, 'image/webp', 0.9, 65 * 1024);
    if (ukuranDataUrl(d) > 68 * 1024) d = await perkecilGambar(f, 200, 'image/jpeg', 0.85, 65 * 1024);
    const r = await api('unggahLogo', slot, d);
    $('#logoPrev_' + slot).innerHTML = '<img src="' + d + '" alt="Logo">';
    toast('Logo tersimpan', r.message, 'success');
    try { const i = await api('getInfoAplikasi'); AppState.info = i.data; renderInfo(); } catch (e) { /* abaikan */ }
  } catch (e) { tanganiGalat(e, 'Gagal unggah logo'); }
};

// ════════════════════════════════════════════════════════
// 16. HALAMAN: HP SAYA (SEMUA PERAN)
// ════════════════════════════════════════════════════════
HALAMAN.hpSaya = async (c, o, seq) => {
  if (!window.QRCode) { const c0 = ambilCache('getHpSaya'); try { await (c0 ? Promise.race([muatPustaka('qr'), jeda(1500)]) : muatPustaka('qr')); } catch (e) { /* QR ditampilkan setelah pustaka siap */ } }
  await swr('getHpSaya', 'getHpSaya', [], d => { if (!basi(seq)) renderHpSaya(c, d, seq); }, { paksa: !!o.paksa });
  if (!window.QRCode) muatPustaka('qr').then(() => { if (!basi(seq) && AppState.cache.hpSaya) renderHpSaya(c, AppState.cache.hpSaya, seq); }).catch(() => {});
};
function renderHpSaya(c, d, seq) {
  {
  const p = d.profil;
  AppState.cache.hpSaya = d;
  let qr = '';
  try { qr = buatQrDataUrl(d.kodeKartu, 360); } catch (e) { qr = ''; }
  AppState.cache.qrKartu = qr;
  const now = Date.now();
  const hpHtml = d.hp.length ? d.hp.map(h => {
    const telat = h.batas && new Date(h.batas).getTime() < now && h.status !== 'DI_LUAR';
    return '<div class="list-item"><div class="thumb-sm" ' + (h.punyaFoto ? 'data-foto-hp="' + esc(h.id) + '" data-kecil="1"' : '') + ' role="img" aria-label="Foto HP"><i class="bi bi-phone" aria-hidden="true"></i></div>' +
      '<div class="grow"><div class="d-flex gap-2 align-items-center flex-wrap"><span class="tag-loker ' + (telat ? 'red' : '') + '">' + esc(h.id) + '</span><b class="truncate">' + esc(h.merek) + '</b></div>' +
      '<div class="cell-sub">' + esc(h.warna) + ' • <span class="imei-chip">****' + esc(h.imei4) + '</span></div>' +
      (h.status !== 'DI_LUAR' && h.waktuTitip ? '<div class="cell-sub mt-1" style="' + (telat ? 'color:var(--red);font-weight:700' : '') + '">' + (h.status === 'DIBAWA_BERIZIN' ? 'Masuk berizin ' : 'Dititip ') + fmt(h.waktuTitip, 'tglJam') + ' • batas ' + fmt(h.batas, 'tglJam') + ' WIT' + (telat ? ' — LEWAT BATAS, segera ambil!' : '') + '</div>' : '') +
      '</div>' + badge(h.status) + '</div>';
  }).join('') : '<div class="notice mb-0"><i class="bi bi-info-circle" aria-hidden="true"></i><div class="small">Belum ada HP terdaftar atas nama Anda. Hubungi Admin Kamtib/KPLP untuk pendaftaran HP &amp; pemasangan label QR.</div></div>';
  c.innerHTML = kepala('HP Saya', 'Status HP Anda, riwayat titip/ambil, dan kartu QR petugas.',
    p.boleh ? '<button type="button" class="btn btn-gold btn-sm" data-nav="izin"><i class="bi bi-file-earmark-plus"></i> Ajukan izin bawa HP</button>' : '') +
    '<div class="row g-3">' +
    '<div class="col-lg-4 d-flex flex-column gap-3">' +
    '<section class="cardx"><div class="cardx-body d-flex gap-3 align-items-center"><span class="avatar" style="width:52px;height:52px;font-size:1rem">' + esc(inisial(p.nama)) + '</span>' +
    '<div class="min-w-0"><div class="fw-bold">' + esc(p.nama) + '</div><div class="cell-sub mono">' + esc(p.nip) + '</div><div class="cell-sub">' + esc(p.jabatan || '-') + ' • ' + esc(p.regu) + '</div><div class="mt-1">' + badgePeran(p.peran) + '</div></div></div></section>' +
    '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-person-vcard" aria-hidden="true"></i> Kartu QR Petugas</h6></div><div class="cardx-body">' +
    '<div class="qr-card"><div class="head"><span>LAPAS KELAS IIB NABIRE</span><span>KARTU PETUGAS</span></div><div class="qr">' + (qr ? '<img src="' + qr + '" alt="QR kartu petugas ' + esc(p.nama) + '">' : '<div class="small text-center py-4">QR gagal dibuat. Muat ulang halaman.</div>') + '</div>' +
    '<div class="nm">' + esc(p.nama) + '</div><div class="nip">' + esc(p.nip) + '</div></div>' +
    '<p class="small text-secondary-x mt-2 mb-2">Cadangan bila stiker HP rusak: tunjukkan kartu ini ke P2U untuk menampilkan semua HP Anda. Jangan bagikan ke orang lain.</p>' +
    '<button type="button" class="btn btn-soft w-100" data-act="unduhKartu"><i class="bi bi-download"></i> Simpan gambar kartu</button></div></section>' +
    '</div>' +
    '<div class="col-lg-8 d-flex flex-column gap-3">' +
    '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-phone" aria-hidden="true"></i> HP terdaftar</h6><span class="bs bs-navy">' + d.hp.length + '</span></div><div class="cardx-body py-1" id="hpSayaList">' + hpHtml + '</div></section>' +
    '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-clock-history" aria-hidden="true"></i> Riwayat terakhir</h6></div>' +
    (d.riwayat.length ? '<div class="table-wrap"><table class="tablex"><thead><tr><th>HP</th><th>Titip</th><th>Ambil</th><th>Durasi</th><th>Status</th></tr></thead><tbody>' +
      d.riwayat.map(x => '<tr><td class="mono">' + esc(x.idHp) + (x.jenis === 'BERIZIN' ? '<div class="cell-sub">berizin</div>' : '') + '</td><td class="mono">' + fmt(x.waktuTitip, 'tglJam') + '</td><td class="mono">' + (x.waktuAmbil ? fmt(x.waktuAmbil, 'tglJam') : '—') + '</td>' +
        '<td class="mono">' + (x.durasi !== '' && x.durasi !== null ? durasi(x.durasi) : '-') + '</td><td>' + badge(x.status) + '</td></tr>').join('') + '</tbody></table></div>' :
      kosong('bi-clock', 'Belum ada riwayat titip/ambil.')) + '</section>' +
    '</div></div>';
  muatFotoLazy($('#hpSayaList'));
  }
}
AKSI.unduhKartu = async () => {
  const d = AppState.cache.hpSaya;
  if (!d || !AppState.cache.qrKartu) { toast('Kartu', 'QR kartu belum tersedia. Muat ulang halaman.', 'warning'); return; }
  const cv = document.createElement('canvas');
  cv.width = 640; cv.height = 860;
  const x = cv.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, 640, 860);
  x.fillStyle = '#13254A'; x.fillRect(0, 0, 640, 120);
  x.fillStyle = '#E5B219'; x.fillRect(0, 120, 640, 8);
  x.textAlign = 'center';
  x.fillStyle = '#E5B219'; x.font = 'bold 20px Inter, Arial, sans-serif'; x.fillText('KARTU PETUGAS • SIPANTAU-HP', 320, 52);
  x.fillStyle = '#ffffff'; x.font = 'bold 26px Poppins, Arial, sans-serif'; x.fillText('LAPAS KELAS IIB NABIRE', 320, 92);
  const img = await muatGambar(AppState.cache.qrKartu);
  x.drawImage(img, 120, 160, 400, 400);
  x.fillStyle = '#111111'; x.font = 'bold 30px Inter, Arial, sans-serif'; x.fillText(d.profil.nama.slice(0, 32), 320, 620);
  x.font = '24px "JetBrains Mono", monospace'; x.fillStyle = '#444444'; x.fillText(d.profil.nip, 320, 660);
  x.font = '22px Inter, Arial, sans-serif'; x.fillText((d.profil.jabatan || '') + ' • ' + d.profil.regu, 320, 700);
  x.fillStyle = '#C62828'; x.font = 'bold 18px Inter, Arial, sans-serif'; x.fillText('Tunjukkan di Pos P2U Pintu 2 • Jangan dipinjamkan', 320, 800);
  cv.toBlob(b => unduhBlob(b, 'Kartu_Petugas_' + d.profil.nip + '.png'), 'image/png');
};

/** Muat foto HP secara bertahap untuk elemen ber-atribut data-foto-hp */
async function muatFotoLazy(root) {
  if (!root) return;
  for (const el of $$('[data-foto-hp]', root)) {
    const id = el.getAttribute('data-foto-hp');
    try {
      const r = await api('getFotoHP', id);
      if (!r.data.foto || !el.isConnected) continue;
      const img = document.createElement('img');
      img.src = r.data.foto;
      img.alt = 'Foto ' + id;
      img.className = el.dataset.kecil ? 'thumb-sm' : 'hp-photo';
      img.setAttribute('data-act', 'zoomFotoBebas');
      img.setAttribute('role', 'button');
      img.setAttribute('tabindex', '0');
      el.replaceWith(img);
    } catch (e) { /* abaikan */ }
  }
}
AKSI.zoomFotoBebas = (el) => zoomGambar(el.getAttribute('src'), el.getAttribute('alt'));

// ════════════════════════════════════════════════════════
// 17. PENDENGAR GLOBAL (event delegation) & INISIALISASI
// ════════════════════════════════════════════════════════
function pasangPendengar() {
  $('#formLogin').addEventListener('submit', onLogin);
  $('#formGantiSandi').addEventListener('submit', onGantiSandi);

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { e.preventDefault(); navigateTo(nav.dataset.nav); return; }
    const tp = e.target.closest('[data-toggle-pass]');
    if (tp) {
      const i = document.getElementById(tp.dataset.togglePass);
      if (i) { const lihat = i.type === 'password'; i.type = lihat ? 'text' : 'password'; tp.innerHTML = '<i class="bi ' + (lihat ? 'bi-eye-slash' : 'bi-eye') + '"></i>'; tp.setAttribute('aria-label', lihat ? 'Sembunyikan' : 'Tampilkan'); }
      return;
    }
    const a = e.target.closest('[data-act]');
    if (a && AKSI[a.dataset.act] && !a.disabled) {
      if (a.tagName === 'A' && a.getAttribute('href') === '#') e.preventDefault();
      AKSI[a.dataset.act](a, e);
    }
  });
  // Enter / Spasi pada elemen non-tombol yang dapat diklik (baris tabel, foto)
  document.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-act], img[data-act]')) { e.preventDefault(); e.target.click(); }
  });
  document.addEventListener('change', e => { const el = e.target; if (el.dataset && el.dataset.chg && UBAH[el.dataset.chg]) UBAH[el.dataset.chg](el, e); });
  document.addEventListener('input', e => { const el = e.target; if (el.dataset && el.dataset.inp && KETIK[el.dataset.inp]) KETIK[el.dataset.inp](el, e); });
  document.addEventListener('submit', e => {
    const f = e.target;
    if (f.dataset && f.dataset.submit && KIRIM[f.dataset.submit]) { e.preventDefault(); KIRIM[f.dataset.submit](f, e); }
  });

  // Pintasan keyboard halaman scan (F1/F2/F3/Esc) & tutup sidebar
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSidebar();
    if (AppState.page !== 'scan' || document.querySelector('.modal.show')) return;
    const klik = sel => { const b = $(sel); if (b && !b.disabled) { e.preventDefault(); b.click(); } };
    if (e.key === 'F1') klik('[data-aksi="TITIP"]');
    else if (e.key === 'F2') klik('[data-aksi="AMBIL"]');
    else if (e.key === 'F3') klik('[data-aksi="BERIZIN_MASUK"], [data-aksi="BERIZIN_KELUAR"]');
    else if (e.key === 'Escape' && AppState.hasilScan) { e.preventDefault(); siapScanBerikut(); }
  });

  // Hemat baterai: kamera dimatikan saat aplikasi di latar belakang, dinyalakan lagi saat kembali
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { AppState.tersembunyiSejak = Date.now(); if (AppState.scannerOn) { stopKamera(); AppState.kameraTadi = true; } return; }
    if (AppState.kameraTadi && AppState.page === 'scan') { AppState.kameraTadi = false; mulaiKamera(); }
    // Kembali dari latar belakang > 2 menit: bangunkan server & segarkan data layar aktif
    if (AppState.tersembunyiSejak && Date.now() - AppState.tersembunyiSejak > 120000) {
      warmUp();
      if (AppState.user && SEGARKAN[AppState.page] && !document.querySelector('.modal.show')) SEGARKAN[AppState.page]();
    }
    AppState.tersembunyiSejak = 0;
  });
  // Tombol Kembali / Maju browser & HP (router hash)
  window.addEventListener('popstate', () => {
    if (!AppState.user) return;
    const pg = halamanDariHash();
    const modal = document.querySelector('.modal.show');
    if (modal) { const i = bootstrap.Modal.getInstance(modal); if (i) i.hide(); }
    if ($('#sidebar').classList.contains('show')) closeSidebar();
    if (pg && pg !== AppState.page) navigateTo(pg, { dariRiwayat: true });
  });
  window.addEventListener('online', () => { if (AppState.user && SEGARKAN[AppState.page]) SEGARKAN[AppState.page](); });

  // Bersihkan URL blob pratinjau saat modal ditutup
  $('#modalPreview').addEventListener('hidden.bs.modal', () => {
    const a = $('#previewUnduh');
    if (a.href && a.href.indexOf('blob:') === 0) setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    a.removeAttribute('href');
    $('#previewIsi').innerHTML = '';
  });
  $('#modalUmum').addEventListener('hidden.bs.modal', () => { $('#modalUmumBody').innerHTML = ''; AppState.fotoBaru = ''; });

  document.addEventListener('pointerdown', siapkanAudio, { once: true });
}

function jalankanJam() {
  const tick = () => {
    const el = $('#witClock'); if (el) el.textContent = fmt(new Date(), 'jamDetik');
    const sh = $('#shiftNow'); if (sh) sh.textContent = hitungShift();
  };
  tick();
  setInterval(tick, 1000);
}
function hitungShift() {
  const j = (AppState.info && AppState.info.jamShift) || { pagi: '08:00', siang: '13:00', malam: '20:00' };
  const p = bagianWIT(new Date());
  const now = Number(p.hour) * 60 + Number(p.minute);
  const m = s => { const a = String(s || '00:00').split(':').map(Number); return a[0] * 60 + (a[1] || 0); };
  if (now >= m(j.pagi) && now < m(j.siang)) return 'Pagi ' + j.pagi + '–' + j.siang;
  if (now >= m(j.siang) && now < m(j.malam)) return 'Siang ' + j.siang + '–' + j.malam;
  return 'Malam ' + j.malam + '–' + j.pagi;
}

async function init() {
  terapkanTema(ambilLokal('theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  pasangPendengar();
  jalankanJam();
  warmUp();
  if (!URL_SIAP) {
    AppState.info = { logos: {} };
    renderInfo();
    const body = $('#screenLogin .auth-body');
    if (body) body.insertAdjacentHTML('afterbegin', '<div class="notice" style="background:var(--red-soft);border-left-color:var(--red)" role="alert"><i class="bi bi-plug" style="color:var(--red)" aria-hidden="true"></i>' +
      '<div class="small"><b>Backend belum terhubung.</b> Admin: isi <code>GAS_URL</code> di file <code>js/config.js</code> dengan URL Web App Google Apps Script (berakhiran <code>/exec</code>), lalu push ulang ke GitHub.</div></div>');
    const b = $('#formLogin button[type="submit"]'); if (b) b.disabled = true;
    tampilLayar('login');
    sembunyikanLoading();
    return;
  }
  // 1) Info aplikasi: dari cache perangkat seketika, segarkan di latar
  const infoLama = Store.get('info', null);
  AppState.info = (infoLama && infoLama.data) || { logos: {} };
  renderInfo();
  const segarkanInfo = apiOpsi({ diam: true }, 'getInfoAplikasi').then(r => {
    Store.set('info', { t: Date.now(), data: r.data });
    AppState.info = r.data; renderInfo();
  }).catch(e => { if (!infoLama) toast('Koneksi', e.message, 'warning'); });

  // 2) Sesi tersimpan → shell + data cache tampil SEKETIKA, token diverifikasi di latar
  const t = ambilLokal(KUNCI_TOKEN);
  const userLama = Store.get('userTerakhir', null);
  if (t && userLama && userLama.token === t && userLama.user && !userLama.wajibGanti) {
    AppState.token = t;
    masukAplikasi(userLama.user);
    sembunyikanLoading();
    try {
      const r = await api('cekToken');
      ingatUser(r.data);
      AppState.user = Object.assign(AppState.user || {}, r.data.user);
      benihBoot(r.data.boot);
      if (r.data.wajibGanti) tampilLayar('gantiSandi');
    } catch (e) { if (e.code !== 'AUTH') { /* jaringan: tetap pakai sesi lokal, api berikutnya mencoba lagi */ } }
    return;
  }
  if (!infoLama) await segarkanInfo;
  if (t) {
    AppState.token = t;
    try {
      const r = await api('cekToken');
      AppState.user = r.data.user;
      ingatUser(r.data);
      if (r.data.wajibGanti) tampilLayar('gantiSandi'); else masukAplikasi(r.data.user, r.data.boot);
    } catch (e) {
      AppState.token = null; AppState.user = null;
      if (e.code === 'AUTH' || e.code === 'GANTI_SANDI') simpanLokal(KUNCI_TOKEN, null);
      tampilLayar('login');
      if (e.code === 'JARINGAN') toast('Koneksi', e.message, 'warning');
    }
  } else {
    tampilLayar('login');
  }
  sembunyikanLoading();
}

/** Simpan profil sesi terakhir (tanpa sandi) agar pembukaan berikutnya langsung tampil. */
function ingatUser(data) {
  if (!data || !data.user) return;
  Store.set('userTerakhir', { token: AppState.token, user: data.user, wajibGanti: !!data.wajibGanti });
}

/** Warm-up: membangunkan instance GAS (cold start 1–4 dtk) sebelum pengguna mengklik. */
function warmUp() {
  if (!URL_SIAP) return;
  AppState.warmAt = Date.now();
  fetch(GAS_URL + '?ping=1', { method: 'GET', mode: 'no-cors', cache: 'no-store', redirect: 'follow' }).catch(() => {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
