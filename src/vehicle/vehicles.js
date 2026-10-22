import * as THREE from 'three';
import { BIKE, buildBike, EYE } from './bike.js';
import { CAR, buildCar, CAR_EYE, CAR_NOSE, CAR_LAMP } from './car.js';

// Every ride a player can pick with V. Each has its tuning (spec), a model
// builder, and where the cockpit eye, nose camera and headlight sit.
export const VEHICLES = {
  bike: {
    label: 'Hubless superbike',
    blurb: 'Leans into corners, pulls wheelies (Shift). Nimble and light.',
    stats: { speed: 0.78, accel: 0.72, grip: 0.7 },
    spec: BIKE, build: buildBike,
    eye: EYE, nose: new THREE.Vector3(0, 0.62, 1.34), lamp: new THREE.Vector3(0, 0.95, 1.2),
  },
  car: {
    label: 'Hypercar',
    blurb: 'Single seater with a huge rear wing. Faster, grippier, no wheelies.',
    stats: { speed: 0.92, accel: 0.88, grip: 0.9 },
    spec: CAR, build: buildCar,
    eye: CAR_EYE, nose: CAR_NOSE, lamp: CAR_LAMP,
  },
};
export const vehicleFor = (kind) => VEHICLES[kind] || VEHICLES.bike;
