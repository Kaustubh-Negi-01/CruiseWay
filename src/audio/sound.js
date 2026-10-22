import { ZenMusic } from './music.js';
import { WeatherSound } from './weather.js';

// Game audio, using the Web Audio API.
//
//   master ─┬─ effects bus ─ riding sound (the two recorded clips) + one-shots
//           │                + weather (rain, wind, thunder: see weather.js)
//           └─ music bus ─── zen soundtrack
//
// Riding sound is only real recordings in public/audio. The bike uses two:
// one for tarmac, one for grass and dirt. The hypercar uses the project
// owner's own engine clip (engine-car.mp3).
// Short loops are cut from each (idle, low revs, high revs) and blended by
// engine revs through a simulated gearbox, and for the bike by surface.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// Gearbox and rev range per vehicle: engine rpm per m/s of road speed in
// each gear, idle, shift points, and how far each loop may be sped up or
// slowed down (the car's loops are steady tones, so they stretch further).
const ENGINES = {
  bike: { gears: [0, 500, 335, 255, 200, 162, 136], idle: 1100, up: 6600, down: 2700, max: 8200, low: 3000, high: 6500, rateLow: [0.85, 1.2], rateHigh: [0.85, 1.15] },
  car: { gears: [0, 420, 290, 215, 170, 140, 118, 102], idle: 900, up: 6800, down: 3000, max: 7600, low: 2600, high: 6000, rateLow: [0.8, 1.35], rateHigh: [0.85, 1.25] },
};

// Loop sections, in seconds into each clip. Tune by ear if needed.
const SAMPLES = {
  road: { file: 'engine-road.mp3',    idle: [1.0, 2.0], low: [4.0, 6.0], high: [9.6, 11.4] },
  off:  { file: 'engine-offroad.mp3', idle: [1.0, 2.0], low: [4.0, 6.0], high: [9.6, 11.4] },
  // Your car clip (20 s): played as overlapping random slices (grains) of
  // its under-load stretches rather than loops, so nothing audibly repeats.
  // Each region is [from s, to s, engine note at start Hz, at end Hz]; every
  // slice is pitch-corrected to the band's reference note, so the game's
  // revs alone set the pitch.
  car:  { file: 'engine-car.mp3', grains: true, gain: 1.0,
          idle: { ref: 56, regions: [[13.2, 14.8, 66, 47]] },
          low:  { ref: 85, regions: [[0.7, 1.6, 77, 84], [3.25, 5.1, 82, 88], [7.0, 8.6, 79, 89], [9.25, 10.6, 84, 87]] },
          high: { ref: 85, regions: [[0.7, 1.6, 77, 84], [3.25, 5.1, 82, 88], [7.0, 8.6, 79, 89], [9.25, 10.6, 84, 87]] } },
};
const BANDS = ['idle', 'low', 'high'];

export const DEFAULT_SOUND = { master: 0.8, effects: 0.8, music: 0.45, effectsOn: true, musicOn: true };

export class SoundManager {
  constructor(settings = DEFAULT_SOUND) {
    this.settings = { ...DEFAULT_SOUND, ...settings };
    this.ctx = null;
    this.riding = false;
    this.vehicle = 'bike';
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
    this.weatherSound = new WeatherSound(ctx, this.fx);
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
        for (const band of BANDS) {
          this.samples[k][band] = SAMPLES[k].grains
            ? { buffer: decoded[i], ...SAMPLES[k][band] }
            : makeLoop(ctx, decoded[i], ...SAMPLES[k][band]);
        }
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
  // Rain and wind follow the weather; null fades them out (left the world).
  weather(w) {
    if (!this.weatherSound) return;
    this.weatherSound.update(w || {}, !w || !this.riding);
  }

  // Thunder from a strike `dist` metres away (arrives after the flash).
  thunder(dist) {
    if (!this.weatherSound || !this.riding) return;
    this.weatherSound.thunder(dist);
  }

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

  // ---- riding sound: the recordings ------------------------------------------

  // Bike or car: which recordings and gearbox to use.
  setVehicle(kind) {
    const v = kind === 'car' ? 'car' : 'bike';
    if (v === this.vehicle) return;
    this.vehicle = v;
    this.gear = 1;
  }

  startRide() {
    this.wantRide = true;
    if (!this.ctx || this.riding) return;
    this.riding = true;
    this.gear = 1;
    this.rpm = ENGINES[this.vehicle].idle;
    this.shiftUntil = 0;
    this.surfaceMix = 1;
    this.lastT = this.ctx.currentTime;
    this.startVoices();
  }

  // Looping voices: (road, off-road, car) × (idle, low, high). The ones not in
  // use sit at zero volume.
  startVoices() {
    if (!this.samples || this.voices) return;
    const ctx = this.ctx;
    this.rideGain = gain(ctx, 0, this.fx);
    this.voices = {};
    for (const surface of Object.keys(SAMPLES)) {
      for (const band of BANDS) {
        if (SAMPLES[surface].grains) {
          const s = this.samples[surface][band];
          this.voices[surface + band] = new GrainVoice(ctx, s.buffer, s.regions, s.ref, this.rideGain);
          continue;
        }
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
    const E = ENGINES[this.vehicle], G = E.gears;
    this.gear = Math.min(this.gear, G.length - 1);
    const shifting = t < this.shiftUntil;
    const throttle = shifting ? 0 : b.throttle;
    if (!shifting) {
      if (this.gear < G.length - 1 && sp * G[this.gear] > E.up && b.throttle > 0.1) {
        const at = sp * G[this.gear];       // revs at the shift point
        this.gear++;
        this.shiftUntil = t + (this.vehicle === 'car' ? 0.12 : 0.09);
        this.shiftFx(true, at, b.throttle);
      } else if (this.gear > 1 && sp * G[this.gear] < E.down) {
        this.gear--;
        this.blipUntil = t + 0.16;          // rev-matching blip on the way down
        this.shiftFx(false, sp * G[this.gear], b.throttle);
      }
    }
    let target = Math.max(E.idle, sp * G[this.gear]);
    if (t < (this.blipUntil || 0)) target += this.vehicle === 'car' ? 1100 : 800;
    if (sp < 4) target = Math.max(target, E.idle + throttle * 1800);
    if (!b.onGround) target += throttle * 900;
    this.rpm += (Math.min(E.max, target) - this.rpm) * (1 - Math.exp(-dt * (shifting ? 18 : 9)));
    const rpm = this.rpm;

    // which loops: idle when stopped and off the throttle, else low<->high by revs
    const idle = clamp01(1 - Math.max(sp / 4, throttle * 2));
    const x = clamp01((rpm - E.low) / (E.high - E.low));
    const wIdle = Math.sqrt(idle);
    const wLow = Math.sqrt(1 - idle) * Math.cos(x * Math.PI / 2);
    const wHigh = Math.sqrt(1 - idle) * Math.sin(x * Math.PI / 2);
    // only gentle speed changes, so the clips keep their own character
    const rateLow = Math.min(E.rateLow[1], Math.max(E.rateLow[0], rpm / E.low));
    const rateHigh = Math.min(E.rateHigh[1], Math.max(E.rateHigh[0], rpm / E.high));

    // bike: your road clip on tarmac, your off-road clip on grass and dirt.
    // car: your car clip everywhere.
    const onRoad = b.surface === 1 ? 1 : 0;
    this.surfaceMix += (onRoad - this.surfaceMix) * (1 - Math.exp(-dt * 3));
    const car = this.vehicle === 'car';
    const mixes = car
      ? [['road', 0], ['off', 0], ['car', SAMPLES.car.gain]]
      : [['road', Math.sqrt(this.surfaceMix)], ['off', Math.sqrt(1 - this.surfaceMix)], ['car', 0]];
    for (const [set, s] of mixes) {
      if (set === 'car') {
        // the clip's engine note sits near 85 Hz under load, about 3,400 rpm
        // here: play its slices at the note the revs ask for
        const load = Math.min(1.6, Math.max(0.75, rpm / 40 / 85));
        // (the clip's idle stretch is quiet coasting: lifted to sit like the bike's idle)
        this.setVoice('caridle', wIdle * s * 2, 0.92 + throttle * 0.15, t, T);
        this.setVoice('carlow', Math.sqrt(1 - idle) * s, load, t, T);
        this.setVoice('carhigh', 0, load, t, T);
        continue;
      }
      this.setVoice(set + 'idle', wIdle * s, 1, t, T);
      this.setVoice(set + 'low', wLow * s, rateLow, t, T);
      this.setVoice(set + 'high', wHigh * s, rateHigh, t, T);
    }
    // a little quieter when coasting than under throttle; on an upshift the
    // ignition cut makes the engine drop out for a moment
    if (shifting) this.rideGain.gain.setTargetAtTime(0.2, t, 0.012);
    else this.rideGain.gain.setTargetAtTime(0.5 + throttle * 0.35, t, T);
  }

  // A gear change you can hear: the gearbox clunks, and when you shift high
  // in the revs (or blip down off the throttle) the exhaust pops and crackles
  // as fuel is cut. Full-bodied on the car, quicker and lighter on the bike.
  shiftFx(up, rpm, throttle) {
    const ctx = this.ctx, t = ctx.currentTime, car = this.vehicle === 'car';
    const k = car ? 1 : 0.55;
    // clunk: a short low knock that falls in pitch...
    const g = gain(ctx, 0, this.fx);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34 * k, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    const o = osc(ctx, 'sine', up ? 105 : 85, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    o.stop(t + 0.15);
    // ...with the metallic tick of the selector
    this.burst(0.11 * k, 0.03, 'bandpass', 3400, 1.4);
    // pops: up near the top of the revs under throttle, or down off throttle
    const hot = up
      ? clamp01((rpm - 4300) / 2300) * (throttle > 0.5 ? 1 : 0.35)
      : clamp01((rpm - 2800) / 3000) * (throttle < 0.2 ? 0.8 : 0.25);
    const pops = Math.round(hot * (car ? 3 : 2) * (0.6 + Math.random() * 0.7));
    let at = t + 0.025;
    for (let i = 0; i < pops; i++) {
      this.pop(at, (0.22 + Math.random() * 0.18) * k * (0.6 + hot * 0.4));
      at += 0.04 + Math.random() * 0.08;
    }
  }

  // One exhaust pop: a sharp burst of mid noise over a short low thud.
  pop(at, level) {
    const ctx = this.ctx;
    const g = gain(ctx, 0, this.fx);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05 + Math.random() * 0.05);
    const f = filter(ctx, 'bandpass', 450 + Math.random() * 950, 1.1, g);
    const n = ctx.createBufferSource();
    n.buffer = this.white;
    n.connect(f);
    n.start(at, Math.random() * 2, 0.12);
    const body = gain(ctx, 0, this.fx);
    body.gain.setValueAtTime(0.0001, at);
    body.gain.exponentialRampToValueAtTime(level * 0.7, at + 0.004);
    body.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
    const o = osc(ctx, 'sine', 65 + Math.random() * 35, body, at);
    o.stop(at + 0.11);
  }

  setVoice(k, w, rate, t, T) {
    const v = this.voices[k];
    v.g.gain.setTargetAtTime(w, t, T);
    if (v.grains) { v.setRate(rate, t, T); if (w > 0.002 || v.active.length) v.pump(t); return; }
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
// An engine voice that never loops: it keeps playing short overlapping
// slices of a recording, each from a random point in its section, with
// equal-power crossfades. Engine sound has no melody, so the stitched result
// sounds continuous, with no repeating pattern. Each region carries its
// engine note at its start and end; every slice is corrected to the voice's
// reference note, so the stream holds one note and the game's revs set it.
const GRAIN = 0.32, HOP = GRAIN / 2;
const HALF_SINE = Float32Array.from({ length: 64 }, (_, i) => Math.sin((i / 63) * Math.PI));
class GrainVoice {
  constructor(ctx, buffer, regions, ref, out) {
    this.grains = true;
    this.ctx = ctx;
    this.buffer = buffer;
    this.regions = regions;          // [[from, to, startHz, endHz], ...]
    this.total = regions.reduce((a, r) => a + (r[1] - r[0]), 0);
    this.ref = ref;
    this.g = gain(ctx, 0, out);
    this.rate = 1;
    this.next = 0;
    this.active = [];
  }

  // pick a region, longer ones more often
  pick() {
    let x = Math.random() * this.total;
    for (const r of this.regions) { x -= r[1] - r[0]; if (x <= 0) return r; }
    return this.regions[this.regions.length - 1];
  }

  setRate(rate, t, T) {
    this.rate = rate;
    for (const gr of this.active) gr.src.playbackRate.setTargetAtTime(rate * gr.k, t, T);
  }

  // keep ~0.3 s of slices scheduled ahead
  pump(t) {
    const ctx = this.ctx;
    this.active = this.active.filter((gr) => gr.end > t);
    if (this.next < t) this.next = t + 0.01;
    while (this.next < t + 0.3) {
      const at = this.next;
      const [a, b, fa, fb] = this.pick();
      const span = GRAIN * this.rate * 1.6;                     // source time a slice may use
      const off = a + Math.random() * Math.max(0.001, b - a - span);
      const k = this.ref / (fa + (fb - fa) * ((off + span / 2 - a) / (b - a)));
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      src.playbackRate.value = this.rate * k;
      const env = ctx.createGain();
      env.gain.value = 0;
      env.gain.setValueCurveAtTime(HALF_SINE, at, GRAIN);
      src.connect(env).connect(this.g);
      src.start(at, off);
      src.stop(at + GRAIN + 0.01);
      this.active.push({ src, k, end: at + GRAIN });
      this.next = at + HOP;
    }
  }
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
