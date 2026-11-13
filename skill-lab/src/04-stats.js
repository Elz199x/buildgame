/* ============================================================
   MODULE 04 — calc : คำนวณสเตตัสสุดท้ายของผู้เล่น/มอนสเตอร์ และสูตรดาเมจ (ฟังก์ชันล้วน ไม่มี DOM ไม่มีเวลา)
   สเตตัสสุดท้าย = (ค่าจากชีต + flat จาก passive/สถานะ) × (1 + %จาก passive + %จากบัฟ(ถูกจำกัดด้วย buffPercentCap))
   ใช้ทั้งหน้าจำลอง (sim) และตารางดาเมจต่อสกิล (UI) — แก้สูตรที่นี่ที่เดียว
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const { val, clamp } = SL.util;
  const calc = {};
  const G = () => SL.store.get().globals;

  /* ---------- ตัวช่วยแสดงผลสเตตัส ---------- */
  const sgn = v => (v < 0 ? '−' : '+');
  const rnd = (v, d) => Number(Math.abs(v).toFixed(d));
  calc.statDef = id => SL.store.get().statDefs.find(s => s.id === id);
  calc.statName = id => { const s = calc.statDef(id); return s ? s.name : id; };
  // แสดงผลของ effect เช่น "ATK +9" "DEF −30%"
  calc.fmtEffect = function(stat, mode, v){
    const sd = calc.statDef(stat); const name = sd ? sd.name : stat;
    if(mode === 'percent') return name + ' ' + sgn(v) + rnd(v * 100, 1) + '%';
    if(sd && sd.kind === 'frac') return name + ' ' + sgn(v) + rnd(v * 100, 1) + '%';
    if(sd && sd.kind === 'pct') return name + ' ' + sgn(v) + rnd(v, 1) + '%';
    return name + ' ' + sgn(v) + rnd(v, 2);
  };
  // แสดงค่าสเตตัสสุดท้าย
  calc.fmtStat = function(stat, v){
    const sd = calc.statDef(stat);
    if(sd && sd.kind === 'frac') return rnd(v * 100, 1) + '%';
    if(sd && sd.kind === 'pct') return rnd(v, 1) + '%';
    return String(Number(v.toFixed(Math.abs(v) < 10 ? 2 : 1)));
  };

  /* ---------- ค่าใช้สกิลที่เลเวลนั้น ---------- */
  calc.usage = function(skill, lv){
    const u = skill.usage || {};
    return {
      sp: val(u.sp, lv), hp: val(u.hp, lv), cooldown: val(u.cooldown, lv), duration: val(u.duration, lv),
      hpDrain: val(u.hpDrain, lv), spDrain: val(u.spDrain, lv),
      // ร่ายแล้วใช้เวลาแทนการตี 1 ครั้งหรือไม่ (toggle เปิด/ปิดทันที ไม่เสียจังหวะ)
      usesAction: u.usesAction === undefined ? skill.type !== 'toggle' : !!u.usesAction,
    };
  };

  /* ---------- รายการ passive ที่ได้ผล ---------- */
  calc.passives = function(state){
    const W = SL.store.find('weapons', state.weaponId);
    const out = [];
    SL.rules.visibleSkills(state.classId).forEach(s => {
      const lv = state.learned[s.id] || 0;
      if(lv > 0 && s.type === 'passive') out.push({ skill: s, lv: lv, active: SL.rules.weaponOk(s, W, state.hasShield) });
    });
    return out;
  };

  /* ---------- ผู้เล่น ----------
     statuses = [{id, lv}] สถานะที่กำลังติดตัว (buff / toggle / trigger / aftermath) */
  calc.player = function(state, statuses){
    const D = SL.store.get(), Gl = D.globals;
    const W = SL.store.find('weapons', state.weaponId) || D.weapons[0];
    const base = {}; D.statDefs.forEach(sd => { base[sd.id] = Number(state.sheet[sd.id]) || 0; });
    const flat = {}, pct = {}, bpct = {}, sources = {};
    function put(stat, mode, v, name, buff){
      if(!(stat in base)) return;
      if(mode === 'percent'){ if(buff) bpct[stat] = (bpct[stat] || 0) + v; else pct[stat] = (pct[stat] || 0) + v; }
      else flat[stat] = (flat[stat] || 0) + v;
      (sources[stat] = sources[stat] || []).push({ name: name, text: calc.fmtEffect(stat, mode, v).replace(calc.statName(stat) + ' ', ''), buff: !!buff });
    }
    calc.passives(state).forEach(p => { if(!p.active) return;
      p.skill.effects.forEach(e => { if(e.appliesTo !== 'target') put(e.stat, e.mode, val(e.value, p.lv), p.skill.name, false); }); });

    // รวมโบนัสจากอุปกรณ์สวมใส่ทั้ง 6 ช่องและการ์ดธาตุ (Equipment & RO Cards — ใช้โครงสร้าง effects เดียวกับพาสซีฟ)
    let attackElement = 'neutral';
    let defenseElement = 'neutral';
    const eq = state.equipped || {};
    const eqList = D.equipItems || [];
    ['headgear', 'armor', 'garment', 'footgear', 'accessory', 'card'].forEach(slotKey => {
      const itemId = eq[slotKey];
      if(!itemId) return;
      const item = eqList.find(x => x.id === itemId);
      if(!item) return;
      if(item.attackElement) attackElement = item.attackElement;
      if(item.defenseElement) defenseElement = item.defenseElement;
      (item.effects || []).forEach(e => {
        put(e.stat, e.mode, val(e.value, 1), item.name, false);
      });
    });

    (statuses || []).forEach(st => { const s = SL.store.skill(st.id); if(!s) return;
      s.effects.forEach(e => { if(e.appliesTo !== 'target') put(e.stat, e.mode, val(e.value, st.lv), s.name, true); }); });

    const S = {};
    Object.keys(base).forEach(k => {
      let b = bpct[k] || 0; const cap = Gl.buffPercentCap ? Gl.buffPercentCap[k] : undefined;
      if(cap !== undefined && b > cap) b = cap;
      S[k] = (base[k] + (flat[k] || 0)) * (1 + (pct[k] || 0) + b);
    });
    S.aspd = clamp(S.aspd, 0, Gl.aspdCap);
    S.physReduction = clamp(S.physReduction, 0, Gl.maxPhysReduction);
    S.blockChance = clamp(S.blockChance, 0, 1);
    S.damageTaken = Math.max(-0.9, S.damageTaken);
    S.maxHp = Math.max(1, S.maxHp); S.maxSp = Math.max(0, S.maxSp);
    ['def','mdef','flee','hit','atk','matk'].forEach(k => { S[k] = Math.max(0, S[k]); });
    // ความเร็วโจมตี แบบ RO: 100 / (200 − ASPD)
    const aps = Math.max(0.1, 100 / (200 - Math.min(S.aspd, 199)));
    return { stats: S, weapon: W, hasShield: !!state.hasShield, aps: aps, attackElement: attackElement, defenseElement: defenseElement, sources: sources };
  };

  /* ---------- มอนสเตอร์ : รองรับสถานะที่ผู้เล่นติดให้ (effect appliesTo:'target') + ธาตุ/ขนาด ---------- */
  calc.monster = function(m, statuses){
    const S = {
      def: +m.def || 0, mdef: +m.mdef || 0, flee: +m.flee || 0, hit: +m.hit || 0, atk: +m.atk || 0, maxHp: +m.maxHp || 1, damageTaken: 0,
      element: m.element || 'neutral',
      size: m.size || 'medium'
    };
    const pct = {};
    (statuses || []).forEach(st => { const s = SL.store.skill(st.id); if(!s) return;
      s.effects.forEach(e => { if(e.appliesTo !== 'target' || !(e.stat in S)) return;
        const v = val(e.value, st.lv);
        if(e.mode === 'percent') pct[e.stat] = (pct[e.stat] || 0) + v; else S[e.stat] += v; }); });
    Object.keys(pct).forEach(k => { S[k] = S[k] * (1 + pct[k]); });
    ['def','mdef','flee','hit','atk'].forEach(k => { S[k] = Math.max(0, S[k]); });
    S.damageTaken = Math.max(-0.9, S.damageTaken);
    S.interval = Math.max(0.2, +m.interval || 2);
    return S;
  };

  /* ---------- ตารางแพ้ชนะธาตุ 13 ธาตุ & ขนาดอาวุธ (RO Elemental & Size Matrix) ---------- */
  calc.elementInfo = function(elemId){
    const es = (SL.store.get() || {}).elementSystem || SL.DEFAULT_DATA.elementSystem || {};
    const list = es.elements || [];
    const found = list.find(e => e.id === (elemId || 'neutral'));
    return found || { id: elemId || 'neutral', name: elemId || 'ไร้ธาตุ', icon: '⚪', color: '#a0aec0', desc: '' };
  };

  calc.elementMult = function(atkElem, defElem){
    const es = (SL.store.get() || {}).elementSystem || SL.DEFAULT_DATA.elementSystem || {};
    const mat = es.matrix || {};
    const a = atkElem || 'neutral', d = defElem || 'neutral';
    if(mat[a] && mat[a][d] !== undefined) return Number(mat[a][d]);
    return 1.0;
  };

  // วิเคราะห์ความสัมพันธ์แพ้-ชนะทางของธาตุหนึ่งๆ ทั้งฝั่งโจมตีและฝั่งป้องกัน
  calc.elementRelations = function(elemId){
    const es = (SL.store.get() || {}).elementSystem || SL.DEFAULT_DATA.elementSystem || {};
    const list = es.elements || [];
    const id = elemId || 'neutral';
    const strongAgainst = [];      // เมื่อใช้ธาตุนี้โจมตี -> ชนะธาตุใดบ้าง (mult >= 1.25)
    const weakAttackAgainst = [];  // เมื่อใช้ธาตุนี้โจมตี -> แพ้ทาง/ติดต้านทานธาตุใดบ้าง (mult <= 0.75)
    const weakToAttackers = [];    // เมื่อมอนสเตอร์/เกราะเป็นธาตุนี้ -> แพ้ทางธาตุโจมตีใดบ้าง (mult >= 1.25)
    const resistsAttackers = [];   // เมื่อมอนสเตอร์/เกราะเป็นธาตุนี้ -> ต้านทานธาตุโจมตีใดบ้าง (mult <= 0.75)
    list.forEach(el => {
      const mAtk = calc.elementMult(id, el.id);
      if(mAtk >= 1.2) strongAgainst.push(Object.assign({}, el, { mult: mAtk }));
      else if(mAtk <= 0.8) weakAttackAgainst.push(Object.assign({}, el, { mult: mAtk }));

      const mDef = calc.elementMult(el.id, id);
      if(mDef >= 1.2) weakToAttackers.push(Object.assign({}, el, { mult: mDef }));
      else if(mDef <= 0.8) resistsAttackers.push(Object.assign({}, el, { mult: mDef }));
    });
    strongAgainst.sort((a, b) => b.mult - a.mult);
    weakAttackAgainst.sort((a, b) => a.mult - b.mult);
    weakToAttackers.sort((a, b) => b.mult - a.mult);
    resistsAttackers.sort((a, b) => a.mult - b.mult);
    return {
      info: calc.elementInfo(id),
      strongAgainst: strongAgainst,
      weakAttackAgainst: weakAttackAgainst,
      weakToAttackers: weakToAttackers,
      resistsAttackers: resistsAttackers
    };
  };

  calc.sizeMult = function(weaponId, targetSize){
    const es = (SL.store.get() || {}).elementSystem || SL.DEFAULT_DATA.elementSystem || {};
    const sm = es.sizeMatrix || {};
    const w = weaponId || 'unarmed', sz = targetSize || 'medium';
    if(sm[w] && sm[w][sz] !== undefined) return Number(sm[w][sz]);
    return 1.0;
  };

  calc.skillElement = function(skillId, spec, P){
    if(spec && spec.element) return spec.element;
    const id = String(skillId || '');
    if(id === 'mgFireBolt' || id === 'swMagnum') return 'fire';
    if(id === 'mgFrostNova') return 'ice';
    if(id === 'mgThunderStorm') return 'lightning';
    if(id === 'mgSoulStrike') return 'holy';
    if(id === 'thEnvenom' || id === 'thVenomCoat') return 'poison';
    return (P && P.attackElement) || 'neutral';
  };

  /* ---------- สูตรกลาง ---------- */
  calc.hitChance = function(hit, flee, lo, hi){
    const Gl = G();
    return clamp(Gl.hitBase + (hit - flee) * Gl.hitPerPoint, lo === undefined ? 0.05 : lo, hi === undefined ? 0.95 : hi);
  };
  calc.reduction = function(def, cap){ def = Math.max(0, def); return Math.min(cap, def / (def + G().softDefK)); };

  // ดาเมจพื้นฐานของการตีธรรมดา = 100% ATK (กายภาพ)
  calc.BASIC = { kind: 'physical', terms: [{ stat: 'atk', mult: 1 }], noCrit: false, alwaysHit: false };

  // แยกส่วนประกอบของดาเมจ (ไม่สุ่ม) — ใช้ทั้งสำหรับตารางคาดการณ์และการทอยจริง (รวมตัวคูณธาตุ RO)
  calc.components = function(spec, lv, P, M){
    const Gl = G(), S = P.stats;
    let raw = 0; const parts = [];
    (spec.terms || []).forEach(t => { const m = val(t.mult, lv), sv = S[t.stat] || 0; raw += m * sv; parts.push({ stat: t.stat, mult: m, value: sv, out: m * sv }); });
    const atkElem = spec.element || (P && P.attackElement) || 'neutral';
    const defElem = (M && M.element) || 'neutral';
    const elemMult = calc.elementMult(atkElem, defElem);
    const taken = (1 + (M.damageTaken || 0)) * elemMult;
    let normal, crit, cc, hc, red, critRed;
    if(spec.kind === 'magic'){
      red = calc.reduction(M.mdef, Gl.maxMagicReduction);
      critRed = calc.reduction(M.mdef * (1 - clamp(S.mdefIgnore, 0, 1)), Gl.maxMagicReduction);
      normal = raw * (1 - red);
      crit = raw * (Gl.critMult + S.critDmg) * (1 - critRed);
      cc = spec.noCrit ? 0 : clamp(S.magicCrit / 100, 0, 1);
      hc = 1;                                   // เวทไม่มีพลาด
    } else {
      red = calc.reduction(M.def * (1 - clamp(S.defPen, 0, 1)), Gl.maxPhysReduction);
      critRed = 0;                              // คริกายภาพข้าม DEF
      normal = raw * (1 - red);
      crit = raw * Gl.critMult;
      cc = spec.noCrit ? 0 : clamp(S.physCrit / 100, 0, 1);
      hc = spec.alwaysHit ? 1 : calc.hitChance(S.hit, M.flee);
    }
    normal = Math.max(1, normal * taken); crit = Math.max(1, crit * taken);
    const expected = cc * crit + (1 - cc) * hc * normal;   // คริติคอลถือว่าโดนเสมอ
    return { raw: raw, parts: parts, red: red, critRed: critRed, normal: normal, crit: crit, critChance: cc, hitChance: hc, expected: expected, kind: spec.kind, elemMult: elemMult, atkElem: atkElem, defElem: defElem };
  };

  // ทอยจริง 1 ครั้ง (rng = ฟังก์ชันสุ่ม 0..1, variance = ความแปรปรวนของดาเมจ ±)
  calc.roll = function(spec, lv, P, M, rng, variance){
    const c = calc.components(spec, lv, P, M);
    const crit = rng() < c.critChance;
    if(!crit && rng() >= c.hitChance) return { miss: true, crit: false, dmg: 0, elemMult: c.elemMult };
    let d = crit ? c.crit : c.normal;
    d *= 1 + (rng() * 2 - 1) * (variance || 0);
    return { miss: false, crit: crit, dmg: Math.max(1, Math.round(d)), elemMult: c.elemMult, atkElem: c.atkElem };
  };

  // ผลของมอนสเตอร์ตีผู้เล่น 1 ครั้ง (รองรับเกราะธาตุ P.defenseElement ป้องกันธาตุมอนสเตอร์ M.element)
  calc.monsterStrike = function(P, M, rng){
    const Gl = G(), S = P.stats;
    const hc = calc.hitChance(M.hit, S.flee, Math.max(0.05, 1 - Gl.maxDodge), 0.95);
    const elemMult = calc.elementMult((M && M.element) || 'neutral', (P && P.defenseElement) || 'neutral');
    if(rng() >= hc) return { miss: true, dmg: 0, blocked: false, elemMult: elemMult };
    let d = M.atk * (1 - calc.reduction(S.def, Gl.maxPhysReduction)) * (1 - S.physReduction) * (1 + S.damageTaken) * elemMult;
    let blocked = false;
    if(P.hasShield && S.blockChance > 0 && rng() < S.blockChance){ blocked = true; d *= (1 - Gl.blockReduction); }
    return { miss: false, blocked: blocked, dmg: Math.max(1, Math.round(d)), elemMult: elemMult };
  };

  // ค่าคาดหวังของมอนสเตอร์ต่อวินาที (ไว้โชว์ในแผงสรุป)
  calc.monsterDps = function(P, M){
    const Gl = G(), S = P.stats;
    const hc = calc.hitChance(M.hit, S.flee, Math.max(0.05, 1 - Gl.maxDodge), 0.95);
    const elemMult = calc.elementMult((M && M.element) || 'neutral', (P && P.defenseElement) || 'neutral');
    const base = M.atk * (1 - calc.reduction(S.def, Gl.maxPhysReduction)) * (1 - S.physReduction) * (1 + S.damageTaken) * elemMult;
    const blk = P.hasShield ? S.blockChance * Gl.blockReduction : 0;
    return hc * base * (1 - blk) / M.interval;
  };

  /* ---------- ระบบกดแต้มสเตตัส & คำนวณชีตจากสูตร RO (ผสาน Status Lab) ---------- */
  const FC = () => SL.store.get().formulaConfig || SL.DEFAULT_DATA.formulaConfig;
  calc.statCost = function(cur){ return Math.floor(Math.max(1, cur) / 10) + 1; };
  calc.costToReach = function(target){
    let sum = 0; for(let v = 1; v < target; v++) sum += calc.statCost(v); return sum;
  };
  calc.totalStatSpent = function(raw){
    let s = 0; ['str','agi','vit','int','dex','luk'].forEach(k => { s += calc.costToReach(raw[k] || 1); }); return s;
  };
  calc.statusPointsForLevel = function(lv){
    const s = FC().statusPointSystem; return Math.floor((lv + s.levelUpOffset) / s.levelUpDivisor);
  };
  calc.totalStatusPoints = function(lv){
    const s = FC().statusPointSystem; let tot = s.startPoints;
    for(let L = 2; L <= lv; L++) tot += calc.statusPointsForLevel(L);
    return tot;
  };
  calc.effectiveStat = function(v, curve){
    v = Math.max(0, Number(v) || 0);
    if(!curve || !Array.isArray(curve.breakpoints) || !Array.isArray(curve.slopes)) return v;
    const bp = curve.breakpoints, sl = curve.slopes;
    let out = 0, prev = 0;
    for(let i = 0; i < bp.length; i++){
      const seg = Math.max(0, Math.min(v, bp[i]) - prev);
      out += seg * (sl[i] === undefined ? 1 : sl[i]);
      prev = bp[i];
      if(v <= prev) return out;
    }
    out += Math.max(0, v - prev) * (sl[bp.length] === undefined ? 0.4 : sl[bp.length]);
    return out;
  };
  calc.computeDerivedFromRaw = function(state){
    const F = FC(), C = F.baseConstants, Gl = G();
    const raw = state.rawStats || { str:40, agi:40, vit:30, int:30, dex:40, luk:20 };
    const lv = Math.max(1, Number(state.baseLv) || 50);
    const eff = {};
    ['str','agi','vit','int','dex','luk'].forEach(k => { eff[k] = calc.effectiveStat(raw[k] || 1, (F.statCurve || {})[k]); });
    const kc = (F.classCoefs && F.classCoefs[state.classId]) || { hpCoef:1, spCoef:1 };
    const wp = (F.weaponProfiles && F.weaponProfiles[state.weaponId]) || { stat:'str', coeff:1, stat2:'', coeff2:0, aspdOffset:0, range:80, critBonusFlat:0, hitBonusFlat:0, hitPenalty:0, defPen:0, matkPercent:0 };
    const wDef = SL.store.find('weapons', state.weaponId) || { slotType:'1H' };
    const hasShield = !!state.hasShield && wDef.slotType === '1H';
    const sh = F.shieldProfile || { aspdOffset:-5, blockChance:0.15, defFlat:15 };

    let atk = (eff[wp.stat] || 0) * (wp.coeff || 0);
    if(wp.stat2) atk += (eff[wp.stat2] || 0) * (wp.coeff2 || 0);
    let aspd = C.aspdBase + eff.agi * C.aspdPerAgi + eff.dex * C.aspdPerDex + (wp.aspdOffset || 0) + (hasShield ? sh.aspdOffset : 0);
    aspd = clamp(aspd, 0, Gl.aspdCap);
    const hit = C.hitBase + eff.dex * C.hitPerDex + (wp.hitBonusFlat || 0) - (wp.hitPenalty || 0);
    const flee = C.fleeBase + eff.agi * C.fleePerAgi + eff.luk * C.fleePerLuk;
    const physCrit = C.critBase + eff.luk * C.critPerLuk + (wp.critBonusFlat || 0);
    const matk = eff.int * C.matkPerInt * (1 + (wp.matkPercent || 0));
    const maxHp = Math.round((eff.vit * C.hpPerVit + lv * C.hpPerLevel) * kc.hpCoef);
    const maxSp = Math.round((eff.int * C.spPerInt + lv * C.spPerLevel) * kc.spCoef);
    const tension = Math.min(0.25, Math.max(0, aspd - C.aspdBase) * 0.002);
    const def = (eff.vit * C.defPerVit + (hasShield ? sh.defFlat : 0)) * (1 - tension);
    const mdef = eff.int * C.mdefPerInt;
    const hpRegen = +(eff.vit * C.hpRegenPerVit).toFixed(2);
    const spRegen = +((C.spRegenBase || 1.0) + eff.int * (C.spRegenPerInt || 0.05)).toFixed(2);
    const mc = F.magicCrit || { chanceBase:0, lukScalar:0.45, mdefIgnoreBase:0.5, dexScalar:0.002, mdefIgnoreCap:0.7, critDmgBase:0.1, intScalar:0.0008, critDmgCap:0.25 };
    const magicCrit = +(mc.chanceBase + eff.luk * C.critPerLuk * mc.lukScalar).toFixed(2);
    const mdefIgnore = +(Math.min(mc.mdefIgnoreCap, mc.mdefIgnoreBase + eff.dex * mc.dexScalar)).toFixed(3);
    const critDmg = +(Math.min(mc.critDmgCap, mc.critDmgBase + eff.int * mc.intScalar)).toFixed(3);

    const sheet = {
      str: raw.str || 1, agi: raw.agi || 1, vit: raw.vit || 1, int: raw.int || 1, dex: raw.dex || 1, luk: raw.luk || 1,
      atk: +atk.toFixed(1), matk: +matk.toFixed(1), hit: +hit.toFixed(1), aspd: +aspd.toFixed(1),
      physCrit: +physCrit.toFixed(1), magicCrit: magicCrit, mdefIgnore: mdefIgnore, critDmg: critDmg,
      defPen: +(wp.defPen || 0).toFixed(2), def: +def.toFixed(1), mdef: +mdef.toFixed(1), flee: +flee.toFixed(1),
      blockChance: hasShield ? sh.blockChance : 0, physReduction: 0, damageTaken: 0,
      maxHp: maxHp, maxSp: maxSp, hpRegen: hpRegen, spRegen: spRegen
    };
    return { sheet: sheet, eff: eff, weaponRange: wp.range || 80 };
  };

  calc.nextBaseExp = function(lv){
    const L = Math.max(1, Number(lv) || 1);
    return Math.round(100 + L * L * 18);
  };
  calc.nextJobExp = function(lv){
    const L = Math.max(1, Number(lv) || 1);
    return Math.round(80 + L * L * 14);
  };

  SL.calc = calc;
})(typeof window !== 'undefined' ? window : globalThis);
