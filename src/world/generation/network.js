import { mulberry32, hashString, createNoise2D, clamp, smoothstep } from './noise.js';

// The island's road network: junction nodes joined by winding paved roads and
// dirt roads, plus dead-end trails into the hills. Built deterministically
// from the seed, so every player (and the terrain worker) gets the same map.

export const PAVED_HALF = 4.6;
export const DIRT_HALF = 2.9;
export const KIND_PAVED = 1, KIND_DIRT = 2;
const STEP = 3;      // metres between road samples
const CELL = 40;     // spatial grid cell
const MIN_NODE_GAP = 760;

export class RoadNetwork {
  // land(x, z): natural terrain height; inland(x, z): 0..1 island mask
  constructor(seed, land, inland, extent) {
    this.land = land;
    this.inland = inland;
    const rand = mulberry32(hashString(seed + ':net'));
    this.wiggle = createNoise2D(hashString(seed + ':wiggle'));
    this.nodes = [];
    this.edges = [];
    this.placeNodes(rand, extent);
    this.connect(rand);
    this.addTrails(rand);
    for (const e of this.edges) this.shapeEdge(e);
    this.levelEdges();
    this.buildSamples();
  }

  // ---- generation ---------------------------------------------------------

  placeNodes(rand, extent) {
    for (let tries = 0; tries < 4000 && this.nodes.length < 70; tries++) {
      const x = (rand() * 2 - 1) * extent, z = (rand() * 2 - 1) * extent;
      if (this.inland(x, z) < 0.97 || this.land(x, z) < 6) continue;
      if (this.nodes.some((n) => (n.x - x) ** 2 + (n.z - z) ** 2 < MIN_NODE_GAP ** 2)) continue;
      this.nodes.push({ id: this.nodes.length, x, z, y: 0, edges: [], trail: false });
    }
  }

  // Relative neighbourhood graph (planar, connected), MST edges paved.
  connect(rand) {
    const N = this.nodes, n = N.length;
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
    const cand = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dij = d2(N[i], N[j]);
        if (dij > 2200 ** 2) continue;
        let ok = true;
        for (let k = 0; k < n && ok; k++) {
          if (k === i || k === j) continue;
          if (Math.max(d2(N[i], N[k]), d2(N[j], N[k])) < dij) ok = false;
        }
        if (ok) cand.push([Math.sqrt(dij), i, j]);
      }
    }
    cand.sort((a, b) => a[0] - b[0]);
    const parent = N.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (const [len, i, j] of cand) {
      const mst = find(i) !== find(j);
      if (mst) parent[find(i)] = find(j);
      const kind = mst || rand() < 0.38 ? KIND_PAVED : KIND_DIRT; // side links are mostly dirt
      this.addEdge(i, j, kind, rand);
    }
  }

  // Dead-end dirt tracks off some junctions, out toward the hills.
  addTrails(rand) {
    const count = this.nodes.length;
    for (let i = 0; i < count; i++) {
      if (rand() > 0.55) continue;
      const a = this.nodes[i];
      const ang = rand() * Math.PI * 2, len = 380 + rand() * 520;
      const x = a.x + Math.sin(ang) * len, z = a.z + Math.cos(ang) * len;
      if (this.inland(x, z) < 0.95 || this.land(x, z) < 5) continue;
      if (this.nodes.some((n) => n !== a && (n.x - x) ** 2 + (n.z - z) ** 2 < 300 ** 2)) continue;
      // keep away from existing roads' straight lines and other edges' directions
      if (this.edges.some((e) => segmentsCross(a, { x, z }, this.nodes[e.a], this.nodes[e.b]) || angleTooClose(a, { x, z }, e, this))) continue;
      const end = { id: this.nodes.length, x, z, y: 0, edges: [], trail: true };
      this.nodes.push(end);
      this.addEdge(a.id, end.id, KIND_DIRT, rand);
    }
  }

  addEdge(i, j, kind, rand) {
    const e = { id: this.edges.length, a: i, b: j, kind, half: kind === KIND_PAVED ? PAVED_HALF : DIRT_HALF, twist: rand() ** 1.8, seed: rand() * 1000 };
    this.edges.push(e);
    this.nodes[i].edges.push(e.id);
    this.nodes[j].edges.push(e.id);
  }

  // Winding centre line between the two nodes, resampled every STEP metres.
  shapeEdge(e) {
    const A = this.nodes[e.a], B = this.nodes[e.b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len = Math.hypot(dx, dz);
    const px = -dz / len, pz = dx / len;
    const ctrlN = Math.max(3, Math.ceil(len / 45));
    const amp = Math.min(150, len * (0.025 + 0.14 * e.twist)) * (e.kind === KIND_DIRT ? 1.15 : 1);
    const freq = 0.9 + e.twist * 4.8;
    const ctrl = [];
    for (let i = 0; i <= ctrlN; i++) {
      const t = i / ctrlN;
      const env = Math.pow(Math.sin(Math.PI * t), 0.75);
      const w = this.wiggle(e.seed + t * freq, 0.37) * 0.8 + this.wiggle(e.seed * 1.7 + t * freq * 2.7, 4.1) * 0.2 * e.twist;
      ctrl.push([A.x + dx * t + px * amp * env * w, A.z + dz * t + pz * amp * env * w]);
    }
    // dense Catmull-Rom, then resample by arc length
    const fine = [];
    for (let i = 0; i < ctrl.length - 1; i++) {
      const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      for (let k = 0; k < 12; k++) {
        const t = k / 12, t2 = t * t, t3 = t2 * t;
        const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
        fine.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
      }
    }
    fine.push(ctrl[ctrl.length - 1]);
    const xs = [fine[0][0]], zs = [fine[0][1]];
    let acc = 0, next = STEP;
    for (let i = 1; i < fine.length; i++) {
      const [x0, z0] = fine[i - 1], [x1, z1] = fine[i];
      const seg = Math.hypot(x1 - x0, z1 - z0);
      while (acc + seg >= next) {
        const t = (next - acc) / seg;
        xs.push(x0 + (x1 - x0) * t);
        zs.push(z0 + (z1 - z0) * t);
        next += STEP;
      }
      acc += seg;
    }
    xs[xs.length - 1] = B.x; zs[zs.length - 1] = B.z;
    if (Math.hypot(xs[xs.length - 1] - xs[xs.length - 2], zs[zs.length - 1] - zs[zs.length - 2]) < 0.5) { xs.splice(-2, 1); zs.splice(-2, 1); }
    xs[xs.length - 1] = B.x; zs[zs.length - 1] = B.z;
    e.x = Float32Array.from(xs);
    e.z = Float32Array.from(zs);
    e.n = xs.length;
    e.length = (e.n - 1) * STEP;
  }

  // Road heights: terrain under the road, smoothed along it (gentle grades),
  // then bent at each end to meet the shared junction height.
  levelEdges() {
    const SIG = 45, WIN = 110; // samples
    const wts = Array.from({ length: WIN * 2 + 1 }, (_, i) => Math.exp(-(((i - WIN) / SIG) ** 2)));
    for (const e of this.edges) {
      const raw = new Float32Array(e.n);
      for (let i = 0; i < e.n; i++) raw[i] = this.land(e.x[i], e.z[i]);
      const sm = new Float32Array(e.n);
      for (let i = 0; i < e.n; i++) {
        let s = 0, w = 0;
        for (let k = Math.max(0, i - WIN); k <= Math.min(e.n - 1, i + WIN); k++) { s += raw[k] * wts[k - i + WIN]; w += wts[k - i + WIN]; }
        sm[i] = s / w;
      }
      e.y = sm;
    }
    for (const n of this.nodes) {
      let s = 0;
      for (const id of n.edges) { const e = this.edges[id]; s += e.a === n.id ? e.y[0] : e.y[e.n - 1]; }
      n.y = Math.max(1.6, n.edges.length ? s / n.edges.length : this.land(n.x, n.z));
      n.disc = Math.max(...n.edges.map((id) => this.edges[id].half)) + 2.2;
      n.kind = n.edges.some((id) => this.edges[id].kind === KIND_PAVED) ? KIND_PAVED : KIND_DIRT;
    }
    for (const e of this.edges) {
      const offA = this.nodes[e.a].y - e.y[0], offB = this.nodes[e.b].y - e.y[e.n - 1];
      const blend = Math.min(160, e.length * 0.45);
      for (let i = 0; i < e.n; i++) {
        const s = i * STEP;
        e.y[i] += offA * (1 - smoothstep(0, blend, s)) + offB * (1 - smoothstep(0, blend, e.length - s));
        e.y[i] = Math.max(1.5, e.y[i]);
      }
      // tangents
      e.tx = new Float32Array(e.n); e.tz = new Float32Array(e.n);
      for (let i = 0; i < e.n; i++) {
        const a = Math.max(0, i - 1), b = Math.min(e.n - 1, i + 1);
        const tx = e.x[b] - e.x[a], tz = e.z[b] - e.z[a];
        const l = Math.hypot(tx, tz) || 1;
        e.tx[i] = tx / l; e.tz[i] = tz / l;
      }
      let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < e.n; i++) {
        minX = Math.min(minX, e.x[i]); maxX = Math.max(maxX, e.x[i]);
        minZ = Math.min(minZ, e.z[i]); maxZ = Math.max(maxZ, e.z[i]);
      }
      e.box = [minX, minZ, maxX, maxZ];
    }
  }

  buildSamples() {
    this.grid = new Map();
    const put = (x, z, v) => {
      const key = cellKey(Math.floor(x / CELL), Math.floor(z / CELL));
      let a = this.grid.get(key);
      if (!a) this.grid.set(key, (a = []));
      a.push(v);
    };
    // samples encoded as edgeId * 65536 + index; nodes as -(id + 1)
    for (const e of this.edges) for (let i = 0; i < e.n; i++) put(e.x[i], e.z[i], e.id * 65536 + i);
    for (const n of this.nodes) put(n.x, n.z, -(n.id + 1));
  }

  // ---- queries --------------------------------------------------------------

  // Nearest road surface within maxR of the road EDGE. Returns
  // { edgeDist, y, kind, x, z, tx, tz, edge, s } or null. edgeDist < 0 = on the road.
  nearest(x, z, maxR = 30) {
    const reach = maxR + PAVED_HALF + CELL;
    const r = Math.ceil(reach / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const q = this.q || (this.q = { d: Infinity, e: -1, i: -1, node: -1 });
    q.d = Infinity; q.e = -1; q.node = -1;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const arr = this.grid.get(cellKey(cx + dx, cz + dz));
        if (arr) this.scanInto(arr, x, z, q);
      }
    }
    const best = this.resolve(q, x, z);
    return best && best.edgeDist <= maxR ? best : null;
  }

  // Back-compat for callers holding their own candidate list (the worker).
  scan(list, x, z) {
    const q = this.q2 || (this.q2 = { d: Infinity, e: -1, i: -1, node: -1 });
    q.d = Infinity; q.e = -1; q.node = -1;
    this.scanInto(list, x, z, q);
    return this.resolve(q, x, z);
  }

  // Find the closest sample (by distance to the road edge) without allocating.
  scanInto(list, x, z, q) {
    for (let n = 0; n < list.length; n++) {
      const v = list[n];
      if (v < 0) {
        const nd = this.nodes[-v - 1];
        const d = Math.sqrt((x - nd.x) ** 2 + (z - nd.z) ** 2) - nd.disc;
        if (d < q.d) { q.d = d; q.node = nd.id; q.e = -1; }
        continue;
      }
      const e = this.edges[(v / 65536) | 0], i = v & 65535;
      const dx = e.x[i] - x, dz = e.z[i] - z;
      const d = Math.sqrt(dx * dx + dz * dz) - e.half;
      if (d < q.d) { q.d = d; q.e = e.id; q.i = i; q.node = -1; }
    }
  }

  resolve(q, x, z) {
    if (q.node >= 0) {
      const nd = this.nodes[q.node];
      return { edgeDist: q.d, y: nd.y, kind: nd.kind, x: nd.x, z: nd.z, tx: 0, tz: 1, edge: nd.edges[0], s: null, node: nd.id };
    }
    if (q.e < 0) return null;
    return this.project(this.edges[q.e], q.i, x, z);
  }

  project(e, i, x, z) {
    let d = Infinity, i0 = 0, t = 0, px = 0, pz = 0;
    for (let k = i - 1; k <= i; k++) {
      if (k < 0 || k + 1 >= e.n) continue;
      const ax = e.x[k], az = e.z[k], ex = e.x[k + 1] - ax, ez = e.z[k + 1] - az;
      const l2 = ex * ex + ez * ez || 1;
      const tt = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
      const qx = ax + ex * tt, qz = az + ez * tt;
      const dd = Math.sqrt((x - qx) ** 2 + (z - qz) ** 2);
      if (dd < d) { d = dd; i0 = k; t = tt; px = qx; pz = qz; }
    }
    return {
      edgeDist: d - e.half,
      y: e.y[i0] + (e.y[i0 + 1] - e.y[i0]) * t,
      kind: e.kind, x: px, z: pz, tx: e.tx[i0], tz: e.tz[i0],
      edge: e.id, s: (i0 + t) * STEP,
    };
  }

  // Nearest road point anywhere on the island.
  nearestAnywhere(x, z) {
    const near = this.nearest(x, z, 200);
    if (near) return near;
    let best = null;
    for (const e of this.edges) {
      for (let i = 0; i < e.n; i += 6) {
        const d = (e.x[i] - x) ** 2 + (e.z[i] - z) ** 2;
        if (!best || d < best[0]) best = [d, e, i];
      }
    }
    const [, e, i] = best;
    let p = null;
    for (let k = Math.max(0, i - 6); k <= Math.min(e.n - 1, i + 6); k++) {
      const q = this.project(e, k, x, z);
      if (!p || q.edgeDist < p.edgeDist) p = q;
    }
    return p;
  }

  // Indices into the grid (for the worker's per-chunk candidate lists)
  entriesInBox(minX, minZ, maxX, maxZ) {
    const out = [];
    for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz++) {
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx++) {
        const a = this.grid.get(cellKey(cx, cz));
        if (a) for (const v of a) out.push(v);
      }
    }
    return out;
  }

  // Point + heading at distance s along edge e.
  pointOnEdge(e, s) {
    const f = clamp(s / STEP, 0, e.n - 1.001);
    const i = Math.floor(f), t = f - i;
    return {
      x: e.x[i] + (e.x[i + 1] - e.x[i]) * t,
      z: e.z[i] + (e.z[i + 1] - e.z[i]) * t,
      y: e.y[i] + (e.y[i + 1] - e.y[i]) * t,
      tx: e.tx[i], tz: e.tz[i],
    };
  }

  // ---- routing (GPS) --------------------------------------------------------

  // Shortest path from a road point to a node. Returns a polyline [[x,z],...].
  route(from, targetNode) {
    const e0 = this.edges[from.edge];
    if (from.node != null) return this.pathFromNodes([[from.node, 0]], targetNode, [[from.x, from.z]]);
    const starts = [[e0.a, from.s], [e0.b, e0.length - from.s]];
    const head = [[from.x, from.z]];
    return this.pathFromNodes(starts, targetNode, head, from);
  }

  pathFromNodes(starts, target, head, from) {
    const n = this.nodes.length;
    const dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), prevEdge = new Int32Array(n).fill(-1);
    const done = new Uint8Array(n);
    for (const [id, d] of starts) { dist[id] = d; }
    for (;;) {
      let u = -1, best = Infinity;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u < 0 || u === target) break;
      done[u] = 1;
      for (const id of this.nodes[u].edges) {
        const e = this.edges[id];
        const v = e.a === u ? e.b : e.a;
        const nd = dist[u] + e.length;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevEdge[v] = id; }
      }
    }
    if (!isFinite(dist[target])) return null;
    const chain = [];
    for (let v = target; prev[v] >= 0; v = prev[v]) chain.push([prevEdge[v], prev[v], v]);
    chain.reverse();
    const pts = head.slice();
    let startNode = chain.length ? chain[0][1] : target;
    if (from) {
      // walk along the starting edge from the player's spot to the first node
      const e = this.edges[from.edge];
      const toA = startNode === e.a;
      const i0 = Math.floor(from.s / STEP);
      if (toA) for (let i = i0; i >= 0; i -= 2) pts.push([e.x[i], e.z[i]]);
      else for (let i = i0 + 1; i < e.n; i += 2) pts.push([e.x[i], e.z[i]]);
    }
    for (const [id, a] of chain) {
      const e = this.edges[id];
      if (e.a === a) for (let i = 0; i < e.n; i += 2) pts.push([e.x[i], e.z[i]]);
      else for (let i = e.n - 1; i >= 0; i -= 2) pts.push([e.x[i], e.z[i]]);
    }
    pts.push([this.nodes[target].x, this.nodes[target].z]);
    return { pts, length: dist[target] };
  }
}

// numeric grid keys (no string building on the hot path)
function cellKey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

function segmentsCross(p1, p2, p3, p4) {
  const d = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2), d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

// Reject a trail leaving node a too close in angle to an existing road at a.
function angleTooClose(a, p, e, net) {
  if (e.a !== a.id && e.b !== a.id) return false;
  const o = net.nodes[e.a === a.id ? e.b : e.a];
  const v1 = Math.atan2(p.x - a.x, p.z - a.z), v2 = Math.atan2(o.x - a.x, o.z - a.z);
  const d = Math.abs(Math.atan2(Math.sin(v1 - v2), Math.cos(v1 - v2)));
  return d < 0.6;
}

export { STEP as ROAD_STEP };
