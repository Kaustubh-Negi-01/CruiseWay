import * as THREE from 'three';
import { patch } from '../world/rendering/materials.js';
import { makeDash, glowTexture, getBikeEnvironment } from './bike.js';

// The second ride: a single-seat hypercar (an original design). A low carbon
// fuselage with a bubble canopy, wheels under carved fender shells, side pods
// with chrome blades, a tall rear wing on swan-neck struts, and big turbine
// wheels whose sidewall stripe glows in the player's colour.
export const CAR = {
  maxSpeed: 58,      // m/s (~210 km/h)
  accel: 11, brake: 20, reverse: 4,
  grip: 9.6,
  dirtGrip: 7.2, dirtTop: 0.9, dirtDrag: 0.06,
  offGrip: 5.6, offTop: 0.8, offDrag: 0.14,
  steer: 1.55, handbrakeGrip: 1.3,
  camDist: 6.6, camHeight: 2.1,
  rearZ: -1.38,
  lean: -0.09,       // body roll per radian of bike-style lean (cars roll outward, a little)
  wheelie: false,
  radius: 1.05,      // for tree collisions
  body: [1.25, 0, -1.25],   // collision circles along the car, for walls
  wheelR: 0.37,
  // where the tyres touch the ground (x across, z along), so none sinks into a dip
  contacts: [[-0.86, 1.42], [0.86, 1.42], [-0.86, -1.38], [0.86, -1.38]],
};

// driver's eye under the canopy, and the nose camera, in the car's frame
export const CAR_EYE = new THREE.Vector3(0, 0.98, -0.05);
export const CAR_NOSE = new THREE.Vector3(0, 0.5, 2.55);
export const CAR_LAMP = new THREE.Vector3(0, 0.55, 2.4);

const R = 0.37, TRACK = 0.86, FRONT = 1.42, REAR = -1.38;
const BODY = { '#38e8ff': '#15171b', '#ff4fd8': '#1b1520', '#ffb627': '#1c1a16', '#7dff6a': '#141a16', '#a07cff': '#17151d', '#ff6b4a': '#1d1514' };

// A smooth body from cross-sections along z. Each station is
// [z, halfWidth, bottomY, topY]; sections are rounded rectangles
// (superellipses), capped at both ends.
function loft(stations, segs = 28, roundness = 3.2) {
  const pos = [], idx = [];
  const e = 2 / roundness;
  for (const [z, hw, y0, y1] of stations) {
    const cy = (y0 + y1) / 2, hh = (y1 - y0) / 2;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      pos.push(Math.sign(c) * Math.abs(c) ** e * hw, cy + Math.sign(s) * Math.abs(s) ** e * hh, z);
    }
  }
  const n = stations.length;
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs), c = a + segs, d = b + segs;
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps, facing outward (front cap +z, rear cap -z)
  for (const [i, flip] of [[0, false], [n - 1, true]]) {
    const [z, , y0, y1] = stations[i];
    const centre = pos.length / 3;
    pos.push(0, (y0 + y1) / 2, z);
    for (let j = 0; j < segs; j++) {
      const a = i * segs + j, b = i * segs + ((j + 1) % segs);
      if (flip) idx.push(centre, b, a); else idx.push(centre, a, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// Race number on a canvas, for the nose and the side pods.
function numberTexture(num, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.font = 'italic 900 104px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 8; g.strokeStyle = color;
  g.strokeText(num, 128, 68);
  g.fillStyle = '#f2f2f2';
  g.fillText(num, 128, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// A solid tyre: a rounded cross-section (tread, shoulders, both sidewalls
// down to the rim) spun around the axle. Shared by every car wheel.
let TYRE = null;
function tyreGeometry() {
  if (TYRE) return TYRE;
  const W = 0.17, ri = R * 0.66, c = 0.05;   // half width, rim radius, shoulder radius
  const pts = [new THREE.Vector2(ri, -W)];
  for (let i = 0; i <= 6; i++) {             // lower shoulder
    const a = -Math.PI / 2 + (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - c + Math.cos(a) * c, -W + c + Math.sin(a) * c));
  }
  for (let i = 0; i <= 6; i++) {             // upper shoulder
    const a = (i / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - c + Math.cos(a) * c, W - c + Math.sin(a) * c));
  }
  pts.push(new THREE.Vector2(ri, W));
  TYRE = new THREE.LatheGeometry(pts, 48).rotateZ(Math.PI / 2);   // axle along x
  TYRE.userData.shared = true;
  return TYRE;
}

// A turbine wheel: dark tyre with a glowing sidewall stripe, angled spokes
// and a chrome lip. Mirrored for the left side.
function wheel(mats, side) {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  const tyre = new THREE.Mesh(tyreGeometry(), mats.tyre);
  // the inside face of the wheel (brake and hub area), so it can't be seen through
  const inner = new THREE.Mesh(new THREE.CircleGeometry(R * 0.66, 32).rotateY(-side * Math.PI / 2), mats.rimDark);
  inner.position.x = -0.12 * side;
  const stripe = new THREE.Mesh(new THREE.RingGeometry(R * 0.8, R * 0.84, 48).rotateY(Math.PI / 2), mats.glow);
  stripe.position.x = 0.174 * side;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(R * 0.66, 0.012, 6, 40).rotateY(Math.PI / 2), mats.chrome);
  lip.position.x = 0.168 * side;
  const dish = new THREE.Mesh(new THREE.CircleGeometry(R * 0.66, 32).rotateY(side * Math.PI / 2), mats.rimDark);
  dish.position.x = 0.1 * side;
  spin.add(tyre, inner, stripe, lip, dish);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.02, R * 0.56, 0.035), mats.graphite);
    spoke.position.set(0.13 * side, Math.cos(a) * R * 0.34, Math.sin(a) * R * 0.34);
    spoke.rotation.set(a + 0.35 * side, 0, 0);
    spin.add(spoke);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16).rotateZ(Math.PI / 2), mats.glow);
  cap.position.x = 0.15 * side;
  spin.add(cap);
  g.add(spin);
  return { group: g, spin };
}

// Model faces +z, ground at y = 0. Same userData shape as the bike:
// lean (body group), steerers, wheels, dash, mats, under.
export function buildCar(color = '#38e8ff', number = '07') {
  const glowCol = new THREE.Color(color);
  const env = { envMap: getBikeEnvironment() };
  const mats = {
    body: patch(new THREE.MeshPhysicalMaterial({ color: new THREE.Color(BODY[color] || '#15171b'), metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.2, ...env })),
    carbon: patch(new THREE.MeshStandardMaterial({ color: 0x0c0d0f, metalness: 0.55, roughness: 0.4, ...env })),
    graphite: patch(new THREE.MeshStandardMaterial({ color: 0x2b2e34, metalness: 0.8, roughness: 0.3, ...env })),
    chrome: patch(new THREE.MeshStandardMaterial({ color: 0xd4d8de, metalness: 1, roughness: 0.18, envMapIntensity: 1.4, ...env })),
    rimDark: patch(new THREE.MeshStandardMaterial({ color: 0x101114, metalness: 0.7, roughness: 0.35, ...env })),
    tyre: patch(new THREE.MeshStandardMaterial({ color: 0x161617, roughness: 0.92, side: THREE.DoubleSide })),
    glass: patch(new THREE.MeshPhysicalMaterial({ color: 0x0a0e14, metalness: 0.3, roughness: 0.04, clearcoat: 1, transparent: true, opacity: 0.55, envMapIntensity: 1.6, depthWrite: false, ...env })),
    seat: patch(new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.85 })),
    glow: new THREE.MeshBasicMaterial({ color: glowCol.clone().multiplyScalar(1.3), toneMapped: false }),
    head: new THREE.MeshBasicMaterial({ color: 0xf4fbff, toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: 0xff2a3a, toneMapped: false }),
    accent: patch(new THREE.MeshStandardMaterial({ color: glowCol, emissive: glowCol, emissiveIntensity: 0.35, metalness: 0.3, roughness: 0.4 })),
  };

  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);

  // --- wheels: rears fixed, fronts on steering groups. They hang off the
  // chassis (root), not the body, so body roll in corners doesn't tip them
  // into the road.
  const wheels = [], steerers = [];
  for (const side of [-1, 1]) {
    const rw = wheel(mats, side);
    rw.group.position.set(side * TRACK, R, REAR);
    root.add(rw.group);
    wheels.push(rw.spin);
    const st = new THREE.Group();
    st.position.set(side * TRACK, R, FRONT);
    const fw = wheel(mats, side);
    st.add(fw.group);
    root.add(st);
    wheels.push(fw.spin);
    steerers.push(st);
  }

  // --- fuselage: a long narrow tub from the pointed nose to the tail
  const tub = new THREE.Mesh(loft([
    [2.42, 0.12, 0.2, 0.26],
    [2.3, 0.34, 0.15, 0.36],
    [2.0, 0.46, 0.13, 0.46],
    [1.5, 0.5, 0.12, 0.56],
    [0.9, 0.52, 0.12, 0.64],
    [0.3, 0.54, 0.12, 0.7],
    [-0.4, 0.58, 0.12, 0.8],
    [-1.0, 0.6, 0.13, 0.86],
    [-1.6, 0.58, 0.15, 0.84],
    [-2.1, 0.5, 0.2, 0.78],
    [-2.32, 0.42, 0.26, 0.7],
  ]), mats.body);
  lean.add(tub);

  // --- fender shells over each wheel, joined to the tub by side pods
  for (const side of [-1, 1]) {
    for (const [z0, long] of [[FRONT, 1.25], [REAR, 1.35]]) {
      const f = new THREE.Mesh(loft([
        [z0 + long * 0.55, 0.06, 0.36, 0.44],
        [z0 + long * 0.42, 0.17, 0.32, 0.66],
        [z0 + long * 0.15, 0.21, 0.3, 0.8],
        [z0 - long * 0.15, 0.21, 0.3, 0.82],
        [z0 - long * 0.4, 0.18, 0.28, 0.72],
        [z0 - long * 0.5, 0.1, 0.32, 0.56],
      ], 20, 2.6), mats.body);
      f.position.x = side * (TRACK + 0.02);
      lean.add(f);
    }
    // side pod between the wheels, with a dark intake and a chrome blade
    const pod = new THREE.Mesh(loft([
      [0.82, 0.08, 0.16, 0.42],
      [0.55, 0.2, 0.14, 0.5],
      [-0.1, 0.24, 0.13, 0.56],
      [-0.6, 0.22, 0.14, 0.6],
      [-0.82, 0.12, 0.2, 0.6],
    ], 20, 2.8), mats.body);
    pod.position.x = side * 0.66;
    lean.add(pod);
    const intake = box(0.04, 0.2, 0.42, mats.carbon, side * 0.9, 0.36, 0.28);
    intake.rotation.y = side * 0.25;
    lean.add(intake);
    const blade = box(0.02, 0.05, 1.3, mats.chrome, side * 0.89, 0.5, -0.1);
    blade.rotation.x = -0.08;
    lean.add(blade);
    // glowing strip along the sill, in the player's colour
    lean.add(box(0.015, 0.015, 1.4, mats.glow, side * 0.86, 0.17, -0.05));
    // race number on the pod
    const num = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: numberTexture(number, color), transparent: true, depthWrite: false }));
    num.position.set(side * 0.9, 0.48, -0.55);
    num.rotation.y = side * Math.PI / 2;
    lean.add(num);
  }

  // --- canopy: a fighter-jet bubble over the single seat
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2), mats.glass);
  canopy.scale.set(0.42, 0.42, 1.05);
  canopy.position.set(0, 0.68, -0.05);
  canopy.renderOrder = 3;
  lean.add(canopy);
  // chrome sill around the canopy's base (nothing crosses the driver's view)
  const sill = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 6, 48).rotateX(Math.PI / 2), mats.chrome);
  sill.scale.set(0.42, 1, 1.05);
  sill.position.set(0, 0.68, -0.05);
  lean.add(sill);
  // cockpit: seat, wheel, dash (seen from the driver's eye)
  lean.add(box(0.4, 0.08, 0.5, mats.seat, 0, 0.64, -0.35));
  lean.add(box(0.4, 0.45, 0.08, mats.seat, 0, 0.84, -0.6));
  const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.016, 6, 24, Math.PI * 1.3), mats.carbon);
  yoke.position.set(0, 0.79, 0.34);
  yoke.rotation.set(-0.35, 0, -Math.PI * 0.15 - Math.PI);
  lean.add(yoke);
  const dash = makeDash(color);
  dash.mesh.position.set(0, 0.86, 0.5);
  dash.mesh.rotation.set(0.42, Math.PI, 0);
  lean.add(dash.mesh);

  // --- nose: splitter, headlight strips, race number
  lean.add(box(1.0, 0.025, 0.3, mats.carbon, 0, 0.11, 2.12));
  for (const side of [-1, 1]) {
    const hl = box(0.3, 0.025, 0.05, mats.head, side * 0.32, 0.38, 2.04);
    hl.rotation.y = side * 0.35;
    lean.add(hl);
  }
  const noseNum = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.17), new THREE.MeshBasicMaterial({ map: numberTexture(number, color), transparent: true, depthWrite: false }));
  noseNum.position.set(0, 0.47, 1.65);
  noseNum.rotation.x = -Math.PI / 2 + 0.2;
  lean.add(noseNum);

  // --- tail: wing on swan-neck struts, endplates, diffuser fins, light bar
  for (const side of [-1, 1]) {
    const strut = box(0.03, 0.6, 0.18, mats.carbon, side * 0.3, 1.08, -2.0);
    strut.rotation.x = 0.25;
    lean.add(strut);
    const plate = box(0.03, 0.38, 0.6, mats.carbon, side * 0.98, 1.3, -2.08);
    lean.add(plate);
    lean.add(box(0.035, 0.03, 0.62, mats.accent, side * 0.98, 1.5, -2.08));
  }
  const wing = box(1.94, 0.045, 0.5, mats.carbon, 0, 1.4, -2.08);
  wing.rotation.x = -0.12;
  lean.add(wing);
  lean.add(box(1.94, 0.015, 0.03, mats.accent, 0, 1.43, -1.84));
  // diffuser: an angled carbon panel under the tail, rising toward the back,
  // with short fins fixed to its underside (kept inside the body and clear of the road)
  const diffuser = new THREE.Group();
  diffuser.position.set(0, 0.27, -2.06);
  diffuser.rotation.x = 0.35;
  diffuser.add(box(1.1, 0.02, 0.48, mats.carbon, 0, 0, 0));
  for (let i = -2; i <= 2; i++) diffuser.add(box(0.015, 0.08, 0.44, mats.carbon, i * 0.22, -0.045, 0));
  lean.add(diffuser);
  lean.add(box(1.0, 0.03, 0.03, mats.tail, 0, 0.6, -2.33));
  // engine cover fin down the spine
  const fin = box(0.02, 0.24, 1.3, mats.body, 0, 0.92, -1.1);
  fin.rotation.x = 0.1;
  lean.add(fin);

  // soft underglow
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 5.2).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color: glowCol, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  under.position.y = 0.04;
  under.renderOrder = 2;
  root.add(under);

  root.traverse((o) => {
    if (!o.isMesh) return;
    const lit = !o.material.isMeshBasicMaterial && o.material !== mats.glass;
    o.castShadow = lit;
    o.receiveShadow = lit;
  });
  root.userData = { lean, steerers, wheels, mats, dash, under };
  return root;
}
