import { hashString, mulberry32 } from '../generation/noise.js';
import { RoadNetwork, ROAD_STEP } from '../generation/network.js';

// Layout of the neon city, generated from the world seed so every player
// gets the same streets, buildings and signs.
//
// The city is a grid of streets around a central scramble crossing at the
// origin, closed by a ring road and a seawall, with bay water beyond. Blocks
// are raised (sidewalk height) and split into lots; big blocks get a narrow
// alley through the middle. Buildings are tallest in a ring around the
// crossing and drop to small shops toward the edge.
//
// Everything here is plain data; city.js turns it into meshes.

export const CITY = {
  E: 520,            // ring road centre line at ±E
  ring: 16,          // ring road width
  plaza: 26,         // the two central avenues that meet at the scramble crossing
  avenue: 20,
  street: 13,
  alley: 7,
  walk: 4.5,         // sidewalk width along streets
  kerb: 0.12,        // sidewalk height
  promenade: 7,      // between the ring road and the seawall
};
CITY.wall = CITY.E + CITY.ring / 2 + CITY.promenade;   // seawall (inner face)
CITY.extent = CITY.wall + 40;                          // what the map shows

const FLOOR = 3.6;   // metres per storey

export class CityLayout {
  constructor(seed) {
    const rand = (this.rand = mulberry32(hashString(String(seed) + ':neon-city')));
    this.xs = lines(rand);   // streets running along z (constant x)
    this.zs = lines(rand);   // streets running along x (constant z)
    this.blocks = [];
    this.alleys = [];
    this.buildings = [];
    this.signs = [];
    this.lamps = [];
    this.vending = [];
    this.makeBlocks(rand);
    for (const b of this.blocks) this.fillBlock(b, rand);
    this.makeLamps(rand);
    this.skyline = makeSkyline(rand);
    this.boxGrid = new Map();
    this.poleGrid = new Map();
    for (const b of this.buildings) gridAdd(this.boxGrid, b.box, b.box);
    for (const v of this.vending) gridAdd(this.boxGrid, v.box, v.box);
    for (const w of seawall()) gridAdd(this.boxGrid, w, w);
    for (const l of this.lamps) gridAdd(this.poleGrid, [l.x, l.z, l.x, l.z], l);
    this.net = new CityNet(this);
    // the way home: a gate across the central avenue near the west edge,
    // facing the scramble crossing
    this.portal = { x: -CITY.E + 30, y: 0, z: 0, tx: 1, tz: 0, r: 9 };
  }

  // ---- blocks, lots and buildings --------------------------------------------------

  makeBlocks(rand) {
    const { xs, zs } = this;
    for (let i = 0; i < xs.length - 1; i++) {
      for (let j = 0; j < zs.length - 1; j++) {
        const x0 = xs[i].p + xs[i].w / 2, x1 = xs[i + 1].p - xs[i + 1].w / 2;
        const z0 = zs[j].p + zs[j].w / 2, z1 = zs[j + 1].p - zs[j + 1].w / 2;
        // big blocks get an alley through the middle (no sidewalks, just tarmac)
        const pieces = [[x0, z0, x1, z1, [1, 1, 1, 1]]];   // street on sides: -x, +x, -z, +z
        const split = (axis) => {
          const out = [];
          for (const p of pieces.splice(0)) {
            const lo = axis === 0 ? p[0] : p[1], hi = axis === 0 ? p[2] : p[3];
            if (hi - lo < 105) { out.push(p); continue; }
            const at = lo + (hi - lo) * (0.38 + rand() * 0.24), a0 = at - CITY.alley / 2, a1 = at + CITY.alley / 2;
            if (axis === 0) {
              this.alleys.push([a0, p[1], a1, p[3]]);
              out.push([p[0], p[1], a0, p[3], [p[4][0], 0, p[4][2], p[4][3]]], [a1, p[1], p[2], p[3], [0, p[4][1], p[4][2], p[4][3]]]);
            } else {
              this.alleys.push([p[0], a0, p[2], a1]);
              out.push([p[0], p[1], p[2], a0, [p[4][0], p[4][1], p[4][2], 0]], [p[0], a1, p[2], p[3], [p[4][0], p[4][1], 0, p[4][3]]]);
            }
          }
          pieces.push(...out);
        };
        split(0);
        split(1);
        for (const [a, b, c, d, streets] of pieces) this.blocks.push({ x0: a, z0: b, x1: c, z1: d, streets });
      }
    }
  }

  // Split a block into lots and put a building on each.
  fillBlock(b, rand) {
    const w = CITY.walk, gap = 0.6;
    const inner = [
      b.x0 + (b.streets[0] ? w : gap), b.z0 + (b.streets[2] ? w : gap),
      b.x1 - (b.streets[1] ? w : gap), b.z1 - (b.streets[3] ? w : gap),
    ];
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const d = district(cx, cz);
    const maxLot = d < 0.5 ? 46 : d < 0.75 ? 32 : 22;
    const lots = [];
    const cut = (r) => {
      const W = r[2] - r[0], D = r[3] - r[1];
      if ((W <= maxLot && D <= maxLot) || (W < 20 && D < 20)) { lots.push(r); return; }
      const t = 0.35 + rand() * 0.3;
      if (W >= D) { const m = r[0] + W * t; cut([r[0], r[1], m, r[3]]); cut([m, r[1], r[2], r[3]]); }
      else { const m = r[1] + D * t; cut([r[0], r[1], r[2], m]); cut([r[0], m, r[2], r[3]]); }
    };
    cut(inner);
    for (const lot of lots) this.addBuilding(lot, inner, b, rand);
  }

  addBuilding(lot, inner, block, rand) {
    // a sliver of space between neighbours, more round the big towers
    const s = 0.5 + rand() * 1.2;
    let [x0, z0, x1, z1] = [lot[0] + s, lot[1] + s, lot[2] - s, lot[3] - s];
    // buildings front right onto the sidewalk
    if (Math.abs(lot[0] - inner[0]) < 0.01) x0 = lot[0];
    if (Math.abs(lot[2] - inner[2]) < 0.01) x1 = lot[2];
    if (Math.abs(lot[1] - inner[1]) < 0.01) z0 = lot[1];
    if (Math.abs(lot[3] - inner[3]) < 0.01) z1 = lot[3];
    const W = x1 - x0, D = z1 - z0;
    if (W < 5 || D < 5) return;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const d = district(cx, cz);
    // height: a ring of towers round the crossing (which itself stays lower,
    // so its big screens can be seen), mid-rise beyond, small shops at the edge
    const core = Math.exp(-(((d - 0.3) / 0.2) ** 2));
    let h = 8 + core * 95 * (0.35 + rand() * 1.0) + (1 - d) * 22 * rand();
    if (d < 0.14) h = 22 + rand() * 30;
    if (rand() < 0.1 && d > 0.15 && d < 0.65 && Math.min(W, D) > 22) h = 150 + rand() * 120;   // landmark towers
    if (Math.min(W, D) < 12) h = Math.min(h, 40);      // pencil buildings
    h = Math.max(2, Math.round(h / FLOOR)) * FLOOR + 1.2;
    // the faces that look onto a street or alley (for shop fronts and signs)
    const faces = [];
    if (x0 <= inner[0] + 0.01) faces.push(['-x', block.streets[0]]);
    if (x1 >= inner[2] - 0.01) faces.push(['+x', block.streets[1]]);
    if (z0 <= inner[1] + 0.01) faces.push(['-z', block.streets[2]]);
    if (z1 >= inner[3] - 0.01) faces.push(['+z', block.streets[3]]);
    const style = h > 90 ? (rand() < 0.6 ? 2 : 0) : d > 0.6 ? (rand() < 0.6 ? 3 : 1) : Math.floor(rand() * 4);
    const bld = {
      box: [x0, z0, x1, z1], h, style, seed: rand(), neon: Math.floor(rand() * NEON.length),
      tiers: [], faces, d,
    };
    // tall buildings step back as they rise
    if (h > 70 && W > 18 && D > 18) {
      const t1 = h * (0.45 + rand() * 0.2), i1 = Math.min(W, D) * (0.08 + rand() * 0.07);
      const t2 = h * (0.8 + rand() * 0.1), i2 = i1 + Math.min(W, D) * (0.07 + rand() * 0.06);
      bld.tiers.push([x0, z0, x1, z1, 0, t1], [x0 + i1, z0 + i1, x1 - i1, z1 - i1, t1, t2], [x0 + i2, z0 + i2, x1 - i2, z1 - i2, t2, h]);
    } else bld.tiers.push([x0, z0, x1, z1, 0, h]);
    this.buildings.push(bld);
    this.addSigns(bld, rand);
    this.addVending(bld, rand);
  }

  // Neon on the street-facing sides: a shop sign over the ground floor,
  // vertical blade signs sticking out into the street, and big screens on
  // the taller buildings round the crossing and along the avenues.
  addSigns(b, rand) {
    const [x0, z0, x1, z1] = b.box;
    for (const [face, street] of b.faces) {
      const along = face[1] === 'x' ? [z0, z1] : [x0, x1];
      const len = along[1] - along[0];
      const at = face === '-x' ? x0 : face === '+x' ? x1 : face === '-z' ? z0 : z1;
      const out = face[0] === '-' ? -1 : 1;
      const sign = (kind, u0, u1, y0, y1, extra = {}) => this.signs.push({
        kind, face, at: at + out * (kind === 'blade' ? 0 : 0.12), out, u0, u1, y0, y1,
        art: Math.floor(rand() * ART[kind]), phase: rand(), flicker: rand() < 0.06, ...extra,
      });
      // shop fronts on every street face, smaller on alleys
      if (b.h > 6 && len > 6 && rand() < (street ? 0.85 : 0.45)) {
        const w = Math.min(len * (0.55 + rand() * 0.3), street ? 11 : 6), c = along[0] + len * (0.3 + rand() * 0.4);
        const u0 = Math.max(along[0] + 0.4, c - w / 2), u1 = Math.min(along[1] - 0.4, u0 + w);
        sign('band', u0, u1, 3.6, 3.6 + (u1 - u0) / 4.2);
      }
      // blade signs: the Tokyo look
      if (b.d > 0.08 && b.h > 10 && rand() < (street ? 0.7 : 0.35)) {
        const n = len > 16 && rand() < 0.5 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const u = k === 0 ? along[0] + 0.9 : along[1] - 0.9;
          // the art is 1:4, so keep them close to that
          const tall = Math.min(b.h - 6, 4.4 * (1 + rand() * 0.5));
          if (tall < 3.5) continue;
          const y0 = 5 + rand() * 2;
          sign('blade', u, u, y0, y0 + tall);
        }
      }
      // big screens and billboards
      const big = street && b.h > 28 && len > 16 && (b.d < 0.22 ? rand() < 0.9 : rand() < 0.22);
      if (big) {
        const w = Math.min(len * 0.8, 14 + rand() * 12), hgt = w * 0.56;
        const y0 = Math.min(b.h - hgt - 2, 10 + rand() * 18);
        if (y0 > 7) {
          const c = (along[0] + along[1]) / 2;
          sign('board', c - w / 2, c + w / 2, y0, y0 + hgt, { led: rand() < 0.55 });
        }
      }
    }
    // a billboard frame on the roof of mid-rise buildings
    if (b.h > 12 && b.h < 40 && b.faces.some((f) => f[1]) && rand() < 0.18) {
      const [face] = b.faces.find((f) => f[1]);
      const along = face[1] === 'x' ? [z0, z1] : [x0, x1];
      const len = along[1] - along[0];
      const w = Math.min(len * 0.9, 9 + rand() * 6), c = (along[0] + along[1]) / 2;
      const at = face === '-x' ? x0 : face === '+x' ? x1 : face === '-z' ? z0 : z1;
      const out = face[0] === '-' ? -1 : 1;
      this.signs.push({ kind: 'board', face, at: at - out * 1.5, out, u0: c - w / 2, u1: c + w / 2, y0: b.h + 1.2, y1: b.h + 1.2 + w * 0.56, art: Math.floor(rand() * ART.board), phase: rand(), flicker: false, roof: true });
    }
  }

  // Glowing vending machines against shop fronts.
  addVending(b, rand) {
    for (const [face, street] of b.faces) {
      if (!street || rand() > 0.22 || b.d < 0.08) continue;
      const [x0, z0, x1, z1] = b.box;
      const along = face[1] === 'x' ? [z0, z1] : [x0, x1];
      if (along[1] - along[0] < 5) continue;
      const u = along[0] + 1 + rand() * (along[1] - along[0] - 2);
      const at = face === '-x' ? x0 : face === '+x' ? x1 : face === '-z' ? z0 : z1;
      const out = face[0] === '-' ? -1 : 1;
      const n = rand() < 0.4 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const uu = u + k * 1.05;
        if (uu > along[1] - 0.6) break;
        const c = at + out * 0.4;
        const box = face[1] === 'x' ? [c - 0.4, uu - 0.5, c + 0.4, uu + 0.5] : [uu - 0.5, c - 0.4, uu + 0.5, c + 0.4];
        this.vending.push({ x: face[1] === 'x' ? c : uu, z: face[1] === 'x' ? uu : c, face, out, color: Math.floor(rand() * 4), box });
      }
    }
  }

  // Street lights along every sidewalk, staggered on the two sides.
  makeLamps(rand) {
    const SP = 30;
    const edge = CITY.kerb;
    for (const b of this.blocks) {
      const sides = [
        ['-x', b.x0 + 0.7, [b.z0 + 6, b.z1 - 6]], ['+x', b.x1 - 0.7, [b.z0 + 6, b.z1 - 6]],
        ['-z', b.z0 + 0.7, [b.x0 + 6, b.x1 - 6]], ['+z', b.z1 - 0.7, [b.x0 + 6, b.x1 - 6]],
      ];
      sides.forEach(([face, at, [a, c]], k) => {
        if (!b.streets[k] || c - a < 4) return;
        const n = Math.max(1, Math.round((c - a) / SP));
        const off = (Math.floor(at) & 1) * 0.5;
        for (let i = 0; i < n; i++) {
          const u = a + ((i + 0.5 + off * 0.3) / n) * (c - a);
          const out = face[0] === '-' ? -1 : 1;
          this.lamps.push(face[1] === 'x' ? { x: at, z: u, y: edge, dx: out, dz: 0, warm: rand() < 0.35 } : { x: u, z: at, y: edge, dx: 0, dz: out, warm: rand() < 0.35 });
        }
      });
    }
    // the promenade along the seawall
    const W = CITY.wall - 1.2;
    for (let u = -W + 10; u < W - 10; u += 34) {
      this.lamps.push({ x: u, z: -W, y: edge, dx: 0, dz: 1, warm: false }, { x: u, z: W, y: edge, dx: 0, dz: -1, warm: false });
      this.lamps.push({ x: -W, z: u, y: edge, dx: 1, dz: 0, warm: false }, { x: W, z: u, y: edge, dx: -1, dz: 0, warm: false });
    }
  }

  // ---- queries ---------------------------------------------------------------------

  // 0 on tarmac (streets, alleys), kerb height on sidewalks and blocks.
  heightAt(x, z) {
    return this.onRoad(x, z) ? 0 : CITY.kerb;
  }

  onRoad(x, z) {
    const lim = CITY.E + CITY.ring / 2;
    if (Math.abs(x) > lim || Math.abs(z) > lim) return false;   // promenade
    for (const l of this.xs) if (Math.abs(x - l.p) < l.w / 2) return true;
    for (const l of this.zs) if (Math.abs(z - l.p) < l.w / 2) return true;
    for (const a of this.alleys) if (x > a[0] && x < a[2] && z > a[1] && z < a[3]) return true;
    return false;
  }

  boxesNear(x, z, out) {
    return gridGet(this.boxGrid, x, z, out);
  }

  // street-light poles, as round obstacles (same shape the island's tree trunks use)
  trunksNear(x, z, out) {
    out.length = 0;
    const list = gridGet(this.poleGrid, x, z, this.poleBuf || (this.poleBuf = []));
    for (const l of list) out.push({ x: l.x, z: l.z, r: 0.14 });
    return out;
  }
}

// ---- streets ------------------------------------------------------------------

// Street centre lines across one axis: the central avenue at 0, the ring
// road at ±E, and streets 70-120 m apart in between.
function lines(rand) {
  const E = CITY.E;
  const out = [{ p: 0, w: CITY.plaza }];
  for (const dir of [1, -1]) {
    let p = 0, k = 0;
    for (;;) {
      p += (70 + rand() * 50) * dir;
      if (Math.abs(p) > E - 62) break;
      k++;
      out.push({ p, w: k % 3 === 0 ? CITY.avenue : CITY.street });
    }
  }
  out.push({ p: -E, w: CITY.ring }, { p: E, w: CITY.ring });
  return out.sort((a, b) => a.p - b.p);
}

// 0 at the crossing .. 1 at the ring road
function district(x, z) {
  return Math.min(1, Math.max(Math.abs(x), Math.abs(z)) / CITY.E);
}

// The seawall, in four straight pieces.
function seawall() {
  const W = CITY.wall, t = 1.2;
  return [[-W - t, -W - t, W + t, -W], [-W - t, W, W + t, W + t], [-W - t, -W, -W, W], [W, -W, W + t, W]];
}

// Far-off towers across the bay: just for the skyline.
function makeSkyline(rand) {
  const out = [];
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2, r = 800 + rand() * 900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 20 + rand() * 45, d = 20 + rand() * 45;
    const h = 30 + rand() ** 2 * 240;
    out.push({ box: [x - w / 2, z - d / 2, x + w / 2, z + d / 2], h, style: Math.floor(rand() * 4), seed: rand(), neon: Math.floor(rand() * NEON.length), tiers: [[x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, h]], far: true });
  }
  return out;
}

// ---- spatial grid ---------------------------------------------------------------

const CELL = 32;
function gridAdd(grid, [x0, z0, x1, z1], item) {
  for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) {
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      const k = cx * 4096 + cz;
      let a = grid.get(k);
      if (!a) grid.set(k, (a = []));
      a.push(item);
    }
  }
}
function gridGet(grid, x, z, out) {
  out.length = 0;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const a = grid.get((cx + dx) * 4096 + cz + dz);
      if (a) for (const it of a) if (!out.includes(it)) out.push(it);
    }
  }
  return out;
}

// ---- road graph for the GPS and resets ---------------------------------------

// The street grid as nodes (crossings) and edges (the street between two
// crossings), in the same shape as the island's RoadNetwork so its routing
// code can be shared.
class CityNet {
  constructor(L) {
    this.nodes = [];
    this.edges = [];
    const id = (i, j) => i * L.zs.length + j;
    for (const a of L.xs) for (const b of L.zs) {
      this.nodes.push({ id: this.nodes.length, x: a.p, z: b.p, y: 0, edges: [], disc: Math.max(a.w, b.w) / 2, kind: 1 });
    }
    const addEdge = (na, nb, half) => {
      const A = this.nodes[na], B = this.nodes[nb];
      const length = Math.hypot(B.x - A.x, B.z - A.z);
      const n = Math.max(2, Math.ceil(length / ROAD_STEP) + 1);
      const tx = (B.x - A.x) / length, tz = (B.z - A.z) / length;
      const e = { id: this.edges.length, a: na, b: nb, n, length, half, kind: 1, x: new Float32Array(n), z: new Float32Array(n), y: new Float32Array(n), tx: new Float32Array(n).fill(tx), tz: new Float32Array(n).fill(tz) };
      for (let i = 0; i < n; i++) {
        const s = Math.min(length, i * ROAD_STEP);
        e.x[i] = A.x + tx * s;
        e.z[i] = A.z + tz * s;
      }
      A.edges.push(e.id); B.edges.push(e.id);
      this.edges.push(e);
      return e;
    };
    this.lineEdges = { x: L.xs.map(() => []), z: L.zs.map(() => []) };
    L.xs.forEach((a, i) => { for (let j = 0; j < L.zs.length - 1; j++) this.lineEdges.x[i].push(addEdge(id(i, j), id(i, j + 1), a.w / 2)); });
    L.zs.forEach((b, j) => { for (let i = 0; i < L.xs.length - 1; i++) this.lineEdges.z[j].push(addEdge(id(i, j), id(i + 1, j), b.w / 2)); });
    this.L = L;
  }

  // Nearest point on a street centre line: { edgeDist, y, kind, x, z, tx, tz, edge, s }.
  nearestAnywhere(x, z) {
    const L = this.L, E = CITY.E;
    let best = null;
    const consider = (edgeDist, px, pz, tx, tz, edges, along) => {
      if (best && edgeDist >= best.edgeDist) return;
      const e = edges.find((ed) => {
        const a = ed.x[0] * tx + ed.z[0] * tz;
        return along >= a - 0.01 && along <= a + ed.length + 0.01;
      });
      if (!e) return;
      best = { edgeDist, y: 0, kind: 1, x: px, z: pz, tx, tz, edge: e.id, s: along - (e.x[0] * tx + e.z[0] * tz) };
    };
    L.xs.forEach((l, i) => {
      const cz = Math.max(-E, Math.min(E, z));
      consider(Math.hypot(x - l.p, z - cz) - l.w / 2, l.p, cz, 0, 1, this.lineEdges.x[i], cz);
    });
    L.zs.forEach((l, j) => {
      const cx = Math.max(-E, Math.min(E, x));
      consider(Math.hypot(z - l.p, x - cx) - l.w / 2, cx, l.p, 1, 0, this.lineEdges.z[j], cx);
    });
    return best;
  }

  nearest(x, z, maxR = 30) {
    const n = this.nearestAnywhere(x, z);
    return n && n.edgeDist <= maxR ? n : null;
  }
}
CityNet.prototype.route = RoadNetwork.prototype.route;
CityNet.prototype.pathFromNodes = RoadNetwork.prototype.pathFromNodes;
CityNet.prototype.pointOnEdge = RoadNetwork.prototype.pointOnEdge;

// ---- sign art --------------------------------------------------------------------

// How many designs of each sign kind the atlas holds (see signs.js).
export const ART = { blade: 16, band: 24, board: 12 };

// Neon colours buildings and signs pick from.
export const NEON = ['#ff2e88', '#22e5ff', '#ffb000', '#9d5cff', '#39ff7a', '#ff4b2b', '#4d7cff', '#ff66d9'];
