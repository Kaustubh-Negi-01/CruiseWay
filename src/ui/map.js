import { MAP_EXTENT } from '../world/generation/terrainGen.js';
import { KIND_DIRT } from '../world/generation/network.js';
import { spotStyle } from '../world/generation/spots.js';
import { CITY_NAME } from '../world/city/cityGen.js';

// Island map: a satellite-style picture (terrain image from the worker with
// the road network painted on top), plus live overlays — spots, riders,
// waypoint and GPS route. Used both for the full-screen map and the minimap.
//
// Screen right = world -x and screen up = world +z (north-up), so the map is
// never mirrored relative to the view from the saddle. The minimap can rotate
// heading-up.

const COMP = 2048;                       // composite image size

// Shared per world: one composite used by every MapView. The city paints its
// own picture (world.extent says how much ground it covers).
const composites = new WeakMap();
function compositeFor(world) {
  let c = composites.get(world);
  if (c) return c;
  const extent = world.extent || MAP_EXTENT;
  c = { canvas: document.createElement('canvas'), ready: false, extent, mpp: (extent * 2) / COMP, bg: world.extent ? '#0a0f22' : '#1b4a54' };
  c.canvas.width = c.canvas.height = COMP;
  if (world.extent) {
    world.onMapReady((pic) => { c.canvas.getContext('2d').drawImage(pic, 0, 0, COMP, COMP); c.ready = true; });
  } else {
    paint(c.canvas, world, null, c);
    world.onMapReady((terrain) => { paint(c.canvas, world, terrain, c); c.ready = true; });
  }
  composites.set(world, c);
  return c;
}

function toImg(x, z, c) { return [(c.extent - x) / c.mpp, (c.extent - z) / c.mpp]; }

function paint(canvas, world, terrain, comp) {
  const g = canvas.getContext('2d');
  if (terrain) {
    g.imageSmoothingEnabled = true;
    g.drawImage(terrain, 0, 0, COMP, COMP);
  } else {
    g.fillStyle = '#1f4b55';
    g.fillRect(0, 0, COMP, COMP);
  }
  const net = world.net;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const trace = (e) => {
    g.beginPath();
    for (let i = 0; i < e.n; i += 4) {
      const [u, v] = toImg(e.x[i], e.z[i], comp);
      if (i === 0) g.moveTo(u, v); else g.lineTo(u, v);
    }
    const [u, v] = toImg(e.x[e.n - 1], e.z[e.n - 1], comp);
    g.lineTo(u, v);
  };
  // dirt first (under), then paved with a dark casing
  for (const e of net.edges) {
    if (e.kind !== KIND_DIRT) continue;
    trace(e);
    g.setLineDash([5, 4]);
    g.strokeStyle = 'rgba(40,24,10,0.55)'; g.lineWidth = 3.2; g.stroke();
    g.strokeStyle = '#d9a35f'; g.lineWidth = 1.8; g.stroke();
  }
  g.setLineDash([]);
  for (const e of net.edges) {
    if (e.kind === KIND_DIRT) continue;
    trace(e);
    g.strokeStyle = 'rgba(20,20,22,0.6)'; g.lineWidth = 4.6; g.stroke();
  }
  for (const e of net.edges) {
    if (e.kind === KIND_DIRT) continue;
    trace(e);
    g.strokeStyle = '#f1efe8'; g.lineWidth = 2.6; g.stroke();
  }
}

export class MapView {
  constructor(canvas, world, { interactive = false, rotate = false, round = false, touch = false } = {}) {
    this.touch = touch;   // phones: pinch to zoom, long-press to drop a waypoint
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.comp = compositeFor(world);
    this.cx = 0; this.cz = 0;
    this.scale = 0.2; // px per metre
    this.rot = 0;
    this.rotate = rotate;
    this.round = round;
    this.follow = true;
    this.onPick = null;   // (x, z) clicked on open map
    this.onSpot = null;   // (spot) clicked
    if (interactive) this.attach();
  }

  toScreen(x, z) {
    const dx = (this.cx - x) * this.scale, dy = (this.cz - z) * this.scale;
    const c = Math.cos(this.rot), s = Math.sin(this.rot);
    return [this.cv.width / 2 + dx * c - dy * s, this.cv.height / 2 + dx * s + dy * c];
  }

  toWorld(px, py) {
    const dx = px - this.cv.width / 2, dy = py - this.cv.height / 2;
    const c = Math.cos(-this.rot), s = Math.sin(-this.rot);
    const rx = dx * c - dy * s, ry = dx * s + dy * c;
    return [this.cx - rx / this.scale, this.cz - ry / this.scale];
  }

  fitIsland() {
    this.follow = false;
    this.cx = 0; this.cz = 0;
    this.scale = (Math.min(this.cv.width, this.cv.height) * 0.95) / (this.comp.extent * 2);
  }

  // The other world: same view settings, its own picture.
  setWorld(world) {
    this.world = world;
    this.comp = compositeFor(world);
    this.follow = true;
  }

  attach() {
    const cv = this.cv;
    let drag = null, moved = false;
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)];
    };
    // phones: two fingers pinch-zoom about their midpoint; holding one
    // finger still for half a second drops a waypoint (a quick tap only
    // opens race spots, so panning never drops pins by accident)
    const fingers = new Map();
    let pinch = null, press = null;
    const zoomAbout = (p, k) => {
      const [wx, wz] = this.toWorld(p[0], p[1]);
      this.scale = Math.min(2, Math.max(0.05, this.scale * k));
      const [nx, nz] = this.toWorld(p[0], p[1]);
      this.cx += wx - nx; this.cz += wz - nz;
      this.follow = false;
    };
    if (this.touch) {
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', (e) => {
        fingers.set(e.pointerId, pt(e));
        clearTimeout(press);
        if (fingers.size === 2) {
          const [a, b] = [...fingers.values()];
          pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) };
          drag = null;
        } else if (fingers.size === 1) {
          const p = pt(e);
          press = setTimeout(() => {
            if (moved || fingers.size !== 1 || this.spotAt(p[0], p[1])) return;
            moved = true;   // consumed: no tap on release
            navigator.vibrate?.(30);
            this.onPick?.(...this.toWorld(p[0], p[1]));
          }, 500);
        }
      }, true);
      cv.addEventListener('pointermove', (e) => {
        if (!fingers.has(e.pointerId)) return;
        fingers.set(e.pointerId, pt(e));
        if (pinch && fingers.size === 2) {
          const [a, b] = [...fingers.values()];
          const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
          zoomAbout([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d / pinch.d);
          pinch.d = d;
          moved = true;
          clearTimeout(press);
        }
      }, true);
      const lift = (e) => {
        fingers.delete(e.pointerId);
        clearTimeout(press);
        if (fingers.size < 2) pinch = null;
      };
      cv.addEventListener('pointerup', lift, true);
      cv.addEventListener('pointercancel', lift, true);
    }
    cv.addEventListener('pointerdown', (e) => { if (pinch) return; drag = pt(e); moved = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag || pinch) return;
      const p = pt(e);
      const dx = p[0] - drag[0], dy = p[1] - drag[1];
      if (Math.abs(dx) + Math.abs(dy) > (this.touch ? 10 : 4)) { moved = true; clearTimeout(press); }
      if (moved) {
        this.follow = false;
        this.cx += dx / this.scale;
        this.cz += dy / this.scale;
        drag = p;
      }
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !moved) {
        const p = pt(e);
        const spot = this.spotAt(p[0], p[1]);
        if (spot && this.onSpot) this.onSpot(spot);
        else if (this.onPick && !this.touch) this.onPick(...this.toWorld(p[0], p[1]));
      }
      drag = null;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const p = pt(e);
      const [wx, wz] = this.toWorld(p[0], p[1]);
      this.scale = Math.min(2, Math.max(0.05, this.scale * (e.deltaY > 0 ? 0.85 : 1.18)));
      // zoom about the cursor
      const [nx, nz] = this.toWorld(p[0], p[1]);
      this.cx += wx - nx; this.cz += wz - nz;
      this.follow = false;
    }, { passive: false });
  }

  spotAt(px, py) {
    for (const s of this.world.spots) {
      const p = s.route.at(s.startS);
      const [sx, sy] = this.toScreen(p.x, p.z);
      if ((sx - px) ** 2 + (sy - py) ** 2 < (this.touch ? 30 : 16) ** 2) return s;   // fingers are bigger than cursors
    }
    return null;
  }

  // o: { me:{x,z}, yaw, others:[{x,z,color,name}], gps:{pts}, waypoint:{x,z}, race:spot, selected:spot }
  draw(o) {
    const { ctx, cv } = this;
    const W = cv.width, H = cv.height;
    if (this.follow && o.me) { this.cx = o.me.x; this.cz = o.me.z; }
    this.rot = this.rotate && o.yaw != null ? o.yaw : 0; // heading-up: forward points to the top
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (this.round) { ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2); ctx.clip(); }
    ctx.fillStyle = this.comp.bg;
    ctx.fillRect(0, 0, W, H);

    // satellite composite
    const [u, v] = toImg(this.cx, this.cz, this.comp);
    const k = this.scale * this.comp.mpp;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(this.rot);
    ctx.scale(k, k);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.comp.canvas, -u, -v);
    ctx.restore();

    // race route or selected spot's route
    const routeSpot = o.race || o.selected;
    if (routeSpot) this.polyline(routeSpot.route, '#ffcf3a', Math.max(3, 5 * Math.min(1, this.scale * 4)), 0.9, o.race ? o.raceFrom || 0 : 0);
    // GPS
    if (o.gps) this.path(o.gps.pts, '#38e8ff', Math.max(3.5, 6 * Math.min(1, this.scale * 4)));

    // spots
    if (!o.bare) for (const s of this.world.spots) this.spotIcon(s, s === o.selected, o.race === s);
    if (o.race) {
      o.race.checkpoints.forEach((cs, i) => { if (i >= (o.raceNext || 0)) this.dot(o.race.route.at(cs), '#ffcf3a', 4, '#111'); });
      this.flag(o.race.route.at(o.race.route.length - 1), '#ffffff', 'F');
    }
    if (!o.bare) for (const p of this.world.portals || []) this.gate(p);
    if (o.waypoint) this.pin(o.waypoint);
    if (o.zone) {
      // the Manhunt zone
      const [zx, zy] = this.toScreen(o.zone.x, o.zone.z);
      ctx.save();
      ctx.strokeStyle = '#c77dff'; ctx.lineWidth = 2.5; ctx.setLineDash([8, 5]);
      ctx.beginPath(); ctx.arc(zx, zy, o.zone.r * this.scale, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    for (const p of o.others || []) {
      if (p.it) this.dot(p, '#ff2b4a', 9, '#fff');      // the IT, ringed in red
      this.dot(p, p.color, 6, '#000', this.scale > 0.1 ? (p.it ? p.name + ' · IT' : p.name) : null);
    }
    if (o.me) this.arrow(o.me, o.yaw ?? 0);
    ctx.restore();
  }

  polyline(route, color, width, alpha = 1, fromS = 0) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = width + 3;
    ctx.lineCap = ctx.lineJoin = 'round';
    const stride = Math.max(1, Math.floor(3 / Math.max(this.scale, 0.01) / 3));
    const i0 = fromS > 0 ? route.indexAt(fromS) : 0;
    const go = () => {
      ctx.beginPath();
      // start exactly at the rider's progress point, so the line shrinks behind you
      const p = route.at(fromS);
      let [x, y] = this.toScreen(p.x, p.z);
      ctx.moveTo(x, y);
      for (let i = i0 + 1; i < route.n; i += stride) {
        [x, y] = this.toScreen(route.x[i], route.z[i]);
        ctx.lineTo(x, y);
      }
      [x, y] = this.toScreen(route.x[route.n - 1], route.z[route.n - 1]);
      ctx.lineTo(x, y);
      ctx.stroke();
    };
    go();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    go();
    ctx.restore();
  }

  path(pts, color, width) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = ctx.lineJoin = 'round';
    const go = () => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => { const [sx, sy] = this.toScreen(x, z); if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy); });
      ctx.stroke();
    };
    ctx.strokeStyle = 'rgba(0,20,30,0.6)'; ctx.lineWidth = width + 3; go();
    ctx.strokeStyle = color; ctx.lineWidth = width; go();
    ctx.restore();
  }

  spotIcon(s, selected, active) {
    const ctx = this.ctx;
    const p = s.route.at(s.startS);
    const [x, y] = this.toScreen(p.x, p.z);
    const d = spotStyle(s);
    const r = selected || active ? 13 : 10;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#16181c';
    ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = d.color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    if (s.mode === 'hunt') {
      // target glyph for Manhunt arenas
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(x, y, 1.8, 0, Math.PI * 2); ctx.fill();
    } else {
      // chequered flag glyph
      ctx.fillStyle = '#111';
      ctx.fillRect(x - 4, y - 6, 1.6, 12);
      for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#111' : '#fff';
        ctx.fillRect(x - 2.4 + i * 2.4, y - 6 + j * 2.4, 2.4, 2.4);
      }
    }
    if (this.scale > 0.07 || selected) {
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.fillStyle = '#fff';
      ctx.strokeText(s.name, x + r + 6, y + 4);
      ctx.fillText(s.name, x + r + 6, y + 4);
    }
    ctx.restore();
  }

  dot(p, color, r, stroke, label) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(p.x, p.z);
    ctx.fillStyle = color;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (label) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(label, sx + 9, sy + 4);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, sx + 9, sy + 4);
    }
  }

  flag(p, color, letter) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(p.x, p.z);
    ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#000';
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(letter, sx, sy + 4);
    ctx.textAlign = 'start';
  }

  // a portal to the other world: a glowing cyan ring, like the real thing
  gate(p) {
    const ctx = this.ctx;
    const [x, y] = this.toScreen(p.x, p.z);
    const city = !!this.world.extent;
    const col = '#22e5ff';
    const rad = Math.max(9, Math.min(22, p.r * this.scale * 1.2));
    ctx.save();
    ctx.shadowColor = col; ctx.shadowBlur = 16;
    ctx.strokeStyle = col; ctx.lineWidth = 3.5;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, rad * 0.62, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgba(230,255,255,0.85)'); grad.addColorStop(1, 'rgba(34,229,255,0.15)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, rad * 0.9, 0, Math.PI * 2); ctx.fill();
    if (this.scale > 0.06) {
      const label = city ? 'Portal to the island' : `Portal to ${CITY_NAME}`;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, x + rad + 6, y + 4);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x + rad + 6, y + 4);
    }
    ctx.restore();
  }

  pin(p) {
    const ctx = this.ctx;
    const [x, y] = this.toScreen(p.x, p.z);
    ctx.save();
    ctx.fillStyle = '#38e8ff';
    ctx.strokeStyle = '#06222a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(x - 10, y - 12, x - 9, y - 24, x, y - 24);
    ctx.bezierCurveTo(x + 9, y - 24, x + 10, y - 12, x, y);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#06222a';
    ctx.beginPath(); ctx.arc(x, y - 16, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  arrow(p, yaw) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(p.x, p.z);
    ctx.save();
    ctx.translate(sx, sy);
    ctx.rotate(this.rot + Math.PI - yaw);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#0a0c10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 11); ctx.lineTo(7, -7); ctx.lineTo(0, -3); ctx.lineTo(-7, -7); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
