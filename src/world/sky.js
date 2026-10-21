import * as THREE from 'three';
import { ATMOS, raw, textures } from './materials.js';

// Golden-hour lighting and a sky dome with drifting clouds. The dome's
// horizon uses the same haze function as the terrain so they meet cleanly.
export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    scene.background = null;
    scene.fog = null;
    const sunDir = ATMOS.uSunDir.value;

    this.hemi = new THREE.HemisphereLight(0xa9bfe0, 0x5a4a2c, 1.15);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffc595, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 1; c.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    this.sunOffset = sunDir.clone().multiplyScalar(300);
    scene.add(this.sun, this.sun.target);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        ...ATMOS,
        uZenith: { value: raw(0x4f7fb4) },
        uUpper: { value: raw(0x9ab3c9) },
        uNoise: { value: textures().noise },
        uSunColor: { value: raw(0xfff0d0) },
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
        varying vec3 vDir;
        float fbm(vec2 p) {
          float v = 0.0, a = 0.5;
          for (int i = 0; i < 4; i++) { v += a * texture2D(uNoise, p).r; p = p * 2.03 + 0.17; a *= 0.5; }
          return v;
        }
        void main() {
          vec3 d = normalize(vDir);
          float s = max(dot(d, uSunDir), 0.0);
          vec3 horizon = mix(uFogColor, uSunFogColor, pow(s, 5.0) * 0.9);
          float h = max(d.y, 0.0);
          vec3 col = mix(horizon, uUpper, smoothstep(0.0, 0.25, h));
          col = mix(col, uZenith, smoothstep(0.18, 0.75, h));
          // warm glow that wraps around the sun near the horizon
          col += uSunFogColor * pow(s, 3.0) * 0.35 * (1.0 - smoothstep(0.0, 0.5, h));
          // clouds on a flat layer, thinning toward the horizon haze
          if (d.y > 0.0) {
            vec2 p = d.xz / (d.y + 0.12) * 0.11 + vec2(uTime * 0.0012, uTime * 0.0004);
            float n = fbm(p);
            float cover = smoothstep(0.47, 0.72, n);
            float lit = pow(s, 2.0);
            vec3 cloud = mix(vec3(0.62, 0.58, 0.62), vec3(1.0, 0.78, 0.6), 0.35 + lit * 0.65);
            cloud = mix(cloud, horizon, 0.35);
            float fade = smoothstep(0.02, 0.22, d.y);
            col = mix(col, cloud, cover * fade * 0.85);
          }
          col += uSunColor * (smoothstep(0.9993, 0.9997, s) * 2.0 + pow(s, 400.0) * 0.6);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1;
    scene.add(this.skyMesh);

    // Reflection map of this sky (plus a dark land disc below the horizon) for
    // the chrome bike and the water.
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

  update(dt, focus) {
    ATMOS.uTime.value += dt;
    this.skyMesh.position.copy(focus);
    // keep the shadow camera on the player, snapped to texels to avoid shimmer
    const snap = 140 / 2048;
    const fx = Math.round(focus.x / snap) * snap, fz = Math.round(focus.z / snap) * snap;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx, focus.y, fz).add(this.sunOffset);
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
