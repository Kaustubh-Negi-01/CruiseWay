import * as THREE from 'three';
import { PAVED_HALF } from '../generation/network.js';

// Shared look: procedural textures, and shader patches that add
//  - sun-tinted atmospheric haze (replaces three's fog),
//  - world-space ground texturing for the terrain,
//  - painted road markings,
//  - wind sway + distance fade for grass.
// All colours that feed the haze/sky are display-space values so the sky dome
// and the hazed geometry meet seamlessly at the horizon.

export const raw = (hex) => new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace);

export const ATMOS = {
  uSunDir: { value: new THREE.Vector3(-0.55, 0.12, 0.83).normalize() },
  uFogColor: { value: raw(0xd6b2a0) },
  uSunFogColor: { value: raw(0xffb27a) },
  uFogDensity: { value: 0.00085 },
  uTime: { value: 0 },
};

// ---- procedural textures ----------------------------------------------------

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

// Tileable value-noise FBM, one independent field per RGBA channel.
function noiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let ch = 0; ch < 4; ch++) {
    const field = new Float32Array(size * size);
    let amp = 1, total = 0;
    for (let oct = 0, cells = 4; oct < 5; oct++, cells *= 2) {
      const lat = new Float32Array(cells * cells).map(() => Math.random());
      const cs = size / cells;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const gx = x / cs, gy = y / cs;
          const x0 = Math.floor(gx), y0 = Math.floor(gy);
          let tx = gx - x0, ty = gy - y0;
          tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
          const a = lat[(y0 % cells) * cells + (x0 % cells)];
          const b = lat[(y0 % cells) * cells + ((x0 + 1) % cells)];
          const c = lat[((y0 + 1) % cells) * cells + (x0 % cells)];
          const d = lat[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
          field[y * size + x] += amp * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < size * size; i++) data[i * 4 + ch] = Math.round((field[i] / total) * 255);
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

// Draw with wrap-around so the texture tiles.
function wrapDraw(size, fn) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy);
}

// Greyscale ground detail: short strokes like a lawn seen from above.
function grassDetailTexture() {
  const S = 512;
  const [c, g] = canvas(S);
  g.fillStyle = 'rgb(120,120,120)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const len = 4 + Math.random() * 10, ang = Math.random() * Math.PI * 2;
    const v = 70 + Math.random() * 120 | 0;
    g.strokeStyle = `rgba(${v},${v},${v},0.55)`;
    g.lineWidth = 1 + Math.random() * 1.2;
    wrapDraw(S, (dx, dy) => {
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.lineTo(x + dx + Math.cos(ang) * len, y + dy + Math.sin(ang) * len);
      g.stroke();
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function dirtDetailTexture() {
  const S = 256;
  const [c, g] = canvas(S);
  g.fillStyle = 'rgb(128,128,128)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 0.6 + Math.random() * 2.8;
    const v = 60 + Math.random() * 150 | 0;
    g.fillStyle = `rgba(${v},${v},${v},0.6)`;
    wrapDraw(S, (dx, dy) => { g.beginPath(); g.arc(x + dx, y + dy, r, 0, Math.PI * 2); g.fill(); });
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Alpha-tested grass clump: tapered, curving blades in mixed greens/golds.
function grassBladeTexture() {
  const S = 256;
  const [c, g] = canvas(S);
  g.clearRect(0, 0, S, S);
  const cols = [[96, 120, 40], [130, 140, 52], [160, 150, 70], [80, 104, 36], [182, 166, 86], [110, 128, 44]];
  for (let i = 0; i < 46; i++) {
    const x0 = 20 + Math.random() * (S - 40);
    const h = S * (0.45 + Math.random() * 0.53);
    const lean = (Math.random() - 0.5) * 90;
    const w = 3 + Math.random() * 4;
    const [r, gg, b] = cols[(Math.random() * cols.length) | 0];
    const grad = g.createLinearGradient(0, S, 0, S - h);
    grad.addColorStop(0, `rgb(${r * 0.45 | 0},${gg * 0.45 | 0},${b * 0.45 | 0})`);
    grad.addColorStop(1, `rgb(${r},${gg},${b})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w, S);
    g.quadraticCurveTo(x0 - w * 0.5 + lean * 0.4, S - h * 0.55, x0 + lean, S - h);
    g.quadraticCurveTo(x0 + w * 0.5 + lean * 0.4, S - h * 0.55, x0 + w, S);
    g.closePath();
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

let TEX = null;
export function textures() {
  if (!TEX) {
    TEX = {
      noise: noiseTexture(),
      grass: grassDetailTexture(),
      dirt: dirtDetailTexture(),
      blade: grassBladeTexture(),
    };
  }
  return TEX;
}

// ---- shader patching --------------------------------------------------------------

const HAZE_PARS = /* glsl */`
  uniform vec3 uSunDir; uniform vec3 uFogColor; uniform vec3 uSunFogColor; uniform float uFogDensity;
  varying vec3 vWPos;
  vec3 hazeColor(vec3 dir) {
    float s = max(dot(dir, uSunDir), 0.0);
    return mix(uFogColor, uSunFogColor, pow(s, 5.0) * 0.9);
  }`;

const HAZE_FRAG = /* glsl */`
  {
    vec3 toP = vWPos - cameraPosition;
    float fd = length(toP);
    float ff = 1.0 - exp(-uFogDensity * uFogDensity * fd * fd);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor(toP / max(fd, 1e-3)), ff);
  }`;

const WORLDPOS_VERT = /* glsl */`
  {
    vec4 cwp = vec4(transformed, 1.0);
    #ifdef USE_INSTANCING
      cwp = instanceMatrix * cwp;
    #endif
    vWPos = (modelMatrix * cwp).xyz;
  }`;

// opts: { terrain, road, wind, fade:[near, far] }
export function patch(material, opts = {}) {
  const tex = textures();
  material.fog = false;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, ATMOS, {
      uNoise: { value: tex.noise },
      uGrassTex: { value: tex.grass },
      uDirtTex: { value: tex.dirt },
    });
    let vs = shader.vertexShader, fs = shader.fragmentShader;
    vs = vs.replace('#include <common>', `#include <common>
      varying vec3 vWPos; varying vec3 vWNrm; uniform float uTime;
      ${opts.terrain || opts.road ? 'attribute float aRoad; varying float vRoad; attribute float aLine; varying float vLine;' : ''}
      ${opts.grass ? 'varying vec3 vTint; uniform sampler2D uNoise;' : ''}`);

    if (opts.wind || opts.fade) {
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          #endif
          ${opts.fade ? `float dcam = distance(ip, cameraPosition);
          transformed *= 1.0 - smoothstep(${opts.fade[0].toFixed(1)}, ${opts.fade[1].toFixed(1)}, dcam);` : ''}
          ${opts.grass ? GRASS_VERT : ''}
          ${opts.wind ? `float h = clamp(position.y / 0.55, 0.0, 1.0);
          float w = sin(uTime * 1.7 + ip.x * 0.21 + ip.z * 0.17) + 0.5 * sin(uTime * 3.1 + ip.x * 0.7);
          transformed.x += w * 0.09 * h * h;
          transformed.z += w * 0.05 * h * h;` : ''}
        }`);
    }
    vs = vs.replace('#include <project_vertex>', `#include <project_vertex>
      ${WORLDPOS_VERT}
      ${material.isMeshBasicMaterial ? 'vWNrm = vec3(0.0, 1.0, 0.0);' : 'vWNrm = normalize(mat3(modelMatrix) * objectNormal);'}
      ${opts.terrain || opts.road ? 'vRoad = aRoad; vLine = aLine;' : ''}
      ${opts.road ? 'gl_Position.z -= 0.0006 * gl_Position.w;' : ''}`);

    fs = fs.replace('#include <common>', `#include <common>
      ${HAZE_PARS}
      varying vec3 vWNrm;
      uniform sampler2D uNoise; uniform sampler2D uGrassTex; uniform sampler2D uDirtTex;
      ${opts.terrain || opts.road ? 'varying float vRoad; varying float vLine;' : ''}
      ${opts.grass ? 'varying vec3 vTint;' : ''}`);

    if (opts.grass) {
      fs = fs.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = vTint * clamp(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * 6.5, 0.3, 1.5);`);
    }
    if (opts.terrain) fs = fs.replace('#include <map_fragment>', TERRAIN_FRAG);
    if (opts.road) fs = fs.replace('#include <map_fragment>', ROAD_FRAG).replace('#include <roughnessmap_fragment>', ROAD_ROUGH);
    fs = fs.replace('#include <fog_fragment>', HAZE_FRAG);
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => JSON.stringify(opts);
  return material;
}

// Grass clumps take the same colour the ground has underneath them, and
// shrink away where the ground shader paints dirt patches.
const GRASS_VERT = /* glsl */`
  {
    vec2 w = ip.xz;
    vec4 macro = texture2D(uNoise, w / 1400.0);
    vec4 mid = texture2D(uNoise, w / 230.0);
    vec4 small = texture2D(uNoise, w / 38.0);
    vec3 lush = vec3(0.115, 0.165, 0.04);
    vec3 olive = vec3(0.19, 0.2, 0.06);
    vec3 golden = vec3(0.33, 0.27, 0.09);
    float dry = smoothstep(0.35, 0.68, macro.r * 0.7 + mid.g * 0.3);
    vTint = mix(mix(lush, olive, smoothstep(0.3, 0.7, mid.r)), golden, dry) * (0.85 + small.b * 0.3) * 1.9;
    float patches = smoothstep(0.64, 0.74, mid.b) + smoothstep(0.68, 0.76, small.a) * 0.6;
    transformed *= clamp(1.0 - patches, 0.0, 1.0);
  }`;

const TERRAIN_FRAG = /* glsl */`
  {
    vec2 w = vWPos.xz;
    float d1 = texture2D(uGrassTex, w / 5.0).r;
    float d2 = texture2D(uGrassTex, w / 17.0 + 0.31).r;
    float detail = (d1 * 0.6 + d2 * 0.4) * 2.1;
    vec4 macro = texture2D(uNoise, w / 1400.0);
    vec4 mid = texture2D(uNoise, w / 230.0);
    vec4 small = texture2D(uNoise, w / 38.0);

    vec3 lush = vec3(0.115, 0.165, 0.04);
    vec3 olive = vec3(0.19, 0.2, 0.06);
    vec3 golden = vec3(0.33, 0.27, 0.09);
    float dry = smoothstep(0.35, 0.68, macro.r * 0.7 + mid.g * 0.3);
    vec3 grass = mix(mix(lush, olive, smoothstep(0.3, 0.7, mid.r)), golden, dry);
    grass *= 0.85 + small.b * 0.3;
    grass *= detail;

    float dd = texture2D(uDirtTex, w / 3.0).r * 2.0;
    vec3 dirt = vec3(0.17, 0.12, 0.075) * dd;
    vec3 gravel = vec3(0.24, 0.22, 0.2) * (texture2D(uDirtTex, w / 1.3).r * 1.6 + 0.2);

    float slope = 1.0 - clamp(normalize(vWNrm).y, 0.0, 1.0);
    float patches = smoothstep(0.66, 0.78, mid.b) * 0.8 + smoothstep(0.7, 0.8, small.a) * 0.5;
    float dirtAmt = clamp(smoothstep(0.26, 0.48, slope) + patches * (1.0 - slope * 0.5), 0.0, 1.0);
    vec3 col = mix(grass, dirt, dirtAmt);
    // vRoad = distance past the road edge, vLine = road kind (1 paved, 2 dirt)
    float shoulder = 1.0 - smoothstep(0.2, 1.9, vRoad + small.r * 0.8);
    vec3 edgeCol = vLine > 1.5 ? vec3(0.2, 0.145, 0.09) * dd : gravel;
    col = mix(col, edgeCol, shoulder);
    // beaches and lake shores
    float sand = 1.0 - smoothstep(1.2, 3.6, vWPos.y + small.g * 1.5);
    vec3 sandCol = vec3(0.52, 0.44, 0.3) * (0.85 + dd * 0.15);
    col = mix(col, sandCol, sand * (1.0 - shoulder));
    col *= 1.0 - smoothstep(0.0, -3.0, vWPos.y) * 0.45; // darker underwater
    diffuseColor.rgb = col;
  }`;

// u across the road (0..1), v = metres along it (uv attribute).
const ROAD_FRAG = /* glsl */`
  float markMask = 0.0;
  {
    vec2 w = vWPos.xz;
    float u = vMapUv.x, v = vMapUv.y;
    float n1 = texture2D(uNoise, w / 9.0).r, n2 = texture2D(uDirtTex, w / 1.1).r;
    vec3 asphalt = vec3(0.075, 0.074, 0.08) * (0.75 + n1 * 0.45) * (0.8 + n2 * 0.4);
    // worn wheel tracks
    float track = exp(-pow((abs(u - 0.5) - 0.24) / 0.06, 2.0));
    asphalt *= 1.0 - track * 0.12;
    float aa = fwidth(u) * 1.2;
    float W = ${(PAVED_HALF * 2).toFixed(2)};
    float lineW = 0.13 / W;
    float edge = smoothstep(lineW + aa, lineW - aa, abs(u - 0.035)) + smoothstep(lineW + aa, lineW - aa, abs(u - 0.965));
    float dash = step(fract(v / 12.0), 0.42);
    float single = smoothstep(lineW * 0.6 + aa, lineW * 0.6 - aa, abs(u - 0.5)) * dash;
    float dbl = smoothstep(lineW * 0.5 + aa, lineW * 0.5 - aa, abs(abs(u - 0.5) - 0.016));
    float center = mix(single, dbl, step(0.5, vLine));
    float paved = 1.0 - step(1.5, vLine);          // 0,1 = marked road; 2 = dirt; 3 = junction
    markMask = clamp(edge + center, 0.0, 1.0) * (0.75 + n2 * 0.25) * paved;
    diffuseColor.rgb = mix(asphalt, vec3(0.78, 0.77, 0.72), markMask);
    if (vLine > 1.5 && vLine < 2.5) {
      // packed dirt with two darker wheel ruts and a grassy crown
      float grain = texture2D(uDirtTex, w / 2.2).r;
      vec3 dirtCol = vec3(0.23, 0.165, 0.1) * (0.7 + n1 * 0.5) * (0.75 + grain * 0.5);
      float ruts = exp(-pow((abs(u - 0.5) - 0.2) / 0.07, 2.0));
      dirtCol *= 1.0 - ruts * 0.25;
      float crown = exp(-pow((u - 0.5) / 0.05, 2.0)) * smoothstep(0.45, 0.7, texture2D(uNoise, w / 14.0).g);
      dirtCol = mix(dirtCol, vec3(0.16, 0.19, 0.06) * (0.7 + grain * 0.6), crown * 0.8);
      float lip = smoothstep(0.38, 0.5, abs(u - 0.5));
      diffuseColor.rgb = mix(dirtCol, dirtCol * 0.82, lip);
    }
  }`;

const ROAD_ROUGH = /* glsl */`
  float roughnessFactor = mix(0.82, 0.6, markMask);`;
