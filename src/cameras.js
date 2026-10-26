import * as THREE from 'three';
import { terrainHeight } from './terrain.js';

export const CAM_MODES = [
  { id: 'mobil', label: 'KAMERA: MOBIL' },
  { id: 'pengemudi', label: 'KAMERA: PENGEMUDI' },
  { id: 'orbit', label: 'KAMERA: BEBAS' },
];

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _qBody = new THREE.Quaternion();
const _qLook = new THREE.Quaternion();
const _qVib = new THREE.Quaternion();
const _vUp = new THREE.Vector3();
const _vUpT = new THREE.Vector3();
const _vAxis = new THREE.Vector3();
const _qUp = new THREE.Quaternion();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
const _eVib = new THREE.Euler(0, 0, 0, 'YXZ');

// Sudut pandang POV pengemudi dimiringkan sedikit ke bawah (radian, negatif =
// lihat ke bawah) supaya cincin setir masuk ke bagian bawah frame. Tanpa ini
// setir berada ~57° di bawah sumbu pandang dan tidak terlihat sama sekali.
const PITCH_BIAS = -0.1;

// ================= penyetelan getaran =================
// Semua fase di bawah MAJU SEBANDING JARAK TEMPUH, bukan waktu absolut. Jadi
// frekuensi getaran otomatis naik saat mobil cepat dan berhenti saat mobil
// diam — inilah yang membuat getaran tidak terasa seperti metronom.
// Frekuensi buzz TIDAK dipatok dalam rad/detik: fase noise maju sebanding
// jarak tempuh, jadi makin cepat mobil makin rapat teksturnya, dan saat mobil
// diam tekstur berhenti total. NOISE_PER_METRE dipilih supaya pada ~65 km/jam
// komponen dasar ada di sekitar 6 Hz (oktaf berikutnya ~10 dan ~15 Hz).
const NOISE_PER_METRE = 0.34;  // unit noise per meter tempuh
const NOISE_RATE_MAX = 7.0;    // batas laju (unit/s) agar tidak lewat Nyquist layar
const SLOW_RATIO = 0.22;       // kanal lambat (ayunan bodi) relatif ke buzz

const BUZZ_ROLL = 0.018;      // rad — road buzz (frekuensi tinggi)
const BUZZ_PITCH = 0.014;
const BUZZ_YAW = 0.0055;

// Ayunan lambat: sasis mengikuti medan secara kaku, jadi tanpa komponen ini
// kepala terasa "dipaku" mati ke bodi. Amplitudo sengaja kecil — ini
// compliance jok/leher, bukan gerakan sasis.
const SWAY_ROLL = 0.0042;     // rad
const SWAY_PITCH = 0.0036;    // rad
const SWAY_HEAVE = 0.0055;    // m
const SWAY_LAT = 0.006;       // m

const RING_W = 9.6;           // rad/s (~1.5 Hz) — pegas suspensi
const RING_Z = 0.42;          // rasio redaman
const RING_ROLL = 0.13;       // rad per (m/s) selisih roda kiri-kanan
const RING_PITCH = 0.052;     // rad per (m/s) selisih roda depan-belakang
const RING_HEAVE = 0.042;     // m per (m/s) hentakan roda

const EXT_LP = 3.4;           // rad/s — tapis tambahan untuk kamera luar
const MAX_ROLL = 0.075;       // rad
const MAX_PITCH = 0.058;      // rad
const MAX_HEAVE = 0.045;      // m

// Sebagian kemiringan medan ditularkan ke sumbu "atas" kamera (0 = horizon
// selalu rata seperti sebelum perbaikan, 1 = horizon ikut sasis penuh).
// 0.7 cukup membuat lereng 21° terbaca miring di layar tanpa memicu mual.
const CAM_UP_BLEND = 0.7;

const clamp = THREE.MathUtils.clamp;

// Satu langkah pegas-peredam orde dua menuju `target`. Dipakai untuk membuat
// getaran punya karakter "hentakan lalu mereda", bukan sinus abadi.
function springStep(s, target, w, z, dt) {
  const acc = (target - s.x) * w * w - s.v * 2 * z * w;
  s.v += acc * dt;
  s.x += s.v * dt;
}

// Noise 1D deterministik (value noise + interpolasi smoothstep).
// Sinus selalu berulang persis, dan itulah yang membuat getaran terasa
// "buatan". Noise memberi tekstur yang tidak pernah mengulang pola sama,
// sehingga tiap gundukan terasa berbeda — seperti permukaan tanah sungguhan.
function hash1(n) {
  const s = Math.sin(n * 127.1 + 0.37) * 43758.5453;
  return s - Math.floor(s);
}

function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash1(i) * 2 - 1;
  const b = hash1(i + 1) * 2 - 1;
  return a + (b - a) * u;
}

// Dua oktaf: tekstur kasar + butiran halus di atasnya.
function noise2(x) {
  return noise1(x) * 0.68 + noise1(x * 2.31 + 17.3) * 0.32;
}

export class CameraRig {
  constructor(camera, vehicle) {
    this.camera = camera;
    this.vehicle = vehicle;

    this.modeIndex = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.dragging = false;

    this.chasePos = new THREE.Vector3(0, 6, 14);
    this.chaseLook = new THREE.Vector3();
    this.orbitYaw = 0;
    this.orbitPitch = 0.28;
    this.orbitDist = 9;

    this.shake = 0;
    this.shakePhase = 0;
    this.vibShake = 0;
    this.intensity = 0;
    this.fovBase = 62;
    this.initialized = false;

    // Vektor "atas" kamera yang mengikuti kemiringan medan. Kalau dipaku ke
    // (0,1,0), mobil yang menanjak 21° tetap tampil seperti di jalan datar
    // karena horizon di layar tidak ikut miring — inilah yang membuat lereng
    // terasa "tidak seperti realita". Nilainya dihaluskan dan dibatasi supaya
    // tidak memicu mual (kamera miring penuh 21° terlalu ekstrem).
    this.camUp = new THREE.Vector3(0, 1, 0);

    // ---- state getaran (berbasis sinyal roda, bukan waktu absolut) ----
    this.noisePos = 0;             // posisi noise kanal cepat (maju per meter)
    this.slowPos = 0;              // posisi noise kanal lambat (ayunan bodi)
    this.buzzRoll = 0;
    this.buzzPitch = 0;
    this.buzzYaw = 0;
    this.swayRoll = 0;
    this.swayPitch = 0;
    this.swayHeave = 0;
    this.swayLat = 0;
    this.sRoll = { x: 0, v: 0 };   // ringing suspensi: roll (rad)
    this.sPitch = { x: 0, v: 0 };  // ringing suspensi: pitch (rad)
    this.sHeave = { x: 0, v: 0 };  // ringing suspensi: naik-turun (m)
    this.extLP = 0;                // buzz yang sudah ditapis untuk kamera luar
    this.hpWheel = [0, 0, 0, 0];   // tapis lolos-tinggi per roda (buang kemiringan)
    this.dbg = null;
  }

  get mode() {
    return CAM_MODES[this.modeIndex].id;
  }

  get modeLabel() {
    return CAM_MODES[this.modeIndex].label;
  }

  cycle() {
    this.modeIndex = (this.modeIndex + 1) % CAM_MODES.length;
    this.dragYaw = 0;
    this.dragPitch = 0;
    this.lookYaw = 0;
    this.lookPitch = 0;
    if (this.mode === 'orbit') {
      this.orbitYaw = 0;
      this.orbitPitch = 0.28;
    }
    this.initialized = false;
    return this.modeLabel;
  }

  // ---------------- input ----------------
  beginDrag() { this.dragging = true; }

  endDrag() { this.dragging = false; }

  drag(dx, dy) {
    if (!this.dragging) return;
    this.dragYaw -= dx * 0.0032;
    this.dragPitch -= dy * 0.0026;
    this.dragPitch = clamp(this.dragPitch, -0.9, 0.75);
    this.dragYaw = clamp(this.dragYaw, -2.4, 2.4);
  }

  // ================= getaran =================
  // Semua komponen di bawah berasal dari data kontak roda:
  //   buzz*  : getaran halus frekuensi tinggi (tekstur permukaan yang tidak
  //            terwakili sampling 4 titik) — fase ikut jarak tempuh roda.
  //   sRoll/sPitch/sHeave : ringing suspensi frekuensi rendah yang dipicu
  //            hentakan roda lalu meluruh sendiri (pegas-peredam orde dua).
  updateVibration(dt) {
    const v = this.vehicle;
    const spd = Math.abs(v.speed);
    const spdN = Math.min(1, spd / 24);
    const rough = v.roughness || 0;
    const grounded = v.grounded ? 1 : 0;
    const moving = spd > 0.3 ? 1 : 0;

    // fase noise maju sebanding jarak tempuh -> tekstur makin rapat saat mobil
    // cepat dan berhenti total saat mobil diam. Laju dibatasi agar di kecepatan
    // tinggi tekstur tidak melewati Nyquist layar (~30 Hz) dan jadi kedipan.
    const adv = Math.min(spd * NOISE_PER_METRE, NOISE_RATE_MAX) * dt;
    this.noisePos += adv;
    this.slowPos += adv * SLOW_RATIO;
    // jaga presisi float pada perjalanan panjang
    if (this.noisePos > 4096) this.noisePos -= 4096;
    if (this.slowPos > 4096) this.slowPos -= 4096;

    // ---- sinyal roda ----
    // wheelVel masih mengandung kemiringan medan (di lereng tetap, kecepatan
    // vertikal roda = kemiringan x kecepatan, jadi bukan getaran). Kita buang
    // komponen lambat itu dengan tapis lolos-tinggi: yang tersisa hanya
    // perubahan mendadak — persis yang dirasakan suspensi saat melewati
    // gundukan, lubang, atau punggung bukit.
    const wv = v.wheelVel || [0, 0, 0, 0];
    const hpRate = 1 - Math.exp(-4.5 * dt); // ~0.22 s
    const hp = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      this.hpWheel[k] += (wv[k] - this.hpWheel[k]) * hpRate;
      hp[k] = wv[k] - this.hpWheel[k];
    }
    // urutan roda: 0=FL 1=FR 2=RL 3=RR
    const latV = (hp[0] + hp[2] - hp[1] - hp[3]) * 0.5; // kiri - kanan
    const lonV = (hp[0] + hp[1] - hp[2] - hp[3]) * 0.5; // depan - belakang
    const magV = (Math.abs(hp[0]) + Math.abs(hp[1]) + Math.abs(hp[2]) + Math.abs(hp[3])) * 0.25;

    // intensitas dasar: kekasaran medan x kecepatan; nol saat diam / melayang
    const intensity = grounded * moving * (0.18 + rough * 0.82) * (0.10 + spdN);
    this.intensity = intensity;
    this.vibShake = intensity;
    this.dbg = { latV, lonV, magV, intensity };

    // ---- road buzz: noise beroktaf, bukan sinus berulang ----
    // Tiap kanal memakai offset berbeda supaya roll / pitch / yaw tidak
    // bergerak serempak (itu terlihat seperti kamera diayun tangan).
    const p = this.noisePos;
    const wA = noise2(p);
    const wB = noise2(p + 53.7);
    const wC = noise2(p * 1.63 + 211.9);

    // ayunan lambat: satu oktaf rendah dari sumber noise yang sama, jadi
    // gerakannya tetap berkorelasi dengan medan tapi jauh lebih lembut.
    const q = this.slowPos;
    const lA = noise2(q * 0.5);
    const lB = noise2(q * 0.5 + 31.4);
    const lC = noise2(q * 0.5 + 97.1);
    const lD = noise2(q * 0.5 + 149.8);

    // amplitudo ikut sinyal roda -> getaran terasa "menempel" pada medan
    const mod = clamp(0.5 + magV * 2.2, 0.35, 1.9);
    const g = intensity * mod;

    this.buzzRoll = wA * BUZZ_ROLL * g;
    this.buzzPitch = wB * BUZZ_PITCH * g;
    this.buzzYaw = wC * BUZZ_YAW * g;

    this.swayRoll = lA * SWAY_ROLL * g;
    this.swayPitch = lB * SWAY_PITCH * g;
    this.swayHeave = lC * SWAY_HEAVE * g;
    this.swayLat = lD * SWAY_LAT * g;

    // ---- ringing suspensi: target dari roda, lalu meluruh sendiri ----
    const tRoll = clamp(latV * RING_ROLL * intensity, -MAX_ROLL, MAX_ROLL);
    const tPitch = clamp(lonV * RING_PITCH * intensity, -MAX_PITCH, MAX_PITCH);
    const tHeave = clamp(magV * RING_HEAVE * intensity, -MAX_HEAVE, MAX_HEAVE);

    springStep(this.sRoll, tRoll, RING_W, RING_Z, dt);
    springStep(this.sPitch, tPitch, RING_W * 1.1, RING_Z, dt);
    springStep(this.sHeave, tHeave, RING_W * 1.4, RING_Z * 1.2, dt);

    // pengaman: sinyal medan bisa sangat tajam, jangan sampai meledak
    this.sRoll.x = clamp(this.sRoll.x, -MAX_ROLL, MAX_ROLL);
    this.sRoll.v = clamp(this.sRoll.v, -4, 4);
    this.sPitch.x = clamp(this.sPitch.x, -MAX_PITCH, MAX_PITCH);
    this.sPitch.v = clamp(this.sPitch.v, -4, 4);
    this.sHeave.x = clamp(this.sHeave.x, -MAX_HEAVE, MAX_HEAVE);
    this.sHeave.v = clamp(this.sHeave.v, -2, 2);

    // komponen yang boleh sampai ke kamera luar (harus lebih halus)
    this.extLP += (this.buzzRoll - this.extLP) * (1 - Math.exp(-EXT_LP * dt));
  }

  // ---------------- update ----------------
  update(dt, speedKmh) {
    const v = this.vehicle;
    if (!v.loaded) return;

    const cam = this.camera;

    if (!this.dragging) {
      const back = 1 - Math.exp(-2.2 * dt);
      this.dragYaw += (0 - this.dragYaw) * back;
      this.dragPitch += (0 - this.dragPitch) * back;
    }

    const targetFov = this.fovBase + Math.min(14, speedKmh * 0.14) + (this.mode === 'pengemudi' ? 2 : 0);
    cam.fov += (targetFov - cam.fov) * (1 - Math.exp(-4 * dt));

    this.shake *= Math.exp(-5 * dt);
    this.shakePhase += dt * 36;
    if (this.shakePhase > 6283) this.shakePhase -= 6283;

    const shakeAmt = this.shake * 0.06 + (v.grounded ? 0 : 0.012);

    this.updateVibration(dt);

    if (this.mode === 'pengemudi') {
      this.updateDriver(dt, shakeAmt);
    } else if (this.mode === 'orbit') {
      this.updateOrbit(dt, shakeAmt);
    } else {
      this.updateChase(dt, shakeAmt);
    }

    cam.updateProjectionMatrix();
  }

  // ---------------- POV pengemudi ----------------
  updateDriver(dt, shakeAmt) {
    const v = this.vehicle;
    const cam = this.camera;

    const anchor = v.driverAnchor;
    anchor.updateWorldMatrix(true, false);

    const worldPos = _v1.setFromMatrixPosition(anchor.matrixWorld);

    // basis orientasi dari bodi mobil (ikut roll & pitch)
    _qBody.setFromRotationMatrix(v.body.matrixWorld);

    this.lookYaw += (this.dragYaw * 0.85 - this.lookYaw) * (1 - Math.exp(-14 * dt));

    // Bias pandangan sedikit ke bawah supaya cincin setir ikut terlihat di
    // bagian bawah layar POV.
    this.lookPitch += (PITCH_BIAS + this.dragPitch * 0.6 - this.lookPitch) * (1 - Math.exp(-14 * dt));

    _e1.set(this.lookPitch, this.lookYaw, 0);
    _qLook.setFromEuler(_e1);

    // ---- getaran kabin ----
    // Pengemudi terikat ke bodi, jadi TIDAK ada geser lateral/memanjang:
    // yang terasa hanya rotasi kecil (kepala ikut bergetar) plus sedikit
    // naik-turun dari kompresi suspensi. Ini yang bikin POV terasa duduk di
    // dalam mobil, bukan kamera yang mengambang.
    let vibRoll = this.buzzRoll + this.swayRoll + this.sRoll.x;
    let vibPitch = this.buzzPitch + this.swayPitch + this.sPitch.x;

    worldPos.y += this.sHeave.x + this.swayHeave;
    // geser lateral mengikuti sumbu kanan bodi (bukan sumbu dunia) — ini
    // compliance jok, arahnya harus ikut arah mobil
    _v2.setFromMatrixColumn(v.body.matrixWorld, 0);
    worldPos.addScaledVector(_v2, this.swayLat);

    // guncangan benturan (transien, meluruh cepat)
    if (shakeAmt > 0.0005) {
      const sp = this.shakePhase;
      worldPos.y += Math.sin(sp * 1.6) * shakeAmt * 1.2;
      vibPitch += Math.sin(sp * 1.9) * shakeAmt * 0.9;
      vibRoll += Math.sin(sp * 1.15) * shakeAmt * 0.8;
    }

    _eVib.set(vibPitch, this.buzzYaw, vibRoll);
    _qVib.setFromEuler(_eVib);

    cam.position.copy(worldPos);
    cam.quaternion.copy(_qBody).multiply(_qLook).multiply(_qVib);
    cam.near = 0.04;
  }

  // ---------------- vektor "atas" kamera yang mengikuti medan ----------------
  // Mengembalikan (lewat this.camUp) arah atas untuk lookAt. Kita ambil sumbu
  // up bodi mobil (yang sudah mengikuti bidang medan), lalu dicampur dengan
  // up dunia dan dibatasi sudutnya. Hasil: di lereng 20°, horizon di layar
  // ikut miring ~8-9° saja — cukup untuk terbaca "medan miring", tapi tidak
  // sampai membuat pandangan jungkir seperti kamera yang dipaku ke sasis.
  updateCamUp(dt) {
    const v = this.vehicle;
    _vUpT.set(0, 1, 0);

    if (v.loaded) {
      // kolom ke-1 matriks dunia root = sumbu up mobil
      _vUp.setFromMatrixColumn(v.root.matrixWorld, 1).normalize();

      const dot = THREE.MathUtils.clamp(_vUp.dot(_vUpT), -1, 1);
      const angle = Math.acos(dot);
      const MAX_TILT = 0.16; // rad (~9°)

      if (angle > 1e-4) {
        // sumbu rotasi dari up dunia menuju up mobil
        _vAxis.crossVectors(_vUpT, _vUp);
        if (_vAxis.lengthSq() > 1e-8) {
          _vAxis.normalize();
          // hanya ikuti sebagian kemiringan, dan jangan lebih dari MAX_TILT
          const effective = Math.min(angle * CAM_UP_BLEND, MAX_TILT);
          _qUp.setFromAxisAngle(_vAxis, effective);
          _vUpT.applyQuaternion(_qUp).normalize();
        }
      }
    }

    this.camUp.lerp(_vUpT, 1 - Math.exp(-3.5 * dt)).normalize();
    if (this.camUp.lengthSq() < 1e-6) this.camUp.set(0, 1, 0);
    return this.camUp;
  }

  // ---------------- chase (kamera mobil) ----------------
  updateChase(dt, shakeAmt) {
    const v = this.vehicle;
    const cam = this.camera;

    const speedNorm = Math.min(1, Math.abs(v.speed) / 30);

    const dist = 7.4 + speedNorm * 2.6;
    const height = 2.85 + speedNorm * 0.75;

    const yaw = v.yaw + this.dragYaw * 1.1;
    const pitch = this.dragPitch * 0.55;

    _v4.set(Math.sin(yaw), 0, Math.cos(yaw));
    const desired = _v1.copy(v.pos)
      .addScaledVector(_v4, dist)
      .add(_v2.set(0, height + pitch * 4.2, 0));

    // jangan masuk ke dalam tanah
    const groundHere = terrainHeight(desired.x, desired.z) + 1.5;
    if (desired.y < groundHere) desired.y = groundHere;

    if (!this.initialized) {
      this.chasePos.copy(desired);
      this.initialized = true;
    }

    const posRate = 1 - Math.exp(-(6.5 + speedNorm * 5) * dt);
    this.chasePos.lerp(desired, posRate);

    const lookTarget = _v3.copy(v.pos)
      .add(_v2.set(0, 1.35 + pitch * 2.0, 0))
      .addScaledVector(v.forward, 2.4 + speedNorm * 3.5);

    this.chaseLook.lerp(lookTarget, 1 - Math.exp(-9 * dt));

    cam.position.copy(this.chasePos);

    // ---- getaran dari luar ----
    // Kamera tidak menempel ke bodi, jadi hanya komponen frekuensi rendah
    // yang tersisa: heave suspensi + buzz yang sudah ditapis berat. Amplitudo
    // jauh lebih kecil daripada di dalam kabin.
    cam.position.y += this.sHeave.x * 0.45;
    cam.position.x += this.extLP * 0.9;
    this.chaseLook.y += this.extLP * 0.55;

    if (shakeAmt > 0.0005) {
      const sp = this.shakePhase;
      cam.position.x += Math.sin(sp * 1.06) * shakeAmt;
      cam.position.y += Math.sin(sp * 1.42) * shakeAmt * 1.2;
      cam.position.z += Math.cos(sp * 1.21) * shakeAmt;
    }

    cam.near = 0.15;
    cam.up.copy(this.updateCamUp(dt));
    cam.lookAt(this.chaseLook);
  }

  // ---------------- orbit bebas ----------------
  updateOrbit(dt, shakeAmt) {
    const v = this.vehicle;
    const cam = this.camera;

    this.orbitYaw = v.yaw + Math.PI + this.dragYaw * 1.4;
    this.orbitPitch = clamp(0.24 + this.dragPitch * 0.8, -0.25, 1.15);

    const dist = this.orbitDist;
    const h = Math.sin(this.orbitPitch) * dist;
    const r = Math.cos(this.orbitPitch) * dist;

    const desired = _v1.set(
      v.pos.x + Math.sin(this.orbitYaw) * r,
      v.pos.y + 1.0 + h,
      v.pos.z + Math.cos(this.orbitYaw) * r
    );

    const groundHere = terrainHeight(desired.x, desired.z) + 1.1;
    if (desired.y < groundHere) desired.y = groundHere;

    const rate = 1 - Math.exp(-8 * dt);
    cam.position.lerp(desired, rate);

    // getaran dari kamera bebas: paling halus (kamera jauh dari mobil)
    cam.position.y += this.sHeave.x * 0.30;
    cam.position.x += this.extLP * 0.55;

    if (shakeAmt > 0.0005) {
      const sp = this.shakePhase;
      cam.position.x += Math.sin(sp * 0.92) * shakeAmt;
      cam.position.y += Math.sin(sp * 1.38) * shakeAmt;
    }

    cam.near = 0.15;
    cam.up.copy(this.updateCamUp(dt));
    cam.lookAt(_v3.set(v.pos.x, v.pos.y + 1.05, v.pos.z));
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  snapToCar() {
    this.initialized = false;
    // buang sisa ringing supaya kamera tidak "bergetar hantu" setelah respawn
    this.camUp.set(0, 1, 0);
    this.sRoll.x = 0; this.sRoll.v = 0;
    this.sPitch.x = 0; this.sPitch.v = 0;
    this.sHeave.x = 0; this.sHeave.v = 0;
    this.extLP = 0;
    this.shake = 0;
    this.buzzRoll = 0; this.buzzPitch = 0; this.buzzYaw = 0;
    this.swayRoll = 0; this.swayPitch = 0; this.swayHeave = 0; this.swayLat = 0;
    this.hpWheel[0] = 0; this.hpWheel[1] = 0; this.hpWheel[2] = 0; this.hpWheel[3] = 0;
  }
}
