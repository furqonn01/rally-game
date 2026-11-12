import * as THREE from 'three';

/**
 * Speedometer (digital cluster) dan Head Unit (infotainment) di dalam kabin BAIC BJ40.
 *
 * Diletakkan presisi di ruang mesh-lokal kabin:
 * - Speedometer: tepat di binnacle instrumen di balik kemudi (mesh 'zk' driver pod)
 * - Head Unit: di konsol tengah bergaya floating tablet modern BAIC BJ40 PLUS,
 *   dimiringkan ~15° menghadap pengemudi untuk ergonomi dan visibilitas sempurna.
 *
 * Kedua layar menggunakan CanvasTexture dinamis beresolusi tinggi dengan material
 * berpendar (emissive) agar menyala terang dan terbaca jelas dari POV pengemudi
 * maupun dari kamera luar melalui kaca transparan.
 */

const SPEEDO_W = 1024;
const SPEEDO_H = 384;
const HEAD_W = 1024;
const HEAD_H = 576;

// Posisi & dimensi speedometer di ruang bodi mobil (mesh-lokal)
// Analisis geometri: binnacle 'zk' X: -0.58 s/d -0.27, Y: 0.74 s/d 0.85, Z: -0.375
const SPEEDO_POS = new THREE.Vector3(-0.426, 0.793, -0.370);
const SPEEDO_SIZE = { w: 0.312, h: 0.114 };

// Konsol tengah: nempel langsung di ceruk permukaan konsol tengah bawaan model BAIC BJ40
const HEAD_POS = new THREE.Vector3(0.000, 0.695, -0.340);
const HEAD_SIZE = { w: 0.248, h: 0.116 };
const HEAD_ROT = new THREE.Euler(0.105, 0.035, 0, 'YXZ'); // mengikuti kemiringan ceruk konsol

export class CabinDisplay {
  constructor() {
    this.root = new THREE.Group();
    this.root.name = 'cabinDisplays';

    // Canvas untuk speedometer
    this.speedoCanvas = document.createElement('canvas');
    this.speedoCanvas.width = SPEEDO_W;
    this.speedoCanvas.height = SPEEDO_H;
    this.speedoCtx = this.speedoCanvas.getContext('2d');

    this.speedoTexture = new THREE.CanvasTexture(this.speedoCanvas);
    this.speedoTexture.colorSpace = THREE.SRGBColorSpace;
    this.speedoTexture.minFilter = THREE.LinearFilter;
    this.speedoTexture.magFilter = THREE.LinearFilter;

    // Canvas untuk head unit
    this.headCanvas = document.createElement('canvas');
    this.headCanvas.width = HEAD_W;
    this.headCanvas.height = HEAD_H;
    this.headCtx = this.headCanvas.getContext('2d');

    this.headTexture = new THREE.CanvasTexture(this.headCanvas);
    this.headTexture.colorSpace = THREE.SRGBColorSpace;
    this.headTexture.minFilter = THREE.LinearFilter;
    this.headTexture.magFilter = THREE.LinearFilter;

    // Material layar: emissive agar menyala di dalam kabin gelap
    const speedoMat = new THREE.MeshStandardMaterial({
      map: this.speedoTexture,
      emissive: 0xffffff,
      emissiveMap: this.speedoTexture,
      emissiveIntensity: 1.25,
      roughness: 0.25,
      metalness: 0.05,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    this.speedoMat = speedoMat;

    this.headMat = new THREE.MeshStandardMaterial({
      map: this.headTexture,
      emissive: 0xffffff,
      emissiveMap: this.headTexture,
      emissiveIntensity: 1.25,
      roughness: 0.22,
      metalness: 0.05,
      toneMapped: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });

    // Material bezel / bingkai hitam matte
    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0x121418,
      roughness: 0.70,
      metalness: 0.50,
    });

    // ---- 1. Speedometer Mesh (di binnacle instrumen 'zk') ----
    const speedoGroup = new THREE.Group();
    speedoGroup.position.copy(SPEEDO_POS);

    // Bezel belakang
    const speedoBezel = new THREE.Mesh(
      new THREE.PlaneGeometry(SPEEDO_SIZE.w + 0.008, SPEEDO_SIZE.h + 0.008),
      bezelMat
    );
    speedoBezel.position.set(0, 0, -0.001);
    speedoGroup.add(speedoBezel);

    // Layar
    const speedoMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SPEEDO_SIZE.w, SPEEDO_SIZE.h),
      speedoMat
    );
    speedoMesh.name = 'speedoScreen';
    speedoGroup.add(speedoMesh);
    this.root.add(speedoGroup);

    // ---- 2. Head Unit Mesh ----
    // Nempel langsung pada bidang permukaan konsol tengah model mobil,
    // TANPA membuat kotakan tebal sendiri ("bukan bikin kotakan sendiri")
    const headMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(HEAD_SIZE.w, HEAD_SIZE.h),
      this.headMat
    );
    headMesh.position.copy(HEAD_POS);
    headMesh.rotation.copy(HEAD_ROT);
    headMesh.name = 'headUnitScreen';
    this.root.add(headMesh);
    this.headUnitMesh = headMesh;

    // State internal animasi & timer throttled
    this.speedoTimer = 0;
    this.headTimer = 0;
    this.blinkTimer = 0;
    this.eqPhase = 0;
    this.smoothKmh = 0;
    this.smoothRpm = 820;

    // Render awal
    this.renderSpeedo(0, 820, 'N', 0, 0, false, false, true, 0);
    this.renderHeadUnit(0, 0, 0, 0, 'N', 0, 0, 820);
    this.speedoTexture.needsUpdate = true;
    this.headTexture.needsUpdate = true;
  }

  /**
   * Menempelkan Head Unit display langsung pada mesh 'cd' (konsol tengah) model 3D.
   * Tidak membuat kotak/bezel custom terpisah ("bukan bikin kotakan sendiri").
   */
  attachToHeadUnit(cdMesh) {
    if (!cdMesh || !cdMesh.isMesh) return;
    this.headUnitMesh = cdMesh;

    cdMesh.geometry.computeBoundingBox();
    const bb = cdMesh.geometry.boundingBox;
    const pos = cdMesh.geometry.attributes.position;
    const spanX = Math.max(0.001, bb.max.x - bb.min.x);
    const spanY = Math.max(0.001, bb.max.y - bb.min.y);
    const uvs = new Float32Array(pos.count * 2);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      uvs[i * 2] = (x - bb.min.x) / spanX;
      uvs[i * 2 + 1] = (y - bb.min.y) / spanY;
    }

    cdMesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    cdMesh.material = this.headMat;
    cdMesh.castShadow = false;
    cdMesh.receiveShadow = false;
  }

  reset() {
    this.smoothKmh = 0;
    this.smoothRpm = 820;
    this.renderSpeedo(0, 820, 'N', 0, 0, false, false, true, 0);
    this.renderHeadUnit(0, 0, 0, 0, 'N', 0, 0, 820);
    this.speedoTexture.needsUpdate = true;
    this.headTexture.needsUpdate = true;
  }

  update(vehicle, dt, isDriverMode = true) {
    this.blinkTimer += dt;
    this.eqPhase += dt * 8.5;
    this.speedoTimer = (this.speedoTimer || 0) + dt;
    this.headTimer = (this.headTimer || 0) + dt;

    // Refresh rate teroptimasi: speedometer ~30 fps, head unit ~20 fps saat di kabin.
    // Di luar kabin, turunkan ke ~7 fps untuk menghemat CPU dan upload tekstur GPU.
    const speedoInterval = isDriverMode ? 0.033 : 0.140;
    const headInterval = isDriverMode ? 0.050 : 0.180;

    const doSpeedo = this.speedoTimer >= speedoInterval;
    const doHead = this.headTimer >= headInterval;

    if (!doSpeedo && !doHead) return;

    const telem = vehicle.telemetry || {};
    const kmhTarget = telem.kmh || 0;
    const rpmTarget = vehicle.rpm || 820;
    const gear = telem.gear || 'N';
    const steer = vehicle.steer || 0;
    const pitch = vehicle.bodyPitch || 0;
    const roll = vehicle.bodyRoll || 0;
    const altitude = vehicle.pos ? vehicle.pos.y : 0;
    const roughness = vehicle.roughness || 0;
    const slip = telem.slip || 0;
    const yaw = vehicle.yaw || 0;

    // Penghalusan jarum & angka
    const interpDt = Math.min(0.05, Math.max(dt, this.speedoTimer));
    this.smoothKmh += (kmhTarget - this.smoothKmh) * Math.min(1, interpDt * 20);
    this.smoothRpm += (rpmTarget - this.smoothRpm) * Math.min(1, interpDt * 18);

    if (doSpeedo) {
      this.speedoTimer = 0;
      const blinkOn = Math.floor(this.blinkTimer * 3.5) % 2 === 0;
      const blinkLeft = steer > 0.08 && blinkOn;
      const blinkRight = steer < -0.08 && blinkOn;
      const handbrake = Math.abs(vehicle.speed || 0) < 0.4 && gear === 'N';

      this.renderSpeedo(
        this.smoothKmh,
        this.smoothRpm,
        gear,
        steer,
        slip,
        blinkLeft,
        blinkRight,
        handbrake,
        roughness
      );
      this.speedoTexture.needsUpdate = true;
    }

    if (doHead) {
      this.headTimer = 0;
      this.renderHeadUnit(
        pitch,
        roll,
        yaw,
        altitude,
        gear,
        roughness,
        slip,
        this.smoothRpm
      );
      this.headTexture.needsUpdate = true;
    }
  }

  // =========================================================================
  // SPEEDOMETER (Instrument Cluster)
  // =========================================================================
  renderSpeedo(kmh, rpm, gear, steer, slip, blinkL, blinkR, handbrake, rough) {
    const ctx = this.speedoCtx;
    const W = SPEEDO_W;
    const H = SPEEDO_H;

    // Latar belakang gradien kabin digital
    const bgGrad = ctx.createLinearGradient(0, 0, 0, H);
    bgGrad.addColorStop(0, '#04070d');
    bgGrad.addColorStop(0.5, '#09111c');
    bgGrad.addColorStop(1, '#030509');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, W, H);

    // Garis aksen bingkai instrumen
    ctx.strokeStyle = '#1d3350';
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, W - 16, H - 16);

    // Pola grid vertikal halus di latar
    ctx.strokeStyle = 'rgba(20, 38, 64, 0.45)';
    ctx.lineWidth = 1;
    for (let x = 40; x < W; x += 55) {
      ctx.beginPath();
      ctx.moveTo(x, 14);
      ctx.lineTo(x, H - 14);
      ctx.stroke();
    }

    // ---- 1. POD KIRI: TACHOMETER (RPM) ----
    const cxL = 205;
    const cyL = 205;
    const rL = 128;

    const aStartL = 0.75 * Math.PI; // 135°
    const aEndL = 2.25 * Math.PI;   // 405° / 45°
    const maxRpm = 6000;
    const rpmRatio = Math.min(1, Math.max(0, rpm / maxRpm));
    const aCurrentL = aStartL + (aEndL - aStartL) * rpmRatio;

    // Busur dasar
    ctx.beginPath();
    ctx.arc(cxL, cyL, rL, aStartL, aEndL);
    ctx.strokeStyle = '#132133';
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Zona Redline (di atas 4500 RPM)
    const aRedlineL = aStartL + (aEndL - aStartL) * (4500 / maxRpm);
    ctx.beginPath();
    ctx.arc(cxL, cyL, rL, aRedlineL, aEndL);
    ctx.strokeStyle = 'rgba(255, 30, 60, 0.45)';
    ctx.lineWidth = 15;
    ctx.stroke();

    // Busur aktif RPM
    if (rpmRatio > 0.01) {
      const rpmGrad = ctx.createLinearGradient(cxL - rL, cyL, cxL + rL, cyL);
      rpmGrad.addColorStop(0, '#00e5ff');
      rpmGrad.addColorStop(0.65, '#00b0ff');
      rpmGrad.addColorStop(0.85, '#ff9100');
      rpmGrad.addColorStop(1, '#ff1744');
      ctx.beginPath();
      ctx.arc(cxL, cyL, rL, aStartL, aCurrentL);
      ctx.strokeStyle = rpmGrad;
      ctx.lineWidth = 15;
      ctx.stroke();
    }

    // Tanda angka RPM
    ctx.fillStyle = '#9cb6d8';
    ctx.font = '700 18px "Segoe UI", Trebuchet, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 6; i++) {
      const a = aStartL + (aEndL - aStartL) * (i / 6);
      const tx = cxL + Math.cos(a) * (rL - 28);
      const ty = cyL + Math.sin(a) * (rL - 28);
      ctx.fillText(String(i), tx, ty);
    }

    // Teks tengah RPM
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 14px "Segoe UI", sans-serif';
    ctx.fillText('x1000 r/min', cxL, cyL - 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 36px "Segoe UI", sans-serif';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.fillText(String(Math.round(rpm)), cxL, cyL + 12);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#8eaecf';
    ctx.font = '700 14px "Segoe UI", sans-serif';
    ctx.fillText('RPM', cxL, cyL + 40);

    // Jarum Tachometer
    ctx.save();
    ctx.translate(cxL, cyL);
    ctx.rotate(aCurrentL);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(rL - 8, -1.5);
    ctx.lineTo(rL - 8, 1.5);
    ctx.lineTo(0, 4);
    ctx.fillStyle = '#ff3d00';
    ctx.shadowColor = '#ff3d00';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();

    // ---- 2. POD KANAN: SPEEDOMETER ANALOG & AUX ----
    const cxR = W - 205;
    const cyR = 205;
    const rR = 128;
    const maxSpd = 160;
    const spdRatio = Math.min(1, Math.max(0, kmh / maxSpd));
    const aStartR = 0.75 * Math.PI;
    const aEndR = 2.25 * Math.PI;
    const aCurrentR = aStartR + (aEndR - aStartR) * spdRatio;

    // Busur dasar speedo
    ctx.beginPath();
    ctx.arc(cxR, cyR, rR, aStartR, aEndR);
    ctx.strokeStyle = '#132133';
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Busur aktif speedo
    if (spdRatio > 0.01) {
      const spdGrad = ctx.createLinearGradient(cxR - rR, cyR, cxR + rR, cyR);
      spdGrad.addColorStop(0, '#00e5ff');
      spdGrad.addColorStop(0.65, '#00e676');
      spdGrad.addColorStop(1, '#ffab00');
      ctx.beginPath();
      ctx.arc(cxR, cyR, rR, aStartR, aCurrentR);
      ctx.strokeStyle = spdGrad;
      ctx.lineWidth = 15;
      ctx.stroke();
    }

    // Tanda angka Speedo
    ctx.fillStyle = '#9cb6d8';
    ctx.font = '700 17px "Segoe UI", Trebuchet, sans-serif';
    for (let sp = 0; sp <= 160; sp += 20) {
      const a = aStartR + (aEndR - aStartR) * (sp / 160);
      const tx = cxR + Math.cos(a) * (rR - 28);
      const ty = cyR + Math.sin(a) * (rR - 28);
      ctx.fillText(String(sp), tx, ty);
    }

    // Teks tengah Speedo
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 14px "Segoe UI", sans-serif';
    ctx.fillText('SPEED', cxR, cyR - 28);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 36px "Segoe UI", sans-serif';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 8;
    ctx.fillText(String(Math.round(kmh)), cxR, cyR + 12);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#8eaecf';
    ctx.font = '700 14px "Segoe UI", sans-serif';
    ctx.fillText('KM/H', cxR, cyR + 40);

    // Jarum Speedometer
    ctx.save();
    ctx.translate(cxR, cyR);
    ctx.rotate(aCurrentR);
    ctx.beginPath();
    ctx.moveTo(0, -4);
    ctx.lineTo(rR - 8, -1.5);
    ctx.lineTo(rR - 8, 1.5);
    ctx.lineTo(0, 4);
    ctx.fillStyle = '#00e5ff';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.restore();

    // Mini bar bahan bakar
    ctx.fillStyle = '#6f8ba8';
    ctx.font = '700 12px "Segoe UI", sans-serif';
    ctx.fillText('E', cxR - 58, cyR + 82);
    ctx.fillText('FUEL', cxR, cyR + 82);
    ctx.fillText('F', cxR + 58, cyR + 82);
    ctx.fillStyle = '#17273d';
    ctx.fillRect(cxR - 46, cyR + 92, 92, 7);
    ctx.fillStyle = '#00e676';
    ctx.fillRect(cxR - 46, cyR + 92, 76, 7); // ~82% fuel

    // ---- 3. BAGIAN TENGAH: DISPLAY DIGITAL BESAR ----
    const cxC = W / 2;

    // Angka kecepatan digital besar
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 102px "Segoe UI", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#00e5ff';
    ctx.shadowBlur = 16;
    ctx.fillText(String(Math.round(kmh)), cxC, 195);
    ctx.shadowBlur = 0;

    // Satuan km/h
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 20px "Segoe UI", sans-serif';
    ctx.fillText('km/h', cxC, 226);

    // Kotak Gear: [ P | R | N | D ]
    const gears = ['P', 'R', 'N', 'D'];
    const gW = 42;
    const gH = 38;
    const gSpacing = 10;
    const totalGW = gears.length * gW + (gears.length - 1) * gSpacing;
    const gStartX = cxC - totalGW / 2;
    const gY = 246;

    gears.forEach((g, idx) => {
      const gx = gStartX + idx * (gW + gSpacing);
      const isActive = gear === g;

      ctx.fillStyle = isActive
        ? (g === 'D' ? '#00e676' : g === 'R' ? '#ff3d00' : '#ffab00')
        : '#101d2d';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(gx, gY, gW, gH, 8) : ctx.rect(gx, gY, gW, gH);
      ctx.fill();

      if (isActive) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.fillStyle = isActive ? '#050a12' : '#7a9ec4';
      ctx.font = '700 20px "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(g, gx + gW / 2, gY + gH / 2);
    });

    // ---- 4. BAR STATUS & INDIKATOR DI ATAS ----
    const topY = 44;

    // Lampu sein kiri (blinker)
    ctx.fillStyle = blinkL ? '#00e676' : '#142a22';
    ctx.font = '700 32px "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('◀', cxC - 170, topY);

    // Lampu sein kanan (blinker)
    ctx.fillStyle = blinkR ? '#00e676' : '#142a22';
    ctx.fillText('▶', cxC + 170, topY);

    // Ikon Lampu Utama
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 15px "Segoe UI", sans-serif';
    ctx.fillText('AUTO 💡', cxC - 95, topY);

    // Ikon 4x4
    ctx.fillStyle = '#ffab00';
    ctx.fillText('4x4 4H', cxC, topY);

    // Ikon Rem Parkir (P)
    ctx.fillStyle = handbrake ? '#ff1744' : '#2b1219';
    ctx.fillText('(P) BRAKE', cxC + 95, topY);

    // Baris info bawah instrumen
    ctx.fillStyle = '#6586ac';
    ctx.font = '700 13px "Segoe UI", sans-serif';
    ctx.fillText('BAIC BJ40 OFFROAD 4WD  •  TERRAIN MODE: ROCK & TRAIL  •  ODO 1,280 km', cxC, H - 26);
  }

  // =========================================================================
  // HEAD UNIT (Center Infotainment Display)
  // =========================================================================
  renderHeadUnit(pitch, roll, yaw, altitude, gear, rough, slip, rpm) {
    const ctx = this.headCtx;
    const W = HEAD_W;
    const H = HEAD_H;

    // Latar belakang head unit
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#070b14');
    bg.addColorStop(0.5, '#0d1524');
    bg.addColorStop(1, '#050810');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // ---- 1. STATUS BAR ATAS (H = 52) ----
    ctx.fillStyle = '#0e1728';
    ctx.fillRect(0, 0, W, 52);
    ctx.strokeStyle = '#1e324e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 52);
    ctx.lineTo(W, 52);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 18px "Segoe UI", sans-serif';
    ctx.fillText('BAIC  BJ40 OFFROAD SYSTEM', 26, 26);

    // Jam & Suhu di tengah
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 19px "Segoe UI", sans-serif';
    ctx.fillText(`${hh}:${mm}   |   28°C CLEAR`, W / 2, 26);

    // Status GPS & Koneksi di kanan
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8ab2dc';
    ctx.font = '700 15px "Segoe UI", sans-serif';
    const altText = `ALT ${Math.round(altitude)}m   4G LTE   BT CONNECTED`;
    ctx.fillText(altText, W - 26, 26);

    // ---- 2. PANEL KIRI: INKLINOMETER & GYRO OFFROAD ----
    const pLeftX = 26;
    const pTopY = 68;
    const pW = 464;
    const pH = 434;

    ctx.fillStyle = '#0b1322';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(pLeftX, pTopY, pW, pH, 14) : ctx.rect(pLeftX, pTopY, pW, pH);
    ctx.fill();
    ctx.strokeStyle = '#1c2e47';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Judul kartu
    ctx.textAlign = 'left';
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 16px "Segoe UI", sans-serif';
    ctx.fillText('⛰️ OFFROAD INCLINOMETER & COMPASS', pLeftX + 20, pTopY + 28);

    // Kompas & Derajat Heading
    const yawDeg = ((yaw * 180 / Math.PI) % 360 + 360) % 360;
    const cardinals = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const cardIdx = Math.round(yawDeg / 45) % 8;
    const headingLabel = `${cardinals[cardIdx]} ${Math.round(yawDeg)}°`;

    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffab00';
    ctx.font = '700 16px "Segoe UI", sans-serif';
    ctx.fillText(headingLabel, pLeftX + pW - 20, pTopY + 28);

    // Lingkaran Gyro / Horizon Buatan
    const gyroCx = pLeftX + pW / 2;
    const gyroCy = pTopY + 162;
    const gyroR = 94;

    ctx.save();
    ctx.beginPath();
    ctx.arc(gyroCx, gyroCy, gyroR, 0, Math.PI * 2);
    ctx.clip();

    // Langit
    ctx.fillStyle = '#10223d';
    ctx.fillRect(gyroCx - gyroR, gyroCy - gyroR, gyroR * 2, gyroR * 2);

    // Tanah miring sesuai pitch & roll
    const pitchPx = (pitch * 180 / Math.PI) * 2.8;
    ctx.save();
    ctx.translate(gyroCx, gyroCy + pitchPx);
    ctx.rotate(-roll);
    ctx.fillStyle = '#422814'; // Tanah offroad cokelat
    ctx.fillRect(-gyroR * 2, 0, gyroR * 4, gyroR * 2);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-gyroR * 2, 0);
    ctx.lineTo(gyroR * 2, 0);
    ctx.stroke();
    ctx.restore();

    ctx.restore();

    // Bingkai lingkaran gyro
    ctx.beginPath();
    ctx.arc(gyroCx, gyroCy, gyroR, 0, Math.PI * 2);
    ctx.strokeStyle = '#2f4c72';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Siluet mobil BAIC di tengah gyro
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '700 28px "Segoe UI", sans-serif';
    ctx.fillText('🚙', gyroCx, gyroCy);

    // Kotak Nilai Pitch & Roll di bawah gyro
    const pitchDeg = (pitch * 180 / Math.PI).toFixed(1);
    const rollDeg = (roll * 180 / Math.PI).toFixed(1);

    const bW = 192;
    const bH = 74;
    const bY = pTopY + 280;

    // Kotak Pitch
    const bPitchX = pLeftX + 26;
    ctx.fillStyle = '#121d2f';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bPitchX, bY, bW, bH, 10) : ctx.rect(bPitchX, bY, bW, bH);
    ctx.fill();
    ctx.strokeStyle = '#243a59';
    ctx.stroke();
    ctx.fillStyle = '#8db2dc';
    ctx.font = '700 13px "Segoe UI", sans-serif';
    ctx.fillText('PITCH (DERAJAT)', bPitchX + bW / 2, bY + 22);
    ctx.fillStyle = Math.abs(pitchDeg) > 18 ? '#ff3d00' : '#00e676';
    ctx.font = '700 30px "Segoe UI", sans-serif';
    ctx.fillText(`${pitchDeg > 0 ? '+' : ''}${pitchDeg}°`, bPitchX + bW / 2, bY + 52);

    // Kotak Roll
    const bRollX = pLeftX + pW - 26 - bW;
    ctx.fillStyle = '#121d2f';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(bRollX, bY, bW, bH, 10) : ctx.rect(bRollX, bY, bW, bH);
    ctx.fill();
    ctx.strokeStyle = '#243a59';
    ctx.stroke();
    ctx.fillStyle = '#8db2dc';
    ctx.font = '700 13px "Segoe UI", sans-serif';
    ctx.fillText('ROLL (DERAJAT)', bRollX + bW / 2, bY + 22);
    ctx.fillStyle = Math.abs(rollDeg) > 14 ? '#ff3d00' : '#00e676';
    ctx.font = '700 30px "Segoe UI", sans-serif';
    ctx.fillText(`${rollDeg > 0 ? '+' : ''}${rollDeg}°`, bRollX + bW / 2, bY + 52);

    // Status diferensial bawah kartu kiri
    ctx.fillStyle = '#6f92bc';
    ctx.font = '700 13px "Segoe UI", sans-serif';
    ctx.fillText('DIFF LOCK: FRONT ACTIVE  •  REAR ACTIVE  •  ESC: OFFROAD', pLeftX + pW / 2, pTopY + 395);

    // ---- 3. PANEL KANAN: 4x4 MONITOR & MEDIA PLAYER ----
    const pRightX = W - pW - 26;

    // Sub-panel atas: 4WD Chassis Monitor
    const chH = 205;
    ctx.fillStyle = '#0b1322';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(pRightX, pTopY, pW, chH, 14) : ctx.rect(pRightX, pTopY, pW, chH);
    ctx.fill();
    ctx.strokeStyle = '#1c2e47';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#00e5ff';
    ctx.font = '700 16px "Segoe UI", sans-serif';
    ctx.fillText('🚗 4WD TRACTION MONITOR', pRightX + 20, pTopY + 28);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#00e676';
    ctx.font = '700 15px "Segoe UI", sans-serif';
    ctx.fillText('50 : 50 TORQUE SPLIT', pRightX + pW - 20, pTopY + 28);

    // Diagram 4 roda
    const chCx = pRightX + pW / 2;
    const chCy = pTopY + 112;
    const wSpreadX = 88;
    const wSpreadY = 46;

    // Sasis bodi penghubung roda
    ctx.strokeStyle = '#274061';
    ctx.lineWidth = 3;
    ctx.strokeRect(chCx - 40, chCy - 38, 80, 76);

    const wheelPos = [
      { x: chCx - wSpreadX, y: chCy - wSpreadY, label: 'FL' },
      { x: chCx + wSpreadX, y: chCy - wSpreadY, label: 'FR' },
      { x: chCx - wSpreadX, y: chCy + wSpreadY, label: 'RL' },
      { x: chCx + wSpreadX, y: chCy + wSpreadY, label: 'RR' },
    ];

    wheelPos.forEach((wp) => {
      ctx.fillStyle = slip > 0.15 ? '#ff9100' : '#00e676';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(wp.x - 14, wp.y - 20, 28, 40, 5) : ctx.rect(wp.x - 14, wp.y - 20, 28, 40);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 13px "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(wp.label, wp.x, wp.y);
    });

    ctx.fillStyle = '#8db2dc';
    ctx.font = '700 13px "Segoe UI", sans-serif';
    ctx.fillText('4H HIGH  •  TRACTION CONTROL: OPTIMAL', chCx, pTopY + chH - 18);

    // Sub-panel bawah: Media Player
    const mTopY = pTopY + chH + 16;
    const mH = pH - chH - 16;

    ctx.fillStyle = '#0b1322';
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(pRightX, mTopY, pW, mH, 14) : ctx.rect(pRightX, mTopY, pW, mH);
    ctx.fill();
    ctx.strokeStyle = '#1c2e47';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffab00';
    ctx.font = '700 16px "Segoe UI", sans-serif';
    ctx.fillText('🎵 MEDIA  •  OFFROAD FM 98.4', pRightX + 20, mTopY + 26);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 17px "Segoe UI", sans-serif';
    ctx.fillText('Wilderness Trail - BJ40 Acoustic Mix', pRightX + 20, mTopY + 56);
    ctx.fillStyle = '#8db2dc';
    ctx.font = '600 13px "Segoe UI", sans-serif';
    ctx.fillText('Surround 6-Speaker System  •  ▶ PLAYING', pRightX + 20, mTopY + 80);

    // Bar equalizer audio animasi
    const eqBars = 16;
    const eqStartX = pRightX + 20;
    const eqY = mTopY + 116;
    const barW = 18;
    const barGap = 9;

    for (let b = 0; b < eqBars; b++) {
      const freq = Math.sin(this.eqPhase + b * 0.45) * 0.5 + 0.5;
      const rpmBoost = (rpm / 6000) * 0.4;
      const barH = Math.max(6, Math.min(48, (freq + rpmBoost) * 44));

      const bx = eqStartX + b * (barW + barGap);
      const bGrad = ctx.createLinearGradient(0, eqY - barH, 0, eqY);
      bGrad.addColorStop(0, '#00e5ff');
      bGrad.addColorStop(1, '#004870');
      ctx.fillStyle = bGrad;
      ctx.fillRect(bx, eqY - barH, barW, barH);
    }

    // ---- 4. DOCK NAVIGASI BAWAH (H = 54) ----
    const dY = H - 56;
    ctx.fillStyle = '#09101d';
    ctx.fillRect(0, dY, W, 56);
    ctx.strokeStyle = '#182940';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, dY);
    ctx.lineTo(W, dY);
    ctx.stroke();

    const tabs = [
      { icon: '🗺️', label: 'NAVIGASI' },
      { icon: '⛰️', label: 'OFFROAD 4x4', active: true },
      { icon: '🎵', label: 'AUDIO' },
      { icon: '⚙️', label: 'KENDARAAN' },
    ];

    const tabW = W / tabs.length;
    tabs.forEach((tab, i) => {
      const tx = i * tabW;
      if (tab.active) {
        ctx.fillStyle = '#162942';
        ctx.fillRect(tx, dY, tabW, 56);
        ctx.fillStyle = '#00e5ff';
        ctx.fillRect(tx + 20, dY + 51, tabW - 40, 5); // garis aktif
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = tab.active ? '#00e5ff' : '#7a9ec4';
      ctx.font = '700 15px "Segoe UI", sans-serif';
      ctx.fillText(`${tab.icon}  ${tab.label}`, tx + tabW / 2, dY + 28);
    });
  }
}
