import * as THREE from 'three';

// The Manhunt zone: a ring of holographic wall around the arena that follows
// the ground and shrinks over the round. Touching it pushes you back inside.

const SEG = 160;           // wall segments around the ring
const HEIGHT = 9;          // metres above the ground
const BELOW = 4;           // metres below it (so dips never show a gap)
const MARGIN = 0.8;        // how close a vehicle's centre may get to the wall

const vert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

// Same look as the race barriers: grid, glowing rails, a scanline sweep and a
// flash where you hit it; diagonal hazard stripes instead of chevrons.
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
    float grid = max(line(s / 2.0, 0.04), line(h * 8.0, 0.05)) * 0.3;
    float rails = smoothstep(0.05, 0.0, abs(h - 0.31)) + smoothstep(0.96, 1.0, h) * 0.9;
    float stripes = step(0.82, fract((s + h * 12.0) / 6.0 - uTime * 0.4)) * smoothstep(0.31, 0.36, h) * 0.35;
    float scan = smoothstep(0.03, 0.0, abs(fract(h - uTime * 0.25) - 0.5) - 0.47) * 0.25;
    float body = 0.06 + 0.07 * (1.0 - h);
    float a = body + grid + rails + stripes + scan;
    vec3 col = mix(uColor, uHot, clamp(rails + stripes, 0.0, 1.0));
    float hit = exp(-uHitAge * 3.5) * smoothstep(10.0, 0.0, distance(vWorld, uHitPos));
    col = mix(col, vec3(1.0), hit * 0.7);
    a += hit * 1.2;
    a *= smoothstep(750.0, 160.0, distance(vWorld, uCam));
    gl_FragColor = vec4(col * a, a);
  }`;

export class ArenaWall {
  constructor(scene, center, world) {
    this.scene = scene;
    this.cx = center.x;
    this.cz = center.z;
    this.world = world;
    this.r = -1;
    this.builtAt = 0;
    this.uniforms = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0xb35cff) },
      uHot: { value: new THREE.Color(0xffc8ff) },
      uHitPos: { value: new THREE.Vector3(1e6, 0, 0) },
      uHitAge: { value: 99 },
      uCam: { value: new THREE.Vector3() },
    };
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array((SEG + 1) * 2 * 3);
    this.uv = new Float32Array((SEG + 1) * 2 * 2);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    const idx = [];
    for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  // r: current radius. The ring is rebuilt (following the ground) when it has
  // moved half a metre, at most five times a second.
  update(now, dt, r, cam) {
    this.uniforms.uTime.value += dt;
    this.uniforms.uHitAge.value += dt;
    this.uniforms.uCam.value.copy(cam);
    if (Math.abs(r - this.r) > 0.5 && now - this.builtAt > 200) this.build(r, now);
  }

  build(r, now) {
    this.r = r;
    this.builtAt = now;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = this.cx + Math.cos(a) * r, z = this.cz + Math.sin(a) * r;
      const y = Math.max(-1, this.world.heightAt(x, z));
      this.pos.set([x, y - BELOW, z, x, y + HEIGHT, z], i * 6);
      const s = a * r;
      this.uv.set([s, 0, s, 1], i * 4);
    }
    const g = this.mesh.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.uv.needsUpdate = true;
  }

  // Keep a vehicle inside: push it back and turn its outward motion along the wall.
  constrain(pos, vel, r) {
    const dx = pos.x - this.cx, dz = pos.z - this.cz;
    const d = Math.hypot(dx, dz), lim = r - MARGIN;
    if (d <= lim || d < 1e-3) return 0;
    const nx = dx / d, nz = dz / d;
    pos.x = this.cx + nx * lim;
    pos.z = this.cz + nz * lim;
    const vn = vel.x * nx + vel.z * nz;
    if (vn <= 0) return 0;
    vel.x -= nx * vn * 1.05;
    vel.z -= nz * vn * 1.05;
    const scrub = Math.max(0.7, 1 - vn * 0.02);
    vel.x *= scrub; vel.z *= scrub;
    this.uniforms.uHitPos.value.set(pos.x, pos.y + 1, pos.z);
    this.uniforms.uHitAge.value = 0;
    return vn;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
