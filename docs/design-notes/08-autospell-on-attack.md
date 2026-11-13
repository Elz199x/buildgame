> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# Autospell-on-Attack: ออกแบบให้ Physical class ได้ Magic Damage แบบ "ด้อยกว่าธรรมชาติ" โดยไม่ต้อง Hard-Lock

ยังไม่สร้างไฟล์ — นี่คือการวิเคราะห์และดีไซน์เต็มระบบ ต่อยอดจาก Magic Crit Triad ที่ทำไปแล้ว

---

## 1) ปัญหาหลักที่ต้องแก้ก่อนอื่นใด

**คำถามที่แท้จริงคือ**: "ถ้าโจรตีเร็ว + คริบ่อย แล้วมี autospell ติดเวทด้วย จะกลายเป็นนักเวทที่ดีกว่า Mage จริงไหม?"

มี 2 ความเสี่ยงซ้อนกันที่ต้องตัดทั้งคู่:

1. **ASPD-stacking risk**: ถ้า proc chance คูณตรงกับจำนวนครั้งที่ตี (ต่อวินาที) → ยิ่งตีเร็วยิ่ง cast เวทถี่แบบไม่มีเพดาน → ตีเร็วกลายเป็น "ทางลัด" ของการได้ magic DPS แทนที่จะลง INT
2. **LUK-double-dip risk**: โจรลง LUK เพื่อ Physical Crit อยู่แล้ว ถ้า Magic Crit Chance (ที่ออกแบบให้ผูกกับ LUK เหมือนกัน) มาฟรีด้วย → โจรจะได้ magic crit chance สูงโดยไม่ได้ตั้งใจลงทุน

**หลักการแก้**: แยกให้ชัดว่า **"ความถี่ที่ยิง" (trigger) เป็นคนละเรื่องกับ "แรงที่ยิง" (damage)** — ความถี่ควบคุมด้วย item/skill design (ไม่ผูก stat), ส่วนแรงต้องผูกกับ INT ของผู้โจมตีเองเสมอ ไม่ว่าจะเป็นใคร

---

## 2) โครงสร้าง Autospell Profile

```js
{
  id: 'autospell_fireball_lv1',
  triggerChancePerHit: 0.08,     // 8% ต่อการโจมตี 1 ครั้ง — fixed value จาก item/skill ไม่ผูก stat ใดๆ
  icd: 4,                         // internal cooldown (วินาที) — ตัวสำคัญที่สุด อธิบายข้อ 3
  spellMatkMultiplier: 3.0,       // ตัวคูณของสเปลนี้ (เหมือน "เลเวลสเปล")
  damageType: 'magic',
  element: 'neutral',             // field เตรียมไว้ตามที่ออกแบบก่อนหน้า
  canCrit: true,                  // ใช้ Magic Crit Triad ชุดเดียวกับที่ออกแบบไปแล้ว ไม่แยกสูตรใหม่
  sourceStatOverride: null,       // ปกติ null = ใช้ INT ของผู้โจมตีเสมอ (เผื่อ item พิเศษในอนาคตเท่านั้น)
}
```

**กฎสำคัญ**: `spellMatkMultiplier` คือค่าที่ item/skill กำหนด (เหมือน "ของมันแรงแค่ไหนโดยตัวเอง") แต่ **ตัวคูณนี้คูณกับ effectiveINT ของตัวละครเสมอ** ไม่ใช่คูณกับ weapon ATK — นี่คือจุดล็อกสำคัญที่ทำให้ class ที่ไม่ลง INT จะได้ autospell damage ต่ำเป็นธรรมชาติ ไม่ต้องเขียนเงื่อนไข "ถ้าไม่ใช่ mage ให้ลดดาเมจ" แยกเลย — ระบบ stat เดิมทำงานแทนให้เอง

```
autospellMatk = effectiveINT * BASE_CONSTANTS.matkPerInt * spellMatkMultiplier
```

---

## 3) ICD (Internal Cooldown) — ตัวแก้ปัญหา ASPD-stacking โดยตรง

### สูตร

```
effectiveProcsPerSecond = min(
  attacksPerSecond(aspd) * triggerChancePerHit,
  1 / icd
)
```

### ทำไมต้องมี ICD แบบ hard cap ไม่ใช่แค่ลด % ตาม ASPD

ถ้าไม่มี ICD: โจรดาบสั้น ASPD สูง (สมมติตี 3 ครั้ง/วินาที) ที่มี proc 8% → cast เวที 0.24 ครั้ง/วินาที ส่วนดาบ 2H ช้า (ตี 1 ครั้ง/วินาที) → cast แค่ 0.08 ครั้ง/วินาที **อาวุธเร็วได้เปรียบ 3 เท่าโดยไม่เกี่ยวกับการลงทุน stat เลย** — นี่คือสิ่งที่ต้องกัน

ใส่ ICD = 4 วินาที (`1/icd = 0.25 ครั้ง/วินาที`) → ทั้งโจรและดาบ 2H จะถูก **cap ที่ 0.25 ครั้ง/วินาทีเท่ากันหมด** ต่อให้ ASPD ต่างกันแค่ไหน เพราะ `min()` จะเลือกค่าที่ต่ำกว่าเสมอ — **ASPD มีผลกับ autospell frequency ได้ก็ต่อเมื่อยังไม่ชน ICD เท่านั้น** (ช่วยอาวุธช้ามาก เช่น staff ที่ตีไม่ถึง 0.25 ครั้ง/วินาทีอยู่แล้ว) พอ ASPD สูงเกินจุดหนึ่ง การตีเร็วขึ้นต่อจะ**ไม่มีผลกับความถี่ autospell อีกเลย**

**ผลลัพธ์**: ไม่ว่าจะถืออาวุธไหน ASPD เท่าไหร่ — ความถี่สูงสุดของ autospell เท่ากันหมดทุก build (ที่ ASPD เกิน breakpoint) ตัวแปรที่เหลือที่ทำให้ "ใคร autospell แรงกว่า" คือ **INT เท่านั้น** ตรงตามเจตนา

### Anti-stacking เมื่อมีหลาย source พร้อมกัน (weapon + card + skill)

```
AUTOSPELL_GLOBAL_CONFIG = {
  sharedICD: true,              // ICD ตัวเดียวใช้ร่วมกันทุก source บนตัวละคร
  maxCombinedTriggerChance: 0.30, // รวม chance จากทุก source ห้ามเกิน 30% ต่อการตี 1 ครั้ง
}
```

ถ้าไม่ล็อกแบบนี้ ผู้เล่นจะใส่ของ autospell 4-5 ชิ้นพร้อมกันแล้ว proc ถี่จนตัว ICD เสียความหมาย เพราะแต่ละ source นับ ICD แยกกัน — ต้อง**แชร์ ICD ตัวเดียวข้าม source ทั้งหมด**

---

## 4) Magic Crit Triad ใช้สูตรเดิมทุกอย่าง (ไม่แยกระบบใหม่)

Autospell crit ใช้ `computeMagicCrit()` ที่ออกแบบไปแล้วตรงๆ — **นี่คือจุดที่ "โจรได้เปรียบบางส่วนแต่ไม่ล้น"**

### ตัวอย่างตัวเลขจริง: เทียบ Thief-Autospell vs Pure-INT Mage

**Thief build**: raw STR 40, raw AGI 70, raw DEX 40, raw LUK 80, raw INT 1 (ทิ้งหมด)

| ค่า | คำนวณ | ผล |
|---|---|---|
| effective LUK (curve 80) | 50×1.0 + 30×0.8 | **74** |
| effective INT (curve 1) | 1×1.0 | **1** |
| Magic Crit Chance | 74×0.3×0.45 | **9.99%** |
| MDEF Ignore (DEX 40) | 0.5 + 40×0.002 | **58%** |
| Crit Damage Bonus (INT 1) | 0.10 + 1×0.0008 | **10.08%** |
| Autospell MATK (×3 spell) | 1×2.5×3 | **7.5** (ก่อนคริ) |
| Autospell MATK ตอนคริ | 7.5×1.1008 | **8.26** |

**Mage build**: raw INT 99 (pure, ไม่แตะ LUK/DEX)

| ค่า | ผล |
|---|---|
| effective INT (curve 99) | **~84.3** |
| Autospell MATK (×3 spell) | **632.25** (ก่อนคริ) |

### อ่านผล — นี่คือจุดที่ยืนยันว่าออกแบบถูก

**โจร crit บ่อยกว่า (9.99% vs Mage ที่มักมี LUK น้อยกว่านี้มาก) แต่ดาเมจต่อครั้งต่างกัน ~75 เท่า** (8.26 เทียบ 632) — ความถี่สูง + ดาเมจต่ำสุดขีด vs ความถี่ต่ำ + ดาเมจสูงลิบ **ทั้งสอง build ไม่ได้แข่งกันในสนามเดียวกันเลย** โจรไม่มีทางใช้ autospell เป็น DPS หลักได้จริง เป็นได้แค่ "ของแถมที่ crit บ่อยแต่แทบไม่เจ็บ" ตรงตามเจตนาที่ต้องการให้ physical class ด้อยกว่าในแกนนี้โดยธรรมชาติ ไม่ต้องเขียนเงื่อนไข hard-nerf แยกเลย

---

## 5) เหตุผลเชิงระบบว่าทำไมถึง "ด้อยกว่าเองโดยไม่ต้อง nerf ตรงๆ"

| กลไกที่ทำหน้าที่กั้น | มีผลยังไง |
|---|---|
| Autospell damage ผูก effectiveINT เสมอ | Physical build ไม่ลง INT เลยตามธรรมชาติ (opportunity cost สูง) → ดาเมจต่ำเองโดยอัตโนมัติ |
| ICD cap ความถี่ไม่ให้ scale กับ ASPD | ตีเร็วไม่ช่วยให้ magic DPS สูงขึ้นเกินเพดาน |
| Crit Damage Bonus ผูก INT (ไม่ใช่ LUK) | ต่อให้โจร crit บ่อย แต่ "แรงตอนคริ" ยังต่ำเพราะ INT ต่ำ |
| MDEF Ignore ผูก DEX (ไม่ใช่ LUK) | โจรที่ไม่ได้ลง DEX เพิ่มเพื่อเรื่องนี้ จะไม่ได้ synergy ส่วนนี้ฟรีขนาดนั้น |

**สรุปสำคัญ**: ไม่มีจุดไหนในสูตรที่ physical build "โดนลงโทษ" ตรงๆ — ทุกอย่างคือผลพวงธรรมชาติจาก **การไม่ได้ลงทุนใน INT** ซึ่งเป็น opportunity cost ที่มีอยู่แล้วในระบบ (stat point cost ที่แพงขึ้นเรื่อยๆ ตามที่ออกแบบไว้ก่อนหน้า) — สอดคล้องกับปรัชญาการออกแบบทั้งหมดที่ทำมา (soft restriction ไม่ hard-lock)

---

## 6) ข้อควรระวัง/จุดที่ต้องตัดสินใจเพิ่ม

1. **Hybrid build ที่จงใจลง INT เสริมเพื่อ autospell โดยเฉพาะ** (เช่น โจรลง INT 30 แทน 1) — ต้องยอมรับว่าจะได้ autospell แรงขึ้นจริง แต่ต้องแลกกับ ATK/ASPD/VIT ที่หายไป เป็น build ทางเลือกที่ valid ไม่ใช่บั๊ก (ตรงกับเจตนาการออกแบบทั้งระบบ)

2. **Mage เองก็ใช้ autospell ได้** — ด้วย INT สูงอยู่แล้ว autospell จะแรงมาก (632 ต่อครั้ง) แต่ Mage ปกติ ASPD ต่ำ (ไม่ลง AGI) → จำนวนครั้งที่ตีต่อวินาทีต่ำกว่า ICD cap มาก (ไม่ชน ICD เลย) → autospell ของ Mage ความถี่ต่ำกว่าโจรเสมอ แต่แรงกว่าเยอะ — **ยัง "สมดุลในแกนความถี่" อยู่** เพราะ Mage ไม่ได้เปรียบเรื่องความถี่เลยด้วย

3. **`canCrit: false` สำหรับ autospell ที่เป็น AoE** — เหมือนที่ตกลงไว้กับ skill ปกติ กัน AoE autospell กวาดพร้อม crit จนโอเวอร์

4. **spellMatkMultiplier ของแต่ละ item/skill ต้องถูก tune แยกตามความหายาก** — item ธรรมดาควร multiplier ต่ำ (1.0-1.5), item หายาก/ปลายเกมค่อยขยับสูงขึ้น (3.0+) ไม่ควรให้ item ต้นเกมมี multiplier สูงเพราะจะไปขยายช่องว่างที่ตั้งใจบีบไว้

---

## สรุป Config พร้อมใช้งาน

```js
AUTOSPELL_GLOBAL_CONFIG = {
  sharedICD: true,
  maxCombinedTriggerChance: 0.30,
}

// ตัวอย่าง per-source profile
{
  triggerChancePerHit: 0.08,  // fixed, ไม่ผูก stat
  icd: 4,                      // วินาที — ตัวแก้ ASPD-stacking
  spellMatkMultiplier: 3.0,
  canCrit: true,                // ใช้ Magic Crit Triad เดิมทั้งชุด
  sourceStatOverride: null,     // เสมอใช้ effectiveINT ของผู้โจมตี
}
```

ต้องการให้คำนวณตาราง EV เทียบ build หลายแบบ (dagger-thief, bow-archer, 2H-sword) ว่า autospell contribution เป็นกี่ % ของ total DPS แต่ละ build ไหม หรือจะไปต่อเรื่อง Skill Tree structure ที่ผูกกับ `canCrit`/autospell flag นี้เลยครับ?
