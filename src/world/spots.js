import { mulberry32, hashString } from './noise.js';
import { KIND_DIRT, ROAD_STEP } from './network.js';

// Race meeting spots. Each one owns a fixed route along the road network,
// so its character (length, twistiness, climbing, dirt) — and therefore its
// difficulty — is the same for everyone in the world.

export const DIFFICULTY = [
  null,
  { label: 'Easy', color: '#5fd38a' },
  { label: 'Moderate', color: '#4cc3d9' },
  { label: 'Hard', color: '#f2c14e' },
  { label: 'Expert', color: '#f28a3c' },
  { label: 'Extreme', color: '#ef4f4f' },
];

const PLACES = ['Pine', 'Copper', 'Granite', 'Hollow', 'Ember', 'Misty', 'Falcon', 'Harbor', 'Sable', 'Summit', 'Willow', 'Thunder', 'Amber', 'Cobalt', 'Juniper', 'Raven'];

export class Route {
  constructor(net, steps) {
    // steps: [[edgeId, forward], ...] -> one continuous polyline
    const xs = [], ys = [], zs = [];
    steps.forEach(([id, fwd], k) => {
      const e = net.edges[id];
      for (let j = 0; j < e.n; j++) {
        const i = fwd ? j : e.n - 1 - j;
        if (k > 0 && j === 0) continue; // shared junction point
        xs.push(e.x[i]); ys.push(e.y[i]); zs.push(e.z[i]);
      }
    });
    this.x = Float32Array.from(xs); this.y = Float32Array.from(ys); this.z = Float32Array.from(zs);
    this.n = xs.length;
    this.s = new Float32Array(this.n);
    for (let i = 1; i < this.n; i++) this.s[i] = this.s[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]);
    this.length = this.s[this.n - 1];
  }

  at(s) {
    s = Math.max(0, Math.min(this.length - 0.01, s));
    let lo = 0, hi = this.n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.s[m] <= s) lo = m; else hi = m; }
    const t = (s - this.s[lo]) / Math.max(1e-6, this.s[hi] - this.s[lo]);
    const tx = this.x[hi] - this.x[lo], tz = this.z[hi] - this.z[lo];
    const l = Math.hypot(tx, tz) || 1;
    return {
      x: this.x[lo] + tx * t, y: this.y[lo] + (this.y[hi] - this.y[lo]) * t, z: this.z[lo] + tz * t,
      tx: tx / l, tz: tz / l,
    };
  }
}

export function buildSpots(net, seed, count = 9) {
  const rand = mulberry32(hashString(seed + ':spots'));
  const nodes = net.nodes.filter((n) => !n.trail && n.edges.length >= 2);
  if (!nodes.length) return [];
  // spread spots out: farthest-point sampling starting near the island centre
  const chosen = [nodes.reduce((a, b) => (a.x ** 2 + a.z ** 2 < b.x ** 2 + b.z ** 2 ? a : b))];
  while (chosen.length < Math.min(count, nodes.length)) {
    let best = null, bestD = -1;
    for (const n of nodes) {
      const d = Math.min(...chosen.map((c) => (c.x - n.x) ** 2 + (c.z - n.z) ** 2));
      if (d > bestD) { bestD = d; best = n; }
    }
    chosen.push(best);
  }
  const spots = chosen.map((node, idx) => {
    const target = 2600 + rand() * 6400;
    const steps = walk(net, node.id, target, rand);
    const route = new Route(net, steps);
    // start a few metres down the first road so the grid sits on the road, not the junction
    return { id: idx, node: node.id, steps, route, ...describe(net, steps, route), startS: 14 };
  });
  rate(spots);
  const usedNames = new Set();
  for (const s of spots) s.name = nameFor(s, rand, usedNames);
  return spots;
}

// Difficulty is relative to the other spots on this island, so every world
// has a spread from Easy to Extreme. Each trait is normalised across spots.
function rate(spots) {
  const traits = ['curvy', 'hilly', 'km', 'dirtFrac'];
  const weights = { curvy: 0.36, hilly: 0.22, km: 0.24, dirtFrac: 0.18 };
  for (const s of spots) s.km = s.length / 1000;
  const lo = {}, hi = {};
  for (const t of traits) { lo[t] = Math.min(...spots.map((s) => s[t])); hi[t] = Math.max(...spots.map((s) => s[t])); }
  for (const s of spots) {
    s.norm = {};
    for (const t of traits) s.norm[t] = hi[t] > lo[t] ? (s[t] - lo[t]) / (hi[t] - lo[t]) : 0.5;
    s.score = traits.reduce((a, t) => a + s.norm[t] * weights[t], 0);
  }
  const ranked = spots.slice().sort((a, b) => a.score - b.score);
  ranked.forEach((s, i) => { s.difficulty = 1 + Math.min(4, Math.floor((i / ranked.length) * 5)); });
}

// Random walk without revisiting nodes; backs off and retries if it dead-ends early.
function walk(net, start, target, rand) {
  let best = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const visited = new Set([start]);
    const steps = [];
    let at = start, len = 0;
    while (len < target) {
      const opts = net.nodes[at].edges
        .map((id) => net.edges[id])
        .filter((e) => !visited.has(e.a === at ? e.b : e.a));
      if (!opts.length) break;
      const e = opts[Math.floor(rand() * opts.length)];
      const next = e.a === at ? e.b : e.a;
      steps.push([e.id, e.a === at]);
      visited.add(next);
      len += e.length;
      at = next;
      if (net.nodes[at].trail) break;
    }
    if (!best || Math.abs(len - target) < Math.abs(best.len - target)) best = { steps, len };
    if (len >= target * 0.8) break;
  }
  return best.steps;
}

function describe(net, steps, route) {
  let turn = 0, climb = 0, dirt = 0;
  const stride = 5; // every ~15 m
  for (let i = stride; i < route.n - stride; i += stride) {
    const a1 = Math.atan2(route.x[i] - route.x[i - stride], route.z[i] - route.z[i - stride]);
    const a2 = Math.atan2(route.x[i + stride] - route.x[i], route.z[i + stride] - route.z[i]);
    turn += Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)));
    climb += Math.max(0, route.y[i] - route.y[i - stride]);
  }
  for (const [id] of steps) if (net.edges[id].kind === KIND_DIRT) dirt += net.edges[id].length;
  const km = route.length / 1000;
  const curvy = turn / km;              // radians of steering per km
  const hilly = climb / km;             // metres climbed per km
  const dirtFrac = dirt / route.length;
  const checkpoints = [];
  const spacing = Math.max(500, Math.min(900, route.length / 6));
  for (let s = spacing; s < route.length - spacing * 0.5; s += spacing) checkpoints.push(s);
  return { length: route.length, curvy, hilly, dirtFrac, climb, checkpoints };
}

// Named after whatever stands out most about the route.
function nameFor(st, rand, used) {
  const n = st.norm;
  const top = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  const pick = (a) => a[Math.floor(rand() * a.length)];
  let kind;
  if (top[1] < 0.45) kind = pick(['Sprint', 'Dash', 'Run']);
  else if (top[0] === 'dirtFrac') kind = pick(['Rally', 'Scramble', 'Dirt Trail']);
  else if (top[0] === 'curvy') kind = pick(['Switchbacks', 'Twister', 'Esses']);
  else if (top[0] === 'hilly') kind = pick(['Hillclimb', 'Ridge Run', 'Summit Climb']);
  else kind = pick(['Grand Tour', 'Long Run', 'Cross-Island']);
  for (let i = 0; i < 40; i++) {
    const n = `${PLACES[Math.floor(rand() * PLACES.length)]} ${kind}`;
    if (!used.has(n)) { used.add(n); return n; }
  }
  return `${PLACES[0]} ${kind} ${used.size}`;
}

export { ROAD_STEP };
