import { ZenMusic } from './music.js';

// Game audio, using the Web Audio API.
//
//   master ─┬─ effects bus ─ riding sound (the two recorded clips) + one-shots
//           └─ music bus ─── zen soundtrack
//
// Riding sound is only the two recordings in public/audio: one for tarmac,
// one for grass and dirt. Short loops are cut from each (idle, low revs, high
// revs) and blended by engine revs and by the surface under the bike.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Six-speed gearbox: engine rpm per m/s of road speed in each gear.
const GEARS = [0, 500, 335, 255, 200, 162, 136];
const IDLE = 1100, UPSHIFT = 6600, DOWNSHIFT = 2700;

// Loop sections, in seconds into each clip. Tune by ear if needed.
const SAMPLES = {
  road: { file: 'engine-road.mp3',    idle: [1.0, 2.0], low: [4.0, 6.0], high: [9.6, 11.4] },
  off:  { file: 'engine-offroad.mp3', idle: [1.0, 2.0], low: [4.0, 6.0], high: [9.6, 11.4] },
};
const BANDS = ['idle', 'low', 'high'];
const LOW_RPM = 3000, HIGH_RPM = 6500;

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
    this.white = noiseBuffer(ctx);
    this.music = new ZenMusic(ctx, this.musicBus);
    this.loadSamples();
    this.apply();
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) this.ctx.suspend(); else this.ctx.resume();
    });
  }

  async loadSamples() {
    const ctx = this.ctx, base = import.meta.env.BASE_URL || '/';
    try {
      const keys = Object.keys(SAMPLES);
      const decoded = await Promise.all(keys.map(async (k) =>
        ctx.decodeAudioData(await (await fetch(base + 'audio/' + SAMPLES[k].file)).arrayBuffer())));
      this.samples = {};
      keys.forEach((k, i) => {
        this.samples[k] = {};
        for (const band of BANDS) this.samples[k][band] = makeLoop(ctx, decoded[i], ...SAMPLES[k][band]);
      });
      if (this.riding) this.startVoices();
    } catch (e) {
      console.warn('engine recordings could not be loaded', e);
    }
  }

  set(changes) {
    Object.assign(this.settings, changes);
    if (this.ctx) this.apply();
  }

  // While the radio plays, the zen music fades out (and comes back after).
  setDuck(on) {
    this.ducked = on;
    if (this.ctx) this.apply();
  }

  apply() {
    const s = this.settings, t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.fx.gain.setTargetAtTime(s.effectsOn ? s.effects : 0, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.musicOn && !this.ducked ? s.music : 0, t, this.ducked ? 0.6 : 1.5);
    if (s.musicOn) this.music.start(); else this.music.stop();
  }

  // ---- riding sound: the two recordings ------------------------------------------

  startRide() {
    this.wantRide = true;
    if (!this.ctx || this.riding) return;
    this.riding = true;
    this.gear = 1;
    this.rpm = IDLE;
    this.shiftUntil = 0;
    this.surfaceMix = 1;
    this.lastT = this.ctx.currentTime;
    this.startVoices();
  }

  // Six looping voices: road/off-road × idle/low/high.
  startVoices() {
    if (!this.samples || this.voices) return;
    const ctx = this.ctx;
    this.rideGain = gain(ctx, 0, this.fx);
    this.voices = {};
    for (const surface of Object.keys(SAMPLES)) {
      for (const band of BANDS) {
        const g = gain(ctx, 0, this.rideGain);
        const src = ctx.createBufferSource();
        src.buffer = this.samples[surface][band];
        src.loop = true;
        src.connect(g);
        src.start(ctx.currentTime, Math.random() * src.buffer.duration);
        this.voices[surface + band] = { src, g };
      }
    }
  }

  stopRide() {
    this.wantRide = false;
    if (!this.riding) return;
    this.riding = false;
    this.rideGain?.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
  }

  // b: { speed (m/s), throttle 0-1, surface 0/1/2, onGround, ... }
  update(b) {
    if (!this.riding || !this.ctx || !this.voices) return;
    const t = this.ctx.currentTime, T = 0.06;
    const dt = Math.min(0.1, Math.max(0.001, t - this.lastT));
    this.lastT = t;
    const sp = Math.max(0, b.speed);

    // gearbox: upshifts cut the throttle briefly and drop the revs
    const shifting = t < this.shiftUntil;
    const throttle = shifting ? 0 : b.throttle;
    if (!shifting) {
      if (this.gear < 6 && sp * GEARS[this.gear] > UPSHIFT && b.throttle > 0.1) { this.gear++; this.shiftUntil = t + 0.16; }
      else if (this.gear > 1 && sp * GEARS[this.gear] < DOWNSHIFT) this.gear--;
    }
    let target = Math.max(IDLE, sp * GEARS[this.gear]);
    if (sp < 4) target = Math.max(target, IDLE + throttle * 1800);
    if (!b.onGround) target += throttle * 900;
    this.rpm += (Math.min(8200, target) - this.rpm) * (1 - Math.exp(-dt * (shifting ? 18 : 9)));
    const rpm = this.rpm;

    // which loops: idle when stopped and off the throttle, else low<->high by revs
    const idle = clamp01(1 - Math.max(sp / 4, throttle * 2));
    const x = clamp01((rpm - LOW_RPM) / (HIGH_RPM - LOW_RPM));
    const wIdle = Math.sqrt(idle);
    const wLow = Math.sqrt(1 - idle) * Math.cos(x * Math.PI / 2);
    const wHigh = Math.sqrt(1 - idle) * Math.sin(x * Math.PI / 2);
    // only gentle speed changes, so the clips keep their own character
    const rateLow = Math.min(1.2, Math.max(0.85, rpm / LOW_RPM));
    const rateHigh = Math.min(1.15, Math.max(0.85, rpm / HIGH_RPM));

    // your road clip on tarmac, your off-road clip on grass and dirt
    const onRoad = b.surface === 1 ? 1 : 0;
    this.surfaceMix += (onRoad - this.surfaceMix) * (1 - Math.exp(-dt * 3));
    const road = Math.sqrt(this.surfaceMix), off = Math.sqrt(1 - this.surfaceMix);
    for (const [surface, s] of [['road', road], ['off', off]]) {
      this.setVoice(surface + 'idle', wIdle * s, 1, t, T);
      this.setVoice(surface + 'low', wLow * s, rateLow, t, T);
      this.setVoice(surface + 'high', wHigh * s, rateHigh, t, T);
    }
    // a little quieter when coasting than under throttle
    this.rideGain.gain.setTargetAtTime(0.5 + throttle * 0.35, t, T);
  }

  setVoice(k, w, rate, t, T) {
    const v = this.voices[k];
    v.g.gain.setTargetAtTime(w, t, T);
    v.src.playbackRate.setTargetAtTime(rate, t, T);
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
    if (!this.ctx) return null; // audio not unlocked yet
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
// Cut [a, b] seconds out of a clip as a seamless loop: the last 0.25 s is
// blended into the first 0.25 s so the seam can't be heard.
function makeLoop(ctx, buf, a, b) {
  const sr = buf.sampleRate, fade = Math.floor(sr * 0.25);
  const start = Math.floor(a * sr), len = Math.floor((b - a) * sr);
  const out = ctx.createBuffer(buf.numberOfChannels, len, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) dst[i] = src[start + i] || 0;
    for (let i = 0; i < fade; i++) {
      const w = i / fade; // equal-power crossfade of the tail into the head
      dst[i] = dst[i] * Math.sin(w * Math.PI / 2) + (src[start + len + i] || 0) * Math.cos(w * Math.PI / 2);
    }
  }
  return out;
}

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}
