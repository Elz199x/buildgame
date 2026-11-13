---
name: balance-config
description: ปรับค่า config/สมดุลเกม หรือเพิ่มคีย์ config ใหม่ (formulaConfig, globals, rules, สกิล, มอนสเตอร์, ไอเทม) ให้ถูกที่ — ข้อมูลเกมอยู่ใน DB แยกหมวด ไม่ใช่ในโค้ด/seed (use when changing game balance, config values, or adding a config key)
---

# balance-config — แก้ค่าเกมให้ถูกที่

## หลักการ
- **ข้อมูลเกมจริงอยู่ใน Postgres** ตาราง `game_config_versions` แยก 5 หมวด (`server/internal/gamedata/categories.go`)

  | หมวด | คีย์ |
  |---|---|
  | `balance` | `formulaConfig`, `globals`, `rules` |
  | `content` | `version`, `classes`, `branches`, `skills`, `weapons`, `statDefs` |
  | `entities` | `monsters`, `equipItems`, `elementSystem` |
  | `world` | `worldMap` |
  | `tools` | `presets`, `builds`, `modelSlots` |
- **ห้ามฝังตัวเลขกติกา/บาลานซ์ในโค้ด** (ไม่มี fallback) — ค่าที่ขาดต้องทำให้ `gamedata/validate.go` ปฏิเสธข้อมูล
- ขีดจำกัดวิศวกรรม/กันโกง (ความเร็วสูงสุด, ขนาดคำขอ ฯลฯ) อยู่ในโค้ดได้ — ดูรายการใน `docs/DATA_SCHEMA.md` หัวข้อ `rules`

## A) ปรับค่าที่มีอยู่แล้ว
1. แก้ผ่านหน้าแอดมินในเว็บ (บันทึกอัตโนมัติรายหมวดด้วย `PUT /api/data/{หมวด}` + `If-Match`) หรือเรียก API ตรง ๆ ด้วยบัญชีแอดมิน
2. ได้เวอร์ชันใหม่เฉพาะหมวดนั้น ใช้ทันที ไม่ต้อง build/รีสตาร์ต; ย้อนด้วย `POST /api/data/rollback/{หมวด}/{id}`
3. **อย่าแก้ `server/internal/gamedata/seed/game-data.json` เพื่อปรับระบบที่ใช้งานอยู่** — seed มีผลกับ DB ว่าง/เทสต์เท่านั้น

## B) เพิ่มคีย์ config ใหม่
1. เพิ่มฟิลด์ใน struct ที่ `server/internal/gamedata/types.go` (มี `json` tag; ต้องเป็นค่าที่ **ต้องมี** ไม่ใช่ทางเลือก)
2. `validate.go` อ่านรายชื่อคีย์จาก struct อัตโนมัติ → ข้อมูลที่ขาดคีย์จะถูกปฏิเสธ (เพิ่มการตรวจความสมเหตุสมผลเองถ้าจำเป็น เช่น ชี้ไอเทมที่มีจริง)
3. ใส่ค่าลงใน seed (`game-data.json`) เพื่อให้ DB ใหม่/เทสต์มี
4. **DB ที่ใช้งานอยู่ต้องได้ค่าใหม่ด้วย** — เพิ่มเวอร์ชันใหม่ของหมวดนั้นใน DB (ผ่าน `PUT /api/data/{หมวด}` หรือ SQL) ไม่เช่นนั้นเซิร์ฟเวอร์จะไม่ยอมเริ่มทำงานเพราะข้อมูลขาดคีย์
5. ฝั่งเบราว์เซอร์อ่านผ่าน `SL.store.get().<คีย์>` เท่านั้น (ไม่ใส่ค่าเริ่มต้นในโค้ด JS)
6. ถ้าค่านั้นเข้าสูตรที่ JS และ Go ใช้ร่วมกัน → ทำตาม skill `js-go-parity`
7. อัปเดต `docs/DATA_SCHEMA.md`

## C) เพิ่มคีย์ระดับบนสุดใหม่ (หมวดข้อมูลใหม่)
เพิ่มลงใน `Categories` ที่ `categories.go` (คีย์เข้าหมวดที่มีอยู่) — การเพิ่ม**หมวด**ใหม่ต้องมี migration ใหม่ที่แก้ `CHECK` ของ `game_config_versions` (ดู skill `db-migration`)

## ข้อควรระวัง
- หมวดอ้างอิงกัน (`rules.starterItems` → ไอเทม, `classCoefs` ต้องครบทุกคลาส) — เซิร์ฟเวอร์ตรวจรวมทุกหมวดก่อนบันทึกเสมอ
- การรันเทสต์/golden: ทำเฉพาะเมื่อผู้ใช้สั่ง (กฎใน `CLAUDE.md`) — จบงานให้บอกว่าควรรันอะไร
