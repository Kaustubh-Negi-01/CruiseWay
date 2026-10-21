import * as THREE from 'three';

// Tuning for the three rides. Speeds in m/s.
export const VEHICLES = {
  car: {
    label: 'Car', maxSpeed: 55, accel: 10, brake: 18, reverse: 9,
    grip: 7.5, offGrip: 3.6, offDrag: 0.35, steer: 1.55, handbrakeGrip: 1.4,
    camDist: 7.5, camHeight: 2.6, length: 4.3,
  },
  bike: {
    label: 'Motorbike', maxSpeed: 60, accel: 12, brake: 20, reverse: 4,
    grip: 6.5, offGrip: 2.8, offDrag: 0.45, steer: 1.8, handbrakeGrip: 1.2,
    camDist: 6, camHeight: 2.2, length: 2.2, lean: true,
  },
  bus: {
    label: 'Bus', maxSpeed: 34, accel: 6.5, brake: 10, reverse: 5,
    grip: 6.5, offGrip: 3.8, offDrag: 0.3, steer: 0.95, handbrakeGrip: 2,
    camDist: 15, camHeight: 5.5, length: 11,
  },
};

export const VEHICLE_IDS = Object.keys(VEHICLES);

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

function wheel(r, w) {
  const g = new THREE.CylinderGeometry(r, r, w, 10).rotateZ(Math.PI / 2);
  return new THREE.Mesh(g, mat(0x1c1c1e));
}

// Every model faces +z with the ground at y=0. `body` is the part that
// pitches/rolls/leans; `wheels` spin.
export function buildVehicleModel(type, color = 0xd9483b) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const wheels = [];
  const paint = mat(color);
  const glass = mat(0x2a3440);
  const lights = [];

  const lamp = (x, y, z, c = 0xfff4d0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.16, 0.06), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z);
    body.add(m);
    lights.push(m);
  };

  if (type === 'car') {
    const lower = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 4.2), paint);
    lower.position.y = 0.6;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.5, 2.1), glass);
    cabin.position.set(0, 1.12, -0.25);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 1.9), paint);
    roof.position.set(0, 1.4, -0.25);
    body.add(lower, cabin, roof);
    for (const [x, z] of [[-0.85, 1.35], [0.85, 1.35], [-0.85, -1.35], [0.85, -1.35]]) {
      const w = wheel(0.38, 0.3);
      w.position.set(x, 0.38, z);
      root.add(w); wheels.push(w);
    }
    lamp(-0.6, 0.65, 2.11); lamp(0.6, 0.65, 2.11);
    lamp(-0.6, 0.7, -2.11, 0xff2a2a); lamp(0.6, 0.7, -2.11, 0xff2a2a);
  } else if (type === 'bike') {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 1.5), paint);
    frame.position.set(0, 0.75, 0);
    const tank = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.3, 0.6), paint);
    tank.position.set(0, 1.0, 0.3);
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.7), mat(0x222222));
    seat.position.set(0, 1.02, -0.35);
    const rider = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.35), mat(0x2b2f3a));
    rider.position.set(0, 1.5, -0.2);
    rider.rotation.x = 0.35;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), paint);
    head.position.set(0, 2.0, 0.05);
    const bars = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.05, 0.05), mat(0x222222));
    bars.position.set(0, 1.25, 0.65);
    body.add(frame, tank, seat, rider, head, bars);
    for (const z of [0.75, -0.75]) {
      const w = wheel(0.36, 0.14);
      w.position.set(0, 0.36, z);
      body.add(w); wheels.push(w);
    }
    lamp(0, 1.05, 0.82);
    lamp(0, 0.95, -0.82, 0xff2a2a);
  } else {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 11), paint);
    shell.position.y = 1.85;
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.8, 9.6), glass);
    band.position.set(0, 2.35, -0.3);
    const wind = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.1, 0.06), glass);
    wind.position.set(0, 2.3, 5.51);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.54, 0.18, 11.02), mat(0xf2f2f2));
    stripe.position.y = 1.35;
    body.add(shell, band, wind, stripe);
    for (const [x, z] of [[-1.1, 3.6], [1.1, 3.6], [-1.1, -3.3], [1.1, -3.3]]) {
      const w = wheel(0.55, 0.4);
      w.position.set(x, 0.55, z);
      root.add(w); wheels.push(w);
    }
    lamp(-0.9, 1.0, 5.51); lamp(0.9, 1.0, 5.51);
    lamp(-0.9, 1.2, -5.51, 0xff2a2a); lamp(0.9, 1.2, -5.51, 0xff2a2a);
  }

  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  root.userData = { type, body, wheels, lights, wheelR: type === 'bus' ? 0.55 : type === 'bike' ? 0.36 : 0.38 };
  return root;
}

// Make a model see-through for remote players.
export function ghostify(root, color) {
  const tint = new THREE.Color(color);
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = false;
    const m = o.material.clone();
    m.transparent = true;
    m.opacity = o.material.isMeshBasicMaterial ? 0.7 : 0.42;
    m.depthWrite = false;
    if (m.color && !o.material.isMeshBasicMaterial) m.color.lerp(tint, 0.6);
    if ('emissive' in m) m.emissive = tint.clone().multiplyScalar(0.25);
    o.material = m;
  });
  return root;
}

export function disposeModel(root) {
  root.traverse((o) => {
    if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); }
  });
}
