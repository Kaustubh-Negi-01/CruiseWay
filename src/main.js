import { Game, QUALITY, presetFor } from './core/game.js';
import { UI, chips } from './ui/hud.js';
import { SoundManager, DEFAULT_SOUND } from './audio/sound.js';
import { Radio } from './radio/radio.js';
import { RadioPanel } from './ui/radioPanel.js';
import { Input } from './core/input.js';
import { Net, normalizeCode } from './network/net.js';
import { MapView } from './ui/map.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { return localStorage.getItem('cruiseway:' + k) ?? localStorage.getItem('convoy:' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cruiseway:' + k, v); } catch { /* private mode */ } },
};

const ui = new UI();
const input = new Input();
// Graphics settings are read before the renderer exists: anti-aliasing can
// only be chosen when the GL context is created.
let quality = store.get('quality', 'auto');
if (!QUALITY[quality]) quality = 'auto';
const fpsCap = Number(store.get('fps', '60'));
let soundPrefs = DEFAULT_SOUND;
try { soundPrefs = { ...DEFAULT_SOUND, ...JSON.parse(store.get('sound', '{}')) }; } catch { /* keep defaults */ }
const sound = new SoundManager(soundPrefs);
const game = new Game($('#view'), ui, input, { msaa: presetFor(quality).msaa, quality, fpsCap, sound });

// Browsers only start audio after the player interacts with the page.
const unlockAudio = () => sound.unlock();
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
// a soft tick on every button press
document.addEventListener('click', (e) => { if (e.target.closest('button')) sound.click(); });

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
  ui.toast('Press Q for the radio.');
  setupBigMap();
  input.attachTouch($('#hud'));
  if (net.isHost) {
    $('#hostTools').classList.remove('hidden');
    ui.toast(`World created. Share code ${code} with friends!`);
  }
  history.replaceState(null, '', '?join=' + code);
  updateCursor();
  if (!store.get('cursorTip')) {
    store.set('cursorTip', '1');
    ui.toast('Cursor hidden while you ride. Alt+C brings it back.');
  }
}

// ---------------------------------------------------------------- cursor
// Hidden while riding, like most games. It comes back by itself whenever a
// menu, the map or a prompt is open, and Alt+C toggles it at any time.
let cursorForced = false;
const cursorOverlays = ['#pause', '#mapOverlay', '#results', '#fatal', '#spotPrompt', '#radio'];
function updateCursor() {
  const menuOpen = cursorOverlays.some((s) => !$(s).classList.contains('hidden'));
  document.body.classList.toggle('no-cursor', game.running && !menuOpen && !cursorForced);
}
input.on('cursor', () => {
  if (!game.running) return;
  cursorForced = !cursorForced;
  updateCursor();
  ui.toast(cursorForced ? 'Cursor shown (Alt+C to hide)' : 'Cursor hidden (Alt+C to show)');
});
new MutationObserver(updateCursor).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
input.on('stats', () => ui.toggleStats());

// ---------------------------------------------------------------- radio (Q)
const radio = new Radio({
  videoContainer: $('#ytPlayer'),
  // optional: a YouTube Data API key makes song search more reliable (set VITE_YOUTUBE_API_KEY)
  youtubeKey: import.meta.env.VITE_YOUTUBE_API_KEY || '',
});
const radioPanel = new RadioPanel(radio);
radio.setMaster(sound.settings.master);
radio.on(() => sound.setDuck(radio.playing));
input.on('radio', () => { if (game.running) radioPanel.toggle(); });

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
  if (radioPanel.isOpen) { radioPanel.close(); return; }
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
new MutationObserver(() => { ui.mapOpen = !$('#mapOverlay').classList.contains('hidden'); })
  .observe($('#mapOverlay'), { attributes: true, attributeFilter: ['class'] });
$('#clearRoute').onclick = () => { game.clearWaypoint(); ui.toast('Route cleared.'); };
$('#centerMe').onclick = () => { ui.bigMap.follow = true; ui.bigMap.scale = Math.max(ui.bigMap.scale, 0.35); };
$('#resumeBtn').onclick = closeOverlays;
$('#leaveBtn').onclick = () => { radio.stop(); game.stop(); location.href = location.pathname; };

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

// graphics quality + frame-rate cap (remembered per device)
const qualityHints = {
  auto: 'Starts at Medium and lowers resolution, then detail, if your laptop struggles.',
  eco: 'Coolest and quietest: 30 FPS, lower resolution, no shadows, short view distance.',
  low: 'Lighter: lower resolution, no anti-aliasing, sparse grass.',
  medium: 'Balanced: native resolution, bike shadow only, moderate view distance.',
  high: 'Sharpest image, tree shadows and the longest view. Gets hot on laptops.',
};
function qualityHint(q) {
  const restart = presetFor(q).msaa !== game.msaa ? ' Edge smoothing changes after a reload.' : '';
  $('#qualityHint').textContent = qualityHints[q] + restart;
}
chips($('[data-opt=quality]'), Object.fromEntries(Object.entries(QUALITY).map(([k, v]) => [k, v.label])), quality, (q) => {
  store.set('quality', q);
  game.applyQuality(q);
  qualityHint(q);
});
qualityHint(quality);
// sound settings (remembered per device)
function saveSound(changes) {
  sound.set(changes);
  if ('master' in changes) radio.setMaster(changes.master);
  store.set('sound', JSON.stringify(sound.settings));
}
chips($('[data-opt=music]'), { on: 'On', off: 'Off' }, soundPrefs.musicOn ? 'on' : 'off', (v) => saveSound({ musicOn: v === 'on' }));
chips($('[data-opt=effects]'), { on: 'On', off: 'Off' }, soundPrefs.effectsOn ? 'on' : 'off', (v) => saveSound({ effectsOn: v === 'on' }));
for (const key of ['master', 'music', 'effects']) {
  const el = $('#vol-' + key);
  el.value = Math.round(soundPrefs[key] * 100);
  el.addEventListener('input', () => saveSound({ [key]: el.value / 100 }));
}

chips($('[data-opt=fps]'), { 30: '30 FPS', 60: '60 FPS', 0: 'Max' }, String(fpsCap), (v) => {
  store.set('fps', v);
  game.fpsCap = Number(v);
});

// host safety valve: call off a stuck race
$('#endRaceBtn').onclick = () => game.endRace(true);
setInterval(() => {
  if (!game.running || !game.isHost) return;
  $('#endRaceBtn').classList.toggle('hidden', !game.hostRace || game.hostRace.phase === 'lobby');
}, 250);

// debug handle for testing in the console
window.cruiseway = { game };
