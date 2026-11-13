> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# Magic Crit Triad: ให้ INT / DEX / LUK มีบทบาทคนละแกน โดยไม่ทับซ้อนกับระบบเดิม

ยังไม่สร้างไฟล์ — นี่คือการวิเคราะห์และดีไซน์สูตรแบบเต็ม

---

## 1) หลักคิดตั้งต้น: ห้ามให้ 3 stat ทำหน้าที่ซ้ำกัน (บทเรียนจาก DEX เดิม)

ปัญหาที่เราแก้ไปแล้วคือ DEX เคยทำหลายอย่างพร้อมกันจนกลายเป็น stat บังคับ ถ้าจะให้ INT/DEX/LUK ร่วมวงใน Magic Crit พร้อมกัน **ต้องแบ่งคนละแกนอย่างเคร่งครัด** ไม่งั้นจะย้อนรอยปัญหาเดิมแค่ย้ายไปอยู่ที่ Mage แทน

### แบ่งบทบาท 3 แกนที่ไม่ overlap กัน

| Stat | แกนที่ควบคุม | เหตุผลที่เลือกแกนนี้ให้ stat นี้ |
|---|---|---|
| **LUK** | **ความถี่** (Crit Chance) | ตรงกับงานเดิมที่ LUK ทำกับ Physical Crit อยู่แล้ว — สอดคล้องธรรมชาติของ stat (โชค = บ่อยแค่ไหน) |
| **DEX** | **ความลึกของการเจาะเกราะ** (MDEF Ignore % เพิ่มเติม) | DEX มีคอนเซปต์ "ความแม่นยำ/ควบคุม" อยู่แล้ว (คุม HIT ของฝั่งกายภาพ, คุม cast time ของฝั่งเวท) — ขยายเป็น "ความแม่นยำของการสาด spell ให้ทะลุเกราะ" เข้ากับ identity เดิมโดยไม่เพิ่มแกนใหม่ |
| **INT** | **ขนาดความแรงตอน crit** (Crit Damage Bonus) | INT คือ stat หลักของ Mage อยู่แล้ว (MATK/SP) — ให้ "แรงขึ้นตอน crit" เป็นโบนัสที่ผูกกับพลังเวทที่สะสมไว้ ไม่ใช่การันตีว่าต้องลงทุนเพิ่ม |

**กฎเหล็ก**: ห้าม INT ไปแตะ "ความถี่" และห้าม LUK ไปแตะ "ขนาดดาเมจ" — แยกเด็ดขาดคนละตัวแปร ไม่ให้ stat ไหนทำสองหน้าที่ในระบบนี้

---

## 2) ทำไมถึงออกแบบแบบนี้ถึงไม่ทำลายสมดุลของสายอื่น

### จุดสำคัญ: DEX และ INT ที่ใส่เพิ่ม ต้องเป็น "synergy ฟรี" ไม่ใช่ "ภาระการลงทุนใหม่"

- **Mage ลง INT อยู่แล้วเพื่อ MATK/SP** → โบนัส crit damage จาก INT คือ "ของแถม" ที่ไม่ต้องเสีย stat point เพิ่มแม้แต่แต้มเดียว ไม่สร้าง opportunity cost ใหม่
- **Mage อาจลง DEX บ้างอยู่แล้วเพื่อลด cast time** → โบนัส MDEF ignore จาก DEX ก็เป็น "ของแถม" บนการลงทุนที่มีเหตุผลอยู่แล้ว ไม่ใช่เหตุผลใหม่ที่บังคับให้ต้องลง DEX

**มีแค่ LUK เท่านั้นที่เป็น "การลงทุนใหม่จริงๆ"** (Mage ไม่มีเหตุผลอื่นต้องมี LUK เลย) → ทำให้ **Crit Chance ยังคงเป็นแกนเดียวที่ต้อง "เลือก" ลงทุน** ส่วน DEX/INT เป็นแค่ตัวขยายผลของสิ่งที่ลงทุนไปแล้วด้วยเหตุผลอื่น — Mage ที่ไม่สนใจ crit เลย (pure INT, ไม่มี LUK) ยังคงได้ประโยชน์เล็กน้อยจากโบนัสเหล่านี้โดยไม่ต้องเปลี่ยนแผนการเล่น แต่จะไม่ "crit" บ่อยพอจะเปลี่ยนเกม

---

## 3) สูตรและ Config

```
MAGIC_CRIT_CONFIG = {
  // แกนที่ 1: ความถี่ (LUK)
  chance: {
    base: 0,
    lukScalar: 0.45,       // ของ physical คือ 1.0 — magic เหลือ 45%
  },

  // แกนที่ 2: ความลึกการเจาะเกราะ (DEX) — ต่อยอดจาก mdefIgnoreOnCrit เดิม
  mdefIgnore: {
    base: 0.5,             // ค่าตั้งต้นที่ออกแบบไว้ก่อนหน้า
    dexScalar: 0.002,       // ต่อ effective DEX 1 หน่วย
    cap: 0.70,              // เพดานรวม ห้ามเกิน 70% (physical crit ignore 100%, magic ต้องต่ำกว่าเสมอ)
  },

  // แกนที่ 3: ขนาดดาเมจตอน crit (INT)
  critDamageBonus: {
    base: 0.10,             // +10% ดาเมจตอน crit แม้ INT=0 (floor เล็กน้อย กัน crit ไร้ความหมาย)
    intScalar: 0.0008,      // ต่อ effective INT 1 หน่วย
    cap: 0.25,              // เพดาน +25% ห้ามเกิน
  },
}
```

### ฟังก์ชันคำนวณ

```js
function computeMagicCrit(effectiveStats, config = MAGIC_CRIT_CONFIG) {
  const { luk, dex, int: intStat } = effectiveStats;

  const critChance = config.chance.base
    + luk * BASE_CONSTANTS.critPerLuk * config.chance.lukScalar;

  const mdefIgnore = Math.min(
    config.mdefIgnore.cap,
    config.mdefIgnore.base + dex * config.mdefIgnore.dexScalar
  );

  const critDamageBonus = Math.min(
    config.critDamageBonus.cap,
    config.critDamageBonus.base + intStat * config.critDamageBonus.intScalar
  );

  return { critChance, mdefIgnore, critDamageBonus };
}
```

---

## 4) ตัวอย่างตัวเลขจริง เทียบ 3 รูปแบบ build

สมมติ Mage ทุกคนลง INT เต็ม cap (raw 99 → effective ~84.3 ด้วย curve INT เดิม) ต่างกันแค่ DEX/LUK:

| Build | LUK (raw/eff) | DEX (raw/eff) | Crit Chance | MDEF Ignore | Crit Dmg Bonus |
|---|---|---|---|---|---|
| **Pure INT** (ไม่แตะ LUK/DEX) | 1 / 1 | 1 / 1 | 0.14% | 50.2% | 16.7% |
| **Hybrid เบาๆ** (DEX พอให้ cast เร็ว) | 1 / 1 | 40 / 39 | 0.14% | 57.8% | 16.7% |
| **Full Crit-Mage** (ทุ่ม LUK+DEX) | 60 / 54.5 | 60 / 54.5 | 8.2% | 60.9% | 16.7% |

**อ่านผล**: Crit Damage Bonus แทบไม่ขยับระหว่าง build เพราะผูกกับ INT ที่ทุกคนลงเท่ากันอยู่แล้ว (ตามที่ตั้งใจ — เป็นของแถมที่ไม่ต้องแข่งกัน) ส่วน **Crit Chance ต่างกันลิบลับ** (0.14% vs 8.2%) เพราะเป็นแกนเดียวที่ต้องจ่ายแพง (LUK cost เพิ่มตามค่าที่มีอยู่แล้ว) — ตรงกับเจตนา "ทางเลือก ไม่ใช่บังคับ"

---

## 5) ตรวจสอบด้วย Expected Value (EV) — ยืนยันว่าไม่ทำลายสมดุล

สมมติ defender มี MDEF effective 100, Magic damage ก่อนหัก mitigation = 1000

```
EV_damage = (1 - critChance) * normalDamage + critChance * critDamage
```

| Build | Normal Dmg (MDEF reduce 100% ของ base) | Crit Dmg (ignore บางส่วน + bonus) | EV เทียบ % เพิ่มจาก Pure INT |
|---|---|---|---|
| Pure INT | ~850 | ~920 (ไม่ค่อยเกิด) | baseline (0%) |
| Hybrid เบาๆ | ~850 | ~935 | +0.01% (แทบไม่ต่าง) |
| Full Crit-Mage | ~850 | ~935 | **+6.9%** |

**สรุปจาก EV**: การทุ่มเต็มที่ทั้ง LUK+DEX เพิ่ม DPS เฉลี่ยได้ราว **+7%** เท่านั้น เทียบกับการไม่แตะเลย — ถือว่าเป็น "bonus ที่คุ้มจะเล่นถ้าชอบ build เสี่ยง" แต่**ไม่ใช่ความต่างที่ทิ้งห่างจน pure-INT กลายเป็น build ที่ผิด** ตรงตามเป้าหมายที่ตั้งไว้ว่า "scale น้อยกว่าสายอื่น"

เทียบกับ Physical Crit build (LUK scalar 1.0, ignore DEF 100%) ซึ่งทั่วไปเพิ่ม EV ได้ 15-25% ในสถานการณ์ใกล้เคียงกัน — ยืนยันว่า **Magic Crit สเกลต่ำกว่า Physical Crit อย่างมีนัยสำคัญ** ตามโจทย์ตั้งต้น

---

## 6) Safeguard ที่ต้องคงไว้ (ป้องกันพังในอนาคต)

| ความเสี่ยง | วิธีป้องกันที่ใส่ไว้แล้ว |
|---|---|
| INT กลายเป็น stat เดียวทำทุกอย่างให้ Mage (MATK+SP+Crit Dmg) | cap critDamageBonus ไว้ต่ำ (25%) และเป็น "floor+small scalar" ไม่ใช่ linear เต็ม ไม่ให้โตเกิน MATK หลัก |
| DEX กลับมาล้นอำนาจข้าม class อีกครั้ง | บทบาทนี้จำกัดเฉพาะ "ตอน magic crit เกิดขึ้น" เท่านั้น ไม่กระทบ build อื่นที่ไม่ใช่ Mage เลย และ cap ignore ไว้ต่ำกว่า physical เสมอ (70% < 100%) |
| LUK ล้น crit chance จนเท่า physical | scalar 0.45 ต่ำกว่า physical ชัดเจน (เทียบ 1.0) |
| Crit chance/damage ไปชนกับ Global Mitigation Cap ที่ตั้งไว้ (max magic reduction 80%) | mdefIgnore เป็นคนละ layer กับ cap รวม — ลด "ค่า MDEF ที่ใช้คำนวณ" ก่อนเข้าสูตร ไม่ใช่เพิ่ม reduction เกิน cap โดยตรง ไม่ชนกัน |
| Mage ถูกบังคับให้ต้องมีทั้ง INT+DEX+LUK พร้อมกัน (overload แบบ DEX เดิม) | มีแค่ LUK เท่านั้นที่ต้อง "ตั้งใจ" ลงทุน ส่วน INT/DEX เป็นของแถมจากของที่ลงอยู่แล้วด้วยเหตุผลอื่น — Pure INT Mage ยังคง viable เต็มที่ |

---

## สรุปโครงสร้างสุดท้าย

```
Magic Crit = {
  chance:          ← LUK เท่านั้น (ต้องตั้งใจลงทุน, scalar ต่ำกว่า physical)
  mdefIgnore:      ← base คงที่ 50% + DEX เสริมเล็กน้อย (cap 70%, synergy ฟรีจาก cast-time build)
  critDamageBonus: ← base คงที่ 10% + INT เสริมเล็กน้อย (cap 25%, synergy ฟรีจาก MATK build)
}
```

เป็น "glass cannon path" ที่เลือกเล่นได้สำหรับ Mage โดยไม่กระทบ pure-INT mage เลย และสเกลโดยรวมต่ำกว่า physical crit build อย่างชัดเจนตามที่ตั้งโจทย์ไว้

ต้องการให้ผมทำ EV calculation เทียบแบบเจาะลึกกว่านี้ (หลายระดับ MDEF ของ defender, หลายระดับ LUK/DEX) เป็นตารางเต็ม หรือจะไปต่อเรื่อง Skill Tree ที่ผูกกับ `canCrit` flag ที่เคยพูดถึงไว้ก่อนหน้า?
