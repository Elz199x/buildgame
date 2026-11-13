package store

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/gorm"
)

// Character = ตัวละคร (ตาราง characters) — คอลัมน์ที่ใช้ค้นหา/จัดอันดับ + state ทั้งก้อนเป็น JSONB
type Character struct {
	ID        string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID    string `gorm:"type:uuid"`
	Name      string
	ClassID   string
	BaseLv    int
	JobLv     int
	BaseExp   int64
	JobExp    int64
	Gold      int64
	MapID     string
	PosX      float32
	PosY      float32
	State     json.RawMessage `gorm:"type:jsonb"`
	Mode      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

func (Character) TableName() string { return "characters" }

// CharacterByUser คืนตัวละครแรก (เก่าสุด) ของผู้ใช้ — ตอนนี้ 1 ผู้ใช้ = 1 ตัวละคร
func (s *Store) CharacterByUser(ctx context.Context, userID string) (Character, error) {
	var c Character
	err := s.w(ctx).Where("user_id = ?", userID).Order("created_at").First(&c).Error
	return c, notFound(err)
}

// StateColumns คอลัมน์ที่ดึงออกมาจาก state เพื่อให้ค้นหา/จัดอันดับได้ (ผ่านการตรวจขอบเขตแล้ว)
type StateColumns struct {
	ClassID string
	BaseLv  int
	JobLv   int
	BaseExp int64
	JobExp  int64
	Gold    int64
}

func (s *Store) saveState(tx *gorm.DB, charID string, state json.RawMessage, cols StateColumns) error {
	res := tx.Model(&Character{}).Where("id = ?", charID).Updates(map[string]any{
		"state": []byte(state), "class_id": cols.ClassID, "base_lv": cols.BaseLv, "job_lv": cols.JobLv,
		"base_exp": cols.BaseExp, "job_exp": cols.JobExp, "gold": cols.Gold, "updated_at": time.Now().UTC(),
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}

// SaveCharacterState บันทึก state ทั้งก้อนพร้อมคอลัมน์ที่ซิงก์ไว้
func (s *Store) SaveCharacterState(ctx context.Context, charID string, state json.RawMessage, cols StateColumns) error {
	return s.saveState(s.w(ctx), charID, state, cols)
}

func (s *Store) SaveCharacterPosition(ctx context.Context, charID, mapID string, x, y float32) error {
	return s.w(ctx).Model(&Character{}).Where("id = ?", charID).
		Updates(map[string]any{"map_id": mapID, "pos_x": x, "pos_y": y, "updated_at": time.Now().UTC()}).Error
}

// SetCharacterMode เปลี่ยนโหมดตัวละคร (game | lab)
func (s *Store) SetCharacterMode(ctx context.Context, charID, mode string) error {
	return s.w(ctx).Model(&Character{}).Where("id = ?", charID).Update("mode", mode).Error
}

// MutateCharacter อ่าน-แก้-บันทึก state ใน transaction เดียวโดยล็อกแถว (FOR UPDATE) — ใช้เมื่อผู้เล่นไม่ได้ออนไลน์
// fn รับ state ปัจจุบันแล้วคืน state ใหม่พร้อมคอลัมน์ที่ซิงก์; คืน state ที่บันทึกแล้ว
func (s *Store) MutateCharacter(ctx context.Context, userID string, fn func(Character) (json.RawMessage, StateColumns, error)) (json.RawMessage, error) {
	var out json.RawMessage
	err := s.w(ctx).Transaction(func(tx *gorm.DB) error {
		var c Character
		if err := tx.Raw(`SELECT * FROM characters WHERE user_id = ? ORDER BY created_at LIMIT 1 FOR UPDATE`, userID).Scan(&c).Error; err != nil {
			return err
		}
		if c.ID == "" {
			return ErrNotFound
		}
		state, cols, err := fn(c)
		if err != nil {
			return err
		}
		if err := s.saveState(tx, c.ID, state, cols); err != nil {
			return err
		}
		out = state
		return nil
	})
	return out, err
}

// ---------- แชท ----------

type ChatMessage struct {
	ID        int64     `json:"id"`
	Channel   int       `json:"channel"`
	Sender    string    `json:"sender"`
	Body      string    `json:"text"`
	CreatedAt time.Time `json:"time"`
}

func (ChatMessage) TableName() string { return "chat_messages" }

func (s *Store) InsertChat(ctx context.Context, channel int, charID, sender, body string) error {
	var cid any
	if charID != "" {
		cid = charID
	}
	return s.w(ctx).Exec(`INSERT INTO chat_messages (channel, character_id, sender, body) VALUES (?, ?::uuid, ?, ?)`, channel, cid, sender, body).Error
}

// RecentChat ข้อความล่าสุด เรียงจากเก่าไปใหม่
func (s *Store) RecentChat(ctx context.Context, limit int) ([]ChatMessage, error) {
	out := []ChatMessage{}
	err := s.w(ctx).Raw(
		`SELECT id, channel, sender, body, created_at FROM (SELECT * FROM chat_messages ORDER BY id DESC LIMIT ?) t ORDER BY id`, limit).Scan(&out).Error
	return out, err
}

// PurgeOldChat ลบแชทที่เก่ากว่า olderThan
func (s *Store) PurgeOldChat(ctx context.Context, olderThan time.Duration) (int64, error) {
	res := s.w(ctx).Exec(`DELETE FROM chat_messages WHERE created_at < now() - make_interval(secs => ?)`, olderThan.Seconds())
	return res.RowsAffected, res.Error
}
