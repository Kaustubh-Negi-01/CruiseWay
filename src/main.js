import { Game } from './game.js';
import { UI, chips } from './ui.js';
import { QUALITY } from './game.js';
import { Input } from './input.js';
import { Net, normalizeCode } from './net.js';
import { MapView } from './map.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { return localStorage.getItem('convoy:' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('convoy:' + k, v); } catch { /* private mode */ } },
};

const ui = new UI();
const input = new Input();
const game = new Game($('#view'), ui, input);

// ---------------------------------------------------------------- menu

$('#name').value = store.get('name', '');

// The menu sits over a live view of a fresh world. Creating a world with an
// empty seed field keeps this exact place, so there's nothing to reload.
const randomSeed = () => Math.random().toString(36).slice(2, 10);
const sanitizeSeed = (s) => String(s || '').trim().slice(0, 32) || randomSeed();
const previewSeed = randomSeed();
game.preview(previewSeed);

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
  const seed = $('#seed').value.trim() ? sanitizeSeed($('#seed').value) : previewSeed;
  const net = new Net();
  try {
    const code = await net.host();
    enterGame({ net, seed, code });
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
    enterGame({ net, seed: sanitizeSeed(welcome.seed), code, welcome });
  } catch (e) {
    net.close();
    status(e.message, true);
  } finally {
    busy = false;
  }
};
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#doJoin').click(); });

function enterGame({ net, seed, code, welcome }) {
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  ui.setWorldCode(code);
  game.start({ net, seed, name: playerName(), welcome });
  ui.attachWorld(game.world);
  setupBigMap();
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

const overlays = ['#pause', '#mapOverlay'];
const closeOverlays = () => { overlays.forEach((s) => $(s).classList.add('hidden')); ui.showSpotCard(null); };

input.on('escape', () => {
  if (!game.running) return;
  const anyOpen = overlays.some((s) => !$(s).classList.contains('hidden'));
  closeOverlays();
  if (!anyOpen) $('#pause').classList.remove('hidden');
});

// ---------------------------------------------------------------- map
function sizeBigMap() {
  const cv = $('#bigMap');
  const dpr = Math.min(devicePixelRatio, 2);
  cv.width = Math.round(innerWidth * dpr);
  cv.height = Math.round(innerHeight * dpr);
}
addEventListener('resize', () => { if (ui.bigMap) sizeBigMap(); });

input.on('map', () => {
  if (!game.running) return;
  const m = $('#mapOverlay');
  const open = m.classList.contains('hidden');
  closeOverlays();
  if (!open) return;
  m.classList.remove('hidden');
  sizeBigMap();
  ui.bigMap.fitIsland();
});
$('#clearRoute').onclick = () => { game.clearWaypoint(); ui.toast('Route cleared.'); };
$('#centerMe').onclick = () => { ui.bigMap.follow = true; ui.bigMap.scale = Math.max(ui.bigMap.scale, 0.35); };
$('#resumeBtn').onclick = closeOverlays;
$('#leaveBtn').onclick = () => { game.stop(); location.href = location.pathname; };

function setupBigMap() {
  ui.bigMap = new MapView($('#bigMap'), game.world, { interactive: true });
  ui.bigMap.onSpot = (spot) => ui.showSpotCard(spot, game.bestTimes[spot.id], (s) => {
    game.setWaypointSpot(s);
    ui.toast(`Route set to ${s.name}.`);
    closeOverlays();
  });
  ui.bigMap.onPick = (x, z) => {
    ui.showSpotCard(null);
    game.setWaypointPoint(x, z);
  };
}

// graphics quality (remembered per device)
const qualityHints = {
  auto: 'Adjusts resolution on the fly to keep riding smooth.',
  high: 'Sharpest image and detailed shadows. Needs a strong GPU.',
  medium: 'Balanced: native resolution, lighter shadows and grass.',
  low: 'For older laptops: lower resolution, no shadows, sparse grass.',
};
const qualityPick = chips($('[data-opt=quality]'), Object.fromEntries(Object.entries(QUALITY).map(([k, v]) => [k, v.label])), store.get('quality', 'auto'), (q) => {
  store.set('quality', q);
  game.applyQuality(q);
  $('#qualityHint').textContent = qualityHints[q];
});
game.quality = qualityPick.get();
$('#qualityHint').textContent = qualityHints[qualityPick.get()];

// host safety valve: call off a stuck race
$('#endRaceBtn').onclick = () => game.endRace(true);
setInterval(() => {
  if (!game.running || !game.isHost) return;
  $('#endRaceBtn').classList.toggle('hidden', !game.hostRace || game.hostRace.phase === 'lobby');
}, 250);

// debug handle for testing in the console
window.convoy = { game };
