/* ============================================================
   MODULE 05 — sim : ตัวจำลองการต่อสู้เฉพาะสกิล (ไม่มี DOM, ก้าวเวลาคงที่ 0.05 วิ, สุ่มแบบกำหนด seed ได้)
   - ผู้เล่น: ตีธรรมดา / ใช้สกิล (ใช้เวลาแทนการตี 1 ครั้ง) / toggle / trigger / บัฟ / ฮีล
   - มอนสเตอร์: ถูกตี / สวนกลับ (เปิดได้) / ตาย-เกิดใหม่ หรือเป้านิ่งอมตะ
   - อ่าน state แบบ live (อ้างอิงเดียวกับ SL.state) — UI เปลี่ยนค่าแล้วเรียก sim.sync()
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const { val, clone } = SL.util;
  const H = 0.05;

  function mulberry32(a){
    return function(){ a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const skillOf = id => SL.store.skill(id);

  function create(state, o){
    o = o || {};
    const C = SL.calc, R = SL.rules;
    const rng = mulberry32(o.seed === undefined ? 20260101 : o.seed);
    const opt = (k, d) => (state.opts && state.opts[k] !== undefined ? state.opts[k] : d);
    const G = () => SL.store.get().globals;

    let t, acc, hp, sp, alive, reviveLeft, act, mact, mhp, mAlive, respawnLeft;
    let pst, mst, cd, queue, dirty, P, M, T, events;

    const newTotals = () => ({ dmg:0, hits:0, crits:0, miss:0, casts:0, spUsed:0, hpLost:0, healed:0, deaths:0, kills:0, aliveTime:0,
      basic:{ n:0, dmg:0, crits:0, miss:0 }, skills:{}, uptime:{} });
    const skT = id => T.skills[id] || (T.skills[id] = { casts:0, dmg:0, hits:0, crits:0, miss:0, sp:0 });

    function ev(kind, text, extra){
      events.push(Object.assign({ t: t, kind: kind, text: text }, extra || {}));
      if(events.length > 400) events.splice(0, events.length - 400);
    }
    function recompute(){
      P = C.player(state, pst.map(x => ({ id: x.id, lv: x.lv })));
      M = C.monster(state.monster, mst.map(x => ({ id: x.id, lv: x.lv })));
      hp = Math.min(hp, P.stats.maxHp); sp = Math.min(sp, P.stats.maxSp); mhp = Math.min(mhp, M.maxHp);
      dirty = false;
    }
    function addStatus(list, e){
      for(let i = list.length - 1; i >= 0; i--) if(list[i].id === e.id || (e.group && list[i].group === e.group)) list.splice(i, 1);
      list.push(e); dirty = true;
    }
    const hasSelf = s => s.effects.some(e => e.appliesTo !== 'target');
    const hasTarget = s => s.effects.some(e => e.appliesTo === 'target');
    const isOn = id => pst.some(x => x.id === id);
    const isOnTarget = id => mst.some(x => x.id === id);

    function reset(){
      t = 0; acc = 0; alive = true; reviveLeft = 0; act = 0.2; mAlive = true; respawnLeft = 0;
      pst = []; mst = []; cd = {}; queue = []; T = newTotals(); events = [];
      hp = Infinity; sp = Infinity; mhp = Infinity; dirty = true; recompute();
      mact = M.interval;
    }

    /* ---------- เงื่อนไขการใช้สกิล (คืนข้อความเหตุผลถ้าใช้ไม่ได้ / '' ถ้าใช้ได้) ---------- */
    function why(skill){
      const lv = state.learned[skill.id] || 0;
      if(!lv) return 'ยังไม่ได้เรียน';
      if(!alive) return 'ตายอยู่';
      if(!R.isCastable(skill)) return 'ไม่ใช่สกิลที่กดใช้ได้';
      if(R.chain(state.classId).indexOf(skill.class) < 0) return 'ไม่ใช่สกิลของสายนี้';
      if(!R.weaponOk(skill, P.weapon, P.hasShield)) return skill.needShield ? 'ต้องสวมโล่ + อาวุธ 1 มือ' : 'อาวุธไม่ตรงเงื่อนไข';
      const u = C.usage(skill, lv);
      if((cd[skill.id] || 0) > 0) return 'คูลดาวน์ ' + cd[skill.id].toFixed(1) + ' วิ';
      if(sp < u.sp) return 'SP ไม่พอ (' + Math.ceil(u.sp) + ')';
      if(u.hp > 0 && hp <= u.hp * P.stats.maxHp) return 'HP ไม่พอ';
      if(skill.damage.kind && !mAlive) return 'ไม่มีเป้าหมาย';
      return '';
    }

    function applyHit(r, label, sk){
      if(r.miss){ T.miss++; if(sk) sk.miss++; ev('miss', label + ' พลาด', { who:'player' }); return; }
      mhp -= r.dmg; T.dmg += r.dmg; T.hits++; if(r.crit) T.crits++;
      if(sk){ sk.dmg += r.dmg; sk.hits++; if(r.crit) sk.crits++; }
      ev('dmg', label + ' ' + r.dmg + (r.crit ? ' (คริ!)' : ''), { who:'player', amount: r.dmg, crit: r.crit });
    }
    function checkKill(){
      if(mhp > 0) return;
      T.kills++; ev('kill', 'ล้มมอนสเตอร์ได้', { who:'monster' });
      if(opt('immortal', false)){ mhp = M.maxHp; return; }
      mAlive = false; respawnLeft = G().respawnDelay; mst = []; dirty = true;
    }
    function basicAttack(){
      const r = C.roll(C.BASIC, 1, P, M, rng, opt('variance', 0.08));
      T.basic.n++; if(r.miss) T.basic.miss++; else { T.basic.dmg += r.dmg; if(r.crit) T.basic.crits++; }
      applyHit(r, 'ตีธรรมดา', null);
      checkKill();
    }

    function doCast(skill){
      const lv = state.learned[skill.id], u = C.usage(skill, lv), sk = skT(skill.id);
      sp -= u.sp; hp -= u.hp * P.stats.maxHp;
      if(u.cooldown > 0) cd[skill.id] = u.cooldown;
      T.casts++; T.spUsed += u.sp; sk.casts++; sk.sp += u.sp;
      ev('cast', 'ใช้ ' + skill.name + ' Lv.' + lv, { who:'player', skillId: skill.id });
      if(skill.damage.kind && mAlive){
        const n = skill.damage.aoe ? Math.max(1, Math.round(opt('aoeTargets', 1))) : 1;
        for(let i = 0; i < n; i++) applyHit(C.roll(skill.damage, lv, P, M, rng, opt('variance', 0.08)), skill.name, sk);
      }
      if(skill.heal){
        const amt = val(skill.heal.pctMaxHp, lv) * P.stats.maxHp + val(skill.heal.flat, lv);
        const real = Math.max(0, Math.min(P.stats.maxHp - hp, amt)); hp += real; T.healed += real;
        ev('heal', skill.name + ' ฟื้น HP ' + Math.round(real), { who:'player', amount: real });
      }
      if(skill.type === 'toggle'){
        addStatus(pst, { id: skill.id, lv: lv, left: Infinity, toggle: true, group: skill.group });
        ev('buff', 'เปิด ' + skill.name, { who:'player' });
      } else if(skill.effects.length && u.duration > 0){
        if(hasSelf(skill)) addStatus(pst, { id: skill.id, lv: lv, left: u.duration, group: skill.group });
        if(hasTarget(skill) && mAlive) addStatus(mst, { id: skill.id, lv: lv, left: u.duration, group: skill.group });
        ev('buff', skill.name + ' ติด ' + u.duration + ' วิ', { who:'player' });
      }
      dirty = true;
      checkKill();
    }
    function turnOff(id, why_){
      const i = pst.findIndex(x => x.id === id); if(i < 0) return;
      pst.splice(i, 1); dirty = true;
      const s = skillOf(id); ev('off', (s ? s.name : id) + ' ปิด' + (why_ ? ' (' + why_ + ')' : ''), { who:'player' });
    }

    /* ---------- เลือกสิ่งที่จะทำในจังหวะนี้ ---------- */
    function ruleOk(rule, s){
      if(why(s)) return false;
      const hr = hp / P.stats.maxHp, sr = P.stats.maxSp > 0 ? sp / P.stats.maxSp : 1;
      if(sr < (rule.minSpPct || 0) || hr < (rule.minHpPct || 0) || hr > (rule.maxHpPct === undefined ? 1 : rule.maxHpPct)) return false;
      if(s.type === 'toggle' && isOn(s.id)) return false;
      if(rule.skipIfActive !== false && !s.damage.kind && s.type !== 'toggle' && s.effects.length){
        if((hasSelf(s) && isOn(s.id)) || (hasTarget(s) && isOnTarget(s.id))) return false;
      }
      return true;
    }
    function choose(){
      queue = queue.filter(q => q.until > t && skillOf(q.id));
      for(let i = 0; i < queue.length; i++){ const s = skillOf(queue[i].id); if(!why(s)){ queue.splice(i, 1); return s; } }
      if(opt('auto', true)){
        const rot = state.rotation || [];
        for(let i = 0; i < rot.length; i++){ const s = skillOf(rot[i].id); if(s && ruleOk(rot[i], s)) return s; }
      }
      return null;
    }
    function doAction(){
      for(let g2 = 0; g2 < 6; g2++){
        const s = choose();
        if(!s) break;
        const u = C.usage(s, state.learned[s.id]);
        doCast(s);
        if(u.usesAction) return 1 / P.aps;
        if(dirty) recompute();
      }
      basicAttack(); return 1 / P.aps;
    }

    function die(){
      alive = false; reviveLeft = G().reviveDelay; T.deaths++; pst = []; cd = {}; queue = []; dirty = true;
      ev('death', 'ตัวละครล้ม!', { who:'player' });
    }
    function revive(){
      alive = true; pst = []; dirty = true; recompute(); hp = P.stats.maxHp; sp = P.stats.maxSp; act = 0.3;
      ev('revive', 'ฟื้นคืนชีพ', { who:'player' });
    }

    /* ---------- ก้าวเวลา 1 tick ---------- */
    function tick(){
      if(dirty) recompute();
      t += H;
      Object.keys(cd).forEach(k => { cd[k] = Math.max(0, cd[k] - H); });
      [pst, mst].forEach(list => { for(let i = list.length - 1; i >= 0; i--){ list[i].left -= H;
        if(list[i].left <= 0){ const s = skillOf(list[i].id); list.splice(i, 1); dirty = true; if(s) ev('off', s.name + ' หมดเวลา', { who:'player' }); } } });
      if(!alive){ reviveLeft -= H; if(reviveLeft <= 0) revive(); return; }
      T.aliveTime += H;
      const seen = {}; pst.concat(mst).forEach(x => { if(!seen[x.id]){ seen[x.id] = 1; T.uptime[x.id] = (T.uptime[x.id] || 0) + H; } });
      const S = P.stats;
      hp = Math.min(S.maxHp, hp + S.hpRegen * H); sp = Math.min(S.maxSp, sp + S.spRegen * H);

      // toggle: ดูด HP/SP ต่อวินาที และปิดอัตโนมัติ
      pst.filter(x => x.toggle).forEach(x => {
        const s = skillOf(x.id); if(!s) return; const u = C.usage(s, x.lv), off = s.toggleOff || {};
        if(u.hpDrain > 0){ hp -= u.hpDrain * S.maxHp * H; T.hpLost += u.hpDrain * S.maxHp * H; }
        if(u.spDrain > 0) sp -= u.spDrain * H;
        if((off.hpBelow && hp / S.maxHp < off.hpBelow) || sp < 0){ sp = Math.max(0, sp); turnOff(x.id, off.hpBelow && hp / S.maxHp < off.hpBelow ? 'HP ต่ำ' : 'SP หมด'); }
      });
      // trigger: เปิดเมื่อ HP ต่ำกว่าเกณฑ์ ปิดเมื่อ HP เกินเกณฑ์
      R.visibleSkills(state.classId).forEach(s => {
        if(s.type !== 'trigger' || !s.trigger) return;
        const lv = state.learned[s.id] || 0; if(!lv) return;
        const on = isOn(s.id), hr = hp / S.maxHp;
        if(!on){
          if((cd[s.id] || 0) <= 0 && s.trigger.hpBelow && hr <= s.trigger.hpBelow && R.weaponOk(s, P.weapon, P.hasShield)){
            const dur = val(s.usage.duration, lv);
            addStatus(pst, { id: s.id, lv: lv, left: dur > 0 ? dur : Infinity, group: s.group, trigger: true });
            cd[s.id] = s.trigger.cooldown || 0; skT(s.id).casts++;
            ev('buff', s.name + ' ทำงาน!', { who:'player' });
          }
        } else if(hr > (s.trigger.hpAbove === undefined ? 1 : s.trigger.hpAbove)) turnOff(s.id, 'HP ฟื้น');
      });

      // มอนสเตอร์เกิดใหม่
      if(!mAlive){ respawnLeft -= H; if(respawnLeft <= 0){ mAlive = true; recompute(); mhp = M.maxHp; mact = M.interval; ev('spawn', 'มอนสเตอร์เกิดใหม่', { who:'monster' }); } }
      // ผู้เล่นลงมือ
      if(mAlive){
        act -= H;
        for(let g2 = 0; g2 < 8 && act <= 0 && alive && mAlive; g2++){ act += doAction(); if(dirty) recompute(); }
      }
      // มอนสเตอร์สวนกลับ
      if(mAlive && alive && state.monster.counter){
        mact -= H;
        if(mact <= 0){
          mact += M.interval;
          const r = C.monsterStrike(P, M, rng);
          if(r.miss) ev('dodge', 'หลบการโจมตีได้', { who:'monster' });
          else { hp -= r.dmg; T.hpLost += r.dmg; ev('taken', 'โดนตี ' + r.dmg + (r.blocked ? ' (บล็อก)' : ''), { who:'monster', amount: r.dmg, blocked: r.blocked }); }
        }
      }
      if(hp <= 0 && alive) die();
    }

    /* ---------- API ---------- */
    const sim = {
      advance(dt){ acc += dt; let guard = 0; while(acc >= H - 1e-9 && guard++ < 20000){ tick(); acc -= H; } },
      reset: reset,
      // เรียกเมื่อ state/data เปลี่ยน: ล้างสถานะที่อ้างสกิลที่ไม่มีแล้ว และอัปเดตเลเวลของสถานะ
      sync(){
        [pst, mst].forEach(list => { for(let i = list.length - 1; i >= 0; i--){
          const lv = state.learned[list[i].id] || 0; if(!skillOf(list[i].id) || lv <= 0) list.splice(i, 1); else list[i].lv = lv; } });
        queue = queue.filter(q => skillOf(q.id)); dirty = true; recompute();
      },
      // สั่งใช้สกิลด้วยมือ (เข้าคิว รอจังหวะถัดไป) / toggle กดสลับได้ทันที
      cast(id){
        const s = skillOf(id); if(!s) return;
        if(s.type === 'toggle'){ if(isOn(id)) turnOff(id, 'ปิดเอง'); else if(!why(s)) doCast(s); return; }
        if(!queue.some(q => q.id === id) && queue.length < 5) queue.push({ id: id, until: t + 8 });
      },
      why(idOrSkill){ const s = typeof idOrSkill === 'string' ? skillOf(idOrSkill) : idOrSkill; return s ? why(s) : 'ไม่พบสกิล'; },
      drain(){ const e = events; events = []; return e; },
      view(){
        return { t: t, hp: hp, maxHp: P.stats.maxHp, sp: sp, maxSp: P.stats.maxSp, alive: alive, reviveLeft: reviveLeft,
          mhp: mhp, mMax: M.maxHp, mAlive: mAlive, respawnLeft: respawnLeft,
          pst: pst.map(x => ({ id: x.id, lv: x.lv, left: x.left, toggle: !!x.toggle })), mst: mst.map(x => ({ id: x.id, lv: x.lv, left: x.left })),
          cd: Object.assign({}, cd), queue: queue.map(q => q.id), P: P, M: M, act: act };
      },
      summary(){
        const secs = Math.max(t, 0.001), skills = Object.keys(T.skills).map(id => { const s = skillOf(id), r = T.skills[id];
          return { id: id, name: s ? s.name : id, casts: r.casts, dmg: r.dmg, hits: r.hits, crits: r.crits, miss: r.miss, sp: r.sp,
            share: T.dmg ? r.dmg / T.dmg : 0, dps: r.dmg / secs }; }).sort((a, b) => b.dmg - a.dmg);
        const up = {}; Object.keys(T.uptime).forEach(id => { up[id] = T.uptime[id] / secs; });
        return { t: t, dmg: T.dmg, dps: T.dmg / secs, hits: T.hits, crits: T.crits, miss: T.miss, casts: T.casts,
          basic: { n: T.basic.n, dmg: T.basic.dmg, share: T.dmg ? T.basic.dmg / T.dmg : 0, dps: T.basic.dmg / secs },
          skills: skills, spUsed: T.spUsed, spPerSec: T.spUsed / secs, spNow: sp, spMax: P.stats.maxSp, hpLost: T.hpLost, healed: T.healed,
          deaths: T.deaths, kills: T.kills, aliveFrac: T.aliveTime / secs, uptime: up, aps: P.aps };
      },
    };
    reset();
    return sim;
  }

  /* ---------- ตัวช่วยระดับสูง ---------- */
  // สร้าง state ทดสอบจากบิลด์สำเร็จรูป (ไม่แตะ state จริง)
  function stateFromBuild(buildId){
    const b = SL.store.find('builds', buildId); if(!b) return null;
    const st = clone(SL.state.get());
    st.classId = b.classId; st.jobLv = b.jobLv; st.learned = clone(b.learned || {});
    const p = SL.store.find('presets', b.presetId);
    if(p){ st.presetId = p.id; st.weaponId = p.weaponId; st.hasShield = !!p.hasShield; st.sheet = clone(p.sheet); }
    st.rotation = SL.rules.defaultRotation(st);
    return st;
  }
  // รันแบบไม่มี UI N วินาที (เป้านิ่งอมตะ ใช้ลำดับสกิลอัตโนมัติ) แล้วสรุปผล
  function benchmark(state, seconds, seed){
    const st = clone(state); st.opts = Object.assign({}, st.opts, { auto: true, immortal: true });
    const sim = create(st, { seed: seed === undefined ? 777 : seed });
    sim.advance(seconds || 60);
    return sim.summary();
  }
  function benchBuilds(seconds, seed){
    return SL.store.get().builds.map(b => {
      const st = stateFromBuild(b.id); if(!st) return null;
      const r = benchmark(st, seconds, seed); r.build = b; return r;
    }).filter(Boolean);
  }

  SL.sim = { create: create, stateFromBuild: stateFromBuild, benchmark: benchmark, benchBuilds: benchBuilds, TICK: H };
})(typeof window !== 'undefined' ? window : globalThis);
