import * as THREE from 'three';
import { ATMOS, textures } from '../rendering/materials.js';
import { hashString, mulberry32 } from '../generation/noise.js';

// The city's night: a sky that never gets light, glowing pink and amber at
// the horizon from the streets below, low cloud lit from underneath, and the
// lights and reflections to go with it. Same shape as the island's
// Environment, so the game can treat them alike.

// (written as screen colours; three converts them for the shaders)
const HAZE = new THREE.Color('#2a1532');      // street glow in the haze
const HAZE_HOT = new THREE.Color('#5a2140');  // toward the brightest part of the skyline
const ZENITH = new THREE.Color('#040309'), UPPER = new THREE.Color('#0d0a1f');

export class CityEnvironment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.shadows = false;       // night: no sun, no shadow map work
    this.sunDir = new THREE.Vector3(0, -1, 0);
    this.flash = 0;
    this.envLevel = 0.6;

    this.hemi = new THREE.HemisphereLight(0x8a78c8, 0x3a1c34, 1.0);
    this.sun = new THREE.DirectionalLight(0x9fb2ff, 0.35);   // moonlight, no shadows
    this.sun.position.set(-200, 400, 120);
    scene.add(this.hemi, this.sun);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uTime: ATMOS.uTime, uNoise: { value: textures().noise },
        uHaze: { value: HAZE.clone() }, uHot: { value: HAZE_HOT.clone() },
        uZenith: { value: ZENITH.clone() }, uUpper: { value: UPPER.clone() },
        uCloud: { value: 0.6 }, uFlash: { value: 0 }, uFog: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform sampler2D uNoise;
        uniform vec3 uHaze; uniform vec3 uHot; uniform vec3 uZenith; uniform vec3 uUpper;
        uniform float uCloud; uniform float uFlash; uniform float uFog;
        varying vec3 vDir;
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * texture2D(uNoise, p).r; p = p * 2.03 + 0.17; a *= 0.5; }
          return v;
        }
        void main() {
          vec3 d = normalize(vDir);
          // below the horizon you only ever see the sky through the wet
          // street, so show it mirrored, as a reflection would
          bool below = d.y < 0.0;
          d.y = abs(d.y);
          float h = d.y;
          // the horizon glows hotter toward the city centre's side of the sky
          float hot = 0.5 + 0.5 * sin(atan(d.z, d.x) * 2.0 + 0.6);
          vec3 horizon = mix(uHaze, uHot, hot * 0.6);
          vec3 col = mix(horizon, uUpper, smoothstep(0.0, 0.3, h));
          col = mix(col, uZenith, smoothstep(0.25, 0.85, h));
          if (d.y > 0.0) {
            // low cloud, lit from below by the streets: brightest near the horizon
            vec2 p = d.xz / (d.y + 0.08) * 0.09 + vec2(uTime * 0.0016, uTime * 0.0006);
            float n = fbm(p);
            float cover = smoothstep(0.5 - uCloud * 0.35, 0.78 - uCloud * 0.25, n);
            vec3 lit = mix(uHot * 1.25, uHaze * 0.7, smoothstep(0.0, 0.6, h));
            float fade = smoothstep(0.0, 0.12, d.y);
            col = mix(col, lit, cover * fade * 0.85);
          }
          col = mix(col, horizon, uFog);
          col += vec3(0.5, 0.52, 0.8) * uFlash * 0.9;
          if (below) col *= 0.5;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1;
    scene.add(this.skyMesh);

    // Reflection map: the night sky plus coloured light from every side, so
    // glossy paint picks up neon instead of a daylight sky.
    const envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), this.skyMat));
    const rand = mulberry32(hashString('city-env'));
    const cols = [0xff2e88, 0x22e5ff, 0xffb000, 0x9d5cff, 0xff4b2b, 0x4d7cff];
    for (let i = 0; i < 26; i++) {
      const a = rand() * Math.PI * 2, y = -4 + rand() * 18;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(3 + rand() * 6, 1 + rand() * 5), new THREE.MeshBasicMaterial({ color: cols[i % cols.length], side: THREE.DoubleSide }));
      m.position.set(Math.cos(a) * 40, y, Math.sin(a) * 40);
      m.lookAt(0, y, 0);
      envScene.add(m);
    }
    const ground = new THREE.Mesh(new THREE.CircleGeometry(48, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0810 }));
    ground.position.y = -2;
    envScene.add(ground);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envTarget = pmrem.fromScene(envScene, 0, 0.1, 200);
    this.envMap = this.envTarget.texture;
    pmrem.dispose();
    envScene.traverse((o) => { if (o.isMesh && o.material !== this.skyMat) { o.geometry.dispose(); o.material.dispose(); } });
  }

  // Haze, sky and light for the weather ({ overcast, fog, rain, storm }).
  setWeather(w) {
    const U = this.skyMat.uniforms;
    U.uCloud.value = 0.45 + w.overcast * 0.55;
    U.uFlash.value = this.flash;
    U.uFog.value = Math.min(0.9, Math.max(0, (w.fog - 0.002) / 0.009));
    // the haze glows with the street light; thicker air glows more
    const glow = 1 + w.rain * 0.25 + Math.min(1, w.fog / 0.008) * 0.35;
    ATMOS.uFogColor.value.copy(HAZE).multiplyScalar(glow);
    ATMOS.uSunFogColor.value.copy(HAZE_HOT).multiplyScalar(glow);
    ATMOS.uSunDir.value.set(0, -1, 0);   // no sun: keep the hot tint out of the haze
    if (this.flash > 0) ATMOS.uFogColor.value.addScalar(this.flash * 0.25);
    U.uHaze.value.copy(ATMOS.uFogColor.value);
    U.uHot.value.copy(HAZE_HOT).multiplyScalar(glow);
    this.hemi.intensity = 1.0 + this.flash * 2.2;
    if (this.renderer) this.renderer.toneMappingExposure = 1.15;
  }

  update(dt, focus) {
    ATMOS.uTime.value += dt;
    this.skyMesh.position.copy(focus);
  }

  dispose() {
    this.envTarget.dispose();
    for (const o of [this.hemi, this.sun, this.skyMesh]) {
      this.scene.remove(o);
      o.geometry?.dispose();
      o.material?.dispose();
    }
  }
}

// ---- weather ----------------------------------------------------------------------

// The city keeps its own weather, but on the shared world clock, so everyone
// in the city sees the same rain at the same time. Spells last five minutes
// and blend over the first minute. The streets are always a little wet.
const KINDS = {
  clear:   { label: 'Clear night', icon: '🌃', overcast: 0.35, fog: 0,      rain: 0,    storm: 0, wind: 0.15, wet: 0.55, odds: 30 },
  drizzle: { label: 'Drizzle',     icon: '🌦', overcast: 0.7,  fog: 0.0016, rain: 0.3,  storm: 0, wind: 0.2,  wet: 0.8,  odds: 25 },
  rain:    { label: 'Rain',        icon: '🌧', overcast: 0.85, fog: 0.0026, rain: 0.8,  storm: 0, wind: 0.4,  wet: 1,    odds: 22 },
  fog:     { label: 'Foggy',       icon: '🌫', overcast: 0.6,  fog: 0.0085, rain: 0,    storm: 0, wind: 0.05, wet: 0.7,  odds: 13 },
  storm:   { label: 'Thunderstorm', icon: '⛈', overcast: 1,   fog: 0.003,  rain: 1,    storm: 1, wind: 1,    wet: 1,    odds: 10 },
};
const SLOT = 6000, BLEND = 1200;   // ticks (5 min, 1 min)

export class CityWeather {
  constructor(seed, key) {
    this.key = hashString(String(seed) + ':city:' + key);
    this.events = [];
    this.lastTick = null;
    this.rand = mulberry32(this.key ^ 0xc17e);
  }

  kindAt(slot) {
    const r = mulberry32(this.key ^ Math.imul(slot + 7, 2654435761))();
    let x = r * 100;
    for (const k in KINDS) { x -= KINDS[k].odds; if (x < 0) return k; }
    return 'clear';
  }

  // Weather right now (tick from the shared clock), written into out.
  // calm: this player's "always sunny" setting, a clear night here.
  state(tick, out = {}, calm = false) {
    const slot = Math.floor(tick / SLOT), into = tick - slot * SLOT;
    const a = KINDS[calm ? 'clear' : this.kindAt(slot - 1)], b = KINDS[calm ? 'clear' : this.kindAt(slot)];
    const t = Math.min(1, into / BLEND), s = t * t * (3 - 2 * t);
    for (const k of ['overcast', 'fog', 'rain', 'storm', 'wind', 'wet']) out[k] = a[k] + (b[k] - a[k]) * s;
    out.snow = 0;
    out.cover = 0;
    out.day = 0.75;
    out.kind = calm ? 'clear' : this.kindAt(slot);
    out.label = b.icon + ' ' + b.label;
    // lightning, about every 7 s in a full storm
    if (this.lastTick != null && out.storm > 0.4) {
      const n = Math.min(40, Math.floor(tick) - Math.floor(this.lastTick));
      for (let i = 0; i < n; i++) {
        if (this.rand() < out.storm / 140) {
          const r = this.rand();
          this.events.push({ dist: r < 0.12 ? 120 + this.rand() * 250 : 400 + this.rand() * 2200, angle: this.rand() * Math.PI * 2, bolt: this.rand() < 0.75 });
        }
      }
    }
    this.lastTick = tick;
    return out;
  }
}
