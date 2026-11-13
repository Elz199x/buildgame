/* ============================================================
   MODULE 09 — ui-sim : หน้า "จำลองต่อสู้ (DPS)" — การต่อสู้/สเตตัส/ดาเมจทั้งหมดคำนวณบนเซิร์ฟเวอร์ผ่าน API
   ไคลเอนต์ส่งเฉพาะคำสั่ง (เวลาที่ผ่านไป, สกิลที่กด, ตัวละครในแซนด์บ็อกซ์) แล้ววาดผลที่ได้กลับมา; ลูปทำงานเฉพาะตอนเปิดแท็บนี้
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h, R = SL.rules, fmt = SL.util.fmt, SB = SL.sandbox;
  let sim = null, running = true, speed = 1, raf = 0, last = 0, visible = false, slowT = 0, root = null;
  const E = { sheet: {}, mon: {} }, panels = {}; let sheetSig = '', barSig = '', skillBtns = [], speedBtns = [], runBtn = null;

  function ensureSim(){ if(!sim) sim = SL.remoteSim(() => SB.get()); }

  /* ---------- สเตตัสชีต + นำเข้า JSON ---------- */
  function buildSheet(box){
    const D = SL.store.get(); E.sheet = {}; ui.clear(box); let grp = '', row = null;
    D.statDefs.forEach(sd => {
      if(sd.group !== grp){ grp = sd.group; box.appendChild(h('div', { class:'muted tiny', style:{ marginTop:'6px' } }, grp)); row = h('div', { class:'row' }); box.appendChild(row); }
      E.sheet[sd.id] = ui.num(+SB.get().sheet[sd.id] || 0, v => SB.change(s => { s.sheet[sd.id] = v; }), { label: sd.name });
      row.appendChild(ui.field(sd.name + (sd.kind === 'frac' ? ' (0.15=15%)' : sd.kind === 'pct' ? ' (%)' : ''), E.sheet[sd.id]));
    });
    const ta = h('textarea', { rows:4, placeholder:'วาง JSON เช่น {"atk":56,"aspd":105,"maxHp":1904} หรือ {"stats":{...},"weaponId":"sword_2h"}', 'aria-label':'นำเข้าสเตตัส JSON' });
    box.appendChild(h('hr')); box.appendChild(h('div', { class:'muted tiny' }, 'นำเข้าค่าสเตตัสจากที่อื่น (เช่น Status Lab) — ใช้เฉพาะคีย์ที่ตรงกับรหัสสเตตัส'));
    box.appendChild(ta);
    box.appendChild(h('div', { class:'row' }, h('button', { class:'btn sm', type:'button', onclick: () => {
      try{
        const o = JSON.parse(ta.value), src = o.stats || o.derived || o.sheet || o; let n = 0;
        SB.change(s => { D.statDefs.forEach(sd => { if(typeof src[sd.id] === 'number' && isFinite(src[sd.id])){ s.sheet[sd.id] = src[sd.id]; n++; } });
          if(o.weaponId && SL.store.find('weapons', o.weaponId)) s.weaponId = o.weaponId; if(typeof o.hasShield === 'boolean') s.hasShield = o.hasShield; });
        ui.toast('นำเข้า ' + n + ' ค่า');
      }catch(e){ ui.toast('JSON ไม่ถูกต้อง: ' + e.message); } } }, 'นำเข้า')));
  }
  function syncSheet(){
    const D = SL.store.get(), sig = D.statDefs.map(s => s.id + s.name).join('|');
    if(sig !== sheetSig){ sheetSig = sig; buildSheet(E.sheetBox); }
    D.statDefs.forEach(sd => { const el = E.sheet[sd.id]; if(el && document.activeElement !== el) el.value = +SB.get().sheet[sd.id] || 0; });
  }
  function syncMonster(){
    const st = SB.get(), D = SL.store.get();
    const sig = D.monsters.map(m => m.id + m.name).join('|');
    if(E.monSig !== sig){ E.monSig = sig; ui.clear(E.monSel);
      D.monsters.forEach(m => E.monSel.appendChild(h('option', { value: m.id }, m.name))); }
    E.monSel.value = st.monsterPresetId;
    Object.keys(E.mon).forEach(k => { if(document.activeElement !== E.mon[k]) E.mon[k].value = st.monster[k]; });
    E.counter.querySelector('input').checked = !!st.monster.counter; E.immortal.querySelector('input').checked = !!st.opts.immortal; E.auto.querySelector('input').checked = st.opts.auto !== false;
    if(document.activeElement !== E.aoe) E.aoe.value = st.opts.aoeTargets || 1;
  }

  /* ---------- แถบสกิล ---------- */
  function rebuildSkillbar(){
    const st = SB.get(), list = R.visibleSkills(st.classId).filter(s => R.isCastable(s) && st.learned[s.id]);
    const sig = list.map(s => s.id + ':' + st.learned[s.id] + s.name).join('|'); if(sig === barSig) return; barSig = sig; skillBtns = [];
    ui.clear(E.bar);
    if(!list.length){ E.bar.appendChild(h('div', { class:'muted small' }, 'ยังไม่มีสกิลที่ใช้ได้ — ไปที่แท็บ "ต้นไม้สกิล" เพื่อเรียน หรือโหลดบิลด์ตัวอย่างทางซ้าย')); return; }
    list.forEach(s => { const lv = st.learned[s.id], u = SL.calc.usage(s, lv), ov = h('div', { class:'cdov' });
      const b = h('button', { class:'sk', type:'button', onclick: () => { ensureSim(); sim.cast(s.id); } }, ov, h('b', s.name),
        h('small', 'Lv' + lv + (u.sp ? ' · SP ' + fmt(u.sp, 0) : '') + (u.cooldown ? ' · CD ' + fmt(u.cooldown, 0) : '') + (s.type === 'toggle' ? ' · สลับ' : '')));
      skillBtns.push({ id: s.id, b: b, ov: ov, cd: u.cooldown }); E.bar.appendChild(b); });
  }

  /* ---------- วาดต่อเฟรม ---------- */
  const barSet = (bar, cur, max, txt) => { bar.firstChild.style.width = Math.max(0, Math.min(100, max > 0 ? cur / max * 100 : 0)) + '%'; bar.lastChild.textContent = txt; };
  function chips(box, list, name){
    const key = list.map(x => x.id + Math.ceil(isFinite(x.left) ? x.left : 999)).join(','); if(box._k === key) return; box._k = key; ui.clear(box);
    list.forEach(x => { const s = SL.store.skill(x.id); if(!s) return;
      box.appendChild(h('span', { class:'chip ' + (ui.TYPES[s.type] || {}).c }, s.name + ' Lv' + x.lv + (isFinite(x.left) ? ' · ' + Math.ceil(x.left) + 's' : ' · เปิดอยู่'))); });
  }
  function floatAt(actor, text, cls){
    const f = h('div', { class:'float ' + cls, style:{ left: (18 + Math.random() * 52) + '%', top: (34 + Math.random() * 22) + 'px' } }, text);
    actor.appendChild(f); setTimeout(() => { if(f.parentNode) f.parentNode.removeChild(f); }, 1150);
  }
  function render(slow){
    if(!sim.ready()){ E.time.textContent = 'กำลังเชื่อมต่อเซิร์ฟเวอร์…'; return; }
    const v = sim.view(), st = SB.get();
    barSet(E.hp, v.hp, v.maxHp, Math.max(0, Math.round(v.hp)) + ' / ' + Math.round(v.maxHp));
    barSet(E.sp, v.sp, v.maxSp, Math.round(v.sp) + ' / ' + Math.round(v.maxSp));
    barSet(E.mhp, v.mAlive ? v.mhp : 0, v.mMax, v.mAlive ? Math.max(0, Math.round(v.mhp)) + ' / ' + Math.round(v.mMax) : 'เกิดใหม่ใน ' + v.respawnLeft.toFixed(1) + ' วิ');
    E.pActor.classList.toggle('dead', !v.alive); E.mActor.classList.toggle('dead', !v.mAlive);
    E.pInfo.textContent = (SL.store.klass(st.classId) || {}).name + ' Job Lv.' + st.jobLv + ' · ' + v.P.aps.toFixed(2) + ' ครั้ง/วิ' + (v.alive ? '' : ' · ล้ม ฟื้นใน ' + v.reviveLeft.toFixed(1) + ' วิ');
    E.mInfo.textContent = 'DEF ' + Math.round(v.M.def) + ' · MDEF ' + Math.round(v.M.mdef) + ' · FLEE ' + Math.round(v.M.flee) + ' · ATK ' + Math.round(v.M.atk);
    chips(E.pChips, v.pst); chips(E.mChips, v.mst);
    E.time.textContent = v.t.toFixed(1) + ' วิ';
    skillBtns.forEach(sb => { const s = SL.store.skill(sb.id), why = sim.why(sb.id), cdv = v.cd[sb.id] || 0, on = v.pst.some(x => x.id === sb.id);
      sb.ov.style.transform = 'scaleY(' + (sb.cd > 0 ? Math.min(1, cdv / sb.cd) : 0) + ')';
      sb.b.classList.toggle('off', !!why && !on); sb.b.classList.toggle('active', on); sb.b.classList.toggle('queued', v.queue.indexOf(sb.id) >= 0);
      const t = on && s.type === 'toggle' ? 'กดเพื่อปิด' : (why || 'กดเพื่อสั่งใช้ในจังหวะถัดไป'); if(sb.b.title !== t) sb.b.title = t; });
    const evs = sim.drain();
    evs.slice(-14).forEach(e => { if(e.kind === 'dmg') floatAt(E.mActor, e.amount, e.crit ? 'crit' : 'dmg'); else if(e.kind === 'miss') floatAt(E.mActor, 'MISS', 'miss');
      else if(e.kind === 'taken') floatAt(E.pActor, e.amount, 'taken'); else if(e.kind === 'dodge') floatAt(E.pActor, 'หลบ', 'miss'); else if(e.kind === 'heal') floatAt(E.pActor, '+' + Math.round(e.amount), 'heal'); });
    if(evs.length){ const near = E.log.scrollTop + E.log.clientHeight >= E.log.scrollHeight - 30;
      evs.filter(e => e.kind !== 'miss' || true).forEach(e => E.log.appendChild(h('div', { class:'k-' + e.kind }, '[' + (+e.t).toFixed(1) + '] ' + e.text)));
      while(E.log.childNodes.length > 120) E.log.removeChild(E.log.firstChild); if(near) E.log.scrollTop = E.log.scrollHeight; }
    if(slow){ renderLive(v); panels.fin.update(v); panels.dmg.update(v); }
  }
  function renderLive(v){
    const s = sim.summary(); if(!s) return; const rows = [];
    rows.push(h('tr', h('td', 'ตีธรรมดา'), h('td', { class:'n' }, s.basic.n), h('td', { class:'n' }, fmt(s.basic.dmg, 0)), h('td', { class:'n' }, Math.round(s.basic.share * 100) + '%')));
    s.skills.forEach(k => rows.push(h('tr', h('td', k.name), h('td', { class:'n' }, k.casts), h('td', { class:'n' }, fmt(k.dmg, 0)), h('td', { class:'n' }, Math.round(k.share * 100) + '%'))));
    const up = Object.keys(s.uptime).map(id => { const sk = SL.store.skill(id); return sk ? sk.name + ' ' + Math.round(s.uptime[id] * 100) + '%' : ''; }).filter(Boolean);
    ui.clear(E.live).appendChild(h('div', { class:'col' },
      h('div', { class:'row gap-lg' }, h('div', h('div', { class:'muted tiny' }, 'DPS เฉลี่ย'), h('b', { style:{ fontSize:'26px', color:'var(--accent)', fontFamily:'var(--font-display)' } }, fmt(s.dps, 1))),
        h('dl', { class:'kv grow' }, h('dt', 'ดาเมจรวม'), h('dd', fmt(s.dmg, 0)), h('dt', 'ล้มมอนสเตอร์'), h('dd', s.kills), h('dt', 'ตัวละครล้ม'), h('dd', { class: s.deaths ? 'bad' : '' }, s.deaths),
          h('dt', 'HP ที่เสีย / ฟื้น'), h('dd', fmt(s.hpLost, 0) + ' / ' + fmt(s.healed, 0)), h('dt', 'SP ใช้ต่อวิ'), h('dd', fmt(s.spPerSec, 2)))),
      h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', 'ที่มา'), h('th', { class:'n' }, 'ครั้ง'), h('th', { class:'n' }, 'ดาเมจ'), h('th', { class:'n' }, '%'))), h('tbody', rows))),
      up.length ? h('div', { class:'tiny muted' }, 'เวลาที่สถานะติดอยู่: ' + up.join(' · ')) : null));
  }
  function frame(ts){
    raf = 0; if(!visible) return;
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0; last = ts;
    if(running && sim) sim.advance(dt * speed);
    slowT += dt; const slow = slowT >= 0.25; if(slow) slowT = 0;
    if(sim) render(slow);
    raf = requestAnimationFrame(frame);
  }

  function update(){
    if(!root) return;
    panels.char.update(); syncSheet(); syncMonster(); ensureSim(); sim.sync(); rebuildSkillbar(); panels.rotation.update(); render(true);
  }

  ui.pages.sim = {
    mount(r){
      root = r;
      panels.char = ui.charPanel(SB); panels.rotation = ui.panels.rotation(); panels.fin = ui.panels.finalStats(); panels.dmg = ui.panels.damage(); panels.bench = ui.panels.bench();
      E.sheetBox = h('div', { class:'col', style:{ marginTop:'8px' } });
      E.monSel = ui.select([{ v:'', t:'' }], '', v => { const m = SL.store.find('monsters', v); if(m) SB.change(s => { s.monsterPresetId = v; s.monster = Object.assign({}, m, { counter: s.monster.counter }); }); }, { label:'เป้าหมาย' });
      const fields = [['def','DEF'], ['mdef','MDEF'], ['flee','FLEE'], ['hit','HIT'], ['atk','ATK'], ['maxHp','HP'], ['interval','ตีทุก (วิ)']];
      const monRow = h('div', { class:'row' }); fields.forEach(f => { E.mon[f[0]] = ui.num(0, v => SB.change(s => { s.monster[f[0]] = v; }), { min:0, label:f[1] }); monRow.appendChild(ui.field(f[1], E.mon[f[0]])); });
      E.counter = ui.check('มอนสเตอร์สวนกลับ', false, v => SB.change(s => { s.monster.counter = v; }));
      E.immortal = ui.check('เป้านิ่งอมตะ (HP ฟื้นเองเมื่อหมด)', false, v => SB.change(s => { s.opts.immortal = v; }));
      E.auto = ui.check('ใช้ลำดับสกิลอัตโนมัติ', true, v => SB.change(s => { s.opts.auto = v; }));
      E.aoe = ui.num(1, v => SB.change(s => { s.opts.aoeTargets = v; }), { min:1, max:20, int:true, label:'จำนวนเป้า AoE' });

      E.hp = h('div', { class:'bar' }, h('i'), h('span')); E.sp = h('div', { class:'bar sp' }, h('i'), h('span')); E.mhp = h('div', { class:'bar mon' }, h('i'), h('span'));
      E.pChips = h('div', { class:'statuses' }); E.mChips = h('div', { class:'statuses' }); E.pInfo = h('div', { class:'tiny muted' }); E.mInfo = h('div', { class:'tiny muted' });
      E.pActor = h('div', { class:'actor' }, h('div', { class:'nm' }, 'ผู้เล่น'), E.pInfo, E.hp, E.sp, E.pChips);
      E.mActor = h('div', { class:'actor' }, h('div', { class:'nm' }, 'มอนสเตอร์ทดสอบ'), E.mInfo, E.mhp, E.mChips);
      E.bar = h('div', { class:'skillbar' }); E.log = h('div', { class:'log', role:'log' }); E.live = h('div'); E.time = h('span', { class:'mono muted' }, '0.0 วิ');
      runBtn = h('button', { class:'btn sm primary', type:'button', onclick: () => { running = !running; runBtn.textContent = running ? '⏸ พัก' : '▶ เล่นต่อ'; } }, '⏸ พัก');
      speedBtns = [0.5, 1, 2, 4, 8].map(x => h('button', { class:'btn sm' + (x === speed ? ' on' : ''), type:'button', onclick: () => { speed = x; speedBtns.forEach(b => b.classList.toggle('on', b === speedBtns[[0.5, 1, 2, 4, 8].indexOf(x)])); } }, x + '×'));

      root.appendChild(h('div', { class:'layout-sim' },
        h('div', { class:'col gap-lg' },
          h('div', { class:'panel' }, h('h3', 'ตัวละครทดสอบ (แซนด์บ็อกซ์)'), h('div', { class:'tiny muted', style:{ marginBottom:'6px' } }, 'ปรับค่าได้อิสระเพื่อลองบิลด์ — ไม่กระทบตัวละครจริง · คำนวณทั้งหมดโดยเซิร์ฟเวอร์'), panels.char.el),
          h('div', { class:'panel' }, h('details', h('summary', 'สเตตัสของตัวละคร (ชีต)'), E.sheetBox)),
          h('div', { class:'panel' }, h('h3', 'เป้าหมาย'), h('div', { class:'col' }, ui.field('พรีเซ็ตมอนสเตอร์', E.monSel), monRow, E.counter, E.immortal, ui.field('จำนวนเป้าที่โดนสกิลระยะกว้าง', E.aoe)))),
        h('div', { class:'col gap-lg' },
          h('div', { class:'panel' }, h('div', { class:'row', style:{ marginBottom:'8px' } }, runBtn, speedBtns, h('button', { class:'btn sm', type:'button', onclick: () => { ensureSim(); sim.reset(); ui.clear(E.log); } }, '↺ เริ่มสู้ใหม่'), E.auto, h('span', { class:'right' }, E.time)),
            h('div', { class:'stage' }, E.pActor, E.mActor)),
          h('div', { class:'panel' }, h('h3', 'แถบสกิล (คลิกเพื่อสั่งใช้ · สลับ = เปิด/ปิดทันที)'), E.bar),
          h('div', { class:'panel' }, h('h3', 'บันทึกการต่อสู้'), E.log),
          h('div', { class:'panel' }, h('details', { open:true }, h('summary', 'ลำดับสกิลอัตโนมัติ'), h('div', { style:{ marginTop:'8px' } }, panels.rotation.el)))),
        h('div', { class:'col gap-lg' },
          h('div', { class:'panel' }, h('h3', 'สรุปสด'), E.live),
          h('div', { class:'panel' }, h('h3', 'ดาเมจคาดการณ์ต่อสกิล'), panels.dmg.el),
          h('div', { class:'panel' }, h('h3', 'ทดสอบเร็ว / เทียบบิลด์'), panels.bench.el),
          h('div', { class:'panel' }, h('details', h('summary', 'สเตตัสสุดท้ายหลังคิดสกิล'), h('div', { style:{ marginTop:'8px' } }, panels.fin.el))))));
      update();
    },
    update: update,
    onShow(){ visible = true; last = 0; if(root){ update(); if(!raf) raf = requestAnimationFrame(frame); } },
    onHide(){ visible = false; if(raf){ cancelAnimationFrame(raf); raf = 0; } },
  };
})(typeof window !== 'undefined' ? window : globalThis);
