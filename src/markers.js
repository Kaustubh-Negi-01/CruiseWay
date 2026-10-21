import * as THREE from 'three';
import { ROAD_HALF_WIDTH as W } from './world/road.js';

// Start gate, checkpoint gates and finish gate, plus a tall light beacon on
// whichever gate the local player must reach next (visible through fog, so
// players can navigate off-road toward it).
export class RaceMarkers {
  constructor(scene, world, race) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.gates = [];
    const road = world.road;
    const pts = [race.s0, ...race.cps, race.s1];
    pts.forEach((s, i) => {
      const kind = i === 0 ? 'start' : i === pts.length - 1 ? 'finish' : 'cp';
      const p = road.at(s);
      const gate = makeGate(kind, i);
      gate.position.set(p.x, p.y, p.z);
      gate.rotation.y = Math.atan2(p.tx, p.tz);
      this.group.add(gate);
      this.gates.push({ gate, x: p.x, y: p.y, z: p.z, kind });
    });

    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffd23f, transparent: true, opacity: 0.35, fog: false,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 400, 12, 1, true), beaconMat);
    this.beacon.visible = false;
    this.group.add(this.beacon);
  }

  // index into [start, ...cps, finish] of the gate the player is heading for
  setTarget(i) {
    const g = this.gates[i];
    if (!g) { this.beacon.visible = false; return; }
    this.beacon.visible = true;
    this.beacon.position.set(g.x, g.y + 200, g.z);
    this.beacon.material.color.set(g.kind === 'finish' ? 0x6cff8a : 0xffd23f);
    this.gates.forEach((gg, j) => {
      gg.gate.traverse((o) => { if (o.material && o.userData.banner) o.material.opacity = j === i ? 1 : j < i ? 0.25 : 0.6; });
    });
  }

  update(t) {
    if (this.beacon.visible) this.beacon.material.opacity = 0.28 + Math.sin(t * 3) * 0.08;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}

function makeGate(kind, n) {
  const g = new THREE.Group();
  const color = kind === 'finish' ? 0x111111 : kind === 'start' ? 0x2a7de1 : 0xf2a30f;
  const postMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  for (const x of [-(W + 1.2), W + 1.2]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 6, 8), postMat);
    post.position.set(x, 3, 0);
    post.castShadow = true;
    g.add(post);
  }
  const label = kind === 'finish' ? 'FINISH' : kind === 'start' ? 'START' : `CHECKPOINT ${n}`;
  const tex = bannerTexture(label, kind, color);
  const bannerMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide });
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(2 * W + 2.4, 1.4), bannerMat);
  banner.position.set(0, 5.6, 0);
  banner.userData.banner = true;
  g.add(banner);
  return g;
}

function bannerTexture(text, kind, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 64;
  const c = cv.getContext('2d');
  if (kind === 'finish') {
    for (let x = 0; x < 512; x += 16) for (let y = 0; y < 64; y += 16) {
      c.fillStyle = ((x + y) / 16) % 2 ? '#111' : '#fff';
      c.fillRect(x, y, 16, 16);
    }
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(150, 8, 212, 48);
  } else {
    c.fillStyle = '#' + color.toString(16).padStart(6, '0');
    c.fillRect(0, 0, 512, 64);
  }
  c.fillStyle = '#fff';
  c.font = 'bold 40px system-ui, sans-serif';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, 256, 34);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
