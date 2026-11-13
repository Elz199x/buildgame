/* ============================================================
   MODULE 11 — ui-editor : หน้า "ตัวแก้ไข" เพิ่ม/แก้/ลบ/ทำสำเนา คลาส สาย สกิล และเปลี่ยนรหัสโดยแก้การอ้างอิงให้ครบ
   ทุกการแก้ผ่าน SL.store.change(..., 'editor') — หน้าอื่นรับรู้ผ่านการสมัครรับข่าว ไม่ถูกแก้โดยตรง
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h, R = SL.rules;
  let mode = 'skill', selSkill = '', selClass = '', selBranch = '', filterClass = '', listBox, formBox, root;

  const uniq = (base, exists) => { let i = 1, id = base; while(exists(id)) id = base + '_' + (++i); return id; };
  const D = () => SL.store.get();
  const commit = fn => { SL.store.change(fn, 'editor'); renderList(); };

  /* ---------- สกิล ---------- */
  function newSkill(){
    const cid = filterClass || selClassOfSkill() || D().classes[0].id;
    const id = uniq(cid + 'Skill', i => !!SL.store.skill(i));
    commit(d => d.skills.push({ id: id, class: cid, name: 'สกิลใหม่', desc: '', type: 'passive', branch: (d.branches.find(b => b.class === cid) || {}).id || '', tier: 1, jobLvReq: 1, maxLevel: 5,
      effects: [{ stat: 'atk', mode: 'flat', value: { base: 1, step: 1 }, appliesTo: 'self' }] }));
    selSkill = id; renderForm();
  }
  const selClassOfSkill = () => (SL.store.skill(selSkill) || {}).class;
  function dupSkill(){
    const s = SL.store.skill(selSkill); if(!s) return;
    const id = uniq(s.id + '_copy', i => !!SL.store.skill(i)), c = SL.util.clone(s); c.id = id; c.name = s.name + ' (สำเนา)';
    commit(d => d.skills.push(c)); selSkill = id; renderForm(); ui.toast('ทำสำเนาแล้ว');
  }
  function delSkill(){
    const id = selSkill, n = R.dependents(id).length;
    commit(d => { d.skills = d.skills.filter(s => s.id !== id); d.skills.forEach(s => { s.requires = s.requires.filter(r => r.id !== id); });
      d.builds.forEach(b => { if(b.learned) delete b.learned[id]; }); });
    selSkill = ''; ensureSel(); renderAll(); ui.toast('ลบสกิลแล้ว' + (n ? ' (ถอดการเชื่อมจาก ' + n + ' สกิลให้แล้ว)' : ''));
  }
  function renameSkill(oldId, raw){
    const nid = SL.util.slug(raw);
    if(!nid){ ui.toast('รหัสใช้ได้เฉพาะ A-Z a-z 0-9 _'); renderForm(); return; }
    if(nid === oldId){ renderForm(); return; }
    if(SL.store.skill(nid)){ ui.toast('รหัสนี้มีอยู่แล้ว'); renderForm(); return; }
    const st = SL.state.get(), lv = st.learned[oldId], rot = SL.util.clone(st.rotation);
    commit(d => { d.skills.forEach(s => { if(s.id === oldId) s.id = nid; s.requires.forEach(r => { if(r.id === oldId) r.id = nid; }); });
      d.builds.forEach(b => { if(b.learned && b.learned[oldId] !== undefined){ b.learned[nid] = b.learned[oldId]; delete b.learned[oldId]; } }); });
    SL.state.change(x => { if(lv) x.learned[nid] = lv; x.rotation = rot.map(r => (r.id === oldId ? Object.assign({}, r, { id: nid }) : r)); });
    selSkill = nid; renderAll(); ui.toast('เปลี่ยนรหัสเป็น ' + nid);
  }
  const api = { commit: commit, rebuild: () => renderForm(), jump: id => { mode = 'skill'; selSkill = id; renderAll(); }, rename: renameSkill };

  /* ---------- คลาส / สาย ---------- */
  function classForm(c){
    const others = D().classes.filter(x => x.id !== c.id).map(x => ({ v: x.id, t: x.name }));
    const cnt = D().skills.filter(s => s.class === c.id).length;
    const upd = fn => commit(d => { const x = d.classes.find(q => q.id === c.id); if(x) fn(x); });
    return h('div', { class:'panel flat col' }, h('h3', 'คลาส'),
      h('div', { class:'row' }, ui.field('รหัส', ui.text(c.id, v => renameClass(c.id, v), { width:'140px' })), ui.field('ชื่อ', ui.text(c.name, v => upd(x => { x.name = v; }), { width:'200px' }))),
      h('div', { class:'row' }, ui.field('คลาสแม่ (ต้องผ่านก่อน)', ui.select([{ v:'', t:'(ไม่มี — คลาสเริ่มต้น)' }].concat(others), c.parent, v => upd(x => { x.parent = v; }))),
        ui.field('Job Lv สูงสุด', ui.num(c.jobLvCap, v => upd(x => { x.jobLvCap = v; }), { min:1, max:99, int:true })), ui.field('แต้มสกิลต่อ Job Lv', ui.num(c.pointsPerJobLv, v => upd(x => { x.pointsPerJobLv = v; }), { min:1, max:10, int:true }))),
      ui.field('คำอธิบาย', h('textarea', { rows:2, value: c.desc || '', onchange: ev => upd(x => { x.desc = ev.target.value; }) })),
      h('div', { class:'small muted' }, 'สกิลในคลาสนี้ ' + cnt + ' ตัว · คลาสลูกจะได้แต้มคลาสนี้เต็ม (Job Lv สูงสุด) เมื่อเปลี่ยนอาชีพ'),
      h('div', { class:'row' }, h('button', { class:'btn sm', type:'button', onclick: newBranch }, '＋ สายใหม่ในคลาสนี้'),
        cnt ? h('span', { class:'small muted' }, 'ลบไม่ได้ — ต้องย้ายหรือลบสกิลในคลาสนี้ก่อน') : ui.confirmBtn('ลบคลาสนี้', () => { const id = c.id;
          commit(d => { d.classes = d.classes.filter(x => x.id !== id); d.branches = d.branches.filter(b => b.class !== id); d.classes.forEach(x => { if(x.parent === id) x.parent = ''; }); d.builds = d.builds.filter(b => b.classId !== id); });
          selClass = ''; ensureSel(); renderAll(); ui.toast('ลบคลาสแล้ว'); }, 'sm')));
  }
  function renameClass(oldId, raw){
    const nid = SL.util.slug(raw);
    if(!nid || nid === oldId){ if(!nid) ui.toast('รหัสใช้ได้เฉพาะ A-Z a-z 0-9 _'); renderForm(); return; }
    if(SL.store.klass(nid)){ ui.toast('รหัสนี้มีอยู่แล้ว'); renderForm(); return; }
    const was = SL.state.get().classId;
    commit(d => { d.classes.forEach(c => { if(c.id === oldId) c.id = nid; if(c.parent === oldId) c.parent = nid; });
      d.skills.forEach(s => { if(s.class === oldId) s.class = nid; }); d.branches.forEach(b => { if(b.class === oldId) b.class = nid; }); d.builds.forEach(b => { if(b.classId === oldId) b.classId = nid; }); });
    if(was === oldId) SL.state.change(x => { x.classId = nid; });
    selClass = nid; renderAll(); ui.toast('เปลี่ยนรหัสคลาสแล้ว');
  }
  function newClass(){
    const id = uniq('class', i => !!SL.store.klass(i));
    commit(d => d.classes.push({ id: id, name: 'คลาสใหม่', parent: (d.classes.find(c => c.id === 'novice') || {}).id || '', jobLvCap: 50, pointsPerJobLv: 1, desc: '' }));
    mode = 'class'; selClass = id; selBranch = ''; renderAll();
  }
  function newBranch(){
    const cid = selClass || D().classes[0].id, id = uniq(cid + '_branch', i => !!D().branches.find(b => b.id === i));
    commit(d => d.branches.push({ id: id, class: cid, name: 'สายใหม่' })); mode = 'class'; selBranch = id; renderAll();
  }
  function branchForm(b){
    const upd = fn => commit(d => { const x = d.branches.find(q => q.id === b.id); if(x) fn(x); });
    const n = D().skills.filter(s => s.branch === b.id).length;
    return h('div', { class:'panel flat col' }, h('h3', 'สาย (คอลัมน์ในต้นไม้สกิล)'),
      h('div', { class:'row' }, ui.field('รหัส', ui.text(b.id, v => renameBranch(b.id, v), { width:'150px' })), ui.field('ชื่อ', ui.text(b.name, v => upd(x => { x.name = v; }), { width:'200px' })),
        ui.field('คลาส', ui.select(D().classes.map(c => ({ v: c.id, t: c.name })), b.class, v => upd(x => { x.class = v; }, true)))),
      h('div', { class:'small muted' }, 'มีสกิลในสายนี้ ' + n + ' ตัว (ถ้าลบสาย สกิลจะย้ายไปคอลัมน์ "ไม่มีสาย")'),
      ui.confirmBtn('ลบสายนี้', () => { const id = b.id; commit(d => { d.branches = d.branches.filter(x => x.id !== id); d.skills.forEach(s => { if(s.branch === id) s.branch = ''; }); }); selBranch = ''; ensureSel(); renderAll(); }, 'sm'));
  }
  function renameBranch(oldId, raw){
    const nid = SL.util.slug(raw);
    if(!nid || nid === oldId || D().branches.some(b => b.id === nid)){ ui.toast(nid === oldId ? '' : 'รหัสว่างหรือซ้ำ'); renderForm(); return; }
    commit(d => { d.branches.forEach(b => { if(b.id === oldId) b.id = nid; }); d.skills.forEach(s => { if(s.branch === oldId) s.branch = nid; }); });
    selBranch = nid; renderAll();
  }

  /* ---------- วาด ---------- */
  function ensureSel(){
    const d = D();
    if(!SL.store.skill(selSkill)) selSkill = (d.skills.find(s => !filterClass || s.class === filterClass) || d.skills[0] || {}).id || '';
    if(!SL.store.klass(selClass)) selClass = (d.classes[0] || {}).id || '';
    if(selBranch && !d.branches.some(b => b.id === selBranch)) selBranch = '';
  }
  function renderList(){
    if(!listBox) return; const d = D(); ui.clear(listBox);
    const seg = h('div', { class:'row' }, [['skill', 'สกิล'], ['class', 'คลาส & สาย']].map(m => h('button', { class:'btn sm' + (mode === m[0] ? ' on' : ''), type:'button', onclick: () => { mode = m[0]; renderAll(); } }, m[1])));
    listBox.appendChild(seg);
    if(mode === 'skill'){
      listBox.appendChild(ui.select([{ v:'', t:'ทุกคลาส' }].concat(d.classes.map(c => ({ v: c.id, t: c.name }))), filterClass, v => { filterClass = v; renderList(); }, { label:'กรองตามคลาส' }));
      const order = id => d.classes.findIndex(c => c.id === id);
      const items = d.skills.filter(s => !filterClass || s.class === filterClass).sort((a, b) => order(a.class) - order(b.class) || a.tier - b.tier || a.jobLvReq - b.jobLvReq);
      const list = h('div', { class:'list' }); let last = '';
      items.forEach(s => { if(!filterClass && s.class !== last){ last = s.class; list.appendChild(h('div', { class:'tiny muted', style:{ padding:'6px 8px 2px' } }, (SL.store.klass(s.class) || { name: s.class }).name)); }
        list.appendChild(h('button', { class:'li' + (s.id === selSkill ? ' on' : ''), type:'button', onclick: () => { selSkill = s.id; renderList(); renderForm(); } }, h('span', { class:'grow', style:{ minWidth:0 } }, s.name), ui.typeChip(s.type))); });
      if(!items.length) list.appendChild(h('div', { class:'small muted', style:{ padding:'8px' } }, 'ยังไม่มีสกิลในคลาสนี้'));
      listBox.appendChild(list);
      listBox.appendChild(h('div', { class:'row' }, h('button', { class:'btn sm primary', type:'button', onclick: newSkill }, '＋ สกิลใหม่'), h('button', { class:'btn sm', type:'button', disabled: !selSkill, onclick: dupSkill }, 'ทำสำเนา')));
    } else {
      const list = h('div', { class:'list' });
      d.classes.forEach(c => { list.appendChild(h('button', { class:'li' + (c.id === selClass && !selBranch ? ' on' : ''), type:'button', onclick: () => { selClass = c.id; selBranch = ''; renderList(); renderForm(); } },
        h('b', c.name), h('span', { class:'id' }, c.parent ? '← ' + ((SL.store.klass(c.parent) || {}).name || c.parent) : 'เริ่มต้น')));
        d.branches.filter(b => b.class === c.id).forEach(b => list.appendChild(h('button', { class:'li' + (b.id === selBranch ? ' on' : ''), type:'button', style:{ paddingLeft:'24px' }, onclick: () => { selClass = c.id; selBranch = b.id; renderList(); renderForm(); } }, '└ ' + b.name))); });
      listBox.appendChild(list);
      listBox.appendChild(h('div', { class:'row' }, h('button', { class:'btn sm primary', type:'button', onclick: newClass }, '＋ คลาสใหม่'), h('button', { class:'btn sm', type:'button', onclick: newBranch }, '＋ สายใหม่')));
    }
  }
  function renderForm(){
    if(!formBox) return; ui.clear(formBox); ensureSel();
    if(mode === 'skill'){
      if(!selSkill){ formBox.appendChild(h('div', { class:'panel muted' }, 'ยังไม่มีสกิล — กด "＋ สกิลใหม่"')); return; }
      formBox.appendChild(h('div', { class:'row sp-between' }, h('h4', 'แก้ไขสกิล: ' + SL.store.skill(selSkill).name), h('div', { class:'row' },
        h('a', { class:'btn sm', href:'#tree', onclick: () => { SL.ui.pages.tree.select(selSkill); } }, 'ดูในต้นไม้'), ui.confirmBtn('ลบสกิลนี้', delSkill, 'sm'))));
      formBox.appendChild(ui.skillForm(selSkill, api));
    } else {
      const b = D().branches.find(x => x.id === selBranch), c = SL.store.klass(selClass);
      if(b) formBox.appendChild(branchForm(b)); else if(c) formBox.appendChild(classForm(c)); else formBox.appendChild(h('div', { class:'panel muted' }, 'ยังไม่มีคลาส'));
    }
  }
  function renderAll(){ ensureSel(); renderList(); renderForm(); }

  ui.pages.editor = {
    mount(r){ root = r; listBox = h('div', { class:'col' }); formBox = h('div', { class:'col gap-lg' });
      root.appendChild(h('div', { class:'layout-ed' }, h('div', { class:'panel' }, listBox), formBox)); renderAll(); },
    update(reason){ if(!root) return; if(reason === 'editor' || reason === 'state'){ renderList(); return; } renderAll(); },
    onShow(){ if(ui.nav && ui.nav.skill){ mode = 'skill'; selSkill = ui.nav.skill; ui.nav = null; renderAll(); } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
