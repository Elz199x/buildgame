> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# วิเคราะห์จุดอ่อนของระบบ RO ดั้งเดิม แล้วออกแบบใหม่ให้สมดุลกว่า

## ส่วนที่ 1: วิเคราะห์ปัญหาเชิงลึกของระบบเดิม

### ปัญหาที่ 1: Stat ซ้อนทับหน้าที่กัน (Stat Overlap)
- **DEX** ทำพร้อมกันทั้ง HIT, ATK (physical), ลด cast time, ลด variance ของ damage → กลายเป็น stat ที่ "ต้องมี" ทุก build ทำให้ build อื่นไม่น่าเล่น
- **LUK** ใน RO ดั้งเดิมอ่อนแอมาก (แค่ CRIT เล็กน้อย + ต้าน status) → ไม่มีใครลงเพราะ opportunity cost สูงกว่าได้

### ปัญหาที่ 2: Diminishing Returns ไม่มี หรือมีแบบ hardcode
- STR 1 หน่วยแรกค่าเท่ากับ STR หน่วยที่ 99 → ทำให้เกิด "dump stat strategy" (ทุ่ม stat เดียวสุดโต่งดีกว่ากระจาย) ซึ่งไม่ส่งเสริมความหลากหลายของ build

### ปัญหาที่ 3: ASPD soft cap แบบ non-linear สร้างความสับสน
- สูตร ASPD ของ RO ใช้ log/sqrt ผสมกัน และมี cap แข็งที่ 193 — ผู้เล่นใหม่เข้าใจยาก และ dev ต่อยอดยาก เพราะ logic ฝังอยู่ในสูตรเดียว ไม่ใช่ config

### ปัญหาที่ 4: Damage variance (ATK range) ผูกกับ DEX แบบซ่อนเร้น
- ทำให้ DEX "ล่องหน" ในฐานะ stat ควบคุม consistency ซึ่งผู้เล่นทั่วไปไม่รู้ตัวว่ากำลังเพิ่มอะไรอยู่

### ปัญหาที่ 5: ไม่มีกลไก "trade-off" ที่จับต้องได้ระหว่าง stat
- ปั๊ม VIT ไม่มีข้อเสีย ไม่มี stat ไหนที่ "ขัดแย้ง" กันโดยตรง ทำให้ meta ไหลไปทาง "stat ที่ดีที่สุดในทุกสถานการณ์" แทนที่จะเป็นการเลือก identity

---

## ส่วนที่ 2: หลักการออกแบบใหม่ (Design Principles)

1. **1 Stat = 1 หน้าที่หลัก + 1 หน้าที่รอง** (ไม่ใช่ 3-4 หน้าที่ซ้อน)
2. **Diminishing returns แบบ curve ที่ config ได้** ไม่ hardcode breakpoint
3. **Trade-off ชัดเจน**: stat หนึ่งเพิ่ม ต้องมี stat อื่นที่ถูกลดทอนประสิทธิภาพสัมพัทธ์ (soft counter)
4. **ทุก stat ต้อง "รู้สึกได้" ว่ามีผล** แม้ลงแค่ 1-5 แต้มแรก

---

## ส่วนที่ 3: Status System เวอร์ชันใหม่ (ไม่มี class)

### Base Stats (6 ตัว — ปรับหน้าที่ใหม่ให้ไม่ overlap)

| Stat | หน้าที่หลัก | หน้าที่รอง | ตัดอะไรออกจากของเดิม |
|---|---|---|---|
| **STR** | Physical ATK | Carry weight | เหมือนเดิม |
| **AGI** | ASPD | FLEE (ลดสัดส่วนลง) | แยก FLEE บางส่วนไป LUK |
| **VIT** | HP max, DEF | HP regen | เหมือนเดิม |
| **INT** | MATK, SP max | MDEF | เหมือนเดิม |
| **DEX** | HIT (ที่เดียว) | ลด cast time | **ตัด ATK และ damage variance ออก** → ย้าย ATK bonus ไป STR เต็มๆ, variance ควบคุมด้วย weapon tier แทน |
| **LUK** | CRIT + CRIT damage | FLEE (รับมาจาก AGI บางส่วน) + status resist | เพิ่มน้ำหนักให้มีความหมายจริง |

**ผลลัพธ์**: DEX ไม่ใช่ stat ที่ "ต้องมีทุก build" อีกต่อไป เพราะ HIT สามารถชดเชยด้วย accuracy item/buff ได้ ส่วน ATK ทั้งหมดไปอยู่ที่ STR → นักฆ่าสาย agility เลือกได้จริงว่าจะเน้น ASPD (AGI) หรือ HIT (DEX) โดยไม่ขัดกับ ATK

### Diminishing Returns แบบ Curve (แทน hardcode breakpoint)

```
effective_stat = base_stat ^ 0.85   (หรือปรับ exponent ต่อ stat ได้)
```

หรือถ้าอยากให้ควบคุมง่ายกว่านี้ ใช้ **segment curve**:

```
contribution(stat) = 
  stat * 1.0           ถ้า stat <= 50
  50 + (stat-50)*0.7   ถ้า 50 < stat <= 100
  85 + (stat-100)*0.4  ถ้า stat > 100
```

ข้อดี: ปรับ breakpoint/slope ได้จาก config ไม่ต้องแก้สูตรคำนวณหลัก — รองรับการ rebalance ภายหลังโดยไม่กระทบโค้ด

### Trade-off กลไกใหม่: "Stat Tension"

เพิ่มกติกาว่า **AGI กับ VIT แข่งกันทางอ้อม**: ASPD ที่สูงขึ้นจะเพิ่ม "ช่องโหว่" ให้ DEF ลดประสิทธิภาพลงเล็กน้อยเมื่อโดนตี (ตีถี่ = เปิดจังหวะปะทะมากขึ้น) — จำลองจาก glass cannon concept แบบ soft (ไม่ hard-nerf ตรงๆ แต่ทำให้ full-AGI ต้องคิดเรื่อง survivability จริงจัง)

---

## ส่วนที่ 4: โครงสร้างสถาปัตยกรรม (คงเดิมจากที่เคยแนะนำ แต่เพิ่มชั้น Curve)

```
┌──────────────────────────┐
│ Base Stats (raw point)   │
├──────────────────────────┤
│ Diminishing Return Curve │  ← ใหม่: stat → effective value
├──────────────────────────┤
│ Modifier Layer           │  ← flat + percent (equipment/buff)
├──────────────────────────┤
│ Derived Stats (final)    │
└──────────────────────────┘
```

```
effective_base = curve(raw_stat)
final = (effective_base + sum(flat_mods)) * (1 + sum(percent_mods))
```

### โครงสร้างข้อมูล

```json
{
  "rawStats": { "str": 10, "agi": 10, "vit": 10, "int": 10, "dex": 10, "luk": 10 },
  "statCurveConfig": {
    "str": { "breakpoints": [50, 100], "slopes": [1.0, 0.7, 0.4] },
    "agi": { "breakpoints": [50, 100], "slopes": [1.0, 0.65, 0.35] }
  },
  "level": 1,
  "statusPoints": 48,
  "modifiers": [],
  "derivedCache": {}
}
```

---

## สรุปจุดที่ดีขึ้นจากของเดิม

| ปัญหาเดิม | แก้ไขอย่างไร |
|---|---|
| DEX overpowered เพราะทำหลายหน้าที่ | ตัดเหลือ HIT + cast time เท่านั้น |
| LUK ไร้ค่า | ยกน้ำหนัก CRIT + ย้าย FLEE บางส่วนมาให้ |
| Dump stat เดียวสุดโต่ง | Diminishing return curve แบบ config ได้ |
| ไม่มี trade-off จริง | Stat Tension ระหว่าง AGI-VIT |
| ASPD formula ซับซ้อนเกิน | ย้าย soft cap ไป config แยกจากสูตร |

ต้องการให้ผมช่วยต่อส่วนไหนเพิ่มเติมครับ — เช่น ออกแบบตารางตัวเลขจริง (ค่า coefficient ของแต่ละสูตร), เขียนเป็น class/module โค้ดจริง, หรือออกแบบระบบ status point allocation ตอน level-up ที่ผูกกับ curve นี้?
