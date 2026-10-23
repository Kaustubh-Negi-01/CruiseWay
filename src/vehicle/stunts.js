import * as THREE from 'three';

// Mid-air stunts for the island mega-event.
//
// In the air the controls turn into a stunt set, each axis with its own
// angular momentum (you spin up, and it carries on until you counter it):
//   W / S   pitch: frontflips and backflips
//   A / D   yaw: flat 360s
//   Q / E   roll: barrel rolls (with W / S: corkscrews)
//   Space   hold for a grab: points build faster while you hold it, but let
//           go before you touch down or you bail
// Keys already held at takeoff don't count until you let go of them, so
// holding the throttle off a ramp doesn't flip you.
//
// Every completed rotation adds to a combo. Near the ground, with no stunt
// keys held, an assist rights the ride. Landing upright converts the combo
// into an Overdrive boost; a sketchy landing keeps half and no boost; landing
// on your roof (or still grabbing) is a bail.

const TAU = Math.PI * 2;
const ACCEL = { x: 11, y: 9, z: 11 };   // rad/s² while a key is held
const MAXW = { x: 7, y: 7.5, z: 8 };     // rad/s
const DAMP = 1.2;                        // spin decay with no key held (1/s)
export const STUNT_POINTS = { flip: 1000, spin: 700, roll: 900, air: 60, grab: 350 };
const CLEAN = 0.6, SKETCHY = 1.05;       // landing tilt limits (rad)

const _dq = new THREE.Quaternion(), _ax = new THREE.Vector3();

export class Stunts {
  constructor() {
    this.q = new THREE.Quaternion();       // the ride's tilt relative to level, heading forward
    this.w = new THREE.Vector3();          // spin (local x pitch, y yaw, z roll)
    this.turned = new THREE.Vector3();     // how far it's turned about each axis this jump
    this.reset();
  }

  reset() {
    this.q.identity();
    this.w.set(0, 0, 0);
    this.turned.set(0, 0, 0);
    this.counts = { flipF: 0, flipB: 0, spin: 0, roll: 0 };
    this.tricks = [];        // names in order, for the HUD
    this.points = 0;         // this jump's points before the multiplier
    this.grabTime = 0;
    this.grabbing = false;
    this.airTime = 0;
    this.active = false;
    this.held = null;
  }

  takeoff(input) {
    this.reset();
    this.active = true;
    this.held = { w: input.throttle > 0, s: input.brake > 0, steer: Math.sign(input.steer), roll: Math.sign(input.roll || 0), grab: !!input.handbrake };
  }

  // the combo's multiplier: one more half for each kind of trick in it, and
  // up to +1.5 for a long grab
  get multiplier() {
    const c = this.counts;
    const kinds = (c.flipF || c.flipB ? 1 : 0) + (c.spin ? 1 : 0) + (c.roll ? 1 : 0);
    return 1 + Math.max(0, kinds - 1) * 0.5 + Math.min(1.5, this.grabTime * 0.5);
  }

  get total() { return Math.round(this.points * this.multiplier); }

  // one physics tick in the air; `toGround` is roughly how long until touchdown (s)
  air(dt, input, toGround) {
    if (!this.active) return;
    const h = this.held;
    if (h.w && !input.throttle) h.w = false;
    if (h.s && !input.brake) h.s = false;
    if (h.steer && Math.sign(input.steer) !== h.steer) h.steer = 0;
    if (h.roll && Math.sign(input.roll || 0) !== h.roll) h.roll = 0;
    if (h.grab && !input.handbrake) h.grab = false;
    const pitch = (h.w ? 0 : input.throttle) - (h.s ? 0 : input.brake);   // + = nose down (frontflip)
    const yaw = h.steer ? 0 : input.steer;                                   // + = left
    const roll = h.roll ? 0 : (input.roll || 0);                             // + = right
    this.grabbing = !h.grab && !!input.handbrake;
    const spin = (w, inp, a, max) => (inp ? Math.max(-max, Math.min(max, w + inp * a * dt)) : w * Math.exp(-DAMP * dt));
    this.w.x = spin(this.w.x, pitch, ACCEL.x, MAXW.x);
    this.w.y = spin(this.w.y, yaw, ACCEL.y, MAXW.y);
    this.w.z = spin(this.w.z, roll, ACCEL.z, MAXW.z);
    // the landing assist: about to touch down with no stunt keys held, it
    // stops the spin and rights the ride
    const keys = pitch || yaw || roll;
    if (!keys && toGround < 0.8) {
      const k = 1 - Math.exp(-dt * 7);
      this.w.multiplyScalar(1 - k);
      this.q.slerp(_dq.identity(), 1 - Math.exp(-dt * 4.5));
    }
    // turn (in the ride's own frame)
    const ang = this.w.length() * dt;
    if (ang > 1e-6) {
      _ax.copy(this.w).normalize();
      this.q.multiply(_dq.setFromAxisAngle(_ax, ang)).normalize();
    }
    this.count(this.w.x * dt, 'x');
    this.count(this.w.y * dt, 'y');
    this.count(this.w.z * dt, 'z');
    this.airTime += dt;
    this.points += STUNT_POINTS.air * dt;
    if (this.grabbing) { this.grabTime += dt; this.points += STUNT_POINTS.grab * dt; }
  }

  // add up rotation about one axis and score each full turn
  count(d, axis) {
    const before = this.turned[axis];
    this.turned[axis] += d;
    const n0 = Math.trunc(before / TAU), n1 = Math.trunc(this.turned[axis] / TAU);
    if (n1 === n0) return;
    const fwd = this.turned[axis] > 0;
    if (axis === 'x') {
      if (fwd) this.counts.flipF++; else this.counts.flipB++;
      this.add(fwd ? 'FRONTFLIP' : 'BACKFLIP', STUNT_POINTS.flip);
    } else if (axis === 'y') {
      this.counts.spin++;
      this.add('360', STUNT_POINTS.spin);
    } else {
      this.counts.roll++;
      // rolling and flipping in the same jump makes it a corkscrew
      this.add(Math.abs(this.w.x) > 1.5 ? 'CORKSCREW' : 'BARREL ROLL', STUNT_POINTS.roll * (Math.abs(this.w.x) > 1.5 ? 1.3 : 1));
    }
  }

  add(name, pts) {
    const last = this.tricks[this.tricks.length - 1];
    if (last && last.name === name) last.n++;
    else this.tricks.push({ name, n: 1 });
    this.points += pts;
  }

  // how far from upright and heading straight on (radians)
  get tilt() { return 2 * Math.acos(Math.min(1, Math.abs(this.q.w))); }

  // touching down: { result: 'clean' | 'sketchy' | 'bail' | 'none', points, tricks }
  land() {
    if (!this.active) return { result: 'none', points: 0, tricks: [] };
    const tilt = this.tilt;
    const tricks = this.tricks.map((t) => (t.n > 1 ? `${t.name} ×${t.n}` : t.name));
    let result = tilt < CLEAN ? 'clean' : tilt < SKETCHY ? 'sketchy' : 'bail';
    if (this.grabbing) result = 'bail';   // still grabbing
    const total = this.total;
    const points = result === 'clean' ? total : result === 'sketchy' ? Math.round(total * 0.5) : 0;
    const out = { result, points, tricks, airTime: this.airTime, grab: this.grabTime };
    this.reset();
    return out;
  }
}
