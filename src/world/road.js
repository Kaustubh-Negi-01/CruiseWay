import { createNoise2D, hashString, clamp } from './noise.js';

// One endless winding road, generated outward from the origin in both
// directions. Generation is strictly sequential from index 0, so it is
// identical for every player regardless of where or in what order they explore.
//
// The road keeps a general heading of +z (heading mean-reverts to 0), which
// means "how far along" a point is maps roughly to its z coordinate. We use
// that to decide how much road must exist around a given position.

export const ROAD_HALF_WIDTH = 4.6;
const SEG = 30;        // spacing of control points (m)
const STEP = 3;        // spacing of dense samples (m)
const PER_SEG = SEG / STEP;
const CELL = 32;       // spatial grid cell (m)

// Road elevation is the natural terrain height under the road, low-pass
// filtered along its length (Gaussian over ±180 m of control points). That
// lets the road ride along hillsides with gentle grades, and the terrain is
// cut/filled only in a narrow band beside it.
const Y_WINDOW = 6;
const Y_WEIGHTS = Array.from({ length: Y_WINDOW * 2 + 1 }, (_, j) => Math.exp(-(((j - Y_WINDOW) / 3.2) ** 2)));
const Y_WSUM = Y_WEIGHTS.reduce((a, b) => a + b, 0);

export class Road {
  constructor(seed, heightAt) {
    this.noise = createNoise2D(hashString(seed + ':road'));
    this.heightAt = heightAt; // natural terrain height (before road shaping)
    this.ctrlYCache = new Map();
    // control points: index i >= 0 in fwd[i], index -i in back[i] (back[0] unused)
    this.fwd = [{ x: 0, z: 0, h: 0 }];
    this.back = [null];
    // dense samples by integer k (s = k * STEP)
    this.denseF = [];
    this.denseB = [null];
    this.grid = new Map();
    this.minZ = 0;
    this.maxZ = 0;
  }

  turn(i, h) {
    const n = this.noise;
    const c = n(i * 0.045, 0.5) * 0.11 + n(i * 0.16, 7.3) * 0.05;
    return clamp(c - h * 0.035, -0.13, 0.13);
  }

  ctrl(i) {
    if (i >= 0) {
      while (this.fwd.length <= i) {
        const j = this.fwd.length - 1;
        const p = this.fwd[j];
        const h = clamp(p.h + this.turn(j, p.h), -1.1, 1.1);
        this.fwd.push({ x: p.x + Math.sin(h) * SEG, z: p.z + Math.cos(h) * SEG, h });
      }
      return this.fwd[i];
    }
    const k = -i;
    while (this.back.length <= k) {
      const j = this.back.length - 1;
      const p = j === 0 ? this.fwd[0] : this.back[j];
      const h = clamp(p.h - this.turn(-j - 1, p.h), -1.1, 1.1);
      this.back.push({ x: p.x - Math.sin(h) * SEG, z: p.z - Math.cos(h) * SEG, h });
    }
    return this.back[k];
  }

  ctrlY(i) {
    let y = this.ctrlYCache.get(i);
    if (y === undefined) {
      y = 0;
      for (let j = -Y_WINDOW; j <= Y_WINDOW; j++) {
        const c = this.ctrl(i + j);
        y += this.heightAt(c.x, c.z) * Y_WEIGHTS[j + Y_WINDOW];
      }
      y /= Y_WSUM;
      this.ctrlYCache.set(i, y);
    }
    return y;
  }

  // Catmull-Rom between control points i and i+1
  sampleCtrl(i, t) {
    const p0 = this.ctrl(i - 1), p1 = this.ctrl(i), p2 = this.ctrl(i + 1), p3 = this.ctrl(i + 2);
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, d) =>
      0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    const df = (a, b, c, d) =>
      0.5 * ((-a + c) + 2 * (2 * a - 5 * b + 4 * c - d) * t + 3 * (-a + 3 * b - 3 * c + d) * t2);
    const x = f(p0.x, p1.x, p2.x, p3.x), z = f(p0.z, p1.z, p2.z, p3.z);
    let tx = df(p0.x, p1.x, p2.x, p3.x), tz = df(p0.z, p1.z, p2.z, p3.z);
    const l = Math.hypot(tx, tz) || 1;
    const y = f(this.ctrlY(i - 1), this.ctrlY(i), this.ctrlY(i + 1), this.ctrlY(i + 2));
    return { x, z, y, tx: tx / l, tz: tz / l };
  }

  makeDense(k) {
    const i = Math.floor(k / PER_SEG);
    const t = (k - i * PER_SEG) / PER_SEG;
    const d = this.sampleCtrl(i, t);
    d.k = k;
    d.s = k * STEP;
    const key = cellKey(d.x, d.z);
    let arr = this.grid.get(key);
    if (!arr) this.grid.set(key, (arr = []));
    arr.push(k);
    if (d.z < this.minZ) this.minZ = d.z;
    if (d.z > this.maxZ) this.maxZ = d.z;
    return d;
  }

  dense(k) {
    if (k >= 0) {
      while (this.denseF.length <= k) this.denseF.push(this.makeDense(this.denseF.length));
      return this.denseF[k];
    }
    while (this.denseB.length <= -k) this.denseB.push(this.makeDense(-this.denseB.length));
    return this.denseB[-k];
  }

  get minK() { return -(this.denseB.length - 1); }
  get maxK() { return this.denseF.length - 1; }

  // Make sure road exists for everything within `margin` metres (in z) of z.
  ensureAround(z, margin = 2500) {
    let guard = 0;
    while (this.maxZ < z + margin && guard++ < 20000) this.dense(this.maxK + 1);
    guard = 0;
    while (this.minZ > z - margin && guard++ < 20000) this.dense(this.minK - 1);
  }

  // Point on the road at distance s (m) — s may be negative.
  at(s) {
    const kf = s / STEP;
    const k0 = Math.floor(kf);
    const a = this.dense(k0), b = this.dense(k0 + 1);
    const t = kf - k0;
    const tx = a.tx + (b.tx - a.tx) * t, tz = a.tz + (b.tz - a.tz) * t;
    const l = Math.hypot(tx, tz) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      z: a.z + (b.z - a.z) * t,
      y: a.y + (b.y - a.y) * t,
      tx: tx / l, tz: tz / l, s,
    };
  }

  // Nearest road point within ~maxR metres, or null.
  nearest(x, z, maxR = 70) {
    const r = Math.ceil(maxR / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let bestK = null, bestD = Infinity;
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const arr = this.grid.get((cx + dx) + ',' + (cz + dz));
        if (!arr) continue;
        for (let n = 0; n < arr.length; n++) {
          const d = this.dense(arr[n]);
          const dd = (d.x - x) * (d.x - x) + (d.z - z) * (d.z - z);
          if (dd < bestD) { bestD = dd; bestK = arr[n]; }
        }
      }
    }
    if (bestK === null) return null;
    return this.refine(bestK, x, z, maxR);
  }

  // Project onto the segments either side of sample k.
  refine(k, x, z, maxR = Infinity) {
    let best = null;
    for (const k0 of [k - 1, k]) {
      if (k0 < this.minK || k0 + 1 > this.maxK) continue;
      const a = this.dense(k0), b = this.dense(k0 + 1);
      const ex = b.x - a.x, ez = b.z - a.z;
      const len2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - a.x) * ex + (z - a.z) * ez) / len2, 0, 1);
      const px = a.x + ex * t, pz = a.z + ez * t;
      const dist = Math.hypot(x - px, z - pz);
      if (!best || dist < best.dist) {
        best = {
          dist, x: px, z: pz,
          y: a.y + (b.y - a.y) * t,
          s: (k0 + t) * STEP,
          tx: a.tx, tz: a.tz,
        };
      }
    }
    if (!best) {
      const d = this.dense(k);
      best = { dist: Math.hypot(x - d.x, z - d.z), x: d.x, z: d.z, y: d.y, s: d.s, tx: d.tx, tz: d.tz };
    }
    return best.dist <= maxR ? best : null;
  }

  // Nearest road point anywhere (used for resets and map clicks).
  nearestAnywhere(x, z) {
    const close = this.nearest(x, z, 140);
    if (close) return close;
    this.ensureAround(z, 3000);
    let bestK = 0, bestD = Infinity;
    for (let k = this.minK; k <= this.maxK; k += 4) {
      const d = this.dense(k);
      const dd = (d.x - x) ** 2 + (d.z - z) ** 2;
      if (dd < bestD) { bestD = dd; bestK = k; }
    }
    for (let k = bestK - 4; k <= bestK + 4; k++) {
      if (k < this.minK || k > this.maxK) continue;
      const d = this.dense(k);
      const dd = (d.x - x) ** 2 + (d.z - z) ** 2;
      if (dd <= bestD) { bestD = dd; bestK = k; }
    }
    return this.refine(bestK, x, z);
  }

  // Dense sample indices whose points lie inside the given box.
  samplesInBox(minX, minZ, maxX, maxZ) {
    const out = [];
    const c0x = Math.floor(minX / CELL), c1x = Math.floor(maxX / CELL);
    const c0z = Math.floor(minZ / CELL), c1z = Math.floor(maxZ / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const arr = this.grid.get(cx + ',' + cz);
        if (arr) for (const k of arr) out.push(k);
      }
    }
    return out;
  }
}

function cellKey(x, z) {
  return Math.floor(x / CELL) + ',' + Math.floor(z / CELL);
}

export { STEP as ROAD_STEP };
