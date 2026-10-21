import { MapView } from './map.js';
import { fmtTime } from './game.js';
import { DIFFICULTY } from './world/spots.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stars = (n) => '★'.repeat(n) + '☆'.repeat(5 - n);
const km = (m) => (m / 1000).toFixed(1) + ' km';

// Row of single-select chips. Returns { get, set }.
export function chips(el, options, value, onChange) {
  el.innerHTML = '';
  let cur = value;
  const btns = Object.entries(options).map(([k, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = () => { set(k); onChange?.(k); };
    el.appendChild(b);
    return [k, b];
  });
  const set = (k) => { cur = k; for (const [kk, b] of btns) b.classList.toggle('on', kk === k); };
  set(value);
  return { get: () => cur, set };
}

export function diffChip(spot) {
  const d = DIFFICULTY[spot.difficulty];
  return `<span class="chip diff" style="background:${d.color}">${stars(spot.difficulty)} ${d.label}</span>`;
}

// HUD + overlays used by the Game while riding.
export class UI {
  constructor() {
    this.minimap = null;
    this.bigMap = null;
    this.hudTick = 0;
    this.fatalShown = false;
    this.selectedSpot = null;
  }

  attachWorld(world) {
    this.minimap = new MapView($('#minimap'), world, { rotate: true, round: true });
    this.minimap.scale = 0.2;
  }

  setWorldCode(code) { $('#worldCode').textContent = code; }

  setRoster(list, selfId, hostId) {
    const rows = list
      .slice()
      .sort((a, b) => b.wins - a.wins)
      .map((p) => `<li class="${p.id === selfId ? 'me' : ''}"><span class="dot" style="background:${p.color}"></span>
        <span class="nm">${esc(p.name)}${p.id === hostId ? ' 👑' : ''}${p.id === selfId ? ' (you)' : ''}</span>
        <span class="wins" title="Race wins">${p.wins}🏆</span></li>`)
      .join('');
    $('#roster').innerHTML = `<li class="head"><span class="nm">Riders ${list.length}/6</span><span>wins</span></li>` + rows;
  }

  hud(s) {
    $('#speed').textContent = Math.round(s.speed);
    $('#odo').textContent = (s.odometer / 1000).toFixed(1);
    $('#surface').textContent = s.surface;
    this.hudTick++;
    const mapState = {
      me: s.me, yaw: s.yaw, others: s.others, gps: s.nav?.gps, waypoint: s.nav && !s.nav.spot ? s.nav : null,
      race: s.race?.participant ? s.race.spot : null,
      raceFrom: s.race?.participant ? s.race.progressS : 0,
      raceNext: s.race?.participant ? s.race.next : 0,
    };
    if (this.minimap && this.hudTick % 4 === 0) this.minimap.draw(mapState);
    if (this.bigMap && !$('#mapOverlay').classList.contains('hidden') && this.hudTick % 2 === 0) {
      this.bigMap.draw({ ...mapState, selected: this.selectedSpot });
    }

    // GPS indicator: arrow relative to where you're facing
    const nav = $('#nav');
    if (s.nav && !s.race?.participant) {
      nav.classList.remove('hidden');
      let rel = s.nav.bearing - s.yaw;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      // bearing is measured toward +x; on screen +x is to the left, so flip
      $('#navArrow').parentNode.style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
      const d = s.nav.gps ? Math.max(s.nav.gps.length, s.nav.dist) : s.nav.dist;
      $('#navDist').textContent = d > 950 ? km(d) : `${Math.round(d)} m`;
      $('#navName').textContent = s.nav.spot ? s.nav.spot.name : 'Waypoint';
    } else nav.classList.add('hidden');

    // lobby countdown text
    if (s.lobby) {
      const left = Math.max(0, Math.ceil((s.lobby.endsAt - performance.now()) / 1000));
      const n = s.lobby.members.length;
      $('#lobbyText').innerHTML = this.lobbyMember
        ? `🏁 <b>${esc(s.lobby.spotObj.name)}</b> · race starts in <b>${left}s</b> · ${n} rider${n === 1 ? '' : 's'} ready`
        : `<b>${esc(s.lobby.spotObj.name)}</b> · ${n} ready · starts in ${left}s · ride over to join`;
    }

    const bar = $('#raceBar');
    const r = s.race;
    if (r && r.participant) {
      bar.classList.remove('hidden');
      const total = r.spot.checkpoints.length;
      const t = r.finished ? r.finishTime : r.phase === 'running' ? r.elapsed || 0 : 0;
      const next = r.finished ? 'Finished!' : r.next < total ? `Checkpoint ${r.next + 1}/${total}` : 'Finish';
      bar.innerHTML = `<b>${fmtTime(t)}</b><span>Next <strong>${next}</strong></span>` +
        (r.finished || r.distToNext == null ? '' : `<span><strong>${Math.round(r.distToNext)} m</strong></span>`);
    } else if (r) {
      bar.classList.remove('hidden');
      bar.innerHTML = `<span>Race running at <strong>${esc(r.spot.name)}</strong></span>`;
    } else {
      bar.classList.add('hidden');
    }
  }

  // ---- race spots -----------------------------------------------------------

  spotPrompt(spot, best, busy, cb) {
    const el = $('#spotPrompt');
    $('#spName').textContent = spot.name;
    $('#spMeta').innerHTML = `${diffChip(spot)}<span class="chip">${km(spot.length)}</span>`
      + `<span class="chip">${Math.round(spot.dirtFrac * 100)}% dirt</span>`
      + `<span class="chip">${Math.round(spot.climb)} m climb</span>`
      + (best != null ? `<span class="chip">best ${fmtTime(best)}</span>` : '');
    const busyEl = $('#spBusy');
    busyEl.classList.toggle('hidden', !busy);
    busyEl.textContent = busy || '';
    $('#spYes').classList.toggle('hidden', !!busy);
    $('#spNo').textContent = busy ? 'OK' : 'Not now';
    el.classList.remove('hidden');
    const done = (yes) => { el.classList.add('hidden'); cb(yes); };
    $('#spYes').onclick = () => done(true);
    $('#spNo').onclick = () => done(false);
    this.promptKeys = (e) => {
      if (el.classList.contains('hidden')) return;
      if (e.code === 'Enter' && !busy) done(true);
      if (e.code === 'Backspace') done(false);
    };
    removeEventListener('keydown', this.promptKeysBound);
    this.promptKeysBound = this.promptKeys;
    addEventListener('keydown', this.promptKeysBound);
  }

  closeSpotPrompt() { $('#spotPrompt').classList.add('hidden'); }

  lobby(lobby, member, names, onGo) {
    const bar = $('#lobbyBar');
    if (!lobby) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.classList.toggle('member', member);
    this.lobbyMember = member;
    bar.title = names.join(', ');
    $('#lobbyGo').classList.toggle('hidden', !member);
    $('#lobbyGo').onclick = onGo;
  }

  showSpotCard(spot, best, onRoute) {
    this.selectedSpot = spot;
    const el = $('#spotCard');
    if (!spot) { el.classList.add('hidden'); return; }
    const d = DIFFICULTY[spot.difficulty];
    const pct = (v) => `<div class="bar"><i style="width:${Math.round(Math.min(1, v) * 100)}%;background:${d.color}"></i></div>`;
    el.innerHTML = `
      <div class="sp-kicker">RACE SPOT</div>
      <h3>${esc(spot.name)}</h3>
      <div class="stars" style="color:${d.color}">${stars(spot.difficulty)} <span style="color:var(--ink);font-size:14px">${d.label}</span></div>
      <dl>
        <dt>Distance</dt><dd>${km(spot.length)}</dd>
        <dt>Checkpoints</dt><dd>${spot.checkpoints.length}</dd>
        <dt>Twistiness</dt><dd>${pct(spot.curvy / 5)}</dd>
        <dt>Climbing</dt><dd>${Math.round(spot.climb)} m</dd>
        <dt>Dirt</dt><dd>${Math.round(spot.dirtFrac * 100)}%</dd>
        <dt>Your best</dt><dd>${best != null ? fmtTime(best) : '—'}</dd>
      </dl>
      <div class="row"><button class="btn small" id="cardClose">Close</button><button class="btn small primary" id="cardRoute">Set route</button></div>`;
    el.classList.remove('hidden');
    $('#cardClose').onclick = () => this.showSpotCard(null);
    $('#cardRoute').onclick = () => onRoute(spot);
  }

  // Banner for WRONG WAY / WRONG ROUTE / shortcut / TURN AROUND, with an arrow
  // pointing where to go relative to the bike's heading.
  guidance(state, rel, label) {
    const el = $('#guide');
    if (!state) { if (this.guideState) { el.classList.add('hidden'); this.guideState = null; } return; }
    if (state !== this.guideState) {
      this.guideState = state;
      el.className = state;
      const titles = { wrongway: 'TURN AROUND', turnaround: 'TURN AROUND' };
      $('#guideTitle').textContent = titles[state];
      // U-turn arrow for going backwards; warning triangle for leaving the route
      $('#guideIcon').innerHTML = state === 'wrongway' || state === 'turnaround'
        ? '<path d="M14 40 V20 a10 10 0 0 1 20 0 V30" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/><path d="M26 28 L34 38 L42 28 Z" fill="currentColor"/>'
        : '<path d="M24 5 L45 42 H3 Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><rect x="22" y="17" width="4" height="14" rx="2" fill="currentColor"/><circle cx="24" cy="36" r="2.6" fill="currentColor"/>';
      $('#guideIcon').style.color = state === 'turnaround' ? '#38e8ff' : state === 'shortcut' || state === 'offroute' ? '#f2c14e' : '#ff6b6b';
    }
    $('#guideText').textContent = label;
    $('#guideArrow').style.transform = 'rotate(' + ((-rel * 180) / Math.PI) + 'deg)';
    el.classList.remove('hidden');
  }

  // ---- generic ----------------------------------------------------------------

  toast(text) {
    const d = document.createElement('div');
    d.textContent = text;
    $('#toasts').appendChild(d);
    setTimeout(() => d.remove(), 5000);
  }

  flash(text) {
    const f = $('#flash');
    f.textContent = text;
    f.classList.add('show');
    clearTimeout(this.flashT);
    this.flashT = setTimeout(() => f.classList.remove('show'), 1600);
  }

  countdown(n) {
    const c = $('#countdown');
    c.textContent = n ?? '';
    c.classList.remove('pop');
    void c.offsetWidth;
    if (n != null) c.classList.add('pop');
  }

  fatal(text) {
    if (this.fatalShown) return;
    this.fatalShown = true;
    $('#fatalText').textContent = text;
    $('#fatal').classList.remove('hidden');
  }

  raceStandings(list, race) {
    const el = $('#standings');
    if (!list || !race || list.length < 2) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const total = race.spot.checkpoints.length + 1;
    el.innerHTML = list.map((s, i) => `<div class="${s.me ? 'me' : ''}"><span>${i + 1}.</span>
      <span class="dot" style="background:${s.color}"></span><span>${esc(s.name)}</span>
      <span class="t">${s.time != null ? fmtTime(s.time) : s.left ? 'left' : `${s.cp}/${total}`}</span></div>`).join('');
  }

  results(spot, list, iWon, solo) {
    $('#resultsTitle').textContent = solo ? 'Run complete' : iWon ? '🏆 You won!' : 'Race results';
    $('#resultsSub').textContent = `${spot.name} · ${km(spot.length)} · ${DIFFICULTY[spot.difficulty].label}`;
    $('#resultsList').innerHTML = list.map((s, i) => `<li><span class="pos">${i + 1}</span>
      <span class="dot" style="background:${s.color}"></span><span>${esc(s.name)}${s.me ? ' (you)' : ''}</span>
      <span class="t">${s.time != null ? fmtTime(s.time) : 'DNF'}</span></li>`).join('');
    $('#results').classList.remove('hidden');
    $('#resultsOk').onclick = () => $('#results').classList.add('hidden');
  }
}
