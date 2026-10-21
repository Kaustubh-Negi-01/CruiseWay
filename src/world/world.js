import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TerrainGen, CHUNK, MAP_EXTENT, TREE_PINE, TREE_BROAD, TREE_BUSH } from './terrainGen.js';
import { KIND_DIRT, ROAD_STEP } from './network.js';
import { DIFFICULTY } from './spots.js';
import { patch, textures, raw } from './materials.js';
import { GrassField } from './grass.js';
import TerrainWorker from './terrain.worker.js?worker';

const VIEW = 7.5;          // view radius in chunks (~1.9 km)
const ROAD_PIECE = 64;     // samples per road mesh
const MAX_IN_FLIGHT = 2;
const MAP_SIZE = 1024;

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
    this.net = this.gen.net;
    this.spots = this.gen.spots;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.terrainMat = patch(new THREE.MeshStandardMaterial({ roughness: 0.96, metalness: 0 }), { terrain: true });
    this.roadMat = patch(new THREE.MeshStandardMaterial({ map: textures().noise, roughness: 0.8, metalness: 0 }), { road: true });
    this.treeMat = patch(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
    this.treeGeos = makeTreeGeometries();
    this.indexCache = new Map();

    this.chunks = new Map();
    this.pending = new Map();
    this.roadPieces = new Map();
    this.discs = new Map();

    this.worker = new TerrainWorker();
    this.worker.onerror = (e) => console.error('terrain worker failed', e.message || e);
    this.worker.postMessage({ type: 'init', seed });
    this.worker.onmessage = (e) => (e.data.type === 'map' ? this.onMap(e.data) : this.onChunk(e.data));
    this.mapCanvas = null;
    this.mapListeners = [];
    this.mapRequested = false;

    this.water = makeWater();
    scene.add(this.water);
    this.beacons = makeSpotBeacons(this.spots);
    scene.add(this.beacons);

    this.grass = new GrassField(scene, this.gen);
    this.focus = new THREE.Vector3();
  }

  // ---- queries --------------------------------------------------------------

  heightAt(x, z) { return this.gen.heightAt(x, z); }
  normalAt(x, z, out = new THREE.Vector3()) { return this.gen.normalAt(x, z, out); }
  surfaceAt(x, z) { return this.gen.surfaceAt(x, z); }
  readyAt(x, z) { return this.chunks.has(Math.floor(x / CHUNK) + ',' + Math.floor(z / CHUNK)); }

  // ---- streaming ------------------------------------------------------------

  update(focus) {
    this.focus.copy(focus);
    const pcx = focus.x / CHUNK - 0.5, pcz = focus.z / CHUNK - 0.5;
    const cx0 = Math.floor(focus.x / CHUNK), cz0 = Math.floor(focus.z / CHUNK);
    const R = Math.ceil(VIEW);
    const wanted = new Map();
    const todo = [];
    const lim = MAP_EXTENT + CHUNK;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const cx = cx0 + dx, cz = cz0 + dz;
        // open sea beyond the map: the water plane covers it
        if (Math.abs((cx + 0.5) * CHUNK) > lim || Math.abs((cz + 0.5) * CHUNK) > lim) continue;
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
    // the map image waits until the nearby terrain is in
    if (!this.mapRequested && todo.length === 0 && this.pending.size === 0) {
      this.mapRequested = true;
      this.worker.postMessage({ type: 'map', size: MAP_SIZE });
    }
    for (const [key, c] of this.chunks) {
      if (!wanted.has(key)) { this.disposeChunk(c); this.chunks.delete(key); }
    }
    this.wanted = wanted;
    this.updateRoads(focus);
    this.grass.update(focus);
    this.water.position.set(Math.round(focus.x / 100) * 100, 0, Math.round(focus.z / 100) * 100);
    for (const b of this.beacons.children) {
      const d = Math.hypot(b.position.x - focus.x, b.position.z - focus.z);
      b.visible = d < 2600;
      if (b.userData.label) b.userData.label.visible = d < 350;
    }
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
    g.setAttribute('aLine', new THREE.BufferAttribute(m.kind, 1));
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

  onMap(m) {
    const c = document.createElement('canvas');
    c.width = c.height = m.size;
    c.getContext('2d').putImageData(new ImageData(m.px, m.size, m.size), 0, 0);
    this.mapCanvas = c;
    for (const fn of this.mapListeners) fn(c);
  }

  onMapReady(fn) {
    if (this.mapCanvas) fn(this.mapCanvas);
    else this.mapListeners.push(fn);
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
      const im = new THREE.InstancedMesh(this.treeGeos[type][near ? 0 : 1], this.treeMat, list.length);
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

  // ---- roads ----------------------------------------------------------------

  updateRoads(focus) {
    const R2 = (VIEW * CHUNK) ** 2;
    const net = this.net;
    for (const e of net.edges) {
      const [x0, z0, x1, z1] = e.box;
      const dx = Math.max(x0 - focus.x, 0, focus.x - x1), dz = Math.max(z0 - focus.z, 0, focus.z - z1);
      const edgeNear = dx * dx + dz * dz < R2;
      const pieces = Math.ceil((e.n - 1) / ROAD_PIECE);
      for (let p = 0; p < pieces; p++) {
        const key = e.id + ':' + p;
        let near = false;
        if (edgeNear) {
          const mid = Math.min(e.n - 1, p * ROAD_PIECE + ROAD_PIECE / 2);
          near = (e.x[mid] - focus.x) ** 2 + (e.z[mid] - focus.z) ** 2 < R2;
        }
        const has = this.roadPieces.has(key);
        if (near && !has) {
          const mesh = this.buildRoadPiece(e, p * ROAD_PIECE, Math.min(e.n - 1, (p + 1) * ROAD_PIECE));
          this.roadPieces.set(key, mesh);
          if (mesh) this.group.add(mesh);
        } else if (!near && has) {
          const m = this.roadPieces.get(key);
          if (m) { this.group.remove(m); m.geometry.dispose(); }
          this.roadPieces.delete(key);
        }
      }
    }
    for (const n of net.nodes) {
      const near = (n.x - focus.x) ** 2 + (n.z - focus.z) ** 2 < R2;
      const has = this.discs.has(n.id);
      if (near && !has) {
        const m = this.buildDisc(n);
        this.discs.set(n.id, m);
        this.group.add(m);
      } else if (!near && has) {
        const m = this.discs.get(n.id);
        this.group.remove(m);
        m.geometry.dispose();
        this.discs.delete(n.id);
      }
    }
  }

  // double line where the road bends, dashed where it's straight
  lineStyle(e, i) {
    if (e.kind === KIND_DIRT) return 2;
    const a = Math.max(0, i - 20), b = Math.min(e.n - 1, i + 20);
    const turn = Math.acos(Math.min(1, e.tx[a] * e.tx[b] + e.tz[a] * e.tz[b]));
    return turn > 0.32 ? 1 : 0;
  }

  buildRoadPiece(e, k0, k1) {
    // trim the ends under the junction pads
    const nA = this.net.nodes[e.a], nB = this.net.nodes[e.b];
    const lo = Math.ceil((nA.disc - 1.2) / ROAD_STEP), hi = e.n - 1 - Math.ceil((nB.disc - 1.2) / ROAD_STEP);
    k0 = Math.max(k0, lo); k1 = Math.min(k1, hi);
    if (k1 - k0 < 1) return null;
    const n = k1 - k0 + 1, W = e.half;
    const pos = new Float32Array(n * 6), nor = new Float32Array(n * 6), uv = new Float32Array(n * 4);
    const line = new Float32Array(n * 2), zero = new Float32Array(n * 2);
    const idx = [];
    for (let j = 0; j < n; j++) {
      const i = k0 + j;
      const nx = -e.tz[i], nz = e.tx[i];
      const y = e.y[i] + 0.03;
      pos.set([e.x[i] + nx * W, y, e.z[i] + nz * W, e.x[i] - nx * W, y, e.z[i] - nz * W], j * 6);
      nor.set([0, 1, 0, 0, 1, 0], j * 6);
      uv.set([0, i * ROAD_STEP, 1, i * ROAD_STEP], j * 4);
      line[j * 2] = line[j * 2 + 1] = this.lineStyle(e, i);
      if (j < n - 1) { const a = j * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
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

  buildDisc(n) {
    const g = new THREE.CircleGeometry(n.disc, 32).rotateX(-Math.PI / 2).translate(n.x, n.y + 0.06, n.z);
    const count = g.attributes.position.count;
    g.setAttribute('aLine', new THREE.BufferAttribute(new Float32Array(count).fill(n.kind === KIND_DIRT ? 2 : 3), 1));
    g.setAttribute('aRoad', new THREE.BufferAttribute(new Float32Array(count), 1));
    const m = new THREE.Mesh(g, this.roadMat);
    m.receiveShadow = true;
    return m;
  }

  dispose() {
    this.worker.terminate();
    this.scene.remove(this.group, this.water, this.beacons);
    for (const c of this.chunks.values()) this.disposeChunk(c);
    for (const m of this.roadPieces.values()) m?.geometry.dispose();
    for (const m of this.discs.values()) m.geometry.dispose();
    this.treeGeos.flat().forEach((g) => g.dispose());
    this.grass.dispose();
    this.water.geometry.dispose();
    this.water.material.dispose();
    this.beacons.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
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

// ---- water ------------------------------------------------------------------

function makeWater() {
  const mat = patch(new THREE.MeshStandardMaterial({
    color: 0x1f5d66, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.86, envMapIntensity: 0.9,
  }));
  const m = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), mat);
  m.position.y = 0;
  m.renderOrder = 1;
  m.userData.isWater = true;
  return m;
}

// ---- race spot beacons ------------------------------------------------------------

function makeSpotBeacons(spots) {
  const group = new THREE.Group();
  for (const s of spots) {
    const p = s.route.at(s.startS);
    const color = new THREE.Color(DIFFICULTY[s.difficulty].color);
    const b = new THREE.Group();
    b.position.set(p.x, p.y, p.z);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(10, 0.18, 8, 64).rotateX(Math.PI / 2),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    ring.position.y = 0.25;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.6, 1.6, 160, 16, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    beam.position.y = 80;
    const label = spotLabel(s);
    label.position.y = 7;
    b.add(ring, beam, label);
    b.userData = { spot: s.id, label };
    group.add(b);
  }
  return group;
}

function spotLabel(s) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const c = cv.getContext('2d');
  c.fillStyle = 'rgba(12,14,18,0.72)';
  c.beginPath(); c.roundRect(16, 16, 480, 128, 24); c.fill();
  c.fillStyle = DIFFICULTY[s.difficulty].color;
  c.fillRect(16, 16, 10, 128);
  c.fillStyle = '#fff';
  c.font = '700 44px system-ui, sans-serif';
  c.fillText(s.name, 48, 72);
  c.font = '500 30px system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fillText(`${(s.length / 1000).toFixed(1)} km · ${'★'.repeat(s.difficulty)}${'☆'.repeat(5 - s.difficulty)} ${DIFFICULTY[s.difficulty].label}`, 48, 120);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, fog: false }));
  sp.scale.set(12, 3.75, 1);
  sp.renderOrder = 20;
  return sp;
}

// ---- tree models (original low-poly designs, vertex coloured) ---------------

function colored(geo, hex, jitter = 0, shade = 0) {
  geo = geo.index ? geo.toNonIndexed() : geo;
  const pos = geo.attributes.position;
  if (jitter) {
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
  const pineTiers = [];
  const tiers = 7;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const rad = 3.0 * (1 - f) + 0.55;
    const y = 4.8 + t * 1.6;
    const shade = [0x1e3420, 0x23392a, 0x1b2f1e][t % 3];
    pineTiers.push(colored(new THREE.ConeGeometry(rad, 3.2, 9, 2).translate(0, y, 0), shade, 0.28, 0.35));
  }
  const pineNear = mergeGeometries([trunk(6, 0.32, 0.18), ...pineTiers]);
  const pineFar = mergeGeometries([colored(new THREE.ConeGeometry(2.9, 12, 6).translate(0, 9.4, 0), 0x1d3220), trunk(3.6, 0.3, 0.25)]);
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
  const bushNear = mergeGeometries([
    colored(new THREE.IcosahedronGeometry(1.1, 1).scale(1.3, 0.6, 1).translate(0, 0.35, 0), 0x3a2f20, 0.35),
    colored(new THREE.IcosahedronGeometry(0.8, 1).scale(1.2, 0.7, 1).translate(0.9, 0.3, 0.4), 0x463824, 0.35),
    colored(new THREE.IcosahedronGeometry(0.7, 1).scale(1.2, 0.6, 1).translate(-0.8, 0.25, -0.3), 0x2f3a1e, 0.35),
  ]);
  const bushFar = colored(new THREE.IcosahedronGeometry(1.2, 0).scale(1.5, 0.6, 1.1).translate(0, 0.3, 0), 0x3a3020);
  return [[pineNear, pineFar], [broadNear, broadFar], [bushNear, bushFar]];
}

export { raw };
