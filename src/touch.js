/**
 * Kontrol sentuh untuk perangkat mobile.
 *
 * Modul ini TIDAK menyimpan state permainan sendiri. Ia hanya menerjemahkan
 * sentuhan pada tombol layar menjadi kode tombol keyboard yang sudah dipakai
 * oleh `main.js` (KeyW/KeyS/KeyA/KeyD/Space), lalu memanggil `readInput()`.
 * Dengan begitu jalur input tetap satu: sama seperti bermain dengan keyboard.
 *
 * Setiap jari dilacak lewat `pointerId`, jadi dua jempol (kemudi + pedal)
 * bisa ditekan bersamaan tanpa saling membatalkan.
 */

/** Tombol yang harus DITAHAN (hold) beserta kode tombol keyboard-nya. */
const HOLD_BUTTONS = [
  { id: 'tcGas', code: 'KeyW' },
  { id: 'tcBrake', code: 'KeyS' },
  { id: 'tcLeft', code: 'KeyA' },
  { id: 'tcRight', code: 'KeyD' },
  { id: 'tcHand', code: 'Space' },
];

/** Getaran singkat sebagai umpan balik taktil (diabaikan bila tak didukung). */
function buzz(ms = 8) {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (err) {
    /* abaikan */
  }
}

/**
 * @param {object} api
 * @param {object}   api.keys        objek state tombol milik main.js
 * @param {Function} api.readInput   sinkronisasi keys -> input
 * @param {object}   api.camRig      rig kamera (untuk tombol ganti kamera)
 * @param {object}   api.audio       audio kendaraan (untuk mute)
 * @param {object}   api.state       state permainan (mode)
 * @param {object}   api.el          referensi elemen HUD
 * @param {Function} api.toast       notifikasi singkat
 * @param {Function} api.respawn     reset kendaraan
 * @param {Function} api.pauseGame
 * @param {Function} api.resumeGame
 * @param {Function} [api.onFirstTouch] dipanggil sekali saat sentuhan pertama
 */
export function initTouch(api) {
  const { keys, readInput } = api;
  const root = document.getElementById('touch');
  if (!root) return { clear: () => {}, isTouch: false };

  const isTouch = document.documentElement.classList.contains('touch');
  let firstTouchDone = false;

  /** pointerId -> { code, btn } */
  const active = new Map();

  function setKey(code, on) {
    keys[code] = on;
    readInput();
  }

  /** Lepas satu pointer (dipakai pointerup / cancel / blur). */
  function release(pointerId, silent = false) {
    const entry = active.get(pointerId);
    if (!entry) return;
    active.delete(pointerId);
    entry.btn.classList.remove('down');
    // Jangan matikan tombol bila jari lain masih menekan tombol yang sama
    // (misal dua jari menekan GAS).
    let stillHeld = false;
    for (const other of active.values()) {
      if (other.code === entry.code) {
        stillHeld = true;
        break;
      }
    }
    if (!stillHeld) setKey(entry.code, false);
    if (!silent) buzz(6);
  }

  /** Lepas semua tombol yang sedang ditahan (dipakai saat blur / jeda). */
  function clear() {
    for (const id of Array.from(active.keys())) release(id, true);
    root.querySelectorAll('button.down').forEach((b) => b.classList.remove('down'));
  }

  // -------------------------------------------------------------------------
  // Tombol tahan (gas / rem / kemudi / rem tangan)
  // -------------------------------------------------------------------------
  for (const def of HOLD_BUTTONS) {
    const btn = document.getElementById(def.id);
    if (!btn) continue;

    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      firstTouch();

      // Bila pointer yang sama sudah memegang tombol lain, lepas dulu.
      if (active.has(e.pointerId)) release(e.pointerId, true);

      active.set(e.pointerId, { code: def.code, btn });
      btn.classList.add('down');
      setKey(def.code, true);
      buzz(10);

      try {
        btn.setPointerCapture(e.pointerId);
      } catch (err) {
        /* abaikan */
      }
    });

    const up = (e) => {
      if (!active.has(e.pointerId)) return;
      e.preventDefault();
      try {
        btn.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* abaikan */
      }
      release(e.pointerId);
    };

    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    // Jaring pengaman: jari terangkat di luar tombol tetap melepas.
    btn.addEventListener('lostpointercapture', (e) => release(e.pointerId, true));

    // Cegah menu konteks / seleksi teks saat menahan tombol.
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // -------------------------------------------------------------------------
  // Tombol ketuk (kamera / suara / reset / jeda)
  // -------------------------------------------------------------------------
  function onTap(id, fn) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      firstTouch();
      btn.classList.add('down');
      buzz(12);
      fn();
    });
    const off = () => btn.classList.remove('down');
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointercancel', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  onTap('tcCam', () => {
    const label = api.camRig.cycle();
    if (api.el.camModeText) api.el.camModeText.textContent = label;
    api.audio.setMode(api.camRig.mode);
    api.toast(label, true);
  });

  onTap('tcMute', () => {
    const muted = api.audio.toggleMute();
    api.toast(muted ? 'SUARA: MATI' : 'SUARA: HIDUP', !muted);
  });

  onTap('tcReset', () => {
    if (api.state.mode === 'playing' || api.state.mode === 'paused') api.respawn();
  });

  onTap('tcPause', () => {
    if (api.state.mode === 'playing') api.pauseGame();
    else if (api.state.mode === 'paused') api.resumeGame();
  });

  // -------------------------------------------------------------------------
  // Sentuhan pertama: buka kunci AudioContext (wajib gesture pengguna)
  // -------------------------------------------------------------------------
  function firstTouch() {
    if (firstTouchDone) return;
    firstTouchDone = true;
    try {
      if (api.audio && api.audio.init) api.audio.init();
    } catch (err) {
      /* abaikan */
    }
    document.body.classList.add('touched');
  }

  // Fallback bila pointer event tidak sampai ke tombol (mis. di tengah layar).
  window.addEventListener(
    'pointerdown',
    () => {
      firstTouch();
    },
    { once: true }
  );

  // Blokir zoom/geser halaman ala iOS pada area kontrol.
  root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  // Lepas semua tombol bila aplikasi kehilangan fokus.
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear();
  });

  return { clear, isTouch };
}
