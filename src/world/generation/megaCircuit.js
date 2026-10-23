import { mulberry32, hashString } from './noise.js';
import { Route } from './spots.js';

// The island's mega-event: one circuit over every paved road and dirt trail.
//
// Riding every road exactly once and getting back to the start is only
// possible if an even number of roads meets at every crossing; on the island
// a few dozen crossings (dead ends among them) have an odd number. So those
// crossings are paired up, nearest first (then improved by swapping pairs),
// and each pair is joined by a sky jump: a giant launch ramp at one end throws
// you through the sky to the other, over lakes, forests and roads you've
// already done. With the jumps every crossing is even, and the circuit is a
// single loop (Hierholzer's walk, taking the straightest way on at each
// crossing) that rides every road once and ends back at the flag.
//
// Each flight is a fixed arc (worked out here from where it starts and where
// it lands), so it always lands on the road; you only control the stunts.
// Everything is plain data from the seed, the same on every device.

export const MEGA = {
  rampLen: 70,        // m, foot to lip
  rampAngle: 0.62,    // radians at the lip (~35°)
  rampHalf: 9,        // half width
  launchAngle: 0.66,  // radians of the flight at launch (~38°), more for short hops
  gravity: 16,        // the game's gravity (physics.js)
  runUp: 90,          // a booster this far before each ramp
  padEvery: 1600,     // and one on the road roughly this often
  cpSpacing: 1100,    // checkpoints along the roads
};

const STEP = 3;   // route sample spacing (m)

// The flag: a well-connected crossing near the middle of the island that no
// other spot starts from.
export function megaStartNode(net, spots) {
  const taken = new Set(spots.map((s) => s.node));
  let best = null, bestScore = Infinity;
  for (const n of net.nodes) {
    if (n.trail || n.edges.length < 3 || taken.has(n.id)) continue;
    const score = Math.hypot(n.x, n.z) - n.edges.length * 150;
    if (score < bestScore) { bestScore = score; best = n; }
  }
  return best || net.nodes[0];
}

// The circuit: { route, ramps, pads, checkpoints, runUps, stats }.
// route is a Route (same queries as a race spot's) whose samples also carry
// `air` (1 on a flight: no walls there).
export function buildMegaCircuit(net, heightAt, startNode, seed) {
  const rand = mulberry32(hashString(String(seed) + ':mega'));
  const E = net.edges, nodes = net.nodes;
  // links at each crossing: roads, plus the jumps added below
  const links = nodes.map((n) => n.edges.map((id) => ({ road: id, to: E[id].a === n.id ? E[id].b : E[id].a })));
  const pairs = pairOddCrossings(nodes);
  pairs.forEach(([a, b], k) => { links[a].push({ jump: k, to: b }); links[b].push({ jump: k, to: a }); });
  const usedRoad = new Uint8Array(E.length), usedJump = new Uint8Array(pairs.length);
  const isUsed = (l) => (l.road != null ? usedRoad[l.road] : usedJump[l.jump]);
  const setUsed = (l) => { if (l.road != null) usedRoad[l.road] = 1; else usedJump[l.jump] = 1; };
  // direction you leave crossing `from` by along a link, and arrive at its far end
  const leaveDir = (l, from) => {
    if (l.jump != null) return norm(nodes[l.to].x - nodes[from].x, nodes[l.to].z - nodes[from].z);
    const e = E[l.road], fwd = e.a === from, n = e.n, i0 = fwd ? 0 : n - 1, i1 = fwd ? Math.min(n - 1, 3) : Math.max(0, n - 4);
    return norm(e.x[i1] - e.x[i0], e.z[i1] - e.z[i0]);
  };
  const arriveDir = (l, from) => {
    if (l.jump != null) return leaveDir(l, from);
    const e = E[l.road], fwd = e.a === from, n = e.n, i1 = fwd ? n - 1 : 0, i0 = fwd ? Math.max(0, n - 4) : Math.min(n - 1, 3);
    return norm(e.x[i1] - e.x[i0], e.z[i1] - e.z[i0]);
  };

  // Hierholzer's walk, straightest way on first (and no jump straight after a jump)
  const stack = [{ node: startNode, via: null, from: null, dir: null }], circuit = [];
  while (stack.length) {
    const top = stack[stack.length - 1];
    const open = links[top.node].filter((l) => !isUsed(l));
    if (!open.length) { circuit.push(stack.pop()); continue; }
    let pick = open[0], bestScore = -Infinity;
    for (const l of open) {
      const d = leaveDir(l, top.node);
      const straight = top.dir ? d[0] * top.dir[0] + d[1] * top.dir[1] : 0;
      const score = straight + rand() * 0.3 - (l.jump != null ? 0.6 : 0) - (l.jump != null && top.via?.jump != null ? 5 : 0);
      if (score > bestScore) { bestScore = score; pick = l; }
    }
    setUsed(pick);
    stack.push({ node: pick.to, via: pick, from: top.node, dir: arriveDir(pick, top.node) });
  }
  circuit.reverse();   // start ... start

  // into legs: runs of roads, and jumps
  const legs = [];
  let road = [];
  for (let i = 1; i < circuit.length; i++) {
    const c = circuit[i], l = c.via;
    if (l.road != null) { road.push([l.road, E[l.road].a === c.from]); continue; }
    if (road.length) legs.push({ kind: 'road', steps: road });
    road = [];
    legs.push({ kind: 'jump', from: c.from, to: c.node });
  }
  if (road.length) legs.push({ kind: 'road', steps: road });
  return assemble(net, heightAt, legs, startNode);
}

// Pair up the crossings where an odd number of roads meet so the sky jumps
// between them are short: nearest pairs first, then swap partners while
// that makes the total shorter.
function pairOddCrossings(nodes) {
  const odd = nodes.filter((n) => n.edges.length % 2).map((n) => n.id);
  const d = (a, b) => Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
  const all = [];
  for (let i = 0; i < odd.length; i++) for (let j = i + 1; j < odd.length; j++) all.push([d(odd[i], odd[j]), odd[i], odd[j]]);
  all.sort((p, q) => p[0] - q[0]);
  const taken = new Set(), pairs = [];
  for (const [, a, b] of all) {
    if (taken.has(a) || taken.has(b)) continue;
    taken.add(a); taken.add(b); pairs.push([a, b]);
  }
  for (let pass = 0, better = true; pass < 30 && better; pass++) {
    better = false;
    for (let i = 0; i < pairs.length; i++) for (let j = i + 1; j < pairs.length; j++) {
      const [a, b] = pairs[i], [c, e] = pairs[j], now = d(a, b) + d(c, e);
      if (d(a, c) + d(b, e) < now - 1) { pairs[i] = [a, c]; pairs[j] = [b, e]; better = true; }
      else if (d(a, e) + d(b, c) < now - 1) { pairs[i] = [a, e]; pairs[j] = [b, c]; better = true; }
    }
  }
  return pairs;
}

// Turn the legs into one 3D line, with a ramp and a flight for each jump.
function assemble(net, heightAt, legs, startNode) {
  const pts = [];   // [x, y, z, half, air]
  const ramps = [], pads = [], runUps = [];
  const nodeY = (id) => {
    const n = net.nodes[id];
    for (const eid of n.edges) { const e = net.edges[eid]; return e.a === id ? e.y[0] : e.y[e.n - 1]; }
    return heightAt(n.x, n.z);
  };
  const roadLen = (steps) => steps.reduce((a, [id]) => a + net.edges[id].length, 0);
  let sinceDown = 0;   // metres since the last booster pad
  for (const leg of legs) {
    if (leg.kind === 'road') {
      for (const [id, fwd] of leg.steps) {
        const e = net.edges[id];
        for (let j = 0; j < e.n; j++) {
          const i = fwd ? j : e.n - 1 - j;
          pts.push([e.x[i], e.y[i], e.z[i], e.half, 0]);
        }
      }
      leg.length = roadLen(leg.steps);
      continue;
    }
    // A jump: the ramp stands at the crossing, straight on from the way you
    // arrive (no turning round at speed), and the flight sweeps round in the
    // sky to the crossing it lands on.
    const A = net.nodes[leg.from], B = net.nodes[leg.to];
    const ay = nodeY(leg.from), by = nodeY(leg.to);
    const prev = pts.length > 3 ? pts[pts.length - 4] : null;
    const [dx, dz] = prev ? norm(A.x - prev[0], A.z - prev[2]) : norm(B.x - A.x, B.z - A.z);
    // y = foot + c·s + k·s² along the ramp: a curve up to the lip, plus a
    // steady climb c if the ground rises ahead, so the deck is never buried
    const L = MEGA.rampLen, k = Math.tan(MEGA.rampAngle) / (2 * L);
    const foot = { x: A.x + dx * 6, z: A.z + dz * 6, y: ay };
    let c = 0;
    for (let s = 6; s <= L; s += 4) {
      for (const l of [-MEGA.rampHalf, 0, MEGA.rampHalf]) {
        const gy = heightAt(foot.x + dx * s + dz * l, foot.z + dz * s - dx * l);
        c = Math.max(c, (gy + 1.2 - ay - k * s * s) / s);
      }
    }
    const lip = { x: foot.x + dx * L, z: foot.z + dz * L, y: foot.y + c * L + k * L * L };
    // from the crossing to the ramp foot, then up the ramp
    pts.push([A.x, ay, A.z, MEGA.rampHalf, 0]);
    for (let s = 0; s <= L; s += 3) pts.push([foot.x + dx * s, foot.y + c * s + k * s * s, foot.z + dz * s, MEGA.rampHalf, 0]);
    // the flight, landing on the far crossing
    const land = { x: B.x, z: B.z, y: by };
    const fl = solveFlight(lip, [dx, dz], land, heightAt);
    const ramp = { id: ramps.length, foot, lip, dir: [dx, dz], len: L, c, k, half: MEGA.rampHalf, flight: fl, s: 0 };
    const at = { x: 0, y: 0, z: 0 };
    for (let t = 0.25; t < fl.T; t += 0.25) {
      fl.at(t, at);
      pts.push([at.x, at.y, at.z, MEGA.rampHalf, 1]);
    }
    pts.push([land.x, land.y, land.z, MEGA.rampHalf, 1]);
    ramps.push(ramp);
  }
  const route = resample(pts);
  // where each ramp's foot and lip landed on the line, and the boosters
  let ri = 0;
  for (let i = 0; i < route.n && ri < ramps.length; i++) {
    const r = ramps[ri];
    if (Math.hypot(route.x[i] - r.foot.x, route.z[i] - r.foot.z) < 2.5 && Math.abs(route.y[i] - r.foot.y) < 3) {
      r.s = route.s[i];
      runUps.push(Math.max(0, r.s - MEGA.runUp));
      pads.push(padAt(route, r.s - 30, true));
      ri++;
    }
  }
  // boosters along the roads, now and then, on the ground away from ramps
  for (let s = 400; s < route.length - 200; s += MEGA.padEvery) {
    const i = route.indexAt(s);
    if (route.air[i] || ramps.some((r) => Math.abs(r.s - s) < 250)) continue;
    pads.push(padAt(route, s, false));
  }
  // checkpoints: before every ramp (that's where R puts you, moving), and
  // along the roads in between; never in the air
  const cps = [];
  for (const s of runUps) cps.push(s);
  let last = 0;
  for (let s = MEGA.cpSpacing; s < route.length - 300; s += 20) {
    if (s - last < MEGA.cpSpacing) continue;
    const i = route.indexAt(s);
    if (route.air[i] || cps.some((c) => Math.abs(c - s) < 400)) continue;
    cps.push(s); last = s;
  }
  cps.sort((a, b) => a - b);
  const road = legs.filter((l) => l.kind === 'road').reduce((a, l) => a + l.length, 0);
  return {
    route, ramps, pads, checkpoints: cps, runUps,
    stats: { km: route.length / 1000, roadKm: road / 1000, jumps: ramps.length, edges: net.edges.length },
  };
}

// A flight from the lip to the landing point. Seen from above it's a curve
// (a quadratic Bézier) leaving the lip straight on and bending round to the
// landing; up and down it's a throw under gravity: steep for short hops
// (they should still go high), flatter for long ones, and steeper again if a
// hill is in the way. { T, vy, apex, dist, at(t, pos, vel) }.
function solveFlight(lip, dir, land, heightAt) {
  const g = MEGA.gravity;
  const D0 = Math.hypot(land.x - lip.x, land.z - lip.z) || 1;
  const P0 = [lip.x, lip.z], P2 = [land.x, land.z];
  const P1 = [lip.x + dir[0] * D0 * 0.55, lip.z + dir[1] * D0 * 0.55];
  const bez = (u) => [
    (1 - u) * (1 - u) * P0[0] + 2 * u * (1 - u) * P1[0] + u * u * P2[0],
    (1 - u) * (1 - u) * P0[1] + 2 * u * (1 - u) * P1[1] + u * u * P2[1],
  ];
  let D = 0;
  for (let k = 1, a = P0; k <= 40; k++) { const b = bez(k / 40); D += Math.hypot(b[0] - a[0], b[1] - a[1]); a = b; }
  const dy = land.y - lip.y;
  // steep for short hops (they should still go high); flatter for long ones,
  // so no flight lasts much more than 12 s (time aloft² = 2·D·tanθ / g)
  let th = D < 250 ? 0.95 : D < 600 ? 0.8 : Math.max(0.42, Math.min(MEGA.launchAngle, Math.atan((g * 144) / (2 * D))));
  for (let tries = 0; tries < 12; tries++, th = Math.min(1.25, th + 0.06)) {
    const c = Math.cos(th), t = Math.tan(th);
    const den = 2 * c * c * (D * t - dy);
    if (den <= 0) continue;
    const v = Math.sqrt((g * D * D) / den);
    const vh = v * c, vy = v * Math.sin(th), T = D / vh;
    // stay well clear of the ground on the way
    let clear = true;
    for (let k = 1; k < 20 && clear; k++) {
      const tt = (T * k) / 20;
      const y = lip.y + vy * tt - 0.5 * g * tt * tt;
      const [x, z] = bez(k / 20);
      if (y < heightAt(x, z) + (k > 17 ? 1 : 12)) clear = false;
    }
    if (clear || tries === 11) {
      return {
        T, vy, apex: lip.y + (vy * vy) / (2 * g), dist: D,
        // where the flight is t seconds after the lip (and how fast it's going)
        at(t, pos, vel) {
          const u = Math.min(1, t / T), [x, z] = bez(u);
          pos.x = x; pos.z = z; pos.y = lip.y + vy * t - 0.5 * g * t * t;
          if (vel) {
            vel.x = (2 * (1 - u) * (P1[0] - P0[0]) + 2 * u * (P2[0] - P1[0])) / T;
            vel.z = (2 * (1 - u) * (P1[1] - P0[1]) + 2 * u * (P2[1] - P1[1])) / T;
            vel.y = vy - g * t;
          }
          return pos;
        },
      };
    }
  }
}

function padAt(route, s, ramp) {
  const p = route.at(Math.max(0, s));
  return { x: p.x, y: p.y, z: p.z, dir: [p.tx, p.tz], s: Math.max(0, s), ramp };
}

// Evenly spaced samples (every 3 m) as a Route.
function resample(pts) {
  const xs = [], ys = [], zs = [], hs = [], air = [];
  const push = (p) => { xs.push(p[0]); ys.push(p[1]); zs.push(p[2]); hs.push(p[3]); air.push(p[4]); };
  push(pts[0]);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (len < 0.05) continue;
    const n = Math.max(1, Math.round(len / STEP));
    for (let j = 1; j <= n; j++) {
      const t = j / n;
      push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, t < 1 ? Math.min(a[3], b[3]) : b[3], b[4] && (a[4] || t > 0.5) ? 1 : 0]);
    }
  }
  const r = Object.create(Route.prototype);
  r.x = Float32Array.from(xs); r.y = Float32Array.from(ys); r.z = Float32Array.from(zs);
  r.half = Float32Array.from(hs); r.air = Uint8Array.from(air);
  r.n = xs.length;
  r.s = new Float32Array(r.n);
  for (let i = 1; i < r.n; i++) r.s[i] = r.s[i - 1] + Math.hypot(r.x[i] - r.x[i - 1], r.z[i] - r.z[i - 1]);
  r.length = r.s[r.n - 1];
  return r;
}

function norm(x, z) { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; }

// The event's spot (its flag, card and lobby work like a race spot's). Its
// route is the whole circuit, so the race code, gates, walls, map and drive
// line all just work; `circuit` adds the ramps and pads.
export function megaSpot(gen) {
  const node = megaStartNode(gen.net, gen.spots);
  const circuit = buildMegaCircuit(gen.net, (x, z) => gen.heightAt(x, z), node.id, gen.seed);
  return {
    id: gen.spots.length, node: node.id, name: 'Island Odyssey', mode: 'race', mega: true, difficulty: 5,
    route: circuit.route, length: circuit.route.length, km: circuit.route.length / 1000,
    checkpoints: circuit.checkpoints, startS: 14, half: 6, steps: [],
    curvy: 0, climb: 0, dirtFrac: 0, circuit,
  };
}
