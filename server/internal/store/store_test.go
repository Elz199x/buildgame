package store_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
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
	storetest.SeedGame(t, db)
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
	storetest.SeedGame(t, db2)
	u3, _, err := db2.CreateUserWithCharacter(ctx, "carol", "h", false, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1})
	if err != nil || u3.Role != "player" {
		t.Fatalf("firstAdmin=false: %+v %v", u3, err)
	}
}

func TestSessions(t *testing.T) {
	db := storetest.New(t)
	storetest.SeedGame(t, db)
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
	storetest.SeedGame(t, db)
	ctx := context.Background()
	u, c, _ := db.CreateUserWithCharacter(ctx, "erin", "h", false, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1})
	state := json.RawMessage(`{"classId":"swordman","baseLv":50,"gold":1234,"learned":{"swBash":3,"ghostSkill":2},"weaponId":"sword_1h"}`)
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
	if err := json.Unmarshal(got.State, &m); err != nil || m["classId"] != "swordman" || m["weaponId"] != "sword_1h" {
		t.Fatalf("state: %s %v", got.State, err)
	}
	// สกิลที่เรียนอยู่ในตาราง character_skills (FK) ไม่ใช่ใน jsonb; สกิลที่ไม่มีในเกมถูกข้าม และประกอบกลับเข้า state ตอนอ่าน
	var nSkills int64
	if err := db.DB().Raw(`SELECT count(*) FROM character_skills WHERE character_id = ?`, c.ID).Scan(&nSkills).Error; err != nil || nSkills != 1 {
		t.Fatalf("character_skills ต้องมี 1 แถว (swBash) ได้ %d %v", nSkills, err)
	}
	if l, _ := m["learned"].(map[string]any); len(l) != 1 || l["swBash"] != float64(3) {
		t.Fatalf("learned ที่ประกอบกลับ: %v", m["learned"])
	}
	var raw struct{ State string }
	if err := db.DB().Raw(`SELECT state::text AS state FROM characters WHERE id = ?`, c.ID).Scan(&raw).Error; err != nil || strings.Contains(raw.State, "learned") || strings.Contains(raw.State, "classId") {
		t.Fatalf("state ใน DB ต้องไม่เก็บคีย์ที่ซ้ำกับคอลัมน์/ตารางลูก: %s %v", raw.State, err)
	}
	// อาชีพถูกอ้างโดยตัวละคร ลบไม่ได้
	if _, err := db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "classes", ID: "swordman", Delete: true}}}, nil); !errors.Is(err, store.ErrRefIntegrity) {
		t.Fatalf("ลบอาชีพที่มีตัวละครใช้ต้อง ErrRefIntegrity ได้ %v", err)
	}
	// ข้อจำกัดของฐานข้อมูลต้องกันค่าผิด (gold ติดลบ)
	if err := db.SaveCharacterState(ctx, c.ID, state, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1, Gold: -5}); err == nil {
		t.Fatal("gold ติดลบต้องถูกปฏิเสธโดย CHECK constraint")
	}
	if err := db.SaveCharacterState(ctx, "00000000-0000-0000-0000-000000000000", state, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1}); !errors.Is(err, store.ErrNotFound) {
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

func seedParts(t *testing.T) (map[string][]byte, map[string][]json.RawMessage) {
	t.Helper()
	cfg, tables, err := gamedata.SplitDoc(gamedata.Seed())
	if err != nil {
		t.Fatal(err)
	}
	out := map[string][]byte{}
	for k, v := range cfg {
		out[k] = v
	}
	return out, tables
}

func TestGameData(t *testing.T) {
	db := storetest.New(t)
	ctx := context.Background()
	if _, _, err := db.ActiveGameData(ctx); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("ตารางว่างต้องได้ ErrNotFound")
	}
	cfg, tables := seedParts(t)
	if err := db.SeedGameDataIfEmpty(ctx, cfg, tables); err != nil {
		t.Fatal(err)
	}
	if err := db.SeedGameDataIfEmpty(ctx, cfg, tables); err != nil { // ซ้ำต้องไม่เพิ่มแถว
		t.Fatal(err)
	}
	active, rows, err := db.ActiveGameData(ctx)
	if err != nil || len(active) != len(gamedata.Categories) {
		t.Fatalf("ต้องมีครบทุกหมวดเอกสาร: %d %v", len(active), err)
	}
	for _, tb := range gamedata.Tables {
		if len(rows[tb.Name]) != len(tables[tb.Name]) || len(rows[tb.Name]) == 0 {
			t.Fatalf("ตาราง %s ต้องมีครบทุกรายการ: %d/%d", tb.Name, len(rows[tb.Name]), len(tables[tb.Name]))
		}
	}
	parts := map[string][]byte{}
	for k, r := range active {
		parts[k] = r.Data
	}
	items := map[string][]json.RawMessage{}
	for k, rs := range rows {
		for _, r := range rs {
			items[k] = append(items[k], r.Data)
		}
	}
	raw, _ := gamedata.ComposeDoc(parts, items)
	if _, err := gamedata.Parse(raw); err != nil {
		t.Fatalf("ข้อมูลที่ประกอบกลับจาก DB ต้อง parse ได้: %v", err)
	}

	// ---- หมวดเอกสาร: If-Match / validate / เก็บ 50 เวอร์ชัน ----
	w1 := active["world"].ID
	res, err := db.SaveGameData(ctx, store.SaveInput{Config: map[string][]byte{"world": active["world"].Data}, ConfigExpect: map[string]int64{"world": w1}, Note: "edit"}, nil)
	if err != nil || res.ConfigIDs["world"] <= w1 {
		t.Fatalf("save: %v %v", res, err)
	}
	if _, err := db.SaveGameData(ctx, store.SaveInput{Config: map[string][]byte{"world": active["world"].Data}, ConfigExpect: map[string]int64{"world": w1}}, nil); !errors.Is(err, store.ErrConfigConflict) {
		t.Fatalf("expect เก่าต้อง ErrConfigConflict ได้ %v", err)
	}
	bad := errors.New("ไม่สอดคล้อง")
	before, _ := db.ListGameConfigVersions(ctx, "", 1000)
	if _, err := db.SaveGameData(ctx, store.SaveInput{Config: map[string][]byte{"balance": active["balance"].Data}}, func(map[string][]byte, map[string][]json.RawMessage) error { return bad }); !errors.Is(err, bad) {
		t.Fatalf("ต้องคืน error จาก validate ได้ %v", err)
	}
	if after, _ := db.ListGameConfigVersions(ctx, "", 1000); len(after) != len(before) {
		t.Fatal("validate ล้มเหลวห้ามเพิ่มแถว")
	}
	for i := 0; i < 55; i++ {
		if _, err := db.SaveGameData(ctx, store.SaveInput{Config: map[string][]byte{"world": active["world"].Data}, Note: "bulk"}, nil); err != nil {
			t.Fatal(err)
		}
	}
	if vs, _ := db.ListGameConfigVersions(ctx, "world", 200); len(vs) != 50 {
		t.Fatalf("world ต้องเหลือ 50 เวอร์ชัน ได้ %d", len(vs))
	}

	// ---- ตารางรายการ: version ต่อแถว, FK, ประวัติ ----
	var bash store.TableRow
	for _, r := range rows["skills"] {
		if r.ID == "swBash" {
			bash = r
		}
	}
	if bash.ID == "" || bash.Version != 1 {
		t.Fatalf("ต้องมีสกิล swBash เวอร์ชัน 1: %+v", bash)
	}
	rename := func(name string) []byte {
		var m map[string]any
		_ = json.Unmarshal(bash.Data, &m)
		m["name"] = name
		b, _ := json.Marshal(m)
		return b
	}
	one := int64(1)
	res, err = db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "skills", ID: "swBash", Data: rename("ทดสอบ"), Expect: &one}}, Note: "rename"}, nil)
	if err != nil || res.RowIDs["skills/swBash"] != 2 {
		t.Fatalf("แก้สกิลต้องได้เวอร์ชัน 2: %v %v", res.RowIDs, err)
	}
	if _, err := db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "skills", ID: "swBash", Data: rename("อื่น"), Expect: &one}}}, nil); !errors.Is(err, store.ErrConfigConflict) {
		t.Fatalf("If-Match เก่าต้อง ErrConfigConflict ได้ %v", err)
	}
	res, err = db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "skills", ID: "swBash", Data: rename("ทดสอบ")}}}, nil)
	if err != nil || res.RowIDs["skills/swBash"] != 2 {
		t.Fatalf("ข้อมูลเหมือนเดิมต้องไม่เพิ่มเวอร์ชัน: %v %v", res.RowIDs, err)
	}
	// FK: สกิลชี้อาชีพที่ไม่มี / ลบอาชีพที่ยังมีสกิล
	var ghost map[string]any
	_ = json.Unmarshal(bash.Data, &ghost)
	ghost["id"], ghost["class"] = "zzGhost", "no_such_class"
	gb, _ := json.Marshal(ghost)
	zero := int64(0)
	if _, err := db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "skills", ID: "zzGhost", Data: gb, Expect: &zero}}}, nil); !errors.Is(err, store.ErrRefIntegrity) {
		t.Fatalf("สกิลที่ชี้อาชีพไม่มีต้อง ErrRefIntegrity ได้ %v", err)
	}
	if _, err := db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "classes", ID: "swordman", Delete: true}}}, nil); !errors.Is(err, store.ErrRefIntegrity) {
		t.Fatalf("ลบอาชีพที่ยังมีสกิลต้อง ErrRefIntegrity ได้ %v", err)
	}
	// สร้าง (ต้องยังไม่มี) แล้วสร้างซ้ำ = ชน แล้วลบ
	ghost["class"] = "swordman"
	gb, _ = json.Marshal(ghost)
	if _, err := db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "skills", ID: "zzGhost", Data: gb, Expect: &zero}}}, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "skills", ID: "zzGhost", Data: gb, Expect: &zero}}}, nil); !errors.Is(err, store.ErrConfigConflict) {
		t.Fatalf("สร้างซ้ำต้อง ErrConfigConflict ได้ %v", err)
	}
	if _, err := db.SaveGameData(ctx, store.SaveInput{Ops: []store.TableOp{{Table: "skills", ID: "zzGhost", Delete: true}}}, nil); err != nil {
		t.Fatal(err)
	}
	// ประวัติ: swBash มี create (seed) + update และกู้สถานะเดิมได้
	hist, err := db.ListAudit(ctx, "skills", "swBash", 10)
	if err != nil || len(hist) != 2 || hist[0].Action != "update" || hist[1].Action != "create" {
		t.Fatalf("ประวัติ swBash: %+v %v", hist, err)
	}
	snap, err := db.AuditSnapshot(ctx, "skills", "swBash", hist[1].ID)
	if err != nil || !bytes.Contains(bytes.ReplaceAll(snap, []byte(" "), nil), []byte(`"id":"swBash"`)) {
		t.Fatalf("AuditSnapshot: %s %v", snap, err)
	}
	// หมวดเอกสารไม่ถูกกระทบจากการแก้ตาราง
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
