package httpapi_test

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/protocol"
	"catquest-ro/server/internal/sim"
	"catquest-ro/server/internal/store"
)

func stateOf(t *testing.T, body []byte) map[string]any {
	t.Helper()
	var r struct {
		State map[string]any `json:"state"`
	}
	if err := json.Unmarshal(body, &r); err != nil || r.State == nil {
		t.Fatalf("ไม่มี state ในผลลัพธ์: %s", body)
	}
	return r.State
}

func num(t *testing.T, m map[string]any, path ...string) float64 {
	t.Helper()
	var v any = m
	for _, p := range path {
		mm, ok := v.(map[string]any)
		if !ok {
			t.Fatalf("path %v ไม่ถูกต้อง", path)
		}
		v = mm[p]
	}
	f, ok := v.(float64)
	if !ok {
		t.Fatalf("path %v ไม่ใช่ตัวเลข: %v", path, v)
	}
	return f
}

func TestNewCharacterStartsAsNoviceInGameMode(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	_, body, _ := c.do("POST", "/api/auth/register", map[string]string{"username": "newbie", "password": "password-123"}, nil)
	if jsonField(t, body, "character", "mode") != "game" || jsonField(t, body, "character", "classId") != "novice" {
		t.Fatalf("ตัวละครใหม่ต้องเป็นโนวิซในโหมดเกม: %s", body)
	}
	_, body, _ = c.do("GET", "/api/characters/me", nil, nil)
	st := stateOf(t, []byte(`{"state":`+string(mustField(t, body, "state"))+`}`))
	if st["classId"] != "novice" || num(t, st, "baseLv") != 1 || num(t, st, "gold") != 100 || num(t, st, "itemCounts", "pot_red") != 5 {
		t.Fatalf("state เริ่มต้นผิด: %v", st)
	}
	if num(t, st, "sheet", "maxHp") < 1 {
		t.Fatal("ต้องมีชีตสเตตัสที่เซิร์ฟเวอร์คำนวณให้แล้ว")
	}
}

func mustField(t *testing.T, raw []byte, key string) json.RawMessage {
	t.Helper()
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil || m[key] == nil {
		t.Fatalf("ไม่มี %s ใน %s", key, raw)
	}
	return m[key]
}

func TestLegacyEmptyStateGetsInitialized(t *testing.T) {
	e := newEnv(t)
	// บัญชีเก่าที่ state ว่าง (สร้างก่อนมีระบบตัวละครเกม)
	if _, _, err := e.db.CreateUserWithCharacter(context.Background(), "legacy", "x", false, nil, store.StateColumns{ClassID: "novice", BaseLv: 1, JobLv: 1}); err != nil {
		t.Fatal(err)
	}
	u, _ := e.db.UserByUsername(context.Background(), "legacy")
	ch, state, err := e.svc().Load(context.Background(), u.ID)
	if err != nil || ch.ID == "" {
		t.Fatal(err)
	}
	var m map[string]any
	_ = json.Unmarshal(state, &m)
	if m["classId"] != "novice" || num(t, m, "gold") != 100 {
		t.Fatalf("ต้องสร้างตัวละครให้: %s", state)
	}
	again, _ := e.db.CharacterByUser(context.Background(), u.ID)
	if len(again.State) < 100 {
		t.Fatal("ต้องบันทึก state ที่สร้างลงฐานข้อมูลด้วย")
	}
}

func TestGameCommandsOffline(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("shopper")
	d, _, _ := e.data.Current()
	pot := d.Item("pot_red")

	// สเตตัส: ทุ่มแต้ม (เริ่ม 1) ตามต้นทุนจริง
	st, body, _ := c.do("POST", "/api/game/stat", map[string]any{"stat": "str", "n": 3}, nil)
	if st != 200 || num(t, stateOf(t, body), "rawStats", "str") != 4 {
		t.Fatalf("stat: %d %s", st, body)
	}
	for name, b := range map[string]any{"สเตตัสแปลก": map[string]any{"stat": "hp", "n": 1}, "ฟิลด์แปลก": map[string]any{"stat": "str", "n": 1, "gold": 99999}} {
		st, _, _ := c.do("POST", "/api/game/stat", b, nil)
		want := 422
		if name == "ฟิลด์แปลก" {
			want = 400
		}
		if st != want {
			t.Errorf("%s: ต้อง %d ได้ %d", name, want, st)
		}
	}
	// สกิล: โนวิซ Job Lv.1 ไม่มีแต้มสกิล → ห้ามเรียน
	var novice string
	for _, s := range d.Skills {
		if s.Class == "novice" && len(s.Requires) == 0 {
			novice = s.ID
			break
		}
	}
	if st, body, _ := c.do("POST", "/api/game/learn", map[string]string{"skillId": novice}, nil); st != 422 {
		t.Fatalf("ไม่มีแต้มสกิลต้อง 422 ได้ %d %s", st, body)
	}
	// ร้านค้า: ทองไม่พอซื้อของแพง, ซื้อยา, ขายคืน
	if st, _, _ := c.do("POST", "/api/game/shop", map[string]any{"op": "buy", "itemId": "eq_helm_valkyrie", "qty": 1}, nil); st != 422 {
		t.Fatalf("ทองไม่พอต้อง 422 ได้ %d", st)
	}
	st2, body, _ := c.do("POST", "/api/game/shop", map[string]any{"op": "buy", "itemId": "pot_red", "qty": 2}, nil)
	s := stateOf(t, body)
	if st2 != 200 || num(t, s, "gold") != 100-2*pot.Price || num(t, s, "itemCounts", "pot_red") != 7 {
		t.Fatalf("ซื้อยา: %d gold=%v", st2, s["gold"])
	}
	_, body, _ = c.do("POST", "/api/game/shop", map[string]any{"op": "sell", "itemId": "pot_red", "qty": 1}, nil)
	s = stateOf(t, body)
	if num(t, s, "itemCounts", "pot_red") != 6 || num(t, s, "gold") <= 100-2*pot.Price {
		t.Fatalf("ขายยา: %v", s)
	}
	// ฝากคลัง / สวมใส่ / เปลี่ยนอาชีพ / อาวุธ
	_, body, _ = c.do("POST", "/api/game/storage", map[string]any{"op": "deposit", "itemId": "pot_red", "qty": 4}, nil)
	s = stateOf(t, body)
	if num(t, s, "itemCounts", "pot_red") != 2 || num(t, s, "storageCounts", "pot_red") != 4 {
		t.Fatalf("ฝากคลัง: %v", s)
	}
	if st, _, _ := c.do("POST", "/api/game/equip", map[string]any{"itemId": "pot_red", "set": true}, nil); st != 422 {
		t.Fatalf("ยาสวมไม่ได้ ต้อง 422 ได้ %d", st)
	}
	if st, _, _ := c.do("POST", "/api/game/class", map[string]string{"classId": "swordman"}, nil); st != 422 {
		t.Fatalf("Job Lv ไม่ถึงต้อง 422 ได้ %d", st)
	}
	if st, body, _ := c.do("POST", "/api/game/weapon", map[string]string{"weaponId": "sword_1h"}, nil); st != 200 || stateOf(t, body)["weaponId"] != "sword_1h" {
		t.Fatalf("weapon: %d %s", st, body)
	}
	// ผลทุกอย่างบันทึกลงฐานข้อมูลทันที (คอลัมน์ซิงก์ด้วย)
	ch, _ := e.db.CharacterByUser(context.Background(), userIDOf(t, e, "shopper"))
	if ch.Gold != int64(num(t, s, "gold")) {
		t.Fatalf("ทองในฐานข้อมูล %d ไม่ตรง state %v", ch.Gold, s["gold"])
	}
	// prefs: ตั้งได้เฉพาะค่าที่ไม่กระทบความก้าวหน้า
	if st, _, _ := c.do("PUT", "/api/characters/me/prefs", map[string]any{"opts": map[string]any{"auto": false}}, nil); st != 200 {
		t.Fatalf("prefs: %d", st)
	}
	if st, _, _ := c.do("PUT", "/api/characters/me/prefs", map[string]any{"gold": 999999}, nil); st != 422 {
		t.Fatalf("prefs ห้ามตั้ง gold ได้ %d", st)
	}
	// ความปลอดภัย: ไม่ล็อกอิน / Origin ปลอม / ผู้ใช้อื่นไม่กระทบกัน
	if st, _, _ := e.client().do("POST", "/api/game/shop", map[string]any{"op": "buy", "itemId": "pot_red", "qty": 1}, nil); st != 401 {
		t.Fatalf("ไม่ล็อกอินต้อง 401 ได้ %d", st)
	}
	if st, _, _ := c.do("POST", "/api/game/shop", map[string]any{"op": "buy", "itemId": "pot_red", "qty": 1}, map[string]string{"Origin": "http://evil.example"}); st != 403 {
		t.Fatalf("Origin ปลอมต้อง 403 ได้ %d", st)
	}
	o := e.client()
	o.mustRegister("bystander")
	_, body, _ = o.do("GET", "/api/characters/me", nil, nil)
	if num(t, map[string]any{"s": jsonField(t, body, "state")}, "s", "gold") != 100 {
		t.Fatal("ผู้ใช้อื่นต้องไม่ถูกกระทบ")
	}
}

func TestLabModeIsAdminOnly(t *testing.T) {
	e := newEnv(t)
	admin, player := e.client(), e.client()
	admin.mustRegister("chief")
	player.mustRegister("cadet")
	if st, _, _ := player.do("POST", "/api/characters/me/mode", map[string]string{"mode": "lab"}, nil); st != 403 {
		t.Fatalf("ผู้เล่นทั่วไปเปิด lab ไม่ได้ ต้อง 403 ได้ %d", st)
	}
	if st, _, _ := admin.do("POST", "/api/characters/me/mode", map[string]string{"mode": "nope"}, nil); st != 400 {
		t.Fatal("โหมดแปลกต้อง 400")
	}
	if st, _, _ := admin.do("POST", "/api/characters/me/mode", map[string]string{"mode": "lab"}, nil); st != 200 {
		t.Fatal("admin ต้องเปิด lab ได้")
	}
	if st, body, _ := admin.do("PUT", "/api/characters/me/state", strikerStateJSON(t, e), nil); st != 200 {
		t.Fatalf("lab แก้ state อิสระได้: %d %s", st, body)
	}
	// กลับเป็นโหมดเกม → เขียน state ตรง ๆ ไม่ได้อีก
	admin.do("POST", "/api/characters/me/mode", map[string]string{"mode": "game"}, nil)
	if st, _, _ := admin.do("PUT", "/api/characters/me/state", strikerStateJSON(t, e), nil); st != 403 {
		t.Fatal("กลับโหมดเกมแล้วต้องห้าม")
	}
}

// strongState = ตัวละครที่ตีแรงมาก (ฆ่าปอริ่งในครั้งเดียว) เพื่อให้เทสต์รางวัลจบเร็ว
func strongStateJSON(t *testing.T, e *env) []byte {
	t.Helper()
	var m map[string]any
	_ = json.Unmarshal(strikerStateJSON(t, e), &m)
	m["autoSyncStats"] = false
	sheet := m["sheet"].(map[string]any)
	sheet["atk"], sheet["hit"], sheet["physCrit"] = 99999, 999, 0
	m["gold"], m["baseExp"], m["jobExp"] = 1000, 0, 0
	b, _ := json.Marshal(m)
	return b
}

func (e *env) svc() interface {
	Load(context.Context, string) (store.Character, json.RawMessage, error)
} {
	return e.api.Service()
}

func TestKillRewardsAreServerSideAndPersist(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("slayer")
	e.setMode("slayer", "lab")
	if st, body, _ := c.do("PUT", "/api/characters/me/state", strongStateJSON(t, e), nil); st != 200 {
		t.Fatalf("ตั้งตัวละครแรง: %d %s", st, body)
	}
	e.setMode("slayer", "game") // เล่นจริง: ความก้าวหน้าต่อจากนี้ต้องมาจากเซิร์ฟเวอร์เท่านั้น

	conn, _, err := e.dial(c, goodOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	readOp(t, conn, protocol.OpWelcome, 2*time.Second)

	d, _, _ := e.data.Current()
	var mobUID uint32
	var target gamedata.Spawn
	for i, sp := range d.SpawnsForCurrentMap() {
		if sp.MonsterID == "poring" {
			mobUID, target = uint32(i+1), sp
			break
		}
	}
	poring := d.Monster("poring")
	// เดินไปหาปอริ่ง (เซิร์ฟเวอร์จำกัดความเร็ว จึงต้องส่งต่อเนื่อง) แล้วโจมตีจนได้รางวัล
	move := func() {
		f := make([]byte, 22)
		f[0], f[1], f[2], f[20] = protocol.Magic, protocol.Version, protocol.OpMove, 1
		binary.LittleEndian.PutUint32(f[8:], mathBits(float32(target.X)-50))
		binary.LittleEndian.PutUint32(f[12:], mathBits(float32(target.Y)))
		_ = conn.WriteMessage(websocket.BinaryMessage, f)
	}
	atk := make([]byte, 16)
	atk[0], atk[1], atk[2] = protocol.Magic, protocol.Version, protocol.OpAttack
	binary.LittleEndian.PutUint32(atk[8:], mobUID)

	var reward []byte
	deadline := time.Now().Add(15 * time.Second)
	_ = conn.SetReadDeadline(deadline)
	go func() {
		for time.Now().Before(deadline) {
			move()
			_ = conn.WriteMessage(websocket.BinaryMessage, atk)
			time.Sleep(60 * time.Millisecond)
		}
	}()
	var syncJSON []byte
	for reward == nil || syncJSON == nil {
		_, f, err := conn.ReadMessage()
		if err != nil {
			t.Fatalf("ไม่ได้รับรางวัล/ซิงก์ state: %v", err)
		}
		switch f[2] {
		case protocol.OpReward:
			reward = f
		case protocol.OpStateSync:
			n := binary.LittleEndian.Uint32(f[4:])
			syncJSON = f[8 : 8+n]
		}
	}
	if got := binary.LittleEndian.Uint32(reward[4:]); got != mobUID {
		t.Fatalf("REWARD ของมอนสเตอร์ผิดตัว: %d", got)
	}
	baseExp, jobExp, gold := binary.LittleEndian.Uint32(reward[8:]), binary.LittleEndian.Uint32(reward[12:]), binary.LittleEndian.Uint32(reward[16:])
	if baseExp != uint32(poring.Exp.Base) || jobExp != uint32(poring.Exp.Job) || float64(gold) < poring.Gold[0] || float64(gold) > poring.Gold[1] {
		t.Fatalf("รางวัลไม่ตรงข้อมูลมอนสเตอร์: base=%d job=%d gold=%d", baseExp, jobExp, gold)
	}
	var synced map[string]any
	if err := json.Unmarshal(syncJSON, &synced); err != nil {
		t.Fatalf("STATE_SYNC ไม่ใช่ JSON: %v", err)
	}
	if num(t, synced, "gold") < 1000+poring.Gold[0] || num(t, synced, "baseExp") < poring.Exp.Base {
		t.Fatalf("state ที่ซิงก์ต้องรวมรางวัลแล้ว: gold=%v baseExp=%v", synced["gold"], synced["baseExp"])
	}
	// GET ขณะออนไลน์ต้องเห็น state สด (ฐานข้อมูลอาจช้ากว่า)
	_, body, _ := c.do("GET", "/api/characters/me", nil, nil)
	live := map[string]any{"s": jsonField(t, body, "state")}
	if num(t, live, "s", "gold") != num(t, synced, "gold") {
		t.Fatal("GET ต้องคืน state สดของผู้เล่นออนไลน์")
	}
	// ออกจากเกม → ความก้าวหน้าต้องถูกบันทึกลงฐานข้อมูลแม้ยังไม่ถึงรอบบันทึกอัตโนมัติ
	conn.Close()
	var ch store.Character
	for i := 0; i < 80; i++ {
		ch, _ = e.db.CharacterByUser(context.Background(), userIDOf(t, e, "slayer"))
		if float64(ch.Gold) >= num(t, synced, "gold") {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if float64(ch.Gold) < num(t, synced, "gold") || ch.BaseExp < int64(poring.Exp.Base) {
		t.Fatalf("ต้องบันทึกความก้าวหน้าตอนออกจากเกม: gold=%d baseExp=%d", ch.Gold, ch.BaseExp)
	}
}

func TestOnlineCommandUsesLiveStateAndPersistsImmediately(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("liveshop")
	conn, _, err := e.dial(c, goodOrigin)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	readOp(t, conn, protocol.OpWelcome, 2*time.Second)

	st, body, _ := c.do("POST", "/api/game/shop", map[string]any{"op": "buy", "itemId": "pot_red", "qty": 2}, nil)
	if st != 200 {
		t.Fatalf("buy: %d %s", st, body)
	}
	gold := num(t, stateOf(t, body), "gold")
	if gold >= 100 {
		t.Fatalf("ต้องหักทอง: %v", gold)
	}
	// ผู้เล่นออนไลน์ได้รับ PLAYER_STATE ใหม่ (โลกเกมเห็นการเปลี่ยนแปลงทันที)
	readOp(t, conn, protocol.OpPlayerState, 2*time.Second)
	// บันทึกลงฐานข้อมูลทันที ไม่ต้องรอรอบบันทึก
	ch, _ := e.db.CharacterByUser(context.Background(), userIDOf(t, e, "liveshop"))
	if float64(ch.Gold) != gold {
		t.Fatalf("คำสั่งต้องบันทึกทันที: db=%d state=%v", ch.Gold, gold)
	}
	// คำสั่งที่ผิดกติกาต้องไม่เปลี่ยนอะไรทั้งใน DB และผู้เล่นที่ออนไลน์
	if st, _, _ := c.do("POST", "/api/game/shop", map[string]any{"op": "buy", "itemId": "eq_helm_valkyrie", "qty": 1}, nil); st != 422 {
		t.Fatal("ทองไม่พอต้อง 422")
	}
	_, body, _ = c.do("GET", "/api/characters/me", nil, nil)
	if num(t, map[string]any{"s": jsonField(t, body, "state")}, "s", "gold") != gold {
		t.Fatal("คำสั่งที่ถูกปฏิเสธต้องไม่เปลี่ยน state")
	}
}

func TestSimSessions(t *testing.T) {
	e := newEnv(t)
	c := e.client()
	c.mustRegister("dpsman")
	state := json.RawMessage(strikerStateJSON(t, e))
	_, eng, _ := e.data.Current()

	st, body, _ := c.do("POST", "/api/sim/sessions", map[string]any{"state": state, "seed": 5}, nil)
	if st != 201 {
		t.Fatalf("สร้าง session: %d %s", st, body)
	}
	id := jsonField(t, body, "id").(string)
	if jsonField(t, body, "view", "maxHp").(float64) < 1000 || len(jsonField(t, body, "view", "why").(map[string]any)) == 0 {
		t.Fatalf("view ต้องมี HP จากสูตรเซิร์ฟเวอร์และเหตุผลของสกิล: %s", body)
	}
	path := "/api/sim/sessions/" + id + "/advance"
	// ก้าวเวลา: ผลต้องตรงกับเรียกตัวจำลองตรง ๆ ที่ seed เดียวกัน (กำหนดผลได้)
	st, body, _ = c.do("POST", path, map[string]any{"dt": 2.0}, nil)
	if st != 200 {
		t.Fatalf("advance: %d %s", st, body)
	}
	parsed, _ := sim.ParseState(state)
	direct := eng.NewSim(parsed, 5)
	direct.Advance(2.0)
	if got := jsonField(t, body, "summary", "dmg").(float64); got != direct.Summary().Dmg {
		t.Fatalf("session ต้องให้ผลเดียวกับตัวจำลองตรง ๆ: %v vs %v", got, direct.Summary().Dmg)
	}
	// dt เกินเพดานถูกตัดที่ 2 วินาที
	_, body, _ = c.do("POST", path, map[string]any{"dt": 9999}, nil)
	if tt := jsonField(t, body, "view", "t").(float64); tt < 3.9 || tt > 4.1 {
		t.Fatalf("dt ต้องถูกจำกัด (t=%v)", tt)
	}
	// สั่งสกิล + ซิงก์ state ใหม่ (เปลี่ยนคลาส) + รีเซ็ต
	_, body, _ = c.do("POST", path, map[string]any{"dt": 0.1, "casts": []string{"swBash"}}, nil)
	if jsonField(t, body, "events") == nil {
		t.Fatal("ต้องมี events")
	}
	var m map[string]any
	_ = json.Unmarshal(state, &m)
	m["weaponId"] = "dagger"
	m["classId"] = "novice"
	changed, _ := json.Marshal(m)
	_, body, _ = c.do("POST", path, map[string]any{"dt": 0, "state": json.RawMessage(changed), "reset": true}, nil)
	if jsonField(t, body, "view", "t").(float64) != 0 || jsonField(t, body, "view", "P", "weaponId") != "dagger" {
		t.Fatalf("sync+reset ต้องมีผลทันที: %s", body)
	}
	// ผู้ใช้อื่นเข้าถึง session ของเราไม่ได้
	o := e.client()
	o.mustRegister("snooper")
	if st, _, _ := o.do("POST", path, map[string]any{"dt": 1}, nil); st != 404 {
		t.Fatalf("session ของคนอื่นต้อง 404 ได้ %d", st)
	}
	// โควตา 3 session ต่อผู้ใช้: อันที่ 4 ทำให้อันเก่าสุดถูกปิด
	for i := 0; i < 3; i++ {
		if st, _, _ := c.do("POST", "/api/sim/sessions", map[string]any{"state": state}, nil); st != 201 {
			t.Fatalf("สร้าง session เพิ่ม: %d", st)
		}
	}
	if st, _, _ := c.do("POST", path, map[string]any{"dt": 1}, nil); st != 404 {
		t.Fatalf("session เก่าสุดต้องถูกปิดเมื่อเกินโควตา ได้ %d", st)
	}
	if st, _, _ := c.do("DELETE", "/api/sim/sessions/doesnotexist", nil, nil); st != 204 {
		t.Fatal("ลบ session ที่ไม่มี ต้องไม่ error")
	}
	// ลำดับสกิลอัตโนมัติจากสกิลที่เรียน
	_, body, _ = c.do("POST", "/api/sim/rotation", map[string]any{"state": state}, nil)
	if rot, ok := jsonField(t, body, "rotation").([]any); !ok || len(rot) == 0 {
		t.Fatalf("rotation: %s", body)
	}
}
