import { CITY, K, CITY_NAME, NEON } from './cityGen.js';
import { mulberry32 } from '../generation/noise.js';

// Hikari's map picture, in the style of a night-time city guide: dark water
// with depth contours, streets lighter than the blocks so the grid reads at a
// glance, the Loop glowing cyan and the ring road purple, buildings tinted
// by district, and the districts named. Same projection as the island map
// (2048 px over the square extent, screen right = world -x, up = +z).

const SIZE = 2048;

const DISTRICT = {
  down: { fill: '#2b2058', line: '#8a6cff' },
  mid: { fill: '#221d42', line: '#4f4794' },
  edge: { fill: '#1d1933', line: '#3b3470' },
  tech: { fill: '#0b2a33', line: '#1fc8de' },
  harbor: { fill: '#2b2015', line: '#d08a2a' },
};
const BOX = ['#7a2626', '#22507a', '#276e46', '#a85a1a', '#4a4f58', '#6a2a5e'];

export function paintCityMap(L) {
  const ext = CITY.extent, k = SIZE / (ext * 2);
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const g = c.getContext('2d');
  const X = (x) => (ext - x) * k, Z = (z) => (ext - z) * k;
  const fill = (x0, z0, x1, z1) => g.fillRect(X(x1), Z(z1), (x1 - x0) * k, (z1 - z0) * k);
  const stroke = (x0, z0, x1, z1) => g.strokeRect(X(x1) + 0.5, Z(z1) + 0.5, (x1 - x0) * k - 1, (z1 - z0) * k - 1);

  // the bay: a faint chart grid and depth contours
  g.fillStyle = '#050914';
  g.fillRect(0, 0, SIZE, SIZE);
  g.strokeStyle = 'rgba(70,120,190,0.07)';
  g.lineWidth = 1;
  for (let v = -ext; v <= ext; v += 50) {
    g.beginPath(); g.moveTo(X(v), 0); g.lineTo(X(v), SIZE); g.stroke();
    g.beginPath(); g.moveTo(0, Z(v)); g.lineTo(SIZE, Z(v)); g.stroke();
  }
  contours(g, X, Z);

  // land: the streets are whatever the blocks leave
  g.fillStyle = '#3a4170';
  for (const r of L.land) fill(...r);
  g.fillStyle = '#121729';
  for (const r of L.promenade) fill(...r);
  g.strokeStyle = '#22e5ff';
  g.lineWidth = 2;
  g.shadowColor = '#22e5ff'; g.shadowBlur = 8;
  for (const r of L.walls) stroke(...r);
  g.shadowBlur = 0;

  // street hierarchy: avenues brighter, then the ring road and the Loop glowing
  const street = (s, color, widen = 0) => {
    const a = L.nodes[s.a], b = L.nodes[s.b], hw = s.hw + widen;
    g.fillStyle = color;
    if (s.axis === 'z') fill(s.ax - hw, a.z, s.ax + hw, b.z);
    else fill(a.x, s.az - hw, b.x, s.az + hw);
  };
  for (const s of L.segs) if (s.kind === K.central) street(s, '#5a64a8');
  for (const [x0, z0, x1, z1] of L.alleys) { g.fillStyle = '#2a3058'; fill(x0, z0, x1, z1); }

  // blocks and buildings
  for (const b of L.blocks) {
    g.fillStyle = '#0f1426';
    fill(b.x0, b.z0, b.x1, b.z1);
  }
  for (const b of L.buildings) {
    const d = DISTRICT[b.district];
    g.fillStyle = d.fill;
    fill(...b.box);
    g.strokeStyle = d.line;
    g.lineWidth = 1;
    g.globalAlpha = b.district === 'down' ? 0.9 : 0.55;
    stroke(...b.box);
    g.globalAlpha = 1;
    // the tallest towers get a lit roof
    if (b.h > 120) {
      g.fillStyle = NEON[b.neon];
      g.globalAlpha = 0.35;
      const [x0, z0, x1, z1] = b.box, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, r = Math.min(x1 - x0, z1 - z0) * 0.22;
      fill(cx - r, cz - r, cx + r, cz + r);
      g.globalAlpha = 1;
    }
  }
  for (const ct of L.containers) {
    g.fillStyle = BOX[ct.colors[ct.levels - 1]];
    fill(...ct.box);
  }

  // the ring road and the Loop, with a glow
  for (const [kind, color, glow] of [[K.ring, '#5b2f9a', '#a24dff'], [K.loop, '#0e6074', '#22e5ff']]) {
    g.shadowColor = glow;
    g.shadowBlur = 14;
    for (const s of L.segs) if (s.kind === kind) street(s, color);
    g.shadowBlur = 0;
    g.strokeStyle = glow;
    g.lineWidth = 2;
    for (const s of L.segs) {
      if (s.kind !== kind) continue;
      const a = L.nodes[s.a], b = L.nodes[s.b];
      for (const side of [-1, 1]) {
        g.beginPath();
        if (s.axis === 'z') { g.moveTo(X(s.ax + side * s.hw), Z(a.z)); g.lineTo(X(s.ax + side * s.hw), Z(b.z)); }
        else { g.moveTo(X(a.x), Z(s.az + side * s.hw)); g.lineTo(X(b.x), Z(s.az + side * s.hw)); }
        g.stroke();
      }
    }
  }
  // the scramble crossing
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 3;
  const h = 10;
  g.beginPath(); g.moveTo(X(-h), Z(-h)); g.lineTo(X(h), Z(h)); g.moveTo(X(-h), Z(h)); g.lineTo(X(h), Z(-h)); g.stroke();

  // names
  const label = (text, x, z, size, color, spacing = 0.35) => {
    g.save();
    g.font = `800 ${size}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const spaced = text.split('').join(' '.repeat(spacing > 0.3 ? 1 : 0));
    g.lineWidth = Math.max(3, size / 6);
    g.strokeStyle = 'rgba(3,6,14,0.85)';
    g.strokeText(spaced, X(x), Z(z));
    g.fillStyle = color;
    g.shadowColor = color; g.shadowBlur = 10;
    g.fillText(spaced, X(x), Z(z));
    g.restore();
  };
  label('DOWNTOWN', 0, 150, 26, 'rgba(210,190,255,0.85)');
  label('THE LOOP', 0, gridZ(8) + 26, 20, 'rgba(120,240,255,0.95)');
  label('CIRCUIT DISTRICT', 607, 260, 24, 'rgba(110,230,245,0.9)');
  label('HARBOR', -607, 260, 24, 'rgba(255,190,110,0.9)');
  label('RING ROAD', -230, CITY.C + 26, 16, 'rgba(200,150,255,0.85)', 0);
  label(`${CITY_NAME.toUpperCase()}  光`, 0, -CITY.coreEdge - 120, 64, 'rgba(255,90,180,0.9)');
  label('THE BAY', 0, CITY.coreEdge + 140, 22, 'rgba(110,160,220,0.55)');
  return c;
}

const gridZ = (j) => -CITY.C + CITY.P * j;

// Wobbly depth contours in the bay, round a few deep spots.
function contours(g, X, Z) {
  const rand = mulberry32(0xbada55);
  const centres = [[-560, 620], [420, 640], [-300, -660], [560, -600], [0, 760], [0, -780]];
  g.lineWidth = 1.2;
  for (const [cx, cz] of centres) {
    const ph = rand() * 10;
    for (let ring = 1; ring <= 7; ring++) {
      const r = ring * 34 + rand() * 10;
      g.strokeStyle = `rgba(80,150,200,${0.22 - ring * 0.02})`;
      g.beginPath();
      for (let a = 0; a <= 64; a++) {
        const t = (a / 64) * Math.PI * 2;
        const rr = r * (1 + 0.12 * Math.sin(t * 3 + ph + ring * 0.4) + 0.06 * Math.sin(t * 7 - ph));
        const x = cx + Math.cos(t) * rr * 1.4, z = cz + Math.sin(t) * rr;
        if (a === 0) g.moveTo(X(x), Z(z)); else g.lineTo(X(x), Z(z));
      }
      g.stroke();
    }
  }
}
