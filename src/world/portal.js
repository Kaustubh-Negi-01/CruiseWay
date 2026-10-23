import * as THREE from 'three';
import { ATMOS } from './rendering/materials.js';
import { glowTexture } from '../vehicle/bike.js';
import { KIND_DIRT, ROAD_STEP } from './generation/network.js';

// The portals between the island and the neon city: a glowing arch across
// the road with a swirling surface. Ride through it either way to travel.
// Each side's swirl is tinted like the place it leads to.

export const PORTAL_LOOK = {
  island: { ring: 0xff2e88, swirl: [0xff2e88, 0x22e5ff, 0x9d5cff], label: 'NEON CITY', sub: 'ride through' },
  city: { ring: 0x7dff9a, swirl: [0x7dff9a, 0xffd36a, 0x3fb4ff], label: 'THE ISLAND', sub: 'ride through' },
};

// Where the island's portal stands: on a straight, level stretch of paved
// road a few hundred metres from where new riders start, away from the
// race spots. Same seed, same place, for everyone.
export function islandPortalSpot(world, home) {
  const net = world.net;
  let best = null;
  const tryEdges = (dMin, dMax, straight) => {
    for (const e of net.edges) {
      if (e.kind === KIND_DIRT) continue;
      const m = Math.ceil(45 / ROAD_STEP);
      for (let i = m; i < e.n - m; i += 3) {
        const x = e.x[i], z = e.z[i];
        const d = Math.hypot(x - home.x, z - home.z);
        if (d < dMin || d > dMax) continue;
        const a = i - 8, b = i + 8;
        if (a < 0 || b >= e.n) continue;
        if (e.tx[a] * e.tx[b] + e.tz[a] * e.tz[b] < straight) continue;
        if (Math.abs(e.y[b] - e.y[a]) > 1.8) continue;
        if (world.spots.some((s) => { const p = s.route.at(s.startS); return Math.hypot(p.x - x, p.z - z) < 70; })) continue;
        const score = Math.abs(d - 320);
        if (!best || score < best.score) best = { score, x, y: e.y[i], z, tx: e.tx[i], tz: e.tz[i] };
      }
    }
  };
  tryEdges(180, 650, 0.985);
  if (!best) tryEdges(60, 3000, 0.95);
  if (!best) { const e = net.edges[0]; const p = net.pointOnEdge(e, e.length / 2); best = { x: p.x, y: p.y, z: p.z, tx: p.tx, tz: p.tz }; }
  return { x: best.x, y: best.y, z: best.z, tx: best.tx, tz: best.tz, r: 6 };
}

export class Portal {
  // p: { x, y, z, tx, tz, r }, look: PORTAL_LOOK entry
  constructor(scene, p, look) {
    this.p = p;
    this.scene = scene;
    const g = (this.group = new THREE.Group());
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(p.tx, p.tz);   // local +z = the way through
    const r = p.r, hc = r * 0.6;            // arch centre height: the feet land just off the road
    // the arch: a ring with its bottom cut off at the road
    const foot = Math.asin(Math.min(1, hc / r));
    const arc = Math.PI + 2 * foot;
    const ringGeo = new THREE.TorusGeometry(r, 0.32, 10, 120, arc).rotateZ(-foot);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(look.ring).multiplyScalar(1.8), toneMapped: false }));
    this.ring.position.y = hc;
    const haloGeo = new THREE.TorusGeometry(r, 1.1, 8, 120, arc).rotateZ(-foot);
    this.halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: look.ring, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.halo.position.y = hc;
    // the swirling surface (clipped at the road in the shader)
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        uTime: ATMOS.uTime, uGround: { value: p.y + 0.02 },
        uA: { value: new THREE.Color(look.swirl[0]) }, uB: { value: new THREE.Color(look.swirl[1]) }, uC: { value: new THREE.Color(look.swirl[2]) },
        uPulse: { value: 0 },
      },
      vertexShader: /* glsl */`
        varying vec2 vP; varying float vY;
        void main() {
          vP = position.xy / ${r.toFixed(2)};
          vec4 w = modelMatrix * vec4(position, 1.0);
          vY = w.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uGround; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC; uniform float uPulse;
        varying vec2 vP; varying float vY;
        void main() {
          if (vY < uGround) discard;
          float r = length(vP), a = atan(vP.y, vP.x);
          float swirl = a * 3.0 + r * 9.0 - uTime * 2.2;
          float bands = 0.5 + 0.5 * sin(swirl) * sin(a * 2.0 - r * 5.0 + uTime * 1.3);
          vec3 col = mix(mix(uA, uB, 0.5 + 0.5 * sin(swirl * 0.5)), uC, smoothstep(0.2, 1.0, r) * bands);
          float core = smoothstep(1.0, 0.0, r);
          float edge = smoothstep(0.75, 0.98, r) * (1.0 - smoothstep(0.98, 1.0, r));
          float alpha = (0.18 + bands * 0.35) * core + edge * 0.9 + uPulse * 0.4 * core;
          alpha *= 1.0 - smoothstep(0.97, 1.0, r);
          gl_FragColor = vec4(col * alpha * 1.4, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.99, 64), this.mat);
    this.disc.position.y = hc;
    // a beam so you can find it from far away, and its light on the road
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 1.4, 220, 16, 1, true).translate(0, 110 + hc + r, 0),
      new THREE.MeshBasicMaterial({ color: look.ring, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.pool = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2.4, r * 2.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: look.ring, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.pool.position.y = 0.06;
    this.label = label(look);
    this.label.position.y = hc + r + 3.2;
    g.add(this.ring, this.halo, this.disc, this.beam, this.pool, this.label);
    for (const o of [this.disc, this.halo, this.beam, this.pool]) o.renderOrder = 5;
    scene.add(g);
    this.pulse = 0;
  }

  // a flash as someone goes through
  flash() { this.pulse = 1; }

  update(dt, camPos) {
    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    this.mat.uniforms.uPulse.value = this.pulse;
    const d = Math.hypot(camPos.x - this.p.x, camPos.z - this.p.z);
    // the beam fades out as you arrive, so it never fills the screen
    this.beam.material.opacity = 0.25 * Math.min(1, Math.max(0, (d - 30) / 150));
    this.label.visible = d < 420;
    this.halo.material.opacity = 0.16 + 0.06 * Math.sin(ATMOS.uTime.value * 3);
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (!o.isMesh && !o.isSprite) return;
      o.geometry?.dispose();
      if (o.material.map && o.material.map !== glowTexture()) o.material.map.dispose();
      o.material.dispose();
    });
  }
}

function label(look) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const c = cv.getContext('2d');
  const col = '#' + new THREE.Color(look.ring).getHexString();
  c.fillStyle = 'rgba(10,8,18,0.72)';
  c.beginPath(); c.roundRect(16, 16, 480, 128, 24); c.fill();
  c.strokeStyle = col; c.lineWidth = 4; c.stroke();
  c.textAlign = 'center';
  c.fillStyle = '#fff';
  c.shadowColor = col; c.shadowBlur = 18;
  c.font = '800 54px system-ui, sans-serif';
  c.fillText(look.label, 256, 84);
  c.shadowBlur = 0;
  c.font = '500 28px system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fillText(look.sub, 256, 124);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sp.scale.set(12, 3.75, 1);
  sp.renderOrder = 20;
  return sp;
}
