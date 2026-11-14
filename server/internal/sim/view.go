package sim

import "math"

// มุมมอง (View) ของตัวจำลองสำหรับหน้า DPS — ส่งเป็น JSON ให้ไคลเอนต์วาดภาพ (ไคลเอนต์ไม่คำนวณสูตรเอง)

// StatusView = สถานะที่ติดอยู่ (Left = -1 หมายถึงไม่หมดเวลา เพราะ JSON เก็บ Infinity ไม่ได้)
type StatusView struct {
	ID     string  `json:"id"`
	Lv     int     `json:"lv"`
	Left   float64 `json:"left"`
	Toggle bool    `json:"toggle"`
}

type PlayerView struct {
	Stats          map[string]float64  `json:"stats"`
	APS            float64             `json:"aps"`
	WeaponID       string              `json:"weaponId"`
	HasShield      bool                `json:"hasShield"`
	AttackElement  string              `json:"attackElement"`
	DefenseElement string              `json:"defenseElement"`
	Sources        map[string][]Source `json:"sources"`
}

type MonsterView struct {
	Def         float64 `json:"def"`
	MDef        float64 `json:"mdef"`
	Flee        float64 `json:"flee"`
	Hit         float64 `json:"hit"`
	Atk         float64 `json:"atk"`
	MaxHP       float64 `json:"maxHp"`
	DamageTaken float64 `json:"damageTaken"`
	Interval    float64 `json:"interval"`
	Element     string  `json:"element"`
	Size        string  `json:"size"`
}

type View struct {
	T           float64            `json:"t"`
	HP          float64            `json:"hp"`
	MaxHP       float64            `json:"maxHp"`
	SP          float64            `json:"sp"`
	MaxSP       float64            `json:"maxSp"`
	Alive       bool               `json:"alive"`
	ReviveLeft  float64            `json:"reviveLeft"`
	MHP         float64            `json:"mhp"`
	MMax        float64            `json:"mMax"`
	MAlive      bool               `json:"mAlive"`
	RespawnLeft float64            `json:"respawnLeft"`
	Pst         []StatusView       `json:"pst"`
	Mst         []StatusView       `json:"mst"`
	CD          map[string]float64 `json:"cd"`
	Queue       []string           `json:"queue"`
	P           PlayerView         `json:"P"`
	M           MonsterView        `json:"M"`
	MonsterDPS  float64            `json:"monsterDps"`
	Act         float64            `json:"act"`
	// Why[skillId] = เหตุผลที่สกิลที่เรียนไว้ยังใช้ไม่ได้ ("" = ใช้ได้) — ให้ UI แสดงปุ่มเทา/ทูลทิป
	Why map[string]string `json:"why"`
}

func statusViews(list []active) []StatusView {
	out := make([]StatusView, 0, len(list))
	for _, x := range list {
		left := x.left
		if math.IsInf(left, 1) {
			left = -1
		}
		out = append(out, StatusView{x.id, x.lv, left, x.toggle})
	}
	return out
}

func finite(v float64) float64 {
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return 0
	}
	return v
}

// View สถานะปัจจุบันของการจำลอง
func (s *Sim) View() View {
	P, M := s.P, s.M
	why := map[string]string{}
	for _, sk := range s.e.VisibleSkills(s.state.ClassID) {
		if s.state.learnedLv(sk.ID) > 0 && IsCastable(sk) {
			why[sk.ID] = s.why(sk)
		}
	}
	cd := make(map[string]float64, len(s.cd))
	for k, v := range s.cd {
		cd[k] = v
	}
	q := make([]string, len(s.queue))
	for i, x := range s.queue {
		q[i] = x.id
	}
	return View{
		T: s.t, HP: finite(s.hp), MaxHP: P.S("maxHp"), SP: finite(s.sp), MaxSP: P.S("maxSp"), Alive: s.alive, ReviveLeft: s.reviveLeft,
		MHP: finite(s.mhp), MMax: M.MaxHP, MAlive: s.mAlive, RespawnLeft: s.respawnLeft,
		Pst: statusViews(s.pst), Mst: statusViews(s.mst), CD: cd, Queue: q,
		P:          PlayerView{Stats: P.Stats, APS: P.APS, WeaponID: weaponID(P), HasShield: P.HasShield, AttackElement: P.AttackElement, DefenseElement: P.DefenseElement, Sources: P.Sources},
		M:          MonsterView{M.Def, M.MDef, M.Flee, M.Hit, M.Atk, M.MaxHP, M.DamageTaken, M.Interval, M.Element, M.Size},
		MonsterDPS: s.e.MonsterDPS(P, M), Act: s.act, Why: why,
	}
}

func weaponID(p *Player) string {
	if p.Weapon == nil {
		return ""
	}
	return p.Weapon.ID
}

// Why คืนเหตุผลที่สกิลใช้ไม่ได้ ("" = ใช้ได้)
func (s *Sim) Why(id string) string {
	sk := s.e.D.Skill(id)
	if sk == nil {
		return "ไม่พบสกิล"
	}
	return s.why(sk)
}

// Reset เริ่มการจำลองใหม่จากศูนย์ (state/seed เดิม)
func (s *Sim) Reset() { s.reset() }

// Sync ใช้ state ใหม่ (เมื่อผู้ใช้แก้ค่าระหว่างจำลอง): ล้างสถานะที่อ้างสกิลที่ไม่มี/ไม่ได้เรียนแล้ว และอัปเดตเลเวลสถานะ
// (ตรงกับ sim.sync() ฝั่ง JS)
func (s *Sim) Sync(st *State) {
	s.state = st.Clone()
	for _, lst := range []*[]active{&s.pst, &s.mst} {
		l := *lst
		for i := len(l) - 1; i >= 0; i-- {
			lv := s.state.learnedLv(l[i].id)
			if s.e.D.Skill(l[i].id) == nil || lv <= 0 {
				l = append(l[:i], l[i+1:]...)
			} else {
				l[i].lv = lv
			}
		}
		*lst = l
	}
	kept := s.queue[:0]
	for _, q := range s.queue {
		if s.e.D.Skill(q.id) != nil {
			kept = append(kept, q)
		}
	}
	s.queue = kept
	s.dirty = true
	s.recompute()
}
