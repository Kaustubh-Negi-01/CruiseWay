import * as THREE from 'three';
import { ART, NEON } from './cityGen.js';

// The neon sign atlas, drawn once on a canvas: vertical blade signs, shop
// signs and billboards. Every name is invented (no real shops or brands).
//
// Layout (2048 x 2048):
//   top 512 px:      16 blade signs, 128 x 512 each
//   next 768 px:     24 shop signs, 512 x 128 (4 across, 6 down)
//   bottom 768 px:   12 billboards, 512 x 256 (4 across, 3 down)

const S = 2048;
const JP = '"Hiragino Sans","Yu Gothic UI","Yu Gothic","Meiryo","Noto Sans CJK JP","Noto Sans JP","Microsoft YaHei",sans-serif';
const LATIN = '"Arial Black","Helvetica Neue",Arial,sans-serif';

const BLADES = ['ラーメン', 'カラオケ', '居酒屋', '寿司', 'ホテル', 'ゲーム', '焼肉', '喫茶店', 'バー', '薬局', '中華', '漫画', '酒場', 'ネオン', '夜市', '電気'];
const BANDS = [
  ['RAMEN', '一番'], ['KARAOKE', '24H'], ['NOODLE BAR', ''], ['HOTEL MIRAI', 'ホテル'], ['ARCADE', 'ゲーム'], ['SUSHI', '寿司'],
  ['CAFE NEKO', '猫'], ['BAR 404', ''], ['GAME CENTER', ''], ['IZAKAYA', '居酒屋'], ['PHARMACY', '薬'], ['YAKITORI', '焼鳥'],
  ['GYOZA', '餃子'], ['MANGA', '漫画'], ['LIVE HOUSE', ''], ['TAKOYAKI', ''], ['NIGHT OWL', '夜'], ['DUMPLINGS', ''],
  ['CYBER CAFE', ''], ['RECORDS', 'レコード'], ['TATTOO', ''], ['BOOKS', '本'], ['OPEN 24H', ''], ['CURRY', 'カレー'],
];
const BOARDS = [
  ['NEON NIGHTS', 'ネオン'], ['MIDNIGHT RUN', '真夜中'], ['サイバー', 'CYBER'], ['DRIFT', 'ドリフト'], ['夜', 'NIGHT'], ['CRUISEWAY', 'クルーズ'],
  ['HYPER SODA', 'ソーダ'], ['SKY TOWER', '展望台'], ['NIGHT MARKET', '夜市'], ['ROBOT CAFE', 'ロボット'], ['ドリーム', 'DREAM'], ['RAIN CITY', '雨'],
];

// atlas rectangle (texture coords) of a design: [u0, v0, u1, v1]
export function artRect(kind, i) {
  let x, y, w, h;
  if (kind === 'blade') { w = 128; h = 512; x = (i % 16) * w; y = 0; }
  else if (kind === 'band') { w = 512; h = 128; x = (i % 4) * w; y = 512 + Math.floor(i / 4) * h; }
  else { w = 512; h = 256; x = (i % 4) * w; y = 1280 + Math.floor(i / 4) * h; }
  const p = 3 / S;   // keep a little away from the neighbours (mipmaps)
  return [x / S + p, 1 - (y + h) / S + p, (x + w) / S - p, 1 - y / S - p];
}

// main colour of each design (for its glow and the light it throws)
export const ART_COLOR = {
  blade: BLADES.map((_, i) => NEON[(i * 3) % NEON.length]),
  band: BANDS.map((_, i) => NEON[(i * 5 + 1) % NEON.length]),
  board: BOARDS.map((_, i) => NEON[(i * 7 + 2) % NEON.length]),
};

let ATLAS = null;
export function signAtlas() {
  if (ATLAS) return ATLAS;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#05040a';
  g.fillRect(0, 0, S, S);
  BLADES.forEach((t, i) => blade(g, i * 128, 0, t, ART_COLOR.blade[i], i));
  BANDS.forEach((t, i) => band(g, (i % 4) * 512, 512 + Math.floor(i / 4) * 128, t, ART_COLOR.band[i], i));
  BOARDS.forEach((t, i) => board(g, (i % 4) * 512, 1280 + Math.floor(i / 4) * 256, t, ART_COLOR.board[i], i));
  ATLAS = new THREE.CanvasTexture(c);
  ATLAS.colorSpace = THREE.SRGBColorSpace;
  ATLAS.anisotropy = 4;
  ATLAS.generateMipmaps = true;
  ATLAS.minFilter = THREE.LinearMipmapLinearFilter;
  return ATLAS;
}

// Neon tube text: a coloured glow with a near-white core.
function neonText(g, text, x, y, size, color, font, glow = 18) {
  g.font = `900 ${size}px ${font}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = glow;
  g.fillStyle = color;
  g.fillText(text, x, y);
  g.shadowBlur = glow * 0.4;
  g.fillStyle = mixWhite(color, 0.65);
  g.fillText(text, x, y);
  g.shadowBlur = 0;
}

function tube(g, x, y, w, h, r, color, width = 5) {
  g.shadowColor = color;
  g.shadowBlur = 16;
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = mixWhite(color, 0.6);
  g.lineWidth = width * 0.35;
  g.stroke();
}

function blade(g, x, y, text, color, i) {
  const solid = i % 3 === 0;
  g.fillStyle = solid ? shade(color, 0.85) : '#0d0812';
  g.beginPath(); g.roundRect(x + 8, y + 8, 112, 496, 10); g.fill();
  tube(g, x + 14, y + 14, 100, 484, 8, solid ? '#ffffff' : color, 5);
  const chars = [...text];
  const step = 440 / chars.length, size = Math.min(84, step * 0.86);
  chars.forEach((ch, k) => {
    const cy = y + 40 + step * (k + 0.5);
    if (solid) {
      g.font = `900 ${size}px ${JP}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#140a14';
      g.fillText(ch, x + 64, cy);
    } else neonText(g, ch, x + 64, cy, size, color, JP, 16);
  });
}

function band(g, x, y, [en, jp], color, i) {
  const dark = i % 4 !== 1;
  g.fillStyle = dark ? '#0b0710' : shade(color, 0.8);
  g.fillRect(x + 4, y + 6, 504, 116);
  tube(g, x + 10, y + 12, 492, 104, 14, dark ? color : '#fff4e0', 4);
  const size = en.length > 9 ? 50 : 62;
  if (dark) {
    neonText(g, en, x + (jp ? 220 : 256), y + 66, size, color, LATIN, 14);
    if (jp) neonText(g, jp, x + 440, y + 66, jp.length > 2 ? 34 : 54, NEON[(i + 3) % NEON.length], JP, 12);
  } else {
    g.font = `900 ${size}px ${LATIN}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#16080f';
    g.fillText(en, x + (jp ? 220 : 256), y + 68);
    if (jp) { g.font = `900 ${jp.length > 2 ? 34 : 54}px ${JP}`; g.fillText(jp, x + 440, y + 68); }
  }
}

function board(g, x, y, [big, small], color, i) {
  g.save();
  g.beginPath(); g.rect(x + 4, y + 4, 504, 248); g.clip();
  // backgrounds: gradients, sun rings, grids
  const c2 = NEON[(i * 3 + 5) % NEON.length];
  const grad = g.createLinearGradient(x, y, x + 512, y + 256);
  grad.addColorStop(0, shade(color, 0.25));
  grad.addColorStop(1, shade(c2, 0.35));
  g.fillStyle = grad;
  g.fillRect(x, y, 512, 256);
  if (i % 3 === 0) {
    for (let k = 0; k < 7; k++) {
      g.strokeStyle = `rgba(255,255,255,${0.08 + k * 0.02})`;
      g.lineWidth = 3;
      g.beginPath(); g.arc(x + 400, y + 220, 40 + k * 28, 0, Math.PI * 2); g.stroke();
    }
  } else if (i % 3 === 1) {
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.lineWidth = 2;
    for (let k = 0; k <= 16; k++) { g.beginPath(); g.moveTo(x + k * 32, y + 256); g.lineTo(x + 256 + (k - 8) * 6, y + 120); g.stroke(); }
    for (let k = 0; k < 6; k++) { const yy = y + 130 + k * k * 4.5; g.beginPath(); g.moveTo(x, yy); g.lineTo(x + 512, yy); g.stroke(); }
  } else {
    const r = g.createRadialGradient(x + 380, y + 90, 4, x + 380, y + 90, 120);
    r.addColorStop(0, mixWhite(c2, 0.5)); r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r; g.fillRect(x, y, 512, 256);
  }
  const jpBig = /[^\x00-\x7f]/.test(big);
  neonText(g, big, x + 256, y + 112, jpBig ? (big.length > 2 ? 92 : 130) : big.length > 9 ? 58 : 76, mixWhite(color, 0.25), jpBig ? JP : LATIN, 22);
  const jpSmall = /[^\x00-\x7f]/.test(small);
  neonText(g, small, x + 256, y + 200, 40, c2, jpSmall ? JP : LATIN, 12);
  g.restore();
  tube(g, x + 6, y + 6, 500, 244, 6, color, 4);
}

function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixWhite(hex, k) { const [r, gg, b] = rgb(hex); return `rgb(${r + (255 - r) * k | 0},${gg + (255 - gg) * k | 0},${b + (255 - b) * k | 0})`; }
function shade(hex, k) { const [r, gg, b] = rgb(hex); return `rgb(${r * k | 0},${gg * k | 0},${b * k | 0})`; }
