/* ============================================================
   MODULE 10 — ui-skillform : ฟอร์มแก้ไขสกิล 1 ตัว (ข้อมูลหลัก / การเชื่อมต่อ / อาวุธ / การใช้ / ดาเมจ / ฟื้นฟู / ผล / พิเศษ / ตัวอย่าง)
   ไม่รู้จักหน้าอื่น — ติดต่อกับตัวแก้ไขผ่าน api = { commit(fn), rebuild(), jump(id), rename(old,new) } เท่านั้น
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h, R = SL.rules;

  function closure(startId, nextFn){   // เซตของสกิลที่ไปถึงได้ (ปู่ย่า หรือ ลูกหลาน)
    const set = {}; (function go(i){ nextFn(i).forEach(x => { if(!set[x]){ set[x] = 1; go(x); } }); })(startId); return set;
  }
  const upOf = id => (SL.store.skill(id) ? SL.store.skill(id).requires.map(r => r.id) : []);
  const downOf = id => R.dependents(id).map(d => d.id);
  const sec = (title, kids, note) => h('div', { class:'panel flat' }, h('h3', title), note ? h('div', { class:'tiny muted', style:{ margin:'-4px 0 8px' } }, note) : null, h('div', { class:'col' }, kids));
  const intOpt = { int:true, min:0 };

  ui.skillForm = function(id, api){
    const D = SL.store.get(), s0 = SL.store.skill(id);
    if(!s0) return h('div', { class:'muted' }, 'ไม่พบสกิล');
    const el = h('div', { class:'col gap-lg' }), prev = h('div', { class:'col' }), issues = h('div'); let prevLv = s0.maxLevel;
    const sk = () => SL.store.skill(id);
    const skillOpts = (exclude) => D.skills.filter(x => !exclude[x.id]).map(x => ({ v: x.id, t: x.name + ' (' + x.id + ')' }));
    const statOpts = cur => { const o = D.statDefs.map(sd => ({ v: sd.id, t: sd.name })); if(cur && !o.some(x => x.v === cur)) o.push({ v: cur, t: cur + ' (ไม่พบ)' }); return o; };
    function drawPrev(){
      const s = sk(); if(!s) return; ui.clear(prev);
      prev.appendChild(h('div', { class:'row' }, h('span', { class:'muted small' }, 'ดูที่เลเวล'), ui.num(prevLv, v => { prevLv = v; drawPrev(); }, { min:1, max:s.maxLevel, int:true, label:'เลเวลตัวอย่าง' })));
      prev.appendChild(ui.skillBrief(s, prevLv)); prev.appendChild(ui.levelTable(s, prevLv));
    }
    function drawIssues(){
      ui.clear(issues); const list = R.validate(SL.store.get()).filter(i => i.ref === id && i.level !== 'info');
      if(!list.length) return;
      issues.appendChild(h('div', { class:'panel flat' }, h('h3', 'ข้อควรตรวจ'), list.map(i => h('div', { class:'issue' }, h('span', { class:'lvl ' + (i.level === 'error' ? 'bad' : 'warn') }, i.level === 'error' ? 'ผิดพลาด' : 'เตือน'), h('span', i.msg)))));
    }
    // commit = แก้ข้อมูลสกิลนี้ผ่าน store แล้ววาดส่วนที่เกี่ยวข้องใหม่ (ไม่ rebuild ฟอร์ม เพื่อไม่ให้โฟกัสหลุด)
    const C = (fn, rebuild) => { api.commit(d => { const s = d.skills.find(x => x.id === id); if(s) fn(s, d); }); if(rebuild) api.rebuild(); else { drawPrev(); drawIssues(); } };

    /* ---- 1) ข้อมูลหลัก ---- */
    const s = s0, cls = D.classes.map(c => ({ v: c.id, t: c.name }));
    const branches = [{ v:'', t:'(ไม่มีสาย)' }].concat(D.branches.filter(b => b.class === s.class).map(b => ({ v: b.id, t: b.name })));
    el.appendChild(issues);
    el.appendChild(sec('ข้อมูลหลัก', [
      h('div', { class:'row' }, ui.field('รหัส (id)', ui.text(s.id, v => api.rename(s.id, v), { width:'150px' }), 'เปลี่ยนแล้วระบบแก้การอ้างอิงให้ทั้งหมด'), ui.field('ชื่อสกิล', ui.text(s.name, v => C(x => { x.name = v; }, true), { width:'200px' }))),
      ui.field('คำอธิบาย', h('textarea', { rows:2, value: s.desc, onchange: ev => C(x => { x.desc = ev.target.value; }) })),
      h('div', { class:'row' },
        ui.field('คลาส', ui.select(cls, s.class, v => C(x => { x.class = v; if(!D.branches.some(b => b.id === x.branch && b.class === v)) x.branch = ''; }, true))),
        ui.field('สาย (คอลัมน์ในกราฟ)', ui.select(branches, s.branch, v => C(x => { x.branch = v; }, true))),
        ui.field('ชนิด', ui.select(Object.keys(ui.TYPES).map(k => ({ v: k, t: ui.TYPES[k].t })), s.type, v => C(x => { x.type = v; }, true)))),
      h('div', { class:'row' },
        ui.field('Tier (แถวในกราฟ)', ui.num(s.tier, v => C(x => { x.tier = v; }, true), { min:1, int:true })),
        ui.field('Job Lv ที่ปลดล็อก', ui.num(s.jobLvReq, v => C(x => { x.jobLvReq = v; }, true), { min:1, int:true })),
        ui.field('เลเวลสูงสุด', ui.num(s.maxLevel, v => C(x => { x.maxLevel = v; }, true), { min:1, max:99, int:true })))]));

    /* ---- 2) การเชื่อมต่อ ---- */
    const anc = closure(id, upOf), desc = closure(id, downOf), self = {}; self[id] = 1;
    const reqRows = s.requires.map((r, i) => h('div', { class:'row' },
      ui.select(skillOpts(self).concat(D.skills.some(x => x.id === r.id) ? [] : [{ v: r.id, t: r.id + ' (ไม่พบ)' }]), r.id, v => C(x => { x.requires[i].id = v; }, true), { label:'สกิลที่ต้องมี' }),
      h('span', { class:'muted small' }, 'Lv ≥'), ui.num(r.lv, v => C(x => { x.requires[i].lv = v; }), { min:1, int:true, label:'เลเวลที่ต้องมี' }),
      h('button', { class:'btn sm danger', type:'button', onclick: () => C(x => { x.requires.splice(i, 1); }, true) }, '✕')));
    const blockedUp = Object.assign({ [id]: 1 }, desc); s.requires.forEach(r => { blockedUp[r.id] = 1; });
    const deps = R.dependents(id), blockedDown = Object.assign({ [id]: 1 }, anc); deps.forEach(d => { blockedDown[d.id] = 1; });
    el.appendChild(sec('การเชื่อมต่อสกิล', [
      h('div', { class:'small muted' }, 'ต้องมีสกิลเหล่านี้ถึงเลเวลที่กำหนดก่อนจึงเรียนสกิลนี้ได้ (ครบทุกข้อ):'),
      reqRows.length ? reqRows : h('div', { class:'small muted' }, '— ไม่มีเงื่อนไข (เรียนได้เมื่อถึง Job Lv.) —'),
      ui.select([{ v:'', t:'＋ เพิ่มเงื่อนไข: เลือกสกิลที่ต้องมีก่อน' }].concat(skillOpts(blockedUp)), '', v => { if(v) C(x => { x.requires.push({ id: v, lv: 1 }); }, true); }, { label:'เพิ่มเงื่อนไข' }),
      h('hr'),
      h('div', { class:'small muted' }, 'สกิลที่ใช้สกิลนี้เป็นเงื่อนไข (ปลดล็อกต่อ):'),
      deps.length ? deps.map(d => h('div', { class:'row' },
        h('button', { class:'chip', type:'button', style:{ cursor:'pointer' }, onclick: () => api.jump(d.id) }, d.name), h('span', { class:'muted small' }, 'ต้อง Lv ≥'),
        ui.num(d.requires.find(r => r.id === id).lv, v => api.commit(dd => { const t = dd.skills.find(x => x.id === d.id); if(t) t.requires.forEach(r => { if(r.id === id) r.lv = v; }); }), { min:1, int:true, label:'เลเวลที่ต้องมี' }),
        h('button', { class:'btn sm danger', type:'button', onclick: () => { api.commit(dd => { const t = dd.skills.find(x => x.id === d.id); if(t) t.requires = t.requires.filter(r => r.id !== id); }); api.rebuild(); } }, 'ถอดการเชื่อม'))) : h('div', { class:'small muted' }, '— ยังไม่มีสกิลที่ต่อจากสกิลนี้ —'),
      ui.select([{ v:'', t:'＋ ให้สกิลนี้เป็นเงื่อนไขของ…' }].concat(skillOpts(blockedDown)), '', v => { if(v){ api.commit(dd => { const t = dd.skills.find(x => x.id === v); if(t) t.requires.push({ id: id, lv: 1 }); }); api.rebuild(); } }, { label:'ต่อสกิลอื่น' })],
      'ย้าย/ลบ/เพิ่มการเชื่อมได้จากทั้งสองฝั่ง กราฟในแท็บ "ต้นไม้สกิล" วาดเส้นใหม่ให้อัตโนมัติ'));

    /* ---- 3) อาวุธ ---- */
    const dts = Array.from(new Set(D.weapons.map(w => w.damageType))), wcs = Array.from(new Set(D.weapons.map(w => w.weaponClass)));
    const wcLabel = c => { const w = D.weapons.find(x => x.weaponClass === c); return w ? w.name.replace(/ ?\d ?มือ/, '').trim() : c; };
    const wcBox = (key) => h('div', { class:'row' }, wcs.map(c => ui.check(wcLabel(c), s.weaponReq[key].indexOf(c) >= 0, on => C(x => { const a = x.weaponReq[key]; const i = a.indexOf(c); if(on && i < 0) a.push(c); if(!on && i >= 0) a.splice(i, 1); }))));
    el.appendChild(sec('เงื่อนไขอาวุธ / โล่', [
      h('div', { class:'row' }, ui.field('ชนิดการถือ', ui.select([{ v:'', t:'ไม่จำกัด' }, { v:'1H', t:'1 มือ' }, { v:'2H', t:'2 มือ' }], s.weaponReq.slotType, v => C(x => { x.weaponReq.slotType = v; }))),
        ui.field('ประเภทดาเมจอาวุธ', ui.select([{ v:'', t:'ไม่จำกัด' }].concat(dts.map(d => ({ v: d, t: d }))), s.weaponReq.damageType, v => C(x => { x.weaponReq.damageType = v; }))),
        ui.check('ต้องสวมโล่', s.needShield, v => C(x => { x.needShield = v; }))),
      h('div', { class:'small muted' }, 'ใช้ได้เฉพาะอาวุธ (ไม่เลือก = ทุกชนิด):'), wcBox('include'), h('div', { class:'small muted' }, 'ใช้ไม่ได้กับอาวุธ:'), wcBox('exclude')],
      'ใช้ทั้งกับ passive (ไม่ตรงเงื่อนไข = ไม่มีผล) และกับการกดใช้สกิล'));

    /* ---- 4) การใช้งาน ---- */
    if(s.type !== 'passive'){
      const us = (key, label, scale, hint) => ui.field(label, ui.sInput(s.usage[key], { maxLv: s.maxLevel, scale: scale || 1, onChange: S => C(x => { if(typeof S === 'number' && S === 0) delete x.usage[key]; else x.usage[key] = S; }) }), hint);
      el.appendChild(sec('การใช้งาน', [us('sp', 'SP ที่ใช้'), us('hp', 'HP ที่เสีย (% ของ HP สูงสุด)', 100), us('cooldown', 'คูลดาวน์ (วินาที)'),
        us('duration', 'ระยะเวลาผล (วินาที)', 1, s.type === 'toggle' ? 'toggle ไม่ใช้ค่านี้' : 'ต้องมี duration ถ้ามี effect ถึงจะเกิดสถานะ'),
        s.type === 'toggle' ? us('hpDrain', 'HP ไหลต่อวินาที (% ของสูงสุด)', 100) : null, s.type === 'toggle' ? us('spDrain', 'SP ไหลต่อวินาที') : null,
        ui.check('ใช้เวลาแทนการตี 1 ครั้ง', s.usage.usesAction === undefined ? s.type !== 'toggle' : !!s.usage.usesAction, v => C(x => { x.usage.usesAction = v; }))]));
    }

    /* ---- 5) ดาเมจ + 6) ฟื้นฟู ---- */
    if(s.type !== 'passive'){
      const termRows = s.damage.terms.map((t, i) => h('div', { class:'row' },
        ui.select(statOpts(t.stat), t.stat, v => C(x => { x.damage.terms[i].stat = v; }), { label:'สเตตัส' }), h('span', { class:'muted small' }, '×'),
        ui.sInput(t.mult, { maxLv: s.maxLevel, scale: 100, digits: 1, onChange: S => C(x => { x.damage.terms[i].mult = S; }) }), h('span', { class:'muted small' }, '%'),
        h('button', { class:'btn sm danger', type:'button', onclick: () => C(x => { x.damage.terms.splice(i, 1); }, true) }, '✕')));
      el.appendChild(sec('ดาเมจ', [
        ui.field('ชนิดดาเมจ', ui.select([{ v:'', t:'ไม่มีดาเมจ' }, { v:'physical', t:'กายภาพ (คิด DEF)' }, { v:'magic', t:'เวทมนตร์ (คิด MDEF)' }], s.damage.kind, v => C(x => { x.damage.kind = v; if(v && !x.damage.terms.length) x.damage.terms.push({ stat: v === 'magic' ? 'matk' : 'atk', mult: { base:1, step:0.2 } }); }, true))),
        s.damage.kind ? [h('div', { class:'small muted' }, 'ดาเมจดิบ = ผลรวมของ (เปอร์เซ็นต์ × ค่าสเตตัส) ทุกบรรทัด'), termRows,
          h('button', { class:'btn sm', type:'button', onclick: () => C(x => { x.damage.terms.push({ stat:'atk', mult:1 }); }, true) }, '＋ เพิ่มส่วนประกอบสูตร'),
          h('div', { class:'row' }, ui.check('ห้ามคริติคอล', s.damage.noCrit, v => C(x => { x.damage.noCrit = v; })), ui.check('โดนเสมอ', s.damage.alwaysHit, v => C(x => { x.damage.alwaysHit = v; })), ui.check('ระยะกว้าง (AoE)', s.damage.aoe, v => C(x => { x.damage.aoe = v; })))] : null]));
      el.appendChild(sec('ฟื้นฟู HP', [ui.check('สกิลนี้ฟื้น HP ตัวเอง', !!s.heal, v => C(x => { x.heal = v ? { pctMaxHp: { base:0.05, step:0.02 } } : null; }, true)),
        s.heal ? ui.field('% ของ HP สูงสุด', ui.sInput(s.heal.pctMaxHp, { maxLv: s.maxLevel, scale: 100, digits: 1, onChange: S => C(x => { if(x.heal) x.heal.pctMaxHp = S; }) })) : null,
        s.heal ? ui.field('ค่าคงที่เพิ่ม', ui.sInput(s.heal.flat || 0, { maxLv: s.maxLevel, onChange: S => C(x => { if(x.heal) x.heal.flat = S; }) })) : null]));
    }

    /* ---- 7) ผล (effects) ---- */
    const effRows = s.effects.map((e, i) => { const sd = SL.calc.statDef(e.stat), scale = (e.mode === 'percent' || (sd && sd.kind === 'frac')) ? 100 : 1;
      return h('div', { class:'panel', style:{ padding:'8px' } }, h('div', { class:'row' },
        ui.select(statOpts(e.stat), e.stat, v => C(x => { x.effects[i].stat = v; }, true), { label:'สเตตัส' }),
        ui.select([{ v:'flat', t:'บวกตรง ๆ' }, { v:'percent', t:'บวก %' }], e.mode, v => C(x => { x.effects[i].mode = v; }, true), { label:'วิธีคิด' }),
        s.type === 'passive' ? null : ui.select([{ v:'self', t:'ตัวเอง' }, { v:'target', t:'เป้าหมาย' }], e.appliesTo, v => C(x => { x.effects[i].appliesTo = v; }), { label:'ใช้กับ' }),
        h('button', { class:'btn sm danger right', type:'button', onclick: () => C(x => { x.effects.splice(i, 1); }, true) }, '✕')),
        h('div', { class:'row', style:{ marginTop:'6px' } }, ui.sInput(e.value, { maxLv: s.maxLevel, scale: scale, digits: 2, onChange: S => C(x => { x.effects[i].value = S; }) }), h('span', { class:'muted small' }, scale === 100 ? '%' : ''))); });
    el.appendChild(sec('ผลต่อสเตตัส (effects)', [effRows.length ? effRows : h('div', { class:'small muted' }, '— ยังไม่มี —'),
      h('button', { class:'btn sm', type:'button', onclick: () => C(x => { x.effects.push({ stat:'atk', mode:'flat', value:{ base:1, step:1 }, appliesTo:'self' }); }, true) }, '＋ เพิ่มผล')],
      'passive = ได้ผลตลอด · buff/toggle/trigger = ได้ผลเมื่อติดสถานะ · "บวก %" คูณทั้งก้อนสเตตัส (บัฟ % รวมกันถูกจำกัดตาม buffPercentCap ในหน้าข้อมูล)'));

    /* ---- 8) เงื่อนไขพิเศษ ---- */
    const sp = [ui.field('กลุ่มสถานะ (group)', ui.text(s.group || '', v => C(x => { x.group = v.trim(); }), { width:'160px' }), 'ใช้สกิลที่มี group เดียวกัน = สถานะเก่าถูกแทนที่')];
    if(s.type === 'trigger'){ const t = s.trigger || {};
      sp.push(h('div', { class:'row' }, ui.field('เปิดเมื่อ HP ≤ %', ui.num(Math.round((t.hpBelow || 0) * 100), v => C(x => { x.trigger = Object.assign({}, x.trigger, { hpBelow: v / 100 }); }), { min:0, max:100 })),
        ui.field('ปิดเมื่อ HP > %', ui.num(Math.round((t.hpAbove === undefined ? 1 : t.hpAbove) * 100), v => C(x => { x.trigger = Object.assign({}, x.trigger, { hpAbove: v / 100 }); }), { min:0, max:100 })),
        ui.field('คูลดาวน์ (วิ)', ui.num(t.cooldown || 0, v => C(x => { x.trigger = Object.assign({}, x.trigger, { cooldown: v }); }), { min:0 })))); }
    if(s.type === 'toggle') sp.push(ui.field('ปิดเองเมื่อ HP < %', ui.num(Math.round(((s.toggleOff || {}).hpBelow || 0) * 100), v => C(x => { x.toggleOff = v > 0 ? { hpBelow: v / 100 } : null; }), { min:0, max:100 }), '0 = ไม่ปิดเอง'));
    sp.push(ui.field('hooks (JSON อิสระ สำหรับระบบอนาคต เช่น knockback, stun)', h('textarea', { rows:2, value: JSON.stringify(s.hooks || {}), onchange: ev => {
      try{ const o = JSON.parse(ev.target.value || '{}'); C(x => { x.hooks = o; }); }catch(e){ ui.toast('hooks ต้องเป็น JSON: ' + e.message); } } }), 'ตอนนี้ระบบจำลองยังไม่ใช้ แต่เก็บ/ส่งออกไว้ให้'));
    el.appendChild(sec('เงื่อนไขพิเศษ', sp));
    el.appendChild(sec('ตัวอย่างค่า', [prev]));
    drawPrev(); drawIssues();
    return el;
  };
})(typeof window !== 'undefined' ? window : globalThis);
