import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

import { Terrain, terrainHeight } from './terrain.js';
import { Vehicle } from './vehicle.js';
import { CameraRig } from './cameras.js';
import { Track, CHECKPOINT_COUNT } from './track.js';
import { Scenery, Dust } from './scenery.js';

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.insertBefore(renderer.domElement, document.body.firstChild);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);

// ---------------------------------------------------------------------------
// Langit + matahari
// ---------------------------------------------------------------------------
const sunDir = new THREE.Vector3().setFromSphericalCoords(
  1,
  THREE.MathUtils.degToRad(90 - 24),
  THREE.MathUtils.degToRad(135)
);

const sky = new Sky();
sky.scale.setScalar(450000);
sky.material.uniforms.turbidity.value = 5.2;
sky.material.uniforms.rayleigh.value = 1.6;
sky.material.uniforms.mieCoefficient.value = 0.006;
sky.material.uniforms.mieDirectionalG.value = 0.82;
sky.material.uniforms.sunPosition.value.copy(sunDir);
scene.add(sky);

const HORIZON = new THREE.Color(0xb3c8db);
scene.background = HORIZON.clone();
scene.fog = new THREE.Fog(HORIZON.getHex(), 260, 1000);

const sun = new THREE.DirectionalLight(0xfff2dd, 2.6);
sun.position.copy(sunDir).multiplyScalar(180);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 460;
sun.shadow.camera.left = -62;
sun.shadow.camera.right = 62;
sun.shadow.camera.top = 62;
sun.shadow.camera.bottom = -62;
sun.shadow.bias = -0.0009;
sun.shadow.normalBias = 0.035;
scene.add(sun);
scene.add(sun.target);

const hemi = new THREE.HemisphereLight(0xcfe3f5, 0x6b5a42, 0.85);
scene.add(hemi);

const fill = new THREE.DirectionalLight(0x9fc0e0, 0.35);
fill.position.set(-120, 80, -160);
scene.add(fill);

// ---- environment map dari langit (refleksi bodi mobil) ----
{
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(100);
  envSky.material.uniforms.turbidity.value = 5.2;
  envSky.material.uniforms.rayleigh.value = 1.6;
  envSky.material.uniforms.mieCoefficient.value = 0.006;
  envSky.material.uniforms.mieDirectionalG.value = 0.82;
  envSky.material.uniforms.sunPosition.value.copy(sunDir);
  envScene.add(envSky);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(envScene, 0.035, 0.1, 1000);
  scene.environment = rt.texture;
  pmrem.dispose();
}

// ---------------------------------------------------------------------------
// Dunia
// ---------------------------------------------------------------------------
const terrain = new Terrain();
scene.add(terrain.mesh);

const track = new Track(scene);
const scenery = new Scenery(scene, track.curve, track.samples);
const dust = new Dust(scene, 320);

const vehicle = new Vehicle();
scene.add(vehicle.root);

const camRig = new CameraRig(camera, vehicle);

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------
const el = {
  hud: document.getElementById('hud'),
  camModeText: document.getElementById('camModeText'),
  timeVal: document.getElementById('timeVal'),
  cpVal: document.getElementById('cpVal'),
  bestVal: document.getElementById('bestVal'),
  speedVal: document.getElementById('speedVal'),
  speedBar: document.getElementById('speedBar'),
  gearChip: document.getElementById('gearChip'),
  driveChip: document.getElementById('driveChip'),
  airChip: document.getElementById('airChip'),
  fps: document.getElementById('fps'),
  loading: document.getElementById('loading'),
  loadBar: document.getElementById('loadBar'),
  loadText: document.getElementById('loadText'),
  start: document.getElementById('start'),
  pause: document.getElementById('pause'),
  finish: document.getElementById('finish'),
  finishSub: document.getElementById('finishSub'),
};

const BEST_KEY = 'bj40-offroad-best-v1';
let bestTime = parseFloat(localStorage.getItem(BEST_KEY) || '') || 0;

function fmtTime(sec) {
  if (!isFinite(sec) || sec <= 0) return '--:--.-';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const d = Math.floor((sec * 10) % 10);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + d;
}

el.bestVal.textContent = fmtTime(bestTime);
el.cpVal.textContent = '0 / ' + CHECKPOINT_COUNT;

let toastTimer = 0;
function toast(msg, cool) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('cool', !!cool);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2300);
}

// ---------------------------------------------------------------------------
// Minimap
// ---------------------------------------------------------------------------
const MAP_HALF = 560;
const mapCanvas = document.getElementById('minimap');
const mapCtx = mapCanvas.getContext('2d');
const MAP_S = mapCanvas.width;
const MAP_C = MAP_S * 0.5;
const mapScale = MAP_C / MAP_HALF;

function mx(x) { return MAP_C + x * mapScale; }
function mz(z) { return MAP_C + z * mapScale; }

const mapStatic = document.createElement('canvas');
mapStatic.width = mapStatic.height = MAP_S;
{
  const g = mapStatic.getContext('2d');

  g.fillStyle = 'rgba(9,13,18,0.62)';
  g.fillRect(0, 0, MAP_S, MAP_S);

  // grid
  g.strokeStyle = 'rgba(255,255,255,0.045)';
  g.lineWidth = 1;
  for (let i = -400; i <= 400; i += 200) {
    g.beginPath(); g.moveTo(mx(i), 0); g.lineTo(mx(i), MAP_S); g.stroke();
    g.beginPath(); g.moveTo(0, mz(i)); g.lineTo(MAP_S, mz(i)); g.stroke();
  }

  // rute
  g.beginPath();
  for (let i = 0; i < track.samples.length; i++) {
    const s = track.samples[i];
    const px = mx(s.x), py = mz(s.z);
    if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
  }
  g.closePath();
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 11;
  g.lineJoin = 'round';
  g.stroke();

  g.strokeStyle = 'rgba(255,179,71,0.55)';
  g.lineWidth = 3;
  g.stroke();

  // titik checkpoint
  for (const cp of track.checkpoints) {
    g.beginPath();
    g.arc(mx(cp.pos.x), mz(cp.pos.z), 4.5, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fill();
  }

  // bingkai
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, MAP_S - 2, MAP_S - 2);
}

function drawMinimap() {
  const g = mapCtx;
  g.clearRect(0, 0, MAP_S, MAP_S);
  g.drawImage(mapStatic, 0, 0);

  for (let i = 0; i < track.checkpoints.length; i++) {
    const cp = track.checkpoints[i];
    const px = mx(cp.pos.x), py = mz(cp.pos.z);
    const next = i === track.nextIndex && !cp.passed;

    g.beginPath();
    g.arc(px, py, next ? 7 : 4.5, 0, Math.PI * 2);
    if (cp.passed) {
      g.fillStyle = 'rgba(110,231,168,0.95)';
    } else if (next) {
      g.fillStyle = 'rgba(255,179,71,0.98)';
    } else {
      g.fillStyle = 'rgba(120,140,160,0.6)';
    }
    g.fill();

    if (next) {
      g.beginPath();
      g.arc(px, py, 13, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,179,71,0.55)';
      g.lineWidth = 2;
      g.stroke();
    }
  }

  // mobil
  const cx = mx(vehicle.pos.x);
  const cy = mz(vehicle.pos.z);
  const ang = Math.atan2(-Math.cos(vehicle.yaw), -Math.sin(vehicle.yaw));

  g.save();
  g.translate(cx, cy);
  g.rotate(ang);
  g.beginPath();
  g.moveTo(11, 0);
  g.lineTo(-7, 7);
  g.lineTo(-3.5, 0);
  g.lineTo(-7, -7);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(255,179,71,0.9)';
  g.shadowBlur = 10;
  g.fill();
  g.restore();
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const keys = Object.create(null);
const input = { forward: false, back: false, left: false, right: false, handbrake: false };

const state = { mode: 'loading', elapsed: 0, frames: 0, fpsTimer: 0 };

function readInput() {
  input.forward = !!(keys['KeyW'] || keys['ArrowUp']);
  input.back = !!(keys['KeyS'] || keys['ArrowDown']);
  input.left = !!(keys['KeyA'] || keys['ArrowLeft']);
  input.right = !!(keys['KeyD'] || keys['ArrowRight']);
  input.handbrake = !!keys['Space'];
}

window.addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();

  if (!keys[e.code]) {
    if (e.code === 'KeyC') {
      const label = camRig.cycle();
      el.camModeText.textContent = label;
      toast(label, true);
    } else if (e.code === 'KeyR') {
      if (state.mode === 'playing' || state.mode === 'paused') respawnAtCheckpoint();
    } else if (e.code === 'KeyP') {
      if (state.mode === 'playing') pauseGame();
      else if (state.mode === 'paused') resumeGame();
    } else if (e.code === 'Enter') {
      if (state.mode === 'ready') startGame();
      else if (state.mode === 'finished') restartGame();
    }
  }

  keys[e.code] = true;
  readInput();
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  readInput();
});

// ---- mouse look ----
let dragging = false;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  dragging = true;
  camRig.beginDrag();
  renderer.domElement.setPointerCapture(e.pointerId);
});
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  camRig.drag(e.movementX || 0, e.movementY || 0);
});
const endDrag = (e) => {
  if (!dragging) return;
  dragging = false;
  camRig.endDrag();
  try { renderer.domElement.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
};
renderer.domElement.addEventListener('pointerup', endDrag);
renderer.domElement.addEventListener('pointercancel', endDrag);

renderer.domElement.addEventListener('wheel', (e) => {
  camRig.orbitDist = THREE.MathUtils.clamp(camRig.orbitDist + Math.sign(e.deltaY) * 0.9, 4.5, 26);
}, { passive: true });

// ---------------------------------------------------------------------------
// Alur permainan
// ---------------------------------------------------------------------------
let startPos = new THREE.Vector3(0, 0, 40);
let startYaw = 0;

function computeStart() {
  const p = track.curve.getPointAt(0);
  const tan = track.curve.getTangentAt(0).setY(0).normalize();
  startPos.set(p.x - tan.x * 14, 0, p.z - tan.z * 14);
  startPos.y = terrainHeight(startPos.x, startPos.z);
  startYaw = Math.atan2(-tan.x, -tan.z);
}

function startGame() {
  el.start.classList.add('hidden');
  el.finish.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.hud.classList.add('visible');
  state.mode = 'playing';
  state.elapsed = 0;
  toast('GO! LEWATI SEMUA CHECKPOINT', true);
}

function pauseGame() {
  if (state.mode !== 'playing') return;
  state.mode = 'paused';
  el.pause.classList.remove('hidden');
}

function resumeGame() {
  if (state.mode !== 'paused') return;
  state.mode = 'playing';
  el.pause.classList.add('hidden');
  clock.getDelta();
}

function restartGame() {
  track.resetStates();
  dust.clear();
  computeStart();
  vehicle.reset(startPos, startYaw);
  camRig.snapToCar();
  el.finish.classList.add('hidden');
  el.pause.classList.add('hidden');
  el.start.classList.add('hidden');
  el.hud.classList.add('visible');
  state.elapsed = 0;
  state.mode = 'playing';
  el.cpVal.textContent = '0 / ' + CHECKPOINT_COUNT;
  toast('PETUALANGAN DIMULAI ULANG', true);
}

function respawnAtCheckpoint() {
  const r = track.respawn();
  vehicle.reset(r.pos, r.yaw);
  camRig.snapToCar();
  dust.clear();
  toast('KEMBALI KE CHECKPOINT TERAKHIR');
}

function finishRun() {
  state.mode = 'finished';
  const t = state.elapsed;

  let extra = '';
  if (!bestTime || t < bestTime) {
    bestTime = t;
    localStorage.setItem(BEST_KEY, String(bestTime));
    el.bestVal.textContent = fmtTime(bestTime);
    extra = ' — REKOR BARU!';
  }

  el.finishSub.textContent = 'Waktu kamu: ' + fmtTime(t) + extra;
  el.finish.classList.remove('hidden');
  el.hud.classList.remove('visible');
  toast('SELAMAT! SEMUA CHECKPOINT TERLEWATI', true);
}

document.getElementById('startBtn').addEventListener('click', startGame);
document.getElementById('resumeBtn').addEventListener('click', resumeGame);
document.getElementById('restartBtn').addEventListener('click', restartGame);
document.getElementById('againBtn').addEventListener('click', restartGame);

window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  readInput();
  if (state.mode === 'playing') pauseGame();
});

// ---------------------------------------------------------------------------
// Ukuran layar
// ---------------------------------------------------------------------------
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', onResize);

// ---------------------------------------------------------------------------
// Muat model
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

async function boot() {
  el.loadBar.style.width = '4%';
  el.loadText.textContent = 'MEMUAT MODEL BAIC BJ40 — 0%';

  await vehicle.load('/models/BAIC+BJ40.glb', (p) => {
    const pct = Math.round(p * 100);
    el.loadBar.style.width = Math.max(4, pct) + '%';
    el.loadText.textContent = 'MEMUAT MODEL BAIC BJ40 — ' + pct + '%';
  });

  vehicle.body.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });

  el.loadText.textContent = 'MENYIAPKAN MEDAN PERBUATAN';
  el.loadBar.style.width = '100%';

  computeStart();
  vehicle.reset(startPos, startYaw);
  camRig.snapToCar();
  camRig.update(0.016, 0);

  // render sekali untuk memanaskan shader
  renderer.compile(scene, camera);

  el.loading.classList.add('hidden');
  el.start.classList.remove('hidden');
  state.mode = 'ready';
  clock.getDelta();
  animate();
}

boot().catch((err) => {
  console.error(err);
  el.loadText.textContent = 'GAGAL MEMUAT MODEL — ' + (err && err.message ? err.message : 'kesalahan tidak diketahui');
  el.loadBar.style.background = 'linear-gradient(90deg,#ff5b3d,#ff2d2d)';
});

// ---------------------------------------------------------------------------
// Loop utama
// ---------------------------------------------------------------------------
const tmpV = new THREE.Vector3();
let dustAccum = 0;

function animate() {
  requestAnimationFrame(animate);

  const dtRaw = clock.getDelta();
  const dt = Math.min(dtRaw, 0.05);
  const now = performance.now() * 0.001;

  // ---- update dunia ----
  if (state.mode === 'playing') {
    readInput();
    vehicle.update(dt, input);
    state.elapsed += dt;

    const hit = track.check(pos3(vehicle.pos));
    if (hit) {
      el.cpVal.textContent = hit.checkpoint.index + 1 + ' / ' + CHECKPOINT_COUNT;
      if (hit.finished) {
        finishRun();
      } else {
        toast('CHECKPOINT ' + (hit.checkpoint.index + 1) + ' TERLEWATI', true);
      }
    }

    // debu
    const spd = Math.abs(vehicle.speed);
    if (vehicle.grounded && spd > 5) {
      dustAccum += dt * Math.min(70, spd * 2.4);
      while (dustAccum >= 1) {
        dustAccum -= 1;
        const w = vehicle.wheels[2 + (Math.random() < 0.5 ? 0 : 1)];
        vehicle.localToWorld(w.local.x, 0.16, w.local.z, tmpV);
        dust.emit(tmpV.x, tmpV.y, tmpV.z, Math.min(1, spd / 22));
      }
    } else {
      dustAccum = 0;
    }

    if (vehicle.impact > 0.05) camRig.addShake(vehicle.impact * 0.55);
  } else if (state.mode === 'paused' || state.mode === 'finished') {
    vehicle.update(dt, { forward: false, back: false, left: false, right: false, handbrake: true });
  }

  dust.update(dt);
  track.update(dt, now);

  // ---- kamera ----
  vehicle.root.updateMatrixWorld(true);
  camRig.update(dt, vehicle.telemetry.kmh);

  // ---- matahari mengikuti mobil ----
  sun.position.copy(vehicle.pos).addScaledVector(sunDir, 170);
  sun.target.position.copy(vehicle.pos);
  sun.target.updateMatrixWorld();

  // ---- HUD ----
  if (state.mode !== 'loading') {
    const kmh = vehicle.telemetry.kmh;
    el.speedVal.textContent = String(Math.round(kmh));
    el.speedBar.style.width = Math.min(100, (kmh / 140) * 100) + '%';
    el.gearChip.textContent = vehicle.telemetry.gear;
    el.gearChip.classList.toggle('on', vehicle.telemetry.gear === 'D');
    el.gearChip.classList.toggle('warn', vehicle.telemetry.gear === 'R');
    el.driveChip.classList.toggle('on', vehicle.grounded);
    el.driveChip.classList.toggle('warn', !vehicle.grounded);
    el.airChip.classList.toggle('on', !vehicle.grounded);
    el.timeVal.textContent = fmtTime(state.elapsed);
    drawMinimap();
  }

  state.frames++;
  state.fpsTimer += dtRaw;
  if (state.fpsTimer >= 0.5) {
    el.fps.textContent = Math.round(state.frames / state.fpsTimer) + ' FPS';
    state.frames = 0;
    state.fpsTimer = 0;
  }

  renderer.render(scene, camera);
}

function pos3(v) {
  return v;
}

// ---------------------------------------------------------------------------
// Debug hook (dipakai untuk pengujian otomatis)
// ---------------------------------------------------------------------------
window.__game = {
  THREE, renderer, scene, camera, terrain, track, scenery, dust, vehicle, camRig,
  state, input, keys,
  start: startGame, pause: pauseGame, resume: resumeGame, restart: restartGame,
  respawn: respawnAtCheckpoint,
};
