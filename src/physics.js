import * as THREE from 'three';
import { VEHICLES } from './vehicles.js';
import { clamp } from './world/noise.js';

const G = 18; // a bit above real gravity — feels better for arcade driving
const FIXED = 1 / 120;

// Arcade vehicle: planar motion with longitudinal drive and lateral grip,
// following the terrain height, able to leave the ground over crests.
export class Vehicle {
  constructor(world, type) {
    this.world = world;
    this.setType(type);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.yawRate = 0;
    this.steer = 0;
    this.onGround = true;
    this.onRoad = true;
    this.frozen = false;
    this.normal = new THREE.Vector3(0, 1, 0);
    this.smoothNormal = new THREE.Vector3(0, 1, 0);
    this.lean = 0;
    this.wheelSpin = 0;
    this.acc = 0;
    this.lastGround = 0;
  }

  setType(type) {
    this.type = type;
    this.spec = VEHICLES[type];
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
    this.lastGround = y;
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
    this.smoothNormal.lerp(this.normal, 1 - Math.exp(-dt * 10)).normalize();
    const vf = this.forwardSpeed;
    this.wheelSpin += (vf / (0.4)) * dt;
    if (this.spec.lean) {
      const target = clamp(-this.yawRate * Math.min(this.speed, 30) * 0.045, -0.7, 0.7);
      this.lean += (target - this.lean) * (1 - Math.exp(-dt * 6));
    }
  }

  step(dt, input) {
    const s = this.spec;
    if (this.frozen) {
      this.vel.set(0, 0, 0);
      this.yawRate = 0;
      return;
    }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const rx = fz, rz = -fx;
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vl = this.vel.x * rx + this.vel.z * rz;

    // steering eases in/out; less lock at speed
    const steerTarget = input.steer;
    this.steer += (steerTarget - this.steer) * (1 - Math.exp(-dt * (Math.abs(steerTarget) > Math.abs(this.steer) ? 6 : 10)));

    this.onRoad = this.world.isOnRoad(this.pos.x, this.pos.z);
    const traction = this.onGround ? 1 : 0.05;

    // drive
    const top = s.maxSpeed * (this.onRoad ? 1 : 0.78);
    if (input.throttle > 0) {
      if (vf < -0.5) vf += s.brake * input.throttle * dt * traction;
      else vf += s.accel * input.throttle * Math.max(0, 1 - vf / top) * dt * traction * 0.85;
    }
    if (input.brake > 0) {
      if (vf > 0.5) vf -= s.brake * input.brake * dt * traction;
      else vf -= s.reverse * input.brake * Math.max(0, 1 + vf / (s.maxSpeed * 0.3)) * dt * traction;
    }
    // resistance
    const drag = 0.06 + (this.onRoad ? 0 : s.offDrag) + 0.0009 * Math.abs(vf);
    if (this.onGround) vf -= vf * drag * dt + Math.sign(vf) * Math.min(Math.abs(vf), (input.throttle ? 0 : 0.5) * dt);

    // hold still when parked so slopes don't creep
    const parked = this.onGround && !input.throttle && !input.brake && Math.abs(vf) < 1.2;
    if (parked) vf *= Math.exp(-8 * dt);

    // lateral grip (drifting with handbrake)
    let grip = this.onRoad ? s.grip : s.offGrip;
    if (input.handbrake) { grip = s.handbrakeGrip; vf -= vf * 0.6 * dt; }
    vl *= Math.exp(-grip * traction * dt);

    // yaw
    const sp = Math.abs(vf);
    const steerAmt = this.steer * s.steer * Math.min(1, sp / 4) / (1 + sp / 38);
    const targetYawRate = steerAmt * Math.sign(vf) * (input.handbrake ? 1.35 : 1);
    this.yawRate += (targetYawRate - this.yawRate) * (1 - Math.exp(-dt * 8 * (this.onGround ? 1 : 0.1)));
    this.yaw += this.yawRate * dt;

    // rebuild velocity in the new heading
    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    this.vel.x = nfx * vf + nfz * vl;
    this.vel.z = nfz * vf - nfx * vl;

    // gravity pulls along slopes
    if (this.onGround && !parked) {
      const n = this.normal;
      this.vel.x += n.x * G * 0.55 * dt;
      this.vel.z += n.z * G * 0.55 * dt;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // vertical
    const h = this.world.heightAt(this.pos.x, this.pos.z);
    this.vel.y -= G * dt;
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= h) {
      this.pos.y = h;
      this.vel.y = clamp((h - this.lastGround) / dt, -30, 10);
      this.onGround = true;
      this.world.normalAt(this.pos.x, this.pos.z, this.normal);
    } else {
      this.onGround = this.pos.y - h < 0.08;
      if (this.onGround) this.world.normalAt(this.pos.x, this.pos.z, this.normal);
    }
    this.lastGround = h;
  }

  // Apply state to a model built by buildVehicleModel.
  applyTo(model) {
    model.position.copy(this.pos);
    const up = this.smoothNormal;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    fwd.sub(up.clone().multiplyScalar(fwd.dot(up))).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd);
    const m = new THREE.Matrix4().makeBasis(right, up, fwd);
    model.quaternion.setFromRotationMatrix(m);
    const ud = model.userData;
    if (ud.body) ud.body.rotation.z = this.lean;
    for (const w of ud.wheels || []) w.rotation.x = this.wheelSpin;
  }

  // Compact snapshot for the network.
  snapshot() {
    const q = new THREE.Quaternion();
    const up = this.smoothNormal;
    const fwd = new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    fwd.sub(up.clone().multiplyScalar(fwd.dot(up))).normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd);
    q.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
    const r = (v) => Math.round(v * 100) / 100;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      p: [r(this.pos.x), r(this.pos.y), r(this.pos.z)],
      q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)],
      l: r(this.lean),
      v: r(this.forwardSpeed),
      veh: this.type,
    };
  }
}
