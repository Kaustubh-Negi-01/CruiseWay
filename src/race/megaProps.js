import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// What the island mega-event puts in the world while you ride it: the giant
// launch ramps (a curved deck with glowing chevrons climbing it, rails, and
// a steel frame down to the ground) and the booster pads on the road. It
// also answers the physics: the ramps are solid ground, a pad gives a
// boost, and riding off a ramp's lip starts its flight.
//
// Everything is merged into a handful of meshes (a few draw calls in all).

const PAD_HALF = [3.2, 6];   // pad half width, half length (m)
const _v = new THREE.Vector3();

export class MegaProps {
  constructor(scene, circuit, heightAt) {
    this.scene = scene;
    this.circuit = circuit;
    this.ramps = circuit.ramps;
    this.pads = circuit.pads;
    this.group = new THREE.Group();
    this.uTime = { value: 0 };
    this.build(heightAt);
    scene.add(this.group);
  }

  // ---- queries -----------------------------------------------------------------------

  // where (x, z) is on ramp r: { s along it, l across it } or null if off it
  local(r, x, z) {
    const dx = x - r.foot.x, dz = z - r.foot.z;
    const s = dx * r.dir[0] + dz * r.dir[1], l = dx * r.dir[1] - dz * r.dir[0];
    return s >= 0 && s <= r.len && Math.abs(l) <= r.half ? s : -1;
  }

  // the highest ramp surface under (x, z) that isn't far above y, or -Infinity
  groundAt(x, y, z) {
    let h = -Infinity;
    this.slope = 0;
    this.on = null;
    for (const r of this.ramps) {
      const s = this.local(r, x, z);
      if (s < 0) continue;
      const ys = r.foot.y + r.c * s + r.k * s * s;
      if (ys > h && ys <= y + 0.8) { h = ys; this.slope = r.c + 2 * r.k * s; this.on = r; this.onS = s; }
    }
    return h;
  }

  normalAt(x, y, z, out) {
    if (this.groundAt(x, y, z) === -Infinity || !this.on) return null;
    const m = this.slope, d = this.on.dir;
    return out.set(-d[0] * m, 1, -d[1] * m).normalize();
  }

  // Once you're on a ramp's deck its rails hold you on it: no sliding off
  // the side halfway up, and the ride turns to face up the ramp.
  keepOn(pos, vel) {
    for (const r of this.ramps) {
      const dx = pos.x - r.foot.x, dz = pos.z - r.foot.z;
      const s = dx * r.dir[0] + dz * r.dir[1], l = dx * r.dir[1] - dz * r.dir[0];
      if (s < 2 || s > r.len || Math.abs(l) > r.half + 1.5) continue;
      if (pos.y < r.foot.y + r.c * s + r.k * s * s - 1) continue;   // underneath it
      const lim = r.half - 0.7;
      if (Math.abs(l) <= lim) return null;
      const side = Math.sign(l), push = Math.abs(l) - lim;
      pos.x -= r.dir[1] * side * push;
      pos.z += r.dir[0] * side * push;
      // take away the sideways speed toward the rail
      const vl = vel.x * r.dir[1] - vel.z * r.dir[0];
      if (vl * side > 0) { vel.x -= r.dir[1] * vl; vel.z += r.dir[0] * vl; }
      return r;
    }
    return null;
  }

  // the ramp whose lip you're riding off, or null
  launchFrom(pos, vel) {
    for (const r of this.ramps) {
      const s = this.local(r, pos.x, pos.z);
      if (s < r.len - 2.5) continue;
      if (Math.abs(pos.y - (r.foot.y + r.c * s + r.k * s * s)) > 2.5) continue;
      if (vel.x * r.dir[0] + vel.z * r.dir[1] < 2) continue;
      return r;
    }
    return null;
  }

  // the booster pad you're on, or null
  padAt(pos) {
    for (const p of this.pads) {
      const dx = pos.x - p.x, dz = pos.z - p.z;
      if (Math.abs(pos.y - p.y) > 3) continue;
      const s = dx * p.dir[0] + dz * p.dir[1], l = dx * p.dir[1] - dz * p.dir[0];
      if (Math.abs(s) <= PAD_HALF[1] && Math.abs(l) <= PAD_HALF[0]) return p;
    }
    return null;
  }

  // ---- meshes ------------------------------------------------------------------------

  build(heightAt) {
    const decks = [], frames = [], rails = [], pads = [];
    for (const r of this.ramps) {
      const [dx, dz] = r.dir, rx = dz, rz = -dx;   // (rx, rz): across the ramp
      const at = (s, l, dy = 0) => [r.foot.x + dx * s + rx * l, r.foot.y + r.c * s + r.k * s * s + dy, r.foot.z + dz * s + rz * l];
      // the deck: a strip every 2 m, with a thick edge you can see from below
      const P = [], UV = [];
      const quad = (a, b, c, d, ua, ub) => { P.push(...a, ...b, ...c, ...a, ...c, ...d); UV.push(...ua, ...ub); };
      for (let s = 0; s < r.len; s += 2) {
        const s1 = Math.min(r.len, s + 2), h = r.half;
        quad(at(s, -h), at(s, h), at(s1, h), at(s1, -h), [s, -1, s, 1, s1, 1], [s, -1, s1, 1, s1, -1]);
        quad(at(s, h, -0.8), at(s, -h, -0.8), at(s1, -h, -0.8), at(s1, h, -0.8), [s, 2, s, 2, s1, 2], [s, 2, s1, 2, s1, 2]);
        for (const side of [-1, 1]) {
          const l = side * h;
          quad(at(s, l, -0.8), at(s, l, 0), at(s1, l, 0), at(s1, l, -0.8), [s, 3, s, 3, s1, 3], [s, 3, s1, 3, s1, 3]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
      g.computeVertexNormals();
      decks.push(g);
      // glowing rails along both edges
      for (const side of [-1, 1]) {
        for (let s = 0; s < r.len; s += 2) {
          const a = at(s, side * (r.half - 0.1), 0.6), b = at(Math.min(r.len, s + 2), side * (r.half - 0.1), 0.6);
          rails.push(beam(a, b, 0.12));
        }
      }
      // the frame: pairs of legs every 10 m down to the ground, with cross bars
      for (let s = 10; s <= r.len; s += 10) {
        for (const side of [-1, 1]) {
          const top = at(s, side * (r.half - 0.6), -0.8);
          const gy = heightAt(top[0], top[2]);
          if (top[1] - gy < 1) continue;
          frames.push(new THREE.BoxGeometry(0.7, top[1] - gy, 0.7).translate(top[0], (top[1] + gy) / 2, top[2]));
        }
        const a = at(s, -(r.half - 0.6), -0.9), b = at(s, r.half - 0.6, -0.9);
        if (a[1] - heightAt(a[0], a[2]) > 3) frames.push(beam(a, b, 0.5));
      }
      // a tall marker mast at the lip, so you can see the next ramp from far off
      const lip = at(r.len, 0);
      frames.push(new THREE.BoxGeometry(0.5, 30, 0.5).translate(lip[0] + rx * (r.half + 1.5), lip[1] + 15 - 6, lip[2] + rz * (r.half + 1.5)));
      frames.push(new THREE.BoxGeometry(0.5, 30, 0.5).translate(lip[0] - rx * (r.half + 1.5), lip[1] + 15 - 6, lip[2] - rz * (r.half + 1.5)));
      rails.push(beam([lip[0] + rx * (r.half + 1.5), lip[1] + 24, lip[2] + rz * (r.half + 1.5)], [lip[0] - rx * (r.half + 1.5), lip[1] + 24, lip[2] - rz * (r.half + 1.5)], 0.6));
    }
    for (const p of this.pads) {
      const [dx, dz] = p.dir, rx = dz, rz = -dx, [hw, hl] = PAD_HALF, y = p.y + 0.09;
      const c = (s, l) => [p.x + dx * s + rx * l, y, p.z + dz * s + rz * l];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...c(-hl, -hw), ...c(-hl, hw), ...c(hl, hw), ...c(-hl, -hw), ...c(hl, hw), ...c(hl, -hw)], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
      pads.push(g);
    }
    const deckMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      vertexShader: /* glsl */`
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main() {
          vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
          vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime;
        varying vec2 vUv; varying vec3 vN; varying vec3 vW;
        void main() {
          float s = vUv.x, l = vUv.y;
          vec3 light = normalize(vec3(0.4, 0.8, 0.3));
          float lit = 0.55 + 0.45 * max(dot(vN, light), 0.0);
          vec3 col;
          if (l > 2.5) col = vec3(1.0, 0.45, 0.1) * 1.4;                 // the glowing edge
          else if (l > 1.5) col = vec3(0.12, 0.13, 0.16) * lit;          // underneath
          else {
            // slate deck, white edge stripes, and bold orange chevrons (pointing
            // up the ramp) sliding up it
            float edge = smoothstep(0.84, 0.88, abs(l)) * (1.0 - smoothstep(0.95, 0.98, abs(l)));
            float v = fract((s - abs(l) * 5.0) / 8.0 - uTime * 2.2);
            float aa = fwidth(v) * 1.5;
            float chev = smoothstep(0.0, aa, v) * (1.0 - smoothstep(0.32 - aa, 0.32, v)) * (1.0 - smoothstep(0.78, 0.82, abs(l)));
            col = vec3(0.24, 0.25, 0.29) * lit;
            col = mix(col, vec3(0.95), edge);
            col = mix(col, vec3(1.0, 0.5, 0.1) * 1.6, chev);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const padMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        uniform float uTime; varying vec2 vUv;
        void main() {
          float l = abs(vUv.x - 0.5) * 2.0, s = vUv.y;
          float c = fract(s * 3.0 - uTime * 2.5 - l * 0.6);
          float chev = smoothstep(0.0, 0.08, c) * smoothstep(0.45, 0.3, c);
          float rim = smoothstep(0.8, 0.95, max(l, abs(s - 0.5) * 2.0));
          vec3 col = vec3(0.1, 0.85, 1.0) * (0.25 + chev * 1.6 + rim * 0.9);
          gl_FragColor = vec4(col, 0.35 + chev * 0.6 + rim * 0.5);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    // pads lie on the road, which is drawn pulled toward the camera: pull them further
    padMat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);', 'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position.z -= 0.0016 * gl_Position.w;'); };
    const frameMat = new THREE.MeshLambertMaterial({ color: 0x3a3f4a });
    const railMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.62, 0.2).multiplyScalar(2), toneMapped: false });
    if (decks.length) this.group.add(new THREE.Mesh(mergeGeometries(decks), deckMat));
    if (frames.length) this.group.add(new THREE.Mesh(mergeGeometries(frames.map((g) => g.toNonIndexed())), frameMat));
    if (rails.length) this.group.add(new THREE.Mesh(mergeGeometries(rails.map((g) => g.toNonIndexed())), railMat));
    if (pads.length) {
      const m = new THREE.Mesh(mergeGeometries(pads), padMat);
      m.renderOrder = 5;
      this.group.add(m);
    }
  }

  update(dt) { this.uTime.value += dt; }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  }
}

// a square bar from a to b
function beam(a, b, w) {
  const A = _v.set(...a), len = A.distanceTo(new THREE.Vector3(...b));
  const g = new THREE.BoxGeometry(w, w, len);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...a), new THREE.Vector3(...b), new THREE.Vector3(0, 1, 0));
  g.applyMatrix4(m);
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return g;
}
