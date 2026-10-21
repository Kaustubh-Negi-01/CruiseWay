import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patch } from './world/materials.js';

// The ride: a hubless concept superbike (an original design). Glowing
// translucent tyres on open rims, a low faceted lower body, a sculpted glossy
// spine, and a digital dash you see from the saddle.
export const BIKE = {
  maxSpeed: 50,      // m/s (~180 km/h)
  accel: 9, brake: 16, reverse: 3.5,
  grip: 7.8,                                   // tarmac
  dirtGrip: 6.4, dirtTop: 0.93, dirtDrag: 0.05, // dirt roads
  offGrip: 5.0, offTop: 0.86, offDrag: 0.12,   // grass / open ground
  steer: 1.7, handbrakeGrip: 1.6,
  camDist: 5.0, camHeight: 1.7,
};

// glow colours handed out to players in join order
export const PALETTE = ['#38e8ff', '#ff4fd8', '#ffb627', '#7dff6a', '#a07cff', '#ff6b4a'];
// spine (upper body) colour paired with each glow colour
const BODY = { '#38e8ff': '#e2541f', '#ff4fd8': '#2b2f45', '#ffb627': '#1f6f8b', '#7dff6a': '#3a3f47', '#a07cff': '#d9d4c7', '#ff6b4a': '#1c4a3a' };

let ENV = null;
export function setBikeEnvironment(envMap) { ENV = envMap; }

// rider's eye for the cockpit camera, in the bike's frame
export const EYE = new THREE.Vector3(0, 1.52, -0.3);

const R = 0.43, FRONT = 0.88, REAR = -0.88;

// Side profile (z forward, y up) extruded across x.
function profile(points, depth, bevel, segs = 3) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const [x, y, cx, cy] = points[i];
    if (cx !== undefined) s.quadraticCurveTo(cx, cy, x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: segs, curveSegments: 16 });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

// Narrow a profile toward its ends and weld it so it shades smoothly.
function sculpt(geo, z0, z1, minW = 0.45) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = Math.min(1, Math.max(0, (p.getZ(i) - z0) / (z1 - z0)));
    p.setX(i, p.getX(i) * (minW + (1 - minW) * Math.pow(Math.sin(Math.PI * t), 0.6)));
  }
  geo.computeVertexNormals();
  return geo;
}

function limb(a, b, r, mat) {
  const dir = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.BoxGeometry(r * 2, dir.length(), r * 1.4), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

let TREAD = null;
function treadTexture() {
  if (TREAD) return TREAD;
  const c = document.createElement('canvas');
  c.width = 512; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 64);
  g.strokeStyle = '#7a8a90';
  g.lineWidth = 5;
  for (let x = -64; x < 576; x += 16) { // chevron tread blocks
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 12, 32); g.lineTo(x, 64); g.stroke();
  }
  TREAD = new THREE.CanvasTexture(c);
  TREAD.wrapS = TREAD.wrapT = THREE.RepeatWrapping;
  TREAD.repeat.set(3, 1);
  return TREAD;
}

let GLOW_TEX = null;
function glowTexture() {
  if (GLOW_TEX) return GLOW_TEX;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  GLOW_TEX = new THREE.CanvasTexture(c);
  return GLOW_TEX;
}

// A hubless wheel: the glowing tyre spins; the dark clamp that grips the
// rim from inside stays put.
function wheel(mats) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.1, 0.1, 18, 56), mats.tire);
  tire.rotation.y = Math.PI / 2;
  tire.scale.set(1, 1, 1.75);
  const core = new THREE.Mesh(new THREE.TorusGeometry(R - 0.1, 0.06, 10, 48), mats.glow);
  core.rotation.y = Math.PI / 2;
  core.scale.set(1, 1, 2.2);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(R - 0.205, 0.022, 8, 48), mats.dark);
  rim.rotation.y = Math.PI / 2;
  rim.scale.set(1, 1, 5);
  spin.add(tire, core, rim);
  for (const x of [-0.15, 0.15]) {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(R - 0.1, 0.07, 8, 48), mats.halo);
    halo.rotation.y = Math.PI / 2;
    halo.position.x = x;
    spin.add(halo);
  }
  g.add(spin);
  const clamp = new THREE.Mesh(new THREE.TorusGeometry(R - 0.235, 0.03, 8, 32, Math.PI * 1.1), mats.dark);
  clamp.rotation.set(0, Math.PI / 2, Math.PI * 0.45);
  clamp.scale.set(1, 1, 4);
  g.add(clamp);
  return { group: g, spin };
}

// Model faces +z, ground at y = 0. userData: lean (rolling group), steerer,
// wheels (spinning parts), dash (speedo state), mats.
export function buildBike(color = PALETTE[0]) {
  const glowCol = new THREE.Color(color);
  const bodyCol = new THREE.Color(BODY[color] || '#e2541f');
  const env = { envMap: ENV };
  const mats = {
    spine: patch(new THREE.MeshPhysicalMaterial({ color: bodyCol, metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1, ...env })),
    pod: patch(new THREE.MeshPhysicalMaterial({ color: 0xcbc2b2, metalness: 0.75, roughness: 0.38, clearcoat: 0.4, flatShading: true, ...env })),
    fin: patch(new THREE.MeshPhysicalMaterial({ color: 0xe8e6e1, metalness: 0.6, roughness: 0.3, clearcoat: 0.8, ...env })),
    dark: patch(new THREE.MeshStandardMaterial({ color: 0x141518, metalness: 0.6, roughness: 0.42, ...env })),
    graphite: patch(new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.35, ...env })),
    seat: patch(new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.85 })),
    spring: patch(new THREE.MeshStandardMaterial({ color: 0xd8333a, metalness: 0.5, roughness: 0.35, ...env })),
    tire: patch(new THREE.MeshStandardMaterial({
      color: glowCol.clone().lerp(new THREE.Color(0xffffff), 0.75), map: treadTexture(),
      emissive: glowCol, emissiveIntensity: 0.55, roughness: 0.45, transparent: true, opacity: 0.82,
    })),
    glow: new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(1.3), toneMapped: false }),
    halo: new THREE.MeshBasicMaterial({ color: glowCol, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    head: new THREE.MeshBasicMaterial({ color: 0xf4fbff, toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }),
  };

  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);

  // --- wheels
  const rear = wheel(mats);
  rear.group.position.set(0, R, REAR);
  lean.add(rear.group);
  const steerer = new THREE.Group();
  steerer.position.set(0, R, FRONT);
  lean.add(steerer);
  const front = wheel(mats);
  steerer.add(front.group);

  // --- lower body: a long faceted pod slung between the wheels
  const pod = new THREE.Mesh(profile([
    [-0.72, 0.36], [-0.56, 0.58], [0.4, 0.6], [0.74, 0.47], [0.7, 0.27], [0.12, 0.19], [-0.5, 0.21],
  ], 0.3, 0.035, 1), mats.pod);
  lean.add(pod);
  // arms reaching into each hubless rim
  for (const [z0, z1] of [[0.62, FRONT - 0.12], [-0.62, REAR + 0.12]]) {
    const arm = limb(new THREE.Vector3(0, 0.42, z0), new THREE.Vector3(0, R, z1), 0.05, mats.graphite);
    arm.scale.x = 2.4;
    lean.add(arm);
  }
  const podLight = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.014, 0.7), mats.glow);
  podLight.position.set(0, 0.44, 0.12);
  lean.add(podLight);

  // --- dark core and frame struts linking the two bodies
  const core = new THREE.Mesh(profile([[-0.3, 0.58], [0.34, 0.6], [0.26, 0.9], [-0.18, 0.88]], 0.22, 0.02, 1), mats.graphite);
  lean.add(core);
  lean.add(limb(new THREE.Vector3(0, 0.6, 0.5), new THREE.Vector3(0, 1.02, 0.6), 0.035, mats.dark));
  lean.add(limb(new THREE.Vector3(0, 0.6, -0.5), new THREE.Vector3(0, 0.98, -0.62), 0.035, mats.dark));
  // red coil shock under the seat
  const helix = new THREE.CatmullRomCurve3(Array.from({ length: 40 }, (_, i) => {
    const t = i / 39, a = t * Math.PI * 2 * 6;
    return new THREE.Vector3(Math.cos(a) * 0.045, 0.6 + t * 0.26, -0.36 + Math.sin(a) * 0.045 + t * 0.08);
  }));
  lean.add(new THREE.Mesh(new THREE.TubeGeometry(helix, 160, 0.008, 5, false), mats.spring));

  // --- upper body: one sculpted glossy spine from the steering head to the tail
  const spine = new THREE.Mesh(sculpt(profile([
    [0.66, 0.96],
    [0.36, 1.13, 0.56, 1.14],     // tank crest
    [0.02, 1.02, 0.18, 1.1],
    [-0.42, 0.99],                // seat pan
    [-0.82, 1.12, -0.64, 1.0],    // tail kicks up
    [-1.0, 1.2],
    [-0.98, 1.12],
    [-0.62, 0.97, -0.82, 1.0],
    [-0.2, 0.86, -0.4, 0.86],
    [0.3, 0.86, 0.06, 0.84],
    [0.66, 0.9, 0.52, 0.86],
  ], 0.34, 0.07, 5), -1.05, 0.72, 0.5), mats.spine);
  lean.add(spine);
  const seat = new THREE.Mesh(sculpt(profile([[-0.06, 1.04], [-0.46, 1.03, -0.26, 1.06], [-0.5, 0.98], [-0.08, 0.98]], 0.24, 0.03, 3), -0.55, 0.0, 0.7), mats.seat);
  lean.add(seat);

  // tail fin with a light strip, nose fin with the headlight
  const tailFin = new THREE.Mesh(profile([[-0.92, 1.14], [-1.24, 1.36], [-1.32, 1.33], [-1.06, 1.12]], 0.05, 0.01, 1), mats.fin);
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, 0.3), mats.tail);
  tailLight.position.set(0, 1.27, -1.16);
  tailLight.rotation.x = -0.65;
  const noseFin = new THREE.Mesh(profile([[0.6, 0.98], [0.98, 1.06], [1.02, 1.1], [0.62, 1.07]], 0.12, 0.012, 1), mats.fin);
  const headLight = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.012, 0.3), mats.head);
  headLight.position.set(0, 1.035, 0.84);
  headLight.rotation.x = -0.2;
  lean.add(tailFin, tailLight, noseFin, headLight);

  // clip-on bars
  const bars = new THREE.Group();
  bars.position.set(0, 1.08, 0.56);
  bars.add(limb(new THREE.Vector3(-0.3, 0.02, -0.06), new THREE.Vector3(0.3, 0.02, -0.06), 0.014, mats.dark));
  for (const x of [-0.3, 0.3]) {
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.12, 10).rotateZ(Math.PI / 2), mats.seat);
    grip.position.set(x, 0.02, -0.06);
    bars.add(grip);
  }
  lean.add(bars);

  // --- digital dash on the steering head
  // raised on a stalk above the tank line, angled up toward the rider's eye
  const dash = makeDash(color);
  dash.mesh.position.set(0, 1.25, 0.57);
  dash.mesh.rotation.set(0.32, Math.PI, 0);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.275, 0.165, 0.03), mats.dark);
  bezel.position.set(0, 1.25 - 0.005, 0.57 + 0.017);
  bezel.rotation.copy(dash.mesh.rotation);
  const stalk = limb(new THREE.Vector3(0, 1.04, 0.6), new THREE.Vector3(0, 1.2, 0.59), 0.018, mats.dark);
  lean.add(stalk, bezel, dash.mesh);

  // soft underglow
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 3.4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: glowCol, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  under.position.y = 0.04;
  under.renderOrder = 2;
  root.add(under);

  root.traverse((o) => {
    if (!o.isMesh) return;
    const lit = !o.material.isMeshBasicMaterial;
    o.castShadow = lit && o !== dash.mesh;
    o.receiveShadow = lit;
  });
  root.userData = { lean, steerer, bars, wheels: [rear.spin, front.spin], mats, dash, under };
  return root;
}

// 'chase' and 'cockpit' show the bike; 'nose' hides it (the camera sits in front).
export function setBikeView(root, view) {
  const ud = root.userData;
  ud.lean.visible = view !== 'nose';
  ud.under.visible = view !== 'nose';
}

// ---- digital speedometer ------------------------------------------------------

function makeDash(color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 300;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.146), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  const dash = { canvas: c, tex, mesh, color, last: -1, shown: '' };
  drawDash(dash, 0, 0, 1);
  return dash;
}

// Redraws at most ~12 times a second, and only when the numbers changed.
export function updateDash(root, kmh, km, surface) {
  const d = root.userData.dash;
  const now = performance.now();
  if (now - d.last < 80) return;
  const key = Math.round(kmh) + '|' + km.toFixed(1) + '|' + surface;
  if (key === d.shown) return;
  d.last = now;
  d.shown = key;
  drawDash(d, kmh, km, surface);
}

function drawDash(d, kmh, km, surface) {
  const g = d.canvas.getContext('2d');
  const W = 512, H = 300;
  g.clearRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d1116');
  bg.addColorStop(1, '#05070a');
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(4, 4, W - 8, H - 8, 34); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 3;
  g.stroke();

  // sweep gauge (0–200 km/h) around the speed readout
  const cx = 190, cy = 168, r = 118;
  const a0 = Math.PI * 0.8, a1 = Math.PI * 2.2;
  const frac = Math.min(1, kmh / 200);
  g.lineCap = 'round';
  g.lineWidth = 16;
  g.strokeStyle = 'rgba(255,255,255,0.09)';
  g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
  const grad = g.createLinearGradient(cx - r, 0, cx + r, 0);
  grad.addColorStop(0, d.color);
  grad.addColorStop(1, frac > 0.85 ? '#ff5a4a' : '#ffffff');
  g.strokeStyle = grad;
  g.shadowColor = d.color;
  g.shadowBlur = 18;
  if (frac > 0.002) { g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * frac); g.stroke(); }
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.5)';
  g.lineWidth = 3;
  for (let i = 0; i <= 10; i++) {
    const a = a0 + ((a1 - a0) * i) / 10;
    const inner = r - (i % 5 ? 30 : 38);
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (r - 22), cy + Math.sin(a) * (r - 22));
    g.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.font = '700 96px system-ui, sans-serif';
  g.fillText(String(Math.round(kmh)), cx, cy + 26);
  g.font = '600 24px system-ui, sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.6)';
  g.fillText('KM/H', cx, cy + 62);

  // right-hand panel: trip, surface, charge
  g.textAlign = 'left';
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = '600 20px system-ui, sans-serif';
  g.fillText('TRIP', 352, 92);
  g.fillStyle = '#ffffff';
  g.font = '700 38px system-ui, sans-serif';
  g.fillText(km.toFixed(1), 352, 132);
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.font = '600 20px system-ui, sans-serif';
  g.fillText('KM', 440, 132);
  g.fillStyle = surface === 1 ? 'rgba(255,255,255,0.55)' : '#f0c48a';
  g.fillText(surface === 1 ? 'TARMAC' : surface === 2 ? 'DIRT' : 'OFF-ROAD', 352, 176);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath(); g.roundRect(352, 200, 120, 14, 7); g.fill();
  g.fillStyle = d.color;
  g.beginPath(); g.roundRect(352, 200, 120 * (0.86 - frac * 0.12), 14, 7); g.fill();
  d.tex.needsUpdate = true;
}

export function ghostify(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const m = o.material.clone();
    m.onBeforeCompile = o.material.onBeforeCompile;
    m.customProgramCacheKey = o.material.customProgramCacheKey;
    m.transparent = true;
    if (!o.material.isMeshBasicMaterial) m.opacity = 0.45;
    m.depthWrite = false;
    o.material = m;
  });
  return root;
}

export function disposeModel(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    if (!seen.has(o.material)) {
      seen.add(o.material);
      const map = o.material.map;
      if (map && map !== GLOW_TEX && map !== TREAD) map.dispose();
      o.material.dispose();
    }
  });
}
