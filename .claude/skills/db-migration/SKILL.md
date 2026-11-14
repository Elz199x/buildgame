---
name: db-migration
description: เปลี่ยนสคีมา Postgres ของโปรเจกต์ (เพิ่ม/แก้ตาราง คอลัมน์ ดัชนี หรือหมวดข้อมูลเกม) ให้ปลอดภัยตามแบบแผน — migration ใหม่เสมอ ห้ามแก้ไฟล์เก่า (use when changing the database schema)
---

# db-migration — เปลี่ยนสคีมาฐานข้อมูล

## กฎ (จาก `CLAUDE.md`)
- เปลี่ยนสคีมา = **เพิ่มไฟล์ใหม่** ใน `server/migrations/` เลขถัดไป (`NNNN_ชื่อ.sql`) — **ห้ามแก้ไฟล์เก่า**
- ปิดท้ายไฟล์ด้วย
  ```sql
  INSERT INTO schema_migrations (version) VALUES ('NNNN_ชื่อ') ON CONFLICT DO NOTHING;
  ```
  ชื่อ `version` ต้องตรงกับชื่อไฟล์ (ไม่รวม `.sql`) — เซิร์ฟเวอร์รัน migration ที่ยังไม่เคยรันตอนเริ่มทำงาน (ล็อกกันรันซ้อน) และ `docker compose` ใช้โฟลเดอร์นี้ตอนสร้าง DB ครั้งแรก
- ห้ามใช้ gorm AutoMigrate

## แนวปฏิบัติ
1. **ทำให้ย้อนได้/ไม่ทำลายข้อมูล:** เพิ่มก่อน ย้ายข้อมูล แล้วค่อยเลิกใช้ของเก่าใน migration ถัดไป (ตัวอย่าง: `0003_game_config.sql` ย้ายข้อมูลจาก `game_data_versions` แต่ยังเก็บตารางเดิมไว้)
2. ใส่ `CHECK`/`NOT NULL`/`REFERENCES` ที่ระดับ DB เสมอ ไม่พึ่งแค่โค้ด
3. ย้ายข้อมูลด้วย SQL ใน migration เดียวกัน และกันรันซ้ำ (`WHERE NOT EXISTS ...`)
4. ตารางใหม่ที่มีเวอร์ชัน/ประวัติ: ใส่ดัชนีที่ตรงกับ query จริง
5. อัปเดต `docs/DATABASE.md` (ตาราง/คอลัมน์/เหตุผล) และ `server/README.md` ถ้า API เปลี่ยน
6. **เพิ่มหมวดเอกสารใหม่** (`gamedata.Categories`): migration ที่แก้ `CHECK (category IN (...))` ของ `game_config_versions` + ย้ายคีย์ที่เกี่ยวข้อง · **เพิ่มตารางรายการใหม่** (`gamedata.Tables`): สร้างตาราง `game_*` (id, sort, FK, `data jsonb`, `version`, `updated_by/at` + `CHECK (data->>'id' = id)`), เพิ่มชื่อใน `CHECK` ของ `game_audit.entity`, และเพิ่มชื่อตารางใน `sqlTable`/`fkColumns` ที่ `server/internal/store/gamedata.go`
7. migration ต้องรันได้ทั้งใน Go (ทรานแซกชันเดียว) และ `psql` ตอน `docker compose` สร้าง DB (autocommit ต่อคำสั่ง) — **ห้ามใช้ `CREATE TEMP TABLE ... ON COMMIT DROP`**, FK ที่ต้องย้ายข้อมูลวนกันใช้ `DEFERRABLE INITIALLY DEFERRED`

## ก่อนรัน migration กับ DB จริง
- DB dev ของโปรเจกต์คือ container `catquest-db` พอร์ต **5433** — ห้ามแตะ `pg-main` (พอร์ต 5432) ที่ไม่ใช่ของโปรเจกต์
- migration ที่แก้/ลบข้อมูลเดิมให้ถามผู้ใช้ก่อน
- การรันเทสต์ (`go test ./internal/store`) ทำเฉพาะเมื่อผู้ใช้สั่ง
