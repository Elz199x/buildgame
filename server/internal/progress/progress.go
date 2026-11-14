// Package progress คือกติกาความก้าวหน้าของตัวละคร (เซิร์ฟเวอร์เป็นเจ้าของ): รางวัลจากการล้มมอนสเตอร์ ระดับ/EXP
// แต้มสเตตัส/สกิล อุปกรณ์ กระเป๋า คลังคาฟรา ร้านค้า เปลี่ยนอาชีพ — ทุกฟังก์ชันเป็นการแก้ sim.State ล้วน ๆ
// (ไม่รู้จักฐานข้อมูล/เครือข่าย) จึงทดสอบง่าย และใช้ได้ทั้งตัวละครที่ออนไลน์อยู่และออฟไลน์
package progress

import (
	"encoding/json"
	"fmt"
	"math"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/sim"
)

// RuleError คือการละเมิดกติกาเกม (แปลงเป็น HTTP 422 พร้อมข้อความให้ผู้เล่น) — ต่างจากข้อผิดพลาดของระบบ
type RuleError struct{ Msg string }

func (e *RuleError) Error() string { return e.Msg }

func rule(format string, a ...any) error { return &RuleError{Msg: fmt.Sprintf(format, a...)} }

var (
	StatKeys   = [...]string{"str", "agi", "vit", "int", "dex", "luk"}
	EquipSlots = [...]string{"headgear", "armor", "garment", "footgear", "accessory", "card"}
)

type Progress struct{ E *sim.Engine }

func New(e *sim.Engine) *Progress { return &Progress{E: e} }

// Columns คอลัมน์ที่ซิงก์ลงตาราง characters
type Columns struct {
	ClassID string
	BaseLv  int
	JobLv   int
	BaseExp int64
	JobExp  int64
	Gold    int64
}

func Cols(st *sim.State) Columns {
	return Columns{ClassID: st.ClassID, BaseLv: int(st.BaseLv.F()), JobLv: int(st.JobLv.F()), BaseExp: int64(st.BaseExp.F()), JobExp: int64(st.JobExp.F()), Gold: int64(st.Gold.F())}
}

// ---------- ตัวละครใหม่ ----------

// NewCharacter สร้างสถานะตัวละครใหม่: โนวิซ Lv.1 มีแต้มสเตตัสเริ่มต้นให้ทุ่มเอง ทอง+ยาเล็กน้อย
func (p *Progress) NewCharacter() *sim.State {
	d := p.E.D
	first := d.Classes[0].ID
	for _, c := range d.Classes {
		if c.Parent == "" {
			first = c.ID
			break
		}
	}
	rp := d.Rules.Progression
	st := &sim.State{
		ClassID: first, BaseLv: 1, JobLv: 1, AutoSyncStats: true, WeaponID: rp.StarterWeaponID, Gold: sim.Num(rp.StarterGold),
		Learned:   map[string]sim.Num{},
		RawStats:  map[string]sim.Num{"str": sim.Num(rp.StarterStat), "agi": sim.Num(rp.StarterStat), "vit": sim.Num(rp.StarterStat), "int": sim.Num(rp.StarterStat), "dex": sim.Num(rp.StarterStat), "luk": sim.Num(rp.StarterStat)},
		Equipped:  map[string]string{},
		Inventory: []string{}, ItemCounts: map[string]sim.Num{}, Storage: []string{}, StorageCounts: map[string]sim.Num{},
	}
	for _, s := range EquipSlots {
		st.Equipped[s] = ""
	}
	for _, it := range rp.StarterItems {
		addItem(st, it.ID, int(it.Qty))
	}
	// ฟิลด์ฝั่งเครื่องมือ/ตัวจำลอง (ไคลเอนต์ใช้ในแท็บ DPS และเมนู)
	st.SetExtra("rotation", json.RawMessage(`[]`))
	st.SetExtra("opts", json.RawMessage(`{"auto":true,"speed":1,"benchSeconds":60}`))
	st.SetExtra("presetId", json.RawMessage(`""`))
	if len(d.Monsters) > 0 {
		id, _ := json.Marshal(d.Monsters[0].ID)
		st.SetExtra("monsterPresetId", id)
		st.SetMonster(d.Monsters[0], false)
	}
	p.E.ApplyAutoSync(st)
	return st
}

// ---------- ไอเทม ----------

func qty(st *sim.State, id string) int {
	if v, ok := st.ItemCounts[id]; ok {
		return int(math.Max(0, v.F()))
	}
	for _, x := range st.Inventory {
		if x == id {
			return 1
		}
	}
	return 0
}

func ensure(st *sim.State) {
	if st.ItemCounts == nil {
		st.ItemCounts = map[string]sim.Num{}
	}
	if st.StorageCounts == nil {
		st.StorageCounts = map[string]sim.Num{}
	}
	if st.Equipped == nil {
		st.Equipped = map[string]string{}
	}
	if st.Learned == nil {
		st.Learned = map[string]sim.Num{}
	}
	if st.RawStats == nil {
		st.RawStats = map[string]sim.Num{}
	}
}

func contains(l []string, v string) bool {
	for _, x := range l {
		if x == v {
			return true
		}
	}
	return false
}

func without(l []string, v string) []string {
	out := l[:0:0]
	for _, x := range l {
		if x != v {
			out = append(out, x)
		}
	}
	return out
}

func addItem(st *sim.State, id string, n int) {
	ensure(st)
	prev := qty(st, id)
	if !contains(st.Inventory, id) {
		st.Inventory = append(st.Inventory, id)
	}
	st.ItemCounts[id] = sim.Num(prev + n)
}

func removeItem(st *sim.State, id string, n int) {
	ensure(st)
	next := qty(st, id) - n
	if next <= 0 {
		delete(st.ItemCounts, id)
		st.Inventory = without(st.Inventory, id)
		for slot, eq := range st.Equipped { // ขายจนหมดชิ้นสุดท้าย → ถอดออกจากช่องสวมใส่ด้วย
			if eq == id {
				st.Equipped[slot] = ""
			}
		}
		return
	}
	st.ItemCounts[id] = sim.Num(next)
}

func storageQty(st *sim.State, id string) int {
	if v, ok := st.StorageCounts[id]; ok {
		return int(math.Max(0, v.F()))
	}
	if contains(st.Storage, id) {
		return 1
	}
	return 0
}

// UseItem ใช้ไอเทมฟื้นฟู: ลดจำนวนและคืนเปอร์เซ็นต์ HP/SP ที่ฟื้น (ผู้เรียกเป็นคนฟื้นจริง)
func (p *Progress) UseItem(st *sim.State, itemID string) (hpPct, spPct float64, err error) {
	it := p.E.D.Item(itemID)
	if it == nil || it.Slot != "consumable" || it.ConsumeEffect == nil {
		return 0, 0, rule("ไอเทมนี้ใช้ไม่ได้")
	}
	if qty(st, itemID) < 1 {
		return 0, 0, rule("ไม่มี %s เหลือในกระเป๋า", it.Name)
	}
	removeItem(st, itemID, 1)
	return it.ConsumeEffect.HPPct, it.ConsumeEffect.SPPct, nil
}

func (p *Progress) Equip(st *sim.State, itemID string, set bool) error {
	it := p.E.D.Item(itemID)
	if it == nil {
		return rule("ไม่รู้จักไอเทม")
	}
	slotOK := false
	for _, s := range EquipSlots {
		if s == it.Slot {
			slotOK = true
		}
	}
	if !slotOK {
		return rule("ไอเทมนี้สวมใส่ไม่ได้")
	}
	if qty(st, itemID) < 1 {
		return rule("ไม่มี %s ในกระเป๋า", it.Name)
	}
	ensure(st)
	if !set && st.Equipped[it.Slot] == itemID {
		st.Equipped[it.Slot] = ""
	} else {
		st.Equipped[it.Slot] = itemID
	}
	return nil
}

func (p *Progress) Unequip(st *sim.State, slot string) error {
	for _, s := range EquipSlots {
		if s == slot {
			ensure(st)
			st.Equipped[slot] = ""
			return nil
		}
	}
	return rule("ช่องสวมใส่ไม่ถูกต้อง")
}

func (p *Progress) SetWeapon(st *sim.State, weaponID string) error {
	w := p.E.D.Weapon(weaponID)
	if w == nil {
		return rule("ไม่รู้จักอาวุธ")
	}
	st.WeaponID = weaponID
	if w.SlotType == "2H" {
		st.HasShield = false
	}
	p.E.ApplyAutoSync(st)
	return nil
}

func (p *Progress) SetShield(st *sim.State, on bool) error {
	if on {
		w := p.E.D.Weapon(st.WeaponID)
		if w == nil || w.SlotType != "1H" {
			return rule("สวมโล่ได้เฉพาะอาวุธ 1 มือ")
		}
	}
	st.HasShield = on
	p.E.ApplyAutoSync(st)
	return nil
}

// ---------- คลังคาฟรา ----------

func (p *Progress) Storage(st *sim.State, op, itemID string, n int) error {
	if p.E.D.Item(itemID) == nil {
		return rule("ไม่รู้จักไอเทม")
	}
	if n < 1 {
		n = 1
	}
	ensure(st)
	switch op {
	case "deposit":
		have := qty(st, itemID)
		if have < 1 {
			return rule("ไม่มีไอเทมนี้ในกระเป๋า")
		}
		if n > have {
			n = have
		}
		prev := storageQty(st, itemID)
		if !contains(st.Storage, itemID) {
			st.Storage = append(st.Storage, itemID)
		}
		st.StorageCounts[itemID] = sim.Num(prev + n)
		removeItem(st, itemID, n)
	case "withdraw":
		have := storageQty(st, itemID)
		if have < 1 {
			return rule("ไม่มีไอเทมนี้ในคลัง")
		}
		if n > have {
			n = have
		}
		if next := have - n; next <= 0 {
			delete(st.StorageCounts, itemID)
			st.Storage = without(st.Storage, itemID)
		} else {
			st.StorageCounts[itemID] = sim.Num(next)
		}
		addItem(st, itemID, n)
	default:
		return rule("คำสั่งคลังไม่ถูกต้อง")
	}
	return nil
}

// ---------- ร้านค้า ----------

func (p *Progress) buyPrice(it *gamedata.EquipItem) int64 {
	if it.Price > 0 {
		return int64(it.Price)
	}
	return int64(p.E.D.Rules.Progression.DefaultBuyPrice)
}

func (p *Progress) sellPrice(it *gamedata.EquipItem) int64 {
	rp := p.E.D.Rules.Progression
	return int64(math.Max(rp.MinSellPrice, math.Round(float64(p.buyPrice(it))*rp.SellRatio)))
}

func (p *Progress) Shop(st *sim.State, op, itemID string, n int) error {
	it := p.E.D.Item(itemID)
	if it == nil {
		return rule("ไม่รู้จักไอเทม")
	}
	if maxQty := int(p.E.D.Rules.Progression.MaxShopQty); n < 1 || n > maxQty {
		return rule("จำนวนต้องอยู่ระหว่าง 1–%d", maxQty)
	}
	gold := int64(st.Gold.F())
	switch op {
	case "buy":
		cost := p.buyPrice(it) * int64(n)
		if gold < cost {
			return rule("Zeny ไม่พอ! ต้องการ %d", cost)
		}
		st.Gold = sim.Num(gold - cost)
		addItem(st, itemID, n)
	case "sell":
		if qty(st, itemID) < n {
			return rule("มี %s ในกระเป๋าไม่พอ", it.Name)
		}
		removeItem(st, itemID, n)
		st.Gold = sim.Num(gold + p.sellPrice(it)*int64(n))
	default:
		return rule("คำสั่งร้านค้าไม่ถูกต้อง")
	}
	return nil
}

// ---------- สเตตัส / สกิล / อาชีพ ----------

func (p *Progress) rawStat(st *sim.State, k string) float64 {
	if v := st.RawStats[k].F(); v >= 1 {
		return v
	}
	return 1
}

// StatusPoints แต้มสเตตัสทั้งหมด/ที่ใช้ไป/คงเหลือ ตามเลเวลฐาน
func (p *Progress) StatusPoints(st *sim.State) (total, spent, left int) {
	total = int(p.E.TotalStatusPoints(int(st.BaseLv.F())))
	for _, k := range StatKeys {
		spent += int(sim.CostToReach(p.rawStat(st, k)))
	}
	return total, spent, total - spent
}

func (p *Progress) statCap() float64 {
	if c := p.E.D.FormulaConfig.StatusPointSystem.StatCap; c > 0 {
		return c
	}
	return 99
}

// RaiseStat เพิ่มสเตตัส stat ขึ้น n แต้มตามต้นทุนจริง (ตามจำนวนที่แต้มพอ) — คืนจำนวนที่เพิ่มได้จริง
func (p *Progress) RaiseStat(st *sim.State, stat string, n int) (int, error) {
	valid := false
	for _, k := range StatKeys {
		if k == stat {
			valid = true
		}
	}
	if !valid {
		return 0, rule("สเตตัสไม่ถูกต้อง")
	}
	if n < 1 {
		n = 1
	}
	if n > 99 {
		n = 99
	}
	ensure(st)
	_, _, left := p.StatusPoints(st)
	raised := 0
	for i := 0; i < n; i++ {
		cur := p.rawStat(st, stat)
		if cur >= p.statCap() {
			break
		}
		cost := int(sim.StatCost(cur))
		if left < cost {
			break
		}
		left -= cost
		st.RawStats[stat] = sim.Num(cur + 1)
		raised++
	}
	if raised == 0 {
		if p.rawStat(st, stat) >= p.statCap() {
			return 0, rule("สเตตัสนี้เต็มแล้ว")
		}
		return 0, rule("แต้มสเตตัสไม่พอ (ต้องการ %d)", int(sim.StatCost(p.rawStat(st, stat))))
	}
	p.E.ApplyAutoSync(st)
	return raised, nil
}

func (p *Progress) Learn(st *sim.State, skillID string) error {
	sk := p.E.D.Skill(skillID)
	if sk == nil {
		return rule("ไม่รู้จักสกิล")
	}
	if d := p.E.CanLearn(sk, st); !d.OK {
		return rule("%s", d.Reason)
	}
	ensure(st)
	st.Learned[skillID] = sim.Num(st.LearnedLv(skillID) + 1)
	return nil
}

func (p *Progress) Unlearn(st *sim.State, skillID string) error {
	sk := p.E.D.Skill(skillID)
	if sk == nil {
		return rule("ไม่รู้จักสกิล")
	}
	if d := p.E.CanUnlearn(sk, st); !d.OK {
		return rule("%s", d.Reason)
	}
	if lv := st.LearnedLv(skillID) - 1; lv <= 0 {
		delete(st.Learned, skillID)
	} else {
		st.Learned[skillID] = sim.Num(lv)
	}
	return nil
}

// ChangeClass เลื่อนอาชีพ: ต้องเป็นอาชีพลูกของอาชีพปัจจุบัน และ Job Lv ถึงเพดานของอาชีพปัจจุบัน
func (p *Progress) ChangeClass(st *sim.State, classID string) error {
	target := p.E.D.Class(classID)
	cur := p.E.D.Class(st.ClassID)
	if target == nil || cur == nil || target.Parent != cur.ID {
		return rule("เลื่อนอาชีพนี้ไม่ได้ (ต้องเป็นอาชีพต่อยอดจาก %s)", curName(cur))
	}
	if int(st.JobLv.F()) < cur.JobLvCap {
		return rule("ต้อง Job Lv.%d ก่อนเลื่อนอาชีพ", cur.JobLvCap)
	}
	st.ClassID = classID
	st.JobLv = 1
	st.JobExp = 0
	p.E.ApplyAutoSync(st)
	return nil
}

func curName(c *gamedata.Class) string {
	if c == nil {
		return "-"
	}
	return c.Name
}

// ---------- ค่าที่ผู้เล่นปรับเองได้ (ไม่กระทบความก้าวหน้า) ----------

const maxPrefBytes = 64 << 10

// Prefs ตั้งค่าการใช้งาน: ลำดับสกิลอัตโนมัติ, ตัวเลือกจำลอง, มอนสเตอร์เป้าหมายของแท็บ DPS
func (p *Progress) Prefs(st *sim.State, patch map[string]json.RawMessage) error {
	total := 0
	for _, v := range patch {
		total += len(v)
	}
	if total > maxPrefBytes {
		return rule("ข้อมูลใหญ่เกินไป")
	}
	for k, v := range patch {
		switch k {
		case "rotation":
			var rot []sim.RotationRule
			if err := json.Unmarshal(v, &rot); err != nil || len(rot) > 64 {
				return rule("ลำดับสกิลไม่ถูกต้อง")
			}
			for _, r := range rot {
				if p.E.D.Skill(r.ID) == nil {
					return rule("ลำดับสกิลอ้างสกิลที่ไม่มี: %s", r.ID)
				}
			}
		case "opts", "monster":
			var o map[string]json.RawMessage
			if err := json.Unmarshal(v, &o); err != nil || o == nil {
				return rule("%s ต้องเป็นอ็อบเจ็กต์", k)
			}
		case "monsterPresetId":
			var s string
			if err := json.Unmarshal(v, &s); err != nil || len(s) > 64 {
				return rule("monsterPresetId ไม่ถูกต้อง")
			}
		default:
			return rule("ไม่อนุญาตให้ตั้งค่า %q", k)
		}
	}
	for k, v := range patch {
		st.SetExtra(k, v)
	}
	return nil
}

// ---------- รางวัลจากการล้มมอนสเตอร์ ----------

type Item struct {
	ID  string `json:"id"`
	Qty int    `json:"qty"`
}

type Reward struct {
	BaseExp     int    `json:"baseExp"`
	JobExp      int    `json:"jobExp"`
	Gold        int    `json:"gold"`
	Items       []Item `json:"items"`
	BaseLevelUp bool   `json:"baseLevelUp"`
	JobLevelUp  bool   `json:"jobLevelUp"`
	BaseLv      int    `json:"baseLv"`
	JobLv       int    `json:"jobLv"`
}

func nextBase(e *sim.Engine, lv float64) float64 {
	return math.Max(e.D.Rules.Progression.MinExpRequired, e.NextBaseExp(lv))
}
func nextJob(e *sim.Engine, lv float64) float64 {
	return math.Max(e.D.Rules.Progression.MinExpRequired, e.NextJobExp(lv))
}

// GrantKill ให้ EXP/ทอง/ไอเทมดรอป (ใส่กระเป๋าอัตโนมัติ) และเลื่อนเลเวลเมื่อ EXP พอ
func (p *Progress) GrantKill(st *sim.State, mon *gamedata.Monster, rng func() float64) Reward {
	e := p.E
	exp := mon.Exp
	if exp.Base == 0 && exp.Job == 0 {
		exp.Base, exp.Job = e.D.Rules.Progression.DefaultKillExp.Base, e.D.Rules.Progression.DefaultKillExp.Job
	}
	r := Reward{BaseExp: int(exp.Base), JobExp: int(exp.Job)}

	maxLv := e.D.Rules.Progression.MaxBaseLevel
	baseLv := math.Max(1, st.BaseLv.F())
	baseExp := st.BaseExp.F() + exp.Base
	for req := nextBase(e, baseLv); baseExp >= req && baseLv < maxLv; req = nextBase(e, baseLv) {
		baseExp -= req
		baseLv++
		r.BaseLevelUp = true
	}
	if baseLv >= maxLv {
		baseExp = math.Min(baseExp, nextBase(e, baseLv)-1)
	}
	st.BaseLv, st.BaseExp = sim.Num(baseLv), sim.Num(baseExp)

	jobCap := maxLv
	if c := e.D.Class(st.ClassID); c != nil && c.JobLvCap > 0 {
		jobCap = float64(c.JobLvCap)
	}
	jobLv := math.Max(1, st.JobLv.F())
	jobExp := st.JobExp.F() + exp.Job
	for req := nextJob(e, jobLv); jobExp >= req && jobLv < jobCap; req = nextJob(e, jobLv) {
		jobExp -= req
		jobLv++
		r.JobLevelUp = true
	}
	if jobLv >= jobCap {
		jobExp = math.Min(jobExp, nextJob(e, jobLv)-1)
	}
	st.JobLv, st.JobExp = sim.Num(jobLv), sim.Num(jobExp)
	r.BaseLv, r.JobLv = int(baseLv), int(jobLv)

	if len(mon.Gold) >= 2 && mon.Gold[1] > 0 {
		r.Gold = int(math.Round(mon.Gold[0] + rng()*(mon.Gold[1]-mon.Gold[0])))
		st.Gold = sim.Num(st.Gold.F() + float64(r.Gold))
	}
	for _, dr := range mon.Drops {
		chance := dr.Chance
		if chance == 0 {
			chance = e.D.Rules.Progression.DefaultDropChance
		}
		if rng() <= chance && e.D.Item(dr.ItemID) != nil {
			addItem(st, dr.ItemID, 1)
			r.Items = append(r.Items, Item{ID: dr.ItemID, Qty: 1})
		}
	}
	if r.BaseLevelUp || r.JobLevelUp {
		e.ApplyAutoSync(st)
	}
	return r
}
