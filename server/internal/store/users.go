package store

import (
	"context"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// User = บัญชีผู้ใช้ (ตาราง users)
type User struct {
	ID           string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	Username     string
	PasswordHash string
	Role         string
	Disabled     bool
	CreatedAt    time.Time
	LastLoginAt  *time.Time
}

func (User) TableName() string { return "users" }

// SessionRow = เซสชัน (ตาราง sessions) เก็บเฉพาะแฮชของโทเคน
type SessionRow struct {
	ID         string `gorm:"type:uuid;primaryKey;default:gen_random_uuid()"`
	UserID     string `gorm:"type:uuid"`
	TokenHash  []byte
	CreatedAt  time.Time
	LastSeenAt time.Time
	ExpiresAt  time.Time
	IP         *string `gorm:"column:ip;type:inet"`
	UserAgent  string
}

func (SessionRow) TableName() string { return "sessions" }

// Session = เซสชันที่ใช้งานได้พร้อมเจ้าของ
type Session struct {
	ID         string
	UserID     string
	ExpiresAt  time.Time
	LastSeenAt time.Time
	User       User
}

// CreateUserWithCharacter สร้างผู้ใช้ + ตัวละครเริ่มต้นใน transaction เดียว
// stateJSON/cols = สถานะตั้งต้นของตัวละครใหม่ (สร้างโดยชั้นเกม);
// ถ้า firstAdmin และยังไม่มีผู้ใช้เลย ผู้ใช้แรกจะได้ role admin
func (s *Store) CreateUserWithCharacter(ctx context.Context, username, passwordHash string, firstAdmin bool, stateJSON []byte, cols StateColumns) (User, Character, error) {
	var u User
	var c Character
	err := s.w(ctx).Transaction(func(tx *gorm.DB) error {
		// ล็อกเพื่อให้ "ผู้ใช้แรก" ถูกตัดสินอย่างถูกต้องแม้สมัครพร้อมกัน
		if err := tx.Exec(`SELECT pg_advisory_xact_lock(727275)`).Error; err != nil {
			return err
		}
		role := "player"
		if firstAdmin {
			var n int64
			if err := tx.Model(&User{}).Count(&n).Error; err != nil {
				return err
			}
			if n == 0 {
				role = "admin"
			}
		}
		u = User{Username: username, PasswordHash: passwordHash, Role: role}
		if err := tx.Create(&u).Error; err != nil {
			return err
		}
		if len(stateJSON) == 0 {
			stateJSON = []byte("{}")
		}
		classID, err := lookupID(tx, "game_classes", cols.ClassID, "อาชีพ")
		if err != nil {
			return err
		}
		rest, learned, err := splitState(stateJSON)
		if err != nil {
			return err
		}
		c = Character{UserID: u.ID, Name: username, ClassRef: classID, BaseLv: cols.BaseLv, JobLv: cols.JobLv,
			BaseExp: cols.BaseExp, JobExp: cols.JobExp, Gold: cols.Gold, MapID: "map_prontera", PosX: 520, PosY: 850, State: rest, Mode: "game"}
		if err := tx.Create(&c).Error; err != nil {
			return err
		}
		c.ClassID, c.State = cols.ClassID, stateJSON
		return syncLearned(tx, c.ID, learned)
	})
	if err != nil {
		if isUnique(err) {
			return User{}, Character{}, ErrConflict
		}
		return User{}, Character{}, err
	}
	return u, c, nil
}

func (s *Store) UserByUsername(ctx context.Context, username string) (User, error) {
	var u User
	err := s.w(ctx).Where("lower(username) = lower(?)", username).First(&u).Error
	return u, notFound(err)
}

func (s *Store) TouchLogin(ctx context.Context, userID string) error {
	return s.w(ctx).Model(&User{}).Where("id = ?", userID).Update("last_login_at", time.Now().UTC()).Error
}

// UpdatePasswordHash ใช้ตอนอัปเกรดพารามิเตอร์แฮชหลังล็อกอินสำเร็จ
func (s *Store) UpdatePasswordHash(ctx context.Context, userID, hash string) error {
	return s.w(ctx).Model(&User{}).Where("id = ?", userID).Update("password_hash", hash).Error
}

func (s *Store) CountUsers(ctx context.Context) (int, error) {
	var n int64
	err := s.w(ctx).Model(&User{}).Count(&n).Error
	return int(n), err
}

// ---------- เซสชัน ----------

func (s *Store) CreateSession(ctx context.Context, userID string, tokenHash []byte, expires time.Time, ip, userAgent string) error {
	if len(userAgent) > 300 {
		userAgent = userAgent[:300]
	}
	row := SessionRow{UserID: userID, TokenHash: tokenHash, ExpiresAt: expires, UserAgent: userAgent}
	if ip != "" {
		row.IP = &ip
	}
	return s.w(ctx).Create(&row).Error
}

// SessionByTokenHash คืนเซสชันที่ยังไม่หมดอายุและผู้ใช้ไม่ถูกปิดบัญชี
func (s *Store) SessionByTokenHash(ctx context.Context, tokenHash []byte) (Session, error) {
	var row SessionRow
	if err := s.w(ctx).Where("token_hash = ? AND expires_at > now()", tokenHash).First(&row).Error; err != nil {
		return Session{}, notFound(err)
	}
	var u User
	if err := s.w(ctx).Where("id = ? AND NOT disabled", row.UserID).First(&u).Error; err != nil {
		return Session{}, notFound(err)
	}
	return Session{ID: row.ID, UserID: row.UserID, ExpiresAt: row.ExpiresAt, LastSeenAt: row.LastSeenAt, User: u}, nil
}

// ExtendSession ต่ออายุเซสชันแบบเลื่อนไปเรื่อย ๆ
func (s *Store) ExtendSession(ctx context.Context, id string, expires time.Time) error {
	return s.w(ctx).Model(&SessionRow{}).Where("id = ?", id).
		Updates(map[string]any{"last_seen_at": time.Now().UTC(), "expires_at": expires}).Error
}

// DeleteSessionByTokenHash ลบเซสชันแล้วคืน user_id ของเจ้าของ (ErrNotFound ถ้าไม่มี)
func (s *Store) DeleteSessionByTokenHash(ctx context.Context, tokenHash []byte) (string, error) {
	var rows []SessionRow
	res := s.w(ctx).Clauses(clause.Returning{}).Where("token_hash = ?", tokenHash).Delete(&rows)
	if res.Error != nil {
		return "", res.Error
	}
	if len(rows) == 0 {
		return "", ErrNotFound
	}
	return rows[0].UserID, nil
}

func (s *Store) DeleteUserSessions(ctx context.Context, userID string) error {
	return s.w(ctx).Where("user_id = ?", userID).Delete(&SessionRow{}).Error
}

func (s *Store) PurgeExpiredSessions(ctx context.Context) (int64, error) {
	res := s.w(ctx).Where("expires_at <= now()").Delete(&SessionRow{})
	return res.RowsAffected, res.Error
}
