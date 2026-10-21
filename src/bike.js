import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { patch } from './world/materials.js';

// The ride: an enclosed streamliner superbike — a sealed canopy instead of a
// rider, fat tyres with glowing hubless rims, and light strips in the
// player's colour.
export const BIKE = {
  maxSpeed: 50,      // m/s (~180 km/h)
  accel: 9, brake: 16, reverse: 3.5,
  grip: 7.8,                                   // tarmac
  dirtGrip: 6.4, dirtTop: 0.93, dirtDrag: 0.05, // dirt roads
  offGrip: 5.0, offTop: 0.86, offDrag: 0.12,   // grass / open ground
  steer: 1.7, handbrakeGrip: 1.6,
  camDist: 4.8, camHeight: 1.55,
};

// glow colours handed out to players in join order
export const PALETTE = ['#38e8ff', '#ff4fd8', '#ffb627', '#7dff6a', '#a07cff', '#ff6b4a'];

let ENV = null; // sky reflection map, set once the environment exists
export function setBikeEnvironment(envMap) { ENV = envMap; }

function profile(points, depth, bevel) {
  const s = new THREE.Shape();
  s.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) {
    const [x, y, cx, cy] = points[i];
    if (cx !== undefined) s.quadraticCurveTo(cx, cy, x, y);
    else s.lineTo(x, y);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 6, curveSegments: 14,
  });
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  return t;
}
let GLOW_TEX = null;

// Body width along its length: full in the middle, pinched at nose and tail.
const Z_TAIL = -1.45, Z_NOSE = 1.36;
function taper(z) {
  const t = Math.min(1, Math.max(0, (z - Z_TAIL) / (Z_NOSE - Z_TAIL)));
  return 0.42 + 0.58 * Math.pow(Math.sin(Math.PI * t), 0.55);
}
function sculpt(geo, twoTone) {
  // weld shared corners so the shell shades smoothly instead of in facets
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo, 1e-4);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setX(i, x * taper(z));
    // chrome above the waistline, dark graphite below it
    const k = twoTone ? 0.1 + 0.9 * Math.min(1, Math.max(0, (y - 0.56) / 0.1)) : 1;
    col.set([k, k, k], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function wheel(R, mats) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(R - 0.1, 0.1, 16, 40), mats.tire);
  tire.rotation.y = Math.PI / 2;
  tire.scale.set(1, 1, 1.55); // fat, flat-ish tread (scaled across the wheel)
  g.add(tire);
  const rimR = R - 0.19;
  for (const x of [-0.11, 0.11]) {
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, 0.035, 10, 40), mats.rim);
    rim.rotation.y = Math.PI / 2;
    rim.position.x = x;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.035, 0.012, 8, 48), mats.glow);
    ring.rotation.y = Math.PI / 2;
    ring.position.x = x * 1.15;
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(rimR * 0.62, 0.008, 6, 40), mats.glow);
    ring2.rotation.y = Math.PI / 2;
    ring2.position.x = x * 1.1;
    const halo = new THREE.Mesh(new THREE.TorusGeometry(rimR - 0.03, 0.05, 8, 40), mats.halo);
    halo.rotation.y = Math.PI / 2;
    halo.position.x = x * 1.2;
    g.add(rim, ring, ring2, halo);
  }
  // spokes would spin visibly; a few faint radial blades sell the motion
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.01, rimR * 1.7, 0.03), mats.dark);
    blade.rotation.x = (i / 3) * Math.PI;
    g.add(blade);
  }
  return g;
}

// Model faces +z, ground at y = 0. userData: lean (rolling group),
// steerer (front assembly), wheels (spin), mats.
export function buildBike(color = PALETTE[0]) {
  const glowCol = new THREE.Color(color);
  const silver = new THREE.Color(0xd8dde3);
  const paintCol = silver.clone().lerp(glowCol, 0.18);
  const mats = {
    paint: patch(new THREE.MeshPhysicalMaterial({ color: paintCol, vertexColors: true, metalness: 0.92, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMap: ENV, envMapIntensity: 1.25 })),
    graphite: patch(new THREE.MeshPhysicalMaterial({ color: 0x24272c, metalness: 0.7, roughness: 0.35, clearcoat: 0.6, envMap: ENV })),
    dark: patch(new THREE.MeshStandardMaterial({ color: 0x0f1012, metalness: 0.4, roughness: 0.5, envMap: ENV })),
    tire: patch(new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.85 })),
    rim: patch(new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 1, roughness: 0.18, envMap: ENV })),
    glass: patch(new THREE.MeshPhysicalMaterial({ color: 0x0b1118, metalness: 0.2, roughness: 0.02, clearcoat: 1, envMap: ENV, envMapIntensity: 1.6 })),
    glow: new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(1.4), toneMapped: false }),
    halo: new THREE.MeshBasicMaterial({ color: glowCol, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    head: new THREE.MeshBasicMaterial({ color: 0xf4fbff, toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }),
  };

  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const R = 0.37, FRONT = 0.8, REAR = -0.82;

  const rearWheel = wheel(R, mats);
  rearWheel.position.set(0, R, REAR);
  lean.add(rearWheel);
  const steerer = new THREE.Group();
  steerer.position.set(0, R, FRONT);
  lean.add(steerer);
  const frontWheel = wheel(R, mats);
  steerer.add(frontWheel);

  // single-sided arms reaching the rims
  const armF = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), mats.graphite);
  armF.position.set(0.2, R + 0.22, FRONT - 0.18);
  armF.rotation.x = 0.5;
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.75), mats.graphite);
  armR.position.set(-0.2, R + 0.14, REAR + 0.32);
  armR.rotation.x = -0.25;
  lean.add(armF, armR);

  // --- shell: one long teardrop that swallows the tops of both wheels
  const shell = new THREE.Mesh(sculpt(profile([
    [1.24, 0.6],
    [1.02, 0.88, 1.2, 0.84],
    [0.52, 1.06, 0.8, 1.0],
    [-0.1, 1.2, 0.2, 1.24],
    [-0.7, 1.06, -0.42, 1.17],
    [-1.2, 0.86, -1.0, 0.98],
    [-1.32, 0.72],
    [-1.12, 0.6, -1.3, 0.6],
    [-0.55, 0.5, -0.82, 0.48],
    [0.0, 0.36, -0.3, 0.36],
    [0.6, 0.42, 0.3, 0.36],
    [1.12, 0.52, 0.92, 0.46],
  ], 0.46, 0.11), true), mats.paint);
  lean.add(shell);

  // graphite belly pan and side intakes
  const belly = new THREE.Mesh(sculpt(profile([[0.75, 0.48], [0.2, 0.38], [-0.45, 0.42], [-0.6, 0.56], [0.65, 0.6]], 0.62, 0.04), false), mats.graphite);
  lean.add(belly);

  // canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.glass);
  canopy.scale.set(0.27, 0.2, 0.78);
  canopy.position.set(0, 1.08, -0.02);
  canopy.rotation.x = -0.06;
  lean.add(canopy);

  // light strips along both flanks
  for (const sx of [-1, 1]) {
    const side = (y, z) => new THREE.Vector3((0.34 * taper(z) + 0.012) * sx, y, z);
    const curve = new THREE.CatmullRomCurve3([side(0.72, 1.12), side(0.82, 0.55), side(0.78, -0.1), side(0.84, -0.75), side(0.8, -1.22)]);
    lean.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.012, 6, false), mats.glow));
    lean.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.04, 6, false), mats.halo));
  }
  // headlight blade and tail bar
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.035, 0.04), mats.head);
  head.position.set(0, 0.74, 1.27);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.035, 0.04), mats.tail);
  tail.position.set(0, 0.9, -1.36);
  const tailRing = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.012, 8, 40), mats.glow);
  tailRing.position.set(0, 0.74, -1.4);
  tailRing.scale.set(1.35, 0.8, 1);
  const tailHalo = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.045, 8, 40), mats.halo);
  tailHalo.position.copy(tailRing.position);
  tailHalo.scale.copy(tailRing.scale);
  lean.add(head, tail, tailRing, tailHalo);

  // soft underglow on the ground
  GLOW_TEX ||= glowTexture();
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 3.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: GLOW_TEX, color: glowCol, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  under.position.y = 0.04;
  under.renderOrder = 2;
  root.add(under);

  // --- cockpit (only shown in the first-person view): a dark cowl ahead of
  // the eyes with a glowing rim and a small gauge pod
  const exterior = [...lean.children];
  const cockpit = new THREE.Group();
  cockpit.visible = false;
  const cowl = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), mats.dark);
  cowl.scale.set(0.46, 0.08, 0.6);
  cowl.position.set(0, 0.84, 0.55);
  const rimCurve = new THREE.EllipseCurve(0, 0, 0.46, 0.6, Math.PI * 0.08, Math.PI * 0.92, false);
  const rimPts = rimCurve.getPoints(40).map((p) => new THREE.Vector3(p.x, 0.845, 0.55 + p.y));
  const rim = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rimPts), 60, 0.006, 6, false), mats.glow);
  const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.05, 32), mats.graphite);
  pod.rotation.x = -1.1;
  pod.scale.set(0.8, 0.8, 0.8);
  pod.position.set(0, 0.885, 0.5);
  const gauge = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.005, 6, 40, Math.PI * 1.5), mats.glow);
  gauge.rotation.set(-1.1 + Math.PI / 2, 0, Math.PI * 0.75);
  gauge.scale.set(0.8, 0.8, 0.8);
  gauge.position.set(0, 0.897, 0.49);
  const frameL = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.5), mats.graphite);
  frameL.position.set(-0.22, 1.14, 0.18); frameL.rotation.set(0.35, 0, 0.5);
  const frameR = frameL.clone(); frameR.position.x = 0.22; frameR.rotation.z = -0.5;
  cockpit.add(cowl, rim, pod, gauge, frameL, frameR);
  lean.add(cockpit);

  root.traverse((o) => {
    if (!o.isMesh) return;
    const lit = !o.material.isMeshBasicMaterial;
    o.castShadow = lit && !cockpit.children.includes(o);
    o.receiveShadow = lit;
  });
  root.userData = { lean, steerer, wheels: [rearWheel, frontWheel], mats, exterior, cockpit, under };
  return root;
}

// 'chase' shows the whole bike; 'cockpit' swaps in the dashboard; 'nose' hides it all.
export function setBikeView(root, view) {
  const ud = root.userData;
  for (const o of ud.exterior) o.visible = view === 'chase';
  ud.cockpit.visible = view === 'cockpit';
  ud.under.visible = view !== 'nose';
}

// Eye position inside the canopy, in the bike's leaning frame.
export const EYE = new THREE.Vector3(0, 1.1, 0.02);

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
      if (o.material.map && o.material.map !== GLOW_TEX) o.material.map.dispose();
      o.material.dispose();
    }
  });
}
