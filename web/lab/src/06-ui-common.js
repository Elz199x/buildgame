/* ============================================================
   MODULE 06 — ui-common : ตัวช่วยสร้าง DOM, ช่องกรอก, ตัวแก้ "ค่าตามเลเวล (S)", ตารางค่าสกิลต่อเลเวล, แผงเลือกตัวละคร
   โมดูล UI อื่นใช้ของกลางนี้ — ไม่มีโมดูลไหนอ้างถึงกันเอง (ผ่าน SL.ui.pages เท่านั้น)
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const { val, clamp, fmt } = SL.util;
  const ui = SL.ui = { pages: {} };

  function append(el, kids){
    kids.forEach(k => { if(k === null || k === undefined || k === false) return;
      if(Array.isArray(k)) append(el, k); else el.appendChild(k.nodeType ? k : document.createTextNode(String(k))); });
  }
  const h = ui.h = function(tag, attrs, ...rest){
    const el = document.createElement(tag); let kids = rest;
    if(attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs.nodeType || Array.isArray(attrs))){ kids = [attrs].concat(rest); attrs = null; }
    if(attrs) Object.keys(attrs).forEach(k => { const v = attrs[k];
      if(v === null || v === undefined || v === false || k === 'value' || k === 'checked') return;
      if(k === 'class') el.className = v;
      else if(k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if(k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v); });
    append(el, kids);
    if(attrs && attrs.value !== undefined && attrs.value !== null) el.value = attrs.value;
    if(attrs && attrs.checked !== undefined) el.checked = !!attrs.checked;
    return el;
  };
  ui.clear = el => { while(el.firstChild) el.removeChild(el.firstChild); return el; };
  ui.$ = (sel, root) => (root || document).querySelector(sel);

  let toastTimer = null;
  ui.toast = function(msg){ const t = document.getElementById('toast'); if(!t) return; t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200); };
  // คัดลอกข้อความ — ถ้า clipboard ถูกบล็อก ให้เลือกข้อความใน textarea ให้ผู้ใช้กด Ctrl+C เอง
  ui.copy = function(text, fallbackEl){
    const fail = () => { if(fallbackEl){ fallbackEl.focus(); fallbackEl.select(); } ui.toast('คัดลอกอัตโนมัติไม่ได้ — เลือกข้อความไว้แล้ว กด Ctrl+C'); };
    try{ navigator.clipboard.writeText(text).then(() => ui.toast('คัดลอกแล้ว'), fail); }catch(e){ fail(); }
  };

  ui.TYPES = { passive:{ t:'พาสซีฟ', c:'t-passive' }, active:{ t:'แอคทีฟ', c:'t-active' }, buff:{ t:'บัฟ', c:'t-buff' }, toggle:{ t:'สลับเปิด/ปิด', c:'t-toggle' }, trigger:{ t:'ทริกเกอร์', c:'t-trigger' } };
  ui.typeChip = type => { const T = ui.TYPES[type] || { t: type, c: '' }; return h('span', { class: 'chip ' + T.c }, T.t); };

  /* ---------- ช่องกรอก (บันทึกเมื่อ change = กด Enter/ออกจากช่อง) ---------- */
  ui.num = function(value, onChange, o){
    o = o || {};
    const el = h('input', { type:'number', value: value, min: o.min, max: o.max, step: o.step === undefined ? 'any' : o.step, 'aria-label': o.label, class: o.class });
    el.addEventListener('change', () => {
      let v = parseFloat(el.value); if(!isFinite(v)){ el.value = value; return; }
      if(o.min !== undefined) v = Math.max(o.min, v); if(o.max !== undefined) v = Math.min(o.max, v); if(o.int) v = Math.round(v);
      el.value = v; value = v; onChange(v);
    });
    return el;
  };
  ui.text = function(value, onChange, o){
    o = o || {};
    const el = h('input', { type:'text', value: value || '', 'aria-label': o.label, class: o.class, style: o.width ? { width: o.width } : null, placeholder: o.placeholder });
    el.addEventListener('change', () => onChange(el.value));
    return el;
  };
  ui.select = function(options, value, onChange, o){
    const el = h('select', { 'aria-label': o && o.label, class: o && o.class },
      options.map(op => { const v = typeof op === 'string' ? op : op.v, t = typeof op === 'string' ? op : op.t; return h('option', { value: v }, t); }));
    el.value = value; el.addEventListener('change', () => onChange(el.value));
    return el;
  };
  ui.check = (label, checked, onChange) => { const c = h('input', { type:'checkbox', checked: !!checked });
    c.addEventListener('change', () => onChange(c.checked)); return h('label', { class:'row', style:{ gap:'5px', cursor:'pointer' } }, c, label); };
  ui.field = (label, control, hint) => h('label', { class:'f' }, label, control, hint ? h('span', { class:'hint' }, hint) : null);
  // ปุ่มยืนยัน 2 ขั้น (ไม่ใช้ confirm() เพราะถูกบล็อกในหน้า artifact)
  ui.confirmBtn = function(label, onConfirm, cls){
    let armed = false, timer = null;
    const b = h('button', { class:'btn danger ' + (cls || ''), type:'button' }, label);
    b.addEventListener('click', () => {
      if(!armed){ armed = true; b.textContent = 'กดอีกครั้งเพื่อยืนยัน'; b.classList.add('armed'); timer = setTimeout(() => { armed = false; b.textContent = label; b.classList.remove('armed'); }, 3000); return; }
      clearTimeout(timer); armed = false; b.textContent = label; b.classList.remove('armed'); onConfirm();
    });
    return b;
  };

  /* ---------- ตัวแก้ค่าตามเลเวล S : คงที่ / เส้นตรง / ตาราง ---------- */
  ui.sInput = function(S, o){
    o = o || {}; const maxLv = o.maxLv || 1, scale = o.scale || 1, digits = o.digits === undefined ? 2 : o.digits;
    let cur = S === undefined ? 0 : S; const box = h('div', { class:'sw' });
    const rd = x => +(x * scale).toFixed(6), wr = x => x / scale;
    const emit = () => { o.onChange(cur); prev.textContent = '→ ' + SL.util.preview(cur, maxLv, scale, digits); };
    const prev = h('span', { class:'muted mono tiny' });
    function build(){
      ui.clear(box); const mode = SL.util.sMode(cur);
      const sel = ui.select([{ v:'const', t:'คงที่' }, { v:'linear', t:'ต่อเลเวล' }, { v:'table', t:'ตาราง' }], mode, m => {
        if(m === mode) return;
        const arr = []; for(let l = 1; l <= maxLv; l++) arr.push(val(cur, l));
        if(m === 'const') cur = arr[0];
        else if(m === 'linear') cur = { base: arr[0], step: arr.length > 1 ? (arr[arr.length - 1] - arr[0]) / (arr.length - 1) : 0 };
        else cur = { table: arr };
        build(); emit();
      }, { label:'รูปแบบค่า' });
      box.appendChild(sel);
      if(mode === 'const') box.appendChild(ui.num(rd(cur), v => { cur = wr(v); emit(); }, { label:'ค่า' }));
      else if(mode === 'linear'){
        box.appendChild(h('span', { class:'muted tiny' }, 'Lv1 ='));
        box.appendChild(ui.num(rd(cur.base), v => { cur = { base: wr(v), step: cur.step }; emit(); }, { label:'ค่าเริ่ม' }));
        box.appendChild(h('span', { class:'muted tiny' }, '+ต่อเลเวล'));
        box.appendChild(ui.num(rd(cur.step), v => { cur = { base: cur.base, step: wr(v) }; emit(); }, { label:'เพิ่มต่อเลเวล' }));
      } else {
        const row = h('div', { class:'tablerow', style:{ width:'100%' } });
        for(let l = 1; l <= maxLv; l++) (function(l){ row.appendChild(ui.num(rd(cur.table[l - 1] === undefined ? val(cur, l) : cur.table[l - 1]),
          v => { const t = cur.table.slice(); while(t.length < maxLv) t.push(val(cur, t.length + 1)); t[l - 1] = wr(v); cur = { table: t }; emit(); }, { label:'Lv' + l })); })(l);
        box.appendChild(row);
      }
      box.appendChild(prev); prev.textContent = '→ ' + SL.util.preview(cur, maxLv, scale, digits);
    }
    build(); return box;
  };

  /* ---------- ข้อความบอกเงื่อนไขอาวุธ ---------- */
  ui.weaponReqText = function(s){
    const r = s.weaponReq || {}, W = SL.store.get().weapons, p = [];
    const cname = c => { const w = W.find(x => x.weaponClass === c); return w ? w.name.replace(/ ?\d ?มือ/, '').trim() : c; };
    if(s.needShield) p.push('ต้องสวมโล่ (อาวุธ 1 มือ)');
    if(r.slotType) p.push('อาวุธ ' + (r.slotType === '2H' ? '2 มือ' : '1 มือ'));
    if(r.damageType) p.push('ประเภท ' + r.damageType);
    if(r.include && r.include.length) p.push('เฉพาะ ' + r.include.map(cname).join('/'));
    if(r.exclude && r.exclude.length) p.push('ยกเว้น ' + r.exclude.map(cname).join('/'));
    return p.join(' · ');
  };
  const effVal = (e, lv) => { const t = SL.calc.fmtEffect(e.stat, e.mode, val(e.value, lv)); return t.slice(SL.calc.statName(e.stat).length + 1); };
  ui.effValue = effVal;

  /* ---------- ตารางค่าสกิลทุกเลเวล ---------- */
  ui.levelTable = function(s, curLv){
    const cols = [], U = l => SL.calc.usage(s, l), pc = x => +(x * 100).toFixed(2) + '%';
    const any = f => { for(let l = 1; l <= s.maxLevel; l++) if(f(l)) return true; return false; };
    if(any(l => U(l).sp)) cols.push(['SP', l => fmt(U(l).sp, 1)]);
    if(any(l => U(l).hp)) cols.push(['HP', l => pc(U(l).hp)]);
    if(any(l => U(l).cooldown)) cols.push(['CD', l => fmt(U(l).cooldown, 1) + 's']);
    if(any(l => U(l).duration)) cols.push(['นาน', l => fmt(U(l).duration, 1) + 's']);
    if(any(l => U(l).hpDrain)) cols.push(['HP/วิ', l => pc(U(l).hpDrain)]);
    if(any(l => U(l).spDrain)) cols.push(['SP/วิ', l => fmt(U(l).spDrain, 1)]);
    (s.damage.terms || []).forEach(t => cols.push([(s.damage.kind === 'magic' ? 'เวท ' : '') + SL.calc.statName(t.stat) + '×', l => pc(val(t.mult, l))]));
    if(s.heal) cols.push(['ฟื้น HP', l => pc(val(s.heal.pctMaxHp, l)) + (s.heal.flat ? '+' + fmt(val(s.heal.flat, l), 0) : '')]);
    s.effects.forEach(e => cols.push([SL.calc.statName(e.stat) + (e.appliesTo === 'target' ? ' (เป้า)' : ''), l => effVal(e, l)]));
    if(!cols.length) return h('div', { class:'muted small' }, 'ไม่มีค่าที่เปลี่ยนตามเลเวล');
    const rows = []; for(let l = 1; l <= s.maxLevel; l++) rows.push(h('tr', { style: l === curLv ? { background:'color-mix(in srgb,var(--accent) 16%,transparent)' } : null },
      h('td', { class:'n', style:{ fontWeight:600 } }, l), cols.map(c => h('td', { class:'n' }, c[1](l)))));
    return h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', { class:'n' }, 'Lv'), cols.map(c => h('th', { class:'n' }, c[0])))), h('tbody', rows)));
  };

  // สรุปสกิลสั้น ๆ ที่เลเวลหนึ่ง (ใช้ในรายละเอียดต้นไม้ / ตัวแก้ไข)
  ui.skillBrief = function(s, lv){
    lv = Math.max(1, lv || 1); const u = SL.calc.usage(s, lv), out = [];
    const line = (k, v) => out.push(h('div', { class:'row small', style:{ gap:'6px' } }, h('span', { class:'muted', style:{ minWidth:'62px' } }, k), h('span', v)));
    const use = []; if(u.sp) use.push('SP ' + fmt(u.sp, 1)); if(u.hp) use.push('HP ' + +(u.hp * 100).toFixed(1) + '%'); if(u.cooldown) use.push('CD ' + fmt(u.cooldown, 1) + 's');
    if(u.duration) use.push('นาน ' + fmt(u.duration, 1) + 's'); if(u.hpDrain) use.push('HP ไหล ' + +(u.hpDrain * 100).toFixed(2) + '%/วิ'); if(u.spDrain) use.push('SP ไหล ' + fmt(u.spDrain, 1) + '/วิ');
    if(use.length) line('การใช้', use.join(' · '));
    if(s.damage.kind) line('ดาเมจ', (s.damage.kind === 'magic' ? 'เวท ' : 'กายภาพ ') + s.damage.terms.map(t => +(val(t.mult, lv) * 100).toFixed(1) + '% ' + SL.calc.statName(t.stat)).join(' + ') + (s.damage.aoe ? ' · ระยะกว้าง' : ''));
    if(s.heal) line('ฟื้นฟู', +(val(s.heal.pctMaxHp, lv) * 100).toFixed(1) + '% ของ HP สูงสุด');
    if(s.effects.length) line('ผล', s.effects.map(e => SL.calc.fmtEffect(e.stat, e.mode, val(e.value, lv)) + (e.appliesTo === 'target' ? ' (เป้า)' : '')).join(', '));
    if(s.trigger) line('เงื่อนไข', 'เปิดเมื่อ HP ≤ ' + Math.round((s.trigger.hpBelow || 0) * 100) + '% · ปิดเมื่อ HP > ' + Math.round((s.trigger.hpAbove === undefined ? 1 : s.trigger.hpAbove) * 100) + '% · CD ' + (s.trigger.cooldown || 0) + 's');
    if(s.toggleOff && s.toggleOff.hpBelow) line('ปิดเอง', 'เมื่อ HP < ' + Math.round(s.toggleOff.hpBelow * 100) + '%');
    const wr = ui.weaponReqText(s); if(wr) line('ต้องใช้', wr);
    return h('div', { class:'col', style:{ gap:'3px' } }, out);
  };

  /* ---------- แผงตัวละคร (ใช้ซ้ำในหน้าต้นไม้และหน้า DPS) ----------
     C = ตัวเก็บสถานะ: ไม่ส่ง = ตัวละครจริง (SL.state) — ในโหมดเกมเป็นแผงอ่านอย่างเดียวที่สั่งผ่านเซิร์ฟเวอร์
                       SL.sandbox = ตัวละครสำหรับลองค่า (แก้ได้อิสระ ไม่กระทบตัวละครจริง) */
  ui.charPanel = function(C){
    const sandbox = !!C; C = C || SL.state;
    const gameMode = !sandbox && !!g.__SL_GAME;
    const el = h('div', { class:'col' }); let sig = '', refs = {};
    function build(){
      const D = SL.store.get(); ui.clear(el); refs = {};
      refs.pts = h('div', { class:'small' });
      if(gameMode){
        refs.info = h('div', { class:'small' });
        const kids = () => D.classes.filter(c => c.parent === C.get().classId);
        refs.promo = ui.select([{ v:'', t:'— เลื่อนอาชีพ —' }].concat(kids().map(c => ({ v: c.id, t: c.name }))), '', v => { if(v){ SL.game.classChange(v); refs.promo.value = ''; } }, { label:'เลื่อนอาชีพ' });
        refs.weapon = ui.select(D.weapons.map(w => ({ v: w.id, t: w.name })), C.get().weaponId, v => SL.game.weapon(v), { label:'อาวุธ' });
        refs.shield = ui.check('สวมโล่', C.get().hasShield, v => SL.game.shield(v));
        el.appendChild(refs.info);
        el.appendChild(ui.field('เลื่อนอาชีพ', refs.promo, 'ทำได้เมื่อ Job Lv ถึงเพดานของอาชีพปัจจุบัน (เซิร์ฟเวอร์ตรวจ)'));
        el.appendChild(h('div', { class:'row' }, ui.field('อาวุธ', refs.weapon), refs.shield));
        el.appendChild(refs.pts);
        return;
      }
      refs.cls = ui.select(D.classes.map(c => ({ v: c.id, t: c.name })), C.get().classId, v => C.change(s => { s.classId = v; if(s.jobLv > SL.store.klass(v).jobLvCap) s.jobLv = SL.store.klass(v).jobLvCap; }), { label:'คลาส' });
      refs.job = ui.num(C.get().jobLv, v => C.change(s => { s.jobLv = v; }), { min:1, max:99, int:true, label:'Job Lv' });
      refs.build = ui.select([{ v:'', t:'— เลือกบิลด์ตัวอย่าง —' }].concat(D.builds.map(b => ({ v: b.id, t: b.name }))), '', v => { if(v){ SL.rules.applyBuild(v, C); refs.build.value = ''; ui.toast('โหลดบิลด์แล้ว'); } }, { label:'บิลด์' });
      refs.preset = ui.select([{ v:'', t:'— ชุดสเตตัสสำเร็จรูป —' }].concat(D.presets.map(p => ({ v: p.id, t: p.name }))), '', v => {
        const p = SL.store.find('presets', v); if(!p) return;
        C.change(s => { s.presetId = p.id; s.weaponId = p.weaponId; s.hasShield = !!p.hasShield; s.sheet = SL.util.clone(p.sheet); });
        refs.preset.value = ''; ui.toast('ใช้ชุดสเตตัส: ' + p.name); }, { label:'พรีเซ็ต' });
      refs.weapon = ui.select(D.weapons.map(w => ({ v: w.id, t: w.name })), C.get().weaponId, v => C.change(s => { s.weaponId = v; }), { label:'อาวุธ' });
      refs.shield = ui.check('สวมโล่', C.get().hasShield, v => C.change(s => { s.hasShield = v; }));
      el.appendChild(h('div', { class:'row' }, ui.field('คลาส', refs.cls), ui.field('Job Lv', refs.job)));
      el.appendChild(ui.field('โหลดบิลด์ตัวอย่าง', refs.build, 'ตั้งคลาส/Job Lv/สกิล/สเตตัสให้ครบในคลิกเดียว'));
      el.appendChild(ui.field('ชุดสเตตัสสำเร็จรูป', refs.preset));
      el.appendChild(h('div', { class:'row' }, ui.field('อาวุธ', refs.weapon), refs.shield));
      const btns = [ui.confirmBtn('ล้างสกิลทั้งหมด', () => C.change(s => { s.learned = {}; s.rotation = []; }), 'sm')];
      if(sandbox) btns.push(h('button', { class:'btn sm', type:'button', onclick: () => { C.resetFromState(); ui.toast('คัดลอกจากตัวละครจริงแล้ว'); } }, 'คัดลอกจากตัวละครจริง'));
      el.appendChild(h('div', { class:'row' }, btns));
      el.appendChild(refs.pts);
    }
    function update(){
      const D = SL.store.get(), st = C.get();
      const ns = D.classes.map(c => c.id + c.name).join('|') + '#' + D.builds.map(b => b.id + b.name).join('|') + '#' + D.presets.map(p => p.id + p.name).join('|') + '#' + D.weapons.map(w => w.id + w.name).join('|') + (gameMode ? '#' + st.classId : '');
      if(ns !== sig){ sig = ns; build(); }
      if(gameMode){
        const cls = SL.store.klass(st.classId) || {};
        refs.info.textContent = (cls.name || st.classId) + ' · Base Lv.' + st.baseLv + ' · Job Lv.' + st.jobLv + '/' + (cls.jobLvCap || '?') + ' · ' + SL.util.fmt(st.gold, 0) + ' Zeny';
      } else { refs.cls.value = st.classId; refs.job.value = st.jobLv; refs.job.max = SL.store.klass(st.classId).jobLvCap; }
      refs.weapon.value = st.weaponId; refs.shield.querySelector('input').checked = !!st.hasShield;
      ui.clear(refs.pts);
      SL.rules.pointInfo(st).forEach(p => refs.pts.appendChild(h('div', { class:'row', style:{ gap:'6px' } },
        h('span', { class:'muted' }, p.name), h('b', { class: p.left < 0 ? 'bad' : '' }, p.spent + ' / ' + p.total), h('span', { class:'muted tiny' }, 'เหลือ ' + p.left))));
    }
    update();
    return { el: el, update: update };
  };
})(typeof window !== 'undefined' ? window : globalThis);
