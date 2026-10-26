// ---------------------------------------------------------------------------
// Tombol "PASANG GAME INI" untuk PWA.
//
// Chrome/Edge/Android memicu event sebelum-pasang (beforeinstallprompt) yang
// bisa kita tahan dan tampilkan sebagai tombol. Safari/iOS tidak mendukung
// event itu, jadi di sana kita hanya menampilkan petunjuk manual.
//
// Penting: pemasangan offline HANYA berguna di origin aman (HTTPS/localhost).
// Di origin tidak aman (mis. http://192.168.1.10:4173) service worker tidak
// bisa didaftarkan, jadi tidak ada satu byte pun yang disimpan ke cache.
// Kalau kita tetap menawarkan tombol pasang di sana, hasilnya adalah ikon di
// layar utama yang membuka halaman kosong begitu server dimatikan. Karena itu
// di origin tidak aman tombolnya disembunyikan dan kita tampilkan penjelasan.
// ---------------------------------------------------------------------------

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.navigator.standalone === true
  );
}

function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ memakai user agent desktop, jadi deteksi lewat sentuhan.
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return /iPhone|iPod/.test(ua) || ipad;
}

// Origin aman = syarat mutlak service worker (dan jadi syarat pasang offline).
export function isSecureOrigin() {
  if (typeof location === 'undefined') return true;
  const { protocol, hostname } = location;
  if (protocol === 'https:' || protocol === 'chrome-extension:') return true;
  const local = ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'];
  return local.indexOf(hostname) !== -1;
}

export function setupInstall({ button, hint }) {
  if (typeof window === 'undefined') return { refresh() {} };

  // Petunjuk punya beberapa varian; markup di index.html menandainya dengan
  // [data-hint]. Hanya satu yang ditampilkan pada satu waktu.
  const parts = hint ? Array.prototype.slice.call(hint.querySelectorAll('[data-hint]')) : [];

  const setHint = (kind) => {
    if (!hint) return;
    hint.hidden = !kind;
    if (kind === 'insecure') hint.setAttribute('data-warn', '');
    else hint.removeAttribute('data-warn');
    for (const part of parts) {
      if (part.dataset.hint === kind) part.removeAttribute('hidden');
      else part.setAttribute('hidden', '');
    }
  };

  const hideAll = () => {
    if (button) button.hidden = true;
    if (hint) hint.hidden = true;
  };

  // Build satu file / game yang sudah terpasang tidak perlu tombol pasang.
  if (__BJ40_SINGLE_FILE__ || isStandalone()) {
    hideAll();
    return { refresh() {} };
  }

  // Origin tidak aman: pasang offline mustahil. Jangan berbohong ke pemain.
  if (!isSecureOrigin()) {
    if (button) button.hidden = true;
    setHint('insecure');
    const originEl = document.getElementById('installOrigin');
    if (originEl) originEl.textContent = location.host || location.origin;
    return {
      refresh() {
        if (button) button.hidden = true;
        setHint('insecure');
      },
    };
  }

  let deferred = null;
  let canPrompt = false;

  const show = () => {
    if (button) button.hidden = !canPrompt;
    // Petunjuk manual hanya untuk iOS (tidak punya beforeinstallprompt).
    setHint(isIOS() && !canPrompt ? 'ios' : '');
  };

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    canPrompt = true;
    show();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    canPrompt = false;
    hideAll();
  });

  if (button) {
    button.addEventListener('click', async () => {
      if (!deferred) return;
      button.disabled = true;
      try {
        deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice && choice.outcome === 'accepted') hideAll();
      } catch (err) {
        console.warn('[install] gagal menampilkan dialog pasang:', err);
      } finally {
        deferred = null;
        canPrompt = false;
        button.disabled = false;
        button.hidden = true;
      }
    });
  }

  return {
    // Dipanggil tiap kali menu utama dibuka agar status tombol ikut segar.
    refresh() {
      if (isStandalone()) {
        hideAll();
        return;
      }
      show();
    },
  };
}
