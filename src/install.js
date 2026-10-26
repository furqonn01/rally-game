// ---------------------------------------------------------------------------
// Tombol "PASANG GAME INI" untuk PWA.
//
// Chrome/Edge/Android memicu event sebelum-pasang (beforeinstallprompt) yang
// bisa kita tahan dan tampilkan sebagai tombol. Safari/iOS tidak mendukung
// event itu, jadi di sana kita hanya menampilkan petunjuk manual.
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

export function setupInstall({ button, hint }) {
  if (typeof window === 'undefined') return { refresh() {} };

  // Build satu file / game yang sudah terpasang tidak perlu tombol pasang.
  if (__BJ40_SINGLE_FILE__ || isStandalone()) {
    if (button) button.hidden = true;
    if (hint) hint.hidden = true;
    return { refresh() {} };
  }

  let deferred = null;
  let canPrompt = false;

  const show = () => {
    if (!button && !hint) return;
    if (button && canPrompt) button.hidden = false;
    // Petunjuk manual hanya untuk iOS (tidak punya beforeinstallprompt).
    if (hint) hint.hidden = !(isIOS() && !canPrompt);
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
    if (button) button.hidden = true;
    if (hint) hint.hidden = true;
  });

  if (button) {
    button.addEventListener('click', async () => {
      if (!deferred) return;
      button.disabled = true;
      try {
        deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice && choice.outcome === 'accepted' && hint) hint.hidden = true;
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
        if (button) button.hidden = true;
        if (hint) hint.hidden = true;
        return;
      }
      show();
    },
  };
}
