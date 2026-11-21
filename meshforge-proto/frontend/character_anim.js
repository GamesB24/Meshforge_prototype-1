// Procedural idle / walk / run / jump for a humanoid bone set.
// Bone names come from MeshForge's humanoid template. A few imported aliases are accepted.
import * as THREE from 'three';

const ALIAS = {
  hips: ['hips', 'pelvis', 'mixamorigHips'],
  chest: ['chest', 'spine2', 'mixamorigSpine2', 'spine'],
  'upper_arm.L': ['upper_arm.L', 'leftarm', 'mixamorigLeftArm'],
  'upper_arm.R': ['upper_arm.R', 'rightarm', 'mixamorigRightArm'],
  'upper_leg.L': ['upper_leg.L', 'leftupleg', 'mixamorigLeftUpLeg'],
  'upper_leg.R': ['upper_leg.R', 'rightupleg', 'mixamorigRightUpLeg'],
  'lower_leg.L': ['lower_leg.L', 'leftleg', 'mixamorigLeftLeg'],
  'lower_leg.R': ['lower_leg.R', 'rightleg', 'mixamorigRightLeg'],
};

function norm(name) { return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

export function findArmature(mesh) {
  if (!mesh) return null;
  let found = null;
  mesh.traverse((o) => { if (!found && o.userData?.isArmature) found = o; });
  if (found) return found;
  const root = mesh.parent;
  root?.traverse?.((o) => {
    if (found || !o.userData?.isArmature) return;
    if (o.userData.meshId === mesh.uuid || o.userData.meshName === mesh.name) found = o;
  });
  return found;
}

function boneMap(arm) {
  const list = [];
  arm.traverse((o) => { if (o.isBone) list.push(o); });
  const out = {};
  for (const [key, names] of Object.entries(ALIAS)) {
    const want = new Set(names.map(norm));
    out[key] = list.find((b) => want.has(norm(b.name))) || null;
  }
  return out;
}

function restQuat(bone) {
  if (!bone.userData.restQuaternion) bone.userData.restQuaternion = bone.quaternion.toArray();
  bone.quaternion.fromArray(bone.userData.restQuaternion);
}

function pose(bone, x, y, z) {
  if (!bone) return;
  restQuat(bone);
  if (x) bone.rotateX(x);
  if (y) bone.rotateY(y);
  if (z) bone.rotateZ(z);
}

export function driveHumanoid(mesh, opts) {
  const arm = findArmature(mesh);
  if (!arm) return false;
  const b = boneMap(arm);
  if (!b['upper_arm.L'] || !b['upper_leg.L'] || !b['upper_arm.R'] || !b['upper_leg.R']) return false;
  const moving = !!opts.moving;
  const running = !!opts.running;
  const jumping = !!opts.jumping;
  const phase = opts.time * (running ? 11 : 7);
  const amp = moving ? (running ? 0.95 : 0.55) : 0;
  const s = Math.sin(phase);
  if (!moving && !jumping) {
    const breathe = Math.sin(opts.time * 2) * 0.05;
    pose(b.chest, breathe, 0, 0);
    pose(b.hips, -breathe * 0.25, 0, 0);
    pose(b['upper_arm.L'], 0.15, 0, 0.08);
    pose(b['upper_arm.R'], 0.15, 0, -0.08);
    return true;
  }
  if (jumping) {
    pose(b['upper_arm.L'], -2.1, 0, 0.25);
    pose(b['upper_arm.R'], -2.1, 0, -0.25);
    pose(b['upper_leg.L'], -0.45, 0, 0);
    pose(b['upper_leg.R'], -0.45, 0, 0);
    pose(b['lower_leg.L'], 0.9, 0, 0);
    pose(b['lower_leg.R'], 0.9, 0, 0);
    pose(b.hips, -0.15, 0, 0);
    return true;
  }
  const lift = Math.max(0, s);
  pose(b['upper_arm.L'], s * amp, 0, 0.1);
  pose(b['upper_arm.R'], -s * amp, 0, -0.1);
  pose(b['upper_leg.L'], -s * amp, 0, 0);
  pose(b['upper_leg.R'], s * amp, 0, 0);
  pose(b['lower_leg.L'], lift * amp, 0, 0);
  pose(b['lower_leg.R'], Math.max(0, -s) * amp, 0, 0);
  pose(b.hips, 0.08, 0, s * 0.06);
  pose(b.chest, -0.06, 0, -s * 0.04);
  return true;
}

export function boneQuaternionDelta(mesh, name) {
  const arm = findArmature(mesh);
  if (!arm) return 0;
  let bone = null;
  arm.traverse((o) => { if (!bone && o.isBone && o.name === name) bone = o; });
  if (!bone?.userData.restQuaternion) return 0;
  const rest = new THREE.Quaternion().fromArray(bone.userData.restQuaternion);
  return bone.quaternion.angleTo(rest);
}
