package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"sort"

	"gorm.io/gorm"
)

// ตารางรายการของเกม (classes/branches/skills/weapons/stats) เป็นคอลัมน์จริงทั้งหมด:
// id = int รันอัตโนมัติ, code = รหัสข้อความที่เกม/API ใช้ (เช่น 'swordman')
// ฝั่ง API ยังเห็นเป็นรายการ JSON รูปเดิม {id: <code>, ...} — แปลงไป-กลับที่ไฟล์นี้ที่เดียว
// ลำดับฟิลด์ใน struct = ลำดับคีย์ JSON คงที่; ส่วนที่เป็น jsonb ใน DB ถูกจัดคีย์เรียงตัวอักษรเพื่อให้เทียบ "ข้อมูลเหมือนเดิมไหม" ได้แม่น

type typedRow struct {
	Code    string
	Data    []byte // JSON ของรายการในรูป canonical
	Version int64
}

type typedTable interface {
	// read อ่านทุกแถว (เรียงตาม sort) หรือเฉพาะ code ที่ระบุ (lock = FOR UPDATE)
	read(tx *gorm.DB, code string, lock bool) ([]typedRow, error)
	// canon ตรวจ/จัดรูปรายการ JSON ที่รับมา (ฟิลด์ที่ไม่รู้จัก = error) ให้เป็นรูป canonical
	canon(code string, raw []byte) ([]byte, error)
	// write บันทึกรายการ canonical (exists = มีแถวอยู่แล้ว → UPDATE และเพิ่ม version)
	write(tx *gorm.DB, canon []byte, exists bool, by any) error
	remove(tx *gorm.DB, code string) error
}

var typedTables = map[string]typedTable{
	"classes":  classTable{},
	"branches": branchTable{},
	"skills":   skillTable{},
	"weapons":  weaponTable{},
	"stats":    statTable{},
}

// CanonItem ตรวจรายการของตารางตามโครงสร้างคอลัมน์ (ฟิลด์ที่ไม่รู้จัก/ชนิดผิด/ค่านอกเซต = error) แล้วคืน JSON รูป canonical
// code ว่าง = ใช้ id ในข้อมูลเอง
func CanonItem(table, code string, raw []byte) ([]byte, error) {
	t, ok := typedTables[table]
	if !ok {
		return nil, fmt.Errorf("ไม่มีตาราง %q", table)
	}
	return t.canon(code, raw)
}

// ---------- ตัวช่วยร่วม ----------

func strictDecode(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("มีข้อมูลเกินท้ายออบเจ็กต์")
	}
	return nil
}

// fixCode ให้ id ในข้อมูลตรงกับ code ที่ระบุ (ถ้าระบุ) และอยู่ในช่วงที่ตารางรับได้
func fixCode(id *string, want string) error {
	if want != "" && *id != want {
		return fmt.Errorf("id ในข้อมูล (%s) ไม่ตรงกับ id ที่ระบุ (%s)", *id, want)
	}
	if *id == "" || len(*id) > 64 {
		return errors.New("ต้องมี id (ไม่เกิน 64 ตัวอักษร)")
	}
	return nil
}

// normJSON จัดคีย์ของ JSON ให้เรียงตัวอักษร (ผลคงที่) ; ว่าง/null → def ("" = null)
func normJSON(raw json.RawMessage, def string) (json.RawMessage, error) {
	t := bytes.TrimSpace(raw)
	if len(t) == 0 || string(t) == "null" {
		if def == "" {
			return nil, nil
		}
		return json.RawMessage(def), nil
	}
	dec := json.NewDecoder(bytes.NewReader(t))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, err
	}
	return json.Marshal(v)
}

// jsonKind ตรวจว่า JSON เป็นออบเจ็กต์ ('{') หรืออาเรย์ ('[') ตามที่คอลัมน์ต้องการ
func jsonKind(raw json.RawMessage, first byte, field string) error {
	if len(raw) == 0 || raw[0] != first {
		return fmt.Errorf("%s ต้องเป็น %s", field, map[byte]string{'{': "ออบเจ็กต์", '[': "อาเรย์"}[first])
	}
	return nil
}

func lookupID(tx *gorm.DB, table, code, what string) (int64, error) {
	var ids []int64
	if err := tx.Raw(`SELECT id FROM `+table+` WHERE code = ?`, code).Scan(&ids).Error; err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, fmt.Errorf("%w: %s %q ไม่มี", ErrRefIntegrity, what, code)
	}
	return ids[0], nil
}

// readRows รัน SELECT ฐาน (alias = ตัวย่อของตารางหลัก, ต้องมีคอลัมน์ code/sort/id) แล้วแปลงแต่ละแถวเป็น typedRow
func readRows[T any](tx *gorm.DB, base, alias, code string, lock bool, conv func(*T) (typedRow, error)) ([]typedRow, error) {
	q := base
	var args []any
	if code != "" {
		q += ` WHERE ` + alias + `.code = ?`
		args = append(args, code)
	}
	q += ` ORDER BY ` + alias + `.sort, ` + alias + `.id`
	if lock && code != "" {
		q += ` FOR UPDATE OF ` + alias
	}
	var recs []T
	if err := tx.Raw(q, args...).Scan(&recs).Error; err != nil {
		return nil, err
	}
	rows := make([]typedRow, len(recs))
	for i := range recs {
		r, err := conv(&recs[i])
		if err != nil {
			return nil, err
		}
		rows[i] = r
	}
	return rows, nil
}

func marshalRow(code string, version int64, v any) (typedRow, error) {
	b, err := json.Marshal(v)
	return typedRow{Code: code, Data: b, Version: version}, err
}

// ---------- classes ----------

type classRec struct {
	Code           string `json:"id" gorm:"column:code"`
	Name           string `json:"name" gorm:"column:name"`
	Parent         string `json:"parent" gorm:"column:parent"` // code ของอาชีพพ่อ ("" = ไม่มี)
	JobLvCap       int    `json:"jobLvCap" gorm:"column:job_lv_cap"`
	PointsPerJobLv int    `json:"pointsPerJobLv" gorm:"column:points_per_job_lv"`
	Desc           string `json:"desc" gorm:"column:description"`
	Version        int64  `json:"-" gorm:"column:version"`
}

type classTable struct{}

const classSelect = `SELECT c.code, c.name, COALESCE((SELECT p.code FROM game_classes p WHERE p.id = c.parent_id), '') AS parent,
	c.job_lv_cap, c.points_per_job_lv, c.description, c.version FROM game_classes c`

func (classTable) read(tx *gorm.DB, code string, lock bool) ([]typedRow, error) {
	return readRows(tx, classSelect, "c", code, lock, func(r *classRec) (typedRow, error) { return marshalRow(r.Code, r.Version, r) })
}

func (classTable) canon(code string, raw []byte) ([]byte, error) {
	var r classRec
	if err := strictDecode(raw, &r); err != nil {
		return nil, fmt.Errorf("อาชีพไม่ถูกต้อง: %w", err)
	}
	if err := fixCode(&r.Code, code); err != nil {
		return nil, err
	}
	if r.Parent == r.Code {
		return nil, errors.New("อาชีพเป็นพ่อของตัวเองไม่ได้")
	}
	return json.Marshal(r)
}

func (classTable) write(tx *gorm.DB, canon []byte, exists bool, by any) error {
	var r classRec
	if err := json.Unmarshal(canon, &r); err != nil {
		return err
	}
	var parentID *int64
	if r.Parent != "" {
		id, err := lookupID(tx, "game_classes", r.Parent, "อาชีพพ่อ")
		if err != nil {
			return err
		}
		parentID = &id
	}
	if !exists {
		return tx.Exec(`INSERT INTO game_classes (code, sort, parent_id, name, description, job_lv_cap, points_per_job_lv, updated_by)
			VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM game_classes), ?, ?, ?, ?, ?, ?::uuid)`,
			r.Code, parentID, r.Name, r.Desc, r.JobLvCap, r.PointsPerJobLv, by).Error
	}
	return tx.Exec(`UPDATE game_classes SET parent_id = ?, name = ?, description = ?, job_lv_cap = ?, points_per_job_lv = ?,
		version = version + 1, updated_by = ?::uuid, updated_at = now() WHERE code = ?`,
		parentID, r.Name, r.Desc, r.JobLvCap, r.PointsPerJobLv, by, r.Code).Error
}

func (classTable) remove(tx *gorm.DB, code string) error {
	return tx.Exec(`DELETE FROM game_classes WHERE code = ?`, code).Error
}

// ---------- branches ----------

type branchRec struct {
	Code    string `json:"id" gorm:"column:code"`
	Class   string `json:"class" gorm:"column:class"` // code ของอาชีพ
	Name    string `json:"name" gorm:"column:name"`
	Version int64  `json:"-" gorm:"column:version"`
}

type branchTable struct{}

const branchSelect = `SELECT b.code, k.code AS class, b.name, b.version FROM game_branches b JOIN game_classes k ON k.id = b.class_id`

func (branchTable) read(tx *gorm.DB, code string, lock bool) ([]typedRow, error) {
	return readRows(tx, branchSelect, "b", code, lock, func(r *branchRec) (typedRow, error) { return marshalRow(r.Code, r.Version, r) })
}

func (branchTable) canon(code string, raw []byte) ([]byte, error) {
	var r branchRec
	if err := strictDecode(raw, &r); err != nil {
		return nil, fmt.Errorf("สายสกิลไม่ถูกต้อง: %w", err)
	}
	if err := fixCode(&r.Code, code); err != nil {
		return nil, err
	}
	if r.Class == "" {
		return nil, errors.New("สายสกิลต้องระบุ class")
	}
	return json.Marshal(r)
}

func (branchTable) write(tx *gorm.DB, canon []byte, exists bool, by any) error {
	var r branchRec
	if err := json.Unmarshal(canon, &r); err != nil {
		return err
	}
	classID, err := lookupID(tx, "game_classes", r.Class, "อาชีพ")
	if err != nil {
		return err
	}
	if !exists {
		return tx.Exec(`INSERT INTO game_branches (code, sort, class_id, name, updated_by)
			VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM game_branches), ?, ?, ?::uuid)`, r.Code, classID, r.Name, by).Error
	}
	return tx.Exec(`UPDATE game_branches SET class_id = ?, name = ?, version = version + 1, updated_by = ?::uuid, updated_at = now()
		WHERE code = ?`, classID, r.Name, by, r.Code).Error
}

func (branchTable) remove(tx *gorm.DB, code string) error {
	return tx.Exec(`DELETE FROM game_branches WHERE code = ?`, code).Error
}

// ---------- weapons ----------

type weaponRec struct {
	Code        string `json:"id" gorm:"column:code"`
	Name        string `json:"name" gorm:"column:name"`
	SlotType    string `json:"slotType" gorm:"column:slot_type"`
	DamageType  string `json:"damageType" gorm:"column:damage_type"`
	WeaponClass string `json:"weaponClass" gorm:"column:weapon_class"`
	Version     int64  `json:"-" gorm:"column:version"`
}

type weaponTable struct{}

const weaponSelect = `SELECT w.code, w.name, w.slot_type, w.damage_type, wc.code AS weapon_class, w.version
	FROM game_weapons w JOIN game_weapon_classes wc ON wc.id = w.weapon_class_id`

// ensureWeaponClass คืน id ของชนิดอาวุธ (สร้างให้ถ้ายังไม่มี) — ชนิดอาวุธเกิดจากอาวุธและสกิลอ้างถึงได้เมื่อมีอยู่แล้ว
func ensureWeaponClass(tx *gorm.DB, code string) (int64, error) {
	var id int64
	err := tx.Raw(`INSERT INTO game_weapon_classes (code) VALUES (?)
		ON CONFLICT (code) DO UPDATE SET code = EXCLUDED.code RETURNING id`, code).Scan(&id).Error
	return id, err
}

// pruneWeaponClasses ลบชนิดอาวุธที่ไม่มีอาวุธหรือสกิลอ้างถึงแล้ว
func pruneWeaponClasses(tx *gorm.DB) error {
	return tx.Exec(`DELETE FROM game_weapon_classes c
		WHERE NOT EXISTS (SELECT 1 FROM game_weapons w WHERE w.weapon_class_id = c.id)
		  AND NOT EXISTS (SELECT 1 FROM game_skill_weapon_rules r WHERE r.weapon_class_id = c.id)`).Error
}

func (weaponTable) read(tx *gorm.DB, code string, lock bool) ([]typedRow, error) {
	return readRows(tx, weaponSelect, "w", code, lock, func(r *weaponRec) (typedRow, error) { return marshalRow(r.Code, r.Version, r) })
}

func (weaponTable) canon(code string, raw []byte) ([]byte, error) {
	var r weaponRec
	if err := strictDecode(raw, &r); err != nil {
		return nil, fmt.Errorf("อาวุธไม่ถูกต้อง: %w", err)
	}
	if err := fixCode(&r.Code, code); err != nil {
		return nil, err
	}
	if r.WeaponClass == "" || len(r.WeaponClass) > 64 {
		return nil, errors.New("weaponClass ต้องไม่ว่าง (ไม่เกิน 64 ตัวอักษร)")
	}
	return json.Marshal(r)
}

func (weaponTable) write(tx *gorm.DB, canon []byte, exists bool, by any) error {
	var r weaponRec
	if err := json.Unmarshal(canon, &r); err != nil {
		return err
	}
	classID, err := ensureWeaponClass(tx, r.WeaponClass)
	if err != nil {
		return err
	}
	if !exists {
		return tx.Exec(`INSERT INTO game_weapons (code, sort, name, slot_type, damage_type, weapon_class_id, updated_by)
			VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM game_weapons), ?, ?, ?, ?, ?::uuid)`,
			r.Code, r.Name, r.SlotType, r.DamageType, classID, by).Error
	}
	if err := tx.Exec(`UPDATE game_weapons SET name = ?, slot_type = ?, damage_type = ?, weapon_class_id = ?,
		version = version + 1, updated_by = ?::uuid, updated_at = now() WHERE code = ?`,
		r.Name, r.SlotType, r.DamageType, classID, by, r.Code).Error; err != nil {
		return err
	}
	return pruneWeaponClasses(tx)
}

func (weaponTable) remove(tx *gorm.DB, code string) error {
	if err := tx.Exec(`DELETE FROM game_weapons WHERE code = ?`, code).Error; err != nil {
		return err
	}
	return pruneWeaponClasses(tx)
}

// ---------- stats (statDefs) ----------

type statRec struct {
	Code    string `json:"id" gorm:"column:code"`
	Name    string `json:"name" gorm:"column:name"`
	Group   string `json:"group" gorm:"column:stat_group"`
	Kind    string `json:"kind" gorm:"column:kind"` // num | pct | frac
	Version int64  `json:"-" gorm:"column:version"`
}

type statTable struct{}

const statSelect = `SELECT d.code, d.name, d.stat_group, d.kind, d.version FROM game_stat_defs d`

func (statTable) read(tx *gorm.DB, code string, lock bool) ([]typedRow, error) {
	return readRows(tx, statSelect, "d", code, lock, func(r *statRec) (typedRow, error) { return marshalRow(r.Code, r.Version, r) })
}

func (statTable) canon(code string, raw []byte) ([]byte, error) {
	var r statRec
	if err := strictDecode(raw, &r); err != nil {
		return nil, fmt.Errorf("นิยามสเตตัสไม่ถูกต้อง: %w", err)
	}
	if err := fixCode(&r.Code, code); err != nil {
		return nil, err
	}
	if r.Kind != "num" && r.Kind != "pct" && r.Kind != "frac" {
		return nil, fmt.Errorf("kind ต้องเป็น num | pct | frac (ได้ %q)", r.Kind)
	}
	return json.Marshal(r)
}

func (statTable) write(tx *gorm.DB, canon []byte, exists bool, by any) error {
	var r statRec
	if err := json.Unmarshal(canon, &r); err != nil {
		return err
	}
	if !exists {
		return tx.Exec(`INSERT INTO game_stat_defs (code, sort, name, stat_group, kind, updated_by)
			VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM game_stat_defs), ?, ?, ?, ?::uuid)`, r.Code, r.Name, r.Group, r.Kind, by).Error
	}
	return tx.Exec(`UPDATE game_stat_defs SET name = ?, stat_group = ?, kind = ?, version = version + 1, updated_by = ?::uuid, updated_at = now()
		WHERE code = ?`, r.Name, r.Group, r.Kind, by, r.Code).Error
}

func (statTable) remove(tx *gorm.DB, code string) error {
	return tx.Exec(`DELETE FROM game_stat_defs WHERE code = ?`, code).Error
}

// ---------- skills ----------

type skillReq struct {
	ID string `json:"id"` // code ของสกิลที่ต้องเรียนก่อน
	Lv int    `json:"lv"`
}

type weaponReqRec struct {
	SlotType   string   `json:"slotType"`
	DamageType string   `json:"damageType"`
	Include    []string `json:"include"`
	Exclude    []string `json:"exclude"`
}

type triggerRec struct {
	HPBelow  float64  `json:"hpBelow"`
	HPAbove  *float64 `json:"hpAbove"`
	Cooldown float64  `json:"cooldown"`
}

type toggleOffRec struct {
	HPBelow float64 `json:"hpBelow"`
}

// skillRec = รูป JSON ของสกิลใน API (ลำดับคีย์ตามข้อมูลตั้งต้น)
type skillRec struct {
	ID         string          `json:"id"`
	Class      string          `json:"class"`
	Name       string          `json:"name"`
	Desc       string          `json:"desc"`
	Type       string          `json:"type"`
	Branch     string          `json:"branch"`
	Tier       int             `json:"tier"`
	JobLvReq   int             `json:"jobLvReq"`
	MaxLevel   int             `json:"maxLevel"`
	Requires   []skillReq      `json:"requires"`
	WeaponReq  weaponReqRec    `json:"weaponReq"`
	NeedShield bool            `json:"needShield"`
	Usage      json.RawMessage `json:"usage"`
	Damage     json.RawMessage `json:"damage"`
	Heal       json.RawMessage `json:"heal"`
	Effects    json.RawMessage `json:"effects"`
	Group      string          `json:"group"`
	Trigger    *triggerRec     `json:"trigger"`
	ToggleOff  *toggleOffRec   `json:"toggleOff"`
	Hooks      json.RawMessage `json:"hooks"`
}

// skillRow = หนึ่งแถวจาก SELECT (คอลัมน์จริง + requires ที่รวมจากตารางลูกเป็น JSON)
type skillRow struct {
	Code             string          `gorm:"column:code"`
	Class            string          `gorm:"column:class"`
	Branch           string          `gorm:"column:branch"`
	Name             string          `gorm:"column:name"`
	Description      string          `gorm:"column:description"`
	SkillType        string          `gorm:"column:skill_type"`
	Tier             int             `gorm:"column:tier"`
	JobLvReq         int             `gorm:"column:job_lv_req"`
	MaxLevel         int             `gorm:"column:max_level"`
	NeedShield       bool            `gorm:"column:need_shield"`
	WeaponSlotType   string          `gorm:"column:weapon_slot_type"`
	WeaponDamageType string          `gorm:"column:weapon_damage_type"`
	WeaponInclude    json.RawMessage `gorm:"column:weapon_include"`
	WeaponExclude    json.RawMessage `gorm:"column:weapon_exclude"`
	EffectGroup      string          `gorm:"column:effect_group"`
	TriggerHPBelow   *float64        `gorm:"column:trigger_hp_below"`
	TriggerHPAbove   *float64        `gorm:"column:trigger_hp_above"`
	TriggerCooldown  *float64        `gorm:"column:trigger_cooldown"`
	ToggleOffHPBelow *float64        `gorm:"column:toggle_off_hp_below"`
	Usage            json.RawMessage `gorm:"column:usage"`
	Damage           json.RawMessage `gorm:"column:damage"`
	Heal             json.RawMessage `gorm:"column:heal"`
	Effects          json.RawMessage `gorm:"column:effects"`
	Hooks            json.RawMessage `gorm:"column:hooks"`
	Requires         json.RawMessage `gorm:"column:requires"`
	Version          int64           `gorm:"column:version"`
}

type skillTable struct{}

const skillSelect = `SELECT s.code, k.code AS class, COALESCE(b.code, '') AS branch, s.name, s.description, s.skill_type, s.tier, s.job_lv_req,
	s.max_level, s.need_shield, s.weapon_slot_type, s.weapon_damage_type,
	COALESCE((SELECT jsonb_agg(wc.code ORDER BY wc.code) FROM game_skill_weapon_rules r JOIN game_weapon_classes wc ON wc.id = r.weapon_class_id
		WHERE r.skill_id = s.id AND r.mode = 'include'), '[]'::jsonb) AS weapon_include,
	COALESCE((SELECT jsonb_agg(wc.code ORDER BY wc.code) FROM game_skill_weapon_rules r JOIN game_weapon_classes wc ON wc.id = r.weapon_class_id
		WHERE r.skill_id = s.id AND r.mode = 'exclude'), '[]'::jsonb) AS weapon_exclude,
	s.effect_group,
	s.trigger_hp_below, s.trigger_hp_above, s.trigger_cooldown, s.toggle_off_hp_below,
	s.usage, s.damage, s.heal, s.effects, s.hooks,
	COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.code, 'lv', r.lv) ORDER BY r.pos)
		FROM game_skill_requires r JOIN game_skills t ON t.id = r.requires_skill_id WHERE r.skill_id = s.id), '[]'::jsonb) AS requires,
	s.version
	FROM game_skills s JOIN game_classes k ON k.id = s.class_id LEFT JOIN game_branches b ON b.id = s.branch_id`

func (skillTable) read(tx *gorm.DB, code string, lock bool) ([]typedRow, error) {
	return readRows(tx, skillSelect, "s", code, lock, func(w *skillRow) (typedRow, error) {
		r := skillRec{
			ID: w.Code, Class: w.Class, Name: w.Name, Desc: w.Description, Type: w.SkillType, Branch: w.Branch,
			Tier: w.Tier, JobLvReq: w.JobLvReq, MaxLevel: w.MaxLevel, NeedShield: w.NeedShield, Group: w.EffectGroup,
			WeaponReq: weaponReqRec{SlotType: w.WeaponSlotType, DamageType: w.WeaponDamageType},
			Usage:     w.Usage, Damage: w.Damage, Heal: w.Heal, Effects: w.Effects, Hooks: w.Hooks,
		}
		if err := json.Unmarshal(w.WeaponInclude, &r.WeaponReq.Include); err != nil {
			return typedRow{}, err
		}
		if err := json.Unmarshal(w.WeaponExclude, &r.WeaponReq.Exclude); err != nil {
			return typedRow{}, err
		}
		if err := json.Unmarshal(w.Requires, &r.Requires); err != nil {
			return typedRow{}, err
		}
		if w.TriggerHPBelow != nil {
			r.Trigger = &triggerRec{HPBelow: *w.TriggerHPBelow, HPAbove: w.TriggerHPAbove}
			if w.TriggerCooldown != nil {
				r.Trigger.Cooldown = *w.TriggerCooldown
			}
		}
		if w.ToggleOffHPBelow != nil {
			r.ToggleOff = &toggleOffRec{HPBelow: *w.ToggleOffHPBelow}
		}
		if err := normalizeSkill(&r); err != nil {
			return typedRow{}, err
		}
		return marshalRow(w.Code, w.Version, r)
	})
}

// normalizeSkill ใส่ค่าเริ่มต้นของฟิลด์ที่ไม่ได้ส่งมา จัดคีย์ jsonb ให้คงที่ และตรวจค่า — ใช้ทั้งตอนอ่านจาก DB และตอนรับข้อมูล
// เพื่อให้รูป canonical ของสองฝั่งเท่ากันทุกกรณี
func normalizeSkill(r *skillRec) error {
	switch r.Type {
	case "passive", "active", "buff", "toggle", "trigger":
	default:
		return fmt.Errorf("type ต้องเป็น passive | active | buff | toggle | trigger (ได้ %q)", r.Type)
	}
	if r.Class == "" {
		return errors.New("สกิลต้องระบุ class")
	}
	if r.MaxLevel < 1 {
		return errors.New("maxLevel ต้อง ≥ 1")
	}
	if r.Requires == nil {
		r.Requires = []skillReq{}
	}
	seen := map[string]bool{}
	for _, q := range r.Requires {
		if q.ID == "" || q.ID == r.ID || seen[q.ID] {
			return fmt.Errorf("requires ไม่ถูกต้อง (ว่าง/อ้างตัวเอง/ซ้ำ): %q", q.ID)
		}
		if q.Lv < 1 {
			return fmt.Errorf("requires %s: lv ต้อง ≥ 1", q.ID)
		}
		seen[q.ID] = true
	}
	// include/exclude เป็นเซต: เรียงตัวอักษร ตัดซ้ำ และชนิดเดียวอยู่ทั้งสองฝั่งไม่ได้ (ตรงกับ PK ของ game_skill_weapon_rules)
	r.WeaponReq.Include = sortedSet(r.WeaponReq.Include)
	r.WeaponReq.Exclude = sortedSet(r.WeaponReq.Exclude)
	for _, a := range r.WeaponReq.Include {
		for _, b := range r.WeaponReq.Exclude {
			if a == b {
				return fmt.Errorf("weaponReq: %q อยู่ทั้ง include และ exclude", a)
			}
		}
	}
	var err error
	for _, f := range []struct {
		v     *json.RawMessage
		def   string
		first byte
		name  string
	}{
		{&r.Usage, `{}`, '{', "usage"}, {&r.Damage, `{}`, '{', "damage"}, {&r.Heal, "", '{', "heal"},
		{&r.Effects, `[]`, '[', "effects"}, {&r.Hooks, `{}`, '{', "hooks"},
	} {
		if *f.v, err = normJSON(*f.v, f.def); err != nil {
			return fmt.Errorf("%s: %w", f.name, err)
		}
		if len(*f.v) > 0 {
			if err := jsonKind(*f.v, f.first, f.name); err != nil {
				return err
			}
		}
	}
	return nil
}

func sortedSet(in []string) []string {
	out := make([]string, 0, len(in))
	seen := map[string]bool{}
	for _, v := range in {
		if v != "" && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	sort.Strings(out)
	return out
}

func (skillTable) canon(code string, raw []byte) ([]byte, error) {
	var r skillRec
	if err := strictDecode(raw, &r); err != nil {
		return nil, fmt.Errorf("สกิลไม่ถูกต้อง: %w", err)
	}
	if err := fixCode(&r.ID, code); err != nil {
		return nil, err
	}
	if err := normalizeSkill(&r); err != nil {
		return nil, err
	}
	return json.Marshal(r)
}

func jsonArg(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" { // JSON null = SQL NULL (ไม่ใช่ jsonb 'null')
		return nil
	}
	return string(raw)
}

func (skillTable) write(tx *gorm.DB, canon []byte, exists bool, by any) error {
	var r skillRec
	if err := json.Unmarshal(canon, &r); err != nil {
		return err
	}
	classID, err := lookupID(tx, "game_classes", r.Class, "อาชีพ")
	if err != nil {
		return err
	}
	var branchID *int64
	if r.Branch != "" {
		id, err := lookupID(tx, "game_branches", r.Branch, "สายสกิล")
		if err != nil {
			return err
		}
		branchID = &id
	}
	var trigBelow, trigAbove, trigCd, offBelow *float64
	if r.Trigger != nil {
		trigBelow, trigAbove, trigCd = &r.Trigger.HPBelow, r.Trigger.HPAbove, &r.Trigger.Cooldown
	}
	if r.ToggleOff != nil {
		offBelow = &r.ToggleOff.HPBelow
	}

	var skillID int64
	if !exists {
		err = tx.Raw(`INSERT INTO game_skills (code, sort, class_id, branch_id, name, description, skill_type, tier, job_lv_req, max_level, need_shield,
				weapon_slot_type, weapon_damage_type, effect_group,
				trigger_hp_below, trigger_hp_above, trigger_cooldown, toggle_off_hp_below, usage, damage, heal, effects, hooks, updated_by)
			VALUES (?, (SELECT COALESCE(MAX(sort), 0) + 1 FROM game_skills), ?, ?, ?, ?, ?, ?, ?, ?, ?,
				?, ?, ?,
				?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::uuid) RETURNING id`,
			r.ID, classID, branchID, r.Name, r.Desc, r.Type, r.Tier, r.JobLvReq, r.MaxLevel, r.NeedShield,
			r.WeaponReq.SlotType, r.WeaponReq.DamageType, r.Group,
			trigBelow, trigAbove, trigCd, offBelow,
			jsonArg(r.Usage), jsonArg(r.Damage), jsonArg(r.Heal), jsonArg(r.Effects), jsonArg(r.Hooks), by).Scan(&skillID).Error
	} else {
		err = tx.Raw(`UPDATE game_skills SET class_id = ?, branch_id = ?, name = ?, description = ?, skill_type = ?, tier = ?, job_lv_req = ?, max_level = ?,
				need_shield = ?, weapon_slot_type = ?, weapon_damage_type = ?,
				effect_group = ?, trigger_hp_below = ?, trigger_hp_above = ?, trigger_cooldown = ?, toggle_off_hp_below = ?,
				usage = ?::jsonb, damage = ?::jsonb, heal = ?::jsonb, effects = ?::jsonb, hooks = ?::jsonb,
				version = version + 1, updated_by = ?::uuid, updated_at = now() WHERE code = ? RETURNING id`,
			classID, branchID, r.Name, r.Desc, r.Type, r.Tier, r.JobLvReq, r.MaxLevel,
			r.NeedShield, r.WeaponReq.SlotType, r.WeaponReq.DamageType,
			r.Group, trigBelow, trigAbove, trigCd, offBelow,
			jsonArg(r.Usage), jsonArg(r.Damage), jsonArg(r.Heal), jsonArg(r.Effects), jsonArg(r.Hooks), by, r.ID).Scan(&skillID).Error
	}
	if err != nil {
		return err
	}
	if err := tx.Exec(`DELETE FROM game_skill_weapon_rules WHERE skill_id = ?`, skillID).Error; err != nil {
		return err
	}
	for mode, list := range map[string][]string{"include": r.WeaponReq.Include, "exclude": r.WeaponReq.Exclude} {
		for _, wc := range list {
			wcID, err := lookupID(tx, "game_weapon_classes", wc, "ชนิดอาวุธ")
			if err != nil {
				return err
			}
			if err := tx.Exec(`INSERT INTO game_skill_weapon_rules (skill_id, weapon_class_id, mode) VALUES (?, ?, ?)`, skillID, wcID, mode).Error; err != nil {
				return err
			}
		}
	}
	if err := tx.Exec(`DELETE FROM game_skill_requires WHERE skill_id = ?`, skillID).Error; err != nil {
		return err
	}
	for i, q := range r.Requires {
		target, err := lookupID(tx, "game_skills", q.ID, "สกิลที่ต้องเรียนก่อน")
		if err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO game_skill_requires (skill_id, requires_skill_id, lv, pos) VALUES (?, ?, ?, ?)`,
			skillID, target, q.Lv, i+1).Error; err != nil {
			return err
		}
	}
	return nil
}

func (skillTable) remove(tx *gorm.DB, code string) error {
	return tx.Exec(`DELETE FROM game_skills WHERE code = ?`, code).Error // แถวใน game_skill_requires ของสกิลนี้ถูกลบตาม (CASCADE)
}

// ---------- ลำดับการสร้าง/แก้ ----------

// opDeps = code ของรายการ "ในตารางเดียวกัน" ที่ต้องมีก่อน (classes → parent; skills → requires)
func opDeps(table string, data []byte) []string {
	switch table {
	case "classes":
		var c struct {
			Parent string `json:"parent"`
		}
		if json.Unmarshal(data, &c) == nil && c.Parent != "" {
			return []string{c.Parent}
		}
	case "skills":
		var s struct {
			Requires []struct {
				ID string `json:"id"`
			} `json:"requires"`
		}
		if json.Unmarshal(data, &s) == nil {
			out := make([]string, 0, len(s.Requires))
			for _, q := range s.Requires {
				out = append(out, q.ID)
			}
			return out
		}
	}
	return nil
}

// sortUpserts จัดลำดับการสร้าง/แก้ในชุดการแก้ให้รายการที่ถูกอ้างอิง (พ่อ / สกิลที่ต้องเรียนก่อน) อยู่ก่อนรายการที่อ้างถึง
// (เฉพาะรายการที่อยู่ในชุดเดียวกัน; FK เป็น int ที่หาจาก code ตอนเขียน) โดยคงตำแหน่งของ op อื่นไว้ — แก้ ops ในที่เดิม
func sortUpserts(ops []TableOp) {
	for _, table := range []string{"classes", "skills"} {
		var idx []int
		for i, op := range ops {
			if op.Table == table && !op.Delete {
				idx = append(idx, i)
			}
		}
		if len(idx) < 2 {
			continue
		}
		byID := make(map[string]TableOp, len(idx))
		for _, i := range idx {
			byID[ops[i].ID] = ops[i]
		}
		done := make(map[string]bool, len(idx))
		out := make([]TableOp, 0, len(idx))
		var visit func(id string)
		visit = func(id string) {
			if done[id] {
				return
			}
			done[id] = true // ทำเครื่องหมายก่อนเข้าไปหารายการที่ต้องมีก่อน เพื่อไม่วนไม่รู้จบเมื่ออ้างกันเป็นวง
			for _, d := range opDeps(table, byID[id].Data) {
				if _, ok := byID[d]; ok {
					visit(d)
				}
			}
			out = append(out, byID[id])
		}
		for _, i := range idx {
			visit(ops[i].ID)
		}
		if len(out) != len(idx) { // id ซ้ำในชุดเดียวกัน — ไม่แตะลำดับ ปล่อยให้ขั้นตอนปกติฟ้องเอง
			continue
		}
		for k, i := range idx {
			ops[i] = out[k]
		}
	}
}
