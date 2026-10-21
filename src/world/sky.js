import * as THREE from 'three';
import { TIMES, WEATHER } from './settings.js';

// Lighting, sky dome, fog and precipitation for the chosen time/weather.
export class Environment {
  constructor(scene, settings) {
    this.scene = scene;
    const time = TIMES[settings.time];
    const weather = WEATHER[settings.weather];
    this.night = time.night;
    const grey = new THREE.Color(time.night ? 0x161a22 : 0x9aa2aa);
    const g = weather.grey || 0;
    const sky = new THREE.Color(time.sky).lerp(grey, g);
    const horizon = new THREE.Color(time.horizon).lerp(grey, g);

    scene.background = horizon.clone();
    scene.fog = new THREE.FogExp2(horizon.clone(), weather.fog);

    this.hemi = new THREE.HemisphereLight(sky, 0x554433, time.amb * (1 - g * 0.3));
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(time.sunColor, time.sunI * (1 - g * 0.6));
    const [sx, sy] = time.sun;
    this.sunDir = new THREE.Vector3(sx, sy, 0.4).normalize();
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const c = this.sun.shadow.camera;
    c.left = -60; c.right = 60; c.top = 60; c.bottom = -60; c.near = 1; c.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    // sky dome with vertical gradient and a sun/moon glow
    const skyGeo = new THREE.SphereGeometry(2500, 24, 12);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: sky }, bottom: { value: horizon },
        sunDir: { value: this.sunDir }, sunColor: { value: new THREE.Color(time.night ? 0xdde6ff : time.sunColor) },
        sunAmt: { value: g > 0.5 ? 0.15 : 1 },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunAmt; varying vec3 vDir;
        void main(){ float h = clamp(vDir.y*1.6, 0.0, 1.0); vec3 c = mix(bottom, top, pow(h, 0.7));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += sunColor * (pow(s, 900.0)*1.5 + pow(s, 12.0)*0.25) * sunAmt;
        gl_FragColor = vec4(c, 1.0); }`,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, this.skyMat);
    this.skyMesh.frustumCulled = false;
    this.skyMesh.renderOrder = -1;
    scene.add(this.skyMesh);

    if (time.night && !weather.precip && g < 0.5) this.addStars();
    if (weather.precip) this.addPrecip(weather.precip);
  }

  addStars() {
    const n = 1500, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection();
      v.y = Math.abs(v.y) * 0.9 + 0.05;
      v.normalize().multiplyScalar(2300);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false }));
    this.scene.add(this.stars);
  }

  addPrecip(kind) {
    this.precipKind = kind;
    const n = kind === 'rain' ? 5000 : 4000;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 80, Math.random() * 40, (Math.random() - 0.5) * 80], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      color: kind === 'rain' ? 0xaabbcc : 0xffffff,
      size: kind === 'rain' ? 0.06 : 0.11,
      transparent: true, opacity: kind === 'rain' ? 0.6 : 0.9, depthWrite: false,
    });
    this.precip = new THREE.Points(g, m);
    this.precip.frustumCulled = false;
    this.scene.add(this.precip);
  }

  update(dt, focus) {
    this.skyMesh.position.copy(focus);
    if (this.stars) this.stars.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 200);
    this.sun.target.position.copy(focus);
    if (this.precip) {
      const a = this.precip.geometry.attributes.position;
      const fall = this.precipKind === 'rain' ? 26 : 3;
      const t = performance.now() / 1000;
      for (let i = 0; i < a.count; i++) {
        let y = a.getY(i) - fall * dt;
        if (y < 0) y += 40;
        a.setY(i, y);
        if (this.precipKind === 'snow') a.setX(i, a.getX(i) + Math.sin(t + i) * 0.4 * dt);
      }
      a.needsUpdate = true;
      // keep the particle box centred on the player, wrapping horizontally
      this.precip.position.set(Math.round(focus.x / 80) * 80, focus.y - 10, Math.round(focus.z / 80) * 80);
      for (let i = 0; i < a.count; i++) {
        const wx = a.getX(i) + this.precip.position.x - focus.x;
        const wz = a.getZ(i) + this.precip.position.z - focus.z;
        if (wx > 40) a.setX(i, a.getX(i) - 80); else if (wx < -40) a.setX(i, a.getX(i) + 80);
        if (wz > 40) a.setZ(i, a.getZ(i) - 80); else if (wz < -40) a.setZ(i, a.getZ(i) + 80);
      }
    }
  }

  dispose() {
    for (const o of [this.hemi, this.sun, this.sun.target, this.skyMesh, this.stars, this.precip]) {
      if (!o) continue;
      this.scene.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    this.scene.fog = null;
  }
}
