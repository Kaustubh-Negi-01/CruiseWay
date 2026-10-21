import * as THREE from 'three';
import { World } from '../world/rendering/world.js';
import { Environment } from '../world/rendering/sky.js';
import { Bike } from '../vehicle/physics.js';
import { buildBike, ghostify, disposeModel, PALETTE as COLORS, setBikeEnvironment, setBikeView, updateDash, EYE } from '../vehicle/bike.js';
import { RaceMarkers } from '../race/markers.js';
import { PAVED_HALF, DIRT_HALF, KIND_DIRT } from '../world/generation/network.js';

const SEND_HZ = 15;
const INTERP_DELAY = 140;   // ms behind newest snapshot when rendering ghosts
const CP_RADIUS = 22;
const SPOT_RADIUS = 22;     // how close counts as "arrived" at a race spot
const LOBBY_SECONDS = 15;   // gathering window before a race (any member can start early)
const NOSE = new THREE.Vector3(0, 0.62, 1.34);
const ROLL_Z = new THREE.Quaternion(), ROLL_FULL = new THREE.Quaternion();
const FLIP_Y = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

// Graphics presets, cheapest first. Each one sets render resolution (pr),
// anti-aliasing, shadow map, whether trees cast shadows, grass density, view
// distance (chunks) and terrain detail rings (quads per chunk side, near to
// far). 'fps' caps the frame rate (0 = only the user's cap applies).
// 'auto' runs Medium and steps down (resolution first, then preset) if the
// machine can't hold the frame rate. It never renders above native resolution.
export const QUALITY = {
  auto:   { label: 'Auto' },
  eco:    { label: 'Eco',    pr: 0.7,  msaa: false, fps: 30, shadow: 0,    treeShadows: false, grass: 0.3,  view: 4.5, rings: [64, 32, 16, 8] },
  low:    { label: 'Low',    pr: 0.85, msaa: false, fps: 0,  shadow: 1024, treeShadows: false, grass: 0.45, view: 5,   rings: [64, 32, 16, 8] },
  medium: { label: 'Medium', pr: 1.0,  msaa: true,  fps: 0,  shadow: 1024, treeShadows: false, grass: 0.6,  view: 6,   rings: [96, 48, 24, 12] },
  high:   { label: 'High',   pr: 1.5,  msaa: true,  fps: 0,  shadow: 2048, treeShadows: true,  grass: 1.0,  view: 7.5, rings: [128, 64, 32, 16] },
};
const AUTO_STEPS = ['medium', 'low', 'eco'];
export const presetFor = (name) => QUALITY[name === 'auto' || !QUALITY[name] ? 'medium' : name];
const FINISH_GRACE = 60;    // seconds others get after the winner crosses

// Game owns the 3D scene, the local bike, the ghosts, navigation, and the
// session protocol. The host's browser is the authority for the roster,
// lobbies and races: every message to clients also runs locally on the host
// (sendAll), and every message to the host is handled locally when we are
// the host (toHost).
export class Game {
  constructor(canvas, ui, input, { msaa = true, quality = 'auto', fpsCap = 60 } = {}) {
    this.ui = ui;
    this.input = input;
    // anti-aliasing can only be chosen when the GL context is created
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: msaa, powerPreference: 'high-performance' });
    this.msaa = msaa;
    this.renderer.setPixelRatio(1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.quality = quality;
    this.autoStep = 0;          // index into AUTO_STEPS while on 'auto'
    this.fpsCap = fpsCap;       // user's cap: 30, 60 or 0 (max)
    this.pr = 1;
    this.frameAvg = 1 / 60;
    this.drsAt = 0;
    this.slowSince = 0;
    this.lastTick = 0;
    this.stats = { fps: 60, cpu: 0, frames: 0, t0: performance.now(), cpuSum: 0 };
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.08, 9000);
    this.camQuat = new THREE.Quaternion();
    this.camRoll = 0;
    this.camMode = 0;
    this.running = false;
    this.previewing = false;
    this.bestTimes = {};       // spot id -> best time this session
    addEventListener('resize', () => this.resize());
    this.resize();

    input.on('reset', (d) => d && this.running && this.resetCar());
    input.on('camera', (d) => { if (d) { this.camMode = (this.camMode + 1) % 4; this.camPos = null; } });
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- world --------------------------------------------------------------

  loadWorld(seed, color = COLORS[0]) {
    if (this.world && this.world.seed === seed) {
      this.setModel(color);
      return;
    }
    this.disposeWorld();
    const scene = (this.scene = new THREE.Scene());
    this.world = new World(scene, seed);
    this.env = new Environment(scene, this.renderer);
    setBikeEnvironment(this.env.envMap);
    this.world.water.material.envMap = this.env.envMap;
    this.world.water.material.needsUpdate = true;
    this.car = new Bike(this.world);
    this.model = null;
    this.setModel(color);
    this.spawnHome();
    this.camPos = null;
    this.applyQuality(this.quality);
  }

  // ---- graphics quality -------------------------------------------------------

  // The preset actually in force (auto resolves to its current step).
  activePreset() {
    return this.quality === 'auto' ? QUALITY[AUTO_STEPS[this.autoStep]] : presetFor(this.quality);
  }

  applyQuality(name, keepAutoStep = false) {
    this.quality = QUALITY[name] ? name : 'auto';
    if (!keepAutoStep) this.autoStep = 0;
    const q = this.activePreset();
    const native = Math.min(devicePixelRatio || 1, 2);
    // never render more pixels than the screen has (except High on HiDPI)
    this.pr = Math.min(q.pr, this.quality === 'high' ? native : Math.min(1, native));
    this.prTop = this.pr;
    this.drsAt = performance.now();
    this.slowSince = 0;
    this.renderer.setPixelRatio(this.pr);
    this.resize();
    if (!this.env) return;
    const sun = this.env.sun;
    sun.castShadow = q.shadow > 0;
    if (q.shadow && sun.shadow.mapSize.x !== q.shadow) {
      sun.shadow.mapSize.set(q.shadow, q.shadow);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    this.world.setDetail({ view: q.view, rings: q.rings, treeShadows: q.treeShadows, grass: q.grass });
  }

  // Milliseconds between frames we allow (0 = every display refresh).
  frameInterval() {
    const caps = [this.fpsCap, this.activePreset().fps].filter((c) => c > 0);
    return caps.length ? 1000 / Math.min(...caps) : 0;
  }

  // Auto: if frames take too long, drop resolution (down to 0.6x); if that's
  // not enough, step down a preset (Medium -> Low -> Eco). Creeps resolution
  // back up slowly when there's headroom, never above the preset's own.
  adaptResolution(dt, now) {
    if (this.quality !== 'auto' || document.hidden) return;
    this.frameAvg += (dt - this.frameAvg) * 0.05;
    if (now - this.drsAt < 1500) return;
    const target = (this.frameInterval() || 1000 / 60) / 1000;
    const slow = this.frameAvg > target * 1.2;
    if (slow) {
      if (this.pr > 0.62) {
        this.pr = Math.max(0.6, this.pr - 0.1);
      } else if (this.autoStep < AUTO_STEPS.length - 1) {
        if (!this.slowSince) this.slowSince = now;
        if (now - this.slowSince < 4000) return;
        this.autoStep++;
        this.applyQuality('auto', true);
        this.ui.toast('Graphics lowered to keep things smooth (' + QUALITY[AUTO_STEPS[this.autoStep]].label + ').');
        return;
      } else return;
    } else if (this.frameAvg < target * 1.05 && this.pr < this.prTop && now - this.drsAt > 8000) {
      this.pr = Math.min(this.prTop, this.pr + 0.05);
      this.slowSince = 0;
    } else {
      if (!slow) this.slowSince = 0;
      return;
    }
    this.drsAt = now;
    this.renderer.setPixelRatio(this.pr);
    this.resize();
  }

  // Frame cap + bookkeeping shared by the menu preview and the game loop.
  // Returns false when this display refresh should be skipped.
  tick(interval) {
    const now = performance.now();
    if (interval && now - this.lastTick < interval - 3) return false;
    this.lastTick = now;
    return true;
  }

  noteStats(cpuMs) {
    const st = this.stats;
    st.frames++;
    st.cpuSum += cpuMs;
    const now = performance.now();
    if (now - st.t0 >= 500) {
      st.fps = (st.frames * 1000) / (now - st.t0);
      st.cpu = st.cpuSum / st.frames;
      st.frames = 0; st.cpuSum = 0; st.t0 = now;
      const info = this.renderer.info.render;
      this.ui.stats?.({ fps: st.fps, cpu: st.cpu, calls: info.calls, tris: info.triangles, pr: this.pr, preset: this.quality === 'auto' ? 'Auto · ' + this.activePreset().label : this.activePreset().label, cap: this.frameInterval() ? Math.round(1000 / this.frameInterval()) : 'max' });
    }
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

  // a little way down the route of the first spot, facing along it
  spawnHome() {
    const spot = this.world.spots[0];
    if (spot) {
      const p = spot.route.at(Math.min(120, spot.route.length / 3));
      this.placeAt(p, Math.atan2(p.tx, p.tz));
    } else {
      const e = this.world.net.edges[0];
      const p = this.world.net.pointOnEdge(e, e.length / 2);
      this.placeAt(p, Math.atan2(p.tx, p.tz));
    }
  }

  placeAt(p, yaw) {
    this.car.place(p.x, p.z, yaw);
    this.camPos = null;
    // a teleport isn't "riding the wrong way": restart the guidance
    const r = this.race;
    if (r) r.wrongWay = 0;
    this.navAgainst = 0;
  }

  setModel(color) {
    if (this.model && this.modelColor === color) return;
    if (this.model) { this.scene.remove(this.model); disposeModel(this.model); }
    this.model = buildBike(color);
    this.modelColor = color;
    this.scene.add(this.model);
  }

  // Slow cinematic orbit behind the main menu.
  preview(seed) {
    this.loadWorld(seed);
    this.previewing = true;
    this.last = performance.now();
    this.orbit = 0.6;
    const loop = () => {
      if (!this.previewing) return;
      this.raf = requestAnimationFrame(loop);
      if (!this.tick(1000 / 30)) return;
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      this.orbit += dt * 0.07;
      const c = this.car;
      const fwd = new THREE.Vector3(Math.sin(c.yaw), 0, Math.cos(c.yaw));
      const side = new THREE.Vector3(fwd.z, 0, -fwd.x);
      const cam = c.pos.clone()
        .addScaledVector(fwd, Math.cos(this.orbit) * 5.5)
        .addScaledVector(side, Math.sin(this.orbit) * 5.5)
        .add(new THREE.Vector3(0, 1.3, 0));
      cam.y = Math.max(cam.y, this.world.heightAt(cam.x, cam.z) + 0.6);
      this.camera.position.copy(cam);
      this.camera.lookAt(c.pos.clone().add(new THREE.Vector3(0, 0.8, 0)));
      this.car.update(dt, { steer: 0, throttle: 0, brake: 0, handbrake: false });
      this.car.applyTo(this.model);
      this.world.update(this.car.pos);
      this.env.update(dt, this.car.pos);
      this.renderer.render(this.scene, this.camera);
    };
    cancelAnimationFrame(this.raf);
    loop();
  }

  // ---- session ----------------------------------------------------------------

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
    this.lobby = null;        // client-side lobby view
    this.hostRace = null;     // host-only authoritative lobby/race
    this.latest = new Map();  // host: id -> latest snapshot
    this.nav = null;          // { spot } or { x, z } + gps
    this.prompted = null;     // spot id we've already asked about on this visit

    const myColor = this.isHost ? COLORS[0] : (welcome.roster.find((p) => p.id === welcome.you)?.color || COLORS[1]);
    this.loadWorld(seed, myColor);
    if (welcome?.spawn) {
      // guests appear just behind the host
      const n = this.world.net.nearestAnywhere(welcome.spawn.x, welcome.spawn.z);
      const e = this.world.net.edges[n.edge];
      const p = n.s != null ? this.world.net.pointOnEdge(e, Math.max(0, n.s - 18)) : n;
      this.placeAt(p, Math.atan2(n.tx, n.tz));
    }
    this.car.odometer = 0;

    if (this.isHost) {
      this.players.set(this.selfId, { id: this.selfId, name, color: COLORS[0], wins: 0 });
      net.on('message', (from, msg) => this.hostHandle(from, msg));
      net.on('leave', (id) => this.hostLeave(id));
    } else {
      net.on('message', (_from, msg) => this.clientHandle(msg));
      net.on('hostLost', () => this.ui.fatal('The host closed the world.'));
      this.clientHandle({ t: 'roster', list: welcome.roster });
      if (welcome.lobby) this.clientHandle({ t: 'lobby', lobby: welcome.lobby });
      if (welcome.race) this.clientHandle({ t: 'race_start', race: welcome.race, participants: welcome.race.participants, late: true });
    }
    this.ui.setRoster(this.rosterList(), this.selfId, this.hostId);

    // Network ticks run off a worker timer: unlike requestAnimationFrame it
    // keeps firing in a background tab, so a host who tabs away keeps relaying.
    const src = `setInterval(() => postMessage(0), ${Math.round(1000 / SEND_HZ)});`;
    this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    this.ticker.onmessage = () => this.netTick();

    this.running = true;
    this.last = performance.now();
    const loop = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (!this.tick(this.frameInterval())) return;
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

  resetCar() {
    const r = this.race;
    if (r && r.participant) {
      if (r.phase !== 'running' || r.finished) return;
      const s = r.next > 0 ? r.spot.checkpoints[r.next - 1] : r.spot.startS;
      const p = r.spot.route.at(s);
      this.placeAt(p, Math.atan2(p.tx, p.tz));
      return;
    }
    const n = this.world.net.nearestAnywhere(this.car.pos.x, this.car.pos.z);
    const fwd = Math.sin(this.car.yaw) * n.tx + Math.cos(this.car.yaw) * n.tz;
    const dir = fwd >= 0 ? 1 : -1;
    this.placeAt(n, Math.atan2(n.tx * dir, n.tz * dir));
  }

  // ---- frame ------------------------------------------------------------------

  frame() {
    const now = performance.now();
    const cpu0 = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;

    const inp = this.input.read();
    this.car.update(dt, inp);
    this.car.applyTo(this.model);
    this.world.update(this.car.pos, this.race?.participant ? this.race.spot.id : -1);
    this.env.update(dt, this.car.pos);
    this.updateCamera(dt);
    this.updateGhosts(now);
    if (this.race) this.updateRace(now);
    if (this.markers) this.markers.update(now / 1000);
    this.checkWater(dt);
    this.checkSpots();
    this.updateNav(now);
    this.updateGuidance(dt);
    this.adaptResolution(dt, now);

    if (this.view === 'cockpit') updateDash(this.model, Math.abs(this.car.forwardSpeed) * 3.6, this.car.odometer / 1000, this.car.surface);
    const surface = this.car.surface === KIND_DIRT ? 'dirt road' : this.car.surface === 0 ? 'off-road' : '';
    this.ui.hud({
      speed: Math.abs(this.car.forwardSpeed) * 3.6,
      odometer: this.car.odometer,
      surface,
      me: this.car.pos, yaw: this.car.yaw,
      others: [...this.players.values()].filter((p) => p.ghost).map((p) => ({ x: p.ghost.position.x, z: p.ghost.position.z, color: p.color, name: p.name })),
      race: this.race,
      lobby: this.lobby,
      nav: this.nav,
    });
    // nothing to see behind the full-screen map: save the GPU the work
    if (!this.ui.mapOpen) this.renderer.render(this.scene, this.camera);
    this.noteStats(performance.now() - cpu0);
  }

  // Riding into the sea or a lake: you're slowed right down, and if you stay
  // under for a moment you're put back on the nearest road.
  checkWater(dt) {
    if (this.car.pos.y < -1.0) {
      this.car.underwater += dt;
      if (this.car.underwater > 1.4) {
        this.ui.toast('Splash! Back on the road.');
        this.resetCar();
      }
    } else this.car.underwater = 0;
  }

  // Four views: chase, far chase, cockpit, nose. The chase camera trails the
  // heading with a soft lag and rolls a little with the lean; the cockpit and
  // nose cameras ride the bike's own frame (roll softened), so nothing on the
  // bike can clip through the view.
  updateCamera(dt) {
    const c = this.car, s = c.spec, m = this.model;
    const mode = this.camMode;
    const view = mode === 2 ? 'cockpit' : mode === 3 ? 'nose' : 'chase';
    if (this.view !== view) {
      setBikeView(m, view);
      this.view = view;
      this.camPos = null;
      document.getElementById('hud').classList.toggle('cockpit', view === 'cockpit'); // the dash shows speed
    }
    const k = (rate) => 1 - Math.exp(-dt * rate);
    const speed = Math.abs(c.forwardSpeed);

    if (view !== 'chase') {
      // the eye leans with the bike (so the bike stays centred in view), but
      // the view itself only tilts part of the way, like a rider's head
      ROLL_FULL.setFromAxisAngle(_v2.set(0, 0, 1), c.lean);
      ROLL_Z.setFromAxisAngle(_v2.set(0, 0, 1), c.lean * 0.45);
      const eye = _v.copy(view === 'cockpit' ? EYE : NOSE).applyQuaternion(ROLL_FULL).applyQuaternion(m.quaternion).add(m.position);
      this.camera.position.copy(eye);
      _q.copy(m.quaternion).multiply(ROLL_Z).multiply(FLIP_Y).multiply(TILT);
      if (!this.camPos) { this.camQuat.copy(_q); this.camPos = eye.clone(); }
      this.camQuat.slerp(_q, k(22));
      this.camera.quaternion.copy(this.camQuat);
      const fov = (view === 'cockpit' ? 72 : 76) + Math.min(14, speed * 0.25);
      this.camera.fov += (fov - this.camera.fov) * k(3);
      this.camera.updateProjectionMatrix();
      return;
    }

    // chase: heading lags a little; while sliding, favour the direction of travel
    let target = c.renderYaw;
    if (c.speed > 6 && c.forwardSpeed > 0) {
      const travel = Math.atan2(c.vel.x, c.vel.z);
      let d = travel - target; d = Math.atan2(Math.sin(d), Math.cos(d));
      target += d * 0.5;
    }
    if (this.camYaw == null || this.camPos == null) this.camYaw = target;
    let dy = target - this.camYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    this.camYaw += dy * k(4);
    const far = mode === 1 ? 1.75 : 1;
    const fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
    const bx = c.renderPos.x, by = c.bodyY, bz = c.renderPos.z;
    const wantY = by + s.camHeight * far;
    if (!this.camPos) this.camPos = new THREE.Vector3(bx - fx * s.camDist * far, wantY, bz - fz * s.camDist * far);
    this.camPos.x = bx - fx * s.camDist * far;
    this.camPos.z = bz - fz * s.camDist * far;
    this.camPos.y += (wantY - this.camPos.y) * k(7);
    const ground = this.world.heightAt(this.camPos.x, this.camPos.z) + 0.55;
    if (this.camPos.y < ground) this.camPos.y += (ground - this.camPos.y) * k(25);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(bx + fx * 7, by + 0.95, bz + fz * 7);
    this.camRoll += (c.lean * 0.3 - this.camRoll) * k(5);
    this.camera.rotateZ(this.camRoll);
    const fov = 68 + Math.min(16, speed * 0.3);
    this.camera.fov += (fov - this.camera.fov) * k(3);
    this.camera.updateProjectionMatrix();
  }

  // ---- race / GPS guidance -------------------------------------------------------

  // Shortcuts are part of the game, so the only warning is TURN AROUND: shown
  // when you ride backwards along the race route (or, in free roam, away along
  // your GPS route).
  //
  // Race progress (which the yellow trail starts from) only moves while you
  // are on the route. Leave it for a shortcut and the trail waits where you
  // left; rejoin further on and it jumps ahead to where you came back.
  updateGuidance(dt) {
    const c = this.car, sp = c.speed;
    const vx = sp > 0.1 ? c.vel.x / sp : 0, vz = sp > 0.1 ? c.vel.z / sp : 0;
    const r = this.race;
    let state = null, aim = null, label = '';
    if (r && r.participant && r.phase === 'running' && !r.finished) {
      const route = r.spot.route;
      let q = route.nearestS(c.pos.x, c.pos.z, r.progressS, 320);
      if (q.d > 25) {
        // off the nearby stretch: are we back on the route somewhere further on?
        const g = route.nearestS(c.pos.x, c.pos.z, route.length / 2, route.length, 0);
        if (g.d < 20 && g.s > r.progressS) q = g;
      }
      const onRoute = q.d < 20;
      if (onRoute && q.s > r.progressS) r.progressS = q.s;
      const against = onRoute && sp > 4 && vx * q.tx + vz * q.tz < -0.35;
      r.wrongWay = against ? r.wrongWay + dt : Math.max(0, r.wrongWay - dt * 2.5);
      if (r.wrongWay > 0.7) { state = 'wrongway'; aim = route.at(Math.max(q.s, r.progressS) + 40); label = "You're riding the wrong way"; }
    } else if (!r?.participant && this.nav?.gps && sp > 4) {
      const pts = this.nav.gps.pts;
      let bi = 0, bd = Infinity;
      for (let i = 0; i < Math.min(pts.length - 1, 60); i++) {
        const d = (pts[i][0] - c.pos.x) ** 2 + (pts[i][1] - c.pos.z) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      const j = Math.min(pts.length - 1, bi + 4);
      let tx = pts[j][0] - pts[bi][0], tz = pts[j][1] - pts[bi][1];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const against = Math.sqrt(bd) < 30 && vx * tx + vz * tz < -0.35;
      this.navAgainst = against ? (this.navAgainst || 0) + dt : Math.max(0, (this.navAgainst || 0) - dt * 2.5);
      if (this.navAgainst > 1) { state = 'turnaround'; aim = { x: pts[j][0], z: pts[j][1] }; label = 'Your route is behind you'; }
    }
    let rel = 0;
    if (aim) {
      const d = Math.atan2(aim.x - c.pos.x, aim.z - c.pos.z) - c.yaw;
      rel = Math.atan2(Math.sin(d), Math.cos(d));
    }
    this.ui.guidance(state, rel, label);
  }

  // ---- navigation (GPS) -----------------------------------------------------

  setWaypointSpot(spot) {
    this.nav = { spot, x: spot.route.at(spot.startS).x, z: spot.route.at(spot.startS).z, gps: null, at: 0 };
    this.updateNav(performance.now(), true);
  }

  setWaypointPoint(x, z) {
    this.nav = { spot: null, x, z, gps: null, at: 0 };
    this.updateNav(performance.now(), true);
  }

  clearWaypoint() { this.nav = null; }

  updateNav(now, force = false) {
    const nav = this.nav;
    if (!nav) return;
    const d = Math.hypot(nav.x - this.car.pos.x, nav.z - this.car.pos.z);
    nav.dist = d;
    nav.bearing = Math.atan2(nav.x - this.car.pos.x, nav.z - this.car.pos.z);
    if (d < (nav.spot ? SPOT_RADIUS : 30)) {
      if (!nav.spot) { this.ui.toast('You have arrived.'); this.nav = null; }
      else nav.gps = null;
      return;
    }
    if (!force && now - nav.at < 1500) return;
    nav.at = now;
    const net = this.world.net;
    const from = net.nearestAnywhere(this.car.pos.x, this.car.pos.z);
    let target;
    if (nav.spot) target = net.nodes[nav.spot.node];
    else {
      const t = net.nearestAnywhere(nav.x, nav.z);
      const e = net.edges[t.edge];
      target = t.node != null ? net.nodes[t.node] : net.nodes[t.s < e.length / 2 ? e.a : e.b];
    }
    const r = net.route(from, target.id);
    if (!r) { nav.gps = null; return; }
    const pts = [[this.car.pos.x, this.car.pos.z], ...r.pts];
    if (nav.spot) {
      // finish down the spot's first road to its start line
      const route = nav.spot.route;
      for (let s = 0; s <= nav.spot.startS; s += 3) { const p = route.at(s); pts.push([p.x, p.z]); }
    } else pts.push([nav.x, nav.z]);
    nav.gps = { pts, length: r.length };
  }

  // ---- race spots -----------------------------------------------------------

  nearestSpot() {
    let best = null;
    for (const s of this.world.spots) {
      const p = s.route.at(s.startS);
      const d = Math.hypot(p.x - this.car.pos.x, p.z - this.car.pos.z);
      if (!best || d < best.d) best = { spot: s, d };
    }
    return best;
  }

  checkSpots() {
    const near = this.nearestSpot();
    if (!near) return;
    const { spot, d } = near;
    if (this.prompted != null && (this.prompted !== spot.id || d > 70)) {
      // rode away: forget the visit, and leave its lobby if we were in it
      if (this.lobby && this.lobby.spot === this.prompted && this.lobby.members.includes(this.selfId)) this.toHost({ t: 'spot_leave' });
      this.prompted = null;
      this.ui.closeSpotPrompt();
    }
    if (d < SPOT_RADIUS && this.prompted == null && !(this.race && this.race.participant)) {
      this.prompted = spot.id;
      if (this.nav && this.nav.spot === spot) this.nav = null;
      const busy = this.race ? `A race is running at ${this.world.spots[this.race.spot.id].name}. Try again when it ends.`
        : this.lobby && this.lobby.spot !== spot.id ? `Riders are gathering at ${this.world.spots[this.lobby.spot].name}.` : null;
      this.ui.spotPrompt(spot, this.bestTimes[spot.id], busy, (yes) => {
        if (yes) this.toHost({ t: 'spot_join', spot: spot.id });
      });
    }
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
      p.spin = (p.spin || 0) + (a.s.v / 0.37) * (1 / 60);
      for (const w of ud.wheels) w.rotation.x = p.spin;
      while (buf.length > 2 && buf[1].t < renderT) buf.shift();
    }
  }

  makeGhost(p) {
    this.removeGhost(p);
    const g = ghostify(buildBike(p.color));
    const tag = nameSprite(p.name, p.color);
    tag.position.y = 2.1;
    g.add(tag);
    p.ghost = g;
    p.qa = new THREE.Quaternion();
    p.qb = new THREE.Quaternion();
    this.scene.add(g);
  }

  removeGhost(p) {
    if (!p.ghost) return;
    this.scene.remove(p.ghost);
    p.ghost.traverse((o) => { if (o.isSprite) o.material.map.dispose(); });
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

  // ---- messaging helpers ------------------------------------------------------

  sendAll(msg) { this.net.broadcast(msg); this.clientHandle(msg); }

  toHost(msg) {
    if (this.isHost) this.hostHandle(this.selfId, msg);
    else this.net.send(msg);
  }

  tell(id, msg) {
    if (id === this.selfId) this.clientHandle(msg);
    else this.net.sendTo(id, msg);
  }

  // ---- host side ----------------------------------------------------------------

  hostHandle(from, msg) {
    const hr = this.hostRace;
    switch (msg.t) {
      case 'hello': {
        const used = new Set([...this.players.values()].map((p) => p.color));
        const color = COLORS.find((c) => !used.has(c)) || COLORS[this.players.size % COLORS.length];
        const name = String(msg.name || 'Rider').slice(0, 16);
        this.players.set(from, { id: from, name, color, wins: 0 });
        this.net.sendTo(from, {
          t: 'welcome', you: from, hostId: this.selfId, seed: this.seed,
          roster: this.rosterList(),
          spawn: { x: this.car.pos.x, z: this.car.pos.z },
          lobby: hr && hr.phase === 'lobby' ? this.lobbyPub() : null,
          race: hr && hr.phase !== 'lobby' ? { id: hr.id, spot: hr.spot, participants: hr.participants } : null,
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
      case 'spot_join': {
        const spot = this.world.spots[msg.spot | 0];
        if (!spot) return;
        if (hr && hr.phase !== 'lobby') {
          this.tell(from, { t: 'toast', text: `A race is already running at ${this.world.spots[hr.spot].name}.` });
          return;
        }
        if (hr && hr.spot !== spot.id) {
          this.tell(from, { t: 'toast', text: `Riders are already gathering at ${this.world.spots[hr.spot].name}.` });
          return;
        }
        if (!hr) {
          const secs = LOBBY_SECONDS;
          this.hostRace = {
            id: Math.random().toString(36).slice(2, 8), spot: spot.id, phase: 'lobby',
            members: [from], endsAt: Date.now() + secs * 1000,
            participants: [], ready: new Set(), progress: new Map(), times: new Map(),
          };
          this.hostRace.lobbyTimer = setTimeout(() => this.launchRace(), secs * 1000);
          const who = this.players.get(from)?.name || 'Someone';
          if (this.players.size > 1) this.sendAll({ t: 'toast', text: `${who} is ready to race at ${spot.name} — ${secs}s to join!` });
        } else if (!hr.members.includes(from)) {
          hr.members.push(from);
        }
        this.sendAll({ t: 'lobby', lobby: this.lobbyPub() });
        break;
      }
      case 'spot_leave': {
        if (!hr || hr.phase !== 'lobby') return;
        hr.members = hr.members.filter((id) => id !== from);
        if (!hr.members.length) this.cancelLobby();
        else this.sendAll({ t: 'lobby', lobby: this.lobbyPub() });
        break;
      }
      case 'lobby_go': {
        if (hr && hr.phase === 'lobby' && hr.members.includes(from)) this.launchRace();
        break;
      }
      case 'race_ready': {
        if (!hr || hr.id !== msg.id || hr.phase !== 'spawn') return;
        hr.ready.add(from);
        if (hr.participants.every((id) => hr.ready.has(id) || !this.players.has(id))) this.beginCountdown();
        break;
      }
      case 'race_cp': {
        if (!hr || hr.id !== msg.id || hr.phase !== 'running') return;
        hr.progress.set(from, Math.max(hr.progress.get(from) || 0, msg.i | 0));
        this.broadcastStandings();
        break;
      }
      case 'race_finish': {
        if (!hr || hr.id !== msg.id || hr.phase !== 'running' || hr.times.has(from)) return;
        hr.times.set(from, Number(msg.time));
        hr.progress.set(from, this.world.spots[hr.spot].checkpoints.length + 1);
        if (hr.times.size === 1 && hr.participants.length > 1) {
          const p = this.players.get(from);
          this.sendAll({ t: 'toast', text: `${p?.name || 'Someone'} won! ${FINISH_GRACE}s left for everyone else.` });
          hr.graceTimer = setTimeout(() => this.endRace(false), FINISH_GRACE * 1000);
        }
        this.broadcastStandings();
        this.checkRaceDone();
        break;
      }
    }
  }

  lobbyPub() {
    const hr = this.hostRace;
    return { spot: hr.spot, members: hr.members.slice(), secondsLeft: Math.max(0, (hr.endsAt - Date.now()) / 1000) };
  }

  cancelLobby() {
    const hr = this.hostRace;
    if (!hr) return;
    clearTimeout(hr.lobbyTimer);
    this.hostRace = null;
    this.sendAll({ t: 'lobby', lobby: null });
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
    const hr = this.hostRace;
    if (!hr) return;
    if (hr.phase === 'lobby') {
      hr.members = hr.members.filter((m) => m !== id);
      if (!hr.members.length) this.cancelLobby();
      else this.sendAll({ t: 'lobby', lobby: this.lobbyPub() });
    } else if (hr.phase === 'spawn') {
      if (hr.participants.every((k) => hr.ready.has(k) || !this.players.has(k))) this.beginCountdown();
    } else {
      this.broadcastStandings();
      this.checkRaceDone();
    }
  }

  launchRace() {
    const hr = this.hostRace;
    if (!hr || hr.phase !== 'lobby') return;
    clearTimeout(hr.lobbyTimer);
    hr.participants = hr.members.filter((id) => this.players.has(id));
    if (!hr.participants.length) { this.cancelLobby(); return; }
    hr.phase = 'spawn';
    this.sendAll({ t: 'lobby', lobby: null });
    this.sendAll({ t: 'race_start', race: { id: hr.id, spot: hr.spot }, participants: hr.participants });
    hr.readyTimer = setTimeout(() => this.beginCountdown(), 8000);
  }

  beginCountdown() {
    const hr = this.hostRace;
    if (!hr || hr.phase !== 'spawn') return;
    clearTimeout(hr.readyTimer);
    hr.phase = 'running';
    this.sendAll({ t: 'race_countdown', id: hr.id });
  }

  standings() {
    const hr = this.hostRace;
    return hr.participants.map((id) => ({
      id, cp: hr.progress.get(id) || 0, time: hr.times.has(id) ? hr.times.get(id) : null, left: !this.players.has(id),
    })).sort((a, b) => {
      if (a.time != null && b.time != null) return a.time - b.time;
      if (a.time != null) return -1;
      if (b.time != null) return 1;
      return b.cp - a.cp;
    });
  }

  broadcastStandings() {
    if (this.hostRace) this.sendAll({ t: 'race_update', id: this.hostRace.id, standings: this.standings() });
  }

  checkRaceDone() {
    const hr = this.hostRace;
    if (!hr || hr.phase !== 'running') return;
    const active = hr.participants.filter((id) => this.players.has(id));
    if (active.length === 0 || active.every((id) => hr.times.has(id))) this.endRace(false);
  }

  endRace(cancelled) {
    const hr = this.hostRace;
    if (!hr) return;
    if (hr.phase === 'lobby') { this.cancelLobby(); return; }
    for (const t of ['lobbyTimer', 'readyTimer', 'graceTimer']) clearTimeout(hr[t]);
    const standings = this.standings();
    // a win only counts when someone actually beat somebody else
    const winner = !cancelled && standings[0]?.time != null && hr.participants.length > 1 ? standings[0].id : null;
    if (winner && this.players.has(winner)) this.players.get(winner).wins++;
    this.hostRace = null;
    this.sendAll({ t: 'race_end', id: hr.id, spot: hr.spot, standings, winner, cancelled });
    this.sendAll({ t: 'roster', list: this.rosterList() });
  }

  // ---- client side (runs on guests and on the host) ---------------------------

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
        this.ui.fatal('That world is full (6 riders max).');
        break;
      case 'lobby': {
        const l = msg.lobby;
        this.lobby = l ? { ...l, spotObj: this.world.spots[l.spot], endsAt: performance.now() + l.secondsLeft * 1000 } : null;
        const member = !!l && l.members.includes(this.selfId);
        this.ui.lobby(this.lobby, member, this.lobby && this.lobby.members.map((id) => this.players.get(id)?.name || '…'), () => this.toHost({ t: 'lobby_go' }));
        break;
      }
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
    this.ui.closeSpotPrompt();
    const spot = this.world.spots[pub.spot];
    const participant = !late && participants.includes(this.selfId);
    this.race = {
      id: pub.id, spot, participant, phase: participant ? 'spawn' : 'spectate',
      next: 0, startTime: 0, finished: false,
      progressS: spot.startS, wrongWay: 0,
      standings: participants.map((id) => ({ id, cp: 0, time: null })),
    };
    this.markers?.dispose();
    this.markers = participant ? new RaceMarkers(this.scene, spot, this.world.net.edges[spot.steps[0][0]].half > DIRT_HALF ? PAVED_HALF : DIRT_HALF + 1) : null;
    if (participant) {
      this.nav = null;
      this.markers.setTarget(1);
      const p = spot.route.at(spot.startS);
      this.placeAt(p, Math.atan2(p.tx, p.tz));
      this.car.frozen = true;
      this.ui.toast(`${spot.name} · ${(spot.length / 1000).toFixed(1)} km — get ready`);
      setTimeout(() => this.toHost({ t: 'race_ready', id: pub.id }), 600);
    } else {
      this.ui.toast(`A race is running at ${spot.name}.`);
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
    const cps = r.spot.checkpoints, route = r.spot.route;
    r.elapsed = (now - r.startTime) / 1000;
    const px = this.car.pos.x, pz = this.car.pos.z;
    const near = (p) => Math.hypot(p.x - px, p.z - pz) < CP_RADIUS;
    // Any gate ahead of you counts, so a shortcut that lands on a later
    // checkpoint (or straight on the finish) is accepted.
    const finish = route.at(route.length - 1);
    if (near(finish)) {
      r.finished = true;
      r.finishTime = r.elapsed;
      r.next = cps.length;
      r.progressS = route.length;
      this.markers.setTarget(-1);
      this.ui.flash('Finished · ' + fmtTime(r.elapsed));
      const best = this.bestTimes[r.spot.id];
      if (best == null || r.elapsed < best) this.bestTimes[r.spot.id] = r.elapsed;
      this.toHost({ t: 'race_cp', id: r.id, i: cps.length });
      this.toHost({ t: 'race_finish', id: r.id, time: r.elapsed });
      return;
    }
    for (let i = cps.length - 1; i >= r.next; i--) {
      if (!near(route.at(cps[i]))) continue;
      const skipped = i - r.next;
      r.next = i + 1;
      r.progressS = Math.max(r.progressS, cps[i]);
      this.markers.setTarget(r.next + 1);
      this.ui.flash(skipped > 0 ? 'Checkpoint ' + r.next + '/' + cps.length + ' · shortcut!' : 'Checkpoint ' + r.next + '/' + cps.length);
      this.toHost({ t: 'race_cp', id: r.id, i: r.next });
      break;
    }
    const tgt = r.next < cps.length ? route.at(cps[r.next]) : finish;
    r.distToNext = Math.hypot(tgt.x - px, tgt.z - pz);
  }

  endRaceLocal(msg) {
    if (this.markers) { this.markers.dispose(); this.markers = null; }
    const r = this.race;
    this.race = null;
    this.car.frozen = false;
    this.ui.countdown(null);
    this.ui.raceStandings(null);
    if (!r || !r.participant) return;
    if (msg.cancelled) this.ui.toast('The race was called off.');
    else if (msg.standings.length) this.ui.results(this.world.spots[msg.spot], this.namedStandings(msg.standings), msg.winner === this.selfId, msg.standings.length === 1);
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
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
  s.scale.set(4, 1, 1);
  s.renderOrder = 10;
  return s;
}
