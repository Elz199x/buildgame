/* ============================================================
   MODULE 07 — ui-tree : หน้า "ต้นไม้สกิล" กราฟ SVG วาดจากข้อมูลล้วน ๆ (เส้นต่อ = requires ของแต่ละสกิล)
   เพิ่ม/ย้าย/ลบสกิลหรือเปลี่ยนเงื่อนไขในตัวแก้ไข แล้วกราฟจัดวางใหม่เองทั้งหมด ไม่มีพิกัดฝังในโค้ด
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h, R = SL.rules;
  const NW = 134, NH = 54, GX = 10, GY = 30, GB = 22, LEFT = 60, TOP = 8, PER = 2;   // PER = จำนวนสกิลต่อแถวในสายเดียวกัน (เกินแล้วขึ้นแถวย่อย)
  const TYPE_COLOR = { passive:'var(--accent-2)', active:'var(--danger)', buff:'var(--info)', toggle:'var(--violet)', trigger:'var(--accent)' };
  let selected = '', showAll = false, wrapEl, svgHost, detailEl, panel;

  const NS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs){
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(k => { if(attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]); });
    Array.prototype.slice.call(arguments, 2).forEach(c => { if(c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }

  // จัดวาง: คลาสเรียงบนลงล่าง, ในคลาสแต่ละสายเป็นคอลัมน์, แต่ละ tier เป็นแถว
  function layout(){
    const D = SL.store.get(), st = SL.state.get();
    const classIds = showAll ? D.classes.map(c => c.id) : R.chain(st.classId);
    const nodes = {}, heads = [], rows = [], bheads = []; let y = TOP, maxX = 0;
    classIds.forEach(cid => {
      const c = SL.store.klass(cid), skills = D.skills.filter(s => s.class === cid);
      heads.push({ y: y + 14, text: c.name + ' · Job Lv สูงสุด ' + c.jobLvCap + ' · ' + (c.pointsPerJobLv || 1) + ' แต้ม/เลเวล' }); y += 24;
      if(!skills.length){ heads.push({ y: y + 14, text: '(ยังไม่มีสกิลในคลาสนี้ — เพิ่มได้ในหน้า "ตัวแก้ไข")', dim: true }); y += 34; return; }
      const bIds = D.branches.filter(b => b.class === cid && skills.some(s => s.branch === b.id)).map(b => b.id);
      const key = s => (bIds.indexOf(s.branch) >= 0 ? s.branch : '_');
      if(skills.some(s => key(s) === '_')) bIds.push('_');
      const tiers = Array.from(new Set(skills.map(s => s.tier))).sort((a, b) => a - b);
      const slots = {}; bIds.forEach(b => { slots[b] = 1; tiers.forEach(t => { slots[b] = Math.max(slots[b], Math.min(PER, skills.filter(s => key(s) === b && s.tier === t).length)); }); });
      const bx = {}; let x = LEFT; bIds.forEach(b => { bx[b] = x; x += slots[b] * (NW + GX) + GB; }); maxX = Math.max(maxX, x);
      bIds.forEach(b => { const br = D.branches.find(q => q.id === b); bheads.push({ x: bx[b], y: y + 12, text: br ? br.name : '(ไม่มีสาย)' }); }); y += 20;
      tiers.forEach(t => {
        const ts = skills.filter(s => s.tier === t); rows.push({ y: y + NH / 2 + 4, text: 'T' + t, sub: 'J' + Math.min.apply(null, ts.map(s => s.jobLvReq)) });
        const used = {}; let subs = 1;
        ts.forEach(s => { const b = key(s), i = used[b] || 0, sub = Math.floor(i / PER); used[b] = i + 1; subs = Math.max(subs, sub + 1);
          nodes[s.id] = { s: s, x: bx[b] + (i % PER) * (NW + GX), y: y + sub * (NH + GY) }; });
        y += subs * (NH + GY);
      });
      y += 10;
    });
    return { nodes: nodes, heads: heads, rows: rows, bheads: bheads, w: Math.max(maxX, 420), h: y + 6 };
  }

  function related(id){   // ปู่ย่าตายาย + ลูกหลานทั้งหมดของสกิลที่เลือก
    const set = {}; set[id] = 1;
    (function up(i){ const s = SL.store.skill(i); if(!s) return; s.requires.forEach(r => { if(!set[r.id]){ set[r.id] = 1; up(r.id); } }); })(id);
    (function down(i){ R.dependents(i).forEach(d => { if(!set[d.id]){ set[d.id] = 1; down(d.id); } }); })(id);
    return set;
  }

  function draw(){
    const L = layout(), st = SL.state.get(), rel = selected && L.nodes[selected] ? related(selected) : null;
    const svg = sv('svg', { width: L.w, height: L.h, viewBox: '0 0 ' + L.w + ' ' + L.h, role: 'img', 'aria-label': 'ต้นไม้สกิล' });
    L.heads.forEach(hd => svg.appendChild(sv('text', { x: 6, y: hd.y, class: 'colhead', opacity: hd.dim ? .6 : 1 }, hd.text)));
    L.bheads.forEach(b => svg.appendChild(sv('text', { x: b.x, y: b.y, class: 'colhead', style: 'font-weight:500' }, b.text)));
    L.rows.forEach(r => { svg.appendChild(sv('text', { x: 6, y: r.y - 6, class: 'rowhead', style: 'font-weight:700' }, r.text)); svg.appendChild(sv('text', { x: 6, y: r.y + 8, class: 'rowhead' }, r.sub)); });
    const eg = sv('g'); svg.appendChild(eg);
    Object.keys(L.nodes).forEach(id => { const n = L.nodes[id];
      n.s.requires.forEach(r => { const p = L.nodes[r.id]; if(!p) return;
        const x1 = p.x + NW / 2, y1 = p.y + NH, x2 = n.x + NW / 2, y2 = n.y, dy = Math.max(24, Math.abs(y2 - y1) / 2);
        const ok = (st.learned[r.id] || 0) >= r.lv, hl = rel && (id === selected || r.id === selected);
        const e = sv('path', { d: 'M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + (y1 + dy) + ',' + x2 + ' ' + (y2 - dy) + ',' + x2 + ' ' + y2, class: 'edge' + (ok ? ' ok' : '') + (hl ? ' hl' : ''), opacity: rel && !hl ? .25 : 1 });
        eg.appendChild(e);
        if(r.lv > 1) eg.appendChild(sv('text', { x: (x1 + x2) / 2 + 4, y: (y1 + y2) / 2, class: 'rowhead', opacity: rel && !hl ? .25 : 1 }, 'Lv' + r.lv)); }); });
    Object.keys(L.nodes).forEach(id => { const n = L.nodes[id], s = n.s, lv = st.learned[id] || 0, cl = R.canLearn(s, st);
      const cls = 'node' + (lv >= s.maxLevel ? ' maxed' : lv > 0 ? ' learned' : cl.ok ? ' avail' : ' locked') + (id === selected ? ' sel' : '') + (rel && !rel[id] ? ' dim' : '');
      const gEl = sv('g', { class: cls, transform: 'translate(' + n.x + ',' + n.y + ')', tabindex: 0, role: 'button', 'aria-label': s.name + ' เลเวล ' + lv + ' จาก ' + s.maxLevel },
        sv('rect', { width: NW, height: NH, rx: 8 }), sv('rect', { class: 'ty', width: 5, height: NH - 12, x: 0, y: 6, rx: 2, fill: TYPE_COLOR[s.type] || 'var(--fg-dim)' }),
        sv('text', { x: 12, y: 20 }, s.name.length > 17 ? s.name.slice(0, 16) + '…' : s.name),
        sv('text', { x: 12, y: 40, class: 'lv' }, 'Lv ' + lv + ' / ' + s.maxLevel),
        sv('text', { x: NW - 8, y: 40, 'text-anchor': 'end', class: 'rowhead' }, (ui.TYPES[s.type] || { t: s.type }).t + ' · J' + s.jobLvReq));
      gEl.addEventListener('click', () => { selected = id; update(); });
      gEl.addEventListener('dblclick', () => R.learn(id));
      gEl.addEventListener('keydown', ev => { if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); selected = id; update(); } else if(ev.key === '+' || ev.key === '=') R.learn(id); else if(ev.key === '-') R.unlearn(id); });
      svg.appendChild(gEl); });
    ui.clear(svgHost).appendChild(svg);
  }

  function reqRow(r){ return h('div', { class: 'small ' + (r.ok ? 'ok' : 'bad') }, (r.ok ? '✓ ' : '✗ ') + r.name + ' Lv.' + r.lv, h('span', { class:'muted' }, '  (มี ' + r.have + ')')); }

  function detail(){
    ui.clear(detailEl); const s = SL.store.skill(selected), st = SL.state.get();
    if(!s){ detailEl.appendChild(h('div', { class:'muted' }, 'คลิกสกิลในกราฟเพื่อดูรายละเอียด · ดับเบิลคลิกหรือกด + เพื่อเรียน, กด − เพื่อลด')); return; }
    const lv = st.learned[s.id] || 0, cl = R.canLearn(s, st), un = R.canUnlearn(s, st), br = SL.store.get().branches.find(b => b.id === s.branch);
    const reqs = R.reqStatus(s, st), deps = R.dependents(s.id);
    detailEl.appendChild(h('div', { class:'row sp-between' }, h('h4', s.name), ui.typeChip(s.type)));
    detailEl.appendChild(h('div', { class:'muted tiny' }, s.id + ' · ' + (SL.store.klass(s.class) || { name: s.class }).name + (br ? ' · ' + br.name : '') + ' · Tier ' + s.tier + ' · ต้อง Job Lv.' + s.jobLvReq));
    if(s.desc) detailEl.appendChild(h('div', { class:'small' }, s.desc));
    detailEl.appendChild(h('div', { class:'row' },
      h('b', { style:{ fontSize:'16px' } }, 'Lv ' + lv + ' / ' + s.maxLevel),
      h('button', { class:'btn sm primary', type:'button', disabled: !cl.ok, onclick: () => R.learn(s.id) }, 'เรียน +1'),
      h('button', { class:'btn sm', type:'button', disabled: !un.ok, onclick: () => R.unlearn(s.id) }, 'ลด −1'),
      h('button', { class:'btn sm', type:'button', onclick: () => { for(let i = 0; i < s.maxLevel; i++) R.learn(s.id); } }, 'เรียนให้เต็ม'),
      h('button', { class:'btn sm', type:'button', onclick: () => { ui.nav = { skill: s.id }; location.hash = '#editor'; } }, 'แก้ไขสกิลนี้')));
    if(!cl.ok && lv < s.maxLevel) detailEl.appendChild(h('div', { class:'small warn' }, 'เรียนเพิ่มไม่ได้: ' + cl.reason));
    if(!un.ok && lv > 0) detailEl.appendChild(h('div', { class:'small muted' }, 'ลดไม่ได้: ' + un.reason));
    if(reqs.length){ detailEl.appendChild(h('hr')); detailEl.appendChild(h('h3', 'เงื่อนไขก่อนเรียน')); reqs.forEach(r => detailEl.appendChild(reqRow(r))); }
    if(deps.length){ detailEl.appendChild(h('hr')); detailEl.appendChild(h('h3', 'ปลดล็อกต่อไปยัง'));
      detailEl.appendChild(h('div', { class:'row' }, deps.map(d => h('button', { class:'chip', type:'button', style:{ cursor:'pointer' }, onclick: () => { selected = d.id; update(); } },
        d.name + ' (ต้อง Lv.' + d.requires.find(r => r.id === s.id).lv + ')')))); }
    detailEl.appendChild(h('hr')); detailEl.appendChild(h('h3', 'ค่าที่เลเวล ' + Math.max(1, lv)));
    detailEl.appendChild(ui.skillBrief(s, lv));
    detailEl.appendChild(h('hr')); detailEl.appendChild(h('h3', 'ตารางทุกเลเวล')); detailEl.appendChild(ui.levelTable(s, lv));
  }

  function update(){ if(!wrapEl) return; panel.update(); draw(); detail(); }

  ui.pages.tree = {
    mount(root){
      panel = ui.charPanel(); svgHost = h('div', { class:'treebox' }); detailEl = h('div', { class:'col' });
      wrapEl = h('div', { class:'layout-two' },
        h('div', { class:'panel' }, h('div', { class:'row sp-between', style:{ marginBottom:'8px' } }, h('h3', 'ต้นไม้สกิล'),
          h('div', { class:'row' }, ui.check('แสดงทุกคลาส', showAll, v => { showAll = v; update(); }),
            h('span', { class:'tiny muted' }, 'เส้นเขียว = เงื่อนไขครบ · สีแถบซ้าย = ชนิดสกิล'))), svgHost),
        h('div', { class:'col gap-lg' }, h('div', { class:'panel' }, h('h3', 'ตัวละคร'), panel.el), h('div', { class:'panel' }, detailEl)));
      root.appendChild(wrapEl); update();
    },
    update: update,
    select(id){ selected = id; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
