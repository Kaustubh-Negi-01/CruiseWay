import * as THREE from 'three';
import { glowTexture } from '../vehicle/bike.js';

// The race-finish cinematic, played in the game itself: a few camera cuts
// round your own ride as it rolls over the line, then a crane shot with
// fireworks. About 9 s; skippable.
//
//   1. low behind the rear wheel, pulling back
//   2. close on the side, tracking the wheel
//   3. from ahead, as you come through the finish
//   4. high and wide, circling, fireworks going up all round

const SHOTS = [2.2, 2.0, 2.0, 3.2];   // seconds per shot
export const CINE_LENGTH = SHOTS.reduce((a, b) => a + b, 0);

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _c = new THREE.Vector3(), _l = new THREE.Vector3();

export class FinishCine {
  constructor(scene) {
    this.t = 0;
    this.fw = new Fireworks(scene);
    this.fixed = null;
    this.shot = -1;
    this.launchAt = 0;
  }

  get done() { return this.t >= CINE_LENGTH; }

  // car: the Bike physics object; camera: the game camera
  update(dt, car, camera) {
    this.t += dt;
    let t = this.t, shot = 0;
    while (shot < SHOTS.length - 1 && t > SHOTS[shot]) { t -= SHOTS[shot]; shot++; }
    const k = Math.min(1, t / SHOTS[shot]);   // 0..1 through this shot
    const p = car.renderPos, y = car.bodyY;
    const yaw = car.renderYaw;
    _f.set(Math.sin(yaw), 0, Math.cos(yaw));
    _r.set(-_f.z, 0, _f.x);
    _c.set(p.x, y, p.z);
    if (shot !== this.shot) {
      this.shot = shot;
      // the fixed shots remember where the ride was when they began
      this.fixed = _c.clone();
      this.fixedF = _f.clone();
      this.fixedR = _r.clone();
      if (shot === 2) this.fw.salvo(_c.clone().addScaledVector(_f, 40), 3);
    }
    let fov = 55;
    if (shot === 0) {
      camera.position.copy(_c).addScaledVector(_f, -(3.2 + k * 2.6)).addScaledVector(_r, 0.7 - k * 0.4);
      camera.position.y = y + 0.55 + k * 0.5;
      _l.copy(_c).addScaledVector(_f, 3);
      _l.y = y + 0.7;
      fov = 50;
    } else if (shot === 1) {
      camera.position.copy(_c).addScaledVector(_r, 2.6).addScaledVector(_f, -1.2 + k * 0.8);
      camera.position.y = y + 0.55;
      _l.copy(_c).addScaledVector(_f, -0.6 + k * 0.4);
      _l.y = y + 0.38;
      fov = 50;
    } else if (shot === 2) {
      camera.position.copy(this.fixed).addScaledVector(this.fixedF, 26).addScaledVector(this.fixedR, 1.8);
      camera.position.y = this.fixed.y + 1.1;
      _l.copy(_c);
      _l.y = y + 0.8;
      fov = 38 - k * 8;
    } else {
      const a = Math.atan2(this.fixedF.x, this.fixedF.z) + Math.PI * 0.75 + k * 0.9;
      const rad = 34 - k * 6;
      camera.position.set(_c.x + Math.sin(a) * rad, y + 20 + k * 8, _c.z + Math.cos(a) * rad);
      _l.copy(_c);
      _l.y = y + 4 + k * 6;
      fov = 60;
      if (this.t > this.launchAt) { this.launchAt = this.t + 0.45; this.fw.salvo(_c.clone().addScaledVector(_f, 15), 2); }
    }
    camera.lookAt(_l);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    this.fw.update(dt);
  }

  dispose() { this.fw.dispose(); }
}

// ---- fireworks ----------------------------------------------------------------------

const MAX = 2400;
const COLORS = [0xff4fd8, 0x38e8ff, 0xffd23f, 0x7dff6a, 0xff6b4a, 0xffffff, 0xa07cff];

class Fireworks {
  constructor(scene) {
    this.scene = scene;
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.base = new Float32Array(MAX * 3);
    this.next = 0;
    this.rockets = [];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({
      size: 1.6, map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    scene.add(this.points);
  }

  // n rockets going up round a point, bursting a moment later
  salvo(at, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 10 + Math.random() * 30;
      this.rockets.push({
        x: at.x + Math.cos(a) * r, z: at.z + Math.sin(a) * r, y: at.y,
        top: at.y + 22 + Math.random() * 22, vy: 34 + Math.random() * 8,
        color: new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]),
      });
    }
  }

  burst(x, y, z, color) {
    const n = 160;
    for (let i = 0; i < n; i++) {
      const j = this.next;
      this.next = (this.next + 1) % MAX;
      // even spread over a sphere
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
      const sp = 13 + Math.random() * 4;
      this.pos.set([x, y, z], j * 3);
      this.vel.set([s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp], j * 3);
      const c = Math.random() < 0.15 ? 1.6 : 1.1;
      this.base.set([color.r * c, color.g * c, color.b * c], j * 3);
      this.life[j] = 1.4 + Math.random() * 0.6;
    }
  }

  update(dt) {
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.y += r.vy * dt;
      // a short trail
      const j = this.next;
      this.next = (this.next + 1) % MAX;
      this.pos.set([r.x, r.y, r.z], j * 3);
      this.vel.set([0, -2, 0], j * 3);
      this.base.set([1, 0.8, 0.5], j * 3);
      this.life[j] = 0.35;
      if (r.y >= r.top) { this.burst(r.x, r.y, r.z, r.color); this.rockets.splice(i, 1); }
    }
    for (let j = 0; j < MAX; j++) {
      if (this.life[j] <= 0) { this.col[j * 3] = this.col[j * 3 + 1] = this.col[j * 3 + 2] = 0; continue; }
      this.life[j] -= dt;
      const k = j * 3;
      this.vel[k] *= 1 - dt * 1.2; this.vel[k + 2] *= 1 - dt * 1.2;
      this.vel[k + 1] = this.vel[k + 1] * (1 - dt * 1.2) - 6 * dt;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      const fade = Math.min(1, Math.max(0, this.life[j]) / 0.8) * (0.75 + 0.25 * Math.sin(j * 7.1 + this.life[j] * 40));
      this.col[k] = this.base[k] * fade; this.col[k + 1] = this.base[k + 1] * fade; this.col[k + 2] = this.base[k + 2] * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.points);
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
