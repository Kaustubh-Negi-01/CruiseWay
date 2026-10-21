// "Zen" soundtrack, generated live: slow pad chords, a soft low drone and
// sparse bell notes from a pentatonic scale, all through a long reverb.
// Nothing is pre-recorded and the bell melody is random, so it never loops.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// D major-ish progression, voiced wide and soft (MIDI note numbers)
const CHORDS = [
  [50, 57, 62, 66, 69, 73],   // Dmaj9-ish
  [47, 54, 59, 62, 66, 69],   // Bm7 add11
  [43, 50, 55, 59, 62, 66],   // Gmaj7
  [45, 52, 57, 61, 64, 71],   // A add9
];
const BELLS = [74, 76, 78, 81, 83, 86, 88, 90]; // D major pentatonic, upper octaves
const CHORD_SECONDS = 9;

export class ZenMusic {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.out = out;
    this.running = false;
    this.chord = 0;
    // shared reverb: a generated decaying-noise impulse
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = impulse(ctx, 4.5);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.55;
    this.reverb.connect(this.wet).connect(out);
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.5;
    this.dry.connect(out);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 900;
    this.padFilter.connect(this.dry);
    this.padFilter.connect(this.reverb);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.nextChord = this.ctx.currentTime + 0.1;
    this.nextBell = this.ctx.currentTime + 2;
    this.timer = setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  // Look a little ahead and book whatever falls inside the window.
  schedule() {
    if (!this.running || this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + 1.2;
    while (this.nextChord < horizon) {
      this.pad(CHORDS[this.chord % CHORDS.length], this.nextChord);
      this.chord++;
      this.nextChord += CHORD_SECONDS;
    }
    while (this.nextBell < horizon) {
      if (Math.random() < 0.8) this.bell(BELLS[Math.floor(Math.random() * BELLS.length)], this.nextBell);
      this.nextBell += 1.4 + Math.random() * 3.2;
    }
  }

  pad(notes, t) {
    const ctx = this.ctx, len = CHORD_SECONDS + 4;
    notes.forEach((n, i) => {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(i === 0 ? 0.05 : 0.026, t + 3.5);       // slow swell
      g.gain.setValueAtTime(i === 0 ? 0.05 : 0.026, t + CHORD_SECONDS - 1);
      g.gain.linearRampToValueAtTime(0, t + len);                              // long release
      g.connect(this.padFilter);
      for (const detune of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = i === 0 ? 'sine' : 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = detune;
        o.connect(g);
        o.start(t);
        o.stop(t + len + 0.1);
      }
    });
  }

  bell(n, t) {
    const ctx = this.ctx, f = midi(n);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 4);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = Math.random() * 1.2 - 0.6; g.connect(pan); pan.connect(this.reverb); pan.connect(this.dry); }
    else { g.connect(this.reverb); g.connect(this.dry); }
    // soft FM gives it a glassy, bell-like edge
    const carrier = ctx.createOscillator();
    carrier.frequency.value = f;
    const mod = ctx.createOscillator();
    mod.frequency.value = f * 2.0;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 0.6, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 2.5);
    mod.connect(modGain).connect(carrier.frequency);
    carrier.connect(g);
    carrier.start(t); mod.start(t);
    carrier.stop(t + 4.2); mod.stop(t + 4.2);
  }
}

function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
}
