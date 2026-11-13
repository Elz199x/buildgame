package sim

import (
	"math"
	"sort"
	"strconv"

	"catquest-ro/server/internal/gamedata"
)

// Tick = ก้าวเวลาคงที่ของตัวจำลอง (วินาที)
const Tick = 0.05

// Event = เหตุการณ์ในบันทึกการต่อสู้
type Event struct {
	T       float64 `json:"t"`
	Kind    string  `json:"kind"`
	Text    string  `json:"text"`
	Who     string  `json:"who,omitempty"`
	Amount  float64 `json:"amount,omitempty"`
	Crit    bool    `json:"crit,omitempty"`
	Blocked bool    `json:"blocked,omitempty"`
	SkillID string  `json:"skillId,omitempty"`
}

type skillTotals struct {
	id                       string
	casts, hits, crits, miss int
	dmg, sp                  float64
}

type totals struct {
	dmg               float64
	hits, crits, miss int
	casts             int
	spUsed, hpLost    float64
	healed, aliveTime float64
	deaths, kills     int
	basic             struct {
		n, crits, miss int
		dmg            float64
	}
	skills   []*skillTotals // ลำดับตามการร่ายครั้งแรก (เหมือน Object.keys ของ JS)
	skillIdx map[string]*skillTotals
	uptime   map[string]float64
}

func newTotals() *totals {
	return &totals{skillIdx: map[string]*skillTotals{}, uptime: map[string]float64{}}
}

func (t *totals) sk(id string) *skillTotals {
	if s, ok := t.skillIdx[id]; ok {
		return s
	}
	s := &skillTotals{id: id}
	t.skillIdx[id] = s
	t.skills = append(t.skills, s)
	return s
}

type active struct {
	id      string
	lv      int
	left    float64
	toggle  bool
	group   string
	trigger bool
}

type queued struct {
	id    string
	until float64
}

// Sim คือตัวจำลองการต่อสู้เฉพาะสกิล (ก้าว 0.05 วินาที สุ่มแบบกำหนด seed)
type Sim struct {
	e     *Engine
	state *State
	rng   *RNG

	t, acc                float64
	hp, sp                float64
	alive                 bool
	reviveLeft, act, mact float64
	mhp                   float64
	mAlive                bool
	respawnLeft           float64
	pst, mst              []active
	cd                    map[string]float64
	queue                 []queued
	dirty                 bool
	P                     *Player
	M                     *MonsterStats
	T                     *totals
	events                []Event
}

// NewSim สร้างตัวจำลองจาก state (ถูกคัดลอก — ไม่แก้ของเดิม) แล้วรีเซ็ต
func (e *Engine) NewSim(st *State, seed int64) *Sim {
	s := &Sim{e: e, state: st.Clone(), rng: NewRNG(seed)}
	s.reset()
	return s
}

func (s *Sim) ev(kind, text string, f func(*Event)) {
	x := Event{T: s.t, Kind: kind, Text: text}
	if f != nil {
		f(&x)
	}
	s.events = append(s.events, x)
	if len(s.events) > 400 {
		s.events = s.events[len(s.events)-400:]
	}
}

func (s *Sim) statuses(list []active) []Status {
	out := make([]Status, len(list))
	for i, x := range list {
		out[i] = Status{x.id, x.lv}
	}
	return out
}

func (s *Sim) recompute() {
	s.P = s.e.Player(s.state, s.statuses(s.pst))
	s.M = s.e.Monster(&s.state.Monster.Monster, s.statuses(s.mst))
	s.hp = math.Min(s.hp, s.P.S("maxHp"))
	s.sp = math.Min(s.sp, s.P.S("maxSp"))
	s.mhp = math.Min(s.mhp, s.M.MaxHP)
	s.dirty = false
}

func (s *Sim) addStatus(list *[]active, x active) {
	l := *list
	for i := len(l) - 1; i >= 0; i-- {
		if l[i].id == x.id || (x.group != "" && l[i].group == x.group) {
			l = append(l[:i], l[i+1:]...)
		}
	}
	*list = append(l, x)
	s.dirty = true
}

func hasSelf(sk *gamedata.Skill) bool {
	for _, e := range sk.Effects {
		if e.AppliesTo != "target" {
			return true
		}
	}
	return false
}

func hasTarget(sk *gamedata.Skill) bool {
	for _, e := range sk.Effects {
		if e.AppliesTo == "target" {
			return true
		}
	}
	return false
}

func isOn(list []active, id string) bool {
	for _, x := range list {
		if x.id == id {
			return true
		}
	}
	return false
}

func (s *Sim) reset() {
	s.t, s.acc = 0, 0
	s.alive, s.reviveLeft, s.act = true, 0, 0.2
	s.mAlive, s.respawnLeft = true, 0
	s.pst, s.mst = nil, nil
	s.cd = map[string]float64{}
	s.queue = nil
	s.T = newTotals()
	s.events = nil
	s.hp, s.sp, s.mhp = math.Inf(1), math.Inf(1), math.Inf(1)
	s.dirty = true
	s.recompute()
	s.mact = s.M.Interval
}

func fmtN(v float64, d int) string { return strconv.FormatFloat(v, 'f', d, 64) }

// why คืนเหตุผลที่ใช้สกิลไม่ได้ (” = ใช้ได้)
func (s *Sim) why(sk *gamedata.Skill) string {
	e := s.e
	lv := s.state.learnedLv(sk.ID)
	if lv == 0 {
		return "ยังไม่ได้เรียน"
	}
	if !s.alive {
		return "ตายอยู่"
	}
	if !IsCastable(sk) {
		return "ไม่ใช่สกิลที่กดใช้ได้"
	}
	if !contains(e.Chain(s.state.ClassID), sk.Class) {
		return "ไม่ใช่สกิลของสายนี้"
	}
	if !e.WeaponOK(sk, s.P.Weapon, s.P.HasShield) {
		if sk.NeedShield {
			return "ต้องสวมโล่ + อาวุธ 1 มือ"
		}
		return "อาวุธไม่ตรงเงื่อนไข"
	}
	u := e.Usage(sk, lv)
	if c := s.cd[sk.ID]; c > 0 {
		return "คูลดาวน์ " + fmtN(c, 1) + " วิ"
	}
	if s.sp < u.SP {
		return "SP ไม่พอ (" + fmtN(math.Ceil(u.SP), 0) + ")"
	}
	if u.HP > 0 && s.hp <= u.HP*s.P.S("maxHp") {
		return "HP ไม่พอ"
	}
	if sk.Damage.Kind != "" && !s.mAlive {
		return "ไม่มีเป้าหมาย"
	}
	return ""
}

func (s *Sim) applyHit(r RollResult, label string, sk *skillTotals) {
	if r.Miss {
		s.T.miss++
		if sk != nil {
			sk.miss++
		}
		s.ev("miss", label+" พลาด", func(x *Event) { x.Who = "player" })
		return
	}
	d := float64(r.Dmg)
	s.mhp -= d
	s.T.dmg += d
	s.T.hits++
	if r.Crit {
		s.T.crits++
	}
	if sk != nil {
		sk.dmg += d
		sk.hits++
		if r.Crit {
			sk.crits++
		}
	}
	txt := label + " " + strconv.Itoa(r.Dmg)
	if r.Crit {
		txt += " (คริ!)"
	}
	s.ev("dmg", txt, func(x *Event) { x.Who = "player"; x.Amount = d; x.Crit = r.Crit })
}

func (s *Sim) checkKill() {
	if s.mhp > 0 {
		return
	}
	s.T.kills++
	s.ev("kill", "ล้มมอนสเตอร์ได้", func(x *Event) { x.Who = "monster" })
	if s.state.Opts.Immortal {
		s.mhp = s.M.MaxHP
		return
	}
	s.mAlive = false
	s.respawnLeft = s.e.D.Globals.RespawnDelay
	s.mst = nil
	s.dirty = true
}

func (s *Sim) basicAttack() {
	r := s.e.Roll(&Basic, 1, s.P, s.M, s.rng.Float, s.state.Opts.variance())
	s.T.basic.n++
	if r.Miss {
		s.T.basic.miss++
	} else {
		s.T.basic.dmg += float64(r.Dmg)
		if r.Crit {
			s.T.basic.crits++
		}
	}
	s.applyHit(r, "ตีธรรมดา", nil)
	s.checkKill()
	// Double Attack: ตีซ้ำอีก 1 ครั้งตามโอกาส (สุ่มเฉพาะเมื่อ > 0 ให้ตรงกับฝั่ง JS)
	if da := s.P.S("doubleAttack"); s.mAlive && da > 0 && s.rng.Float() < da {
		r2 := s.e.Roll(&Basic, 1, s.P, s.M, s.rng.Float, s.state.Opts.variance())
		s.T.basic.n++
		if r2.Miss {
			s.T.basic.miss++
		} else {
			s.T.basic.dmg += float64(r2.Dmg)
			if r2.Crit {
				s.T.basic.crits++
			}
		}
		s.applyHit(r2, "Double Attack", nil)
		s.checkKill()
	}
}

func (s *Sim) doCast(sk *gamedata.Skill) {
	e := s.e
	lv := s.state.learnedLv(sk.ID)
	u := e.Usage(sk, lv)
	st := s.T.sk(sk.ID)
	maxHp := s.P.S("maxHp")
	s.sp -= u.SP
	s.hp -= u.HP * maxHp
	if u.Cooldown > 0 {
		s.cd[sk.ID] = u.Cooldown
	}
	s.T.casts++
	s.T.spUsed += u.SP
	st.casts++
	st.sp += u.SP
	s.ev("cast", "ใช้ "+sk.Name+" Lv."+strconv.Itoa(lv), func(x *Event) { x.Who = "player"; x.SkillID = sk.ID })
	if sk.Damage.Kind != "" && s.mAlive {
		n := 1
		if sk.Damage.AoE {
			n = s.state.Opts.aoeTargets()
		}
		for i := 0; i < n; i++ {
			s.applyHit(e.Roll(&sk.Damage, lv, s.P, s.M, s.rng.Float, s.state.Opts.variance()), sk.Name, st)
		}
	}
	if sk.Heal != nil {
		amt := sk.Heal.PctMaxHP.Val(lv)*maxHp + sk.Heal.Flat.Val(lv)
		real := math.Max(0, math.Min(maxHp-s.hp, amt))
		s.hp += real
		s.T.healed += real
		s.ev("heal", sk.Name+" ฟื้น HP "+fmtN(jsRound(real), 0), func(x *Event) { x.Who = "player"; x.Amount = real })
	}
	if sk.Type == "toggle" {
		s.addStatus(&s.pst, active{id: sk.ID, lv: lv, left: math.Inf(1), toggle: true, group: sk.Group})
		s.ev("buff", "เปิด "+sk.Name, func(x *Event) { x.Who = "player" })
	} else if len(sk.Effects) > 0 && u.Duration > 0 {
		if hasSelf(sk) {
			s.addStatus(&s.pst, active{id: sk.ID, lv: lv, left: u.Duration, group: sk.Group})
		}
		if hasTarget(sk) && s.mAlive {
			s.addStatus(&s.mst, active{id: sk.ID, lv: lv, left: u.Duration, group: sk.Group})
		}
		s.ev("buff", sk.Name+" ติด "+fmtN(u.Duration, -1)+" วิ", func(x *Event) { x.Who = "player" })
	}
	s.dirty = true
	s.checkKill()
}

func (s *Sim) turnOff(id, why string) {
	idx := -1
	for i, x := range s.pst {
		if x.id == id {
			idx = i
			break
		}
	}
	if idx < 0 {
		return
	}
	s.pst = append(s.pst[:idx], s.pst[idx+1:]...)
	s.dirty = true
	name := id
	if sk := s.e.D.Skill(id); sk != nil {
		name = sk.Name
	}
	txt := name + " ปิด"
	if why != "" {
		txt += " (" + why + ")"
	}
	s.ev("off", txt, func(x *Event) { x.Who = "player" })
}

func (s *Sim) ruleOK(rule RotationRule, sk *gamedata.Skill) bool {
	if s.why(sk) != "" {
		return false
	}
	maxHp, maxSp := s.P.S("maxHp"), s.P.S("maxSp")
	hr := s.hp / maxHp
	sr := 1.0
	if maxSp > 0 {
		sr = s.sp / maxSp
	}
	maxHpPct := 1.0
	if rule.MaxHpPct != nil {
		maxHpPct = rule.MaxHpPct.F()
	}
	if sr < rule.MinSpPct.F() || hr < rule.MinHpPct.F() || hr > maxHpPct {
		return false
	}
	if sk.Type == "toggle" && isOn(s.pst, sk.ID) {
		return false
	}
	if (rule.SkipIfActive == nil || *rule.SkipIfActive) && sk.Damage.Kind == "" && sk.Type != "toggle" && len(sk.Effects) > 0 {
		if (hasSelf(sk) && isOn(s.pst, sk.ID)) || (hasTarget(sk) && isOn(s.mst, sk.ID)) {
			return false
		}
	}
	return true
}

func (s *Sim) choose() *gamedata.Skill {
	d := s.e.D
	kept := s.queue[:0]
	for _, q := range s.queue {
		if q.until > s.t && d.Skill(q.id) != nil {
			kept = append(kept, q)
		}
	}
	s.queue = kept
	for i := 0; i < len(s.queue); i++ {
		sk := d.Skill(s.queue[i].id)
		if s.why(sk) == "" {
			s.queue = append(s.queue[:i], s.queue[i+1:]...)
			return sk
		}
	}
	if s.state.Opts.auto() {
		for _, rule := range s.state.Rotation {
			if sk := d.Skill(rule.ID); sk != nil && s.ruleOK(rule, sk) {
				return sk
			}
		}
	}
	return nil
}

func (s *Sim) doAction() float64 {
	for g := 0; g < 6; g++ {
		sk := s.choose()
		if sk == nil {
			break
		}
		u := s.e.Usage(sk, s.state.learnedLv(sk.ID))
		s.doCast(sk)
		if u.UsesAction {
			return 1 / s.P.APS
		}
		if s.dirty {
			s.recompute()
		}
	}
	s.basicAttack()
	return 1 / s.P.APS
}

func (s *Sim) die() {
	s.alive = false
	s.reviveLeft = s.e.D.Globals.ReviveDelay
	s.T.deaths++
	s.pst = nil
	s.cd = map[string]float64{}
	s.queue = nil
	s.dirty = true
	s.ev("death", "ตัวละครล้ม!", func(x *Event) { x.Who = "player" })
}

func (s *Sim) revive() {
	s.alive = true
	s.pst = nil
	s.dirty = true
	s.recompute()
	s.hp, s.sp = s.P.S("maxHp"), s.P.S("maxSp")
	s.act = 0.3
	s.ev("revive", "ฟื้นคืนชีพ", func(x *Event) { x.Who = "player" })
}

func (s *Sim) tickOnce() {
	e := s.e
	const H = Tick
	if s.dirty {
		s.recompute()
	}
	s.t += H
	for k, v := range s.cd {
		s.cd[k] = math.Max(0, v-H)
	}
	for _, lst := range []*[]active{&s.pst, &s.mst} {
		l := *lst
		for i := len(l) - 1; i >= 0; i-- {
			l[i].left -= H
			if l[i].left <= 0 {
				sk := e.D.Skill(l[i].id)
				l = append(l[:i], l[i+1:]...)
				s.dirty = true
				if sk != nil {
					s.ev("off", sk.Name+" หมดเวลา", func(x *Event) { x.Who = "player" })
				}
			}
		}
		*lst = l
	}
	if !s.alive {
		s.reviveLeft -= H
		if s.reviveLeft <= 0 {
			s.revive()
		}
		return
	}
	s.T.aliveTime += H
	seen := map[string]bool{}
	for _, x := range append(append([]active(nil), s.pst...), s.mst...) {
		if !seen[x.id] {
			seen[x.id] = true
			s.T.uptime[x.id] += H
		}
	}
	P := s.P
	maxHp, maxSp := P.S("maxHp"), P.S("maxSp")
	s.hp = math.Min(maxHp, s.hp+P.S("hpRegen")*H)
	s.sp = math.Min(maxSp, s.sp+P.S("spRegen")*H)

	// toggle: ดูด HP/SP ต่อวินาทีและปิดอัตโนมัติ
	var toggles []active
	for _, x := range s.pst {
		if x.toggle {
			toggles = append(toggles, x)
		}
	}
	for _, x := range toggles {
		sk := e.D.Skill(x.id)
		if sk == nil {
			continue
		}
		u := e.Usage(sk, x.lv)
		hpBelow := 0.0
		if sk.ToggleOff != nil {
			hpBelow = sk.ToggleOff.HPBelow
		}
		if u.HPDrain > 0 {
			s.hp -= u.HPDrain * maxHp * H
			s.T.hpLost += u.HPDrain * maxHp * H
		}
		if u.SPDrain > 0 {
			s.sp -= u.SPDrain * H
		}
		if (hpBelow != 0 && s.hp/maxHp < hpBelow) || s.sp < 0 {
			s.sp = math.Max(0, s.sp)
			why := "SP หมด"
			if hpBelow != 0 && s.hp/maxHp < hpBelow {
				why = "HP ต่ำ"
			}
			s.turnOff(x.id, why)
		}
	}
	// trigger: เปิดเมื่อ HP ต่ำกว่าเกณฑ์ ปิดเมื่อ HP เกินเกณฑ์
	for _, sk := range e.VisibleSkills(s.state.ClassID) {
		if sk.Type != "trigger" || sk.Trigger == nil {
			continue
		}
		lv := s.state.learnedLv(sk.ID)
		if lv == 0 {
			continue
		}
		on := isOn(s.pst, sk.ID)
		hr := s.hp / maxHp
		if !on {
			if s.cd[sk.ID] <= 0 && sk.Trigger.HPBelow != 0 && hr <= sk.Trigger.HPBelow && e.WeaponOK(sk, P.Weapon, P.HasShield) {
				dur := sk.Usage.Duration.Val(lv)
				left := math.Inf(1)
				if dur > 0 {
					left = dur
				}
				s.addStatus(&s.pst, active{id: sk.ID, lv: lv, left: left, group: sk.Group, trigger: true})
				s.cd[sk.ID] = sk.Trigger.Cooldown
				s.T.sk(sk.ID).casts++
				s.ev("buff", sk.Name+" ทำงาน!", func(x *Event) { x.Who = "player" })
			}
		} else {
			above := 1.0
			if sk.Trigger.HPAbove != nil {
				above = *sk.Trigger.HPAbove
			}
			if hr > above {
				s.turnOff(sk.ID, "HP ฟื้น")
			}
		}
	}
	// มอนสเตอร์เกิดใหม่
	if !s.mAlive {
		s.respawnLeft -= H
		if s.respawnLeft <= 0 {
			s.mAlive = true
			s.recompute()
			s.mhp = s.M.MaxHP
			s.mact = s.M.Interval
			s.ev("spawn", "มอนสเตอร์เกิดใหม่", func(x *Event) { x.Who = "monster" })
		}
	}
	// ผู้เล่นลงมือ
	if s.mAlive {
		s.act -= H
		for g := 0; g < 8 && s.act <= 0 && s.alive && s.mAlive; g++ {
			s.act += s.doAction()
			if s.dirty {
				s.recompute()
			}
		}
	}
	// มอนสเตอร์สวนกลับ
	if s.mAlive && s.alive && s.state.Monster.Counter {
		s.mact -= H
		if s.mact <= 0 {
			s.mact += s.M.Interval
			r := e.MonsterStrike(s.P, s.M, s.rng.Float)
			if r.Miss {
				s.ev("dodge", "หลบการโจมตีได้", func(x *Event) { x.Who = "monster" })
			} else {
				d := float64(r.Dmg)
				s.hp -= d
				s.T.hpLost += d
				txt := "โดนตี " + strconv.Itoa(r.Dmg)
				if r.Blocked {
					txt += " (บล็อก)"
				}
				s.ev("taken", txt, func(x *Event) { x.Who = "monster"; x.Amount = d; x.Blocked = r.Blocked })
			}
		}
	}
	if s.hp <= 0 && s.alive {
		s.die()
	}
}

// Advance เดินเวลา dt วินาที (ก้าวละ 0.05)
func (s *Sim) Advance(dt float64) {
	s.acc += dt
	for guard := 0; s.acc >= Tick-1e-9 && guard < 20000; guard++ {
		s.tickOnce()
		s.acc -= Tick
	}
}

// Cast สั่งใช้สกิลด้วยมือ (เข้าคิว รอจังหวะถัดไป) / toggle สลับได้ทันที
func (s *Sim) Cast(id string) {
	sk := s.e.D.Skill(id)
	if sk == nil {
		return
	}
	if sk.Type == "toggle" {
		if isOn(s.pst, id) {
			s.turnOff(id, "ปิดเอง")
		} else if s.why(sk) == "" {
			s.doCast(sk)
		}
		return
	}
	for _, q := range s.queue {
		if q.id == id {
			return
		}
	}
	if len(s.queue) < 5 {
		s.queue = append(s.queue, queued{id, s.t + 8})
	}
}

func (s *Sim) Drain() []Event {
	e := s.events
	s.events = nil
	return e
}

// SkillSummary = สรุปดาเมจรายสกิล
type SkillSummary struct {
	ID    string  `json:"id"`
	Name  string  `json:"name"`
	Casts int     `json:"casts"`
	Dmg   float64 `json:"dmg"`
	Hits  int     `json:"hits"`
	Crits int     `json:"crits"`
	Miss  int     `json:"miss"`
	SP    float64 `json:"sp"`
	Share float64 `json:"share"`
	DPS   float64 `json:"dps"`
}

type BasicSummary struct {
	N     int     `json:"n"`
	Dmg   float64 `json:"dmg"`
	Share float64 `json:"share"`
	DPS   float64 `json:"dps"`
}

// Summary = ผลสรุปการจำลอง (ตรงกับ sim.summary() ฝั่ง JS)
type Summary struct {
	T         float64            `json:"t"`
	Dmg       float64            `json:"dmg"`
	DPS       float64            `json:"dps"`
	Hits      int                `json:"hits"`
	Crits     int                `json:"crits"`
	Miss      int                `json:"miss"`
	Casts     int                `json:"casts"`
	Basic     BasicSummary       `json:"basic"`
	Skills    []SkillSummary     `json:"skills"`
	SpUsed    float64            `json:"spUsed"`
	SpPerSec  float64            `json:"spPerSec"`
	SpNow     float64            `json:"spNow"`
	SpMax     float64            `json:"spMax"`
	HpLost    float64            `json:"hpLost"`
	Healed    float64            `json:"healed"`
	Deaths    int                `json:"deaths"`
	Kills     int                `json:"kills"`
	AliveFrac float64            `json:"aliveFrac"`
	Uptime    map[string]float64 `json:"uptime"`
	APS       float64            `json:"aps"`
}

func (s *Sim) Summary() Summary {
	T := s.T
	secs := math.Max(s.t, 0.001)
	skills := make([]SkillSummary, 0, len(T.skills))
	for _, r := range T.skills {
		name := r.id
		if sk := s.e.D.Skill(r.id); sk != nil {
			name = sk.Name
		}
		share := 0.0
		if T.dmg != 0 {
			share = r.dmg / T.dmg
		}
		skills = append(skills, SkillSummary{r.id, name, r.casts, r.dmg, r.hits, r.crits, r.miss, r.sp, share, r.dmg / secs})
	}
	sort.SliceStable(skills, func(i, j int) bool { return skills[i].Dmg > skills[j].Dmg })
	up := make(map[string]float64, len(T.uptime))
	for id, v := range T.uptime {
		up[id] = v / secs
	}
	bshare := 0.0
	if T.dmg != 0 {
		bshare = T.basic.dmg / T.dmg
	}
	return Summary{
		T: s.t, Dmg: T.dmg, DPS: T.dmg / secs, Hits: T.hits, Crits: T.crits, Miss: T.miss, Casts: T.casts,
		Basic:  BasicSummary{T.basic.n, T.basic.dmg, bshare, T.basic.dmg / secs},
		Skills: skills, SpUsed: T.spUsed, SpPerSec: T.spUsed / secs, SpNow: s.sp, SpMax: s.P.S("maxSp"),
		HpLost: T.hpLost, Healed: T.healed, Deaths: T.deaths, Kills: T.kills, AliveFrac: T.aliveTime / secs, Uptime: up, APS: s.P.APS,
	}
}

// StateFromBuild สร้าง state ทดสอบจากบิลด์สำเร็จรูป (ไม่แตะ state ต้นทาง)
func (e *Engine) StateFromBuild(base *State, buildID string) *State {
	b := e.D.Build(buildID)
	if b == nil {
		return nil
	}
	st := base.Clone()
	st.ClassID = b.ClassID
	st.JobLv = Num(b.JobLv)
	st.Learned = make(map[string]Num, len(b.Learned))
	for k, v := range b.Learned {
		st.Learned[k] = Num(v)
	}
	if p := e.D.Preset(b.PresetID); p != nil {
		st.WeaponID = p.WeaponID
		st.HasShield = p.HasShield
		st.Sheet = make(map[string]Num, len(p.Sheet))
		for k, v := range p.Sheet {
			st.Sheet[k] = Num(v)
		}
	}
	st.Rotation = e.DefaultRotation(st)
	return st
}

// Benchmark รันแบบไม่มี UI N วินาที (เป้านิ่งอมตะ ใช้ลำดับสกิลอัตโนมัติ) แล้วสรุปผล
func (e *Engine) Benchmark(st *State, seconds float64, seed int64) Summary {
	c := st.Clone()
	t := true
	c.Opts.Auto = &t
	c.Opts.Immortal = true
	if seconds <= 0 {
		seconds = 60
	}
	s := e.NewSim(c, seed)
	s.Advance(seconds)
	return s.Summary()
}
