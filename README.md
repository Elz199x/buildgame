# RO-Style Game System — Status Lab + Skill Lab

โปรเจกต์ออกแบบระบบเกมแนว Ragnarok Online (ภาษาไทย) แบบ data-driven: **Status Lab** (จำลองสเตตัส) และ **Skill Lab** (จำลองสกิลแยกอิสระ) พร้อมบันทึกการออกแบบทั้งหมดและเอกสารสำหรับต่อยอดในเครื่อง

## เริ่มเร็ว (ไม่ต้องติดตั้งอะไร)

| ต้องการ | ทำ |
|---|---|
| ลอง Skill Lab | ดับเบิลคลิก `skill-lab/dist/ro-skill-lab.standalone.html` |
| ลอง Status Lab | ดับเบิลคลิก `status-lab/ro-status-lab.html` |

เบราว์เซอร์สมัยใหม่ (Chrome/Edge/Firefox) · ข้อมูลที่แก้เก็บใน localStorage ของเบราว์เซอร์ · ฟอนต์ใช้ Google Fonts (ออฟไลน์จะใช้ฟอนต์สำรองอัตโนมัติ)

## พัฒนา Skill Lab ต่อ

```bash
cd skill-lab
python3 build.py          # รวม src/*.js + shell.html → dist/*.html   (ต้องใช้ Python 3 เท่านั้น)
node tests/test-core.js   # ทดสอบแกนหลัก (Node 18+ ไม่ต้องติดตั้ง package)
npm install && npx playwright install chromium   # ครั้งเดียว ถ้าจะรันเทส UI
npm run test:ui           # ui-smoke + ui-flow (Playwright), ภาพหน้าจอลง tests/out/
npm run docs              # สร้าง docs/SKILL_TABLES.md และ BENCHMARK_REPORT.md ใหม่จากข้อมูลล่าสุด
npm run all               # ทุกอย่างข้างบน
```
แก้ไฟล์ใน `skill-lab/src/` เท่านั้น — `dist/` เป็นผลที่ build ออกมา

## โครงสร้างโฟลเดอร์

```
ro-game-project/
├─ README.md                  ← ไฟล์นี้
├─ CLAUDE.md                  ← บริบทโปรเจกต์ให้ Claude Code (ตอบภาษาไทย, กฎโค้ด, คำสั่ง)
├─ skill-lab/                 ← แอปจำลองสกิล (หลัก)
│  ├─ src/                    ← โมดูล 00–12, 99 + shell.html (แก้ที่นี่)
│  ├─ dist/                   ← ไฟล์ HTML ที่ build แล้ว
│  ├─ tests/                  ← test-core.js, ui-smoke.js, ui-flow.js
│  ├─ tools/                  ← สคริปต์สร้างเอกสารจากข้อมูล
│  ├─ build.py · package.json
├─ status-lab/                ← แอปจำลองสเตตัส (V8) + default-config.json + ไลบรารี Node รุ่นแรก
└─ docs/
   ├─ ARCHITECTURE.md         ← สถาปัตยกรรม Skill Lab (โมดูล, store, ลำดับโหลด)
   ├─ DATA_SCHEMA.md          ← สคีมาข้อมูล (สกิล คลาส สาย อาวุธ ฯลฯ)
   ├─ FORMULAS.md             ← สูตรคำนวณและกติกาตัวจำลอง
   ├─ EXTENDING.md            ← สูตรการต่อยอด: เพิ่มสกิล/คลาส/สเตตัส/กลไก/หน้าใหม่
   ├─ BALANCE_NOTES.md        ← เหตุผลของตัวเลข ผล balance และประเด็นที่ยังเปิดอยู่
   ├─ STATUS_LAB.md           ← สูตรและ CONFIG ของ Status Lab
   ├─ CHANGELOG.md            ← ประวัติการพัฒนา V1–V8, Skill Lab v1.0
   ├─ SKILL_TABLES.md         ← ตารางสกิลทั้งหมด (สร้างอัตโนมัติ)
   ├─ BENCHMARK_REPORT.md     ← ผลเทียบบิลด์ (สร้างอัตโนมัติ)
   └─ design-notes/           ← บันทึกออกแบบต้นฉบับจากการสนทนา (13 ไฟล์)
```

## อ่านอะไรก่อนดี

1. อยากเข้าใจภาพรวมโค้ด → `docs/ARCHITECTURE.md`
2. อยากเพิ่มสกิล/คลาส → `docs/DATA_SCHEMA.md` + `docs/EXTENDING.md`
3. อยากรู้ว่าทำไมตัวเลขเป็นแบบนี้ → `docs/BALANCE_NOTES.md` และ `docs/design-notes/`
4. อยากรวมสองแอป → `docs/EXTENDING.md` ข้อ 9 และ `docs/BALANCE_NOTES.md` ข้อ 5

## แนวคิดหลัก

- **Data-driven:** สกิล/คลาส/สาย/อาวุธ/มอนสเตอร์/บิลด์เป็นข้อมูล (JSON) ไม่ใช่โค้ด — แก้ข้อมูลโดยไม่แตะตัวจำลอง
- **การเชื่อมต่อสกิล = `requires:[{id, lv}]`** ของสกิลปลายทาง แก้จากทั้งสองฝั่งในตัวแก้ไข กราฟต้นไม้จัดวางใหม่เองจากข้อมูล
- **แยกโมดูลเป็นชั้น:** ข้อมูล/กฎ/สูตร/ตัวจำลอง (ไม่แตะ DOM) แยกจาก UI → เพิ่มคลาส สกิล หรือกลไกใหม่โดยไม่กระทบส่วนอื่น
- **ตรวจสอบได้:** `SL.rules.validate` จับวงกลม สกิลผี เลเวลเกิน และชุดทดสอบอัตโนมัติ
- **ตัวจำลองกำหนดผลได้:** tick 0.05 วิ + RNG แบบ seed (ผลเท่าเดิมทุกครั้ง) เทียบก่อน/หลังปรับ balance ได้

## ข้อควรรู้ / ข้อจำกัดปัจจุบัน

- Skill Lab ครอบคลุมสกิล **Novice (10) และนักดาบ (15)** เท่านั้น — โจร/นักธนู/จอมเวทเป็นโครงเปล่า (มีใน Status Lab แค่ passive)
- ตัวจำลองไม่มี: ยา/ฮีลเอง, หลายเป้าหมาย, ปาร์ตี้, cast time, stun (ช่อง `hooks` เตรียมไว้ในข้อมูล แต่ยังไม่ทำงาน)
- Status Lab กับ Skill Lab ยังแยกกัน — ค่าบางอย่างต่างกันโดยตั้งใจ (ดู `docs/BALANCE_NOTES.md` ข้อ 5)
- `status-lab/ro-status-system.js` กู้คืนจากประวัติการสนทนา เป็นไลบรารีอ้างอิง ไม่ได้ใช้ในหน้าเว็บ
