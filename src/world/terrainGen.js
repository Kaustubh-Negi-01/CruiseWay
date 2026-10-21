import { createNoise2D, hashString, hash2, smoothstep, lerp } from './noise.js';
import { RoadNetwork, KIND_PAVED, KIND_DIRT } from './network.js';
import { buildSpots } from './spots.js';

// Pure terrain maths (no three.js), shared by the main thread (physics,
// grass, map) and the terrain worker (chunk meshes, tree placement, map
// image). Same seed in, same island out — on every device.

export const CHUNK = 256;
export const ISLAND_R = 3900;      // rough coastline radius
export const MAP_EXTENT = 4700;    // half-size of the area the map shows
export const SEA_LEVEL = 0;
const BLEND_IN = 1.6;              // flat shoulder beyond the road edge
const BLEND_OUT = 20;              // natural terrain fully resumes here

export const TREE_PINE = 0, TREE_BROAD = 1, TREE_BUSH = 2;
const TREE_CELL = 7;

export class TerrainGen {
  constructor(seed) {
    const s = hashString(String(seed));
    this.seed = String(seed);
    this.seedInt = s;
    this.nA = createNoise2D(s ^ 0x1a2b);
    this.nB = createNoise2D(s ^ 0x2b3c);
    this.nC = createNoise2D(s ^ 0x3c4d);
    this.nD = createNoise2D(s ^ 0x4d5e);
    this.nForest = createNoise2D(s ^ 0x5e6f);
    this.nMicro = createNoise2D(s ^ 0x6f70);
    this.nCoast = createNoise2D(s ^ 0x7081);
    this.net = new RoadNetwork(this.seed, (x, z) => this.land(x, z), (x, z) => this.inland(x, z), ISLAND_R - 500);
    this.spots = buildSpots(this.net, this.seed);
  }

  // Rolling hills: a few smooth octaves, no sharp ridges.
  natural(x, z) {
    return 26 * this.nA(x / 2600, z / 2600)
      + 34 * this.nB(x / 1100 + 13.1, z / 1100 - 7.7)
      + 12 * this.nC(x / 430 - 3.3, z / 430 + 9.2)
      + 3.5 * this.nD(x / 150, z / 150)
      + 0.35 * this.nMicro(x / 14, z / 14);
  }

  // 1 well inland, falling to 0 out at sea, with a ragged coastline.
  inland(x, z) {
    const r = Math.hypot(x, z);
    const edge = ISLAND_R + 420 * this.nCoast(x / 1500, z / 1500) + 140 * this.nCoast(x / 420 + 9, z / 420 - 3);
    return smoothstep(edge + 150, edge - 750, r);
  }

  // Terrain before any road shaping: hills inland, sloping into the sea.
  land(x, z) {
    const m = this.inland(x, z);
    if (m <= 0) return -30;
    return lerp(-30, 40 + this.natural(x, z), m);
  }

  compose(x, z, near) {
    const t = this.land(x, z);
    if (!near) return t;
    return lerp(near.y, t, smoothstep(BLEND_IN, BLEND_OUT, near.edgeDist));
  }

  nearRoad(x, z) { return this.net.nearest(x, z, BLEND_OUT + 2); }

  heightAt(x, z) {
    return this.compose(x, z, this.nearRoad(x, z));
  }

  normalAt(x, z, out) {
    const e = 1.0;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    const nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  // 0 off-road, KIND_PAVED or KIND_DIRT when on a road surface
  surfaceAt(x, z) {
    const n = this.net.nearest(x, z, 1);
    return n && n.edgeDist < 0.3 ? n.kind : 0;
  }

  forestAmount(x, z) {
    const f = this.nForest(x / 520, z / 520) * 0.75 + this.nForest(x / 170 + 40, z / 170) * 0.25;
    return smoothstep(0.18, 0.42, f);
  }

  // ---- chunk generation (runs in the worker) ----------------------------

  buildChunk(cx, cz, seg) {
    const net = this.net;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const step = CHUNK / seg;
    const pad = BLEND_OUT + 8 + step;
    const cand = net.entriesInBox(ox - pad - 6, oz - pad - 6, ox + CHUNK + pad + 6, oz + CHUNK + pad + 6);
    const nearOf = (x, z) => {
      if (!cand.length) return null;
      const b = net.scan(cand, x, z);
      return b && b.edgeDist <= BLEND_OUT + 2 ? b : null;
    };

    const N = seg + 1, G = N + 2;
    const H = new Float32Array(G * G);
    const D = new Float32Array(G * G);
    const K = new Uint8Array(G * G);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const x = ox + (i - 1) * step, z = oz + (j - 1) * step;
        const near = nearOf(x, z);
        H[j * G + i] = this.compose(x, z, near);
        D[j * G + i] = near ? near.edgeDist : 99;
        K[j * G + i] = near ? near.kind : 0;
      }
    }

    const skirt = 4 * N;
    const count = N * N + skirt;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const road = new Float32Array(count);
    const kind = new Float32Array(count);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const g = (j + 1) * G + (i + 1);
        const v = j * N + i;
        pos[v * 3] = ox + i * step;
        pos[v * 3 + 1] = H[g];
        pos[v * 3 + 2] = oz + j * step;
        const nx = H[g - 1] - H[g + 1], ny = 2 * step, nz = H[g - G] - H[g + G];
        const l = Math.hypot(nx, ny, nz);
        nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
        road[v] = D[g];
        kind[v] = K[g];
      }
    }
    const drop = step * 1.5 + 2;
    const edges = [];
    for (let i = 0; i < N; i++) edges.push(i);
    for (let i = 0; i < N; i++) edges.push((N - 1) * N + i);
    for (let j = 0; j < N; j++) edges.push(j * N);
    for (let j = 0; j < N; j++) edges.push(j * N + N - 1);
    edges.forEach((src, k) => {
      const v = N * N + k;
      pos[v * 3] = pos[src * 3];
      pos[v * 3 + 1] = pos[src * 3 + 1] - drop;
      pos[v * 3 + 2] = pos[src * 3 + 2];
      nor.set(nor.subarray(src * 3, src * 3 + 3), v * 3);
      road[v] = road[src];
      kind[v] = kind[src];
    });

    return { pos, nor, road, kind, trees: this.chunkTrees(ox, oz, H, G, step) };
  }

  // The tree (if any) living in placement cell (gx, gz). Deterministic, so the
  // worker can draw it and the physics can collide with it independently.
  treeInCell(gx, gz) {
    const key = (gx + 32768) * 65536 + (gz + 32768);
    const cache = this.treeCache || (this.treeCache = new Map());
    let t = cache.get(key);
    if (t !== undefined) return t;
    if (cache.size > 30000) cache.clear();
    t = this.computeTree(gx, gz);
    cache.set(key, t);
    return t;
  }

  computeTree(gx, gz) {
    const seed = this.seedInt;
    const x = (gx + 0.1 + hash2(gx, gz, seed + 1) * 0.8) * TREE_CELL;
    const z = (gz + 0.1 + hash2(gx, gz, seed + 2) * 0.8) * TREE_CELL;
    if (this.inland(x, z) < 0.6) return null;
    const forest = this.forestAmount(x, z);
    const r0 = hash2(gx, gz, seed + 3);
    let type = -1;
    if (r0 < forest * 0.62) type = hash2(gx, gz, seed + 4) < 0.8 ? TREE_PINE : TREE_BROAD;
    else if (r0 > 0.9965) type = TREE_BROAD;
    else if (r0 > 0.975 && forest < 0.2) type = TREE_BUSH;
    else if (forest > 0.05 && forest < 0.5 && r0 > 0.9) type = TREE_BUSH;
    if (type < 0) return null;
    if (this.land(x, z) < 3) return null; // no trees on beaches or in lakes
    const near = this.net.nearest(x, z, 10);
    if (near && near.edgeDist < (type === TREE_BUSH ? 2.5 : 5)) return null;
    const sc = type === TREE_PINE ? 0.75 + hash2(gx, gz, seed + 5) * 0.75
      : type === TREE_BROAD ? 0.8 + hash2(gx, gz, seed + 5) * 0.6
        : 0.6 + hash2(gx, gz, seed + 5) * 0.9;
    return { x, z, type, sc, rot: hash2(gx, gz, seed + 6) * Math.PI * 2 };
  }

  trunksNear(x, z, out = []) {
    out.length = 0;
    const cx = Math.floor(x / TREE_CELL), cz = Math.floor(z / TREE_CELL);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.treeInCell(cx + dx, cz + dz);
        if (t && t.type !== TREE_BUSH) out.push({ x: t.x, z: t.z, r: (t.type === TREE_PINE ? 0.3 : 0.45) * t.sc });
      }
    }
    return out;
  }

  chunkTrees(ox, oz, H, G, step) {
    const out = [];
    const sampleH = (x, z) => {
      const fi = (x - ox) / step + 1, fj = (z - oz) / step + 1;
      const i = Math.min(G - 2, Math.max(0, Math.floor(fi))), j = Math.min(G - 2, Math.max(0, Math.floor(fj)));
      const ti = fi - i, tj = fj - j;
      const a = H[j * G + i], b = H[j * G + i + 1], c = H[(j + 1) * G + i], d = H[(j + 1) * G + i + 1];
      return lerp(lerp(a, b, ti), lerp(c, d, ti), tj);
    };
    const g0x = Math.floor(ox / TREE_CELL), g1x = Math.floor((ox + CHUNK) / TREE_CELL);
    const g0z = Math.floor(oz / TREE_CELL), g1z = Math.floor((oz + CHUNK) / TREE_CELL);
    for (let gz = g0z; gz < g1z; gz++) {
      for (let gx = g0x; gx < g1x; gx++) {
        const t = this.treeInCell(gx, gz);
        if (!t) continue;
        out.push(t.x, sampleH(t.x, t.z) - 0.2, t.z, t.sc, t.rot, t.type);
      }
    }
    return new Float32Array(out);
  }

  // ---- map image (runs in the worker) -------------------------------------

  // Satellite-style colour image of the island: hill-shaded terrain, forests,
  // beaches and sea. Roads are drawn on top as vectors by the map view.
  mapImage(size) {
    const px = new Uint8ClampedArray(size * size * 4);
    const H = new Float32Array(size * size);
    const m = (MAP_EXTENT * 2) / size;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        // image +x = world -x (map is not mirrored), image +y = world -z
        const x = MAP_EXTENT - (i + 0.5) * m, z = MAP_EXTENT - (j + 0.5) * m;
        H[j * size + i] = this.land(x, z);
      }
    }
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = j * size + i;
        const h = H[k];
        const x = MAP_EXTENT - (i + 0.5) * m, z = MAP_EXTENT - (j + 0.5) * m;
        let r, g, b;
        if (h < SEA_LEVEL) {
          const d = Math.min(1, -h / 22);
          r = lerp(64, 18, d); g = lerp(170, 72, d); b = lerp(178, 110, d);
        } else {
          const dry = smoothstep(-0.2, 0.6, this.nA(x / 900 + 5, z / 900));
          r = lerp(96, 150, dry); g = lerp(122, 138, dry); b = lerp(52, 70, dry);
          const forest = this.forestAmount(x, z);
          r = lerp(r, 38, forest * 0.85); g = lerp(g, 66, forest * 0.85); b = lerp(b, 36, forest * 0.85);
          const sand = 1 - smoothstep(1.5, 4.5, h);
          r = lerp(r, 214, sand); g = lerp(g, 196, sand); b = lerp(b, 150, sand);
          // hill shade, light from the north-west
          const hl = H[j * size + Math.max(0, i - 1)], hr = H[j * size + Math.min(size - 1, i + 1)];
          const hu = H[Math.max(0, j - 1) * size + i], hd = H[Math.min(size - 1, j + 1) * size + i];
          const shade = 1 + ((hr - hl) * 0.6 + (hd - hu) * 0.6) / m * 0.9;
          const sc = Math.max(0.55, Math.min(1.35, shade));
          r *= sc; g *= sc; b *= sc;
        }
        px[k * 4] = r; px[k * 4 + 1] = g; px[k * 4 + 2] = b; px[k * 4 + 3] = 255;
      }
    }
    return px;
  }
}

export { KIND_PAVED, KIND_DIRT };
