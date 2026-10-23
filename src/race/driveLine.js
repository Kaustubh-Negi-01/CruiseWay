import * as THREE from 'three';

// A drive line, like the Forza assist: glowing chevrons on the road ahead
// along your race route or GPS route, coloured by what to do next:
//   blue    you're fine: keep the power on,
//   yellow  ease off, a corner is coming,
//   red     brake now, or you won't make the next corner.
//
// Each route is turned into a path once (resampled every 2 m, with the
// fastest speed you could carry at every point: a corner's limit, then a
// backward pass for braking distance). Each frame only the ~90 chevrons
// in front of you are placed and coloured, as one instanced draw call.

const STEP = 2;          // path resolution (m)
const GAP = 3.2;         // metres between chevrons
const AHEAD = 280;       // how far ahead the line reaches
const START = 7;         // first chevron this far in front of you
const MAX = Math.ceil(AHEAD / GAP) + 2;
const LIFT = 0.07;       // above the road surface

const BLUE = new THREE.Color(0x2ad8ff), YELLOW = new THREE.Color(0xffd23f), RED = new THREE.Color(0xff3b3b);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(), _c = new THREE.Color();

// A flat chevron (a "^" pointing along +z), about 3 m wide: bold enough to
// read from a low chase camera.
function chevronGeometry() {
  const arm = (side) => {
    const g = new THREE.PlaneGeometry(0.5, 1.9).rotateX(-Math.PI / 2);
    g.rotateY(-side * 0.95);   // front ends meet in the middle, back ends spread out
    g.translate(side * 0.72, 0, -0.45);
    return g;
  };
  const a = arm(1), b = arm(-1);
  const pos = [...a.attributes.position.array, ...b.attributes.position.array];
  const idx = [...a.index.array, ...b.index.array.map((i) => i + 4)];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  a.dispose(); b.dispose();
  return g;
}

export class DriveLine {
  constructor(scene) {
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide, toneMapped: false, fog: false,
    });
    // the island's roads are pulled toward the camera in depth (so they never
    // flicker against the ground): pull the chevrons a little further
    this.mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n  gl_Position.z -= 0.0013 * gl_Position.w;');
    };
    this.mesh = new THREE.InstancedMesh(chevronGeometry(), this.mat, MAX);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.path = null;
    this.hint = 0;
    scene.add(this.mesh);
  }

  // Moves with you to the other world.
  setScene(scene) { scene.add(this.mesh); }

  setPath(path) {
    if (path !== this.path) this.hint = 0;
    this.path = path;
    if (!path) this.mesh.count = 0;
  }

  // pos: where you are, speed: m/s, progress: metres along the path if
  // known (races), else found from the position
  update(pos, speed, progress = null) {
    const P = this.path;
    if (!P) { this.mesh.count = 0; return; }
    const s0 = progress ?? this.locate(pos);
    let n = 0;
    for (let s = s0 + START; s < Math.min(P.length, s0 + AHEAD) && n < MAX; s += GAP) {
      const i = Math.min(P.n - 2, Math.floor(s / STEP)), t = s / STEP - i;
      const x = P.x[i] + (P.x[i + 1] - P.x[i]) * t, z = P.z[i] + (P.z[i + 1] - P.z[i]) * t;
      const y = P.y[i] + (P.y[i + 1] - P.y[i]) * t + LIFT;
      // lie along the road, tilted with its slope
      _f.set(P.x[i + 1] - P.x[i], P.y[i + 1] - P.y[i], P.z[i + 1] - P.z[i]).normalize();
      _r.crossVectors(_u.set(0, 1, 0), _f).normalize();
      _u.crossVectors(_f, _r);
      _m.makeBasis(_r, _u, _f);
      _q.setFromRotationMatrix(_m);
      this.mesh.setMatrixAt(n, _m.compose(_p.set(x, y, z), _q, _s));
      // what to do here, at the speed you're doing now
      const v = P.v[i], ratio = speed / Math.max(1, v);
      if (ratio > 1.04) _c.copy(RED);
      else if (ratio > 0.86) _c.copy(YELLOW).lerp(RED, (ratio - 0.86) / 0.18);
      else _c.copy(BLUE).lerp(YELLOW, Math.max(0, (ratio - 0.7) / 0.16));
      // fade in near you and out in the distance
      const d = s - s0;
      const fade = Math.min(1, (d - START + 2) / 10) * Math.min(1, (AHEAD - d) / 70);
      this.mesh.setColorAt(n, _c.multiplyScalar(0.95 * fade));
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  // nearest point of the path to pos, searched near the last one
  locate(pos) {
    const P = this.path;
    const i0 = Math.max(0, Math.floor(this.hint / STEP) - 40), i1 = Math.min(P.n - 1, Math.floor(this.hint / STEP) + 160);
    let best = i0, bd = Infinity;
    for (let i = i0; i <= i1; i++) {
      const d = (P.x[i] - pos.x) ** 2 + (P.z[i] - pos.z) ** 2;
      if (d < bd) { bd = d; best = i; }
    }
    // lost (a reset or a shortcut): look along the whole path
    if (bd > 60 * 60) {
      for (let i = 0; i < P.n; i++) {
        const d = (P.x[i] - pos.x) ** 2 + (P.z[i] - pos.z) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    this.hint = best * STEP;
    return this.hint;
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

// ---- paths -----------------------------------------------------------------------

// From a race route: follows the road with a gentle racing line (drifting
// to the inside of each bend), within the road's width.
export function pathFromRoute(route, spec) {
  const pts = [];
  for (let s = 0; s <= route.length; s += STEP) {
    const p = route.at(s);
    pts.push([p.x, p.y + 0.03, p.z, route.half[Math.min(route.n - 1, route.indexAt(s))]]);
  }
  return finish(pts, spec, true);
}

// From GPS points ([[x, z], ...]): heights from the ground under them. Only
// the first maxLen metres (the line never shows further ahead than that).
export function pathFromPoints(points, heightAt, spec, maxLen = 700) {
  const pts = [];
  let total = 0;
  for (let k = 0; k < points.length - 1 && total < maxLen; k++) {
    const [ax, az] = points[k], [bx, bz] = points[k + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    total += len;
    const n = Math.max(1, Math.round(len / STEP));
    for (let j = 0; j < n; j++) {
      const x = ax + ((bx - ax) * j) / n, z = az + ((bz - az) * j) / n;
      pts.push([x, heightAt(x, z) + 0.03, z, 0]);
    }
  }
  const last = points[points.length - 1];
  if (last) pts.push([last[0], heightAt(last[0], last[1]) + 0.03, last[1], 0]);
  return pts.length > 2 ? finish(pts, spec, false) : null;
}

// Resample evenly, optionally shift toward the inside of bends, and work
// out the speed you could carry at each point.
function finish(raw, spec, racingLine) {
  // even spacing along the polyline
  const xs = [], ys = [], zs = [], hs = [];
  let acc = 0;
  xs.push(raw[0][0]); ys.push(raw[0][1]); zs.push(raw[0][2]); hs.push(raw[0][3]);
  for (let k = 1; k < raw.length; k++) {
    const [px, py, pz] = raw[k - 1], [x, y, z, h] = raw[k];
    const seg = Math.hypot(x - px, z - pz);
    acc += seg;
    while (acc >= STEP && seg > 0) {
      acc -= STEP;
      const t = 1 - acc / seg;
      xs.push(px + (x - px) * t); ys.push(py + (y - py) * t); zs.push(pz + (z - pz) * t); hs.push(h);
    }
  }
  const n = xs.length;
  // heading and curvature (signed: + bends left), smoothed
  const head = new Float32Array(n), curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
    head[i] = Math.atan2(xs[b] - xs[a], zs[b] - zs[a]);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
    let d = head[b] - head[a];
    d = Math.atan2(Math.sin(d), Math.cos(d));
    curv[i] = d / Math.max(STEP, (b - a) * STEP);
  }
  const smooth = (arr, w) => {
    const out = new Float32Array(n);
    let sum = 0;
    for (let i = 0; i < Math.min(n, w); i++) sum += arr[i];
    for (let i = 0; i < n; i++) {
      const lo = i - w - 1, hi = i + w;
      if (hi < n) sum += arr[hi];
      if (lo >= 0) sum -= arr[lo];
      out[i] = sum / (Math.min(n - 1, hi) - Math.max(0, lo + 1) + 1);
    }
    return out;
  };
  const kS = smooth(curv, 6);
  if (racingLine) {
    // cut toward the inside of each bend, by up to most of the road's half width
    const off = smooth(kS.map((k, i) => Math.max(-1, Math.min(1, k * 45)) * Math.max(0, hs[i] - 1.4)), 12);
    for (let i = 0; i < n; i++) {
      const h = head[i], lx = Math.cos(h), lz = -Math.sin(h);   // left of travel
      xs[i] += lx * off[i];
      zs[i] += lz * off[i];
    }
  }
  // the fastest you could take each point: grip limit in bends, then a
  // backward pass so you've braked in time for what's coming
  const grip = spec.wheelie === false ? 15 : 11;     // m/s² sideways (car / bike)
  const brake = (spec.brake || 16) * 0.7;
  const top = spec.maxSpeed || 50;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) v[i] = Math.min(top, Math.sqrt(grip / Math.max(1e-4, Math.abs(kS[i]))));
  for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] ** 2 + 2 * brake * STEP));
  return { x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs), v, n, length: (n - 1) * STEP };
}
