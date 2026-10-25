import * as THREE from 'three';

export const TERRAIN_SIZE = 1200;
export const TERRAIN_SEG = 240;

/**
 * Fungsi tinggi medan (analitik & deterministik).
 * Dipakai untuk mesh visual maupun fisika kendaraan.
 */
export function terrainHeight(x, z) {
  let h = 0;
  h += Math.sin(x * 0.0062) * Math.cos(z * 0.0071) * 15.0;
  h += Math.sin(x * 0.0131 + 1.7) * 7.0;
  h += Math.cos(z * 0.0157 - 0.6) * 8.0;
  h += Math.sin((x * 0.72 + z * 0.94) * 0.0205) * 3.0;
  h += Math.sin(x * 0.061) * Math.cos(z * 0.053) * 1.05;
  h += Math.sin(x * 0.171 + z * 0.113) * 0.32;

  // Area start dibuat lebih landai supaya mobil tidak langsung menabrak bukit.
  const d = Math.sqrt(x * x + z * z);
  const flat = THREE.MathUtils.smoothstep(d, 30, 140);
  h *= 0.2 + 0.8 * flat;

  return h;
}

const _n = new THREE.Vector3();

export function terrainNormal(x, z, out = _n) {
  const e = 0.7;
  const hL = terrainHeight(x - e, z);
  const hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e);
  const hU = terrainHeight(x, z + e);
  return out.set(hL - hR, 2 * e, hD - hU).normalize();
}

/** Kemiringan medan 0..1 (0 = datar) */
export function terrainSlope(x, z) {
  return 1 - terrainNormal(x, z).y;
}

function makeDetailTexture() {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#b6b2aa';
  ctx.fillRect(0, 0, S, S);

  for (let i = 0; i < 2800; i++) {
    const r = 1 + Math.random() * 9;
    const g = 118 + Math.random() * 122;
    ctx.fillStyle = 'rgba(' + (g | 0) + ',' + ((g * 0.97) | 0) + ',' + ((g * 0.9) | 0) + ',0.2)';
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(52, 52);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const C_ROCK = new THREE.Color(0.40, 0.36, 0.32);
const C_DIRT = new THREE.Color(0.50, 0.38, 0.24);
const C_GRASS = new THREE.Color(0.45, 0.48, 0.24);
const C_SAND = new THREE.Color(0.68, 0.57, 0.40);

export class Terrain {
  constructor() {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEG, TERRAIN_SEG);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const count = pos.count;

    for (let i = 0; i < count; i++) {
      pos.setY(i, terrainHeight(pos.getX(i), pos.getZ(i)));
    }
    geo.computeVertexNormals();

    const nrm = geo.attributes.normal;
    const colors = new Float32Array(count * 3);
    const col = new THREE.Color();

    for (let i = 0; i < count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = pos.getY(i);
      const steep = 1 - nrm.getY(i);

      const n1 = Math.sin(x * 0.087 + 0.4) * Math.cos(z * 0.071 - 1.1) * 0.5 + 0.5;
      const n2 = Math.sin(x * 0.023 - 2.0) * Math.cos(z * 0.031 + 0.5) * 0.5 + 0.5;

      col.copy(C_DIRT).lerp(C_GRASS, n1 * 0.85);
      col.lerp(C_SAND, Math.max(0, n2 - 0.55) * 1.4);
      col.lerp(C_ROCK, THREE.MathUtils.smoothstep(steep, 0.15, 0.40));
      col.lerp(C_SAND, THREE.MathUtils.smoothstep(y, 8, 26) * 0.22);

      const vb = THREE.MathUtils.smoothstep(-y, 4, 20);
      col.multiplyScalar(1 - vb * 0.2);

      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: makeDetailTexture(),
      roughness: 0.96,
      metalness: 0.02,
      envMapIntensity: 0.3,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.name = 'terrain';
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  heightAt(x, z) {
    return terrainHeight(x, z);
  }

  normalAt(x, z, out) {
    return terrainNormal(x, z, out);
  }
}
