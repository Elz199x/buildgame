# RO-Style Game System — Skill Lab

โปรเจกต์ออกแบบระบบเกมแนว Ragnarok Online (ภาษาไทย) แบบ data-driven: **Skill Lab** (จำลองสเตตัสและสกิล; สูตรสเตตัสของ Status Lab เดิมรวมเข้ามาแล้ว) พร้อมบันทึกการออกแบบทั้งหมดและเอกสารสำหรับต่อยอดในเครื่อง

## ส่วนประกอบ

| ส่วน | คืออะไร |
|---|---|
| `server/` | เซิร์ฟเวอร์เกม Go (**gin + gorm** + Postgres): REST API, WebSocket 30Hz, ตัวจำลองสกิล/สเตตัส/ต่อสู้ — เซิร์ฟเวอร์เป็นเจ้าของความก้าวหน้าของผู้เล่นทั้งหมด |
| `web/` | หน้าเว็บ Next.js: login, โฮสต์ Skill Lab ที่ `/`, หน้าทดสอบ `/online` |
| `web/lab/src/` | โมดูล JS ของหน้าเกม/ตัวแก้ไข (วาดภาพ + ส่งคำสั่ง) — `web/` คัดลอกไปใช้ด้วย `npm run sync:lab` |

## ทดสอบ Skill Lab (JS)

```bash
cd web
npm run lab:test      # ทดสอบแกนหลัก (ข้อมูลอ่านจาก seed ของเซิร์ฟเวอร์)
npm run lab:docs      # สร้าง docs/SKILL_TABLES.md และ BENCHMARK_REPORT.md ใหม่จากข้อมูลล่าสุด
npm run lab:golden    # สร้าง golden test ให้ฝั่ง Go เทียบสูตร (หลังแก้สูตรฝั่ง JS)
```

## เล่น/พัฒนา: เซิร์ฟเวอร์ Go + Postgres + เว็บ Next.js

ต้องมี Docker, Go 1.26+ และ Node 20+

```bash
docker compose up -d db                 # 1) ฐานข้อมูล Postgres (schema สร้างให้อัตโนมัติ)
cd server && go run ./cmd/gameserver    # 2) เซิร์ฟเวอร์เกม  http://localhost:8080
cd web && npm install && npm run dev    # 3) หน้าเว็บ        http://localhost:3000
```

เปิด http://localhost:3000 → สมัครสมาชิก (ผู้ใช้คนแรกได้เป็น admin) → เข้าเกม 2.5D
(รัน 1+2 พร้อมกันใน Docker: `docker compose --profile app up -d --build`)

**เซิร์ฟเวอร์เป็นเจ้าของเกม (server-authoritative)** — ตัวละครใหม่เริ่ม Lv.1 แล้วพัฒนาด้วยการเล่นจริงเท่านั้น:
- ไคลเอนต์ส่งแค่ "คำสั่ง/อินพุต"; เซิร์ฟเวอร์ตัดสินดาเมจ มอนสเตอร์ HP/AI การล้มมอนสเตอร์ EXP ทอง ดรอป เลเวลอัป
- คำสั่งความก้าวหน้า `POST /api/game/{learn,unlearn,stat,equip,unequip,weapon,shield,storage,shop,class}` — เซิร์ฟเวอร์ตรวจกติกา หักแต้ม/ทอง แล้วตอบ state ใหม่ (ไคลเอนต์ไม่คำนวณเอง)
- หน้า **จำลองต่อสู้ (DPS)** ใช้ "แซนด์บ็อกซ์" (สำเนาตัวละครสำหรับลองค่า ไม่กระทบตัวละครจริง) และเรียก `/api/sim/*` ทั้งหมด: session ต่อสู้ (`/api/sim/sessions`), สเตตัสสุดท้าย/ดาเมจต่อสกิล (`/api/sim/skills`), benchmark/เทียบบิลด์, ลำดับสกิลอัตโนมัติ
- ตัวละครของ admin สลับเป็น **โหมด Lab** ได้ (แก้ตัวละครอิสระเพื่อออกแบบ/ทดสอบ) ผ่านปุ่มในเมนูเกม; ผู้เล่นทั่วไปอยู่โหมดเกมเสมอ
- ข้อมูลเกมและตัวละครอยู่ในฐานข้อมูล (ไม่ใช่ localStorage) — ดู `docs/DATABASE.md`; รายละเอียด API/ความปลอดภัย/โปรโตคอล/ตัวแปรสภาพแวดล้อม: `server/README.md`

## โครงสร้างโฟลเดอร์

```
├─ README.md · CLAUDE.md      ← ภาพรวม / บริบทให้ Claude Code (ตอบภาษาไทย, กฎโค้ด, คำสั่ง)
├─ server/                    ← เซิร์ฟเวอร์ Go (gin+gorm): cmd/gameserver · internal/{config,auth,store,gamedata,sim,progress,charsvc,game,protocol,realtime,httpapi} · migrations/
├─ web/                       ← Next.js: login, โฮสต์ Skill Lab ที่ /, หน้า /online · lab/ (src โมดูล JS ของหน้าเกม · tests · tools)
├─ docker-compose.yml         ← Postgres (+ เซิร์ฟเวอร์เกมด้วย --profile app) · .env.example
└─ docs/
   ├─ ARCHITECTURE.md         ← สถาปัตยกรรมโมดูล JS (store, ลำดับโหลด)
   ├─ DATA_SCHEMA.md · FORMULAS.md · EXTENDING.md · BALANCE_NOTES.md · CHANGELOG.md
   ├─ SKILL_TABLES.md · BENCHMARK_REPORT.md   ← สร้างอัตโนมัติ
   ├─ DATABASE.md             ← ตารางใน Postgres, migration, สำรองข้อมูล
   ├─ protocol/               ← สเปกโปรโตคอลไบนารี 0xC7 (.fbs)
   └─ design-notes/           ← บันทึกออกแบบต้นฉบับ
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

- Skill Lab ครอบคลุมสกิล **Novice (10) และนักดาบ (15)** เท่านั้น — โจร/นักธนู/จอมเวทเป็นโครงเปล่า (สกิลโจรมีเฉพาะ passive)
- ตัวจำลองไม่มี: ยา/ฮีลเอง, หลายเป้าหมาย, ปาร์ตี้, cast time, stun (ช่อง `hooks` เตรียมไว้ในข้อมูล แต่ยังไม่ทำงาน)
