import { hashString, mulberry32 } from '../generation/noise.js';

// World time and weather, simulated in fixed ticks like Minecraft: 20 ticks a
// second, 24000 ticks to a full day (20 real minutes). Tick 0 of the day is
// sunrise, 6000 is noon, 12000 sunset, 18000 midnight.
//
// The clock runs off wall time, so it never stalls in a background tab. The
// host's clock is the reference: guests are told the host's tick and the
// world's weather key when they join, and get nudged every few seconds.
//
// Weather is a deterministic schedule of spells (sunny, foggy, rainy, snowy,
// thunderstorm) drawn from the world seed and a key the host rolls when the
// world is created, so every rider in a world sees the same sky. Each spell
// blends in from the last one over about a minute. Snow cover and wet ground
// build up and fade tick by tick, from that same schedule.

export const TPS = 20;
export const DAY_TICKS = 24000;
const START_TIME = 500;       // new worlds open just after sunrise
const TRANSITION = 1500;      // ticks (75 s) to blend from one spell to the next
const SECONDS = TPS, MINUTES = 60 * TPS;

// What each kind of weather does at full strength.
//   overcast: cloud deck (0 clear .. 1 heavy)   fog: haze density (0 = normal)
//   rain / snow: precipitation    storm: lightning + thunder    wind: gusts
export const WEATHER = {
  clear: { label: 'Sunny',        icon: '☀', overcast: 0,    fog: 0,      rain: 0,   snow: 0, storm: 0, wind: 0.15, weight: 34, len: [4, 8] },
  fog:   { label: 'Foggy',        icon: '🌫', overcast: 0.55, fog: 0.0125, rain: 0,   snow: 0, storm: 0, wind: 0.05, weight: 14, len: [3, 5] },
  rain:  { label: 'Rainy',        icon: '🌧', overcast: 0.8,  fog: 0.0026, rain: 0.75, snow: 0, storm: 0, wind: 0.4,  weight: 20, len: [3, 6] },
  snow:  { label: 'Snowy',        icon: '❄', overcast: 0.75, fog: 0.0036, rain: 0,   snow: 1, storm: 0, wind: 0.3,  weight: 14, len: [5, 8] },
  storm: { label: 'Thunderstorm', icon: '⛈', overcast: 1,    fog: 0.003,  rain: 1,   snow: 0, storm: 1, wind: 1,    weight: 18, len: [3, 5] },
};
const KINDS = Object.keys(WEATHER);
const TOTAL_WEIGHT = KINDS.reduce((a, k) => a + WEATHER[k].weight, 0);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export class Climate {
  // key: the world's weather key (rolled by the host); tick: current world tick
  constructor(seed, key, tick = 0) {
    this.key = hashString(String(seed) + ':' + key);
    this.key2 = key;
    this.base = tick;                 // world tick at t0
    this.t0 = performance.now();
    this.tick = Math.floor(tick);     // last simulated tick
    this.spells = [];
    this.idx = 0;
    this.cover = 0;                   // snow lying on the ground, 0..1
    this.wet = 0;                     // wet roads and grass, 0..1
    this.events = [];                 // lightning strikes since last read
    this.forced = null;               // local override: { kind, from } (testing / "clear skies")
    this.rand = mulberry32(this.key ^ 0x5eed);
    this.s = { overcast: 0, fog: 0, rain: 0, snow: 0, storm: 0, wind: 0 };
    this.replay(Math.floor(tick));
  }

  // ---- clock -------------------------------------------------------------------

  // exact (fractional) world tick right now
  now() { return this.base + ((performance.now() - this.t0) * TPS) / 1000; }

  // 0..1 through the day (0 sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight)
  dayFraction(t = this.now()) { return (((START_TIME + t) % DAY_TICKS) + DAY_TICKS) % DAY_TICKS / DAY_TICKS; }

  // "07:24" on a 24-hour clock
  clockText(t = this.now()) {
    const h = (this.dayFraction(t) * 24 + 6) % 24;
    return String(Math.floor(h)).padStart(2, '0') + ':' + String(Math.floor((h % 1) * 60)).padStart(2, '0');
  }

  // Guests: line up with the host's tick. Small drift is eased out; a big gap
  // (joining, or the tab slept) jumps and rebuilds snow/wet from the schedule.
  sync(hostTick) {
    const d = hostTick - this.now();
    if (Math.abs(d) > 40) {
      this.base += d;
      if (Math.abs(d) > TRANSITION) this.replay(Math.floor(this.now()));
    } else {
      this.base += d * 0.25;
    }
  }

  // ---- schedule ----------------------------------------------------------------

  spell(i) {
    while (this.spells.length <= i) {
      const n = this.spells.length;
      const r = mulberry32(this.key ^ Math.imul(n + 1, 2654435761));
      let kind = 'clear';
      if (n > 0) {
        const prev = this.spells[n - 1];
        kind = pick(r);
        if (kind === prev.kind && kind !== 'clear') kind = pick(r); // rarely the same twice
        const [a, b] = WEATHER[kind].len;
        this.spells.push({ start: prev.start + prev.len, len: Math.round((a + r() * (b - a)) * MINUTES), kind });
      } else {
        // every world opens with a sunny spell
        this.spells.push({ start: -MINUTES, len: Math.round((5 + r() * 3) * MINUTES), kind });
      }
    }
    return this.spells[i];
  }

  indexAt(t) {
    let i = this.idx;
    while (i > 0 && this.spell(i).start > t) i--;
    while (this.spell(i).start + this.spell(i).len <= t) i++;
    this.idx = i;
    return i;
  }

  // Weather amounts at tick t. Clouds and fog blend across the whole
  // transition; rain and snow ease out early and start late, so the sky
  // changes first.
  sample(t, out = this.s) {
    const i = this.indexAt(t);
    const cur = this.spell(i);
    let from = i > 0 ? this.spell(i - 1).kind : cur.kind, to = cur.kind;
    let b = (t - cur.start) / TRANSITION;
    if (this.forced) {
      // a local override blends in over the same time from whatever was showing
      from = this.forced.fromKind;
      to = this.forced.kind;
      b = (t - this.forced.at) / TRANSITION;
      if (b < 1) {
        mix(out, this.forced.from, WEATHER[to], b);
        return out;
      }
    }
    mix(out, WEATHER[from], WEATHER[to], b);
    // a little life inside a spell: showers come and go
    const g = 0.85 + 0.15 * Math.sin(t * 0.0021 + i * 1.7) * Math.sin(t * 0.0007 + i);
    out.rain *= g;
    out.snow *= 0.8 + 0.2 * g;
    return out;
  }

  // Show one kind of weather here only (testing, or the "clear skies"
  // setting). null goes back to the shared forecast.
  force(kind) {
    const t = this.now();
    if (!kind) { this.forced = null; return; }
    if (!WEATHER[kind]) throw new Error('weather kinds: ' + KINDS.join(', '));
    const snap = { ...this.sample(t, {}) };
    this.forced = { kind, fromKind: kind, from: snap, at: t };
  }

  // What's showing now: the target spell, or the override.
  current() {
    if (this.forced) return this.forced.kind;
    return this.spell(this.indexAt(this.now())).kind;
  }

  // ---- ticks -------------------------------------------------------------------------

  // Runs every whole tick that has passed. Call once per frame.
  update() {
    const target = Math.floor(this.now());
    let n = target - this.tick;
    if (n <= 0) return 0;
    if (n > 3 * MINUTES) { this.replay(target); return n; } // the tab slept: just rebuild
    for (let t = this.tick + 1; t <= target; t++) this.step(t, target - t < 4);
    this.tick = target;
    return n;
  }

  // One tick: snow cover and wetness creep toward the weather, and in a
  // storm, lightning may strike.
  step(t, live) {
    const s = this.sample(t);
    if (s.snow > 0.3) this.cover += s.snow / (4 * MINUTES);            // ~4 min to cover the ground
    else this.cover -= s.rain > 0.2 ? 1 / (90 * SECONDS) : 1 / (4 * MINUTES); // rain melts it faster
    this.cover = clamp01(this.cover);
    if (s.rain > 0.15) this.wet += s.rain / (35 * SECONDS);
    else this.wet -= 1 / (150 * SECONDS);
    this.wet = clamp01(this.wet);
    // lightning: on average every ~7 s at full storm (not replayed history)
    if (live && s.storm > 0.4 && this.rand() < s.storm / (7 * SECONDS)) {
      const r = this.rand();
      this.events.push({
        // mostly far away; now and then frighteningly close
        dist: r < 0.12 ? 120 + this.rand() * 250 : 400 + this.rand() * 2200,
        angle: this.rand() * Math.PI * 2,
        bolt: this.rand() < 0.75,        // the rest light up the clouds only
      });
    }
  }

  // Rebuild snow cover and wetness from the schedule (on join or after a long
  // sleep). Twenty minutes of history is plenty: everything melts or dries by then.
  replay(tick) {
    this.cover = 0;
    this.wet = 0;
    const from = Math.max(-MINUTES, tick - DAY_TICKS);
    for (let t = from; t <= tick; t++) this.step(t, false);
    this.tick = tick;
    this.events.length = 0;
  }

  // Everything the renderer and the sound need, for this frame.
  state(out = {}) {
    const t = this.now();
    this.sample(t);
    Object.assign(out, this.s);
    out.cover = this.cover;
    out.wet = this.wet * (1 - this.cover);
    out.day = this.dayFraction(t);
    out.kind = this.current();
    return out;
  }
}

function pick(r) {
  let x = r() * TOTAL_WEIGHT;
  for (const k of KINDS) { x -= WEATHER[k].weight; if (x < 0) return k; }
  return 'clear';
}

// Blend weather a -> b by b (0..1).
function mix(out, a, w, b) {
  const sky = smooth(0, 1, b);
  const leave = 1 - smooth(0, 0.6, b), arrive = smooth(0.35, 1, b);
  out.overcast = a.overcast + (w.overcast - a.overcast) * sky;
  out.fog = a.fog + (w.fog - a.fog) * sky;
  out.wind = a.wind + (w.wind - a.wind) * sky;
  out.rain = a.rain * leave + w.rain * arrive;
  out.snow = a.snow * leave + w.snow * arrive;
  out.storm = a.storm * leave + w.storm * arrive;
  return out;
}
