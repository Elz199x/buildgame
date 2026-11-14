package store

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"catquest-ro/server/internal/gamedata"
)

// ข้อมูลเกมเก็บ 2 แบบ (ดู gamedata/categories.go):
//   - หมวดเอกสาร (balance/entities/world/tools) → game_config_versions (แถวละเวอร์ชันของหมวด)
//   - ตารางรายการ (classes/branches/skills/weapons/stats) → game_classes ฯลฯ (แถวละรายการ + FOREIGN KEY + version ต่อแถว)
//     และทุกการแก้ลงประวัติใน game_audit

var (
	// ErrConfigConflict: รายการ/หมวดถูกแก้โดยผู้อื่นหลังจากที่ผู้เรียกโหลดไป (optimistic concurrency)
	ErrConfigConflict = errors.New("ข้อมูลนี้ถูกแก้โดยผู้อื่นแล้ว")
	// ErrRefIntegrity: ผิดความสัมพันธ์ระหว่างรายการ (อ้างถึงรายการที่ไม่มี หรือรายการนี้ยังถูกอ้างอิงอยู่)
	ErrRefIntegrity = errors.New("ผิดความสัมพันธ์ของข้อมูล (อ้างถึงรายการที่ไม่มี หรือยังถูกรายการอื่นอ้างอิงอยู่)")
)

const (
	keepConfigVersions = 50 // เก็บกี่เวอร์ชันต่อหมวดเอกสาร (เวอร์ชันที่ใช้งานอยู่ไม่ถูกลบเสมอ)
	configLockKey      = 7_340_001
)

// ---------- หมวดเอกสาร ----------

type ConfigRow struct {
	ID        int64 `gorm:"primaryKey;autoIncrement:false"`
	Category  string
	Data      json.RawMessage `gorm:"type:jsonb"`
	Note      string
	CreatedBy *string `gorm:"type:uuid"`
	CreatedAt time.Time
}

func (ConfigRow) TableName() string { return "game_config_versions" }

type ConfigVersion struct {
	ID        int64
	Category  string
	Note      string
	CreatedBy *string // username
	CreatedAt time.Time
}

func activeConfig(tx *gorm.DB) (map[string]ConfigRow, error) {
	var rows []ConfigRow
	if err := tx.Raw(`SELECT DISTINCT ON (category) id, category, data, note, created_by, created_at
		FROM game_config_versions ORDER BY category, id DESC`).Scan(&rows).Error; err != nil {
		return nil, err
	}
	out := make(map[string]ConfigRow, len(rows))
	for _, r := range rows {
		out[r.Category] = r
	}
	return out, nil
}

// ---------- ตารางรายการ ----------
// ทุกตารางเป็นคอลัมน์จริง (ดู gametables.go): แปลงระหว่างแถวกับรายการ JSON ของ API ที่นั่นที่เดียว

// TableRow = หนึ่งรายการ (JSON ของ API; id = code) + เลขเวอร์ชันของแถว (ใช้เป็น If-Match)
type TableRow struct {
	ID      string
	Data    json.RawMessage
	Version int64
}

// TableOp = การแก้หนึ่งรายการ (สร้าง/แก้/ลบ)
// Expect: nil = ไม่ตรวจ, 0 = ต้องยังไม่มีรายการนี้, >0 = ต้องเป็นเวอร์ชันนี้ (ไม่ตรง = ErrConfigConflict)
type TableOp struct {
	Table  string
	ID     string
	Delete bool
	Data   []byte
	Expect *int64
}

func loadTables(tx *gorm.DB) (map[string][]TableRow, error) {
	out := make(map[string][]TableRow, len(gamedata.Tables))
	for _, t := range gamedata.Tables {
		rows, err := typedTables[t.Name].read(tx, "", false)
		if err != nil {
			return nil, err
		}
		list := make([]TableRow, len(rows))
		for i, r := range rows {
			list[i] = TableRow{ID: r.Code, Data: r.Data, Version: r.Version}
		}
		out[t.Name] = list
	}
	return out, nil
}

func rawTables(rows map[string][]TableRow) map[string][]json.RawMessage {
	out := make(map[string][]json.RawMessage, len(rows))
	for name, rs := range rows {
		items := make([]json.RawMessage, len(rs))
		for i, r := range rs {
			items[i] = r.Data
		}
		out[name] = items
	}
	return out
}

func isFKViolation(err error) bool {
	if err == nil {
		return false
	}
	m := err.Error()
	return strings.Contains(m, "23503") || strings.Contains(m, "violates foreign key")
}

func auditInsert(tx *gorm.DB, table, id, action string, before, after []byte, note string, by any) error {
	var b, a any
	if before != nil {
		b = string(before)
	}
	if after != nil {
		a = string(after)
	}
	return tx.Exec(`INSERT INTO game_audit (entity, entity_id, action, before, after, note, created_by)
		VALUES (?, ?, ?, ?::jsonb, ?::jsonb, ?, ?::uuid)`, table, id, action, b, a, note, by).Error
}

// applyOp ทำหนึ่งการแก้ในทรานแซกชัน: ตรวจ If-Match → เขียน (เพิ่ม version) → ลงประวัติ; คืนเวอร์ชันของแถวหลังแก้ (0 = ถูกลบ)
func applyOp(tx *gorm.DB, op TableOp, note string, by any) (int64, error) {
	t, ok := typedTables[op.Table]
	if !ok {
		return 0, fmt.Errorf("ไม่มีตาราง %q", op.Table)
	}
	rows, err := t.read(tx, op.ID, true)
	if err != nil {
		return 0, err
	}
	found := len(rows) > 0
	var cur typedRow
	if found {
		cur = rows[0]
	}
	if op.Expect != nil {
		if (found && *op.Expect != cur.Version) || (!found && *op.Expect != 0) {
			return 0, fmt.Errorf("%w: %s/%s", ErrConfigConflict, op.Table, op.ID)
		}
		if found && *op.Expect == 0 {
			return 0, fmt.Errorf("%w: %s/%s มีอยู่แล้ว", ErrConfigConflict, op.Table, op.ID)
		}
	}
	if op.Delete {
		if !found {
			return 0, ErrNotFound
		}
		if err := t.remove(tx, op.ID); err != nil {
			if isFKViolation(err) {
				return 0, fmt.Errorf("%w: %s/%s", ErrRefIntegrity, op.Table, op.ID)
			}
			return 0, err
		}
		return 0, auditInsert(tx, op.Table, op.ID, "delete", cur.Data, nil, note, by)
	}

	canon, err := t.canon(op.ID, op.Data)
	if err != nil {
		return 0, fmt.Errorf("%s/%s: %w", op.Table, op.ID, err)
	}
	if found && bytes.Equal(canon, cur.Data) { // ข้อมูลเหมือนเดิม: ไม่เพิ่มเวอร์ชัน ไม่ลงประวัติ
		return cur.Version, nil
	}
	if err := t.write(tx, canon, found, by); err != nil {
		if isFKViolation(err) {
			return 0, fmt.Errorf("%w: %s/%s", ErrRefIntegrity, op.Table, op.ID)
		}
		return 0, err
	}
	if !found {
		return 1, auditInsert(tx, op.Table, op.ID, "create", nil, canon, note, by)
	}
	return cur.Version + 1, auditInsert(tx, op.Table, op.ID, "update", cur.Data, canon, note, by)
}

// ---------- API ของ Store ----------

// ActiveGameData คืนข้อมูลเกมที่ใช้งาน: เวอร์ชันล่าสุดของทุกหมวดเอกสาร + ทุกรายการของตาราง
// ErrNotFound ถ้ายังไม่มีข้อมูลเลย; error ถ้าหมวดไม่ครบ
func (s *Store) ActiveGameData(ctx context.Context) (map[string]ConfigRow, map[string][]TableRow, error) {
	db := s.w(ctx)
	cfg, err := activeConfig(db)
	if err != nil {
		return nil, nil, err
	}
	if len(cfg) == 0 {
		return nil, nil, ErrNotFound
	}
	for _, c := range gamedata.Categories {
		if _, ok := cfg[c.Name]; !ok {
			return nil, nil, fmt.Errorf("ข้อมูลเกมใน DB ขาดหมวด %q", c.Name)
		}
	}
	tables, err := loadTables(db)
	if err != nil {
		return nil, nil, err
	}
	return cfg, tables, nil
}

// SeedGameDataIfEmpty ใส่ข้อมูลตั้งต้นเมื่อยังไม่มีข้อมูลเกมเลย (ปลอดภัยเมื่อหลายอินสแตนซ์เริ่มพร้อมกัน)
func (s *Store) SeedGameDataIfEmpty(ctx context.Context, cfg map[string][]byte, tables map[string][]json.RawMessage) error {
	return s.w(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(?)`, configLockKey).Error; err != nil {
			return err
		}
		var n int64
		if err := tx.Raw(`SELECT count(*) FROM game_config_versions`).Scan(&n).Error; err != nil || n > 0 {
			return err
		}
		for _, c := range gamedata.Categories {
			p, ok := cfg[c.Name]
			if !ok {
				return fmt.Errorf("ข้อมูลตั้งต้นขาดหมวด %q", c.Name)
			}
			if err := tx.Exec(`INSERT INTO game_config_versions (category, data, note) VALUES (?, ?::jsonb, 'seed')`, c.Name, string(p)).Error; err != nil {
				return err
			}
		}
		for _, t := range gamedata.Tables {
			ops := make([]TableOp, 0, len(tables[t.Name]))
			for _, item := range tables[t.Name] {
				var h struct {
					ID string `json:"id"`
				}
				if err := json.Unmarshal(item, &h); err != nil || h.ID == "" {
					return fmt.Errorf("ข้อมูลตั้งต้น %s: รายการไม่มี id", t.Name)
				}
				ops = append(ops, TableOp{Table: t.Name, ID: h.ID, Data: item})
			}
			sortUpserts(ops)
			for _, op := range ops {
				if _, err := applyOp(tx, op, "seed", nil); err != nil {
					return fmt.Errorf("ข้อมูลตั้งต้น %s/%s: %w", t.Name, op.ID, err)
				}
			}
		}
		return nil
	})
}

// SaveInput = การเปลี่ยนแปลงหนึ่งชุด (ทั้งหมวดเอกสารและรายการของตาราง) ที่ต้องสำเร็จพร้อมกันหรือไม่สำเร็จเลย
type SaveInput struct {
	Config       map[string][]byte // หมวดเอกสารที่แก้ (ข้อมูลทั้งหมวด)
	ConfigExpect map[string]int64  // id เวอร์ชันของหมวดที่ผู้เรียกเห็นล่าสุด (0/ไม่ใส่ = ไม่ตรวจ)
	Ops          []TableOp         // เรียงตามลำดับที่ควรทำ (สร้าง/แก้ตามลำดับพึ่งพา, ลบย้อนลำดับ)
	Note         string
	UserID       string
}

type SaveResult struct {
	ConfigIDs map[string]int64 // เวอร์ชันใหม่ของหมวดเอกสารที่เขียน
	RowIDs    map[string]int64 // "ตาราง/id" → เวอร์ชันของแถวหลังแก้ (0 = ลบแล้ว)
}

// SaveGameData ทำทั้งหมดในทรานแซกชันเดียวภายใต้ advisory lock (กันผู้เขียนซ้อนกันข้ามอินสแตนซ์):
// ตรวจ If-Match → เขียน → ประกอบเอกสารหลังแก้แล้วเรียก validate (ตรวจการอ้างอิงข้ามส่วน) — ไม่ผ่านย้อนทั้งหมด
func (s *Store) SaveGameData(ctx context.Context, in SaveInput,
	validate func(cfg map[string][]byte, tables map[string][]json.RawMessage) error) (SaveResult, error) {
	res := SaveResult{ConfigIDs: map[string]int64{}, RowIDs: map[string]int64{}}
	err := s.w(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(?)`, configLockKey).Error; err != nil {
			return err
		}
		cur, err := activeConfig(tx)
		if err != nil {
			return err
		}
		all := make(map[string][]byte, len(gamedata.Categories))
		for _, c := range gamedata.Categories {
			if r, ok := cur[c.Name]; ok {
				all[c.Name] = r.Data
			}
		}
		for cat, data := range in.Config {
			if want := in.ConfigExpect[cat]; want != 0 && cur[cat].ID != want {
				return fmt.Errorf("%w: %s (ล่าสุด #%d)", ErrConfigConflict, cat, cur[cat].ID)
			}
			all[cat] = data
		}
		var by any
		if in.UserID != "" {
			by = in.UserID
		}
		ops := append([]TableOp(nil), in.Ops...)
		sortUpserts(ops) // พ่อ/สกิลที่ถูกอ้างต้องมีก่อน (FK เป็น int หาจาก code)
		for _, op := range ops {
			v, err := applyOp(tx, op, in.Note, by)
			if err != nil {
				return err
			}
			res.RowIDs[op.Table+"/"+op.ID] = v
		}
		if validate != nil {
			rows, err := loadTables(tx)
			if err != nil {
				return err
			}
			if err := validate(all, rawTables(rows)); err != nil {
				return err
			}
		}
		for cat, data := range in.Config {
			var id int64
			if err := tx.Raw(`INSERT INTO game_config_versions (category, data, note, created_by) VALUES (?, ?::jsonb, ?, ?::uuid) RETURNING id`,
				cat, string(data), in.Note, by).Scan(&id).Error; err != nil {
				return err
			}
			res.ConfigIDs[cat] = id
			if err := tx.Exec(`DELETE FROM game_config_versions WHERE category = ? AND id <=
				(SELECT id FROM game_config_versions WHERE category = ? ORDER BY id DESC OFFSET ? LIMIT 1)`, cat, cat, keepConfigVersions).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		if isFKViolation(err) && !errors.Is(err, ErrRefIntegrity) { // FK แบบ DEFERRABLE (classes.parent_id) จะฟ้องตอน commit
			err = fmt.Errorf("%w: %v", ErrRefIntegrity, err)
		}
		return SaveResult{}, err
	}
	return res, nil
}

// GameConfigVersion อ่านเวอร์ชันหนึ่งของหนึ่งหมวดเอกสาร
func (s *Store) GameConfigVersion(ctx context.Context, category string, id int64) (ConfigRow, error) {
	var r ConfigRow
	if err := s.w(ctx).First(&r, "id = ? AND category = ?", id, category).Error; err != nil {
		return ConfigRow{}, notFound(err)
	}
	return r, nil
}

// ListGameConfigVersions ประวัติเวอร์ชันของหมวดเอกสาร (ถ้า category ว่าง = ทุกหมวด) เรียงใหม่→เก่า
func (s *Store) ListGameConfigVersions(ctx context.Context, category string, limit int) ([]ConfigVersion, error) {
	var out []ConfigVersion
	q := `SELECT v.id, v.category, v.note, u.username AS created_by, v.created_at
		FROM game_config_versions v LEFT JOIN users u ON u.id = v.created_by`
	args := []any{}
	if category != "" {
		q += ` WHERE v.category = ?`
		args = append(args, category)
	}
	q += ` ORDER BY v.id DESC LIMIT ?`
	args = append(args, limit)
	err := s.w(ctx).Raw(q, args...).Scan(&out).Error
	return out, err
}

// AuditEntry = หนึ่งบรรทัดประวัติของรายการ
type AuditEntry struct {
	ID        int64
	Action    string
	Note      string
	CreatedBy *string // username
	CreatedAt time.Time
}

// ListAudit ประวัติการแก้ของรายการหนึ่ง (ใหม่→เก่า)
func (s *Store) ListAudit(ctx context.Context, table, id string, limit int) ([]AuditEntry, error) {
	var out []AuditEntry
	err := s.w(ctx).Raw(`SELECT a.id, a.action, a.note, u.username AS created_by, a.created_at
		FROM game_audit a LEFT JOIN users u ON u.id = a.created_by
		WHERE a.entity = ? AND a.entity_id = ? ORDER BY a.id DESC LIMIT ?`, table, id, limit).Scan(&out).Error
	return out, err
}

// AuditSnapshot คืนสถานะของรายการ "หลัง" บรรทัดประวัตินั้น (ถ้าเป็นการลบ คืนสถานะก่อนลบ) ใช้กู้คืนรายการ
func (s *Store) AuditSnapshot(ctx context.Context, table, id string, auditID int64) ([]byte, error) {
	var r struct {
		Before json.RawMessage
		After  json.RawMessage
	}
	res := s.w(ctx).Raw(`SELECT before, after FROM game_audit WHERE id = ? AND entity = ? AND entity_id = ?`, auditID, table, id).Scan(&r)
	if res.Error != nil {
		return nil, res.Error
	}
	if res.RowsAffected == 0 {
		return nil, ErrNotFound
	}
	if len(r.After) > 0 && string(r.After) != "null" {
		return r.After, nil
	}
	if len(r.Before) > 0 && string(r.Before) != "null" {
		return r.Before, nil
	}
	return nil, ErrNotFound
}
