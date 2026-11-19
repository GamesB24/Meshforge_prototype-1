// Bundled example: every major v7.1 API in a small, original MIT module.
export async function activate(mf) {
  const {panel} = mf.registerTab({id:'example', label:'Example', order:100,
    onEnter:()=>{}, onLeave:()=>{}});
  panel.innerHTML = '<details open><summary>Plugin example</summary><button id="exJob" class="primary">Run backend job</button><div id="exProgress" class="hint0"></div><button id="exScene" class="btn">Count scene objects</button><div id="exSceneOut" class="hint0"></div><label class="hint0">Session API key (not stored)</label><input id="exSecret" type="password" autocomplete="new-password"><button id="exSecretSet" class="btn">Set for this session</button><div id="exSecretStatus" class="hint0"></div></details>';
  const q = id => panel.querySelector(id);
  q('#exSecretSet').onclick = () => { const msg = mf.secrets.set('Gemini', q('#exSecret').value); q('#exSecret').value=''; q('#exSecretStatus').textContent = msg; };
  q('#exJob').onclick = async () => {
    q('#exProgress').textContent='Starting…';
    const r=await mf.backend('work',{method:'POST',headers:{...mf.secrets.header('Gemini')}});
    if(!r.ok){q('#exProgress').textContent='Backend error '+r.status;return;}
    const {job_id}=await r.json(); const j=await mf.jobs.poll(job_id,p=>q('#exProgress').textContent=`${p.status}: ${Math.round(p.progress*100)}% ${p.message}`);
    q('#exProgress').textContent=j.status==='done'?j.result.message:j.error;
  };
  q('#exScene').onclick=()=>{q('#exSceneOut').textContent=`Scene API: ${mf.api.getObjects().length} object(s)`;};
  const side=mf.registerPanel({id:'example',title:'Example plugin',location:'right'}).el;
  side.innerHTML='<span class="hint0">Tab, panel, jobs, memory-only secret and scene API example.</span>';
  panel.dataset.asset=mf.assetURL('plugin.json');
}
export function deactivate() {}
