// Shift+A add menu. Opens at the pointer inside the viewport.
import { ADD_ITEMS, createPrimitive, triangleCount } from './primitives.js';

export function createAddMenu(ctx) {
  const el = document.createElement('div');
  el.id = 'addMenu';
  el.className = 'hidden';
  el.innerHTML = `<input id="addSearch" placeholder="Search" autocomplete="off"><div id="addList"></div>`;
  document.body.appendChild(el);
  const search = el.querySelector('#addSearch');
  const list = el.querySelector('#addList');
  let items = ADD_ITEMS.slice();
  let hi = 0;

  function paint() {
    const q = search.value.trim().toLowerCase();
    const shown = items.filter((it) => !q || it.label.toLowerCase().includes(q) || it.id.includes(q));
    hi = Math.min(hi, Math.max(0, shown.length - 1));
    list.innerHTML = shown.map((it, i) => `<button type="button" data-id="${it.id}" class="${i === hi ? 'on' : ''}"><small>${it.group}</small>${it.label}</button>`).join('')
      || '<div class="hint0">No match</div>';
    list.querySelectorAll('button').forEach((b) => { b.onmousedown = (e) => { e.preventDefault(); choose(b.dataset.id); }; });
    return shown;
  }
  function choose(id) {
    close();
    if (id === 'sky' || id === 'water') { ctx.addEnvironment?.(id); return; }
    const obj = createPrimitive(id);
    if (!obj) { ctx.status?.('Unknown add item'); return; }
    ctx.add(obj, { label: obj.name, source: 'primitive' });
    const tris = triangleCount(obj);
    ctx.status?.(`Added ${obj.name} (${tris.toLocaleString()} tris). Other objects were left in place.`);
  }
  function open(x, y) {
    el.classList.remove('hidden');
    const pad = 8;
    const w = 240, h = 320;
    el.style.left = Math.max(pad, Math.min(x, window.innerWidth - w - pad)) + 'px';
    el.style.top = Math.max(pad, Math.min(y, window.innerHeight - h - pad)) + 'px';
    search.value = '';
    hi = 0;
    paint();
    setTimeout(() => search.focus(), 0);
  }
  function close() { el.classList.add('hidden'); }
  search.oninput = () => { hi = 0; paint(); };
  search.onkeydown = (e) => {
    const shown = paint();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); hi = Math.min(shown.length - 1, hi + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, hi - 1); paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[hi]) choose(shown[hi].id); }
  };
  document.addEventListener('pointerdown', (e) => { if (!el.contains(e.target)) close(); });

  return {
    open, close, choose, items: () => ADD_ITEMS.map((i) => i.id),
    isOpen: () => !el.classList.contains('hidden'),
  };
}
