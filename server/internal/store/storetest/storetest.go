// Package storetest: ตัวช่วยสร้างฐานข้อมูลชั่วคราวสำหรับเทสต์ที่ใช้ Postgres จริง
//
// ตั้ง TEST_DATABASE_URL เป็น connection string ของ Postgres ที่มีสิทธิ์สร้างฐานข้อมูล เช่น
//
//	postgres://catquest:catquest_dev_password@127.0.0.1:5433/catquest?sslmode=disable
//
// (หลัง `docker compose up -d db`) — ถ้าไม่ตั้ง เทสต์ที่ต้องใช้ฐานข้อมูลจะถูกข้าม
package storetest

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"catquest-ro/server/internal/store"
)

// New สร้างฐานข้อมูลใหม่ + รัน migration แล้วลบทิ้งเมื่อเทสต์จบ
func New(t testing.TB) *store.Store {
	t.Helper()
	adminURL := os.Getenv("TEST_DATABASE_URL")
	if adminURL == "" {
		t.Skip("ไม่ได้ตั้ง TEST_DATABASE_URL — ข้ามเทสต์ที่ใช้ Postgres (docker compose up -d db)")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, adminURL)
	if err != nil {
		t.Fatalf("เชื่อมต่อ Postgres ไม่ได้: %v", err)
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	name := "catquest_test_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, `CREATE DATABASE `+name); err != nil {
		admin.Close(ctx)
		t.Fatalf("สร้างฐานข้อมูลทดสอบไม่ได้: %v", err)
	}
	u, err := url.Parse(adminURL)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	db, err := store.Open(ctx, u.String(), 10*time.Second)
	if err != nil {
		admin.Exec(ctx, `DROP DATABASE `+name+` WITH (FORCE)`) //nolint:errcheck
		admin.Close(ctx)
		t.Fatalf("เปิดฐานข้อมูลทดสอบไม่ได้: %v", err)
	}
	if err := db.Migrate(ctx); err != nil {
		db.Close()
		admin.Exec(ctx, `DROP DATABASE `+name+` WITH (FORCE)`) //nolint:errcheck
		admin.Close(ctx)
		t.Fatalf("migrate ล้มเหลว: %v", err)
	}
	t.Cleanup(func() {
		db.Close()
		admin.Exec(context.Background(), `DROP DATABASE `+name+` WITH (FORCE)`) //nolint:errcheck
		admin.Close(context.Background())
	})
	return db
}
