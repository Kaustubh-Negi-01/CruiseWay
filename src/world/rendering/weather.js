import * as THREE from 'three';
import { ATMOS } from './materials.js';

// Rain, snow and lightning around the camera.
//
// Rain and snow are each a single draw call: a fixed set of drops in a box
// that wraps around the camera, moved entirely in the vertex shader, so they
// cost almost nothing on the CPU. How many drops exist depends on the
// graphics preset; how many are showing follows the weather.

const RAIN_MAX = 9000, SNOW_MAX = 7000;
const RAIN_BOX = new THREE.Vector3(64, 34, 64);
const SNOW_BOX = new THREE.Vector3(56, 30, 56);
const BOLT_LIFE = 0.55;

export class WeatherFX {
  constructor(scene, density = 1) {
    this.scene = scene;
    this.time = 0;
    this.camVel = new THREE.Vector3();
    this.lastCam = null;
    this.bolts = [];
    this.flashes = [];           // { t, strength }
    this.flash = 0;
    this.build(density);
  }

  // Graphics preset hook: fewer drops on lighter presets.
  setDensity(density) {
    if (density === this.density) return;
    this.disposeParticles();
    this.build(density);
  }

  build(density) {
    this.density = density;
    this.rain = makeRain(Math.round(RAIN_MAX * density));
    this.snow = makeSnow(Math.round(SNOW_MAX * density));
    this.rain.visible = this.snow.visible = false;
    this.scene.add(this.rain, this.snow);
  }

  // w: { rain, snow, wind, storm }, light: 0..1 how bright the scene is,
  // lamp: 0..1 headlight (drops close in front of the bike catch it)
  update(dt, camera, w, light, pixelHeight, lamp = 0) {
    this.time += dt;
    const cam = camera.position;
    if (this.lastCam && dt > 0) this.camVel.subVectors(cam, this.lastCam).divideScalar(dt);
    if (this.camVel.lengthSq() > 60 * 60) this.camVel.set(0, 0, 0); // teleport
    this.lastCam = (this.lastCam || new THREE.Vector3()).copy(cam);

    const windX = w.wind * 6, windZ = w.wind * 2.5;
    // rain
    const ru = this.rain.material.uniforms;
    this.rain.visible = w.rain > 0.01;
    if (this.rain.visible) {
      ru.uCam.value.copy(cam);
      ru.uTime.value = this.time;
      ru.uAmount.value = Math.min(1, w.rain);
      ru.uFall.value.set(windX, -(20 + w.storm * 6), windZ);
      // streak = motion relative to the camera over ~a 30 ms exposure
      ru.uTail.value.copy(ru.uFall.value).sub(this.camVel).multiplyScalar(0.042);
      ru.uColor.value.setRGB(0.8, 0.84, 0.92).multiplyScalar(0.3 + light * 0.7);
      ru.uOpacity.value = 0.45 + w.storm * 0.15;
      ru.uLamp.value = lamp;
    }
    // snow
    const su = this.snow.material.uniforms;
    this.snow.visible = w.snow > 0.01;
    if (this.snow.visible) {
      su.uCam.value.copy(cam);
      su.uTime.value = this.time;
      su.uAmount.value = Math.min(1, w.snow);
      su.uFall.value.set(windX * 0.35, -1.3, windZ * 0.35);
      su.uColor.value.setRGB(0.92, 0.94, 0.98).multiplyScalar(0.3 + light * 0.7);
      su.uLamp.value = lamp;
      su.uSize.value = 0.11 * pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }

    // lightning: flicker of each strike, and its bolt
    let f = 0;
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const fl = this.flashes[i];
      fl.t += dt;
      if (fl.t > BOLT_LIFE) { this.flashes.splice(i, 1); continue; }
      f = Math.max(f, flicker(fl.t) * fl.strength);
    }
    this.flash = f;
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t += dt;
      if (b.t > BOLT_LIFE) {
        this.scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bolts.splice(i, 1);
        continue;
      }
      b.mesh.material.opacity = flicker(b.t) * b.vis;
    }
    return f;
  }

  // A strike `dist` metres away in direction `angle`. bolt=false lights up
  // the clouds only.
  strike(ev, cam, heightAt) {
    const strength = Math.min(1.4, Math.max(0.25, 700 / ev.dist));
    this.flashes.push({ t: 0, strength: ev.bolt ? strength : strength * 0.6 });
    if (!ev.bolt || this.bolts.length > 2) return;
    const gx = cam.x + Math.sin(ev.angle) * ev.dist, gz = cam.z + Math.cos(ev.angle) * ev.dist;
    const ground = new THREE.Vector3(gx, Math.max(0, heightAt(gx, gz)), gz);
    const top = new THREE.Vector3(gx + (Math.random() - 0.5) * 160, 330, gz + (Math.random() - 0.5) * 160);
    const toCam = new THREE.Vector3().subVectors(cam, ground).normalize();
    const geo = boltGeometry(top, ground, toCam, Math.max(3, ev.dist * 0.0065));
    const mat = new THREE.MeshBasicMaterial({
      color: 0xdde6ff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    // haze dims far bolts, but they're bright enough to punch through some of it
    const fd = ATMOS.uFogDensity.value * ev.dist;
    this.bolts.push({ mesh, t: 0, vis: 0.25 + 0.75 * Math.exp(-fd * fd) });
  }

  disposeParticles() {
    for (const o of [this.rain, this.snow]) {
      this.scene.remove(o);
      o.geometry.dispose();
      o.material.dispose();
    }
  }

  dispose() {
    this.disposeParticles();
    for (const b of this.bolts) { this.scene.remove(b.mesh); b.mesh.geometry.dispose(); b.mesh.material.dispose(); }
    this.bolts.length = 0;
  }
}

// A real flash stutters: a bright stroke, a dip, a re-strike, then fades.
function flicker(t) {
  const pulse = (c, w, a) => a * Math.exp(-((t - c) * (t - c)) / (w * w));
  return Math.min(1, pulse(0.03, 0.035, 1) + pulse(0.14, 0.04, 0.75) + pulse(0.3, 0.07, 0.45));
}

// ---- rain: thin streaks, one instanced quad per drop --------------------------
// (quads rather than GL lines, so drops keep a real width up close on big screens)

function makeRain(count) {
  const geo = new THREE.InstancedBufferGeometry();
  // corner.x: -1/1 across the drop, corner.y: 0 head .. 1 tail
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const seed = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) seed.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));   // xyz in the box, w: show threshold
  geo.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmount: { value: 0 },
      uFall: { value: new THREE.Vector3(0, -20, 0) }, uTail: { value: new THREE.Vector3(0, -0.8, 0) },
      uBox: { value: RAIN_BOX }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0.4 }, uLamp: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform vec3 uCam; uniform float uTime; uniform float uAmount; uniform vec3 uFall; uniform vec3 uTail; uniform vec3 uBox;
      attribute vec4 aSeed;
      uniform float uLamp;
      varying float vA; varying float vX; varying float vLit;
      void main() {
        float on = step(aSeed.w, uAmount);
        vec3 lo = uCam - uBox * 0.5;
        vec3 head = mod(aSeed.xyz * uBox + uFall * uTime * (0.85 + aSeed.y * 0.3) - lo, uBox) + lo;
        vec3 tail = head - uTail;
        vec3 side = normalize(cross(tail - head, head - cameraPosition)) * 0.009;
        vec3 p = mix(head, tail, position.y) + side * position.x;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        vA = on * (1.0 - smoothstep(8.0, 30.0, distance(head, uCam))) * mix(1.0, 0.1, position.y);
        vX = position.x;
        vLit = uLamp * (1.0 - smoothstep(2.0, 16.0, distance(head, uCam)));
        if (on < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor; uniform float uOpacity;
      varying float vA; varying float vX; varying float vLit;
      void main() { gl_FragColor = vec4(uColor + vec3(0.9, 0.86, 0.78) * vLit, (vA * uOpacity + vLit * 0.3) * (1.0 - vX * vX)); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

// ---- snow: soft round flakes ------------------------------------------------------

function makeSnow(count) {
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    pos.set([Math.random(), Math.random(), Math.random()], i * 3);
    rnd.set([Math.random(), Math.random()], i * 2);   // (show threshold, size/speed)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uAmount: { value: 0 },
      uFall: { value: new THREE.Vector3(0, -1.3, 0) }, uBox: { value: SNOW_BOX },
      uColor: { value: new THREE.Color() }, uSize: { value: 30 }, uLamp: { value: 0 },
    },
    vertexShader: /* glsl */`
      uniform vec3 uCam; uniform float uTime; uniform float uAmount; uniform vec3 uFall; uniform vec3 uBox; uniform float uSize; uniform float uLamp;
      attribute vec2 aRand;
      varying float vA; varying float vLit;
      void main() {
        vec3 lo = uCam - uBox * 0.5;
        float sp = 0.7 + aRand.y * 0.6;
        vec3 p = mod(position * uBox + uFall * uTime * sp - lo, uBox) + lo;
        // flakes flutter as they fall
        p.x += sin(uTime * 0.9 + aRand.x * 40.0) * 0.7;
        p.z += cos(uTime * 0.7 + aRand.y * 31.0) * 0.7;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uSize * (0.55 + aRand.y * 0.9) / max(-mv.z, 0.1), 1.0, 24.0);
        float on = step(aRand.x, uAmount);
        vA = on * (1.0 - smoothstep(12.0, 26.0, distance(p, uCam)));
        vLit = uLamp * (1.0 - smoothstep(2.0, 14.0, distance(p, uCam)));
        if (on < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      varying float vA; varying float vLit;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        gl_FragColor = vec4(uColor + vec3(0.8, 0.78, 0.72) * vLit, smoothstep(0.5, 0.1, d) * vA);
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 2;
  return pts;
}

// ---- lightning bolt: a jagged ribbon facing the camera, with a few forks ---------

function boltGeometry(top, ground, toCam, width) {
  const pos = [];
  const ribbon = (pts, w) => {
    const side = new THREE.Vector3();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      side.subVectors(b, a).cross(toCam).normalize().multiplyScalar(w * (1 - (i / pts.length) * 0.4) * 0.5);
      pos.push(
        a.x - side.x, a.y - side.y, a.z - side.z, a.x + side.x, a.y + side.y, a.z + side.z, b.x + side.x, b.y + side.y, b.z + side.z,
        a.x - side.x, a.y - side.y, a.z - side.z, b.x + side.x, b.y + side.y, b.z + side.z, b.x - side.x, b.y - side.y, b.z - side.z,
      );
    }
  };
  const main = jag(top, ground, 7, ground.distanceTo(top) * 0.09);
  ribbon(main, width);
  // forks off the upper part of the main channel
  const forks = 2 + Math.floor(Math.random() * 3);
  for (let f = 0; f < forks; f++) {
    const from = main[Math.floor(main.length * (0.15 + Math.random() * 0.5))];
    const len = 40 + Math.random() * 110;
    const to = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * len, -len * (0.6 + Math.random() * 0.5), (Math.random() - 0.5) * len));
    ribbon(jag(from, to, 4, len * 0.12), width * 0.45);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

// Midpoint displacement: split each segment and push the midpoint sideways.
function jag(a, b, depth, spread) {
  let pts = [a.clone(), b.clone()];
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const m = pts[i].clone().lerp(pts[i + 1], 0.4 + Math.random() * 0.2);
      m.x += (Math.random() - 0.5) * spread;
      m.z += (Math.random() - 0.5) * spread;
      m.y += (Math.random() - 0.5) * spread * 0.3;
      out.push(m, pts[i + 1]);
    }
    pts = out;
    spread *= 0.55;
  }
  return pts;
}
