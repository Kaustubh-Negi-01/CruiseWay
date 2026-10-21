import * as THREE from 'three';
import { ATMOS, raw, textures } from './materials.js';

// Sun, moon, sky dome and the light they give, through the day and through
// the weather. The dome's horizon uses the same haze function as the terrain
// so they meet cleanly.
//
// Colours are keyed on the sun's height above the horizon (night, blue hour,
// dusk, golden hour, day, noon) and blended between, then greyed and dimmed
// by the cloud deck.

// The sun rises from the direction the original golden-hour light came from.
const EAST = new THREE.Vector3(-0.55, 0, 0.83).normalize();
const SOUTH = new THREE.Vector3(0.83, 0, 0.55).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const TILT = 0.6;   // radians off the zenith at noon (~34°)

const K = (e, o) => ({ e, ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' && k !== 'sunI' && k !== 'hemiI' && k !== 'stars' && k !== 'exp' ? raw(v) : v])) });
const KEYS = [
  K(-0.45, { fog: 0x0a1120, sunFog: 0x0e1830, zenith: 0x02050d, upper: 0x050b1a, sun: 0x8fa6ff, sunI: 0,   hemiSky: 0x3a4c7a, hemiGround: 0x0e1014, hemiI: 0.6,  cloud: 0x10141e, cloudLit: 0x1a2030, stars: 1,   exp: 1.25 }),
  K(-0.14, { fog: 0x252b46, sunFog: 0x4a3352, zenith: 0x0a1230, upper: 0x24365f, sun: 0x8fa6ff, sunI: 0,   hemiSky: 0x5a6896, hemiGround: 0x18181c, hemiI: 0.65, cloud: 0x262a40, cloudLit: 0x3a3450, stars: 0.6, exp: 1.2 }),
  K(-0.035, { fog: 0x8a6072, sunFog: 0xff7444, zenith: 0x22346a, upper: 0x6878a0, sun: 0xff8a50, sunI: 0,   hemiSky: 0x8a90b8, hemiGround: 0x3a3028, hemiI: 0.8,  cloud: 0x6a5468, cloudLit: 0xff9a6a, stars: 0,   exp: 1.12 }),
  K(0.12,  { fog: 0xd6b2a0, sunFog: 0xffb27a, zenith: 0x4f7fb4, upper: 0x9ab3c9, sun: 0xffc595, sunI: 3.4, hemiSky: 0xa9bfe0, hemiGround: 0x5a4a2c, hemiI: 1.15, cloud: 0x9e94a0, cloudLit: 0xffc79a, stars: 0,   exp: 1.05 }),
  K(0.34,  { fog: 0xc6ced6, sunFog: 0xffe2c2, zenith: 0x3c74b8, upper: 0x90b3d6, sun: 0xffead8, sunI: 3.6, hemiSky: 0xb0c8e6, hemiGround: 0x5a5034, hemiI: 1.2,  cloud: 0xc2c6d0, cloudLit: 0xfff4e6, stars: 0,   exp: 1.0 }),
  K(0.85,  { fog: 0xc0cbd6, sunFog: 0xfff0dc, zenith: 0x346cb4, upper: 0x8bb0d8, sun: 0xfff6ea, sunI: 3.8, hemiSky: 0xb4cbe8, hemiGround: 0x5c5236, hemiI: 1.25, cloud: 0xd0d4dc, cloudLit: 0xffffff, stars: 0,   exp: 1.0 }),
];
const MOON = { color: raw(0x9fb4ff), intensity: 0.55 };

const _c = new THREE.Color(), _grey = new THREE.Color();

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    scene.background = null;
    scene.fog = null;
    this.sunDir = ATMOS.uSunDir.value;
    this.moonDir = new THREE.Vector3();
    this.lightDir = new THREE.Vector3();
    this.flash = 0;           // lightning, set by the weather effects
    this.envLevel = 1;        // how bright reflections should be (night/clouds dim them)

    this.hemi = new THREE.HemisphereLight(0xa9bfe0, 0x5a4a2c, 1.15);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffc595, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 1; c.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    scene.add(this.sun, this.sun.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        ...ATMOS,
        uZenith: { value: raw(0x4f7fb4) },
        uUpper: { value: raw(0x9ab3c9) },
        uNoise: { value: textures().noise },
        uSunColor: { value: raw(0xfff0d0) },
        uCloud: { value: raw(0x9e94a0) },
        uCloudLit: { value: raw(0xffc79a) },
        uMoonDir: { value: this.moonDir },
        uOvercast: { value: 0 },
        uHaze: { value: 0 },
        uStars: { value: 0 },
        uSunVis: { value: 1 },
        uFlash: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDir; uniform vec3 uFogColor; uniform vec3 uSunFogColor; uniform float uTime;
        uniform vec3 uZenith; uniform vec3 uUpper; uniform vec3 uSunColor; uniform sampler2D uNoise;
        uniform vec3 uCloud; uniform vec3 uCloudLit; uniform vec3 uMoonDir;
        uniform float uOvercast; uniform float uHaze; uniform float uStars; uniform float uSunVis; uniform float uFlash;
        varying vec3 vDir;
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * texture2D(uNoise, p).r; p = p * 2.03 + 0.17; a *= 0.5; }
          return v;
        }
        float hash3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
        void main() {
          vec3 d = normalize(vDir);
          float s = max(dot(d, uSunDir), 0.0);
          vec3 horizon = mix(uFogColor, uSunFogColor, pow(s, 5.0) * 0.9);
          float h = max(d.y, 0.0);
          vec3 col = mix(horizon, uUpper, smoothstep(0.0, 0.25, h));
          col = mix(col, uZenith, smoothstep(0.18, 0.75, h));
          // warm glow that wraps around the sun near the horizon
          col += uSunFogColor * pow(s, 3.0) * 0.35 * (1.0 - smoothstep(0.0, 0.5, h)) * uSunVis;
          float cover = 0.0;
          if (d.y > 0.0) {
            // stars, faded out under cloud
            if (uStars > 0.01) {
              vec3 sp = d * 260.0;
              vec3 cell = floor(sp);
              float hs = hash3(cell);
              vec3 c = cell + 0.2 + 0.6 * vec3(hash3(cell + 1.3), hash3(cell + 2.7), hash3(cell + 4.1));
              float star = smoothstep(0.16, 0.0, length(sp - c)) * step(0.993, hs);
              star *= 0.6 + 0.4 * sin(uTime * (1.5 + hs * 4.0) + hs * 60.0);
              col += vec3(0.85, 0.9, 1.0) * star * uStars * smoothstep(0.02, 0.2, d.y) * 2.2;
            }
            // clouds on a flat layer, thicker and darker as the weather turns
            vec2 p = d.xz / (d.y + 0.12) * 0.11 + vec2(uTime * 0.0012, uTime * 0.0004) * (1.0 + uOvercast * 2.5);
            float n = fbm(p);
            cover = smoothstep(0.47 - uOvercast * 0.38, 0.72 - uOvercast * 0.3, n);
            float lit = pow(s, 2.0) * uSunVis;
            vec3 cloud = mix(uCloud, uCloudLit, (0.35 + lit * 0.65) * (1.0 - uOvercast * 0.7));
            cloud *= 1.0 - uOvercast * 0.35 * smoothstep(0.55, 0.85, n);   // darker bellies
            cloud = mix(cloud, horizon, 0.35);
            float fade = smoothstep(0.02, 0.22, d.y);
            col = mix(col, cloud, cover * fade * (0.85 + uOvercast * 0.15));
            // a solid deck behind the gaps
            col = mix(col, mix(uCloud, horizon, 0.45), uOvercast * 0.65 * fade);
          }
          // moon: a soft disc and halo opposite the sun
          float m = max(dot(d, uMoonDir), 0.0);
          float moon = smoothstep(0.99955, 0.99975, m) * 1.3 + pow(m, 180.0) * 0.12;
          col += vec3(0.82, 0.86, 1.0) * moon * uStars * (1.0 - cover * 0.9) * (1.0 - uOvercast * 0.8);
          // sun disc, hidden by cloud and below the horizon
          col += uSunColor * (smoothstep(0.9993, 0.9997, s) * 2.0 + pow(s, 400.0) * 0.6) * uSunVis * smoothstep(-0.02, 0.01, d.y);
          // fog swallows the sky
          col = mix(col, horizon, uHaze);
          // lightning lights up the cloud
          col += vec3(0.55, 0.6, 0.85) * uFlash * (0.25 + cover * 1.1);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1;
    scene.add(this.skyMesh);

    // Reflection map of the golden-hour sky (plus a dark land disc below the
    // horizon) for the chrome bike and the water. At night and under cloud
    // reflections are dimmed rather than re-baked (see envLevel).
    this.setTime(0.02, null);
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat));
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(48, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x2a2a18 }),
    );
    ground.position.y = -2;
    envScene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = pmrem.fromScene(envScene, 0, 0.1, 200);
    this.envMap = this.envTarget.texture;
    pmrem.dispose();
    ground.geometry.dispose();
    ground.material.dispose();
  }

  // Lighting for a moment of the day (0 sunrise .. 0.25 noon .. 0.5 sunset
  // .. 0.75 midnight) under some weather ({ overcast, fog, rain, storm }).
  setTime(day, w) {
    const a = day * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    // sun arc: rises along EAST, peaks tilted toward SOUTH
    this.sunDir.copy(EAST).multiplyScalar(ca)
      .addScaledVector(UP, sa * Math.cos(TILT))
      .addScaledVector(SOUTH, sa * Math.sin(TILT))
      .normalize();
    this.moonDir.copy(this.sunDir).negate();
    this.moonDir.y = Math.abs(this.moonDir.y) * 0.85 + 0.05; // keep the moon a little higher at dusk
    this.moonDir.normalize();
    const e = this.sunDir.y;

    // blend the two keyframes either side of the sun's height
    let i = 0;
    while (i < KEYS.length - 2 && e > KEYS[i + 1].e) i++;
    const A = KEYS[i], B = KEYS[i + 1];
    const t = Math.min(1, Math.max(0, (e - A.e) / (B.e - A.e)));
    const lerpC = (k, out) => out.copy(A[k]).lerp(B[k], t);
    const lerpN = (k) => A[k] + (B[k] - A[k]) * t;

    const overcast = w ? w.overcast : 0;
    const storm = w ? w.storm : 0;
    const rain = w ? w.rain : 0;
    const dark = 1 - storm * 0.55 - rain * 0.12;            // storms darken everything
    const day01 = Math.min(1, Math.max(0, (e + 0.1) / 0.3));  // 0 night .. 1 day

    const U = this.skyMat.uniforms;
    // haze colours, greyed toward the cloud colour under overcast
    lerpC('fog', ATMOS.uFogColor.value);
    lerpC('sunFog', ATMOS.uSunFogColor.value);
    lerpC('cloud', _grey);
    const greyLum = (0.45 + 0.55 * _grey.r) * day01 + 0.04;
    _grey.setRGB(greyLum * 0.86, greyLum * 0.9, greyLum * 0.96).multiplyScalar(dark);
    const g = overcast * 0.85;
    ATMOS.uFogColor.value.lerp(_grey, g);
    ATMOS.uSunFogColor.value.lerp(ATMOS.uFogColor.value, overcast * 0.9);
    lerpC('zenith', U.uZenith.value).lerp(_grey, g * 0.9);
    lerpC('upper', U.uUpper.value).lerp(_grey, g * 0.9);
    lerpC('cloud', U.uCloud.value).multiplyScalar(dark * (1 - overcast * 0.25));
    lerpC('cloudLit', U.uCloudLit.value).lerp(U.uCloud.value, overcast * 0.8);
    // lightning brightens the haze too
    if (this.flash > 0) {
      _c.setRGB(0.5, 0.55, 0.8).multiplyScalar(this.flash * 0.6);
      ATMOS.uFogColor.value.add(_c);
    }
    U.uOvercast.value = overcast;
    U.uStars.value = lerpN('stars');
    U.uSunVis.value = 1 - overcast * 0.95;
    U.uFlash.value = this.flash;
    U.uHaze.value = w ? Math.min(0.92, Math.max(0, (w.fog - 0.002) / 0.009)) : 0;

    // sunlight by day, moonlight by night (the sun's own colour fades to 0 at the horizon)
    const sunI = lerpN('sunI') * (1 - overcast * 0.82) * dark;
    if (e > -0.03) {
      this.lightDir.copy(this.sunDir);
      lerpC('sun', this.sun.color);
      this.sun.intensity = sunI;
      lerpC('sun', U.uSunColor.value);
    } else {
      this.lightDir.copy(this.moonDir);
      this.sun.color.copy(MOON.color);
      this.sun.intensity = MOON.intensity * Math.min(1, (-0.03 - e) / 0.1) * (1 - overcast * 0.75);
    }
    lerpC('hemiSky', this.hemi.color).lerp(_grey, overcast * 0.6);
    lerpC('hemiGround', this.hemi.groundColor);
    this.hemi.intensity = lerpN('hemiI') * (1 - overcast * 0.12) * dark + this.flash * 2.2;
    if (this.renderer) this.renderer.toneMappingExposure = lerpN('exp');
    this.envLevel = (0.15 + 0.85 * day01) * (1 - overcast * 0.45);
  }

  update(dt, focus) {
    ATMOS.uTime.value += dt;
    this.skyMesh.position.copy(focus);
    // keep the shadow camera on the player, snapped to texels to avoid shimmer
    const snap = 140 / 2048;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).addScaledVector(this.lightDir, 300);
  }

  dispose() {
    this.envTarget.dispose();
    for (const o of [this.hemi, this.sun, this.sun.target, this.skyMesh]) {
      this.scene.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    }
  }
}
