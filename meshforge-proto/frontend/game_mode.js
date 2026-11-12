// MeshForge play runtime. Runs the user's current scene: timeline keys, glTF clips and behaviours.
// Stop restores every content object's transform, visibility and colour, and drops objects spawned during play.
// Original MIT code. The old built-in shooter / kiosk / drone launch has been removed from this path.
import * as THREE from 'three';
import { listBehaviours } from './behaviours.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

export function createGameMode(ctx) {
  const { scene, canvas, camera, controls, status, getModel, editor, anim, isLandscape } = ctx;

  const S = {
    state: 'edit', // edit | play | pause
    snapshot: null,
    time: 0,
    keys: {},
    following: false,
    mixer: null,
    scriptErrors: new Set(),
  };

  function contentRoot() {
    return getModel?.() || null;
  }

  function eachContent(fn) {
    const root = contentRoot();
    if (!root) return;
    root.traverse((o) => {
      if (o.isMesh && !o.userData.isOverlay && !o.userData.isSelection) fn(o);
    });
  }

  function findByName(name) {
    if (!name) return null;
    let found = null;
    eachContent((o) => { if (!found && o.name === name) found = o; });
    return found;
  }

  function capture() {
    const objects = [];
    eachContent((o) => {
      const col = o.material && !Array.isArray(o.material) && o.material.color ? o.material.color.getHex() : null;
      objects.push({
        uuid: o.uuid,
        object: o,
        parent: o.parent,
        position: o.position.clone(),
        quaternion: o.quaternion.clone(),
        scale: o.scale.clone(),
        visible: o.visible,
        color: col,
      });
    });
    const cam = camera();
    return {
      objects,
      ids: new Set(objects.map((o) => o.uuid)),
      camPos: cam.position.clone(),
      camTarget: controls.target.clone(),
      frame: anim?.getFrame?.() ?? 0,
    };
  }

  function clearRuntimeTemps() {
    eachContent((o) => {
      for (const b of o.userData.behaviours || []) {
        delete b._base; delete b._ground; delete b._vy; delete b._facing; delete b._fn; delete b._err;
      }
    });
    S.scriptErrors.clear();
  }

  function restore(snap) {
    if (!snap) return;
    const root = contentRoot();
    if (root) {
      const extra = [];
      root.traverse((o) => {
        if (o !== root && o.parent === root && !o.userData.isOverlay && !snap.ids.has(o.uuid) && (o.isMesh || o.isGroup)) extra.push(o);
      });
      extra.forEach((o) => o.parent.remove(o));
    }
    for (const rec of snap.objects) {
      const o = rec.object;
      if (!o.parent && rec.parent) rec.parent.add(o);
      o.position.copy(rec.position);
      o.quaternion.copy(rec.quaternion);
      o.scale.copy(rec.scale);
      o.visible = rec.visible;
      if (rec.color != null && o.material && !Array.isArray(o.material) && o.material.color) o.material.color.setHex(rec.color);
      o.updateMatrixWorld(true);
    }
    const cam = camera();
    cam.position.copy(snap.camPos);
    controls.target.copy(snap.camTarget);
    cam.lookAt(controls.target);
    controls.enabled = true;
    controls.update();
  }

  function stopClips() {
    if (S.mixer) { S.mixer.stopAllAction(); S.mixer = null; }
  }

  function startClips() {
    stopClips();
    const root = contentRoot();
    if (!root) return;
    const keyed = new Set(anim?.keyedNames?.() || []);
    const found = [];
    const take = (clips) => { for (const c of clips || []) if (c?.tracks?.length) found.push(c); };
    take(root.animations);
    root.traverse((o) => take(o.animations));
    if (!found.length) return;
    S.mixer = new THREE.AnimationMixer(root);
    for (const clip of found) {
      const tracks = clip.tracks.filter((t) => !keyed.has(String(t.name).split('.')[0]));
      if (!tracks.length) continue;
      const sub = new THREE.AnimationClip(clip.name || 'clip', clip.duration, tracks);
      S.mixer.clipAction(sub, root).play();
    }
  }

  function armBehaviours() {
    eachContent((o) => {
      for (const b of listBehaviours(o)) {
        const live = (o.userData.behaviours || []).find((x) => x.type === b.type) || b;
        if (live.type === 'oscillate') live._base = o.position.clone();
        if (live.type === 'character') { live._ground = o.position.y; live._vy = 0; delete live._facing; }
      }
    });
  }

  function runScript(obj, beh, dt) {
    const source = String(beh.params?.source || '');
    if (!source.trim()) return;
    if (!beh._fn) {
      try { beh._fn = new Function('api', '"use strict";\n' + source); }
      catch (err) {
        if (!beh._err) { beh._err = true; status(`Script on ${obj.name} failed to parse: ${err.message}`); }
        return;
      }
    }
    const api = {
      dt,
      time: S.time,
      name: obj.name,
      position: obj.position,
      rotation: obj.rotation,
      scale: obj.scale,
      object: obj,
      get: (name) => findByName(name),
      key: (code) => !!S.keys[code],
    };
    try { beh._fn(api); }
    catch (err) {
      const id = obj.uuid + source;
      if (!S.scriptErrors.has(id)) { S.scriptErrors.add(id); status(`Script on ${obj.name}: ${err.message}`); }
    }
  }

  function stepCharacter(obj, beh, dt) {
    const p = beh.params || {};
    const speed = (S.keys.ShiftLeft || S.keys.ShiftRight ? 1.8 : 1) * (p.speed ?? 4.5);
    const cam = camera();
    cam.getWorldDirection(_fwd);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
    _fwd.normalize();
    _right.crossVectors(_fwd, _up).normalize();
    _move.set(0, 0, 0);
    if (S.keys.KeyW) _move.add(_fwd);
    if (S.keys.KeyS) _move.sub(_fwd);
    if (S.keys.KeyD) _move.add(_right);
    if (S.keys.KeyA) _move.sub(_right);
    if (_move.lengthSq() > 0) {
      _move.normalize().multiplyScalar(speed * dt);
      const parent = obj.parent;
      const world = obj.getWorldPosition(new THREE.Vector3()).add(_move);
      if (parent) obj.position.copy(parent.worldToLocal(world));
      else obj.position.copy(world);
      if (!beh._facing) beh._facing = new THREE.Vector3();
      beh._facing.set(_move.x, 0, _move.z);
      if (beh._facing.lengthSq() > 1e-8) {
        beh._facing.normalize();
        obj.rotation.y = Math.atan2(beh._facing.x, beh._facing.z);
      }
    }
    if (S.keys.Space && beh._vy === 0 && obj.position.y <= beh._ground + 0.02) beh._vy = p.jump ?? 6;
    beh._vy -= 18 * dt;
    obj.position.y += beh._vy * dt;
    if (obj.position.y <= beh._ground) { obj.position.y = beh._ground; beh._vy = 0; }
    if (p.camera === 'follow') {
      S.following = true;
      const facing = beh._facing && beh._facing.lengthSq() > 0 ? beh._facing : _fwd;
      const worldPos = obj.getWorldPosition(new THREE.Vector3());
      cam.position.copy(worldPos).addScaledVector(facing, -3.2);
      cam.position.y = worldPos.y + 1.7;
      controls.target.copy(worldPos).add(new THREE.Vector3(0, 0.9, 0));
      cam.lookAt(controls.target);
    }
  }

  function stepFollow(obj, beh, dt) {
    const p = beh.params || {};
    const target = findByName(p.target);
    if (!target) return;
    const offset = obj.position.clone().sub(target.position);
    offset.y = 0;
    if (offset.lengthSq() < 1e-4) offset.set(1, 0, 0);
    offset.setLength(p.distance ?? 1.6);
    const goal = target.position.clone().add(offset);
    goal.y = target.position.y + (p.height ?? 1.4);
    obj.position.lerp(goal, Math.min(1, dt * 3));
    obj.lookAt(target.position.x, obj.position.y, target.position.z);
  }

  function tickBehaviours(dt) {
    S.following = false;
    eachContent((obj) => {
      for (const beh of obj.userData.behaviours || []) {
        if (beh.enabled === false) continue;
        const p = beh.params || {};
        if (beh.type === 'spin') {
          const axis = p.axis === 'x' || p.axis === 'z' ? p.axis : 'y';
          obj.rotation[axis] += THREE.MathUtils.degToRad(p.speed ?? 90) * dt;
        } else if (beh.type === 'oscillate') {
          if (!beh._base) beh._base = obj.position.clone();
          const axis = p.axis === 'x' || p.axis === 'z' ? p.axis : 'y';
          obj.position[axis] = beh._base[axis] + Math.sin(S.time * (p.speed ?? 2)) * (p.amplitude ?? 0.25);
        } else if (beh.type === 'character') stepCharacter(obj, beh, dt);
        else if (beh.type === 'follow') stepFollow(obj, beh, dt);
        else if (beh.type === 'script') runScript(obj, beh, dt);
      }
    });
    controls.enabled = !(S.state === 'play' && S.following);
  }

  function behaviourCount() {
    let n = 0;
    eachContent((o) => { n += (o.userData.behaviours || []).filter((b) => b.enabled !== false).length; });
    return n;
  }

  function objectCount() {
    let n = 0;
    eachContent(() => { n += 1; });
    return n;
  }

  function setBody(on) {
    document.body.classList.toggle('mf-sim', on);
    const label = document.getElementById('playState');
    if (label) label.textContent = S.state === 'play' ? 'Playing' : S.state === 'pause' ? 'Paused' : 'Edit';
    document.getElementById('btnPlayGame')?.classList.toggle('on', S.state === 'play');
    document.getElementById('btnPauseGame')?.classList.toggle('on', S.state === 'pause');
  }

  function beginSession() {
    S.snapshot = capture();
    S.time = 0;
    S.scriptErrors.clear();
    clearRuntimeTemps();
    editor?.setPlaybackLocked?.(true);
    anim?.pause?.();
    anim?.setFrame?.(anim.getFrame?.() ?? 0);
    armBehaviours();
    anim?.play?.();
    startClips();
    const n = objectCount();
    const b = behaviourCount();
    status(`Playing the current scene · ${n} object${n === 1 ? '' : 's'} · ${b} behaviour${b === 1 ? '' : 's'}`);
  }

  function startPlay(fromStart = false) {
    if (isLandscape?.()) { status('Play runs the main scene. Leave the Landscape workspace first.'); return false; }
    if (editor?.mode && editor.mode !== 'object') { status('Switch to Object Mode before Play.'); return false; }
    if (S.state === 'pause') return resume();
    if (S.state === 'play') return true;
    if (!contentRoot()) { status('Nothing in the scene yet. Add or generate objects, then press Play.'); return false; }
    if (fromStart) anim?.setFrame?.(anim.getStartFrame?.() ?? 0, { apply: false });
    beginSession();
    S.state = 'play';
    setBody(true);
    return true;
  }

  function resume() {
    if (S.state !== 'pause') return false;
    S.state = 'play';
    anim?.play?.();
    controls.enabled = !S.following;
    setBody(true);
    status('Resumed');
    return true;
  }

  function pausePlay() {
    if (S.state !== 'play') return false;
    S.state = 'pause';
    anim?.pause?.();
    controls.enabled = true;
    setBody(true);
    status('Paused · Stop restores the scene to the moment before Play');
    return true;
  }

  function stopPlay() {
    if (S.state === 'edit') return false;
    stopClips();
    anim?.pause?.();
    const frame = S.snapshot?.frame ?? 0;
    anim?.setFrame?.(frame, { apply: false });
    restore(S.snapshot);
    clearRuntimeTemps();
    S.snapshot = null;
    S.time = 0;
    S.state = 'edit';
    S.following = false;
    editor?.setPlaybackLocked?.(false);
    setBody(false);
    status('Stopped. Scene restored to its pre-play state.');
    return true;
  }

  function restart() {
    if (S.state === 'edit') return startPlay(true);
    if (!S.snapshot) return startPlay();
    stopClips();
    anim?.pause?.();
    const snap = S.snapshot;
    anim?.setFrame?.(anim.getStartFrame?.() ?? 0, { apply: false });
    restore(snap);
    clearRuntimeTemps();
    S.snapshot = snap;
    S.time = 0;
    anim?.setFrame?.(anim.getStartFrame?.() ?? 0);
    armBehaviours();
    anim?.play?.();
    startClips();
    S.state = 'play';
    setBody(true);
    status('Restarted from the start of the timeline');
    return true;
  }

  function togglePlay() {
    if (S.state === 'play') return pausePlay();
    return startPlay();
  }

  function handleKey(e) {
    if (e.code === 'KeyP' && e.altKey && !e.repeat) { e.preventDefault(); togglePlay(); return true; }
    if (!isActive()) return false;
    if (e.code === 'Escape') { e.preventDefault(); stopPlay(); return true; }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].includes(e.code)) {
      S.keys[e.code] = true;
      e.preventDefault();
      return true;
    }
    if (['KeyG', 'KeyR', 'Delete', 'Tab'].includes(e.code)) { e.preventDefault(); return true; }
    return false;
  }

  window.addEventListener('keyup', (e) => { S.keys[e.code] = false; });
  canvas.addEventListener('mousedown', (e) => { if (isActive()) e.stopPropagation(); }, true);

  function tick(delta = 0.016) {
    if (S.state !== 'play') return;
    const dt = Math.min(Math.max(delta, 0), 0.05);
    S.time += dt;
    anim?.tick?.(dt);
    if (S.mixer) S.mixer.update(dt);
    tickBehaviours(dt);
    const label = document.getElementById('playState');
    if (label) label.textContent = `Playing ${S.time.toFixed(1)}s`;
  }

  function allowsOrbit() { return S.state !== 'play' || !S.following; }

  function isActive() { return S.state === 'play' || S.state === 'pause'; }
  function isPlaying() { return isActive(); }
  function isSimulating() { return S.state === 'play'; }

  return {
    startPlay,
    stopPlay,
    pausePlay,
    resume,
    restart,
    togglePlay,
    handleKey,
    tick,
    isPlaying,
    isActive,
    isSimulating,
    allowsOrbit,
    getState: () => S.state,
    getPlayerPosition() {
      const player = findByName('Player');
      return player ? player.position.clone() : camera().position.clone();
    },
  };
}
