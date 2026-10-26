# BAIC BJ40 — Petualangan Offroad 🏔️🚙

Game offroad 3D berbasis browser yang dibangun dengan **Three.js** dan **Vite**. Kendarai BAIC BJ40 melintasi perbukitan liar — jelajahi medan sesukamu dalam **Free Roam**, atau balapan melawan waktu melewati seluruh checkpoint dalam **Mode Timer**.

![Three.js](https://img.shields.io/badge/Three.js-r169-black?logo=three.js)
![Vite](https://img.shields.io/badge/Vite-5.4-646CFF?logo=vite)
![License](https://img.shields.io/badge/License-ISC-blue)

---

## ✨ Fitur

- **Model 3D BAIC BJ40** hasil impor GLB dengan material PBR dan refleksi environment map dari langit.
- **Terrain prosedural** 1200 × 1200 unit dengan ketinggian, normal, dan slope yang dihitung real-time.
- **Fisika kendaraan arcade** — akselerasi, pengereman, handbrake, grip lateral, suspensi kosmetik, dan deteksi udara (airborne).
- **Dua mode bermain** — **Free Roam** (tanpa timer & checkpoint, lengkap dengan penghitung jarak) dan **Mode Timer** (10 checkpoint berurutan + rekor waktu). Bisa berganti mode kapan saja lewat menu, jeda, atau layar hasil.
- **Sistem checkpoint** — 10 checkpoint berurutan, respawn ke checkpoint terakhir, dan pencatatan best time (localStorage). Gerbang checkpoint otomatis disembunyikan saat Free Roam.
- **HUD adaptif** — speedometer, indikator gigi/slip, timer/durasi, progres checkpoint atau penghitung jarak (tergantung mode), minimap real-time, dan FPS counter.
- **3 mode kamera** — Kamera Mobil (chase), Kamera Pengemudi (POV kabin), dan Kamera Bebas (orbit).
- **Scenery & efek** — pepohonan, batu, rumput, partikel debu, sky dome atmosferik, dan fog.
- **Suara mesin prosedural** — mesin diesel, kerikil, angin, road hum, dan benturan dibangkitkan lewat Web Audio API (tanpa file audio), dengan **akustik berbeda di dalam kabin vs di luar kabin**.
- **Getaran roda & kamera** — tiap roda berguncang dan bergoyang mengikuti kekasaran medan, dan kamera ikut bergetar (paling keras di POV pengemudi).
- **Kontrol keyboard + mouse** — setir, kamera, dan orbit bebas tanpa perlu pointer lock.

---

## 🎮 Kontrol

| Tombol | Aksi |
| --- | --- |
| `W` / `↑` | Gas / maju |
| `S` / `↓` | Rem & mundur |
| `A` `D` / `←` `→` | Belok kiri / kanan |
| `Space` | Rem tangan (handbrake) |
| `C` | Ganti mode kamera |
| `M` | Suara hidup / mati |
| `R` | Reset kendaraan (ke checkpoint terakhir pada Mode Timer, ke jalur terdekat pada Free Roam) |
| `P` | Jeda / lanjut |
| `Esc` | Kembali ke menu pilih mode |
| `Enter` | Mulai Mode Timer (dari menu/hasil) atau lanjutkan (saat jeda) |
| `Mouse Drag` | Lihat sekeliling |
| `Scroll` | Zoom kamera bebas |

---

## 🕹️ Mode Bermain

Saat game dibuka, kamu memilih salah satu dari dua mode:

| Mode | Isi | HUD |
| --- | --- | --- |
| **Mode 1 — Free Roam** | Tanpa timer dan tanpa checkpoint. Gerbang checkpoint disembunyikan, jadi kamu bebas menjelajahi seluruh medan. | Menampilkan **DURASI** dan **JARAK** tempuh; baris checkpoint & rekor disembunyikan. Peta berlabel *PETA MEDAN*. |
| **Mode 2 — Mode Timer** | Lewati 10 checkpoint berurutan secepat mungkin; waktu terus berjalan dan rekor terbaik disimpan otomatis di browser. | Menampilkan **WAKTU**, **CHECKPOINT**, dan **REKOR**. Peta berlabel *PETA RUTE*. |

Perpindahan mode bisa dilakukan dari tiga tempat:

- **Menu awal** — klik kartu mode yang diinginkan.
- **Layar jeda** (`P`) — tombol **GANTI MODE** untuk kembali ke menu, atau **ULANG MODE INI** untuk mengulang mode aktif.
- **Layar hasil** (setelah 10 checkpoint) — **ULANGI TIMER**, **LANJUT FREE ROAM**, atau **GANTI MODE**.
- Kapan saja saat bermain, tekan **`Esc`** untuk langsung kembali ke menu pilih mode.

---

## 🚀 Menjalankan Secara Lokal

### Prasyarat

- [Node.js](https://nodejs.org/) versi 18 atau lebih baru
- npm (sudah termasuk dalam Node.js)

### Langkah

```bash
# 1. Clone repository
git clone https://github.com/furqonn01/rally-game.git
cd rally-game

# 2. Install dependency
npm install

# 3. Jalankan dev server
npm run dev
```

Buka `http://localhost:5173` di browser.

### Build untuk produksi

```bash
npm run build     # output ke folder dist/
npm run preview   # preview hasil build secara lokal
```

> **Catatan:** folder `models/` berisi file GLB berukuran besar (± 35 MB). Jika proses clone terasa lambat, gunakan `git clone --depth 1`.

---

## 📁 Struktur Proyek

```
FnOffroad/
├── index.html          # Markup HUD, overlay (loading / start / pause / finish), dan styling
├── package.json        # Metadata & dependency proyek
├── models/
│   └── BAIC+BJ40.glb   # Model 3D kendaraan
└── src/
    ├── main.js         # Entry point: renderer, scene, game loop, HUD, input, alur permainan
    ├── terrain.js      # Generator terrain prosedural + helper height/normal/slope
    ├── vehicle.js      # Loader model, fisika kendaraan, roda, suspensi, telemetri
    ├── cameras.js      # CameraRig: mode chase, POV pengemudi, dan orbit bebas
    ├── audio.js        # Suara mesin/kerikil/angin prosedural (Web Audio) + profil kabin vs luar
    ├── track.js        # Kurva jalur, penempatan checkpoint, logika progres & respawn
    └── scenery.js      # Pohon, batu, rumput, dan sistem partikel debu
```

---

## 🧩 Cara Kerja Singkat

1. **Bootstrap** — `main.js` membuat renderer WebGL, scene, langit `Sky`, pencahayaan, dan environment map (PMREM) untuk refleksi bodi mobil.
2. **Dunia** — `Terrain` membangun mesh plane yang dideformasi fungsi ketinggian; `Track` membuat kurva tertutup dan menyebar 10 checkpoint di sepanjang jalur; `Scenery` menempatkan objek dekoratif di luar jalur.
3. **Kendaraan** — `Vehicle` memuat GLB, memecah roda menjadi pivot terpisah, lalu setiap frame menghitung akselerasi, grip lateral (dibatasi `MAX_LAT_ACCEL`), rotasi yaw, dan suspensi.
4. **Game loop** — input dibaca dari keyboard, fisika di-update, lalu HUD & minimap digambar ulang dan scene dirender. Pada **Mode Timer**, tabrakan checkpoint diperiksa setiap frame; pada **Free Roam**, pemeriksaan checkpoint dilewati dan jarak tempuh diakumulasi (`JARAK`).
5. **Suara & getaran** — `VehicleAudio` menyintesis mesin diesel (3 osilator + modulasi pembakaran), kerikil, angin, road hum, dan benturan; profil filter berubah otomatis antara kabin dan luar kabin. `Vehicle` juga menghitung kekasaran medan untuk mengguncang tiap roda dan menggetarkan kamera.

---

## 🛠️ Teknologi

- [Three.js](https://threejs.org/) — rendering 3D berbasis WebGL
- [Vite](https://vitejs.dev/) — dev server & bundler
- HTML5 Canvas 2D — untuk minimap
- Web Storage API — untuk menyimpan best time

---

## 🙏 Credits

### Model 3D Mobil

Model kendaraan **BAIC BJ40** dibuat oleh **DigitalArt3D**.

- Designer: **[DigitalArt3D di CGTrader](https://www.cgtrader.com/designers/digitalart3d?utm_source=credit&utm_source=credit_item_page)**
- Sumber: [CGTrader](https://www.cgtrader.com/)

Terima kasih kepada DigitalArt3D atas karya model yang luar biasa ini. Silakan kunjungi halaman designer untuk melihat karya 3D lainnya dan mendukung pembuatnya.

### Library & Aset Lain

- **Three.js** — MIT License, © Three.js Authors
- **Vite** — MIT License, © VoidZero Inc. & Vite Contributors

---

## 📄 Lisensi

Kode proyek ini dirilis di bawah **ISC License**.

> ⚠️ **Penting:** Lisensi ISC **hanya berlaku untuk kode sumber**. Model 3D `BAIC+BJ40.glb` adalah karya pihak ketiga milik **DigitalArt3D** dan **tidak** tercakup dalam lisensi ini. Penggunaan ulang, redistribusi, atau penggunaan komersial atas model tersebut tunduk pada lisensi dan syarat dari pembuatnya di CGTrader.
