/* ============================================================
   MODULE 03 — rules : กติกาของต้นไม้สกิล (เรียนสกิล / ปลดล็อก / เงื่อนไข / งบแต้ม / ตรวจความถูกต้อง)
   ไม่แตะ DOM และไม่รู้จัก engine — อ่านแค่ data (SL.store) กับ state (SL.state)
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const { val } = SL.util;
  const rules = {};

  const D = () => SL.store.get();

  // รายการคลาสจากรากถึงคลาสที่ระบุ เช่น ['novice','swordman']
  rules.chain = function(classId){
    const out = []; const seen = {};
    let cur = SL.store.klass(classId);
    while(cur && !seen[cur.id]){ seen[cur.id] = 1; out.unshift(cur.id); cur = cur.parent ? SL.store.klass(cur.parent) : null; }
    return out;
  };
  rules.visibleSkills = function(classId){
    const ch = rules.chain(classId);
    return D().skills.filter(s => ch.indexOf(s.class) >= 0);
  };
  // งบแต้มแยกตามคลาสในสาย: คลาสก่อนหน้าถือว่าจบ Job Lv สูงสุดแล้ว คลาสปัจจุบันใช้ jobLv ของ state
  rules.pointInfo = function(state){
    const ch = rules.chain(state.classId);
    return ch.map((cid, i) => {
      const c = SL.store.klass(cid); const cur = i === ch.length - 1;
      const total = Math.max(0, ((cur ? state.jobLv : c.jobLvCap) - 1) * (c.pointsPerJobLv || 1));
      let spent = 0; D().skills.forEach(s => { if(s.class === cid) spent += state.learned[s.id] || 0; });
      return { classId: cid, name: c.name, total, spent, left: total - spent, current: cur };
    });
  };
  rules.jobLvFor = function(classId, state){
    return classId === state.classId ? state.jobLv : (SL.store.klass(classId) || { jobLvCap: 1 }).jobLvCap;
  };
  rules.dependents = function(id){ return D().skills.filter(s => s.requires.some(r => r.id === id)); };

  rules.reqStatus = function(skill, state){
    return skill.requires.map(r => {
      const t = SL.store.skill(r.id);
      return { id: r.id, lv: r.lv, name: t ? t.name : r.id + ' (ไม่พบ)', have: state.learned[r.id] || 0, ok: (state.learned[r.id] || 0) >= r.lv };
    });
  };
  rules.canLearn = function(skill, state){
    const lv = state.learned[skill.id] || 0;
    if(lv >= skill.maxLevel) return { ok:false, reason:'เลเวลเต็มแล้ว' };
    if(rules.chain(state.classId).indexOf(skill.class) < 0) return { ok:false, reason:'ไม่ใช่สกิลของสายนี้' };
    const need = skill.jobLvReq, have = rules.jobLvFor(skill.class, state);
    if(have < need) return { ok:false, reason:'ต้องการ Job Lv.' + need };
    const bad = rules.reqStatus(skill, state).find(r => !r.ok);
    if(bad) return { ok:false, reason:'ต้องมี ' + bad.name + ' Lv.' + bad.lv };
    const pool = rules.pointInfo(state).find(p => p.classId === skill.class);
    if(!pool || pool.left <= 0) return { ok:false, reason:'แต้มของ ' + (pool ? pool.name : skill.class) + ' หมด' };
    return { ok:true, reason:'' };
  };
  rules.canUnlearn = function(skill, state){
    const lv = state.learned[skill.id] || 0;
    if(lv <= 0) return { ok:false, reason:'ยังไม่ได้เรียน' };
    const blocker = rules.dependents(skill.id).find(d => (state.learned[d.id] || 0) > 0 &&
      d.requires.some(r => r.id === skill.id && r.lv > lv - 1));
    if(blocker) return { ok:false, reason:'ถูกใช้เป็นเงื่อนไขของ ' + blocker.name };
    return { ok:true, reason:'' };
  };
  rules.learn = function(id){
    const s = SL.store.skill(id); if(!s) return;
    SL.state.change(st => { if(rules.canLearn(s, st).ok) st.learned[id] = (st.learned[id] || 0) + 1; });
  };
  rules.unlearn = function(id){
    const s = SL.store.skill(id); if(!s) return;
    SL.state.change(st => { if(rules.canUnlearn(s, st).ok){ st.learned[id] -= 1; if(st.learned[id] <= 0) delete st.learned[id]; } });
  };
  // โหลดบิลด์สำเร็จรูป (ตั้งคลาส, Job Lv, สกิล, พรีเซ็ตสเตตัส)
  rules.applyBuild = function(buildId){
    const b = SL.store.find('builds', buildId); if(!b) return;
    SL.state.change(st => {
      st.classId = b.classId; st.jobLv = b.jobLv; st.learned = SL.util.clone(b.learned || {});
      const p = SL.store.find('presets', b.presetId);
      if(p){
        st.presetId = p.id; st.weaponId = p.weaponId; st.hasShield = !!p.hasShield; st.sheet = SL.util.clone(p.sheet);
        st.baseLv = b.classId === 'novice' ? 10 : 50;
        st.rawStats = { str: p.sheet.str || 1, agi: p.sheet.agi || 1, vit: p.sheet.vit || 1, int: p.sheet.int || 1, dex: p.sheet.dex || 1, luk: p.sheet.luk || 1 };
      }
      st.rotation = [];
    });
    SL.state.change(st => { st.rotation = rules.defaultRotation(st); });
  };

  // เงื่อนไขอาวุธ/โล่ ของสกิล (ใช้ทั้งตอนคิดผล passive และตอนร่ายสกิล)
  rules.weaponOk = function(skill, weapon, hasShield){
    const r = skill.weaponReq || {};
    if(skill.needShield && !(hasShield && weapon && weapon.slotType === '1H')) return false;
    if(!weapon) return !(r.slotType || r.damageType || (r.include && r.include.length));
    if(r.slotType && weapon.slotType !== r.slotType) return false;
    if(r.damageType && weapon.damageType !== r.damageType) return false;
    if(r.include && r.include.length && r.include.indexOf(weapon.weaponClass) < 0) return false;
    if(r.exclude && r.exclude.length && r.exclude.indexOf(weapon.weaponClass) >= 0) return false;
    return true;
  };

  rules.isCastable = s => s.type === 'active' || s.type === 'buff' || s.type === 'toggle';

  // สร้างลำดับสกิลอัตโนมัติ: บัฟ/toggle → ดีบัฟ → สกิลดาเมจ (แรงสุดก่อน) → ฮีล
  rules.defaultRotation = function(state){
    const items = [];
    rules.visibleSkills(state.classId).forEach(s => {
      const lv = state.learned[s.id] || 0;
      if(lv <= 0 || !rules.isCastable(s)) return;
      let rank = 2, score = 0;
      const dmg = s.damage && s.damage.kind;
      if(s.type === 'buff' || s.type === 'toggle') rank = 0;
      else if(!dmg && s.heal) rank = 3;
      else if(!dmg) rank = 1;
      if(dmg) score = (s.damage.terms || []).reduce((a, t) => a + Math.abs(val(t.mult, lv)), 0);
      items.push({ s, rank, score });
    });
    items.sort((a, b) => a.rank - b.rank || b.score - a.score);
    return items.map(it => ({ id: it.s.id, minSpPct: 0, minHpPct: 0, maxHpPct: it.rank === 3 ? 0.7 : 1, skipIfActive: true }));
  };

  /* ---------------- ตรวจความถูกต้องของข้อมูลทั้งชุด ---------------- */
  rules.validate = function(data){
    const issues = [];
    const add = (level, msg, ref) => issues.push({ level, msg, ref: ref || '' });
    const ids = {}; const stat = {}; data.statDefs.forEach(s => stat[s.id] = 1);
    const cls = {}; data.classes.forEach(c => cls[c.id] = c);
    data.classes.forEach(c => {
      if(c.parent && !cls[c.parent]) add('error', 'คลาส "' + c.name + '" อ้าง parent ที่ไม่มี: ' + c.parent, c.id);
    });
    data.classes.forEach(c => {            // วงวน parent
      const seen = {}; let cur = c;
      while(cur && cur.parent){ if(seen[cur.id]){ add('error', 'ลำดับ parent ของคลาส "' + c.name + '" วนเป็นวงกลม', c.id); break; } seen[cur.id] = 1; cur = cls[cur.parent]; }
    });
    data.skills.forEach(s => {
      if(ids[s.id]) add('error', 'id ซ้ำ: ' + s.id, s.id); ids[s.id] = s;
    });
    data.skills.forEach(s => {
      const nm = s.name + ' (' + s.id + ')';
      if(!cls[s.class]) add('error', nm + ': ไม่พบคลาส "' + s.class + '"', s.id);
      else {
        const br = data.branches.find(b => b.id === s.branch);
        if(s.branch && !br) add('warn', nm + ': ไม่พบสาย "' + s.branch + '"', s.id);
        else if(br && br.class !== s.class) add('warn', nm + ': สายนี้เป็นของคลาส ' + br.class, s.id);
        if(s.jobLvReq > cls[s.class].jobLvCap) add('warn', nm + ': ต้องการ Job Lv.' + s.jobLvReq + ' แต่คลาสสูงสุด ' + cls[s.class].jobLvCap + ' (เรียนไม่ได้)', s.id);
      }
      s.requires.forEach(r => {
        const t = ids[r.id];
        if(r.id === s.id) add('error', nm + ': อ้างตัวเองเป็นเงื่อนไข', s.id);
        else if(!t) add('error', nm + ': เงื่อนไขอ้างสกิลที่ไม่มี "' + r.id + '"', s.id);
        else {
          if(r.lv > t.maxLevel) add('error', nm + ': ต้องการ ' + t.name + ' Lv.' + r.lv + ' แต่สกิลนั้นสูงสุด Lv.' + t.maxLevel, s.id);
          if(t.class === s.class && t.jobLvReq > s.jobLvReq) add('warn', nm + ': เงื่อนไข ' + t.name + ' ปลดล็อกที่ Job Lv.' + t.jobLvReq + ' หลังตัวสกิลเอง (Lv.' + s.jobLvReq + ')', s.id);
          if(cls[s.class] && cls[t.class]){
            const chain = []; let cur = cls[s.class]; const seen = {};
            while(cur && !seen[cur.id]){ seen[cur.id] = 1; chain.push(cur.id); cur = cls[cur.parent]; }
            if(chain.indexOf(t.class) < 0) add('warn', nm + ': เงื่อนไขมาจากคลาส ' + t.class + ' ซึ่งไม่ใช่คลาสในสายเดียวกัน', s.id);
          }
        }
      });
      s.effects.forEach(e => { if(!stat[e.stat]) add('error', nm + ': effect อ้างสเตตัส "' + e.stat + '" ที่ไม่มีใน statDefs', s.id); });
      (s.damage.terms || []).forEach(t => { if(!stat[t.stat]) add('error', nm + ': สูตรดาเมจอ้างสเตตัส "' + t.stat + '" ที่ไม่มี', s.id); });
      if(s.damage.kind && !(s.damage.terms || []).length) add('warn', nm + ': มีชนิดดาเมจแต่ไม่มีสูตร (terms)', s.id);
      if(s.type === 'active' && !s.damage.kind && !s.heal && !s.effects.length) add('warn', nm + ': สกิล active ที่ไม่มีดาเมจ/ฮีล/effect เลย', s.id);
      if((s.type === 'active' || s.type === 'buff') && s.effects.length && !(s.usage.duration)) add('warn', nm + ': มี effect แต่ไม่ได้ตั้ง duration (จะไม่มีผล)', s.id);
      if(s.type === 'trigger' && !s.trigger) add('error', nm + ': สกิล trigger ต้องมีเงื่อนไข trigger', s.id);
      if(s.type === 'toggle' && !s.effects.length) add('warn', nm + ': toggle ที่ไม่มี effect', s.id);
      if(s.type === 'passive' && s.effects.length === 0) add('warn', nm + ': passive ที่ไม่มี effect', s.id);
    });
    // วงวนของ prerequisite
    const color = {};
    function dfs(id, path){
      if(color[id] === 2) return; if(color[id] === 1){ add('error', 'เงื่อนไขสกิลวนเป็นวงกลม: ' + path.concat(id).join(' → '), id); return; }
      color[id] = 1; const s = ids[id];
      if(s) s.requires.forEach(r => { if(ids[r.id]) dfs(r.id, path.concat(id)); });
      color[id] = 2;
    }
    data.skills.forEach(s => dfs(s.id, []));
    // สรุปงบแต้ม
    data.classes.forEach(c => {
      const own = data.skills.filter(s => s.class === c.id);
      if(!own.length) return;
      const levels = own.reduce((a, s) => a + s.maxLevel, 0), pts = (c.jobLvCap - 1) * (c.pointsPerJobLv || 1);
      add('info', c.name + ': ' + own.length + ' สกิล รวม ' + levels + ' เลเวล เทียบแต้ม ' + pts + ' (ซื้อได้ ' + Math.round(Math.min(1, pts / levels) * 100) + '%)', c.id);
    });
    return issues;
  };

  SL.rules = rules;
})(typeof window !== 'undefined' ? window : globalThis);
