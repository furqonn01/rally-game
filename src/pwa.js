// ---------------------------------------------------------------------------
// Registrasi service worker (mode offline / install PWA).
//
// Service worker hanya boleh jalan di HTTPS atau localhost, dan tidak bisa
// dipakai saat game dibuka langsung dari file:// — jadi registrasinya dijaga.
// ---------------------------------------------------------------------------

import { isSecureOrigin } from './install.js';

export function registerServiceWorker(onUpdate) {
  if (typeof window === 'undefined') return;
  // Build satu file (dist-offline) tidak menyertakan service worker.
  if (__BJ40_SINGLE_FILE__) return;
  if (!import.meta.env.PROD) return;

  // Origin tidak aman (mis. http://192.168.1.10:4173): browser melarang service
  // worker, jadi tidak ada yang bisa disimpan untuk mode offline. Jangan diam
  // saja — beri tahu pengembang dan pemain supaya tidak bingung kenapa hasil
  // pasangnya kosong.
  if (!isSecureOrigin()) {
    console.warn(
      '[pwa] Origin tidak aman (' + window.location.origin + '). Service worker tidak bisa ' +
        'didaftarkan sehingga game TIDAK bisa dipasang/dimainkan offline. ' +
        'Gunakan HTTPS atau localhost.'
    );
    return;
  }

  if (!('serviceWorker' in navigator)) {
    console.warn('[pwa] Browser ini tidak mendukung service worker; mode offline tidak aktif.');
    return;
  }

  const swUrl = new URL('sw.js', document.baseURI).href;

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(swUrl, { scope: './' })
      .then((reg) => {
        // Versi baru siap dipakai: beri tahu pemain, lalu aktifkan saat aman.
        reg.addEventListener('updatefound', () => {
          const fresh = reg.installing;
          if (!fresh) return;
          fresh.addEventListener('statechange', () => {
            if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
              if (typeof onUpdate === 'function') onUpdate(() => fresh.postMessage({ type: 'SKIP_WAITING' }));
            }
          });
        });

        // Cek pembaruan tiap 30 menit selama game terbuka.
        setInterval(() => reg.update().catch(() => {}), 30 * 60 * 1000);
      })
      .catch((err) => {
        console.warn('[pwa] service worker gagal didaftarkan:', err);
      });

    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}
