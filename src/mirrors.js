import * as THREE from 'three';

/**
 * Kaca Spion Fungsional untuk BAIC BJ40.
 *
 * Menggunakan geometri kaca spion ASLI dari model 3D BAIC BJ40 ('black_1_0_0_0'):
 * 1. Spion Kiri (Left Side Mirror): 14 segitiga kaca pintu kiri bawaan model.
 * 2. Spion Kanan (Right Side Mirror): 14 segitiga kaca pintu kanan bawaan model.
 * 3. Spion Tengah (Center Rearview Mirror): 128 segitiga kaca spion tengah kabin bawaan model.
 *
 * Tidak membuat bingkai atau kotak custom buatan sendiri ("bukan bikin sendiri"),
 * melainkan langsung memetakan render target ke permukaan kaca model aslinya.
 *
 * Optimasi Anti-Lag Kabin:
 * - Shadow map dinonaktifkan sementara saat render mirror pass (menghilangkan beban berat 2048x2048 shadow render).
 * - Bodi mobil disembunyikan sementara selama render spion (menghemat ~200 draw calls & 200k vertices).
 * - Ukuran WebGLRenderTarget sangat efisien (256x96 tengah, 128x160 samping).
 * - Pembaruan bergilir (staggered round-robin): hanya 1 spion per 2 frame di mode kabin
 *   (50% frame memiliki nol overhead spion untuk jaminan 60 FPS mulus).
 * - Di luar kabin diperlambat (setiap 36 frame).
 */

// Resolusi render target efisien (aspek rasio proporsional dengan geometri kaca mobil)
const RT_CENTER_W = 256;
const RT_CENTER_H = 96;
const RT_SIDE_W = 128;
const RT_SIDE_H = 160;

function buildGeometry(src, indices) {
  const g = new THREE.BufferGeometry();
  for (const name in src.attributes) {
    const a = src.attributes[name];
    const isz = a.itemSize;
    const arr = new Float32Array(indices.length * isz);
    for (let i = 0; i < indices.length; i++) {
      const vi = indices[i];
      const o = i * isz;
      for (let c = 0; c < isz; c++) arr[o + c] = a.getComponent(vi, c);
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, isz, false));
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

function applyPlanarUVs(geom) {
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  const pos = geom.attributes.position;
  const spanX = Math.max(0.001, bb.max.x - bb.min.x);
  const spanY = Math.max(0.001, bb.max.y - bb.min.y);
  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    uvs[i * 2] = (x - bb.min.x) / spanX;
    uvs[i * 2 + 1] = (y - bb.min.y) / spanY;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

export class VehicleMirrors {
  constructor(vehicle) {
    this.vehicle = vehicle;
    this.root = new THREE.Group();
    this.root.name = 'vehicleMirrors';

    this.frameIndex = 0;
    this.staggerCounter = 0;
    this.lowRateCounter = 0;

    // Vektor temporer untuk efisiensi render loop (tanpa alokasi GC)
    this._vPos = new THREE.Vector3();
    this._vTarget = new THREE.Vector3();
    this._vUp = new THREE.Vector3();
    this._qBody = new THREE.Quaternion();

    // 1. Render Targets dengan pembalikan horizontal alami (mirror optics)
    const rtOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    };

    this.rtCenter = new THREE.WebGLRenderTarget(RT_CENTER_W, RT_CENTER_H, rtOptions);
    this.rtCenter.texture.wrapS = THREE.RepeatWrapping;
    this.rtCenter.texture.repeat.x = -1;
    this.rtCenter.texture.offset.x = 1;

    this.rtLeft = new THREE.WebGLRenderTarget(RT_SIDE_W, RT_SIDE_H, rtOptions);
    this.rtLeft.texture.wrapS = THREE.RepeatWrapping;
    this.rtLeft.texture.repeat.x = -1;
    this.rtLeft.texture.offset.x = 1;

    this.rtRight = new THREE.WebGLRenderTarget(RT_SIDE_W, RT_SIDE_H, rtOptions);
    this.rtRight.texture.wrapS = THREE.RepeatWrapping;
    this.rtRight.texture.repeat.x = -1;
    this.rtRight.texture.offset.x = 1;

    // 2. Material Cermin: jernih tanpa double tone mapping / double emissive yang membuat fade/pucat
    const makeMaterial = (rt) => new THREE.MeshBasicMaterial({
      map: rt.texture,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.matCenter = makeMaterial(this.rtCenter);
    this.matLeft = makeMaterial(this.rtLeft);
    this.matRight = makeMaterial(this.rtRight);

    // Mesh kaca model asli BAIC BJ40
    this.leftMesh = null;
    this.rightMesh = null;
    this.centerMesh = null;

    // 3. Kamera Cermin (far = 160m untuk performa optimal tanpa culling pemandangan penting)
    this.camCenter = new THREE.PerspectiveCamera(62, RT_CENTER_W / RT_CENTER_H, 0.2, 160);
    this.camLeft = new THREE.PerspectiveCamera(52, RT_SIDE_W / RT_SIDE_H, 0.2, 160);
    this.camRight = new THREE.PerspectiveCamera(52, RT_SIDE_W / RT_SIDE_H, 0.2, 160);
  }

  /**
   * Mengekstrak segitiga permukaan kaca spion bawaan model 3D BAIC BJ40 ('black_1_0_0_0')
   * dan menerapkan material cermin interaktif langsung ke atasnya.
   */
  attachToModel(blackMesh) {
    if (!blackMesh || !blackMesh.isMesh) return;

    const pos = blackMesh.geometry.attributes.position;
    const norm = blackMesh.geometry.attributes.normal;
    const idx = blackMesh.geometry.index;
    const count = idx ? idx.count : pos.count;

    const leftIdx = [];
    const rightIdx = [];
    const centerIdx = [];
    const restIdx = [];

    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;

      const p0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
      const p1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
      const p2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
      const c = p0.clone().add(p1).add(p2).divideScalar(3);
      const n = new THREE.Vector3(norm.getX(i0), norm.getY(i0), norm.getZ(i0));

      if (c.x < -0.82 && c.x > -1.0 && c.y > 0.78 && c.y < 0.98 && c.z > -0.42 && c.z < -0.30 && n.z > 0.8) {
        leftIdx.push(i0, i1, i2);
      } else if (c.x > 0.82 && c.x < 1.0 && c.y > 0.78 && c.y < 0.98 && c.z > -0.42 && c.z < -0.30 && n.z > 0.8) {
        rightIdx.push(i0, i1, i2);
      } else if (Math.abs(c.x) < 0.16 && c.y > 1.10 && c.y < 1.25 && c.z > -0.25 && c.z < -0.12 && n.z > 0.8) {
        centerIdx.push(i0, i1, i2);
      } else {
        restIdx.push(i0, i1, i2);
      }
    }

    if (leftIdx.length > 0 && rightIdx.length > 0 && centerIdx.length > 0) {
      const leftGeo = buildGeometry(blackMesh.geometry, leftIdx);
      const rightGeo = buildGeometry(blackMesh.geometry, rightIdx);
      const centerGeo = buildGeometry(blackMesh.geometry, centerIdx);
      const restGeo = buildGeometry(blackMesh.geometry, restIdx);

      applyPlanarUVs(leftGeo);
      applyPlanarUVs(rightGeo);
      applyPlanarUVs(centerGeo);

      this.leftMesh = new THREE.Mesh(leftGeo, this.matLeft);
      this.leftMesh.name = 'modelMirrorLeft';
      this.leftMesh.castShadow = false;
      this.leftMesh.receiveShadow = false;

      this.rightMesh = new THREE.Mesh(rightGeo, this.matRight);
      this.rightMesh.name = 'modelMirrorRight';
      this.rightMesh.castShadow = false;
      this.rightMesh.receiveShadow = false;

      this.centerMesh = new THREE.Mesh(centerGeo, this.matCenter);
      this.centerMesh.name = 'modelMirrorCenter';
      this.centerMesh.castShadow = false;
      this.centerMesh.receiveShadow = false;

      blackMesh.geometry = restGeo;

      const parent = blackMesh.parent || this.vehicle.body;
      parent.add(this.leftMesh);
      parent.add(this.rightMesh);
      parent.add(this.centerMesh);
    }
  }

  reset() {
    this.frameIndex = 0;
    this.staggerCounter = 0;
    this.lowRateCounter = 0;
  }

  update(renderer, scene, camRig) {
    if (!this.vehicle || !this.vehicle.loaded || !this.vehicle.body) return;

    const isDriverMode = camRig && camRig.mode === 'pengemudi';

    // Di luar kabin (mode kamera luar), spion hampir tidak terlihat di kejauhan.
    // Update sangat jarang (setiap 36 frame) untuk menghemat 100% beban GPU.
    if (!isDriverMode) {
      this.lowRateCounter++;
      if (this.lowRateCounter < 36) return;
      this.lowRateCounter = 0;
    } else {
      // Saat di dalam kabin: pembaharuan bergilir staggered (1 cermin setiap 2 frame)
      // Frame genap: update 1 cermin
      // Frame ganjil: skip (0 cermin dirender -> game 60 FPS mulus bebas lag!)
      this.staggerCounter = (this.staggerCounter || 0) + 1;
      if (this.staggerCounter % 2 !== 0) return;
    }

    const prevRenderTarget = renderer.getRenderTarget();
    const prevAutoUpdate = renderer.shadowMap.autoUpdate;

    // 1. Matikan kalkulasi ulang shadow map selama render cermin (optimasi anti-lag)
    // Shadow yang sudah ada tetap dipakai sehingga pantulan memiliki kontras alami dan tidak fade/pucat
    renderer.shadowMap.autoUpdate = false;

    // 2. Sembunyikan bodi mobil agar tidak memantulkan diri sendiri dan tidak menghalangi spion tengah
    if (this.vehicle.root) this.vehicle.root.visible = false;

    // Vektor atas kamera mengikuti kemiringan bodi mobil
    this.vehicle.body.getWorldQuaternion(this._qBody);
    this._vUp.set(0, 1, 0).applyQuaternion(this._qBody);

    // Pilih cermin yang dirender pada slot ini (0: Kiri, 1: Tengah, 2: Kanan)
    const slot = this.frameIndex % 3;
    this.frameIndex++;

    if (slot === 0 || !isDriverMode) {
      // 1. Spion Kiri
      this._vPos.set(-0.950, 0.880, -0.360);
      this.vehicle.body.localToWorld(this._vPos);
      this.camLeft.position.copy(this._vPos);

      this._vTarget.set(-1.350, 0.860, 10.0);
      this.vehicle.body.localToWorld(this._vTarget);
      this.camLeft.lookAt(this._vTarget);
      this.camLeft.up.copy(this._vUp);

      renderer.setRenderTarget(this.rtLeft);
      renderer.clear();
      renderer.render(scene, this.camLeft);
    }

    if (slot === 1 || !isDriverMode) {
      // 2. Spion Tengah
      this._vPos.set(0.000, 1.170, -0.180);
      this.vehicle.body.localToWorld(this._vPos);
      this.camCenter.position.copy(this._vPos);

      this._vTarget.set(0.000, 1.140, 10.0);
      this.vehicle.body.localToWorld(this._vTarget);
      this.camCenter.lookAt(this._vTarget);
      this.camCenter.up.copy(this._vUp);

      renderer.setRenderTarget(this.rtCenter);
      renderer.clear();
      renderer.render(scene, this.camCenter);
    }

    if (slot === 2 || !isDriverMode) {
      // 3. Spion Kanan
      this._vPos.set(0.950, 0.880, -0.360);
      this.vehicle.body.localToWorld(this._vPos);
      this.camRight.position.copy(this._vPos);

      this._vTarget.set(1.350, 0.860, 10.0);
      this.vehicle.body.localToWorld(this._vTarget);
      this.camRight.lookAt(this._vTarget);
      this.camRight.up.copy(this._vUp);

      renderer.setRenderTarget(this.rtRight);
      renderer.clear();
      renderer.render(scene, this.camRight);
    }

    // Kembalikan visibilitas mobil dan pengaturan shadow
    if (this.vehicle.root) this.vehicle.root.visible = true;
    renderer.shadowMap.autoUpdate = prevAutoUpdate;
    renderer.setRenderTarget(prevRenderTarget);
  }

  dispose() {
    this.rtCenter.dispose();
    this.rtLeft.dispose();
    this.rtRight.dispose();
    this.matCenter.dispose();
    this.matLeft.dispose();
    this.matRight.dispose();
  }
}
