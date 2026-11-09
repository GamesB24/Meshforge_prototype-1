// MeshForge Animation Suite: Keyframing, Timeline, Dopesheet, and glTF Animation Clip Export.
import * as THREE from 'three';

export function createAnimationTimeline(ctx) {
  const { scene, editor, getModel, status } = ctx;

  const S = {
    visible: true,
    playing: false,
    currentFrame: 0,
    startFrame: 0,
    endFrame: 120,
    fps: 30,
    loop: true,
    autoKey: false,
    selectedTrack: 'all',
    // Keyframe database: objectUUID -> { property -> [ { frame, value } ] }
    keyframeData: new Map(),
    mixer: null,
    activeAction: null,
    clock: new THREE.Clock(),
    lastFrameTime: 0,
  };

  S.mixer = new THREE.AnimationMixer(scene);

  // ---------- Keyframing Core ----------
  function getObjectKeyframes(obj) {
    if (!obj) return null;
    if (!S.keyframeData.has(obj.uuid)) {
      S.keyframeData.set(obj.uuid, {
        position: [],
        rotation: [],
        scale: [],
      });
    }
    return S.keyframeData.get(obj.uuid);
  }

  function insertKeyframe(obj = editor.sel, channels = 'all', frame = S.currentFrame) {
    if (!obj) {
      status('No object selected to keyframe.');
      return false;
    }

    const data = getObjectKeyframes(obj);
    const pos = obj.position.toArray();
    const rot = [obj.rotation.x, obj.rotation.y, obj.rotation.z];
    const scl = obj.scale.toArray();

    if (channels === 'all' || channels === 'loc') {
      upsertFrame(data.position, frame, pos);
    }
    if (channels === 'all' || channels === 'rot') {
      upsertFrame(data.rotation, frame, rot);
    }
    if (channels === 'all' || channels === 'scale') {
      upsertFrame(data.scale, frame, scl);
    }

    renderDopesheet();
    bakeAnimationClip(obj);
    status(`Recorded keyframe for ${obj.name} at frame ${frame} (${channels.toUpperCase()})`);
    return true;
  }

  function upsertFrame(track, frame, val) {
    const idx = track.findIndex((k) => k.frame === frame);
    if (idx >= 0) track[idx].val = [...val];
    else {
      track.push({ frame, val: [...val] });
      track.sort((a, b) => a.frame - b.frame);
    }
  }

  function deleteKeyframeAtCurrent() {
    const obj = editor.sel;
    if (!obj) return;
    const data = getObjectKeyframes(obj);
    for (const key of ['position', 'rotation', 'scale']) {
      data[key] = data[key].filter((k) => k.frame !== S.currentFrame);
    }
    renderDopesheet();
    bakeAnimationClip(obj);
    status(`Deleted keyframes at frame ${S.currentFrame}`);
  }

  // Hotkey 'I' for keyframe insert
  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyI' && !e.repeat && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      if (editor.sel) insertKeyframe(editor.sel, 'all');
    }
  });

  // Bake Keyframes to Three.js AnimationClip
  function bakeAnimationClip(obj) {
    if (!obj) return null;
    const data = getObjectKeyframes(obj);
    const tracks = [];

    // Position track
    if (data.position.length > 0) {
      const times = data.position.map((k) => k.frame / S.fps);
      const values = data.position.flatMap((k) => k.val);
      tracks.push(new THREE.VectorKeyframeTrack(`${obj.name}.position`, times, values));
    }

    // Rotation track (Euler to Quaternion)
    if (data.rotation.length > 0) {
      const times = data.rotation.map((k) => k.frame / S.fps);
      const quatValues = [];
      const euler = new THREE.Euler();
      const q = new THREE.Quaternion();
      for (const k of data.rotation) {
        euler.set(k.val[0], k.val[1], k.val[2]);
        q.setFromEuler(euler);
        quatValues.push(q.x, q.y, q.z, q.w);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(`${obj.name}.quaternion`, times, quatValues));
    }

    // Scale track
    if (data.scale.length > 0) {
      const times = data.scale.map((k) => k.frame / S.fps);
      const values = data.scale.flatMap((k) => k.val);
      tracks.push(new THREE.VectorKeyframeTrack(`${obj.name}.scale`, times, values));
    }

    if (tracks.length === 0) return null;

    const clip = new THREE.AnimationClip(`${obj.name}_Action`, (S.endFrame - S.startFrame) / S.fps, tracks);
    obj.animations = [clip];

    // Bind to mixer
    S.mixer.stopAllAction();
    S.activeAction = S.mixer.clipAction(clip, obj);
    S.activeAction.setLoop(S.loop ? THREE.LoopRepeat : THREE.LoopOnce);
    if (S.playing) S.activeAction.play();
    return clip;
  }

  // Set Current Frame & Scrubber
  function setFrame(f) {
    S.currentFrame = Math.max(S.startFrame, Math.min(S.endFrame, Math.round(f)));
    const time = S.currentFrame / S.fps;

    // Apply values at current frame to selected object
    const obj = editor.sel;
    if (obj && !S.playing) {
      const data = getObjectKeyframes(obj);
      if (data) {
        interpolateTransform(obj, data, S.currentFrame);
      }
    }

    if (S.activeAction) {
      S.activeAction.time = time;
      S.mixer.update(0);
    }

    updateUI();
  }

  function interpolateTransform(obj, data, frame) {
    // Linear interpolation between surrounding keyframes
    const sample = (track) => {
      if (!track || track.length === 0) return null;
      if (frame <= track[0].frame) return track[0].val;
      if (frame >= track[track.length - 1].frame) return track[track.length - 1].val;
      for (let i = 0; i < track.length - 1; i++) {
        if (frame >= track[i].frame && frame <= track[i + 1].frame) {
          const t = (frame - track[i].frame) / (track[i + 1].frame - track[i].frame);
          return track[i].val.map((v, idx) => v + t * (track[i + 1].val[idx] - v));
        }
      }
      return null;
    };

    const p = sample(data.position);
    if (p) obj.position.set(p[0], p[1], p[2]);

    const r = sample(data.rotation);
    if (r) obj.rotation.set(r[0], r[1], r[2]);

    const s = sample(data.scale);
    if (s) obj.scale.set(s[0], s[1], s[2]);

    obj.updateMatrixWorld();
  }

  // Transport Controls
  function play() {
    S.playing = true;
    if (S.activeAction) S.activeAction.play();
    updateUI();
  }

  function pause() {
    S.playing = false;
    if (S.activeAction) S.activeAction.paused = true;
    updateUI();
  }

  function togglePlay() {
    if (S.playing) pause();
    else play();
  }

  // Animation Update Loop Tick
  function tick(delta = 0.016) {
    if (S.playing) {
      S.currentFrame += delta * S.fps;
      if (S.currentFrame > S.endFrame) {
        if (S.loop) S.currentFrame = S.startFrame;
        else {
          S.currentFrame = S.endFrame;
          pause();
        }
      }
      setFrame(S.currentFrame);
      S.mixer.update(delta);
    }
  }

  // ---------- UI Creation ----------
  function createTimelineUI() {
    let bar = document.getElementById('animTimelineBar');
    if (bar) return bar;

    bar = document.createElement('div');
    bar.id = 'animTimelineBar';
    bar.className = 'anim-timeline-bar';
    bar.innerHTML = `
      <div class="anim-transport">
        <button id="tlToggleDock" class="anim-btn" title="Toggle Timeline">▼ Timeline</button>
        <button id="tlStart" class="anim-btn" title="First Frame (Shift+Left)">⏮</button>
        <button id="tlPrev" class="anim-btn" title="Step Back (Left)">◀</button>
        <button id="tlPlay" class="anim-btn play" title="Play / Pause (Space)">▶</button>
        <button id="tlNext" class="anim-btn" title="Step Forward (Right)">▶</button>
        <button id="tlEnd" class="anim-btn" title="Last Frame (Shift+Right)">⏭</button>
        <button id="tlLoop" class="anim-btn on" title="Loop Toggle">🔁</button>
        <span class="sep"></span>
        <button id="tlKeyframe" class="anim-btn key" title="Insert Keyframe (I)">◆ Key</button>
        <button id="tlAutoKey" class="anim-btn" title="Auto-Keying Toggle">⏺ Auto</button>
        <button id="tlDelKey" class="anim-btn" title="Delete Keyframe at Current Frame">🗑</button>
        <span class="grow"></span>
        <div class="anim-frame-input">
          <label>Frame:</label>
          <input id="tlCurrentVal" type="number" value="0" min="0" max="240">
          <label>/</label>
          <input id="tlEndVal" type="number" value="120" min="10" max="1000">
        </div>
      </div>
      <div class="anim-dopesheet-wrap">
        <div class="anim-tracks-list" id="tlTrackList">
          <div class="track-hdr">Channels</div>
          <div class="track-row" data-ch="position">Position</div>
          <div class="track-row" data-ch="rotation">Rotation</div>
          <div class="track-row" data-ch="scale">Scale</div>
        </div>
        <div class="anim-ruler-wrap" id="tlRulerWrap">
          <canvas id="tlDopesheetCanvas" height="96"></canvas>
          <div id="tlPlayhead" class="anim-playhead"></div>
        </div>
      </div>
    `;
    document.body.appendChild(bar);

    // Event hooks
    bar.querySelector('#tlPlay').onclick = () => togglePlay();
    bar.querySelector('#tlStart').onclick = () => setFrame(S.startFrame);
    bar.querySelector('#tlEnd').onclick = () => setFrame(S.endFrame);
    bar.querySelector('#tlPrev').onclick = () => setFrame(S.currentFrame - 1);
    bar.querySelector('#tlNext').onclick = () => setFrame(S.currentFrame + 1);
    bar.querySelector('#tlKeyframe').onclick = () => insertKeyframe(editor.sel, 'all');
    bar.querySelector('#tlDelKey').onclick = () => deleteKeyframeAtCurrent();

    const loopBtn = bar.querySelector('#tlLoop');
    loopBtn.onclick = () => {
      S.loop = !S.loop;
      loopBtn.classList.toggle('on', S.loop);
    };

    const autoKeyBtn = bar.querySelector('#tlAutoKey');
    autoKeyBtn.onclick = () => {
      S.autoKey = !S.autoKey;
      autoKeyBtn.classList.toggle('on', S.autoKey);
    };

    const curInp = bar.querySelector('#tlCurrentVal');
    curInp.onchange = () => setFrame(parseFloat(curInp.value) || 0);

    const endInp = bar.querySelector('#tlEndVal');
    endInp.onchange = () => {
      S.endFrame = parseInt(endInp.value, 10) || 120;
      renderDopesheet();
    };

    const toggleDockBtn = bar.querySelector('#tlToggleDock');
    toggleDockBtn.onclick = () => {
      bar.classList.toggle('collapsed');
      toggleDockBtn.textContent = bar.classList.contains('collapsed') ? '▲ Timeline' : '▼ Timeline';
    };

    // Scrubber drag on ruler canvas
    const rulerWrap = bar.querySelector('#tlRulerWrap');
    let draggingScrubber = false;
    const scrub = (e) => {
      const rect = rulerWrap.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const f = (x / rect.width) * (S.endFrame - S.startFrame) + S.startFrame;
      setFrame(f);
    };
    rulerWrap.onmousedown = (e) => {
      draggingScrubber = true;
      scrub(e);
    };
    window.addEventListener('mousemove', (e) => {
      if (draggingScrubber) scrub(e);
    });
    window.addEventListener('mouseup', () => {
      draggingScrubber = false;
    });

    renderDopesheet();
    return bar;
  }

  // Draw Dopesheet Diamond Markers on Canvas
  function renderDopesheet() {
    const canvas = document.getElementById('tlDopesheetCanvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    canvas.width = wrap.clientWidth;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = '#22262d';
    ctx.fillRect(0, 0, w, h);

    // Draw frame notches and grid
    const totalFrames = S.endFrame - S.startFrame;
    const step = Math.max(1, Math.round(totalFrames / 20));
    ctx.strokeStyle = '#323742';
    ctx.fillStyle = '#7a8291';
    ctx.font = '10px monospace';

    for (let f = S.startFrame; f <= S.endFrame; f += step) {
      const x = ((f - S.startFrame) / totalFrames) * w;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(String(f), x + 2, 12);
    }

    // Render keyframes for currently selected object
    const obj = editor.sel;
    if (obj) {
      const data = getObjectKeyframes(obj);
      const rows = [
        { key: 'position', y: 32, color: '#e8963a' },
        { key: 'rotation', y: 56, color: '#4f7fd6' },
        { key: 'scale', y: 80, color: '#6bbf59' },
      ];

      for (const row of rows) {
        const track = data[row.key] || [];
        ctx.fillStyle = row.color;
        for (const k of track) {
          const x = ((k.frame - S.startFrame) / totalFrames) * w;
          // Draw diamond marker ◆
          ctx.beginPath();
          ctx.moveTo(x, row.y - 5);
          ctx.lineTo(x + 5, row.y);
          ctx.lineTo(x, row.y + 5);
          ctx.lineTo(x - 5, row.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
  }

  function updateUI() {
    const playBtn = document.getElementById('tlPlay');
    if (playBtn) playBtn.textContent = S.playing ? '⏸' : '▶';

    const curInp = document.getElementById('tlCurrentVal');
    if (curInp && document.activeElement !== curInp) curInp.value = Math.round(S.currentFrame);

    const playhead = document.getElementById('tlPlayhead');
    const wrap = document.getElementById('tlRulerWrap');
    if (playhead && wrap) {
      const frac = (S.currentFrame - S.startFrame) / (S.endFrame - S.startFrame);
      playhead.style.left = `${frac * 100}%`;
    }
  }

  createTimelineUI();

  return {
    insertKeyframe,
    deleteKeyframe: deleteKeyframeAtCurrent,
    setFrame,
    play,
    pause,
    togglePlay,
    tick,
    bakeAnimationClip,
    renderDopesheet,
    isAutoKey: () => S.autoKey,
  };
}
