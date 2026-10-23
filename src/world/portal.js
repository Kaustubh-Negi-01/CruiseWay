import * as THREE from 'three';
import { ATMOS } from './rendering/materials.js';
import { glowTexture } from '../vehicle/bike.js';
import { KIND_DIRT, ROAD_STEP } from './generation/network.js';
import { CITY_NAME } from './city/cityGen.js';

// The portals between the island and Hikari: a huge ring of crackling energy
// with a swirling vortex, standing across the road. Ride through it either
// way to travel. The look is a looping video (public/video/portal.mp4, cut
// down from the project owner's clip to 512 px and 0.75 MB) drawn with
// additive blending, so its black background vanishes. Until the video is
// playing (or on a phone that won't autoplay it) a drawn swirl stands in.

export const PORTAL_LOOK = {
  island: { glow: 0x22e5ff, label: CITY_NAME.toUpperCase(), sub: '光 · ride through' },
  city: { glow: 0x22e5ff, label: 'THE ISLAND', sub: 'ride through' },
};

// The island's portals stand at its two ends, east and west: on the
// farthest straight, level stretch of road each way, away from the race
// spots. Same seed, same places, for everyone. Each faces back inland, the
// way you leave when you arrive.
export function islandPortalSpots(world) {
  const net = world.net, out = [];
  const nearSpot = (x, z) => world.spots.some((s) => { const p = s.route.at(s.startS); return Math.hypot(p.x - x, p.z - z) < 80; });
  for (const dir of [1, -1]) {
    let best = null;
    for (const e of net.edges) {
      const m = Math.ceil(35 / ROAD_STEP);
      for (let i = m; i < e.n - m; i += 2) {
        const a = i - 7, b = i + 7;
        if (a < 0 || b >= e.n) continue;
        if (e.tx[a] * e.tx[b] + e.tz[a] * e.tz[b] < 0.97) continue;
        if (Math.abs(e.y[b] - e.y[a]) > 2.2 || e.y[i] < 2) continue;
        const x = e.x[i], z = e.z[i];
        if (nearSpot(x, z)) continue;
        // as far toward this end as possible; a paved road wins if it's nearly as far
        const score = x * dir - (e.kind === KIND_DIRT ? 120 : 0);
        if (!best || score > best.score) best = { score, x, y: e.y[i], z, tx: e.tx[i], tz: e.tz[i] };
      }
    }
    if (!best) { const e = net.edges[0]; const p = net.pointOnEdge(e, e.length / 2); best = { x: p.x, y: p.y, z: p.z, tx: p.tx, tz: p.tz }; }
    // arrive heading back toward the middle of the island
    let { tx, tz } = best;
    if (tx * -best.x + tz * -best.z < 0) { tx = -tx; tz = -tz; }
    out.push({ x: best.x, y: best.y, z: best.z, tx, tz, r: 14, end: dir > 0 ? 'east' : 'west' });
  }
  return out;
}

// ---- the shared video ---------------------------------------------------------------

let VIDEO = null, VTEX = null, want = false;
function portalVideo() {
  if (VTEX) return VTEX;
  const v = (VIDEO = document.createElement('video'));
  v.src = '/video/portal.mp4';
  v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
  v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
  VTEX = new THREE.VideoTexture(v);
  VTEX.colorSpace = THREE.SRGBColorSpace;
  // some phones only start a video after a tap: try again on the next one
  const retry = () => { if (want && v.paused) v.play().catch(() => {}); };
  for (const ev of ['pointerdown', 'keydown', 'touchend']) addEventListener(ev, retry, { passive: true });
  return VTEX;
}

// Play the video only while a portal is close enough to see (it costs a
// little to decode, so it rests the rest of the time).
export function portalVideoActive(on) {
  if (!VIDEO || on === want) return;
  want = on;
  if (on) VIDEO.play().catch(() => {});
  else VIDEO.pause();
}
const videoLive = () => !!VIDEO && !VIDEO.paused && VIDEO.readyState >= 2;

export class Portal {
  // p: { x, y, z, tx, tz, r }, look: PORTAL_LOOK entry
  constructor(scene, p, look) {
    this.p = p;
    this.scene = scene;
    const g = (this.group = new THREE.Group());
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = Math.atan2(p.tx, p.tz);   // local +z = the way through
    const r = p.r, hc = r * 0.9;            // ring centre: its bottom sinks just under the road
    const ground = p.y + 0.03;

    // the video: the ring sits about 0.43 of the frame out from the centre
    const S = r * 2.33;
    // brightness becomes opacity, so the black background vanishes and the
    // vortex keeps its detail even against a bright daytime sky
    this.vmat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uVid: { value: portalVideo() }, uGround: { value: ground }, uPulse: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vUv; varying float vY;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vY = w.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uVid; uniform float uGround; uniform float uPulse;
        varying vec2 vUv; varying float vY;
        void main() {
          if (vY < uGround) discard;
          vec3 c = max(texture2D(uVid, vUv).rgb - 0.035, 0.0) * 1.1;   // the near-black background disappears
          float a = clamp(max(c.r, max(c.g, c.b)) * 1.5 + uPulse * 0.3, 0.0, 1.0);
          gl_FragColor = vec4(c / max(a, 0.001) * (1.0 + uPulse * 0.6), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.video = new THREE.Mesh(new THREE.PlaneGeometry(S, S), this.vmat);
    this.video.position.y = hc;
    this.video.visible = false;

    // stand-in until the video plays: a cyan ring and a drawn swirl
    this.fallback = new THREE.Group();
    const foot = Math.asin(Math.min(1, hc / r)), arc = Math.PI + 2 * foot;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.45, 10, 140, arc).rotateZ(-foot), new THREE.MeshBasicMaterial({ color: new THREE.Color(look.glow).multiplyScalar(1.8), toneMapped: false }));
    ring.position.y = hc;
    this.smat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uTime: ATMOS.uTime, uGround: { value: ground }, uPulse: { value: 0 } },
      vertexShader: /* glsl */`
        varying vec2 vP; varying float vY;
        void main() {
          vP = position.xy / ${r.toFixed(2)};
          vec4 w = modelMatrix * vec4(position, 1.0);
          vY = w.y;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform float uTime; uniform float uGround; uniform float uPulse;
        varying vec2 vP; varying float vY;
        void main() {
          if (vY < uGround) discard;
          float r = length(vP), a = atan(vP.y, vP.x);
          float swirl = a * 3.0 + r * 9.0 - uTime * 2.2;
          float bands = 0.5 + 0.5 * sin(swirl) * sin(a * 2.0 - r * 5.0 + uTime * 1.3);
          vec3 col = mix(vec3(0.75, 0.95, 1.0), vec3(0.13, 0.9, 1.0), smoothstep(0.1, 1.0, r) * bands);
          float alpha = (0.2 + bands * 0.4) * smoothstep(1.0, 0.0, r) + uPulse * 0.4;
          alpha *= 1.0 - smoothstep(0.96, 1.0, r);
          gl_FragColor = vec4(col * alpha * 1.3, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 64), this.smat);
    disc.position.y = hc;
    this.fallback.add(ring, disc);

    // a beam so you can find it from far away, and its glow on the road
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2, 2, 300, 16, 1, true).translate(0, 150 + hc + r, 0),
      new THREE.MeshBasicMaterial({ color: look.glow, transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.pool = new THREE.Mesh(
      new THREE.PlaneGeometry(r * 2.4, r * 2.4).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: look.glow, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.pool.position.y = 0.06;
    this.label = label(look);
    this.label.position.y = hc + r * 1.15 + 4;
    g.add(this.video, this.fallback, this.beam, this.pool, this.label);
    for (const o of [this.video, disc, this.beam, this.pool]) o.renderOrder = 5;
    scene.add(g);
    this.pulse = 0;
  }

  // a flash as someone goes through
  flash() { this.pulse = 1; }

  // Returns the distance from the camera, so the game can wake the video.
  update(dt, camPos) {
    this.pulse = Math.max(0, this.pulse - dt * 1.5);
    this.vmat.uniforms.uPulse.value = this.smat.uniforms.uPulse.value = this.pulse;
    const live = videoLive();
    this.video.visible = live;
    this.fallback.visible = !live;
    const d = Math.hypot(camPos.x - this.p.x, camPos.z - this.p.z);
    // the beam fades out as you arrive, so it never fills the screen
    this.beam.material.opacity = 0.25 * Math.min(1, Math.max(0, (d - 40) / 160));
    this.label.visible = d < 600;
    return d;
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
  const col = '#' + new THREE.Color(look.glow).getHexString();
  c.fillStyle = 'rgba(6,10,20,0.72)';
  c.beginPath(); c.roundRect(16, 16, 480, 128, 24); c.fill();
  c.strokeStyle = col; c.lineWidth = 4; c.stroke();
  c.textAlign = 'center';
  c.fillStyle = '#fff';
  c.shadowColor = col; c.shadowBlur = 18;
  c.font = '800 56px system-ui, sans-serif';
  c.fillText(look.label, 256, 84);
  c.shadowBlur = 0;
  c.font = '500 28px "Hiragino Sans","Yu Gothic UI","Meiryo","Noto Sans JP",system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.8)';
  c.fillText(look.sub, 256, 124);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false }));
  sp.scale.set(16, 5, 1);
  sp.renderOrder = 20;
  return sp;
}
