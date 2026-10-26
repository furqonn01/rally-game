import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteSingleFile } from 'vite-plugin-singlefile';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MODEL_REL = 'models/BAIC+BJ40.glb';
const MODEL_ABS = path.resolve(ROOT, MODEL_REL);

/**
 * Model kendaraan ada di `models/` (bukan `public/`), jadi Vite tidak menyalinnya.
 * Plugin ini menaruhnya di folder output supaya build tetap bisa memuat mobil.
 */
function copyVehicleModel({ outDir, skip }) {
  return {
    name: 'bj40:copy-vehicle-model',
    apply: 'build',
    closeBundle() {
      if (skip) return; // pada mode satu file, model sudah ditanam di HTML
      if (!fs.existsSync(MODEL_ABS)) {
        this.warn(`Model tidak ditemukan: ${MODEL_ABS} — jalankan "npm run compress:model" dulu.`);
        return;
      }
      const dest = path.resolve(ROOT, outDir, MODEL_REL);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(MODEL_ABS, dest);
      const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(2);
      console.log(`\n  ${MODEL_REL} disalin ke ${outDir} (${mb} MB)`);
    },
  };
}

/**
 * `import VEHICLE_URL from 'virtual:vehicle-url'`
 *
 * - Build biasa  : URL relatif ke file model (bisa di-precache service worker).
 * - Build 1 file : data URL base64, supaya game jalan dari file:// tanpa server.
 */
function vehicleUrlPlugin({ inline }) {
  const VIRTUAL_ID = 'virtual:vehicle-url';
  const RESOLVED = '\0' + VIRTUAL_ID;

  return {
    name: 'bj40:vehicle-url',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;

      if (inline) {
        if (!fs.existsSync(MODEL_ABS)) {
          this.error(`Model tidak ditemukan: ${MODEL_ABS} — jalankan "npm run compress:model" dulu.`);
        }
        const b64 = fs.readFileSync(MODEL_ABS).toString('base64');
        return `export default 'data:model/gltf-binary;base64,${b64}';`;
      }

      // BASE_URL diakhiri '/', jadi hasilnya selalu relatif terhadap dokumen.
      return (
        'export default new URL(import.meta.env.BASE_URL + ' +
        JSON.stringify(MODEL_REL) +
        ', document.baseURI).href;'
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  // `npm run build:offline` → mode "singlefile": satu index.html, tanpa server.
  const singleFile = mode === 'singlefile';
  const outDir = singleFile ? 'dist-offline' : 'dist';

  return {
    // Relatif: game tetap jalan di sub-folder (mis. GitHub Pages) maupun file://.
    base: './',

    server: {
      host: true, // bisa dibuka dari HP lewat Wi-Fi yang sama
      port: 5173,
    },
    preview: {
      host: true,
      port: 4173,
    },

    build: {
      outDir,
      target: 'es2020',
      chunkSizeWarningLimit: 1500,
      assetsInlineLimit: singleFile ? 0 : 4096,
      cssCodeSplit: !singleFile,
    },

    define: {
      // Dipakai src/pwa.js untuk melewati registrasi SW pada build satu file.
      __BJ40_SINGLE_FILE__: JSON.stringify(singleFile),
    },

    plugins: [
      vehicleUrlPlugin({ inline: singleFile }),
      copyVehicleModel({ outDir, skip: singleFile }),

      // Service worker + precache hanya untuk build PWA (butuh HTTPS/localhost).
      !singleFile &&
        VitePWA({
          registerType: 'autoUpdate',
          injectRegister: null, // registrasi manual di src/pwa.js
          manifest: false, // memakai public/manifest.webmanifest
          // Ikon sudah tercakup globPatterns di bawah; mendaftarkannya lagi lewat
          // includeAssets hanya menghasilkan entri precache duplikat.
          workbox: {
            globPatterns: ['**/*.{js,css,html,glb,png,svg,webmanifest}'],
            // Model mobil ~1.9 MB; batas default Workbox 2 MiB terlalu mepet.
            maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
            cleanupOutdatedCaches: true,
            clientsClaim: true,
            skipWaiting: true,
            navigateFallback: 'index.html',
            navigateFallbackDenylist: [/\/sw\.js$/, /\/manifest\.webmanifest$/],
          },
          devOptions: {
            enabled: false, // uji offline pakai `npm run build && npm run preview`
          },
        }),

      singleFile &&
        viteSingleFile({
          removeViteModuleLoader: true,
          useRecommendedBuildConfig: true,
        }),
    ].filter(Boolean),
  };
});
