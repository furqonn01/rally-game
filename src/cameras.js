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
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
const _eVib = new THREE.Euler(0, 0, 0, 'YXZ');
const _qVib = new THREE.Quaternion();

// Sudut pandang POV pengemudi dimiringkan sedikit ke bawah (radian, negatif =
// lihat ke bawah) supaya cincin setir masuk ke bagian bawah frame. Tanpa ini
// setir berada ~57° di bawah sumbu pandang dan tidak terlihat sama sekali.
const PITCH_BIAS = -0.1;

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
    this.vibShake = 0;
    this.fovBase = 62;
    this.initialized = false;
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
    this.dragPitch = THREE.MathUtils.clamp(this.dragPitch, -0.9, 0.75);
    this.dragYaw = THREE.MathUtils.clamp(this.dragYaw, -2.4, 2.4);
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
    const shakeAmt = this.shake * 0.06 + (v.grounded ? 0 : 0.012);

    // Getaran medan: di dalam kabin seluruh bodi bergetar bersama pengemudi,
    // jadi efeknya jauh lebih terasa. Di kamera luar, kamera "mengambang" dan
    // hanya ikut sebagian — guncangan dari ban hampir hilang.
    this.vibShake = (v.vibration || 0) * (this.mode === 'pengemudi' ? 1 : 0.32);

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
    const bodyQuat = _q1.setFromRotationMatrix(v.body.matrixWorld);

    this.lookYaw += (this.dragYaw * 0.85 - this.lookYaw) * (1 - Math.exp(-14 * dt));

    // Bias pandangan sedikit ke bawah supaya cincin setir ikut terlihat di
    // bagian bawah layar POV.
    this.lookPitch += (PITCH_BIAS + this.dragPitch * 0.6 - this.lookPitch) * (1 - Math.exp(-14 * dt));

    _e1.set(this.lookPitch, this.lookYaw, 0);
    const lookQuat = new THREE.Quaternion().setFromEuler(_e1);

    // ---- getaran kabin: badan & kepala ikut bergetar bersama bodi ----
    // Karena kamera menempel ke bodi, getaran ban harus terasa sebagai
    // guncangan nyata: posisi naik-turun/tenggelam, plus rotasi kecil
    // (roll & pitch) yang membuat dunia terlihat bergetar.
    const vib = this.vibShake || 0;
    let vibRoll = 0;
    let vibPitch = 0;

    if (vib > 0.0008) {
      const t = performance.now() * 0.001;
      const amp = vib * 0.045;

      worldPos.y += Math.sin(t * 23.7) * amp * 1.5 + Math.sin(t * 41.1) * amp * 0.55;
      worldPos.x += Math.sin(t * 19.3) * amp * 0.75;
      worldPos.z += Math.cos(t * 21.9) * amp * 0.6;

      // roll/pitch kecil — inilah yang paling terasa "guncangan ban"
      vibRoll = (Math.sin(t * 17.3) * 0.010 + Math.sin(t * 33.9) * 0.005) * vib;
      vibPitch = (Math.sin(t * 21.1) * 0.007 + Math.sin(t * 39.7) * 0.004) * vib;

      _eVib.set(vibPitch, 0, vibRoll);
      lookQuat.multiply(_qVib.setFromEuler(_eVib));
    }

    const finalQuat = bodyQuat.clone().multiply(lookQuat);

    // guncangan benturan
    if (shakeAmt > 0.0005) {
      const t = performance.now() * 0.001;
      worldPos.x += Math.sin(t * 41.3) * shakeAmt;
      worldPos.y += Math.sin(t * 57.7) * shakeAmt * 1.4;
      worldPos.z += Math.cos(t * 47.1) * shakeAmt;
    }

    cam.position.copy(worldPos);
    cam.quaternion.copy(finalQuat);
    cam.near = 0.04;
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

    const back = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const desired = _v1.copy(v.pos)
      .addScaledVector(back, dist)
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

    // getaran dari luar: hanya frekuensi rendah & amplitudo kecil, karena
    // kamera tidak menempel pada bodi. Guncangan ban halus nyaris tak terasa.
    const vib = this.vibShake || 0;
    if (vib > 0.0008) {
      const t = performance.now() * 0.001;
      const amp = vib * 0.022;
      cam.position.y += Math.sin(t * 11.3) * amp;
      cam.position.x += Math.sin(t * 8.7) * amp * 0.5;
      // look target ikut bergoyang sedikit -> frame terasa "hidup"
      this.chaseLook.y += Math.sin(t * 9.1) * amp * 0.9;
    }

    if (shakeAmt > 0.0005) {
      const t = performance.now() * 0.001;
      cam.position.x += Math.sin(t * 38.1) * shakeAmt;
      cam.position.y += Math.sin(t * 51.3) * shakeAmt * 1.2;
      cam.position.z += Math.cos(t * 43.7) * shakeAmt;
    }

    cam.near = 0.15;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.chaseLook);
  }

  // ---------------- orbit bebas ----------------
  updateOrbit(dt, shakeAmt) {
    const v = this.vehicle;
    const cam = this.camera;

    this.orbitYaw = v.yaw + Math.PI + this.dragYaw * 1.4;
    this.orbitPitch = THREE.MathUtils.clamp(0.24 + this.dragPitch * 0.8, -0.25, 1.15);

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
    const vib = this.vibShake || 0;
    if (vib > 0.0008) {
      const t = performance.now() * 0.001;
      const amp = vib * 0.014;
      cam.position.y += Math.sin(t * 7.3) * amp;
      cam.position.x += Math.sin(t * 6.1) * amp * 0.6;
    }

    if (shakeAmt > 0.0005) {
      const t = performance.now() * 0.001;
      cam.position.x += Math.sin(t * 33.1) * shakeAmt;
      cam.position.y += Math.sin(t * 49.7) * shakeAmt;
    }

    cam.near = 0.15;
    cam.up.set(0, 1, 0);
    cam.lookAt(_v3.set(v.pos.x, v.pos.y + 1.05, v.pos.z));
  }

  addShake(amount) {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  snapToCar() {
    this.initialized = false;
  }
}
