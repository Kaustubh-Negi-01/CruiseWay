import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createNoise2D, hashString, hash2, smoothstep, lerp } from './noise.js';
import { Road, ROAD_HALF_WIDTH as W, ROAD_STEP } from './road.js';
import { BIOMES } from './settings.js';

const CHUNK = 160;
const RES = 40;               // quads per chunk side (4 m)
const VIEW_CHUNKS = 4;        // radius in chunks
const ROAD_PIECE = 64;        // dense samples per road mesh
const NEAR_R = 90;            // how far the road shapes the terrain

export class World {
  constructor(scene, settings) {
    this.scene = scene;
    this.settings = settings;
    this.biome = BIOMES[settings.biome];
    const seed = hashString(settings.seed);
    this.nBase = createNoise2D(seed ^ 0x1234);
    this.nBase2 = createNoise2D(seed ^ 0x2345);
    this.nRidge = createNoise2D(seed ^ 0x3456);
    this.nMask = createNoise2D(seed ^ 0x4567);
    this.nHill = createNoise2D(seed ^ 0x5678);
    this.nColor = createNoise2D(seed ^ 0x6789);
    this.seedInt = seed;
    this.road = new Road(settings.seed, (x, z) => this.base(x, z));
    this.road.ensureAround(0);

    this.chunks = new Map();
    this.roadPieces = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);

    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    this.roadMat = new THREE.MeshLambertMaterial({
      map: makeRoadTexture(settings.biome),
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.treeGeos = makeTreeGeometries();
    this.treeMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  }

  base(x, z) {
    return 30 * this.nBase(x / 2200, z / 2200) + 7 * this.nBase2(x / 750, z / 750);
  }

  detail(x, z) {
    const b = this.biome;
    const ridge = 1 - Math.abs(this.nRidge(x / 650, z / 650));
    const mMask = smoothstep(-0.3, 0.6, this.nMask(x / 2600, z / 2600));
    return b.mountain * ridge * ridge * mMask
      + b.hill * this.nHill(x / 160, z / 160)
      + 1.3 * this.nHill(x / 27 + 50, z / 27);
  }

  // Combine base terrain with the road corridor. `near` is the road point.
  compose(x, z, near) {
    const base = this.base(x, z);
    if (!near) return base + this.detail(x, z);
    const d = near.dist;
    const terrain = base + this.detail(x, z) * smoothstep(W + 3, NEAR_R, d);
    return lerp(near.y, terrain, smoothstep(W + 2, W + 13, d));
  }

  heightAt(x, z) {
    return this.compose(x, z, this.road.nearest(x, z, NEAR_R));
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.2;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  isOnRoad(x, z) {
    const n = this.road.nearest(x, z, W + 1);
    return !!n && n.dist < W + 0.6;
  }

  // ---- streaming ------------------------------------------------------

  update(focus) {
    this.road.ensureAround(focus.z);
    const cx = Math.floor(focus.x / CHUNK), cz = Math.floor(focus.z / CHUNK);
    // build the nearest missing chunk(s) each frame
    let built = 0;
    const wanted = new Set();
    const order = [];
    for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
      for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
        if (dx * dx + dz * dz > (VIEW_CHUNKS + 0.5) ** 2) continue;
        const key = (cx + dx) + ',' + (cz + dz);
        wanted.add(key);
        if (!this.chunks.has(key)) order.push([dx * dx + dz * dz, cx + dx, cz + dz, key]);
      }
    }
    order.sort((a, b) => a[0] - b[0]);
    for (const [, x, z, key] of order) {
      if (built >= (this.chunks.size < 9 ? 9 : 1)) break;
      this.chunks.set(key, this.buildChunk(x, z));
      built++;
    }
    for (const [key, c] of this.chunks) {
      if (!wanted.has(key)) {
        this.group.remove(c);
        c.traverse((o) => { if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
        this.chunks.delete(key);
      }
    }
    this.updateRoad(focus);
  }

  // Build everything near a point immediately (used for spawns / race starts).
  preload(x, z) {
    this.road.ensureAround(z);
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const key = (cx + dx) + ',' + (cz + dz);
      if (!this.chunks.has(key)) this.chunks.set(key, this.buildChunk(cx + dx, cz + dz));
    }
    this.updateRoad({ x, z });
  }

  updateRoad(focus) {
    const r = this.road;
    const p0 = Math.floor(r.minK / ROAD_PIECE), p1 = Math.floor((r.maxK - 1) / ROAD_PIECE);
    const R2 = (VIEW_CHUNKS * CHUNK + 150) ** 2;
    for (let p = p0; p <= p1; p++) {
      const kMid = Math.min(Math.max(p * ROAD_PIECE + ROAD_PIECE / 2, r.minK), r.maxK);
      const d = r.dense(kMid);
      const near = (d.x - focus.x) ** 2 + (d.z - focus.z) ** 2 < R2;
      const has = this.roadPieces.has(p);
      if (near && !has) {
        const k0 = Math.max(p * ROAD_PIECE, r.minK), k1 = Math.min(p * ROAD_PIECE + ROAD_PIECE, r.maxK);
        if (k1 - k0 < 2) continue;
        const mesh = this.buildRoadPiece(k0, k1);
        this.roadPieces.set(p, mesh);
        this.group.add(mesh);
      } else if (!near && has) {
        const m = this.roadPieces.get(p);
        this.group.remove(m);
        m.geometry.dispose();
        this.roadPieces.delete(p);
      }
    }
  }

  buildRoadPiece(k0, k1) {
    const r = this.road;
    const n = k1 - k0 + 1;
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx = [];
    for (let i = 0; i < n; i++) {
      const d = r.dense(k0 + i);
      const nx = -d.tz, nz = d.tx;
      const y = d.y + 0.08;
      pos.set([d.x + nx * W, y, d.z + nz * W, d.x - nx * W, y, d.z - nz * W], i * 6);
      const v = d.s / 24;
      uv.set([0, v, 1, v], i * 4);
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.roadMat);
    m.receiveShadow = true;
    return m;
  }

  buildChunk(cx, cz) {
    const b = this.biome;
    const ox = cx * CHUNK, oz = cz * CHUNK;
    const r = this.road;
    // Road samples that can affect this chunk, so each vertex only checks a few.
    const cand = r.samplesInBox(ox - NEAR_R, oz - NEAR_R, ox + CHUNK + NEAR_R, oz + CHUNK + NEAR_R);
    const nearOf = (x, z) => {
      if (!cand.length) return null;
      let bestK = 0, best = Infinity;
      for (let i = 0; i < cand.length; i++) {
        const d = r.dense(cand[i]);
        const dd = (d.x - x) ** 2 + (d.z - z) ** 2;
        if (dd < best) { best = dd; bestK = cand[i]; }
      }
      if (best > (NEAR_R + 6) ** 2) return null;
      return r.refine(bestK, x, z, NEAR_R);
    };

    const N = RES + 1;
    const step = CHUNK / RES;
    const heights = new Float32Array(N * N);
    const dists = new Float32Array(N * N);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = ox + i * step, z = oz + j * step;
        const near = nearOf(x, z);
        heights[j * N + i] = this.compose(x, z, near);
        dists[j * N + i] = near ? near.dist : 1e9;
      }
    }

    // Non-indexed flat-shaded triangles with per-face colour.
    const pos = new Float32Array(RES * RES * 6 * 3);
    const col = new Float32Array(RES * RES * 6 * 3);
    const c = new THREE.Color();
    const ground = b.ground.map((h) => new THREE.Color(h));
    const rock = new THREE.Color(b.rock), high = new THREE.Color(b.high);
    const gravel = new THREE.Color(b.ground === BIOMES.desert.ground ? 0xb89a72 : 0x8c8576);
    let p = 0;
    const tri = (ax, az, ay, bx, bz, by, qx, qz, qy, dmin) => {
      const mx = (ax + bx + qx) / 3, mz = (az + bz + qz) / 3, my = (ay + by + qy) / 3;
      // face normal y-component for slope
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = qx - ax, vy = qy - ay, vz = qz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const slope = Math.abs(ny) / Math.hypot(nx, ny, nz);
      const cn = this.nColor(mx / 90, mz / 90) * 0.5 + 0.5;
      const g0 = ground[cn < 0.33 ? 0 : cn < 0.66 ? 1 : 2];
      c.copy(g0).lerp(ground[(cn * 3 + 1 | 0) % 3], (cn * 3) % 1 * 0.5);
      if (slope < 0.78) c.lerp(rock, smoothstep(0.86, 0.66, slope));
      if (my > 70) c.lerp(high, smoothstep(70, 110, my));
      if (dmin < W + 2.2) c.copy(gravel);
      const jit = 0.94 + hash2(Math.round(mx * 3), Math.round(mz * 3), 7) * 0.1;
      c.multiplyScalar(jit);
      for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [qx, qy, qz]]) {
        pos[p] = x; pos[p + 1] = y; pos[p + 2] = z;
        col[p] = c.r; col[p + 1] = c.g; col[p + 2] = c.b;
        p += 3;
      }
    };
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const i00 = j * N + i, i10 = i00 + 1, i01 = i00 + N, i11 = i01 + 1;
        const x0 = ox + i * step, x1 = x0 + step, z0 = oz + j * step, z1 = z0 + step;
        const dmin = Math.min(dists[i00], dists[i10], dists[i01], dists[i11]);
        tri(x0, z0, heights[i00], x0, z1, heights[i01], x1, z0, heights[i10], dmin);
        tri(x1, z0, heights[i10], x0, z1, heights[i01], x1, z1, heights[i11], dmin);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, this.terrainMat);
    mesh.receiveShadow = true;

    const chunk = new THREE.Group();
    chunk.add(mesh);
    this.addScenery(chunk, ox, oz, heights, dists, N, step);
    this.group.add(chunk);
    return chunk;
  }

  addScenery(chunk, ox, oz, heights, dists, N, step) {
    const b = this.biome;
    const CELLSZ = 9;
    const per = Math.floor(CHUNK / CELLSZ);
    const lists = {};
    for (const t of b.trees) lists[t] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let j = 0; j < per; j++) {
      for (let i = 0; i < per; i++) {
        const gx = Math.floor(ox / CELLSZ) + i, gz = Math.floor(oz / CELLSZ) + j;
        const r0 = hash2(gx, gz, this.seedInt);
        const cluster = this.nMask(gx * CELLSZ / 300, gz * CELLSZ / 300) * 0.5 + 0.5;
        if (r0 > b.treeDensity * (0.25 + cluster * 1.1)) continue;
        const lx = (i + 0.15 + hash2(gx, gz, 11) * 0.7) * CELLSZ;
        const lz = (j + 0.15 + hash2(gx, gz, 13) * 0.7) * CELLSZ;
        const ii = Math.min(N - 1, Math.round(lx / step)), jj = Math.min(N - 1, Math.round(lz / step));
        if (dists[jj * N + ii] < W + 7) continue;
        const y = heights[jj * N + ii];
        const ia = Math.min(N - 2, ii);
        const slope = Math.abs(heights[jj * N + ia + 1] - heights[jj * N + ia]) / step;
        if (slope > 0.9) continue;
        if (y > 115 && b !== BIOMES.desert) continue;
        const type = b.trees[hash2(gx, gz, 17) < 0.68 ? 0 : 1];
        const sc = 0.7 + hash2(gx, gz, 19) * 0.8;
        q.setFromAxisAngle(up, hash2(gx, gz, 23) * Math.PI * 2);
        s.set(sc, sc * (0.85 + hash2(gx, gz, 29) * 0.4), sc);
        v.set(ox + lx, y - 0.3, oz + lz);
        lists[type].push(m.compose(v, q, s).clone());
      }
    }
    for (const t in lists) {
      if (!lists[t].length) continue;
      const im = new THREE.InstancedMesh(this.treeGeos[t], this.treeMat, lists[t].length);
      im.userData.sharedGeo = true;
      lists[t].forEach((mm, k) => im.setMatrixAt(k, mm));
      im.castShadow = true;
      im.computeBoundingSphere();
      chunk.add(im);
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const c of this.chunks.values()) c.traverse((o) => { if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); });
    for (const m of this.roadPieces.values()) m.geometry.dispose();
    Object.values(this.treeGeos).forEach((g) => g.dispose());
  }
}

export { CHUNK, ROAD_STEP };

// ---- assets ---------------------------------------------------------------

function colored(geo, hex) {
  geo = geo.toNonIndexed();
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function makeTreeGeometries() {
  const trunk = (h, r = 0.35) => colored(new THREE.CylinderGeometry(r * 0.7, r, h, 5).translate(0, h / 2, 0), 0x5a4030);
  const pine = mergeGeometries([
    trunk(2.4),
    colored(new THREE.ConeGeometry(2.6, 5, 7).translate(0, 4.2, 0), 0x2f5a32),
    colored(new THREE.ConeGeometry(2.0, 4, 7).translate(0, 6.6, 0), 0x356638),
    colored(new THREE.ConeGeometry(1.3, 3, 7).translate(0, 8.6, 0), 0x3b7040),
  ]);
  const snowpine = mergeGeometries([
    trunk(2.4),
    colored(new THREE.ConeGeometry(2.6, 5, 7).translate(0, 4.2, 0), 0x2c4a36),
    colored(new THREE.ConeGeometry(2.0, 4, 7).translate(0, 6.6, 0), 0xdfe8ee),
    colored(new THREE.ConeGeometry(1.3, 3, 7).translate(0, 8.6, 0), 0xf4f8fb),
  ]);
  const oak = mergeGeometries([
    trunk(3, 0.45),
    colored(new THREE.IcosahedronGeometry(2.8, 0).translate(0, 4.6, 0), 0x4f8a3a),
    colored(new THREE.IcosahedronGeometry(2.0, 0).translate(1.2, 5.6, 0.6), 0x5c9a44),
  ]);
  const autumn = mergeGeometries([
    trunk(3, 0.45),
    colored(new THREE.IcosahedronGeometry(2.8, 0).translate(0, 4.6, 0), 0xd0702a),
    colored(new THREE.IcosahedronGeometry(2.0, 0).translate(1.2, 5.6, 0.6), 0xe0a030),
  ]);
  const cactus = mergeGeometries([
    colored(new THREE.CylinderGeometry(0.45, 0.5, 4.5, 6).translate(0, 2.25, 0), 0x4f7f3a),
    colored(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 6).translate(0.9, 2.6, 0), 0x4f7f3a),
    colored(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 6).rotateZ(Math.PI / 2).translate(0.5, 1.9, 0), 0x4f7f3a),
    colored(new THREE.CylinderGeometry(0.28, 0.28, 1.3, 6).translate(-0.8, 3.1, 0), 0x4f7f3a),
    colored(new THREE.CylinderGeometry(0.28, 0.28, 0.8, 6).rotateZ(Math.PI / 2).translate(-0.45, 2.5, 0), 0x4f7f3a),
  ]);
  const rock = colored(new THREE.DodecahedronGeometry(1.6, 0).scale(1.3, 0.8, 1).translate(0, 0.6, 0), 0x9a6a4a);
  return { pine, snowpine, oak, autumn, cactus, rock };
}

function makeRoadTexture(biome) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = biome === 'desert' ? '#4a4644' : '#3b3d41';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 50 + Math.random() * 30 | 0;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 256, 1, 1);
  }
  g.fillStyle = '#e8e8e2';
  g.fillRect(5, 0, 4, 256);
  g.fillRect(119, 0, 4, 256);
  g.fillStyle = '#e8c44a';
  g.fillRect(62, 0, 4, 120);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.ClampToEdgeWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
