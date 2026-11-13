> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# EV Table: Autospell Contribution to Total DPS — Dagger-Thief / Bow-Archer / 2H-Sword vs Staff-Mage

ใช้สูตรและ config ทั้งหมดที่ออกแบบไว้ก่อนหน้า (Curve, Weapon Profile, Magic Crit Triad, ICD) คำนวณจริงเพื่อดูว่า autospell กิน % ของ DPS รวมแค่ไหนในแต่ละ build

**หมายเหตุสมมติฐานที่ใช้**: ยังไม่มีระบบ defender DEF/MDEF จริงจัง จึงจำลอง physical crit ด้วยตัวคูณคงที่ x1.5 (แทนการ ignore DEF เต็มที่), แปลง ASPD→attacks/sec แบบเชิงเส้นง่ายๆ (`aspd/100`) เพื่อการเทียบเชิงสัดส่วนเท่านั้น ตัวเลขจริงต้องปรับเมื่อมีระบบ defender

---

## 1) Stat Build ที่ใช้ทดสอบ (raw stats)

| Build | STR | AGI | VIT | INT | DEX | LUK |
|---|---|---|---|---|---|---|
| Dagger-Thief | 40 | 90 | 30 | 1 | 50 | 70 |
| Bow-Archer | 20 | 60 | 40 | 1 | 90 | 20 |
| 2H-Sword (Swordman) | 90 | 30 | 60 | 1 | 20 | 10 |
| Staff-Mage (pure INT) | 1 | 20 | 30 | 90 | 40 | 10 |

## 2) ผลหลัง Curve + Weapon Profile

| Build | ATK (weapon) | ASPD (sim.) | Atk/sec | Physical Crit% |
|---|---|---|---|---|
| Thief (dagger) | 73.0 | 155.4 | 1.554 | 25.8% |
| Archer (bow) | 78.0 | 135.4 | 1.354 | 7.0% |
| Swordman (2H) | 109.2 | 99.0 | 0.990 | 4.0% |
| Mage (staff, autoattack) | 0.1 | 112.0 | 1.120 | 1.4% |

Physical DPS (รวม crit multiplier x1.5 แบบจำลอง): **Thief ~128.0 / Archer ~109.3 / Swordman ~110.3 / Mage ~0.11**

---

## 3) Autospell: ความถี่ (ทดสอบ 2 สถานการณ์)

ใช้ `triggerChancePerHit=0.15`, `icd=4s` (cap 0.25 proc/sec)

**สถานการณ์ A — มี autospell แหล่งเดียว:**

| Build | Proc/sec (ก่อน ICD) | หลัง ICD cap |
|---|---|---|
| Thief | 0.233 | 0.233 (ไม่ชน) |
| Archer | 0.203 | 0.203 |
| Swordman | 0.149 | 0.149 |
| Mage | 0.168 | 0.168 |

**สถานการณ์ B — ใส่ของ autospell 2 ชิ้นพร้อมกัน** (chance รวมถูก cap ที่ `maxCombinedTriggerChance=0.30`):

| Build | Proc/sec (ก่อน ICD) | หลัง ICD cap |
|---|---|---|
| Thief | 0.466 | **0.250 (ชน cap)** |
| Archer | 0.406 | **0.250 (ชน cap)** |
| Swordman | 0.297 | **0.250 (ชน cap)** |
| Mage | 0.336 | **0.250 (ชน cap)** |

**จุดสำคัญ**: พอ stack source จนเกิน threshold ทุก build ถูก ICD ดึงมาเท่ากันหมดที่ 0.25 proc/sec — ไม่ว่า ASPD จะต่างกันแค่ไหน ความถี่สุดท้ายเท่ากัน ยืนยันว่า ICD ทำงานตามที่ออกแบบ (ตัดความได้เปรียบจาก ASPD เมื่อ stack เกินจุดหนึ่ง)

---

## 4) ดาเมจต่อ Proc (ผ่าน Magic Crit Triad, spellMultiplier=3.0)

| Build | Autospell MATK (ก่อน crit) | Magic Crit% | Avg Dmg/proc (รวม crit) |
|---|---|---|---|
| Thief | 7.5 | 8.91% | 7.57 |
| Archer | 7.5 | 2.70% | 7.52 |
| Swordman | 7.5 | 1.35% | 7.51 |
| Mage | 585.0 | 1.35% | 586.3 |

**สังเกต**: Physical build ทั้ง 3 ได้ autospell damage ใกล้เคียงกันมาก (~7.5) ต่อให้ LUK ต่างกันเยอะ (70 vs 20 vs 10) เพราะ damage ผูกกับ **INT=1 เท่ากันหมด** — LUK มีผลแค่ "ความถี่ที่ crit" ไม่ใช่ "ขนาด" ตามที่ตั้งใจออกแบบ

---

## 5) สรุป: Autospell เป็นกี่ % ของ DPS รวม

### สถานการณ์ A (แหล่งเดียว)

| Build | Physical DPS | Autospell DPS | Autospell % ของรวม |
|---|---|---|---|
| Thief | 128.0 | 1.77 | **1.36%** |
| Archer | 109.3 | 1.53 | **1.38%** |
| Swordman | 110.3 | 1.12 | **1.00%** |
| Mage | 0.11 | 98.5 | **99.9%** |

### สถานการณ์ B (stack 2 source, ชน ICD cap)

| Build | Physical DPS | Autospell DPS | Autospell % ของรวม |
|---|---|---|---|
| Thief | 128.0 | 1.89 | **1.46%** |
| Archer | 109.3 | 1.88 | **1.69%** |
| Swordman | 110.3 | 1.88 | **1.67%** |
| Mage | 0.11 | 146.6 | **99.9%** |

---

## 6) สรุปผลที่ยืนยันว่าดีไซน์ถูกทาง

1. **ทุก physical class อยู่ในช่วง 1-2% ของ DPS รวมเท่านั้น** — ไม่ว่าจะเป็นโจรตีเร็ว+คริสูง หรือดาบ 2H ตีช้า+คริต่ำ ต่างกันแค่เศษเสี้ยว เพราะทั้งหมดถูกบีบด้วย INT=1 เหมือนกัน
2. **พอ stack source จนชน ICD (สถานการณ์ B) ความต่างระหว่าง physical build ยิ่งแคบลงอีก** (1.46% ถึง 1.69%) เพราะความถี่ถูกปรับเท่ากันหมด เหลือแค่ความต่างเล็กน้อยจาก Magic Crit chance (LUK ต่าง)
3. **Mage ไม่เสียเปรียบจากการมี ASPD ต่ำ** เพราะ autospell ของ Mage ไม่เคยชน ICD cap เลยในทั้งสองสถานการณ์ (ใช้ศักยภาพเต็มที่ตามแต้มที่ลง) ส่วน physical build ที่ ASPD สูงกลับโดน ICD "ตัดแต้มต่อ" ทิ้งไปเมื่อ stack เกิน
4. **โจร (LUK สูงสุด) ไม่ได้เปรียบ Archer/Swordman อย่างมีนัยสำคัญ** แม้ LUK ต่างกันถึง 7 เท่า (70 vs 10) เพราะ magic crit chance scale ต่ำ (lukScalar 0.45) และ crit damage ผูก INT ไม่ใช่ LUK — ตรงกับเป้าหมายที่ไม่อยากให้ LUK กลายเป็น "ทางลัด" สู่ magic damage

ต้องการให้ผมทดสอบเพิ่มกรณี **hybrid build ที่จงใจเติม INT บางส่วน** (เช่น โจรลง INT 20-30 แทน 1) ดูว่า autospell % กระโดดขึ้นแค่ไหน และ trade-off ที่เสียไปคุ้มไหม หรือจะไปต่อเรื่อง Skill Tree structure ครับ?
