import { hashString, mulberry32 } from '../generation/noise.js';
import { RoadNetwork, ROAD_STEP } from '../generation/network.js';
import { Route } from '../generation/spots.js';

// Layout of Hikari, the neon city, generated from the world seed so every
// player gets the same streets, buildings and signs.
//
// The map came first and the city follows it, so it's easy to find your way:
//  - the core: a regular grid of 10 x 10 blocks inside a purple-lit ring road;
//  - the Loop: a cyan-lit boulevard round downtown (and a race circuit);
//  - two central avenues that meet at the scramble crossing in the middle;
//  - the Harbor (warehouses and container yards) on the west wing, where
//    the portal stands at the end of the main avenue, and the Circuit
//    District (tech campus) on the east wing (the map shows west on the
//    right, as you'd see it facing north);
//  - the bay to the north and south, behind a seawall.
// Buildings are tallest inside the Loop and drop to small shops toward the
// ring road. Everything here is plain data; city.js turns it into meshes.

export const CITY_NAME = 'Hikari';

export const CITY = {
  P: 88,             // core block pitch (street centre to street centre)
  N: 10,             // core blocks per side
  walk: 4.5,         // sidewalk width
  kerb: 0.12,        // sidewalk height
  promenade: 7,      // between the outermost roads and the seawall
  wingX: [600, 750], // wing street lines (mirrored east and west)
  wingZ: 352,        // the wings span |z| up to this street
};
CITY.C = (CITY.P * CITY.N) / 2;   // ring road centre lines at ±C (440)

// street kinds and their widths
export const K = { street: 0, central: 1, loop: 2, ring: 3, side: 4, alley: 5, junction: 6, scramble: 7 };
const WIDTH = [12, 24, 20, 18, 14, 6];

CITY.coreEdge = CITY.C + WIDTH[K.ring] / 2 + CITY.promenade;              // 456
CITY.wingEdgeX = CITY.wingX[1] + WIDTH[K.side] / 2 + CITY.promenade;      // 764
CITY.wingEdgeZ = CITY.wingZ + WIDTH[K.side] / 2 + CITY.promenade;         // 366
CITY.extent = 800;   // half-size of the square the map shows

// The Loop as core grid nodes (i along x, j along z): a ring round
// downtown with a tab top and bottom, like the map's glowing boulevard.
const LOOP = [[4, 2], [5, 2], [6, 2], [6, 3], [7, 3], [7, 4], [7, 5], [7, 6], [7, 7], [6, 7], [6, 8], [5, 8], [4, 8], [4, 7], [3, 7], [3, 6], [3, 5], [3, 4], [3, 3], [4, 3]];

const FLOOR = 3.6;   // metres per storey
const gx = (i) => -CITY.C + CITY.P * i;   // core grid line positions

export class CityLayout {
  constructor(seed) {
    const rand = (this.rand = mulberry32(hashString(String(seed) + ':hikari')));
    this.nodes = [];
    this.segs = [];
    this.nodeKey = new Map();
    this.buildStreets();
    this.blocks = [];
    this.alleys = [];
    this.buildBlocks(rand);
    this.buildings = [];
    this.signs = [];
    this.vending = [];
    this.containers = [];
    for (const b of this.blocks) this.fillBlock(b, rand);
    this.lamps = [];
    this.makeLamps(rand);
    this.edges();
    this.skyline = makeSkyline(rand);
    // spatial lookups
    this.boxGrid = new Map();
    this.poleGrid = new Map();
    this.groundGrid = new Map();
    for (const b of this.buildings) gridAdd(this.boxGrid, b.box, b.box);
    for (const v of this.vending) gridAdd(this.boxGrid, v.box, v.box);
    for (const c of this.containers) gridAdd(this.boxGrid, c.box, c.box);
    for (const w of this.walls) gridAdd(this.boxGrid, w, w);
    for (const l of this.lamps) gridAdd(this.poleGrid, [l.x, l.z, l.x, l.z], l);
    for (const r of [...this.blocks.map((b) => [b.x0, b.z0, b.x1, b.z1]), ...this.promenade]) gridAdd(this.groundGrid, r, r);
    this.net = new CityNet(this);
    // the way home: a gate at the harbour end of the main avenue, facing into the city
    this.portal = { x: -675, y: 0, z: 0, tx: 1, tz: 0, r: 16 };
    this.portals = [this.portal];
    this.spots = makeSpots(this);
  }

  // ---- streets ---------------------------------------------------------------------

  node(x, z) {
    const k = Math.round(x) + ',' + Math.round(z);
    let n = this.nodeKey.get(k);
    if (!n) {
      n = { id: this.nodes.length, x, z, segs: [], hx: 0, hz: 0 };
      this.nodes.push(n);
      this.nodeKey.set(k, n);
    }
    return n;
  }

  nodeAt(x, z) { return this.nodeKey.get(Math.round(x) + ',' + Math.round(z)); }

  seg(ax, az, bx, bz, kind) {
    const a = this.node(ax, az), b = this.node(bx, bz);
    const s = { id: this.segs.length, a: a.id, b: b.id, ax, az, bx, bz, kind, hw: WIDTH[kind] / 2, axis: ax === bx ? 'z' : 'x', len: Math.hypot(bx - ax, bz - az) };
    a.segs.push(s); b.segs.push(s);
    this.segs.push(s);
    return s;
  }

  buildStreets() {
    const N = CITY.N;
    const loop = new Set();
    LOOP.forEach(([i, j], k) => {
      const [i2, j2] = LOOP[(k + 1) % LOOP.length];
      loop.add(edgeKey(i, j, i2, j2));
    });
    const kindOf = (line, i, j, i2, j2) => (line === 0 || line === N ? K.ring : loop.has(edgeKey(i, j, i2, j2)) ? K.loop : line === N / 2 ? K.central : K.street);
    for (let i = 0; i <= N; i++) for (let j = 0; j < N; j++) this.seg(gx(i), gx(j), gx(i), gx(j + 1), kindOf(i, i, j, i, j + 1));
    for (let j = 0; j <= N; j++) for (let i = 0; i < N; i++) this.seg(gx(i), gx(j), gx(i + 1), gx(j), kindOf(j, i, j, i + 1, j));
    // the wings: two streets across, five along (continuing the core's odd lines)
    const wz = [-352, -176, 0, 176, 352];
    for (const s of [-1, 1]) {
      const [x1, x2] = CITY.wingX.map((x) => x * s);
      for (const x of [x1, x2]) for (let k = 0; k < wz.length - 1; k++) this.seg(x, wz[k], x, wz[k + 1], K.side);
      for (const z of wz) {
        const kind = z === 0 ? K.central : K.side;
        this.seg(Math.min(s * CITY.C, x1), z, Math.max(s * CITY.C, x1), z, kind);
        this.seg(Math.min(x1, x2), z, Math.max(x1, x2), z, kind);
      }
    }
    // junction sizes: as wide as the widest street through each way
    for (const n of this.nodes) {
      for (const s of n.segs) {
        if (s.axis === 'z') n.hx = Math.max(n.hx, s.hw);
        else n.hz = Math.max(n.hz, s.hw);
      }
      if (!n.hx) n.hx = n.hz;
      if (!n.hz) n.hz = n.hx;
      n.scramble = n.x === 0 && n.z === 0;
    }
    // quick lookup of the street along a line between two neighbouring nodes
    this.segAt = new Map(this.segs.map((s) => [segKey(s.ax, s.az, s.bx, s.bz), s]));
  }

  halfAt(ax, az, bx, bz) {
    const s = this.segAt.get(segKey(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)));
    return s ? s.hw : 0;
  }

  // ---- blocks, lots and buildings --------------------------------------------------

  buildBlocks(rand) {
    const N = CITY.N;
    const add = (xa, xb, za, zb) => {
      // the block reaches from the edge of each street round it
      const x0 = xa + this.halfAt(xa, za, xa, zb), x1 = xb - this.halfAt(xb, za, xb, zb);
      const z0 = za + this.halfAt(xa, za, xb, za), z1 = zb - this.halfAt(xa, zb, xb, zb);
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const district = districtAt(cx, cz);
      const pieces = [[x0, z0, x1, z1, [1, 1, 1, 1]]];
      // alleys: some core blocks, and every block in the wings (service lanes)
      const wing = district === 'tech' || district === 'harbor';
      if (wing || rand() < 0.35) {
        const p = pieces.pop();
        const alongX = wing ? x1 - x0 > z1 - z0 : rand() < 0.5;
        const lo = alongX ? p[0] : p[1], hi = alongX ? p[2] : p[3];
        const at = lo + (hi - lo) * (0.4 + rand() * 0.2), a0 = at - WIDTH[K.alley] / 2, a1 = at + WIDTH[K.alley] / 2;
        if (alongX) {
          this.alleys.push([a0, p[1], a1, p[3]]);
          pieces.push([p[0], p[1], a0, p[3], [1, 0, 1, 1]], [a1, p[1], p[2], p[3], [0, 1, 1, 1]]);
        } else {
          this.alleys.push([p[0], a0, p[2], a1]);
          pieces.push([p[0], p[1], p[2], a0, [1, 1, 1, 0]], [p[0], a1, p[2], p[3], [1, 1, 0, 1]]);
        }
      }
      for (const [a, b, c, d, streets] of pieces) this.blocks.push({ x0: a, z0: b, x1: c, z1: d, streets, district });
    };
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) add(gx(i), gx(i + 1), gx(j), gx(j + 1));
    const wz = [-352, -176, 0, 176, 352];
    for (const s of [-1, 1]) {
      const xsw = [s * CITY.C, ...CITY.wingX.map((x) => x * s)].sort((a, b) => a - b);
      for (let k = 0; k < xsw.length - 1; k++) for (let m = 0; m < wz.length - 1; m++) add(xsw[k], xsw[k + 1], wz[m], wz[m + 1]);
    }
  }

  fillBlock(b, rand) {
    const w = CITY.walk, gap = 0.6;
    const inner = [
      b.x0 + (b.streets[0] ? w : gap), b.z0 + (b.streets[2] ? w : gap),
      b.x1 - (b.streets[1] ? w : gap), b.z1 - (b.streets[3] ? w : gap),
    ];
    const maxLot = { down: 42, mid: 34, edge: 22, tech: 62, harbor: 72 }[b.district];
    const lots = [];
    const cut = (r) => {
      const W = r[2] - r[0], D = r[3] - r[1];
      if ((W <= maxLot && D <= maxLot) || (W < 20 && D < 20)) { lots.push(r); return; }
      const t = 0.35 + rand() * 0.3;
      if (W >= D) { const m = r[0] + W * t; cut([r[0], r[1], m, r[3]]); cut([m, r[1], r[2], r[3]]); }
      else { const m = r[1] + D * t; cut([r[0], r[1], r[2], m]); cut([r[0], m, r[2], r[3]]); }
    };
    cut(inner);
    for (const lot of lots) {
      if (b.district === 'harbor' && rand() < 0.45) this.addYard(lot, rand);
      else this.addBuilding(lot, inner, b, rand);
    }
  }

  addBuilding(lot, inner, block, rand) {
    const tight = block.district === 'tech' || block.district === 'harbor' ? 2.5 : 0.5;
    const s = tight + rand() * 1.2;
    let [x0, z0, x1, z1] = [lot[0] + s, lot[1] + s, lot[2] - s, lot[3] - s];
    // in town, buildings front right onto the sidewalk
    if (tight < 1) {
      if (Math.abs(lot[0] - inner[0]) < 0.01) x0 = lot[0];
      if (Math.abs(lot[2] - inner[2]) < 0.01) x1 = lot[2];
      if (Math.abs(lot[1] - inner[1]) < 0.01) z0 = lot[1];
      if (Math.abs(lot[3] - inner[3]) < 0.01) z1 = lot[3];
    }
    const W = x1 - x0, D = z1 - z0;
    if (W < 5 || D < 5) return;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const dist = block.district;
    let h, style, neon;
    const pick = (list) => list[Math.floor(rand() * list.length)];
    if (dist === 'down') {
      // the four blocks round the crossing stay lower, so their big screens show
      if (Math.abs(cx) < CITY.P && Math.abs(cz) < CITY.P) h = 22 + rand() * 26;
      else h = rand() < 0.7 ? 80 + rand() ** 1.6 * 180 : 40 + rand() * 40;
      style = h > 70 ? (rand() < 0.65 ? 2 : 0) : pick([0, 1, 3]);
      neon = Math.floor(rand() * NEON.length);
    } else if (dist === 'mid') {
      h = rand() < 0.08 ? 90 + rand() * 60 : 18 + rand() * 52;
      style = pick([0, 1, 1, 3]);
      neon = Math.floor(rand() * NEON.length);
    } else if (dist === 'edge') {
      h = 8 + rand() * 18;
      style = pick([1, 3, 3]);
      neon = Math.floor(rand() * NEON.length);
    } else if (dist === 'tech') {
      h = rand() < 0.07 && Math.min(W, D) > 14 ? 60 + rand() * 45 : 10 + rand() * 20;
      style = 4;
      neon = pick([1, 6, 4]);   // cyan, blue, green
    } else {
      h = 8 + rand() * 7;
      style = 5;
      neon = pick([2, 5]);      // amber, red-orange
    }
    if (Math.min(W, D) < 12) h = Math.min(h, 40);      // pencil buildings
    h = Math.max(2, Math.round(h / FLOOR)) * FLOOR + 1.2;
    const faces = [];
    if (x0 <= inner[0] + 0.01 || tight > 1) faces.push(['-x', block.streets[0]]);
    if (x1 >= inner[2] - 0.01 || tight > 1) faces.push(['+x', block.streets[1]]);
    if (z0 <= inner[1] + 0.01 || tight > 1) faces.push(['-z', block.streets[2]]);
    if (z1 >= inner[3] - 0.01 || tight > 1) faces.push(['+z', block.streets[3]]);
    const bld = { box: [x0, z0, x1, z1], h, style, seed: rand(), neon, tiers: [], faces, district: dist };
    if (h > 70 && W > 18 && D > 18) {
      const t1 = h * (0.45 + rand() * 0.2), i1 = Math.min(W, D) * (0.08 + rand() * 0.07);
      const t2 = h * (0.8 + rand() * 0.1), i2 = i1 + Math.min(W, D) * (0.07 + rand() * 0.06);
      bld.tiers.push([x0, z0, x1, z1, 0, t1], [x0 + i1, z0 + i1, x1 - i1, z1 - i1, t1, t2], [x0 + i2, z0 + i2, x1 - i2, z1 - i2, t2, h]);
    } else bld.tiers.push([x0, z0, x1, z1, 0, h]);
    this.buildings.push(bld);
    this.addSigns(bld, rand);
    if (dist !== 'tech' && dist !== 'harbor') this.addVending(bld, rand);
  }

  // A harbour container yard: rows of stacked boxes.
  addYard(lot, rand) {
    const [x0, z0, x1, z1] = [lot[0] + 3, lot[1] + 3, lot[2] - 3, lot[3] - 3];
    const alongX = x1 - x0 > z1 - z0;
    const L = 12.2, Wd = 2.44, gapRow = 3.5;
    const rows = Math.floor(((alongX ? z1 - z0 : x1 - x0) + gapRow) / (Wd * 2 + gapRow));
    const cols = Math.floor((alongX ? x1 - x0 : z1 - z0) / (L + 0.6));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (rand() < 0.12) continue;
        for (let k = 0; k < 2; k++) {
          const levels = 1 + Math.floor(rand() * 3);
          const u = (alongX ? x0 : z0) + c * (L + 0.6) + L / 2;
          const v = (alongX ? z0 : x0) + r * (Wd * 2 + gapRow) + k * Wd + Wd / 2;
          const x = alongX ? u : v, z = alongX ? v : u;
          const hx = (alongX ? L : Wd) / 2, hz = (alongX ? Wd : L) / 2;
          const colors = Array.from({ length: levels }, () => Math.floor(rand() * 6));
          this.containers.push({ x, z, alongX, levels, colors, box: [x - hx, z - hz, x + hx, z + hz] });
        }
      }
    }
  }

  // Neon on the street-facing sides: shop signs, blade signs sticking out
  // into the street, and big screens round the crossing and the Loop.
  addSigns(b, rand) {
    const [x0, z0, x1, z1] = b.box;
    const odds = {
      down: { band: 0.8, blade: 0.45, board: 0.9 }, mid: { band: 0.85, blade: 0.7, board: 0.25 },
      edge: { band: 0.9, blade: 0.75, board: 0.08 }, tech: { band: 0.35, blade: 0.08, board: 0.12 },
      harbor: { band: 0.15, blade: 0, board: 0.05 },
    }[b.district];
    for (const [face, street] of b.faces) {
      const along = face[1] === 'x' ? [z0, z1] : [x0, x1];
      const len = along[1] - along[0];
      const at = face === '-x' ? x0 : face === '+x' ? x1 : face === '-z' ? z0 : z1;
      const out = face[0] === '-' ? -1 : 1;
      const sign = (kind, u0, u1, y0, y1, extra = {}) => this.signs.push({
        kind, face, at: at + out * (kind === 'blade' ? 0 : 0.12), out, u0, u1, y0, y1,
        art: Math.floor(rand() * ART[kind]), phase: rand(), flicker: rand() < 0.06, ...extra,
      });
      if (b.h > 6 && len > 6 && rand() < odds.band * (street ? 1 : 0.5)) {
        const w = Math.min(len * (0.55 + rand() * 0.3), street ? 11 : 6), c = along[0] + len * (0.3 + rand() * 0.4);
        const u0 = Math.max(along[0] + 0.4, c - w / 2), u1 = Math.min(along[1] - 0.4, u0 + w);
        sign('band', u0, u1, 3.6, 3.6 + (u1 - u0) / 4.2);
      }
      if (b.h > 10 && rand() < odds.blade * (street ? 1 : 0.5)) {
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
      if (street && b.h > 28 && len > 16 && rand() < odds.board) {
        const w = Math.min(len * 0.8, 14 + rand() * 12), hgt = w * 0.56;
        const y0 = Math.min(b.h - hgt - 2, 10 + rand() * 18);
        if (y0 > 7) {
          const c = (along[0] + along[1]) / 2;
          sign('board', c - w / 2, c + w / 2, y0, y0 + hgt, { led: rand() < 0.55 });
        }
      }
    }
    if ((b.district === 'mid' || b.district === 'edge') && b.h > 12 && b.h < 40 && b.faces.some((f) => f[1]) && rand() < 0.18) {
      const [face] = b.faces.find((f) => f[1]);
      const along = face[1] === 'x' ? [z0, z1] : [x0, x1];
      const len = along[1] - along[0];
      const w = Math.min(len * 0.9, 9 + rand() * 6), c = (along[0] + along[1]) / 2;
      const at = face === '-x' ? x0 : face === '+x' ? x1 : face === '-z' ? z0 : z1;
      const out = face[0] === '-' ? -1 : 1;
      this.signs.push({ kind: 'board', face, at: at - out * 1.5, out, u0: c - w / 2, u1: c + w / 2, y0: b.h + 1.2, y1: b.h + 1.2 + w * 0.56, art: Math.floor(rand() * ART.board), phase: rand(), flicker: false, roof: true });
    }
  }

  addVending(b, rand) {
    for (const [face, street] of b.faces) {
      if (!street || rand() > 0.22) continue;
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

  // Street lights along every sidewalk that faces a street, and the promenade.
  makeLamps(rand) {
    const SP = 30, edge = CITY.kerb;
    for (const b of this.blocks) {
      const sides = [
        ['-x', b.x0 + 0.7, [b.z0 + 6, b.z1 - 6]], ['+x', b.x1 - 0.7, [b.z0 + 6, b.z1 - 6]],
        ['-z', b.z0 + 0.7, [b.x0 + 6, b.x1 - 6]], ['+z', b.z1 - 0.7, [b.x0 + 6, b.x1 - 6]],
      ];
      sides.forEach(([face, at, [a, c]], k) => {
        if (!b.streets[k] || c - a < 4) return;
        const n = Math.max(1, Math.round((c - a) / SP));
        for (let i = 0; i < n; i++) {
          const u = a + ((i + 0.5) / n) * (c - a);
          const out = face[0] === '-' ? -1 : 1;
          const warm = b.district === 'harbor' ? true : b.district === 'tech' ? false : rand() < 0.35;
          this.lamps.push(face[1] === 'x' ? { x: at, z: u, y: edge, dx: out, dz: 0, warm } : { x: u, z: at, y: edge, dx: 0, dz: out, warm });
        }
      });
    }
  }

  // Land, promenade, seawall and water, from the outline: the core square
  // plus the two wings.
  edges() {
    const E = CITY.coreEdge, WX = CITY.wingEdgeX, WZ = CITY.wingEdgeZ;
    const R = CITY.C + WIDTH[K.ring] / 2, WS = CITY.wingZ + WIDTH[K.side] / 2, WO = CITY.wingX[1] + WIDTH[K.side] / 2;
    this.land = [[-E, -E, E, E], [-WX, -WZ, -E, WZ], [E, -WZ, WX, WZ]];
    this.promenade = [
      [-E, R, E, E], [-E, -E, E, -R],                           // north and south of the core
      [-E, WZ, -R, R], [-E, -R, -R, -WZ], [R, WZ, E, R], [R, -R, E, -WZ],   // core sides beyond the wings
      [-WX, WS, -R, WZ], [-WX, -WZ, -R, -WS], [R, WS, WX, WZ], [R, -WZ, WX, -WS],   // wing tops and bottoms
      [-WX, -WS, -WO, WS], [WO, -WS, WX, WS],                   // wing ends
    ];
    const t = 1.2;
    this.walls = [
      [-E - t, E, E + t, E + t], [-E - t, -E - t, E + t, -E],
      [-E - t, WZ, -E, E], [-E - t, -E, -E, -WZ], [E, WZ, E + t, E], [E, -E, E + t, -WZ],
      [-WX - t, WZ, -E, WZ + t], [-WX - t, -WZ - t, -E, -WZ], [E, WZ, WX + t, WZ + t], [E, -WZ - t, WX + t, -WZ],
      [-WX - t, -WZ, -WX, WZ], [WX, -WZ, WX + t, WZ],
    ];
    // open water: every cell of the outline's grid that isn't land
    const F = 6000, bx = [-F, -WX, -E, E, WX, F], bz = [-F, -E, -WZ, WZ, E, F];
    this.water = [];
    for (let i = 0; i < bx.length - 1; i++) {
      for (let j = 0; j < bz.length - 1; j++) {
        const cx = (bx[i] + bx[i + 1]) / 2, cz = (bz[j] + bz[j + 1]) / 2;
        if (!this.land.some(([a, b, c, d]) => cx > a && cx < c && cz > b && cz < d)) this.water.push([bx[i], bz[j], bx[i + 1], bz[j + 1]]);
      }
    }
  }

  // ---- queries ---------------------------------------------------------------------

  // Kerb height on blocks and the promenade; the streets are everything else.
  heightAt(x, z) {
    const list = gridGet(this.groundGrid, x, z, this.hBuf || (this.hBuf = []), 0);
    for (const r of list) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return CITY.kerb;
    return 0;
  }

  boxesNear(x, z, out) { return gridGet(this.boxGrid, x, z, out, 1); }

  // street-light poles, as round obstacles (the shape the island's tree trunks use)
  trunksNear(x, z, out) {
    out.length = 0;
    const list = gridGet(this.poleGrid, x, z, this.poleBuf || (this.poleBuf = []), 1);
    for (const l of list) out.push({ x: l.x, z: l.z, r: 0.14 });
    return out;
  }
}

// ---- helpers ------------------------------------------------------------------------

const edgeKey = (i, j, i2, j2) => (i < i2 || (i === i2 && j < j2) ? `${i},${j}-${i2},${j2}` : `${i2},${j2}-${i},${j}`);
const segKey = (ax, az, bx, bz) => `${Math.round(ax)},${Math.round(az)}-${Math.round(bx)},${Math.round(bz)}`;

// Which part of town a point is in.
export function districtAt(x, z) {
  if (x < -CITY.C - 9) return 'harbor';
  if (x > CITY.C + 9) return 'tech';
  if (insideLoop(x, z)) return 'down';
  if (Math.abs(x) > CITY.C - CITY.P || Math.abs(z) > CITY.C - CITY.P) return 'edge';
  return 'mid';
}

const LOOP_XZ = LOOP.map(([i, j]) => [gx(i), gx(j)]);
export function insideLoop(x, z) {
  let inside = false;
  for (let i = 0, j = LOOP_XZ.length - 1; i < LOOP_XZ.length; j = i++) {
    const [xi, zi] = LOOP_XZ[i], [xj, zj] = LOOP_XZ[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
export { LOOP_XZ };

// Far-off towers across the bay: just for the skyline.
function makeSkyline(rand) {
  const out = [];
  for (let i = 0; i < 260; i++) {
    const a = rand() * Math.PI * 2, r = 950 + rand() * 900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const w = 20 + rand() * 45, d = 20 + rand() * 45;
    const h = 30 + rand() ** 2 * 240;
    out.push({ box: [x - w / 2, z - d / 2, x + w / 2, z + d / 2], h, style: Math.floor(rand() * 4), seed: rand(), neon: Math.floor(rand() * NEON.length), tiers: [[x - w / 2, z - d / 2, x + w / 2, z + d / 2, 0, h]], far: true });
  }
  return out;
}

// ---- spatial grid ---------------------------------------------------------------------

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
function gridGet(grid, x, z, out, reach) {
  out.length = 0;
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  for (let dz = -reach; dz <= reach; dz++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const a = grid.get((cx + dx) * 4096 + cz + dz);
      if (a) for (const it of a) if (!out.includes(it)) out.push(it);
    }
  }
  return out;
}

// ---- road graph for the GPS, resets and race routes ------------------------------------

// The streets as nodes (crossings) and edges (the street between two), in the
// same shape as the island's RoadNetwork so its routing code can be shared.
class CityNet {
  constructor(L) {
    this.L = L;
    this.nodes = L.nodes.map((n) => ({ id: n.id, x: n.x, z: n.z, y: 0, edges: [], disc: Math.max(n.hx, n.hz), kind: 1 }));
    this.edges = L.segs.map((s) => {
      const n = Math.max(2, Math.ceil(s.len / ROAD_STEP) + 1);
      const tx = (s.bx - s.ax) / s.len, tz = (s.bz - s.az) / s.len;
      const e = { id: s.id, a: s.a, b: s.b, n, length: s.len, half: s.hw, kind: 1, x: new Float32Array(n), z: new Float32Array(n), y: new Float32Array(n), tx: new Float32Array(n).fill(tx), tz: new Float32Array(n).fill(tz) };
      for (let i = 0; i < n; i++) {
        const d = Math.min(s.len, i * ROAD_STEP);
        e.x[i] = s.ax + tx * d;
        e.z[i] = s.az + tz * d;
      }
      this.nodes[s.a].edges.push(e.id);
      this.nodes[s.b].edges.push(e.id);
      return e;
    });
  }

  // Nearest point on a street centre line: { edgeDist, y, kind, x, z, tx, tz, edge, s }.
  nearestAnywhere(x, z) {
    let best = null;
    for (const s of this.L.segs) {
      const ex = s.bx - s.ax, ez = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / (s.len * s.len)));
      const px = s.ax + ex * t, pz = s.az + ez * t;
      const d = Math.hypot(x - px, z - pz) - s.hw;
      if (!best || d < best.edgeDist) best = { edgeDist: d, y: 0, kind: 1, x: px, z: pz, tx: ex / s.len, tz: ez / s.len, edge: s.id, s: t * s.len };
    }
    return best;
  }

  nearest(x, z, maxR = 30) {
    const n = this.nearestAnywhere(x, z);
    return n && n.edgeDist <= maxR ? n : null;
  }

  // edges for a walk through these nodes: [[edgeId, forward], ...]
  stepsThrough(nodeIds) {
    const steps = [];
    for (let k = 0; k < nodeIds.length - 1; k++) {
      const a = nodeIds[k], b = nodeIds[k + 1];
      const id = this.nodes[a].edges.find((e) => (this.edges[e].a === a && this.edges[e].b === b) || (this.edges[e].a === b && this.edges[e].b === a));
      if (id == null) throw new Error(`no street between nodes ${a} and ${b}`);
      steps.push([id, this.edges[id].a === a]);
    }
    return steps;
  }
}
CityNet.prototype.route = RoadNetwork.prototype.route;
CityNet.prototype.pathFromNodes = RoadNetwork.prototype.pathFromNodes;
CityNet.prototype.pointOnEdge = RoadNetwork.prototype.pointOnEdge;

// ---- race and Manhunt spots ----------------------------------------------------------------

// Spot ids in the city start here (the island's are 0, 1, 2...).
export const CITY_SPOT_BASE = 100;

// Hand-made courses that follow the map: round the Loop, round the ring road,
// a zigzag through downtown, and a dash from the Circuit District to the
// Harbor. Plus two Manhunt arenas.
function makeSpots(L) {
  const net = L.net;
  const N = (i, j) => L.nodeAt(gx(i), gx(j)).id;
  const W = (x, z) => L.nodeAt(x, z).id;
  const ring = [];
  for (let j = 5; j <= 10; j++) ring.push(N(0, j));
  for (let i = 1; i <= 10; i++) ring.push(N(i, 10));
  for (let j = 9; j >= 0; j--) ring.push(N(10, j));
  for (let i = 9; i >= 0; i--) ring.push(N(i, 0));
  for (let j = 1; j <= 5; j++) ring.push(N(0, j));
  const zig = [N(0, 9)];
  for (let k = 0; k < 9; k++) { zig.push(N(k + 1, 9 - k)); zig.push(N(k + 1, 8 - k)); }
  zig.push(N(10, 0));
  const dash = [W(750, -176), W(600, -176)];
  for (let i = 10; i >= 0; i--) dash.push(N(i, 3));
  dash.push(W(-600, -176), W(-750, -176), W(-750, 0), W(-750, 176), W(-600, 176), N(0, 7));
  const defs = [
    { name: 'Loop Grand Prix', mode: 'race', difficulty: 4, nodes: [...LOOP.map(([i, j]) => N(i, j)), N(...LOOP[0])] },
    { name: 'Ring Road Run', mode: 'race', difficulty: 3, nodes: ring },
    { name: 'Downtown Zigzag', mode: 'race', difficulty: 5, nodes: zig },
    { name: 'Circuit–Harbor Dash', mode: 'race', difficulty: 3, nodes: dash },
    { name: 'Scramble Square', mode: 'hunt', difficulty: 1, nodes: [N(5, 5), N(6, 5)] },
    { name: 'Circuit Yard', mode: 'hunt', difficulty: 2, nodes: [W(600, 0), W(750, 0)] },
  ];
  return defs.map((d, k) => {
    const steps = net.stepsThrough(d.nodes);
    const route = new Route(net, steps);
    const checkpoints = [];
    const spacing = Math.max(500, Math.min(900, route.length / 6));
    for (let s = spacing; s < route.length - spacing * 0.5; s += spacing) checkpoints.push(s);
    return {
      id: CITY_SPOT_BASE + k, node: d.nodes[0], steps, route, length: route.length, km: route.length / 1000,
      checkpoints, startS: 14, name: d.name, mode: d.mode, difficulty: d.difficulty,
      half: net.edges[steps[0][0]].half, city: true,
    };
  });
}

// ---- sign art --------------------------------------------------------------------------

// How many designs of each sign kind the atlas holds (see signs.js).
export const ART = { blade: 16, band: 24, board: 12 };

// Neon colours buildings and signs pick from.
export const NEON = ['#ff2e88', '#22e5ff', '#ffb000', '#9d5cff', '#39ff7a', '#ff4b2b', '#4d7cff', '#ff66d9'];
