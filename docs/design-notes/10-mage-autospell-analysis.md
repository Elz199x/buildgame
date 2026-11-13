> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# วิเคราะห์: Mage ปั๊ม AGI+INT+LUK เพื่อเล่น Autospell-on-Attack โดยเฉพาะ — จุดที่ระบบเดิมยังมีรูรั่ว

สมมติฐานของคุณถูกต้อง — นี่คือจุดที่ออกแบบไว้ก่อนหน้ายังไม่ปลอดภัยพอ ขอคำนวณให้เห็นตัวเลขจริงว่ารั่วตรงไหน แล้วเสนอ fix

---

## 1) คำนวณ Build ที่คุณถามถึงจริงๆ

**Mage-Hybrid**: raw INT 99 (คงเดิม ไม่ยอมเสีย), raw AGI 99 (ปั๊มเพิ่มจากเดิม), raw DEX 40, raw LUK 10

| ค่า | สูตร | ผล |
|---|---|---|
| effective INT (curve) | 50×1.0+49×0.7 | 84.3 |
| effective AGI (curve) | 50×1.0+49×0.65 | 81.85 |
| ASPD | 100+81.85×0.4+40×0.1 | 136.7 |
| Atk/sec (sim) | aspd/100 | 1.367 |
| Autospell MATK (×3 spell) | 84.3×2.5×3 | 632.25 |
| Magic Crit% (LUK10) | 10×0.3×0.45 | 1.35% |
| Avg Dmg/proc | ~633.7 | |

### เทียบ proc/sec กับ Pure-INT Mage เดิม (raw AGI 20)

| Build | Atk/sec | Proc/sec (single source, 0.15) | Proc/sec (2 source stack, cap 0.30) |
|---|---|---|---|
| Pure-INT Mage (agi20) | 1.12 | 0.168 | **0.25 (ชน ICD cap แล้ว!)** |
| Hybrid Mage (agi99) | 1.367 | 0.205 | **0.25 (ชน ICD cap เท่ากัน)** |

---

## 2) จุดที่รั่ว — เจอ 2 ปัญหาซ้อนกัน

### ปัญหา A: ปั๊ม AGI แบบ single-source ได้ไม่คุ้มทุน (ไม่ใช่ปัญหาจริง)
จาก agi20→99 ต้องใช้ ~510 status point (แพงมาก) แลกมาแค่ proc/sec เพิ่ม 0.168→0.205 (+22%) → DPS ของ autospell เพิ่มจาก ~98.5 เป็น ~106-130 เท่านั้น **ไม่คุ้มที่จะทิ้ง VIT/DEX ไปขนาดนั้น** — จุดนี้ระบบป้องกันตัวเองได้อยู่แล้ว

### ปัญหา B: Multi-source stacking คือจุดที่พังจริง ⚠️
สังเกตว่า **Pure-INT Mage (ไม่ต้องปั๊ม AGI เลย)** ก็ชน ICD cap ที่ 0.25 proc/sec ได้อยู่แล้วตั้งแต่ตอน stack 2 source — เพราะ ICD cap เป็น**ค่าคงที่เดียวกันทุก class**

นี่คือจุดอันตรายที่แท้จริง: **Mage ไม่ต้องปั๊มอะไรเลยก็แตะเพดานความถี่เดียวกับโจรได้** (0.25 proc/sec ทั้งคู่) แต่ดาเมจต่อ proc ต่างกันคนละขั้ว:

| Build | Proc/sec (ที่ cap) | Dmg/proc | Autospell DPS ที่ cap |
|---|---|---|---|
| Thief (full LUK, INT=1) | 0.25 | 7.57 | 1.89 |
| Mage (full INT) | 0.25 | 633.7 | **158.4** |

**158.4 DPS จากแค่ "ของแถม" (autospell) เพียงอย่างเดียว มากกว่า Thief ทั้ง build DPS รวมทั้งหมด (128.0)** — นี่คือจุดที่ breaking balance จริง ไม่ใช่เพราะ Mage ปั๊มอะไรผิดปกติ แต่เพราะ**ระบบปล่อยให้ "ของแถม" ของ Mage ใหญ่กว่า "อาชีพหลัก" ของคนอื่นทั้งคนโดยไม่ได้ตั้งใจ**

---

## 3) สาเหตุที่แท้จริง: ICD Cap เป็นค่าคงที่ ไม่สนใจว่าใครถืออาวุธอะไร

Autospell-on-attack ถูกออกแบบมาเป็น **"ของแถมสำหรับสาย physical ที่ตีถี่"** แต่สูตรความถี่ (`proc/sec`) ดันเป็นกลางทาง class สนิท — พอ damage-per-proc ผูกกับ INT (ซึ่งต่างกัน 80 เท่าระหว่างสาย) แต่ความถี่สุดท้ายเท่ากันหมด (เพราะ cap) **ของแถมเลยกลายเป็นโดดเด่นที่สุดสำหรับคนที่มี INT สูงอยู่แล้ว** ทั้งที่ควรเด่นกับสาย physical มากกว่า

---

## 4) Fix ที่เสนอ: ผูก Autospell Efficiency เข้ากับ "ประเภทอาวุธ" (ไม่ใช่ class หรือ stat)

สอดคล้องกับปรัชญาเดิมที่ทำมาตลอด (soft restriction ผ่าน Weapon Profile ไม่ hard-lock ที่ class)

### เพิ่ม field ใหม่ใน Weapon Profile

```js
{
  id: 'staff',
  ...
  autospellEfficiency: 0.4,   // ใหม่ — caster weapon ถูกลด "ความถี่ที่จะ proc" ลงเหลือ 40%
}
{
  id: 'dagger', 'bow', 'sword_1h', 'sword_2h', 'axe', 'mace',
  ...
  autospellEfficiency: 1.0,   // melee/ranged ได้เต็มประสิทธิภาพ — นี่คือ niche ที่ตั้งใจให้สายนี้
}
```

### ผลต่อสูตร

```
effectiveTriggerChance = triggerChancePerHit * weaponProfile.autospellEfficiency
```

คำนวณใหม่: Mage ถือ staff, trigger 0.15×0.4 = **0.06** ต่อ source

| Build | Proc/sec (single, 0.06 eff) | Proc/sec (2 source, cap 0.30 ก่อน×eff) |
|---|---|---|
| Mage (agi20, pure) | 0.0672 | 0.0672×2≈0.134 (ไม่ชน cap เลย) |
| Mage (agi99, hybrid) | 0.082 | 0.164 (ยังไม่ชน cap) |
| Thief (eff=1.0) | 0.233 | **0.25 (ชน cap ตามเดิม)** |

### DPS หลังแก้

| Build | Autospell DPS (ก่อนแก้) | Autospell DPS (หลังแก้) |
|---|---|---|
| Mage (pure INT, stack 2) | **158.4** | **103.9** |
| Mage (hybrid AGI, stack2) | ~165 | ~110 |
| Thief (stack 2) | 1.89 | 1.89 (ไม่เปลี่ยน) |

**ผลลัพธ์**: Mage's autospell DPS ลดจาก 158 เหลือ ~104-110 — ยังคงสูงกว่า physical class มาก (ตามธรรมชาติที่ INT สูงกว่าเยอะ) **แต่ไม่ล้นจนเกิน DPS รวมของ melee class ทั้ง build อีกต่อไป** และปั๊ม AGI เพิ่มตอนนี้ยิ่งไม่คุ้มเข้าไปใหญ่ (gain จาก agi stacking แทบไม่ขยับเพราะ eff ต่ำจนไม่มีทางชน ICD cap ได้เลย)

---

## 5) Safeguard ชั้นที่ 2: บังคับ Trade-off ถ้า Mage อยากเลี่ยงบทลงโทษนี้

ถ้า Mage คิดจะ "สวมอาวุธ melee แทน staff เพื่อเลี่ยง autospellEfficiency ต่ำ" — ต้องให้มี **ของที่เสียไปจริง**:

Staff's `specialEffects` ที่ออกแบบไว้ก่อนหน้า (`matkPercent +20%, castReductionBonus +10%`) จะหายไปทันทีถ้าถอด staff → เสียทั้ง **MATK ของสกิลจริง (ไม่ใช่แค่ autospell)** และ **cast time ที่เร็วขึ้น** — นี่คือ opportunity cost ที่หนักกว่าการได้ autospell efficiency คืนมาเยอะ เพราะ skill damage จริงควรเป็น DPS หลักของ Mage อยู่แล้ว (มากกว่า autospell แน่นอน) ระบบจึงกันตัวเองได้โดยไม่ต้อง hard-lock

---

## 6) ข้อแนะนำเพิ่มเติมสำหรับระยะยาว

| คำแนะนำ | เหตุผล |
|---|---|
| `spellMatkMultiplier` ของ item autospell ควรต่ำกว่า active skill multiplier เสมอ (เช่น autospell item ใช้ 0.3-1.0, active nuke skill ใช้ 2.0+) | กันไม่ให้ "ของแถมบนอาวุธ" แรงเท่า "สกิลหลักที่ตั้งใจกด" ไม่ว่าจะ fix efficiency ยังไงก็ตาม |
| ต้อง design ให้ Active Skill DPS ของ Mage > Autospell DPS เสมอ (เป็น design principle ตายตัว) | Autospell ควรเป็นแค่ "bonus ระหว่างที่ autoattack คั่นเวลา" ไม่ใช่ core loop ของ Mage |
| `autospellEfficiency` ควร apply ก่อนเช็ค `maxCombinedTriggerChance` (ลด per-source ก่อนรวม ไม่ใช่รวมก่อนแล้วค่อยลด) | กันไม่ให้ stack หลาย source แล้วยังโดนดันชน global cap ได้ง่ายเกิน แม้ eff ต่ำ |

---

## สรุป Config ที่อัปเดต

```js
WEAPON_PROFILES = {
  staff: { ..., autospellEfficiency: 0.4 },
  dagger: { ..., autospellEfficiency: 1.0 },
  bow: { ..., autospellEfficiency: 1.0 },
  sword_1h: { ..., autospellEfficiency: 1.0 },
  sword_2h: { ..., autospellEfficiency: 1.0 },
  axe: { ..., autospellEfficiency: 1.0 },
  mace: { ..., autospellEfficiency: 1.0 },
}

effectiveTriggerChance = triggerChancePerHit * weaponProfile.autospellEfficiency  // คำนวณก่อน sum หลาย source
```

ยืนยันตามที่คุณสงสัยไว้ถูกต้อง — จุดนี้เป็นรูรั่วจริงที่ต้องอุดก่อนจะ implement ต้องการให้คำนวณต่อว่าเลข `0.4` เหมาะสมที่สุดไหม (ลองเทียบ 0.3/0.4/0.5) หรือจะไปต่อเรื่อง Active Skill DPS baseline ที่ต้องออกแบบคู่กันเพื่อให้ตัวเลขนี้มีบริบทอ้างอิงจริงครับ?
