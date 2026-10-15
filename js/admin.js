'use strict';
/* ============================================================
   SIPANTAU-HP — Modul Admin (dimuat otomatis hanya saat dibutuhkan)
   1. WhatsApp & Notifikasi : blast WA per batch, antrean kirim, konfigurasi Fonnte & matriks event
   2. CRM Kontak             : nama · email · WhatsApp seluruh petugas + kontak manual
   3. Migrasi & Backup       : import data app lama (dry-run, idempoten, delta) + cadangan & pemulihan
   Memakai utilitas global dari js/app.js (api, swr, esc, kepala, kpi, toast, AKSI, HALAMAN, dst.)
   ============================================================ */
window.SIPANTAU_ADMIN = true;

const ADM = {
  tabNotif: 'blast', aud: null, preset: null, cfg: null, qf: { status: '', kanal: '', blastId: '' },
  crmF: { cari: '', segmen: '', statusWA: '', tag: '', masalah: '', optOut: '', halaman: 1, per: 50 },
  crmPilih: new Map(), crmData: null, deteksiJalan: false
};
const SEGMEN_CRM = ['Pimpinan', 'Admin', 'P2U', 'Petugas', 'BKO', 'Magang', 'Manual'];
const SHEET_IMPORT = [
  ['Pengaturan', 'Pengaturan', true, 'Hanya nilai yang masih bawaan di app ini'],
  ['Petugas', 'Data petugas', true, 'Kunci: NIP (0 di depan dijaga)'],
  ['HP', 'Data HP', true, 'Kunci: ID HP; status terkini selalu ikut'],
  ['Izin_Bawa_HP', 'Izin bawa HP', true, 'Hanya memperbarui izin yang masih MENUNGGU'],
  ['Log_Titip', 'Log titip/ambil', true, 'Diurutkan ulang menurut waktu titip'],
  ['CRM_Kontak', 'Kontak CRM manual', false, 'Kontak dari petugas dibuat ulang otomatis'],
  ['Audit_Log', 'Log audit lama', false, 'Diarsipkan ke sheet Arsip_Audit_Lama']
];
const STATUS_ANTRE = { Antri: ['Antre', 'bs-gold'], Terkirim: ['Terkirim', 'bs-green'], Gagal: ['Gagal', 'bs-red'], Batal: ['Batal', 'bs-gray'],
  Berjalan: ['Berjalan', 'bs-gold'], Selesai: ['Selesai', 'bs-green'], Dihentikan: ['Dihentikan', 'bs-gray'] };
const VAR_BLAST = ['nama', 'nip', 'regu', 'jabatan', 'institusi', 'link'];

function badgeA(st) { const x = STATUS_ANTRE[st] || [st || '-', 'bs-gray']; return '<span class="bs ' + x[1] + '">' + esc(x[0]) + '</span>'; }
function badgeWA(st, valid) {
  if (st === 'Terdaftar') return '<span class="bs bs-green" title="Nomor terdaftar di WhatsApp"><i class="bi bi-whatsapp"></i> WA</span>';
  if (st === 'Tidak Terdaftar') return '<span class="bs bs-red" title="Nomor tidak terdaftar di WhatsApp">Bukan WA</span>';
  return valid === false ? '<span class="bs bs-gray">Tidak valid</span>' : '<span class="bs bs-gray" title="Belum dicek ke WhatsApp">Belum dicek</span>';
}
function adminSaja() { return AppState.user && AppState.user.peran === 'ADMIN'; }
function waHtml(t) { return esc(t).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/_([^_\n]+)_/g, '<i>$1</i>').replace(/\n/g, '<br>'); }
function isiVar(tpl, v) { return String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (v[k] == null ? '' : String(v[k]))); }
function saklar(id, label, on, sub) {
  return '<div class="form-check form-switch d-flex align-items-start gap-2 py-1"><input class="form-check-input mt-1" type="checkbox" role="switch" id="' + id + '"' + (on ? ' checked' : '') + '>' +
    '<label class="form-check-label" for="' + id + '"><b class="small">' + label + '</b>' + (sub ? '<div class="form-text mt-0">' + sub + '</div>' : '') + '</label></div>';
}
function bar(persen, warna) {
  return '<div class="progress" style="height:8px;background:var(--bg-muted)" role="progressbar" aria-valuenow="' + persen + '" aria-valuemin="0" aria-valuemax="100"><div class="progress-bar" style="width:' + persen + '%;background:' + (warna || 'var(--green)') + '"></div></div>';
}
let _tunda = 0;
function tunda(fn, ms) { clearTimeout(_tunda); _tunda = setTimeout(fn, ms || 300); }

// ════════════════════════════════════════════════════════
// A. WHATSAPP & NOTIFIKASI
// ════════════════════════════════════════════════════════
HALAMAN.notifikasi = async (c, o, seq) => {
  if (!adminSaja() && ADM.tabNotif === 'konfig') ADM.tabNotif = 'blast';
  if (o.tab) ADM.tabNotif = o.tab;
  const tabs = [['blast', '<i class="bi bi-megaphone"></i> Blast WA'], ['antrean', '<i class="bi bi-list-task"></i> Antrean kirim']];
  if (adminSaja()) tabs.push(['konfig', '<i class="bi bi-sliders"></i> Konfigurasi']);
  c.innerHTML = kepala('WhatsApp &amp; Notifikasi', 'Pesan otomatis (peringatan, izin, titip/ambil) dan blast WhatsApp dikirim lewat antrean oleh sistem tiap 1 menit — tombol tetap instan, aman dari banned.',
    '<button type="button" class="btn btn-soft btn-sm" data-act="muatUlang"><i class="bi bi-arrow-clockwise"></i> Muat ulang</button>') +
    '<div class="nav-tabs-x mb-3" role="tablist" style="width:max-content;max-width:100%">' +
    tabs.map(t => '<button type="button" role="tab" aria-selected="' + (ADM.tabNotif === t[0]) + '" class="' + (ADM.tabNotif === t[0] ? 'active' : '') + '" data-act="tabNotif" data-tab="' + t[0] + '">' + t[1] + '</button>').join('') + '</div>' +
    '<div id="notifIsi">' + memuat() + '</div>';
  await TAB_NOTIF[ADM.tabNotif](seq, false);
};
const TAB_NOTIF = {
  blast: (seq, paksa) => tabBlast(seq, paksa),
  antrean: (seq, paksa) => muatAntrean(seq, paksa),
  konfig: (seq, paksa) => muatKonfig(seq, paksa)
};
SEGARKAN.notifikasi = () => TAB_NOTIF[ADM.tabNotif](AppState.navSeq, true).catch(tanganiGalat);
AKSI.tabNotif = (el) => { ADM.tabNotif = el.dataset.tab; navigateTo('notifikasi', { dariRiwayat: true }); };

// ── A1. Blast ──
async function tabBlast(seq, paksa) {
  const box = $('#notifIsi');
  if (!box) return;
  const batchDef = (ADM.cfg && ADM.cfg.batchDefault) || 20, jedaDef = (ADM.cfg && ADM.cfg.jeda) || '5';
  box.innerHTML = '<div class="row g-3"><div class="col-xl-7">' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-people" aria-hidden="true"></i> 1. Penerima</h6></div><div class="cardx-body">' +
    '<div class="row g-2">' +
    '<div class="col-12 col-md-4"><label class="form-label" for="blSumber">Sumber</label><select class="form-select" id="blSumber" data-chg="blSumber">' +
      opsi([['crm', 'CRM Kontak (petugas)'], ['manual', 'Tempel nomor manual']].concat(ADM.preset ? [['terpilih', 'Kontak terpilih dari CRM (' + ADM.preset.length + ')']] : []), ADM.preset ? 'terpilih' : 'crm') + '</select></div>' +
    '<div class="col-6 col-md-4 bl-crm"><label class="form-label" for="blSegmen">Segmen</label><select class="form-select" id="blSegmen">' + opsi(SEGMEN_CRM, '', 'Semua segmen') + '</select></div>' +
    '<div class="col-6 col-md-4 bl-crm"><label class="form-label" for="blRegu">Regu</label><select class="form-select" id="blRegu">' + opsi(DAFTAR_REGU, '', 'Semua regu') + '</select></div>' +
    '<div class="col-6 col-md-4 bl-crm"><label class="form-label" for="blStatusWA">Status WA</label><select class="form-select" id="blStatusWA">' + opsi([['Terdaftar', 'Terdaftar WA'], ['Tidak Terdaftar', 'Tidak terdaftar'], ['belum', 'Belum dicek']], '', 'Semua') + '</select></div>' +
    '<div class="col-6 col-md-4 bl-crm"><label class="form-label" for="blTag">Tag</label><input class="form-control" id="blTag" placeholder="mis. rapat"></div>' +
    '<div class="col-12 bl-manual hidden"><label class="form-label" for="blManual">Nomor (satu per baris: <span class="mono">0812xxxx|Nama</span>)</label><textarea class="form-control mono" id="blManual" rows="4" placeholder="081234567890|Budi&#10;082198765432|Sari"></textarea></div>' +
    '</div>' +
    '<div class="d-flex flex-wrap gap-2 mt-3"><button type="button" class="btn btn-navy btn-sm" data-act="blMuat"><i class="bi bi-funnel"></i> Muat penerima</button>' +
    '<button type="button" class="btn btn-soft btn-sm" data-act="blDeteksi" id="btnDeteksi" disabled><i class="bi bi-whatsapp"></i> Deteksi nomor WA</button></div>' +
    '<div id="blRingkas" class="mt-3"></div></div></section>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-chat-text" aria-hidden="true"></i> 2. Pesan</h6><span class="small text-secondary-x" id="blHitung">0/4000</span></div><div class="cardx-body">' +
    '<label class="form-label" for="blJudul">Judul blast (internal)</label><input class="form-control mb-2" id="blJudul" maxlength="120" placeholder="mis. Pemberitahuan apel pagi">' +
    '<label class="form-label" for="blPesan">Isi pesan</label><textarea class="form-control" id="blPesan" rows="6" maxlength="4000" data-inp="blPesan" placeholder="Yth. {nama},&#10;…&#10;— {institusi}"></textarea>' +
    '<div class="d-flex flex-wrap gap-1 mt-2">' + VAR_BLAST.map(v => '<button type="button" class="btn btn-soft btn-sm py-0" data-act="blVar" data-v="' + v + '">{' + v + '}</button>').join('') + '</div>' +
    '<div class="form-text">*tebal*, _miring_. Variabel diganti otomatis per penerima.</div>' +
    '<div class="small fw-semibold mt-3 mb-1">Pratinjau</div><div class="wa-bubble" id="blPratinjau"><span class="text-secondary-x">Tulis pesan untuk melihat pratinjau…</span></div>' +
    '</div></section>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-speedometer" aria-hidden="true"></i> 3. Kecepatan kirim (anti-banned)</h6></div><div class="cardx-body row g-2">' +
    '<div class="col-6"><label class="form-label" for="blBatch">Pesan per batch</label><select class="form-select" id="blBatch">' + opsi([[10, '10 (paling aman)'], [20, '20 (disarankan)'], [50, '50 (cepat)']], batchDef) + '</select></div>' +
    '<div class="col-6"><label class="form-label" for="blJeda">Jeda antarpesan (detik)</label><input class="form-control" id="blJeda" value="' + esc(jedaDef) + '" placeholder="5 atau 3-8"></div>' +
    '<div class="col-12 form-text">Sistem mengirim 1 batch tiap menit (berjalan walau aplikasi ditutup). Gunakan rentang acak mis. <b>3-8</b> agar lebih alami.</div>' +
    '<div class="col-12 d-grid mt-2"><button type="button" class="btn btn-green" data-act="blKirim" id="btnBlast" disabled><i class="bi bi-send"></i> Buat &amp; mulai blast</button></div>' +
    '</div></section></div>' +
    '<div class="col-xl-5"><section class="cardx"><div class="cardx-head"><h6><i class="bi bi-clock-history" aria-hidden="true"></i> Riwayat blast</h6></div><div id="blDaftar">' + memuat() + '</div></section></div></div>';
  if (ADM.preset) { aturSumberBlast('terpilih'); ADM.aud = audiensDariPreset(); renderAudiens(); }
  else if (ADM.aud) renderAudiens();
  if (adminSaja() && !ADM.cfg) swr('notifConfig', 'notifConfig', [], d => { ADM.cfg = d; }).catch(() => {});
  await muatDaftarBlast(seq, paksa);
  pasangTimer(() => { if (ADM.tabNotif === 'blast' && (ADM.blastJalan || 0) > 0) muatDaftarBlast(AppState.navSeq, true).catch(() => {}); }, 20000);
}
function aturSumberBlast(v) {
  $$('.bl-crm').forEach(e => e.classList.toggle('hidden', v !== 'crm'));
  $$('.bl-manual').forEach(e => e.classList.toggle('hidden', v !== 'manual'));
}
function audiensDariPreset() {
  const rows = ADM.preset.map(k => ({ id: k.id, nama: k.nama, hp: k.wa, statusWA: k.statusWA, optOut: k.optOut, valid: k.waValid, vars: { nip: k.refId, regu: k.regu, jabatan: k.jabatan } }));
  const seen = {};
  const ringkas = { total: rows.length, valid: 0, tidakValid: 0, ganda: 0, terdaftarWA: 0, tidakTerdaftarWA: 0, optOut: 0 };
  rows.forEach(r => {
    r.ganda = r.valid && !!seen[r.hp]; if (r.valid) seen[r.hp] = true;
    if (!r.valid) ringkas.tidakValid++; else if (r.ganda) ringkas.ganda++; else ringkas.valid++;
    if (r.statusWA === 'Terdaftar') ringkas.terdaftarWA++;
    if (r.statusWA === 'Tidak Terdaftar') ringkas.tidakTerdaftarWA++;
    if (r.optOut) ringkas.optOut++;
  });
  return { rows: rows, ringkas: ringkas };
}
UBAH.blSumber = (el) => { aturSumberBlast(el.value); if (el.value === 'terpilih' && ADM.preset) { ADM.aud = audiensDariPreset(); renderAudiens(); } };
AKSI.blMuat = async (el) => {
  const sumber = $('#blSumber').value;
  if (sumber === 'terpilih') { ADM.aud = audiensDariPreset(); renderAudiens(); return; }
  const f = sumber === 'manual' ? { sumber: 'manual', teks: $('#blManual').value } :
    { sumber: 'crm', segmen: $('#blSegmen').value, regu: $('#blRegu').value, statusWA: $('#blStatusWA').value, tag: $('#blTag').value.trim() };
  if (sumber === 'manual' && !f.teks.trim()) { $('#blManual').focus(); toast('Nomor kosong', 'Tempel minimal satu nomor.', 'warning'); return; }
  ADM.preset = null;
  await denganTombol(el, async () => {
    try { const r = await api('waAudience', f); ADM.aud = r.data; renderAudiens(); } catch (e) { tanganiGalat(e); }
  });
};
function penerimaSiap() {
  if (!ADM.aud) return [];
  const hanyaWA = $('#blHanyaWA') && $('#blHanyaWA').checked;
  return ADM.aud.rows.filter(r => r.valid && !r.ganda && !r.optOut && (!hanyaWA || r.statusWA === 'Terdaftar'));
}
function renderAudiens() {
  const box = $('#blRingkas');
  if (!box || !ADM.aud) return;
  const g = ADM.aud.ringkas, rows = ADM.aud.rows;
  const belum = rows.filter(r => r.valid && !r.ganda && !r.statusWA).length;
  const hanyaWA = $('#blHanyaWA') ? $('#blHanyaWA').checked : false;
  box.innerHTML = '<div class="row g-2 mb-2">' +
    '<div class="col-6 col-md-3">' + kpi('navy', 'bi-people', 'Total', g.total, '') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('green', 'bi-check2-circle', 'Nomor valid', g.valid, g.ganda ? g.ganda + ' ganda dibuang' : '') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('green', 'bi-whatsapp', 'Terdaftar WA', g.terdaftarWA, g.tidakTerdaftarWA + ' bukan WA') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('red', 'bi-slash-circle', 'Opt-out / invalid', g.optOut + g.tidakValid, g.optOut + ' opt-out') + '</div></div>' +
    saklar('blHanyaWA', 'Kirim hanya ke nomor yang terdaftar WhatsApp', hanyaWA, belum ? belum + ' nomor belum dicek — klik "Deteksi nomor WA" untuk hasil terbaik.' : 'Semua nomor sudah dicek.') +
    '<div class="small mt-2" id="blSiap"></div>' +
    '<details class="mt-2"><summary class="small">Lihat daftar penerima (' + Math.min(rows.length, 200) + ' pertama)</summary><div class="table-wrap mt-2" style="max-height:260px"><table class="tablex"><thead><tr><th>Nama</th><th>Nomor</th><th>WA</th></tr></thead><tbody>' +
    rows.slice(0, 200).map(r => '<tr><td>' + esc(r.nama || '-') + (r.optOut ? ' <span class="bs bs-gray">opt-out</span>' : '') + (r.ganda ? ' <span class="bs bs-gray">ganda</span>' : '') + '</td><td class="mono">' + esc(r.hp || '-') + '</td><td>' + badgeWA(r.statusWA, r.valid) + '</td></tr>').join('') +
    '</tbody></table></div></details>';
  const det = $('#btnDeteksi'); if (det) { det.disabled = !belum || ADM.deteksiJalan; det.innerHTML = '<i class="bi bi-whatsapp"></i> Deteksi nomor WA' + (belum ? ' (' + belum + ')' : ''); }
  hitungSiap();
}
document.addEventListener('change', e => { if (e.target && (e.target.id === 'blHanyaWA' || e.target.id === 'blBatch')) hitungSiap(); });
function hitungSiap() {
  const n = penerimaSiap().length, el = $('#blSiap');
  if (el) el.innerHTML = '<i class="bi bi-send-check" style="color:var(--green)"></i> <b>' + n + '</b> penerima siap dikirimi' + (n ? ' • ' + Math.ceil(n / Number($('#blBatch') ? $('#blBatch').value : 20)) + ' batch ≈ ' + Math.ceil(n / Number($('#blBatch') ? $('#blBatch').value : 20)) + ' menit' : '');
  const b = $('#btnBlast'); if (b) b.disabled = !n;
  pratinjauBlast();
}
AKSI.blDeteksi = async (el) => {
  if (!ADM.aud || ADM.deteksiJalan) return;
  const nomor = [...new Set(ADM.aud.rows.filter(r => r.valid && !r.ganda && !r.statusWA).map(r => r.hp))];
  if (!nomor.length) return;
  ADM.deteksiJalan = true;
  el.disabled = true;
  let selesai = 0, terdaftar = 0;
  try {
    for (let i = 0; i < nomor.length; i += 50) {
      el.innerHTML = '<span class="spinner-inline"></span> Mengecek ' + Math.min(i + 50, nomor.length) + '/' + nomor.length;
      const r = await api('waValidate', nomor.slice(i, i + 50));
      const h = r.data.hasil || {};
      ADM.aud.rows.forEach(x => { if (h[x.hp]) x.statusWA = h[x.hp]; });
      selesai += Object.keys(h).length; terdaftar += r.data.terdaftar || 0;
      if (AppState.page !== 'notifikasi') break;
    }
    const g = ADM.aud.ringkas;
    g.terdaftarWA = ADM.aud.rows.filter(x => x.statusWA === 'Terdaftar').length;
    g.tidakTerdaftarWA = ADM.aud.rows.filter(x => x.statusWA === 'Tidak Terdaftar').length;
    toast('Deteksi selesai', selesai + ' nomor dicek: ' + terdaftar + ' terdaftar WhatsApp. Hasil juga tersimpan di data petugas & CRM.', 'success');
  } catch (e) { tanganiGalat(e, 'Deteksi WA'); }
  finally { ADM.deteksiJalan = false; renderAudiens(); }
};
AKSI.blVar = (el) => {
  const t = $('#blPesan'), v = '{' + el.dataset.v + '}';
  const a = t.selectionStart || t.value.length, b = t.selectionEnd || a;
  t.value = t.value.slice(0, a) + v + t.value.slice(b);
  t.focus(); t.setSelectionRange(a + v.length, a + v.length);
  pratinjauBlast();
};
KETIK.blPesan = () => pratinjauBlast();
function pratinjauBlast() {
  const t = $('#blPesan'), box = $('#blPratinjau');
  if (!t || !box) return;
  $('#blHitung').textContent = t.value.length + '/4000';
  if (!t.value.trim()) { box.innerHTML = '<span class="text-secondary-x">Tulis pesan untuk melihat pratinjau…</span>'; return; }
  const p = penerimaSiap()[0] || { nama: 'Budi Santoso', vars: { nip: '199001012015031001', regu: 'Regu 1', jabatan: 'Penjaga Tahanan' } };
  const info = AppState.info || {};
  const v = Object.assign({ institusi: info.instansi || 'Lapas Kelas IIB Nabire', link: (ADM.cfg && ADM.cfg.appUrl) || location.origin + location.pathname }, p.vars || {}, { nama: p.nama || 'Bapak/Ibu' });
  box.innerHTML = waHtml(isiVar(t.value, v)) + '<div class="wa-time">' + fmt(new Date(), 'jam') + ' ✓✓</div>';
}
AKSI.blKirim = async (el) => {
  const pen = penerimaSiap(), pesan = $('#blPesan').value.trim(), jedaV = $('#blJeda').value.trim() || '5', ukuran = Number($('#blBatch').value);
  if (pesan.length < 5) { $('#blPesan').focus(); toast('Pesan kosong', 'Tulis isi pesan terlebih dahulu.', 'warning'); return; }
  if (!/^\d{1,3}(-\d{1,3})?$/.test(jedaV)) { $('#blJeda').focus(); toast('Jeda tidak valid', 'Isi angka detik (mis. 5) atau rentang (mis. 3-8).', 'warning'); return; }
  if (!pen.length) return;
  const ok = await konfirmasi({ judul: 'Mulai blast WhatsApp', okTeks: 'Ya, mulai blast', okKelas: 'btn-green',
    pesan: '<b>' + pen.length + '</b> pesan akan diantrekan, dikirim <b>' + ukuran + '</b> pesan per menit dengan jeda <b>' + esc(jedaV) + '</b> detik.<br><span class="small text-secondary-x">Proses berjalan di server — aplikasi boleh ditutup. Blast dapat dihentikan kapan saja.</span>' });
  if (!ok) return;
  const sumber = $('#blSumber').value;
  const sasaran = sumber === 'manual' ? 'Nomor manual' : sumber === 'terpilih' ? 'Kontak terpilih CRM' :
    ['Segmen ' + ($('#blSegmen').value || 'semua'), $('#blRegu').value, $('#blStatusWA').value, $('#blTag').value.trim() && 'tag ' + $('#blTag').value.trim()].filter(Boolean).join(', ');
  await denganTombol(el, async () => {
    try {
      const r = await api('waBlastCreate', { judul: $('#blJudul').value.trim(), pesan: pesan, ukuranBatch: ukuran, jeda: jedaV, sasaran: sasaran,
        penerima: pen.map(p => ({ id: p.id, nama: p.nama, hp: p.hp, vars: p.vars })) });
      toast('Blast dimulai', r.message, 'success');
      ADM.aud = null; ADM.preset = null;
      $('#blPesan').value = ''; $('#blJudul').value = '';
      $('#blRingkas').innerHTML = ''; hitungSiap();
      await muatDaftarBlast(AppState.navSeq, true);
    } catch (e) { tanganiGalat(e, 'Gagal membuat blast'); }
  });
};
async function muatDaftarBlast(seq, paksa) {
  await swr('waBlastList', 'waBlastList', [], d => { if (!basi(seq)) renderDaftarBlast(d); }, { paksa: paksa });
}
function renderDaftarBlast(list) {
  const box = $('#blDaftar');
  if (!box) return;
  ADM.blastJalan = list.filter(b => b.status === 'Berjalan').length;
  box.innerHTML = list.length ? '<div class="cardx-body py-1">' + list.slice(0, 30).map(b =>
    '<div class="list-item d-block"><div class="d-flex justify-content-between gap-2 align-items-start"><div class="min-w-0"><b class="truncate d-block">' + esc(b.judul) + '</b>' +
    '<div class="cell-sub">' + fmt(b.tanggal, 'tglJam') + ' • ' + esc(b.oleh) + ' • batch ' + b.ukuran + ' / jeda ' + esc(b.jeda) + ' dtk</div>' +
    (b.sasaran ? '<div class="cell-sub truncate">' + esc(b.sasaran) + '</div>' : '') + '</div>' + badgeA(b.status) + '</div>' +
    '<div class="mt-2">' + bar(b.persen, b.gagal ? 'var(--gold)' : 'var(--green)') + '</div>' +
    '<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mt-1"><span class="small"><b>' + b.terkirim + '</b> terkirim • <b>' + b.gagal + '</b> gagal • ' + b.sisa + ' sisa / ' + b.total + '</span>' +
    '<span class="d-flex gap-1">' +
    (b.status === 'Berjalan' ? '<button type="button" class="btn btn-green btn-sm py-0" data-act="blProses" data-id="' + esc(b.id) + '"><i class="bi bi-skip-forward"></i> Kirim batch berikutnya</button>' +
      '<button type="button" class="btn btn-soft btn-sm py-0" style="color:var(--red)" data-act="blStop" data-id="' + esc(b.id) + '">Hentikan</button>' : '') +
    '<button type="button" class="btn btn-soft btn-sm py-0" data-act="blLihat" data-id="' + esc(b.id) + '" aria-label="Lihat antrean blast"><i class="bi bi-list-ul"></i></button></span></div></div>').join('') + '</div>' :
    kosong('bi-megaphone', 'Belum ada blast. Pilih penerima, tulis pesan, lalu mulai.');
}
AKSI.blProses = async (el) => {
  await denganTombol(el, async () => {
    try { const r = await api('waBlastProcess', el.dataset.id); toast('Batch diproses', r.message, 'success'); await muatDaftarBlast(AppState.navSeq, true); }
    catch (e) { tanganiGalat(e); }
  });
};
AKSI.blStop = async (el) => {
  const ok = await konfirmasi({ judul: 'Hentikan blast', pesan: 'Pesan yang belum terkirim akan dibatalkan. Lanjutkan?', okTeks: 'Hentikan', okKelas: 'btn-red' });
  if (!ok) return;
  try { const r = await api('waBlastStop', el.dataset.id); toast('Dihentikan', r.message, 'success'); await muatDaftarBlast(AppState.navSeq, true); } catch (e) { tanganiGalat(e); }
};
AKSI.blLihat = (el) => { ADM.qf = { status: '', kanal: '', blastId: el.dataset.id }; ADM.tabNotif = 'antrean'; navigateTo('notifikasi', { dariRiwayat: true }); };

// ── A2. Antrean ──
async function muatAntrean(seq, paksa) {
  const box = $('#notifIsi');
  if (!box) return;
  const f = ADM.qf;
  if (!$('#qTabel')) {
    box.innerHTML = '<div id="qKpi" class="row g-3 mb-3"></div>' +
      '<form class="cardx mb-3" data-submit="qCari"><div class="cardx-body row g-2 align-items-end">' +
      '<div class="col-6 col-md-3"><label class="form-label" for="qStatus">Status</label><select class="form-select" id="qStatus" data-chg="qCari">' + opsi([['Antri', 'Antre'], ['Terkirim', 'Terkirim'], ['Gagal', 'Gagal'], ['Batal', 'Batal']], f.status, 'Semua') + '</select></div>' +
      '<div class="col-6 col-md-3"><label class="form-label" for="qKanal">Kanal</label><select class="form-select" id="qKanal" data-chg="qCari">' + opsi([['WA', 'WhatsApp'], ['EMAIL', 'Email']], f.kanal, 'Semua') + '</select></div>' +
      '<div class="col-12 col-md-3"><label class="form-label" for="qBlast">ID Blast</label><input class="form-control mono" id="qBlast" value="' + esc(f.blastId) + '" placeholder="BLW…"></div>' +
      '<div class="col-12 col-md-3 d-flex gap-2"><button type="submit" class="btn btn-navy flex-fill"><i class="bi bi-search"></i> Tampilkan</button></div></div>' +
      '<div class="cardx-body pt-0 d-flex flex-wrap gap-2"><button type="button" class="btn btn-green btn-sm" data-act="qProses"><i class="bi bi-lightning"></i> Proses antrean sekarang</button>' +
      (adminSaja() ? '<button type="button" class="btn btn-soft btn-sm" data-act="qUlangSemua"><i class="bi bi-arrow-repeat"></i> Ulangi semua yang gagal</button>' : '') + '</div></form>' +
      '<section class="cardx" id="qTabel">' + memuat() + '</section>';
  }
  await swr('notifQueue:' + f.status + '|' + f.kanal + '|' + f.blastId, 'notifQueue', [f], d => { if (!basi(seq)) renderAntrean(d); }, { paksa: paksa, segar: 10000 });
  pasangTimer(() => { if (ADM.tabNotif === 'antrean' && $('#qTabel')) swr('notifQueue:' + ADM.qf.status + '|' + ADM.qf.kanal + '|' + ADM.qf.blastId, 'notifQueue', [ADM.qf], d => { if (ADM.tabNotif === 'antrean') renderAntrean(d); }, { paksa: true }).catch(() => {}); }, 30000);
}
function renderAntrean(d) {
  const g = d.ringkas;
  $('#qKpi').innerHTML = '<div class="col-6 col-md-3">' + kpi('', 'bi-hourglass-split', 'Antre', g.Antri || 0, 'dikirim tiap 1 menit') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('green', 'bi-check2-all', 'Terkirim', g.Terkirim || 0, '3.000 baris terakhir') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('red', 'bi-x-octagon', 'Gagal', g.Gagal || 0, 'setelah 3× percobaan') + '</div>' +
    '<div class="col-6 col-md-3">' + kpi('navy', 'bi-slash-circle', 'Dibatalkan', g.Batal || 0, '') + '</div>';
  $('#qTabel').innerHTML = d.rows.length ? '<div class="table-wrap"><table class="tablex"><thead><tr><th>Waktu</th><th>Kanal</th><th>Penerima</th><th>Kejadian / Pesan</th><th>Status</th><th></th></tr></thead><tbody>' +
    d.rows.map(r => '<tr><td class="mono">' + fmt(r.dikirim || r.dibuat, 'tglJam') + '</td><td>' + (r.kanal === 'WA' ? '<i class="bi bi-whatsapp" style="color:var(--green)"></i> WA' : '<i class="bi bi-envelope"></i> Email') + '</td>' +
      '<td><div class="cell-main">' + esc(r.nama || '-') + '</div><div class="cell-sub mono">' + esc(r.tujuan) + '</div></td>' +
      '<td style="min-width:220px"><div class="cell-main small">' + esc(r.event) + (r.blastId ? ' <span class="cell-sub mono">' + esc(r.blastId) + '</span>' : '') + '</div><div class="cell-sub">' + esc(r.pesan.slice(0, 120)) + '</div></td>' +
      '<td>' + badgeA(r.status) + (r.percobaan ? '<div class="cell-sub">' + r.percobaan + '× coba</div>' : '') + (r.respon && r.status !== 'Terkirim' ? '<div class="cell-sub">' + esc(r.respon.slice(0, 60)) + '</div>' : '') + '</td>' +
      '<td>' + (r.status === 'Gagal' && adminSaja() ? '<button type="button" class="btn btn-soft btn-sm py-0" data-act="qUlang" data-id="' + esc(r.id) + '">Ulangi</button>' : '') + '</td></tr>').join('') +
    '</tbody></table></div>' + (d.total > d.rows.length ? '<div class="p-2 small text-secondary-x border-top">Menampilkan ' + d.rows.length + ' dari ' + d.total + ' baris.</div>' : '') :
    kosong('bi-inbox', 'Tidak ada pesan pada filter ini.');
}
UBAH.qCari = () => KIRIM.qCari();
KIRIM.qCari = () => {
  ADM.qf = { status: $('#qStatus').value, kanal: $('#qKanal').value, blastId: $('#qBlast').value.trim() };
  $('#qTabel').innerHTML = memuat();
  muatAntrean(AppState.navSeq, false).catch(tanganiGalat);
};
AKSI.qProses = async (el) => {
  await denganTombol(el, async () => { try { const r = await api('notifProcessNow'); toast('Antrean diproses', r.message, 'success'); await muatAntrean(AppState.navSeq, true); } catch (e) { tanganiGalat(e); } });
};
AKSI.qUlang = async (el) => {
  try { const r = await api('notifRetry', [el.dataset.id]); toast('Diantrekan ulang', r.message, 'success'); await muatAntrean(AppState.navSeq, true); } catch (e) { tanganiGalat(e); }
};
AKSI.qUlangSemua = async (el) => {
  const ok = await konfirmasi({ judul: 'Ulangi semua yang gagal', pesan: 'Semua notifikasi berstatus Gagal akan diantrekan ulang. Lanjutkan?', okTeks: 'Ulangi' });
  if (!ok) return;
  await denganTombol(el, async () => { try { const r = await api('notifRetry', []); toast('Diantrekan ulang', r.message, 'success'); await muatAntrean(AppState.navSeq, true); } catch (e) { tanganiGalat(e); } });
};

// ── A3. Konfigurasi (ADMIN) ──
async function muatKonfig(seq, paksa) {
  await swr('notifConfig', 'notifConfig', [], d => { if (!basi(seq) && ADM.tabNotif === 'konfig') { ADM.cfg = d; pertahankanForm($('#notifIsi'), () => renderKonfig(d)); } }, { paksa: paksa });
}
function renderKonfig(d) {
  ADM.matriks = d.matriks.map(m => Object.assign({}, m));
  $('#notifIsi').innerHTML = '<div class="row g-3"><div class="col-xl-5">' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-toggles" aria-hidden="true"></i> Saklar utama</h6>' +
    (d.pekerjaAktif ? '<span class="bs bs-green">Pekerja otomatis aktif</span>' : '<span class="bs bs-red">Trigger belum dipasang</span>') + '</div><div class="cardx-body">' +
    saklar('cfWa', 'Notifikasi WhatsApp (Fonnte)', d.waAktif, d.tokenAda ? 'Token: <span class="mono">' + esc(d.tokenMask) + '</span>' : 'Isi token Fonnte di bawah terlebih dahulu.') +
    saklar('cfEmail', 'Notifikasi Email (Gmail)', d.emailAktif, 'Sisa kuota email hari ini: <b>' + esc(d.kuotaEmail) + '</b>') +
    saklar('cfDeteksi', 'Deteksi otomatis nomor WA petugas baru', d.deteksiOtomatis, 'Dicek tiap ±10 menit, maks. 50 nomor per putaran.') +
    (d.pekerjaAktif ? '' : '<div class="notice mt-2" style="background:var(--red-soft);border-left-color:var(--red)"><i class="bi bi-exclamation-triangle" style="color:var(--red)"></i><div class="small">Antrean belum diproses otomatis. Klik <b>Simpan konfigurasi</b> atau <b>Pengaturan → Pasang trigger</b>.</div></div>') +
    '</div></section>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-key" aria-hidden="true"></i> Token Fonnte</h6>' + (d.tokenAda ? '<span class="bs bs-green">Tersimpan</span>' : '<span class="bs bs-red">Belum ada</span>') + '</div><div class="cardx-body">' +
    '<ol class="small ps-3 mb-3"><li>Daftar di <a href="https://fonnte.com" target="_blank" rel="noopener">fonnte.com</a>, pilih paket.</li><li><b>Device</b> → tambah nomor WA dinas → <b>Connect</b> (pindai QR dari WhatsApp).</li><li>Salin <b>Token</b> device, tempel di bawah, lalu <b>Simpan konfigurasi</b>.</li></ol>' +
    '<label class="form-label" for="cfToken">Token baru (kosongkan bila tidak diubah)</label><div class="input-group mb-2"><input type="password" class="form-control mono" id="cfToken" autocomplete="off" placeholder="' + (d.tokenAda ? esc(d.tokenMask) : 'Tempel token di sini') + '">' +
    '<button type="button" class="btn btn-soft" data-toggle-pass="cfToken" aria-label="Tampilkan token"><i class="bi bi-eye"></i></button></div>' +
    '<div class="d-flex flex-wrap gap-2"><button type="button" class="btn btn-soft btn-sm" data-act="cfDevice"' + (d.tokenAda ? '' : ' disabled') + '><i class="bi bi-phone-vibrate"></i> Cek perangkat</button>' +
    (d.tokenAda ? '<button type="button" class="btn btn-soft btn-sm" style="color:var(--red)" data-act="cfHapusToken">Hapus token</button>' : '') + '</div>' +
    '<div id="cfDeviceInfo" class="mt-2"></div><div class="form-text">Token disimpan di Script Properties (tidak tampil di Sheet, tidak pernah dikirim utuh ke browser).</div></div></section>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-speedometer" aria-hidden="true"></i> Pengiriman</h6></div><div class="cardx-body row g-2">' +
    '<div class="col-6"><label class="form-label" for="cfBatch">Batch blast bawaan</label><select class="form-select" id="cfBatch">' + opsi([10, 20, 50], d.batchDefault) + '</select></div>' +
    '<div class="col-6"><label class="form-label" for="cfJeda">Jeda (detik)</label><input class="form-control" id="cfJeda" value="' + esc(d.jeda) + '" placeholder="5 atau 3-8"></div>' +
    '<div class="col-12"><label class="form-label" for="cfNama">Nama pengirim email</label><input class="form-control" id="cfNama" maxlength="60" value="' + esc(d.namaPengirim) + '"></div>' +
    '<div class="col-12"><label class="form-label" for="cfUrl">URL aplikasi untuk {link}</label><input class="form-control" id="cfUrl" type="url" value="' + esc(d.appUrl) + '" placeholder="https://username.github.io/sipantau-hp-web/"></div>' +
    '<div class="col-12"><button type="button" class="btn btn-soft btn-sm" data-act="cfUrlIni"><i class="bi bi-link-45deg"></i> Pakai alamat halaman ini</button></div></div></section>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-send-check" aria-hidden="true"></i> Uji kirim</h6></div><div class="cardx-body">' +
    '<label class="form-label" for="ujiNomor">WhatsApp ke nomor</label><div class="input-group mb-2"><input class="form-control mono" id="ujiNomor" inputmode="tel" placeholder="081234567890">' +
    '<button type="button" class="btn btn-green" data-act="ujiWA"><i class="bi bi-whatsapp"></i> Uji</button></div>' +
    '<label class="form-label" for="ujiEmail">Email ke</label><div class="input-group"><input type="email" class="form-control" id="ujiEmail" inputmode="email" placeholder="nama@kemenimipas.go.id">' +
    '<button type="button" class="btn btn-navy" data-act="ujiEmail"><i class="bi bi-envelope"></i> Uji</button></div></div></section>' +
    '</div><div class="col-xl-7">' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-grid-3x3" aria-hidden="true"></i> Kejadian × kanal</h6><span class="small text-secondary-x">Pilih notifikasi yang dikirim</span></div>' +
    '<div class="table-wrap"><table class="tablex"><thead><tr><th>Kejadian</th><th class="text-center">WA</th><th class="text-center">Email</th><th></th></tr></thead><tbody>' +
    ADM.matriks.map((m, i) => '<tr><td><div class="cell-main">' + esc(m.label) + '</div><div class="cell-sub">Ke: ' + esc(m.sasaran || '-') + (m.pesan !== m.pesanDefault || m.subjek !== m.subjekDefault ? ' • <span style="color:var(--gold-dark)">template diubah</span>' : '') + '</div></td>' +
      '<td class="text-center"><input class="form-check-input" type="checkbox" id="mxWa_' + i + '" aria-label="WA ' + esc(m.label) + '"' + (m.wa ? ' checked' : '') + '></td>' +
      '<td class="text-center"><input class="form-check-input" type="checkbox" id="mxEm_' + i + '" aria-label="Email ' + esc(m.label) + '"' + (m.email ? ' checked' : '') + '></td>' +
      '<td><button type="button" class="btn btn-soft btn-sm py-0" data-act="cfTemplate" data-i="' + i + '"><i class="bi bi-pencil"></i> Template</button></td></tr>').join('') +
    '</tbody></table></div></section>' +
    '<div class="d-grid d-md-flex justify-content-md-end"><button type="button" class="btn btn-green px-4" data-act="cfSimpan"><i class="bi bi-save"></i> Simpan konfigurasi</button></div>' +
    '</div></div>';
}
AKSI.cfUrlIni = () => { $('#cfUrl').value = location.origin + location.pathname; };
AKSI.cfDevice = async (el) => {
  await denganTombol(el, async () => {
    try {
      const r = await api('waDevice'), d = r.data;
      $('#cfDeviceInfo').innerHTML = '<div class="kv-list small"><div><span>Perangkat</span><b class="mono">' + esc(d.device || '-') + '</b></div><div><span>Status</span><b>' +
        (d.status === 'connect' ? '<span class="bs bs-green">Terhubung</span>' : '<span class="bs bs-red">' + esc(d.status || 'Terputus') + '</span>') + '</b></div>' +
        '<div><span>Paket</span><b>' + esc(d.paket || '-') + '</b></div><div><span>Kuota</span><b>' + esc(d.kuota || '-') + '</b></div>' + (d.kedaluwarsa ? '<div><span>Berlaku s.d.</span><b>' + esc(d.kedaluwarsa) + '</b></div>' : '') + '</div>';
    } catch (e) { tanganiGalat(e, 'Cek perangkat'); }
  });
};
AKSI.cfHapusToken = async () => {
  const ok = await konfirmasi({ judul: 'Hapus token Fonnte', pesan: 'Semua pengiriman WhatsApp (peringatan & blast) akan berhenti. Lanjutkan?', okTeks: 'Hapus token', okKelas: 'btn-red' });
  if (!ok) return;
  try { const r = await api('notifConfigSave', { token: '__HAPUS__', waAktif: false }); simpanCache('notifConfig', r.data); ADM.cfg = r.data; renderKonfig(r.data); toast('Token dihapus', r.message, 'success'); } catch (e) { tanganiGalat(e); }
};
AKSI.cfTemplate = (el) => {
  const i = Number(el.dataset.i), m = ADM.matriks[i];
  bukaModal({ judul: 'Template — ' + esc(m.label), ukuran: 'lg', sheet: true,
    isi: '<div class="small text-secondary-x mb-2">Variabel: ' + (m.vars || []).concat(['institusi', 'link']).map(v => '<span class="mono">{' + esc(v) + '}</span>').join(' ') + '</div>' +
      '<label class="form-label" for="tpSubjek">Subjek email</label><input class="form-control mb-2" id="tpSubjek" maxlength="200" value="' + esc(m.subjek) + '">' +
      '<label class="form-label" for="tpPesan">Isi pesan (WA &amp; email)</label><textarea class="form-control" id="tpPesan" rows="9" maxlength="3000">' + esc(m.pesan) + '</textarea>',
    kaki: '<button type="button" class="btn btn-soft me-auto" data-act="tpBawaan" data-i="' + i + '">Kembalikan bawaan</button><button type="button" class="btn btn-soft" data-bs-dismiss="modal">Batal</button>' +
      '<button type="button" class="btn btn-navy" data-act="tpPakai" data-i="' + i + '">Pakai template</button>' });
};
AKSI.tpBawaan = (el) => { const m = ADM.matriks[Number(el.dataset.i)]; $('#tpSubjek').value = m.subjekDefault; $('#tpPesan').value = m.pesanDefault; };
AKSI.tpPakai = async (el) => {
  const m = ADM.matriks[Number(el.dataset.i)];
  if ($('#tpPesan').value.trim().length < 5) { $('#tpPesan').focus(); return; }
  m.subjek = $('#tpSubjek').value.trim() || m.subjekDefault; m.pesan = $('#tpPesan').value;
  await tutupModal();
  toast('Template diperbarui', 'Klik "Simpan konfigurasi" untuk menyimpan ke server.', 'info');
};
AKSI.cfSimpan = async (el) => {
  const data = {
    waAktif: $('#cfWa').checked, emailAktif: $('#cfEmail').checked, deteksiOtomatis: $('#cfDeteksi').checked,
    batchDefault: Number($('#cfBatch').value), jeda: $('#cfJeda').value.trim(), namaPengirim: $('#cfNama').value.trim(), appUrl: $('#cfUrl').value.trim(),
    matriks: ADM.matriks.map((m, i) => ({ kode: m.kode, wa: $('#mxWa_' + i).checked, email: $('#mxEm_' + i).checked, subjek: m.subjek, pesan: m.pesan }))
  };
  const t = $('#cfToken').value.trim();
  if (t) data.token = t;
  await denganTombol(el, async () => {
    try { const r = await api('notifConfigSave', data); simpanCache('notifConfig', r.data); ADM.cfg = r.data; renderKonfig(r.data); toast('Tersimpan', r.message, 'success'); }
    catch (e) { tanganiGalat(e, 'Gagal menyimpan'); }
  });
};

// ════════════════════════════════════════════════════════
// B. CRM KONTAK
// ════════════════════════════════════════════════════════
HALAMAN.crm = async (c, o, seq) => {
  ADM.crmPilih = new Map();
  const f = ADM.crmF;
  c.innerHTML = kepala('CRM Kontak', 'Satu daftar Nama · Email · WhatsApp untuk seluruh petugas (sinkron otomatis dari Data Petugas) ditambah kontak manual.',
    '<button type="button" class="btn btn-soft btn-sm" data-act="crmSync"><i class="bi bi-arrow-repeat"></i> Sinkron sekarang</button>' +
    (adminSaja() ? '<button type="button" class="btn btn-soft btn-sm" data-act="crmImpor"><i class="bi bi-upload"></i> Import CSV</button>' : '') +
    '<button type="button" class="btn btn-soft btn-sm" data-act="crmEkspor"><i class="bi bi-download"></i> Ekspor CSV</button>' +
    '<button type="button" class="btn btn-soft btn-sm" data-act="crmDuplikat"><i class="bi bi-intersect"></i> Duplikat</button>') +
    '<div id="crmKpi" class="row g-3 mb-3"></div>' +
    '<div id="crmChip" class="d-flex flex-wrap gap-2 mb-2"></div>' +
    '<div class="cardx mb-3"><div class="cardx-body row g-2">' +
    '<div class="col-12 col-md-4"><label class="visually-hidden" for="crmCari">Cari kontak</label><input type="search" class="form-control" id="crmCari" data-inp="crmCari" value="' + esc(f.cari) + '" placeholder="Cari nama, NIP, nomor, email, tag…"></div>' +
    '<div class="col-6 col-md-2"><label class="visually-hidden" for="crmStatusWA">Status WA</label><select class="form-select" id="crmStatusWA" data-chg="crmFilter">' + opsi([['Terdaftar', 'Terdaftar WA'], ['Tidak Terdaftar', 'Bukan WA'], ['belum', 'Belum dicek']], f.statusWA, 'Semua status WA') + '</select></div>' +
    '<div class="col-6 col-md-2"><label class="visually-hidden" for="crmTag">Tag</label><select class="form-select" id="crmTag" data-chg="crmFilter"><option value="">Semua tag</option></select></div>' +
    '<div class="col-6 col-md-2"><label class="visually-hidden" for="crmMasalah">Kualitas data</label><select class="form-select" id="crmMasalah" data-chg="crmFilter">' + opsi([['tanpaWA', 'Tanpa nomor WA'], ['tanpaKontak', 'Tanpa WA & email'], ['duplikat', 'Duplikat']], f.masalah, 'Semua data') + '</select></div>' +
    '<div class="col-6 col-md-2"><label class="visually-hidden" for="crmOpt">Opt-out</label><select class="form-select" id="crmOpt" data-chg="crmFilter">' + opsi([['YA', 'Opt-out saja']], f.optOut, 'Termasuk opt-out') + '</select></div>' +
    '</div></div>' +
    '<div id="crmAksi" class="bulk-bar hidden"></div>' +
    '<section class="cardx"><div id="crmTabel">' + memuat() + '</div></section>';
  const stats = swr('crmStats', 'crmStats', [], d => { if (!basi(seq)) renderCrmStats(d); }).catch(() => {});
  await muatCrm(seq, false);
  await stats;
};
SEGARKAN.crm = () => { const s = AppState.navSeq; swr('crmStats', 'crmStats', [], d => { if (!basi(s)) renderCrmStats(d); }, { paksa: true }).catch(() => {}); return muatCrm(s, true).catch(tanganiGalat); };
function kunciCrm() { const f = ADM.crmF; return 'crmList:' + [f.cari, f.segmen, f.statusWA, f.tag, f.masalah, f.optOut, f.halaman, f.per].join('|'); }
async function muatCrm(seq, paksa) {
  await swr(kunciCrm(), 'crmList', [ADM.crmF], d => { if (!basi(seq) && $('#crmTabel')) renderCrm(d); }, { paksa: paksa, segar: 30000 });
}
function renderCrmStats(s) {
  const box = $('#crmKpi');
  if (!box) return;
  box.innerHTML = '<div class="col-6 col-md-2">' + kpi('navy', 'bi-person-lines-fill', 'Total kontak', s.total, s.baru7 + ' baru 7 hari') + '</div>' +
    '<div class="col-6 col-md-2">' + kpi('green', 'bi-whatsapp', 'Terdaftar WA', s.terdaftarWA, s.waValid + ' nomor valid') + '</div>' +
    '<div class="col-6 col-md-2">' + kpi('', 'bi-question-circle', 'Belum dicek WA', s.belumCekWA, s.tidakTerdaftarWA + ' bukan WA') + '</div>' +
    '<div class="col-6 col-md-2">' + kpi('navy', 'bi-envelope-check', 'Email valid', s.emailValid, '') + '</div>' +
    '<div class="col-6 col-md-2">' + kpi('red', 'bi-exclamation-diamond', 'Tanpa kontak', s.tanpaKontak, s.duplikat + ' duplikat') + '</div>' +
    '<div class="col-6 col-md-2">' + kpi('green', 'bi-chat-dots', 'Dihubungi 30 hr', s.dihubungi30, s.optOut + ' opt-out') + '</div>';
}
function renderCrm(d) {
  ADM.crmData = d;
  const f = ADM.crmF;
  const seg = Object.keys(d.facet.segmen).sort();
  $('#crmChip').innerHTML = '<button type="button" class="chip-f' + (!f.segmen ? ' on' : '') + '" data-act="crmSegmen" data-v="">Semua</button>' +
    seg.map(s => '<button type="button" class="chip-f' + (f.segmen === s ? ' on' : '') + '" data-act="crmSegmen" data-v="' + esc(s) + '">' + esc(s) + ' <span>' + d.facet.segmen[s] + '</span></button>').join('');
  const tagSel = $('#crmTag');
  if (tagSel) tagSel.innerHTML = opsi(Object.keys(d.facet.tag).sort().map(t => [t, t + ' (' + d.facet.tag[t] + ')']), f.tag, 'Semua tag');
  const semuaDipilih = d.rows.length && d.rows.every(k => ADM.crmPilih.has(k.id));
  $('#crmTabel').innerHTML = d.rows.length ? '<div class="table-wrap"><table class="tablex"><thead><tr>' +
    '<th class="chk"><input class="form-check-input" type="checkbox" data-chg="crmPilihSemua" aria-label="Pilih semua di halaman ini"' + (semuaDipilih ? ' checked' : '') + '></th>' +
    '<th>Nama</th><th>WhatsApp</th><th>Email</th><th>Tag</th><th>Kontak terakhir</th></tr></thead><tbody>' +
    d.rows.map(k => '<tr data-act="crmBuka" data-id="' + esc(k.id) + '" tabindex="0" style="cursor:pointer">' +
      '<td class="chk"><input class="form-check-input" type="checkbox" data-chg="crmPilih" data-id="' + esc(k.id) + '" aria-label="Pilih ' + esc(k.nama) + '"' + (ADM.crmPilih.has(k.id) ? ' checked' : '') + '></td>' +
      '<td><div class="cell-main">' + esc(k.nama) + (k.optOut ? ' <span class="bs bs-gray">opt-out</span>' : '') + (k.duplikat ? ' <span class="bs bs-gold">duplikat</span>' : '') + '</div>' +
      '<div class="cell-sub">' + esc(k.segmen) + (k.regu ? ' • ' + esc(k.regu) : '') + (k.sumber === 'petugas' ? ' • <span class="mono">' + esc(k.refId) + '</span>' : ' • manual') + '</div></td>' +
      '<td><div class="mono small">' + esc(k.wa || '-') + '</div>' + (k.wa ? badgeWA(k.statusWA, k.waValid) : '') + '</td>' +
      '<td class="small">' + (k.email ? esc(k.email) + (k.emailValid === 'YA' ? '' : ' <span class="bs bs-red">?</span>') : '<span class="text-secondary-x">-</span>') + '</td>' +
      '<td>' + (k.tag ? k.tag.split(',').map(t => '<span class="tag-chip">' + esc(t) + '</span>').join(' ') : '') + '</td>' +
      '<td class="small">' + (k.terakhir ? fmt(k.terakhir, 'tglJam') : '-') + '<div class="cell-sub">' + k.jumlahPesan + ' pesan</div></td></tr>').join('') +
    '</tbody></table></div>' + pager(d.total, d.halaman, d.per, 'crmHal') :
    kosong('bi-person-x', d.total === 0 && !f.cari && !f.segmen ? 'Belum ada kontak. Klik "Sinkron sekarang" untuk menarik data petugas.' : 'Tidak ada kontak yang cocok dengan filter.');
  renderBulkCrm();
}
function renderBulkCrm() {
  const box = $('#crmAksi');
  if (!box) return;
  const n = ADM.crmPilih.size;
  box.classList.toggle('hidden', !n);
  if (!n) return;
  box.innerHTML = '<b class="me-1">' + n + ' dipilih</b>' +
    '<button type="button" class="btn btn-green btn-sm" data-act="crmBlast"><i class="bi bi-megaphone"></i> Blast WA</button>' +
    '<button type="button" class="btn btn-soft btn-sm" data-act="crmDeteksi"><i class="bi bi-whatsapp"></i> Deteksi WA</button>' +
    (adminSaja() ? '<button type="button" class="btn btn-soft btn-sm" data-act="crmMassal" data-aksi="tag"><i class="bi bi-tag"></i> Tambah tag</button>' +
      '<button type="button" class="btn btn-soft btn-sm" data-act="crmMassal" data-aksi="untag"><i class="bi bi-tag"></i> Hapus tag</button>' +
      '<button type="button" class="btn btn-soft btn-sm" data-act="crmMassal" data-aksi="optout">Opt-out</button>' +
      '<button type="button" class="btn btn-soft btn-sm" data-act="crmMassal" data-aksi="optin">Opt-in</button>' +
      '<button type="button" class="btn btn-soft btn-sm" style="color:var(--red)" data-act="crmMassal" data-aksi="hapusManual">Hapus manual</button>' : '') +
    '<button type="button" class="btn btn-soft btn-sm ms-auto" data-act="crmBersih">Batal pilih</button>';
}
function segarkanCrm() { $('#crmTabel').innerHTML = memuat(); muatCrm(AppState.navSeq, false).catch(tanganiGalat); }
KETIK.crmCari = (el) => tunda(() => { ADM.crmF.cari = el.value.trim(); ADM.crmF.halaman = 1; muatCrm(AppState.navSeq, false).catch(tanganiGalat); }, 350);
UBAH.crmFilter = () => {
  Object.assign(ADM.crmF, { statusWA: $('#crmStatusWA').value, tag: $('#crmTag').value, masalah: $('#crmMasalah').value, optOut: $('#crmOpt').value, halaman: 1 });
  segarkanCrm();
};
AKSI.crmSegmen = (el) => { ADM.crmF.segmen = el.dataset.v; ADM.crmF.halaman = 1; segarkanCrm(); };
AKSI.crmHal = (el) => { ADM.crmF.halaman = Number(el.dataset.hal) || 1; segarkanCrm(); $('#crmTabel').scrollIntoView({ block: 'start', behavior: geraklah() ? 'smooth' : 'auto' }); };
UBAH.crmPilih = (el) => {
  const k = ADM.crmData.rows.find(x => x.id === el.dataset.id);
  if (el.checked && k) ADM.crmPilih.set(k.id, k); else ADM.crmPilih.delete(el.dataset.id);
  renderBulkCrm();
};
UBAH.crmPilihSemua = (el) => {
  ADM.crmData.rows.forEach(k => { if (el.checked) ADM.crmPilih.set(k.id, k); else ADM.crmPilih.delete(k.id); });
  $$('#crmTabel [data-chg="crmPilih"]').forEach(x => { x.checked = el.checked; });
  renderBulkCrm();
};
// Klik checkbox di baris tidak membuka detail
document.addEventListener('click', e => { if (e.target.matches && e.target.matches('#crmTabel input[type="checkbox"]')) e.stopPropagation(); }, true);
AKSI.crmBersih = () => { ADM.crmPilih.clear(); $$('#crmTabel input[type="checkbox"]').forEach(x => { x.checked = false; }); renderBulkCrm(); };
AKSI.crmSync = async (el) => {
  await denganTombol(el, async () => { try { const r = await api('crmSync'); toast('Sinkron selesai', r.message, 'success'); SEGARKAN.crm(); } catch (e) { tanganiGalat(e); } });
};
AKSI.crmBlast = () => {
  ADM.preset = [...ADM.crmPilih.values()];
  ADM.aud = null; ADM.tabNotif = 'blast';
  navigateTo('notifikasi');
};
AKSI.crmDeteksi = async (el) => {
  const nomor = [...new Set([...ADM.crmPilih.values()].filter(k => k.waValid).map(k => k.wa))];
  if (!nomor.length) { toast('Tidak ada nomor', 'Kontak terpilih tidak punya nomor WA yang valid.', 'warning'); return; }
  await denganTombol(el, async () => {
    try {
      let t = 0;
      for (let i = 0; i < nomor.length; i += 50) { const r = await api('waValidate', nomor.slice(i, i + 50)); t += r.data.terdaftar || 0; }
      toast('Deteksi selesai', nomor.length + ' nomor dicek, ' + t + ' terdaftar WhatsApp.', 'success');
      SEGARKAN.crm();
    } catch (e) { tanganiGalat(e, 'Deteksi WA'); }
  });
};
AKSI.crmMassal = async (el) => {
  const aksi = el.dataset.aksi, ids = [...ADM.crmPilih.keys()];
  const label = { tag: 'Tambah tag', untag: 'Hapus tag', optout: 'Tandai opt-out (tidak menerima blast)', optin: 'Batalkan opt-out', hapusManual: 'Hapus kontak manual' }[aksi];
  const butuhTag = aksi === 'tag' || aksi === 'untag';
  const ok = await konfirmasi({ judul: label, pesan: '<b>' + ids.length + '</b> kontak terpilih.' + (aksi === 'hapusManual' ? ' Kontak dari data petugas tidak ikut terhapus.' : ''),
    input: butuhTag ? { label: 'Nama tag', placeholder: 'mis. rapat-bulanan', wajib: true, min: 1 } : null, okTeks: label, okKelas: aksi === 'hapusManual' ? 'btn-red' : 'btn-navy' });
  if (!ok) return;
  try { const r = await api('crmBulk', { aksi: aksi, ids: ids, nilai: ok.nilai }); toast('Selesai', r.message, 'success'); ADM.crmPilih.clear(); SEGARKAN.crm(); } catch (e) { tanganiGalat(e); }
};
AKSI.crmEkspor = async (el) => {
  await denganTombol(el, async () => {
    try {
      const r = await api('crmExport', Object.assign({}, ADM.crmF, { halaman: 1 }));
      unduhCsv('CRM_Kontak_' + hariIni() + '.csv', ['KontakID', 'Nama', 'NoWA', 'StatusWA', 'Email', 'EmailValid', 'Segmen', 'Sumber', 'NIP/Ref', 'Regu', 'Jabatan', 'Tag', 'OptOut', 'JumlahPesan', 'TerakhirDihubungi', 'Catatan'],
        r.data.map(k => [k.id, k.nama, k.wa, k.statusWA, k.email, k.emailValid, k.segmen, k.sumber, k.refId, k.regu, k.jabatan, k.tag, k.optOut ? 'YA' : 'TIDAK', k.jumlahPesan, k.terakhir ? fmt(k.terakhir) : '', k.catatan]));
    } catch (e) { tanganiGalat(e); }
  });
};

// ── Detail kontak (laci) ──
AKSI.crmBuka = async (el) => {
  const id = el.dataset.id;
  bukaModal({ judul: '<i class="bi bi-person-vcard"></i> Detail kontak', ukuran: 'lg', sheet: true, isi: memuat('Memuat kontak…') });
  try { const r = await api('crmDetail', id); renderDetailKontak(r.data); } catch (e) { $('#modalUmumBody').innerHTML = kosong('bi-exclamation-triangle', e.message); }
};
function renderDetailKontak(d) {
  const k = d.kontak, bisa = adminSaja();
  const ro = bisa ? '' : ' readonly';
  $('#modalUmumTitle').innerHTML = '<i class="bi bi-person-vcard"></i> ' + esc(k.nama);
  $('#modalUmumBody').innerHTML = '<div class="row g-3"><div class="col-md-6">' +
    '<div class="small text-secondary-x mb-2">' + esc(k.segmen) + ' • ' + (k.sumber === 'petugas' ? 'Data petugas <span class="mono">' + esc(k.refId) + '</span> — perubahan nama/WA/email ikut memperbarui Data Petugas.' : 'Kontak manual') + '</div>' +
    '<label class="form-label" for="ktNama">Nama</label><input class="form-control mb-2" id="ktNama" value="' + esc(k.nama) + '"' + ro + '>' +
    '<label class="form-label" for="ktWa">WhatsApp</label><div class="input-group mb-2"><input class="form-control mono" id="ktWa" inputmode="tel" value="' + esc(k.wa) + '"' + ro + '>' +
    (k.wa ? '<a class="btn btn-soft" href="https://wa.me/' + esc(k.wa.replace(/^0/, '62')) + '" target="_blank" rel="noopener" aria-label="Buka chat WhatsApp"><i class="bi bi-whatsapp" style="color:var(--green)"></i></a>' : '') + '</div>' +
    '<div class="mb-2">' + (k.wa ? badgeWA(k.statusWA, k.waValid) + (k.cekWA ? ' <span class="cell-sub">dicek ' + fmt(k.cekWA, 'tglJam') + '</span>' : '') : '') + '</div>' +
    '<label class="form-label" for="ktEmail">Email</label><input class="form-control mb-2" id="ktEmail" type="email" value="' + esc(k.email) + '"' + ro + '>' +
    '<label class="form-label" for="ktTag">Tag (pisahkan koma)</label><input class="form-control mb-2" id="ktTag" value="' + esc(k.tag) + '"' + ro + '>' +
    '<label class="form-label" for="ktCatatan">Catatan</label><textarea class="form-control mb-2" id="ktCatatan" rows="2"' + ro + '>' + esc(k.catatan) + '</textarea>' +
    (bisa ? saklar('ktOpt', 'Opt-out — jangan kirimi blast', k.optOut, 'Notifikasi tugas (peringatan, izin) tetap terkirim.') +
      '<div class="d-grid mt-2"><button type="button" class="btn btn-navy" data-act="ktSimpan" data-id="' + esc(k.id) + '"><i class="bi bi-save"></i> Simpan kontak</button></div>' : '') +
    '</div><div class="col-md-6">' +
    '<div class="small fw-semibold mb-1">Catat interaksi</div><div class="d-flex gap-2 mb-2"><select class="form-select form-select-sm" id="ixKanal" style="max-width:140px" aria-label="Kanal">' + opsi(['Telepon', 'WA Manual', 'Kunjungan', 'Email Manual', 'Catatan'], 'Telepon') + '</select>' +
    '<input class="form-control form-control-sm" id="ixRingkas" placeholder="Ringkasan…" aria-label="Ringkasan interaksi"><button type="button" class="btn btn-gold btn-sm" data-act="ixSimpan" data-id="' + esc(k.id) + '" aria-label="Simpan interaksi"><i class="bi bi-plus-lg"></i></button></div>' +
    '<div class="small fw-semibold mt-3 mb-1">Linimasa (' + d.timeline.length + ')</div><div class="timeline">' +
    (d.timeline.length ? d.timeline.map(t => '<div class="tl-item ' + (t.jenis === 'pesan' ? 'tl-msg' : 'tl-int') + '"><div class="tl-head"><b>' + esc(t.kanal) + '</b> ' + (t.status ? badgeA(t.status) : '') + '<span class="ms-auto mono">' + fmt(t.waktu, 'tglJam') + '</span></div>' +
      '<div class="tl-body">' + esc(t.ringkasan) + (t.oleh ? ' <span class="cell-sub">— ' + esc(t.oleh) + '</span>' : '') + '</div></div>').join('') : kosong('bi-chat', 'Belum ada pesan atau interaksi.')) +
    '</div></div></div>';
}
AKSI.ktSimpan = async (el) => {
  const data = { id: el.dataset.id, nama: $('#ktNama').value.trim(), wa: $('#ktWa').value.trim(), email: $('#ktEmail').value.trim(), tag: $('#ktTag').value, catatan: $('#ktCatatan').value, optOut: $('#ktOpt').checked };
  await denganTombol(el, async () => { try { const r = await api('crmSave', data); toast('Tersimpan', r.message, 'success'); await tutupModal(); SEGARKAN.crm(); } catch (e) { tanganiGalat(e, 'Gagal menyimpan'); } });
};
AKSI.ixSimpan = async (el) => {
  const ringkasan = $('#ixRingkas').value.trim();
  if (ringkasan.length < 3) { $('#ixRingkas').focus(); return; }
  await denganTombol(el, async () => {
    try { await api('crmInteraksi', { kontakId: el.dataset.id, kanal: $('#ixKanal').value, ringkasan: ringkasan }); const r = await api('crmDetail', el.dataset.id); renderDetailKontak(r.data); toast('Dicatat', 'Interaksi ditambahkan ke linimasa.', 'success'); }
    catch (e) { tanganiGalat(e); }
  });
};

// ── Import CSV kontak manual ──
AKSI.crmImpor = () => {
  bukaModal({ judul: '<i class="bi bi-upload"></i> Import kontak (CSV)', sheet: true,
    isi: '<p class="small">Kolom: <span class="mono">nama; wa; email; segmen; tag</span> (pemisah ; atau ,). Baris tanpa nama atau tanpa nomor/email valid dilewati. Nomor yang sama diperbarui (tidak dobel).</p>' +
      '<button type="button" class="btn btn-soft btn-sm mb-3" data-act="crmTemplate"><i class="bi bi-file-earmark-arrow-down"></i> Unduh template</button>' +
      '<input type="file" class="form-control" id="crmFile" accept=".csv,text/csv" data-chg="crmFile"><div id="crmImporInfo" class="mt-3"></div>',
    kaki: '<button type="button" class="btn btn-soft" data-bs-dismiss="modal">Batal</button><button type="button" class="btn btn-navy" data-act="crmImporJalan" id="btnImporKontak" disabled><i class="bi bi-upload"></i> Import</button>' });
};
AKSI.crmTemplate = () => unduhCsv('Template_Kontak_CRM.csv', ['nama', 'wa', 'email', 'segmen', 'tag'], [['Budi Santoso', '081234567890', 'budi@contoh.id', 'Manual', 'mitra'], ['Sari Dewi', '082198765432', '', 'Manual', 'rapat']]);
function parseCsv(teks) {
  teks = teks.replace(/^﻿/, '');
  const pis = (teks.split(/\r?\n/)[0].match(/;/g) || []).length >= (teks.split(/\r?\n/)[0].match(/,/g) || []).length ? ';' : ',';
  const rows = []; let row = [], sel = '', kutip = false;
  for (let i = 0; i < teks.length; i++) {
    const ch = teks[i];
    if (kutip) { if (ch === '"') { if (teks[i + 1] === '"') { sel += '"'; i++; } else kutip = false; } else sel += ch; }
    else if (ch === '"') kutip = true;
    else if (ch === pis) { row.push(sel); sel = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && teks[i + 1] === '\n') i++; row.push(sel); rows.push(row); row = []; sel = ''; }
    else sel += ch;
  }
  if (sel || row.length) { row.push(sel); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}
UBAH.crmFile = async (el) => {
  const f = el.files && el.files[0];
  if (!f) return;
  if (f.size > 2 * 1024 * 1024) { toast('File terlalu besar', 'Maksimal 2 MB (±5.000 kontak).', 'warning'); return; }
  const rows = parseCsv(await f.text());
  const h = (rows.shift() || []).map(x => String(x).trim().toLowerCase().replace(/^'/, ''));
  const idx = k => h.indexOf(k);
  if (idx('nama') < 0 || (idx('wa') < 0 && idx('email') < 0)) { $('#crmImporInfo').innerHTML = '<div class="notice" style="background:var(--red-soft);border-left-color:var(--red)"><div class="small">Header wajib: <b>nama</b> dan <b>wa</b> atau <b>email</b>.</div></div>'; return; }
  ADM.imporKontak = rows.map(r => ({ nama: r[idx('nama')] || '', wa: idx('wa') >= 0 ? String(r[idx('wa')] || '').replace(/^'/, '') : '', email: idx('email') >= 0 ? r[idx('email')] || '' : '',
    segmen: idx('segmen') >= 0 ? r[idx('segmen')] || '' : '', tag: idx('tag') >= 0 ? r[idx('tag')] || '' : '' })).slice(0, 5000);
  $('#crmImporInfo').innerHTML = '<div class="small"><b>' + ADM.imporKontak.length + '</b> baris siap diimport. Contoh: ' + ADM.imporKontak.slice(0, 3).map(x => esc(x.nama) + ' (' + esc(x.wa || x.email) + ')').join(', ') + '</div>';
  $('#btnImporKontak').disabled = !ADM.imporKontak.length;
};
AKSI.crmImporJalan = async (el) => {
  await denganTombol(el, async () => {
    try { const r = await api('crmImport', ADM.imporKontak || []); toast('Import selesai', r.message, 'success'); await tutupModal(); SEGARKAN.crm(); } catch (e) { tanganiGalat(e, 'Import gagal'); }
  });
};

// ── Duplikat & gabung ──
AKSI.crmDuplikat = async () => {
  bukaModal({ judul: '<i class="bi bi-intersect"></i> Kontak duplikat', ukuran: 'lg', sheet: true, isi: memuat('Mencari duplikat…') });
  try {
    const r = await api('crmDuplikat');
    ADM.duplikat = r.data;
    $('#modalUmumBody').innerHTML = r.data.length ? '<p class="small">Kontak dengan nomor WA / email yang sama. Pilih kontak <b>utama</b>, lalu gabungkan (tag, catatan, jumlah pesan &amp; opt-out ikut digabung).</p>' +
      r.data.map((g, gi) => '<div class="cardx mb-2"><div class="cardx-head"><h6 class="mono small">' + esc(g.kunci) + '</h6>' +
        (adminSaja() ? '<button type="button" class="btn btn-navy btn-sm" data-act="crmGabung" data-g="' + gi + '">Gabung</button>' : '') + '</div><div class="cardx-body py-1">' +
        g.kontak.map((k, ki) => '<div class="form-check py-1"><input class="form-check-input" type="radio" name="dup' + gi + '" id="dup' + gi + '_' + ki + '" value="' + esc(k.id) + '"' + (ki === 0 ? ' checked' : '') + '>' +
          '<label class="form-check-label small" for="dup' + gi + '_' + ki + '"><b>' + esc(k.nama) + '</b> • ' + esc(k.segmen) + ' • ' + esc(k.sumber) + ' <span class="mono">' + esc(k.wa || k.email) + '</span></label></div>').join('') + '</div></div>').join('') :
      kosong('bi-check2-circle', 'Tidak ada kontak duplikat.');
  } catch (e) { $('#modalUmumBody').innerHTML = kosong('bi-exclamation-triangle', e.message); }
};
AKSI.crmGabung = async (el) => {
  const g = ADM.duplikat[Number(el.dataset.g)];
  const pilih = document.querySelector('input[name="dup' + el.dataset.g + '"]:checked');
  if (!g || !pilih) return;
  await denganTombol(el, async () => {
    try { const r = await api('crmMerge', { utama: pilih.value, gabung: g.kontak.map(k => k.id).filter(id => id !== pilih.value) }); toast('Digabung', r.message, 'success'); AKSI.crmDuplikat(); SEGARKAN.crm(); }
    catch (e) { tanganiGalat(e); }
  });
};

// ════════════════════════════════════════════════════════
// C. MIGRASI & BACKUP (ADMIN)
// ════════════════════════════════════════════════════════
HALAMAN.migrasi = async (c, o, seq) => {
  c.innerHTML = kepala('Migrasi &amp; Backup', 'Pindahkan data dari spreadsheet app lama tanpa mengubahnya, dan kelola cadangan database.', '') +
    '<div class="row g-3"><div class="col-xl-7">' +
    '<section class="cardx mb-3" id="kartuImport"><div class="cardx-head"><h6><i class="bi bi-box-arrow-in-down" aria-hidden="true"></i> Import data app lama / pulihkan cadangan</h6></div><div class="cardx-body">' +
    '<div class="notice mb-3"><i class="bi bi-info-circle" aria-hidden="true"></i><div class="small">Spreadsheet sumber <b>hanya dibaca</b>, tidak pernah diubah. Aman diulang: data dicocokkan per NIP / ID HP / ID log, sehingga tidak ada baris dobel. Spreadsheet harus milik akun Google yang sama dengan backend.</div></div>' +
    '<label class="form-label" for="mgSumber">URL atau ID spreadsheet sumber</label><input class="form-control mono mb-3" id="mgSumber" placeholder="https://docs.google.com/spreadsheets/d/…">' +
    '<div class="small fw-semibold mb-1">Data yang diimport</div><div class="row g-1 mb-2">' +
    SHEET_IMPORT.map(s => '<div class="col-md-6"><div class="form-check"><input class="form-check-input" type="checkbox" id="mgS_' + s[0] + '" value="' + s[0] + '"' + (s[2] ? ' checked' : '') + '>' +
      '<label class="form-check-label small" for="mgS_' + s[0] + '"><b>' + esc(s[1]) + '</b><div class="form-text mt-0">' + esc(s[3]) + '</div></label></div></div>').join('') + '</div>' +
    saklar('mgTimpa', 'Timpa data yang sudah ada', false, 'Nama, jabatan, regu, WA/email petugas & identitas HP di app ini diganti dengan data sumber. Biarkan mati bila app ini sudah dipakai & dikoreksi.') +
    '<div class="d-flex flex-wrap gap-2 mt-3"><button type="button" class="btn btn-navy" data-act="mgPindai"><i class="bi bi-search"></i> Pindai (dry-run)</button>' +
    '<button type="button" class="btn btn-gold" data-act="mgJalan"><i class="bi bi-play-circle"></i> Jalankan import</button></div>' +
    '<div id="mgHasil" class="mt-3"></div></div></section>' +
    '<section class="cardx mb-3"><div class="cardx-head"><h6><i class="bi bi-signpost-split" aria-hidden="true"></i> Langkah pindah (cutover)</h6></div><div class="cardx-body"><ol class="small ps-3 mb-0">' +
    '<li>Tempel URL spreadsheet app lama → <b>Pindai</b> → periksa angka &amp; peringatan.</li><li><b>Jalankan import</b>, lalu cek Data Petugas, Data HP &amp; CRM. Uji login 1 akun petugas.</li>' +
    '<li>Tepat sebelum pindah: <b>Jalankan import sekali lagi</b> (delta) untuk menangkap titip/ambil terbaru.</li><li>Umumkan alamat baru (blast WA dari menu WhatsApp &amp; Notifikasi). Sesi lama tidak ikut pindah — semua petugas login ulang.</li></ol></div></section>' +
    '</div><div class="col-xl-5">' +
    '<section class="cardx"><div class="cardx-head"><h6><i class="bi bi-shield-check" aria-hidden="true"></i> Cadangan database</h6><span id="mgMingguan"></span></div>' +
    '<div class="cardx-body d-grid gap-2"><button type="button" class="btn btn-green" data-act="bkBuat"><i class="bi bi-cloud-plus"></i> Buat cadangan sekarang</button>' +
    '<button type="button" class="btn btn-soft" data-act="bkUnduh" data-id=""><i class="bi bi-file-earmark-excel"></i> Unduh database saat ini (.xlsx)</button>' +
    '<div class="d-flex gap-2 align-items-end"><div class="flex-fill"><label class="form-label" for="mgSimpan">Simpan cadangan terakhir</label><input type="number" min="3" max="60" class="form-control" id="mgSimpan" inputmode="numeric"></div>' +
    '<button type="button" class="btn btn-soft" data-act="bkAtur">Simpan</button></div></div>' +
    '<div id="mgDaftar">' + memuat() + '</div></section></div></div>';
  await swr('getDaftarBackup', 'getDaftarBackup', [], d => { if (!basi(seq)) renderBackup(d); }, { paksa: !!o.paksa });
};
SEGARKAN.migrasi = () => swr('getDaftarBackup', 'getDaftarBackup', [], d => { if (AppState.page === 'migrasi') renderBackup(d); }, { paksa: true }).catch(tanganiGalat);
function renderBackup(d) {
  ADM.backup = d;
  const s = $('#mgSimpan'); if (s && document.activeElement !== s) s.value = d.simpan;
  $('#mgMingguan').innerHTML = d.mingguanAktif ? '<span class="bs bs-green">Otomatis tiap Minggu</span>' : '<span class="bs bs-red">Otomatis belum aktif</span>';
  $('#mgDaftar').innerHTML = (d.backup.length ? '<div class="cardx-body py-1 border-top">' + d.backup.map(b =>
    '<div class="list-item"><i class="bi bi-file-earmark-spreadsheet fs-4" style="color:var(--green)" aria-hidden="true"></i><div class="grow"><div class="cell-main truncate">' + esc(b.nama) + '</div>' +
    '<div class="cell-sub">' + fmt(b.dibuat) + ' WIT' + (b.ukuranKB ? ' • ' + b.ukuranKB + ' KB' : '') + '</div></div>' +
    '<div class="d-flex gap-1"><button type="button" class="btn btn-soft btn-sm btn-icon-sm" data-act="bkUnduh" data-id="' + esc(b.id) + '" aria-label="Unduh .xlsx" title="Unduh .xlsx"><i class="bi bi-download"></i></button>' +
    '<button type="button" class="btn btn-soft btn-sm" data-act="bkPulihkan" data-id="' + esc(b.id) + '" title="Pulihkan dari cadangan ini">Pulihkan</button></div></div>').join('') + '</div>' :
    '<div class="border-top">' + kosong('bi-cloud', 'Belum ada cadangan. Klik "Buat cadangan sekarang".') + '</div>') +
    (d.folderUrl ? '<div class="p-2 border-top small"><a href="' + esc(d.folderUrl) + '" target="_blank" rel="noopener"><i class="bi bi-folder2-open"></i> Buka folder Backup di Google Drive</a></div>' : '');
}
function opsiImport(dry) {
  const sumber = $('#mgSumber').value.trim();
  if (!sumber) { $('#mgSumber').focus(); toast('Sumber kosong', 'Tempel URL atau ID spreadsheet sumber.', 'warning'); return null; }
  const sheets = SHEET_IMPORT.map(s => s[0]).filter(n => $('#mgS_' + n).checked);
  if (!sheets.length) { toast('Pilih data', 'Centang minimal satu jenis data.', 'warning'); return null; }
  return { sumber: sumber, sheets: sheets, timpa: $('#mgTimpa').checked, dryRun: dry };
}
function renderHasilImport(d) {
  const nama = {}; SHEET_IMPORT.forEach(s => { nama[s[0]] = s[1]; });
  $('#mgHasil').innerHTML = '<div class="notice ' + (d.dryRun ? '' : 'ok') + '" style="' + (d.dryRun ? '' : 'background:var(--green-soft);border-left-color:var(--green)') + '"><i class="bi ' + (d.dryRun ? 'bi-eye' : 'bi-check2-circle') + '" aria-hidden="true"></i><div class="small">' +
    (d.dryRun ? '<b>Hasil pindai</b> — belum ada data yang ditulis.' : '<b>Import selesai.</b>') + ' Sumber: <b>' + esc(d.source.nama) + '</b></div></div>' +
    '<div class="table-wrap mt-2"><table class="tablex"><thead><tr><th>Data</th><th class="text-end">Di sumber</th><th class="text-end">Ditambah</th><th class="text-end">Diperbarui</th><th class="text-end">Dilewati</th></tr></thead><tbody>' +
    Object.keys(d.report).map(k => { const r = d.report[k]; return '<tr><td>' + esc(nama[k] || k) + '</td><td class="text-end mono">' + esc(r.source) + '</td><td class="text-end mono" style="color:var(--green)">' + r.inserted + '</td><td class="text-end mono">' + r.updated + '</td><td class="text-end mono text-secondary-x">' + r.skipped + '</td></tr>'; }).join('') +
    '</tbody></table></div>' +
    (d.warnings.length ? '<div class="small fw-semibold mt-3 mb-1"><i class="bi bi-exclamation-triangle" style="color:var(--gold-dark)"></i> Peringatan (' + d.warnings.length + ')</div><ul class="small ps-3 mb-0" style="max-height:220px;overflow:auto">' +
      d.warnings.slice(0, 200).map(w => '<li>' + esc(w) + '</li>').join('') + '</ul>' : '<div class="small text-secondary-x mt-2">Tidak ada peringatan.</div>');
}
AKSI.mgPindai = async (el) => {
  const o = opsiImport(true); if (!o) return;
  await denganTombol(el, async () => { try { const r = await api('importData', o); renderHasilImport(r.data); } catch (e) { tanganiGalat(e, 'Pindai gagal'); } });
};
AKSI.mgJalan = async (el) => {
  const o = opsiImport(false); if (!o) return;
  const ok = await konfirmasi({ judul: 'Jalankan import', okTeks: 'Ya, import', okKelas: 'btn-gold',
    pesan: 'Data akan ditulis ke database app ini (' + o.sheets.length + ' jenis data' + (o.timpa ? ', <b>menimpa</b> data yang ada' : ', data yang ada tidak ditimpa') + ').<br><span class="small text-secondary-x">Disarankan klik <b>Buat cadangan sekarang</b> terlebih dahulu.</span>' });
  if (!ok) return;
  await denganTombol(el, async () => {
    try { const r = await api('importData', o); renderHasilImport(r.data); toast('Import selesai', r.message, 'success'); AppState.tulisTerakhir = Date.now(); }
    catch (e) { tanganiGalat(e, 'Import gagal'); }
  });
};
AKSI.bkBuat = async (el) => {
  await denganTombol(el, async () => { try { const r = await api('buatBackup'); toast('Cadangan dibuat', r.message, 'success'); await SEGARKAN.migrasi(); } catch (e) { tanganiGalat(e); } });
};
AKSI.bkUnduh = async (el) => {
  await denganTombol(el, async () => {
    try { const r = await api('unduhBackupXlsx', el.dataset.id || ''); unduhBlob(base64KeBlob(r.data.base64, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), r.data.namaFile); toast('Diunduh', r.data.namaFile, 'success'); }
    catch (e) { tanganiGalat(e, 'Unduh gagal'); }
  });
};
AKSI.bkAtur = async (el) => {
  const n = Number($('#mgSimpan').value);
  await denganTombol(el, async () => { try { const r = await api('aturBackup', { simpan: n }); toast('Tersimpan', r.message, 'success'); } catch (e) { tanganiGalat(e); } });
};
AKSI.bkPulihkan = (el) => {
  $('#mgSumber').value = el.dataset.id;
  SHEET_IMPORT.forEach(s => { $('#mgS_' + s[0]).checked = ['Petugas', 'HP', 'Izin_Bawa_HP', 'Log_Titip', 'CRM_Kontak'].indexOf(s[0]) >= 0; });
  $('#mgTimpa').checked = true;
  $('#mgHasil').innerHTML = '<div class="notice"><i class="bi bi-life-preserver" aria-hidden="true"></i><div class="small"><b>Mode pemulihan.</b> Data yang hilang/terhapus dikembalikan dari cadangan dan data yang ada disamakan (opsi timpa aktif). Data yang dibuat setelah cadangan <b>tidak</b> dihapus. Klik <b>Pindai</b> dulu untuk melihat dampaknya.</div></div>';
  $('#kartuImport').scrollIntoView({ block: 'start', behavior: geraklah() ? 'smooth' : 'auto' });
  $('#mgSumber').focus({ preventScroll: true });
};
