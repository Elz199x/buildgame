> **บันทึกจากบทสนทนาออกแบบ** — เก็บไว้เป็นเหตุผล/แบบแผนต้นทาง ตัวเลขจริงให้ยึดไฟล์ข้อมูลและโค้ดเป็นหลัก (บางค่าถูกปรับภายหลัง ดู docs/CHANGELOG.md และ docs/BALANCE_NOTES.md)

# DAMAGE_TYPES: วิเคราะห์ของจริงใน RO แล้วเสนอทางที่เหมาะกับระบบนี้

## RO ของจริงมี 2 ระบบคนละชั้นที่มักเข้าใจผิดว่าเป็นเรื่องเดียวกัน

### ระบบที่ 1: Weapon Damage Type (ATK Element แบบกายภาพ)
RO แบ่งอาวุธเป็น **Slash / Pierce / Blunt** (+ Magic แยกออกไปอีกกลุ่ม) — ใช้คุม:
- Card/อุปกรณ์บางชิ้นที่ "ลดดาเมจจากอาวุธประเภทนี้ %"
- Monster บางตัวต้านทาน/อ่อนแอต่อประเภทอาวุธ (เช่น Insect/Plant โดน Slash เยอะกว่า)

อันนี้คือสิ่งที่เราออกแบบไปแล้ว (หัวข้อ 6 ก่อนหน้า) — **ตรงกับ RO อยู่แล้ว**

### ระบบที่ 2: Elemental System (10 ธาตุ) — อันนี้ RO ใช้จริงจังกว่ามาก
RO มีธาตุ **Neutral, Water, Earth, Fire, Wind, Poison, Holy, Shadow, Ghost, Undead** ผูกกับทั้งอาวุธ (ถ้าลงเอนช้าน) และ armor (ธาตุป้องกัน) คำนวณผ่าน **ตาราง multiplier แบบ matrix** (attack element × defense element × element level 1-4) เช่น Fire vs Undead = x1.75, Water vs Fire = x1.5 เป็นต้น

**นี่คือคนละเรื่องกับ Slash/Pierce/Blunt/Magic โดยสิ้นเชิง** — อาวุธหนึ่งเล่มมีได้ทั้ง damage type (Slash) และ element (Fire) พร้อมกัน

---

## คำตอบตรงๆ: ควรทำยังไง

**แนะนำ: เอาระบบที่ 1 (ที่ออกแบบไปแล้ว) ไว้ใช้งานจริงตอนนี้ — ส่วนระบบที่ 2 (ธาตุ 10 แบบ) ยังไม่ควรใส่ตอนนี้** ด้วยเหตุผล:

1. **ยังไม่มีระบบ armor/monster** — ธาตุจะมีประโยชน์ก็ต่อเมื่อมีฝั่งรับ (armor ธาตุ, monster ธาตุ) ให้ชนด้วย ใส่ไปตอนนี้คือ over-engineering ที่ไม่มีอะไรให้ interact
2. **ตาราง multiplier 10×10×4 level ซับซ้อนเกินความจำเป็นของ scope ปัจจุบัน** (ยังไม่มี skill, ยังไม่มี monster) — ถ้าใส่ตอนนี้จะกลายเป็น dead config ที่ไม่ถูกใช้
3. **แต่ต้องเตรียมช่องไว้** ไม่ให้ตอนใส่จริงต้องรื้อ pipeline ดาเมจที่ทำไปแล้ว

## ทางที่เหมาะสม: แยกเป็น 2 layer ให้ชัด เตรียมที่แต่ยังไม่เปิดใช้

```
DAMAGE_TYPE  (ใช้งานจริงตอนนี้ — คุม hit/dodge/block pipeline)
  = 'slash' | 'pierce' | 'blunt' | 'magic'

ELEMENT      (เตรียม field ไว้ default 'neutral' ทุกตัว — ยังไม่มี logic คำนวณ)
  = 'neutral' | 'water' | 'earth' | 'fire' | 'wind'
  | 'poison' | 'holy' | 'shadow' | 'ghost' | 'undead'
```

WeaponProfile เพิ่ม field เฉยๆ:
```js
{
  id: 'sword_1h',
  damageType: 'slash',     // ใช้จริง
  element: 'neutral',      // เตรียมไว้ ยังไม่มีผลต่อการคำนวณ
  ...
}
```

เมื่อถึงเวลาทำระบบ armor/monster ค่อยเพิ่ม `ELEMENT_MULTIPLIER_TABLE` เป็น matrix แยกไฟล์ แล้ว hook เข้า damage pipeline **หลัง** `totalReduction` (mitigation cap) ที่ออกแบบไปแล้ว ไม่ใช่แทนที่

## ถ้าต้องการตัวเลขจริงของ RO element table ไว้อ้างอิงอนาคต

ตัวอย่างระดับ 1 (ส่วนหนึ่งของตารางเต็ม 10×10):

| Attack↓ / Defense→ | Neutral | Fire | Water | Undead |
|---|---|---|---|---|
| Neutral | 100% | 100% | 100% | 100% |
| Fire | 100% | 25% (resist) | 50% | 175% |
| Water | 100% | 150% | 25% | 100% |

(ตัวเลขจริงมีระดับ 1-4 ต่อธาตุ ซับซ้อนกว่านี้ — ค่อยดึงมาทำตอนถึงจุดนั้นจริง)

---

## สรุป

- **Damage Type (slash/pierce/blunt/magic)**: ใช้แบบที่ออกแบบไปแล้ว ตรงกับ RO อยู่แล้ว ใช้งานได้จริงตอนนี้
- **Element (10 ธาตุแบบ RO)**: ไม่ใส่ตอนนี้ แค่เติม field `element: 'neutral'` ไว้เฉยๆในทุก weapon profile กันต้องรื้อ struct ทีหลัง ส่วน multiplier table ค่อยทำตอนมี armor/monster จริง

ต้องการให้ล็อก field `element` ไว้ใน weapon profile ตอนนี้เลยไหม หรือข้ามไปเรื่อง damage pipeline เต็ม (attacker→defender) ที่ยังไม่ได้ออกแบบก่อน?
