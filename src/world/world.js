import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TerrainGen, CHUNK, TREE_PINE, TREE_BROAD, TREE_BUSH } from './terrainGen.js';
import { ROAD_HALF_WIDTH as W, ROAD_STEP } from './road.js';
import { patch, textures } from './materials.js';
import { GrassField } from './grass.js';
import TerrainWorker from './terrain.worker.js?worker';

const VIEW = 7.5;          // view radius in chunks (~1.9 km)
const ROAD_PIECE = 64;     // dense samples per road mesh
const MAX_IN_FLIGHT = 2;

// detail by distance (in chunks) from the player
function segFor(d) {
  if (d < 1.25) return 128;
  if (d < 2.4) return 64;
  if (d < 4.2) return 32;
  return 16;
}

export class World {
  constructor(scene, seed) {
    this.scene = scene;
    this.seed = seed;
    this.gen = new TerrainGen(seed);
    this.road = this.gen.road;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.terrainMat = patch(new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 }), { terrain: true });
    this.roadMat = patch(new THREE.MeshStandardMaterial({ map: textures().noise, roughness: 0.8, metalness: 0 }), { road: true });
    this.treeMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    this.treeGeos = makeTreeGeometries();
    this.indexCache = new Map();

    this.chunks = new Map();   // key -> { seg, group }
    this.pending = new Map();  // key -> seg requested
    this.roadPieces = new Map();

    this.worker = new TerrainWorker();
    this.worker.onerror = (e) => console.error('terrain worker failed', e.message || e);
    this.worker.postMessage({ type: 'init', seed });
    this.worker.onmessage = (e) => this.onChunk(e.data);

    this.grass = new GrassField(scene, this.gen);
    this.focus = new THREE.Vector3();
  }

  // ---- queries used by physics / gameplay ---------------------------------

  heightAt(x, z) { return this.gen.heightAt(x, z); }
  normalAt(x, z, out = new THREE.Vector3()) { return this.gen.normalAt(x, z, out); }
  isOnRoad(x, z) {
    const n = this.road.nearest(x, z, W + 1);
    return !!n && n.dist < W + 0.4;
  }

  // true once the chunk under a point has a mesh (used by the loading screen)
  readyAt(x, z) {
    return this.chunks.has(Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK));
  }

  preload(x, z) {
    this.road.ensureAround(z);
    this.focus.set(x, 0, z);
  }

  // ---- streaming ------------------------------------------------------------

  update(focus) {
    this.focus.copy(focus);
    this.road.ensureAround(focus.z);
    const pcx = focus.x / CHUNK - 0.5, pcz = focus.z / CHUNK - 0.5;
    const cx0 = Math.floor(focus.x / CHUNK), cz0 = Math.floor(focus.z / CHUNK);
    const R = Math.ceil(VIEW);
    const wanted = new Map();
    const todo = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = cx0 + dx, cz = cz0 + dz;
        const d = Math.hypot(cx - pcx, cz - pcz);
        if (d > VIEW) continue;
        const key = cx + ',' + cz;
        const seg = segFor(d);
        wanted.set(key, seg);
        const have = this.chunks.get(key);
        if ((!have || have.seg !== seg) && this.pending.get(key) !== seg) todo.push([d - (have ? 0 : 10), cx, cz, key, seg]);
      }
    }
    todo.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz, key, seg] of todo) {
      if (this.pending.size >= MAX_IN_FLIGHT) break;
      this.pending.set(key, seg);
      this.worker.postMessage({ type: 'chunk', key, cx, cz, seg });
    }
    for (const [key, c] of this.chunks) {
      if (!wanted.has(key)) { this.disposeChunk(c); this.chunks.delete(key); }
    }
    this.wanted = wanted;
    this.updateRoad(focus);
    this.grass.update(focus);
  }

  onChunk(m) {
    if (this.pending.get(m.key) === m.seg) this.pending.delete(m.key);
    if (!this.wanted || this.wanted.get(m.key) !== m.seg) return;
    const old = this.chunks.get(m.key);
    const group = new THREE.Group();

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(m.nor, 3));
    g.setAttribute('aRoad', new THREE.BufferAttribute(m.road, 1));
    g.setIndex(this.indexFor(m.seg));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.terrainMat);
    mesh.receiveShadow = true;
    group.add(mesh);

    this.addTrees(group, m.trees, m.seg >= 64);
    this.group.add(group);
    if (old) this.disposeChunk(old);
    this.chunks.set(m.key, { seg: m.seg, group });
  }

  disposeChunk(c) {
    this.group.remove(c.group);
    c.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      else if (o.geometry) o.geometry.dispose();
    });
  }

  indexFor(seg) {
    let idx = this.indexCache.get(seg);
    if (idx) return idx;
    const N = seg + 1;
    const out = [];
    for (let j = 0; j < seg; j++) {
      for (let i = 0; i < seg; i++) {
        const a = j * N + i, b = a + N, c = a + 1, d = b + 1;
        out.push(a, b, c, c, b, d);
      }
    }
    // skirts, both windings so they are visible from either side
    const base = N * N;
    for (let e = 0; e < 4; e++) {
      for (let k = 0; k < N - 1; k++) {
        const s0 = base + e * N + k, s1 = s0 + 1;
        const g0 = edgeVertex(e, k, N), g1 = edgeVertex(e, k + 1, N);
        out.push(g0, s0, g1, g1, s0, s1, g0, g1, s0, g1, s1, s0);
      }
    }
    idx = new THREE.BufferAttribute(new Uint32Array(out), 1);
    this.indexCache.set(seg, idx);
    return idx;
  }

  addTrees(group, data, near) {
    const byType = [[], [], []];
    for (let i = 0; i < data.length; i += 6) byType[data[i + 5]].push(i);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    [TREE_PINE, TREE_BROAD, TREE_BUSH].forEach((type) => {
      const list = byType[type];
      if (!list.length) return;
      const geo = this.treeGeos[type][near ? 0 : 1];
      const im = new THREE.InstancedMesh(geo, this.treeMat, list.length);
      list.forEach((i, n) => {
        p.set(data[i], data[i + 1], data[i + 2]);
        q.setFromAxisAngle(up, data[i + 4]);
        const sc = data[i + 3];
        s.set(sc, sc * (type === TREE_PINE ? 1.1 : 1), sc);
        im.setMatrixAt(n, m.compose(p, q, s));
      });
      im.castShadow = near && type !== TREE_BUSH;
      im.receiveShadow = near;
      im.computeBoundingSphere();
      group.add(im);
    });
  }

  updateRoad(focus) {
    const r = this.road;
    const p0 = Math.floor(r.minK / ROAD_PIECE), p1 = Math.floor((r.maxK - 1) / ROAD_PIECE);
    const R2 = (VIEW * CHUNK) ** 2;
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

  // No-overtaking double line where the road bends, dashed where it's straight.
  lineStyle(k) {
    const r = this.road;
    const a = r.dense(Math.max(r.minK, k - 20)), b = r.dense(Math.min(r.maxK, k + 20));
    const turn = Math.acos(Math.min(1, a.tx * b.tx + a.tz * b.tz));
    return turn > 0.32 ? 1 : 0;
  }

  buildRoadPiece(k0, k1) {
    const r = this.road;
    const n = k1 - k0 + 1;
    const pos = new Float32Array(n * 2 * 3);
    const nor = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const line = new Float32Array(n * 2);
    const zero = new Float32Array(n * 2);
    const idx = [];
    // smooth the line style along the piece so it doesn't flicker
    const styles = [];
    for (let i = 0; i < n; i++) styles.push(this.lineStyle(k0 + i));
    for (let i = 0; i < n; i++) {
      const d = r.dense(k0 + i);
      const nx = -d.tz, nz = d.tx;
      const y = d.y + 0.03;
      pos.set([d.x + nx * W, y, d.z + nz * W, d.x - nx * W, y, d.z - nz * W], i * 6);
      nor.set([0, 1, 0, 0, 1, 0], i * 6);
      uv.set([0, d.s, 1, d.s], i * 4);
      line[i * 2] = line[i * 2 + 1] = styles[i];
      if (i < n - 1) {
        const a = i * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setAttribute('aLine', new THREE.BufferAttribute(line, 1));
    g.setAttribute('aRoad', new THREE.BufferAttribute(zero, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.roadMat);
    m.receiveShadow = true;
    return m;
  }

  dispose() {
    this.worker.terminate();
    this.scene.remove(this.group);
    for (const c of this.chunks.values()) this.disposeChunk(c);
    for (const m of this.roadPieces.values()) m.geometry.dispose();
    this.treeGeos.flat().forEach((g) => g.dispose());
    this.grass.dispose();
    [this.terrainMat, this.roadMat, this.treeMat].forEach((m) => m.dispose());
  }
}

export { CHUNK, ROAD_STEP };

function edgeVertex(e, k, N) {
  if (e === 0) return k;
  if (e === 1) return (N - 1) * N + k;
  if (e === 2) return k * N;
  return k * N + N - 1;
}

// ---- tree models (original low-poly designs, vertex coloured) ---------------

function colored(geo, hex, jitter = 0, shade = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const pos = geo.attributes.position;
  if (jitter) {
    // deterministic per-vertex wobble keyed on position so shared corners move together
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
      const f = 1 + (h - Math.floor(h) - 0.5) * jitter;
      pos.setXYZ(i, x * f, y + (f - 1) * 0.6, z * f);
    }
  }
  const c = new THREE.Color(hex);
  const arr = new Float32Array(pos.count * 3);
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox;
  const span = Math.max(1e-3, max.y - min.y);
  for (let i = 0; i < pos.count; i++) {
    // darker toward the underside of each part, like self-shadowed foliage
    const k = 1 - shade * (1 - (pos.getY(i) - min.y) / span);
    arr.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  return geo;
}

function makeTreeGeometries() {
  const trunk = (h, r0, r1) => colored(new THREE.CylinderGeometry(r1, r0, h, 6).translate(0, h / 2, 0), 0x3b2a1c);

  // Tall dark conifer: stacked drooping tiers.
  const pineTiers = [];
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const rad = 3.0 * (1 - f) + 0.55;
    const y = 4.8 + t * 1.6; // lowest boughs clear the riding camera
    const shade = [0x1e3420, 0x23392a, 0x1b2f1e][t % 3];
    pineTiers.push(colored(new THREE.ConeGeometry(rad, 3.2, 9, 2).translate(0, y, 0), shade, 0.28, 0.35));
  }
  const pineNear = mergeGeometries([trunk(6, 0.32, 0.18), ...pineTiers]);
  const pineFar = mergeGeometries([colored(new THREE.ConeGeometry(2.9, 12, 6).translate(0, 9.4, 0), 0x1d3220), trunk(3.6, 0.3, 0.25)]);

  // Broadleaf: lumpy canopy of jittered blobs.
  const blobs = [
    [0, 7.2, 0, 2.9], [1.9, 6.4, 0.6, 2.2], [-1.8, 6.6, -0.4, 2.3], [0.4, 8.6, -1.2, 2.0],
    [-0.6, 6.0, 1.9, 2.0], [0.8, 6.1, -2.0, 1.9], [-0.2, 9.4, 0.7, 1.6],
  ];
  const canopyCols = [0x31481c, 0x3c5622, 0x2b4019, 0x445f26];
  const broadNear = mergeGeometries([
    trunk(5.6, 0.45, 0.28),
    colored(new THREE.CylinderGeometry(0.12, 0.2, 2.6, 5).rotateZ(0.8).translate(0.9, 5.0, 0), 0x3b2a1c),
    colored(new THREE.CylinderGeometry(0.12, 0.2, 2.4, 5).rotateZ(-0.7).translate(-0.8, 4.9, 0.2), 0x3b2a1c),
    ...blobs.map(([x, y, z, r], i) => colored(new THREE.IcosahedronGeometry(r, 1).translate(x, y, z), canopyCols[i % 4], 0.3, 0.25)),
  ]);
  const broadFar = mergeGeometries([
    trunk(5, 0.45, 0.3),
    colored(new THREE.IcosahedronGeometry(3.4, 0).scale(1, 0.85, 1).translate(0, 7.4, 0), 0x34501f),
  ]);

  // Low heather / scrub clump.
  const bushNear = mergeGeometries([
    colored(new THREE.IcosahedronGeometry(1.1, 1).scale(1.3, 0.6, 1).translate(0, 0.35, 0), 0x3a2f20, 0.35),
    colored(new THREE.IcosahedronGeometry(0.8, 1).scale(1.2, 0.7, 1).translate(0.9, 0.3, 0.4), 0x463824, 0.35),
    colored(new THREE.IcosahedronGeometry(0.7, 1).scale(1.2, 0.6, 1).translate(-0.8, 0.25, -0.3), 0x2f3a1e, 0.35),
  ]);
  const bushFar = colored(new THREE.IcosahedronGeometry(1.2, 0).scale(1.5, 0.6, 1.1).translate(0, 0.3, 0), 0x3a3020);

  return [[pineNear, pineFar], [broadNear, broadFar], [bushNear, bushFar]];
}
