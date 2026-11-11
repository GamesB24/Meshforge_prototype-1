// Optional sample scene. Nothing here is created until the user loads it from the File menu.
// Play then runs these objects because they are ordinary scene meshes with behaviours.
import * as THREE from 'three';
import { buildCompanionMesh } from './companion.js';
import { bakeObject } from './scene.js';

function mesh(geo, color, name, position) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.25 }));
  m.name = name;
  if (position) m.position.set(position[0], position[1], position[2]);
  return m;
}

export function buildKioskSample() {
  const floor = mesh(new THREE.PlaneGeometry(24, 24).rotateX(-Math.PI / 2), 0x3a4454, 'Sample_Floor', [0, 0, 0]);
  floor.material.roughness = 0.9;

  const base = mesh(new THREE.CylinderGeometry(1.6, 1.8, 1.0, 16), 0x263238, 'Kiosk_Base', [6, 0.5, -4]);
  const counter = mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.15, 16), 0xe8963a, 'Kiosk_Counter', [6, 1.05, -4]);
  const canopy = mesh(new THREE.ConeGeometry(2.0, 0.8, 16), 0x1e88e5, 'Kiosk_Canopy', [6, 2.8, -4]);
  canopy.material.transparent = true;
  canopy.material.opacity = 0.75;
  const attendant = mesh(new THREE.SphereGeometry(0.35, 16, 16), 0xffb74d, 'Kiosk_Attendant', [6, 1.6, -4]);
  attendant.userData.behaviours = [{ type: 'spin', enabled: true, params: { axis: 'y', speed: 40 } }];
  const sign = mesh(new THREE.BoxGeometry(1.2, 0.3, 0.05), 0x00e676, 'Kiosk_Sign', [6, 2.2, -2.8]);

  const player = mesh(new THREE.CapsuleGeometry(0.35, 0.9, 6, 12), 0x3d5afe, 'Player', [0, 0.8, 2]);
  player.userData.behaviours = [{ type: 'character', enabled: true, params: { speed: 4.5, jump: 6, camera: 'follow' } }];

  const droneRoot = buildCompanionMesh();
  droneRoot.position.set(-1.2, 2.2, 3.2);
  const drone = bakeObject(droneRoot, 'Companion_Drone');
  drone.position.copy(droneRoot.position);
  drone.userData.behaviours = [{ type: 'follow', enabled: true, params: { target: 'Player', distance: 1.6, height: 1.5 } }];

  return [floor, base, counter, canopy, attendant, sign, player, drone];
}
