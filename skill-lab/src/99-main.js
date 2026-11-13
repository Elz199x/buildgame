/* ============================================================
   MODULE 99 — main : โหลดข้อมูล, สร้างหน้าทั้งหมด, สลับแท็บด้วย hash (#sim #tree #editor #data), กระจายข่าวการเปลี่ยนแปลงไปยังหน้าที่เปิดอยู่
   หน้าที่ซ่อนอยู่จะถูกทำเครื่องหมาย dirty และวาดใหม่ตอนเปิดเท่านั้น
============================================================ */
(function(g){
  const SL = g.SL, ui = SL.ui, h = ui.h;
  const NAMES = ['world', 'formulas', 'tree', 'editor', 'models', 'sim', 'data'], sections = {}; let cur = '';

  SL.loadAll();
  // เปิดครั้งแรกให้มีตัวละครตัวอย่างพร้อมใช้
  try{
    if(!localStorage.getItem('roSkillLabSeeded_v1') && !Object.keys(SL.state.get().learned).length){
      SL.rules.applyBuild('bld_striker'); localStorage.setItem('roSkillLabSeeded_v1', '1');
    }
  }catch(e){ if(!Object.keys(SL.state.get().learned).length) SL.rules.applyBuild('bld_striker'); }

  const view = document.getElementById('view');
  NAMES.forEach(n => { sections[n] = h('section', { id: 'page-' + n, hidden: true }); view.appendChild(sections[n]);
    try{ ui.pages[n].mount(sections[n]); }catch(e){ console.error(e); sections[n].appendChild(h('div', { class:'panel bad' }, 'โหลดหน้านี้ไม่สำเร็จ: ' + e.message)); } });

  function show(name){
    if(!ui.pages[name]) name = 'world';
    if(cur && cur !== name && ui.pages[cur].onHide) ui.pages[cur].onHide();
    cur = name;
    NAMES.forEach(n => { sections[n].hidden = n !== name; });
    Array.prototype.forEach.call(document.querySelectorAll('#tabs a'), a => { a.classList.toggle('on', a.dataset.tab === name); a.setAttribute('aria-current', a.dataset.tab === name ? 'page' : 'false'); });
    const pg = ui.pages[name];
    if(pg._dirty){ pg._dirty = false; try{ pg.update && pg.update('full'); }catch(e){ console.error(e); } }
    if(pg.onShow) try{ pg.onShow(); }catch(e){ console.error(e); }
  }
  const route = () => { const n = (location.hash || '').replace('#', ''); show(NAMES.indexOf(n) >= 0 ? n : 'world'); };

  /* ---------- กระจายข่าวการเปลี่ยนแปลง (รวมหลายเหตุการณ์ในจังหวะเดียวเป็นรอบเดียว) ---------- */
  let pend = null, sched = false;
  function notify(reason){
    if(!pend) pend = { full: false, editor: false };
    if(reason !== 'state' && reason !== 'editor') pend.full = true;
    if(reason === 'editor') pend.editor = true;
    if(!sched){ sched = true; Promise.resolve().then(flush); }
  }
  function flush(){
    sched = false; const p = pend; pend = null; if(!p) return;
    const reason = p.full ? 'full' : (p.editor ? 'editor' : 'state');
    NAMES.forEach(n => { const pg = ui.pages[n];
      if(n === cur){ try{ if(!(n === 'data' && reason === 'state')) pg.update && pg.update(reason); }catch(e){ console.error(e); } }
      else pg._dirty = true; });
  }
  SL.state.subscribe(() => notify('state'));
  SL.store.subscribe(reason => notify(reason || 'full'));

  window.addEventListener('hashchange', route);
  route();
})(typeof window !== 'undefined' ? window : globalThis);
