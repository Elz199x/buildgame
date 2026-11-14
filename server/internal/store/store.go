// Package store คือชั้นเข้าถึงฐานข้อมูล Postgres ผ่าน GORM (ผู้ใช้ เซสชัน ตัวละคร ข้อมูลเกม แชท)
//
// สคีมาถูกกำหนดโดยไฟล์ SQL ใน migrations/ (แหล่งความจริงเดียว) — GORM ใช้เพื่อ query/บันทึกเท่านั้น ไม่ใช้ AutoMigrate
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"catquest-ro/server/migrations"
)

var (
	ErrNotFound = errors.New("ไม่พบข้อมูล")
	ErrConflict = errors.New("ข้อมูลซ้ำ")
)

type Store struct {
	db *gorm.DB
}

// Open เชื่อมต่อฐานข้อมูล (รอได้สูงสุด wait เพื่อให้ container ฐานข้อมูลพร้อมก่อน)
func Open(ctx context.Context, url string, wait time.Duration) (*Store, error) {
	cfg := &gorm.Config{
		Logger:                 logger.New(slogWriter{}, logger.Config{SlowThreshold: 500 * time.Millisecond, LogLevel: logger.Warn, IgnoreRecordNotFoundError: true, ParameterizedQueries: true}),
		SkipDefaultTransaction: true, // คำสั่งเดี่ยวไม่ต้องห่อ transaction (เร็วขึ้น); ใช้ Transaction() ชัดเจนเมื่อจำเป็น
		PrepareStmt:            false,
		NowFunc:                func() time.Time { return time.Now().UTC() },
	}
	deadline := time.Now().Add(wait)
	for {
		db, err := gorm.Open(postgres.Open(url), cfg)
		if err == nil {
			var sd *sql.DB
			if sd, err = db.DB(); err == nil {
				pctx, cancel := context.WithTimeout(ctx, 3*time.Second)
				err = sd.PingContext(pctx)
				cancel()
				if err == nil {
					sd.SetMaxOpenConns(10)
					sd.SetMaxIdleConns(2)
					sd.SetConnMaxLifetime(time.Hour)
					sd.SetConnMaxIdleTime(15 * time.Minute)
					return &Store{db: db}, nil
				}
				_ = sd.Close()
			}
		}
		if time.Now().After(deadline) || ctx.Err() != nil {
			return nil, fmt.Errorf("เชื่อมต่อฐานข้อมูลไม่ได้: %w", err)
		}
		time.Sleep(time.Second)
	}
}

type slogWriter struct{}

func (slogWriter) Printf(format string, args ...any) {
	slog.Warn(fmt.Sprintf(strings.TrimSpace(format), args...))
}

func (s *Store) Close() {
	if sd, err := s.db.DB(); err == nil {
		_ = sd.Close()
	}
}

func (s *Store) Ping(ctx context.Context) error {
	sd, err := s.db.DB()
	if err != nil {
		return err
	}
	return sd.PingContext(ctx)
}

// DB สำหรับเทสต์/งานพิเศษ
func (s *Store) DB() *gorm.DB { return s.db }

func (s *Store) w(ctx context.Context) *gorm.DB { return s.db.WithContext(ctx) }

// Migrate รันไฟล์ migrations/*.sql ที่ยังไม่เคยรัน (แต่ละไฟล์อยู่ใน transaction เดียวและบันทึกตัวเองลง schema_migrations)
func (s *Store) Migrate(ctx context.Context) error {
	return s.w(ctx).Connection(func(c *gorm.DB) error {
		if err := c.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`).Error; err != nil {
			return err
		}
		// กันรัน migration พร้อมกันจากหลายอินสแตนซ์ (ล็อกระดับ session บน connection นี้)
		if err := c.Exec(`SELECT pg_advisory_lock(727274)`).Error; err != nil {
			return err
		}
		defer c.Exec(`SELECT pg_advisory_unlock(727274)`) //nolint:errcheck

		var done []string
		if err := c.Raw(`SELECT version FROM schema_migrations`).Scan(&done).Error; err != nil {
			return err
		}
		applied := map[string]bool{}
		for _, v := range done {
			applied[v] = true
		}
		entries, err := fs.ReadDir(migrations.FS, ".")
		if err != nil {
			return err
		}
		var files []string
		for _, e := range entries {
			if strings.HasSuffix(e.Name(), ".sql") {
				files = append(files, e.Name())
			}
		}
		sort.Strings(files)
		for _, f := range files {
			version := strings.TrimSuffix(f, ".sql")
			if applied[version] {
				continue
			}
			text, err := fs.ReadFile(migrations.FS, f)
			if err != nil {
				return err
			}
			if err := c.Transaction(func(tx *gorm.DB) error {
				if err := tx.Exec(string(text)).Error; err != nil {
					return err
				}
				return tx.Exec(`INSERT INTO schema_migrations (version) VALUES (?) ON CONFLICT DO NOTHING`, version).Error
			}); err != nil {
				return fmt.Errorf("migration %s ล้มเหลว: %w", f, err)
			}
			slog.Info("รัน migration", "version", version)
		}
		return nil
	})
}

// isUnique ตรวจว่าเป็นข้อผิดพลาด unique violation (23505)
func isUnique(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func notFound(err error) error {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ErrNotFound
	}
	return err
}
