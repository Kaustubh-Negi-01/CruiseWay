import { Game } from './game.js';
import { UI, chips } from './ui.js';
import { Input } from './input.js';
import { Net, normalizeCode } from './net.js';
import { MapView } from './map.js';
import { BIOMES, TIMES, WEATHER, sanitizeSettings } from './world/settings.js';
import { VEHICLES } from './vehicles.js';

const $ = (s) => document.querySelector(s);
const labels = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, v.label]));
const store = {
  get(k, d) { try { return localStorage.getItem('convoy:' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('convoy:' + k, v); } catch { /* private mode */ } },
};

const ui = new UI();
const input = new Input();
const game = new Game($('#view'), ui, input);

// ---------------------------------------------------------------- menu

$('#name').value = store.get('name', '');
const pick = {
  biome: chips($('#create [data-opt=biome]'), labels(BIOMES), 'meadow'),
  time: chips($('#create [data-opt=time]'), labels(TIMES), 'day'),
  weather: chips($('#create [data-opt=weather]'), labels(WEATHER), 'clear'),
};
let myVehicle = store.get('vehicle', 'car');
if (!VEHICLES[myVehicle]) myVehicle = 'car';
const vehiclePickers = [...document.querySelectorAll('[data-opt=vehicle], [data-opt=pauseVehicle]')].map((el) =>
  chips(el, labels(VEHICLES), myVehicle, (v) => {
    myVehicle = v;
    store.set('vehicle', v);
    vehiclePickers.forEach((p) => p.set(v));
    if (game.running) game.changeVehicle(v);
  }));

const show = (pane) => {
  for (const id of ['home', 'create', 'join']) $('#' + id).classList.toggle('hidden', id !== pane);
  status('');
};
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => show(b.dataset.go)));

const params = new URLSearchParams(location.search);
if (params.get('join')) {
  $('#code').value = normalizeCode(params.get('join'));
  show('join');
}

function status(text, err = false) {
  const s = $('#status');
  s.textContent = text;
  s.classList.toggle('err', err);
}

function playerName() {
  const n = $('#name').value.trim().slice(0, 16) || 'Driver';
  store.set('name', n);
  return n;
}

let busy = false;
$('#doCreate').onclick = async () => {
  if (busy) return;
  busy = true;
  status('Creating world…');
  const settings = sanitizeSettings({
    seed: $('#seed').value.trim(), biome: pick.biome.get(), time: pick.time.get(), weather: pick.weather.get(),
  });
  const net = new Net();
  try {
    const code = await net.host();
    enterGame({ net, settings, code });
  } catch (e) {
    status(e.message, true);
  } finally {
    busy = false;
  }
};

$('#doJoin').onclick = async () => {
  if (busy) return;
  const code = normalizeCode($('#code').value);
  if (code.length !== 5) { status('World codes are 5 characters.', true); return; }
  busy = true;
  status('Connecting…');
  const net = new Net();
  try {
    await net.join(code);
    const welcome = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The host did not respond.')), 10000);
      net.on('message', (_f, msg) => {
        if (msg.t === 'welcome') { clearTimeout(t); resolve(msg); }
        if (msg.t === 'full') { clearTimeout(t); reject(new Error('That world is full (6 players max).')); }
      });
      net.send({ t: 'hello', name: playerName() });
    });
    enterGame({ net, settings: sanitizeSettings(welcome.settings), code, welcome });
  } catch (e) {
    net.close();
    status(e.message, true);
  } finally {
    busy = false;
  }
};
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#doJoin').click(); });

function enterGame({ net, settings, code, welcome }) {
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  ui.setWorldCode(code);
  game.start({ net, settings, name: playerName(), vehicle: myVehicle, welcome });
  ui.attachWorld(game.world);
  ui.bigMap = new MapView($('#bigMap'), game.world, { interactive: true });
  input.attachTouch($('#hud'));
  if (net.isHost) {
    $('#hostTools').classList.remove('hidden');
    ui.toast(`World created. Share code ${code} with friends!`);
  }
  history.replaceState(null, '', '?join=' + code);
}

// ---------------------------------------------------------------- in game

$('#worldChip').onclick = async () => {
  const code = $('#worldCode').textContent;
  const link = `${location.origin}${location.pathname}?join=${code}`;
  try {
    await navigator.clipboard.writeText(link);
    ui.toast('Invite link copied — send it to your friends.');
  } catch {
    ui.toast(`World code: ${code}`);
  }
};

const overlays = ['#pause', '#mapOverlay', '#raceSetup'];
const closeOverlays = () => overlays.forEach((s) => $(s).classList.add('hidden'));

input.on('escape', () => {
  if (!game.running) return;
  const anyOpen = overlays.some((s) => !$(s).classList.contains('hidden'));
  closeOverlays();
  if (!anyOpen) $('#pause').classList.remove('hidden');
});
input.on('map', () => {
  if (!game.running) return;
  const m = $('#mapOverlay');
  const open = m.classList.contains('hidden');
  closeOverlays();
  if (open) { m.classList.remove('hidden'); ui.bigMap.follow = true; ui.bigMap.scale = 0.12; }
});
$('#resumeBtn').onclick = closeOverlays;
$('#leaveBtn').onclick = () => { game.stop(); location.href = location.pathname; };
$('#mapOverlay').addEventListener('pointerdown', (e) => { if (e.target.id === 'mapOverlay') closeOverlays(); });

// ---------------------------------------------------------------- race setup (host)

let setupMap = null;
const picks = { s0: null, s1: null };
const raceVehicle = chips($('[data-opt=raceVehicle]'), labels(VEHICLES), 'car');
const spacing = chips($('[data-opt=spacing]'), { 400: 'Every 400 m', 800: 'Every 800 m', 1500: 'Every 1.5 km', 100000: 'Finish only' }, '800', refreshSetup);

function refreshSetup() {
  const ok = picks.s0 != null && picks.s1 != null && Math.abs(picks.s1 - picks.s0) >= 500;
  $('#setupSend').disabled = !ok;
  let text = '';
  if (picks.s0 == null) text = 'Click the road to place the start.';
  else if (picks.s1 == null) text = 'Now click the road to place the finish.';
  else {
    const len = Math.abs(picks.s1 - picks.s0);
    const n = Math.max(0, Math.round(len / Number(spacing.get())) - 1);
    text = len < 500 ? 'Too short — make it at least 500 m along the road.'
      : `${(len / 1000).toFixed(1)} km along the road · ${n} checkpoint${n === 1 ? '' : 's'} + finish`;
  }
  $('#setupSummary').textContent = text;
}

function drawSetup() {
  if ($('#raceSetup').classList.contains('hidden')) return;
  setupMap.draw({ me: game.car.pos, heading: game.car.yaw, others: [], picks });
  requestAnimationFrame(drawSetup);
}

$('#raceBtn').onclick = () => {
  if (game.hostRace) return;
  closeOverlays();
  if (!setupMap) {
    setupMap = new MapView($('#setupMap'), game.world, { interactive: true });
    setupMap.onPick = (x, z) => {
      const n = game.world.road.nearestAnywhere(x, z);
      if (!n || n.dist > 18 / setupMap.scale) return; // must click near the road
      if (picks.s0 == null || picks.s1 != null) { picks.s0 = n.s; picks.s1 = null; } else picks.s1 = n.s;
      refreshSetup();
    };
  }
  setupMap.follow = true;
  setupMap.scale = 0.08;
  picks.s0 = picks.s1 = null;
  refreshSetup();
  $('#raceSetup').classList.remove('hidden');
  requestAnimationFrame(() => { setupMap.follow = false; });
  drawSetup();
};
document.querySelectorAll('[data-quick]').forEach((b) => (b.onclick = () => {
  const n = game.world.road.nearestAnywhere(game.car.pos.x, game.car.pos.z);
  const dir = Math.sin(game.car.yaw) * n.tx + Math.cos(game.car.yaw) * n.tz >= 0 ? 1 : -1;
  picks.s0 = n.s;
  picks.s1 = n.s + dir * Number(b.dataset.quick);
  setupMap.fitRoute(picks.s0, picks.s1);
  refreshSetup();
}));
$('#clearPicks').onclick = () => { picks.s0 = picks.s1 = null; refreshSetup(); };
$('#setupCancel').onclick = closeOverlays;
$('#setupSend').onclick = () => {
  closeOverlays();
  game.createRace({ s0: picks.s0, s1: picks.s1, vehicle: raceVehicle.get(), spacing: Number(spacing.get()) });
};
$('#endRaceBtn').onclick = () => game.endRace(true);

// toggle host buttons according to race state
setInterval(() => {
  if (!game.running || !game.isHost) return;
  const active = !!game.hostRace;
  $('#raceBtn').classList.toggle('hidden', active);
  $('#endRaceBtn').classList.toggle('hidden', !active);
}, 250);

// debug handle for testing in the console
window.convoy = { game };
