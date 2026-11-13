package game

import (
	"encoding/binary"
	"encoding/json"
	"testing"
	"time"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/protocol"
	"catquest-ro/server/internal/sim"
)

func testWorld(t *testing.T) (*World, *gamedata.Data) {
	t.Helper()
	d, err := gamedata.Parse(gamedata.Seed())
	if err != nil {
		t.Fatal(err)
	}
	return NewWorld(d), d
}

// strikerState = JSON ของตัวละครนักดาบสองมือ (บิลด์แรก) ที่เรียนสกิลครบ
func strikerState(t *testing.T, d *gamedata.Data) []byte {
	t.Helper()
	eng := sim.New(d)
	st := eng.StateFromBuild(&sim.State{BaseLv: 50}, d.Builds[0].ID)
	st.Monster = sim.MonsterState{Monster: d.Monsters[0]}
	raw, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func addStriker(t *testing.T, w *World, d *gamedata.Data) *Player {
	t.Helper()
	p, err := w.AddPlayer(PlayerInit{UserID: "u1", CharID: "c1", Name: "Tester", StateJSON: strikerState(t, d), X: 520, Y: 850})
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func (w *World) mobOf(id string) *Mob {
	for _, m := range w.mobs {
		if m.Def.ID == id {
			return m
		}
	}
	return nil
}

func (w *World) teleport(p *Player, x, y float32) {
	w.mu.Lock()
	p.X, p.Y, p.hasMoved = x, y, true
	w.mu.Unlock()
}

func damageEvents(o Outbox) (evs [][]byte) {
	for _, f := range o.Broadcast {
		if f[2] == protocol.OpDamage {
			evs = append(evs, f)
		}
	}
	return
}

func TestPlayerStatsComeFromSimulator(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	st, _ := sim.ParseState(strikerState(t, d))
	want := sim.New(d).Player(st, nil)
	if p.maxHP() != want.S("maxHp") || p.maxSP() != want.S("maxSp") || p.HP != p.maxHP() {
		t.Fatalf("สเตตัสต้องมาจากสูตรจริง: maxHp %v vs %v", p.maxHP(), want.S("maxHp"))
	}
	if p.classIdx != 1 || p.weaponIdx != 2 { // swordman, sword_2h
		t.Fatalf("class/weapon: %d %d", p.classIdx, p.weaponIdx)
	}
}

func TestAttackKillsMobAndRespawns(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	poring := w.mobOf("poring")
	w.teleport(p, poring.X-60, poring.Y)
	killed := false
	for i := 0; i < 200 && !killed; i++ {
		w.HandleAttack(p.UID, poring.UID)
		w.Step(0.5)
		for _, f := range damageEvents(w.TakeOutbox()) {
			if f[20]&protocol.DmgKill != 0 && binary.LittleEndian.Uint32(f[8:]) == poring.UID {
				killed = true
			}
		}
	}
	if !killed || poring.Alive {
		t.Fatal("มอนสเตอร์ควรตาย")
	}
	for i := 0; i < 20 && !poring.Alive; i++ {
		w.Step(0.5)
	}
	if !poring.Alive || poring.HP != poring.MaxHP {
		t.Fatal("ควรเกิดใหม่เลือดเต็ม")
	}
}

func TestAttackOutOfRangeAndCooldown(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	m := w.mobOf("poring")
	w.teleport(p, m.X+1500, m.Y)
	w.HandleAttack(p.UID, m.UID)
	if len(w.TakeOutbox().Broadcast) != 0 || m.HP != m.MaxHP {
		t.Fatal("ไกลเกินระยะต้องไม่มีผล")
	}
	w.teleport(p, m.X-50, m.Y)
	w.HandleAttack(p.UID, m.UID)
	n1 := len(damageEvents(w.TakeOutbox()))
	w.HandleAttack(p.UID, m.UID) // ทันที → ติดคูลดาวน์
	n2 := len(damageEvents(w.TakeOutbox()))
	if n1 != 1 || n2 != 0 {
		t.Fatalf("ต้องตีได้ครั้งเดียวก่อนหมดคูลดาวน์: %d %d", n1, n2)
	}
}

func TestSkillCastSpendsSPAndSetsCooldown(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	m := w.mobOf("armor")
	w.teleport(p, m.X-60, m.Y)
	idx, ok := d.SkillIndex("swBash")
	if !ok {
		t.Fatal("ไม่มี swBash")
	}
	sp0 := p.SP
	w.HandleSkill(p.UID, idx, m.UID)
	evs := damageEvents(w.TakeOutbox())
	if len(evs) != 1 || p.SP >= sp0 || p.cd["swBash"] <= 0 {
		t.Fatalf("ต้องมีดาเมจ 1 ครั้ง หัก SP และตั้งคูลดาวน์: evs=%d sp=%v→%v cd=%v", len(evs), sp0, p.SP, p.cd["swBash"])
	}
	w.Step(0.5)
	w.TakeOutbox()
	w.HandleSkill(p.UID, idx, m.UID) // ยังติดคูลดาวน์ 3 วินาที
	if len(damageEvents(w.TakeOutbox())) != 0 {
		t.Fatal("ติดคูลดาวน์ต้องใช้ไม่ได้")
	}
	// ไม่ได้เรียนสกิล → ใช้ไม่ได้
	sw, _ := d.SkillIndex("thSteal")
	w.HandleSkill(p.UID, sw, m.UID)
	w.HandleSkill(p.UID, 99999, m.UID) // ดัชนีเกินช่วงต้องไม่ panic
}

func TestBuffAppliesAndExpires(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	idx, _ := d.SkillIndex("swBattleCry")
	atk0 := p.P.S("atk")
	w.HandleSkill(p.UID, idx, 0)
	if !p.hasStatus("swBattleCry") || p.P.S("atk") <= atk0 {
		t.Fatalf("บัฟต้องเพิ่ม ATK: %v → %v", atk0, p.P.S("atk"))
	}
	for i := 0; i < 400 && p.hasStatus("swBattleCry"); i++ {
		w.Step(0.5)
	}
	if p.hasStatus("swBattleCry") || p.P.S("atk") != atk0 {
		t.Fatal("บัฟหมดเวลาแล้วสเตตัสต้องกลับเป็นเดิม")
	}
}

func TestToggleOnOff(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	idx, _ := d.SkillIndex("swBerserk")
	w.HandleSkill(p.UID, idx, 0)
	if !p.hasStatus("swBerserk") {
		t.Fatal("toggle ต้องเปิด")
	}
	w.HandleSkill(p.UID, idx, 0)
	if p.hasStatus("swBerserk") {
		t.Fatal("กดซ้ำต้องปิด")
	}
}

func TestMobKillsPlayerThenRevivesInTown(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	boss := w.mobOf("boss")
	w.teleport(p, boss.X-30, boss.Y)
	dead := false
	for i := 0; i < 3000 && !dead; i++ {
		w.Step(1.0 / 30)
		for _, f := range damageEvents(w.TakeOutbox()) {
			if f[20]&protocol.DmgKill != 0 && binary.LittleEndian.Uint32(f[8:]) == p.UID {
				dead = true
			}
		}
	}
	if !dead || p.alive() {
		t.Fatal("บอสควรฆ่าผู้เล่นได้")
	}
	for i := 0; i < 200 && !p.alive(); i++ {
		w.Step(0.1)
	}
	if !p.alive() || p.HP != p.maxHP() || p.X != float32(w.data.Rules.World.TownX) {
		t.Fatalf("ต้องเกิดใหม่ที่เมืองด้วยเลือดเต็ม: alive=%v hp=%v x=%v", p.alive(), p.HP, p.X)
	}
}

func TestRollGivesIFramesAndCooldown(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	w.HandleRoll(p.UID, protocol.Roll{X: 520, Y: 850})
	hp := p.HP
	w.mu.Lock()
	w.damagePlayer(p, 1, 99999, false)
	after := p.HP
	w.mu.Unlock()
	if after != hp {
		t.Fatal("ระหว่างกลิ้งต้องอมตะ")
	}
	if p.RollCD <= 0 {
		t.Fatal("ต้องมีคูลดาวน์กลิ้ง")
	}
	cd := p.RollCD
	w.HandleRoll(p.UID, protocol.Roll{X: 520, Y: 850}) // ซ้ำทันที ต้องไม่รีเซ็ต
	if p.RollCD != cd {
		t.Fatal("กลิ้งซ้ำระหว่างคูลดาวน์ต้องไม่มีผล")
	}
}

func TestMoveSpeedClamped(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	now := time.Now()
	w.mu.Lock()
	p.hasMoved = false
	w.placePlayer(p, 500, 500, now)
	w.placePlayer(p, 2000, 500, now.Add(100*time.Millisecond)) // วาร์ป 1500px ใน 0.1 วินาที
	x := p.X
	w.mu.Unlock()
	if x > 500+moveBudgetMax+1 {
		t.Fatalf("ต้องจำกัดระยะวาร์ป x=%v", x)
	}
	// ส่ง MOVE ถี่ ๆ (1000 ข้อความใน 1 วินาที) ก็ต้องไม่เดินเร็วเกิน maxMoveSpeed
	w.mu.Lock()
	p.hasMoved = false
	w.placePlayer(p, 500, 500, now)
	p.moveBudget = 0
	for i := 1; i <= 1000; i++ {
		w.placePlayer(p, 500+float32(i)*3, 500, now.Add(time.Duration(i)*time.Millisecond)) // พยายามเดิน 3000px/s
	}
	moved := p.X - 500
	w.mu.Unlock()
	if moved > maxMoveSpeed*1.02 {
		t.Fatalf("ส่งข้อความถี่ต้องไม่ทำให้เดินเร็วเกินจริง: เดินไป %v px ใน 1 วินาที (สูงสุด %v)", moved, float64(maxMoveSpeed))
	}
}

func TestPlayerStateFramesSentToOwnerOnly(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	for i := 0; i < 20; i++ {
		w.Step(1.0 / 30)
	}
	o := w.TakeOutbox()
	frames := o.Direct[p.UID]
	if len(frames) == 0 || frames[0][2] != protocol.OpPlayerState || len(frames[0]) < 21 {
		t.Fatalf("ต้องส่ง PLAYER_STATE ให้เจ้าของ: %d เฟรม", len(frames))
	}
	for _, f := range o.Broadcast {
		if f[2] == protocol.OpPlayerState {
			t.Fatal("ห้ามกระจาย PLAYER_STATE ให้คนอื่น")
		}
	}
}

func TestEmptyStateFallsBackToDefaultBuild(t *testing.T) {
	w, _ := testWorld(t)
	p, err := w.AddPlayer(PlayerInit{Name: "New", StateJSON: []byte(`{}`)})
	if err != nil || p.maxHP() <= 1 || !p.alive() {
		t.Fatalf("ตัวละครใหม่ที่ state ว่างต้องเล่นได้: %v", err)
	}
	if _, err := w.AddPlayer(PlayerInit{Name: "Bad", StateJSON: []byte(`[1,2]`)}); err == nil {
		t.Fatal("state ที่ไม่ใช่อ็อบเจ็กต์ต้องถูกปฏิเสธ")
	}
}

func TestSetDataRebuildsMobsOnlyWhenNeeded(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	first := w.mobs[0]
	// ข้อมูลเดิมเป๊ะ: มอนสเตอร์ต้องเป็นอ็อบเจ็กต์เดิม (ไม่รีเซ็ตเลือดผู้เล่นที่กำลังสู้)
	d2, _ := gamedata.Parse(gamedata.Seed())
	w.SetData(d2)
	if w.mobs[0] != first {
		t.Fatal("ข้อมูลที่เกี่ยวข้องไม่เปลี่ยน ต้องไม่สร้างมอนสเตอร์ใหม่")
	}
	if p.maxHP() <= 0 {
		t.Fatal("ผู้เล่นต้องคำนวณสเตตัสใหม่ได้")
	}
	// ตัดจุดเกิดเหลือ 2 → ต้องสร้างใหม่
	var raw map[string]any
	_ = json.Unmarshal(gamedata.Seed(), &raw)
	wm := raw["worldMap"].(map[string]any)
	wm["currentMapId"] = "none"
	wm["spawns"] = wm["spawns"].([]any)[:2]
	b, _ := json.Marshal(raw)
	d3, err := gamedata.Parse(b)
	if err != nil {
		t.Fatal(err)
	}
	w.SetData(d3)
	if len(w.mobs) != 2 {
		t.Fatalf("mobs=%d", len(w.mobs))
	}
}

func TestSnapshotContainsPlayersAndMobs(t *testing.T) {
	w, d := testWorld(t)
	p := addStriker(t, w, d)
	snap := w.Snapshot()
	peers, mobs := int(snap[8]), int(snap[9])
	if snap[2] != protocol.OpSnapshot || peers != 4 || mobs != len(w.mobs) { // 3 บอท + 1 ผู้เล่น
		t.Fatalf("snapshot: peers=%d mobs=%d", peers, mobs)
	}
	found := false
	for i := 0; i < peers; i++ {
		if binary.LittleEndian.Uint32(snap[10+16*i:]) == p.UID {
			found = true
		}
	}
	if !found {
		t.Fatal("ต้องเห็นผู้เล่นใน snapshot")
	}
}

func TestPlayerStateCarriesBuffsAndUseItemHeals(t *testing.T) {
	w, d := testWorld(t)
	// ให้ผู้เล่นมียาแดง 2 ขวด
	var m map[string]any
	_ = json.Unmarshal(strikerState(t, d), &m)
	m["itemCounts"] = map[string]any{"pot_red": 2}
	raw, _ := json.Marshal(m)
	p, err := w.AddPlayer(PlayerInit{Name: "Drinker", StateJSON: raw})
	if err != nil {
		t.Fatal(err)
	}
	cry, _ := d.SkillIndex("swBattleCry")
	w.HandleSkill(p.UID, cry, 0)
	f := w.stateFrame(p)
	n := int(f[20])
	if n != 1 || binary.LittleEndian.Uint16(f[21:]) != uint16(cry) || f[23] == 0 {
		t.Fatalf("PLAYER_STATE ต้องมีบัฟ swBattleCry: n=%d", n)
	}
	// ยา: ต้องมีไอเทมและมีจำนวนเหลือ
	potIdx := -1
	for i, it := range d.EquipItems {
		if it.ID == "pot_red" {
			potIdx = i
		}
	}
	if potIdx < 0 {
		t.Fatal("ไม่มี pot_red ในข้อมูล")
	}
	w.mu.Lock()
	p.HP = p.maxHP() * 0.1
	w.mu.Unlock()
	w.HandleUseItem(p.UID, potIdx)
	if p.HP <= p.maxHP()*0.3 {
		t.Fatalf("ยาแดงต้องฟื้น HP: %v/%v", p.HP, p.maxHP())
	}
	w.HandleUseItem(p.UID, potIdx)
	w.HandleUseItem(p.UID, potIdx) // ขวดที่ 3 ไม่มี → ไม่มีผล
	if p.st.ItemCounts["pot_red"].F() != 0 {
		t.Fatalf("ต้องใช้ได้เท่าที่มี: เหลือ %v", p.st.ItemCounts["pot_red"].F())
	}
	w.HandleUseItem(p.UID, -1)
	w.HandleUseItem(p.UID, 99999)
	for i, it := range d.EquipItems { // ไอเทมที่ไม่ใช่ยา ใช้ไม่ได้
		if it.ConsumeEffect == nil {
			p.st.ItemCounts[it.ID] = 5
			hp := p.HP
			w.HandleUseItem(p.UID, i)
			if p.HP != hp {
				t.Fatalf("%s ไม่ใช่ยา แต่ฟื้น HP", it.ID)
			}
			break
		}
	}
}
