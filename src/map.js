// Top-down map drawn on a canvas: the road, players, and race points.
// Screen up = world +z, screen right = world -x (so it is not mirrored
// relative to what you see from the driver's seat).

export class MapView {
  constructor(canvas, world, { interactive = false } = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = world;
    this.cx = 0; this.cz = 0;
    this.scale = 0.25; // px per metre
    this.follow = true;
    this.onPick = null;
    if (interactive) this.attach();
  }

  toScreen(x, z) {
    const w = this.cv.width, h = this.cv.height;
    return [w / 2 - (x - this.cx) * this.scale, h / 2 - (z - this.cz) * this.scale];
  }

  toWorld(px, py) {
    const w = this.cv.width, h = this.cv.height;
    return [this.cx - (px - w / 2) / this.scale, this.cz - (py - h / 2) / this.scale];
  }

  attach() {
    const cv = this.cv;
    let drag = null, moved = false;
    const pt = (e) => {
      const r = cv.getBoundingClientRect();
      return [(e.clientX - r.left) * (cv.width / r.width), (e.clientY - r.top) * (cv.height / r.height)];
    };
    cv.addEventListener('pointerdown', (e) => { drag = pt(e); moved = false; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = pt(e);
      const dx = p[0] - drag[0], dy = p[1] - drag[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) {
        this.follow = false;
        this.cx += dx / this.scale;
        this.cz += dy / this.scale;
        drag = p;
      }
    });
    cv.addEventListener('pointerup', (e) => {
      if (drag && !moved && this.onPick) {
        const [x, z] = this.toWorld(...pt(e));
        this.onPick(x, z);
      }
      drag = null;
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scale = Math.min(3, Math.max(0.03, this.scale * (e.deltaY > 0 ? 0.85 : 1.18)));
    }, { passive: false });
  }

  draw({ me, others = [], race = null, picks = null, heading = null }) {
    const { ctx, cv } = this;
    const road = this.world.road;
    if (this.follow && me) { this.cx = me.x; this.cz = me.z; }
    road.ensureAround(this.cz, Math.max(2500, cv.height / this.scale));
    ctx.fillStyle = '#1d2621';
    ctx.fillRect(0, 0, cv.width, cv.height);

    // road
    const span = Math.hypot(cv.width, cv.height) / this.scale;
    const stride = Math.max(1, Math.floor(2 / this.scale / 3));
    ctx.strokeStyle = '#d8d2c0';
    ctx.lineWidth = Math.max(2, 9.2 * this.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    for (let k = road.minK; k <= road.maxK; k += stride) {
      const d = road.dense(k);
      if (Math.abs(d.z - this.cz) > span) { pen = false; continue; }
      const [sx, sy] = this.toScreen(d.x, d.z);
      if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
      pen = true;
    }
    ctx.stroke();

    // race route highlight + gates
    const route = race || (picks && picks.s0 != null && picks.s1 != null ? picks : null);
    if (route) {
      const a = Math.min(route.s0, route.s1), b = Math.max(route.s0, route.s1);
      ctx.strokeStyle = '#f2a30f';
      ctx.lineWidth = Math.max(3, 9.2 * this.scale);
      ctx.beginPath();
      for (let s = a, first = true; s <= b; s += Math.max(3, 6 / this.scale)) {
        const p = road.at(s);
        const [sx, sy] = this.toScreen(p.x, p.z);
        if (first) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        first = false;
      }
      ctx.stroke();
      for (const s of route.cps || []) this.dot(road.at(s), '#f2a30f', 5, '#000');
    }
    const flags = race || picks;
    if (flags) {
      if (flags.s0 != null) this.flag(road.at(flags.s0), '#2a7de1', 'S');
      if (flags.s1 != null) this.flag(road.at(flags.s1), '#ffffff', 'F');
    }

    for (const o of others) this.dot(o, o.color, 6, '#000', o.name);
    if (me) {
      const [sx, sy] = this.toScreen(me.x, me.z);
      ctx.save();
      ctx.translate(sx, sy);
      // heading: world forward (sin yaw, cos yaw) -> screen (-sin, -cos)
      ctx.rotate(-(heading ?? 0) + Math.PI);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 9); ctx.lineTo(6, -6); ctx.lineTo(0, -2); ctx.lineTo(-6, -6); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // Zoom/pan so the road between s0 and s1 fits the canvas.
  fitRoute(s0, s1) {
    const road = this.world.road;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const a = Math.min(s0, s1), b = Math.max(s0, s1);
    for (let s = a; s <= b; s += Math.max(10, (b - a) / 100)) {
      const p = road.at(s);
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
    }
    this.follow = false;
    this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2;
    this.scale = Math.min(1, 0.85 * Math.min(this.cv.width / Math.max(1, x1 - x0), this.cv.height / Math.max(1, z1 - z0)));
  }

  dot(p, color, r, stroke, label) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(p.x, p.z);
    ctx.fillStyle = color;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (label) {
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = '#fff';
      ctx.fillText(label, sx + 9, sy + 4);
    }
  }

  flag(p, color, letter) {
    const ctx = this.ctx;
    const [sx, sy] = this.toScreen(p.x, p.z);
    ctx.fillStyle = color;
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 10, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color === '#ffffff' ? '#000' : '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(letter, sx, sy + 4);
    ctx.textAlign = 'start';
  }
}
