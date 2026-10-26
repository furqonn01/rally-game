import * as THREE from 'three';
import { terrainHeight, terrainNormal } from './terrain.js';

// ---------------------------------------------------------------------------
// Rute petualangan (loop tertutup) dibangkitkan secara deterministik
// supaya tetap berada di dalam arena (radius < 410 m).
// ---------------------------------------------------------------------------
const WAYPOINTS = (() => {
  const out = [];
  const N = 34;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 236 + Math.sin(a * 2 + 0.4) * 56 + Math.cos(a * 3 - 0.9) * 27;
    out.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  return out;
})();

export const CHECKPOINT_COUNT = 10;

export class Track {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'track';
    scene.add(this.group);

    // ---- kurva rute ----
    const pts = WAYPOINTS.map(([x, z]) => new THREE.Vector3(x, 0, z));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);

    const N = 900;
    this.samples = [];
    for (let i = 0; i < N; i++) {
      const p = this.curve.getPointAt(i / N);
      p.y = terrainHeight(p.x, p.z);
      this.samples.push(p);
    }

    this.length = 0;
    for (let i = 1; i <= N; i++) {
      const a = this.samples[i - 1];
      const b = this.samples[i % N];
      this.length += a.distanceTo(b);
    }

    this.checkpoints = [];
    this.gatesVisible = true;
    this.buildCheckpoints();
    this.buildRouteRibbon();
  }

  // -------------------------------------------------------------------------
  buildCheckpoints() {
    const ringGeo = new THREE.TorusGeometry(4.2, 0.24, 8, 40);
    const poleGeo = new THREE.CylinderGeometry(0.13, 0.13, 4.6, 6);
    poleGeo.translate(0, 2.3, 0);

    for (let i = 0; i < CHECKPOINT_COUNT; i++) {
      const t = i / CHECKPOINT_COUNT;
      const p = this.curve.getPointAt(t);
      const tan = this.curve.getTangentAt(t).setY(0).normalize();

      const baseY = terrainHeight(p.x, p.z);
      const n = terrainNormal(p.x, p.z).normalize();

      const node = new THREE.Group();
      node.position.set(p.x, baseY, p.z);

      // Orientasi gerbang: sumbu +Z lokal menghadap arah lintasan (jadi pemain
      // melewati bidang ring), sumbu +Y lokal mengikuti normal medan.
      // Sebelumnya dipakai setFromUnitVectors(UP, n) lalu diputar lagi dengan
      // (yaw + PI/2) — hasilnya gerbang menghadap 90° menyamping dari rute.
      const zAxis = tan.clone().normalize();
      const xAxis = new THREE.Vector3().crossVectors(n, zAxis).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();

      node.quaternion.setFromRotationMatrix(
        new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis)
      );

      // tiang + ring
      const mat = new THREE.MeshStandardMaterial({
        color: 0x2a3440,
        roughness: 0.6,
        metalness: 0.5,
      });

      const ringMat = new THREE.MeshStandardMaterial({
        color: 0xffb347,
        emissive: 0xff9a2e,
        emissiveIntensity: 1.6,
        roughness: 0.35,
        metalness: 0.1,
        transparent: true,
        opacity: 0.92,
      });

      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.y = 4.6;
      ring.castShadow = false;
      node.add(ring);

      const poleL = new THREE.Mesh(poleGeo, mat);
      poleL.position.set(-4.2, 0, 0);
      poleL.castShadow = true;
      node.add(poleL);

      const poleR = new THREE.Mesh(poleGeo, mat);
      poleR.position.set(4.2, 0, 0);
      poleR.castShadow = true;
      node.add(poleR);

      // glow disc di tanah
      const discGeo = new THREE.CircleGeometry(4.4, 28);
      const discMat = new THREE.MeshBasicMaterial({
        color: 0xffb347,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      });
      const disc = new THREE.Mesh(discGeo, discMat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.06;
      node.add(disc);

      this.group.add(node);

      this.checkpoints.push({
        index: i,
        t,
        pos: new THREE.Vector3(p.x, baseY + 1.8, p.z),
        groundY: baseY,
        tangent: tan.clone(),
        radius: 9.0,
        node,
        ring,
        ringMat,
        discMat,
        passed: false,
        isFinish: i === 0,
      });
    }

    this.resetStates();
  }

  buildRouteRibbon() {
    const N = this.samples.length;
    const verts = new Float32Array((N + 1) * 2 * 3);
    const idx = [];

    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const next = this.samples[(i + 1) % N];
      const dx = next.x - s.x;
      const dz = next.z - s.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      const w = 2.6;

      const o = i * 6;
      verts[o] = s.x + nx * w;
      verts[o + 1] = terrainHeight(s.x + nx * w, s.z + nz * w) + 0.09;
      verts[o + 2] = s.z + nz * w;

      verts[o + 3] = s.x - nx * w;
      verts[o + 4] = terrainHeight(s.x - nx * w, s.z - nz * w) + 0.09;
      verts[o + 5] = s.z - nz * w;

      if (i < N) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color: 0x1d2833,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    this.group.add(mesh);
  }

  // -------------------------------------------------------------------------
  resetStates() {
    this.nextIndex = 0;
    this.passedCount = 0;
    for (const cp of this.checkpoints) {
      cp.passed = false;
      cp.ringMat.color.setHex(0xffb347);
      cp.ringMat.emissive.setHex(0xff9a2e);
      cp.ringMat.emissiveIntensity = 1.6;
      cp.ringMat.opacity = 0.92;
      cp.discMat.color.setHex(0xffb347);
      cp.discMat.opacity = 0.16;
      cp.node.scale.setScalar(1);
    }
    this.highlightNext();
  }

  highlightNext() {
    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      if (i === this.nextIndex) {
        cp.ringMat.color.setHex(0xffb347);
        cp.ringMat.emissive.setHex(0xff9a2e);
        cp.ringMat.emissiveIntensity = 2.4;
        cp.ringMat.opacity = 1.0;
        cp.discMat.opacity = 0.26;
      } else if (!cp.passed) {
        cp.ringMat.color.setHex(0x3c4a58);
        cp.ringMat.emissive.setHex(0x223040);
        cp.ringMat.emissiveIntensity = 0.5;
        cp.ringMat.opacity = 0.55;
        cp.discMat.opacity = 0.07;
      }
    }
  }

  /** Kembalikan checkpoint jika baru saja terlewati, atau null. */
  check(pos) {
    const cp = this.checkpoints[this.nextIndex];
    if (!cp) return null;

    // Jarak horizontal (bukan bola 3D) supaya checkpoint tetap terdeteksi walau
    // posisi mobil sedikit di atas/bawah titik acuan akibat kontur medan.
    const dx = pos.x - cp.pos.x;
    const dz = pos.z - cp.pos.z;
    if (dx * dx + dz * dz > cp.radius * cp.radius) return null;

    // harus berada dekat permukaan tanah checkpoint (bukan di udara / jurang)
    if (Math.abs(pos.y - cp.groundY) > 6) return null;

    cp.passed = true;
    cp.ringMat.color.setHex(0x6ee7a8);
    cp.ringMat.emissive.setHex(0x38d98a);
    cp.ringMat.emissiveIntensity = 1.2;
    cp.ringMat.opacity = 0.75;
    cp.discMat.color.setHex(0x6ee7a8);
    cp.discMat.opacity = 0.1;

    this.passedCount++;
    this.nextIndex++;

    const finished = this.passedCount >= this.checkpoints.length;
    if (finished) this.nextIndex = this.checkpoints.length; // tidak ada lagi
    this.highlightNext();

    return { checkpoint: cp, finished };
  }

  /** Posisi & arah aman untuk reset kendaraan. */
  respawn() {
    const cp = this.checkpoints[this.nextIndex] || this.checkpoints[0];
    const tan = cp.tangent.clone().setY(0).normalize();

    // Kendaraan menghadap arah rute: forward = (-sin(yaw), 0, -cos(yaw))
    const yaw = Math.atan2(-tan.x, -tan.z);

    // Letakkan di BELAKANG gerbang (arah -tangent) sejauh lebih dari radius
    // deteksi, supaya gerbang tidak langsung terpicu saat respawn.
    const back = cp.radius + 6;
    const x = cp.pos.x - tan.x * back;
    const z = cp.pos.z - tan.z * back;

    return {
      pos: new THREE.Vector3(x, terrainHeight(x, z), z),
      yaw,
    };
  }

  /** Tampilkan / sembunyikan seluruh gerbang checkpoint (mode Free Roam). */
  setGatesVisible(v) {
    this.gatesVisible = !!v;
    for (const cp of this.checkpoints) cp.node.visible = !!v;
  }

  /** Titik rute terdekat — dipakai respawn Free Roam. */
  nearestOnRoute(pos) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < this.samples.length; i++) {
      const s = this.samples[i];
      const dx = s.x - pos.x;
      const dz = s.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; bi = i; }
    }
    const s = this.samples[bi];
    const n = this.samples[(bi + 1) % this.samples.length];
    const tan = new THREE.Vector3(n.x - s.x, 0, n.z - s.z).normalize();
    return {
      index: bi,
      pos: new THREE.Vector3(s.x, terrainHeight(s.x, s.z), s.z),
      yaw: Math.atan2(-tan.x, -tan.z),
    };
  }

  update(dt, elapsed) {
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.1);
    const cp = this.checkpoints[this.nextIndex];
    if (cp) {
      cp.ringMat.emissiveIntensity = 1.8 + pulse * 1.4;
      cp.discMat.opacity = 0.16 + pulse * 0.14;
      cp.ring.scale.setScalar(1 + pulse * 0.045);
    }
  }
}
