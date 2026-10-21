import * as THREE from 'three';
import { BIKE } from './bike.js';
import { clamp } from './world/noise.js';

const G = 16;
const FIXED = 1 / 120;
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _lean = new THREE.Quaternion(), _axis = new THREE.Vector3();

// Arcade motorbike: planar drive + lateral grip, glued to the terrain with a
// soft suspension so rolling hills and off-road slopes feel smooth.
export class Bike {
  constructor(world) {
    this.world = world;
    this.spec = BIKE;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.lean = 0;
    this.onGround = true;
    this.onRoad = true;
    this.frozen = false;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.smoothNormal = new THREE.Vector3(0, 1, 0);
    this.bodyY = 0;          // suspension-smoothed height used for rendering
    this.bodyVy = 0;
    this.wheelSpin = 0;
    this.acc = 0;
    this.lastGround = 0;
    this.odometer = 0;
    this.surface = 1;        // 0 grass/open ground, 1 tarmac, 2 dirt
    this.prevY = 0;
    this.groundVy = 0;
    this.underwater = 0;     // seconds spent submerged
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get forwardSpeed() { return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw); }

  place(x, z, yaw) {
    const y = this.world.heightAt(x, z);
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.yawRate = 0;
    this.steer = 0;
    this.lean = 0;
    this.lastGround = y;
    this.bodyY = y;
    this.bodyVy = 0;
    this.prevY = y;
    this.groundVy = 0;
    this.underwater = 0;
    this.onGround = true;
    this.world.normalAt(x, z, this.normal);
    this.smoothNormal.copy(this.normal);
  }

  update(dt, input) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= FIXED) {
      this.step(FIXED, input);
      this.acc -= FIXED;
    }
    this.smoothNormal.lerp(this.normal, 1 - Math.exp(-dt * 12)).normalize();
    // Suspension: a damped spring that tracks the wheels' height AND vertical
    // speed, so a steady climb settles at zero offset (no sinking into the
    // road) and only sudden changes in slope get softened.
    if (dt > 0) {
      const vy = (this.pos.y - this.prevY) / dt;
      this.groundVy += (vy - this.groundVy) * (1 - Math.exp(-dt * 30));
    }
    this.prevY = this.pos.y;
    const k = 220, c = 2 * Math.sqrt(k);
    this.bodyVy += ((this.pos.y - this.bodyY) * k + (this.groundVy - this.bodyVy) * c) * dt;
    this.bodyY += this.bodyVy * dt;
    // never sit below the road surface, and never float far above it
    if (this.bodyY < this.pos.y - 0.05) { this.bodyY = this.pos.y - 0.05; this.bodyVy = Math.max(this.bodyVy, this.groundVy); }
    if (this.bodyY > this.pos.y + 0.35) this.bodyY = this.pos.y + 0.35;

    const vf = this.forwardSpeed;
    this.wheelSpin += (vf / 0.31) * dt;
    this.odometer += Math.abs(vf) * dt;
    // lean from the centripetal demand of the turn: tan(lean) = v * yawRate / g
    const target = clamp(-Math.atan((this.yawRate * Math.abs(vf)) / 9.8), -0.85, 0.85);
    this.lean += (target - this.lean) * (1 - Math.exp(-dt * 5));
  }

  step(dt, input) {
    const s = this.spec;
    if (this.frozen) { this.vel.set(0, 0, 0); this.yawRate = 0; return; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vl = this.vel.x * fz - this.vel.z * fx;

    const steerTarget = input.steer;
    const rate = Math.abs(steerTarget) > Math.abs(this.steer) ? 3.2 : 6;
    this.steer += (steerTarget - this.steer) * (1 - Math.exp(-dt * rate));

    this.surface = this.world.surfaceAt(this.pos.x, this.pos.z);
    this.onRoad = this.surface !== 0;
    const traction = this.onGround ? 1 : 0.04;
    const wet = this.pos.y < -0.5;   // riding into the sea or a lake
    const top = s.maxSpeed * (this.surface === 1 ? 1 : this.surface === 2 ? s.dirtTop : s.offTop) * (wet ? 0.25 : 1);

    if (input.throttle > 0) {
      if (vf < -0.5) vf += s.brake * input.throttle * dt * traction;
      else vf += s.accel * input.throttle * Math.max(0, 1 - (vf / top) ** 2) * dt * traction;
    }
    if (input.brake > 0) {
      if (vf > 0.5) vf -= s.brake * input.brake * dt * traction;
      else vf -= s.reverse * input.brake * Math.max(0, 1 + vf / 5) * dt * traction;
    }
    const parked = this.onGround && !input.throttle && !input.brake && Math.abs(vf) < 1;
    if (parked) vf *= Math.exp(-6 * dt);
    if (this.onGround) {
      const drag = 0.02 + (this.surface === 1 ? 0 : this.surface === 2 ? s.dirtDrag : s.offDrag) + 0.0007 * Math.abs(vf) + (wet ? 1.5 : 0);
      vf -= vf * drag * dt;
      if (vf > top) vf += (top - vf) * (1 - Math.exp(-dt * 1.5)); // ease down when leaving the road fast
    }

    let grip = this.surface === 1 ? s.grip : this.surface === 2 ? s.dirtGrip : s.offGrip;
    if (input.handbrake) { grip = s.handbrakeGrip; vf -= vf * 0.5 * dt; }
    vl *= Math.exp(-grip * traction * dt);

    const sp = Math.abs(vf);
    const steerAmt = this.steer * s.steer * Math.min(1, sp / 3) / (1 + sp / 26);
    const target = steerAmt * Math.sign(vf) * (input.handbrake ? 1.3 : 1);
    this.yawRate += (target - this.yawRate) * (1 - Math.exp(-dt * 6 * (this.onGround ? 1 : 0.15)));
    this.yaw += this.yawRate * dt;

    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    this.vel.x = nfx * vf + nfz * vl;
    this.vel.z = nfz * vf - nfx * vl;

    if (this.onGround && !parked) {
      const n = this.normal;
      this.vel.x += n.x * G * 0.5 * dt;
      this.vel.z += n.z * G * 0.5 * dt;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.collideTrees();

    const h = this.world.heightAt(this.pos.x, this.pos.z);
    this.vel.y -= G * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= h) {
      this.pos.y = h;
      this.vel.y = clamp((h - this.lastGround) / dt, -30, 9);
      this.onGround = true;
      this.world.normalAt(this.pos.x, this.pos.z, this.normal);
    } else {
      this.onGround = this.pos.y - h < 0.12;
      if (this.onGround) this.world.normalAt(this.pos.x, this.pos.z, this.normal);
    }
    this.lastGround = h;
  }

  // Glance off tree trunks: push out, kill the velocity into the trunk, scrub speed.
  collideTrees() {
    const trunks = this.world.gen.trunksNear(this.pos.x, this.pos.z, this.trunkBuf || (this.trunkBuf = []));
    for (const t of trunks) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const d = Math.hypot(dx, dz), min = t.r + 0.35;
      if (d >= min || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d;
      this.pos.x = t.x + nx * min;
      this.pos.z = t.z + nz * min;
      const vn = this.vel.x * nx + this.vel.z * nz;
      if (vn < 0) {
        this.vel.x -= nx * vn * 1.25;
        this.vel.z -= nz * vn * 1.25;
        this.vel.x *= 0.55;
        this.vel.z *= 0.55;
        this.bumped = performance.now();
      }
    }
  }

  orientation(out) {
    const up = this.smoothNormal;
    _fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    _fwd.addScaledVector(up, -_fwd.dot(up)).normalize();
    _right.crossVectors(up, _fwd);
    _m.makeBasis(_right, up, _fwd);
    return out.setFromRotationMatrix(_m);
  }

  applyTo(model) {
    model.position.set(this.pos.x, this.bodyY, this.pos.z);
    this.orientation(model.quaternion);
    const ud = model.userData;
    ud.lean.rotation.z = this.lean;
    ud.steerer.rotation.y = this.steer * 0.25 * Math.max(0.2, 1 - this.speed / 30);
    for (const w of ud.wheels) w.rotation.x = this.wheelSpin;
  }

  snapshot() {
    this.orientation(_q);
    const r = (v) => Math.round(v * 100) / 100;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      p: [r(this.pos.x), r(this.bodyY), r(this.pos.z)],
      q: [r3(_q.x), r3(_q.y), r3(_q.z), r3(_q.w)],
      l: r(this.lean),
      st: r(this.steer),
      v: r(this.forwardSpeed),
    };
  }
}
