import { createNoise2D, hashString, hash2, smoothstep, lerp } from './noise.js';
import { Road, ROAD_HALF_WIDTH as W } from './road.js';

// Pure terrain maths (no three.js), shared by the main thread (physics,
// grass, map) and the terrain worker (chunk meshes, tree placement). Same
// seed in, same world out — on every device.

export const CHUNK = 256;
const BLEND_IN = W + 1.6;   // flat shoulder ends here
const BLEND_OUT = W + 20;   // natural terrain fully resumes here

export const TREE_PINE = 0, TREE_BROAD = 1, TREE_BUSH = 2;
const TREE_CELL = 7;

export class TerrainGen {
  constructor(seed) {
    const s = hashString(String(seed));
    this.seedInt = s;
    this.nA = createNoise2D(s ^ 0x1a2b);
    this.nB = createNoise2D(s ^ 0x2b3c);
    this.nC = createNoise2D(s ^ 0x3c4d);
    this.nD = createNoise2D(s ^ 0x4d5e);
    this.nForest = createNoise2D(s ^ 0x5e6f);
    this.nMicro = createNoise2D(s ^ 0x6f70);
    this.road = new Road(String(seed), (x, z) => this.natural(x, z));
    this.road.ensureAround(0);
  }

  // Rolling hills: a few smooth octaves, no sharp ridges.
  natural(x, z) {
    return 26 * this.nA(x / 2600, z / 2600)
      + 34 * this.nB(x / 1100 + 13.1, z / 1100 - 7.7)
      + 12 * this.nC(x / 430 - 3.3, z / 430 + 9.2)
      + 3.5 * this.nD(x / 150, z / 150)
      + 0.35 * this.nMicro(x / 14, z / 14);
  }

  compose(x, z, near) {
    const t = this.natural(x, z);
    if (!near) return t;
    return lerp(near.y, t, smoothstep(BLEND_IN, BLEND_OUT, near.dist));
  }

  heightAt(x, z) {
    return this.compose(x, z, this.road.nearest(x, z, BLEND_OUT + 4));
  }

  normalAt(x, z, out) {
    const e = 1.0;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    let nx = hl - hr, ny = 2 * e, nz = hd - hu;
    const l = Math.hypot(nx, ny, nz);
    out.x = nx / l; out.y = ny / l; out.z = nz / l;
    return out;
  }

  roadDist(x, z, maxR = 40) {
    const n = this.road.nearest(x, z, maxR);
    return n ? n.dist : maxR + 1;
  }

  forestAmount(x, z) {
    const f = this.nForest(x / 520, z / 520) * 0.75 + this.nForest(x / 170 + 40, z / 170) * 0.25;
    return smoothstep(0.18, 0.42, f);
  }

  // ---- chunk generation (runs in the worker) ----------------------------

  // seg = quads per side. Returns typed arrays ready for a BufferGeometry,
  // plus tree instances. Normals come from the global height function, so
  // chunk borders shade seamlessly.
  buildChunk(cx, cz, seg) {
    const r = this.road;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const step = CHUNK / seg;
    const reach = BLEND_OUT + 8;
    r.ensureAround(oz + CHUNK / 2, 2500 + CHUNK);
    const cand = r.samplesInBox(ox - reach - step, oz - reach - step, ox + CHUNK + reach + step, oz + CHUNK + reach + step);
    const nearOf = (x, z) => {
      if (!cand.length) return null;
      let bestK = 0, best = Infinity;
      for (let i = 0; i < cand.length; i++) {
        const d = r.dense(cand[i]);
        const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
        if (dd < best) { best = dd; bestK = cand[i]; }
      }
      if (best > (reach + 4) ** 2) return null;
      return r.refine(bestK, x, z, reach);
    };

    // heights on an (N+2)^2 grid with a 1-cell border for central-difference normals
    const N = seg + 1, G = N + 2;
    const H = new Float32Array(G * G);
    const D = new Float32Array(G * G);
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const x = ox + (i - 1) * step, z = oz + (j - 1) * step;
        const near = nearOf(x, z);
        H[j * G + i] = this.compose(x, z, near);
        D[j * G + i] = near ? near.dist : 999;
      }
    }

    const skirt = 4 * N;
    const count = N * N + skirt;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const road = new Float32Array(count);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const g = (j + 1) * G + (i + 1);
        const v = j * N + i;
        pos[v * 3] = ox + i * step;
        pos[v * 3 + 1] = H[g];
        pos[v * 3 + 2] = oz + j * step;
        let nx = H[g - 1] - H[g + 1], ny = 2 * step, nz = H[g - G] - H[g + G];
        const l = Math.hypot(nx, ny, nz);
        nor[v * 3] = nx / l; nor[v * 3 + 1] = ny / l; nor[v * 3 + 2] = nz / l;
        road[v] = D[g];
      }
    }
    // skirts: copies of edge vertices pushed down, hiding cracks between LODs
    const drop = step * 1.5 + 2;
    const edges = [];
    for (let i = 0; i < N; i++) edges.push(i);                 // j = 0
    for (let i = 0; i < N; i++) edges.push((N - 1) * N + i);   // j = N-1
    for (let j = 0; j < N; j++) edges.push(j * N);             // i = 0
    for (let j = 0; j < N; j++) edges.push(j * N + N - 1);     // i = N-1
    edges.forEach((src, k) => {
      const v = N * N + k;
      pos[v * 3] = pos[src * 3];
      pos[v * 3 + 1] = pos[src * 3 + 1] - drop;
      pos[v * 3 + 2] = pos[src * 3 + 2];
      nor.set(nor.subarray(src * 3, src * 3 + 3), v * 3);
      road[v] = road[src];
    });

    return { pos, nor, road, trees: this.chunkTrees(ox, oz, H, G, step) };
  }

  // The tree (if any) living in placement cell (gx, gz). Deterministic, so the
  // worker can draw it and the physics can collide with it independently.
  treeInCell(gx, gz) {
    const seed = this.seedInt;
    const x = (gx + 0.1 + hash2(gx, gz, seed + 1) * 0.8) * TREE_CELL;
    const z = (gz + 0.1 + hash2(gx, gz, seed + 2) * 0.8) * TREE_CELL;
    const forest = this.forestAmount(x, z);
    const r0 = hash2(gx, gz, seed + 3);
    let type = -1;
    if (r0 < forest * 0.62) type = hash2(gx, gz, seed + 4) < 0.8 ? TREE_PINE : TREE_BROAD;
    else if (r0 > 0.9965) type = TREE_BROAD;            // lone field trees
    else if (r0 > 0.975 && forest < 0.2) type = TREE_BUSH; // heather / scrub
    else if (forest > 0.05 && forest < 0.5 && r0 > 0.9) type = TREE_BUSH; // forest fringe
    if (type < 0) return null;
    const near = this.road.nearest(x, z, W + 9);
    if (near && near.dist < W + (type === TREE_BUSH ? 4 : 8)) return null;
    const sc = type === TREE_PINE ? 0.75 + hash2(gx, gz, seed + 5) * 0.75
      : type === TREE_BROAD ? 0.8 + hash2(gx, gz, seed + 5) * 0.6
        : 0.6 + hash2(gx, gz, seed + 5) * 0.9;
    return { x, z, type, sc, rot: hash2(gx, gz, seed + 6) * Math.PI * 2 };
  }

  // Trunks the bike could hit near (x, z): [{x, z, r}]
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
    // every cell whose index falls in this chunk's span, so each is drawn exactly once
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
}
