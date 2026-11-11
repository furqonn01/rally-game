import * as THREE from 'three';

/**
 * Kaca Spion Fungsional untuk BAIC BJ40.
 *
 * Mengimplementasikan 3 kaca spion real-time:
 * 1. Spion Tengah (Interior Rearview Mirror):
 *    Terpasang di bagian atas kaca depan di dalam kabin, memantulkan
 *    pemandangan ke belakang melalui kaca belakang mobil.
 * 2. Spion Luar Kiri (Left Side Mirror):
 *    Terpasang di daun pintu kiri, memantulkan sisi bodi kiri dan area belakang.
 * 3. Spion Luar Kanan (Right Side Mirror):
 *    Terpasang di daun pintu kanan, memantulkan sisi bodi kanan dan area belakang.
 *
 * Efisiensi & Performa:
 * - Menggunakan WebGLRenderTarget berukuran ringkas & filter bilinear cepat.
 * - Pembaharuan bergilir (round-robin) saat di mode 'pengemudi': 1 kamera cermin
 *   per frame (~20 fps per cermin pada 60 fps game) untuk memastikan framerate
 *   tetap mulus 60 FPS tanpa beban GPU ganda.
 * - Di mode kamera luar ('mobil' / 'orbit'), pembaharuan diperlambat (setiap 24 frame)
 *   karena cermin hanya berukuran beberapa piksel di kejauhan.
 * - Tekstur dibalik horizontal secara alami (wrapS repeat.x = -1, offset.x = 1)
 *   sesuai optik cermin fisik sesungguhnya.
 */

// Dimensi dan posisi cermin di ruang bodi mobil (mesh-lokal)
const CENTER_POS = new THREE.Vector3(0.000, 1.170, -0.183);
const CENTER_SIZE = { w: 0.222, h: 0.070 };
const CENTER_NORM = new THREE.Vector3(-0.05, -0.03, 0.998).normalize();

const LEFT_POS = new THREE.Vector3(-0.925, 0.880, -0.362);
const LEFT_SIZE = { w: 0.118, h: 0.150 };
const LEFT_NORM = new THREE.Vector3(0.18, 0.00, 0.98).normalize();

const RIGHT_POS = new THREE.Vector3(0.925, 0.880, -0.362);
const RIGHT_SIZE = { w: 0.118, h: 0.150 };
const RIGHT_NORM = new THREE.Vector3(-0.18, 0.00, 0.98).normalize();

// Resolusi render target
const RT_CENTER_W = 384;
const RT_CENTER_H = 192;
const RT_SIDE_W = 192;
const RT_SIDE_H = 256;

export class VehicleMirrors {
  constructor(vehicle) {
    this.vehicle = vehicle;
    this.root = new THREE.Group();
    this.root.name = 'vehicleMirrors';

    this.frameIndex = 0;
    this.lowRateCounter = 0;

    // Vektor temporer untuk efisiensi render loop (tanpa alokasi GC)
    this._vPos = new THREE.Vector3();
    this._vTarget = new THREE.Vector3();
    this._vUp = new THREE.Vector3();
    this._qBody = new THREE.Quaternion();

    // 1. Render Targets dengan pembalikan horizontal (mirror optics)
    const rtOptions = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      colorSpace: THREE.SRGBColorSpace,
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

    // 2. Material Cermin: sedikit berpendar agar pemandangan luar terang di dalam kabin
    const makeMaterial = (rt) => new THREE.MeshStandardMaterial({
      map: rt.texture,
      emissive: 0xffffff,
      emissiveMap: rt.texture,
      emissiveIntensity: 0.92,
      roughness: 0.15,
      metalness: 0.10,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });

    this.matCenter = makeMaterial(this.rtCenter);
    this.matLeft = makeMaterial(this.rtLeft);
    this.matRight = makeMaterial(this.rtRight);

    // Bezel hitam matte untuk rumah cermin
    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0x141618,
      roughness: 0.70,
      metalness: 0.40,
    });

    const _Z = new THREE.Vector3(0, 0, 1);

    // ---- 3. Cermin Tengah ----
    const centerGroup = new THREE.Group();
    centerGroup.position.copy(CENTER_POS);
    centerGroup.quaternion.setFromUnitVectors(_Z, CENTER_NORM);

    const centerBezel = new THREE.Mesh(
      new THREE.BoxGeometry(CENTER_SIZE.w + 0.008, CENTER_SIZE.h + 0.008, 0.006),
      bezelMat
    );
    centerBezel.position.set(0, 0, -0.003);
    centerGroup.add(centerBezel);

    this.centerMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(CENTER_SIZE.w, CENTER_SIZE.h),
      this.matCenter
    );
    this.centerMesh.position.set(0, 0, 0.0005);
    centerGroup.add(this.centerMesh);
    this.root.add(centerGroup);

    // ---- 4. Cermin Samping Kiri ----
    const leftGroup = new THREE.Group();
    leftGroup.position.copy(LEFT_POS);
    leftGroup.quaternion.setFromUnitVectors(_Z, LEFT_NORM);

    const leftBezel = new THREE.Mesh(
      new THREE.BoxGeometry(LEFT_SIZE.w + 0.008, LEFT_SIZE.h + 0.008, 0.006),
      bezelMat
    );
    leftBezel.position.set(0, 0, -0.003);
    leftGroup.add(leftBezel);

    this.leftMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(LEFT_SIZE.w, LEFT_SIZE.h),
      this.matLeft
    );
    this.leftMesh.position.set(0, 0, 0.0005);
    leftGroup.add(this.leftMesh);
    this.root.add(leftGroup);

    // ---- 5. Cermin Samping Kanan ----
    const rightGroup = new THREE.Group();
    rightGroup.position.copy(RIGHT_POS);
    rightGroup.quaternion.setFromUnitVectors(_Z, RIGHT_NORM);

    const rightBezel = new THREE.Mesh(
      new THREE.BoxGeometry(RIGHT_SIZE.w + 0.008, RIGHT_SIZE.h + 0.008, 0.006),
      bezelMat
    );
    rightBezel.position.set(0, 0, -0.003);
    rightGroup.add(rightBezel);

    this.rightMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(RIGHT_SIZE.w, RIGHT_SIZE.h),
      this.matRight
    );
    this.rightMesh.position.set(0, 0, 0.0005);
    rightGroup.add(this.rightMesh);
    this.root.add(rightGroup);

    // ---- 6. Kamera Cermin ----
    this.camCenter = new THREE.PerspectiveCamera(65, RT_CENTER_W / RT_CENTER_H, 0.15, 350);
    this.camLeft = new THREE.PerspectiveCamera(52, RT_SIDE_W / RT_SIDE_H, 0.15, 350);
    this.camRight = new THREE.PerspectiveCamera(52, RT_SIDE_W / RT_SIDE_H, 0.15, 350);
  }

  reset() {
    this.frameIndex = 0;
    this.lowRateCounter = 0;
  }

  update(renderer, scene, camRig) {
    if (!this.vehicle || !this.vehicle.loaded || !this.vehicle.body) return;

    const isDriverMode = camRig && camRig.mode === 'pengemudi';

    // Di luar kabin, cermin jarang diperbaharui untuk menghemat daya GPU
    if (!isDriverMode) {
      this.lowRateCounter++;
      if (this.lowRateCounter < 24) return;
      this.lowRateCounter = 0;
    }

    const prevRenderTarget = renderer.getRenderTarget();

    // Sembunyikan mesh cermin saat render agar tidak memantulkan diri sendiri
    this.root.visible = false;

    // Vektor atas kamera mengikuti kemiringan bodi mobil
    this.vehicle.body.getWorldQuaternion(this._qBody);
    this._vUp.set(0, 1, 0).applyQuaternion(this._qBody);

    // Pilih cermin yang dirender pada frame ini (round-robin saat di kabin)
    const slot = isDriverMode ? (this.frameIndex % 3) : 0;
    this.frameIndex++;

    if (slot === 0 || !isDriverMode) {
      // 1. Spion Tengah: melihat lurus ke belakang melewati jendela kabin
      this._vPos.set(0.000, 1.170, -0.183);
      this.vehicle.body.localToWorld(this._vPos);
      this.camCenter.position.copy(this._vPos);

      this._vTarget.set(0.000, 1.150, 10.0);
      this.vehicle.body.localToWorld(this._vTarget);
      this.camCenter.lookAt(this._vTarget);
      this.camCenter.up.copy(this._vUp);

      renderer.setRenderTarget(this.rtCenter);
      renderer.render(scene, this.camCenter);
    }

    if (slot === 1 || !isDriverMode) {
      // 2. Spion Kiri: melihat ke belakang menyusuri sisi kiri bodi mobil
      this._vPos.set(-0.950, 0.880, -0.360);
      this.vehicle.body.localToWorld(this._vPos);
      this.camLeft.position.copy(this._vPos);

      this._vTarget.set(-1.350, 0.860, 10.0);
      this.vehicle.body.localToWorld(this._vTarget);
      this.camLeft.lookAt(this._vTarget);
      this.camLeft.up.copy(this._vUp);

      renderer.setRenderTarget(this.rtLeft);
      renderer.render(scene, this.camLeft);
    }

    if (slot === 2 || !isDriverMode) {
      // 3. Spion Kanan: melihat ke belakang menyusuri sisi kanan bodi mobil
      this._vPos.set(0.950, 0.880, -0.360);
      this.vehicle.body.localToWorld(this._vPos);
      this.camRight.position.copy(this._vPos);

      this._vTarget.set(1.350, 0.860, 10.0);
      this.vehicle.body.localToWorld(this._vTarget);
      this.camRight.lookAt(this._vTarget);
      this.camRight.up.copy(this._vUp);

      renderer.setRenderTarget(this.rtRight);
      renderer.render(scene, this.camRight);
    }

    this.root.visible = true;
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

