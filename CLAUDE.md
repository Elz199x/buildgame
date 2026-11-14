# CLAUDE.md — บริบทโปรเจกต์ RO-Style Game System

## ผู้ใช้และภาษา
- เจ้าของโปรเจกต์ชื่อ Mr. Tuna พูดภาษาไทย → **ตอบเป็นภาษาไทยเสมอ** (ศัพท์เทคนิค/ชื่อโค้ดเป็นอังกฤษได้)
- ข้อความ UI, คอมเมนต์ในโค้ด และเอกสารในโปรเจกต์เป็นภาษาไทย ให้คงสไตล์เดิม
- ตอบกระชับ บอกผลลัพธ์ก่อน ไม่ต้องเล่าทุกขั้นตอน

## โปรเจกต์นี้คืออะไร
ระบบเกมแนว Ragnarok Online แบบ data-driven:
- `server/` — เซิร์ฟเวอร์เกม Go (gin + gorm + Postgres) **เป็นเจ้าของเกมจริง** (ความก้าวหน้า ต่อสู้ รางวัล ตัวจำลอง)
- `web/` — Next.js โฮสต์หน้าเกม/ตัวแก้ไขที่เขียนเป็นโมดูล JS ใน `web/lab/src/`
อ่านเอกสารใน `docs/` ก่อนแก้ใหญ่ (`ARCHITECTURE.md`, `DATA_SCHEMA.md`, `FORMULAS.md`, `EXTENDING.md`)

## กฎการทดสอบ (สำคัญ — ผู้ใช้กำหนด)
- **ห้ามรันการทดสอบเองจนกว่าผู้ใช้จะสั่งให้ทดสอบ**: `go test`, `npm run lab:test`, `npm run lab:golden`, benchmark, `typecheck`, `next build`, รันเซิร์ฟเวอร์/สคริปต์เพื่อ "ลองดูว่าผ่านไหม"
- แก้โค้ดเสร็จให้ **รายงานตรง ๆ ว่า "ยังไม่ได้ทดสอบ"** และบอกคำสั่งที่ควรรัน (ผู้ใช้ตัดสินใจเอง) — ห้ามอ้างว่าผ่าน/ใช้ได้ถ้าไม่ได้รัน
- ผู้ใช้สั่งให้ทดสอบเมื่อไหร่ค่อยรัน — ใช้ skill `/run-checks` (ผู้ใช้เรียกเท่านั้น)
- ฟอร์แมตโค้ด (`gofmt -w`) ทำได้ เพราะไม่ใช่การทดสอบ

## Skills ของโปรเจกต์ (`.claude/skills/`)
| skill | ใช้เมื่อ |
|---|---|
| `balance-config` | ปรับค่าสมดุล/เพิ่มคีย์ config — ข้อมูลเกมอยู่ใน DB แยกหมวด ไม่ฝังในโค้ด |
| `js-go-parity` | แก้สูตรที่มีทั้ง JS และ Go ให้ตรงกัน (golden) |
| `db-migration` | เปลี่ยนสคีมา Postgres ตามแบบแผน |
| `run-checks` | **ผู้ใช้สั่งทดสอบเท่านั้น** — รัน gofmt/vet/go test/lab:test/typecheck แล้วสรุปผล |

## คำสั่ง (รันใน `web/`) — รันเมื่อผู้ใช้สั่งเท่านั้น
```bash
npm run lab:test                 # ทดสอบแกนหลัก (รันเมื่อผู้ใช้สั่ง)
npm run lab:docs                 # สร้าง docs/SKILL_TABLES.md + BENCHMARK_REPORT.md ใหม่
npm run lab:golden               # สร้าง golden test ของ Go (หลังแก้สูตร)
```
(ไม่มี build/dist — หน้าเว็บโหลดโมดูลจาก `web/public/skill-lab` ที่ sync จาก `web/lab/src/`)

**ข้อมูลเกมอยู่ในฐานข้อมูลทั้งหมด:** เบราว์เซอร์ไม่มีค่าเริ่มต้นฝังในโค้ด (รับจาก `/api/data`); ข้อมูลจริงอยู่ในตาราง `game_data_versions` (แก้ผ่านหน้าแอดมิน มีประวัติ/rollback); ไฟล์ `server/internal/gamedata/seed/game-data.json` เป็นแค่ **ข้อมูลตั้งต้นตอน bootstrap DB ว่าง + ฟิกซ์เจอร์ของเทสต์** (ไม่ใช่ที่ปรับสมดุล) และ Go ปฏิเสธข้อมูลที่ขาดค่า config (`gamedata/validate.go`)

## กฎโค้ดของ Skill Lab (สำคัญ)
1. แก้เฉพาะ `web/lab/src/*.js` และ `shell.html` — **ห้ามแก้ `web/public/skill-lab/` ตรง ๆ** (สร้างอัตโนมัติ)
2. ไม่ใช้ bundler/framework: vanilla JS, โมดูลเรียงตามเลขนำหน้า `NN-ชื่อ.js` ผูกกับ namespace `SL` ผ่าน IIFE
3. ชั้นเลขต่ำกว่า `06` (`00–05`: util, store, rules, stats, sim) **ห้ามแตะ DOM** และห้ามพึ่ง UI
4. เนื้อหาเกม (สกิล/คลาส/…): ใส่เป็น **ข้อมูลใน DB** (แก้ผ่านหน้าแก้ไขของแอดมิน; ถ้าเป็นของใหม่ที่ DB ใหม่/เทสต์ต้องมี ให้เพิ่มใน `server/internal/gamedata/seed/game-data.json` ด้วย) ไม่ฝังเงื่อนไขเฉพาะสกิลในโค้ด sim/stats — ถ้าต้องมีกลไกใหม่ให้เพิ่มเป็นฟิลด์ข้อมูล + รองรับใน `normalizeSkill`, `validate`, ฟอร์มใน `10-ui-skillform.js` และตัว sim
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
| ข้อมูลเกมจริง (สกิล/อาชีพ/สเตตัส/อาวุธ/มอนสเตอร์/formulaConfig/rules) | DB: อาชีพ·สาย·สกิล·อาวุธ·สเตตัส เป็น**ตารางเชิงสัมพันธ์รายรายการ** (`game_classes/branches/skills/weapons/stat_defs` + FK + `game_audit`); หมวดอื่น (balance/entities/world/tools) เป็นเอกสารเวอร์ชันใน `game_config_versions` — ดู `docs/DATABASE.md`; แก้ผ่านหน้าแอดมิน · `server/internal/gamedata/seed/game-data.json` = ข้อมูลตั้งต้นของ DB ว่าง/เทสต์เท่านั้น |
| กติกาเรียนสกิล / validator | `03-rules.js` |
| สูตรดาเมจ/สเตตัสสุดท้าย | `04-stats.js` |
| ตัวจำลองต่อสู้ / rotation / benchmark (ต้นฉบับ JS; ใช้จริงบนเซิร์ฟเวอร์ Go) | `05-sim.js` |
| เรียก API เซิร์ฟเวอร์ (SL.remote / SL.game / SL.remoteSim) | `05c-remote.js` |
| หน้า DPS (แซนด์บ็อกซ์ + ตัวจำลองบนเซิร์ฟเวอร์) | `08-ui-panels.js` `09-ui-sim.js` |
| กราฟต้นไม้สกิล (ค่าคงที่ NW NH PER ฯลฯ) | `07-ui-tree.js` |
| ฟอร์มแก้สกิล | `10-ui-skillform.js` · ตัวแก้ไขรวม `11-ui-editor.js` |
| หน้าข้อมูล/นำเข้า-ส่งออก | `12-ui-data.js` |
| routing / การแจ้งเตือน | `99-main.js` |
| สูตรสเตตัส (ชีตจากแต้มดิบ) | `web/lab/src/04-stats.js` (`computeDerivedFromRaw`) + `formulaConfig` ในข้อมูลเกม (เก็บใน DB ผ่าน `/api/data`) · Go: `server/internal/sim/calc.go` |

## หลังบ้าน (Go + Postgres) และหน้าเว็บ (Next.js)
- **หลักการ: เซิร์ฟเวอร์เป็นเจ้าของ (server-authoritative)** — โหมดเกม (`characters.mode=game`, ค่าเริ่มต้น) ไคลเอนต์ห้ามคำนวณ/แก้ EXP ทอง ไอเทม เลเวล สกิล สเตตัส อุปกรณ์ เอง: ส่งคำสั่งผ่าน `SL.game.*` (`/api/game/*`) แล้ว `SL.state.applyServer` ตัวละครที่ได้กลับมา; `state.change` ในโหมดเกมย้อนค่าที่เซิร์ฟเวอร์เป็นเจ้าของ; หน้า DPS ใช้ `SL.sandbox` + `/api/sim/*` เท่านั้น — เพิ่มกติกาใหม่ที่ `server/internal/progress` ไม่ใช่ใน JS
- โครงสร้าง: `server/cmd/gameserver` + `server/internal/{config,auth,store,gamedata,sim,progress,charsvc,game,protocol,realtime,httpapi}` + `server/migrations` — อ่าน `server/README.md` และ `docs/DATABASE.md` ก่อนแก้
- หลังบ้านเป็น Go ล้วน — **ห้ามเพิ่มเซิร์ฟเวอร์ Node/อื่น**; ข้อมูลเกมอยู่ใน Postgres (ตารางรายการ `game_skills` ฯลฯ + หมวดเอกสาร `game_config_versions`) ตัวละครอยู่ใน `characters.state`; **สูตรสกิล/สเตตัส/ต่อสู้เป็นโค้ด** (ไม่เก็บใน DB) อยู่ที่ `server/internal/sim`
- **JS ↔ Go ต้องตรงกัน:** `internal/sim` พอร์ตจาก `web/lab/src/03-rules.js 04-stats.js 05-sim.js` — แก้สูตรฝั่ง JS แล้วต้อง `node web/lab/tools/gen-golden.js` และแก้ Go ให้ `go test ./internal/sim` ผ่าน (golden test เทียบทุกบิต) — สองคำสั่งนี้รันเมื่อผู้ใช้สั่งเท่านั้น ถ้ายังไม่สั่งให้แจ้งว่ายังไม่ได้สร้าง/ทดสอบ (ดู skill `js-go-parity`)
- ตรวจฝั่ง Go (รันเมื่อผู้ใช้สั่งเท่านั้น — ดู `/run-checks`): `cd server && gofmt -l . && go vet ./... && go test ./...` (ตั้ง `TEST_DATABASE_URL` เพื่อรันเทสต์ที่ใช้ Postgres: ดู server/README.md) และ `govulncheck ./...` เมื่อแก้ dependency
- เปลี่ยนสคีมา = เพิ่มไฟล์ใหม่ใน `server/migrations` (ห้ามแก้ไฟล์เก่า) ปิดท้ายด้วย INSERT ลง schema_migrations
- โปรโตคอลไบนารี 0xC7 ต้องตรงกัน 3 ที่: `server/internal/protocol`, `web/lab/src/05b-net-codec.js`, `web/lib/codec.ts` (+ `docs/protocol/catquest_ro.fbs`; มี STATE_SYNC 0x24 / REWARD 0x25 ด้วย); decode ฝั่ง Go ต้องตรวจความยาวเฟรมเสมอ
- ความปลอดภัย: ห้ามเก็บ/ส่งรหัสผ่านหรือโทเคนดิบ (เซสชันเก็บเฉพาะแฮช), ทุก API ผูกกับเซสชัน ห้ามรับ id ผู้ใช้จากไคลเอนต์, อินพุตจากไคลเอนต์ต้องตรวจขอบเขต/ขนาด, การเขียนข้อมูลส่วนกลางต้อง admin
- `web/public/skill-lab/` สร้างอัตโนมัติจาก `web/lab/src` (`npm run sync:lab`, รันให้เองใน `npm run dev/build`) — **แก้ที่ web/lab/src เท่านั้น**; ถ้ารัน Next ด้วย `npx next dev` ตรง ๆ ต้องสั่ง sync เอง
- `server/internal/gamedata/seed/game-data.json` ใช้ 2 อย่างเท่านั้น: ใส่ให้ DB ที่ว่างตอนเริ่มครั้งแรก และเป็นฟิกซ์เจอร์ของเทสต์/เครื่องมือ JS (`web/lab/tools/lab-env.js`, golden test) — **ไม่มี endpoint รีเซ็ตกลับ seed แล้ว** ย้อนค่าด้วย rollback รายหมวดเอกสาร (`POST /api/data/rollback/{หมวด}/{id}`) หรือกู้รายรายการ (`POST /api/tables/{ตาราง}/{id}/restore/{auditId}`) ผ่านแผงประวัติในหน้าข้อมูล; ปรับสมดุลของระบบที่ใช้งานอยู่ทำผ่านหน้าแอดมินเท่านั้น (อย่าแก้ seed)
- stack: **gin** (HTTP) + **gorm** (DB, `ParameterizedQueries` เปิดไว้ กัน log รั่วแฮช) — ห้าม AutoMigrate ให้ใช้ไฟล์ migration
- Docker: Postgres ของโปรเจกต์นี้คือ container `catquest-db` พอร์ต **5433** — เครื่องนี้มี Postgres อื่น (`pg-main` พอร์ต 5432) ที่ไม่ใช่ของโปรเจกต์ ห้ามแตะ
- ตัวเรนเดอร์ตัวละคร/มอนสเตอร์ (`13-game-world.js`) ตรวจภาพได้ด้วย Playwright + `@napi-rs/canvas` (โหลดโมดูล 00–13 ใน Node แล้วเรียก `SL.rigRenderer.drawCharacter`)

## งานค้าง / ไอเดียถัดไป (ผู้ใช้ยังไม่ได้สั่ง — ถามก่อนทำ)
- สกิลโจร/นักธนู/จอมเวท (ใช้ `docs/design-notes/21-swordman-skill-design.md` เป็นแม่แบบ)
- ระบบยา/ฮีลในตัวจำลอง, หลายเป้าหมาย, stun/knockback ผ่าน `hooks`
- autospell ติดตัว (`autospellChance`) และ `castReduction` มีเป็นสเตตัสแล้วแต่ตัวจำลองยังไม่ใช้ (ยังไม่มีสเปล/cast time ของผู้เล่น)
- ประเด็น balance ที่ยังเปิด: Guardian DPS ต่ำ, Berserker ตายเมื่อมอนสเตอร์สวนกลับ, SP เป็นคอขวด (ดู `docs/BALANCE_NOTES.md` §4)
- ข้อต่างระหว่างสองแอป เช่น Berserker Soul +12 (Status) vs +9 (Skill) — ตัดสินใจว่าอะไรเป็นแหล่งความจริง

## ข้อควรระวัง
- ค่าเดียวที่ผู้ใช้แก้ในหน้าเว็บอยู่ใน localStorage (`roSkillLabData_v1`, `roSkillLabState_v1`, `roSkillLabSeeded_v1`; Status Lab: `roStatusLabConfig_v1`) — ถ้าแก้ defaults แล้วหน้าไม่เปลี่ยน ให้ใช้ปุ่ม "คืนค่าเริ่มต้น" หรือล้าง localStorage
- ความเร็วตี: `APS = 100/(200−ASPD)` (ไม่ใช่ ASPD/100) — ผู้ใช้เคยแก้จุดนี้แล้ว อย่าเปลี่ยนกลับ
- "Max ASPD" ที่ผู้ใช้หมายถึงคือ **เพดาน 193 แบบ RO** ไม่ใช่ปุ่มทุ่มแต้มสุดทาง
