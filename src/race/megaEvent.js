import { MegaProps } from './megaProps.js';
import { RaceMarkers } from './markers.js';
import { Stunts } from '../vehicle/stunts.js';
import { MEGA } from '../world/generation/megaCircuit.js';

// The island mega-event, as the game runs it (see megaCircuit.js for the
// circuit and megaProps.js for its ramps and pads).
//
// Two ways to ride it from its flag:
//  - Zen Parkour, just you: no timer, no walls, nothing to lose, the sky held
//    at golden hour. R puts you back at the last checkpoint and F back at the
//    run-up of the last ramp you jumped, both already rolling, to try it again.
//  - Parkour Race, with whoever joins the lobby: the normal race flow (gates,
//    walls, results), scored on time minus stunt points (1,000 points take a
//    second off).
// Either way the stunt controls are on in the air, landing a combo cleanly
// turns it into an Overdrive boost, and resets put you back already moving.

export const CRUISE = 80 / 3.6;              // m/s you're moving at after a reset
export const POINTS_PER_SECOND = 1000;       // stunt points that take 1 s off a race time
const ZEN_DAY = 0.49;                        // day fraction (~17:45): golden hour

// what you get for landing a combo: an instant kick, then a stronger engine for a while
const overdrive = (pts) => ({ kick: Math.min(28, 4 + pts / 450), ms: Math.min(6000, 1500 + pts * 0.6) });

export function startEvent(g, spot, mode) {
  endEvent(g);
  const props = new MegaProps(g.scene, spot.circuit, (x, z) => g.island.heightAt(x, z));
  g.island.extraGround = props;
  const ev = (g.event = { mode, spot, props, points: 0, boostUntil: 0, lastRamp: null, banner: null });
  const c = g.car;
  c.stunt = new Stunts();
  c.event = {
    gentle: mode === 'zen',
    padAt: (p) => props.padAt(p),
    keepOn: (p, v) => props.keepOn(p, v),
    launchFrom: (p, v) => {
      const ramp = props.launchFrom(p, v);
      return ramp && g.race && Math.abs(g.race.progressS - ramp.s) < 400 ? ramp : null;
    },
    onPad: (pad) => {
      // a booster: up to speed at once (more on a ramp's run-up), and a short surge
      const target = pad.ramp ? 46 : 40, f = c.forwardSpeed;
      if (f < target) addSpeed(c, target - f);
      ev.boostUntil = Math.max(ev.boostUntil, performance.now() + 1400);
      g.sound?.checkpoint();
    },
    onLaunch: (ramp) => { ev.lastRamp = ramp; },
    onLand: (res) => {
      let od = null;
      if (res.result === 'clean' && res.points >= 150) {
        od = overdrive(res.points);
        addSpeed(c, od.kick);
        ev.boostUntil = Math.max(ev.boostUntil, performance.now() + od.ms);
        g.sound?.checkpoint();
      }
      ev.points += res.points;
      if (g.race) g.race.stuntPoints = ev.points;
      ev.banner = { ...res, overdrive: !!od, until: performance.now() + 2200 };
    },
  };
  if (mode === 'zen') {
    g.climate.force('clear');
    g.zenDay = null;
  }
}

export function endEvent(g) {
  const ev = g.event;
  if (!ev) return;
  ev.props.dispose();
  if (g.island) g.island.extraGround = null;
  const c = g.car;
  c.stunt = null;
  c.event = null;
  c.flight = null;
  c.boost = 1;
  if (ev.mode === 'zen') g.climate.force(g.clearSkies ? 'clear' : null);
  g.event = null;
  g.ui.stunts(null);
}

// every frame while the event is on
export function updateEvent(g, dt) {
  const ev = g.event;
  if (!ev) return;
  ev.props.update(dt);
  const now = performance.now(), c = g.car;
  c.boost = now < ev.boostUntil ? 1.4 : 1;
  const st = c.stunt;
  g.ui.stunts({
    air: st?.active && c.airTime > 0.3 ? { tricks: st.tricks, points: Math.round(st.points), mult: st.multiplier, grab: st.grabbing } : null,
    banner: ev.banner && now < ev.banner.until ? ev.banner : null,
    overdrive: now < ev.boostUntil ? (ev.boostUntil - now) / 1000 : 0,
    total: ev.points,
  });
}

// golden hour and fair weather for Zen Parkour (this screen only)
export function zenSky(g, w, dt) {
  if (g.event?.mode !== 'zen') return;
  g.zenDay ??= w.day;
  let d = ZEN_DAY - g.zenDay;
  d -= Math.round(d);   // the short way round the clock
  g.zenDay += d * Math.min(1, dt * 0.8);
  w.day = ((g.zenDay % 1) + 1) % 1;
  w.cover = 0; w.wet = 0;
  w.fog = Math.min(w.fog, 0.0003);
}

// Zen Parkour: a run of the circuit just for you, no lobby
export function startZen(g, spot) {
  if (g.race) return;
  g.ui.closeSpotPrompt();
  g.nav = null;
  g.race = {
    id: 'zen-' + Date.now(), zen: true, mode: 'race', spot, participant: true, phase: 'running',
    next: 0, startTime: performance.now(), finished: false, progressS: spot.startS, wrongWay: 0, standings: [],
  };
  g.markers?.dispose();
  g.markers = new RaceMarkers(g.scene, spot, spot.half);
  g.markers.setTarget(1);
  startEvent(g, spot, 'zen');
  const p = spot.route.at(spot.startS);
  g.placeAt({ ...p, s: spot.startS }, Math.atan2(p.tx, p.tz));
  g.ui.zen(true, () => endZen(g, 'Zen Parkour over.'));
  g.ui.toast('Zen Parkour: no timer, nothing to lose. R: last checkpoint · F: back to the last ramp');
}

export function endZen(g, msg) {
  if (!g.race?.zen) return;
  const pts = g.event?.points || 0;
  g.markers?.dispose();
  g.markers = null;
  g.race = null;
  endEvent(g);
  g.ui.zen(false);
  g.ui.toast(`${msg} ${pts.toLocaleString()} stunt points.`);
}

// back at a point on the circuit, already rolling
export function respawnMoving(g, s) {
  const r = g.race, route = r.spot.route;
  const p = route.at(s);
  const yaw = Math.atan2(p.tx, p.tz);
  g.placeAt({ ...p, s }, yaw);
  g.car.vel.set(Math.sin(yaw) * CRUISE, 0, Math.cos(yaw) * CRUISE);
}

// F in Zen Parkour: to the run-up of the last ramp you jumped, to have another go
export function rewindToRamp(g) {
  const r = g.race, ev = g.event;
  if (!r?.zen || !ev) return;
  const ramp = ev.lastRamp;
  if (!ramp) { g.ui.toast('Jump a ramp first: F brings you back to its run-up.'); return; }
  const s = Math.max(r.spot.startS, ramp.s - MEGA.runUp);
  r.progressS = s;
  r.next = r.spot.checkpoints.filter((c) => c <= s + 1).length;
  g.markers?.setTarget(r.next + 1);
  respawnMoving(g, s);
}

function addSpeed(c, dv) {
  c.vel.x += Math.sin(c.yaw) * dv;
  c.vel.z += Math.cos(c.yaw) * dv;
}
