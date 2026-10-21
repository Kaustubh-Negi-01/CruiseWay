import { ZenMusic } from './music.js';

// All game audio, synthesised live with the Web Audio API (no sample files).
//
//   master ─┬─ effects bus ─ continuous riding layers + one-shot effects
//           └─ music bus ─── zen soundtrack
//
// Riding layers (petrol engine, tyre roar, gravel crunch, wind, skid) run
// continuously and are steered every frame from the bike's state.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Six-speed gearbox: engine rpm per m/s of road speed in each gear.
const GEARS = [0, 500, 335, 255, 200, 162, 136];
const IDLE = 1100, UPSHIFT = 6600, DOWNSHIFT = 2700;

export const DEFAULT_SOUND = { master: 0.8, effects: 0.8, music: 0.45, effectsOn: true, musicOn: true };

export class SoundManager {
  constructor(settings = DEFAULT_SOUND) {
    this.settings = { ...DEFAULT_SOUND, ...settings };
    this.ctx = null;
    this.riding = false;
  }

  // Browsers only allow audio after a click or key press.
  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (this.wantRide && !this.riding) this.startRide(); // ride began before audio was allowed
  }

  init() {
    const ctx = (this.ctx = new (window.AudioContext || window.webkitAudioContext)());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.fx = ctx.createGain();
    this.fx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.white = noiseBuffer(ctx, 'white');
    this.brown = noiseBuffer(ctx, 'brown');
    this.music = new ZenMusic(ctx, this.musicBus);
    this.apply();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  set(changes) {
    Object.assign(this.settings, changes);
    if (this.ctx) this.apply();
  }

  apply() {
    const s = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.fx.gain.setTargetAtTime(s.effectsOn ? s.effects : 0, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicOn ? s.music : 0, t, 0.3);
    if (s.musicOn) this.music.start(); else this.music.stop();
  }

  // ---- continuous riding layers -----------------------------------------------

  startRide() {
    this.wantRide = true;
    if (!this.ctx || this.riding) return;
    this.riding = true;
    const ctx = this.ctx;
    const L = (this.layers = {});

    // Petrol twin. A pulse-shaped wave at the firing frequency (rpm/60) gives
    // the beat of the cylinders; a sub-octave sine adds the lumpy thump; the
    // exhaust is low noise pulsed in time with the firing. A soft drive stage
    // and a warm low-pass keep it round rather than buzzy.
    L.engGain = gain(ctx, 0, this.fx);
    L.engFilter = filter(ctx, 'lowpass', 500, 1.1, L.engGain);
    L.engDrive = ctx.createWaveShaper();
    L.engDrive.curve = softClip(1.6);
    L.engDrive.connect(L.engFilter);
    L.engPre = gain(ctx, 0.6, L.engDrive);
    const wave = pulseWave(ctx);
    L.eng1 = osc(ctx, 'sine', 30, L.engPre); L.eng1.setPeriodicWave(wave);
    L.eng2 = osc(ctx, 'sine', 30, gain(ctx, 0.55, L.engPre)); L.eng2.setPeriodicWave(wave); // slightly uneven second cylinder
    L.subGain = gain(ctx, 0, L.engGain);
    L.sub = osc(ctx, 'sine', 15, L.subGain);
    L.exGain = gain(ctx, 0, L.engFilter);
    L.exAM = gain(ctx, 0.5, L.exGain);
    L.exFilter = filter(ctx, 'bandpass', 180, 1.5, L.exAM);
    noise(ctx, this.brown, L.exFilter);
    L.exPulse = osc(ctx, 'sine', 30, gain(ctx, 0.5, L.exAM.gain));
    this.gear = 1;
    this.rpm = IDLE;
    this.shiftUntil = 0;
    this.prevThrottle = 0;
    this.liftAt = -9;
    this.nextPop = 0;
    this.lastT = ctx.currentTime;

    // tyre roar on tarmac: band-passed noise, brighter with speed
    L.roadGain = gain(ctx, 0, this.fx);
    L.roadFilter = filter(ctx, 'bandpass', 400, 0.7, L.roadGain);
    noise(ctx, this.white, L.roadFilter);

    // gravel / grass crunch: noise through a high-pass, chopped by a random-ish LFO
    L.crunchGain = gain(ctx, 0, this.fx);
    L.crunchAM = gain(ctx, 0.5, L.crunchGain);
    L.crunchFilter = filter(ctx, 'highpass', 1400, 0.5, L.crunchAM);
    noise(ctx, this.white, L.crunchFilter);
    L.crunchLfoGain = gain(ctx, 0.5, L.crunchAM.gain);
    L.crunchLfo = osc(ctx, 'square', 13, L.crunchLfoGain);

    // wind: brown noise, opening up with speed
    L.windGain = gain(ctx, 0, this.fx);
    L.windFilter = filter(ctx, 'lowpass', 300, 0.5, L.windGain);
    noise(ctx, this.brown, L.windFilter);

    // skid / tyre scrub: narrow band of noise that screeches on tarmac
    L.skidGain = gain(ctx, 0, this.fx);
    L.skidFilter = filter(ctx, 'bandpass', 2400, 6, L.skidGain);
    noise(ctx, this.white, L.skidFilter);
  }

  stopRide() {
    this.wantRide = false;
    if (!this.riding) return;
    this.riding = false;
    const t = this.ctx.currentTime;
    for (const k of ['engGain', 'roadGain', 'crunchGain', 'windGain', 'skidGain']) this.layers[k].gain.setTargetAtTime(0, t, 0.1);
  }

  // b: { speed (m/s), throttle 0-1, braking 0-1, slip (m/s), surface 0/1/2, onGround, lean (rad) }
  update(b) {
    if (!this.riding || !this.ctx) return;
    const L = this.layers, t = this.ctx.currentTime, T = 0.06;
    const sp = Math.max(0, b.speed), v = clamp01(sp / 50);
    const ground = b.onGround ? 1 : 0;

    this.engine(b, sp, t);

    // tyres: tarmac hiss vs gravel crunch vs soft grass
    const lean = Math.min(1, Math.abs(b.lean) / 0.6);
    const tarmac = b.surface === 1 ? 1 : 0, dirt = b.surface === 2 ? 1 : 0, grass = b.surface === 0 ? 1 : 0;
    L.roadFilter.frequency.setTargetAtTime(250 + sp * 18 + lean * 220 - grass * 120, t, T);
    L.roadGain.gain.setTargetAtTime(ground * v * (tarmac * 0.22 + dirt * 0.12 + grass * 0.08) * (1 + lean * 0.4), t, T);
    L.crunchLfo.frequency.setTargetAtTime(6 + sp * 0.9, t, T);
    L.crunchFilter.frequency.setTargetAtTime(dirt ? 1200 : 2600, t, T);
    L.crunchGain.gain.setTargetAtTime(ground * clamp01(sp / 25) * (dirt * 0.2 + grass * 0.08), t, T);

    // wind rises steeply with speed, and gusts a little as you lean
    L.windFilter.frequency.setTargetAtTime(250 + v * v * 2200 + lean * 300, t, T);
    L.windGain.gain.setTargetAtTime(v * v * 0.32, t, T * 2);

    // skid: braking hard or sliding sideways
    const skid = ground * clamp01(Math.max(b.braking * clamp01(sp / 15), (b.slip - 1.2) / 5));
    L.skidFilter.frequency.setTargetAtTime(tarmac ? 2300 + sp * 10 : 900, t, T);
    L.skidFilter.Q.value = tarmac ? 7 : 1.2;
    L.skidGain.gain.setTargetAtTime(skid * (tarmac ? 0.16 : 0.12), t, 0.04);
  }

  // Gearbox + engine voice. Upshifts cut the throttle for a moment and the
  // revs drop into the next gear; lifting off at high revs gives a soft
  // burble of exhaust pops.
  engine(b, sp, t) {
    const L = this.layers, T = 0.05;
    const dt = Math.min(0.1, Math.max(0.001, t - this.lastT));
    this.lastT = t;
    const shifting = t < this.shiftUntil;
    const throttle = shifting ? 0 : b.throttle;

    // pick a gear for this road speed
    if (!shifting) {
      if (this.gear < 6 && sp * GEARS[this.gear] > UPSHIFT && b.throttle > 0.1) {
        this.gear++;
        this.shiftUntil = t + 0.16;
      } else if (this.gear > 1 && sp * GEARS[this.gear] < DOWNSHIFT) {
        this.gear--;
      }
    }
    // engine speed: geared to the wheels once rolling, free-revving with the
    // clutch slipping at a standstill or when the rear wheel is sliding
    let target = Math.max(IDLE, sp * GEARS[this.gear]);
    if (sp < 4) target = Math.max(target, IDLE + throttle * 1800);
    if (b.slip > 2) target += throttle * 500;
    if (!b.onGround) target += throttle * 900;
    this.rpm += (Math.min(8200, target) - this.rpm) * (1 - Math.exp(-dt * (shifting ? 18 : 9)));

    const fire = this.rpm / 60; // twin, one power stroke per revolution
    L.eng1.frequency.setTargetAtTime(fire, t, T);
    L.eng2.frequency.setTargetAtTime(fire * 1.006, t, T);
    L.sub.frequency.setTargetAtTime(fire / 2, t, T);
    L.exPulse.frequency.setTargetAtTime(fire, t, T);
    L.exFilter.frequency.setTargetAtTime(fire * 3.2, t, T);
    const r = clamp01((this.rpm - IDLE) / 6000);
    L.engFilter.frequency.setTargetAtTime(260 + r * 900 + throttle * 1100, t, T);
    L.engGain.gain.setTargetAtTime(0.06 + throttle * 0.08 + r * 0.03, t, T);
    L.subGain.gain.setTargetAtTime(0.22 + throttle * 0.15, t, T);
    L.exGain.gain.setTargetAtTime(0.25 + throttle * 0.55, t, T);

    // lifting off from high revs: a few soft pops for the next second or so
    if (this.prevThrottle > 0.5 && b.throttle < 0.1 && this.rpm > 3800) this.liftAt = t;
    this.prevThrottle = b.throttle;
    if (t - this.liftAt < 1.1 && t > this.nextPop && sp > 8) {
      this.nextPop = t + 0.09 + Math.random() * 0.22;
      if (Math.random() < 0.6) this.burst(0.03 + Math.random() * 0.05, 0.06, 'lowpass', 700 + Math.random() * 600);
    }
  }

  // ---- one-shot effects ------------------------------------------------------------

  // knocks / thumps: a falling sine plus a short noise burst
  thump(strength, pitch = 90) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, k = clamp01(strength / 12);
    const g = gain(ctx, 0, this.fx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 + k * 0.5, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    const o = osc(ctx, 'sine', pitch * 1.6, g);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + 0.3);
    o.stop(t + 0.4);
    this.burst(0.15 + k * 0.25, 0.12, 'lowpass', 900);
  }

  burst(level, dur, type, freq, q = 0.7) {
    const ctx = this.ctx, t = ctx.currentTime;
    const g = gain(ctx, 0, this.fx);
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const f = filter(ctx, type, freq, q, g);
    const n = noise(ctx, this.white, f);
    n.stop(t + dur + 0.05);
    return f;
  }

  land(impact) { this.thump(impact, 70); }
  treeHit(strength) { this.thump(strength, 120); this.burst(0.1, 0.25, 'bandpass', 2500, 2); }

  // hitting a barrier: an electric crackle over a dull thud
  wallHit(strength) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, k = clamp01(strength / 10);
    this.thump(strength * 0.6, 80);
    const g = gain(ctx, 0, this.fx);
    g.gain.setValueAtTime(0.12 + k * 0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    const f = filter(ctx, 'bandpass', 3200, 3, g);
    const am = gain(ctx, 0, f);
    noise(ctx, this.white, am).stop(t + 0.45);
    const zap = osc(ctx, 'square', 60, am.gain); // chops the noise into a buzz
    zap.stop(t + 0.45);
  }

  splash() {
    if (!this.ctx) return;
    const f = this.burst(0.5, 0.9, 'lowpass', 1800);
    f.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.8);
  }

  // short bell-like notes for race moments
  chime(freqs, spacing = 0.09, level = 0.18, decay = 0.9) {
    if (!this.ctx) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    freqs.forEach((fq, i) => {
      const t = t0 + i * spacing;
      const g = gain(ctx, 0, this.fx);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(level, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      const o = osc(ctx, 'sine', fq, g, t);
      const o2 = osc(ctx, 'sine', fq * 2.01, gain(ctx, 0.25, g), t);
      o.stop(t + decay + 0.05); o2.stop(t + decay + 0.05);
    });
  }

  countdown(n) { this.chime([n === 'GO' ? 1046.5 : 523.25], 0, 0.22, n === 'GO' ? 0.9 : 0.35); }
  checkpoint() { this.chime([784, 1175]); }
  finish(won) { this.chime(won ? [523.25, 659.25, 784, 1046.5] : [523.25, 659.25, 784], 0.12, 0.2, 1.4); }
  prompt() { this.chime([659.25, 987.77], 0.1, 0.1, 0.6); }
  click() { this.chime([1318.5], 0, 0.05, 0.12); }
}

// ---- tiny Web Audio helpers -----------------------------------------------------------

function gain(ctx, v, to) { const g = ctx.createGain(); g.gain.value = v; g.connect(to); return g; }
function osc(ctx, type, freq, to, at) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; o.connect(to); o.start(at ?? ctx.currentTime); return o;
}
function filter(ctx, type, freq, q, to) {
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; f.connect(to); return f;
}
function noise(ctx, buffer, to) {
  const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.connect(to);
  s.start(ctx.currentTime, Math.random() * buffer.duration); return s;
}
// Harmonic recipe for a pulse-like engine wave: a strong fundamental with
// slowly falling harmonics, even ones a bit weaker for a hollow, throaty tone.
function pulseWave(ctx) {
  const N = 28, real = new Float32Array(N), imag = new Float32Array(N);
  for (let n = 1; n < N; n++) imag[n] = (1 / Math.pow(n, 0.85)) * (n % 2 ? 1 : 0.65);
  return ctx.createPeriodicWave(real, imag);
}

function softClip(k) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
  return c;
}

function noiseBuffer(ctx, kind) {
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
  }
  return buf;
}
