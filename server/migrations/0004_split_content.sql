-- 0004 : แยกหมวด content (48KB ส่วนใหญ่คือ skills) เป็น 3 หมวดตามจังหวะการแก้
--   skills  = skills                         (แก้บ่อยที่สุด โตต่อเนื่อง)
--   classes = classes, branches, weapons     (โครงของอาชีพ แทบนิ่ง)
--   stats   = statDefs, version              (รายการสเตตัสที่สูตรทุกตัวอ้างถึง — แก้แยกอย่างระวัง)
-- ย้ายทุกเวอร์ชันเดิมของ content (คงผู้บันทึก/เวลา/หมายเหตุ/ลำดับ) แล้วลบแถว content เดิม — ชื่อหมวดต้องตรงกับ gamedata.Categories
ALTER TABLE game_config_versions DROP CONSTRAINT game_config_versions_category_check;

INSERT INTO game_config_versions (category, data, note, created_by, created_at)
SELECT c.category,
       COALESCE((SELECT jsonb_object_agg(e.key, e.value) FROM jsonb_each(v.data) AS e WHERE e.key = ANY (c.keys)), '{}'::jsonb),
       v.note, v.created_by, v.created_at
FROM game_config_versions v
CROSS JOIN (VALUES
    ('skills',  ARRAY['skills']),
    ('classes', ARRAY['classes', 'branches', 'weapons']),
    ('stats',   ARRAY['statDefs', 'version'])
) AS c(category, keys)
WHERE v.category = 'content'
ORDER BY v.id, c.category;

DELETE FROM game_config_versions WHERE category = 'content';

ALTER TABLE game_config_versions ADD CONSTRAINT game_config_versions_category_check
    CHECK (category IN ('balance', 'skills', 'classes', 'stats', 'entities', 'world', 'tools'));

INSERT INTO schema_migrations (version) VALUES ('0004_split_content') ON CONFLICT DO NOTHING;
