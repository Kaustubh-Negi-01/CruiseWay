import * as THREE from 'three';
import { patch } from './world/materials.js';

// The one ride: a sleek sport bike with a tucked-in rider.
export const BIKE = {
  maxSpeed: 47,      // m/s (~170 km/h)
  accel: 8.5, brake: 15, reverse: 3.5,
  grip: 7.5, offGrip: 5.0, offTop: 0.86, offDrag: 0.12,
  steer: 1.7, handbrakeGrip: 1.6,
  camDist: 4.6, camHeight: 1.75,
};

export const PALETTE = ['#e8483b', '#2f8cf0', '#f2b21b', '#3fc46a', '#b05ce8', '#f07ab8'];

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

// Capsule/cylinder spanning two points.
function limb(a, b, r, mat, segs = 8) {
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.01, len - r * 0.5), 4, segs), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(v3(0, 1, 0), dir.normalize());
  return m;
}

// Side profile (z forward, y up) extruded across x with rounded bevels.
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
    depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 10,
  });
  // shape x -> world z, extrusion -> world x (centred)
  g.rotateY(-Math.PI / 2);
  g.translate(depth / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

function wheel(r, mats) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(new THREE.TorusGeometry(r - 0.065, 0.068, 12, 32), mats.tire);
  tire.rotation.y = Math.PI / 2;
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.11, r - 0.11, 0.05, 28, 1, true), mats.rim);
  rim.rotation.z = Math.PI / 2;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 12), mats.metal);
  hub.rotation.z = Math.PI / 2;
  g.add(tire, rim, hub);
  // five split spokes
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    for (const off of [-0.07, 0.07]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.018, r - 0.14, 0.03), mats.rim);
      sp.position.set(0, Math.cos(a + off) * (r - 0.14) / 2, Math.sin(a + off) * (r - 0.14) / 2);
      sp.rotation.x = -(a + off);
      g.add(sp);
    }
  }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.62, r * 0.62, 0.012, 24), mats.metal);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = 0.07;
  g.add(disc);
  return g;
}

// Model faces +z, ground at y = 0. userData: lean (group that rolls),
// wheels (spin), steerer (front assembly), lights.
export function buildBike(color = PALETTE[0]) {
  const paint = new THREE.Color(color);
  const mats = {
    paint: patch(new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 })),
    accent: patch(new THREE.MeshPhysicalMaterial({ color: 0xf2efe8, metalness: 0.1, roughness: 0.35, clearcoat: 0.8 })),
    dark: patch(new THREE.MeshStandardMaterial({ color: 0x17181b, metalness: 0.3, roughness: 0.55 })),
    seat: patch(new THREE.MeshStandardMaterial({ color: 0x1c1b1a, roughness: 0.85 })),
    tire: patch(new THREE.MeshStandardMaterial({ color: 0x101011, roughness: 0.9 })),
    rim: patch(new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.8, roughness: 0.3 })),
    metal: patch(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.25 })),
    glass: patch(new THREE.MeshPhysicalMaterial({ color: 0x20262e, metalness: 0, roughness: 0.05, transparent: true, opacity: 0.55, clearcoat: 1 })),
    suit: patch(new THREE.MeshStandardMaterial({ color: 0x23252b, roughness: 0.7 })),
    suitAccent: patch(new THREE.MeshStandardMaterial({ color: paint, roughness: 0.6 })),
    helmet: patch(new THREE.MeshPhysicalMaterial({ color: paint.clone().lerp(new THREE.Color(0xffffff), 0.15), metalness: 0.2, roughness: 0.25, clearcoat: 1 })),
    visor: patch(new THREE.MeshPhysicalMaterial({ color: 0x0b0d10, metalness: 0.6, roughness: 0.05, clearcoat: 1 })),
    head: patch(new THREE.MeshBasicMaterial({ color: 0xfff6e0 })),
    tail: patch(new THREE.MeshBasicMaterial({ color: 0xff2a1f })),
  };

  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const R = 0.31;
  const FRONT = 0.72, REAR = -0.7;

  // --- wheels & running gear
  const rearWheel = wheel(R, mats);
  rearWheel.position.set(0, R, REAR);
  lean.add(rearWheel);

  const steerer = new THREE.Group(); // pivots about the steering head
  steerer.position.set(0, 0.98, 0.5);
  lean.add(steerer);
  const frontWheel = wheel(R, mats);
  frontWheel.position.set(0, R - 0.98, FRONT - 0.5);
  steerer.add(frontWheel);
  for (const x of [-0.085, 0.085]) {
    steerer.add(limb(v3(x, R - 0.98, FRONT - 0.5), v3(x, 0.02, 0), 0.028, mats.metal));
  }
  steerer.add(limb(v3(-0.32, 0.06, -0.08), v3(0.32, 0.06, -0.08), 0.016, mats.dark)); // clip-on bars
  lean.add(limb(v3(0.0, R, REAR), v3(0.0, 0.5, -0.05), 0.045, mats.dark)); // swingarm
  // shock
  lean.add(limb(v3(0.0, 0.5, -0.25), v3(0.0, 0.85, -0.05), 0.03, mats.metal));

  // --- engine block and exhaust
  const engine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.5, 2, 2, 2), mats.dark);
  engine.position.set(0, 0.5, 0.12);
  lean.add(engine);
  const header = limb(v3(0.06, 0.38, 0.32), v3(0.14, 0.28, -0.3), 0.035, mats.metal);
  const muffler = limb(v3(0.15, 0.32, -0.3), v3(0.19, 0.55, -0.85), 0.065, mats.metal, 12);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), mats.dark);
  tip.position.set(0.19, 0.56, -0.87);
  tip.rotation.x = -1.15;
  lean.add(header, muffler, tip);

  // --- bodywork: fairing / tank / tail in one smooth profile
  const body = new THREE.Mesh(profile([
    [0.98, 0.78],
    [0.86, 1.08, 1.0, 0.98],     // nose up into screen
    [0.55, 1.2, 0.72, 1.2],      // tank front
    [0.12, 1.12, 0.32, 1.22],    // tank top
    [-0.08, 0.98],               // seat well
    [-0.5, 1.0],
    [-0.92, 1.13, -0.75, 1.03],  // tail kicks up
    [-0.96, 1.06],
    [-0.62, 0.86, -0.85, 0.9],
    [-0.2, 0.74],
    [0.2, 0.62, 0.0, 0.66],
    [0.62, 0.52, 0.45, 0.52],    // belly pan
    [0.9, 0.6, 0.86, 0.52],
  ], 0.3, 0.07), mats.paint);
  lean.add(body);
  // white side flash
  const flash = new THREE.Mesh(profile([
    [0.92, 0.8], [0.72, 1.0], [0.36, 0.86], [0.3, 0.72], [0.62, 0.6],
  ], 0.43, 0.01), mats.accent);
  lean.add(flash);
  const seat = new THREE.Mesh(profile([[-0.06, 1.02], [-0.5, 1.05, -0.28, 1.06], [-0.55, 0.98], [-0.08, 0.95]], 0.24, 0.04), mats.seat);
  lean.add(seat);
  const screen = new THREE.Mesh(profile([[0.86, 1.08], [0.66, 1.32, 0.8, 1.28], [0.62, 1.22], [0.78, 1.06]], 0.26, 0.02), mats.glass);
  lean.add(screen);

  // --- lights
  for (const x of [-0.07, 0.07]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.035, 0.02), mats.head);
    h.position.set(x, 0.92, 1.02);
    h.rotation.x = -0.6;
    lean.add(h);
  }
  const tl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.03, 0.02), mats.tail);
  tl.position.set(0, 1.05, -1.02);
  tl.rotation.x = 0.5;
  lean.add(tl);

  // --- rider, tucked in
  const hip = v3(0, 1.12, -0.33);
  const chest = v3(0, 1.36, 0.12);
  const torso = limb(hip, chest, 0.16, mats.suit, 10);
  lean.add(torso);
  const stripe = limb(hip.clone().add(v3(0, 0.03, 0.02)), chest.clone().add(v3(0, 0.03, 0.02)), 0.165, mats.suitAccent, 10);
  stripe.scale.set(0.35, 1, 1.02);
  lean.add(stripe);
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 20, 14), mats.helmet);
  helmet.position.set(0, 1.5, 0.26);
  helmet.scale.set(1, 0.95, 1.12);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.157, 20, 10, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.26), mats.visor);
  visor.position.copy(helmet.position);
  visor.scale.copy(helmet.scale);
  lean.add(helmet, visor);
  for (const sx of [-1, 1]) {
    const sh = v3(0.16 * sx, 1.34, 0.08), elbow = v3(0.25 * sx, 1.16, 0.28), hand = v3(0.3 * sx, 1.05, 0.44);
    lean.add(limb(sh, elbow, 0.055, mats.suit), limb(elbow, hand, 0.048, mats.suit));
    const glove = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mats.dark);
    glove.position.copy(hand);
    lean.add(glove);
    const hp = v3(0.14 * sx, 1.08, -0.34), knee = v3(0.22 * sx, 0.92, 0.08), foot = v3(0.17 * sx, 0.52, -0.22);
    lean.add(limb(hp, knee, 0.075, mats.suit), limb(knee, foot, 0.06, mats.suit));
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.24), mats.dark);
    boot.position.copy(foot).add(v3(0, -0.02, 0.06));
    lean.add(boot);
  }

  root.traverse((o) => { if (o.isMesh) { o.castShadow = !o.material.isMeshBasicMaterial; o.receiveShadow = true; } });
  root.userData = { lean, steerer, wheels: [rearWheel, frontWheel], mats };
  return root;
}

// See-through version for other players.
export function ghostify(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    o.receiveShadow = false;
    const m = o.material.clone();
    m.onBeforeCompile = o.material.onBeforeCompile;
    m.customProgramCacheKey = o.material.customProgramCacheKey;
    m.transparent = true;
    m.opacity = o.material.isMeshBasicMaterial ? 0.8 : 0.5;
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
    if (!seen.has(o.material)) { seen.add(o.material); o.material.map?.dispose(); o.material.dispose(); }
  });
}
