/* ทดสอบแกนหลัก (ไม่ใช้เบราว์เซอร์): ข้อมูล → กฎ → สูตร → ตัวจำลอง   รัน: node tests/test-core.js  (exit 1 ถ้ามีข้อผิดพลาด) */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
['00-util', '01-defaults', '02-store', '03-rules', '04-stats', '05-sim', '05b-net-codec'].forEach(f => (0, eval)(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8')));
const SL = globalThis.SL; SL.loadAll();

let fail = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; };
const clone = x => JSON.parse(JSON.stringify(x));

/* 1) ข้อมูลเริ่มต้นต้องสะอาด */
const issues = SL.rules.validate(SL.store.get());
check(issues.filter(i => i.level === 'error').length === 0, 'validate: ไม่มี error ในข้อมูลเริ่มต้น');
check(issues.filter(i => i.level === 'warn').length === 0, 'validate: ไม่มี warning ในข้อมูลเริ่มต้น');

/* 2) validator ต้องจับเงื่อนไขวนเป็นวงกลม / อ้างสกิลที่ไม่มี / เลเวลเกิน max */
const bad = clone(SL.store.get());
bad.skills.find(s => s.id === 'swBash').requires = [{ id: 'swMagnum', lv: 1 }];   // Bash <- Magnum <- Bash
bad.skills.find(s => s.id === 'swMastery').requires = [{ id: 'ghost', lv: 1 }];
bad.skills.find(s => s.id === 'swToughness').requires = [{ id: 'swBash', lv: 99 }];
const bi = SL.rules.validate(bad);
check(bi.some(i => /วนเป็นวงกลม/.test(i.msg)), 'validate: จับ cycle ได้');
check(bi.some(i => /ไม่มี "ghost"/.test(i.msg)), 'validate: จับการอ้างสกิลที่ไม่มีได้');
check(bi.some(i => /แต่สกิลนั้นสูงสุด/.test(i.msg)), 'validate: จับเลเวลที่ต้องการเกิน max ได้');

/* 3) ทุกบิลด์ตัวอย่างต้องเรียนได้จริงตามกฎ และงบแต้มไม่ติดลบ */
SL.store.get().builds.forEach(b => {
  SL.state.change(s => { s.classId = b.classId; s.jobLv = b.jobLv; s.learned = {}; });
  let progress = true, guard = 0;
  while (progress && guard++ < 1000) {
    progress = false;
    Object.keys(b.learned).forEach(id => {
      if ((SL.state.get().learned[id] || 0) < b.learned[id] && SL.rules.canLearn(SL.store.skill(id), SL.state.get()).ok) { SL.rules.learn(id); progress = true; }
    });
  }
  const missing = Object.keys(b.learned).filter(id => (SL.state.get().learned[id] || 0) < b.learned[id]);
  check(!missing.length, 'build ' + b.id + ': เรียนได้ครบตามกฎ' + (missing.length ? ' (ขาด ' + missing.join(',') + ')' : ''));
  check(SL.rules.pointInfo(SL.state.get()).every(p => p.left >= 0), 'build ' + b.id + ': งบแต้มไม่ติดลบ');
});

/* 4) กฎ unlearn: ห้ามลดสกิลที่ยังถูกใช้เป็นเงื่อนไข */
SL.state.change(s => { s.classId = 'swordman'; s.jobLv = 50; s.learned = { swBash: 2, swProvoke: 1 }; });
check(!SL.rules.canUnlearn(SL.store.skill('swBash'), SL.state.get()).ok, 'unlearn: Bash Lv2 ถูก Provoke ใช้เป็นเงื่อนไข → ลดไม่ได้');
SL.state.change(s => { s.learned = { swBash: 3, swProvoke: 1 }; });
check(SL.rules.canUnlearn(SL.store.skill('swBash'), SL.state.get()).ok, 'unlearn: Bash Lv3 → ลดเหลือ 2 ได้');

/* 5) ตัวจำลองต้อง deterministic เมื่อ seed เท่ากัน และให้ผลสมเหตุสมผล */
const rows1 = SL.sim.benchBuilds(60, 1), rows2 = SL.sim.benchBuilds(60, 1);
check(rows1.every((r, i) => r.dps === rows2[i].dps), 'sim: seed เดียวกัน → ผลเหมือนเดิมทุกบิลด์');
check(rows1.find(r => r.build.id === 'bld_striker').dps > rows1.find(r => r.build.id === 'bld_nv_survivor').dps * 10, 'sim: นักดาบ Lv50 แรงกว่าชาวบ้านมาก');
check(rows1.every(r => isFinite(r.dps) && r.dps >= 0), 'sim: DPS เป็นจำนวนจริงทุกบิลด์');

/* 6) สูตรสำคัญ */
const st = SL.sim.stateFromBuild('bld_striker');
const P = SL.calc.player(st, []);
check(Math.abs(P.aps - 100 / (200 - P.stats.aspd)) < 1e-9, 'calc: APS = 100/(200−ASPD)');
check(P.stats.aspd <= SL.store.get().globals.aspdCap, 'calc: ASPD ไม่เกินเพดาน');
const capped = SL.calc.player(Object.assign(clone(st), { sheet: Object.assign(clone(st.sheet), { aspd: 999 }) }), []);
check(capped.stats.aspd === SL.store.get().globals.aspdCap, 'calc: ASPD 999 ถูกตัดที่เพดาน 193');
const buffed = SL.calc.player(st, [{ id: 'swBattleCry', lv: 5 }, { id: 'swBerserk', lv: 5 }, { id: 'swLastStand', lv: 5 }]);
const cap = SL.store.get().globals.buffPercentCap.atk;
const rawAtk = (P.stats.atk);                      // ผ่าน passive แล้ว ไม่มีบัฟ
check(buffed.stats.atk <= rawAtk * (1 + cap) + 1e-6, 'calc: บัฟ ATK% รวมกันไม่เกิน buffPercentCap (' + cap * 100 + '%)');

/* 7) normalize ต้องเติมค่าที่ขาด (เพิ่มสกิลแบบย่อได้) */
SL.store.change(d => d.skills.push({ id: 'tmpSkill', class: 'novice', name: 'ทดสอบ', effects: [{ stat: 'atk', value: 1 }] }));
const t = SL.store.skill('tmpSkill');
check(t && t.type === 'passive' && t.maxLevel === 1 && Array.isArray(t.requires) && t.effects[0].mode === 'flat', 'store: สกิลที่ระบุไม่ครบถูก normalize เป็นค่าเริ่มต้น');
SL.store.change(d => { d.skills = d.skills.filter(s => s.id !== 'tmpSkill'); });

/* 8) สูตร Status Lab (computeDerivedFromRaw) และโครงสร้างโมเดล/โลก 2.5D */
const dRaw1 = SL.calc.computeDerivedFromRaw({ classId: 'swordman', baseLv: 50, weaponId: 'sword_2h', hasShield: false, rawStats: { str: 50, agi: 30, vit: 40, int: 10, dex: 30, luk: 10 } });
const dRaw2 = SL.calc.computeDerivedFromRaw({ classId: 'swordman', baseLv: 50, weaponId: 'sword_2h', hasShield: false, rawStats: { str: 80, agi: 60, vit: 40, int: 10, dex: 30, luk: 10 } });
check(dRaw2.sheet.atk > dRaw1.sheet.atk && dRaw2.sheet.aspd > dRaw1.sheet.aspd, 'status-lab: เพิ่ม STR/AGI แล้ว ATK และ ASPD เพิ่มขึ้นตามสูตร');
check(SL.calc.totalStatusPoints(50) > SL.calc.totalStatusPoints(1), 'status-lab: แต้มสเตตัสรวมที่ Lv50 มากกว่า Lv1');
check(Boolean(SL.store.get().modelSlots && SL.store.get().modelSlots.classes.swordman), 'models: มีข้อมูลสล็อตโมเดลและริกครบถ้วน');
check(SL.store.get().monsters.every(m => m.world && m.world.telegraph), 'world: มอนสเตอร์ทุกตัวมีข้อมูลโลก 2.5D และวงเตือน Telegraph');

/* 9) ทดสอบ Binary Wire Protocol (FlatBuffers 0xC7 Codec - SL.binCodec) */
SL.binCodec.resetStats();
const moveBuf = SL.binCodec.encodeMove({ seq: 42, x: 425.6, y: 850.2, vx: 120, vy: -80, facing: -1, animState: 'walk' });
const moveDec = SL.binCodec.decode(moveBuf);
check(moveBuf.byteLength === 22, 'binCodec: Move packet มีขนาดคงที่ 22 ไบต์ (ประหยัดกว่า JSON ~5-7 เท่า)');
check(moveDec && moveDec.seq === 42 && Math.abs(moveDec.x - 425.6) < 0.15 && moveDec.facing === -1 && moveDec.animState === 'walk', 'binCodec: ถอดรหัส Move packet ได้ค่าตรงตามต้นฉบับ');

const snapBuf = SL.binCodec.encodeWorldSnapshot(900, [
  { uid: 9001, x: 940, y: 390, facing: 1, animState: 'attack', classId: 'novice', weaponId: 'unarmed', hp: 320, maxHp: 350 },
  { uid: 9002, x: 1480, y: 1220, facing: -1, animState: 'walk', classId: 'thief', weaponId: 'dagger', hp: 1400, maxHp: 1450 }
], [
  { uid: 1, monsterId: 'poring', x: 980, y: 400, hp: 55, maxHp: 80, alive: true, facing: -1, animState: 'hurt' },
  { uid: 2, monsterId: 'bapho_jr', x: 1940, y: 600, hp: 18500, maxHp: 22000, alive: true, facing: 1, animState: 'cast' }
]);
const snapDec = SL.binCodec.decode(snapBuf);
check(snapDec && snapDec.tick === 900 && snapDec.peers.length === 2 && snapDec.mobs.length === 2 && snapDec.mobs[1].hp === 18500, 'binCodec: เข้ารหัสและถอดรหัส WorldSnapshot (Peers + Mobs) สำเร็จ');
check(SL.binCodec.savingsRatio() > 0.75, 'binCodec: ประหยัดแบนด์วิดท์ได้มากกว่า 75% เมื่อเทียบกับ JSON (' + Math.round(SL.binCodec.savingsRatio() * 100) + '%)');

/* 10) ทดสอบ Reactive Single Source of Truth (แก้ค่ามอนสเตอร์/แผนที่/สูตรที่เดียว ซิงก์ทุกหน้าอัตโนมัติ) */
SL.state.change(s => { s.monsterPresetId = 'poring'; s.autoSyncStats = true; s.rawStats = { str: 60, agi: 70, vit: 40, int: 20, dex: 50, luk: 30 }; });
const oldPoringHp = SL.store.find('monsters', 'poring').maxHp;
SL.store.change(d => { d.monsters.find(m => m.id === 'poring').maxHp = 9999; });
check(SL.state.get().monster.maxHp === 9999, 'reactive-sync: แก้ไข MaxHP มอนสเตอร์ที่เดียว ซิงก์เข้าสถานะการจำลอง (#sim) อัตโนมัติ');
SL.store.change(d => { d.monsters.find(m => m.id === 'poring').maxHp = oldPoringHp; });
check(Array.isArray(SL.store.get().worldMap.zones) && Array.isArray(SL.store.get().worldMap.spawns), 'reactive-sync: แผนที่โลก (zones) และจุดเกิดมอนสเตอร์ (spawns) เก็บอยู่ในคลังกลาง SL.store');

/* 11) ทดสอบระบบธาตุ RO 13 ธาตุ (13×13 Elemental Matrix), อุปกรณ์ 6 ช่อง & เกราะธาตุ (6-Slot Equipment & Defense Element), และกระเป๋าไอเทม (Inventory) */
check(SL.store.get().elementSystem.elements.length === 13, 'element-13: มีธาตุครบ 13 ธาตุ (ไร้ธาตุ, ไฟ, น้ำ, ดิน, ลม, น้ำแข็ง, สายฟ้า, พืช, พิษ, ศักดิ์สิทธิ์, ความมืด, ผีดิบ, วิญญาณ)');
check(SL.calc.elementMult('fire', 'nature') === 1.75 && SL.calc.elementMult('lightning', 'water') === 1.75 && SL.calc.elementMult('holy', 'undead') === 2.0 && SL.calc.elementMult('neutral', 'ghost') === 0.25, 'element-matrix: คำนวณแพ้-ชนะ 13 ธาตุ (ไฟชนะพืช ×1.75, สายฟ้าชนะน้ำ ×1.75, แสงชนะผีดิบ ×2.0, ไร้ธาตุตีวิญญาณ ×0.25)');
const fireRel = SL.calc.elementRelations('fire');
check(fireRel.strongAgainst.some(e => e.id === 'nature') && fireRel.weakToAttackers.some(e => e.id === 'water'), 'element-relations: วิเคราะห์จุดอ่อนและธาตุที่ชนะทางได้ถูกต้อง');
const basePlayer = SL.calc.player(st, []);
const eqState = Object.assign(clone(st), {
  equipped: {
    headgear: 'eq_helm_valkyrie',
    armor: 'eq_armor_ignis',
    garment: 'eq_cape_wind',
    footgear: 'eq_boots_hermes',
    accessory: 'eq_ring_str',
    card: 'card_vadon'
  }
});
const eqPlayer = SL.calc.player(eqState, []);
check(eqPlayer.stats.atk > basePlayer.stats.atk && eqPlayer.stats.def > basePlayer.stats.def && eqPlayer.stats.flee > basePlayer.stats.flee && eqPlayer.attackElement === 'fire' && eqPlayer.defenseElement === 'fire', 'equip-6slots: สวมใส่อุปกรณ์ครบ 6 ช่องบวก ATK/DEF/FLEE และตั้งธาตุโจมตี/ธาตุเกราะป้องกันอัตโนมัติ');
const fireBoss = SL.calc.monster(SL.store.find('monsters', 'boss'), []);
check(SL.calc.monsterDps(eqPlayer, fireBoss) < SL.calc.monsterDps(basePlayer, fireBoss) * 0.35, 'defense-element: สวมเกราะธาตุไฟแล้วลดดาเมจจากบอสมังกรไฟลงอย่างมาก (ต้านทาน ×0.25)');
const prevPot = SL.state.getQty('pot_red');
SL.state.addItem('pot_red', 3);
check(SL.state.getQty('pot_red') === prevPot + 3, 'inventory-stack: เพิ่มจำนวนไอเทมแบบซ้อนทับ (Stackable) ในกระเป๋าได้');
SL.state.removeItem('pot_red', 3);
check(Array.isArray(SL.store.get().worldMap.maps) && SL.store.get().worldMap.maps.length >= 3 && SL.store.get().worldMap.maps.every(m => Array.isArray(m.portals) && m.portals.length > 0), 'multi-map: มีแผนที่อย่างน้อย 3 แมพพร้อมพอร์ทัลวาร์ปเชื่อมถึงกัน');
check(typeof SL.state.save === 'function' && typeof SL.store.save === 'function', 'store: มีเมธอด SL.state.save() และ SL.store.save() สำหรับบันทึกทันทีหลังดรอปของ/วาร์ปแมพ');

/* 12) ทดสอบช่องเก็บของคาฟรา (Kafra Storage), น้ำหนักกระเป๋า (Weight) และไอเทมขยะมอนสเตอร์ (ETC) */
check(SL.store.get().equipItems.some(it => it.slot === 'etc'), 'ro-etc-items: มีหมวดหมู่ไอเทมขยะมอนสเตอร์และแร่ (ETC) เช่น Jellopy, Oridecon');
const jelloBagBefore = SL.state.getQty('etc_jellopy');
const jelloStoreBefore = SL.state.getStorageQty('etc_jellopy');
check(SL.state.depositToStorage('etc_jellopy', 2) === true && SL.state.getQty('etc_jellopy') === jelloBagBefore - 2 && SL.state.getStorageQty('etc_jellopy') === jelloStoreBefore + 2, 'kafra-deposit: ฝากไอเทมจากกระเป๋าเข้าช่องเก็บของคาฟรา (Storage) ได้ถูกต้อง');
check(SL.state.withdrawFromStorage('etc_jellopy', 2) === true && SL.state.getQty('etc_jellopy') === jelloBagBefore && SL.state.getStorageQty('etc_jellopy') === jelloStoreBefore, 'kafra-withdraw: เบิกไอเทมจากช่องเก็บของคาฟรา (Storage) กลับเข้ากระเป๋าได้ถูกต้อง');
const wCalc = SL.state.calcWeight();
check(wCalc && wCalc.cur > 0 && wCalc.max >= 2000, 'ro-weight: คำนวณน้ำหนักไอเทมในกระเป๋าเทียบกับน้ำหนักสูงสุดตามค่า STR ของตัวละครได้');

console.log(fail ? '\n' + fail + ' CHECK(S) FAILED' : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
