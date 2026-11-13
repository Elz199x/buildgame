> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# ระบบ Magic Crit — ให้สาย Magic ได้ Crit แต่ scale ต่ำกว่าสายอื่น

ยังไม่สร้างไฟล์ (ต่อโหมดออกแบบเดิม) — นี่คือการวิเคราะห์สูตร, จุดที่เหมาะสม, และข้อเสีย/ข้อแนะนำ

---

## 1) หลักการที่ต้องยึดก่อนคำนวณตัวเลข

### ทำไม Magic Crit "ต้อง" scale ต่ำกว่า Physical Crit โดยธรรมชาติ (ไม่ใช่แค่ nerf ลอยๆ)

จากดีไซน์ที่ทำไปแล้ว (หัวข้อ Damage Type):
- **Physical ต้องผ่าน FLEE (dodge) ก่อนถึงจะติดดาเมจ** — มีโอกาส "พลาด" ทั้งหมด
- **Magic ไม่มี FLEE เลย ชนแน่นอนทุกครั้ง** (กันด้วย MDEF อย่างเดียว)

ดังนั้นถ้า Magic Crit ให้ค่าเท่า Physical Crit แบบ 1:1 ต่อแต้ม LUK → **Magic จะได้ทั้ง "ชนแน่นอน" และ "crit เท่าเดิม" พร้อมกัน** ซึ่งเป็นข้อได้เปรียบซ้อนที่ Physical ไม่มี (Physical ต้องเสี่ยงพลาดด้วย) — นี่คือเหตุผลเชิงระบบ ไม่ใช่แค่ "มันดูโอเวอร์" ลอยๆ

### ปัญหาที่ 2 ที่ต้องระวัง: LUK กลายเป็น stat ล่องหนแบบ DEX เดิม

ถ้าทุก class ได้ประโยชน์จาก LUK ทั้ง Physical Crit และ Magic Crit พร้อมกัน เสี่ยงย้อนกลับไปเป็นปัญหาเดิมที่เราแก้ DEX ไปแล้ว (stat เดียวมีประโยชน์กับทุกสาย) — ต้องออกแบบให้ **LUK ยังคงมีค่าไม่เท่ากันในแต่ละ class ตามธรรมชาติ** (มาจี Physical class ใช้ physical crit เป็นหลัก, Mage ใช้ magic crit เป็นหลัก — คนละแกน ไม่ overlap)

---

## 2) สูตรที่เสนอ

### Magic Crit Chance

```
MAGIC_CRIT_SCALAR = 0.5   // ครึ่งนึงของ physical ต่อแต้ม LUK เท่ากัน
MAGIC_CRIT_BASE = 0       // ไม่มี floor ฟรีเหมือน physical (ซึ่งมี critBase=1)

magicCritChance = MAGIC_CRIT_BASE + effectiveLUK * (critPerLuk * MAGIC_CRIT_SCALAR)
```

**ทำไม base = 0 (physical มี base = 1):**
Physical crit มี 1% ติดตัวฟรีเป็น "รสชาติ" ของการต่อสู้พื้นฐาน แต่ Magic Crit เป็น **mechanic เสริมที่ต้องลงทุนถึงจะได้** — มาจี้ล้วน (pure INT, LUK=0) จะไม่มี crit เลย เป็น build "เสถียร ดาเมจคงที่" ส่วนมาจี้ที่เอา LUK มาผสมจะเป็น build "เสี่ยงดวง ดาเมจแปรผัน" — สร้าง build identity 2 แบบในสายเดียวกัน (เหมือน dagger-crit build vs สาย balance ของ physical)

### Magic Crit "ผลที่ได้" — ไม่ใช้ตัวคูณ x2 แบบ Physical ตรงๆ

Physical crit ของ RO คือ **ignore DEF เต็มร้อย** (ไม่ใช่แค่คูณดาเมจ) ถ้า Magic crit ให้ **ignore MDEF เต็มร้อยเหมือนกัน** จะชนกับ Global Mitigation Cap ที่ตั้งไว้ (จำกัด magic reduction สูงสุด 80%) แบบแรงเกินไป เพราะ "crit แปลว่าทะลุเกราะหมดทันที"

**เสนอ: Magic Crit ignore MDEF แค่บางส่วน (partial ignore) แทน**

```
MAGIC_CRIT_MDEF_IGNORE = 0.5   // crit แล้ว MDEF มีผลเหลือแค่ 50%
```

เทียบ:
| | ปกติ (ไม่ crit) | Crit |
|---|---|---|
| Physical | MDEF/DEF ทำงาน 100% | ignore DEF 100% (ทะลุเกราะกายภาพหมด) |
| Magic | MDEF ทำงาน 100% | MDEF เหลือผล 50% (ทะลุครึ่งเดียว) |

---

## 3) ตัวอย่างตัวเลขจริง (ทดสอบว่า scalar 0.5 เหมาะสมไหม)

ใช้ curve LUK เดิมที่มี (`breakpoints:[50,100], slopes:[1.0,0.8,0.5]`):

| LUK (raw) | Effective LUK | Physical Crit% | Magic Crit% |
|---|---|---|---|
| 0 | 0 | 1.0% (base) | 0% |
| 20 | 20 | 7.0% | 3.0% |
| 50 | 50 | 16.0% | 7.5% |
| 99 (cap) | 89.2 | 27.76% | 13.38% |

**อ่านผล**: ต่อให้ทุ่ม LUK ไปจนสุด cap 99 (ซึ่งแพงมากเพราะ cost เพิ่มตามค่าที่มี) Magic Crit ก็ยังอยู่ราวๆ 13% เท่านั้น — เทียบกับ Physical Crit 27.76% ที่ LUK เท่ากัน ถือว่า**มีความหมาย (ไม่ไร้ค่า) แต่ไม่คุ้มเท่าการทุ่ม LUK ในสายกายภาพ** ตรงกับโจทย์พอดี

---

## 4) ปัญหา/ข้อเสียที่ต้องรู้ก่อนลงมือ

### ปัญหาที่ 1: Opportunity Cost ของ Mage ต่างจาก Physical class โดยธรรมชาติ (ต้องคิดเผื่อ)
Physical class ต้องแบ่ง stat point ไปที่ STR/AGI/DEX/VIT หลายตัวพร้อมกันเพื่อให้ฟังก์ชันหลักทำงาน (ATK, HIT, ASPD, survive) ส่วน **Mage ต้องการแค่ INT เป็นหลัก (MATK/SP)** — แปลว่า Mage มี "stat point เหลือ" มากกว่า class อื่นตามธรรมชาติ ถ้า scalar 0.5 ยังทำให้ Mage คุ้มที่จะทุ่ม LUK เพิ่มหลังจากอัพ INT พอแล้ว อาจกลายเป็น **meta บังคับ** ว่า "Mage ที่ดีต้องมี LUK" ซึ่งขัดกับเจตนาที่อยากให้เป็นแค่ build ทางเลือก

**ข้อแนะนำ**: ต้อง playtest เช็คว่า pure-INT mage (ไม่มี LUK เลย) ยังสร้างดาเมจ sustained ได้ใกล้เคียงกับ LUK-hybrid mage หรือไม่ (ต่างกันแค่ variance ไม่ใช่ expected value เฉลี่ยต่างกันมาก) — ถ้าพบว่า LUK-hybrid ดีกว่าชัดเจนในทุกสถานการณ์ ต้องลด scalar ลงอีก (เช่น 0.35-0.4)

### ปัญหาที่ 2: scalar ต่ำเกินไปจะกลายเป็น "mechanic ที่ไม่มีใครสนใจ"
ถ้า scalar ต่ำกว่า ~0.3 (Magic Crit ที่ LUK 99 จะเหลือแค่ ~8%) อาจจะเตี้ยจนไม่มีใครลงทุนเลย กลายเป็น dead design — **แนะนำช่วงที่เหมาะสมคือ scalar 0.4-0.5** ไม่ควรต่ำกว่านี้ ไม่งั้นเสียเวลาออกแบบไปเปล่าๆ

### ปัญหาที่ 3: ไม่ใช่ทุก Magic Skill ควร Crit ได้
ในเกมแนวนี้ ปกติ DoT (damage over time) หรือ AoE กวาดพื้นที่มักไม่ค่อยให้ crit เพื่อกัน damage output พุ่งเกินจริงตอน AoE กราดศัตรูหลายตัวพร้อมกัน

**ข้อเสนอ**: เพิ่ม flag ต่อ skill ตั้งแต่ตอนออกแบบ skill tree ในอนาคต
```
skillProfile: {
  id: 'fire_bolt',
  canCrit: true,      // nuke เดี่ยว ให้ crit ได้
},
skillProfile: {
  id: 'meteor_storm',
  canCrit: false,     // AoE กวาดพื้นที่ ไม่ให้ crit กันโอเวอร์
}
```

### ปัญหาที่ 4: Physical class ที่บังเอิญมีแต้ม LUK สูง (เช่น Thief) จะได้ Magic Crit แถมฟรีโดยไม่ได้ตั้งใจ
Thief ทุ่ม LUK เพื่อ Physical Crit อยู่แล้ว → จะได้ Magic Crit ติดมาด้วยทั้งที่ไม่ได้ใช้ magic เลย **ไม่ใช่ปัญหาจริง** เพราะ Thief ไม่มีช่องทางใช้ magic skill (ไม่มี skill magic ให้ใช้ตั้งแต่แรก) ค่า magicCritChance ที่ "มีอยู่" แต่ "ใช้ไม่ได้" ไม่กระทบ balance — แค่เป็นเลขเปล่าที่ไม่ถูกเรียกใช้

---

## 5) Config สรุป (พร้อมใช้งานเมื่อจะ implement)

```
MAGIC_CRIT_CONFIG = {
  base: 0,
  lukScalar: 0.5,           // ปรับช่วง 0.4-0.5 ตาม playtest
  mdefIgnoreOnCrit: 0.5,    // crit ทะลุ MDEF ได้ครึ่งเดียว (ไม่ใช่ทะลุหมดแบบ physical)
}

PHYSICAL_CRIT_CONFIG = {
  base: 1,
  lukScalar: 1.0,           // ค่าปกติเดิม (baseline)
  defIgnoreOnCrit: 1.0,     // ignore DEF เต็มร้อย (ตาม RO ดั้งเดิม)
}
```

สูตรรวม (ใช้ config เดียวกัน คำนวณต่างแค่ scalar — ไม่ต้องเขียนสูตรซ้ำสองชุด):
```
function computeCritChance(effectiveLuk, config) {
  return config.base + effectiveLuk * BASE_CONSTANTS.critPerLuk * config.lukScalar;
}
```

---

## สรุปคำแนะนำ

| หัวข้อ | ค่าที่เสนอ | เหตุผล |
|---|---|---|
| Magic Crit base | 0% | ต้องลงทุนถึงได้ ไม่ฟรีเหมือน physical |
| LUK scalar สำหรับ magic | 0.4–0.5 | สมดุล: มีความหมายแต่ไม่คุ้มเท่า physical |
| Crit "ผล" ของ magic | ignore MDEF 50% (ไม่ใช่ 100%) | กัน stack เกินกับ "ชนแน่นอน" ที่ magic มีอยู่แล้ว |
| Skill-level control | เพิ่ม `canCrit` flag ต่อ skill | กัน AoE/DoT ถูก crit จนโอเวอร์ |
| ต้อง playtest | pure-INT vs LUK-hybrid mage | กันไม่ให้ LUK กลายเป็น "ต้องมี" แบบ DEX เดิม |

ต้องการให้ผมคำนวณตัวเลขช่วง scalar ที่ต่างกัน (0.4 vs 0.5) เทียบ expected damage output ระหว่าง pure-INT กับ LUK-hybrid mage แบบละเอียดกว่านี้ไหมครับ หรือจะไปต่อเรื่อง Skill Tree structure ที่ผูกกับ `canCrit` flag นี้เลย?
