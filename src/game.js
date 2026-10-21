import * as THREE from 'three';
import { World } from './world/world.js';
import { Environment } from './world/sky.js';
import { Bike } from './physics.js';
import { buildBike, ghostify, disposeModel, PALETTE as COLORS } from './bike.js';
import { RaceMarkers } from './markers.js';

const SEND_HZ = 15;
const INTERP_DELAY = 140; // ms behind newest snapshot when rendering ghosts
const CP_RADIUS = 20;
const INVITE_SECONDS = 15;
const FINISH_GRACE = 60; // seconds others get after the winner crosses

// Game owns the 3D scene, the local car, the ghosts, and the session
// protocol. The host runs the authoritative copy of the roster and races;
// every message to clients also runs locally on the host (see sendAll), and
// every message to the host is handled locally when we are the host (toHost).
export class Game {
  constructor(canvas, ui, input) {
    this.ui = ui;
    this.input = input;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.1, 6000);
    this.camMode = 0;
    this.running = false;
    this.previewing = false;
    addEventListener('resize', () => this.resize());
    this.resize();

    input.on('reset', (d) => d && this.running && this.resetCar());
    input.on('camera', (d) => { if (d) this.camMode = (this.camMode + 1) % 3; });
  }

  // Build (or reuse) the world for a seed: scene, terrain, sky, the bike.
  loadWorld(seed, color = COLORS[0]) {
    if (this.world && this.world.seed === seed) {
      this.setModel(color);
      return;
    }
    this.disposeWorld();
    const scene = (this.scene = new THREE.Scene());
    this.world = new World(scene, seed);
    this.env = new Environment(scene);
    this.car = new Bike(this.world);
    this.setModel(color);
    this.placeOnRoad(0, 1);
    this.camPos = null;
  }

  disposeWorld() {
    if (!this.world) return;
    this.markers?.dispose();
    this.markers = null;
    if (this.model) { this.scene.remove(this.model); disposeModel(this.model); this.model = null; }
    this.world.dispose();
    this.env.dispose();
    this.world = null;
    this.renderer.renderLists.dispose();
  }

  // Slow cinematic orbit behind the main menu.
  preview(seed) {
    this.loadWorld(seed);
    this.previewing = true;
    this.last = performance.now();
    this.orbit = 0;
    const loop = () => {
      if (!this.previewing) return;
      this.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.orbit += dt * 0.06;
      const c = this.car;
      const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const cam = c.pos.clone()
        .addScaledVector(fwd, Math.cos(this.orbit) * 7 - 2)
        .addScaledVector(side, Math.sin(this.orbit) * 7)
        .add(new THREE.Vector3(0, 1.6, 0));
      cam.y = Math.max(cam.y, this.world.heightAt(cam.x, cam.z) + 0.8);
      this.camera.position.copy(cam);
      this.camera.lookAt(c.pos.clone().addScaledVector(fwd, 30).add(new THREE.Vector3(0, 2.5, 0)));
      this.car.update(dt, { steer: 0, throttle: 0, brake: 0, handbrake: false });
      this.car.applyTo(this.model);
      this.world.update(this.car.pos);
      this.env.update(dt, this.car.pos);
      this.renderer.render(this.scene, this.camera);
    };
    cancelAnimationFrame(this.raf);
    loop();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- lifecycle ----------------------------------------------------------

  start({ net, seed, name, welcome }) {
    this.previewing = false;
    cancelAnimationFrame(this.raf);
    this.net = net;
    this.isHost = net.isHost;
    this.seed = seed;
    this.name = name;
    this.selfId = this.isHost ? net.id : welcome.you;
    this.hostId = this.isHost ? net.id : welcome.hostId;
    this.players = new Map(); // id -> { id, name, color, wins, ghost, buf }
    this.race = null;         // client-side race view
    this.hostRace = null;     // host-only authoritative race
    this.latest = new Map();  // host: id -> latest snapshot

    const myColor = this.isHost ? COLORS[0] : (welcome.roster.find((p) => p.id === welcome.you)?.color || COLORS[1]);
    this.loadWorld(seed, myColor);

    // spawn: host at the origin, guests just behind the host
    const s = welcome?.spawnS != null ? welcome.spawnS - 25 : 0;
    this.placeOnRoad(s, 1);
    this.camPos = null;
    this.car.odometer = 0;

    if (this.isHost) {
      this.players.set(this.selfId, { id: this.selfId, name, color: COLORS[0], wins: 0 });
      net.on('message', (from, msg) => this.hostHandle(from, msg));
      net.on('leave', (id) => this.hostLeave(id));
    } else {
      net.on('message', (_from, msg) => this.clientHandle(msg));
      net.on('hostLost', () => this.ui.fatal('The host closed the world.'));
      this.clientHandle({ t: 'roster', list: welcome.roster });
      if (welcome.race) this.clientHandle({ t: 'race_start', race: welcome.race, participants: welcome.race.participants, late: true });
    }
    this.ui.setRoster(this.rosterList(), this.selfId, this.hostId);

    // Network ticks run off a worker timer: unlike requestAnimationFrame it
    // keeps firing when the tab is in the background, so a host who tabs away
    // keeps relaying everyone else's positions.
    const src = `setInterval(() => postMessage(0), ${Math.round(1000 / SEND_HZ)});`;
    this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.ticker.onmessage = () => this.netTick();

    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  netTick() {
    if (!this.running) return;
    const snap = this.car.snapshot();
    if (this.isHost) {
      this.latest.set(this.selfId, snap);
      const list = [];
      for (const [id, s] of this.latest) list.push({ id, ...s });
      this.net.broadcast({ t: 'sts', list });
    } else {
      this.net.send({ t: 'st', ...snap });
    }
  }

  stop() {
    this.running = false;
    this.ticker?.terminate();
    cancelAnimationFrame(this.raf);
    if (this.isHost) this.net.broadcast({ t: 'bye' });
    this.net?.close();
    for (const p of this.players.values()) this.removeGhost(p);
    this.disposeWorld();
  }

  setModel(color) {
    if (this.model && this.modelColor === color) return;
    if (this.model) { this.scene.remove(this.model); disposeModel(this.model); }
    this.model = buildBike(color);
    this.modelColor = color;
    this.scene.add(this.model);
  }

  placeOnRoad(s, dir) {
    const p = this.world.road.at(s);
    this.world.preload(p.x, p.z);
    this.car.place(p.x, p.z, Math.atan2(p.tx * dir, p.tz * dir));
  }

  resetCar() {
    const r = this.race;
    if (r && r.participant) {
      if (r.phase !== 'running' || r.finished) return;
      const s = r.next > 0 ? r.cps[r.next - 1] : r.s0;
      this.placeOnRoad(s, r.dir);
      return;
    }
    const n = this.world.road.nearestAnywhere(this.car.pos.x, this.car.pos.z);
    const fwd = Math.sin(this.car.yaw) * n.tx + Math.cos(this.car.yaw) * n.tz;
    this.placeOnRoad(n.s, fwd >= 0 ? 1 : -1);
  }

  // ---- frame ----------------------------------------------------------------

  frame() {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    const inp = this.input.read();
    this.car.update(dt, inp);
    this.car.applyTo(this.model);
    this.world.update(this.car.pos);
    this.env.update(dt, this.car.pos);
    this.updateCamera(dt);
    this.updateGhosts(now);
    if (this.race) this.updateRace(now);
    if (this.markers) this.markers.update(now / 1000);

    this.ui.hud({
      speed: Math.abs(this.car.forwardSpeed) * 3.6,
      odometer: this.car.odometer,
      onRoad: this.car.onRoad,
      me: this.car.pos, yaw: this.car.yaw,
      others: [...this.players.values()].filter((p) => p.ghost).map((p) => ({ x: p.ghost.position.x, z: p.ghost.position.z, color: p.color, name: p.name })),
      race: this.race,
    });

    this.renderer.render(this.scene, this.camera);
  }

  updateCamera(dt) {
    const c = this.car, s = c.spec;
    // the chase camera swings round lazily, so turns read as the bike leaning in
    if (this.camYaw == null || this.camPos == null) this.camYaw = c.yaw;
    let dy = c.yaw - this.camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.camYaw += dy * (1 - Math.exp(-dt * 3.2));
    const fwd = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const bodyPos = new THREE.Vector3(c.pos.x, c.bodyY, c.pos.z);
    let want, look;
    if (this.camMode === 2) {
      const head = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      want = bodyPos.clone().addScaledVector(head, 0.35).add(new THREE.Vector3(0, 1.55, 0));
      look = want.clone().addScaledVector(head, 20).add(new THREE.Vector3(0, -1.2, 0));
      this.camPos = want.clone();
    } else {
      const far = this.camMode === 1 ? 1.8 : 1;
      want = bodyPos.clone().addScaledVector(fwd, -s.camDist * far).add(new THREE.Vector3(0, s.camHeight * far, 0));
      look = bodyPos.clone().addScaledVector(fwd, 6).add(new THREE.Vector3(0, 1.1, 0));
      if (!this.camPos) this.camPos = want.clone();
      // stay locked at a fixed distance (the yaw lag above gives the swing);
      // only height is smoothed so bumps don't jolt the view
      this.camPos.x = want.x;
      this.camPos.z = want.z;
      this.camPos.y += (want.y - this.camPos.y) * (1 - Math.exp(-dt * 8));
      const g = this.world.heightAt(this.camPos.x, this.camPos.z) + 0.6;
      if (this.camPos.y < g) this.camPos.y = g;
    }
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(look);
    const targetFov = 68 + Math.min(16, Math.abs(c.forwardSpeed) * 0.3);
    this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-dt * 3));
    this.camera.updateProjectionMatrix();
  }

  // ---- ghosts -----------------------------------------------------------------

  updateGhosts(now) {
    const renderT = now - INTERP_DELAY;
    for (const p of this.players.values()) {
      if (p.id === this.selfId || !p.buf || p.buf.length === 0) continue;
      if (!p.ghost) this.makeGhost(p);
      const buf = p.buf;
      let a = buf[0], b = buf[0];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= renderT) { a = buf[i]; b = buf[i + 1] || buf[i]; break; }
      }
      const t = b === a ? 0 : Math.min(1, (renderT - a.t) / (b.t - a.t));
      const g = p.ghost;
      g.position.set(
        a.s.p[0] + (b.s.p[0] - a.s.p[0]) * t,
        a.s.p[1] + (b.s.p[1] - a.s.p[1]) * t,
        a.s.p[2] + (b.s.p[2] - a.s.p[2]) * t,
      );
      p.qa.set(...a.s.q); p.qb.set(...b.s.q);
      g.quaternion.slerpQuaternions(p.qa, p.qb, t);
      const ud = g.userData;
      ud.lean.rotation.z = a.s.l + (b.s.l - a.s.l) * t;
      ud.steerer.rotation.y = (a.s.st || 0) * 0.25 * Math.max(0.2, 1 - Math.abs(a.s.v) / 30);
      p.spin = (p.spin || 0) + (a.s.v / 0.31) * (1 / 60);
      for (const w of ud.wheels) w.rotation.x = p.spin;
      // drop old snapshots
      while (buf.length > 2 && buf[1].t < renderT) buf.shift();
    }
  }

  makeGhost(p) {
    this.removeGhost(p);
    const g = ghostify(buildBike(p.color));
    const tag = nameSprite(p.name, p.color);
    tag.position.y = 2.3;
    g.add(tag);
    p.ghost = g;
    p.qa = new THREE.Quaternion();
    p.qb = new THREE.Quaternion();
    this.scene.add(g);
  }

  removeGhost(p) {
    if (!p.ghost) return;
    this.scene.remove(p.ghost);
    p.ghost.traverse((o) => { if (o.material?.map) o.material.map.dispose(); });
    disposeModel(p.ghost);
    p.ghost = null;
  }

  pushSnapshot(id, s) {
    if (id === this.selfId) return;
    const p = this.players.get(id);
    if (!p) return;
    (p.buf ||= []).push({ t: performance.now(), s });
    if (p.buf.length > 30) p.buf.shift();
  }

  rosterList() {
    return [...this.players.values()].map(({ id, name, color, wins }) => ({ id, name, color, wins }));
  }

  // ---- messaging helpers ----------------------------------------------------

  sendAll(msg) {           // host -> every client, including the host itself
    this.net.broadcast(msg);
    this.clientHandle(msg);
  }

  toHost(msg) {            // any client -> host
    if (this.isHost) this.hostHandle(this.selfId, msg);
    else this.net.send(msg);
  }

  // ---- host side --------------------------------------------------------------

  hostHandle(from, msg) {
    switch (msg.t) {
      case 'hello': {
        const used = new Set([...this.players.values()].map((p) => p.color));
        const color = COLORS.find((c) => !used.has(c)) || COLORS[this.players.size % COLORS.length];
        const name = String(msg.name || 'Driver').slice(0, 16);
        this.players.set(from, { id: from, name, color, wins: 0 });
        const hr = this.hostRace;
        const nearest = this.world.road.nearestAnywhere(this.car.pos.x, this.car.pos.z);
        this.net.sendTo(from, {
          t: 'welcome', you: from, hostId: this.selfId, seed: this.seed,
          roster: this.rosterList(), spawnS: nearest.s,
          race: hr && hr.phase !== 'invite' ? { ...hr.pub, participants: hr.participants } : null,
        });
        this.sendAll({ t: 'roster', list: this.rosterList() });
        this.sendAll({ t: 'toast', text: `${name} joined the world` });
        break;
      }
      case 'st': {
        const { t, ...snap } = msg;
        this.latest.set(from, snap);
        this.pushSnapshot(from, snap);
        break;
      }
      case 'race_reply': {
        const r = this.hostRace;
        if (!r || r.pub.id !== msg.id || r.phase !== 'invite') return;
        r.replies.set(from, !!msg.accept);
        this.ui.hostInviteStatus(this.inviteStatus());
        if ([...this.players.keys()].every((id) => r.replies.has(id))) this.launchRace();
        break;
      }
      case 'race_ready': {
        const r = this.hostRace;
        if (!r || r.pub.id !== msg.id || r.phase !== 'spawn') return;
        r.ready.add(from);
        if (r.participants.every((id) => r.ready.has(id) || !this.players.has(id))) this.beginCountdown();
        break;
      }
      case 'race_cp': {
        const r = this.hostRace;
        if (!r || r.pub.id !== msg.id || r.phase !== 'running') return;
        r.progress.set(from, Math.max(r.progress.get(from) || 0, msg.i | 0));
        this.broadcastStandings();
        break;
      }
      case 'race_finish': {
        const r = this.hostRace;
        if (!r || r.pub.id !== msg.id || r.phase !== 'running' || r.times.has(from)) return;
        r.times.set(from, Number(msg.time));
        r.progress.set(from, r.pub.cps.length + 1);
        if (r.times.size === 1) {
          const p = this.players.get(from);
          this.sendAll({ t: 'toast', text: `${p?.name || 'Someone'} won! ${FINISH_GRACE}s left for everyone else.` });
          r.graceTimer = setTimeout(() => this.endRace(false), FINISH_GRACE * 1000);
        }
        this.broadcastStandings();
        this.checkRaceDone();
        break;
      }
    }
  }

  hostLeave(id) {
    const p = this.players.get(id);
    this.latest.delete(id);
    if (p) {
      this.players.delete(id);
      this.removeGhost(p);
      this.sendAll({ t: 'roster', list: this.rosterList() });
      this.sendAll({ t: 'toast', text: `${p.name} left` });
    }
    const r = this.hostRace;
    if (!r) return;
    if (r.phase === 'invite') {
      if ([...this.players.keys()].every((k) => r.replies.has(k))) this.launchRace();
    } else if (r.phase === 'spawn') {
      if (r.participants.every((k) => r.ready.has(k) || !this.players.has(k))) this.beginCountdown();
    } else {
      this.broadcastStandings();
      this.checkRaceDone();
    }
  }

  // Host picked start/finish in the race setup panel.
  createRace({ s0, s1, spacing }) {
    if (this.hostRace) return;
    const dir = s1 >= s0 ? 1 : -1;
    const len = Math.abs(s1 - s0);
    const cps = [];
    const count = Math.max(0, Math.round(len / spacing) - 1);
    for (let i = 1; i <= count; i++) cps.push(s0 + (dir * len * i) / (count + 1));
    const pub = { id: Math.random().toString(36).slice(2, 8), s0, s1, cps, length: len };
    this.hostRace = {
      pub, phase: 'invite', replies: new Map([[this.selfId, true]]),
      participants: [], ready: new Set(), progress: new Map(), times: new Map(),
    };
    this.net.broadcast({ t: 'race_invite', race: pub, host: this.name, seconds: INVITE_SECONDS });
    this.ui.hostInviteStatus(this.inviteStatus());
    this.hostRace.inviteTimer = setTimeout(() => this.launchRace(), INVITE_SECONDS * 1000);
    if (this.players.size === 1) this.launchRace();
  }

  inviteStatus() {
    const r = this.hostRace;
    if (!r) return null;
    return [...this.players.values()].map((p) => ({ name: p.name, color: p.color, reply: r.replies.has(p.id) ? (r.replies.get(p.id) ? 'yes' : 'no') : 'wait' }));
  }

  launchRace() {
    const r = this.hostRace;
    if (!r || r.phase !== 'invite') return;
    clearTimeout(r.inviteTimer);
    r.participants = [...this.players.keys()].filter((id) => r.replies.get(id));
    r.phase = 'spawn';
    this.ui.hostInviteStatus(null);
    this.sendAll({ t: 'race_start', race: r.pub, participants: r.participants });
    r.readyTimer = setTimeout(() => this.beginCountdown(), 8000);
  }

  beginCountdown() {
    const r = this.hostRace;
    if (!r || r.phase !== 'spawn') return;
    clearTimeout(r.readyTimer);
    r.phase = 'running';
    this.sendAll({ t: 'race_countdown', id: r.pub.id });
  }

  standings() {
    const r = this.hostRace;
    return r.participants.map((id) => ({
      id, cp: r.progress.get(id) || 0, time: r.times.has(id) ? r.times.get(id) : null, left: !this.players.has(id),
    })).sort((a, b) => {
      if (a.time != null && b.time != null) return a.time - b.time;
      if (a.time != null) return -1;
      if (b.time != null) return 1;
      return b.cp - a.cp;
    });
  }

  broadcastStandings() {
    if (!this.hostRace) return;
    this.sendAll({ t: 'race_update', id: this.hostRace.pub.id, standings: this.standings() });
  }

  checkRaceDone() {
    const r = this.hostRace;
    if (!r || r.phase !== 'running') return;
    const active = r.participants.filter((id) => this.players.has(id));
    if (active.length === 0 || active.every((id) => r.times.has(id))) this.endRace(false);
  }

  endRace(cancelled) {
    const r = this.hostRace;
    if (!r) return;
    for (const t of ['inviteTimer', 'readyTimer', 'graceTimer']) clearTimeout(r[t]);
    const standings = r.phase === 'invite' ? [] : this.standings();
    const winner = !cancelled && standings[0]?.time != null ? standings[0].id : null;
    if (winner && this.players.has(winner)) this.players.get(winner).wins++;
    this.hostRace = null;
    this.ui.hostInviteStatus(null);
    this.sendAll({ t: 'race_end', id: r.pub.id, standings, winner, cancelled });
    this.sendAll({ t: 'roster', list: this.rosterList() });
  }

  // ---- client side (runs on guests and on the host) --------------------------

  clientHandle(msg) {
    switch (msg.t) {
      case 'roster': {
        const ids = new Set(msg.list.map((p) => p.id));
        for (const [id, p] of this.players) if (!ids.has(id)) { this.removeGhost(p); this.players.delete(id); }
        for (const p of msg.list) {
          const cur = this.players.get(p.id);
          if (cur) Object.assign(cur, p);
          else this.players.set(p.id, { ...p });
        }
        this.ui.setRoster(this.rosterList(), this.selfId, this.hostId);
        break;
      }
      case 'sts':
        for (const { id, ...s } of msg.list) this.pushSnapshot(id, s);
        break;
      case 'toast':
        this.ui.toast(msg.text);
        break;
      case 'bye':
        this.ui.fatal('The host closed the world.');
        break;
      case 'full':
        this.ui.fatal('That world is full (6 players max).');
        break;
      case 'race_invite':
        if (this.isHost) return;
        this.ui.invite(msg, (accept) => this.toHost({ t: 'race_reply', id: msg.race.id, accept }));
        break;
      case 'race_start':
        this.startRaceLocal(msg.race, msg.participants, msg.late);
        break;
      case 'race_countdown':
        if (this.race && this.race.id === msg.id) this.runCountdown();
        break;
      case 'race_update':
        if (this.race && this.race.id === msg.id) {
          this.race.standings = msg.standings;
          this.ui.raceStandings(this.namedStandings(msg.standings), this.race);
        }
        break;
      case 'race_end':
        this.endRaceLocal(msg);
        break;
    }
  }

  namedStandings(list) {
    return list.map((s) => {
      const p = this.players.get(s.id);
      return { ...s, name: p?.name || 'Left', color: p?.color || '#888', me: s.id === this.selfId };
    });
  }

  startRaceLocal(pub, participants, late) {
    this.ui.closeInvite();
    const participant = !late && participants.includes(this.selfId);
    const dir = pub.s1 >= pub.s0 ? 1 : -1;
    this.race = {
      ...pub, dir, participant, phase: participant ? 'spawn' : 'spectate',
      next: 0, // index into cps; cps.length means the finish is next
      startTime: 0, finished: false, standings: participants.map((id) => ({ id, cp: 0, time: null })),
    };
    this.markers?.dispose();
    this.markers = new RaceMarkers(this.scene, this.world, pub);
    if (participant) {
      this.markers.setTarget(1);
      this.placeOnRoad(pub.s0 - dir * 6, dir);
      this.car.frozen = true;
      this.ui.toast(`Race! ${(pub.length / 1000).toFixed(1)} km — get ready`);
      // give the renderer a frame to build the start area, then report ready
      setTimeout(() => this.toHost({ t: 'race_ready', id: pub.id }), 600);
    } else {
      this.ui.toast('A race is in progress — you are spectating.');
    }
    this.ui.raceStandings(this.namedStandings(this.race.standings), this.race);
  }

  runCountdown() {
    const r = this.race;
    if (!r.participant) { r.phase = 'running'; return; }
    r.phase = 'countdown';
    let n = 3;
    this.ui.countdown(n);
    const tick = () => {
      if (this.race !== r) return;
      n--;
      if (n > 0) { this.ui.countdown(n); setTimeout(tick, 1000); return; }
      this.ui.countdown('GO');
      r.phase = 'running';
      r.startTime = performance.now();
      this.car.frozen = false;
      setTimeout(() => this.ui.countdown(null), 800);
    };
    setTimeout(tick, 1000);
  }

  updateRace(now) {
    const r = this.race;
    if (!r.participant || r.phase !== 'running' || r.finished) return;
    const target = r.next < r.cps.length ? this.world.road.at(r.cps[r.next]) : this.world.road.at(r.s1);
    const d = Math.hypot(target.x - this.car.pos.x, target.z - this.car.pos.z);
    r.elapsed = (now - r.startTime) / 1000;
    r.distToNext = d;
    if (d < CP_RADIUS) {
      if (r.next < r.cps.length) {
        r.next++;
        this.markers.setTarget(r.next + 1);
        this.ui.flash(`Checkpoint ${r.next}/${r.cps.length}`);
        this.toHost({ t: 'race_cp', id: r.id, i: r.next });
      } else {
        r.finished = true;
        r.finishTime = r.elapsed;
        this.markers.setTarget(-1);
        this.ui.flash(`Finished · ${fmtTime(r.elapsed)}`);
        this.toHost({ t: 'race_finish', id: r.id, time: r.elapsed });
      }
    }
  }

  endRaceLocal(msg) {
    this.ui.closeInvite();
    const r = this.race;
    if (this.markers) { this.markers.dispose(); this.markers = null; }
    this.race = null;
    this.car.frozen = false;
    this.ui.countdown(null);
    this.ui.raceStandings(null);
    if (msg.cancelled) this.ui.toast('The host ended the race.');
    else if (msg.standings.length) this.ui.results(this.namedStandings(msg.standings), msg.winner === this.selfId);
  }
}

export function fmtTime(t) {
  if (t == null) return '—';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, '0')}`;
}

function nameSprite(name, color) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const c = cv.getContext('2d');
  c.font = '600 30px system-ui, sans-serif';
  const w = Math.min(240, c.measureText(name).width + 34);
  c.fillStyle = 'rgba(10,12,16,0.6)';
  c.beginPath();
  c.roundRect((256 - w) / 2, 10, w, 44, 22);
  c.fill();
  c.fillStyle = color;
  c.beginPath();
  c.arc((256 - w) / 2 + 18, 32, 6, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#fff';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(name, 128 + 8, 33);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.scale.set(4, 1, 1);
  s.renderOrder = 10;
  return s;
}
