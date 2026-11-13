#!/usr/bin/env node
/* สร้างชุดทดสอบ golden สำหรับตัวจำลองฝั่ง Go (server/internal/sim)
   รันตัวจำลอง JS ต้นฉบับ (03-rules / 04-stats / 05-sim) กับทุกบิลด์ × มอนสเตอร์ แล้วบันทึกอินพุต + ผลลัพธ์
   Go ต้องคำนวณได้ค่าเดียวกัน — ถ้าแก้สูตรฝั่ง JS ให้รันสคริปต์นี้ใหม่แล้วแก้ Go ให้ตรง
   ใช้: node web/lab/tools/gen-golden.js */
const fs = require('fs'), path = require('path');
require('./lab-env')(['00-util', '02-store', '03-rules', '04-stats', '05-sim']);
const D = SL.store.get(), C = SL.calc, R = SL.rules;
const clone = x => JSON.parse(JSON.stringify(x));

// เก็บเฉพาะฟิลด์ของ state ที่ตัวจำลองใช้
const pick = st => ({
  classId: st.classId, baseLv: st.baseLv, jobLv: st.jobLv, learned: st.learned, sheet: st.sheet, rawStats: st.rawStats,
  weaponId: st.weaponId, hasShield: st.hasShield, autoSyncStats: false, equipped: st.equipped, rotation: st.rotation,
  opts: st.opts, monster: st.monster,
});
const MONSTERS = ['dummy', 'poring', 'wolf', 'armor', 'boss'];
const EQUIP_SETS = [
  {},
  { headgear: 'eq_helm_valkyrie', armor: 'eq_armor_odin', card: 'card_marina' },
  { armor: 'eq_armor_ignis', garment: 'eq_cape_wind', footgear: 'eq_boots_hermes', accessory: 'eq_ring_str', card: 'card_hatii' },
];

const cases = [];
D.builds.forEach(b => {
  EQUIP_SETS.forEach((eq, ei) => {
    MONSTERS.forEach(mid => {
      const m = D.monsters.find(x => x.id === mid); if (!m) return;
      const st = SL.sim.stateFromBuild(b.id);
      st.equipped = Object.assign({ headgear: '', armor: '', garment: '', footgear: '', accessory: '', card: '' }, eq);
      st.monster = Object.assign({}, clone(m), { counter: false });
      // อิน/เอาต์ของ calc
      const castables = R.visibleSkills(st.classId).filter(s => (st.learned[s.id] || 0) > 0 && (s.type === 'buff' || s.type === 'toggle' || s.effects.some(e => e.appliesTo === 'target')));
      const statuses = castables.slice(0, 3).map(s => ({ id: s.id, lv: st.learned[s.id] }));
      const P0 = C.player(st, []), P1 = C.player(st, statuses);
      const M0 = C.monster(st.monster, []), M1 = C.monster(st.monster, statuses);
      const comps = { basic: C.components(C.BASIC, 1, P0, M0) };
      R.visibleSkills(st.classId).forEach(s => {
        const lv = st.learned[s.id] || 0;
        if (lv > 0 && s.damage.kind) comps[s.id] = C.components(s.damage, lv, P1, M1);
      });
      const bench = SL.sim.benchmark(st, 60, 777);
      // ต่อสู้จริง: มอนสเตอร์สวนกลับ ผู้เล่นตายได้ มอนสเตอร์ตาย/เกิดใหม่ได้
      const st2 = clone(st); st2.opts = Object.assign({}, st2.opts, { auto: true, immortal: false }); st2.monster.counter = true;
      const sim2 = SL.sim.create(st2, { seed: 42 }); sim2.advance(90);
      cases.push({
        name: b.id + '|eq' + ei + '|' + mid,
        state: pick(st),
        statuses,
        player0: { stats: P0.stats, aps: P0.aps, attackElement: P0.attackElement, defenseElement: P0.defenseElement },
        player1: { stats: P1.stats, aps: P1.aps },
        monster0: M0, monster1: M1,
        components: comps,
        bench, fight: sim2.summary(),
      });
    });
  });
});

// กติกาสกิล (canLearn/canUnlearn/pointInfo/defaultRotation/weaponOk) ของทุกบิลด์ + สถานะว่าง
const rules = [];
D.builds.forEach(b => {
  const st = SL.sim.stateFromBuild(b.id);
  const W = SL.store.find('weapons', st.weaponId);
  rules.push({
    name: b.id, state: pick(st),
    pointInfo: R.pointInfo(st),
    canLearn: D.skills.map(s => R.canLearn(s, st)),
    canUnlearn: D.skills.map(s => R.canUnlearn(s, st)),
    weaponOk: D.skills.map(s => R.weaponOk(s, W, st.hasShield)),
    defaultRotation: R.defaultRotation(st),
  });
});

// สูตรชีตจากแต้มดิบ ครอบคลุมทุกคลาส × อาวุธ × โล่ × ค่าสเตตัสหลายระดับ
const RAWS = [{ str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }, { str: 40, agi: 40, vit: 30, int: 30, dex: 40, luk: 20 },
  { str: 99, agi: 77, vit: 55, int: 63, dex: 91, luk: 33 }, { str: 120, agi: 1, vit: 130, int: 99, dex: 5, luk: 99 }, { str: 23, agi: 58, vit: 7, int: 81, dex: 49, luk: 66 }];
const derived = [];
D.classes.forEach(c => D.weapons.forEach(w => [false, true].forEach(sh => RAWS.forEach(raw => [10, 50, 99].forEach(lv => {
  const st = { classId: c.id, weaponId: w.id, hasShield: sh, rawStats: raw, baseLv: lv };
  const d = C.computeDerivedFromRaw(st);
  derived.push({ state: st, sheet: d.sheet, eff: d.eff, weaponRange: d.weaponRange });
})))));

// ค่าตายตัวอื่น ๆ
const misc = {
  rng: [1, 777, 20260101, 4294967295, 123456789].map(seed => { // ลำดับสุ่ม mulberry32
    let a = seed; const f = function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    return { seed, values: Array.from({ length: 30 }, f) };
  }),
  statCost: [1, 9, 10, 29, 30, 77, 99].map(v => ({ v, cost: C.statCost(v), reach: C.costToReach(v) })),
  statusPoints: [1, 2, 10, 50, 99].map(lv => ({ lv, total: C.totalStatusPoints(lv), per: C.statusPointsForLevel(lv) })),
  exp: [1, 10, 50, 99].map(lv => ({ lv, base: C.nextBaseExp(lv), job: C.nextJobExp(lv) })),
  toFixed: [0.25, 0.35, 1.005, 2.675, 1.45, 8.345, 123.456, 0.049999, 5e-7, 14.4, 0.5, 1.5, 2.5].map(x => ({ x, d1: +x.toFixed(1), d2: +x.toFixed(2), d3: +x.toFixed(3) })),
  elementMult: D.elementSystem.elements.slice(0, 6).map(a => D.elementSystem.elements.slice(0, 6).map(d => ({ a: a.id, d: d.id, m: C.elementMult(a.id, d.id) }))).flat(),
};

const out = path.resolve(__dirname, '..', '..', '..', 'server', 'internal', 'sim', 'testdata', 'golden.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedBy: 'web/lab/tools/gen-golden.js', cases, rules, derived, misc }));
console.log('cases', cases.length, 'rules', rules.length, 'derived', derived.length, '→', out, (fs.statSync(out).size / 1024 / 1024).toFixed(2) + ' MB');
