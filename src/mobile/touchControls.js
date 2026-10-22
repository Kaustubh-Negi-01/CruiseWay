import { buzz } from './mobile.js';

// Thumb controls for phones, laid out for landscape:
//   left half   drag left/right anywhere to steer (analogue; a ring shows
//               where your thumb landed)
//   right       big GAS, BRAKE (also reverse), DRIFT (rear brake slide),
//               WHEELIE on the bike, and the Manhunt power-up when you have one
//   top         pause, camera, reset, vehicle; tap the minimap for the big map
// Built on Pointer Events so several fingers work at once.

// keep getting a finger's moves even if it slides off the control
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* finger already gone */ } };

const FULL_LOCK = 56;   // px of thumb travel for full steering
const DEAD = 5;         // px dead zone around where the thumb landed

export class TouchControls {
  constructor(root, input, game) {
    this.input = input;
    this.game = game;
    this.root = root;
    const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
    const box = root.querySelector('#touch');
    box.innerHTML = '';

    // steering zone
    this.zone = el('<div class="t-steer"><div class="t-ring"><i></i></div><span class="t-hint">◀ drag to steer ▶</span></div>');
    this.ring = this.zone.querySelector('.t-ring');
    this.dot = this.ring.querySelector('i');
    box.appendChild(this.zone);
    this.bindSteer();

    // pedals and actions
    const btn = (cls, label, opts = {}) => {
      const b = el(`<button class="t-btn ${cls}" type="button">${label}</button>`);
      box.appendChild(b);
      if (opts.hold) this.hold(b, opts.hold);
      if (opts.tap) this.tap(b, opts.tap);
      return b;
    };
    btn('t-gas', 'GAS', { hold: 'throttle' });
    btn('t-brake', 'BRAKE', { hold: 'brake' });
    btn('t-drift', 'DRIFT', { hold: 'handbrake' });
    this.wheelieBtn = btn('t-wheelie', 'WHEELIE', { hold: 'wheelie' });
    this.powerBtn = btn('t-power hidden', '⚡', { tap: () => { this.input.fire('power', true); buzz(30); } });
    btn('t-pause', '☰', { tap: () => this.input.fire('escape', true) });
    btn('t-cam', '🎥', { tap: () => this.input.fire('camera', true) });
    btn('t-reset', '↺', { tap: () => this.input.fire('reset', true) });
    btn('t-veh', '⇄', { tap: () => this.input.fire('vehicle', true) });
    // the minimap opens the big map
    root.querySelector('#minimap')?.addEventListener('click', () => this.input.fire('map', true));

    // contextual buttons follow the game state a few times a second
    setInterval(() => this.refresh(), 250);
  }

  // hold-to-press pedals
  hold(b, key) {
    const down = (e) => { e.preventDefault(); capture(b, e.pointerId); this.input.touch[key] = 1; b.classList.add('down'); if (key !== 'throttle') buzz(12); };
    const up = () => { this.input.touch[key] = 0; b.classList.remove('down'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
  }

  tap(b, fn) {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('down'); });
    b.addEventListener('pointerup', (e) => { e.preventDefault(); b.classList.remove('down'); fn(); });
    b.addEventListener('pointercancel', () => b.classList.remove('down'));
  }

  bindSteer() {
    let id = null, x0 = 0;
    const set = (dx) => {
      const d = Math.abs(dx) < DEAD ? 0 : dx - Math.sign(dx) * DEAD;
      const v = Math.max(-1, Math.min(1, d / FULL_LOCK));
      this.input.touch.steer = -v;   // drag right = steer right
      this.dot.style.transform = `translateX(${v * FULL_LOCK}px)`;
    };
    this.zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      x0 = e.clientX;
      capture(this.zone, id);
      const r = this.zone.getBoundingClientRect();
      this.ring.style.left = (e.clientX - r.left) + 'px';
      this.ring.style.top = (e.clientY - r.top) + 'px';
      this.zone.classList.add('active');
      set(0);
    });
    this.zone.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e.clientX - x0); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.input.touch.steer = 0;
      this.zone.classList.remove('active');
      this.dot.style.transform = '';
    };
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
  }

  refresh() {
    const g = this.game;
    this.wheelieBtn.classList.toggle('hidden', !g.running || g.vehicle !== 'bike');
    const r = g.race, h = g.hunt;
    const power = g.running && r?.mode === 'hunt' && r.phase === 'running' && r.it === g.selfId && h.power;
    this.powerBtn.classList.toggle('hidden', !power);
    if (power) this.powerBtn.textContent = h.power === 'nitro' ? '🔥' : h.power === 'radar' ? '📡' : '💥';
  }
}
