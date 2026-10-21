import * as THREE from 'three';
import { hash2 } from './noise.js';
import { ROAD_HALF_WIDTH as W } from './road.js';
import { patch, textures } from './materials.js';

// Dense grass clumps in a ring around the player. The area is split into a
// toroidal grid of cells; as you move, only the cells that scroll into view
// are re-planted, so it streams cheaply at any speed.
const CELL = 6;
const GRID = 26;           // cells per side (~156 m)
const PER = 30;            // clumps per cell

export class GrassField {
  constructor(scene, gen) {
    this.scene = scene;
    this.gen = gen;
    const quads = [];
    for (let i = 0; i < 3; i++) {
      const q = new THREE.PlaneGeometry(1.0, 0.55, 1, 2).translate(0, 0.275, 0).rotateY((i * Math.PI) / 3);
      quads.push(q);
    }
    const geo = mergeQuads(quads);
    const mat = patch(new THREE.MeshStandardMaterial({
      map: textures().blade, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0,
    }), { wind: true, fade: [48, 74], grass: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, GRID * GRID * PER);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, zero);
    scene.add(this.mesh);
    this.slots = new Int32Array(GRID * GRID * 2).fill(0x7fffffff);
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.s = new THREE.Vector3();
    this.p = new THREE.Vector3();
    this.up = new THREE.Vector3(0, 1, 0);
  }

  update(focus) {
    const pcx = Math.floor(focus.x / CELL), pcz = Math.floor(focus.z / CELL);
    const half = GRID >> 1;
    let changed = false;
    for (let sz = 0; sz < GRID; sz++) {
      for (let sx = 0; sx < GRID; sx++) {
        // the cell in [pc - half, pc + half) that maps onto this slot
        const cx = pcx - half + mod(sx - (pcx - half), GRID);
        const cz = pcz - half + mod(sz - (pcz - half), GRID);
        const slot = sz * GRID + sx;
        if (this.slots[slot * 2] === cx && this.slots[slot * 2 + 1] === cz) continue;
        this.slots[slot * 2] = cx;
        this.slots[slot * 2 + 1] = cz;
        this.plant(slot, cx, cz);
        changed = true;
      }
    }
    if (changed) this.mesh.instanceMatrix.needsUpdate = true;
  }

  plant(slot, cx, cz) {
    const { m, q, s, p, up, gen } = this;
    const base = slot * PER;
    const roadNear = gen.road.nearest(cx * CELL + CELL / 2, cz * CELL + CELL / 2, CELL + W + 2);
    for (let i = 0; i < PER; i++) {
      const x = (cx + hash2(cx * PER + i, cz, 91)) * CELL;
      const z = (cz + hash2(cx * PER + i, cz, 92)) * CELL;
      let sc = 0.6 + hash2(cx * PER + i, cz, 93) * 0.8;
      if (roadNear) {
        const d = gen.road.nearest(x, z, W + 3);
        if (d && d.dist < W + 0.5) sc = 0;
        else if (d && d.dist < W + 2.2) sc *= 0.5; // short verge on the gravel shoulder
      }
      p.set(x, gen.heightAt(x, z) - 0.05, z);
      q.setFromAxisAngle(up, hash2(cx * PER + i, cz, 94) * Math.PI * 2);
      s.set(sc, sc * (0.75 + hash2(cx * PER + i, cz, 95) * 0.6), sc);
      this.mesh.setMatrixAt(base + i, m.compose(p, q, s));
    }
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.mesh.dispose();
  }
}

function mod(a, n) { return ((a % n) + n) % n; }

function mergeQuads(list) {
  const pos = [], uv = [], nor = [], idx = [];
  let off = 0;
  for (const g of list) {
    const p = g.attributes.position, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      uv.push(u.getX(i), u.getY(i));
      nor.push(0, 1, 0); // light the blades like the ground beneath them
    }
    for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    off += p.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}
