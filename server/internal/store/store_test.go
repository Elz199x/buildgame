package store_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/store"
	"catquest-ro/server/internal/store/storetest"
)

func TestMigrateIsIdempotent(t *testing.T) {
	db := storetest.New(t)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := db.Migrate(ctx); err != nil {
			t.Fatalf("migrate ครั้งที่ %d: %v", i+2, err)
		}
	}
	var n int
	if err := db.DB().Raw(`SELECT count(*) FROM schema_migrations`).Scan(&n).Error; err != nil || n < 2 {
		t.Fatalf("schema_migrations: n=%d err=%v", n, err)
	}
}

func TestUsersAndFirstAdmin(t *testing.T) {
	db := storetest.New(t)
	ctx := context.Background()
	u1, c1, err := db.CreateUserWithCharacter(ctx, "Alice", "hash1", true, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1})
	if err != nil {
		t.Fatal(err)
	}
	if u1.Role != "admin" || c1.Name != "Alice" || c1.UserID != u1.ID {
		t.Fatalf("ผู้ใช้แรกต้องเป็น admin: %+v %+v", u1, c1)
	}
	u2, _, err := db.CreateUserWithCharacter(ctx, "bob", "hash2", true, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1})
	if err != nil || u2.Role != "player" {
		t.Fatalf("คนที่สองต้องเป็น player: %+v %v", u2, err)
	}
	// ชื่อซ้ำแบบไม่สนตัวพิมพ์ต้องถูกปฏิเสธ และไม่ทิ้งแถวค้าง
	if _, _, err := db.CreateUserWithCharacter(ctx, "ALICE", "x", true, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1}); !errors.Is(err, store.ErrConflict) {
		t.Fatalf("ต้องได้ ErrConflict: %v", err)
	}
	if n, _ := db.CountUsers(ctx); n != 2 {
		t.Fatalf("จำนวนผู้ใช้ต้องเป็น 2 ได้ %d", n)
	}
	got, err := db.UserByUsername(ctx, "aLiCe")
	if err != nil || got.ID != u1.ID || got.PasswordHash != "hash1" {
		t.Fatalf("ค้นหาแบบไม่สนตัวพิมพ์: %+v %v", got, err)
	}
	if _, err := db.UserByUsername(ctx, "nobody"); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("ต้องได้ ErrNotFound")
	}
	// firstAdmin=false ห้ามได้ admin แม้เป็นคนแรก
	db2 := storetest.New(t)
	u3, _, err := db2.CreateUserWithCharacter(ctx, "carol", "h", false, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1})
	if err != nil || u3.Role != "player" {
		t.Fatalf("firstAdmin=false: %+v %v", u3, err)
	}
}

func TestSessions(t *testing.T) {
	db := storetest.New(t)
	ctx := context.Background()
	u, _, _ := db.CreateUserWithCharacter(ctx, "dave", "h", false, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1})
	hash := []byte("0123456789abcdef0123456789abcdef")
	if err := db.CreateSession(ctx, u.ID, hash, time.Now().Add(time.Hour), "203.0.113.9", "test-agent"); err != nil {
		t.Fatal(err)
	}
	s, err := db.SessionByTokenHash(ctx, hash)
	if err != nil || s.User.Username != "dave" {
		t.Fatalf("session: %+v %v", s, err)
	}
	// หมดอายุแล้วต้องไม่คืน
	exp := []byte("expiredexpiredexpiredexpiredexp!")
	_ = db.CreateSession(ctx, u.ID, exp, time.Now().Add(-time.Minute), "", "")
	if _, err := db.SessionByTokenHash(ctx, exp); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("เซสชันหมดอายุต้องไม่ผ่าน")
	}
	if n, _ := db.PurgeExpiredSessions(ctx); n != 1 {
		t.Fatalf("purge ต้องลบ 1 ได้ %d", n)
	}
	// ปิดบัญชี → เซสชันใช้ไม่ได้
	if err := db.DB().Exec(`UPDATE users SET disabled = true WHERE id = ?`, u.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := db.SessionByTokenHash(ctx, hash); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("ผู้ใช้ที่ปิดบัญชีต้องใช้เซสชันไม่ได้")
	}
	_ = db.DB().Exec(`UPDATE users SET disabled = false WHERE id = ?`, u.ID).Error
	if uid, err := db.DeleteSessionByTokenHash(ctx, hash); err != nil || uid != u.ID {
		t.Fatalf("delete: %v %v", uid, err)
	}
	if _, err := db.SessionByTokenHash(ctx, hash); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("ลบแล้วต้องไม่พบ")
	}
}

func TestCharacterState(t *testing.T) {
	db := storetest.New(t)
	ctx := context.Background()
	u, c, _ := db.CreateUserWithCharacter(ctx, "erin", "h", false, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1})
	state := json.RawMessage(`{"classId":"swordman","baseLv":50,"gold":1234,"learned":{"swBash":3}}`)
	if err := db.SaveCharacterState(ctx, c.ID, state, store.StateColumns{ClassID: "swordman", BaseLv: 50, JobLv: 25, BaseExp: 10, JobExp: 5, Gold: 1234}); err != nil {
		t.Fatal(err)
	}
	got, err := db.CharacterByUser(ctx, u.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ClassID != "swordman" || got.Gold != 1234 || got.JobLv != 25 {
		t.Fatalf("คอลัมน์ไม่ซิงก์: %+v", got)
	}
	var m map[string]any
	if err := json.Unmarshal(got.State, &m); err != nil || m["classId"] != "swordman" {
		t.Fatalf("state: %s %v", got.State, err)
	}
	// ข้อจำกัดของฐานข้อมูลต้องกันค่าผิด (gold ติดลบ)
	if err := db.SaveCharacterState(ctx, c.ID, state, store.StateColumns{ClassID: "x", BaseLv: 1, JobLv: 1, Gold: -5}); err == nil {
		t.Fatal("gold ติดลบต้องถูกปฏิเสธโดย CHECK constraint")
	}
	if err := db.SaveCharacterState(ctx, "00000000-0000-0000-0000-000000000000", state, store.StateColumns{ClassID: "x", BaseLv: 1, JobLv: 1}); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("ไม่พบตัวละครต้องได้ ErrNotFound: %v", err)
	}
	if err := db.SaveCharacterPosition(ctx, c.ID, "map_prontera", 700, 800); err != nil {
		t.Fatal(err)
	}
	got, _ = db.CharacterByUser(ctx, u.ID)
	if got.PosX != 700 || got.PosY != 800 {
		t.Fatalf("ตำแหน่ง: %v,%v", got.PosX, got.PosY)
	}
}

func TestGameConfigVersions(t *testing.T) {
	db := storetest.New(t)
	ctx := context.Background()
	if _, err := db.ActiveGameConfig(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("ตารางว่างต้องได้ ErrNotFound")
	}
	split, err := gamedata.SplitDoc(gamedata.Seed())
	if err != nil {
		t.Fatal(err)
	}
	seed := map[string][]byte{}
	for k, v := range split {
		seed[k] = v
	}
	if err := db.SeedGameConfigIfEmpty(ctx, seed); err != nil {
		t.Fatal(err)
	}
	if err := db.SeedGameConfigIfEmpty(ctx, seed); err != nil { // ซ้ำต้องไม่เพิ่มแถว
		t.Fatal(err)
	}
	active, err := db.ActiveGameConfig(ctx)
	if err != nil || len(active) != len(gamedata.Categories) {
		t.Fatalf("ต้องมีครบทุกหมวด: %d %v", len(active), err)
	}
	parts := map[string][]byte{}
	for k, r := range active {
		parts[k] = r.Data
	}
	raw, _ := gamedata.ComposeDoc(parts)
	if _, err := gamedata.Parse(raw); err != nil {
		t.Fatalf("ข้อมูลที่ประกอบกลับจาก JSONB ต้อง parse ได้: %v", err)
	}
	all, _ := db.ListGameConfigVersions(ctx, "", 100)
	if len(all) != len(gamedata.Categories) {
		t.Fatalf("seed ต้องได้หมวดละ 1 เวอร์ชัน ได้ %d", len(all))
	}

	// เขียนเฉพาะหมวดที่แก้ + ตรวจ If-Match
	w1 := active["world"].ID
	ids, err := db.SaveGameConfig(ctx, map[string][]byte{"world": active["world"].Data}, map[string]int64{"world": w1}, "edit", "", nil)
	if err != nil || len(ids) != 1 || ids["world"] <= w1 {
		t.Fatalf("save: %v %v", ids, err)
	}
	if _, err := db.SaveGameConfig(ctx, map[string][]byte{"world": active["world"].Data}, map[string]int64{"world": w1}, "stale", "", nil); !errors.Is(err, store.ErrConfigConflict) {
		t.Fatalf("expect เก่าต้อง ErrConfigConflict ได้ %v", err)
	}
	// validate ไม่ผ่านต้องไม่บันทึกอะไร
	before, _ := db.ListGameConfigVersions(ctx, "", 1000)
	bad := errors.New("ไม่สอดคล้อง")
	if _, err := db.SaveGameConfig(ctx, map[string][]byte{"balance": active["balance"].Data}, nil, "x", "", func(map[string][]byte) error { return bad }); !errors.Is(err, bad) {
		t.Fatalf("ต้องคืน error จาก validate ได้ %v", err)
	}
	if after, _ := db.ListGameConfigVersions(ctx, "", 1000); len(after) != len(before) {
		t.Fatal("validate ล้มเหลวห้ามเพิ่มแถว")
	}
	if _, err := db.GameConfigVersion(ctx, "balance", w1); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("เวอร์ชันของหมวดอื่นต้องไม่พบ")
	}
	// เก็บเพียง 50 เวอร์ชันล่าสุดต่อหมวด และไม่กระทบหมวดอื่น
	for i := 0; i < 55; i++ {
		if _, err := db.SaveGameConfig(ctx, map[string][]byte{"world": active["world"].Data}, nil, "bulk", "", nil); err != nil {
			t.Fatal(err)
		}
	}
	if vs, _ := db.ListGameConfigVersions(ctx, "world", 200); len(vs) != 50 {
		t.Fatalf("world ต้องเหลือ 50 เวอร์ชัน ได้ %d", len(vs))
	}
	if vs, _ := db.ListGameConfigVersions(ctx, "balance", 200); len(vs) != 1 {
		t.Fatalf("balance ต้องไม่ถูกกระทบ ได้ %d", len(vs))
	}
}

func TestChat(t *testing.T) {
	db := storetest.New(t)
	ctx := context.Background()
	for i := 0; i < 5; i++ {
		if err := db.InsertChat(ctx, 0, "", "System", "ข้อความ "+string(rune('A'+i))); err != nil {
			t.Fatal(err)
		}
	}
	msgs, err := db.RecentChat(ctx, 3)
	if err != nil || len(msgs) != 3 || msgs[0].Body != "ข้อความ C" || msgs[2].Body != "ข้อความ E" {
		t.Fatalf("ต้องได้ 3 ข้อความล่าสุดเรียงเก่า→ใหม่: %+v %v", msgs, err)
	}
	if n, err := db.PurgeOldChat(ctx, time.Hour); err != nil || n != 0 {
		t.Fatalf("ยังไม่มีข้อความเก่า: %d %v", n, err)
	}
	_ = db.DB().Exec(`UPDATE chat_messages SET created_at = now() - interval '2 hours'`).Error
	if n, _ := db.PurgeOldChat(ctx, time.Hour); n != 5 {
		t.Fatalf("ต้องลบ 5 ได้ %d", n)
	}
}
