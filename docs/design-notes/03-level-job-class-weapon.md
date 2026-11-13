> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# โครงสร้างระบบ Base Level / Job Level / Class / Weapon

ไม่สร้างไฟล์ตามที่ขอ — นี่คือการวางโครงสร้างเชิงออกแบบ พร้อมจุดที่ต้องตัดสินใจ/ความเสี่ยงที่ควรรู้ก่อนลงโค้ดจริง

---

## 1) Base Level vs Job Level

ต้องแยกบทบาทให้ชัดตั้งแต่ต้น ไม่งั้นจะชนกับระบบ status point ที่มีอยู่แล้ว

| | Base Level | Job Level |
|---|---|---|
| **คุมอะไร** | HP/SP growth, Status Point (ที่ทำไปแล้ว), stat cap ตาม level | Skill point (อนาคต), bonus เฉพาะอาชีพบางอย่าง |
| **Cap** | 99 (ตั้งไปแล้ว) | **ต้อง cap แยกและต่ำกว่า** — Novice: 10, First Class: 50 |
| **อิสระจากกัน** | ใช่ — เลเวลขึ้นคนละ EXP pool คนละ EXP table | ใช่ |

### จุดที่ต้องตัดสินใจ
- **EXP แยก pool หรือ EXP เดียวแบ่งสัดส่วน?** แนะนำแยก pool แบบ RO ดั้งเดิม (Base EXP / Job EXP คนละแถบ) เพราะจัดการง่ายกว่า
- **Job Level ชนเพดานก่อน Base Level จะเกิดอะไรขึ้น?** (เช่น First Class Job cap 50 แต่ Base ยังไปต่อถึง 99 ได้) — ต้องตัดสินใจว่า Job EXP ส่วนเกินจะ "ทิ้ง" หรือ "แปลงเป็น Base EXP เสริมเล็กน้อย" แนะนำแบบหลัง เพื่อไม่ให้ผู้เล่นรู้สึกเสียของ

---

## 2) Class System

```
Novice (Job cap 10)
   ├── นักดาบ (Swordman)
   ├── โจร (Thief)
   ├── นักธนู (Archer)
   └── จอมเวท (Mage)
```

### เงื่อนไขเปลี่ยนอาชีพ
- Job Level ถึง cap ของ Novice (เช่น 10) → เปลี่ยนได้
- Base Level ไม่ต้อง gate (classic RO ก็ไม่ gate ด้วย base level ตอน novice→first job)

### โบนัสตอนเปลี่ยน Class (ต้องมี 2 ชนิด แยกกันให้ชัด)

1. **One-time flat bonus** — บวก raw stat ทันทีตอนเปลี่ยน (ให้รู้สึกว่า "แข็งแกร่งขึ้นทันที")
2. **Permanent passive modifier** — ผ่าน `modifiers` ที่มีอยู่แล้ว เช่น `source: 'class:swordman'` เป็น percent bonus ระยะยาว
3. **Growth coefficient ต่อคลาส** — ใช้ `curveConfig` override ที่ hook ไว้แล้ว (Mage ให้ INT โตดีกว่า, Swordman ให้ VIT โตดีกว่า) **+ ต้องเพิ่มของใหม่: HP/SP coefficient ต่อคลาส** (ตอนนี้สูตร HP/SP ใช้ constant ตัวเดียวทุกคลาส — อันนี้เป็น**ช่องโหว่ที่ต้องแก้**ก่อนมี class จริง)

| Class | เน้น Stat | HP Coef | SP Coef | แนวทาง Damage |
|---|---|---|---|---|
| นักดาบ | STR/VIT | สูง | ต่ำ | Physical melee, tank |
| โจร | AGI/DEX/LUK | กลาง | ต่ำ | Physical, crit/speed |
| นักธนู | DEX/AGI | กลาง-ต่ำ | ต่ำ | Physical ranged |
| จอมเวท | INT | ต่ำ | สูง | Magic |

### ปัญหาที่ต้องตัดสินใจ
- **Stat cap ยังคง 99 เท่ากันทุกคลาสไหม?** หรือบางคลาสควร cap stat หลักสูงกว่า (เช่น Mage cap INT ที่ 120)? แนะนำ**คงที่ 99 เท่ากันทุก class ไปก่อน** เพื่อความง่าย ค่อยแยกตอนมี Job 2
- Curve override ต่อคลาสจะชนกับ "diminishing return" ที่ออกแบบไว้แก้ dump-stat หรือเปล่า? ต้องเทสต์ว่า Mage ทุ่ม INT อย่างเดียวยังคุ้มไหมหลังมี curve ที่ดีขึ้น — เสี่ยง**สร้าง dump-stat กลับมาใหม่เฉพาะในคลาส** ถ้า curve ต่อคลาสดีเกินไป

---

## 3) Weapon System

### ปัญหาสถาปัตยกรรมสำคัญที่ต้องแก้ก่อน (บล็อกเกอร์)

ตอนนี้สูตร **ATK ผูกกับ STR เท่านั้น** (ที่ตั้งใจแก้ "DEX overpowered" ไปแล้ว) — แต่พอมี **Bow (ควรอิง DEX)** กับ **Staff/MATK (อิง INT)** สูตรเดิมจะไม่พอ

**ต้องเพิ่มชั้นใหม่: Weapon Profile Layer** แทรกอยู่ก่อน Derived Stats:

```
Raw Stats → Curve → Modifiers → [Weapon Profile] → Derived Stats
```

Weapon Profile กำหนด:
- stat ไหนเป็นตัวคูณ ATK หลักของอาวุธนั้น (ไม่ใช้ STR ตายตัวอีกต่อไป)
- ASPD offset เฉพาะอาวุธ
- bonus พิเศษ (per-weapon)
- class ไหนใช้ได้/ใช้ไม่ได้ (weapon restriction)
- ประเภทดาเมจ (slash / pierce / blunt / magic) — **เตรียมไว้สำหรับระบบ armor/resist ในอนาคต** แม้ตอนนี้ยังไม่มี

### ตารางออกแบบอาวุธ

| อาวุธ | มือ | Stat คุม ATK | ASPD | จุดเด่น/โบนัสพิเศษ | Trade-off | เหมาะกับ |
|---|---|---|---|---|---|---|
| **ดาบ 1H** | 1H (ใส่โล่ได้) | STR | ปกติ | สมดุล ใช้กับโล่ได้ | ATK ต่ำกว่าดาบ 2H | นักดาบ (tank/balanced) |
| **ดาบ 2H** | 2H | STR (coeff สูงกว่า 1H) | ช้าลง | ATK สูงสุดในกลุ่ม melee | ใส่โล่ไม่ได้, ASPD ต่ำ | นักดาบ (DPS) |
| **Axe** | 1H (ใส่โล่ได้) | STR | ช้ากว่าดาบ 1H | **เจาะ DEF %** (ละเลย DEF บางส่วน) | HIT ลดลง (โจมตีพลาดง่ายกว่า) | นักดาบ (anti-tank) |
| **Mace** | 1H (ใส่โล่ได้) | STR/VIT ผสม | ปกติ | **HP regen เมื่อโจมตีโดน** | ATK ceiling ต่ำสุดในกลุ่ม melee | นักดาบ (tank เต็มรูปแบบ) |
| **Dagger** | 1H | AGI (หลัก) + LUK (crit) | เร็วที่สุด | Crit rate โบนัสเพิ่ม | ATK ต่อหมัดต่ำ | โจร |
| **Bow** | 2H (ระยะไกล) | DEX | ปกติ-เร็ว | HIT โบนัสพิเศษ, โจมตีระยะไกล | ใส่โล่ไม่ได้, อ่อนเมื่อถูกเข้าประชิด (future mechanic) | นักธนู |
| **Staff** | 2H | INT (MATK) | ปกติ | MATK% โบนัส + ลด cast time เพิ่ม | ATK กายภาพต่ำมาก | จอมเวท |
| **โล่ (Shield)** | Off-hand เท่านั้น | VIT/LUK (block chance) | ลด ASPD เล็กน้อย | DEF flat + % block โจมตีกายภาพ | เสียช่องมืออีกข้าง, ลด ASPD | นักดาบ (tank) |

### ปัญหา/ความเสี่ยงที่ต้องตัดสินใจก่อนลงโค้ด

1. **ต้องมี Equipment Slot system ก่อน** — ตอนนี้ยังไม่มีแนวคิด "mainHand / offHand" ใน character object เลย ต้องเพิ่มก่อนจะ implement weapon ได้จริง (ไม่ใช่แค่ modifier ธรรมดา เพราะ weapon เปลี่ยน "สูตร" ATK ทั้งหมด ไม่ใช่แค่บวกค่า)

2. **Weapon restriction ต่อ class** — ต้องตัดสินใจว่าเข้มงวดแค่ไหน เช่น โจรใช้ดาบ 1H ได้ไหม (classic RO ให้ได้แต่ dmg ไม่ดี) แนะนำ: ทุกคลาสถืออาวุธอะไรก็ได้ แต่**ถ้าไม่ตรงสาย class จะไม่ได้โบนัสพิเศษของ class นั้น** (ยืดหยุ่นกว่า hard-lock)

3. **Bow ใช้ DEX เป็น ATK หลัก จะดึง DEX กลับมา overpowered เฉพาะ Archer ไหม?** — เนื่องจาก DEX ยังคุม HIT + cast reduction ของทุกคลาสด้วย ถ้า Archer ได้ ATK จาก DEX ด้วย จะกลายเป็น stat เดียวทำทุกอย่างให้ Archer โดยเฉพาะ (same pattern ที่เราเพิ่งแก้ไปสำหรับภาพรวม) — **ยอมรับได้ในระดับ class-specific** แต่ควรลด coefficient ของ DEX→HIT ลงสำหรับ build ที่ใช้ Bow เพื่อไม่ให้ DEX คุ้มเกินไปตัวเดียว (ต้อง tune ตัวเลขทีหลัง)

4. **Stat Tension (AGI→ลด DEF) ที่ทำไว้ก่อนหน้า จะชนกับ Axe's "เจาะ DEF%" และ Mace's regen ไหม?** ต้องเทสต์ลำดับการคำนวณ: ควรหัก DEF จาก Stat Tension ก่อน แล้วค่อยหัก DEF% จาก Axe ทีหลัง (สอง effect คนละชั้น ไม่ compound กันแบบผิดๆ)

5. **โล่กับ Swordman tank build เสี่ยง over-tank** — ถ้า block chance + DEF bonus + Mace regen รวมกันหมด นักดาบสาย tank อาจแกร่งเกินจุดสมดุล ควรมี cap รวมของ "damage reduction ทั้งหมด" (คล้าย `tensionPenalty` ที่ cap ไว้ 25% ไปแล้ว) — แนะนำตั้ง **global mitigation cap** ไว้ตั้งแต่ตอนนี้ในสถาปัตยกรรม

6. **Dagger dual-wield ในอนาคต** — ถ้าจะเปิดให้ถือ dagger สองมือทีหลัง ต้องออกแบบ ASPD/damage-split ไว้ตั้งแต่ตอนนี้ใน Weapon Profile layer ไม่งั้นจะต้องรื้อ

---

## สรุปสิ่งที่ต้องเพิ่มในสถาปัตยกรรม (ก่อนจะเขียนโค้ด)

| ของใหม่ที่ต้องเพิ่ม | เหตุผล |
|---|---|
| Job Level + Job EXP (แยกจาก Base) | แยก progression 2 เส้นตามที่ขอ |
| Equipment Slot (mainHand/offHand) | รองรับ weapon + shield อย่างเป็นระบบ |
| Weapon Profile Layer | ให้แต่ละอาวุธกำหนด stat ที่ใช้คำนวณ ATK ได้เอง ไม่ผูกตายกับ STR |
| HP/SP Coefficient ต่อ Class | ตอนนี้ยังเป็นค่าคงที่เดียวทุกคลาส ต้องแยก |
| Global Mitigation Cap | กัน tank build (โล่+mace+tension) over-balance |
| Damage Type tag (slash/pierce/blunt/magic) | ยังไม่ใช้ตอนนี้ แต่ควร tag ไว้รองรับ armor/resist ในอนาคต |

ต้องการให้ผมเจาะลึกส่วนไหนต่อก่อนครับ — เช่น ตัวเลข coefficient ของแต่ละอาชีพ/อาวุธแบบจริงจัง, หรือดีไซน์ Equipment Slot object structure ก่อน?
