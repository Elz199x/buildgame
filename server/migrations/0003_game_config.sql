-- 0003 : ข้อมูลเกมแยกเป็นหมวด (แทนการเก็บเป็นก้อนเดียวใน game_data_versions)
--
--   • หนึ่งแถว = หนึ่งเวอร์ชันของหนึ่งหมวด; เวอร์ชันที่ใช้งานของหมวด = แถวที่ id มากที่สุดของหมวดนั้น
--   • แก้หมวดไหนเขียนเฉพาะหมวดนั้น → ย้อนกลับรายหมวดได้ ไม่ทับกันข้ามหมวด และมีประวัติ "ใครแก้อะไร"
--   • หมวดที่อ้างอิงกัน (เช่น rules ชี้ไปที่ไอเทม) ถูกตรวจรวมทุกครั้งก่อนบันทึก (ฝั่งเซิร์ฟเวอร์, ในทรานแซกชันเดียว)
--   • ชื่อหมวดต้องตรงกับ gamedata.Categories (ชุดปิด — เพิ่มหมวดต้องมี migration)
CREATE TABLE game_config_versions (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    category   text        NOT NULL CHECK (category IN ('balance', 'content', 'entities', 'world', 'tools')),
    data       jsonb       NOT NULL CHECK (jsonb_typeof(data) = 'object'),
    note       text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
    created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- หาเวอร์ชันล่าสุดของแต่ละหมวด / ไล่ประวัติของหมวด
CREATE INDEX game_config_versions_category_id ON game_config_versions (category, id DESC);

-- ย้ายข้อมูลจากตารางเดิม (เฉพาะเวอร์ชันล่าสุด) เข้าหมวดต่าง ๆ — ประวัติเก่ายังอยู่ใน game_data_versions
INSERT INTO game_config_versions (category, data, note)
SELECT c.category,
       COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(g.data) AS e WHERE e.key = ANY (c.keys)), '{}'::jsonb),
       'migrated from game_data_versions #' || g.id
FROM (SELECT id, data FROM game_data_versions ORDER BY id DESC LIMIT 1) AS g
CROSS JOIN (VALUES
    ('balance',  ARRAY['formulaConfig', 'globals', 'rules']),
    ('content',  ARRAY['version', 'classes', 'branches', 'skills', 'weapons', 'statDefs']),
    ('entities', ARRAY['monsters', 'equipItems', 'elementSystem']),
    ('world',    ARRAY['worldMap']),
    ('tools',    ARRAY['presets', 'builds', 'modelSlots'])
) AS c(category, keys)
WHERE NOT EXISTS (SELECT 1 FROM game_config_versions);

COMMENT ON TABLE game_data_versions IS 'DEPRECATED: แทนที่ด้วย game_config_versions (0003) — เก็บไว้เป็นประวัติ/ทางถอย จะลบใน migration ถัดไป';

INSERT INTO schema_migrations (version) VALUES ('0003_game_config') ON CONFLICT DO NOTHING;
