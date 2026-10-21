import { MapView } from './map.js';
import { fmtTime } from './game.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Build a row of single-select chips. Returns { get, set }.
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

// HUD + overlays used by the Game while driving.
export class UI {
  constructor() {
    this.minimap = null;
    this.hudTick = 0;
    this.fatalShown = false;
  }

  attachWorld(world) {
    this.minimap = new MapView($('#minimap'), world);
    this.minimap.scale = 0.22;
  }

  setWorldCode(code) {
    $('#worldCode').textContent = code;
  }

  setRoster(list, selfId, hostId) {
    const rows = list
      .slice()
      .sort((a, b) => b.wins - a.wins)
      .map((p) => `<li class="${p.id === selfId ? 'me' : ''}"><span class="dot" style="background:${p.color}"></span>
        <span class="nm">${esc(p.name)}${p.id === hostId ? ' 👑' : ''}${p.id === selfId ? ' (you)' : ''}</span>
        <span class="wins" title="Race wins">${p.wins}🏆</span></li>`)
      .join('');
    $('#roster').innerHTML = `<li class="head"><span class="nm">Drivers ${list.length}/6</span><span>wins</span></li>` + rows;
  }

  hud(s) {
    $('#speed').textContent = Math.round(s.speed);
    $('#odo').textContent = (s.odometer / 1000).toFixed(1);
    $('#surface').textContent = s.onRoad ? '' : 'off-road';
    this.hudTick++;
    if (this.minimap && this.hudTick % 4 === 0) {
      this.minimap.draw({ me: s.me, heading: s.yaw, others: s.others, race: s.race });
    }
    if (this.bigMap && !$('#mapOverlay').classList.contains('hidden') && this.hudTick % 3 === 0) {
      this.bigMap.draw({ me: s.me, heading: s.yaw, others: s.others, race: s.race });
    }
    const bar = $('#raceBar');
    const r = s.race;
    if (r && r.participant && (r.phase === 'running' || r.phase === 'countdown' || r.phase === 'spawn')) {
      bar.classList.remove('hidden');
      const total = r.cps.length;
      const t = r.finished ? r.finishTime : r.phase === 'running' ? r.elapsed || 0 : 0;
      const next = r.finished ? 'Finished!' : r.next < total ? `Checkpoint ${r.next + 1}/${total}` : 'Finish';
      bar.innerHTML = `<b>${fmtTime(t)}</b><span>Next <strong>${next}</strong></span>` +
        (r.finished || r.distToNext == null ? '' : `<span><strong>${Math.round(r.distToNext)} m</strong> away</span>`);
    } else if (r && !r.participant) {
      bar.classList.remove('hidden');
      bar.innerHTML = '<span>Race in progress — you are free-roaming</span>';
    } else {
      bar.classList.add('hidden');
    }
  }

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

  invite(msg, reply) {
    const r = msg.race;
    $('#inviteText').innerHTML = `<b>${esc(msg.host)}</b> wants to race: <b>${(r.length / 1000).toFixed(1)} km</b> with
      ${r.cps.length} checkpoint${r.cps.length === 1 ? '' : 's'}. You'll be moved to the start line.`;
    $('#invite').classList.remove('hidden');
    const bar = $('#inviteTimer');
    const start = performance.now();
    const total = msg.seconds * 1000;
    clearInterval(this.inviteT);
    this.inviteT = setInterval(() => {
      const left = Math.max(0, 1 - (performance.now() - start) / total);
      bar.style.width = left * 100 + '%';
      if (left <= 0) done(false);
    }, 100);
    const done = (yes) => {
      clearInterval(this.inviteT);
      $('#invite').classList.add('hidden');
      reply(yes);
    };
    $('#acceptBtn').onclick = () => done(true);
    $('#declineBtn').onclick = () => done(false);
  }

  closeInvite() {
    clearInterval(this.inviteT);
    $('#invite').classList.add('hidden');
  }

  hostInviteStatus(list) {
    const el = $('#inviteStatus');
    if (!list) { el.innerHTML = ''; return; }
    const icon = { yes: '✅', no: '❌', wait: '⏳' };
    el.innerHTML = '<div style="color:var(--muted);margin-bottom:4px">Waiting for replies…</div>' +
      list.map((p) => `<div>${icon[p.reply]} ${esc(p.name)}</div>`).join('');
  }

  raceStandings(list, race) {
    const el = $('#standings');
    if (!list || !race) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    const total = race.cps.length + 1;
    el.innerHTML = list.map((s, i) => `<div class="${s.me ? 'me' : ''}"><span>${i + 1}.</span>
      <span class="dot" style="background:${s.color}"></span><span>${esc(s.name)}</span>
      <span class="t">${s.time != null ? fmtTime(s.time) : s.left ? 'left' : `${s.cp}/${total}`}</span></div>`).join('');
  }

  results(list, iWon) {
    $('#resultsTitle').textContent = iWon ? '🏆 You won!' : 'Race results';
    $('#resultsList').innerHTML = list.map((s, i) => `<li><span class="pos">${i + 1}</span>
      <span class="dot" style="background:${s.color}"></span><span>${esc(s.name)}${s.me ? ' (you)' : ''}</span>
      <span class="t">${s.time != null ? fmtTime(s.time) : 'DNF'}</span></li>`).join('');
    $('#results').classList.remove('hidden');
    $('#resultsOk').onclick = () => $('#results').classList.add('hidden');
  }
}
