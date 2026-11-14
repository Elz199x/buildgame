package httpapi_test

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"catquest-ro/server/internal/auth"
	"catquest-ro/server/internal/config"
	"catquest-ro/server/internal/game"
	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/httpapi"
	"catquest-ro/server/internal/protocol"
	"catquest-ro/server/internal/realtime"
	"catquest-ro/server/internal/sim"
	"catquest-ro/server/internal/store"
	"catquest-ro/server/internal/store/storetest"
)

const goodOrigin = "http://localhost:3000"

type env struct {
	api   *httpapi.Server
	t     *testing.T
	ts    *httptest.Server
	db    *store.Store
	world *game.World
	hub   *realtime.Hub
	data  *httpapi.DataManager
}

func newEnv(t *testing.T) *env {
	t.Helper()
	db := storetest.New(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	dm, err := httpapi.NewDataManager(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	d, _, _ := dm.Current()
	world := game.NewWorld(d)
	dm.SetOnChange(world.SetData)
	cfg := config.Config{
		Env: "development", AllowedOrigins: []string{goodOrigin}, SessionTTL: 24 * time.Hour,
		FirstUserIsAdmin: true, MaxClients: 3, Argon: auth.Params{Memory: 8 * 1024, Time: 1, Threads: 1},
	}
	hub := realtime.NewHub(world, db, cfg.MaxClients, cfg.AllowedOrigins)
	go hub.Run(ctx)
	go hub.RunLoop(ctx)
	go hub.SaveLoop(ctx)
	api := httpapi.New(httpapi.Deps{Cfg: cfg, DB: db, Hub: hub, World: world, Data: dm})
	ts := httptest.NewServer(api.Handler())
	t.Cleanup(ts.Close)
	return &env{t: t, api: api, ts: ts, db: db, world: world, hub: hub, data: dm}
}

type client struct {
	e   *env
	c   *http.Client
	jar *cookiejar.Jar
}

func (e *env) client() *client {
	jar, _ := cookiejar.New(nil)
	return &client{e: e, c: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, jar: jar}
}

func (c *client) do(method, path string, body any, hdr map[string]string) (int, []byte, http.Header) {
	c.e.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	case []byte:
		rd = bytes.NewReader(b)
	default:
		j, _ := json.Marshal(b)
		rd = bytes.NewReader(j)
	}
	req, _ := http.NewRequest(method, c.e.ts.URL+path, rd)
	if rd != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := c.c.Do(req)
	if err != nil {
		c.e.t.Fatal(err)
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, out, resp.Header
}

func (c *client) register(user, pw string) int {
	c.e.t.Helper()
	st, _, _ := c.do("POST", "/api/auth/register", map[string]string{"username": user, "password": pw}, nil)
	return st
}

func (c *client) mustRegister(user string) {
	c.e.t.Helper()
	if st := c.register(user, "password-123"); st != 201 {
		c.e.t.Fatalf("สมัคร %s ได้ %d", user, st)
	}
}

func jsonField(t *testing.T, raw []byte, path ...string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatalf("JSON: %s", raw)
	}
	for _, p := range path {
		m, ok := v.(map[string]any)
		if !ok {
			t.Fatalf("ไม่มี %v ใน %s", path, raw)
		}
		v = m[p]
	}
	return v
}

func TestRegisterLoginLogout(t *testing.T) {
	e := newEnv(t)
	c := e.client()

	if st, _, _ := c.do("GET", "/api/auth/me", nil, nil); st != 401 {
		t.Fatalf("ยังไม่ล็อกอินต้อง 401 ได้ %d", st)
	}
	for name, body := range map[string]map[string]string{
		"ชื่อสั้นเกิน":     {"username": "ab", "password": "password-123"},
		"ชื่อมีอักขระแปลก": {"username": "bad name!", "password": "password-123"},
		"รหัสสั้น":         {"username": "alice", "password": "short"},
		"รหัสเท่าชื่อ":     {"username": "alicealice", "password": "alicealice"},
	} {
		if st, _, _ := c.do("POST", "/api/auth/register", body, nil); st != 400 {
			t.Errorf("%s: ต้อง 400 ได้ %d", name, st)
		}
	}
	// ฟิลด์แปลกปลอมถูกปฏิเสธ (strict)
	if st, _, _ := c.do("POST", "/api/auth/register", `{"username":"alice","password":"password-123","role":"admin"}`, nil); st != 400 {
		t.Fatalf("ฟิลด์ role ต้องถูกปฏิเสธ ได้ %d", st)
	}

	st, body, hdr := c.do("POST", "/api/auth/register", map[string]string{"username": "Alice", "password": "password-123"}, nil)
	if st != 201 {
		t.Fatalf("สมัครไม่ผ่าน: %d %s", st, body)
	}
	ck := hdr.Get("Set-Cookie")
	if !strings.Contains(ck, "cq_session=") || !strings.Contains(ck, "HttpOnly") || !strings.Contains(ck, "SameSite=Lax") {
		t.Fatalf("cookie ต้อง HttpOnly + SameSite=Lax: %s", ck)
	}
	if jsonField(t, body, "user", "role") != "admin" || jsonField(t, body, "character", "name") != "Alice" {
		t.Fatalf("ผู้ใช้แรกต้องเป็น admin และมีตัวละคร: %s", body)
	}
	if strings.Contains(string(body), "password") {
		t.Fatal("ห้ามส่งข้อมูลรหัสผ่านกลับ")
	}
	if st, _, _ := c.do("GET", "/api/auth/me", nil, nil); st != 200 {
		t.Fatalf("หลังสมัครต้อง me ได้: %d", st)
	}
	if st := e.client().register("ALICE", "password-123"); st != 409 {
		t.Fatalf("ชื่อซ้ำ (ไม่สนตัวพิมพ์) ต้อง 409 ได้ %d", st)
	}

	// เก็บ cookie ไว้ทดสอบว่าถูกเพิกถอนฝั่งเซิร์ฟเวอร์จริง
	u := c.e.ts.URL
	var saved *http.Cookie
	for _, k := range c.jar.Cookies(mustURL(u)) {
		if k.Name == "cq_session" {
			saved = k
		}
	}
	if saved == nil {
		t.Fatal("ไม่พบ cookie")
	}
	if st, _, h := c.do("POST", "/api/auth/logout", nil, nil); st != 204 || !strings.Contains(h.Get("Set-Cookie"), "Max-Age=0") {
		t.Fatalf("logout: %d %v", st, h)
	}
	if st, _, _ := c.do("GET", "/api/auth/me", nil, nil); st != 401 {
		t.Fatalf("หลัง logout ต้อง 401 ได้ %d", st)
	}
	req, _ := http.NewRequest("GET", u+"/api/auth/me", nil)
	req.AddCookie(saved)
	resp, _ := http.DefaultClient.Do(req)
	if resp.StatusCode != 401 {
		t.Fatalf("cookie เก่าต้องใช้ไม่ได้อีก (เพิกถอนฝั่งเซิร์ฟเวอร์) ได้ %d", resp.StatusCode)
	}

	// ล็อกอิน: ข้อความผิดพลาดต้องเหมือนกันทั้ง "ไม่มีผู้ใช้" และ "รหัสผิด" (กันเดาชื่อผู้ใช้)
	_, b1, _ := c.do("POST", "/api/auth/login", map[string]string{"username": "alice", "password": "wrong-password"}, nil)
	st2, b2, _ := c.do("POST", "/api/auth/login", map[string]string{"username": "ghost", "password": "wrong-password"}, nil)
	if st2 != 401 || string(b1) != string(b2) {
		t.Fatalf("ต้องตอบเหมือนกัน: %s | %s", b1, b2)
	}
	if st, body, _ := c.do("POST", "/api/auth/login", map[string]string{"username": "aLiCe", "password": "password-123"}, nil); st != 200 || jsonField(t, body, "user", "username") != "Alice" {
		t.Fatalf("login: %d %s", st, body)
	}
	if st, _, _ := c.do("GET", "/api/auth/me", nil, nil); st != 200 {
		t.Fatal("login แล้วต้อง me ได้")
	}
}

func mustURL(s string) *urlT { u, _ := urlParse(s); return u }

func TestProtectedEndpointsRequireLogin(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	for _, ep := range [][2]string{
		{"GET", "/api/data"}, {"PUT", "/api/data"}, {"GET", "/api/data/versions"},
		{"GET", "/api/characters/me"}, {"PUT", "/api/characters/me/state"}, {"GET", "/api/players"}, {"GET", "/api/chat/recent"},
		{"POST", "/api/sim/stats"}, {"POST", "/api/sim/benchmark"}, {"POST", "/api/sim/builds"}, {"POST", "/api/sim/skills"}, {"GET", "/ws"},
	} {
		if st, _, _ := c.do(ep[0], ep[1], "{}", nil); st != 401 {
			t.Errorf("%s %s ต้อง 401 ได้ %d", ep[0], ep[1], st)
		}
	}
	if st, body, _ := c.do("GET", "/api/health", nil, nil); st != 200 || jsonField(t, body, "db") != true {
		t.Fatalf("health เปิดสาธารณะและต้องเช็กฐานข้อมูล: %d %s", st, body)
	}
}

type dataMeta struct {
	Versions map[string]int64            `json:"versions"`
	Tables   map[string]map[string]int64 `json:"tables"`
}

func readMeta(t *testing.T, raw []byte) dataMeta {
	t.Helper()
	var doc struct {
		Meta dataMeta `json:"_meta"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil || len(doc.Meta.Versions) == 0 || len(doc.Meta.Tables["skills"]) == 0 {
		t.Fatalf("ต้องมี _meta.versions และ _meta.tables: %v", err)
	}
	return doc.Meta
}

func TestGameDataAdminOnlyAndVersioning(t *testing.T) {
	e := newEnv(t)
	admin, player := e.client(), e.client()
	admin.mustRegister("boss") // คนแรก = admin
	player.mustRegister("pawn")

	st, raw, hdr := player.do("GET", "/api/data", nil, nil)
	if st != 200 || hdr.Get("ETag") == "" || jsonField(t, raw, "monsters") == nil {
		t.Fatalf("ผู้เล่นทั่วไปอ่านข้อมูลเกมได้: %d", st)
	}
	etag := hdr.Get("ETag")
	m1 := readMeta(t, raw)
	if st, _, _ := player.do("GET", "/api/data", nil, map[string]string{"If-None-Match": etag}); st != 304 {
		t.Fatalf("ETag ต้องให้ 304 ได้ %d", st)
	}
	for _, p := range [][2]string{{"PUT", "/api/data"}, {"PUT", "/api/data/world"}, {"GET", "/api/data/versions"}, {"POST", "/api/data/rollback/world/1"},
		{"PUT", "/api/tables/skills/swBash"}, {"DELETE", "/api/tables/skills/swBash"}, {"GET", "/api/tables/skills/swBash/history"}} {
		if st, _, _ := player.do(p[0], p[1], string(raw), nil); st != 403 {
			t.Errorf("ผู้เล่นทั่วไป %s %s ต้อง 403 ได้ %d", p[0], p[1], st)
		}
	}
	// ข้อมูลเสียต้องถูกปฏิเสธและไม่เปลี่ยนอะไร
	for name, body := range map[string]string{"ไม่ใช่ JSON": `{`, "ขาดหมวด": `{"classes":[]}`, "คีย์ที่ไม่รู้จัก": `{"hack":1}`} {
		if st, _, _ := admin.do("PUT", "/api/data", body, nil); st != 400 {
			t.Errorf("%s: ต้อง 400 ได้ %d", name, st)
		}
	}
	if st, _, _ := admin.do("PUT", "/api/data/nope", `{}`, map[string]string{"If-Match": "1"}); st != 404 {
		t.Errorf("หมวดที่ไม่มีต้อง 404 ได้ %d", st)
	}
	if st, _, _ := admin.do("PUT", "/api/data/world", `{}`, nil); st != 428 {
		t.Errorf("ไม่ส่ง If-Match ต้อง 428 ได้ %d", st)
	}
	ifm := func(v int64) map[string]string { return map[string]string{"If-Match": itoa(int(v))} }
	if st, _, _ := admin.do("PUT", "/api/data/world", `{"classes":[]}`, ifm(m1.Versions["world"])); st != 400 {
		t.Errorf("คีย์ผิดหมวดต้อง 400 ได้ %d", st)
	}
	if st, _, _ := admin.do("PUT", "/api/data/world", `{"worldMap":{}}`, ifm(m1.Versions["world"])); st != 400 {
		t.Errorf("ข้อมูลหมวดที่ทำให้ระบบไม่สอดคล้องต้อง 400 ได้ %d", st)
	}
	_, _, h2 := admin.do("GET", "/api/data", nil, nil)
	if h2.Get("ETag") != etag {
		t.Fatal("ข้อมูลเสียห้ามเปลี่ยนเวอร์ชัน")
	}

	// ---- หมวดเอกสาร world: แก้ → เวอร์ชันใหม่เฉพาะหมวดนั้น + โลกเกมโหลดใหม่ทันที ----
	var doc map[string]any
	_ = json.Unmarshal(raw, &doc)
	wm := doc["worldMap"].(map[string]any)
	wm["currentMapId"] = "none"
	wm["spawns"] = wm["spawns"].([]any)[:2]
	edited, _ := json.Marshal(map[string]any{"worldMap": wm})
	if st, body, _ := admin.do("PUT", "/api/data/world?note=trim+spawns", edited, ifm(m1.Versions["world"])); st != 200 {
		t.Fatalf("admin แก้ข้อมูลไม่ได้: %d %s", st, body)
	}
	if _, _, mobs, _ := e.world.Counts(); mobs != 2 {
		t.Fatalf("โลกเกมต้องมี 2 มอนสเตอร์ ได้ %d", mobs)
	}
	if st, _, _ := admin.do("PUT", "/api/data/world", edited, ifm(m1.Versions["world"])); st != 409 {
		t.Fatalf("If-Match เก่าต้อง 409 ได้ %d", st)
	}
	_, raw3, h3 := player.do("GET", "/api/data", nil, nil)
	if h3.Get("ETag") == etag {
		t.Fatal("ETag ต้องเปลี่ยนตามเนื้อหา")
	}
	m3 := readMeta(t, raw3)
	if m3.Versions["world"] <= m1.Versions["world"] {
		t.Fatalf("world ต้องได้เวอร์ชันใหม่: %v -> %v", m1.Versions, m3.Versions)
	}
	for _, cat := range []string{"balance", "entities", "tools"} {
		if m3.Versions[cat] != m1.Versions[cat] {
			t.Fatalf("หมวด %s ต้องไม่ถูกกระทบ: %v -> %v", cat, m1.Versions[cat], m3.Versions[cat])
		}
	}
	_, vraw, _ := admin.do("GET", "/api/data/versions?category=world", nil, nil)
	var versions []map[string]any
	_ = json.Unmarshal(vraw, &versions)
	if len(versions) != 2 || versions[0]["note"] != "trim spawns" || versions[0]["by"] != "boss" || versions[1]["note"] != "seed" {
		t.Fatalf("ประวัติเวอร์ชัน: %s", vraw)
	}
	if st, _, _ := admin.do("GET", "/api/data/versions?category=nope", nil, nil); st != 404 {
		t.Fatalf("หมวดที่ไม่มีต้อง 404 ได้ %d", st)
	}
	seedID := int(versions[1]["id"].(float64))
	if st, _, _ := admin.do("POST", "/api/data/rollback/world/"+itoa(seedID), nil, nil); st != 200 {
		t.Fatalf("rollback: %d", st)
	}
	if _, _, mobs, _ := e.world.Counts(); mobs <= 2 {
		t.Fatalf("rollback แล้วมอนสเตอร์ต้องกลับมา: %d", mobs)
	}
	if st, _, _ := admin.do("POST", "/api/data/rollback/balance/"+itoa(seedID), nil, nil); st != 404 {
		t.Fatalf("id ของหมวดอื่นต้อง 404 ได้ %d", st)
	}
	if st, _, _ := admin.do("POST", "/api/data/rollback/world/999999", nil, nil); st != 404 {
		t.Fatalf("เวอร์ชันที่ไม่มีต้อง 404 ได้ %d", st)
	}
	if st, _, _ := admin.do("POST", "/api/data/rollback/world/abc", nil, nil); st != 400 {
		t.Fatalf("id ผิดรูปแบบต้อง 400 ได้ %d", st)
	}
	if st, _, _ := admin.do("POST", "/api/data/reset", nil, nil); st != 404 {
		t.Fatalf("ต้องไม่มี endpoint reset แล้ว ได้ %d", st)
	}

	// ---- ตารางรายการ skills: แก้ทีละสกิล ด้วย version ต่อแถว ----
	var skillItem map[string]any
	for _, x := range doc["skills"].([]any) {
		if x.(map[string]any)["id"] == "swBash" {
			skillItem = x.(map[string]any)
		}
	}
	if skillItem == nil {
		t.Fatal("ต้องมีสกิล swBash ในข้อมูลตั้งต้น")
	}
	rowV := m1.Tables["skills"]["swBash"]
	skillItem["name"] = "ทดสอบรายสกิล"
	body, _ := json.Marshal(skillItem)
	if st, _, _ := admin.do("PUT", "/api/tables/skills/swBash", body, nil); st != 428 {
		t.Fatalf("ไม่ส่ง If-Match/If-None-Match ต้อง 428 ได้ %d", st)
	}
	if st, _, _ := admin.do("PUT", "/api/tables/nope/x", body, ifm(1)); st != 404 {
		t.Fatalf("ตารางที่ไม่มีต้อง 404 ได้ %d", st)
	}
	if st, _, _ := admin.do("PUT", "/api/tables/skills/swMagnum", body, ifm(rowV)); st != 400 {
		t.Fatalf("id ในข้อมูลไม่ตรง URL ต้อง 400 ได้ %d", st)
	}
	if st, rb, _ := admin.do("PUT", "/api/tables/skills/swBash?note=rename", body, ifm(rowV)); st != 200 || jsonField(t, rb, "version") != float64(rowV+1) {
		t.Fatalf("แก้สกิลต้องได้เวอร์ชัน %d: %d %s", rowV+1, st, rb)
	}
	if st, _, _ := admin.do("PUT", "/api/tables/skills/swBash", body, ifm(rowV)); st != 409 {
		t.Fatalf("If-Match เก่าของแถวต้อง 409 ได้ %d", st)
	}
	_, raw4, _ := player.do("GET", "/api/data", nil, nil)
	m4 := readMeta(t, raw4)
	if m4.Tables["skills"]["swBash"] != rowV+1 || m4.Tables["skills"]["swMagnum"] != m1.Tables["skills"]["swMagnum"] {
		t.Fatalf("แก้ swBash ต้องไม่กระทบสกิลอื่น: %v", m4.Tables["skills"])
	}
	// สร้างสกิลใหม่: ต้องส่ง If-None-Match: * และอ้างอาชีพที่มีจริง; อ้างอาชีพที่ไม่มี = 409
	skillItem["id"] = "zzNew"
	skillItem["class"] = "no_such_class"
	bad, _ := json.Marshal(skillItem)
	star := map[string]string{"If-None-Match": "*"}
	if st, _, _ := admin.do("PUT", "/api/tables/skills/zzNew", bad, star); st != 409 {
		t.Fatalf("สกิลที่ชี้อาชีพไม่มีต้อง 409 ได้ %d", st)
	}
	skillItem["class"] = "swordman"
	good, _ := json.Marshal(skillItem)
	if st, _, _ := admin.do("PUT", "/api/tables/skills/zzNew", good, star); st != 200 {
		t.Fatalf("สร้างสกิลไม่สำเร็จ: %d", st)
	}
	if st, _, _ := admin.do("PUT", "/api/tables/skills/zzNew", good, star); st != 409 {
		t.Fatalf("สร้างซ้ำต้อง 409 ได้ %d", st)
	}
	if st, _, _ := admin.do("DELETE", "/api/tables/classes/swordman", nil, ifm(1)); st != 409 {
		t.Fatalf("ลบอาชีพที่ยังมีสกิลต้อง 409 ได้ %d", st)
	}
	if st, _, _ := admin.do("DELETE", "/api/tables/skills/zzNew", nil, nil); st != 428 {
		t.Fatalf("ลบโดยไม่ส่ง If-Match ต้อง 428 ได้ %d", st)
	}
	if st, _, _ := admin.do("DELETE", "/api/tables/skills/zzNew", nil, ifm(1)); st != 200 {
		t.Fatalf("ลบสกิลไม่สำเร็จ: %d", st)
	}
	// ประวัติและกู้คืน: swBash มี create (seed) + update; กู้ไปสถานะ create ได้ชื่อเดิมกลับมา
	_, hraw, _ := admin.do("GET", "/api/tables/skills/swBash/history", nil, nil)
	var hist []map[string]any
	_ = json.Unmarshal(hraw, &hist)
	if len(hist) != 2 || hist[0]["action"] != "update" || hist[0]["by"] != "boss" || hist[1]["action"] != "create" {
		t.Fatalf("ประวัติ swBash: %s", hraw)
	}
	first := int(hist[1]["id"].(float64))
	if st, _, _ := admin.do("POST", "/api/tables/skills/swBash/restore/"+itoa(first), nil, nil); st != 200 {
		t.Fatalf("กู้คืนไม่สำเร็จ: %d", st)
	}
	_, raw5, _ := player.do("GET", "/api/data", nil, nil)
	var doc5 struct {
		Skills []map[string]any `json:"skills"`
	}
	_ = json.Unmarshal(raw5, &doc5)
	for _, x := range doc5.Skills {
		if x["id"] == "swBash" && x["name"] == "ทดสอบรายสกิล" {
			t.Fatal("กู้คืนแล้วชื่อสกิลต้องกลับเป็นของเดิม")
		}
	}
}

func strikerStateJSON(t *testing.T, e *env) []byte {
	t.Helper()
	d, eng, _ := e.data.Current()
	st := eng.StateFromBuild(&sim.State{BaseLv: 50}, d.Builds[0].ID)
	st.SetMonster(d.Monsters[0], false)
	raw, _ := json.Marshal(st)
	return raw
}

func TestCharacterStatePersistsAndValidates(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("hero")
	st, body, _ := c.do("GET", "/api/characters/me", nil, nil)
	if st != 200 || jsonField(t, body, "character", "name") != "hero" {
		t.Fatalf("get: %d %s", st, body)
	}
	good := strikerStateJSON(t, e)
	if st, _, _ := c.do("PUT", "/api/characters/me/state", good, nil); st != 403 {
		t.Fatalf("โหมดเกมต้องห้ามเขียน state ตรง ๆ (403) ได้ %d", st)
	}
	e.setMode("hero", "lab")
	if st, body, _ := c.do("PUT", "/api/characters/me/state", good, nil); st != 200 {
		t.Fatalf("บันทึก state ไม่ได้: %d %s", st, body)
	}
	_, body, _ = c.do("GET", "/api/characters/me", nil, nil)
	if jsonField(t, body, "character", "classId") != "swordman" || jsonField(t, body, "state", "classId") != "swordman" {
		t.Fatalf("คอลัมน์/สถานะไม่ซิงก์: %s", body)
	}
	mutate := func(f func(m map[string]any)) []byte {
		var m map[string]any
		_ = json.Unmarshal(good, &m)
		f(m)
		b, _ := json.Marshal(m)
		return b
	}
	bad := map[string][]byte{
		"คลาสแปลก":         mutate(func(m map[string]any) { m["classId"] = "godmode" }),
		"เลเวลเกิน":        mutate(func(m map[string]any) { m["baseLv"] = 500 }),
		"jobLv เกินคลาส":   mutate(func(m map[string]any) { m["jobLv"] = 9999 }),
		"gold ติดลบ":       mutate(func(m map[string]any) { m["gold"] = -1 }),
		"สกิลเลเวลเกิน":    mutate(func(m map[string]any) { m["learned"] = map[string]any{"swBash": 99} }),
		"สกิลที่ไม่มี":     mutate(func(m map[string]any) { m["learned"] = map[string]any{"hackSkill": 1} }),
		"ไม่ใช่อ็อบเจ็กต์": []byte(`[1,2,3]`),
	}
	for name, b := range bad {
		if st, _, _ := c.do("PUT", "/api/characters/me/state", b, nil); st != 422 {
			t.Errorf("%s: ต้อง 422 ได้ %d", name, st)
		}
	}
	if st, _, _ := c.do("PUT", "/api/characters/me/state", string(good), map[string]string{"Content-Type": "text/plain"}); st != 415 {
		t.Fatalf("Content-Type ผิดต้อง 415 ได้ %d", st)
	}
	if st, _, _ := c.do("PUT", "/api/characters/me/state", []byte(`{"pad":"`+strings.Repeat("a", 300<<10)+`"}`), nil); st != 413 {
		t.Fatalf("ใหญ่เกินต้อง 413 ได้ %d", st)
	}
	// state ผิดต้องไม่ทับของเดิม
	_, body, _ = c.do("GET", "/api/characters/me", nil, nil)
	if jsonField(t, body, "state", "classId") != "swordman" {
		t.Fatal("state ที่ถูกปฏิเสธต้องไม่ทับข้อมูลเดิม")
	}
	// ผู้ใช้อื่นเห็น/แก้ตัวละครของเรา (IDOR) ไม่ได้: API ผูกกับ session เสมอ
	o := e.client()
	o.mustRegister("other")
	_, body, _ = o.do("GET", "/api/characters/me", nil, nil)
	if jsonField(t, body, "character", "name") != "other" {
		t.Fatal("ต้องได้ตัวละครของตัวเองเท่านั้น")
	}
}

func TestCSRFOriginGuardAndCORS(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	body := map[string]string{"username": "csrf", "password": "password-123"}
	if st, _, _ := c.do("POST", "/api/auth/register", body, map[string]string{"Origin": "http://evil.example"}); st != 403 {
		t.Fatalf("Origin แปลกปลอมต้อง 403 ได้ %d", st)
	}
	st, _, h := c.do("POST", "/api/auth/register", body, map[string]string{"Origin": goodOrigin})
	if st != 201 || h.Get("Access-Control-Allow-Origin") != goodOrigin || h.Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("Origin ที่อนุญาตต้องผ่านพร้อม CORS+credentials: %d %v", st, h)
	}
	if st, _, h := c.do("OPTIONS", "/api/auth/login", nil, map[string]string{"Origin": goodOrigin}); st != 204 || h.Get("Access-Control-Allow-Methods") == "" {
		t.Fatalf("preflight: %d %v", st, h)
	}
	if _, _, h := c.do("GET", "/api/health", nil, map[string]string{"Origin": "http://evil.example"}); h.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("ห้ามให้ CORS แก่โดเมนแปลกปลอม")
	}
	// logout ข้ามเว็บก็ต้องถูกกัน
	if st, _, _ := c.do("POST", "/api/auth/logout", nil, map[string]string{"Origin": "http://evil.example"}); st != 403 {
		t.Fatalf("logout ข้ามโดเมนต้อง 403 ได้ %d", st)
	}
	if st, _, h := c.do("GET", "/api/health", nil, nil); st != 200 || h.Get("X-Content-Type-Options") != "nosniff" || h.Get("X-Frame-Options") != "DENY" {
		t.Fatal("ต้องมี security headers")
	}
}

func TestLoginBruteForceThrottle(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("victim")
	c.do("POST", "/api/auth/logout", nil, nil)
	got429 := false
	for i := 0; i < 12; i++ {
		st, _, _ := c.do("POST", "/api/auth/login", map[string]string{"username": "victim", "password": "guess-" + itoa(i) + "-xx"}, nil)
		if st == 429 {
			got429 = true
			break
		}
		if st != 401 {
			t.Fatalf("ต้อง 401 ก่อนถูกจำกัด ได้ %d", st)
		}
	}
	if !got429 {
		t.Fatal("เดารหัสผ่านซ้ำ ๆ ต้องถูกจำกัดอัตรา (429)")
	}
	// แม้รหัสถูก ก็ต้องรอ (จำกัดต่อชื่อผู้ใช้)
	if st, _, _ := c.do("POST", "/api/auth/login", map[string]string{"username": "victim", "password": "password-123"}, nil); st != 429 {
		t.Fatalf("ระหว่างถูกจำกัดต้อง 429 ได้ %d", st)
	}
}

func TestSimulatorEndpointsMatchEngine(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("simmer")
	state := strikerStateJSON(t, e)
	d, eng, _ := e.data.Current()

	st, body, _ := c.do("POST", "/api/sim/stats", map[string]any{"state": json.RawMessage(state)}, nil)
	if st != 200 {
		t.Fatalf("stats: %d %s", st, body)
	}
	parsed, _ := sim.ParseState(state)
	want := eng.Player(parsed, nil)
	got := jsonField(t, body, "stats", "atk").(float64)
	if got != want.S("atk") || jsonField(t, body, "aps").(float64) != want.APS {
		t.Fatalf("stats ต้องตรงกับ engine: %v vs %v", got, want.S("atk"))
	}

	// benchmark = ผลเดียวกับเรียก engine ตรง ๆ (เมล็ดเดียวกัน)
	st, body, _ = c.do("POST", "/api/sim/benchmark", map[string]any{"state": json.RawMessage(state), "seconds": 20, "seed": 5}, nil)
	if st != 200 {
		t.Fatalf("benchmark: %d %s", st, body)
	}
	exp := eng.Benchmark(parsed, 20, 5)
	if jsonField(t, body, "dmg").(float64) != exp.Dmg || int(jsonField(t, body, "casts").(float64)) != exp.Casts || exp.Dmg <= 0 {
		t.Fatalf("benchmark ไม่ตรง: %s vs dmg=%v", body, exp.Dmg)
	}
	// เกินเวลาสูงสุดต้องถูกตัดไว้ที่ 300 วินาที
	_, body, _ = c.do("POST", "/api/sim/benchmark", map[string]any{"state": json.RawMessage(state), "seconds": 100000}, nil)
	if jsonField(t, body, "t").(float64) > 300.5 {
		t.Fatalf("ต้องจำกัดเวลาจำลอง: %v", jsonField(t, body, "t"))
	}
	// เปรียบเทียบบิลด์ทั้งหมด
	st, body, _ = c.do("POST", "/api/sim/builds", map[string]any{"state": json.RawMessage(state), "seconds": 10}, nil)
	var rows []map[string]any
	_ = json.Unmarshal(body, &rows)
	if st != 200 || len(rows) != len(d.Builds) {
		t.Fatalf("builds: %d rows=%d want %d", st, len(rows), len(d.Builds))
	}
	// ตารางดาเมจต่อสกิล
	st, body, _ = c.do("POST", "/api/sim/skills", map[string]any{"state": json.RawMessage(state)}, nil)
	_ = json.Unmarshal(body, &rows)
	if st != 200 || len(rows) < 3 || rows[0]["id"] != "basic" {
		t.Fatalf("skills: %d %s", st, body)
	}
	// อินพุตเสีย
	for name, b := range map[string]any{"ไม่มี state": map[string]any{}, "คลาสแปลก": map[string]any{"state": map[string]any{"classId": "nope"}}} {
		if st, _, _ := c.do("POST", "/api/sim/stats", b, nil); st != 400 {
			t.Errorf("%s: ต้อง 400 ได้ %d", name, st)
		}
	}
}

// ---------- WebSocket ----------

func (e *env) dial(c *client, origin string) (*websocket.Conn, *http.Response, error) {
	url := "ws" + strings.TrimPrefix(e.ts.URL, "http") + "/ws"
	dialer := websocket.Dialer{Jar: c.jar, HandshakeTimeout: 3 * time.Second}
	h := http.Header{}
	if origin != "" {
		h.Set("Origin", origin)
	}
	return dialer.Dial(url, h)
}

func readOp(t *testing.T, c *websocket.Conn, op byte, d time.Duration) []byte {
	t.Helper()
	deadline := time.Now().Add(d)
	for time.Now().Before(deadline) {
		_ = c.SetReadDeadline(deadline)
		_, f, err := c.ReadMessage()
		if err != nil {
			t.Fatalf("อ่านไม่ได้ (รอ op %#x): %v", op, err)
		}
		if len(f) > 2 && f[2] == op {
			return f
		}
	}
	t.Fatalf("ไม่พบ op %#x", op)
	return nil
}

func TestWebSocketRequiresSessionAndOrigin(t *testing.T) {
	e := newEnv(t)
	anon := e.client()
	if _, resp, err := e.dial(anon, goodOrigin); err == nil || resp == nil || resp.StatusCode != 401 {
		t.Fatalf("ไม่ล็อกอินต้องได้ 401: %v", err)
	}
	c := e.client()
	c.mustRegister("wsuser")
	if _, _, err := e.dial(c, "http://evil.example"); err == nil {
		t.Fatal("Origin แปลกปลอมต้องถูกปฏิเสธ")
	}
	conn, _, err := e.dial(c, goodOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	w := readOp(t, conn, protocol.OpWelcome, 2*time.Second)
	if uid := binary.LittleEndian.Uint32(w[4:]); uid < 1001 {
		t.Fatalf("uid=%d", uid)
	}
}

func TestWebSocketGameplayChatAndPersistence(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("fighter")
	e.setMode("fighter", "lab")
	if st, _, _ := c.do("PUT", "/api/characters/me/state", strikerStateJSON(t, e), nil); st != 200 {
		t.Fatal("ตั้ง state ไม่สำเร็จ")
	}
	conn, _, err := e.dial(c, goodOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	uid := binary.LittleEndian.Uint32(readOp(t, conn, protocol.OpWelcome, 2*time.Second)[4:])

	// แชท: ชื่อผู้ส่งต้องเป็นชื่อตัวละครของบัญชี ไม่ใช่ที่ไคลเอนต์ปลอมมา และถูกบันทึกลงฐานข้อมูล
	_ = conn.WriteMessage(websocket.BinaryMessage, protocol.EncodeChat(0, "Admin", "สวัสดีชาวโลก"))
	var m protocol.Chat
	for i := 0; i < 20; i++ { // ข้ามข้อความของบอทที่อาจแทรกเข้ามาก่อน
		m, _ = protocol.DecodeChat(readOp(t, conn, protocol.OpChat, 2*time.Second))
		if m.Sender == "fighter" {
			break
		}
	}
	if m.Sender != "fighter" || m.Text != "สวัสดีชาวโลก" {
		t.Fatalf("chat=%+v", m)
	}
	var msgs []map[string]any
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		_, raw, _ := c.do("GET", "/api/chat/recent", nil, nil)
		_ = json.Unmarshal(raw, &msgs)
		if len(msgs) > 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if len(msgs) != 1 || msgs[0]["text"] != "สวัสดีชาวโลก" || msgs[0]["sender"] != "fighter" {
		t.Fatalf("แชทต้องถูกบันทึกลงฐานข้อมูล: %+v", msgs)
	}

	// เข้าตีมอนสเตอร์จริงด้วยสเตตัสจากตัวจำลอง: ได้ DAMAGE_EVENT ของผู้เล่น + PLAYER_STATE ส่วนตัว
	d, _, _ := e.data.Current()
	var target gamedata.Spawn
	for _, sp := range d.SpawnsForCurrentMap() {
		if sp.MonsterID == "dummy" {
			target = sp
			break
		}
	}
	var mobUID uint32
	for i, sp := range d.SpawnsForCurrentMap() {
		if sp.ID == target.ID {
			mobUID = uint32(i + 1)
		}
	}
	move := func(x, y float32) {
		f := make([]byte, 22)
		f[0], f[1], f[2], f[20] = protocol.Magic, protocol.Version, protocol.OpMove, 1
		binary.LittleEndian.PutUint32(f[8:], mathBits(x))
		binary.LittleEndian.PutUint32(f[12:], mathBits(y))
		_ = conn.WriteMessage(websocket.BinaryMessage, f)
	}
	for i := 0; i < 80; i++ { // เดินไปหาดัมมี่ (เซิร์ฟเวอร์จำกัดความเร็ว จึงต้องส่งต่อเนื่อง)
		move(float32(target.X)-60, float32(target.Y))
		time.Sleep(25 * time.Millisecond)
	}
	atk := make([]byte, 16)
	atk[0], atk[1], atk[2] = protocol.Magic, protocol.Version, protocol.OpAttack
	binary.LittleEndian.PutUint32(atk[8:], mobUID)
	_ = conn.WriteMessage(websocket.BinaryMessage, atk)
	hit := false
	for i := 0; i < 60 && !hit; i++ {
		ev := readOp(t, conn, protocol.OpDamage, 3*time.Second)
		hit = binary.LittleEndian.Uint32(ev[4:]) == uid && binary.LittleEndian.Uint32(ev[8:]) == mobUID
	}
	if !hit {
		t.Fatal("ไม่พบ DAMAGE_EVENT ที่ผู้เล่นตีดัมมี่")
	}
	ps := readOp(t, conn, protocol.OpPlayerState, 2*time.Second)
	if maxHP := mathFromBits(binary.LittleEndian.Uint32(ps[8:])); maxHP < 500 {
		t.Fatalf("PLAYER_STATE ต้องใช้ MaxHP จริงจากสูตร: %v", maxHP)
	}
	conn.Close()

	// ออกจากเกม → บันทึกตำแหน่งลงฐานข้อมูล
	deadline = time.Now().Add(2 * time.Second)
	var ch store.Character
	for time.Now().Before(deadline) {
		ch, _ = e.db.CharacterByUser(context.Background(), userIDOf(t, e, "fighter"))
		if ch.PosX > 600 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if ch.PosX <= 600 {
		t.Fatalf("ต้องบันทึกตำแหน่งตอนออก (x=%v)", ch.PosX)
	}
}

func TestSecondLoginAndLogoutKickOnlineSession(t *testing.T) {
	e := newEnv(t)
	c1 := e.client()
	c1.mustRegister("solo")
	conn1, _, err := e.dial(c1, goodOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn1.Close()
	readOp(t, conn1, protocol.OpWelcome, 2*time.Second)

	// ล็อกอินซ้ำจากอีกเครื่อง → การเชื่อมต่อเก่าถูกตัด (1 บัญชี = 1 ผู้เล่นออนไลน์)
	c2 := e.client()
	if st, _, _ := c2.do("POST", "/api/auth/login", map[string]string{"username": "solo", "password": "password-123"}, nil); st != 200 {
		t.Fatal("login ครั้งที่สองไม่ผ่าน")
	}
	conn2, _, err := e.dial(c2, goodOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn2.Close()
	readOp(t, conn2, protocol.OpWelcome, 2*time.Second)
	_ = conn1.SetReadDeadline(time.Now().Add(2 * time.Second))
	for {
		if _, _, err := conn1.ReadMessage(); err != nil {
			break
		}
	}
	if players, _, _, _ := e.world.Counts(); players != 1 {
		t.Fatalf("ต้องเหลือผู้เล่นออนไลน์ 1 คน ได้ %d", players)
	}
	// logout → ตัดการเชื่อมต่อเกมทันที
	if st, _, _ := c2.do("POST", "/api/auth/logout", nil, nil); st != 204 {
		t.Fatal("logout ไม่ผ่าน")
	}
	_ = conn2.SetReadDeadline(time.Now().Add(2 * time.Second))
	closed := false
	for i := 0; i < 50; i++ {
		if _, _, err := conn2.ReadMessage(); err != nil {
			closed = true
			break
		}
	}
	if !closed {
		t.Fatal("logout ต้องตัดการเชื่อมต่อเกม")
	}
}

func TestServerFullRejectsExtraClients(t *testing.T) {
	e := newEnv(t) // MaxClients = 3
	var conns []*websocket.Conn
	for i, name := range []string{"play1", "play2", "play3"} {
		c := e.client()
		c.mustRegister(name)
		conn, _, err := e.dial(c, goodOrigin)
		if err != nil {
			t.Fatalf("ผู้เล่นที่ %d: %v", i+1, err)
		}
		conns = append(conns, conn)
	}
	defer func() {
		for _, c := range conns {
			c.Close()
		}
	}()
	c4 := e.client()
	c4.mustRegister("play4")
	if _, resp, err := e.dial(c4, goodOrigin); err == nil || resp == nil || resp.StatusCode != 503 {
		t.Fatalf("เต็มแล้วต้องได้ 503: %v", err)
	}
}

// setMode สลับโหมดตัวละครของผู้ใช้ตรง ๆ ที่ฐานข้อมูล (ตัวช่วยของเทสต์)
func (e *env) setMode(username, mode string) {
	e.t.Helper()
	ch, err := e.db.CharacterByUser(context.Background(), userIDOf(e.t, e, username))
	if err != nil {
		e.t.Fatal(err)
	}
	if err := e.db.SetCharacterMode(context.Background(), ch.ID, mode); err != nil {
		e.t.Fatal(err)
	}
}
