import * as THREE from 'three';
import { BIKE } from './bike.js';
import { clamp } from '../world/generation/noise.js';

const G = 16;
const FIXED = 1 / 120;
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _lean = new THREE.Quaternion(), _axis = new THREE.Vector3(), _p = new THREE.Vector3();
const _e = new THREE.Euler(), _q2 = new THREE.Quaternion();

// Wheelies: hold the wheelie key above minSpeed. The meter drains while the
// front is up and recharges after a short rest. Steering is much weaker and
// the bike wobbles, in exchange for a small speed bonus.
export const WHEELIE = {
  minSpeed: 11,      // m/s (~40 km/h) to start one
  dropSpeed: 9,      // below this it comes down
  startMeter: 0.35,  // need at least this much charge to start
  drain: 0.28,       // per second while up (~3.5 s from full)
  recharge: 0.14,    // per second after the rest (~7 s to full)
  rest: 1.0,         // seconds before recharging starts
  angle: 0.42,       // radians of front lift (~24°)
};

// Roll (lean) plus wheelie pitch for the bike's leaning group, pivoting the
// pitch on the rear tyre's contact patch so the back wheel stays planted.
export function poseLean(lean, roll, pitch, rearZ) {
  lean.rotation.set(-pitch, 0, roll);
  _p.set(0, 0, rearZ).applyEuler(lean.rotation);
  lean.position.set(-_p.x, -_p.y, rearZ - _p.z);
}

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
    this.rideLift = 0.035;   // see update(): roads are drawn a little above the ground
    this.groundFit = 0;      // extra lift so no tyre sinks into a dip
    this.wheelSpin = 0;
    this.acc = 0;
    this.lastGround = 0;
    this.odometer = 0;
    this.surface = 1;        // 0 grass/open ground, 1 tarmac, 2 dirt
    this.prevY = 0;
    this.groundVy = 0;
    this.underwater = 0;     // seconds spent submerged
    // Physics ticks at a fixed 120 Hz; what we draw is interpolated between
    // the last two ticks so motion is smooth at any frame rate.
    // Hooks: the game sets these. constraint(pos, vel) keeps the bike inside
    // race barriers; events() receives { land, bump, wall } impacts for sound.
    this.constraint = null;
    this.onImpact = null;
    this.slip = 0;            // sideways sliding speed (m/s), for tyre sounds
    this.airTime = 0;
    this.braking = 0;
    this.wheelie = { active: false, meter: 1, rest: 0, angle: 0, t: 0 };
    this.prevPos = new THREE.Vector3();
    this.prevYaw = 0;
    this.renderPos = new THREE.Vector3();
    this.renderYaw = 0;
  }

  // Switch rides (bike / car): tuning only, the bike keeps its place and speed.
  setSpec(spec) {
    this.spec = spec;
    if (this.wheelie) { this.wheelie.active = false; this.wheelie.angle = 0; }
  }

  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  get forwardSpeed() { return this.vel.x * Math.sin(this.yaw) + this.vel.z * Math.cos(this.yaw); }

  // yHint: put it on the surface near that height (a checkpoint up on the
  // Skyway), not on the street under it
  place(x, z, yaw, yHint = null) {
    const y = yHint != null && this.world.groundAt ? this.world.groundAt(x, yHint + 0.5, z) : this.world.heightAt(x, z);
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
    this.prevPos.copy(this.pos);
    this.renderPos.copy(this.pos);
    if (this.wheelie) { this.wheelie.active = false; this.wheelie.angle = 0; }
    this.prevYaw = this.renderYaw = yaw;
    this.acc = 0;
    this.airPitch = this.airRoll = this.trajPitch = this.squash = 0;
  }

  // Height of the ground under (x, z) for something at height y: on the
  // island just the terrain; in the city also roofs and hard-light decks.
  ground(x, z, y) {
    return this.world.groundAt ? this.world.groundAt(x, y, z) : this.world.heightAt(x, z);
  }

  update(dt, input) {
    this.acc += Math.min(dt, 0.1);
    while (this.acc >= FIXED) {
      this.prevPos.copy(this.pos);
      this.prevYaw = this.yaw;
      this.step(FIXED, input);
      this.acc -= FIXED;
    }
    const a = this.acc / FIXED;
    this.renderPos.lerpVectors(this.prevPos, this.pos, a);
    let dyaw = this.yaw - this.prevYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    this.renderYaw = this.prevYaw + dyaw * a;
    this.smoothNormal.lerp(this.normal, 1 - Math.exp(-dt * 12)).normalize();
    // Suspension: a damped spring that tracks the wheels' height AND vertical
    // speed, so a steady climb settles at zero offset (no sinking into the
    // road) and only sudden changes in slope get softened.
    const gy = this.renderPos.y;
    if (dt > 0) {
      const vy = (gy - this.prevY) / dt;
      this.groundVy += (vy - this.groundVy) * (1 - Math.exp(-dt * 30));
    }
    this.prevY = gy;
    // heavier damping for a while after a big landing, so a 20 m drop
    // squats and settles once instead of bouncing
    const k = 220, c = 2 * Math.sqrt(k) * (1 + Math.min(1.5, this.squash * 6));
    this.bodyVy += ((gy - this.bodyY) * k + (this.groundVy - this.bodyVy) * c) * dt;
    this.bodyY += this.bodyVy * dt;
    // never sit below the road surface (except the squat of a hard landing),
    // and never float far above it
    this.squash = Math.max(0, (this.squash || 0) - dt * 0.8);
    if (this.bodyY < gy - 0.01 - this.squash) { this.bodyY = gy - 0.01 - this.squash; this.bodyVy = Math.max(this.bodyVy, this.groundVy); }
    // Road meshes are drawn 3 cm above the ground they follow (junction pads
    // 6 cm), so on a road the tyres ride a little higher to sit on the
    // tarmac rather than in it. Eased, so crossing onto grass isn't a step.
    const ride = this.surface === 0 ? 0.01 : 0.035;
    this.rideLift += (ride - this.rideLift) * (1 - Math.exp(-dt * 8));
    // In a dip, the ground under the tyres rises above the tilt plane through
    // the centre (more so on a long car): lift the body so none sinks in.
    let fit = 0;
    const n = this.smoothNormal, fx = Math.sin(this.renderYaw), fz = Math.cos(this.renderYaw);
    for (const [sx, sz] of this.spec.contacts || []) {
      const dx = fz * sx + fx * sz, dz = -fx * sx + fz * sz;
      const plane = gy - (n.x * dx + n.z * dz) / n.y;
      fit = Math.max(fit, this.ground(this.renderPos.x + dx, this.renderPos.z + dz, gy + 0.3) - plane);
    }
    this.groundFit += (Math.min(fit, 0.4) - this.groundFit) * (1 - Math.exp(-dt * 20));
    if (this.bodyY > gy + 0.35) this.bodyY = gy + 0.35;

    const vf = this.forwardSpeed;
    this.wheelSpin += (vf / (this.spec.wheelR || 0.31)) * dt;
    this.odometer += Math.abs(vf) * dt;
    // lean from the centripetal demand of the turn: tan(lean) = v * yawRate / g
    // (a car rolls a little the other way: spec.lean scales and flips it)
    const target = clamp(-Math.atan((this.yawRate * Math.abs(vf)) / 9.8) * 0.85, -0.62, 0.62) * (this.spec.lean ?? 1);
    this.lean += (target - this.lean) * (1 - Math.exp(-dt * 5));
    // front wheel up / down
    const w = this.wheelie;
    const lift = w.active ? WHEELIE.angle + 0.05 * Math.sin(w.t * 3.1) : 0;
    w.angle += (lift - w.angle) * (1 - Math.exp(-dt * (w.active ? 4 : 7)));
    // back on the ground: any mid-air pitch and roll settles out
    if (this.onGround) {
      const settle = Math.exp(-dt * 9);
      this.airPitch *= settle; this.airRoll *= settle; this.trajPitch *= settle;
    }
  }

  step(dt, input) {
    const s = this.spec;
    if (this.frozen) { this.vel.set(0, 0, 0); this.yawRate = 0; return; }
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let vf = this.vel.x * fx + this.vel.z * fz;
    let vl = this.vel.x * fz - this.vel.z * fx;

    // wheelie: start, keep up, or drop
    const w = this.wheelie;
    if (w.active) {
      if (!input.wheelie || input.brake > 0 || vf < WHEELIE.dropSpeed || w.meter <= 0) this.endWheelie();
    } else if (input.wheelie && s.wheelie !== false && this.onGround && vf > WHEELIE.minSpeed && !input.brake && w.meter >= WHEELIE.startMeter && w.rest <= 0) {
      w.active = true;
    }
    if (w.active) {
      w.meter = Math.max(0, w.meter - WHEELIE.drain * dt);
      w.t += dt;
    } else {
      w.rest = Math.max(0, w.rest - dt);
      if (w.rest <= 0) w.meter = Math.min(1, w.meter + WHEELIE.recharge * dt);
    }

    const steerTarget = input.steer;
    const rate = (Math.abs(steerTarget) > Math.abs(this.steer) ? 3.2 : 6) * (w.active ? 0.5 : 1);
    this.steer += (steerTarget - this.steer) * (1 - Math.exp(-dt * rate));

    this.surface = this.world.surfaceAt(this.pos.x, this.pos.z);
    this.onRoad = this.surface !== 0;
    const traction = this.onGround ? 1 : 0.04;
    const wet = this.pos.y < -0.5;   // riding into the sea or a lake
    const top = s.maxSpeed * (this.surface === 1 ? 1 : this.surface === 2 ? s.dirtTop : s.offTop) * (wet ? 0.25 : 1) * (w.active ? 1.06 : 1) * (this.boost ?? 1);

    if (input.throttle > 0) {
      if (vf < -0.5) vf += s.brake * input.throttle * dt * traction;
      else vf += s.accel * (w.active ? 1.12 : 1) * (this.boost ?? 1) * input.throttle * Math.max(0, 1 - (vf / top) ** 2) * dt * traction;
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
    // Car at speed: the handbrake kicks the tail out into a drift you hold
    // with the steering, losing little speed; grip comes back gradually as
    // you let go. Otherwise (bike, or slow) it's a sliding rear brake.
    const drifting = s.wheelie === false && input.handbrake && vf > 12 && Math.abs(input.steer) > 0.15;
    this.drift = Math.max(0, Math.min(1, (this.drift || 0) + (drifting ? dt * 4 : -dt * 1.6)));
    if (this.drift > 0) {
      grip = grip + ((s.driftGrip ?? 0.9) - grip) * this.drift;
      vf -= vf * 0.09 * this.drift * dt;
    }
    if (input.handbrake && !drifting) { grip = Math.min(grip, s.handbrakeGrip); vf -= vf * 0.5 * dt; }
    if (w.active) grip *= 0.8;
    grip *= this.world.gripScale ?? 1;   // wet roads and snow
    vl *= Math.exp(-grip * traction * dt);
    this.slip = this.onGround ? Math.abs(vl) : 0;
    this.braking = this.onGround && vf > 2 ? Math.max(input.brake, input.handbrake ? 0.7 : 0) : 0;

    const sp = Math.abs(vf);
    const steerAmt = this.steer * s.steer * Math.min(1, sp / 3) / (1 + sp / 36) * (w.active ? 0.2 : 1);
    let target = steerAmt * Math.sign(vf) * (input.handbrake ? 1.3 : 1) * (1 + (this.drift || 0) * 0.6);
    if (w.active) {
      // balancing on the back wheel: a wandering tug you have to correct
      const t = w.t;
      target += (Math.sin(t * 2.3) + 0.6 * Math.sin(t * 5.1 + 1) + 0.4 * Math.sin(t * 8.7 + 2)) * 0.16 * Math.min(1, sp / 20);
    }
    this.yawRate += (target - this.yawRate) * (1 - Math.exp(-dt * 6 * (this.onGround ? 1 : 0.15)));
    this.yaw += this.yawRate * dt;

    const nfx = Math.sin(this.yaw), nfz = Math.cos(this.yaw);
    this.vel.x = nfx * vf + nfz * vl;
    this.vel.z = nfz * vf - nfx * vl;
    if (this.drift > 0) {
      // in a drift the car keeps going where it was heading while the body
      // swings round; the (low) side grip then pulls the path round after it
      const m = this.drift * 0.7;
      this.vel.x += (fx * vf + fz * vl - this.vel.x) * m;
      this.vel.z += (fz * vf - fx * vl - this.vel.z) * m;
    }

    if (this.onGround && !parked) {
      const n = this.normal;
      this.vel.x += n.x * G * 0.5 * dt;
      this.vel.z += n.z * G * 0.5 * dt;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.collideTrees();
    if (this.world.boxesNear) this.collideBoxes();
    if (this.constraint) {
      const hit = this.constraint(this.pos, this.vel);
      if (hit > 0) {
        // turn the bike to run along the wall instead of into it
        const along = Math.atan2(this.vel.x, this.vel.z);
        if (vf > 3) {
          let d = along - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
          this.yaw += d * 0.35;
          this.yawRate *= 0.5;
        }
        if (w.active && hit > 1) this.endWheelie();
      }
      if (hit > 0.5) this.onImpact?.('wall', hit);
    }

    const h = this.ground(this.pos.x, this.pos.z, this.pos.y);
    const wasOnGround = this.onGround;
    this.vel.y -= G * dt;
    this.pos.y += this.vel.y * dt;
    // Stay planted unless the ground really falls away: like real suspension,
    // the tyres follow small crests and dips instead of taking off.
    const stick = wasOnGround && this.pos.y - h < 0.25;
    if (this.pos.y <= h || stick) {
      // touching down after some air
      if (this.airTime > 0.25) this.land(h);
      this.airTime = 0;
      this.pos.y = h;
      this.onGround = true;
      this.world.normalAt(this.pos.x, this.pos.z, this.normal, this.pos.y + 0.2);
      // vertical speed from the slope we're driving along, not from how far the
      // ground moved since the last tick (a small step there used to fling
      // the bike up at 9 m/s)
      const n = this.normal;
      this.vel.y = clamp(-(n.x * this.vel.x + n.z * this.vel.z) / Math.max(0.3, n.y), -30, 9);
    } else {
      // In the air: the nose follows the arc a little on its own, and you
      // line up the landing yourself, W/S pitching the nose down/up and A/D
      // rolling. Keys still held from the takeoff don't count until let go,
      // so keeping W down off a ramp doesn't send you in nose-first.
      if (wasOnGround) this.airHeld = { w: input.throttle > 0, s: input.brake > 0, steer: Math.sign(input.steer) };
      const held = this.airHeld || (this.airHeld = { w: false, s: false, steer: 0 });
      if (held.w && !input.throttle) held.w = false;
      if (held.s && !input.brake) held.s = false;
      if (held.steer && Math.sign(input.steer) !== held.steer) held.steer = 0;
      this.onGround = false;
      this.airTime += dt;
      const hs = Math.hypot(this.vel.x, this.vel.z);
      this.trajPitch = 0.5 * Math.atan2(this.vel.y, Math.max(4, hs));
      const pitchIn = (held.s ? 0 : input.brake) - (held.w ? 0 : input.throttle);
      const rollIn = held.steer ? 0 : input.steer;
      this.airPitch = clamp(this.airPitch + pitchIn * 1.6 * dt, -1.1, 1.1);
      // (the spinning wheels slowly right a roll you've let go of)
      this.airRoll = clamp(this.airRoll - rollIn * 1.2 * dt, -0.8, 0.8);
      if (!rollIn) this.airRoll -= Math.sign(this.airRoll) * Math.min(Math.abs(this.airRoll), 0.5 * dt);
    }
    this.lastGround = h;
  }

  // Touching down. Landing level (lined up with the ground) keeps your speed;
  // landing nose-first, tail-first or rolled over costs some, and so does a
  // really heavy drop. The suspension squats to soak it up.
  land(h) {
    const impact = Math.max(0, -this.vel.y);
    this.world.normalAt(this.pos.x, this.pos.z, this.normal, h + 0.2);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw), n = this.normal;
    const groundPitch = Math.atan2(-(n.x * fx + n.z * fz), n.y);   // + = facing uphill
    const groundRoll = Math.atan2(-(n.x * fz - n.z * fx), n.y);    // the ground's tilt across you, same sense as airRoll
    const off = Math.abs(this.airPitch + this.trajPitch - groundPitch) + Math.abs(this.airRoll - groundRoll) * 0.5;
    const loss = Math.min(0.4, Math.max(0, off - 0.3) * 0.7 + Math.max(0, impact - 15) * 0.012);
    this.vel.x *= 1 - loss;
    this.vel.z *= 1 - loss;
    this.squash = Math.min(0.32, impact * 0.013);
    this.bodyVy = Math.min(this.bodyVy, -impact * 0.3);
    if (this.wheelie.active && off > 0.4) this.endWheelie();
    this.onImpact?.('land', Math.min(20, impact * (1 + off)));
    this.lastLanding = { impact, off, loss };
  }

  endWheelie() {
    this.wheelie.active = false;
    this.wheelie.rest = WHEELIE.rest;
  }

  // Glance off tree trunks: push out, kill the velocity into the trunk, scrub speed.
  collideTrees() {
    const trunks = this.world.gen.trunksNear(this.pos.x, this.pos.z, this.trunkBuf || (this.trunkBuf = []));
    for (const t of trunks) {
      const dx = this.pos.x - t.x, dz = this.pos.z - t.z;
      const d = Math.hypot(dx, dz), min = t.r + (this.spec.radius || 0.35);
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
        if (this.wheelie.active) this.endWheelie();
        if (-vn > 1) this.onImpact?.('tree', -vn);
      }
    }
  }

  // Buildings and other solid boxes (the city): a few circles along the
  // vehicle are pushed out of any box they overlap, the speed into the wall
  // is taken away, and the vehicle turns to scrape along it.
  collideBoxes() {
    const boxes = this.world.boxesNear(this.pos.x, this.pos.z, this.boxBuf || (this.boxBuf = []));
    if (!boxes.length) return;
    const r = this.spec.radius || 0.35;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    let worst = 0;
    for (const off of this.spec.body || [0]) {
      for (const b of boxes) {
        if (b[4] != null && this.pos.y >= b[4] - 0.5) continue;
        const px = this.pos.x + fx * off, pz = this.pos.z + fz * off;
        const qx = clamp(px, b[0], b[2]), qz = clamp(pz, b[1], b[3]);
        const dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
        if (d >= r) continue;
        let nx, nz, push;
        if (d > 1e-4) { nx = dx / d; nz = dz / d; push = r - d; }
        else {
          // the centre got inside: out through the nearest side
          const sides = [[px - b[0], -1, 0], [b[2] - px, 1, 0], [pz - b[1], 0, -1], [b[3] - pz, 0, 1]];
          sides.sort((a, c) => a[0] - c[0]);
          [push, nx, nz] = sides[0];
          push += r;
        }
        this.pos.x += nx * push;
        this.pos.z += nz * push;
        const vn = this.vel.x * nx + this.vel.z * nz;
        if (vn < 0) {
          this.vel.x -= nx * vn;
          this.vel.z -= nz * vn;
          // scraping costs speed, more for a harder hit
          const keep = 1 - Math.min(0.35, -vn / 40);
          this.vel.x *= keep; this.vel.z *= keep;
          worst = Math.max(worst, -vn);
        }
      }
    }
    if (worst > 0) {
      // turn to run along the wall instead of into it
      const vf = this.vel.x * fx + this.vel.z * fz;
      if (vf > 3) {
        const along = Math.atan2(this.vel.x, this.vel.z);
        let d = along - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * 0.3;
        this.yawRate *= 0.6;
      }
      if (this.wheelie.active && worst > 3) this.endWheelie();
      if (worst > 1.5) this.onImpact?.('wall', worst);
    }
  }

  orientation(out, yaw = this.renderYaw) {
    const up = this.smoothNormal;
    _fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    _fwd.addScaledVector(up, -_fwd.dot(up)).normalize();
    _right.crossVectors(up, _fwd);
    _m.makeBasis(_right, up, _fwd);
    out.setFromRotationMatrix(_m);
    const pitch = (this.airPitch || 0) + (this.trajPitch || 0), roll = this.airRoll || 0;
    if (pitch || roll) out.multiply(_q2.setFromEuler(_e.set(-pitch, 0, roll)));
    return out;
  }

  applyTo(model) {
    model.position.set(this.renderPos.x, this.bodyY + this.rideLift + this.groundFit, this.renderPos.z);
    this.orientation(model.quaternion);
    const ud = model.userData;
    poseLean(ud.lean, this.lean, this.wheelie.angle, this.spec.rearZ);
    const sa = this.steer * (ud.steerers ? 0.45 : 0.25) * Math.max(0.2, 1 - this.speed / 30);
    for (const st of ud.steerers || [ud.steerer]) st.rotation.y = sa;
    for (const w of ud.wheels) w.rotation.x = this.wheelSpin;
  }

  snapshot() {
    this.orientation(_q);
    const r = (v) => Math.round(v * 100) / 100;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return {
      p: [r(this.pos.x), r(this.bodyY + this.rideLift + this.groundFit), r(this.pos.z)],
      q: [r3(_q.x), r3(_q.y), r3(_q.z), r3(_q.w)],
      l: r(this.lean),
      w: r(this.wheelie.angle),
      st: r(this.steer),
      v: r(this.forwardSpeed),
      u: [r(this.vel.x), r(this.vel.y), r(this.vel.z)],   // velocity, so others can predict where you are
    };
  }
}
