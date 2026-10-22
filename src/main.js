import { Game, QUALITY, presetFor } from './core/game.js';
import { UI, chips } from './ui/hud.js';
import { SoundManager, DEFAULT_SOUND } from './audio/sound.js';
import { Radio } from './radio/radio.js';
import { RadioPanel } from './ui/radioPanel.js';
import { Input } from './core/input.js';
import { Net, normalizeCode } from './network/net.js';
import { MapView } from './ui/map.js';
import { VEHICLES } from './vehicle/vehicles.js';
import { IS_MOBILE, setupMobile, keepAwake, Tilt, TILT_SENS } from './mobile/mobile.js';
import { TouchControls } from './mobile/touchControls.js';

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { return localStorage.getItem('cruiseway:' + k) ?? localStorage.getItem('convoy:' + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('cruiseway:' + k, v); } catch { /* private mode */ } },
};

const ui = new UI();
const input = new Input();
// Graphics settings are read before the renderer exists: anti-aliasing can
// only be chosen when the GL context is created.
setupMobile();
// phones start on Low (lighter on the GPU and the battery); change it in Esc > Graphics
let quality = store.get('quality', IS_MOBILE ? 'low' : 'auto');
if (!QUALITY[quality]) quality = 'auto';
const fpsCap = Number(store.get('fps', '60'));
let soundPrefs = DEFAULT_SOUND;
try { soundPrefs = { ...DEFAULT_SOUND, ...JSON.parse(store.get('sound', '{}')) }; } catch { /* keep defaults */ }
const sound = new SoundManager(soundPrefs);
const game = new Game($('#view'), ui, input, { msaa: presetFor(quality).msaa, quality, fpsCap, sound });

// Browsers only start audio after the player interacts with the page.
const unlockAudio = () => sound.unlock();
addEventListener('pointerdown', unlockAudio);
addEventListener('touchend', unlockAudio);   // iOS only unlocks audio on touchend
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

// Menu steps: home (your name) -> play (join with a code, or create) -> create.
// An invite link (?join=CODE) joins as soon as the name is in.
const show = (pane, keepStatus = false) => {
  for (const id of ['home', 'play', 'create']) $('#' + id).classList.toggle('hidden', id !== pane);
  if (!keepStatus) status('');
  if (pane === 'home') $('#name').focus();
  if (pane === 'play') { $('#helloName').textContent = playerName(); $('#code').focus(); }
};
document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => show(b.dataset.go)));

const invite = normalizeCode(new URLSearchParams(location.search).get('join'));
if (invite.length === 5) {
  $('#code').value = invite;
  $('#inviteCode').textContent = invite;
  $('#inviteNote').classList.remove('hidden');
  $('#doName').textContent = 'Join world';
}
// the address bar shows ?join=CODE while you play; a reload starts fresh
history.replaceState(null, '', location.pathname);

$('#doName').onclick = () => {
  if (!$('#name').value.trim()) { status('Enter a name so friends know who you are.', true); $('#name').focus(); return; }
  playerName();
  if (invite.length === 5) joinWorld(invite);
  else show('play');
};
$('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#doName').click(); });
$('#name').focus();

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

$('#doJoin').onclick = () => {
  const code = normalizeCode($('#code').value);
  if (code.length !== 5) { status('World codes are 5 characters.', true); return; }
  joinWorld(code);
};

async function joinWorld(code) {
  if (busy) return;
  busy = true;
  status(`Joining world ${code}…`);
  const net = new Net();
  try {
    await net.join(code);
    const welcome = await new Promise((resolve, reject) => {
      let resend = 0;
      const stop = () => { clearTimeout(t); clearInterval(resend); };
      const t = setTimeout(() => { stop(); reject(new Error('The host did not respond. They may have left the world.')); }, 10000);
      net.on('message', (_f, msg) => {
        if (msg.t === 'welcome') { stop(); resolve(msg); }
        if (msg.t === 'full') { stop(); reject(new Error('That world is full (6 players max).')); }
      });
      // say hello until the host answers: a first message can arrive before
      // the host's side of the connection is ready to read it
      const hello = () => net.send({ t: 'hello', name: playerName(), vehicle: game.vehicle });
      hello();
      resend = setInterval(hello, 1500);
    });
    enterGame({ net, seed: sanitizeSeed(welcome.seed), code, welcome });
  } catch (e) {
    net.close();
    // land on the code screen with the reason, so they can retry or create a world
    show('play', true);
    status(e.message, true);
  } finally {
    busy = false;
  }
}
$('#code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#doJoin').click(); });

function enterGame({ net, seed, code, welcome }) {
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  ui.setWorldCode(code);
  game.start({ net, seed, name: playerName(), welcome });
  ui.attachWorld(game.world);
  if (!IS_MOBILE) ui.toast('Press Q for the radio.');
  setupBigMap();
  if (IS_MOBILE) {
    touchControls = new TouchControls($('#hud'), input, game);
    touchControls.setTilt(tilt.on);
    document.body.classList.add('riding');
    keepAwake(true);   // don't let the screen dim mid-ride
  } else input.attachTouch($('#hud'));
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
const cursorOverlays = ['#pause', '#mapOverlay', '#results', '#fatal', '#spotPrompt', '#radio', '#garage'];
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
input.on('radio', () => { if (game.running && !IS_MOBILE) radioPanel.toggle(); });
input.on('power', (d) => { if (d && game.running) game.hunt.usePower(); });

// ---------------------------------------------------------------- vehicle (V)
game.setVehicle(store.get('vehicle', 'bike'));
function renderGarage() {
  const list = $('#garageList');
  list.innerHTML = '';
  Object.entries(VEHICLES).forEach(([kind, v], i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'garage-item' + (game.vehicle === kind ? ' on' : '');
    const bar = (label, x) => `<div class="g-stat"><span>${label}</span><i style="--w:${Math.round(x * 100)}%"></i></div>`;
    const img = game.vehicleThumb(kind);
    b.innerHTML = (img ? `<img class="g-img" src="${img}" alt="${v.label}">` : '') + `<div class="g-head"><kbd>${i + 1}</kbd><b>${v.label}</b>${game.vehicle === kind ? '<em>riding</em>' : ''}</div>
      <p>${v.blurb}</p>${bar('Top speed', v.stats.speed)}${bar('Acceleration', v.stats.accel)}${bar('Grip', v.stats.grip)}`;
    b.onclick = () => pickVehicle(kind);
    list.appendChild(b);
  });
}
function pickVehicle(kind) {
  if (game.setVehicle(kind)) {
    store.set('vehicle', kind);
    ui.toast(`Now riding the ${VEHICLES[kind].label.toLowerCase()}.`);
    $('#garage').classList.add('hidden');
  }
}
input.on('vehicle', () => {
  if (!game.running) return;
  const g = $('#garage');
  if (!g.classList.contains('hidden')) { g.classList.add('hidden'); return; }
  closeOverlays();
  renderGarage();
  g.classList.remove('hidden');
});
addEventListener('keydown', (e) => {
  if ($('#garage').classList.contains('hidden')) return;
  const kind = Object.keys(VEHICLES)[Number(e.key) - 1];
  if (kind) pickVehicle(kind);
});

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

const overlays = ['#pause', '#mapOverlay', '#garage'];
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
$('#leaveBtn').onclick = () => { radio.stop(); game.stop(); keepAwake(false); location.href = location.pathname; };
$('#mapClose').onclick = closeOverlays;

function setupBigMap() {
  ui.bigMap = new MapView($('#bigMap'), game.world, { interactive: true, touch: IS_MOBILE });
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

// phones: steer by dragging, or by tilting the phone like a wheel
let touchControls = null;
const tilt = new Tilt((v) => { input.touch.tilt = v; });
const steerHints = {
  touch: 'Put your thumb on the left side and slide it left or right.',
  tilt: 'Hold the phone sideways and turn it like a steering wheel. Touching the left side still steers too.',
};
function showSteering(mode) {
  $('#tiltSensRow').classList.toggle('hidden', mode !== 'tilt');
  $('#steerHint').textContent = steerHints[mode];
  touchControls?.setTilt(mode === 'tilt');
}
async function setSteering(mode) {
  if (mode === 'tilt') {
    const ok = await tilt.enable();
    if (!ok) {
      ui.toast('Tilt steering needs motion access. Allow it in your browser, or keep Drag.');
      steeringChips.set('touch');
      mode = 'touch';
    }
  } else tilt.disable();
  store.set('steering', mode);
  showSteering(mode);
}
const steeringPref = store.get('steering') === 'tilt' ? 'tilt' : 'touch';
const steeringChips = chips($('[data-opt=steering]'), { touch: 'Drag', tilt: 'Tilt' }, steeringPref, (v) => setSteering(v));
const sensPref = TILT_SENS[store.get('tiltSens')] ? store.get('tiltSens') : 'medium';
tilt.full = TILT_SENS[sensPref];
chips($('[data-opt=tiltSens]'), { low: 'Low', medium: 'Medium', high: 'High' }, sensPref, (v) => { tilt.full = TILT_SENS[v]; store.set('tiltSens', v); });
showSteering(steeringPref);
// iOS only grants motion access inside a tap, so a saved Tilt choice
// switches on at the first tap of the session
if (IS_MOBILE && steeringPref === 'tilt') {
  addEventListener('pointerup', function first() {
    removeEventListener('pointerup', first, true);
    setSteering('tilt');
  }, true);
}

// weather: the shared forecast, or always sunny on this device
const weatherPref = store.get('weather') === 'clear' ? 'clear' : 'live';
game.setClearSkies(weatherPref === 'clear');
chips($('[data-opt=weather]'), { live: 'Live', clear: 'Always sunny' }, weatherPref, (v) => {
  store.set('weather', v);
  game.setClearSkies(v === 'clear');
});

chips($('[data-opt=fps]'), { 30: '30 FPS', 60: '60 FPS', 0: 'Max' }, String(fpsCap), (v) => {
  store.set('fps', v);
  game.fpsCap = Number(v);
});

// Esc menu tabs (the last one opened is remembered)
function showTab(name) {
  for (const b of document.querySelectorAll('#pauseTabs button')) b.classList.toggle('on', b.dataset.tab === name);
  for (const p of document.querySelectorAll('#pause .pane')) p.classList.toggle('hidden', p.dataset.pane !== name);
  store.set('menuTab', name);
}
for (const b of document.querySelectorAll('#pauseTabs button')) b.onclick = () => showTab(b.dataset.tab);
showTab(['general', 'graphics', 'audio', 'controls'].includes(store.get('menuTab')) ? store.get('menuTab') : 'general');

// host safety valve: call off a stuck race
$('#endRaceBtn').onclick = () => game.endRace(true);
setInterval(() => {
  if (!game.running || !game.isHost) return;
  $('#endRaceBtn').classList.toggle('hidden', !game.hostRace || game.hostRace.phase === 'lobby');
}, 250);

// debug handle for testing in the console
window.cruiseway = { game };
