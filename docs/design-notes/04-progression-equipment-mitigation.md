> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# โครงสร้างระบบ: Job Progression, Equipment, Weapon Profile, Class Balance, Mitigation, Damage Type

ยังไม่สร้างไฟล์ตามที่ขอ — นี่คือดีไซน์เต็มทั้ง 6 หัวข้อ พร้อมจุดตัดสินใจ/สูตรที่เสนอ

---

## 1) Job Level + Job EXP

### กติกาตามที่กำหนด
- Job Lv.10 (Novice) → เปลี่ยนอาชีพได้ทันที **ไม่เงื่อนไข Base Level**
- เปลี่ยนอาชีพแล้ว Job Level **รีเซ็ตเป็น 1** เริ่มนับใหม่ในสายอาชีพนั้น
- Job cap ของ First Class = 50 → ถึง cap แล้ว **หยุดรับ Job EXP ทันที** (ไม่ overflow ไปไหน ตามที่สั่ง — ยกเลิกไอเดีย "แปลงเป็น Base EXP" ที่เคยเสนอไว้)
- เตรียม hook ไว้สำหรับ Job 2 ที่ Job Lv.50 (ยังไม่ implement แต่ field ต้องรองรับ)

### โครงสร้างข้อมูล

```
jobState: {
  jobClass: 'novice',   // novice | swordman | thief | archer | mage | (future: job2 names)
  jobTier: 1,           // 0=novice, 1=first class, 2=second class (future)
  jobLevel: 1,
  jobExp: 0,
}
```

### Config ตาราง cap

```
JOB_CAP_CONFIG = {
  novice:   { cap: 10, tier: 0 },
  swordman: { cap: 50, tier: 1 },
  thief:    { cap: 50, tier: 1 },
  archer:   { cap: 50, tier: 1 },
  mage:     { cap: 50, tier: 1 },
}
```

### Logic สำคัญ
- `canChangeClass(character)` = `jobClass === 'novice' && jobLevel >= 10`
- `changeClass(character, newClass)` → set `jobClass`, `jobTier: 1`, **reset** `jobLevel: 1`, `jobExp: 0`, แล้ว apply one-time bonus + passive modifier (ตามที่ออกแบบไว้ก่อนหน้า)
- `gainJobExp(character, amount)` → ถ้า `jobLevel >= cap` ของ class ปัจจุบัน → **ไม่บวก exp เลย** (early return) ไม่ใช่แค่ไม่ level up — กัน exp ค้างในระบบโดยไม่มีประโยชน์

### จุดที่ต้องตัดสินใจ
- **Job 2 ที่ Lv.50 จะ "เปลี่ยนชื่อ class" หรือ "tier เดิมแต่ปลดล็อคความสามารถ"?** แนะนำให้เป็นชื่อใหม่ (เช่น Swordman → Knight) เพราะเข้ากับ RO มากกว่า และทำให้ `classAffinity` ของอาวุธ/damage type ขยายได้ง่ายโดยเพิ่ม entry ใหม่ใน config ไม่ต้องรื้อ logic
- Base Level คนละเรื่องกับ Job เลย — **ควรมี Base Level cap ขั้นต่ำแนะนำสำหรับ Job 2 ไหม?** (RO ดั้งเดิมบังคับ Base Lv.99 ก่อนขึ้น 2nd class แต่คุณตั้ง Base cap ไว้ที่ 99 เท่ากับ Job 2 ไปแล้ว ดังนั้นในระบบนี้คงไม่ชนกัน แต่ถ้าในอนาคตเพิ่ม 3rd job ต้อง gate ด้วย Base Level ไม่ใช่ Job Level อย่างเดียว)

---

## 2) Equipment Slot System

### โครงสร้าง

```
equipment: {
  mainHand: null,   // WeaponInstance | null
  offHand: null,    // ShieldInstance | WeaponInstance (future dual-wield) | null
}
```

### กติกาการ equip

| สถานการณ์ | ผล |
|---|---|
| Equip อาวุธ 2H ที่ mainHand | offHand ถูก **บังคับ unequip** และ **lock** (equip อะไรใน offHand ไม่ได้จนกว่าจะถอด 2H) |
| Equip อาวุธ 1H ที่ mainHand | offHand ใช้ได้ปกติ (โล่ หรือเว้นว่าง) |
| Equip โล่ที่ offHand | ต้องเช็คว่า mainHand ไม่ใช่ 2H อยู่ก่อน |
| Unequip mainHand (2H) | ปลด lock ที่ offHand อัตโนมัติ |

### ทำไมไม่ใช้ `modifiers` ธรรมดาแบบ equipment อื่น
อาวุธไม่ได้แค่ "บวกค่า" แต่ **เปลี่ยนสูตรว่า ATK อิง stat ตัวไหน** (เช่น Bow ใช้ DEX ไม่ใช่ STR) — เป็นการเปลี่ยน **วิธีคำนวณ** ไม่ใช่แค่ **ค่าที่บวกเพิ่ม** จึงต้องแยกเป็นชั้น Weapon Profile (หัวข้อ 3) แทนที่จะยัดเป็น modifier ทั่วไป ส่วนโบนัสรองของอาวุธ (เช่น crit%, hit%) ยังคงผ่าน `modifiers` array ปกติได้ (source: `'equipment:mainHand'`)

### ฟังก์ชันหลักที่ต้องมี
```
equipWeapon(character, slot, weaponId)
  → validate slot vs weapon.slotType (1H/2H/offHandOnly)
  → ถ้า 2H ที่ mainHand: auto unequip + lock offHand
  → push modifier ด้วย source: 'equipment:mainHand' (หรือ offHand)
  → เก็บ weaponProfile reference ไว้ใช้ตอนคำนวณ ATK

unequipWeapon(character, slot)
  → removeModifiersBySource(character, 'equipment:' + slot)
  → ปลด lock ถ้าเกี่ยวข้อง
```

### ข้อเสนอแนะเพิ่มเติม
- **Soft restriction ตามที่ตกลงไว้ก่อนหน้า** (ไม่ hard-lock ว่าอาชีพไหนถืออะไรไม่ได้ แต่ไม่ตรงสายจะไม่ได้ class bonus) → ต้องมี field `classAffinity` ใน weapon profile เช็คตอนคำนวณ ไม่ใช่ตอน equip
- เผื่ออนาคตมี armor slot (head/body/etc.) ให้ `equipment` object เป็น dictionary แบบเปิด ไม่ hardcode แค่ 2 key นี้ตั้งแต่ต้น จะได้ไม่ต้องรื้อ struct ทีหลัง

---

## 3) Weapon Profile Layer (เจาะลึกตามที่สนใจ)

### ตำแหน่งในสถาปัตยกรรม

```
Raw Stats → Curve → Modifiers (flat/%) → Weapon Profile (ATK formula) → Derived Stats
```

### โครงสร้าง WeaponProfile

```js
{
  id: 'sword_1h',
  weaponClass: 'sword',          // sword | axe | mace | dagger | bow | staff | shield
  slotType: '1H',                 // '1H' | '2H' | 'offHandOnly'
  damageType: 'slash',            // slash | pierce | blunt | magic  (หัวข้อ 6)

  atkFormula: {
    primaryStat: 'str',
    primaryCoefficient: 1.0,
    secondaryStat: null,          // เช่น mace ใช้ vit เสริม
    secondaryCoefficient: 0,
  },

  aspdOffset: 0,                  // บวก/ลบ ASPD base ตามความหนักอาวุธ

  specialEffects: {
    critBonus: 0,                 // flat % เพิ่ม crit
    hitBonus: 0,
    defPenetrationPercent: 0,     // axe ใช้
    hpRegenOnHit: 0,              // mace ใช้
    matkPercent: 0,               // staff ใช้
    castReductionBonus: 0,        // staff ใช้
    blockChance: 0,               // shield ใช้
  },

  classAffinity: ['swordman'],    // class ที่ได้ class-bonus เมื่อถืออาวุธนี้
}
```

### สูตรคำนวณ ATK ใหม่ (แทนที่สูตรเดิมที่ผูก STR ตายตัว)

```
function computeWeaponATK(effectiveStats, profile) {
  const { primaryStat, primaryCoefficient, secondaryStat, secondaryCoefficient } = profile.atkFormula;
  let atk = effectiveStats[primaryStat] * primaryCoefficient;
  if (secondaryStat) atk += effectiveStats[secondaryStat] * secondaryCoefficient;
  return atk;
}
```

`calculateDerivedStats` เดิมที่เขียนไว้ ต้องแก้จาก:
```
atk = str * atkPerStr
```
เป็น
```
atk = computeWeaponATK(effectiveStats, equippedWeaponProfile || DEFAULT_UNARMED_PROFILE)
```

### ตาราง Profile จริงของแต่ละอาวุธ (ฉบับใช้งานได้)

| Weapon | primaryStat | coeff | secondary | aspdOffset | damageType | special |
|---|---|---|---|---|---|---|
| Sword 1H | str | 1.0 | – | 0 | slash | – |
| Sword 2H | str | 1.4 | – | -15 | slash | – |
| Axe | str | 1.1 | – | -8 | slash | defPenetration 15%, hitBonus -10 |
| Mace | str | 0.8 | vit×0.3 | 0 | blunt | hpRegenOnHit +0.5%maxHP |
| Dagger | agi | 0.7 | luk×0.3 | +20 | pierce | critBonus +5% |
| Bow | dex | 1.0 | – | +5 | pierce | hitBonus +15 |
| Staff | int | — (ไม่คิด ATK กายภาพ) | – | 0 | magic | matkPercent +20%, castReductionBonus +10% |
| Shield (offHand) | – (ไม่มี ATK) | – | – | -5 | – | blockChance 15%, DEF flat +bonus |

### จุดที่ต้องตัดสินใจ
- **Staff ควรมี ATK กายภาพเป็น 0 เลยไหม หรือให้ต่ำมากแต่ไม่ใช่ 0?** แนะนำ**ไม่ใช่ 0** (ให้ base ต่ำสุด เช่น primaryStat: str, coeff: 0.1) เพื่อไม่ให้ตีมือเปล่าแรงกว่าใช้ staff ตีกรณีฉุกเฉิน (edge case QoL)
- **Unarmed (ไม่ถืออะไร) ควรมี default profile เท่าไหร่?** แนะนำ `{ primaryStat: 'str', coeff: 0.5, damageType: 'blunt' }` ให้อ่อนกว่าอาวุธทุกชนิดแต่ไม่ใช่ 0 ชัดเจน

---

## 4) HP/SP Coefficient ต่อ Class (ออกแบบให้สมดุลเป็นระบบ)

### หลักการ: "Coefficient Budget" — ป้องกัน class ได้เปรียบทั้งคู่

ตั้งงบรวมคงที่ต่อ class: `hpCoef + spCoef = BUDGET (คงที่ทุก class)` เพื่อบังคับว่า**ไม่มี class ไหนได้ HP เยอะและ SP เยอะพร้อมกัน** — ต้องเลือกฝั่งใดฝั่งหนึ่ง

```
CLASS_RESOURCE_BUDGET = 2.0   // ผลรวม hpCoef+spCoef ของทุกคลาสต้องเท่ากันหมด

CLASS_CONFIG = {
  novice:   { hpCoef: 1.0, spCoef: 1.0 },  // baseline
  swordman: { hpCoef: 1.4, spCoef: 0.6 },  // tank เน้น HP ชัดเจน
  thief:    { hpCoef: 1.1, spCoef: 0.9 },  // physical ผสม เอียง HP เล็กน้อย
  archer:   { hpCoef: 1.0, spCoef: 1.0 },  // สมดุลกลาง (ranged physical ไม่ tank ไม่ nuke)
  mage:     { hpCoef: 0.6, spCoef: 1.4 },  // nuker เน้น SP ชัดเจน
}
```

การใช้งาน:
```
hp = (vit*hpPerVit + level*hpPerLevel) * classConfig.hpCoef
sp = (int*spPerInt + level*spPerLevel) * classConfig.spCoef
```

### ทำไมวิธีนี้ดีกว่าการเซ็ตตัวเลขลอยๆ
- Validate ได้ง่ายด้วย assertion เดียว: `hpCoef + spCoef === BUDGET` ทุก class ที่เพิ่มเข้ามาใหม่ (รวม Job 2 ในอนาคต) — กัน dev ลืม balance ตอนเพิ่ม class ใหม่
- ทำให้ "VIT stacking" ของ Swordman ยังโดนจำกัดด้วย SP ที่ต่ำ (ใช้ skill ได้น้อยกว่าในอนาคตที่มี skill cost SP)

### จุดที่ต้องตัดสินใจ
- Budget = 2.0 คือเลขที่เลือกเอง ต้องเทสต์จริงว่า HP ของ Swordman (1.4×) เพียงพอเป็น "tank" ในทางปฏิบัติไหม หรือควรขยับ budget เป็น 2.2-2.5 — ตัวเลขนี้ขึ้นกับ pacing ของดาเมจที่ยังไม่ได้ออกแบบ (monster scaling ยังไม่มี)

---

## 5) Global Mitigation Cap (ตอบโจทย์ "Tank อมตะ" โดยตรง)

### ปัญหาเฉพาะที่คุณยกมา: VIT + AGI + INT รวมกันแล้วอมตะ

ต้องแก้ด้วย **2 ชั้นป้องกันพร้อมกัน**:

#### ชั้นที่ 1 — แยก "สระ" การป้องกันตามประเภทดาเมจ (ผูกกับหัวข้อ 6)
กฎสำคัญที่ยืมมาจาก RO ดั้งเดิม: **FLEE (dodge) ใช้ได้กับดาเมจกายภาพเท่านั้น ไม่มีผลกับ magic**

| ประเภทดาเมจ | ป้องกันด้วย |
|---|---|
| Physical (slash/pierce/blunt) | FLEE (dodge จาก AGI/LUK) + DEF (จาก VIT) + Block% (จากโล่) |
| Magic | **MDEF เท่านั้น** (จาก INT) — ไม่โดน dodge, ไม่โดน block |

**ผลลัพธ์**: build ที่ทุ่ม VIT+AGI (ป้องกันกายภาพเก่งมาก) จะ**ไม่มีผลใดๆ กับ magic** นักเวทโจมตีทะลุได้เสมอ ถ้าอยากกันทั้งสองทาง ต้องทุ่ม INT ด้วย ซึ่งจะชนกับ opportunity cost ของ stat point cost ที่เพิ่มขึ้นเรื่อยๆ (หัวข้อที่เคยทำไปแล้ว) → ป้องกัน "VIT+AGI+INT รวมกันแล้วอมตะ" เพราะการทุ่มทั้ง 3 ตัวพร้อมกันแพงเกินจะทำได้ในทางปฏิบัติ

#### ชั้นที่ 2 — Cap แข็งบนแต่ละสระ (กันทฤษฎีสุดโต่งที่ stat สูงเกินจริง)

```
GLOBAL_MITIGATION_CONFIG = {
  maxDodgeChance: 0.60,        // FLEE-based dodge ห้ามเกิน 60% ไม่ว่า FLEE จะสูงแค่ไหน
  maxPhysicalReduction: 0.80,  // DEF% + Block% รวมกัน ห้ามลดดาเมจเกิน 80%
  maxMagicReduction: 0.80,     // MDEF% ห้ามลดดาเมจ magic เกิน 80%
}
```

### วิธี combine หลายแหล่งไม่ให้ compound จนเกินจริง

ห้ามบวกตรงๆ (`def% + block% = 50%+30% = 80%` ตรงไปตรงมาแบบนี้เสี่ยงเกิน 100% ง่าย) ให้ใช้สูตร **multiplicative complement** แทน:

```
totalReduction = 1 - (1 - defReduction) * (1 - blockReduction) * (1 - otherReduction...)
totalReduction = Math.min(totalReduction, GLOBAL_MITIGATION_CONFIG.maxPhysicalReduction)
```

ข้อดี: ยิ่งมีหลายแหล่งลดดาเมจพร้อมกัน ผลตอบแทนส่วนเพิ่มจะยิ่งน้อยลงเองโดยธรรมชาติ (diminishing returns แบบ passive) ก่อนจะชน cap แข็งอีกที — สองชั้นซ้อนกันเพื่อความปลอดภัย

### จุดที่ต้องตัดสินใจ
- Dodge cap 60% หมายความว่า "full-AGI build" ยังโดนตีอย่างน้อย 40% ของจังหวะเสมอ — ตัวเลขนี้ต้องเทสต์คู่กับ HIT ของศัตรูที่ยังไม่ได้ออกแบบ
- Mace's `hpRegenOnHit` และ Stat Tension (AGI→ลด DEF) ที่ทำไปก่อนหน้า ต้องเข้าสูตร `totalReduction` นี้ด้วยหรือเป็นคนละ layer? แนะนำ: Stat Tension เป็น **penalty** (ลด DEF ก่อนเข้าสูตร) ส่วน block/DEF% เป็น **mitigation** (ลดดาเมจหลัง DEF คำนวณแล้ว) — คนละขั้นตอนของ pipeline ไม่ปะปนกัน

---

## 6) Damage Type Tag (slash / pierce / blunt / magic)

### Mapping จากอาวุธ (ตามธรรมชาติของอาวุธจริง)

| Weapon | damageType |
|---|---|
| Sword 1H/2H | slash |
| Axe | slash |
| Mace | blunt |
| Dagger | pierce |
| Bow | pierce |
| Staff | magic |
| Unarmed | blunt |

### โครงสร้างรองรับอนาคต (เตรียมไว้ตอนนี้ ยังไม่ต้องใช้จริง)

```
DAMAGE_TYPES = ['slash', 'pierce', 'blunt', 'magic'];

// เผื่อ armor/monster resistance ในอนาคต — ไม่ implement ตอนนี้ แค่เตรียม field
resistanceProfile: {
  slash: 0, pierce: 0, blunt: 0, magic: 0   // 0 = ไม่ต้าน, ค่าบวก = ต้านทาน %
}
```

### ผลที่ damageType มีต่อระบบที่ออกแบบไปแล้ว (เชื่อมกับหัวข้อ 5)
- **Shield block chance ใช้ได้เฉพาะ `slash | pierce | blunt`** ไม่มีผลกับ `magic` (ตามหลักการชั้นที่ 1 ของ Global Mitigation)
- **FLEE dodge ใช้ได้เฉพาะ 3 ประเภทกายภาพเช่นกัน**
- Axe's `defPenetrationPercent` ใช้ได้เฉพาะตอนดาเมจเป็น physical (อยู่แล้วโดยธรรมชาติเพราะ axe เป็น slash)

### จุดที่ต้องตัดสินใจ
- ตอนนี้ยังไม่มีระบบ armor/monster จึง `resistanceProfile` จะเป็น field ที่ "มีไว้ก่อนแต่ default 0 ทุกตัว" — ไม่กระทบการคำนวณปัจจุบันเลย ปลอดภัยที่จะใส่ไว้ล่วงหน้า
- ควรมี damage type ที่ 5 ไหม เช่น "neutral" สำหรับ true damage (ข้าม mitigation ทั้งหมด)? ยังไม่จำเป็นตอนนี้ แต่ถ้าจะมี skill ulti ในอนาคตที่ "เจาะเกราะทุกอย่าง" ควรเผื่อ enum ไว้ตั้งแต่ต้น

---

## สรุปสิ่งที่ต้องแก้ของเดิม (Breaking Changes จากไฟล์เดิม)

| ของเดิม | ต้องแก้เป็น |
|---|---|
| `atk = str * atkPerStr` (hardcode) | ดึงจาก Weapon Profile ที่ equip อยู่ |
| `hp`/`sp` ใช้ constant เดียวทุกคลาส | คูณด้วย `classConfig.hpCoef`/`spCoef` |
| ไม่มี damage type เลย | เพิ่ม tag ที่ weapon + ผูกกับ mitigation logic |
| `def` ลดจาก Stat Tension อย่างเดียว | ต้องแยก pipeline: Tension (pre) → DEF%/Block% (post, capped) |

ต้องการให้เจาะส่วนไหนต่อก่อนลงรายละเอียดเป็นโค้ด — เช่น pipeline การคำนวณดาเมจแบบเต็ม (attacker → defender, รวม hit/dodge/mitigation ทุกชั้น), หรือ one-time bonus/passive ตอนเปลี่ยน class แบบตัวเลขจริง?
