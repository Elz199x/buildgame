# ฐานข้อมูล (PostgreSQL)

ใช้ Postgres 16 ผ่าน Docker (`docker-compose.yml`) — เซิร์ฟเวอร์ Go เชื่อมด้วย **gorm** (driver pgx, `DATABASE_URL`) — สคีมามาจากไฟล์ SQL migration เท่านั้น (gorm ไม่ทำ AutoMigrate)

```bash
docker compose up -d db          # container catquest-db  → 127.0.0.1:5433  (ผูกเฉพาะ localhost)
docker compose down              # หยุด (ข้อมูลอยู่ใน volume catquest_pgdata)
docker compose down -v           # หยุด + ลบข้อมูลทั้งหมด
docker exec -it catquest-db psql -U catquest -d catquest
```

พอร์ตฝั่งเครื่องคือ **5433** (ไม่ใช่ 5432) เพื่อไม่ชนกับ Postgres อื่นในเครื่อง

## อะไรอยู่ในฐานข้อมูล และทำไม

| ตาราง | เก็บอะไร | เหตุผล |
|---|---|---|
| `users` | ชื่อผู้ใช้, รหัสผ่าน (argon2id), role, สถานะปิดบัญชี | ต้องคงอยู่ + unique แบบไม่สนตัวพิมพ์ |
| `sessions` | SHA-256 ของโทเคนเซสชัน, หมดอายุ, IP, user-agent | เพิกถอนฝั่งเซิร์ฟเวอร์ได้ (logout / ปิดบัญชี) |
| `characters` | `class_id` (**int FK → `game_classes.id`**, `ON DELETE RESTRICT`), เลเวล/EXP/ทอง, ตำแหน่ง, `mode` (`game`/`lab`) + `state` JSONB | `state` เก็บเฉพาะส่วนที่ยังเป็นเอกสาร (สเตตัส อุปกรณ์ กระเป๋า คลัง ลำดับสกิล) — คีย์ที่ซ้ำกับคอลัมน์/ตารางลูก (`classId` `baseLv` `jobLv` `baseExp` `jobExp` `gold` `learned`) **ไม่เก็บใน jsonb**; โค้ดฝั่งเกมยังเห็น state เป็นก้อนเดียว (`store/characters.go`: `splitState` ตอนเขียน, `hydrateCharacter` ตอนอ่าน). ในโหมดเกมเซิร์ฟเวอร์เป็นผู้เขียนเพียงฝ่ายเดียว. `map_id` ไม่มี FK เพราะแผนที่อยู่ในเอกสาร `world` |
| `character_skills` | `character_id` (FK → characters, CASCADE) + `skill_id` (int FK → `game_skills.id`, CASCADE) + `lv` (≥ 1) | สกิลที่ตัวละครเรียน; ลบสกิลออกจากเกมจะลบแถวที่เรียนไว้ตาม |
| `game_config_versions` | หมวด**เอกสาร** 4 หมวด แถวละ 1 เวอร์ชันของ 1 หมวด (`category`, `data jsonb`, `note`, `created_by`, `created_at`) | **balance** = version/formulaConfig/globals/rules · **entities** = monsters/equipItems/elementSystem · **world** = worldMap · **tools** = presets/builds/modelSlots. เวอร์ชันที่ใช้งานของหมวด = แถวที่ id มากที่สุดของหมวด; แก้ = แถวใหม่เฉพาะหมวดที่เปลี่ยน → ย้อนรายหมวดได้ (เก็บ 50 ล่าสุดต่อหมวด); แก้พร้อมกันตรวจด้วย `If-Match` (409) |
| `game_classes` · `game_branches` · `game_skills` · `game_weapons` · `game_stat_defs` | ตาราง**คอลัมน์จริง** หนึ่งแถวต่อหนึ่งรายการ: `id integer` (รันอัตโนมัติ, PK) + `code` (รหัสข้อความที่เกม/API ใช้ เช่น `swordman`, UNIQUE) + ฟิลด์เป็นคอลัมน์ทั้งหมด + `sort` + `version` + `updated_by/at` | FK ทั้งหมดชี้ด้วย `id` (int): `parent_id`, `class_id`, `branch_id`, `weapon_class_id`; ไม่เก็บ id ซ้ำใน jsonb. **skills**: ค่าเดี่ยวเป็นคอลัมน์ (`weapon_slot_type`, `trigger_hp_below` ฯลฯ), สายสกิลบังคับให้เป็นของอาชีพเดียวกับสกิลด้วย FK แบบรวม `(branch_id, class_id)`, เงื่อนไขสกิลก่อนหน้าเป็น `game_skill_requires` (FK + `lv`), ชนิดอาวุธที่ต้อง/ห้ามใช้เป็น `game_skill_weapon_rules` (FK → `game_weapon_classes`), เหลือ jsonb เฉพาะสูตรซ้อน `usage/damage/heal/effects/hooks`. API ยังส่ง/รับ JSON รูปเดิม (`id` = `code`, `class`/`parent`/`branch`/`weaponClass` = code) แปลงที่ `store/gametables.go`; ฟิลด์ที่ไม่รู้จักถูกปฏิเสธ (400). `version` ต่อแถวใช้เป็น `If-Match` |
| `game_weapon_classes` | `id` + `code` (ชนิดอาวุธ เช่น `sword`, `bow`) | เกิดจาก `game_weapons.weapon_class` เอง (ไม่มี API แยก) และถูกลบเมื่อไม่มีอาวุธ/สกิลอ้างถึงแล้ว; สกิลอ้างได้เฉพาะชนิดที่มีอยู่ → พิมพ์ชนิดอาวุธผิดจะถูกปฏิเสธ (409) |
| `game_audit` | ประวัติทุกการแก้ของตารางรายการ: `entity`, `entity_id`, `action` (create/update/delete), `before`, `after`, `note`, `created_by`, `created_at` | ย้อน/กู้รายรายการ (`POST /api/tables/{ตาราง}/{id}/restore/{auditId}`) แม้รายการถูกลบไปแล้ว | `entity_id` เป็น code ไม่ใช่ FK โดยตั้งใจ (ประวัติต้องอยู่ต่อหลังลบรายการ)
| `chat_messages` | ประวัติแชท (`channel` CHECK 0–3) | แสดงย้อนหลังให้ผู้เข้าใหม่; ล้างที่เก่ากว่า 30 วันอัตโนมัติ |
| `schema_migrations` | เวอร์ชัน migration ที่รันแล้ว | |

**ไม่เก็บใน DB:** ตัวจำลองสกิล/สเตตัส (เป็นการคำนวณ ไม่ใช่ข้อมูล → อยู่ในโค้ด Go `internal/sim`), session จำลองต่อสู้ของหน้า DPS (หน่วยความจำ), สถานะโลกเกมชั่วขณะ (ตำแหน่งมอนสเตอร์/HP ผู้เล่นระหว่างเล่น → หน่วยความจำของลูปเกม), เซสชัน WebSocket

การบันทึกตัวละครที่ออนไลน์: ทุก 3 วินาทีเมื่อมีการเปลี่ยนแปลง (dirty flag) + ตอนหลุดการเชื่อมต่อ + ตอนปิดเซิร์ฟเวอร์ — ส่วนคำสั่ง `/api/game/*` บันทึกทันที

## Migration

- ไฟล์ SQL อยู่ที่ `server/migrations/NNNN_ชื่อ.sql` เรียงตามชื่อ — ฝังในไบนารี เซิร์ฟเวอร์รันไฟล์ที่ยังไม่เคยรันตอนเริ่ม (ใน transaction, มี advisory lock กันรันซ้อนจากหลายอินสแตนซ์)
- docker-compose เมานต์โฟลเดอร์เดียวกันเข้า `/docker-entrypoint-initdb.d` — สคีมาจึงพร้อมตั้งแต่ครั้งแรกที่สร้าง container; ทุกไฟล์บันทึกตัวเองลง `schema_migrations` ท้ายไฟล์ เซิร์ฟเวอร์จึงข้ามที่รันไปแล้ว
- เพิ่มการเปลี่ยนแปลงสคีมา = สร้างไฟล์ใหม่ (เช่น `0002_xxx.sql`) ห้ามแก้ไฟล์ที่ปล่อยไปแล้ว; ไฟล์ต้องเป็น SQL ล้วนที่ `psql` รันได้ และปิดท้ายด้วย
  `INSERT INTO schema_migrations (version) VALUES ('0002_xxx') ON CONFLICT DO NOTHING;`

## ข้อมูลเกมตั้งต้น (seed — เฉพาะ bootstrap)

ตารางว่างตอนเริ่มครั้งแรก → เซิร์ฟเวอร์ใส่ข้อมูลตั้งต้นที่ฝังในไบนารี (`server/internal/gamedata/seed/game-data.json`)
ไฟล์ `server/internal/gamedata/seed/game-data.json` ใช้ใส่ข้อมูลเริ่มต้นเฉพาะตอนที่ตารางว่าง และเป็นฟิกซ์เจอร์ของเทสต์ — **ไม่ใช่ที่ปรับสมดุล** (ข้อมูลที่ใช้งานจริงคือแถวล่าสุดของ `game_data_versions`; แก้ผ่านหน้าแอดมิน) ไม่มี endpoint รีเซ็ตกลับ seed: ย้อนด้วย `POST /api/data/rollback/{หมวด}/{id}` เซิร์ฟเวอร์ตรวจว่ามีค่า config ครบทุกค่า (`gamedata/validate.go`) ไม่มีค่า fallback ในโค้ด — ข้อมูลเวอร์ชันเก่าที่ขาดคีย์ใหม่จะ rollback ไม่ได้

## สำรองข้อมูล

```bash
docker exec catquest-db pg_dump -U catquest -Fc catquest > backup.dump
docker exec -i catquest-db pg_restore -U catquest -d catquest --clean < backup.dump
```
