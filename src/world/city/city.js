import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ATMOS, HAZE_PARS, HAZE_FRAG, patch, textures } from '../rendering/materials.js';
import { makeSpotBeacons } from '../rendering/world.js';
import { glowTexture } from '../../vehicle/bike.js';
import { CityLayout, CITY, NEON, K } from './cityGen.js';
import { signAtlas, artRect, ART_COLOR } from './signs.js';
import { paintCityMap } from './cityMap.js';

// Hikari, the neon city: always night, always a little wet.
//
// Built once from the layout in cityGen.js, in a handful of draw calls:
//  - buildings: plain boxes in tiles; a shader draws every window, shop
//    front, warehouse door and tower crown (no textures), so a whole tile is
//    one draw call;
//  - streets: one quad per street and per crossing, whose shader paints the
//    markings from what each quad knows (its width, length and kind); the
//    Loop's edges glow cyan and the ring road's purple. The tarmac is very
//    slightly see-through, and under it a mirrored copy of the signs (and of
//    the buildings, on the higher presets) makes faint wet reflections;
//  - signs: one mesh using a single atlas (signs.js), with flicker and LED
//    screens done in the shader; soft additive quads fake their glow and the
//    coloured light they throw on the street (no real lights: they cost too
//    much per pixel);
//  - street lights, vending machines and harbour containers: instanced.
//
// It answers the same questions as the island's World (heightAt, net,
// spots, update...), so the game and the physics don't care which one they're in.

const TILE = 280;
const _c = new THREE.Color();

export class City {
  constructor(scene, seed, layout = new CityLayout(seed)) {
    this.scene = scene;
    this.seed = seed;
    const L = (this.layout = layout);
    this.net = L.net;
    this.spots = L.spots;
    this.portal = L.portal;
    this.portals = L.portals;
    this.extent = CITY.extent;
    this.gripScale = 1;
    this.gen = { trunksNear: (x, z, out) => L.trunksNear(x, z, out) };
    this.group = new THREE.Group();
    scene.add(this.group);
    this.uRefl = { value: 1 };
    this.uWetC = { value: 0.7 };
    this.mirrors = [];
    this.fogBase = 0.0009;
    this.weatherFog = 0;
  }

  // Makes the meshes a piece at a time (each yield is a good moment to let
  // a frame through), so building the city never stalls the ride.
  *build() {
    yield* this.buildBuildings();
    this.buildStreets();
    this.buildBlocks();
    yield;
    this.buildSigns();
    yield;
    this.buildLamps();
    yield;
    yield* this.buildGlows();
    yield;
    this.buildVending();
    this.buildContainers();
    this.buildBay();
    this.beacons = makeSpotBeacons(this.spots);
    this.scene.add(this.beacons);
    yield;
    this.mapCanvas = paintCityMap(this.layout);
  }

  // ---- queries (same as the island's World) ----------------------------------------

  heightAt(x, z) { return this.layout.heightAt(x, z); }
  normalAt(x, z, out = new THREE.Vector3()) { return out.set(0, 1, 0); }
  surfaceAt() { return 1; }
  readyAt() { return true; }
  boxesNear(x, z, out) { return this.layout.boxesNear(x, z, out); }
  onMapReady(fn) { fn(this.mapCanvas); }

  // First point (0..1) where the segment a->b enters a building, for the
  // chase camera; 1 if it's clear.
  rayBlock(ax, az, bx, bz) {
    const list = this.layout.boxesNear((ax + bx) / 2, (az + bz) / 2, this.rayBuf || (this.rayBuf = []));
    let best = 1;
    const dx = bx - ax, dz = bz - az;
    for (const b of list) {
      let t0 = 0, t1 = 1;
      for (const [p, d, lo, hi] of [[ax, dx, b[0] - 0.3, b[2] + 0.3], [az, dz, b[1] - 0.3, b[3] + 0.3]]) {
        if (Math.abs(d) < 1e-6) { if (p < lo || p > hi) { t0 = 2; break; } continue; }
        let a = (lo - p) / d, c = (hi - p) / d;
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      }
      if (t0 <= t1 && t0 < best) best = t0;
    }
    return best;
  }

  // ---- per frame ---------------------------------------------------------------------

  // race spot beacons: hidden for the spot you're racing, faded as you arrive
  update(focus, hideSpot = -1) {
    if (!this.beacons) return;
    for (const b of this.beacons.children) {
      const d = Math.hypot(b.position.x - focus.x, b.position.z - focus.z);
      b.visible = d < 2600 && b.userData.spot !== hideSpot;
      if (b.userData.label) b.userData.label.visible = d < 350;
      b.userData.beam.material.opacity = 0.28 * Math.min(1, Math.max(0, (d - 25) / 120));
    }
  }

  setDetail({ view, reflect = 2 }) {
    this.fogBase = 0.0055 / Math.max(3, view);
    ATMOS.uFogDensity.value = Math.max(this.fogBase, this.weatherFog);
    this.reflect = reflect;
    for (const m of this.mirrors) m.visible = reflect >= (m.userData.level || 1);
    this.uRefl.value = reflect > 0 ? 1 : 0;
  }

  setWeatherFog(d) {
    this.weatherFog = d;
    ATMOS.uFogDensity.value = Math.max(this.fogBase, d);
  }

  setWet(wet) {
    this.uWetC.value = wet;
    // light pools shine harder on a wet street
    if (this.pools) this.pools.material.uniforms.uGain.value = 0.5 + wet * 0.45;
  }

  // ---- buildings -------------------------------------------------------------------

  *buildBuildings() {
    const mat = buildingMaterial(false), mirrorMat = buildingMaterial(true);
    this.mats = [mat, mirrorMat];
    const tiles = new Map();
    for (const b of this.layout.buildings) {
      const cx = (b.box[0] + b.box[2]) / 2, cz = (b.box[1] + b.box[3]) / 2;
      const k = Math.floor((cx + 800) / TILE) * 100 + Math.floor((cz + 800) / TILE);
      if (!tiles.has(k)) tiles.set(k, []);
      tiles.get(k).push(b);
    }
    let n = 0;
    for (const list of tiles.values()) {
      if (++n % 4 === 0) yield;
      const g = boxes(list);
      const m = new THREE.Mesh(g, mat);
      this.group.add(m);
      const mm = new THREE.Mesh(g, mirrorMat);
      mm.scale.y = -1;
      mm.renderOrder = 1;          // after the real city, so hidden parts fail the depth test early
      mm.userData.level = 2;
      this.mirrors.push(mm);
      this.group.add(mm);
    }
    const far = new THREE.Mesh(boxes(this.layout.skyline), mat);
    this.group.add(far);
  }

  // ---- streets ---------------------------------------------------------------------

  // One quad per street between two crossings and one per crossing, each
  // carrying what the shader needs to paint it: across/along position, half
  // width and length (aR), and the street's kind plus which side traffic
  // keeps to (aK). No loops in the shader, so it's cheap.
  buildStreets() {
    const L = this.layout;
    const P = [], R = [], KK = [];
    const put = (corners, attrs, kind, lane) => {
      for (const i of [0, 1, 2, 0, 2, 3]) {
        P.push(corners[i][0], 0, corners[i][1]);
        R.push(...attrs[i]);
        KK.push(kind, lane);
      }
    };
    for (const s of L.segs) {
      const a = L.nodes[s.a], b = L.nodes[s.b], hw = s.hw;
      if (s.axis === 'z') {
        const z0 = a.z + a.hz, z1 = b.z - b.hz, x = s.ax, len = z1 - z0;
        if (len <= 0) continue;
        put([[x - hw, z0], [x - hw, z1], [x + hw, z1], [x + hw, z0]], [[-hw, 0, hw, len], [-hw, len, hw, len], [hw, len, hw, len], [hw, 0, hw, len]], s.kind, 1);
      } else {
        const x0 = a.x + a.hx, x1 = b.x - b.hx, z = s.az, len = x1 - x0;
        if (len <= 0) continue;
        put([[x0, z - hw], [x0, z + hw], [x1, z + hw], [x1, z - hw]], [[-hw, 0, hw, len], [hw, 0, hw, len], [hw, len, hw, len], [-hw, len, hw, len]], s.kind, -1);
      }
    }
    for (const n of L.nodes) {
      const { x, z, hx, hz } = n;
      put([[x - hx, z - hz], [x - hx, z + hz], [x + hx, z + hz], [x + hx, z - hz]], [[-hx, -hz, hx, hz], [-hx, hz, hx, hz], [hx, hz, hx, hz], [hx, -hz, hx, hz]], n.scramble ? K.scramble : K.junction, 0);
    }
    const zero = [0, 0, 0, 0];
    for (const [x0, z0, x1, z1] of L.alleys) put([[x0, z0], [x0, z1], [x1, z1], [x1, z0]], [zero, zero, zero, zero], K.alley, 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('aR', new THREE.Float32BufferAttribute(R, 4));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(KK, 2));
    g.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: true,
      uniforms: { ...ATMOS, uNoise: { value: textures().noise }, uRefl: this.uRefl, uWetC: this.uWetC },
      vertexShader: /* glsl */`
        attribute vec4 aR; attribute vec2 aK;
        varying vec3 vWPos; varying vec4 vR; varying vec2 vK;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWPos = w.xyz; vR = aR; vK = aK;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        ${HAZE_PARS}
        uniform sampler2D uNoise; uniform float uRefl; uniform float uWetC;
        varying vec4 vR; varying vec2 vK;
        float stripe(float x, float w) { float aa = fwidth(x) * 1.2; return smoothstep(w + aa, w - aa, abs(x)); }
        void main() {
          vec2 w = vWPos.xz;
          float n1 = texture2D(uNoise, w / 9.0).r, n2 = texture2D(uNoise, w / 1.7).g;
          vec3 col = vec3(0.075, 0.075, 0.084) * (0.8 + n1 * 0.4) * (0.85 + n2 * 0.3);
          float kind = vK.x;
          float mark = 0.0;
          vec3 paint = vec3(0.86, 0.86, 0.83);
          vec3 glow = vec3(0.0);
          if (kind < 4.5) {
            // a street between two crossings
            float u = vR.x, v = vR.y, hw = vR.z, len = vR.w;
            float toEnd = min(v, len - v);
            float ahead = v > len * 0.5 ? 1.0 : -1.0;
            // zebra crossing at each end, then a stop line across the lane coming in (traffic keeps left)
            float zebra = step(0.6, toEnd) * step(toEnd, 4.6) * step(0.5, fract(u / 1.1 + 0.25)) * step(abs(u), hw - 0.7);
            float stopL = step(5.2, toEnd) * step(toEnd, 5.6) * step(0.0, u * vK.y * ahead) * step(abs(u), hw - 0.7);
            float dash = step(fract(v / 8.0), 0.5);
            bool wide = hw > 8.5;
            float centre = wide ? stripe(abs(u) - 0.18, 0.08) : stripe(u, 0.08) * dash;
            float lanes = wide ? stripe(abs(abs(u) - hw * 0.5), 0.07) * dash : 0.0;
            float edge = stripe(abs(u) - (hw - 0.55), 0.07);
            mark = max(max(zebra, stopL), (max(centre, lanes) + edge) * step(5.6, toEnd));
            if (wide && abs(u) < 0.45 && toEnd > 5.6) paint = vec3(0.95, 0.72, 0.2);
            // the Loop glows cyan along both edges, the ring road purple
            float rim = stripe(abs(u) - (hw - 0.22), 0.11);
            if (kind > 1.5 && kind < 2.5) glow = vec3(0.1, 0.85, 1.0) * rim * 2.4;
            if (kind > 2.5 && kind < 3.5) glow = vec3(0.62, 0.3, 1.0) * rim * 2.2;
          } else if (kind > 6.5) {
            // the scramble crossing: zebras on the diagonals too
            vec2 q = vR.xy;
            float lim = min(vR.z, vR.w) * 1.3;
            float d1 = abs(q.x - q.y) * 0.7071, d2 = abs(q.x + q.y) * 0.7071;
            float a1 = (q.x + q.y) * 0.7071, a2 = (q.x - q.y) * 0.7071;
            mark = max(step(d1, 2.4) * step(0.5, fract(a1 / 1.1)) * step(abs(a1), lim),
                       step(d2, 2.4) * step(0.5, fract(a2 / 1.1)) * step(abs(a2), lim));
          }
          mark *= 0.75 + n2 * 0.25;
          col = mix(col, paint * 0.5, mark);
          col *= 1.0 - uWetC * 0.22;
          col += glow;
          // wet asphalt: just a hint of the mirrored street below, mostly at a glance
          vec3 V = normalize(vWPos - cameraPosition);
          float fres = pow(1.0 - clamp(-V.y, 0.0, 1.0), 4.0);
          float puddle = smoothstep(0.5, 0.72, texture2D(uNoise, w / 13.0).r);
          float refl = uRefl * uWetC * (0.04 + 0.2 * fres) * (0.45 + 0.55 * puddle) * (1.0 - mark * 0.7) * (1.0 - min(1.0, length(glow)));
          gl_FragColor = vec4(col, 1.0 - clamp(refl, 0.0, 0.28));
          ${HAZE_FRAG}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const road = new THREE.Mesh(g, mat);
    road.renderOrder = 2;
    this.group.add(road);
    this.road = road;
    this.buildEdgeLights();
  }

  // Light strips along the kerbs of the Loop (cyan) and the ring road
  // (purple): follow the colour and you know where you are.
  buildEdgeLights() {
    const L = this.layout, k = CITY.kerb;
    const parts = { [K.loop]: [], [K.ring]: [] };
    for (const s of L.segs) {
      if (!parts[s.kind]) continue;
      const a = L.nodes[s.a], b = L.nodes[s.b];
      for (const side of [-1, 1]) {
        if (s.axis === 'z') {
          const z0 = a.z + a.hz, z1 = b.z - b.hz;
          if (z1 > z0) parts[s.kind].push(new THREE.BoxGeometry(0.06, 0.05, z1 - z0).translate(s.ax + side * (s.hw + 0.02), k - 0.035, (z0 + z1) / 2));
        } else {
          const x0 = a.x + a.hx, x1 = b.x - b.hx;
          if (x1 > x0) parts[s.kind].push(new THREE.BoxGeometry(x1 - x0, 0.05, 0.06).translate((x0 + x1) / 2, k - 0.035, s.az + side * (s.hw + 0.02)));
        }
      }
    }
    for (const [kind, col] of [[K.loop, 0x22e5ff], [K.ring, 0xa24dff]]) {
      if (!parts[kind].length) continue;
      const m = new THREE.Mesh(mergeGeometries(parts[kind]), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(2.2), toneMapped: false }));
      this.group.add(m);
    }
  }

  // Raised blocks (sidewalks and the ground under the buildings), the
  // promenade along the seawall, and the wall itself.
  buildBlocks() {
    const L = this.layout, k = CITY.kerb, geos = [];
    for (const b of L.blocks) geos.push(...slab(b.x0, b.z0, b.x1, b.z1, -0.02, k));
    for (const [x0, z0, x1, z1] of L.promenade) geos.push(...slab(x0, z0, x1, z1, -0.02, k));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...ATMOS, uNoise: { value: textures().noise }, uWetC: this.uWetC },
      vertexShader: WORLD_VERT_N,
      fragmentShader: /* glsl */`
        ${HAZE_PARS}
        uniform sampler2D uNoise; uniform float uWetC;
        varying vec3 vN;
        void main() {
          vec2 w = vWPos.xz;
          float n = texture2D(uNoise, w / 7.0).r;
          vec3 col;
          if (vN.y > 0.5) {
            // paving slabs
            vec2 g = abs(fract(w / 0.9) - 0.5);
            float aa = fwidth(w.x / 0.9) * 1.5;
            float grout = 1.0 - smoothstep(0.44 - aa, 0.5, max(g.x, g.y)) * 0.35;
            float tone = 0.9 + 0.2 * fract(sin(dot(floor(w / 0.9), vec2(12.9898, 78.233))) * 43758.5);
            col = vec3(0.075, 0.072, 0.08) * tone * grout * (0.85 + n * 0.3);
            // wet sheen of the glowing haze
            vec3 V = normalize(vWPos - cameraPosition);
            float fres = pow(1.0 - clamp(-V.y, 0.0, 1.0), 5.0);
            col = mix(col * (1.0 - uWetC * 0.3), uFogColor * 0.9, fres * uWetC * 0.4);
          } else {
            col = vec3(0.11, 0.105, 0.11) * (0.8 + n * 0.4);   // kerb stones
          }
          gl_FragColor = vec4(col, 1.0);
          ${HAZE_FRAG}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.blocks = new THREE.Mesh(mergeGeometries(geos), mat);
    this.group.add(this.blocks);
    // the seawall, with a strip of light along the top
    const h = 1.1, walls = [], strips = [];
    for (const [x0, z0, x1, z1] of L.walls) {
      walls.push(...slab(x0, z0, x1, z1, -2, h));
      strips.push(new THREE.BoxGeometry(x1 - x0, 0.06, z1 - z0).scale(x1 - x0 > z1 - z0 ? 1 : 0.1, 1, x1 - x0 > z1 - z0 ? 0.1 : 1).translate((x0 + x1) / 2, h + 0.03, (z0 + z1) / 2));
    }
    this.wall = new THREE.Mesh(mergeGeometries(walls), patch(new THREE.MeshLambertMaterial({ color: 0x3a3842 })));
    this.group.add(this.wall);
    this.group.add(new THREE.Mesh(mergeGeometries(strips), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x22e5ff).multiplyScalar(1.6), toneMapped: false })));
  }

  // ---- harbour container yards -----------------------------------------------------------

  buildContainers() {
    const list = this.layout.containers;
    const count = list.reduce((n, c) => n + c.levels, 0);
    if (!count) return;
    const cols = ['#7a2626', '#22507a', '#276e46', '#a85a1a', '#4a4f58', '#6a2a5e'];
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), patch(new THREE.MeshLambertMaterial()), count);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let i = 0;
    for (const c of list) {
      for (let lv = 0; lv < c.levels; lv++) {
        s.set(c.alongX ? 12.2 : 2.44, 2.59, c.alongX ? 2.44 : 12.2);
        im.setMatrixAt(i, m.compose(p.set(c.x, CITY.kerb + 1.3 + lv * 2.6, c.z), q, s));
        im.setColorAt(i, _c.set(cols[c.colors[lv]]));
        i++;
      }
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    this.group.add(im);
  }

  // ---- signs -----------------------------------------------------------------------

  buildSigns() {
    const P = [], UV = [], LUV = [], S = [];
    const halos = [], pools = [];
    const push = (a, b, c, d, rect, s) => {
      P.push(...a, ...b, ...c, ...a, ...c, ...d);
      const [u0, v0, u1, v1] = rect;
      UV.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
      LUV.push(0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1);
      for (let i = 0; i < 6; i++) S.push(...s);
    };
    for (const sg of this.layout.signs) {
      const rect = artRect(sg.kind, sg.art), color = ART_COLOR[sg.kind][sg.art];
      const s = [sg.phase, sg.flicker ? 1 : 0, sg.led ? 1 : 0];
      const xFace = sg.face[1] === 'x';
      // corners in (along, y) on the facade, oriented so the art reads correctly from outside
      const at = (u, y, o = 0) => (xFace ? [sg.at + sg.out * o, y, u] : [u, y, sg.at + sg.out * o]);
      // reading direction along the facade when you face it from the street
      const right = xFace ? (sg.out < 0 ? 1 : -1) : (sg.out < 0 ? -1 : 1);
      if (sg.kind === 'blade') {
        // sticks straight out from the wall, art on both faces
        const u = sg.u0, y0 = sg.y0, y1 = sg.y1, o0 = 0.25, o1 = 1.35;
        const p = (o, y, side) => (xFace ? [sg.at + sg.out * o, y, u + side * 0.04] : [u + side * 0.04, y, sg.at + sg.out * o]);
        for (const side of [1, -1]) {
          // looking at this face, "right" runs outward or inward from the wall
          const flip = (xFace ? -side : side) * sg.out > 0;
          const a = flip ? o1 : o0, b = flip ? o0 : o1;
          push(p(a, y0, side), p(b, y0, side), p(b, y1, side), p(a, y1, side), rect, s);
        }
        const mid = xFace ? [sg.at + sg.out * 0.8, (y0 + y1) / 2, u] : [u, (y0 + y1) / 2, sg.at + sg.out * 0.8];
        halos.push([mid, xFace ? [0, 0, 1] : [1, 0, 0], 3.2, (y1 - y0) * 1.2, color, 0.5]);
        halos.push([mid, xFace ? [1, 0, 0] : [0, 0, 1], 3.2, (y1 - y0) * 1.2, color, 0.35]);
        pools.push([xFace ? sg.at + sg.out * 3 : u, xFace ? u : sg.at + sg.out * 3, 6, color, 0.32]);
        continue;
      }
      const [ua, ub] = right > 0 ? [sg.u0, sg.u1] : [sg.u1, sg.u0];
      push(at(ua, sg.y0), at(ub, sg.y0), at(ub, sg.y1), at(ua, sg.y1), rect, s);
      const w = sg.u1 - sg.u0, h = sg.y1 - sg.y0, mu = (sg.u0 + sg.u1) / 2, my = (sg.y0 + sg.y1) / 2;
      const c = at(mu, my, 0.05);
      halos.push([c, xFace ? [0, 0, 1] : [1, 0, 0], w * 1.35, h * (sg.kind === 'band' ? 2.4 : 1.4), color, sg.kind === 'board' ? 0.3 : 0.4]);
      if (!sg.roof) {
        const reach = sg.kind === 'board' ? 9 : 4;
        pools.push([xFace ? sg.at + sg.out * reach : mu, xFace ? mu : sg.at + sg.out * reach, sg.kind === 'board' ? 10 : Math.max(4, w * 0.6), color, sg.kind === 'board' ? 0.16 : 0.38]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setAttribute('aL', new THREE.Float32BufferAttribute(LUV, 2));
    g.setAttribute('aS', new THREE.Float32BufferAttribute(S, 3));
    const signs = new THREE.Mesh(g, signMaterial(false));
    this.group.add(signs);
    const mirror = new THREE.Mesh(g, signMaterial(true));
    mirror.scale.y = -1;
    mirror.renderOrder = 1;
    mirror.userData.level = 1;
    this.mirrors.push(mirror);
    this.group.add(mirror);
    this.signs = signs;
    this.halosData = halos;
    this.poolsData = pools;
  }

  // ---- street lights ------------------------------------------------------------------

  buildLamps() {
    const lamps = this.layout.lamps, n = lamps.length;
    const H = 7.4, ARM = 1.7;
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.07, 0.1, H, 6).translate(0, H / 2, 0),
      new THREE.BoxGeometry(0.08, 0.08, ARM).translate(0, H - 0.1, ARM / 2),
    ]);
    const poles = new THREE.InstancedMesh(pole, patch(new THREE.MeshLambertMaterial({ color: 0x2a2a30 })), n);
    const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.1, 0.8).translate(0, H - 0.2, ARM - 0.2), new THREE.MeshBasicMaterial({ toneMapped: false }), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const halos = this.halosData, pools = this.poolsData;
    lamps.forEach((l, i) => {
      // the arm reaches out over the road (away from the buildings)
      const yaw = Math.atan2(l.dx, l.dz);
      q.setFromAxisAngle(up, yaw);
      m.compose(p.set(l.x, l.y, l.z), q, one);
      poles.setMatrixAt(i, m);
      heads.setMatrixAt(i, m);
      const col = l.warm ? '#ffcf8a' : '#d8e8ff';
      heads.setColorAt(i, _c.set(col).multiplyScalar(2.2));
      const hx = l.x + l.dx * (ARM - 0.2), hz = l.z + l.dz * (ARM - 0.2);
      halos.push([[hx, l.y + H - 0.35, hz], null, 2.6, 2.6, col, 0.55]);
      pools.push([hx + l.dx * 1.5, hz + l.dz * 1.5, 8, col, 0.45]);
    });
    for (const im of [poles, heads]) { im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); this.group.add(im); }
    heads.instanceColor.needsUpdate = true;
  }

  // Soft glows: halos round signs and lamps (facing the camera when no
  // facing is given), and pools of coloured light on the ground.
  *buildGlows() {
    const hp = [], huv = [], hc = [], hcent = [];
    for (const [c, dir, w, h, col, a] of this.halosData) {
      _c.set(col).multiplyScalar(a);
      for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
        hcent.push(...c, dir ? 1 : 0);
        if (dir) hp.push(c[0] + dir[0] * u * w / 2, c[1] + v * h / 2, c[2] + dir[2] * u * w / 2);
        else hp.push(u * w / 2, v * h / 2, 0);
        huv.push((u + 1) / 2, (v + 1) / 2);
        hc.push(_c.r, _c.g, _c.b);
      }
    }
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
    hg.setAttribute('uv', new THREE.Float32BufferAttribute(huv, 2));
    hg.setAttribute('aCol', new THREE.Float32BufferAttribute(hc, 3));
    hg.setAttribute('aCenter', new THREE.Float32BufferAttribute(hcent, 4));
    const halos = new THREE.Mesh(hg, glowMaterial(true));
    halos.frustumCulled = false;
    halos.renderOrder = 4;
    this.group.add(halos);
    yield;

    const pp = [], puv = [], pc = [];
    const k = CITY.kerb;
    for (const [x, z, r, col, a] of this.poolsData) {
      _c.set(col).multiplyScalar(a);
      // on the street and (raised a little) on the sidewalk, so both catch it
      for (const y of [0.02, k + 0.015]) {
        for (const [u, v] of [[-1, -1], [1, 1], [1, -1], [-1, -1], [-1, 1], [1, 1]]) {
          pp.push(x + u * r, y, z + v * r);
          puv.push((u + 1) / 2, (v + 1) / 2);
          pc.push(_c.r, _c.g, _c.b);
        }
      }
    }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pp, 3));
    pg.setAttribute('uv', new THREE.Float32BufferAttribute(puv, 2));
    pg.setAttribute('aCol', new THREE.Float32BufferAttribute(pc, 3));
    pg.setAttribute('aCenter', new THREE.Float32BufferAttribute(new Float32Array(pp.length / 3 * 4), 4));
    this.pools = new THREE.Mesh(pg, glowMaterial(false));
    this.pools.renderOrder = 3;
    this.pools.frustumCulled = false;
    this.group.add(this.pools);
    this.halosData = this.poolsData = null;
  }

  // ---- vending machines ----------------------------------------------------------------

  buildVending() {
    const list = this.layout.vending;
    if (!list.length) return;
    const tex = vendingTexture();
    const dark = new THREE.MeshBasicMaterial({ color: 0x16161c });
    const front = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1.0, 1.9, 0.75), [dark, dark, dark, dark, front, dark], list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const tints = ['#ffffff', '#bfe0ff', '#ffc2c2', '#c8ffd8'];
    list.forEach((v, i) => {
      const yaw = v.face === '-x' ? -Math.PI / 2 : v.face === '+x' ? Math.PI / 2 : v.face === '-z' ? Math.PI : 0;
      q.setFromAxisAngle(up, yaw);
      im.setMatrixAt(i, m.compose(p.set(v.x, CITY.kerb + 0.95, v.z), q, one));
      im.setColorAt(i, _c.set(tints[v.color]));
    });
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    this.group.add(im);
    this.vendTex = tex;
  }

  // ---- the bay ---------------------------------------------------------------------------

  buildBay() {
    // dark water outside the seawall only (under the city it would hide the reflections)
    const y = -1.6;
    const parts = this.layout.water.map(([x0, z0, x1, z1]) => quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...ATMOS, uNoise: { value: textures().noise } },
      vertexShader: WORLD_VERT,
      fragmentShader: /* glsl */`
        ${HAZE_PARS}
        uniform sampler2D uNoise; uniform float uTime;
        void main() {
          vec2 w = vWPos.xz;
          float n = texture2D(uNoise, w / 40.0 + vec2(uTime * 0.004, 0.0)).r * 0.6 + texture2D(uNoise, w / 9.0 - vec2(0.0, uTime * 0.01)).g * 0.4;
          vec3 V = normalize(vWPos - cameraPosition);
          float fres = pow(1.0 - clamp(-V.y, 0.0, 1.0), 3.0);
          vec3 col = mix(vec3(0.008, 0.01, 0.022), uFogColor * 1.3, fres * (0.4 + n * 0.6));
          // glints of the city's colours on the swell
          col += uSunFogColor * smoothstep(0.62, 0.8, n) * 0.35 * fres;
          gl_FragColor = vec4(col, 1.0);
          ${HAZE_FRAG}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.water = new THREE.Mesh(mergeGeometries(parts), mat);
    this.group.add(this.water);
  }

  dispose() {
    this.scene.remove(this.group);
    const seen = new Set();
    this.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
      for (const m of [].concat(o.material || [])) if (!seen.has(m)) { seen.add(m); m.dispose(); }
    });
    if (this.beacons) {
      this.scene.remove(this.beacons);
      this.beacons.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    }
    this.vendTex?.dispose();
  }
}

// ---- geometry helpers ------------------------------------------------------------------

// two triangles a-b-c, a-c-d (counter-clockwise seen from the front)
function quad(a, b, c, d) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.computeVertexNormals();
  return g;
}

// A raised rectangle: its top and (optionally) its four sides.
function slab(x0, z0, x1, z1, y0, y1, sides = [1, 1, 1, 1]) {
  const out = [quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0])];
  if (sides[0]) out.push(quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]));
  if (sides[1]) out.push(quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]));
  if (sides[2]) out.push(quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]));
  if (sides[3]) out.push(quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]));
  return out;
}

// Boxes for a list of buildings (one per tier), with what the facade shader
// needs per vertex: aB = (seed, style, top height, starts at ground), aC = neon colour.
function boxes(list) {
  const P = [], N = [], B = [], C = [];
  const face = (a, b, c, d, n, bv, cv) => {
    P.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) { N.push(...n); B.push(...bv); C.push(...cv); }
  };
  for (const b of list) {
    _c.set(NEON[b.neon]);
    const cv = [_c.r, _c.g, _c.b];
    for (const [x0, z0, x1, z1, y0, y1] of b.tiers) {
      const bv = [b.seed, b.style, b.h, y0 < 0.5 ? 1 : 0];
      face([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], bv, cv);
      face([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], bv, cv);
      face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], bv, cv);
      face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], bv, cv);
      face([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0], bv, cv);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aB', new THREE.Float32BufferAttribute(B, 4));
  g.setAttribute('aC', new THREE.Float32BufferAttribute(C, 3));
  g.computeBoundingSphere();
  return g;
}

// ---- materials -----------------------------------------------------------------------------

const WORLD_VERT = /* glsl */`
  varying vec3 vWPos;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWPos = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const WORLD_VERT_N = /* glsl */`
  varying vec3 vWPos; varying vec3 vN;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWPos = w.xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

const HASH = /* glsl */`
  float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }`;

function buildingMaterial(mirror) {
  return new THREE.ShaderMaterial({
    defines: mirror ? { MIRROR: 1 } : {},
    uniforms: { ...ATMOS },
    vertexShader: /* glsl */`
      attribute vec4 aB; attribute vec3 aC;
      varying vec3 vWPos; varying vec3 vN; varying vec4 vB; varying vec3 vC;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWPos = w.xyz;
        vN = normalize(mat3(modelMatrix) * normal);
        vB = aB; vC = aC;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${HAZE_PARS}
      uniform float uTime;
      varying vec3 vN; varying vec4 vB; varying vec3 vC;
      ${HASH}
      void main() {
        float seed = vB.x, style = vB.y, top = vB.z;
        vec3 N = normalize(vN);
        #ifdef MIRROR
          float y = -vWPos.y;
        #else
          float y = vWPos.y;
        #endif
        vec3 wall = vec3(0.03, 0.029, 0.038) * (0.75 + 0.6 * fract(seed * 13.7));
        wall *= 0.85 + 0.12 * N.x + 0.06 * N.z;
        vec3 col;
        if (abs(N.y) > 0.5) {
          col = wall * 0.6;
        } else {
          float u = (abs(N.x) > 0.5 ? vWPos.z : vWPos.x) + seed * 41.0;
          #ifdef MIRROR
            u += sin(y * 0.9 + uTime * 1.6) * 0.18;     // ripples in the puddles
          #endif
          float cw = style < 0.5 ? 3.0 : style < 1.5 ? 2.5 : style < 2.5 ? 1.7 : style < 3.5 ? 3.3 : 3.0;
          vec2 cell = vec2(u / cw, (y - 0.6) / 3.6);
          vec2 id = floor(cell), f = fract(cell);
          vec2 win = style < 0.5 ? vec2(0.84, 0.6) : style < 1.5 ? vec2(0.58, 0.52) : style < 2.5 ? vec2(0.9, 0.82) : style < 3.5 ? vec2(0.55, 0.5) : vec2(0.96, 0.3);
          vec2 aa = max(fwidth(cell) * 1.5, vec2(1e-4));
          float mask = smoothstep(0.5 * win.x + aa.x, 0.5 * win.x - aa.x, abs(f.x - 0.5))
                     * smoothstep(0.5 * win.y + aa.y, 0.5 * win.y - aa.y, abs(f.y - 0.5));
          float lr = style < 0.5 ? 0.5 : style < 1.5 ? 0.36 : style < 2.5 ? 0.28 : style < 3.5 ? 0.42 : 0.62;
          float r = hash(id + seed * 113.0);
          float lit = step(r, lr);
          // now and then a light goes on or off
          lit = abs(lit - step(0.993, hash(id * 1.3 + floor(uTime / 30.0 + r * 9.0))));
          float c = hash(id.yx * 1.7 + seed * 7.0);
          vec3 wc = c < 0.42 ? vec3(1.0, 0.62, 0.3) : c < 0.78 ? vec3(0.9, 0.92, 1.0) : c < 0.93 ? vec3(0.55, 0.72, 1.0) : vC;
          wc *= 0.55 + 0.8 * hash(id + 3.1);
          if (style > 1.5 && style < 2.5) wc = mix(wc, vec3(0.5, 0.7, 1.0), 0.45);
          if (style > 3.5) wc = mix(wc, vec3(0.6, 0.95, 1.0), 0.6);   // tech campus: cool ribbon windows
          vec3 glass = vec3(0.012, 0.014, 0.024) + uFogColor * 0.15;
          vec3 winCol = mix(glass, wc * 1.1 * (0.8 + 0.3 * f.y), lit);
          // windows too small to draw blend into their average (no shimmer)
          float far = smoothstep(0.3, 0.8, max(aa.x, aa.y));
          vec3 avg = mix(wall, mix(glass, wc * 1.1, lr), win.x * win.y * 0.9);
          #ifdef MIRROR
            far = max(far, 0.7);   // a wet street blurs what it reflects
          #endif
          col = mix(mix(wall, winCol, mask), avg, far);
          // shop fronts on the ground floor: lit, or shuttered for the night
          if (vB.w > 0.5 && y < 3.4 && style < 3.5) {
            float sh = hash(vec2(floor(u / 6.0), seed * 50.0));
            // lit shops (warm, white or tinted by the street's neon), or shutters
            vec3 inside = sh < 0.3 ? vec3(1.0, 0.78, 0.5) : sh < 0.5 ? vec3(0.85, 0.9, 1.0) : mix(vec3(0.9), vC, 0.6);
            vec3 shop = sh < 0.68 ? inside * (0.45 + 0.35 * smoothstep(3.0, 0.4, y)) : vec3(0.04, 0.04, 0.05) * (0.8 + 0.4 * step(0.5, fract(y * 6.0)));
            float pane = step(0.08, fract(u / 2.0)) * step(0.35, y) * step(y, 3.0);
            col = mix(wall * 1.2, shop, pane);
          }
          if (style > 4.5) {
            // warehouse: ribbed metal walls, a row of small high windows, loading doors with a light over each
            col = wall * 1.5 * (0.85 + 0.15 * step(0.5, fract(u / 0.6)));
            float band = step(top - 3.2, y) * step(y, top - 2.0) * step(0.3, fract(u / 4.0)) * step(fract(u / 4.0), 0.7);
            float litw = step(0.55, hash(vec2(floor(u / 4.0), seed * 31.0)));
            col = mix(col, mix(vec3(0.02), vec3(1.0, 0.7, 0.35) * 0.8, litw), band);
            float door = step(fract(u / 12.0), 0.4) * step(y, 4.5) * vB.w;
            col = mix(col, wall * 0.5, door);
            col += vec3(1.0, 0.6, 0.25) * 0.7 * step(fract(u / 12.0), 0.4) * step(4.6, y) * step(y, 4.8) * vB.w;
          }
          if (style > 3.5 && style < 4.5) {
            // tech campus: a line of light every third floor
            col += vC * 1.3 * smoothstep(0.035, 0.0, abs(fract((y - 0.6) / 10.8) - 0.02));
          }
          // the street's neon washes up the lower floors
          col += vC * 0.07 * exp(-y / 10.0);
          // a ring of light round the top of the tall towers
          if (top > 70.0) col += vC * 1.6 * smoothstep(top - 1.6, top - 1.2, y) * smoothstep(top - 0.2, top - 0.5, y);
        }
        #ifdef MIRROR
          col *= 0.3;
        #endif
        gl_FragColor = vec4(col, 1.0);
        ${HAZE_FRAG}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function signMaterial(mirror) {
  return new THREE.ShaderMaterial({
    defines: mirror ? { MIRROR: 1 } : {},
    side: THREE.DoubleSide,
    uniforms: { ...ATMOS, uAtlas: { value: signAtlas() } },
    vertexShader: /* glsl */`
      attribute vec2 aL; attribute vec3 aS;
      varying vec3 vWPos; varying vec2 vUv; varying vec2 vL; varying vec3 vS;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWPos = w.xyz; vUv = uv; vL = aL; vS = aS;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      ${HAZE_PARS}
      uniform sampler2D uAtlas; uniform float uTime;
      varying vec2 vUv; varying vec2 vL; varying vec3 vS;
      void main() {
        vec2 uv = vUv;
        #ifdef MIRROR
          uv.x += sin(vWPos.y * 2.0 + uTime * 2.2) * 0.004;
        #endif
        vec3 c = texture2D(uAtlas, uv).rgb * 1.7;
        // a gentle hum, and a few dying tubes that stutter
        c *= 0.92 + 0.08 * sin(uTime * 2.3 + vS.x * 40.0);
        if (vS.y > 0.5) {
          float t = floor(uTime * 14.0 + vS.x * 50.0);
          float off = step(0.86, fract(sin(t * 12.9898) * 43758.5453)) * step(0.5, fract(uTime * 0.07 + vS.x));
          c *= 1.0 - off * 0.85;
        }
        if (vS.z > 0.5) {
          // LED screens: colour sweeps and scanlines over the artwork
          float ph = uTime * 0.6 + vS.x * 10.0;
          vec3 sweep = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + vL.x * 0.6 + ph * 0.3));
          float wave = 0.5 + 0.5 * sin(vL.x * 9.0 - uTime * 2.5 + sin(vL.y * 5.0 + uTime));
          c = mix(c, sweep * (0.6 + wave), 0.32 + 0.18 * sin(ph));
          c *= 0.82 + 0.18 * step(0.5, fract(vL.y * 70.0));
        }
        #ifdef MIRROR
          c *= 0.38;
        #endif
        gl_FragColor = vec4(c, 1.0);
        {
          vec3 toP = vWPos - cameraPosition;
          float fd = length(toP);
          float ff = 1.0 - exp(-uFogDensity * uFogDensity * fd * fd);
          gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeColor(toP / max(fd, 1e-3)), ff * 0.8);
        }
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// Additive glow quads. Billboards (aCenter.w = 0) turn to face the camera.
function glowMaterial(billboard) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { ...ATMOS, uGlow: { value: glowTexture() }, uGain: { value: 1 } },
    defines: billboard ? { BILLBOARD: 1 } : {},
    vertexShader: /* glsl */`
      attribute vec3 aCol; attribute vec4 aCenter;
      varying vec3 vWPos; varying vec2 vUv; varying vec3 vCol;
      void main() {
        vec3 p = position;
        #ifdef BILLBOARD
          if (aCenter.w < 0.5) {
            vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
            vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
            p = aCenter.xyz + right * position.x + up * position.y;
          }
        #endif
        vec4 w = modelMatrix * vec4(p, 1.0);
        vWPos = w.xyz; vUv = uv; vCol = aCol;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uGlow; uniform float uGain; uniform float uFogDensity;
      varying vec3 vWPos; varying vec2 vUv; varying vec3 vCol;
      void main() {
        float a = texture2D(uGlow, vUv).a;
        float fd = length(vWPos - cameraPosition);
        float ff = exp(-uFogDensity * uFogDensity * fd * fd);   // haze swallows far glows
        gl_FragColor = vec4(vCol * a * a * uGain * ff, 1.0);
      }`,
  });
}

let VEND = null;
function vendingTexture() {
  if (VEND) return VEND;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f7ff'; g.fillRect(0, 0, 64, 128);
  const cols = ['#e8333a', '#2c7be5', '#f2b705', '#1aa35a', '#ff7a1a', '#7a3cff'];
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 6; k++) {
      g.fillStyle = cols[(r * 2 + k) % cols.length];
      g.fillRect(5 + k * 9.5, 10 + r * 18, 6, 13);
    }
    g.fillStyle = '#c9ced8'; g.fillRect(4, 25 + r * 18, 56, 2);
  }
  g.fillStyle = '#20232b'; g.fillRect(4, 86, 56, 36);
  g.fillStyle = '#3a3f4b'; g.fillRect(14, 104, 36, 10);
  VEND = new THREE.CanvasTexture(c);
  VEND.colorSpace = THREE.SRGBColorSpace;
  return VEND;
}

