// MeshForge In-Engine Game Mode (Play-In-Editor / PIE)
// Provides a real-time playable game inside the viewport with player physics, shooting, and metaverse kiosk.
import * as THREE from 'three';

export function createGameMode(ctx) {
  const { scene, canvas, camera, controls, auth, companion, status } = ctx;

  const S = {
    playing: false,
    player: null,
    playerCam: null,
    kiosk: null,
    savedCamPos: new THREE.Vector3(),
    savedCamTarget: new THREE.Vector3(),
    keys: { w: false, a: false, s: false, d: false, space: false, shift: false },
    velocity: new THREE.Vector3(),
    onGround: true,
    yaw: 0,
    pitch: 0,
    mouseLocked: false,
    projectiles: [],
    nearKiosk: false,
  };

  // Build Player Rig
  function buildPlayer() {
    const group = new THREE.Group();
    group.name = 'Player_Rig';

    // Stylized Character Capsule
    const bodyGeo = new THREE.CapsuleGeometry(0.35, 0.9, 8, 16);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x3d5afe,
      metalness: 0.6,
      roughness: 0.4,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = 0.8;
    body.castShadow = true;
    group.add(body);

    // Visor / Faceplate
    const visorGeo = new THREE.BoxGeometry(0.3, 0.12, 0.2);
    const visorMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 1.15, 0.25);
    group.add(visor);

    // Energy Blaster / Tool in hand
    const blasterGeo = new THREE.BoxGeometry(0.12, 0.15, 0.45);
    const blasterMat = new THREE.MeshStandardMaterial({ color: 0x212121, metalness: 0.8 });
    const blaster = new THREE.Mesh(blasterGeo, blasterMat);
    blaster.position.set(0.45, 0.75, 0.3);
    group.add(blaster);

    group.position.set(0, 0, 0);
    scene.add(group);
    return group;
  }

  // Build Metaverse Kiosk / Street Cafe
  function buildKiosk() {
    const group = new THREE.Group();
    group.name = 'Metaverse_Kiosk';

    // Kiosk Booth Base
    const baseGeo = new THREE.CylinderGeometry(1.6, 1.8, 1.0, 16);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x263238, roughness: 0.5 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.y = 0.5;
    group.add(base);

    // Counter Top
    const counterGeo = new THREE.CylinderGeometry(1.9, 1.9, 0.15, 16);
    const counterMat = new THREE.MeshStandardMaterial({ color: 0xe8963a, metalness: 0.7, roughness: 0.2 });
    const counter = new THREE.Mesh(counterGeo, counterMat);
    counter.position.y = 1.05;
    group.add(counter);

    // Holographic Canopy
    const canopyGeo = new THREE.ConeGeometry(2.0, 0.8, 16);
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x1e88e5, transparent: true, opacity: 0.7 });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.y = 2.8;
    group.add(canopy);

    // Kiosk Bot / Attendant
    const botGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const botMat = new THREE.MeshStandardMaterial({ color: 0xffb74d, metalness: 0.8 });
    const bot = new THREE.Mesh(botGeo, botMat);
    bot.position.set(0, 1.6, 0);
    group.add(bot);

    // Glowing Sign
    const signGeo = new THREE.BoxGeometry(1.2, 0.3, 0.05);
    const signMat = new THREE.MeshBasicMaterial({ color: 0x00e676 });
    const sign = new THREE.Mesh(signGeo, signMat);
    sign.position.set(0, 2.2, 1.2);
    group.add(sign);

    group.position.set(6, 0, -4);
    group.visible = false; // Hidden in DCC Editor; only visible when Play button is pressed
    scene.add(group);
    return group;
  }

  // Shoot Energy Projectile
  function shootProjectile() {
    if (!S.playing || !S.player) return;

    const projGeo = new THREE.SphereGeometry(0.1, 8, 8);
    const projMat = new THREE.MeshBasicMaterial({ color: 0x00e5ff });
    const proj = new THREE.Mesh(projGeo, projMat);

    const spawnPos = new THREE.Vector3(0.45, 0.75, 0.5).applyQuaternion(S.player.quaternion).add(S.player.position);
    proj.position.copy(spawnPos);

    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ')).normalize();
    proj.userData = { velocity: fwd.multiplyScalar(28.0), life: 2.0 };

    scene.add(proj);
    S.projectiles.push(proj);
  }

  // Pointer lock mouse look
  function onMouseMove(e) {
    if (!S.playing || !S.mouseLocked) return;
    const sensitivity = 0.0022;
    S.yaw -= e.movementX * sensitivity;
    S.pitch -= e.movementY * sensitivity;
    S.pitch = Math.max(-Math.PI / 2.3, Math.min(Math.PI / 2.3, S.pitch));
  }

  // Enter Play Mode (ONLY called when user clicks ▶ Play or Alt+P)
  function startPlay() {
    if (S.playing) return;
    S.playing = true;

    // Save DCC editor camera
    const cam = camera();
    S.savedCamPos.copy(cam.position);
    S.savedCamTarget.copy(controls.target);
    controls.enabled = false;

    // Reveal player & kiosk
    if (!S.player) S.player = buildPlayer();
    S.player.visible = true;

    if (!S.kiosk) S.kiosk = buildKiosk();
    S.kiosk.visible = true;

    // Wake companion bot
    companion?.setActive(true);

    // Reset player position
    S.player.position.set(0, 0, 0);
    S.velocity.set(0, 0, 0);
    S.yaw = 0;
    S.pitch = 0;

    // UI Updates
    document.body.classList.add('in-game');
    updateHUD(true);
    status('🎮 Play Mode: WASD move · Mouse aim · Click shoot · Esc exit');

    canvas.requestPointerLock();
  }

  // Exit Play Mode (Return to 100% quiet DCC Editor)
  function stopPlay() {
    if (!S.playing) return;
    S.playing = false;

    document.exitPointerLock?.();
    if (S.player) S.player.visible = false;
    if (S.kiosk) S.kiosk.visible = false;
    companion?.setActive(false); // Companion goes completely dormant and silent

    // Restore DCC editor camera
    const cam = camera();
    cam.position.copy(S.savedCamPos);
    controls.target.copy(S.savedCamTarget);
    controls.enabled = true;

    document.body.classList.remove('in-game');
    updateHUD(false);
    status('Returned to DCC Editor.');
  }

  // Toggle Play
  function togglePlay() {
    if (S.playing) stopPlay();
    else startPlay();
  }

  // Input listeners: Only activate on explicit Alt+P or button click
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyP' && e.altKey) {
      e.preventDefault();
      togglePlay();
      return;
    }
    if (!S.playing) return;
    if (e.code === 'KeyW') S.keys.w = true;
    if (e.code === 'KeyA') S.keys.a = true;
    if (e.code === 'KeyS') S.keys.s = true;
    if (e.code === 'KeyD') S.keys.d = true;
    if (e.code === 'Space') S.keys.space = true;
    if (e.code === 'ShiftLeft') S.keys.shift = true;
    if (e.code === 'Escape') stopPlay();
    if (e.code === 'KeyE' && S.nearKiosk) {
      interactKiosk();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (!S.playing) return;
    if (e.code === 'KeyW') S.keys.w = false;
    if (e.code === 'KeyA') S.keys.a = false;
    if (e.code === 'KeyS') S.keys.s = false;
    if (e.code === 'KeyD') S.keys.d = false;
    if (e.code === 'Space') S.keys.space = false;
    if (e.code === 'ShiftLeft') S.keys.shift = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!S.playing) return;
    if (!S.mouseLocked) {
      canvas.requestPointerLock();
    } else if (e.button === 0) {
      shootProjectile();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    S.mouseLocked = document.pointerLockElement === canvas;
  });

  window.addEventListener('mousemove', onMouseMove);

  // Kiosk Interaction Modal
  async function interactKiosk() {
    const user = auth?.getUser() || { name: 'Creator', wallet_credits: 500 };
    companion?.showBubble('Welcome to the Metaverse Kiosk! Transferring credits to your Google Agent...', 'happy');
    
    // Simulate immediate metaverse transaction
    try {
      const tx = await auth?.wallet?.transact({
        action: 'transfer',
        amount: 50,
        reason: 'Cafe Kiosk Coffee & Agent Boost',
        targetAgent: 'Google Assistant / Agent Wallet',
      });
      status(`Kiosk transaction approved! 50 Credits transferred to Google Agent. Balance: ${tx?.new_balance || user.wallet_credits}`);
    } catch (err) {
      status('Kiosk error: ' + err.message);
    }
  }

  // Create In-Game HUD Elements
  function createHUD() {
    let hud = document.getElementById('gameHUD');
    if (hud) return hud;

    hud = document.createElement('div');
    hud.id = 'gameHUD';
    hud.className = 'game-hud hidden';
    hud.innerHTML = `
      <div class="hud-crosshair">+</div>
      <div class="hud-top">
        <div class="hud-chip"><b>Player:</b> <span id="hudPlayerName">Creator</span></div>
        <div class="hud-chip"><b>Credits:</b> <span id="hudCredits">1,000</span></div>
        <button id="hudExitBtn" class="hud-exit" title="Exit to DCC Editor (Esc)">✕ Exit Game</button>
      </div>
      <div id="hudKioskPrompt" class="hud-prompt hidden">[E] Interact with Shopkeeper Bot</div>
      <div class="hud-bottom">
        <div class="hud-bar"><span class="hud-bar-fill" style="width: 100%"></span></div>
        <div class="hud-hint">WASD move · Space jump · Click shoot · V voice · E interact · Esc DCC</div>
      </div>
    `;
    document.body.appendChild(hud);
    hud.querySelector('#hudExitBtn').onclick = () => stopPlay();
    return hud;
  }

  function updateHUD(visible) {
    const hud = createHUD();
    hud.classList.toggle('hidden', !visible);
    if (visible && auth) {
      const u = auth.getUser();
      hud.querySelector('#hudPlayerName').textContent = u.name;
      hud.querySelector('#hudCredits').textContent = `${u.wallet_credits} Credits`;
    }
  }

  // Per-Frame Game Physics & Render Tick
  function tick(delta = 0.016) {
    if (!S.playing || !S.player) return;

    // Movement Physics
    const speed = S.keys.shift ? 10.0 : 5.5;
    const moveDir = new THREE.Vector3();

    if (S.keys.w) moveDir.z -= 1;
    if (S.keys.s) moveDir.z += 1;
    if (S.keys.a) moveDir.x -= 1;
    if (S.keys.d) moveDir.x += 1;
    moveDir.normalize();

    // Rotate movement by yaw
    moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), S.yaw);

    // Horizontal velocity
    S.velocity.x = moveDir.x * speed;
    S.velocity.z = moveDir.z * speed;

    // Jumping & Gravity
    if (S.keys.space && S.onGround) {
      S.velocity.y = 7.5;
      S.onGround = false;
    }
    S.velocity.y -= 19.6 * delta; // Gravity

    // Update position
    S.player.position.addScaledVector(S.velocity, delta);

    // Floor collision
    if (S.player.position.y <= 0) {
      S.player.position.y = 0;
      S.velocity.y = 0;
      S.onGround = true;
    }

    // Orient player mesh towards horizontal look yaw
    S.player.rotation.y = S.yaw;

    // Third-person camera follow
    const cam = camera();
    const camOffset = new THREE.Vector3(0, 1.8, 3.2).applyEuler(new THREE.Euler(S.pitch, S.yaw, 0, 'YXZ'));
    const targetCamPos = S.player.position.clone().add(camOffset);
    cam.position.copy(targetCamPos);

    // Look at player head
    const lookTarget = S.player.position.clone().add(new THREE.Vector3(0, 1.3, 0));
    cam.lookAt(lookTarget);

    // Update Companion
    if (companion) {
      const fwd = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(0, S.yaw, 0));
      companion.tick(delta, { position: S.player.position, forward: fwd });
    }

    // Check distance to Kiosk
    if (S.kiosk) {
      const d = S.player.position.distanceTo(S.kiosk.position);
      const prompt = document.getElementById('hudKioskPrompt');
      S.nearKiosk = d < 3.2;
      if (prompt) prompt.classList.toggle('hidden', !S.nearKiosk);
    }

    // Update Projectiles
    for (let i = S.projectiles.length - 1; i >= 0; i--) {
      const p = S.projectiles[i];
      p.position.addScaledVector(p.userData.velocity, delta);
      p.userData.life -= delta;
      if (p.userData.life <= 0) {
        scene.remove(p);
        S.projectiles.splice(i, 1);
      }
    }
  }

  createHUD();

  return {
    startPlay,
    stopPlay,
    togglePlay,
    isPlaying: () => S.playing,
    getPlayerPosition: () => S.player ? S.player.position.clone() : new THREE.Vector3(),
    tick,
  };
}
