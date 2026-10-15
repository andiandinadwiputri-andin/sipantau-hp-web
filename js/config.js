/* ============================================================
   SIPANTAU-HP — KONFIGURASI FRONTEND
   ⚠️ SATU-SATUNYA file yang WAJIB Anda ubah sebelum push ke GitHub.
   ============================================================

   GAS_URL = URL Web App dari Google Apps Script (Terapkan → Deployment baru →
   Aplikasi web → Jalankan sebagai: Saya, Akses: Siapa saja). Bentuknya:
   https://script.google.com/macros/s/AKfycb........./exec

   File ini aman dipublikasikan: URL /exec memang alamat publik, tidak berisi
   kata sandi. Keamanan data dijaga oleh login NIP + kata sandi di server.
*/
window.SIPANTAU_CONFIG = {
  GAS_URL: https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnRtoDZRD0iBZdWUnAw25pEBuev--1kEOQb6d3b2WCUIiVWrjknVpcru5kZ3RkIdMvYIXco9B18NV3K77y4zbyfxD3Se7WHLZuhxeP_nLAt4NAR0KGy6lLVHZ8x8n-_iwiPasM1w9S9ZjjfDMyvCDMeeZm7vyXieRehnIf9YMn4PmU3jNZwXkRDGfBuJuSEX4RuO07WoVs874Us-d_lmg9ljDgJuiseJvtDj5w1BFuwHXxROzwKirplSUIJ-1QW4Tt37DvuY-wtZnNtxv68o2PeOmVteOw&lib=Mvy9PJEyFFPlGbSNniSTmCaKsRpcr8Sdm
  // Batas waktu tunggu respons server (milidetik). PDF bulanan bisa butuh ±30 detik.
  API_TIMEOUT_MS: 90000,

  // Naikkan angka ini setiap kali Anda mengunggah versi baru file js/ (memaksa browser memuat ulang modul admin)
  VERSI: '2'
};
