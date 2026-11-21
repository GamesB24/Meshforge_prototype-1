// MeshForge companion speech bubble, plus an optional drone mesh used only by the kiosk sample scene.
// The drone is not added to the viewport unless a caller inserts the mesh into the scene.
import * as THREE from 'three';

export function buildCompanionMesh() {
  const group = new THREE.Group();
  group.name = 'Companion_Drone';

  const bodyGeo = new THREE.OctahedronGeometry(0.35, 1);
  bodyGeo.scale(1.0, 0.7, 1.2);
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0x22262d, metalness: 0.8, roughness: 0.3 }));
  group.add(body);

  const eyeGeo = new THREE.SphereGeometry(0.12, 12, 12);
  eyeGeo.scale(1.5, 0.6, 0.5);
  const eye = new THREE.Mesh(eyeGeo, new THREE.MeshBasicMaterial({ color: 0x4fc3f7 }));
  eye.position.set(0, 0.05, 0.32);
  eye.name = 'Companion_Eye';
  group.add(eye);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.02, 8, 24), new THREE.MeshStandardMaterial({ color: 0x8892a0, metalness: 0.9, roughness: 0.2 }));
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  const thrusterGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.25, 10);
  const thrusterMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.7 });
  const left = new THREE.Mesh(thrusterGeo, thrusterMat);
  left.position.set(-0.35, -0.1, -0.1);
  const right = left.clone();
  right.position.x = 0.35;
  group.add(left, right);

  group.position.set(-1.5, 1.6, 1.5);
  return group;
}

// Bubble only. No scene graph object is created.
export function createCompanion(ctx) {
  const { camera, status, findAnchor } = ctx;
  let bubbleEl = document.getElementById('companionBubble');
  if (!bubbleEl) {
    bubbleEl = document.createElement('div');
    bubbleEl.id = 'companionBubble';
    bubbleEl.className = 'companion-bubble hidden';
    document.body.appendChild(bubbleEl);
  }

  function anchorObject() {
    try { return findAnchor?.() || null; } catch { return null; }
  }

  function placeBubble() {
    const anchor = anchorObject();
    const cam = camera?.();
    if (!anchor || !cam || bubbleEl.classList.contains('hidden')) return;
    const screenPos = anchor.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0));
    screenPos.project(cam);
    const hw = window.innerWidth / 2, hh = window.innerHeight / 2;
    bubbleEl.style.left = '0';
    bubbleEl.style.top = '0';
    bubbleEl.style.transform = `translate(${(screenPos.x * hw) + hw}px, ${-(screenPos.y * hh) + hh}px) translate(-50%, -120%)`;
  }

  function showBubble(text, _mood = 'neutral', duration = 3500) {
    if (!text) return;
    bubbleEl.textContent = text;
    bubbleEl.classList.remove('hidden');
    placeBubble();
    clearTimeout(bubbleEl._timer);
    bubbleEl._timer = setTimeout(() => bubbleEl.classList.add('hidden'), duration);
    status?.(text);
  }

  return {
    showBubble,
    hide: () => bubbleEl.classList.add('hidden'),
    tick: () => placeBubble(),
    mesh: null,
    setActive: () => {},
  };
}
