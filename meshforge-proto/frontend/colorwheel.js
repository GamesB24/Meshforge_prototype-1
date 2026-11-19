// MeshForge colour wheel (original MIT code): hue around the ring, saturation towards the rim, value slider below.
import * as THREE from 'three';
export function createColorWheel(host, onChange, size = 150) {
  const wrap = document.createElement('div'); wrap.className = 'cwheel';
  wrap.innerHTML = `<canvas width="${size}" height="${size}"></canvas><div class="cwrow"><input type="range" class="cwv" min="0" max="1" step="0.01" value="1" title="Value (brightness)"><input type="text" class="cwhex txt" value="#ffffff" maxlength="7" title="Hex colour"><span class="cwsw"></span></div>`;
  host.appendChild(wrap);
  const cv = wrap.querySelector('canvas'), g = cv.getContext('2d'), vIn = wrap.querySelector('.cwv'), hex = wrap.querySelector('.cwhex'), sw = wrap.querySelector('.cwsw');
  const R = size / 2 - 3; let hsv = { h: 0, s: 0, v: 1 };
  function hsv2rgb(h, s, v) { const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); }; return [f(5), f(3), f(1)]; }
  function rgb2hsv(r, g2, b) { const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), d = mx - mn; let h = 0;
    if (d) h = mx === r ? ((g2 - b) / d) % 6 : mx === g2 ? (b - r) / d + 2 : (r - g2) / d + 4; h = ((h / 6) + 1) % 1; return { h, s: mx ? d / mx : 0, v: mx }; }
  const toHex = (rgb) => '#' + rgb.map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255).toString(16).padStart(2, '0')).join('');
  function draw() {
    const im = g.createImageData(size, size), c = size / 2;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c, r = Math.hypot(dx, dy), i = (y * size + x) * 4; if (r > R + 1) continue;
      const [rr, gg, bb] = hsv2rgb(((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1, Math.min(1, r / R), hsv.v);
      im.data[i] = rr * 255; im.data[i + 1] = gg * 255; im.data[i + 2] = bb * 255; im.data[i + 3] = r > R ? (R + 1 - r) * 255 : 255;
    }
    g.putImageData(im, 0, 0);
    const a = hsv.h * 2 * Math.PI, px = c + Math.cos(a) * hsv.s * R, py = c + Math.sin(a) * hsv.s * R;
    g.lineWidth = 2; g.strokeStyle = '#000'; g.beginPath(); g.arc(px, py, 6, 0, 7); g.stroke(); g.strokeStyle = '#fff'; g.beginPath(); g.arc(px, py, 4.5, 0, 7); g.stroke();
    const h = toHex(hsv2rgb(hsv.h, hsv.s, hsv.v)); if (document.activeElement !== hex) hex.value = h; sw.style.background = h; vIn.value = hsv.v;
  }
  function emit() { draw(); onChange?.(toHex(hsv2rgb(hsv.h, hsv.s, hsv.v))); }
  let drag = false;
  const pick = (e) => { const r = cv.getBoundingClientRect(), dx = (e.clientX - r.left) * size / r.width - size / 2, dy = (e.clientY - r.top) * size / r.height - size / 2;
    hsv.h = ((Math.atan2(dy, dx) / (2 * Math.PI)) + 1) % 1; hsv.s = Math.min(1, Math.hypot(dx, dy) / R); if (hsv.v < 0.05) hsv.v = 1; emit(); };
  cv.addEventListener('pointerdown', (e) => { drag = true; cv.setPointerCapture(e.pointerId); pick(e); });
  cv.addEventListener('pointermove', (e) => { if (drag) pick(e); });
  cv.addEventListener('pointerup', () => { drag = false; });
  vIn.oninput = () => { hsv.v = +vIn.value; emit(); };
  hex.onchange = () => { const v = hex.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(v)) { set(v.startsWith('#') ? v : '#' + v); onChange?.(toHex(hsv2rgb(hsv.h, hsv.s, hsv.v))); } };
  function set(h) { const c = new THREE.Color(h); const s = c.getHexString(); const r = parseInt(s.slice(0, 2), 16) / 255, gg = parseInt(s.slice(2, 4), 16) / 255, b = parseInt(s.slice(4, 6), 16) / 255; hsv = rgb2hsv(r, gg, b); draw(); }
  draw();
  return { set, get hex() { return toHex(hsv2rgb(hsv.h, hsv.s, hsv.v)); }, el: wrap, pickAt: (fx, fy) => pick({ clientX: cv.getBoundingClientRect().left + fx * cv.getBoundingClientRect().width, clientY: cv.getBoundingClientRect().top + fy * cv.getBoundingClientRect().height }) };
}
