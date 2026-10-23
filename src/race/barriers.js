import * as THREE from 'three';

// Holographic walls along both sides of a race route. They keep racers on
// the track: touching one pushes you back in and scrubs off speed.
//
// Walls sit just past the road edge and run through junctions too, which
// closes off side roads. Where the route doubles back close to itself, the
// wall pieces that would cut across the road are left out (and don't collide).

const MARGIN = 4.6;        // metres beyond the road edge (room to run wide in bends)
const HEIGHT = 2.6;
const PIECE = 48;          // samples per mesh (culled / faded by distance)
const BIKE_HALF = 0.45;    // how close the bike's centre can get to a wall

const vert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Grid panel with glowing rails, chevrons scrolling in the race direction,
// a scanline sweep, and a flash where the rider last hit it.
const frag = /* glsl */`
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uHot;
  uniform vec3 uHitPos;
  uniform float uHitAge;
  uniform vec3 uCam;
  varying vec2 vUv;
  varying vec3 vWorld;
  float line(float v, float w) { float f = abs(fract(v) - 0.5); return smoothstep(w, 0.0, 0.5 - f); }
  void main() {
    float s = vUv.x, h = vUv.y;
    float grid = max(line(s / 1.2, 0.04), line(h * 6.0, 0.05)) * 0.35;
    float rails = smoothstep(0.06, 0.0, h) + smoothstep(0.94, 1.0, h) * 0.9;
    // chevrons: arrow shapes every 14 m, drifting forward
    float c = fract((s - uTime * 6.0) / 14.0);
    float arrow = abs(h - 0.5) * 0.9 + c * 3.2;
    float chev = smoothstep(0.18, 0.0, abs(fract(arrow) - 0.5) - 0.25) * step(c, 0.28) * step(abs(h - 0.5), 0.32);
    float scan = smoothstep(0.03, 0.0, abs(fract(h - uTime * 0.35) - 0.5) - 0.47) * 0.25;
    float body = 0.07 + 0.08 * (1.0 - h);
    float a = body + grid + rails + chev * 0.8 + scan;
    vec3 col = mix(uColor, uHot, clamp(rails + chev, 0.0, 1.0));
    // impact flash
    float hit = exp(-uHitAge * 3.5) * smoothstep(9.0, 0.0, distance(vWorld, uHitPos));
    col = mix(col, vec3(1.0), hit * 0.7);
    a += hit * 1.2;
    // fade out with distance so only the nearby stretch draws attention
    float d = distance(vWorld, uCam);
    a *= smoothstep(420.0, 140.0, d);
    gl_FragColor = vec4(col * a, a);
  }`;

export class RaceBarriers {
  constructor(scene, spot) {
    this.scene = scene;
    this.route = spot.route;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xff3b5c) },
      uHot: { value: new THREE.Color(0xffd0a0) },
      uHitPos: { value: new THREE.Vector3(1e6, 0, 0) },
      uHitAge: { value: 99 },
      uCam: { value: new THREE.Vector3() },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.computeWalls();
    this.buildMeshes();
  }

  // Per-sample wall line on each side, and whether that wall exists.
  computeWalls() {
    const r = this.route, n = r.n;
    this.nx = new Float32Array(n); this.nz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
      let tx = r.x[b] - r.x[a], tz = r.z[b] - r.z[a];
      const l = Math.hypot(tx, tz) || 1;
      this.nx[i] = -tz / l; this.nz[i] = tx / l; // left-hand normal
    }
    // spatial grid of route samples to find places where it runs past itself
    const CELL = 24, grid = new Map();
    const key = (cx, cz) => cx * 100003 + cz;
    for (let i = 0; i < n; i++) {
      const k = key(Math.floor(r.x[i] / CELL), Math.floor(r.z[i] / CELL));
      (grid.get(k) || grid.set(k, []).get(k)).push(i);
    }
    this.wall = [new Uint8Array(n), new Uint8Array(n)]; // [left, right]
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? 1 : -1;
      for (let i = 0; i < n; i++) {
        const off = r.half[i] + MARGIN;
        const wx = r.x[i] + this.nx[i] * off * sgn, wz = r.z[i] + this.nz[i] * off * sgn;
        let blocked = false;
        const cx = Math.floor(wx / CELL), cz = Math.floor(wz / CELL);
        for (let dz = -1; dz <= 1 && !blocked; dz++) for (let dx = -1; dx <= 1 && !blocked; dx++) {
          const list = grid.get(key(cx + dx, cz + dz));
          if (!list) continue;
          for (const j of list) {
            if (Math.abs(r.s[j] - r.s[i]) < 40) continue;
            if (Math.hypot(r.x[j] - wx, r.z[j] - wz) < r.half[j] + 1.5) { blocked = true; break; }
          }
        }
        this.wall[side][i] = blocked ? 0 : 1;
      }
    }
  }

  buildMeshes() {
    const r = this.route, n = r.n;
    this.pieces = [];
    for (let side = 0; side < 2; side++) {
      const sgn = side === 0 ? 1 : -1;
      for (let i0 = 0; i0 < n - 1; i0 += PIECE) {
        const i1 = Math.min(n - 1, i0 + PIECE);
        const pos = [], uv = [], idx = [];
        let v = 0;
        for (let i = i0; i <= i1; i++) {
          const off = r.half[i] + MARGIN;
          const x = r.x[i] + this.nx[i] * off * sgn, z = r.z[i] + this.nz[i] * off * sgn, y = r.y[i];
          pos.push(x, y - 0.3, z, x, y + HEIGHT, z);
          uv.push(r.s[i], 0, r.s[i], 1);
          // a quad only where both ends have a wall
          if (i < i1 && this.wall[side][i] && this.wall[side][i + 1]) idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
          v += 2;
        }
        if (!idx.length) continue;
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeBoundingSphere();
        const m = new THREE.Mesh(g, this.material);
        m.renderOrder = 3;
        m.frustumCulled = true;
        this.group.add(m);
        this.pieces.push(m);
      }
    }
  }

  // Keep the bike inside the walls. Called from the physics step.
  // `hint` is where along the route the bike was last time.
  // Returns impact strength (m/s into the wall) or 0.
  constrain(pos, vel, hint) {
    const r = this.route;
    const q = r.nearestS(pos.x, pos.z, hint, 60);
    this.lastS = q.s;
    const i = Math.min(r.n - 1, Math.max(0, r.indexAt(q.s)));
    const p = r.at(q.s);
    // which side of the centre line are we on?
    const side = (pos.x - p.x) * this.nx[i] + (pos.z - p.z) * this.nz[i] >= 0 ? 0 : 1;
    if (!this.wall[side][i]) return 0;
    const limit = r.half[i] + MARGIN - BIKE_HALF;
    if (q.d <= limit) return 0;
    const nx = (pos.x - p.x) / q.d, nz = (pos.z - p.z) / q.d;
    pos.x = p.x + nx * limit;
    pos.z = p.z + nz * limit;
    const vn = vel.x * nx + vel.z * nz;
    if (vn <= 0) return 0;
    // remove the push into the wall so you slide along it; a glancing touch
    // costs a little speed, a head-on hit a lot more
    vel.x -= nx * vn * 1.05;
    vel.z -= nz * vn * 1.05;
    const scrub = Math.max(0.65, 1 - vn * 0.025);
    vel.x *= scrub; vel.z *= scrub;
    this.uniforms.uHitPos.value.set(pos.x + nx * 0.5, pos.y + 1, pos.z + nz * 0.5);
    this.uniforms.uHitAge.value = 0;
    return vn;
  }

  update(dt, cam) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uHitAge.value += dt;
    this.uniforms.uCam.value.copy(cam);
    for (const m of this.pieces) {
      const c = m.geometry.boundingSphere.center;
      m.visible = c.distanceToSquared(cam) < 520 * 520;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const m of this.pieces) m.geometry.dispose();
    this.material.dispose();
  }
}
