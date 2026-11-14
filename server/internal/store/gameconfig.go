package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"gorm.io/gorm"

	"catquest-ro/server/internal/gamedata"
)

// ---------- ข้อมูลเกมแบบแยกหมวด + มีเวอร์ชัน (ตาราง game_config_versions) ----------

// ErrConfigConflict: หมวดถูกแก้โดยผู้อื่นหลังจากที่ผู้เรียกโหลดไป (optimistic concurrency)
var ErrConfigConflict = errors.New("ข้อมูลหมวดนี้ถูกแก้โดยผู้อื่นแล้ว")

// ConfigRow = หนึ่งเวอร์ชันของหนึ่งหมวด
type ConfigRow struct {
	ID        int64 `gorm:"primaryKey;autoIncrement:false"`
	Category  string
	Data      json.RawMessage `gorm:"type:jsonb"`
	Note      string
	CreatedBy *string `gorm:"type:uuid"`
	CreatedAt time.Time
}

func (ConfigRow) TableName() string { return "game_config_versions" }

// ConfigVersion = แถวสำหรับแสดงประวัติ (ไม่รวมตัวข้อมูล)
type ConfigVersion struct {
	ID        int64
	Category  string
	Note      string
	CreatedBy *string // username
	CreatedAt time.Time
}

const (
	keepConfigVersions = 50 // เก็บกี่เวอร์ชันต่อหมวด (เวอร์ชันที่ใช้งานอยู่ไม่ถูกลบเสมอ)
	configLockKey      = 7_340_001
)

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

// ActiveGameConfig คืนเวอร์ชันที่ใช้งานของทุกหมวด; ErrNotFound ถ้ายังไม่มีเลย หรือมีหมวดไม่ครบ
func (s *Store) ActiveGameConfig(ctx context.Context) (map[string]ConfigRow, error) {
	m, err := activeConfig(s.w(ctx))
	if err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return nil, ErrNotFound
	}
	for _, c := range gamedata.Categories {
		if _, ok := m[c.Name]; !ok {
			return nil, fmt.Errorf("ข้อมูลเกมใน DB ขาดหมวด %q", c.Name)
		}
	}
	return m, nil
}

// SeedGameConfigIfEmpty ใส่ข้อมูลตั้งต้นทุกหมวดเมื่อตารางว่าง (ปลอดภัยเมื่อหลายอินสแตนซ์เริ่มพร้อมกัน)
func (s *Store) SeedGameConfigIfEmpty(ctx context.Context, parts map[string][]byte) error {
	return s.w(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(?)`, configLockKey).Error; err != nil {
			return err
		}
		var n int64
		if err := tx.Raw(`SELECT count(*) FROM game_config_versions`).Scan(&n).Error; err != nil || n > 0 {
			return err
		}
		for _, c := range gamedata.Categories {
			p, ok := parts[c.Name]
			if !ok {
				return fmt.Errorf("ข้อมูลตั้งต้นขาดหมวด %q", c.Name)
			}
			if err := tx.Exec(`INSERT INTO game_config_versions (category, data, note) VALUES (?, ?::jsonb, 'seed')`, c.Name, string(p)).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// SaveGameConfig เขียนเฉพาะหมวดที่เปลี่ยน ในทรานแซกชันเดียว โดย
//   - ล็อกผู้เขียนทั้งระบบ (advisory lock) กันสองคนเขียนซ้อนกันข้ามหมวด
//   - expect[หมวด] = id เวอร์ชันที่ผู้เรียกเห็นล่าสุด (0/ไม่ใส่ = ไม่ตรวจ) — ไม่ตรงคืน ErrConfigConflict
//   - validate(เอกสารหลังแก้ทุกหมวด) ต้องผ่านก่อนจึงบันทึก (ตรวจการอ้างอิงข้ามหมวด)
//
// คืน id เวอร์ชันใหม่ต่อหมวดที่เขียน
func (s *Store) SaveGameConfig(ctx context.Context, changes map[string][]byte, expect map[string]int64,
	note, userID string, validate func(all map[string][]byte) error) (map[string]int64, error) {
	ids := map[string]int64{}
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
		for cat, data := range changes {
			if want := expect[cat]; want != 0 && cur[cat].ID != want {
				return fmt.Errorf("%w: %s (ล่าสุด #%d)", ErrConfigConflict, cat, cur[cat].ID)
			}
			all[cat] = data
		}
		if validate != nil {
			if err := validate(all); err != nil {
				return err
			}
		}
		var by any
		if userID != "" {
			by = userID
		}
		for cat, data := range changes {
			var id int64
			if err := tx.Raw(`INSERT INTO game_config_versions (category, data, note, created_by) VALUES (?, ?::jsonb, ?, ?::uuid) RETURNING id`,
				cat, string(data), note, by).Scan(&id).Error; err != nil {
				return err
			}
			ids[cat] = id
			if err := tx.Exec(`DELETE FROM game_config_versions WHERE category = ? AND id <=
				(SELECT id FROM game_config_versions WHERE category = ? ORDER BY id DESC OFFSET ? LIMIT 1)`, cat, cat, keepConfigVersions).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return ids, nil
}

// GameConfigVersion อ่านเวอร์ชันหนึ่งของหนึ่งหมวด
func (s *Store) GameConfigVersion(ctx context.Context, category string, id int64) (ConfigRow, error) {
	var r ConfigRow
	if err := s.w(ctx).First(&r, "id = ? AND category = ?", id, category).Error; err != nil {
		return ConfigRow{}, notFound(err)
	}
	return r, nil
}

// ListGameConfigVersions ประวัติเวอร์ชัน (ถ้า category ว่าง = ทุกหมวด) เรียงใหม่→เก่า
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
