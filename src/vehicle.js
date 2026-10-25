import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { terrainHeight, terrainNormal } from './terrain.js';

// ---------------------------------------------------------------------------
// Geometri roda (hasil analisis model BAIC BJ40, ruang mesh-lokal)
// ---------------------------------------------------------------------------
export const WHEEL_RADIUS = 0.424;
const MODEL_GROUND_OFFSET = 0.558; // jarak origin model ke dasar ban
const WHEEL_Y = -0.134;            // tinggi pusat roda di ruang model
const TRACK_HALF = 0.82;           // setengah lebar lintasan roda
const AXLE_FRONT = -1.2774;
const AXLE_REAR = 1.2737;
const WHEELBASE = AXLE_REAR - AXLE_FRONT;

// pusat roda untuk klasifikasi segitiga (dipakai saat memecah mesh)
const WHEEL_CENTERS = [
  new THREE.Vector3(-TRACK_HALF, WHEEL_Y, AXLE_FRONT),
  new THREE.Vector3(TRACK_HALF, WHEEL_Y, AXLE_FRONT),
  new THREE.Vector3(-TRACK_HALF, WHEEL_Y, AXLE_REAR),
  new THREE.Vector3(TRACK_HALF, WHEEL_Y, AXLE_REAR),
];

// Mesh yang memuat geometri roda. Selain ban, model BAIC menyimpan velg
// ('black_1_0_1') dan cakram/kaliper ('shachepan', 'lights_0_0') di mesh
// terpisah — kalau tidak ikut dipisah, velg akan tertinggal saat roda belok.
const WHEEL_MESH_NAMES = ['black_wheel', 'black_1_0_1', 'tyre', 'shachepan', 'lights_0_0'];

// Kaliper rem: ikut berbelok (steer) tapi TIDAK ikut berputar (spin).
const STEER_ONLY_MESHES = ['lights_0_0'];

// Klasifikasi segitiga roda: di dalam silinder roda (radial dari sumbu)
// dan berada di sisi luar bodi.
const WHEEL_RADIAL_MAX = 0.56;
const WHEEL_X_MIN = 0.55;

// ---------------------------------------------------------------------------
// Setir (steering wheel) di dalam kabin
// ---------------------------------------------------------------------------
// Mesh 'fxp' = setir BAIC BJ40 (cincin + jari-jari). Sumbu putarnya miring
// ~12° ke atas menuju pengemudi — diambil dari PCA geometri mesh tsb.
const STEER_WHEEL_MESH = 'fxp';
const STEER_WHEEL_AXIS = new THREE.Vector3(0, 0.2103, 0.9776).normalize();
// Pusat cincin setir (ruang mesh-lokal), hasil circle-fit geometri mesh 'fxp'.
const STEER_WHEEL_HUB = new THREE.Vector3(-0.43462, 0.72905, -0.21249);

// Sudut roda depan maksimum hanya 0.44 rad (25°). Di mobil nyata setir butuh
// ~1.5 putaran penuh; di sini dipakai rasio ~5:1 supaya gerakannya terbaca
// jelas dari POV pengemudi tanpa terlihat seperti gasing.
const STEER_VISUAL_RATIO = 5.2;

const _AXIS_Z = new THREE.Vector3(0, 0, 1);
const _qSteer = new THREE.Quaternion();

// ---------------------------------------------------------------------------
// Tuning kemudi
// ---------------------------------------------------------------------------
// Sudut belok maksimum (rad) di kecepatan sangat rendah. 0.62 rad (~35°) pada
// wheelbase 2.55 m memberi radius putar ~3.6 m — terlalu tajam untuk arcade.
const MAX_STEER = 0.44;

// Batas percepatan lateral (m/s²) supaya mobil tidak "nyangkut" di tikungan
// kecepatan tinggi: yaw-rate dibatasi agar a_lat = v * yawRate tetap wajar.
const MAX_LAT_ACCEL = 11.5;

// ---------------------------------------------------------------------------
// Utilitas pemecahan geometri roda
// ---------------------------------------------------------------------------
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
  g.computeBoundingSphere();
  return g;
}

/** Pecah satu mesh roda (berisi 4 roda + ban cadangan) menjadi 5 geometri. */
function splitWheelMesh(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index;
  const triCount = idx ? idx.count / 3 : pos.count / 3;

  const buckets = [[], [], [], [], []]; // 0..3 roda, 4 = sisa (ban cadangan)

  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2;
    if (idx) {
      i0 = idx.getX(t * 3);
      i1 = idx.getX(t * 3 + 1);
      i2 = idx.getX(t * 3 + 2);
    } else {
      i0 = t * 3; i1 = t * 3 + 1; i2 = t * 3 + 2;
    }

    const cx = (pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3;
    const cy = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
    const cz = (pos.getZ(i0) + pos.getZ(i1) + pos.getZ(i2)) / 3;

    let best = -1;
    let bestR = Infinity;

    if (Math.abs(cx) >= WHEEL_X_MIN) {
      const candidates = cx < 0 ? [0, 2] : [1, 3]; // 0/2 kiri, 1/3 kanan
      for (let i = 0; i < candidates.length; i++) {
        const k = candidates[i];
        const c = WHEEL_CENTERS[k];
        const dy = cy - WHEEL_Y;
        const dz = cz - c.z;
        const rad = Math.sqrt(dy * dy + dz * dz);
        if (rad < bestR) { bestR = rad; best = k; }
      }
    }

    if (best >= 0 && bestR < WHEEL_RADIAL_MAX) {
      buckets[best].push(i0, i1, i2);
    } else {
      buckets[4].push(i0, i1, i2);
    }
  }

  return buckets.map((list) => (list.length ? buildGeometry(geo, list) : null));
}

// ---------------------------------------------------------------------------
// Material: matikan transmission (berat) & buat kaca transparan sederhana
// ---------------------------------------------------------------------------
const GLASS_MESHES = ['vehicle_generic_glasswindows2', 'vehicle_generic_glasswindows3'];

function tuneMaterials(root) {
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1018,
    metalness: 0.0,
    roughness: 0.08,
    transparent: true,
    opacity: 0.42,
    envMapIntensity: 2.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const cache = new Map();

  root.traverse((o) => {
    if (!o.isMesh) return;

    const isGlass = GLASS_MESHES.indexOf(o.name) !== -1 ||
      (o.material && /glass/i.test(o.material.name || ''));

    if (isGlass) {
      o.material = glassMat;
      o.castShadow = false;
      o.renderOrder = 4;
      return;
    }

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map((m) => {
      if (!m) return m;
      if (cache.has(m.uuid)) return cache.get(m.uuid);

      m.transmission = 0;
      m.thickness = 0;
      if (m.emissiveIntensity !== undefined) {
        const em = m.emissive ? m.emissive.getHex() : 0;
        if (em !== 0) {
          m.emissiveIntensity = 2.4;
          m.toneMapped = true;
        }
      }
      if (m.metalness !== undefined) m.metalness = Math.min(m.metalness, 0.9);
      m.envMapIntensity = 1.15;
      m.needsUpdate = true;
      cache.set(m.uuid, m);
      return m;
    });

    o.material = Array.isArray(o.material) ? out : out[0];
    o.castShadow = true;
    o.receiveShadow = true;
  });

  return glassMat;
}

// ---------------------------------------------------------------------------
// Kendaraan
// ---------------------------------------------------------------------------
export class Vehicle {
  constructor() {
    this.root = new THREE.Group();          // posisi + yaw (dunia)
    this.body = new THREE.Group();          // bodi (roll/pitch kosmetik)
    this.root.add(this.body);

    this.pivots = [];       // 4 pivot roda
    this.wheels = [];       // { pivot, baseY, front }
    this.loaded = false;

    this.glassMaterial = null;

    // ---- state fisika ----
    this.pos = new THREE.Vector3(0, 0, 0);
    this.yaw = 0;
    this.speed = 0;         // m/s, positif = maju
    this.vy = 0;
    this.steer = 0;
    this.yawRateEff = 0;
    this.grounded = true;
    this.airTime = 0;
    this.wheelSpin = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.suspension = [0, 0, 0, 0];
    this.impact = 0;

    // ---- state untuk audio & guncangan ----
    this.rpm = 820;          // putaran mesin (RPM) — dipakai sintesis suara
    this.throttle = 0;       // 0..1 bukaan gas terhalus
    this.roughness = 0;      // 0..1 kekasaran medan di bawah roda
    this.vibration = 0;      // 0..1 getaran bodi total (kamera + audio)
    this.wheelBump = [0, 0, 0, 0];   // guncangan vertikal per roda
    this.wheelWobble = [0, 0, 0, 0]; // goyangan samping per roda

    this.quat = new THREE.Quaternion();
    this.targetQuat = new THREE.Quaternion();

    this._fwd = new THREE.Vector3(0, 0, -1);
    this._right = new THREE.Vector3(1, 0, 0);
    this._up = new THREE.Vector3(0, 1, 0);
    this._n = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._w = new THREE.Vector3();

    this.telemetry = { kmh: 0, gear: 'N', slip: 0 };
  }

  // -------------------------------------------------------------------------
  async load(url, onProgress) {
    const loader = new GLTFLoader();
    // Model GLB dikompresi dengan gltfpack (meshopt). Decoder wajib didaftarkan
    // sebelum loadAsync, kalau tidak EXT_meshopt_compression akan gagal.
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(url, (e) => {
      if (onProgress && e.total) onProgress(e.loaded / e.total);
    });

    const scene = gltf.scene;

    // buang node kamera KeyShot
    const junk = scene.getObjectByName('active');
    if (junk && junk.parent) junk.parent.remove(junk);

    // nol-kan translasi node 'bj40' agar semua berada di ruang mesh-lokal
    const bj40 = scene.getObjectByName('bj40');
    if (bj40) {
      bj40.matrixAutoUpdate = true;
      bj40.position.set(0, 0, 0);
      bj40.quaternion.identity();
      bj40.scale.set(1, 1, 1);
      bj40.updateMatrix();
    }

    // ---- pecah roda ----
    const parts = [[], [], [], []]; // per roda: daftar {geometry, material, spin}

    for (const name of WHEEL_MESH_NAMES) {
      const mesh = scene.getObjectByName(name);
      if (!mesh || !mesh.isMesh) continue;

      const canSpin = STEER_ONLY_MESHES.indexOf(name) === -1;
      const geos = splitWheelMesh(mesh);
      if (!geos) continue;

      for (let k = 0; k < 4; k++) {
        if (geos[k]) parts[k].push({ geometry: geos[k], material: mesh.material, spin: canSpin });
      }

      // sisa (ban cadangan) tetap menempel di bodi
      if (geos[4]) {
        mesh.geometry = geos[4];
      } else if (mesh.parent) {
        mesh.parent.remove(mesh);
      }
    }

    this.glassMaterial = tuneMaterials(scene);

    // ---- bodi ----
    this.body.add(scene);
    this.body.position.set(0, MODEL_GROUND_OFFSET, 0);

    // ---- titik kamera pengemudi (ikut roll/pitch bodi) ----
    this.driverAnchor = new THREE.Object3D();
    this.driverAnchor.name = 'driverAnchor';
    // Sedikit lebih rendah & mundur dari posisi awal supaya cincin setir ikut
    // masuk ke bagian bawah layar POV (posisi duduk natural, bukan menempel kaca).
    this.driverAnchor.position.set(-0.435, 1.0, 0.1);
    this.body.add(this.driverAnchor);

    // ---- setir: bungkus mesh 'fxp' dengan pivot di pusat cincin ----
    // Pivot diletakkan tepat di hub setir dan diputar supaya sumbu lokal +Z
    // sejajar sumbu setir yang sebenarnya. Mesh dipindah ke dalamnya dengan
    // attach() agar tidak bergeser sedikit pun.
    this.steerWheel = null;
    const wheelMesh = scene.getObjectByName(STEER_WHEEL_MESH);
    if (wheelMesh && wheelMesh.isMesh) {
      const pivot = new THREE.Group();
      pivot.name = 'steerWheelPivot';
      pivot.position.copy(STEER_WHEEL_HUB);
      pivot.quaternion.setFromUnitVectors(_AXIS_Z, STEER_WHEEL_AXIS);
      this.body.add(pivot);

      this.body.updateWorldMatrix(true, true);
      pivot.attach(wheelMesh);

      this.steerWheel = pivot;
      this.steerWheelBase = pivot.quaternion.clone();
      this.steerWheelAngle = 0;

      // Material asli setir hampir hitam pekat (#040404) dan kabin tidak
      // mendapat cahaya matahari, jadi tanpa ini setir cuma jadi siluet gelap
      // di POV. Dinaikkan sedikit + diberi sedikit self-illumination supaya
      // bentuk cincin dan jari-jarinya terbaca.
      const wm = Array.isArray(wheelMesh.material) ? wheelMesh.material : [wheelMesh.material];
      for (const m of wm) {
        if (!m) continue;
        if (m.color) m.color.setHex(0x1c1d1f);
        if (m.emissive) {
          m.emissive.setHex(0x2b2e31);
          m.emissiveIntensity = 1.0;
        }
        if (m.roughness !== undefined) m.roughness = 0.62;
        m.needsUpdate = true;
      }
    }

    // ---- pivot roda (saudara bodi, supaya tidak ikut roll kosmetik) ----
    for (let k = 0; k < 4; k++) {
      const c = WHEEL_CENTERS[k];
      const pivot = new THREE.Group();
      pivot.rotation.order = 'YXZ';
      pivot.position.set(c.x, c.y + MODEL_GROUND_OFFSET, c.z);
      pivot.name = 'wheelPivot' + k;

      let spinner = null;

      for (const p of parts[k]) {
        const m = new THREE.Mesh(p.geometry, p.material);
        m.position.set(-c.x, -c.y, -c.z);
        m.castShadow = true;
        m.receiveShadow = false;

        if (p.spin) {
          // bagian yang ikut berputar masuk grup dalam, supaya bisa diputar
          // di sumbu X tanpa ikut memutar kaliper rem.
          if (!spinner) {
            spinner = new THREE.Group();
            spinner.rotation.order = 'YXZ';
            pivot.add(spinner);
          }
          spinner.add(m);
        } else {
          pivot.add(m);
        }
      }

      this.root.add(pivot);
      this.pivots.push(pivot);
      this.wheels.push({
        pivot,
        spinner,
        baseY: c.y + MODEL_GROUND_OFFSET,
        local: new THREE.Vector3(c.x, 0, c.z),
        front: k < 2,
        left: k === 0 || k === 2,
      });
    }

    this.loaded = true;
    this.reset(new THREE.Vector3(0, 0, 0), 0);
  }

  reset(pos, yaw) {
    this.pos.copy(pos);
    this.pos.y = terrainHeight(pos.x, pos.z);
    this.yaw = yaw;
    this.speed = 0;
    this.vy = 0;
    this.steer = 0;
    this.yawRateEff = 0;
    this.grounded = true;
    this.airTime = 0;
    this.bodyRoll = 0;
    this.bodyPitch = 0;
    this.steerWheelAngle = 0;
    if (this.steerWheel) this.steerWheel.quaternion.copy(this.steerWheelBase);

    this.rpm = 820;
    this.throttle = 0;
    this.roughness = 0;
    this.vibration = 0;
    for (let k = 0; k < 4; k++) {
      this.wheelBump[k] = 0;
      this.wheelWobble[k] = 0;
    }

    const n = terrainNormal(this.pos.x, this.pos.z, this._n);
    this.quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    this.quat.premultiply(q);

    this.syncTransform();
  }

  get forward() {
    return this._fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  get right() {
    return this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** posisi dunia sebuah titik di ruang mobil (origin = permukaan tanah) */
  localToWorld(lx, ly, lz, out) {
    const r = this.right;
    const f = this.forward;
    return out.set(
      this.pos.x + r.x * lx - f.x * lz,
      this.pos.y + ly,
      this.pos.z + r.z * lx - f.z * lz
    );
  }

  // -------------------------------------------------------------------------
  update(dt, input) {
    if (!this.loaded) return;

    dt = Math.min(dt, 1 / 25);

    const fwd = this.forward;
    const right = this.right;
    const n = terrainNormal(this.pos.x, this.pos.z, this._n);

    // ---------- kemudi ----------
    // Sudut belok maksimum dibatasi supaya tidak terlalu tajam, dan makin
    // kecil saat kecepatan naik (stabilitas). Rate perubahan juga diperlambat
    // agar gerakan setir terasa progresif, bukan menyentak.
    const steerInput = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const speedAbs = Math.abs(this.speed);
    const speedFactor = 1 - Math.min(1, speedAbs / 36) * 0.72;
    const steerTarget = steerInput * MAX_STEER * speedFactor;
    const steerRate = steerInput !== 0 ? 2.6 : 4.4;
    this.steer += THREE.MathUtils.clamp(steerTarget - this.steer, -steerRate * dt, steerRate * dt);

    // ---------- gaya mesin / rem ----------
    const throttle = input.forward ? 1 : 0;
    const brake = input.back ? 1 : 0;
    const handbrake = input.handbrake ? 1 : 0;

    let accel = 0;

    if (throttle) {
      const v = Math.abs(this.speed);
      const powerCurve = 1 - Math.min(1, v / 34) * 0.72;
      accel += 13.5 * powerCurve;
    }
    if (brake) {
      if (this.speed > 0.6) {
        accel -= 24;
      } else {
        accel -= 7.5; // mundur
      }
    }
    if (handbrake) {
      accel -= Math.sign(this.speed) * 26;
    }

    // hambatan udara + gelinding
    accel -= this.speed * Math.abs(this.speed) * 0.0026;
    accel -= Math.sign(this.speed) * 1.05;

    // gravitasi sepanjang lereng
    const fx = fwd.x, fz = fwd.z;
    const dn = fx * n.x + fz * n.z;
    const slopeX = fx - n.x * dn;
    const slopeZ = fz - n.z * dn;
    const slopeLen = Math.hypot(slopeX, slopeZ) || 1;
    const slopeY = -dn / slopeLen; // komponen vertikal arah maju pada lereng
    if (this.grounded) accel -= 9.81 * slopeY * 0.9;

    this.speed += accel * dt;

    // batas kecepatan
    const maxFwd = 34;
    const maxRev = 11;
    if (this.speed > maxFwd) this.speed = maxFwd;
    if (this.speed < -maxRev) this.speed = -maxRev;
    if (Math.abs(this.speed) < 0.045 && !throttle && !brake) this.speed = 0;

    // ---------- yaw ----------
    // Model kinematik sepeda (bicycle model) + batas grip lateral. Sudut belok
    // besar pada kecepatan tinggi menghasilkan yaw-rate ekstrem, jadi yaw-rate
    // dibatasi agar percepatan lateral a = v * yawRate tetap di bawah MAX_LAT_ACCEL.
    if (Math.abs(this.speed) > 0.08) {
      const grip = this.grounded ? 1 : 0.18;
      const rawYawRate = (this.speed * Math.tan(this.steer)) / WHEELBASE;
      const maxYawRate = MAX_LAT_ACCEL / Math.max(1, Math.abs(this.speed));
      const yawRate = THREE.MathUtils.clamp(rawYawRate, -maxYawRate, maxYawRate);
      this.yawRateEff = yawRate * grip;
      this.yaw += yawRate * dt * grip;
    } else {
      this.yawRateEff = 0;
    }

    // ---------- posisi horizontal ----------
    this.pos.x += fwd.x * this.speed * dt;
    this.pos.z += fwd.z * this.speed * dt;

    // batas arena
    const LIM = 430;
    const distO = Math.hypot(this.pos.x, this.pos.z);
    if (distO > LIM) {
      const s = LIM / distO;
      this.pos.x *= s;
      this.pos.z *= s;
      this.speed *= 0.6;
    }

    // ---------- sampel roda ----------
    const heights = [0, 0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      const wx = this.pos.x + right.x * w.local.x - fwd.x * w.local.z;
      const wz = this.pos.z + right.z * w.local.x - fwd.z * w.local.z;
      heights[k] = terrainHeight(wx, wz);
    }

    const hFL = heights[0], hFR = heights[1], hRL = heights[2], hRR = heights[3];
    const groundY = (hFL + hFR + hRL + hRR) * 0.25;

    // ---------- vertikal / lompat ----------
    const prevGrounded = this.grounded;

    if (prevGrounded) {
      const gap = groundY - this.pos.y;
      // jika tanah turun sangat cepat -> melayang
      if (gap < -0.55 && this.speed > 9) {
        this.grounded = false;
        this.vy = Math.max(gap / dt * 0.35, -9);
      } else {
        this.vy = gap / dt;
        this.pos.y = groundY;
        this.grounded = true;
      }
    } else {
      this.vy -= 9.81 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= groundY) {
        const impactV = this.vy;
        this.pos.y = groundY;
        this.grounded = true;
        this.vy = 0;
        if (impactV < -7) {
          this.impact = Math.min(1, -impactV / 26);
          this.speed *= 0.86;
        }
      }
    }

    if (this.grounded) this.airTime = 0;
    else this.airTime += dt;

    // ---------- orientasi bodi mengikuti medan ----------
    const hFront = (hFL + hFR) * 0.5;
    const hRear = (hRL + hRR) * 0.5;
    const hLeft = (hFL + hRL) * 0.5;
    const hRight = (hFR + hRR) * 0.5;

    const f = this._v.set(
      fwd.x * WHEELBASE,
      hFront - hRear,
      fwd.z * WHEELBASE
    ).normalize();

    const r = this._w.set(
      right.x * TRACK_HALF * 2,
      hRight - hLeft,
      right.z * TRACK_HALF * 2
    ).normalize();

    const up = new THREE.Vector3().crossVectors(r, f).normalize();
    const zAxis = new THREE.Vector3().crossVectors(r, up).normalize();

    this._m.makeBasis(r, up, zAxis);
    this.targetQuat.setFromRotationMatrix(this._m);

    const align = this.grounded ? 1 - Math.exp(-11 * dt) : 1 - Math.exp(-1.6 * dt);
    this.quat.slerp(this.targetQuat, align);

    // ---------- roll & pitch kosmetik ----------
    const yawRateNow = this.yawRateEff;
    const latAccel = this.speed * yawRateNow;
    const rollTarget = THREE.MathUtils.clamp(-latAccel * 0.009, -0.11, 0.11);
    const pitchTarget = THREE.MathUtils.clamp(-accel * 0.004, -0.06, 0.06);

    this.bodyRoll += (rollTarget - this.bodyRoll) * (1 - Math.exp(-7 * dt));
    this.bodyPitch += (pitchTarget - this.bodyPitch) * (1 - Math.exp(-7 * dt));

    // ---------- roda ----------
    this.wheelSpin -= (this.speed * dt) / WHEEL_RADIUS;

    // Kekasaran medan: selisih tinggi antar roda + variasi lokal. Dipakai untuk
    // guncangan bodi, getaran kamera, dan intensitas suara kerikil.
    const spread = Math.max(hFL, hFR, hRL, hRR) - Math.min(hFL, hFR, hRL, hRR);
    const localVar = Math.abs(terrainHeight(this.pos.x + 1.2, this.pos.z) - heights[0]) +
      Math.abs(terrainHeight(this.pos.x, this.pos.z + 1.2) - heights[0]);
    const roughTarget = THREE.MathUtils.clamp(spread * 0.55 + localVar * 0.30, 0, 1);
    this.roughness += (roughTarget - this.roughness) * (1 - Math.exp(-6 * dt));

    const spdNorm = Math.min(1, Math.abs(this.speed) / 26);
    const vibTarget = this.grounded
      ? Math.min(1, this.roughness * (0.35 + spdNorm * 1.25) + spdNorm * 0.06)
      : 0.05;
    this.vibration += (vibTarget - this.vibration) * (1 - Math.exp(-9 * dt));

    const vibTime = performance.now() * 0.001;

    for (let k = 0; k < 4; k++) {
      const w = this.wheels[k];
      const spin = this.grounded ? this.wheelSpin : this.wheelSpin * 0.98;

      w.pivot.rotation.y = w.front ? this.steer : 0;
      if (w.spinner) w.spinner.rotation.x = spin;

      // suspensi visual
      let off = 0;
      if (this.grounded) {
        const wWorldY = this.pos.y + (heights[k] - groundY) * 0.5;
        off = THREE.MathUtils.clamp((heights[k] - wWorldY) * 0.75, -0.16, 0.16);
      }
      this.suspension[k] += (off - this.suspension[k]) * (1 - Math.exp(-16 * dt));

      // ---- guncangan ban: tiap roda punya fase sendiri ----
      // Getaran halus dari permukaan (selalu ada saat bergerak) ditambah
      // hentakan keras saat roda menabrak gundukan (suspensi memanjang).
      let bump = 0;
      let wobble = 0;
      if (this.grounded && Math.abs(this.speed) > 0.4) {
        const phase = k * 1.9;
        const f1 = 13.0 + k * 1.7;
        const f2 = 27.0 + k * 2.3;
        const amp = this.roughness * (0.030 + spdNorm * 0.055) + spdNorm * 0.004;
        bump = (Math.sin(vibTime * f1 + phase) * 0.65 +
          Math.sin(vibTime * f2 + phase * 1.7) * 0.35) * amp;
        wobble = Math.sin(vibTime * (9.0 + k * 0.8) + phase * 2.3) * amp * 0.7;
      }
      // hentakan dari suspensi yang sedang bekerja keras
      bump += this.suspension[k] * 0.35;

      this.wheelBump[k] += (bump - this.wheelBump[k]) * (1 - Math.exp(-22 * dt));
      this.wheelWobble[k] += (wobble - this.wheelWobble[k]) * (1 - Math.exp(-18 * dt));

      w.pivot.position.y = w.baseY + this.suspension[k] + this.wheelBump[k];
      w.pivot.rotation.z = this.wheelWobble[k] * 0.35;
      w.pivot.rotation.x = this.wheelBump[k] * 0.55;
    }

    // ---------- setir di dalam kabin ----------
    // `steer` sudah dibatasi laju (steerRate), jadi cukup dihaluskan sedikit
    // supaya gerakan tangan di POV tidak terasa kaku.
    if (this.steerWheel) {
      const targetAngle = this.steer * STEER_VISUAL_RATIO;
      this.steerWheelAngle += (targetAngle - this.steerWheelAngle) * (1 - Math.exp(-18 * dt));
      _qSteer.setFromAxisAngle(_AXIS_Z, this.steerWheelAngle);
      this.steerWheel.quaternion.copy(this.steerWheelBase).multiply(_qSteer);
    }

    // ---------- state mesin (dipakai sintesis suara) ----------
    this.throttle += ((throttle ? 1 : 0) - this.throttle) * (1 - Math.exp(-11 * dt));

    // Simulasi 5 gigi: RPM naik dari 800 (idle) ke ~4600 lalu turun saat
    // gigi berikutnya masuk. Membuat suara mesin punya "tangga" yang wajar,
    // bukan cuma mengikuti kecepatan linear.
    const kmhAbs = Math.abs(this.speed) * 3.6;
    const GEARS = [0, 26, 52, 84, 120, 170];
    const IDLE = 800;
    const REDLINE = 4650;
    let gearIdx = 1;
    while (gearIdx < GEARS.length - 1 && kmhAbs > GEARS[gearIdx]) gearIdx++;
    const lo = GEARS[gearIdx - 1];
    const hi = GEARS[gearIdx];
    const inGear = THREE.MathUtils.clamp((kmhAbs - lo) / Math.max(1, hi - lo), 0, 1);
    let targetRpm = IDLE + inGear * (REDLINE - IDLE);

    // kopling / netral: menahan gas di tempat membuat RPM naik sedikit
    if (kmhAbs < 1.5) targetRpm = IDLE + this.throttle * 1250;
    if (!this.grounded) targetRpm += this.throttle * 700;

    this.rpm += (targetRpm - this.rpm) * (1 - Math.exp(-9 * dt));

    // ---------- telemetri ----------
    this.telemetry.kmh = Math.abs(this.speed) * 3.6;
    this.telemetry.gear = this.speed > 0.6 ? 'D' : (this.speed < -0.6 ? 'R' : 'N');
    this.telemetry.slip = Math.abs(this.steer) * Math.min(1, Math.abs(this.speed) / 22);
    this.telemetry.rpm = this.rpm;
    this.telemetry.rough = this.roughness;

    this.impact *= Math.exp(-3.5 * dt);
    this.syncTransform();
  }

  syncTransform() {
    this.root.position.copy(this.pos);
    this.root.quaternion.copy(this.quat);
    this.body.rotation.set(this.bodyPitch, 0, this.bodyRoll);
  }
}
