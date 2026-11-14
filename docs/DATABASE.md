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
| `characters` | คอลัมน์ที่ใช้ค้นหา/จัดอันดับ (คลาส เลเวล EXP ทอง ตำแหน่ง) + `mode` (`game`/`lab`) + `state` JSONB | state คือสถานะทั้งก้อน (สกิลที่เรียน สเตตัส อุปกรณ์ กระเป๋า คลัง ลำดับสกิล) — **ในโหมดเกมเซิร์ฟเวอร์เป็นผู้เขียนเพียงฝ่ายเดียว** (EXP/ทอง/ไอเทมเปลี่ยนจากคำสั่งเกมและรางวัลล้มมอนสเตอร์เท่านั้น) โครงสร้างเปลี่ยนบ่อยตามเกม จึงเก็บเป็นเอกสาร |
| `game_config_versions` | ข้อมูลเกมแยกเป็น 5 หมวด แถวละ 1 เวอร์ชันของ 1 หมวด (`category`, `data jsonb`, `note`, `created_by`, `created_at`) | **balance** = formulaConfig/globals/rules · **content** = classes/branches/skills/weapons/statDefs/version · **entities** = monsters/equipItems/elementSystem · **world** = worldMap · **tools** = presets/builds/modelSlots. เวอร์ชันที่ใช้งานของหมวด = แถวที่ id มากที่สุดของหมวด; แก้ = แถวใหม่เฉพาะหมวดที่เปลี่ยน → ย้อนรายหมวดได้ ไม่ทับกันข้ามหมวด (เก็บ 50 ล่าสุดต่อหมวด) · ตัวเอกสารเต็มประกอบจากทุกหมวดแล้วตรวจก่อนบันทึกเสมอ (อ้างอิงข้ามหมวด เช่น `rules` → ไอเทม) ในทรานแซกชันเดียวภายใต้ advisory lock · แก้พร้อมกันตรวจด้วย `If-Match` (409) |
| `game_data_versions` | _(เลิกใช้ตั้งแต่ migration 0003)_ ตารางเดิมแบบก้อนเดียว | เก็บไว้เป็นประวัติ/ทางถอย — เวอร์ชันล่าสุดถูกย้ายเข้า `game_config_versions` แล้ว จะลบใน migration ถัดไป |
| `chat_messages` | ประวัติแชท | แสดงย้อนหลังให้ผู้เข้าใหม่; ล้างที่เก่ากว่า 30 วันอัตโนมัติ |
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
