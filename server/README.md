# Cat Quest × RO — Go Game Server

เซิร์ฟเวอร์ตัวเดียว (Go + **gin** + **gorm**) ทำทั้ง **REST API** (บัญชีผู้ใช้ / ข้อมูลเกม / ตัวละคร / คำสั่งความก้าวหน้า / ตัวจำลอง), **WebSocket เกมออนไลน์ 30Hz (authoritative)** และเก็บข้อมูลใน **PostgreSQL** — เซิร์ฟเวอร์เป็นเจ้าของ EXP/ทอง/ดรอป/เลเวล/สกิล/สเตตัส/อุปกรณ์/ร้านค้า/คลัง/เลื่อนอาชีพทั้งหมด

## เริ่มใช้งาน

ต้องมี Go 1.26+ และ Docker

```bash
# 1) ฐานข้อมูล (จากโฟลเดอร์รากของโปรเจกต์) — schema ถูกสร้างให้อัตโนมัติ
docker compose up -d db

# 2) เซิร์ฟเวอร์เกม
cd server
go run ./cmd/gameserver          # http://127.0.0.1:8080  ws://127.0.0.1:8080/ws

# หรือรันทั้งคู่ใน Docker
docker compose --profile app up -d --build
```

ผู้ใช้คนแรกที่สมัครจะได้เป็น `admin` (แก้ข้อมูลเกมส่วนกลางได้) — ปิดได้ด้วย `FIRST_USER_IS_ADMIN=false`

```bash
go test ./...                    # เทสต์ทั้งหมด (เทสต์ที่ใช้ Postgres จะถูกข้ามถ้าไม่ตั้ง TEST_DATABASE_URL)
TEST_DATABASE_URL="postgres://catquest:catquest_dev_password@127.0.0.1:5433/catquest?sslmode=disable" go test ./...
```

เทสต์แต่ละชุดสร้างฐานข้อมูลชั่วคราวของตัวเองแล้วลบทิ้ง จึงไม่แตะข้อมูลจริง

## ตัวแปรสภาพแวดล้อม

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|---|---|---|
| `DATABASE_URL` | dev: `postgres://catquest:…@127.0.0.1:5433/catquest` | Postgres (production ต้องตั้งเอง) |
| `LISTEN_ADDR` | `127.0.0.1:8080` | ที่อยู่ที่ฟัง (ใน container ใช้ `0.0.0.0:8080`) |
| `ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | โดเมนเว็บที่เรียก API/WebSocket ได้ |
| `APP_ENV` | `development` | `production` = เข้มงวด (บังคับ `DATABASE_URL`, `ALLOWED_ORIGINS`, `COOKIE_SECURE`) และ log เป็น JSON |
| `COOKIE_SECURE` | `false` (production: `true`) | ต้องเป็น `true` เมื่อเว็บใช้ HTTPS |
| `FIRST_USER_IS_ADMIN` | `true` (production: `false`) | ผู้ใช้คนแรกเป็น admin |
| `SESSION_DAYS` | `14` | อายุเซสชัน (ต่ออายุเรื่อย ๆ เมื่อใช้งาน) |
| `MAX_CLIENTS` | `200` | จำนวน WebSocket สูงสุด |
| `TRUST_PROXY` | `false` | เชื่อ `X-Forwarded-For` (เปิดเมื่ออยู่หลัง reverse proxy ที่ควบคุมเองเท่านั้น) |
| `DB_WAIT_SECONDS` | `30` | รอฐานข้อมูลพร้อมตอนเริ่ม |

## โครงสร้างโค้ด

```
server/
├─ cmd/gameserver/        main: โหลด config → ต่อ DB → migrate → เริ่ม HTTP + ลูปเกม → ปิดเครื่องอย่างนุ่มนวล
├─ internal/
│  ├─ config/             อ่าน/ตรวจตัวแปรสภาพแวดล้อม
│  ├─ auth/               argon2id, โทเคนเซสชัน (เก็บเฉพาะแฮช), ตรวจอินพุต, จำกัดอัตรา
│  ├─ store/              ชั้นฐานข้อมูล (gorm + pgx): users, sessions, characters, game data, chat + ตัวรัน migration (สคีมามาจาก SQL migration เท่านั้น ไม่ใช้ AutoMigrate)
│  ├─ gamedata/           ชนิดข้อมูลเกม + parse/validate JSON (ข้อมูลตั้งต้นฝังในไบนารี)
│  ├─ sim/                ตัวจำลองสกิล/สเตตัส/ต่อสู้ (พอร์ตจาก JS — ตรวจด้วย golden tests)
│  ├─ progress/           กติกาความก้าวหน้าแบบฟังก์ชันล้วนบน sim.State: เรียน/ลืมสกิล ทุ่มสเตตัส สวมใส่ ร้านค้า คลัง เลื่อนอาชีพ ใช้ไอเทม รางวัลล้มมอนสเตอร์
│  ├─ charsvc/            โหลด/แก้ตัวละครแบบอะตอมมิก (ออนไลน์ → ใน world lock, ออฟไลน์ → ธุรกรรม DB)
│  ├─ game/               โลกเกม: ผู้เล่น มอนสเตอร์ AI วงแดง การต่อสู้ รางวัล (ใช้ sim + progress)
│  ├─ protocol/           เข้ารหัส/ถอดรหัสเฟรมไบนารี 0xC7
│  ├─ realtime/           WebSocket hub, ลูป 30Hz
│  └─ httpapi/            REST บน gin + middleware (CORS, CSRF, security headers, log, recover)
└─ migrations/            SQL สร้าง/อัปเกรดสคีมา (ฝังในไบนารี และเมานต์เข้า container ฐานข้อมูล)
```

กฎการพึ่งพา: `httpapi → charsvc → realtime → game → progress → sim → gamedata`; `store` ไม่รู้จักชั้นบน; `protocol`/`gamedata`/`sim` ไม่แตะเครือข่ายหรือฐานข้อมูล

## บัญชีผู้ใช้และความปลอดภัย

- **สมัคร/เข้า/ออกจากระบบ:** `POST /api/auth/register|login|logout`, `GET /api/auth/me`
- รหัสผ่านแฮชด้วย **argon2id** (m=64MiB, t=3, p=2) แฮชเก่าถูกอัปเกรดเงียบ ๆ ตอนล็อกอิน; ตอบข้อความเดียวกันทั้ง "ไม่มีผู้ใช้"/"รหัสผิด" และใช้เวลาเท่ากัน (กันเดาชื่อผู้ใช้)
- เซสชัน = โทเคนสุ่ม 256 บิตใน cookie `HttpOnly; SameSite=Lax` (`Secure` ใน production) ฐานข้อมูลเก็บเฉพาะ SHA-256 ของโทเคน; ออกจากระบบ = ลบเซสชันฝั่งเซิร์ฟเวอร์ + ตัดการเชื่อมต่อเกม; สร้างเซสชันใหม่ทุกครั้งที่ล็อกอิน
- กันเดารหัสผ่าน: จำกัดอัตราต่อ IP และต่อชื่อผู้ใช้; สมัครจำกัดต่อ IP; งาน argon2 และตัวจำลองมีคิวจำกัดจำนวนพร้อมกัน
- CSRF: ตรวจ `Origin` ของคำขอที่เปลี่ยนสถานะ + cookie SameSite=Lax; WebSocket ตรวจ `Origin` และต้องมีเซสชัน; 1 บัญชี = 1 การเชื่อมต่อ (ล็อกอินใหม่เตะเครื่องเก่า)
- สิทธิ์: `player` / `admin` — แก้ข้อมูลเกมส่วนกลางได้เฉพาะ admin; ทุก API ผูกกับเซสชัน ไม่รับ id ผู้ใช้จากไคลเอนต์ (กัน IDOR)
- ข้อมูลที่ไคลเอนต์ส่ง (state ตัวละคร, เฟรม WebSocket) ถูกตรวจขอบเขต/ขนาดเสมอ; เซิร์ฟเวอร์ตัดสิน ระยะโจมตี คูลดาวน์ ความเร็วเดิน ดาเมจ i-frame

## REST API

ทั้งหมดต้องล็อกอิน (cookie) ยกเว้น `health`, `register`, `login`, `logout`

| Method | Path | หน้าที่ |
|---|---|---|
| GET | `/api/health` | สถานะ + ตรวจฐานข้อมูล (สาธารณะ) |
| POST | `/api/auth/register` `/login` `/logout` · GET `/api/auth/me` | บัญชีผู้ใช้ |
| GET | `/api/data` | ข้อมูลเกมทั้งชุด (ETag = แฮชเนื้อหา) + `_meta` (เวอร์ชันของแต่ละหมวด/แถว, คีย์, ลำดับพึ่งพา) |
| PUT | `/api/data/{หมวด}?note=…` 🛡️ | แก้หมวดเอกสาร (balance/entities/world/tools) — ต้องส่ง `If-Match: <id เวอร์ชันของหมวด>` (ไม่ส่ง = 428, ไม่ตรง = 409) → ตรวจความสอดคล้องกับส่วนอื่น → เวอร์ชันใหม่เฉพาะหมวด + โลกเกมโหลดทันที |
| PUT | `/api/tables/{ตาราง}/{id}?note=…` 🛡️ | สร้าง/แก้ทีละรายการของ classes/branches/skills/weapons/stats — แก้ส่ง `If-Match: <เวอร์ชันแถว>`, สร้างส่ง `If-None-Match: *`; ผิด FK/ซ้ำ/ชน = 409 |
| DELETE | `/api/tables/{ตาราง}/{id}` 🛡️ | ลบรายการ (ส่ง `If-Match`); ถ้ายังถูกอ้างอิง = 409 |
| GET / POST | `/api/tables/{ตาราง}/{id}/history` · `/restore/{auditId}` 🛡️ | ประวัติการแก้ของรายการ / กู้รายการไปสถานะตามบรรทัดประวัติ |
| PUT | `/api/data?note=…` 🛡️ | นำเข้าเอกสารทั้งชุด — เขียนเฉพาะส่วนที่ต่าง และ**ลบ**รายการของตารางที่หายไปจากเอกสาร (ไม่ตรวจ If-Match; สำหรับสคริปต์/นำเข้า) |
| GET | `/api/data/versions?category=…` 🛡️ | ประวัติเวอร์ชัน (เก็บ 50 ล่าสุดต่อหมวด) |
| POST | `/api/data/rollback/{หมวด}/{id}` 🛡️ | ย้อนหมวดไปเวอร์ชันที่เลือก (สร้างเป็นเวอร์ชันใหม่ ไม่ลบประวัติ; ตรวจความสอดคล้องกับหมวดอื่นก่อน) |
| GET | `/api/characters/me` | ตัวละครของบัญชี (+`mode`) + state (ตัวละครใหม่ = Lv.1 ทอง 100) |
| PUT | `/api/characters/me/state` | บันทึก state ทั้งก้อน — **โหมด lab เท่านั้น** (โหมดเกมตอบ 403; ≤256KB) |
| PUT | `/api/characters/me/prefs` | ค่าที่ปรับเองได้ทุกโหมด: ลำดับสกิล/ตัวเลือกจำลอง/มอนสเตอร์เป้าหมาย |
| POST | `/api/characters/me/mode` 🛡️ | สลับตัวละครตัวเองเป็น `game` / `lab` |
| POST | `/api/game/learn` `unlearn` `stat` `equip` `unequip` `weapon` `shield` `storage` `shop` `class` | **คำสั่งความก้าวหน้า** — ตรวจกติกา (422 ถ้าผิดกติกา) แล้วตอบ `{state}` ใหม่; ผู้เล่นออนไลน์จะถูกแก้ใน world ทันที |
| POST | `/api/sim/stats` | สเตตัสสุดท้ายจากสูตรของเซิร์ฟเวอร์ |
| POST | `/api/sim/benchmark` | จำลองต่อสู้ N วินาที (≤300) |
| POST | `/api/sim/builds` | เปรียบเทียบบิลด์สำเร็จรูปทั้งหมด |
| POST | `/api/sim/skills` | ตารางดาเมจต่อสกิลที่เรียนไว้ |
| POST | `/api/sim/rotation` | ลำดับสกิลอัตโนมัติ |
| POST | `/api/sim/sessions` · `/sessions/{id}/advance` · DELETE `/sessions/{id}` | การต่อสู้จำลองแบบต่อเนื่องของหน้า DPS (อยู่ในหน่วยความจำ ≤3 ต่อผู้ใช้ หมดอายุเมื่อเงียบ 10 นาที; ไคลเอนต์ส่ง `dt`/`casts`/state แซนด์บ็อกซ์ แล้วได้ `view`+`events`+`summary`) |
| GET | `/api/players` · `/api/chat/recent` | ผู้เล่นออนไลน์ / ประวัติแชท |
| GET | `/ws` | WebSocket เกมออนไลน์ (ต้องมีเซสชัน) |

🛡️ = admin เท่านั้น

## WebSocket (`/ws`, ไบนารี 0xC7 Little-Endian)

สเปกเฟรม: `internal/protocol/protocol.go` และ `docs/protocol/catquest_ro.fbs`

| Op | ทิศทาง | เนื้อหา |
|---|---|---|
| `0x01` PING / `0x02` PONG | ↔ | วัด ping + tick |
| `0x04` WELCOME | S→C | `uid` ของผู้เล่น (ส่งทันทีหลังเชื่อมต่อ) |
| `0x10` MOVE `0x11` ATTACK `0x12` SKILL `0x13` ROLL `0x14` USE_ITEM | C→S | คำสั่งผู้เล่น (SKILL ใช้ลำดับสกิลใน `skills[]`) |
| `0x20` WORLD_SNAPSHOT | S→C | ผู้เล่น+มอนสเตอร์ทั้งโลก 15Hz |
| `0x21` DAMAGE_EVENT | S→C | ผลโจมตีทุกครั้ง (ทั้งสองทิศทาง) |
| `0x22` TELEGRAPH | S→C | วงแดงเตือนก่อนมอนสเตอร์ปล่อยท่า |
| `0x23` PLAYER_STATE | S→เจ้าของ | HP/SP จริง + บัฟที่ติดอยู่ (5Hz) |
| `0x24` STATE_SYNC | S→เจ้าของ | ตัวละครทั้งก้อน (JSON) หลังมีการเปลี่ยนแปลง (ใช้ไอเทม/รางวัล/คำสั่ง) |
| `0x25` REWARD | S→เจ้าของ | EXP/ทอง/ไอเทมที่ได้จากการล้มมอนสเตอร์ + ธง level up |
| `0x30` CHAT | ↔ | แชท (เซิร์ฟเวอร์ใส่ชื่อตัวละครเอง และบันทึกลงฐานข้อมูล) |

## ตัวจำลอง (`internal/sim`)

พอร์ตจาก `web/lab/src/03-rules.js`, `04-stats.js`, `05-sim.js` ผลต้องตรงกับ JS ทุกบิต — ตรวจด้วยชุดทดสอบ golden ที่รันตัวจำลอง JS จริง
(`node web/lab/tools/gen-golden.js` สร้าง `internal/sim/testdata/golden.json`: 165 การจำลองเต็ม 60/90 วินาที, สเตตัส 1,200 ชุด, กฎสกิลทุกบิลด์)
ถ้าแก้สูตรฝั่ง JS ให้รัน gen-golden ใหม่แล้วแก้ Go ให้ตรง — เทสต์จะบอกว่าต่างตรงไหน

## ความก้าวหน้าแบบ server-authoritative

- ตัวละครมี `mode`: **game** (ค่าเริ่มต้น เซิร์ฟเวอร์ตัดสินทุกอย่าง) หรือ **lab** (admin เท่านั้น แก้ state อิสระเพื่อออกแบบ/ทดสอบ)
- ล้มมอนสเตอร์ → `game.rewardKill` คิด EXP/ทอง/ดรอป (auto-loot) ตามข้อมูลมอนสเตอร์ → ส่ง REWARD + STATE_SYNC ให้เจ้าของ; บันทึกลง DB เมื่อมีการเปลี่ยนแปลง (ทุก 3 วินาที), ตอนหลุด, และตอนปิดเซิร์ฟเวอร์
- คำสั่ง `/api/game/*` ผ่าน `charsvc.Mutate`: ออนไลน์ → แก้ใน world (ภายใต้ล็อก) + บันทึกทันที; ออฟไลน์ → ธุรกรรม `SELECT … FOR UPDATE`
- การเดินมีงบความเร็ว (token bucket) กัน speedhack; ใช้ไอเทมหักจำนวนที่เซิร์ฟเวอร์
- state ตัวละครเป็น `sim.State` (ฟิลด์ที่เซิร์ฟเวอร์รู้จัก + `Extra` เก็บฟิลด์อื่นของไคลเอนต์ไว้ไม่ให้หาย)

## ข้อจำกัดที่ควรรู้

- **โหมด Lab:** เลเวล/สกิล/สเตตัสของตัวละครกำหนดจากไคลเอนต์ได้อิสระ (เป็นเครื่องมือออกแบบ — admin เท่านั้น)
- มีแมพเดียว (`map_prontera`) และตัวละครหนึ่งตัวต่อบัญชี (สคีมารองรับหลายตัวละคร)
- ไม่มีการเทรด/ปาร์ตี้/กิลด์; ยังไม่มีการกู้รหัสผ่าน/ยืนยันอีเมล
