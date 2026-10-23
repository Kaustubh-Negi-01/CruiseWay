import * as THREE from 'three';
import { BIKE, PALETTE, makeDash, glowTexture } from './bike.js';

// The bike's look in Hikari, the city: "Cyberpunk bike" by daCruz
// (https://skfb.ly/6RAYJ), licensed under CC BY-NC 4.0
// (http://creativecommons.org/licenses/by-nc/4.0/).
//
// public/models/cyberbike.glb is that model prepared for the game: scaled to
// our wheelbase, wheels split out so they can spin and steer, normals dropped
// (it's unlit), and the painted texture saved as JPEG (3.1 MB -> 1.3 MB).
// It's only downloaded when someone heads for the city.
//
// Same handling as the island bike; only the wheel positions differ.

export const CITY_BIKE_SPEC = { ...BIKE, rearZ: -0.925, contacts: [[0, 0.925], [0, -0.925]], wheelR: 0.414 };

let TEMPLATE = null, LOADING = null;

export const cityBikeReady = () => !!TEMPLATE;

export function loadCityBike() {
  if (TEMPLATE) return Promise.resolve(TEMPLATE);
  if (LOADING) return LOADING;
  LOADING = import('three/examples/jsm/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => new GLTFLoader().loadAsync('/models/cyberbike.glb'))
    .then((gltf) => {
      const parts = { body: [], wheelFront: [], wheelRear: [] }, pivots = {};
      for (const k of Object.keys(parts)) {
        const node = gltf.scene.getObjectByName(k);
        pivots[k] = node.position.clone();
        node.traverse((o) => {
          if (!o.isMesh) return;
          // one copy shared by every bike in the city: never disposed, never made see-through
          o.geometry.userData.shared = true;
          o.material.userData.shared = true;
          o.material.userData.noGhost = true;
          if (o.material.map) o.material.map.userData.shared = true;
          parts[k].push({ geo: o.geometry, mat: o.material });
        });
      }
      TEMPLATE = { parts, pivots };
      return TEMPLATE;
    })
    .catch((e) => { LOADING = null; throw e; });
  return LOADING;
}

// Same structure as buildBike: userData { lean, steerer, wheels, mats, dash, under }.
export function buildCityBike(color = PALETTE[0]) {
  const T = TEMPLATE;
  const meshes = (list) => list.map(({ geo, mat }) => new THREE.Mesh(geo, mat));
  const root = new THREE.Group(), lean = new THREE.Group();
  root.add(lean);
  lean.add(...meshes(T.parts.body));
  const rear = new THREE.Group();
  rear.position.copy(T.pivots.wheelRear);
  rear.add(...meshes(T.parts.wheelRear));
  const steerer = new THREE.Group();
  steerer.position.copy(T.pivots.wheelFront);
  const front = new THREE.Group();
  front.add(...meshes(T.parts.wheelFront));
  steerer.add(front);
  lean.add(rear, steerer);
  // live speedo on the bike's cyan screen, for the cockpit view
  const dash = makeDash(color);
  dash.mesh.scale.set(0.94, 0.75, 1);   // fills the bike's own screen (about 24 x 11 cm)
  dash.mesh.position.copy(CITY_DASH.pos);
  dash.mesh.rotation.set(CITY_DASH.tilt, Math.PI, 0);
  lean.add(dash.mesh);
  // underglow in the rider's colour
  const under = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 3.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
  );
  under.position.y = 0.04;
  under.renderOrder = 2;
  root.add(under);
  root.userData = { lean, steerer, wheels: [rear, front], mats: {}, dash, under };
  return root;
}

// the screen on top of the headlight cowl, facing up at the rider
export const CITY_DASH = { pos: new THREE.Vector3(0, 1.104, 0.544), tilt: 1.25 };
export const CITY_EYE = new THREE.Vector3(0, 1.5, -0.42);
