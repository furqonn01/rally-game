# Model BAIC BJ40

`BAIC+BJ40.glb` dikompresi dari 34,27 MB (35.931.520 B) menjadi 1,88 MB
(1.965.636 B) — sekitar 18× lebih kecil — memakai
[gltfpack](https://github.com/zeux/meshoptimizer/tree/master/gltf) (meshoptimizer).

## Pipeline

```bash
npm run compress:model
```

Setara dengan:

```bash
gltfpack -i models/BAIC+BJ40.original.glb -o models/BAIC+BJ40.glb \
         -cc -kn -vpf -vtf -vnf
```

Arti flag (semuanya penting, jangan dihapus tanpa alasan):

| Flag   | Fungsi | Kenapa wajib |
| ------ | ------ | ------------ |
| `-cc`  | Kompresi maksimum (meshopt + kuantisasi agresif) | Ukuran terkecil yang tetap aman |
| `-kn`  | Pertahankan nama node | `vehicle.js` mencari roda lewat `scene.getObjectByName()` |
| `-vpf` | Posisi vertex tetap float32 | `splitWheelMesh()` mengklasifikasi segitiga pakai koordinat asli |
| `-vtf` | Texcoord tetap float32 | Menghindari artefak UV pada tekstur mobil |
| `-vnf` | Normal tetap float32 | Hindari banding pada bodi mengkilap |

## Jebakan: jangan pakai kuantisasi posisi

Kalau `-vpf` dihilangkan (atau memakai `@gltf-transform` dengan transform
`meshopt`/`quantize`), gltfpack akan mengubah POSITION menjadi `int16`
ternormalisasi dan memindahkan skala asli ke transform node. three.js
`BufferAttribute.getX()` menormalisasi ulang nilai tersebut, sehingga
`splitWheelMesh()` menerima koordinat ~-1..1 alih-alih meter lokal model.
Akibatnya **semua segitiga roda masuk ke bucket "sisa"** dan keempat roda
hilang dari animasi (mobil bergerak tanpa roda berputar).

Hasil klasifikasi yang benar untuk mesh roda:

```
black_wheel  [7658, 7658, 7658, 7658, 7658]
black_1_0_1  [5190, 5190, 4702, 5190, 5126]
tyre         [ 936,  936,  936,  936,  936]
shachepan    [ 100,  100,  100,  100,    0]
lights_0_0   [1046, 1046, 1046, 1046,    0]
```

Urutan bucket: `[kiri-depan, kanan-depan, kiri-belakang, kanan-belakang, sisa]`.

## Decoder runtime

Hasil kompresi memakai `EXT_meshopt_compression`, jadi `src/vehicle.js` wajib
mendaftarkan decoder sebelum memuat model:

```js
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
loader.setMeshoptDecoder(MeshoptDecoder);
```

Decoder di-bundle oleh Vite, tidak ada request tambahan saat runtime.

## Mengembalikan model asli

Versi 34 MB masih tersimpan di riwayat git:

```bash
git log --oneline -- models/BAIC+BJ40.glb
git show <commit-sebelum-kompresi>:models/BAIC+BJ40.glb > models/BAIC+BJ40.original.glb
```
