// Weather sounds, generated in code: rain on the ground, storm wind, and
// thunder. Everything plays on the effects bus.
//
// Thunder is built like the real thing sounds from a distance: a sharp crack
// (close strikes only), then a long rumble of low noise that swells a few
// times as the sound arrives from different parts of the bolt, a deep sub
// boom under it, all sent through a big reverb. It arrives after the flash,
// one second per 343 m.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class WeatherSound {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    const rate = ctx.sampleRate;
    this.white = noise(ctx, 4, 'white');
    this.brown = noise(ctx, 10, 'brown');

    // a hall-sized reverb for thunder: 3.5 s of decaying noise
    this.verb = ctx.createConvolver();
    this.verb.buffer = impulse(ctx, 3.5, 2.2);
    this.verbOut = gainNode(ctx, 0.8, out);
    this.verb.connect(this.verbOut);

    // rain: bright hiss + a lower wash that grows with heavy rain
    this.rainGain = gainNode(ctx, 0, out);
    loop(ctx, this.white, [hp(ctx, 500), lp(ctx, 7500)], this.rainGain);
    this.heavyGain = gainNode(ctx, 0, out);
    loop(ctx, this.brown, [lp(ctx, 900)], this.heavyGain);

    // wind: low noise through a band that wanders
    this.windGain = gainNode(ctx, 0, out);
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass'; band.frequency.value = 420; band.Q.value = 0.8;
    loop(ctx, this.brown, [band], this.windGain, 3.3);
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 0.11; depth.gain.value = 220;
    lfo.connect(depth).connect(band.frequency);
    lfo.start();
    this.rate = rate;
  }

  // levels follow the weather; quiet=true (menus, not riding) fades it all out
  update({ rain = 0, storm = 0, wind = 0, snow = 0 }, quiet = false) {
    const t = this.ctx.currentTime, k = quiet ? 0 : 1;
    this.rainGain.gain.setTargetAtTime(k * rain * 0.32, t, 0.6);
    this.heavyGain.gain.setTargetAtTime(k * (rain * 0.12 + storm * 0.22), t, 0.8);
    this.windGain.gain.setTargetAtTime(k * (wind * 0.16 + snow * 0.05 + storm * 0.12), t, 1.2);
  }

  thunder(dist) {
    const ctx = this.ctx;
    const t0 = ctx.currentTime + dist / 343;
    const near = clamp01(1 - (dist - 150) / 1400);            // 1 overhead .. 0 far off
    const level = 0.35 + near * 0.75;
    const dur = 5 + (1 - near) * 4 + Math.random() * 2;       // far thunder rolls longer
    const pan = ctx.createStereoPanner();
    pan.pan.value = (Math.random() - 0.5) * 1.2;
    const dry = gainNode(ctx, 1, pan);
    pan.connect(this.out);
    const wet = gainNode(ctx, 0.55 + (1 - near) * 0.35, this.verb);
    dry.connect(wet);

    // 1) the crack: a ripping burst of bright noise sweeping down (close only)
    if (near > 0.4) {
      for (const [dt, amt] of [[0, 1], [0.07 + Math.random() * 0.05, 0.6]]) {
        const s = src(ctx, this.white, Math.random() * 3);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass'; f.Q.value = 0.6;
        f.frequency.setValueAtTime(5000, t0 + dt);
        f.frequency.exponentialRampToValueAtTime(350, t0 + dt + 0.45);
        const g = gainNode(ctx, 0, dry);
        g.gain.setValueAtTime(0, t0 + dt);
        g.gain.linearRampToValueAtTime(level * 1.1 * amt * near, t0 + dt + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
        s.connect(f).connect(g);
        s.start(t0 + dt, Math.random() * 3, 0.6);
      }
    }

    // 2) the rumble: low noise with several swells, rolling away
    const curve = new Float32Array(256);
    const attack = 0.03 + (1 - near) * 0.5;
    const swells = [];
    for (let i = 0, n = 3 + Math.floor(Math.random() * 3); i < n; i++) {
      swells.push([Math.random() * dur * 0.6, 0.25 + Math.random() * 0.5, 0.4 + Math.random() * 0.8]);
    }
    for (let i = 0; i < curve.length; i++) {
      const t = (i / (curve.length - 1)) * dur;
      const env = Math.min(1, t / attack) * Math.exp(-t / (dur * 0.32));
      let s = 0.55;
      for (const [c, w, a] of swells) s += a * Math.exp(-((t - c) * (t - c)) / (w * w));
      curve[i] = env * Math.min(1.6, s) * level * 0.75;
    }
    curve[curve.length - 1] = 0;
    const rumble = src(ctx, this.brown, Math.random() * 6);
    const rlp = lp(ctx, 140 + near * 520);
    const rg = gainNode(ctx, 0, dry);
    rumble.connect(rlp).connect(rg);
    rg.gain.setValueCurveAtTime(curve, t0, dur);
    rumble.start(t0, Math.random() * 3, dur + 0.1);

    // 3) the boom you feel more than hear
    const sub = src(ctx, this.brown, Math.random() * 6);
    const slp = lp(ctx, 70);
    const sg = gainNode(ctx, 0, dry);
    sub.connect(slp).connect(sg);
    sg.gain.setValueAtTime(0, t0);
    sg.gain.linearRampToValueAtTime(level * (0.9 + near * 0.6), t0 + attack + 0.05);
    sg.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.8);
    sub.start(t0, Math.random() * 3, dur);
  }
}

// ---- helpers ------------------------------------------------------------------------

function gainNode(ctx, v, to) { const g = ctx.createGain(); g.gain.value = v; if (to) g.connect(to); return g; }
function lp(ctx, f) { const b = ctx.createBiquadFilter(); b.type = 'lowpass'; b.frequency.value = f; return b; }
function hp(ctx, f) { const b = ctx.createBiquadFilter(); b.type = 'highpass'; b.frequency.value = f; return b; }
function src(ctx, buf) { const s = ctx.createBufferSource(); s.buffer = buf; return s; }

// a looping noise source through a chain of filters
function loop(ctx, buf, chain, to, rate = 1) {
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = true; s.playbackRate.value = rate;
  let node = s;
  for (const f of chain) { node.connect(f); node = f; }
  node.connect(to);
  s.start(0, Math.random() * buf.duration);
  return s;
}

// stereo noise; brown = integrated white noise (deep, rumbly)
function noise(ctx, seconds, kind) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let b = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; } else d[i] = w;
    }
    // fade the ends together so the loop doesn't click
    const f = Math.min(len >> 3, 4000);
    for (let i = 0; i < f; i++) { const k = i / f; d[i] = d[i] * k + d[len - f + i] * (1 - k); }
  }
  return buf;
}

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
