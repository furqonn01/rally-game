import * as THREE from 'three';
import { terrainHeight, terrainNormal } from './terrain.js';

// ---------------------------------------------------------------------------
// RNG deterministik
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Pemandangan: pohon + batu (InstancedMesh)
// ---------------------------------------------------------------------------
export class Scenery {
  constructor(scene, curve, samples) {
    this.group = new THREE.Group();
    this.group.name = 'scenery';
    scene.add(this.group);

    const rnd = mulberry32(20240617);

    // titik-titik jalur untuk menjaga koridor tetap kosong
    const track = [];
    for (let i = 0; i < samples.length; i += 3) {
      track.push(samples[i].x, samples[i].z);
    }

    const minDistToTrack = (x, z, limit) => {
      const l2 = limit * limit;
      for (let i = 0; i < track.length; i += 2) {
        const dx = x - track[i];
        const dz = z - track[i + 1];
        if (dx * dx + dz * dz < l2) return true;
      }
      return false;
    };

    const pick = (count, minR, maxR, clearTrack, clearStart) => {
      const out = [];
      let guard = 0;
      while (out.length < count && guard < count * 60) {
        guard++;
        const a = rnd() * Math.PI * 2;
        const r = minR + Math.sqrt(rnd()) * (maxR - minR);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;

        if (Math.hypot(x, z) < clearStart) continue;
        if (clearTrack > 0 && minDistToTrack(x, z, clearTrack)) continue;

        const n = terrainNormal(x, z);
        if (n.y < 0.80) continue;              // lereng terlalu curam
        const y = terrainHeight(x, z);
        if (y < -26) continue;                 // hindari cekungan ekstrem

        out.push({ x, y, z, s: rnd(), rot: rnd() * Math.PI * 2, tilt: (rnd() - 0.5) });
      }
      return out;
    };

    const trees = pick(660, 55, 470, 20, 26);
    const rocks = pick(420, 40, 470, 12, 22);

    this.buildTrees(trees);
    this.buildRocks(rocks);
  }

  buildTrees(list) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.30, 2.7, 6);
    trunkGeo.translate(0, 1.35, 0);
    const leafGeo = new THREE.ConeGeometry(1.9, 5.6, 7);
    leafGeo.translate(0, 4.55, 0);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x54402e, roughness: 0.95, metalness: 0 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f4a24, roughness: 0.9, metalness: 0, flatShading: true });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, list.length);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const scale = 0.72 + t.s * 0.85;
      e.set(t.tilt * 0.14, t.rot, t.tilt * 0.11);
      q.setFromEuler(e);
      p.set(t.x, t.y - 0.25, t.z);
      s.set(scale, scale * (0.9 + t.s * 0.35), scale);
      m.compose(p, q, s);
      trunks.setMatrixAt(i, m);
      leaves.setMatrixAt(i, m);

      const g = 0.30 + t.s * 0.24;
      col.setRGB(g * 0.72, g, g * 0.52);
      leaves.setColorAt(i, col);
    }

    trunks.instanceMatrix.needsUpdate = true;
    leaves.instanceMatrix.needsUpdate = true;
    if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;

    trunks.castShadow = true;
    leaves.castShadow = true;
    trunks.frustumCulled = false;
    leaves.frustumCulled = false;

    this.group.add(trunks, leaves);
  }

  buildRocks(list) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const pos = geo.attributes.position;
    const rnd = mulberry32(777);
    for (let i = 0; i < pos.count; i++) {
      const f = 0.72 + rnd() * 0.62;
      pos.setXYZ(i, pos.getX(i) * f, pos.getY(i) * f * 0.78, pos.getZ(i) * f);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({ color: 0x8d8577, roughness: 0.95, metalness: 0.02, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    const col = new THREE.Color();

    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const scale = 0.55 + r.s * 2.6;
      e.set(r.tilt * 0.9, r.rot, r.tilt * 0.7);
      q.setFromEuler(e);
      p.set(r.x, r.y + scale * 0.18, r.z);
      s.set(scale * (0.8 + r.s * 0.5), scale, scale * (0.8 + r.rot * 0.4));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);

      const g = 0.42 + r.s * 0.22;
      col.setRGB(g, g * 0.96, g * 0.88);
      mesh.setColorAt(i, col);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    this.group.add(mesh);
  }
}

// ---------------------------------------------------------------------------
// Debu roda
// ---------------------------------------------------------------------------
const DUST_VERT = `
attribute float aLife;
varying float vLife;
void main() {
  vLife = aLife;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = (34.0 + 46.0 * (1.0 - aLife)) * (14.0 / max(2.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`;

const DUST_FRAG = `
varying float vLife;
void main() {
  if (vLife <= 0.0) discard;
  vec2 d = gl_PointCoord - vec2(0.5);
  float a = smoothstep(0.5, 0.06, length(d)) * vLife * 0.42;
  if (a <= 0.002) discard;
  gl_FragColor = vec4(0.80, 0.72, 0.58, a);
}
`;

export class Dust {
  constructor(scene, max = 300) {
    this.max = max;
    this.cursor = 0;

    this.positions = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.vel = new Float32Array(max * 3);

    for (let i = 0; i < max; i++) {
      this.positions[i * 3 + 1] = -9999;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);

    this.geo = geo;
  }

  emit(x, y, z, strength) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;

    this.positions[i * 3] = x + (Math.random() - 0.5) * 0.7;
    this.positions[i * 3 + 1] = y + Math.random() * 0.35;
    this.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.7;

    this.vel[i * 3] = (Math.random() - 0.5) * 1.6;
    this.vel[i * 3 + 1] = 0.5 + Math.random() * 1.5;
    this.vel[i * 3 + 2] = (Math.random() - 0.5) * 1.6;

    this.life[i] = Math.min(1, 0.55 + strength * 0.45);
  }

  update(dt) {
    const p = this.positions;
    const v = this.vel;
    const l = this.life;

    for (let i = 0; i < this.max; i++) {
      if (l[i] <= 0) continue;
      l[i] -= dt * 0.62;
      if (l[i] <= 0) { l[i] = 0; p[i * 3 + 1] = -9999; continue; }

      v[i * 3] *= 0.985;
      v[i * 3 + 2] *= 0.985;
      v[i * 3 + 1] = v[i * 3 + 1] * 0.99 + dt * 0.35;

      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
    }

    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }

  clear() {
    for (let i = 0; i < this.max; i++) {
      this.life[i] = 0;
      this.positions[i * 3 + 1] = -9999;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aLife.needsUpdate = true;
  }
}
