// MeshForge AI Companion Bot ("Echo"): 3D Follower, Rear-Threat Radar, and In-Game Assistant.
import * as THREE from 'three';

export function createCompanion(ctx) {
  const { scene, camera, status } = ctx;

  const S = {
    bot: null,
    eyeMat: null,
    active: true,
    target: null, // Player object or camera
    offset: new THREE.Vector3(-1.2, 1.3, -1.0),
    time: 0,
    lastWarningTime: 0,
    currentMood: 'neutral', // 'neutral', 'alert', 'happy'
  };

  // Build the 3D procedural companion drone mesh
  function buildDroneMesh() {
    const group = new THREE.Group();
    group.name = 'Companion_Echo';

    // Drone Chassis (Chiseled diamond/capsule pod)
    const bodyGeo = new THREE.OctahedronGeometry(0.35, 2);
    bodyGeo.scale(1.0, 0.7, 1.2);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x22262d,
      metalness: 0.8,
      roughness: 0.3,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    group.add(body);

    // Glowing Ocular Visor / Eye
    const eyeGeo = new THREE.SphereGeometry(0.12, 16, 16);
    eyeGeo.scale(1.5, 0.6, 0.5);
    S.eyeMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7 });
    const eye = new THREE.Mesh(eyeGeo, S.eyeMat);
    eye.position.set(0, 0.05, 0.32);
    group.add(eye);

    // Halo / Sensor Ring
    const ringGeo = new THREE.TorusGeometry(0.42, 0.02, 12, 32);
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x8892a0, metalness: 0.9, roughness: 0.2 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // Hover Thrusters (Left & Right pod engines)
    const thrusterGeo = new THREE.CylinderGeometry(0.06, 0.08, 0.25, 16);
    const thrusterMat = new THREE.MeshStandardMaterial({ color: 0x1a1d24, metalness: 0.7 });
    const leftThruster = new THREE.Mesh(thrusterGeo, thrusterMat);
    leftThruster.position.set(-0.35, -0.1, -0.1);
    leftThruster.rotation.z = 0.2;
    group.add(leftThruster);

    const rightThruster = new THREE.Mesh(thrusterGeo, thrusterMat);
    rightThruster.position.set(0.35, -0.1, -0.1);
    rightThruster.rotation.z = -0.2;
    group.add(rightThruster);

    // Glowing jet glow particles / cones
    const jetGeo = new THREE.ConeGeometry(0.05, 0.18, 12);
    jetGeo.rotateX(Math.PI);
    const jetMat = new THREE.MeshBasicMaterial({ color: 0x29b6f6 });
    const leftJet = new THREE.Mesh(jetGeo, jetMat);
    leftJet.position.set(-0.35, -0.25, -0.1);
    group.add(leftJet);

    const rightJet = new THREE.Mesh(jetGeo, jetMat);
    rightJet.position.set(0.35, -0.25, -0.1);
    group.add(rightJet);

    // Small Antenna
    const antGeo = new THREE.CylinderGeometry(0.01, 0.01, 0.2, 8);
    const ant = new THREE.Mesh(antGeo, ringMat);
    ant.position.set(0.12, 0.3, -0.15);
    ant.rotation.z = -0.2;
    group.add(ant);

    group.position.set(-1.5, 1.8, 1.5);
    scene.add(group);
    return group;
  }

  S.bot = buildDroneMesh();

  // Floating Speech Bubble Element in Viewport
  let bubbleEl = document.getElementById('companionBubble');
  if (!bubbleEl) {
    bubbleEl = document.createElement('div');
    bubbleEl.id = 'companionBubble';
    bubbleEl.className = 'companion-bubble hidden';
    document.body.appendChild(bubbleEl);
  }

  function showBubble(text, mood = 'neutral', duration = 4000) {
    if (!bubbleEl) return;
    setMood(mood);
    bubbleEl.innerHTML = `<span class="bubble-icon">🤖</span> <b>Echo:</b> ${text}`;
    bubbleEl.classList.remove('hidden');
    clearTimeout(bubbleEl._timer);
    bubbleEl._timer = setTimeout(() => {
      bubbleEl.classList.add('hidden');
      setMood('neutral');
    }, duration);
  }

  function setMood(mood) {
    S.currentMood = mood;
    if (!S.eyeMat) return;
    if (mood === 'alert') S.eyeMat.color.setHex(0xff3d00); // Crimson / Amber warning
    else if (mood === 'happy') S.eyeMat.color.setHex(0x00e676); // Green approval
    else S.eyeMat.color.setHex(0x4fc3f7); // Serene blue
  }

  // Tactical Threat Radar: Checks objects behind player's view
  function checkTacticalSurroundings(playerPos, playerForward) {
    const now = performance.now();
    if (now - S.lastWarningTime < 6000) return; // Prevent spam

    let threatFound = false;
    let threatName = '';

    scene.traverse((obj) => {
      if (threatFound || !obj.isMesh || obj === S.bot || obj.userData.isOverlay || obj.name.includes('Floor') || obj.name.includes('Sky')) return;
      // Calculate vector from player to object
      const objWorldPos = new THREE.Vector3();
      obj.getWorldPosition(objWorldPos);
      const toObj = objWorldPos.clone().sub(playerPos);
      const dist = toObj.length();

      // Only check nearby objects within 8 meters
      if (dist > 1.5 && dist < 8.0) {
        toObj.normalize();
        const dot = playerForward.dot(toObj);
        // dot < -0.4 means the object is directly behind the player's view!
        if (dot < -0.4) {
          threatFound = true;
          threatName = obj.name || 'Object';
        }
      }
    });

    if (threatFound) {
      S.lastWarningTime = now;
      const warning = `Watch your six! Approaching hazard behind you: ${threatName}!`;
      showBubble(warning, 'alert', 3500);
      window.MeshForge?.agent?.speak?.(warning);
    }
  }

  // Animation & follow tick (called each frame)
  function tick(delta = 0.016, playerTransform = null) {
    if (!S.active || !S.bot) return;
    S.time += delta;

    let targetPos = new THREE.Vector3();
    let playerFwd = new THREE.Vector3(0, 0, -1);

    if (playerTransform) {
      targetPos.copy(playerTransform.position);
      playerFwd.copy(playerTransform.forward);
    } else {
      // In editor mode, hover near perspective camera
      const cam = camera();
      targetPos.copy(cam.position);
      cam.getWorldDirection(playerFwd);
    }

    // Desired companion position relative to target
    const right = new THREE.Vector3().crossVectors(playerFwd, new THREE.Vector3(0, 1, 0)).normalize();
    const desiredPos = targetPos.clone()
      .add(right.clone().multiplyScalar(S.offset.x))
      .add(new THREE.Vector3(0, S.offset.y + Math.sin(S.time * 2.5) * 0.08, 0))
      .add(playerFwd.clone().multiplyScalar(S.offset.z));

    // Smooth position interpolation
    S.bot.position.lerp(desiredPos, delta * 5.0);

    // Look slightly towards player forward vector with soft banking
    const lookTarget = targetPos.clone().add(playerFwd.clone().multiplyScalar(4.0));
    S.bot.lookAt(lookTarget);

    // Check tactical awareness
    checkTacticalSurroundings(targetPos, playerFwd);

    // Update screen position of floating speech bubble
    if (bubbleEl && !bubbleEl.classList.contains('hidden')) {
      const screenPos = S.bot.position.clone().add(new THREE.Vector3(0, 0.5, 0));
      screenPos.project(camera());
      const hw = window.innerWidth / 2;
      const hh = window.innerHeight / 2;
      const x = (screenPos.x * hw) + hw;
      const y = -(screenPos.y * hh) + hh;
      bubbleEl.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  return {
    mesh: S.bot,
    showBubble,
    setMood,
    tick,
    setActive: (v) => {
      S.active = v;
      if (S.bot) S.bot.visible = v;
    },
  };
}
