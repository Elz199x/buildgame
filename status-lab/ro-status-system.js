/**
 * ============================================================================
 *  RO-Style Status System (Redesigned / Balanced)
 * ============================================================================
 *
 *  ระบบ Status แนว Ragnarok Online ที่ออกแบบใหม่เพื่อแก้ปัญหาความเหลื่อมล้ำ
 *  ของสูตรดั้งเดิม (DEX overpowered, LUK ไร้ค่า, ไม่มี diminishing returns ฯลฯ)
 *
 *  สถาปัตยกรรม 3 ชั้น:
 *
 *      Raw Stats  ──curve──▶  Effective Base  ──modifiers──▶  Final (Derived)
 *
 *  ออกแบบให้ "config-driven" ทุกจุด: ปรับ balance ได้โดยแก้ตัวเลขใน config
 *  ไม่ต้องแตะ logic การคำนวณ — เหมาะกับการต่อยอดเพิ่ม equipment / buff /
 *  skill tree / job class ในอนาคต โดยไม่ต้องรื้อ core
 *
 *  วิธีต่อยอดที่แนะนำ:
 *    - เพิ่ม job class       → ดูหัวข้อ "JOB CLASS HOOK" ด้านล่าง
 *    - เพิ่ม equipment       → push เข้า modifiers ด้วย source: "equipment:xxx"
 *    - เพิ่ม buff/debuff     → push เข้า modifiers ด้วย source: "buff:xxx"
 *      แล้วเรียก removeModifiersBySource() เมื่อหมดเวลา/ถอดของ
 *    - เพิ่ม skill passive    → เหมือน buff แต่ source: "skill:xxx"
 * ============================================================================
 */

'use strict';

// ============================================================================
// 1) STAT CURVE CONFIG — Diminishing Returns แบบปรับได้
// ============================================================================
// แต่ละ stat มี breakpoints + slopes ของตัวเอง เพื่อให้ปรับ balance แยกตัวได้
// contribution ต่ำกว่า breakpoint แรก = slope เต็ม (1.0)
// เกิน breakpoint จะได้ slope ที่ลดลงเรื่อย ๆ ตาม segment

const STAT_CURVE_CONFIG = {
  str: { breakpoints: [50, 100], slopes: [1.0, 0.7, 0.4] },
  agi: { breakpoints: [50, 100], slopes: [1.0, 0.65, 0.35] },
  vit: { breakpoints: [50, 100], slopes: [1.0, 0.75, 0.45] },
  int: { breakpoints: [50, 100], slopes: [1.0, 0.7, 0.4] },
  dex: { breakpoints: [50, 100], slopes: [1.0, 0.7, 0.4] },
  luk: { breakpoints: [50, 100], slopes: [1.0, 0.8, 0.5] }, // LUK คุ้มค่ากว่าของเดิม
};

/**
 * คำนวณ "effective value" ของ stat ตาม diminishing-return curve
 * @param {number} rawValue - ค่า stat ดิบที่ผู้เล่นลงไป
 * @param {{breakpoints:number[], slopes:number[]}} curveConfig
 * @returns {number} effective value หลังผ่าน curve
 */
function applyCurve(rawValue, curveConfig) {
  const { breakpoints, slopes } = curveConfig;
  let remaining = rawValue;
  let prevBreak = 0;
  let total = 0;

  for (let i = 0; i < breakpoints.length; i++) {
    const segmentSize = breakpoints[i] - prevBreak;
    if (remaining <= segmentSize) {
      total += remaining * slopes[i];
      return total;
    }
    total += segmentSize * slopes[i];
    remaining -= segmentSize;
    prevBreak = breakpoints[i];
  }

  // ส่วนที่เกิน breakpoint สุดท้าย ใช้ slope ตัวสุดท้าย
  total += remaining * slopes[slopes.length - 1];
  return total;
}

/**
 * แปลง rawStats ทั้งก้อนเป็น effectiveStats ทั้งก้อน
 * @param {Object} rawStats - { str, agi, vit, int, dex, luk }
 * @param {Object} [curveConfig=STAT_CURVE_CONFIG] - เผื่อ override ต่อ character/class
 */
function computeEffectiveStats(rawStats, curveConfig = STAT_CURVE_CONFIG) {
  const effective = {};
  for (const key of Object.keys(rawStats)) {
    const cfg = curveConfig[key];
    effective[key] = cfg ? applyCurve(rawStats[key], cfg) : rawStats[key];
  }
  return effective;
}

// ============================================================================
// 2) MODIFIER LAYER — equipment / buff / skill
// ============================================================================
// modifier แต่ละตัวมี: source, stat, type ("flat" | "percent"), value
// เก็บ source ไว้เพื่อให้ลบออกเป็นกลุ่มได้ง่าย (เช่น ถอดไอเทม, buff หมดเวลา)

/**
 * รวม modifier ทั้งหมดที่มีผลต่อ stat หนึ่ง ๆ แยกเป็น flat / percent
 * @param {Array} modifiers
 * @param {string} statName
 */
function collectModifiers(modifiers, statName) {
  let flatSum = 0;
  let percentSum = 0;
  for (const mod of modifiers) {
    if (mod.stat !== statName && mod.stat !== 'allBase') continue;
    if (mod.type === 'flat') flatSum += mod.value;
    else if (mod.type === 'percent') percentSum += mod.value;
  }
  return { flatSum, percentSum };
}

/**
 * คำนวณค่า final ของ stat หนึ่งตัว ตามสูตร:
 *   final = (effectiveBase + flatMods) * (1 + percentMods)
 */
function applyModifiers(effectiveBase, modifiers, statName) {
  const { flatSum, percentSum } = collectModifiers(modifiers, statName);
  return (effectiveBase + flatSum) * (1 + percentSum);
}

function addModifier(character, modifier) {
  character.modifiers.push(modifier);
}

function removeModifiersBySource(character, source) {
  character.modifiers = character.modifiers.filter((m) => m.source !== source);
}

// ============================================================================
// 3) DERIVED STATS — สูตรคำนวณ stat รอง (แก้ overlap ของ DEX/LUK แล้ว)
// ============================================================================
// หน้าที่ของแต่ละ base stat (เวอร์ชันใหม่ ไม่ซ้อนทับกัน):
//   STR  -> ATK (หลัก), Carry Weight
//   AGI  -> ASPD (หลัก), FLEE (รอง)
//   VIT  -> HP max / DEF (หลัก), HP regen (รอง)
//   INT  -> MATK / SP max (หลัก), MDEF (รอง)
//   DEX  -> HIT (หลักเดียว), Cast time reduction (รอง)  [ตัด ATK ออกแล้ว]
//   LUK  -> CRIT / CRIT damage (หลัก), FLEE เสริม + status resist (รอง)

const BASE_CONSTANTS = {
  hpPerVit: 12,
  hpPerLevel: 20,
  spPerInt: 8,
  spPerLevel: 8,
  atkPerStr: 2,
  matkPerInt: 2.5,
  hitBase: 50,
  hitPerDex: 1,
  fleeBase: 50,
  fleePerAgi: 0.8,
  fleePerLuk: 0.3, // LUK เสริม FLEE ตามดีไซน์ใหม่
  aspdBase: 100,
  aspdPerAgi: 0.4,
  aspdPerDex: 0.1,
  critBase: 1,
  critPerLuk: 0.3,
  defPerVit: 0.5,
  mdefPerInt: 0.5,
  hpRegenPerVit: 0.05,
  castReductionPerDex: 0.15, // %
};

/**
 * คำนวณ derived stats ทั้งหมดจาก character object
 * @param {Object} character - { rawStats, level, modifiers, curveConfig? }
 * @returns {Object} derivedStats ที่คำนวณเสร็จแล้ว
 */
function calculateDerivedStats(character) {
  const { rawStats, level, modifiers, curveConfig } = character;
  const eff = computeEffectiveStats(rawStats, curveConfig || STAT_CURVE_CONFIG);
  const C = BASE_CONSTANTS;

  // ดึง effective stat แต่ละตัวผ่าน modifier layer (รองรับ equipment/buff ที่บวกตรง base)
  const str = applyModifiers(eff.str, modifiers, 'str');
  const agi = applyModifiers(eff.agi, modifiers, 'agi');
  const vit = applyModifiers(eff.vit, modifiers, 'vit');
  const int_ = applyModifiers(eff.int, modifiers, 'int');
  const dex = applyModifiers(eff.dex, modifiers, 'dex');
  const luk = applyModifiers(eff.luk, modifiers, 'luk');

  const derived = {
    hp: Math.round(
      applyModifiers(
        vit * C.hpPerVit + level * C.hpPerLevel,
        modifiers,
        'hp'
      )
    ),
    sp: Math.round(
      applyModifiers(int_ * C.spPerInt + level * C.spPerLevel, modifiers, 'sp')
    ),
    atk: Math.round(
      applyModifiers(str * C.atkPerStr, modifiers, 'atk')
    ),
    matk: Math.round(
      applyModifiers(int_ * C.matkPerInt, modifiers, 'matk')
    ),
    hit: Math.round(
      applyModifiers(C.hitBase + dex * C.hitPerDex, modifiers, 'hit')
    ),
    flee: Math.round(
      applyModifiers(
        C.fleeBase + agi * C.fleePerAgi + luk * C.fleePerLuk,
        modifiers,
        'flee'
      )
    ),
    aspd: Number(
      applyModifiers(
        C.aspdBase + agi * C.aspdPerAgi + dex * C.aspdPerDex,
        modifiers,
        'aspd'
      ).toFixed(2)
    ),
    crit: Number(
      applyModifiers(C.critBase + luk * C.critPerLuk, modifiers, 'crit').toFixed(2)
    ),
    def: Math.round(applyModifiers(vit * C.defPerVit, modifiers, 'def')),
    mdef: Math.round(applyModifiers(int_ * C.mdefPerInt, modifiers, 'mdef')),
    hpRegen: Number(
      applyModifiers(vit * C.hpRegenPerVit, modifiers, 'hpRegen').toFixed(2)
    ),
    castReduction: Number(
      Math.min(100, dex * C.castReductionPerDex).toFixed(1)
    ), // % — cap ที่ 100%
  };

  // --- Stat Tension: AGI สูง (ASPD สูง) ลด DEF effective ลงเล็กน้อย ---
  // เพื่อสร้าง trade-off ระหว่างสาย full-AGI กับความอยู่รอด (soft, ไม่ hard-nerf)
  const aspdOverBase = Math.max(0, derived.aspd - C.aspdBase);
  const tensionPenalty = Math.min(0.25, aspdOverBase * 0.002); // cap ลด DEF ได้สูงสุด 25%
  derived.def = Math.round(derived.def * (1 - tensionPenalty));
  derived.defPenaltyFromAspd = Number((tensionPenalty * 100).toFixed(1)); // % ไว้โชว์ใน UI

  return derived;
}

// ============================================================================
// 4) LEVEL CAP & STAT POINT SYSTEM — จำกัดเลเวลไว้ที่ 99
// ============================================================================
// ตั้ง cap ไว้เป็น config เดียว ไม่ hardcode กระจายในหลายจุด เวลาจะขยับ cap
// (เช่น เพิ่ม rebirth/transcend ภายหลัง) แก้ที่เดียวตรงนี้พอ

const LEVEL_CAP_CONFIG = {
  maxLevel: 99,   // เลเวลสูงสุด
  statCap: 99,    // ค่า raw stat สูงสุดต่อ 1 ตัว (ผูกกับ maxLevel ของ non-transcend build)
};

/**
 * จำนวน status point ที่ได้รับเมื่อเลเวลอัพ "ไปสู่" level ที่ระบุ
 * สูตรทรงแบบ RO ดั้งเดิม (ยิ่งเลเวลสูง ยิ่งได้ point ต่อครั้งมากขึ้น)
 * แยกเป็น config function เพื่อปรับ growth rate ได้โดยไม่แตะ levelUp()
 */
function statusPointsForLevelUp(targetLevel) {
  return Math.floor((targetLevel + 9) / 4);
}

/**
 * ต้นทุน (point cost) ในการเพิ่ม raw stat ตัวหนึ่งอีก 1 หน่วย
 * ยิ่ง stat ปัจจุบันสูง ยิ่งใช้ point เยอะขึ้น (ผูกแนวคิดเดียวกับ diminishing curve)
 * @param {number} currentValue - ค่า raw stat ปัจจุบันของ stat นั้น (ก่อนบวก)
 */
function costForNextStatPoint(currentValue) {
  return Math.floor(currentValue / 10) + 1;
}

/**
 * เลเวลอัพ 1 ครั้ง — จะไม่ขยับเกิน maxLevel ที่ตั้งไว้
 * @param {Object} character
 * @param {Object} [capConfig=LEVEL_CAP_CONFIG]
 * @returns {{leveledUp: boolean, pointsGained: number}}
 */
function levelUp(character, capConfig = LEVEL_CAP_CONFIG) {
  if (character.level >= capConfig.maxLevel) {
    return { leveledUp: false, pointsGained: 0 }; // ชนเพดานแล้ว
  }
  character.level += 1;
  const pointsGained = statusPointsForLevelUp(character.level);
  character.statusPoints += pointsGained;
  return { leveledUp: true, pointsGained };
}

/**
 * ใช้ status point เพิ่ม raw stat ทีละ 1 หน่วย พร้อมเช็ค stat cap และ point ที่มี
 * @param {Object} character
 * @param {string} statName - 'str'|'agi'|'vit'|'int'|'dex'|'luk'
 * @param {Object} [capConfig=LEVEL_CAP_CONFIG]
 * @returns {{success: boolean, reason?: string, cost?: number}}
 */
function allocateStatPoint(character, statName, capConfig = LEVEL_CAP_CONFIG) {
  const current = character.rawStats[statName];
  if (current === undefined) {
    return { success: false, reason: 'unknown_stat' };
  }
  if (current >= capConfig.statCap) {
    return { success: false, reason: 'stat_cap_reached' };
  }
  const cost = costForNextStatPoint(current);
  if (character.statusPoints < cost) {
    return { success: false, reason: 'not_enough_points', cost };
  }
  character.statusPoints -= cost;
  character.rawStats[statName] += 1;
  return { success: true, cost };
}

// ============================================================================
// 5) CHARACTER FACTORY — สร้าง character object มาตรฐาน
// ============================================================================

function createCharacter({ rawStats, level = 1, curveConfig = null } = {}) {
  return {
    rawStats: Object.assign(
      { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 },
      rawStats
    ),
    level: Math.min(level, LEVEL_CAP_CONFIG.maxLevel), // กันสร้างตัวละครเริ่มเกิน cap
    statusPoints: 0,
    modifiers: [], // [{ source, stat, type: 'flat'|'percent', value }]
    curveConfig: curveConfig, // null = ใช้ STAT_CURVE_CONFIG default (เผื่อ per-class override)
  };
}

// ============================================================================
// 6) JOB CLASS HOOK — จุดเกี่ยวสำหรับต่อยอดระบบ class ในอนาคต
// ============================================================================
// แนวทาง: job class ไม่ควรไปแก้สูตรใน calculateDerivedStats ตรง ๆ
// แต่ให้ผูกผ่าน 2 ช่องทางนี้แทน เพื่อให้ core logic ไม่ต้องถูกแก้อีก:
//
//   1. curveConfig ต่อ class  -> เช่น Mage ให้ int โต slope ดีกว่า class อื่น
//   2. modifiers แบบ source: 'class:xxx' -> เช่น Swordman ได้ atk flat +5 ตั้งแต่เกิด
//
// ตัวอย่าง (คอมเมนต์ไว้เป็นแนวทาง ไม่ใช่โค้ดที่ทำงานจริงตอนนี้):
//
//   const MAGE_CURVE = { ...STAT_CURVE_CONFIG, int: { breakpoints:[70,120], slopes:[1,0.9,0.6] } };
//   const mage = createCharacter({ rawStats:{...}, curveConfig: MAGE_CURVE });
//   addModifier(mage, { source:'class:mage', stat:'matk', type:'percent', value:0.15 });

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  STAT_CURVE_CONFIG,
  BASE_CONSTANTS,
  LEVEL_CAP_CONFIG,
  applyCurve,
  computeEffectiveStats,
  addModifier,
  removeModifiersBySource,
  calculateDerivedStats,
  createCharacter,
  statusPointsForLevelUp,
  costForNextStatPoint,
  levelUp,
  allocateStatPoint,
};

// ============================================================================
// DEMO (รันตรง ๆ ด้วย: node ro-status-system.js)
// ============================================================================
if (require.main === module) {
  const hero = createCharacter({ rawStats: { str: 80, agi: 60, vit: 40, int: 10, dex: 30, luk: 20 }, level: 50 });

  console.log('--- ก่อนใส่ไอเทม/บัฟ ---');
  console.log(calculateDerivedStats(hero));

  addModifier(hero, { source: 'equipment:sword_of_fire', stat: 'atk', type: 'flat', value: 15 });
  addModifier(hero, { source: 'buff:blessing', stat: 'allBase', type: 'flat', value: 1 });
  addModifier(hero, { source: 'skill:power_thrust', stat: 'atk', type: 'percent', value: 0.1 });

  console.log('--- หลังใส่ไอเทม/บัฟ ---');
  console.log(calculateDerivedStats(hero));

  removeModifiersBySource(hero, 'buff:blessing');
  console.log('--- หลัง buff หมดเวลา ---');
  console.log(calculateDerivedStats(hero));

  // --- ทดสอบ Level Cap ที่ 99 ---
  console.log('\n--- ทดสอบ Level Cap (99) ---');
  const capTester = createCharacter({ rawStats: { str: 1, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }, level: 98 });
  console.log(levelUp(capTester)); // ควรเลเวลอัพได้ -> level 99
  console.log('level ปัจจุบัน:', capTester.level, '| statusPoints:', capTester.statusPoints);
  console.log(levelUp(capTester)); // ควรติด cap -> { leveledUp: false, pointsGained: 0 }
  console.log('level หลังพยายามอัพอีกครั้ง:', capTester.level);

  // --- ทดสอบ Stat Cap (99 ต่อ stat) + cost ที่เพิ่มตามค่า stat ---
  console.log('\n--- ทดสอบ Stat Cap + Point Cost ---');
  const statTester = createCharacter({ rawStats: { str: 97, agi: 1, vit: 1, int: 1, dex: 1, luk: 1 }, level: 1 });
  statTester.statusPoints = 10;
  console.log(allocateStatPoint(statTester, 'str')); // cost = floor(97/10)+1 = 10
  console.log('STR:', statTester.rawStats.str, '| points เหลือ:', statTester.statusPoints);
  console.log(allocateStatPoint(statTester, 'str')); // STR=98 -> cost=floor(98/10)+1=10 แต่ point เหลือ 0
  console.log(allocateStatPoint(statTester, 'str')); // ถ้า point ไม่พอ -> not_enough_points
}
