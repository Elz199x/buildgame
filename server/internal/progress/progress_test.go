package progress

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/sim"
)

func setup(t *testing.T) (*Progress, *sim.State, *gamedata.Data) {
	t.Helper()
	d, err := gamedata.Parse(gamedata.Seed())
	if err != nil {
		t.Fatal(err)
	}
	p := New(sim.New(d))
	return p, p.NewCharacter(), d
}

func isRule(err error) bool {
	var re *RuleError
	return errors.As(err, &re)
}

func TestNewCharacter(t *testing.T) {
	p, st, d := setup(t)
	if st.ClassID != "novice" || st.BaseLv != 1 || st.JobLv != 1 || st.Gold != StarterGold || st.WeaponID != "unarmed" {
		t.Fatalf("ตัวละครใหม่ผิด: %+v", st)
	}
	if qty(st, StarterPotion) != StarterPotQty || len(st.Inventory) != 1 {
		t.Fatal("ต้องมียาเริ่มต้น")
	}
	total, spent, left := p.StatusPoints(st)
	if total != int(d.FormulaConfig.StatusPointSystem.StartPoints) || spent != 0 || left != total {
		t.Fatalf("แต้มสเตตัสเริ่มต้น: %d/%d/%d", total, spent, left)
	}
	if st.Sheet["maxHp"] < 1 || st.Sheet["atk"] < 0 {
		t.Fatal("ต้องคำนวณชีตสเตตัสให้แล้ว")
	}
	// JSON round trip: ฟิลด์เซิร์ฟเวอร์ครบ + ฟิลด์ฝั่งเครื่องมือยังอยู่
	raw, err := json.Marshal(st)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	_ = json.Unmarshal(raw, &m)
	for _, k := range []string{"classId", "learned", "rawStats", "inventory", "itemCounts", "equipped", "gold", "monster", "opts", "rotation", "monsterPresetId", "sheet"} {
		if _, ok := m[k]; !ok {
			t.Errorf("ขาดฟิลด์ %s ใน state ที่ส่งให้ไคลเอนต์", k)
		}
	}
	if string(m["learned"]) != "{}" || string(m["storage"]) != "[]" {
		t.Fatalf("map/slice ว่างต้องไม่เป็น null: %s %s", m["learned"], m["storage"])
	}
}

func TestStateRoundTripKeepsUnknownFields(t *testing.T) {
	_, st, _ := setup(t)
	raw, _ := json.Marshal(st)
	var m map[string]any
	_ = json.Unmarshal(raw, &m)
	m["futureField"] = map[string]any{"a": []any{1, 2, 3}}
	m["monster"] = map[string]any{"id": "custom", "maxHp": 777, "drops": []any{map[string]any{"itemId": "x", "chance": 0.5}}, "extraKey": true}
	raw, _ = json.Marshal(m)
	st2, err := sim.ParseState(raw)
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(st2)
	var m2 map[string]any
	_ = json.Unmarshal(out, &m2)
	if m2["futureField"] == nil || m2["monster"].(map[string]any)["extraKey"] != true || m2["monster"].(map[string]any)["maxHp"].(float64) != 777 {
		t.Fatalf("ฟิลด์ที่ไม่รู้จัก/ฟิลด์ monster ต้องไม่สูญหาย: %s", out)
	}
	if st2.Monster.MaxHP != 777 {
		t.Fatal("มุมมอง Monster ต้องอ่านจาก JSON ได้")
	}
}

func TestRaiseStatCostsAndLimits(t *testing.T) {
	p, st, _ := setup(t)
	_, _, left0 := p.StatusPoints(st)
	n, err := p.RaiseStat(st, "str", 5)
	if err != nil || n != 5 || st.RawStats["str"] != 6 {
		t.Fatalf("raise: n=%d err=%v str=%v", n, err, st.RawStats["str"])
	}
	_, spent, left := p.StatusPoints(st)
	if spent != 5 || left != left0-5 { // 1→6 ราคาแต้มละ 1
		t.Fatalf("spent=%d left=%d", spent, left)
	}
	// ทุ่มจนแต้มหมด: ต้องไม่ติดลบ และหยุดเมื่อไม่พอ
	for i := 0; i < 200; i++ {
		if _, err := p.RaiseStat(st, "vit", 10); err != nil {
			if !isRule(err) {
				t.Fatalf("ต้องเป็น RuleError: %v", err)
			}
			break
		}
	}
	if _, _, l := p.StatusPoints(st); l < 0 || l >= int(sim.StatCost(p.rawStat(st, "vit"))) {
		t.Fatalf("แต้มคงเหลือผิดปกติ: %d", l)
	}
	if _, err := p.RaiseStat(st, "hp", 1); !isRule(err) {
		t.Fatal("สเตตัสที่ไม่มีต้องถูกปฏิเสธ")
	}
	// เลเวลขึ้น → ได้แต้มเพิ่ม
	st.BaseLv = 30
	if total, _, _ := p.StatusPoints(st); total <= 48 {
		t.Fatalf("เลเวลสูงขึ้นต้องได้แต้มเพิ่ม: %d", total)
	}
	// ชีตซิงก์ใหม่หลังทุ่มแต้ม
	if st.Sheet["maxHp"] <= 0 {
		t.Fatal("ต้องซิงก์ชีต")
	}
}

func TestLearnUnlearnRespectJobPointsAndPrereqs(t *testing.T) {
	p, st, d := setup(t)
	var first *gamedata.Skill
	for i := range d.Skills {
		if d.Skills[i].Class == "novice" && len(d.Skills[i].Requires) == 0 && d.Skills[i].Type == "passive" {
			first = &d.Skills[i]
			break
		}
	}
	if first == nil {
		t.Fatal("ไม่มีสกิลโนวิซที่เรียนได้")
	}
	if err := p.Learn(st, first.ID); !isRule(err) { // Job Lv.1 = 0 แต้ม
		t.Fatalf("ไม่มีแต้มสกิลต้องเรียนไม่ได้: %v", err)
	}
	st.JobLv = 10
	if err := p.Learn(st, first.ID); err != nil {
		t.Fatalf("ควรเรียนได้เมื่อมีแต้ม: %v", err)
	}
	if st.LearnedLv(first.ID) != 1 {
		t.Fatal("เลเวลสกิลต้องเพิ่ม")
	}
	// ใช้แต้มจนหมด (9 แต้ม) แล้วต้องเรียนต่อไม่ได้
	for i := 0; i < 50; i++ {
		for j := range d.Skills {
			s := &d.Skills[j]
			if s.Class == "novice" {
				_ = p.Learn(st, s.ID)
			}
		}
	}
	for _, pi := range p.E.PointInfo(st) {
		if pi.Left < 0 {
			t.Fatalf("แต้มสกิลติดลบ: %+v", pi)
		}
	}
	if err := p.Learn(st, "no_such_skill"); !isRule(err) {
		t.Fatal("สกิลที่ไม่มีต้องถูกปฏิเสธ")
	}
	// ยกเลิกสกิลที่ถูกใช้เป็นเงื่อนไขต้องไม่ได้
	for _, s := range d.Skills {
		for _, r := range s.Requires {
			if st.LearnedLv(s.ID) > 0 && st.LearnedLv(r.ID) == r.Lv && r.Lv >= 1 {
				if err := p.Unlearn(st, r.ID); !isRule(err) {
					t.Fatalf("%s เป็นเงื่อนไขของ %s ที่เรียนอยู่ — ต้องห้ามถอน: %v", r.ID, s.ID, err)
				}
				return
			}
		}
	}
}

func TestGrantKillLevelsAndRewards(t *testing.T) {
	p, st, d := setup(t)
	poring := d.Monster("poring")
	zero := func() float64 { return 0 } // ทอยต่ำสุด → ดรอปทุกอย่าง ทองต่ำสุด
	r := p.GrantKill(st, poring, zero)
	if r.BaseExp != int(poring.Exp.Base) || r.Gold != int(poring.Gold[0]) || len(r.Items) != len(poring.Drops) {
		t.Fatalf("รางวัลไม่ตรงข้อมูลมอนสเตอร์: %+v", r)
	}
	if st.Gold != StarterGold+sim.Num(r.Gold) {
		t.Fatalf("ทองต้องเพิ่ม: %v", st.Gold)
	}
	high := func() float64 { return 0.999999 } // ทอยสูงสุด → ไม่ดรอป (ยกเว้นโอกาส 100%) ทองสูงสุด
	st2 := p.NewCharacter()
	r2 := p.GrantKill(st2, poring, high)
	if r2.Gold != int(poring.Gold[1]) || len(r2.Items) != 0 {
		t.Fatalf("ทอยสูงสุด: %+v", r2)
	}
	// EXP มหาศาล → ขึ้นหลายเลเวล, ติดเพดาน Base 99 และเพดาน Job ของคลาส
	big := *poring
	big.Exp.Base, big.Exp.Job = 1e9, 1e9
	st3 := p.NewCharacter()
	r3 := p.GrantKill(st3, &big, zero)
	if !r3.BaseLevelUp || !r3.JobLevelUp || st3.BaseLv != MaxBaseLevel || int(st3.JobLv) != d.Class("novice").JobLvCap {
		t.Fatalf("ต้องติดเพดานเลเวล: base=%v job=%v cap=%d", st3.BaseLv, st3.JobLv, d.Class("novice").JobLvCap)
	}
	if st3.BaseExp.F() >= nextBase(p.E, 99) || st3.JobExp.F() >= nextJob(p.E, st3.JobLv.F()) {
		t.Fatal("EXP ที่เพดานต้องไม่ล้นเกินเลเวลถัดไป")
	}
	// เลเวลขึ้นแล้วชีตซิงก์ใหม่ (HP สูงขึ้น)
	if st3.Sheet["maxHp"] <= st.Sheet["maxHp"] {
		t.Fatal("เลเวลสูงขึ้นต้องทำให้ชีต/HP เปลี่ยน")
	}
	// มอนสเตอร์ที่ไม่มีข้อมูล EXP ใช้ค่าเริ่มต้น
	plain := gamedata.Monster{ID: "x", MaxHP: 1}
	if r := p.GrantKill(p.NewCharacter(), &plain, zero); r.BaseExp != 20 || r.JobExp != 15 || r.Gold != 0 {
		t.Fatalf("ค่าเริ่มต้น: %+v", r)
	}
}

func TestChangeClass(t *testing.T) {
	p, st, d := setup(t)
	if err := p.ChangeClass(st, "swordman"); !isRule(err) {
		t.Fatalf("Job Lv ไม่ถึงเพดานต้องเลื่อนไม่ได้: %v", err)
	}
	st.JobLv = sim.Num(d.Class("novice").JobLvCap)
	st.JobExp = 77
	if err := p.ChangeClass(st, "mage"); err != nil && !isRule(err) {
		t.Fatal(err)
	}
	if err := p.ChangeClass(st, "novice"); !isRule(err) {
		t.Fatal("เลื่อนไปอาชีพตัวเองต้องไม่ได้")
	}
	if err := p.ChangeClass(st, "nope"); !isRule(err) {
		t.Fatal("อาชีพที่ไม่มีต้องไม่ได้")
	}
	st.ClassID, st.JobLv = "novice", sim.Num(d.Class("novice").JobLvCap)
	if err := p.ChangeClass(st, "swordman"); err != nil {
		t.Fatalf("ควรเลื่อนได้: %v", err)
	}
	if st.ClassID != "swordman" || st.JobLv != 1 || st.JobExp != 0 {
		t.Fatalf("หลังเลื่อน: %s job=%v exp=%v", st.ClassID, st.JobLv, st.JobExp)
	}
	// เลื่อนข้ามขั้น (โนวิซ → สายอื่นของนักดาบ) ต้องไม่ได้
	if err := p.ChangeClass(st, "thief"); !isRule(err) {
		t.Fatal("เลื่อนข้ามสายต้องไม่ได้")
	}
}

func TestShopStorageEquip(t *testing.T) {
	p, st, d := setup(t)
	var armor, card *gamedata.EquipItem
	for i := range d.EquipItems {
		it := &d.EquipItems[i]
		if it.Slot == "armor" && armor == nil {
			armor = it
		}
		if it.Slot == "card" && card == nil {
			card = it
		}
	}
	// ซื้อ: ทองไม่พอ / จำนวนผิด / สำเร็จ
	st.Gold = 1
	if err := p.Shop(st, "buy", armor.ID, 1); !isRule(err) || st.Gold != 1 || qty(st, armor.ID) != 0 {
		t.Fatal("ทองไม่พอต้องซื้อไม่ได้และไม่เสียอะไร")
	}
	st.Gold = 1_000_000
	for _, n := range []int{0, -3, 100} {
		if err := p.Shop(st, "buy", armor.ID, n); !isRule(err) {
			t.Fatalf("จำนวน %d ต้องถูกปฏิเสธ", n)
		}
	}
	if err := p.Shop(st, "buy", armor.ID, 2); err != nil || qty(st, armor.ID) != 2 || st.Gold != sim.Num(1_000_000-2*float64(p.buyPrice(armor))) {
		t.Fatalf("ซื้อไม่สำเร็จ: qty=%d gold=%v", qty(st, armor.ID), st.Gold)
	}
	// สวมใส่: ต้องมีของ, สลับถอดได้, ช่องผิดไม่ได้
	if err := p.Equip(st, armor.ID, false); err != nil || st.Equipped["armor"] != armor.ID {
		t.Fatal("สวมไม่สำเร็จ")
	}
	if err := p.Equip(st, armor.ID, false); err != nil || st.Equipped["armor"] != "" {
		t.Fatal("กดซ้ำต้องถอด")
	}
	if err := p.Equip(st, card.ID, true); !isRule(err) {
		t.Fatal("ไม่มีการ์ดในกระเป๋าต้องสวมไม่ได้")
	}
	if err := p.Equip(st, StarterPotion, true); !isRule(err) {
		t.Fatal("ยาสวมใส่ไม่ได้")
	}
	_ = p.Equip(st, armor.ID, true)
	// ขายจนหมด → ถอดออกอัตโนมัติ, ได้ทองตามราคาขาย
	gold := st.Gold
	if err := p.Shop(st, "sell", armor.ID, 2); err != nil || qty(st, armor.ID) != 0 || st.Equipped["armor"] != "" || st.Gold != gold+sim.Num(2*p.sellPrice(armor)) {
		t.Fatalf("ขายไม่ถูกต้อง: qty=%d eq=%q gold=%v", qty(st, armor.ID), st.Equipped["armor"], st.Gold)
	}
	if err := p.Shop(st, "sell", armor.ID, 1); !isRule(err) {
		t.Fatal("ขายของที่ไม่มีต้องไม่ได้")
	}
	// คลัง: ฝาก/ถอน คงจำนวนรวม
	if err := p.Storage(st, "deposit", StarterPotion, 3); err != nil || qty(st, StarterPotion) != 2 || storageQty(st, StarterPotion) != 3 {
		t.Fatalf("ฝากไม่ถูกต้อง: %d/%d", qty(st, StarterPotion), storageQty(st, StarterPotion))
	}
	if err := p.Storage(st, "deposit", StarterPotion, 99); err != nil || qty(st, StarterPotion) != 0 || storageQty(st, StarterPotion) != 5 || contains(st.Inventory, StarterPotion) {
		t.Fatal("ฝากเกินจำนวนที่มีต้องฝากเท่าที่มี")
	}
	if err := p.Storage(st, "withdraw", StarterPotion, 5); err != nil || qty(st, StarterPotion) != 5 || storageQty(st, StarterPotion) != 0 {
		t.Fatal("ถอนไม่ถูกต้อง")
	}
	if err := p.Storage(st, "withdraw", StarterPotion, 1); !isRule(err) {
		t.Fatal("ถอนของที่ไม่มีในคลังต้องไม่ได้")
	}
	if err := p.Storage(st, "steal", StarterPotion, 1); !isRule(err) {
		t.Fatal("คำสั่งแปลกต้องถูกปฏิเสธ")
	}
}

func TestWeaponShieldAndUseItem(t *testing.T) {
	p, st, d := setup(t)
	var oneH, twoH string
	for _, w := range d.Weapons {
		if w.SlotType == "1H" && oneH == "" {
			oneH = w.ID
		}
		if w.SlotType == "2H" && twoH == "" {
			twoH = w.ID
		}
	}
	if err := p.SetWeapon(st, "nope"); !isRule(err) {
		t.Fatal("อาวุธที่ไม่มีต้องไม่ได้")
	}
	_ = p.SetWeapon(st, oneH)
	if err := p.SetShield(st, true); err != nil || !st.HasShield {
		t.Fatalf("อาวุธ 1 มือสวมโล่ได้: %v", err)
	}
	_ = p.SetWeapon(st, twoH)
	if st.HasShield {
		t.Fatal("เปลี่ยนเป็นอาวุธ 2 มือต้องถอดโล่")
	}
	if err := p.SetShield(st, true); !isRule(err) {
		t.Fatal("อาวุธ 2 มือสวมโล่ไม่ได้")
	}
	hp, sp, err := p.UseItem(st, StarterPotion)
	if err != nil || hp <= 0 || qty(st, StarterPotion) != StarterPotQty-1 {
		t.Fatalf("ใช้ยา: hp=%v sp=%v err=%v", hp, sp, err)
	}
	for i := 0; i < StarterPotQty; i++ {
		_, _, _ = p.UseItem(st, StarterPotion)
	}
	if _, _, err := p.UseItem(st, StarterPotion); !isRule(err) || contains(st.Inventory, StarterPotion) {
		t.Fatal("ยาหมดแล้วต้องใช้ไม่ได้และออกจากกระเป๋า")
	}
	if _, _, err := p.UseItem(st, "eq_helm_valkyrie"); !isRule(err) {
		t.Fatal("ของที่ไม่ใช่ยาใช้ไม่ได้")
	}
}

func TestPrefsValidation(t *testing.T) {
	p, st, d := setup(t)
	skill := d.Skills[0].ID
	ok := map[string]json.RawMessage{
		"rotation":        json.RawMessage(`[{"id":"` + skill + `","minSpPct":0.2}]`),
		"opts":            json.RawMessage(`{"auto":false,"speed":2}`),
		"monsterPresetId": json.RawMessage(`"poring"`),
	}
	if err := p.Prefs(st, ok); err != nil {
		t.Fatal(err)
	}
	if len(st.Rotation) != 1 || st.Rotation[0].ID != skill || (st.Opts.Auto == nil || *st.Opts.Auto) {
		t.Fatalf("ต้องอัปเดตมุมมอง: %+v %+v", st.Rotation, st.Opts)
	}
	bad := []map[string]json.RawMessage{
		{"gold": json.RawMessage(`999999`)}, // ฟิลด์ที่ผู้เล่นห้ามตั้งเอง
		{"learned": json.RawMessage(`{"x":1}`)},
		{"rotation": json.RawMessage(`[{"id":"ghost"}]`)}, // สกิลที่ไม่มี
		{"rotation": json.RawMessage(`"x"`)},
		{"opts": json.RawMessage(`[1]`)},
		{"monster": json.RawMessage(`5`)},
		{"monsterPresetId": json.RawMessage(`123`)},
		{"opts": json.RawMessage(`{"x":"` + strings.Repeat("a", maxPrefBytes) + `"}`)},
	}
	for i, b := range bad {
		before := st.Gold
		if err := p.Prefs(st, b); !isRule(err) || st.Gold != before {
			t.Errorf("กรณีที่ %d ต้องถูกปฏิเสธ: %v", i, err)
		}
	}
}
