-- 0004 : อาชีพ / สายสกิล / สกิล / อาวุธ / นิยามสเตตัส เป็นตารางเชิงสัมพันธ์ (หนึ่งแถวต่อหนึ่งรายการ)
--
--   • ทุกตารางมี id = int รันอัตโนมัติ (PK) และ code = รหัสข้อความที่เกม/API ใช้อ้าง (เช่น 'swordman', 'swBash') — UNIQUE
--     ไม่มีการเก็บ id ซ้ำใน jsonb; FOREIGN KEY ทั้งหมดชี้ด้วย id (int)
--   • ทุกฟิลด์ที่เป็นค่าเดี่ยวเป็นคอลัมน์จริง; รายการลูก (เงื่อนไขสกิลก่อนหน้า) เป็นตารางลูก game_skill_requires;
--     เหลือ jsonb เฉพาะส่วนที่เป็นสูตร/โครงสร้างซ้อนที่รูปทรงต่างกันตามสกิล (usage, damage, heal, effects, hooks)
--   • version ต่อแถว = optimistic concurrency (If-Match) — แก้คนละรายการพร้อมกันไม่ชนกัน
--   • game_audit = ประวัติทุกการแก้ (ก่อน/หลัง/ใคร/เมื่อไหร่) → ย้อนรายรายการได้ (เก็บรายการในรูป JSON ของ API, entity_id = code)
--   • sort = ลำดับแสดงผล (คงลำดับเดิมของเอกสาร)
--   • ตัวละครอ้างอาชีพ/สกิลด้วย FK จริง: characters.class_id (int) และตาราง character_skills — state jsonb เก็บเฉพาะส่วนที่ยังเป็นเอกสาร
-- หมวดที่เหลือ (balance/entities/world/tools) ยังเป็นเอกสารเวอร์ชันใน game_config_versions

CREATE TABLE game_classes (
    id                integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code              text        NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 64),
    sort              integer     NOT NULL,
    parent_id         integer     REFERENCES game_classes (id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED
                                  CHECK (parent_id IS DISTINCT FROM id),
    name              text        NOT NULL,
    description       text        NOT NULL DEFAULT '',
    job_lv_cap        integer     NOT NULL,
    points_per_job_lv integer     NOT NULL,
    version           bigint      NOT NULL DEFAULT 1,
    updated_by        uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_branches (
    id         integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       text        NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 64),
    sort       integer     NOT NULL,
    class_id   integer     NOT NULL REFERENCES game_classes (id) ON DELETE RESTRICT,
    name       text        NOT NULL,
    version    bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, class_id)  -- ให้ game_skills อ้าง (branch_id, class_id) เพื่อบังคับว่าสายต้องเป็นของอาชีพเดียวกับสกิล
);
CREATE INDEX game_branches_class ON game_branches (class_id);

-- ชนิดอาวุธ (unarmed, sword, bow …) — เกมจัดการเอง: เกิดจาก game_weapons.weapon_class และถูกลบเมื่อไม่มีใครอ้างแล้ว
CREATE TABLE game_weapon_classes (
    id   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text    NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 64)
);

CREATE TABLE game_skills (
    id                 integer          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code               text             NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 64),
    sort               integer          NOT NULL,
    class_id           integer          NOT NULL REFERENCES game_classes (id) ON DELETE RESTRICT,
    branch_id          integer,
    name               text             NOT NULL,
    description        text             NOT NULL DEFAULT '',
    skill_type         text             NOT NULL CHECK (skill_type IN ('passive', 'active', 'buff', 'toggle', 'trigger')),
    tier               integer          NOT NULL DEFAULT 0,
    job_lv_req         integer          NOT NULL DEFAULT 0,
    max_level          integer          NOT NULL DEFAULT 1,
    need_shield        boolean          NOT NULL DEFAULT false,
    -- เงื่อนไขอาวุธ (weaponReq): ค่าว่าง = ไม่จำกัด; รายชนิดอาวุธที่ต้อง/ห้ามใช้อยู่ใน game_skill_weapon_rules
    weapon_slot_type   text             NOT NULL DEFAULT '',
    weapon_damage_type text             NOT NULL DEFAULT '',
    effect_group       text             NOT NULL DEFAULT '',
    -- trigger: ทั้งสามค่า NULL = สกิลนี้ไม่มี trigger; toggle_off_hp_below NULL = ไม่มี toggleOff
    trigger_hp_below   double precision,
    trigger_hp_above   double precision,
    trigger_cooldown   double precision,
    toggle_off_hp_below double precision,
    -- สูตร/โครงสร้างซ้อนที่รูปทรงต่างกันตามสกิล (ค่าที่เป็นตัวเลขหรือ {base, step}, รายการ effect ฯลฯ)
    usage              jsonb            NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(usage) = 'object'),
    damage             jsonb            NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(damage) = 'object'),
    heal               jsonb            CHECK (jsonb_typeof(heal) = 'object'),
    effects            jsonb            NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(effects) = 'array'),
    hooks              jsonb            NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(hooks) = 'object'),
    version            bigint           NOT NULL DEFAULT 1,
    updated_by         uuid             REFERENCES users (id) ON DELETE SET NULL,
    updated_at         timestamptz      NOT NULL DEFAULT now(),
    CHECK ((trigger_hp_below IS NULL) = (trigger_cooldown IS NULL)),
    -- สายสกิลต้องเป็นของอาชีพเดียวกับสกิล (branch_id เป็น NULL = ไม่อยู่สายใด ไม่ตรวจ)
    FOREIGN KEY (branch_id, class_id) REFERENCES game_branches (id, class_id) ON DELETE RESTRICT
);
CREATE INDEX game_skills_class ON game_skills (class_id);
CREATE INDEX game_skills_branch ON game_skills (branch_id);

-- ชนิดอาวุธที่สกิลต้องใช้ (include) หรือห้ามใช้ (exclude); ชนิดเดียวเป็นได้อย่างเดียวต่อสกิล
CREATE TABLE game_skill_weapon_rules (
    skill_id        integer NOT NULL REFERENCES game_skills (id) ON DELETE CASCADE,
    weapon_class_id integer NOT NULL REFERENCES game_weapon_classes (id) ON DELETE RESTRICT,
    mode            text    NOT NULL CHECK (mode IN ('include', 'exclude')),
    PRIMARY KEY (skill_id, weapon_class_id)
);
CREATE INDEX game_skill_weapon_rules_class ON game_skill_weapon_rules (weapon_class_id);

-- สกิลต้องเรียนสกิลอื่นถึงเลเวลหนึ่งก่อน (requires) — ตรวจความมีอยู่ที่ commit (DEFERRABLE) เพื่อให้ลบ/สร้างหลายสกิลพร้อมกันได้
CREATE TABLE game_skill_requires (
    skill_id          integer NOT NULL REFERENCES game_skills (id) ON DELETE CASCADE,
    requires_skill_id integer NOT NULL REFERENCES game_skills (id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    lv                integer NOT NULL CHECK (lv >= 1),
    pos               integer NOT NULL,
    PRIMARY KEY (skill_id, requires_skill_id),
    CHECK (skill_id <> requires_skill_id)
);
CREATE INDEX game_skill_requires_target ON game_skill_requires (requires_skill_id);

CREATE TABLE game_weapons (
    id           integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code         text        NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 64),
    sort         integer     NOT NULL,
    name         text        NOT NULL,
    slot_type    text        NOT NULL,
    damage_type  text        NOT NULL,
    weapon_class_id integer  NOT NULL REFERENCES game_weapon_classes (id) ON DELETE RESTRICT,
    version      bigint      NOT NULL DEFAULT 1,
    updated_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_stat_defs (
    id         integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       text        NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 64),
    sort       integer     NOT NULL,
    name       text        NOT NULL,
    stat_group text        NOT NULL DEFAULT '',
    kind       text        NOT NULL CHECK (kind IN ('num', 'pct', 'frac')),
    version    bigint      NOT NULL DEFAULT 1,
    updated_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE game_audit (
    id         bigint      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity     text        NOT NULL CHECK (entity IN ('classes', 'branches', 'skills', 'weapons', 'stats')),
    entity_id  text        NOT NULL,
    action     text        NOT NULL CHECK (action IN ('create', 'update', 'delete')),
    before     jsonb,
    after      jsonb,
    note       text        NOT NULL DEFAULT '' CHECK (char_length(note) <= 200),
    created_by uuid        REFERENCES users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_audit_entity ON game_audit (entity, entity_id, id DESC);
COMMENT ON COLUMN game_audit.entity_id IS 'code ของรายการ (ไม่ใช่ FK โดยตั้งใจ — ประวัติต้องอยู่ต่อแม้รายการถูกลบ)';

-- ---------- ย้ายข้อมูลจากหมวด content เดิม (เวอร์ชันล่าสุด) เข้าตาราง ----------
INSERT INTO game_classes (code, sort, name, description, job_lv_cap, points_per_job_lv)
SELECT e.item ->> 'id', e.n::int, e.item ->> 'name', COALESCE(e.item ->> 'desc', ''),
       (e.item ->> 'jobLvCap')::int, (e.item ->> 'pointsPerJobLv')::int
FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c, jsonb_array_elements(c.data -> 'classes') WITH ORDINALITY AS e(item, n);

-- parent_id ใส่ทีหลัง (ต้องมีแถวพ่อก่อน)
UPDATE game_classes k SET parent_id = p.id
FROM (SELECT e.item FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c,
             jsonb_array_elements(c.data -> 'classes') AS e(item)) AS s
JOIN game_classes p ON p.code = NULLIF(s.item ->> 'parent', '')
WHERE k.code = s.item ->> 'id';

INSERT INTO game_branches (code, sort, class_id, name)
SELECT e.item ->> 'id', e.n::int, (SELECT k.id FROM game_classes k WHERE k.code = e.item ->> 'class'), e.item ->> 'name'
FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c, jsonb_array_elements(c.data -> 'branches') WITH ORDINALITY AS e(item, n);

INSERT INTO game_skills (code, sort, class_id, branch_id, name, description, skill_type, tier, job_lv_req, max_level, need_shield,
                         weapon_slot_type, weapon_damage_type, effect_group,
                         trigger_hp_below, trigger_hp_above, trigger_cooldown, toggle_off_hp_below,
                         usage, damage, heal, effects, hooks)
SELECT e.item ->> 'id', e.n::int,
       (SELECT k.id FROM game_classes k WHERE k.code = e.item ->> 'class'),
       (SELECT b.id FROM game_branches b WHERE b.code = NULLIF(e.item ->> 'branch', '')),
       e.item ->> 'name', COALESCE(e.item ->> 'desc', ''), e.item ->> 'type',
       COALESCE((e.item ->> 'tier')::int, 0), COALESCE((e.item ->> 'jobLvReq')::int, 0), COALESCE((e.item ->> 'maxLevel')::int, 1),
       COALESCE((e.item ->> 'needShield')::boolean, false),
       COALESCE(e.item -> 'weaponReq' ->> 'slotType', ''), COALESCE(e.item -> 'weaponReq' ->> 'damageType', ''),
       COALESCE(e.item ->> 'group', ''),
       (e.item -> 'trigger' ->> 'hpBelow')::float8, (e.item -> 'trigger' ->> 'hpAbove')::float8, (e.item -> 'trigger' ->> 'cooldown')::float8,
       (e.item -> 'toggleOff' ->> 'hpBelow')::float8,
       COALESCE(e.item -> 'usage', '{}'::jsonb), COALESCE(e.item -> 'damage', '{}'::jsonb), NULLIF(e.item -> 'heal', 'null'::jsonb),
       COALESCE(e.item -> 'effects', '[]'::jsonb), COALESCE(e.item -> 'hooks', '{}'::jsonb)
FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c, jsonb_array_elements(c.data -> 'skills') WITH ORDINALITY AS e(item, n);

INSERT INTO game_skill_requires (skill_id, requires_skill_id, lv, pos)
SELECT s.id, t.id, (r.item ->> 'lv')::int, r.n::int
FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c
CROSS JOIN LATERAL jsonb_array_elements(c.data -> 'skills') AS e(item)
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(e.item -> 'requires', '[]'::jsonb)) WITH ORDINALITY AS r(item, n)
JOIN game_skills s ON s.code = e.item ->> 'id'
JOIN game_skills t ON t.code = r.item ->> 'id';

INSERT INTO game_weapon_classes (code)
SELECT DISTINCT x.code FROM (
    SELECT e.item ->> 'weaponClass' AS code
    FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c, jsonb_array_elements(c.data -> 'weapons') AS e(item)
    UNION
    SELECT w.value
    FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c
    CROSS JOIN LATERAL jsonb_array_elements(c.data -> 'skills') AS e(item)
    CROSS JOIN LATERAL (VALUES ('include'), ('exclude')) AS m(mode)
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.item -> 'weaponReq' -> m.mode, '[]'::jsonb)) AS w(value)
) AS x WHERE x.code IS NOT NULL AND x.code <> '';

INSERT INTO game_weapons (code, sort, name, slot_type, damage_type, weapon_class_id)
SELECT e.item ->> 'id', e.n::int, e.item ->> 'name', e.item ->> 'slotType', e.item ->> 'damageType',
       (SELECT wc.id FROM game_weapon_classes wc WHERE wc.code = e.item ->> 'weaponClass')
FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c, jsonb_array_elements(c.data -> 'weapons') WITH ORDINALITY AS e(item, n);

INSERT INTO game_skill_weapon_rules (skill_id, weapon_class_id, mode)
SELECT DISTINCT ON (s.id, wc.id) s.id, wc.id, m.mode
FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c
CROSS JOIN LATERAL jsonb_array_elements(c.data -> 'skills') AS e(item)
CROSS JOIN LATERAL (VALUES ('include'), ('exclude')) AS m(mode)
CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(e.item -> 'weaponReq' -> m.mode, '[]'::jsonb)) AS w(value)
JOIN game_skills s ON s.code = e.item ->> 'id'
JOIN game_weapon_classes wc ON wc.code = w.value
ORDER BY s.id, wc.id, m.mode;

INSERT INTO game_stat_defs (code, sort, name, stat_group, kind)
SELECT e.item ->> 'id', e.n::int, e.item ->> 'name', COALESCE(e.item ->> 'group', ''), e.item ->> 'kind'
FROM (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c, jsonb_array_elements(c.data -> 'statDefs') WITH ORDINALITY AS e(item, n);

-- ---------- ตัวละคร: class_id เป็น int FK, สกิลที่เรียนเป็นตารางลูก, state jsonb เก็บเฉพาะส่วนที่เหลือ ----------
ALTER TABLE characters ADD COLUMN class_ref integer REFERENCES game_classes (id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
UPDATE characters ch SET class_ref = COALESCE(
    (SELECT k.id FROM game_classes k WHERE k.code = ch.class_id),
    (SELECT k.id FROM game_classes k WHERE k.parent_id IS NULL ORDER BY k.sort LIMIT 1));
ALTER TABLE characters DROP COLUMN class_id;
ALTER TABLE characters RENAME COLUMN class_ref TO class_id;
-- ฐานข้อมูลใหม่ไม่มีตัวละคร จึงตั้ง NOT NULL ได้; ถ้ามีตัวละครแต่ไม่มีอาชีพเลย migration นี้ล้มโดยตั้งใจ
ALTER TABLE characters ALTER COLUMN class_id SET NOT NULL;
CREATE INDEX characters_class_idx ON characters (class_id);

CREATE TABLE character_skills (
    character_id uuid    NOT NULL REFERENCES characters (id) ON DELETE CASCADE,
    skill_id     integer NOT NULL REFERENCES game_skills (id) ON DELETE CASCADE,
    lv           integer NOT NULL CHECK (lv >= 1),
    PRIMARY KEY (character_id, skill_id)
);
CREATE INDEX character_skills_skill ON character_skills (skill_id);

-- ย้ายสกิลที่เรียนออกจาก state (สกิลที่ไม่มีในเกมแล้วถูกทิ้ง) และเอาค่าที่ซ้ำกับคอลัมน์ออกจาก state
INSERT INTO character_skills (character_id, skill_id, lv)
SELECT ch.id, s.id, round(l.value::numeric)::int
FROM characters ch
CROSS JOIN LATERAL jsonb_each_text(CASE WHEN jsonb_typeof(ch.state -> 'learned') = 'object' THEN ch.state -> 'learned' ELSE '{}'::jsonb END) AS l(key, value)
JOIN game_skills s ON s.code = l.key
WHERE CASE WHEN l.value ~ '^[0-9]+(\.[0-9]+)?$' THEN round(l.value::numeric) ELSE 0 END >= 1;
UPDATE characters SET state = state - 'learned' - 'classId' - 'baseLv' - 'jobLv' - 'baseExp' - 'jobExp' - 'gold';

-- ช่องแชทที่เซิร์ฟเวอร์รับ = 0..3
ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_channel_check CHECK (channel BETWEEN 0 AND 3);

COMMENT ON COLUMN characters.map_id IS 'id แผนที่ใน worldMap (หมวด world เป็นเอกสาร jsonb จึงไม่มี FK)';

-- ตารางเดิมที่เลิกใช้ตั้งแต่ 0003 (ประวัติถูกย้ายไป game_config_versions แล้ว)
DROP TABLE game_data_versions;

-- คีย์ version (เวอร์ชันสคีมาของเอกสาร) ย้ายไปอยู่กับหมวด balance
INSERT INTO game_config_versions (category, data, note)
SELECT 'balance', b.data || jsonb_build_object('version', c.data -> 'version'), 'migrated: ย้ายคีย์ version จาก content'
FROM (SELECT data FROM game_config_versions WHERE category = 'balance' ORDER BY id DESC LIMIT 1) AS b, (SELECT data FROM game_config_versions WHERE category = 'content' ORDER BY id DESC LIMIT 1) AS c
WHERE jsonb_exists(c.data, 'version');

-- เลิกใช้หมวด content (ตาราง game_data_versions เดิมถูกลบด้านบนแล้ว)
DELETE FROM game_config_versions WHERE category = 'content';
ALTER TABLE game_config_versions DROP CONSTRAINT game_config_versions_category_check;
ALTER TABLE game_config_versions ADD CONSTRAINT game_config_versions_category_check
    CHECK (category IN ('balance', 'entities', 'world', 'tools'));

INSERT INTO schema_migrations (version) VALUES ('0004_game_tables') ON CONFLICT DO NOTHING;
