# ประวัติการพัฒนา (Changelog)

เรียงตามลำดับที่ทำในบทสนทนา (ภาษาไทยทั้งหมด) — ไฟล์ออกแบบต้นฉบับอยู่ใน `docs/design-notes/`

## ช่วงออกแบบระบบสเตตัส
1. วางโครงระบบ Status แนว RO ที่ต่อยอดได้ → `design-notes/01`
2. วิเคราะห์จุดอ่อนของ RO ดั้งเดิม (DEX overpower, สเตตัสเดี่ยวสุดโต่ง) และออกแบบใหม่ให้สมดุลกว่า → `design-notes/02`
3. ไฟล์ Node library `ro-status-system.js` (curve diminishing returns, modifier layer, derived stats, character factory, class hook) + ระบบ Level Cap 99 / `levelUp` / `allocateStatPoint` (cost `floor(stat/10)+1`)
4. โครงสร้าง Base Level / Job Level / Class / Weapon (Job Lv.10 เปลี่ยนอาชีพ, อาชีพ 2 ที่ Job Lv.50) → `design-notes/03–04`
5. `DAMAGE_TYPES` (slash/pierce/blunt/magic) → `05` · Magic Crit และ Magic Crit Triad (LUK/DEX/INT คนละแกน) → `06–07`
6. Autospell-on-attack ให้สายกายภาพได้เวทแบบด้อยกว่า, ตาราง EV ของ DPS, วิเคราะห์ Mage ปั๊ม AGI+INT+LUK, อธิบาย autospell ของ RO จริง → `08–11`

## RO Status Lab (`status-lab/ro-status-lab.html`)
| เวอร์ชัน | สิ่งที่เพิ่ม |
|---|---|
| V1 | หน้าเว็บจำลองสเตตัสทั้งระบบ: Base Level + raw stat + diminishing curve, คลาส 5 แบบ, อาวุธ 8 โปรไฟล์ (ล็อกมือรองเมื่อถือ 2H), passive 5 ตัว, autospell จากไอเทมแยกจาก passive (รวมแล้วชน cap), ดัมมี่ + จำลองต่อสู้ 20 วินาที |
| V2 | ช่อง Raw Stats เป็นระบบกดแต้มแบบ RO จริง: แต้มเริ่ม 48, `floor((level+9)/4)` ต่อเลเวล, cost `floor(current/10)+1`, ปุ่ม +/−, รีเซ็ต, ค่าเริ่มต้นถูกคำนวณให้ตรง Lv.49 |
| V3 | ดัมมี่เคลื่อนไหวเรียลไทม์: HP bar, ตัวเลขดาเมจเด้งแยกสี (ปกติ/คริ/autospell/magic crit/MISS), จังหวะตีตาม ASPD จริง, ล้ม-ฟื้นใน 1.2 วิ, ปุ่มเริ่ม/หยุด (pause-resume) |
| V4 | แท็บ "ตั้งค่าสูตร (Backend)": ทุกสูตรย้ายมาอยู่ใน `CONFIG` ก้อนเดียว แยกหมวดแก้/เพิ่ม/ลบได้ + ปุ่มคืนค่าเริ่มต้นรายหมวด + export/import JSON |
| V5 | Passive Skill Tree 24 ตัว (Universal 4 + นักดาบ/โจร/นักธนู/จอมเวท คลาสละ 5) พร้อมเงื่อนไขปลดล็อก + ตัวแก้ passive ใน backend (effects แบบ data-driven, 17 เป้าหมาย) |
| V6 | (เพิ่มปุ่ม "Max ASPD" แบบทุ่มแต้ม — **ถอดออกใน V7** เพราะเข้าใจเจตนาผิด) + กดค้างปุ่ม +/− เพื่อเพิ่มแต้มแบบเร่งความเร็ว (Pointer Events) |
| V7 | **ASPD hard cap แบบ RO** (`aspdCap` = 193) + ติ๊ก "ทดสอบที่ ASPD ตัน" |
| V8 | แก้การแปลง ASPD → ครั้งตี/วินาที จากเส้นตรง `ASPD/100` เป็น `100/(200−ASPD)` (ASPD 193 ≈ 14.3 ครั้ง/วิ) |

## Skill Lab (`skill-lab/`)
- ออกแบบโครงสกิล Novice (10 สกิล 3 สาย) → `design-notes/20` และนักดาบ (15 สกิล passive/active/buff/toggle/trigger) → `design-notes/21`
- **v1.0** — แอปแยกไฟล์เดียวพร้อมใช้: 4 หน้า (จำลองต่อสู้ / ต้นไม้สกิล / ตัวแก้ไข / ข้อมูล-ตรวจสอบ), ข้อมูลล้วน + validator, ตัวจำลองกำหนด seed ได้ + benchmark เทียบบิลด์, ตัวแก้ไขที่ rename id แล้วแก้อ้างอิงให้, import/merge JSON, ธีมมืด/สว่างตามระบบ, ใช้ได้บนมือถือ
- ปรับ balance ตามผลตรวจ: Soul +12 → +9/Lv, Berserk ใช้ `damageTaken`, เพิ่ม `buffPercentCap`
- ชุดทดสอบ: `tests/test-core.js` (แกนหลัก 25 ข้อ), `tests/ui-smoke.js`, `tests/ui-flow.js` (Playwright)
- **v1.1** — เพิ่มสกิลครบทุกคลาสแรก: **โจร (Thief 15 สกิล 3 สาย)**, **นักธนู (Archer 15 สกิล 3 สาย)**, **จอมเวท (Mage 15 สกิล 3 สาย)** รวมทั้งหมด 70 สกิล (Novice 10 + 4 คลาสแรก × 15 สกิล, คลาสละ 78 เลเวล เทียบ 49 แต้ม) พร้อมพรีเซ็ตสเตตัส Lv50, บิลด์ตัวอย่างอีก 6 บิลด์ (รวม 11 บิลด์), เพดาน `buffPercentCap.matk = 0.6`, ระบบ auto-migration เติมสกิลใหม่เข้า localStorage อัตโนมัติ (`version: 2`), และสคริปต์ `tools/build.js` สำหรับ build ด้วย Node.js

## บั๊กที่เจอและแก้ (บทเรียน)
- `ui.h` เดิมกำหนดค่าให้พารามิเตอร์ `attrs` ซ้ำ → ใน sloppy mode ไปทับ `arguments[1]` ทำให้ลูกที่เป็นสตริงหาย (หัวข้อ `h3` ว่าง) — แก้ด้วย rest parameters
- `store.change` เรียก `state.sanitize()` ซึ่งตัดสกิลที่ id หาย → การ rename ต้องจดค่าไว้ก่อนแล้วเขียนกลับ
- แถบคูลดาวน์สกิลเข้มเกินในธีมสว่าง → ใช้ `color-mix` กับสี `--fg`
- กราฟต้นไม้กว้างเกิน → จำกัด 2 สกิลต่อแถวในสายเดียวกัน (`PER`) แล้วขึ้นแถวย่อย
