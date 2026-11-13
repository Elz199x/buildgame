package sim

import (
	"math"
	"strconv"

	"catquest-ro/server/internal/gamedata"
)

// Status = สถานะที่ติดตัว (บัฟ/toggle/trigger/aftermath)
type Status struct {
	ID string `json:"id"`
	Lv int    `json:"lv"`
}

// Player = สเตตัสสุดท้ายของผู้เล่น (calc.player)
type Player struct {
	Stats          map[string]float64
	Weapon         *gamedata.Weapon
	HasShield      bool
	APS            float64
	AttackElement  string
	DefenseElement string
	Sources        map[string][]Source // ที่มาของโบนัสแต่ละสเตตัส (ไว้แสดง tooltip)
}

// Source = โบนัสของสเตตัสหนึ่งตัวมาจากไหน
type Source struct {
	Name string `json:"name"`
	Text string `json:"text"`
	Buff bool   `json:"buff"`
}

func (p *Player) S(k string) float64 { return p.Stats[k] }

// MonsterStats = สเตตัสมอนสเตอร์หลังรวมสถานะที่ผู้เล่นติดให้ (calc.monster)
type MonsterStats struct {
	Def, MDef, Flee, Hit, Atk, MaxHP, DamageTaken, Interval float64
	Element, Size                                           string
}

var equipSlots = [...]string{"headgear", "armor", "garment", "footgear", "accessory", "card"}

// Usage = ค่าใช้สกิลที่เลเวลนั้น
type Usage struct {
	SP, HP, Cooldown, Duration, HPDrain, SPDrain float64
	UsesAction                                   bool
}

func (e *Engine) Usage(s *gamedata.Skill, lv int) Usage {
	u := s.Usage
	ua := s.Type != "toggle"
	if u.UsesAction != nil {
		ua = *u.UsesAction
	}
	return Usage{u.SP.Val(lv), u.HP.Val(lv), u.Cooldown.Val(lv), u.Duration.Val(lv), u.HPDrain.Val(lv), u.SPDrain.Val(lv), ua}
}

func (e *Engine) weaponOf(st *State) *gamedata.Weapon {
	if w := e.D.Weapon(st.WeaponID); w != nil {
		return w
	}
	if len(e.D.Weapons) > 0 {
		return &e.D.Weapons[0]
	}
	return nil
}

type passive struct {
	skill  *gamedata.Skill
	lv     int
	active bool
}

func (e *Engine) passives(st *State) []passive {
	w := e.D.Weapon(st.WeaponID)
	var out []passive
	for _, s := range e.VisibleSkills(st.ClassID) {
		lv := st.learnedLv(s.ID)
		if lv > 0 && s.Type == "passive" {
			out = append(out, passive{s, lv, e.WeaponOK(s, w, st.HasShield)})
		}
	}
	return out
}

// Player คำนวณสเตตัสสุดท้าย = (ชีต + flat) × (1 + %passive + %บัฟ(จำกัดเพดาน))
func (e *Engine) Player(st *State, statuses []Status) *Player {
	D := e.D
	g := D.Globals
	w := e.weaponOf(st)
	base := make(map[string]float64, len(D.StatDefs))
	for _, sd := range D.StatDefs {
		base[sd.ID] = st.Sheet[sd.ID].F()
	}
	flat := map[string]float64{}
	pct := map[string]float64{}
	bpct := map[string]float64{}
	sources := map[string][]Source{}
	put := func(stat, mode string, v float64, name string, buff bool) {
		if _, ok := base[stat]; !ok {
			return
		}
		sources[stat] = append(sources[stat], Source{Name: name, Text: e.fmtEffectValue(stat, mode, v), Buff: buff})
		if mode == "percent" {
			if buff {
				bpct[stat] += v
			} else {
				pct[stat] += v
			}
		} else {
			flat[stat] += v
		}
	}
	for _, p := range e.passives(st) {
		if !p.active {
			continue
		}
		for _, ef := range p.skill.Effects {
			if ef.AppliesTo != "target" {
				put(ef.Stat, ef.Mode, ef.Value.Val(p.lv), p.skill.Name, false)
			}
		}
	}
	attackElement, defenseElement := "neutral", "neutral"
	for _, slot := range equipSlots {
		id := st.Equipped[slot]
		if id == "" {
			continue
		}
		item := D.Item(id)
		if item == nil {
			continue
		}
		if item.AttackElement != "" {
			attackElement = item.AttackElement
		}
		if item.DefenseElement != "" {
			defenseElement = item.DefenseElement
		}
		for _, ef := range item.Effects {
			put(ef.Stat, ef.Mode, ef.Value.Val(1), item.Name, false)
		}
	}
	for _, sx := range statuses {
		s := D.Skill(sx.ID)
		if s == nil {
			continue
		}
		for _, ef := range s.Effects {
			if ef.AppliesTo != "target" {
				put(ef.Stat, ef.Mode, ef.Value.Val(sx.Lv), s.Name, true)
			}
		}
	}
	S := make(map[string]float64, len(base))
	for k, bv := range base {
		b := bpct[k]
		if cap, ok := g.BuffPercentCap[k]; ok && b > cap {
			b = cap
		}
		S[k] = (bv + flat[k]) * (1 + pct[k] + b)
	}
	S["aspd"] = clamp(S["aspd"], 0, g.AspdCap)
	S["physReduction"] = clamp(S["physReduction"], 0, g.MaxPhysReduction)
	S["blockChance"] = clamp(S["blockChance"], 0, 1)
	S["doubleAttack"] = clamp(S["doubleAttack"], 0, 1)
	S["castReduction"] = clamp(S["castReduction"], 0, 100)
	S["autospellChance"] = clamp(S["autospellChance"]*D.FormulaConfig.WeaponProfiles[e.weaponProfileID(st)].AutospellEfficiency, 0, D.FormulaConfig.AutospellGlobal.MaxCombinedTriggerChance)
	S["damageTaken"] = math.Max(-0.9, S["damageTaken"])
	S["maxHp"] = math.Max(1, S["maxHp"])
	S["maxSp"] = math.Max(0, S["maxSp"])
	for _, k := range [...]string{"def", "mdef", "flee", "hit", "atk", "matk"} {
		S[k] = math.Max(0, S[k])
	}
	aps := math.Max(0.1, 100/(200-math.Min(S["aspd"], 199)))
	return &Player{Stats: S, Weapon: w, HasShield: st.HasShield, APS: aps, AttackElement: attackElement, DefenseElement: defenseElement, Sources: sources}
}

// Monster รองรับสถานะที่ผู้เล่นติดให้ (effect appliesTo:'target')
func (e *Engine) Monster(m *gamedata.Monster, statuses []Status) *MonsterStats {
	S := &MonsterStats{Def: m.Def, MDef: m.MDef, Flee: m.Flee, Hit: m.Hit, Atk: m.Atk, MaxHP: m.MaxHP, Element: m.Element, Size: m.Size}
	if S.MaxHP == 0 {
		S.MaxHP = 1
	}
	if S.Element == "" {
		S.Element = "neutral"
	}
	if S.Size == "" {
		S.Size = "medium"
	}
	ref := func(stat string) *float64 {
		switch stat {
		case "def":
			return &S.Def
		case "mdef":
			return &S.MDef
		case "flee":
			return &S.Flee
		case "hit":
			return &S.Hit
		case "atk":
			return &S.Atk
		case "maxHp":
			return &S.MaxHP
		case "damageTaken":
			return &S.DamageTaken
		}
		return nil
	}
	pct := map[string]float64{}
	for _, sx := range statuses {
		s := e.D.Skill(sx.ID)
		if s == nil {
			continue
		}
		for _, ef := range s.Effects {
			p := ref(ef.Stat)
			if ef.AppliesTo != "target" || p == nil {
				continue
			}
			v := ef.Value.Val(sx.Lv)
			if ef.Mode == "percent" {
				pct[ef.Stat] += v
			} else {
				*p += v
			}
		}
	}
	for k, v := range pct {
		p := ref(k)
		*p = *p * (1 + v)
	}
	for _, p := range [...]*float64{&S.Def, &S.MDef, &S.Flee, &S.Hit, &S.Atk} {
		*p = math.Max(0, *p)
	}
	S.DamageTaken = math.Max(-0.9, S.DamageTaken)
	iv := m.Interval
	if iv == 0 {
		iv = 2
	}
	S.Interval = math.Max(0.2, iv)
	return S
}

// ---------- ธาตุ / ขนาด ----------

func (e *Engine) ElementMult(atk, def string) float64 {
	if atk == "" {
		atk = "neutral"
	}
	if def == "" {
		def = "neutral"
	}
	if row, ok := e.D.ElementSystem.Matrix[atk]; ok {
		if v, ok := row[def]; ok {
			return v
		}
	}
	return 1.0
}

func (e *Engine) SizeMult(weaponID, targetSize string) float64 {
	if weaponID == "" {
		weaponID = "unarmed"
	}
	if targetSize == "" {
		targetSize = "medium"
	}
	if row, ok := e.D.ElementSystem.SizeMatrix[weaponID]; ok {
		if v, ok := row[targetSize]; ok {
			return v
		}
	}
	return 1.0
}

// ---------- สูตรกลาง ----------

func (e *Engine) HitChance(hit, flee, lo, hi float64) float64 {
	g := e.D.Globals
	return clamp(g.HitBase+(hit-flee)*g.HitPerPoint, lo, hi)
}

func (e *Engine) reduction(def, cap float64) float64 {
	def = math.Max(0, def)
	return math.Min(cap, def/(def+e.D.Globals.SoftDefK))
}

// Basic = ดาเมจพื้นฐานของการตีธรรมดา (100% ATK กายภาพ)
var Basic = gamedata.DamageSpec{Kind: "physical", Terms: []gamedata.DamageTerm{{Stat: "atk", Mult: gamedata.Const(1)}}}

type Part struct {
	Stat  string  `json:"stat"`
	Mult  float64 `json:"mult"`
	Value float64 `json:"value"`
	Out   float64 `json:"out"`
}

type Components struct {
	Raw        float64 `json:"raw"`
	Parts      []Part  `json:"parts"`
	Red        float64 `json:"red"`
	CritRed    float64 `json:"critRed"`
	Normal     float64 `json:"normal"`
	Crit       float64 `json:"crit"`
	CritChance float64 `json:"critChance"`
	HitChance  float64 `json:"hitChance"`
	Expected   float64 `json:"expected"`
	Kind       string  `json:"kind"`
	ElemMult   float64 `json:"elemMult"`
	AtkElem    string  `json:"atkElem"`
	DefElem    string  `json:"defElem"`
}

// Components แยกส่วนประกอบดาเมจ (ไม่สุ่ม) รวมตัวคูณธาตุ
func (e *Engine) Components(spec *gamedata.DamageSpec, lv int, P *Player, M *MonsterStats) Components {
	g := e.D.Globals
	S := P.Stats
	raw := 0.0
	parts := make([]Part, 0, len(spec.Terms))
	for _, t := range spec.Terms {
		m := t.Mult.Val(lv)
		sv := S[t.Stat]
		raw += m * sv
		parts = append(parts, Part{t.Stat, m, sv, m * sv})
	}
	atkElem := spec.Element
	if atkElem == "" {
		atkElem = P.AttackElement
	}
	if atkElem == "" {
		atkElem = "neutral"
	}
	defElem := M.Element
	if defElem == "" {
		defElem = "neutral"
	}
	elemMult := e.ElementMult(atkElem, defElem)
	taken := (1 + M.DamageTaken) * elemMult
	var normal, crit, cc, hc, red, critRed float64
	if spec.Kind == "magic" {
		red = e.reduction(M.MDef, g.MaxMagicReduction)
		critRed = e.reduction(M.MDef*(1-clamp(S["mdefIgnore"], 0, 1)), g.MaxMagicReduction)
		normal = raw * (1 - red)
		crit = raw * (g.CritMult + S["critDmg"]) * (1 - critRed)
		if !spec.NoCrit {
			cc = clamp(S["magicCrit"]/100, 0, 1)
		}
		hc = 1
	} else {
		red = e.reduction(M.Def*(1-clamp(S["defPen"], 0, 1)), g.MaxPhysReduction)
		critRed = 0
		normal = raw * (1 - red)
		crit = raw * g.CritMult
		if !spec.NoCrit {
			cc = clamp(S["physCrit"]/100, 0, 1)
		}
		if spec.AlwaysHit {
			hc = 1
		} else {
			hc = e.HitChance(S["hit"], M.Flee, 0.05, 0.95)
		}
	}
	normal = math.Max(1, normal*taken)
	crit = math.Max(1, crit*taken)
	expected := cc*crit + (1-cc)*hc*normal
	return Components{raw, parts, red, critRed, normal, crit, cc, hc, expected, spec.Kind, elemMult, atkElem, defElem}
}

type RollResult struct {
	Miss     bool    `json:"miss"`
	Crit     bool    `json:"crit"`
	Dmg      int     `json:"dmg"`
	ElemMult float64 `json:"elemMult"`
	AtkElem  string  `json:"atkElem,omitempty"`
}

// Roll ทอยดาเมจจริง 1 ครั้ง (ลำดับการเรียก rng ตรงกับ JS)
func (e *Engine) Roll(spec *gamedata.DamageSpec, lv int, P *Player, M *MonsterStats, rng func() float64, variance float64) RollResult {
	c := e.Components(spec, lv, P, M)
	crit := rng() < c.CritChance
	if !crit && rng() >= c.HitChance {
		return RollResult{Miss: true, ElemMult: c.ElemMult}
	}
	d := c.Normal
	if crit {
		d = c.Crit
	}
	d *= 1 + (rng()*2-1)*variance
	return RollResult{Crit: crit, Dmg: int(math.Max(1, jsRound(d))), ElemMult: c.ElemMult, AtkElem: c.AtkElem}
}

type Strike struct {
	Miss     bool    `json:"miss"`
	Blocked  bool    `json:"blocked"`
	Dmg      int     `json:"dmg"`
	ElemMult float64 `json:"elemMult"`
}

// MonsterStrike = มอนสเตอร์ตีผู้เล่น 1 ครั้ง
func (e *Engine) MonsterStrike(P *Player, M *MonsterStats, rng func() float64) Strike {
	g := e.D.Globals
	S := P.Stats
	hc := e.HitChance(M.Hit, S["flee"], math.Max(0.05, 1-g.MaxDodge), 0.95)
	elemMult := e.ElementMult(M.Element, P.DefenseElement)
	if rng() >= hc {
		return Strike{Miss: true, ElemMult: elemMult}
	}
	d := M.Atk * (1 - e.reduction(S["def"], g.MaxPhysReduction)) * (1 - S["physReduction"]) * (1 + S["damageTaken"]) * elemMult
	blocked := false
	if P.HasShield && S["blockChance"] > 0 && rng() < S["blockChance"] {
		blocked = true
		d *= 1 - g.BlockReduction
	}
	return Strike{Blocked: blocked, Dmg: int(math.Max(1, jsRound(d))), ElemMult: elemMult}
}

// MonsterDPS ค่าคาดหวังของมอนสเตอร์ต่อวินาที
func (e *Engine) MonsterDPS(P *Player, M *MonsterStats) float64 {
	g := e.D.Globals
	S := P.Stats
	hc := e.HitChance(M.Hit, S["flee"], math.Max(0.05, 1-g.MaxDodge), 0.95)
	elemMult := e.ElementMult(M.Element, P.DefenseElement)
	base := M.Atk * (1 - e.reduction(S["def"], g.MaxPhysReduction)) * (1 - S["physReduction"]) * (1 + S["damageTaken"]) * elemMult
	blk := 0.0
	if P.HasShield {
		blk = S["blockChance"] * g.BlockReduction
	}
	return hc * base * (1 - blk) / M.Interval
}

// ---------- ระบบแต้มสเตตัส & คำนวณชีตจากสูตร RO ----------

func StatCost(cur float64) float64 { return math.Floor(math.Max(1, cur)/10) + 1 }

func CostToReach(target float64) float64 {
	sum := 0.0
	for v := 1.0; v < target; v++ {
		sum += StatCost(v)
	}
	return sum
}

func (e *Engine) StatusPointsForLevel(lv float64) float64 {
	s := e.D.FormulaConfig.StatusPointSystem
	return math.Floor((lv + s.LevelUpOffset) / s.LevelUpDivisor)
}

func (e *Engine) TotalStatusPoints(lv int) float64 {
	tot := e.D.FormulaConfig.StatusPointSystem.StartPoints
	for L := 2; L <= lv; L++ {
		tot += e.StatusPointsForLevel(float64(L))
	}
	return tot
}

func EffectiveStat(v float64, curve *gamedata.StatCurve) float64 {
	v = math.Max(0, v)
	if curve == nil || curve.Breakpoints == nil || curve.Slopes == nil {
		return v
	}
	bp, sl := curve.Breakpoints, curve.Slopes
	out, prev := 0.0, 0.0
	for i := 0; i < len(bp); i++ {
		seg := math.Max(0, math.Min(v, bp[i])-prev)
		slope := 1.0
		if i < len(sl) {
			slope = sl[i]
		}
		out += seg * slope
		prev = bp[i]
		if v <= prev {
			return out
		}
	}
	tail := 1.0
	if len(sl) > 0 {
		tail = sl[len(sl)-1]
	}
	out += math.Max(0, v-prev) * tail
	return out
}

func (e *Engine) NextBaseExp(lv float64) float64 {
	L := math.Max(1, lv)
	c := e.D.Rules.Progression.BaseExp
	return jsRound(c.Base + L*L*c.PerLevelSq)
}

func (e *Engine) NextJobExp(lv float64) float64 {
	L := math.Max(1, lv)
	c := e.D.Rules.Progression.JobExp
	return jsRound(c.Base + L*L*c.PerLevelSq)
}

type Derived struct {
	Sheet       map[string]float64 `json:"sheet"`
	Eff         map[string]float64 `json:"eff"`
	WeaponRange float64            `json:"weaponRange"`
}

var primaryStats = [...]string{"str", "agi", "vit", "int", "dex", "luk"}

// ComputeDerivedFromRaw คำนวณชีตสเตตัสจากแต้มดิบ (str/agi/...) + คลาส + อาวุธ
func (e *Engine) ComputeDerivedFromRaw(st *State) Derived {
	F := e.D.FormulaConfig
	C := F.BaseConstants
	g := e.D.Globals
	raw := map[string]float64{"str": 40, "agi": 40, "vit": 30, "int": 30, "dex": 40, "luk": 20}
	if st.RawStats != nil {
		raw = map[string]float64{}
		for k, v := range st.RawStats {
			raw[k] = v.F()
		}
	}
	lv := math.Max(1, st.baseLv())
	if st.BaseLv == 0 {
		lv = 50
	}
	eff := map[string]float64{}
	for _, k := range primaryStats {
		v := raw[k]
		if v == 0 {
			v = 1
		}
		var cv *gamedata.StatCurve
		if c, ok := F.StatCurve[k]; ok {
			cv = &c
		}
		eff[k] = EffectiveStat(v, cv)
	}
	kc, ok := F.ClassCoefs[st.ClassID]
	if !ok {
		kc = F.ClassCoefs[e.D.Classes[0].ID] // ไอดีไม่รู้จัก → ใช้คลาสแรกในข้อมูล (ไม่ฝังค่าในโค้ด)
	}
	wp := F.WeaponProfiles[e.weaponProfileID(st)]
	wDef := e.D.Weapon(st.WeaponID)
	slot1H := wDef == nil || wDef.SlotType == "1H"
	hasShield := st.HasShield && slot1H
	sh := *F.ShieldProfile
	atk := eff[wp.Stat] * wp.Coeff
	if wp.Stat2 != "" {
		atk += eff[wp.Stat2] * wp.Coeff2
	}
	aspd := C.AspdBase + eff["agi"]*C.AspdPerAgi + eff["dex"]*C.AspdPerDex + wp.AspdOffset
	if hasShield {
		aspd += sh.AspdOffset
	}
	aspd = clamp(aspd, 0, g.AspdCap)
	hit := C.HitBase + eff["dex"]*C.HitPerDex + wp.HitBonusFlat - wp.HitPenalty
	flee := C.FleeBase + eff["agi"]*C.FleePerAgi + eff["luk"]*C.FleePerLuk
	physCrit := C.CritBase + eff["luk"]*C.CritPerLuk + wp.CritBonusFlat
	matk := eff["int"] * C.MatkPerInt * (1 + wp.MatkPercent)
	maxHp := jsRound((eff["vit"]*C.HPPerVit + lv*C.HPPerLevel) * kc.HPCoef)
	maxSp := jsRound((eff["int"]*C.SPPerInt + lv*C.SPPerLevel) * kc.SPCoef)
	tension := math.Min(0.25, math.Max(0, aspd-C.AspdBase)*0.002)
	def := eff["vit"] * C.DefPerVit
	if hasShield {
		def += sh.DefFlat
	}
	def *= 1 - tension
	mdef := eff["int"] * C.MDefPerInt
	hpRegen := toFixed(eff["vit"]*C.HPRegenPerVit, 2)
	castReduction := toFixed(math.Min(100, eff["dex"]*C.CastReductionPerDex+wp.CastReductionBonus*100), 1)
	spRegen := toFixed(C.SPRegenBase+eff["int"]*C.SPRegenPerInt, 2)
	mc := *F.MagicCrit
	magicCrit := toFixed(mc.ChanceBase+eff["luk"]*C.CritPerLuk*mc.LukScalar, 2)
	mdefIgnore := toFixed(math.Min(mc.MdefIgnoreCap, mc.MdefIgnoreBase+eff["dex"]*mc.DexScalar), 3)
	critDmg := toFixed(math.Min(mc.CritDmgCap, mc.CritDmgBase+eff["int"]*mc.IntScalar), 3)

	rawOr1 := func(k string) float64 {
		if v := raw[k]; v != 0 {
			return v
		}
		return 1
	}
	block := 0.0
	if hasShield {
		block = sh.BlockChance
	}
	sheet := map[string]float64{
		"str": rawOr1("str"), "agi": rawOr1("agi"), "vit": rawOr1("vit"), "int": rawOr1("int"), "dex": rawOr1("dex"), "luk": rawOr1("luk"),
		"atk": toFixed(atk, 1), "matk": toFixed(matk, 1), "hit": toFixed(hit, 1), "aspd": toFixed(aspd, 1),
		"physCrit": toFixed(physCrit, 1), "magicCrit": magicCrit, "mdefIgnore": mdefIgnore, "critDmg": critDmg,
		"defPen": toFixed(wp.DefPen, 2), "def": toFixed(def, 1), "mdef": toFixed(mdef, 1), "flee": toFixed(flee, 1),
		"blockChance": block, "physReduction": 0, "damageTaken": 0,
		"maxHp": maxHp, "maxSp": maxSp, "hpRegen": hpRegen, "spRegen": spRegen,
		"castReduction": castReduction, "doubleAttack": 0, "autospellChance": 0,
	}
	return Derived{Sheet: sheet, Eff: eff, WeaponRange: wp.Range}
}

// ApplyAutoSync ทำเหมือน syncPlayerStats ฝั่งไคลเอนต์: ถ้า autoSyncStats ให้คำนวณชีตจากแต้มดิบ
func (e *Engine) ApplyAutoSync(st *State) {
	if !st.AutoSyncStats {
		return
	}
	d := e.ComputeDerivedFromRaw(st)
	st.Sheet = make(map[string]Num, len(d.Sheet))
	for k, v := range d.Sheet {
		st.Sheet[k] = Num(v)
	}
}

// weaponProfileID คืนไอดีโปรไฟล์อาวุธของ state; ถ้าไม่รู้จักใช้อาวุธแรกในข้อมูล (ไม่ฝังค่าในโค้ด)
func (e *Engine) weaponProfileID(st *State) string {
	if _, ok := e.D.FormulaConfig.WeaponProfiles[st.WeaponID]; ok {
		return st.WeaponID
	}
	return e.D.Weapons[0].ID
}

func (e *Engine) statDef(id string) *gamedata.StatDef {
	for i := range e.D.StatDefs {
		if e.D.StatDefs[i].ID == id {
			return &e.D.StatDefs[i]
		}
	}
	return nil
}

func fmtNum(v float64, d int) string {
	return strconv.FormatFloat(toFixed(math.Abs(v), d), 'f', -1, 64)
}

func sign(v float64) string {
	if v < 0 {
		return "−"
	}
	return "+"
}

// fmtEffectValue แสดงผลของ effect เช่น "+9" "−30%" (ส่วนที่ต่อท้ายชื่อสเตตัสในฝั่ง JS: fmtEffect ตัดชื่อออกแล้ว)
func (e *Engine) fmtEffectValue(stat, mode string, v float64) string {
	sd := e.statDef(stat)
	switch {
	case mode == "percent":
		return sign(v) + fmtNum(v*100, 1) + "%"
	case sd != nil && sd.Kind == "frac":
		return sign(v) + fmtNum(v*100, 1) + "%"
	case sd != nil && sd.Kind == "pct":
		return sign(v) + fmtNum(v, 1) + "%"
	}
	return sign(v) + fmtNum(v, 2)
}
