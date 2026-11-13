package game

import (
	"encoding/json"
	"errors"
	"math"
	"math/rand"
	"reflect"
	"sort"
	"sync"
	"time"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/progress"
	"catquest-ro/server/internal/protocol"
	"catquest-ro/server/internal/sim"
)

const (
	WorldW float32 = 2400
	WorldH float32 = 1700
	TickHz         = 30

	maxMoveSpeed       = 720.0 // px/s (กลิ้งเร็วสุด ~620 + ค่าเผื่อ)
	moveBudgetMax      = 160.0 // โควตาสะสมสูงสุด (px) รองรับความหน่วงเครือข่ายเป็นช่วง ๆ
	attackLatencySlack = 70.0
	minActionInterval  = 0.15
	stateEveryTicks    = 6 // ส่ง PLAYER_STATE ให้เจ้าของ ~5Hz
	maxMobs            = 255
)

type zone struct {
	shape   uint8 // 0 วงกลม 1 โคน 2 เส้น
	x, y    float32
	angle   float32
	radius  float32
	coneRad float32
	mult    float64
}

// Mob = มอนสเตอร์ 1 ตัว (uid = ลำดับจุดเกิด เริ่ม 1)
type Mob struct {
	UID            uint32
	Def            *gamedata.Monster
	SlotID         string
	X, Y           float32
	HomeX, HomeY   float32
	HP, MaxHP      float64
	Alive          bool
	RespawnLeft    float32
	Facing         int8
	Anim           uint8
	AnimLeft       float32
	Casting        bool
	CastLeft       float32
	AtkCD, SkillCD float32
	returning      bool
	z              *zone
	statuses       []status
}

func (m *Mob) radius(base float64) float64 { return base * m.Def.World.Scale }

// Outbox = เฟรมที่ต้องส่งหลังแต่ละรอบ: กระจายทุกคน หรือส่งให้ผู้เล่นรายบุคคล
type Outbox struct {
	Broadcast [][]byte
	Direct    map[uint32][][]byte
}

// World คือสถานะโลกเกมทั้งหมด (ปลอดภัยต่อการเรียกพร้อมกันผ่าน mu)
type World struct {
	mu      sync.Mutex
	tick    uint32
	data    *gamedata.Data
	eng     *sim.Engine
	prog    *progress.Progress
	players map[uint32]*Player
	mobs    []*Mob
	rng     *rand.Rand
	out     Outbox
	nextUID uint32
}

func NewWorld(d *gamedata.Data) *World {
	w := &World{
		players: map[uint32]*Player{},
		rng:     rand.New(rand.NewSource(time.Now().UnixNano())),
		nextUID: 1000,
		data:    d,
		eng:     sim.New(d),
	}
	w.prog = progress.New(w.eng)
	w.rebuildMobs()
	w.addBots()
	return w
}

// SetData ใช้ข้อมูลเกมชุดใหม่: คำนวณสเตตัสผู้เล่นใหม่ และสร้างมอนสเตอร์ใหม่เฉพาะเมื่อส่วนที่เกี่ยวข้องเปลี่ยนจริง
func (w *World) SetData(d *gamedata.Data) {
	w.mu.Lock()
	defer w.mu.Unlock()
	old := w.data
	w.data, w.eng = d, sim.New(d)
	w.prog = progress.New(w.eng)
	if !reflect.DeepEqual(old.Monsters, d.Monsters) || !reflect.DeepEqual(old.SpawnsForCurrentMap(), d.SpawnsForCurrentMap()) {
		w.rebuildMobs()
	}
	for _, p := range w.players {
		if !p.Bot {
			w.refreshStateLocked(p)
		}
	}
}

func (w *World) rebuildMobs() {
	w.mobs = w.mobs[:0]
	for i, sp := range w.data.SpawnsForCurrentMap() {
		def := w.data.Monster(sp.MonsterID)
		if def == nil || len(w.mobs) >= maxMobs {
			continue
		}
		w.mobs = append(w.mobs, &Mob{
			UID: uint32(i + 1), Def: def, SlotID: sp.ID,
			X: float32(sp.X), Y: float32(sp.Y), HomeX: float32(sp.X), HomeY: float32(sp.Y),
			HP: def.MaxHP, MaxHP: def.MaxHP, Alive: true, Facing: -1,
			SkillCD: 3 + w.rng.Float32()*3, AtkCD: 0.8,
		})
	}
}

func (w *World) emit(f []byte) { w.out.Broadcast = append(w.out.Broadcast, f) }

func (w *World) emitTo(uid uint32, f []byte) {
	if w.out.Direct == nil {
		w.out.Direct = map[uint32][][]byte{}
	}
	w.out.Direct[uid] = append(w.out.Direct[uid], f)
}

// TakeOutbox ดึงเฟรมที่ค้างอยู่ (ดาเมจ วงแดง แชทบอท สถานะผู้เล่น)
func (w *World) TakeOutbox() Outbox {
	w.mu.Lock()
	defer w.mu.Unlock()
	o := w.out
	w.out = Outbox{}
	return o
}

// ---------- บอทและผู้เล่น ----------

var botLines = []string{
	"พาวทาวน์ น้ำพุฟื้นฟูเลือดไวมาก!",
	"ทุ่งปอริ่งข้างบนมีใครมาฟาร์มไหมครับ",
	"ระวังวงแดงหมาป่าด้วยนะครับ กลิ้ง Space หลบได้!",
	"บอสมังกรเพลิงตีเจ็บมาก ไปเป็นปาร์ตี้กันไหม",
	"ใครมียาแดงเหลือขายบ้างครับ",
}

func (w *World) addBots() {
	bots := []struct {
		uid     uint32
		name    string
		class   uint8
		wpn     uint8
		x, y    float32
		hp, max float64
	}{
		{9001, "PoringHunter", 0, 0, 940, 390, 350, 350},
		{9002, "Shadow_Fang", 2, 5, 1480, 1220, 1450, 1450},
		{9003, "Grand_Archmage", 4, 7, 460, 820, 850, 850},
	}
	for _, b := range bots {
		w.players[b.uid] = &Player{
			UID: b.uid, Name: b.name, Bot: true, X: b.x, Y: b.y, Facing: 1, classIdx: b.class, weaponIdx: b.wpn,
			HP: b.hp, homeX: b.x, homeY: b.y, phase: float32(b.uid % 7), botMaxHP: b.max,
		}
	}
}

// PlayerInit ข้อมูลที่ใช้สร้างผู้เล่นจากตัวละครในฐานข้อมูล
type PlayerInit struct {
	UserID, CharID, Name string
	StateJSON            []byte
	X, Y                 float32
}

var ErrBadState = errors.New("state ของตัวละครใช้ไม่ได้")

// buildState แปลง JSON ของตัวละครเป็น sim.State พร้อมซิงก์สเตตัสอัตโนมัติ (ถ้าว่าง ใช้บิลด์แรกเป็นค่าตั้งต้น)
func (w *World) buildState(raw []byte) (*sim.State, error) {
	var st *sim.State
	if len(raw) > 0 {
		s, err := sim.ParseState(raw)
		if err != nil {
			return nil, ErrBadState
		}
		st = s
	}
	if st == nil || st.ClassID == "" || w.data.Class(st.ClassID) == nil {
		st = w.prog.NewCharacter()
	}
	w.eng.ApplyAutoSync(st)
	return st, nil
}

func (w *World) AddPlayer(in PlayerInit) (*Player, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	st, err := w.buildState(in.StateJSON)
	if err != nil {
		return nil, err
	}
	w.nextUID++
	x, y := in.X, in.Y
	if x == 0 && y == 0 {
		x, y = 520, 850
	}
	p := &Player{UID: w.nextUID, UserID: in.UserID, CharID: in.CharID, Name: in.Name, X: clampF(x, 40, WorldW-40), Y: clampF(y, 40, WorldH-40), Facing: 1, st: st, cd: map[string]float64{}}
	w.recompute(p)
	p.HP, p.SP = p.maxHP(), p.maxSP()
	w.players[p.UID] = p
	return p, nil
}

func (w *World) RemovePlayer(uid uint32) {
	w.mu.Lock()
	delete(w.players, uid)
	w.mu.Unlock()
}

// RefreshState โหลด state ใหม่ของผู้เล่น (หลังบันทึกตัวละคร) โดยคงสัดส่วน HP/SP
func (w *World) RefreshState(uid uint32, raw []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.players[uid]
	if p == nil || p.Bot {
		return nil
	}
	st, err := w.buildState(raw)
	if err != nil {
		return err
	}
	hr, sr := p.HP/p.maxHP(), 1.0
	if p.maxSP() > 0 {
		sr = p.SP / p.maxSP()
	}
	p.st = st
	w.recompute(p)
	p.HP, p.SP = p.maxHP()*hr, p.maxSP()*sr
	return nil
}

func (w *World) refreshStateLocked(p *Player) {
	hr, sr := p.HP/p.maxHP(), 1.0
	if p.maxSP() > 0 {
		sr = p.SP / p.maxSP()
	}
	if p.st.ClassID == "" || w.data.Class(p.st.ClassID) == nil {
		return
	}
	w.recompute(p)
	p.HP, p.SP = p.maxHP()*hr, p.maxSP()*sr
}

func clampF(v, lo, hi float32) float32 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func clampf64(v, lo, hi float64) float64 { return math.Max(lo, math.Min(hi, v)) }

// placePlayer ย้ายตำแหน่งตามที่ไคลเอนต์รายงาน แต่จำกัดความเร็วสูงสุดด้วยโควตาระยะทาง (กันวาร์ป/สปีดแฮ็ก):
// โควตาเติม maxMoveSpeed×dt ต่อวินาที (สะสมได้ไม่เกิน moveBudgetMax) และการเดินแต่ละครั้งใช้โควตาตามระยะที่เดินจริง
func (w *World) placePlayer(p *Player, x, y float32, now time.Time) {
	x = clampF(x, 40, WorldW-40)
	y = clampF(y, 40, WorldH-40)
	if !p.hasMoved {
		p.X, p.Y, p.hasMoved = x, y, true
		p.lastMove, p.moveBudget = now, moveBudgetMax
		return
	}
	dt := clampf64(now.Sub(p.lastMove).Seconds(), 0, 0.5)
	p.lastMove = now
	p.moveBudget = math.Min(moveBudgetMax, p.moveBudget+maxMoveSpeed*dt)
	dx, dy := float64(x-p.X), float64(y-p.Y)
	d := math.Hypot(dx, dy)
	if d > p.moveBudget && d > 0 {
		x = p.X + float32(dx/d*p.moveBudget)
		y = p.Y + float32(dy/d*p.moveBudget)
		d = p.moveBudget
	}
	p.moveBudget -= d
	p.X, p.Y = x, y
}

func (w *World) HandleMove(uid uint32, m protocol.Move) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.players[uid]
	if p == nil || p.Bot || !p.alive() {
		return
	}
	w.placePlayer(p, m.X, m.Y, time.Now())
	p.Facing = m.Facing
	if p.RollLeft <= 0 {
		p.Anim = m.Anim
		if p.Anim == protocol.AnimRoll {
			p.Anim = protocol.AnimIdle // สถานะกลิ้งกำหนดโดยคำสั่ง ROLL เท่านั้น
		}
	}
}

func (w *World) HandleRoll(uid uint32, r protocol.Roll) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.players[uid]
	if p == nil || p.Bot || !p.alive() || p.RollCD > 0 {
		return
	}
	c := w.data.FormulaConfig.BaseConstants
	cd, dur := c.RollCooldown, c.RollDuration
	if cd <= 0 {
		cd = 1.1
	}
	if dur <= 0 {
		dur = 0.28
	}
	w.placePlayer(p, float32(r.X), float32(r.Y), time.Now())
	p.RollCD, p.RollLeft = float32(cd), float32(math.Max(w.data.Rules.World.RollIFrame, dur+0.1))
	p.Anim = protocol.AnimRoll
}

func (w *World) mobByUID(uid uint32) *Mob {
	if uid == 0 || int(uid) > len(w.mobs) {
		return nil
	}
	if m := w.mobs[uid-1]; m.UID == uid {
		return m
	}
	for _, m := range w.mobs {
		if m.UID == uid {
			return m
		}
	}
	return nil
}

// ---------- ผู้เล่นโจมตี ----------

func (w *World) mobStats(m *Mob) *sim.MonsterStats {
	sl := make([]sim.Status, len(m.statuses))
	for i, s := range m.statuses {
		sl[i] = sim.Status{ID: s.id, Lv: s.lv}
	}
	return w.eng.Monster(m.Def, sl)
}

func (p *Player) actionInterval() float32 {
	return float32(math.Max(minActionInterval, 1/p.P.APS))
}

func (w *World) HandleAttack(uid, targetUID uint32) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.players[uid]
	if p == nil || p.Bot || !p.alive() || p.AtkCD > 0 {
		return
	}
	m := w.mobByUID(targetUID)
	if m == nil || !m.Alive || !w.inReach(p, m, 0) {
		return
	}
	p.AtkCD = p.actionInterval()
	w.faceMob(p, m)
	w.strikeMob(p, m, &sim.Basic, 1)
}

func (w *World) inReach(p *Player, m *Mob, extra float64) bool {
	reach := p.weaponRange(w.data) + extra + m.radius(w.data.Rules.World.MobBaseRadius) + attackLatencySlack
	return math.Hypot(float64(m.X-p.X), float64(m.Y-p.Y)) <= reach
}

func (w *World) faceMob(p *Player, m *Mob) {
	if m.X >= p.X {
		p.Facing = 1
	} else {
		p.Facing = -1
	}
}

// strikeMob ทอยดาเมจผู้เล่น→มอนสเตอร์ด้วยสูตรจริง (sim.Roll) แล้วกระจายผล
func (w *World) strikeMob(p *Player, m *Mob, spec *gamedata.DamageSpec, lv int) {
	r := w.eng.Roll(spec, lv, p.P, w.mobStats(m), w.rng.Float64, 0.08)
	var flags byte
	if spec.Kind == "magic" {
		flags |= protocol.DmgMagic
	}
	dmg := uint32(0)
	if r.Miss {
		flags |= protocol.DmgMiss
	} else {
		dmg = uint32(r.Dmg)
		if r.Crit {
			flags |= protocol.DmgCrit
		}
		if float64(dmg) >= m.HP {
			m.HP = 0
		} else {
			m.HP -= float64(dmg)
		}
		m.Anim, m.AnimLeft = protocol.AnimHurt, 0.2
	}
	if m.HP <= 0 && m.Alive {
		m.Alive = false
		m.Casting, m.z, m.statuses = false, nil, nil
		m.Anim = protocol.AnimDead
		m.RespawnLeft = float32(math.Max(w.data.Rules.World.MobRespawn, w.data.Globals.RespawnDelay))
		flags |= protocol.DmgKill
	}
	w.emit(protocol.EncodeDamage(p.UID, m.UID, dmg, uint32(m.HP), flags))
	if flags&protocol.DmgKill != 0 {
		w.rewardKill(p, m)
	}
}

// ---------- สกิล ----------

func (p *Player) learnedLv(id string) int { return p.st.LearnedLv(id) }

func (p *Player) hasStatus(id string) bool {
	for _, s := range p.statuses {
		if s.id == id {
			return true
		}
	}
	return false
}

func addStatus(list *[]status, x status) {
	l := *list
	for i := len(l) - 1; i >= 0; i-- {
		if l[i].id == x.id || (x.group != "" && l[i].group == x.group) {
			l = append(l[:i], l[i+1:]...)
		}
	}
	*list = append(l, x)
}

func (w *World) HandleSkill(uid uint32, skillIdx int, targetUID uint32) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.players[uid]
	if p == nil || p.Bot || !p.alive() {
		return
	}
	sk := w.data.SkillAt(skillIdx)
	if sk == nil || !sim.IsCastable(sk) {
		return
	}
	lv := p.learnedLv(sk.ID)
	if lv <= 0 || !w.inChain(p, sk) || !w.eng.WeaponOK(sk, p.P.Weapon, p.P.HasShield) {
		return
	}
	if sk.Type == "toggle" && p.hasStatus(sk.ID) { // กดซ้ำ = ปิด
		w.removeStatus(p, sk.ID)
		w.recompute(p)
		return
	}
	u := w.eng.Usage(sk, lv)
	if p.cd[sk.ID] > 0 || p.SP < u.SP || (u.HP > 0 && p.HP <= u.HP*p.maxHP()) || (u.UsesAction && p.AtkCD > 0) {
		return
	}
	var target *Mob
	if sk.Damage.Kind != "" {
		target = w.mobByUID(targetUID)
		if target == nil || !target.Alive || !w.inReach(p, target, 60) {
			return
		}
	}
	p.SP -= u.SP
	p.HP -= u.HP * p.maxHP()
	if u.Cooldown > 0 {
		p.cd[sk.ID] = u.Cooldown
	}
	if u.UsesAction {
		p.AtkCD = p.actionInterval()
		p.Anim = protocol.AnimCast
	}
	if target != nil {
		w.faceMob(p, target)
		hits := []*Mob{target}
		if sk.Damage.AoE {
			for _, m := range w.mobs {
				if m != target && m.Alive && len(hits) < int(w.data.Rules.World.AoeMaxTargets) && math.Hypot(float64(m.X-target.X), float64(m.Y-target.Y)) <= w.data.Rules.World.AoeRadius {
					hits = append(hits, m)
				}
			}
		}
		for _, m := range hits {
			w.strikeMob(p, m, &sk.Damage, lv)
		}
	}
	if sk.Heal != nil {
		amt := sk.Heal.PctMaxHP.Val(lv)*p.maxHP() + sk.Heal.Flat.Val(lv)
		p.HP = math.Min(p.maxHP(), p.HP+math.Max(0, amt))
	}
	switch {
	case sk.Type == "toggle":
		addStatus(&p.statuses, status{id: sk.ID, lv: lv, left: math.Inf(1), toggle: true, group: sk.Group})
	case len(sk.Effects) > 0 && u.Duration > 0:
		self, tgt := false, false
		for _, e := range sk.Effects {
			if e.AppliesTo == "target" {
				tgt = true
			} else {
				self = true
			}
		}
		if self {
			addStatus(&p.statuses, status{id: sk.ID, lv: lv, left: u.Duration, group: sk.Group})
		}
		if tgt && target != nil && target.Alive {
			addStatus(&target.statuses, status{id: sk.ID, lv: lv, left: u.Duration, group: sk.Group})
		}
	}
	w.recompute(p)
	w.emitTo(p.UID, w.stateFrame(p))
}

func (w *World) inChain(p *Player, sk *gamedata.Skill) bool {
	for _, c := range w.eng.Chain(p.st.ClassID) {
		if c == sk.Class {
			return true
		}
	}
	return false
}

func (w *World) removeStatus(p *Player, id string) {
	for i, s := range p.statuses {
		if s.id == id {
			p.statuses = append(p.statuses[:i], p.statuses[i+1:]...)
			return
		}
	}
}

// ---------- ผู้เล่นโดนตี ----------

func (w *World) damagePlayer(p *Player, attacker uint32, dmg int, miss bool) {
	if !p.alive() {
		return
	}
	var flags byte
	d := uint32(0)
	switch {
	case p.RollLeft > 0 || miss:
		flags |= protocol.DmgMiss
	default:
		d = uint32(dmg)
		if float64(d) >= p.HP {
			p.HP = 0
		} else {
			p.HP -= float64(d)
		}
		p.Anim = protocol.AnimHurt
	}
	if p.HP <= 0 {
		p.DeadLeft = float32(w.data.Globals.ReviveDelay)
		p.Anim = protocol.AnimDead
		p.statuses = nil
		flags |= protocol.DmgKill
		w.recompute(p)
	}
	w.emit(protocol.EncodeDamage(attacker, p.UID, d, uint32(math.Ceil(p.HP)), flags))
}

// ---------- Step (30Hz) ----------

func dist32(ax, ay, bx, by float32) float64 {
	return math.Hypot(float64(ax-bx), float64(ay-by))
}

func (w *World) Step(dt float32) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.tick++
	for _, p := range w.players {
		w.stepPlayer(p, dt)
	}
	for _, m := range w.mobs {
		w.stepMob(m, dt)
	}
}

func (w *World) stepPlayer(p *Player, dt float32) {
	if p.AtkCD > 0 {
		p.AtkCD -= dt
	}
	if p.RollCD > 0 {
		p.RollCD -= dt
	}
	if p.RollLeft > 0 {
		p.RollLeft -= dt
		if p.RollLeft <= 0 && p.Anim == protocol.AnimRoll {
			p.Anim = protocol.AnimIdle
		}
	}
	if p.Bot {
		w.stepBot(p, dt)
		return
	}
	if p.DeadLeft > 0 {
		p.DeadLeft -= dt
		if p.DeadLeft <= 0 { // เกิดใหม่ที่เมืองพร้อมเลือดเต็ม
			p.HP, p.SP = p.maxHP(), p.maxSP()
			p.X, p.Y, p.hasMoved = float32(w.data.Rules.World.TownX), float32(w.data.Rules.World.TownY), false
			p.Anim = protocol.AnimIdle
			w.emitTo(p.UID, w.stateFrame(p))
		}
		return
	}
	d := float64(dt)
	for id, v := range p.cd {
		if v -= d; v <= 0 {
			delete(p.cd, id)
		} else {
			p.cd[id] = v
		}
	}
	dirty := false
	for i := len(p.statuses) - 1; i >= 0; i-- {
		p.statuses[i].left -= d
		if p.statuses[i].left <= 0 {
			p.statuses = append(p.statuses[:i], p.statuses[i+1:]...)
			dirty = true
		}
	}
	for _, s := range append([]status(nil), p.statuses...) {
		if !s.toggle {
			continue
		}
		sk := w.data.Skill(s.id)
		if sk == nil {
			continue
		}
		u := w.eng.Usage(sk, s.lv)
		p.HP -= u.HPDrain * p.maxHP() * d
		p.SP -= u.SPDrain * d
		below := 0.0
		if sk.ToggleOff != nil {
			below = sk.ToggleOff.HPBelow
		}
		if (below != 0 && p.HP/p.maxHP() < below) || p.SP < 0 {
			p.SP = math.Max(0, p.SP)
			w.removeStatus(p, s.id)
			dirty = true
		}
	}
	for _, sk := range w.eng.VisibleSkills(p.st.ClassID) {
		if sk.Type != "trigger" || sk.Trigger == nil {
			continue
		}
		lv := p.learnedLv(sk.ID)
		if lv == 0 {
			continue
		}
		hr := p.HP / p.maxHP()
		if !p.hasStatus(sk.ID) {
			if p.cd[sk.ID] <= 0 && sk.Trigger.HPBelow != 0 && hr <= sk.Trigger.HPBelow && w.eng.WeaponOK(sk, p.P.Weapon, p.P.HasShield) {
				left := math.Inf(1)
				if dur := sk.Usage.Duration.Val(lv); dur > 0 {
					left = dur
				}
				addStatus(&p.statuses, status{id: sk.ID, lv: lv, left: left, group: sk.Group})
				p.cd[sk.ID] = sk.Trigger.Cooldown
				dirty = true
			}
		} else {
			above := 1.0
			if sk.Trigger.HPAbove != nil {
				above = *sk.Trigger.HPAbove
			}
			if hr > above {
				w.removeStatus(p, sk.ID)
				dirty = true
			}
		}
	}
	if dirty {
		w.recompute(p)
	}
	p.HP = math.Min(p.maxHP(), p.HP+p.P.S("hpRegen")*d)
	p.SP = math.Min(p.maxSP(), p.SP+p.P.S("spRegen")*d)
	if p.HP <= 0 { // ตายจาก toggle ดูดเลือด
		w.damagePlayer(p, 0, 1, false)
	}
	if w.tick%stateEveryTicks == 0 {
		w.emitTo(p.UID, w.stateFrame(p))
	}
}

func (w *World) stepBot(p *Player, dt float32) {
	p.phase += dt
	t := float64(p.phase) * 0.35
	nx := p.homeX + float32(math.Cos(t)*90)
	ny := p.homeY + float32(math.Sin(t)*60)
	if nx >= p.X {
		p.Facing = 1
	} else {
		p.Facing = -1
	}
	p.X, p.Y = nx, ny
	p.Anim = protocol.AnimWalk
	if int(p.phase*2)%9 == 0 {
		p.Anim = protocol.AnimAttack
	}
	p.chatCD -= dt
	if p.chatCD <= 0 {
		p.chatCD = 25 + w.rng.Float32()*35
		w.emit(protocol.EncodeChat(0, p.Name, botLines[w.rng.Intn(len(botLines))]))
	}
}

func (w *World) nearestHuman(x, y float32, rng float64) (*Player, float64) {
	var best *Player
	bd := rng
	for _, p := range w.players {
		if p.Bot || !p.alive() {
			continue
		}
		if d := dist32(x, y, p.X, p.Y); d <= bd {
			best, bd = p, d
		}
	}
	return best, bd
}

func (w *World) stepMob(m *Mob, dt float32) {
	if !m.Alive {
		m.RespawnLeft -= dt
		if m.RespawnLeft <= 0 {
			m.Alive, m.HP = true, m.MaxHP
			m.X, m.Y = m.HomeX, m.HomeY
			m.Anim, m.Casting, m.z, m.returning, m.statuses = protocol.AnimIdle, false, nil, false, nil
			m.AtkCD, m.SkillCD = 0.8, 3
		}
		return
	}
	if m.AtkCD > 0 {
		m.AtkCD -= dt
	}
	if m.SkillCD > 0 {
		m.SkillCD -= dt
	}
	if m.AnimLeft > 0 {
		m.AnimLeft -= dt
		if m.AnimLeft <= 0 {
			m.Anim = protocol.AnimIdle
		}
	}
	for i := len(m.statuses) - 1; i >= 0; i-- {
		if m.statuses[i].left -= float64(dt); m.statuses[i].left <= 0 {
			m.statuses = append(m.statuses[:i], m.statuses[i+1:]...)
		}
	}
	def := m.Def
	wd := def.World

	if m.Casting { // กำลังร่ายวงแดง: หยุดนิ่งจนครบเวลาแล้วปล่อยดาเมจ
		m.CastLeft -= dt
		if m.CastLeft <= 0 {
			w.resolveZone(m)
		}
		return
	}
	if wd.AggroRange <= 0 {
		return // ดัมมี่
	}
	leash := wd.AggroRange*2.5 + 400
	homeDist := dist32(m.X, m.Y, m.HomeX, m.HomeY)
	if homeDist > leash {
		m.returning = true
	}
	if m.returning {
		if homeDist < 20 {
			m.returning = false
			m.HP = m.MaxHP
			m.Anim = protocol.AnimIdle
			return
		}
		w.moveMob(m, m.HomeX, m.HomeY, dt)
		m.HP = math.Min(m.MaxHP, m.HP+m.MaxHP*0.1*float64(dt))
		return
	}
	target, d := w.nearestHuman(m.X, m.Y, wd.AggroRange)
	if target == nil {
		if homeDist > 12 && wd.MoveSpeed > 0 {
			w.moveMob(m, m.HomeX, m.HomeY, dt)
		} else if m.Anim == protocol.AnimWalk {
			m.Anim = protocol.AnimIdle
		}
		return
	}
	if target.X >= m.X {
		m.Facing = 1
	} else {
		m.Facing = -1
	}
	if tg := wd.Telegraph; tg != nil && m.SkillCD <= 0 && tg.CastTime > 0 && d <= wd.AttackRange+tg.Radius*0.8 {
		w.beginCast(m, target, tg)
		return
	}
	if d > wd.AttackRange+w.data.Rules.World.PlayerRadius {
		if wd.MoveSpeed > 0 {
			w.moveMob(m, target.X, target.Y, dt)
		}
		return
	}
	if m.Anim == protocol.AnimWalk {
		m.Anim = protocol.AnimIdle
	}
	if m.AtkCD <= 0 {
		m.AtkCD = float32(math.Max(0.2, def.Interval))
		m.Anim, m.AnimLeft = protocol.AnimAttack, 0.35
		s := w.eng.MonsterStrike(target.P, w.mobStats(m), w.rng.Float64)
		w.damagePlayer(target, m.UID, s.Dmg, s.Miss)
	}
}

func (w *World) moveMob(m *Mob, tx, ty float32, dt float32) {
	sp := float32(m.Def.World.MoveSpeed)
	if sp <= 0 {
		return
	}
	ang := math.Atan2(float64(ty-m.Y), float64(tx-m.X))
	step := sp * dt
	if d := float32(dist32(m.X, m.Y, tx, ty)); step > d {
		step = d
	}
	m.X = float32(clampf64(float64(m.X)+math.Cos(ang)*float64(step), 50, float64(WorldW)-50))
	m.Y = float32(clampf64(float64(m.Y)+math.Sin(ang)*float64(step), 50, float64(WorldH)-50))
	if tx >= m.X {
		m.Facing = 1
	} else {
		m.Facing = -1
	}
	if m.Anim != protocol.AnimAttack && m.Anim != protocol.AnimHurt {
		m.Anim = protocol.AnimWalk
	}
}

func shapeCode(s string) uint8 {
	switch s {
	case "cone":
		return 1
	case "line":
		return 2
	}
	return 0
}

func (w *World) beginCast(m *Mob, target *Player, tg *gamedata.TelegraphDef) {
	z := &zone{shape: shapeCode(tg.Shape), radius: float32(tg.Radius), mult: tg.Mult}
	if z.mult <= 0 {
		z.mult = 1.5
	}
	if z.radius <= 0 {
		z.radius = 90
	}
	z.coneRad = float32(tg.Angle * math.Pi / 180)
	switch z.shape {
	case 0: // วงกลมตกที่ตำแหน่งเป้าหมาย ณ ตอนเริ่มร่าย
		z.x, z.y = target.X, target.Y
	default: // โคน/เส้น พุ่งออกจากตัวมอนสเตอร์ไปทางเป้าหมาย
		z.x, z.y = m.X, m.Y
		z.angle = float32(math.Atan2(float64(target.Y-m.Y), float64(target.X-m.X)))
	}
	m.z, m.Casting, m.CastLeft = z, true, float32(tg.CastTime)
	m.SkillCD = float32(math.Max(tg.CD, tg.CastTime+0.5))
	m.Anim = protocol.AnimCast
	angDeg := int16(math.Round(float64(z.angle) * 180 / math.Pi))
	w.emit(protocol.EncodeTelegraph(m.UID, z.shape, z.x, z.y, z.radius, angDeg,
		uint16(clampf64(tg.CastTime*1000, 0, 65535)), uint16(clampf64(z.mult*100, 0, 65535))))
}

func (w *World) resolveZone(m *Mob) {
	z := m.z
	m.Casting, m.z = false, nil
	m.Anim, m.AnimLeft = protocol.AnimAttack, 0.3
	if z == nil {
		return
	}
	ms := w.mobStats(m)
	for _, p := range w.players {
		if p.Bot || !p.alive() {
			continue
		}
		d := dist32(p.X, p.Y, z.x, z.y)
		hit := false
		switch z.shape {
		case 1:
			diff := math.Atan2(float64(p.Y-z.y), float64(p.X-z.x)) - float64(z.angle)
			for diff > math.Pi {
				diff -= 2 * math.Pi
			}
			for diff < -math.Pi {
				diff += 2 * math.Pi
			}
			hit = d <= float64(z.radius) && math.Abs(diff) <= float64(z.coneRad)*0.5
		case 2: // เส้นกว้างคงที่ ยาว radius
			dx, dy := math.Cos(float64(z.angle)), math.Sin(float64(z.angle))
			rx, ry := float64(p.X-z.x), float64(p.Y-z.y)
			along := rx*dx + ry*dy
			across := math.Abs(rx*dy - ry*dx)
			hit = along >= 0 && along <= float64(z.radius) && across <= 28
		default:
			hit = d <= float64(z.radius)
		}
		if !hit {
			continue
		}
		// สูตรเดียวกับไคลเอนต์: มอนสเตอร์ตีพลาด = ดาเมจครึ่งเดียว แล้วคูณตัวคูณท่า (วงแดงไม่มีพลาด)
		s := w.eng.MonsterStrike(p.P, ms, w.rng.Float64)
		base := float64(s.Dmg)
		if s.Miss {
			base = ms.Atk * 0.5
		}
		w.damagePlayer(p, m.UID, int(math.Max(1, math.Round(base*z.mult))), false)
	}
}

// ---------- Snapshot / สถิติ ----------

func (p *Player) hpView() (hp, max float64) {
	if p.Bot {
		return p.HP, p.botMaxHP
	}
	return p.HP, p.maxHP()
}

func (w *World) Snapshot() []byte {
	w.mu.Lock()
	defer w.mu.Unlock()
	peers := make([]protocol.PeerView, 0, len(w.players))
	for _, p := range w.players {
		hp, max := p.hpView()
		peers = append(peers, protocol.PeerView{
			UID: p.UID, X: p.X, Y: p.Y,
			HP: uint16(clampf64(math.Ceil(hp), 0, 65535)), MaxHP: uint16(clampf64(max, 1, 65535)),
			Class: p.classIdx, Weapon: p.weaponIdx, Facing: p.Facing, Anim: p.Anim,
		})
	}
	sort.Slice(peers, func(i, j int) bool { return peers[i].UID < peers[j].UID })
	mobs := make([]protocol.MobView, 0, len(w.mobs))
	for _, m := range w.mobs {
		mobs = append(mobs, protocol.MobView{UID: m.UID, X: m.X, Y: m.Y, HP: uint32(math.Max(0, math.Ceil(m.HP))), Alive: m.Alive, Facing: m.Facing, Anim: m.Anim, Casting: m.Casting})
	}
	return protocol.EncodeSnapshot(w.tick, peers, mobs)
}

func (w *World) Tick() uint32 {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.tick
}

// Position ตำแหน่งปัจจุบันของผู้เล่น (ใช้บันทึกลงฐานข้อมูลตอนออก)
func (w *World) Position(uid uint32) (x, y float32, ok bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if p := w.players[uid]; p != nil {
		return p.X, p.Y, true
	}
	return 0, 0, false
}

func (w *World) Players() []Info {
	w.mu.Lock()
	defer w.mu.Unlock()
	list := make([]Info, 0, len(w.players))
	for _, p := range w.players {
		cls := "novice"
		if int(p.classIdx) < len(protocol.ClassCodes) {
			cls = protocol.ClassCodes[p.classIdx]
		}
		hp, max := p.hpView()
		list = append(list, Info{p.UID, p.Name, cls, p.X, p.Y, math.Round(hp), max, p.Bot})
	}
	sort.Slice(list, func(i, j int) bool { return list[i].UID < list[j].UID })
	return list
}

func (w *World) Counts() (players, bots, mobs, aliveMobs int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, p := range w.players {
		if p.Bot {
			bots++
		} else {
			players++
		}
	}
	for _, m := range w.mobs {
		if m.Alive {
			aliveMobs++
		}
	}
	return players, bots, len(w.mobs), aliveMobs
}

// stateFrame สร้างเฟรม PLAYER_STATE (HP/SP + บัฟที่ติดอยู่) ให้เจ้าของตัวละคร
func (w *World) stateFrame(p *Player) []byte {
	sts := make([]protocol.StatusView, 0, len(p.statuses))
	for _, s := range p.statuses {
		idx, ok := w.data.SkillIndex(s.id)
		if !ok {
			continue
		}
		left := protocol.StatusForever
		if !math.IsInf(s.left, 1) {
			left = uint16(clampf64(math.Ceil(s.left*10), 0, float64(protocol.StatusForever-1)))
		}
		sts = append(sts, protocol.StatusView{SkillIdx: uint16(idx), Lv: uint8(s.lv), LeftDs: left})
	}
	return protocol.EncodePlayerState(p.HP, p.maxHP(), p.SP, p.maxSP(), sts)
}

// HandleUseItem ใช้ไอเทมฟื้นฟู (ยา): ต้องมีจำนวนเหลือในกระเป๋า — เซิร์ฟเวอร์ลดจำนวนและฟื้น HP/SP เอง
func (w *World) HandleUseItem(uid uint32, itemIdx int) {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.players[uid]
	if p == nil || p.Bot || !p.alive() || itemIdx < 0 || itemIdx >= len(w.data.EquipItems) {
		return
	}
	hp, sp, err := w.prog.UseItem(p.st, w.data.EquipItems[itemIdx].ID)
	if err != nil {
		return
	}
	p.HP = math.Min(p.maxHP(), p.HP+p.maxHP()*hp)
	p.SP = math.Min(p.maxSP(), p.SP+p.maxSP()*sp)
	p.dirty = true
	w.emitTo(p.UID, w.stateFrame(p))
}

func (w *World) itemIndex(id string) (uint16, bool) {
	for i := range w.data.EquipItems {
		if w.data.EquipItems[i].ID == id {
			return uint16(i), true
		}
	}
	return 0, false
}

// rewardKill ให้ EXP/ทอง/ดรอปแก่ผู้ที่ล้มมอนสเตอร์ (เซิร์ฟเวอร์ตัดสินทั้งหมด) แล้วแจ้งเจ้าของ: REWARD + state ใหม่
func (w *World) rewardKill(p *Player, m *Mob) {
	if p.Bot || p.st == nil {
		return
	}
	r := w.prog.GrantKill(p.st, m.Def, w.rng.Float64)
	if r.BaseLevelUp || r.JobLevelUp {
		w.recompute(p)
		p.HP, p.SP = p.maxHP(), p.maxSP() // เลเวลอัปฟื้นเต็ม
	}
	p.dirty = true
	var items []protocol.ItemGain
	for _, it := range r.Items {
		if idx, ok := w.itemIndex(it.ID); ok {
			items = append(items, protocol.ItemGain{ItemIdx: idx, Qty: uint8(math.Min(255, float64(it.Qty)))})
		}
	}
	var flags byte
	if r.BaseLevelUp {
		flags |= protocol.RewardBaseLevelUp
	}
	if r.JobLevelUp {
		flags |= protocol.RewardJobLevelUp
	}
	w.emitTo(p.UID, protocol.EncodeReward(m.UID, uint32(r.BaseExp), uint32(r.JobExp), uint32(r.Gold), uint8(r.BaseLv), uint8(r.JobLv), flags, items))
	if js, err := json.Marshal(p.st); err == nil {
		w.emitTo(p.UID, protocol.EncodeStateSync(js))
	}
	w.emitTo(p.UID, w.stateFrame(p))
}

// MutateByUser แก้ state ของผู้เล่นที่ออนไลน์อยู่ (ใต้ล็อกของโลกเกม จึงไม่ชนกับการให้รางวัล/การต่อสู้)
// found=false ถ้าผู้ใช้ไม่ได้ออนไลน์ (ผู้เรียกต้องไปแก้ที่ฐานข้อมูลแทน); คืน state ใหม่เป็น JSON เมื่อสำเร็จ
func (w *World) MutateByUser(userID string, fn func(*sim.State) error) (json.RawMessage, bool, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	var p *Player
	for _, q := range w.players {
		if !q.Bot && q.UserID == userID {
			p = q
			break
		}
	}
	if p == nil {
		return nil, false, nil
	}
	c := p.st.Clone()
	if err := fn(c); err != nil {
		return nil, true, err
	}
	w.eng.ApplyAutoSync(c)
	p.st = c
	w.recompute(p)
	p.dirty = true
	w.emitTo(p.UID, w.stateFrame(p))
	js, err := json.Marshal(c)
	return js, true, err
}

// DirtyChar คือตัวละครที่ state เปลี่ยนและรอบันทึกลงฐานข้อมูล
type DirtyChar struct {
	CharID string
	State  json.RawMessage
	Cols   progress.Columns
}

func (w *World) snapshotDirty(p *Player) (DirtyChar, bool) {
	if p.Bot || !p.dirty || p.CharID == "" {
		return DirtyChar{}, false
	}
	js, err := json.Marshal(p.st)
	if err != nil {
		return DirtyChar{}, false
	}
	p.dirty = false
	return DirtyChar{CharID: p.CharID, State: js, Cols: progress.Cols(p.st)}, true
}

// DrainDirty เก็บตัวละครที่รอบันทึกทั้งหมด (เรียกเป็นระยะโดยลูปบันทึกข้อมูล)
func (w *World) DrainDirty() []DirtyChar {
	w.mu.Lock()
	defer w.mu.Unlock()
	var out []DirtyChar
	for _, p := range w.players {
		if d, ok := w.snapshotDirty(p); ok {
			out = append(out, d)
		}
	}
	return out
}

// RemovePlayerSave ลบผู้เล่นออกจากโลกและคืนข้อมูลที่ยังไม่ได้บันทึก (ถ้ามี) เพื่อบันทึกตอนออก
func (w *World) RemovePlayerSave(uid uint32) *DirtyChar {
	w.mu.Lock()
	defer w.mu.Unlock()
	p := w.players[uid]
	delete(w.players, uid)
	if p == nil {
		return nil
	}
	if d, ok := w.snapshotDirty(p); ok {
		return &d
	}
	return nil
}

// Requeue คืนสถานะ "รอบันทึก" เมื่อบันทึกลงฐานข้อมูลไม่สำเร็จ (จะลองใหม่รอบถัดไป)
func (w *World) Requeue(charID string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, p := range w.players {
		if p.CharID == charID {
			p.dirty = true
		}
	}
}

// PeekByUser คืน state ปัจจุบัน (สด) ของผู้เล่นที่ออนไลน์ — ฐานข้อมูลอาจช้ากว่านี้ได้ไม่เกินรอบบันทึก (3 วินาที)
func (w *World) PeekByUser(userID string) (json.RawMessage, bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	for _, q := range w.players {
		if !q.Bot && q.UserID == userID {
			js, err := json.Marshal(q.st)
			return js, err == nil
		}
	}
	return nil, false
}
