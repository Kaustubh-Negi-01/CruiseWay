import * as THREE from 'three';
import { ArenaWall } from './arena.js';
import { buzz } from '../mobile/mobile.js';

// Manhunt: tag with vehicles, at the purple arena spots.
//
// One rider is IT and chases the others; touching a runner passes IT on.
// The host picks the round length. Whoever is IT when time runs out loses,
// and everyone else wins. Play happens inside a holographic ring that
// shrinks over the round, and the IT gets a power-up every 15-20 s (E).
//
// The host decides everything that matters (tags, power-ups, the end) from
// the 15 Hz position snapshots, so all players see the same result.

export const HUNT = {
  minPlayers: 3,
  minutes: [3, 5, 8],
  r0: 520, r1: 110,       // zone radius at the start and at the end (m)
  shrinkAfter: 20,        // seconds before the zone starts closing
  tagDist: 3.6,           // metres between vehicle centres that count as a touch
  noTagBack: 3,           // seconds before the new IT may tag the one who tagged them
  itFreeze: 2,            // seconds a new IT must wait: a head start for runners
  startFreeze: 5,         // the first IT waits this long after GO
  power: [15, 20],        // seconds between the IT's power-ups
  hideBeyond: 150,        // the IT's minimap shows only runners this close (Radar shows all)
  danger: 70,             // runners get a warning when the IT is this close
};

export const POWERS = {
  nitro: { label: 'Nitro', icon: '🔥', secs: 4, text: 'a burst of speed' },
  radar: { label: 'Radar', icon: '📡', secs: 6, text: 'every runner revealed' },
  shock: { label: 'Shockwave', icon: '💥', secs: 3, radius: 60, text: 'slows runners within 60 m' },
};
const POWER_KINDS = Object.keys(POWERS);

// Zone radius t seconds after GO: holds, then closes steadily, reaching its
// smallest at 90% of the round.
export function zoneRadius(t, durS) {
  const a = HUNT.shrinkAfter, b = Math.max(a + 10, durS * 0.9);
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return HUNT.r0 + (HUNT.r1 - HUNT.r0) * x;
}

const randIn = ([a, b]) => (a + Math.random() * (b - a)) * 1000;

export class Manhunt {
  constructor(game) {
    this.g = game;
    this.r = null;          // the client view of the current hunt (also game.race)
  }

  // ---- host ----------------------------------------------------------------------

  // Called from Game.launchRace for a hunt lobby with enough riders.
  launch(hr) {
    const g = this.g;
    hr.participants = hr.members.filter((id) => g.players.has(id));
    hr.phase = 'spawn';
    hr.it = hr.participants[Math.floor(Math.random() * hr.participants.length)];
    hr.prevIt = null;
    hr.noTagBackUntil = 0;
    hr.itMs = new Map();
    hr.tags = new Map();
    hr.last = new Map();     // previous snapshot per player, for swept tag checks
    const spot = g.spotById(hr.spot), c = spot.route.at(spot.startS);
    hr.center = { x: c.x, z: c.z };
    hr.durationS = hr.minutes * 60;
    g.sendAll({ t: 'lobby', lobby: null });
    g.sendAll({
      t: 'hunt_start',
      hunt: { id: hr.id, spot: hr.spot, center: hr.center, durationS: hr.durationS, it: hr.it, participants: hr.participants, spawns: this.spawns(hr) },
    });
    hr.readyTimer = setTimeout(() => g.beginCountdown(), 8000);
  }

  // The IT starts in the middle; runners on roads in a ring 170-260 m out.
  spawns(hr) {
    const net = this.g.netOfSpot(hr.spot), out = {};
    const place = (x, z) => {
      const n = net.nearest(x, z, 200);
      return n ? [n.x, n.z, Math.atan2(n.tx, n.tz)] : [x, z, 0];
    };
    out[hr.it] = place(hr.center.x, hr.center.z);
    const runners = hr.participants.filter((id) => id !== hr.it);
    const turn = Math.random() * Math.PI * 2;
    runners.forEach((id, i) => {
      const a = turn + (i / runners.length) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const r = 170 + Math.random() * 90;
      out[id] = place(hr.center.x + Math.cos(a) * r, hr.center.z + Math.sin(a) * r);
    });
    return out;
  }

  // From Game.beginCountdown: the clock starts after the 3-2-1.
  countdown(hr) {
    const now = Date.now();
    hr.goAt = now + 3000;
    hr.endAt = hr.goAt + hr.durationS * 1000;
    hr.itSince = hr.goAt;
    hr.itFrozenUntil = hr.goAt + HUNT.startFreeze * 1000;
    hr.nextPower = hr.goAt + randIn(HUNT.power);
  }

  // Every network tick (15 Hz) on the host: tags, power-ups, time.
  hostTick() {
    const g = this.g, hr = g.hostRace;
    if (!hr || hr.mode !== 'hunt' || hr.phase !== 'running' || !hr.goAt) return;
    const now = Date.now();
    if (now < hr.goAt) return;
    if (now >= hr.endAt) { this.end(false); return; }
    const it = g.latest.get(hr.it), itPrev = hr.last.get(hr.it) || it;
    if (it && now >= hr.itFrozenUntil) {
      for (const id of hr.participants) {
        if (id === hr.it || !g.players.has(id)) continue;
        if (id === hr.prevIt && now < hr.noTagBackUntil) continue;
        const s = g.latest.get(id);
        if (!s) continue;
        const sPrev = hr.last.get(id) || s;
        // closest approach over the last tick, so fast passes still count
        if (sweptDist(itPrev.p, it.p, sPrev.p, s.p) < HUNT.tagDist && Math.abs(s.p[1] - it.p[1]) < 3) {
          this.tag(id, now);
          break;
        }
      }
    }
    for (const [id, s] of g.latest) hr.last.set(id, s);
    if (now >= hr.nextPower) {
      hr.nextPower = now + randIn(HUNT.power);
      g.sendAll({ t: 'hunt_power', id: hr.id, to: hr.it, kind: POWER_KINDS[Math.floor(Math.random() * POWER_KINDS.length)] });
    }
  }

  tag(victim, now) {
    const g = this.g, hr = g.hostRace, by = hr.it;
    hr.itMs.set(by, (hr.itMs.get(by) || 0) + (now - hr.itSince));
    hr.tags.set(by, (hr.tags.get(by) || 0) + 1);
    hr.prevIt = by;
    hr.it = victim;
    hr.itSince = now;
    hr.itFrozenUntil = now + HUNT.itFreeze * 1000;
    hr.noTagBackUntil = now + HUNT.noTagBack * 1000;
    hr.nextPower = Math.max(hr.nextPower, now + 8000);   // the new IT's first power-up comes a bit later
    g.sendAll({ t: 'hunt_tag', id: hr.id, it: victim, by });
  }

  hostHandle(from, msg) {
    const g = this.g, hr = g.hostRace;
    if (msg.t === 'hunt_minutes') {
      // only the host chooses the round length, while the lobby is open
      if (from !== g.selfId || !hr || hr.mode !== 'hunt' || hr.phase !== 'lobby') return;
      if (HUNT.minutes.includes(msg.m)) hr.minutes = msg.m;
      g.sendAll({ t: 'lobby', lobby: g.lobbyPub() });
    } else if (msg.t === 'hunt_use') {
      if (!hr || hr.id !== msg.id || hr.it !== from || msg.kind !== 'shock') return;
      g.sendAll({ t: 'hunt_shock', id: hr.id, x: +msg.x, z: +msg.z, by: from });
    }
  }

  // A player left mid-hunt: hand IT on if needed, and stop if too few remain.
  hostLeave(id) {
    const g = this.g, hr = g.hostRace;
    const active = hr.participants.filter((k) => g.players.has(k));
    if (active.length < 2) { this.end(true); return; }
    if (hr.it === id) {
      const now = Date.now();
      hr.it = active[Math.floor(Math.random() * active.length)];
      hr.itSince = now;
      hr.prevIt = null;
      hr.itFrozenUntil = now + HUNT.itFreeze * 1000;
      g.sendAll({ t: 'hunt_tag', id: hr.id, it: hr.it, by: null });
    }
    if (hr.phase === 'spawn' && hr.participants.every((k) => hr.ready.has(k) || !g.players.has(k))) g.beginCountdown();
  }

  end(cancelled) {
    const g = this.g, hr = g.hostRace;
    if (!hr) return;
    for (const t of ['lobbyTimer', 'readyTimer']) clearTimeout(hr[t]);
    const now = Date.now();
    if (!cancelled && hr.it && hr.itSince) hr.itMs.set(hr.it, (hr.itMs.get(hr.it) || 0) + (now - hr.itSince));
    const loser = cancelled ? null : hr.it;
    const winners = cancelled ? [] : hr.participants.filter((id) => id !== loser && g.players.has(id));
    for (const id of winners) g.players.get(id).wins++;
    g.hostRace = null;
    g.sendAll({
      t: 'hunt_end', id: hr.id, spot: hr.spot, loser, winners, cancelled,
      stats: hr.participants.map((id) => ({ id, itMs: hr.itMs?.get(id) || 0, tags: hr.tags?.get(id) || 0, left: !g.players.has(id) })),
    });
    g.sendAll({ t: 'roster', list: g.rosterList() });
  }

  // ---- every player -----------------------------------------------------------------

  clientHandle(msg) {
    const g = this.g;
    if (msg.t === 'hunt_start') { this.start(msg.hunt); return; }
    const r = this.r;
    if (!r || r.id !== msg.id) return;
    const me = g.selfId, now = performance.now();
    const name = (id) => g.players.get(id)?.name || 'Someone';
    if (msg.t === 'hunt_tag') {
      r.it = msg.it;
      if (msg.it !== me) this.power = null;
      if (msg.it === me && r.participant) {
        this.frozenUntil = now + HUNT.itFreeze * 1000;
        g.ui.flash(msg.by ? `TAGGED! You're IT` : `You're IT now`);
        buzz(120);
        g.sound?.countdown('GO');
      } else if (msg.by === me) {
        g.ui.flash(`Tagged ${name(msg.it)}!`);
        buzz(60);
        g.sound?.finish(false);
      } else {
        g.ui.toast(msg.by ? `${name(msg.by)} tagged ${name(msg.it)}` : `${name(msg.it)} is IT now`);
      }
      this.markIt();
    } else if (msg.t === 'hunt_power') {
      if (msg.to !== me || !r.participant) return;
      this.power = msg.kind;
      const p = POWERS[msg.kind];
      g.ui.flash(`${p.icon} ${p.label} ready · ${document.body.classList.contains('mobile') ? 'tap it' : 'press E'}`);
      buzz(30);
      g.sound?.checkpoint();
    } else if (msg.t === 'hunt_shock') {
      if (g.map === g.mapOfSpot(r.spot.id)) this.ring(msg.x, msg.z);
      if (r.participant && r.it !== me && Math.hypot(g.car.pos.x - msg.x, g.car.pos.z - msg.z) < POWERS.shock.radius) {
        this.slowUntil = now + POWERS.shock.secs * 1000;
        g.ui.flash('💥 Shockwave! Slowed down');
      }
    } else if (msg.t === 'hunt_end') {
      this.finish(msg);
    }
  }

  start(h) {
    const g = this.g;
    if (g.race?.zen) return;   // riding Zen Parkour: a hunt elsewhere leaves you be
    g.ui.closeSpotPrompt();
    this.cleanup();
    const spot = g.spotById(h.spot);
    const participant = h.participants.includes(g.selfId) && g.map === g.mapOfSpot(h.spot);
    this.r = g.race = {
      mode: 'hunt', id: h.id, spot, participant, phase: participant ? 'spawn' : 'spectate',
      it: h.it, center: h.center, durationS: h.durationS, startTime: 0, participants: h.participants,
    };
    this.power = null;
    this.frozenUntil = 0;
    this.nitroUntil = this.radarUntil = this.slowUntil = 0;
    this.started = false;
    this.itBeam = makeBeam(0xff2b4a, 1.0, 70);
    g.scene.add(this.itBeam);
    this.radarBeams = [];
    this.rings = [];
    if (participant) {
      g.nav = null;
      this.wall = new ArenaWall(g.scene, h.center, g.world);
      g.car.constraint = (pos, vel) => this.wall.constrain(pos, vel, this.radius());
      const [x, z, yaw] = h.spawns[g.selfId];
      g.placeAt({ x, z }, yaw);
      g.car.frozen = true;
      const mins = Math.round(h.durationS / 60);
      g.ui.toast(h.it === g.selfId
        ? `Manhunt · ${mins} min · You're IT! You start after the others get a ${HUNT.startFreeze}s head start.`
        : `Manhunt · ${mins} min · ${g.players.get(h.it)?.name || 'Someone'} is IT. Get away!`);
      setTimeout(() => g.toHost({ t: 'race_ready', id: h.id }), 600);
    } else {
      g.ui.toast(`A Manhunt is on at ${spot.name}.`);
    }
    this.markIt();
  }

  // We changed worlds while a hunt is on: its markers come along.
  moveTo(scene) {
    for (const b of [this.itBeam, ...(this.radarBeams || []), ...(this.rings || [])]) if (b) scene.add(b);
  }

  // zone radius right now
  radius() {
    const r = this.r;
    if (!r || r.phase !== 'running' || !r.startTime) return HUNT.r0;
    return zoneRadius((performance.now() - r.startTime) / 1000, r.durationS);
  }

  usePower() {
    const g = this.g, r = this.r;
    if (!r || !r.participant || r.phase !== 'running' || r.it !== g.selfId || !this.power) return;
    const kind = this.power, p = POWERS[kind], now = performance.now();
    this.power = null;
    if (kind === 'nitro') this.nitroUntil = now + p.secs * 1000;
    if (kind === 'radar') this.radarUntil = now + p.secs * 1000;
    if (kind === 'shock') g.toHost({ t: 'hunt_use', id: r.id, kind, x: g.car.pos.x, z: g.car.pos.z });
    g.ui.flash(`${p.icon} ${p.label}!`);
    g.sound?.checkpoint();
  }

  // every frame
  update(now, dt) {
    const g = this.g, r = this.r;
    if (!r) return;
    if (r.participant && r.phase === 'running' && r.startTime && !this.started) {
      this.started = true;
      if (r.it === g.selfId) this.frozenUntil = r.startTime + HUNT.startFreeze * 1000;
    }
    if (r.participant && r.phase === 'running') {
      const frozen = now < this.frozenUntil;
      if (g.car.frozen !== frozen) g.car.frozen = frozen;
      g.car.boost = (now < this.nitroUntil ? 1.4 : 1) * (now < this.slowUntil ? 0.55 : 1);
    }
    this.wall?.update(now, dt, this.radius(), g.camera.position);
    // the IT's beacon, and radar beams over runners
    const itP = this.posOf(r.it);
    this.itBeam.visible = !!itP && r.it !== g.selfId;
    if (itP) this.itBeam.position.set(itP.x, itP.y, itP.z);
    const radar = r.it === g.selfId && now < this.radarUntil;
    let n = 0;
    if (radar) {
      for (const id of r.participants) {
        if (id === g.selfId) continue;
        const p = this.posOf(id);
        if (!p) continue;
        let b = this.radarBeams[n];
        if (!b) { b = makeBeam(0xffd84a, 0.7, 50); g.scene.add(b); this.radarBeams.push(b); }
        b.visible = true;
        b.position.set(p.x, p.y, p.z);
        n++;
      }
    }
    for (let i = n; i < this.radarBeams.length; i++) this.radarBeams[i].visible = false;
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      ring.userData.t += dt;
      const k = ring.userData.t / 0.7;
      ring.scale.setScalar(1 + k * POWERS.shock.radius);
      ring.material.opacity = Math.max(0, 0.8 * (1 - k));
      if (k >= 1) { ring.parent?.remove(ring); ring.geometry.dispose(); ring.material.dispose(); this.rings.splice(i, 1); }
    }
    // runners: warning when the IT is close
    const dIt = itP && r.it !== g.selfId ? Math.hypot(itP.x - g.car.pos.x, itP.z - g.car.pos.z) : null;
    const danger = r.participant && r.phase === 'running' && dIt != null && dIt < HUNT.danger;
    if (danger !== this.danger) { this.danger = danger; document.body.classList.toggle('hunt-danger', danger); }
    this.dIt = dIt;
  }

  posOf(id) {
    const g = this.g;
    if (id === g.selfId) return g.model?.position;
    return g.players.get(id)?.ghost?.position || null;
  }

  // Which other riders the minimap should show: the IT only sees nearby
  // runners unless Radar is on.
  visibleOthers(list) {
    const g = this.g, r = this.r;
    if (!r || !r.participant || r.phase !== 'running' || r.it !== g.selfId || performance.now() < this.radarUntil) return list;
    return list.filter((o) => Math.hypot(o.x - g.car.pos.x, o.z - g.car.pos.z) < HUNT.hideBeyond);
  }

  // what the HUD shows
  hudState() {
    const g = this.g, r = this.r;
    if (!r) return null;
    const now = performance.now();
    const left = r.phase === 'running' && r.startTime ? Math.max(0, r.durationS - (now - r.startTime) / 1000) : r.durationS;
    return {
      participant: r.participant, spot: r.spot, phase: r.phase,
      isIt: r.it === g.selfId, itName: g.players.get(r.it)?.name || '…',
      left, radius: this.radius(), dIt: this.dIt,
      frozen: Math.max(0, (this.frozenUntil - now) / 1000),
      power: this.power ? POWERS[this.power] : null,
      active: [['nitro', this.nitroUntil], ['radar', this.radarUntil], ['slowed', this.slowUntil]].filter(([, t]) => now < t).map(([k, t]) => [k, (t - now) / 1000]),
      zone: { x: r.center.x, z: r.center.z, r: this.radius() },
    };
  }

  ring(x, z) {
    const g = this.g;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 64).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    ring.position.set(x, g.world.heightAt(x, z) + 0.6, z);
    ring.userData.t = 0;
    g.scene.add(ring);
    this.rings.push(ring);
  }

  markIt() {
    const g = this.g;
    for (const p of g.players.values()) p.isIt = this.r && p.id === this.r.it;
  }

  finish(msg) {
    const g = this.g, r = this.r;
    this.cleanup();
    if (!g.race?.zen) g.race = null;
    this.r = null;
    g.ui.raceStandings(null);
    if (!r || !r.participant) return;
    if (msg.cancelled) { g.ui.toast('The Manhunt was called off.'); return; }
    const won = msg.winners.includes(g.selfId);
    g.sound?.finish(won);
    const rows = msg.stats.map((s) => {
      const p = g.players.get(s.id);
      return { ...s, name: p?.name || 'Left', color: p?.color || '#888', me: s.id === g.selfId, lost: s.id === msg.loser };
    }).sort((a, b) => (a.lost - b.lost) || (a.itMs - b.itMs));
    g.ui.huntResults(r.spot, rows, won);
  }

  cleanup() {
    const g = this.g;
    this.wall?.dispose();
    this.wall = null;
    for (const b of [this.itBeam, ...(this.radarBeams || []), ...(this.rings || [])]) {
      if (!b) continue;
      b.parent?.remove(b);
      b.geometry.dispose();
      b.material.dispose();
    }
    this.itBeam = null;
    this.radarBeams = [];
    this.rings = [];
    if (g.car) { g.car.constraint = null; g.car.frozen = false; g.car.boost = 1; }
    document.body.classList.remove('hunt-danger');
    this.danger = false;
    for (const p of g.players?.values() || []) p.isIt = false;
  }
}

// A tall glowing column, used to mark the IT (red) and Radar targets (gold).
function makeBeam(color, radius, height) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 12, 1, true).translate(0, height / 2, 0),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false, toneMapped: false }),
  );
  m.frustumCulled = false;
  m.visible = false;
  return m;
}

// Closest distance between two points each moving in a straight line over
// one tick (a0->a1 and b0->b1), on the ground plane.
function sweptDist(a0, a1, b0, b1) {
  const rx = b0[0] - a0[0], rz = b0[2] - a0[2];
  const vx = (b1[0] - a1[0]) - rx, vz = (b1[2] - a1[2]) - rz;
  const vv = vx * vx + vz * vz;
  const t = vv > 1e-6 ? Math.min(1, Math.max(0, -(rx * vx + rz * vz) / vv)) : 1;
  return Math.hypot(rx + vx * t, rz + vz * t);
}
