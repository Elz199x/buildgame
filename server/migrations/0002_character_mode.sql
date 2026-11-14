-- 0002 : โหมดตัวละคร
--   game = เซิร์ฟเวอร์เป็นเจ้าของความก้าวหน้า (EXP/ทอง/ไอเทม/เลเวล/สกิล/สเตตัส) — ค่าเริ่มต้นของผู้เล่นทุกคน
--   lab  = โหมดทดลอง แก้สถานะอิสระได้ (เฉพาะ admin เปิดให้ตัวเองได้)
ALTER TABLE characters ADD COLUMN mode text NOT NULL DEFAULT 'game' CHECK (mode IN ('game', 'lab'));

INSERT INTO schema_migrations (version) VALUES ('0002_character_mode') ON CONFLICT DO NOTHING;
