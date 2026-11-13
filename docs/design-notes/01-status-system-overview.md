> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# ระบบ Status แบบ Ragnarok Online ที่ต่อยอดได้

ขอวางโครงสร้างให้แบบที่แยกชั้นชัดเจน เพื่อให้ต่อยอดเป็นระบบ equipment, buff, skill tree ได้ภายหลังโดยไม่ต้องรื้อของเดิม

## 1. Base Stats (ค่าพื้นฐาน 6 ตัว แบบ RO ดั้งเดิม)

| Stat | ชื่อเต็ม | ผลที่ควรมี |
|---|---|---|
| STR | Strength | เพิ่ม ATK, น้ำหนักที่ถือได้ |
| AGI | Agility | เพิ่ม ASPD (ความเร็วโจมตี), FLEE |
| VIT | Vitality | เพิ่ม HP max, DEF, HP regen |
| INT | Intelligence | เพิ่ม MATK, SP max, MDEF |
| DEX | Dexterity | เพิ่ม HIT, ATK เล็กน้อย, ลด cast time |
| LUK | Luck | เพิ่ม CRIT, อัตรา perfect dodge, ความต้านทาน status |

จุดสำคัญ: **แต่ละ stat ไม่ควรไปโผล่ในสูตรของ secondary stat ตรงๆ** ให้ผ่าน "modifier layer" กลางแทน จะอธิบายข้อ 3

## 2. Secondary / Derived Stats

คำนวณจาก Base Stats + Level + Job/Class + Equipment:

- **HP max** = f(VIT, Level, Class base)
- **SP max** = f(INT, Level, Class base)
- **ATK** = Weapon ATK + f(STR, DEX, Level)
- **MATK** = f(INT, Level) + Weapon MATK
- **DEF / MDEF** = Base armor DEF + f(VIT/INT) − Penetration
- **HIT** = Base + f(DEX, Level)
- **FLEE** = Base + f(AGI, Level)
- **ASPD** = Base - f(AGI, DEX) ปรับเป็น % ลด delay
- **CRIT** = f(LUK)

## 3. สถาปัตยกรรมที่ต่อยอดได้ (แนะนำให้ยึดเป็นหลัก)

```
┌─────────────────────────┐
│   Base Stats (raw)      │  ← จาก level-up, stat point allocation
├─────────────────────────┤
│   Modifier Layer         │  ← buff, debuff, equipment, skill passive
│  (additive / multiplic.) │
├─────────────────────────┤
│   Derived Stats (final)  │  ← ค่าที่เอาไปใช้คำนวณ damage จริง
└─────────────────────────┘
```

**หลักการสำคัญ**: แยก "Final Stat" ออกเป็น 3 ชั้นเสมอ
1. `base` — มาจาก stat point ที่ผู้เล่นลงไป
2. `flat modifiers` — บวกตรงๆ (เช่น item +10 STR)
3. `percent modifiers` — คูณทีหลัง (เช่น buff +20% ATK)

สูตรกลาง:
```
final = (base + sum(flat_mods)) * (1 + sum(percent_mods))
```

แบบนี้เวลาเพิ่มระบบ equipment, buff, skill tree ในอนาคต แค่ "push modifier" เข้า list โดยไม่ต้องแก้สูตรคำนวณหลักเลย

## 4. โครงสร้างข้อมูลแนะนำ (ถ้าจะ implement เป็นโค้ด)

```json
{
  "baseStats": { "str": 10, "agi": 10, "vit": 10, "int": 10, "dex": 10, "luk": 10 },
  "level": 1,
  "jobClass": "novice",
  "statusPoints": 48,
  "modifiers": [
    { "source": "equipment:sword_of_fire", "stat": "atk", "type": "flat", "value": 15 },
    { "source": "buff:blessing", "stat": "allBase", "type": "flat", "value": 1 },
    { "source": "skill:power_thrust", "stat": "atk", "type": "percent", "value": 0.1 }
  ],
  "derivedCache": { "hp": 0, "sp": 0, "atk": 0, "...": 0 }
}
```

- เก็บ `modifiers` เป็น array ที่มี source ชัดเจน → ลบ/เพิ่มได้ง่ายเวลา equip/unequip หรือ buff หมดเวลา
- `derivedCache` ไว้ cache ค่าที่คำนวณแล้ว แล้ว invalidate ใหม่เมื่อ base/modifier เปลี่ยน (อย่า recalculate ทุก frame)

## 5. จุดที่ RO เดิมมีปัญหา (ถ้าอยากทำให้ดีกว่า)

- RO มี stat soft cap (99/120/etc.) แบบ hardcode — ถ้าอยากต่อยอดควรทำเป็น config แยกตาม class/level cap แทนที่จะ hardcode ในสูตร
- การผสม DEX ในทั้ง HIT และ ATK ทำให้ DEX overpowered ในบาง build — ถ้าออกแบบใหม่อาจแยกให้ชัดกว่านี้

---

อยากให้ผมช่วยต่อในส่วนไหนเป็นพิเศษครับ — เช่น เขียนเป็นโค้ด (JS/C#/Python class), ออกแบบระบบ stat point allocation ตอน level up, หรือระบบ equipment/buff ที่ผูกกับ modifier layer นี้?
