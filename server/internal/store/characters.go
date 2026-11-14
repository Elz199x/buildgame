package store

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"gorm.io/gorm"
)

// Character = ตัวละคร (ตาราง characters)
//
// อาชีพเก็บเป็น FK int (class_id → game_classes.id); สกิลที่เรียนเก็บในตาราง character_skills; ค่าพื้นฐาน (เลเวล/EXP/ทอง) เป็นคอลัมน์
// ส่วน state JSONB เก็บเฉพาะที่เหลือ (สเตตัส อุปกรณ์ กระเป๋า คลัง ลำดับสกิล …)
// ฝั่งโค้ดยังเห็น state เป็นก้อนเดียวเหมือนเดิม: ตอนอ่านจะประกอบคอลัมน์/ตารางลูกกลับเข้าไป (hydrate) ตอนเขียนจะแยกออก (splitState)
type Character struct {
	ID       string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID   string `gorm:"type:uuid"`
	Name     string
	ClassRef int64  `gorm:"column:class_id"` // game_classes.id
	ClassID  string `gorm:"-"`               // code ของอาชีพ (เติมตอนอ่าน)
	BaseLv   int
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

// stateOwnedKeys = คีย์ของ state ที่เก็บในคอลัมน์/ตารางลูกแทน (ไม่เก็บซ้ำใน jsonb)
var stateOwnedKeys = []string{"classId", "baseLv", "jobLv", "baseExp", "jobExp", "gold", "learned"}

func levelOf(v json.RawMessage) int {
	var f float64
	if json.Unmarshal(v, &f) == nil {
		return int(math.Round(f))
	}
	var b bool
	if json.Unmarshal(v, &b) == nil && b {
		return 1
	}
	return 0
}

// splitState แยก state ที่ไม่มีคีย์ซ้ำกับคอลัมน์ออกมา พร้อมสกิลที่เรียน (code → เลเวล ≥ 1)
func splitState(state json.RawMessage) (json.RawMessage, map[string]int, error) {
	if len(state) == 0 {
		return json.RawMessage("{}"), nil, nil
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(state, &top); err != nil {
		return nil, nil, err
	}
	learned := map[string]int{}
	if raw, ok := top["learned"]; ok {
		var m map[string]json.RawMessage
		if json.Unmarshal(raw, &m) == nil {
			for code, v := range m {
				if lv := levelOf(v); lv >= 1 {
					learned[code] = lv
				}
			}
		}
	}
	for _, k := range stateOwnedKeys {
		delete(top, k)
	}
	out, err := json.Marshal(top)
	return out, learned, err
}

// hydrateCharacter เติม code อาชีพ และประกอบคอลัมน์ + สกิลที่เรียนกลับเข้า state (state ว่าง = บัญชีเก่า คงไว้ให้สร้างตัวละครใหม่)
func hydrateCharacter(tx *gorm.DB, c *Character) error {
	var cls []string
	if err := tx.Raw(`SELECT code FROM game_classes WHERE id = ?`, c.ClassRef).Scan(&cls).Error; err != nil {
		return err
	}
	if len(cls) > 0 {
		c.ClassID = cls[0]
	}
	var top map[string]json.RawMessage
	if len(c.State) == 0 || json.Unmarshal(c.State, &top) != nil || len(top) == 0 {
		return nil
	}
	var rows []struct {
		Code string
		Lv   int
	}
	if err := tx.Raw(`SELECT s.code, cs.lv FROM character_skills cs JOIN game_skills s ON s.id = cs.skill_id WHERE cs.character_id = ?`, c.ID).Scan(&rows).Error; err != nil {
		return err
	}
	learned := make(map[string]int, len(rows))
	for _, r := range rows {
		learned[r.Code] = r.Lv
	}
	for k, v := range map[string]any{"classId": c.ClassID, "baseLv": c.BaseLv, "jobLv": c.JobLv, "baseExp": c.BaseExp, "jobExp": c.JobExp, "gold": c.Gold, "learned": learned} {
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		top[k] = b
	}
	out, err := json.Marshal(top)
	c.State = out
	return err
}

// syncLearned ทำให้ character_skills ตรงกับสกิลที่เรียนใน state (สกิลที่ไม่มีในเกมแล้วถูกข้าม)
func syncLearned(tx *gorm.DB, charID string, learned map[string]int) error {
	if err := tx.Exec(`DELETE FROM character_skills WHERE character_id = ?::uuid`, charID).Error; err != nil {
		return err
	}
	if len(learned) == 0 {
		return nil
	}
	js, err := json.Marshal(learned)
	if err != nil {
		return err
	}
	return tx.Exec(`INSERT INTO character_skills (character_id, skill_id, lv)
		SELECT ?::uuid, s.id, v.value::int FROM jsonb_each_text(?::jsonb) AS v JOIN game_skills s ON s.code = v.key`, charID, string(js)).Error
}

// CharacterByUser คืนตัวละครแรก (เก่าสุด) ของผู้ใช้ — ตอนนี้ 1 ผู้ใช้ = 1 ตัวละคร
func (s *Store) CharacterByUser(ctx context.Context, userID string) (Character, error) {
	var c Character
	db := s.w(ctx)
	if err := db.Where("user_id = ?", userID).Order("created_at").First(&c).Error; err != nil {
		return c, notFound(err)
	}
	return c, hydrateCharacter(db, &c)
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
	rest, learned, err := splitState(state)
	if err != nil {
		return err
	}
	classID, err := lookupID(tx, "game_classes", cols.ClassID, "อาชีพ")
	if err != nil {
		return err
	}
	res := tx.Model(&Character{}).Where("id = ?", charID).Updates(map[string]any{
		"state": []byte(rest), "class_id": classID, "base_lv": cols.BaseLv, "job_lv": cols.JobLv,
		"base_exp": cols.BaseExp, "job_exp": cols.JobExp, "gold": cols.Gold, "updated_at": time.Now().UTC(),
	})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return syncLearned(tx, charID, learned)
}

// SaveCharacterState บันทึก state ทั้งก้อน (แยกลงคอลัมน์/ตารางลูกให้) ในทรานแซกชันเดียว
func (s *Store) SaveCharacterState(ctx context.Context, charID string, state json.RawMessage, cols StateColumns) error {
	return s.w(ctx).Transaction(func(tx *gorm.DB) error { return s.saveState(tx, charID, state, cols) })
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
		if err := hydrateCharacter(tx, &c); err != nil {
			return err
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
