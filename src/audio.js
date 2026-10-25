// ---------------------------------------------------------------------------
// Suara kendaraan prosedural (Web Audio API)
// ---------------------------------------------------------------------------
// Semua suara dibangkitkan secara sintetis — tidak ada file audio yang perlu
// diunduh. Lapisan suara:
//   1. MESIN  : 3 osilator (saw / sub-saw / square) + lowpass + modulasi
//               pembakaran (LFO pada frekuensi firing 4 silinder 4-tak).
//   2. DIESEL : noise bandpass sempit yang mengikuti bukaan gas ("clatter").
//   3. BAN    : noise bandpass, intensitas mengikuti kecepatan + tekstur medan.
//   4. ANGIN  : noise highpass, mengikuti kecepatan kuadratik.
//   5. HUMM   : noise lowpass, getaran medan frekuensi rendah.
//   6. BENTURAN: burst osilator turun + krak kerikil.
//
// Profil KABIN vs LUAR KABIN sengaja dibuat berbeda:
//   - KABIN (POV pengemudi) : mesin lebih dominan tapi teredam (lowpass
//     rendah, terdengar "di dalam ruang"), kerikil & angin nyaris hilang,
//     road hum paling terasa karena bodi ikut bergetar.
//   - LUAR (kamera mobil / bebas) : mesin lebih terang & sedikit lebih pelan,
//     kerikil dan angin jelas terdengar, road hum teredam karena kamera tidak
//     menempel ke bodi.
// ---------------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class VehicleAudio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.paused = false;
    this.mode = 'mobil'; // id mode kamera (lihat CAM_MODES)
    this.volume = 0.85;

    this._lastImpact = 0;
    this._impactCool = 0;
    this._noiseBuffer = null;
  }

  get isCabin() {
    return this.mode === 'pengemudi';
  }

  // -------------------------------------------------------------------------
  // Inisialisasi — WAJIB dipanggil dari gesture pengguna (klik / tombol)
  // -------------------------------------------------------------------------
  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        try { await this.ctx.resume(); } catch (e) { /* abaikan */ }
      }
      this._applyGain();
      return;
    }

    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    this.ctx = ctx;

    // ---- bus utama + kompresor ----
    const master = ctx.createGain();
    master.gain.value = 0.0001; // fade-in dari senyap

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 24;
    comp.ratio.value = 3.0;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;

    master.connect(comp);
    comp.connect(ctx.destination);
    this.master = master;

    // ---- buffer noise 2 detik (dipakai semua lapisan noise) ----
    const len = Math.floor(ctx.sampleRate * 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;

    // ---- MESIN ----
    const engineBus = ctx.createGain();
    engineBus.gain.value = 0.9;

    const engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 900;
    engineFilter.Q.value = 1.5;

    const engineGain = ctx.createGain();
    engineGain.gain.value = 0.0001;

    engineBus.connect(engineFilter);
    engineFilter.connect(engineGain);
    engineGain.connect(master);

    const makeOsc = (type, level, detune) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 42;
      o.detune.value = detune || 0;
      const g = ctx.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(engineBus);
      o.start();
      return o;
    };

    this.oscMain = makeOsc('sawtooth', 0.50, 0);    // nada dasar
    this.oscSub = makeOsc('sawtooth', 0.34, -7);    // satu oktaf di bawah
    this.oscRasp = makeOsc('square', 0.12, 6);      // karakter kasar diesel

    // denyut pembakaran: gain engineBus dimodulasi pada frekuensi firing
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 30;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.26;
    lfo.connect(lfoGain);
    lfoGain.connect(engineBus.gain);
    lfo.start();
    this.lfo = lfo;

    // ---- CLATTER DIESEL ----
    const clatterSrc = ctx.createBufferSource();
    clatterSrc.buffer = buf;
    clatterSrc.loop = true;
    const clatterBP = ctx.createBiquadFilter();
    clatterBP.type = 'bandpass';
    clatterBP.frequency.value = 1500;
    clatterBP.Q.value = 0.9;
    const clatterGain = ctx.createGain();
    clatterGain.gain.value = 0.0001;
    clatterSrc.connect(clatterBP);
    clatterBP.connect(clatterGain);
    clatterGain.connect(master);
    clatterSrc.start();

    // ---- BAN / KERIKIL ----
    const tireSrc = ctx.createBufferSource();
    tireSrc.buffer = buf;
    tireSrc.loop = true;
    const tireBP = ctx.createBiquadFilter();
    tireBP.type = 'bandpass';
    tireBP.frequency.value = 850;
    tireBP.Q.value = 0.75;
    const tireGain = ctx.createGain();
    tireGain.gain.value = 0.0001;
    tireSrc.connect(tireBP);
    tireBP.connect(tireGain);
    tireGain.connect(master);
    tireSrc.start();

    // ---- ANGIN ----
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    const windHP = ctx.createBiquadFilter();
    windHP.type = 'highpass';
    windHP.frequency.value = 600;
    windHP.Q.value = 0.6;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.0001;
    windSrc.connect(windHP);
    windHP.connect(windGain);
    windGain.connect(master);
    windSrc.start();

    // ---- HUMM (getaran medan frekuensi rendah) ----
    const humSrc = ctx.createBufferSource();
    humSrc.buffer = buf;
    humSrc.loop = true;
    const humLP = ctx.createBiquadFilter();
    humLP.type = 'lowpass';
    humLP.frequency.value = 130;
    humLP.Q.value = 1.1;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.0001;
    humSrc.connect(humLP);
    humLP.connect(humGain);
    humGain.connect(master);
    humSrc.start();

    this.engineBus = engineBus;
    this.engineFilter = engineFilter;
    this.engineGain = engineGain;
    this.clatterGain = clatterGain;
    this.tireBP = tireBP;
    this.tireGain = tireGain;
    this.windHP = windHP;
    this.windGain = windGain;
    this.humLP = humLP;
    this.humGain = humGain;

    try { await ctx.resume(); } catch (e) { /* abaikan */ }

    this.ready = true;
    this._applyGain();
  }

  // -------------------------------------------------------------------------
  // Profil akustik: kabin vs luar kabin
  // -------------------------------------------------------------------------
  setMode(modeId) {
    this.mode = modeId || 'mobil';
  }

  setPaused(paused) {
    this.paused = !!paused;
    this._applyGain();
  }

  toggleMute() {
    this.muted = !this.muted;
    this._applyGain();
    return this.muted;
  }

  _applyGain() {
    if (!this.ctx || !this.master) return;
    const target = this.muted || this.paused ? 0.0001 : this.volume;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.12);
  }

  // -------------------------------------------------------------------------
  // Update per frame
  // -------------------------------------------------------------------------
  update(dt, v) {
    if (!this.ready || !this.ctx || !v) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const cabin = this.isCabin;
    const set = (param, value) => param.setTargetAtTime(value, now, 0.05);

    const speed = Math.abs(v.speed || 0);
    const kmh = speed * 3.6;
    const rpm = v.rpm || 820;
    const throttle = v.throttle || 0;
    const grounded = !!v.grounded;
    const rough = grounded ? (v.roughness || 0) : 0;

    const spdNorm = clamp(speed / 26, 0, 1);
    const rpmNorm = clamp((rpm - 800) / 4200, 0, 1);

    // frekuensi pembakaran mesin 4 silinder 4-tak
    const firing = clamp((rpm / 60) * 2, 16, 240);

    // ---- mesin ----
    set(this.oscMain.frequency, firing);
    set(this.oscSub.frequency, firing * 0.5);
    set(this.oscRasp.frequency, firing * 2.02);
    set(this.lfo.frequency, firing);

    // kabin: nada teredam (lebih banyak harmonisa rendah)
    // luar  : nada lebih terang, knalpot & mekanik terdengar
    const tone = cabin
      ? 300 + rpm * 0.15 + throttle * 240
      : 900 + rpm * 0.55 + throttle * 780;
    set(this.engineFilter.frequency, clamp(tone, 170, 5400));
    set(this.engineFilter.Q, cabin ? 2.1 : 1.15);

    const engineVol = (0.050 + rpmNorm * 0.070 + throttle * 0.048) * (cabin ? 1.18 : 0.92);
    set(this.engineGain.gain, engineVol);

    set(this.clatterGain.gain,
      (0.0035 + throttle * 0.020 + rpmNorm * 0.007) * (cabin ? 1.35 : 0.72));

    // ---- ban / kerikil ----
    const contact = grounded ? 1 : 0.06;
    const gravel = (spdNorm * 0.052 + rough * spdNorm * 0.095) * contact;
    set(this.tireGain.gain, gravel * (cabin ? 0.30 : 1.15));
    set(this.tireBP.frequency, 700 + spdNorm * 1400 + rough * 950);

    // ---- angin ----
    const wind = spdNorm * spdNorm * 0.075;
    set(this.windGain.gain, wind * (cabin ? 0.35 : 1.0));
    set(this.windHP.frequency, 500 + spdNorm * 1300);

    // ---- hum getaran medan ----
    const hum = (spdNorm * 0.018 + rough * 0.080) * (grounded ? 1 : 0.25);
    set(this.humGain.gain, hum * (cabin ? 1.55 : 0.80));
    set(this.humLP.frequency, 95 + rough * 70);

    // ---- benturan ----
    this._impactCool -= dt;
    const imp = v.impact || 0;
    if (imp > 0.12 && imp > this._lastImpact + 0.03 && this._impactCool <= 0) {
      this.thump(imp, cabin);
      this._impactCool = 0.28;
    }
    this._lastImpact = imp;

    // dipakai untuk debug/HUD suara (tidak wajib)
    this.level = { firing, kmh };
  }

  // -------------------------------------------------------------------------
  // Dentuman benturan / pendaratan
  // -------------------------------------------------------------------------
  thump(strength, cabin) {
    const ctx = this.ctx;
    if (!ctx || !this._noiseBuffer) return;

    const t = ctx.currentTime;
    const s = clamp(strength, 0, 1);
    const level = (0.06 + s * 0.28) * (cabin ? 1.15 : 0.9);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    g.connect(this.master);

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.36);
    o.connect(g);
    o.start(t);
    o.stop(t + 0.48);

    // krak kerikil / logam — di kabin lebih teredam
    const n = ctx.createBufferSource();
    n.buffer = this._noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = cabin ? 620 : 1100;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.20 * s + 0.02, t + 0.008);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(this.master);
    n.start(t);
    n.stop(t + 0.24);
  }
}
