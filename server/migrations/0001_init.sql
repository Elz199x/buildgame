-- 0001_init : สคีมาเริ่มต้นของ Cat Quest × RO
-- รันได้ทั้งโดย docker-entrypoint-initdb.d (ครั้งแรกที่สร้าง container) และโดยตัวรัน migration ของเซิร์ฟเวอร์ (idempotent)
-- ไฟล์นี้ต้องเป็น SQL ล้วนที่ psql รันได้ (ไม่มีเทมเพลต) และบันทึกตัวเองลง schema_migrations ท้ายไฟล์

CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text        PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

-- ผู้ใช้ / การยืนยันตัวตน -----------------------------------------------------------------
CREATE TABLE users (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text        NOT NULL CHECK (username ~ '^[A-Za-z0-9_]{3,20}$'),
    password_hash text        NOT NULL,                        -- argon2id (PHC string)
    role          text        NOT NULL DEFAULT 'player' CHECK (role IN ('player', 'admin')),
    disabled      boolean     NOT NULL DEFAULT false,
    created_at    timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz
);
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

-- เซสชันแบบ opaque token: เก็บเฉพาะ SHA-256 ของ token (token ดิบอยู่ใน cookie ฝั่งผู้ใช้เท่านั้น)
CREATE TABLE sessions (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash   bytea       NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    ip           inet,
    user_agent   text        NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user_idx    ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ตัวละคร -------------------------------------------------------------------------------
-- คอลัมน์ที่ใช้ค้นหา/จัดอันดับแยกเป็นคอลัมน์จริง; state คือสถานะทั้งหมดจากหน้าเว็บ
-- (สกิลที่เรียน สเตตัส อุปกรณ์ กระเป๋า คลัง ลำดับสกิลอัตโนมัติ ฯลฯ) เก็บเป็น JSONB
CREATE TABLE characters (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name       text        NOT NULL CHECK (char_length(name) BETWEEN 2 AND 24),
    class_id   text        NOT NULL DEFAULT 'novice',
    base_lv    integer     NOT NULL DEFAULT 1 CHECK (base_lv BETWEEN 1 AND 99),
    job_lv     integer     NOT NULL DEFAULT 1 CHECK (job_lv  BETWEEN 1 AND 99),
    base_exp   bigint      NOT NULL DEFAULT 0 CHECK (base_exp >= 0),
    job_exp    bigint      NOT NULL DEFAULT 0 CHECK (job_exp  >= 0),
    gold       bigint      NOT NULL DEFAULT 0 CHECK (gold     >= 0),
    map_id     text        NOT NULL DEFAULT 'map_prontera',
    pos_x      real        NOT NULL DEFAULT 520,
    pos_y      real        NOT NULL DEFAULT 850,
    state      jsonb       NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(state) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX characters_name_lower_idx ON characters (lower(name));
CREATE INDEX        characters_user_idx       ON characters (user_id);

-- ข้อมูลเกม (นิยามคลาส/สกิล/อาวุธ/มอนสเตอร์/แมพ/สูตร) แบบมีเวอร์ชัน --------------------------
-- เวอร์ชันที่ใช้งาน = แถวที่ id มากที่สุด; การแก้ไขสร้างแถวใหม่เสมอ จึงย้อนกลับได้
CREATE TABLE game_data_versions (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    data       jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    note       text        NOT NULL DEFAULT '',
    created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ประวัติแชท -----------------------------------------------------------------------------
CREATE TABLE chat_messages (
    id           bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    channel      smallint    NOT NULL DEFAULT 0,
    character_id uuid        REFERENCES characters (id) ON DELETE SET NULL,
    sender       text        NOT NULL,
    body         text        NOT NULL CHECK (char_length(body) <= 200),
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_created_idx ON chat_messages (created_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0001_init') ON CONFLICT DO NOTHING;
