# CLAUDE.md — บริบทโปรเจกต์ RO-Style Game System

## ผู้ใช้และภาษา
- เจ้าของโปรเจกต์ชื่อ Mr. Tuna พูดภาษาไทย → **ตอบเป็นภาษาไทยเสมอ** (ศัพท์เทคนิค/ชื่อโค้ดเป็นอังกฤษได้)
- ข้อความ UI, คอมเมนต์ในโค้ด และเอกสารในโปรเจกต์เป็นภาษาไทย ให้คงสไตล์เดิม
- ตอบกระชับ บอกผลลัพธ์ก่อน ไม่ต้องเล่าทุกขั้นตอน

## โปรเจกต์นี้คืออะไร
ระบบเกมแนว Ragnarok Online แบบ data-driven สองแอปไฟล์เดียว:
- `skill-lab/` — ตัวจำลองสกิล (งานหลัก) แยกจากส่วนอื่นเพื่อให้เพิ่มสกิล/คลาส/โครงสร้างและปรับการเชื่อมต่อสกิลได้ง่ายโดยไม่กระทบกัน
- `status-lab/` — ตัวจำลองสเตตัส (V8) เป็นไฟล์ HTML เดียว ไม่มี build
อ่านเอกสารใน `docs/` ก่อนแก้ใหญ่ (`ARCHITECTURE.md`, `DATA_SCHEMA.md`, `FORMULAS.md`, `EXTENDING.md`)

## คำสั่ง (รันใน `skill-lab/`)
```bash
python3 build.py                 # build dist/*.html (ทุกครั้งหลังแก้ src/)
node tests/test-core.js          # ทดสอบแกนหลัก ต้องผ่านทุกข้อก่อนจบงาน
npm run test:ui                  # Playwright (ต้อง npm install + npx playwright install chromium)
npm run docs                     # สร้าง docs/SKILL_TABLES.md + BENCHMARK_REPORT.md ใหม่
```

## กฎโค้ดของ Skill Lab (สำคัญ)
1. แก้เฉพาะ `skill-lab/src/*.js` และ `shell.html` — **ห้ามแก้ `dist/` ตรง ๆ**
2. ไม่ใช้ bundler/framework: vanilla JS, โมดูลเรียงตามเลขนำหน้า `NN-ชื่อ.js` ผูกกับ namespace `SL` ผ่าน IIFE
3. ชั้นเลขต่ำกว่า `06` (`00–05`: util, defaults, store, rules, stats, sim) **ห้ามแตะ DOM** และห้ามพึ่ง UI
4. เนื้อหาเกม (สกิล/คลาส/…): ใส่เป็น **ข้อมูล** ใน `01-defaults.js` ไม่ฝังเงื่อนไขเฉพาะสกิลในโค้ด sim/stats — ถ้าต้องมีกลไกใหม่ให้เพิ่มเป็นฟิลด์ข้อมูล + รองรับใน `normalizeSkill`, `validate`, ฟอร์มใน `10-ui-skillform.js` และตัว sim
5. ค่าสเกลตามเลเวลใช้ "Scalable value": เลข | `{base, step}` | `{table:[]}` ผ่าน `SL.util.val(S, lv)` เท่านั้น
6. การเปลี่ยนข้อมูลทุกครั้งต้องผ่าน `SL.store.change(fn, reason)` (normalize → sanitize state → save → emit) อย่าแก้ `store.data` ตรง ๆ
7. การเชื่อมต่อสกิล = `requires:[{id,lv}]` ของสกิลปลายทาง (AND) — validator ต้องจับ cycle/ghost/เลเวลเกินได้ ห้ามอนุญาต cycle ใน UI
8. UI: สร้าง DOM ด้วย `ui.h(tag, attrs, ...children)`; input ใช้ commit-on-`change`; อัปเดตแบบ in-place เพื่อไม่ให้ focus หลุด; **ห้าม `alert/confirm/prompt`** (ใช้ปุ่มยืนยันสองขั้น `confirmBtn`); clipboard ต้องมี fallback
9. สี/ฟอนต์ผ่าน CSS tokens (มืดเป็นหลัก มีธีมสว่าง) — ห้ามใช้สีตายตัวที่อ่านได้แค่ธีมเดียว
10. ตัวจำลองต้อง deterministic (seeded RNG mulberry32, tick 0.05s) — ห้ามใช้ `Math.random()` ใน `05-sim.js`/`04-stats.js`
11. localStorage ห่อ try/catch เสมอ · ชื่อ hash route เป็น ASCII (#sim #tree #editor #data)
12. เมื่อเปลี่ยนสูตร/ค่า balance ให้รัน `npm run docs` แล้วอัปเดต `docs/BALANCE_NOTES.md` กับ `docs/CHANGELOG.md`

## แผนที่ไฟล์เร็ว
| อยากแก้ | ไปที่ |
|---|---|
| ข้อมูลเริ่มต้น (สกิล/คลาส/อาวุธ/มอนสเตอร์/บิลด์) | `skill-lab/src/01-defaults.js` |
| กติกาเรียนสกิล / validator | `03-rules.js` |
| สูตรดาเมจ/สเตตัสสุดท้าย | `04-stats.js` |
| ตัวจำลองต่อสู้ / rotation / benchmark | `05-sim.js` |
| กราฟต้นไม้สกิล (ค่าคงที่ NW NH PER ฯลฯ) | `07-ui-tree.js` |
| ฟอร์มแก้สกิล | `10-ui-skillform.js` · ตัวแก้ไขรวม `11-ui-editor.js` |
| หน้าข้อมูล/นำเข้า-ส่งออก | `12-ui-data.js` |
| routing / การแจ้งเตือน | `99-main.js` |
| สูตรสเตตัส Status Lab | `status-lab/ro-status-lab.html` (`computeDerived`) |

## งานค้าง / ไอเดียถัดไป (ผู้ใช้ยังไม่ได้สั่ง — ถามก่อนทำ)
- สกิลโจร/นักธนู/จอมเวท (ใช้ `docs/design-notes/21-swordman-skill-design.md` เป็นแม่แบบ)
- ระบบยา/ฮีลในตัวจำลอง, หลายเป้าหมาย, stun/knockback ผ่าน `hooks`
- ปุ่ม "คัดลอกเป็น JSON สำหรับ Skill Lab" ใน Status Lab
- รวมสกิลของ Skill Lab เข้า Status Lab (ระยะ 1 passive → 2 active → 3 UI)
- ประเด็น balance ที่ยังเปิด: Guardian DPS ต่ำ, Berserker ตายเมื่อมอนสเตอร์สวนกลับ, SP เป็นคอขวด (ดู `docs/BALANCE_NOTES.md` §4)
- ข้อต่างระหว่างสองแอป เช่น Berserker Soul +12 (Status) vs +9 (Skill) — ตัดสินใจว่าอะไรเป็นแหล่งความจริง

## ข้อควรระวัง
- ค่าเดียวที่ผู้ใช้แก้ในหน้าเว็บอยู่ใน localStorage (`roSkillLabData_v1`, `roSkillLabState_v1`, `roSkillLabSeeded_v1`; Status Lab: `roStatusLabConfig_v1`) — ถ้าแก้ defaults แล้วหน้าไม่เปลี่ยน ให้ใช้ปุ่ม "คืนค่าเริ่มต้น" หรือล้าง localStorage
- ความเร็วตี: `APS = 100/(200−ASPD)` (ไม่ใช่ ASPD/100) — ผู้ใช้เคยแก้จุดนี้แล้ว อย่าเปลี่ยนกลับ
- "Max ASPD" ที่ผู้ใช้หมายถึงคือ **เพดาน 193 แบบ RO** ไม่ใช่ปุ่มทุ่มแต้มสุดทาง
