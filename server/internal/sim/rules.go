package sim

import (
	"fmt"
	"sort"

	"catquest-ro/server/internal/gamedata"
)

// Engine ถือข้อมูลเกม (ไม่เปลี่ยนแปลง) และเป็นจุดเรียกใช้สูตรทั้งหมด — ใช้ร่วมกันได้หลาย goroutine
type Engine struct{ D *gamedata.Data }

func New(d *gamedata.Data) *Engine { return &Engine{D: d} }

// ---------- กติกาต้นไม้สกิล (03-rules.js) ----------

// Chain รายการคลาสจากรากถึงคลาสที่ระบุ เช่น [novice swordman]
func (e *Engine) Chain(classID string) []string {
	var out []string
	seen := map[string]bool{}
	cur := e.D.Class(classID)
	for cur != nil && !seen[cur.ID] {
		seen[cur.ID] = true
		out = append([]string{cur.ID}, out...)
		if cur.Parent == "" {
			break
		}
		cur = e.D.Class(cur.Parent)
	}
	return out
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (e *Engine) VisibleSkills(classID string) []*gamedata.Skill {
	ch := e.Chain(classID)
	var out []*gamedata.Skill
	for i := range e.D.Skills {
		if contains(ch, e.D.Skills[i].Class) {
			out = append(out, &e.D.Skills[i])
		}
	}
	return out
}

type PointInfo struct {
	ClassID string `json:"classId"`
	Name    string `json:"name"`
	Total   int    `json:"total"`
	Spent   int    `json:"spent"`
	Left    int    `json:"left"`
	Current bool   `json:"current"`
}

func (e *Engine) PointInfo(st *State) []PointInfo {
	ch := e.Chain(st.ClassID)
	out := make([]PointInfo, 0, len(ch))
	for i, cid := range ch {
		c := e.D.Class(cid)
		cur := i == len(ch)-1
		lv := c.JobLvCap
		if cur {
			lv = st.jobLv()
		}
		pp := c.PointsPerJobLv
		if pp == 0 {
			pp = 1
		}
		total := (lv - 1) * pp
		if total < 0 {
			total = 0
		}
		spent := 0
		for j := range e.D.Skills {
			if e.D.Skills[j].Class == cid {
				spent += st.learnedLv(e.D.Skills[j].ID)
			}
		}
		out = append(out, PointInfo{ClassID: cid, Name: c.Name, Total: total, Spent: spent, Left: total - spent, Current: cur})
	}
	return out
}

func (e *Engine) jobLvFor(classID string, st *State) int {
	if classID == st.ClassID {
		return st.jobLv()
	}
	if c := e.D.Class(classID); c != nil {
		return c.JobLvCap
	}
	return 1
}

type Decision struct {
	OK     bool   `json:"ok"`
	Reason string `json:"reason"`
}

func (e *Engine) reqBad(s *gamedata.Skill, st *State) (string, int, bool) {
	for _, r := range s.Requires {
		if st.learnedLv(r.ID) < r.Lv {
			name := r.ID + " (ไม่พบ)"
			if t := e.D.Skill(r.ID); t != nil {
				name = t.Name
			}
			return name, r.Lv, true
		}
	}
	return "", 0, false
}

func (e *Engine) CanLearn(s *gamedata.Skill, st *State) Decision {
	lv := st.learnedLv(s.ID)
	if lv >= s.MaxLevel {
		return Decision{false, "เลเวลเต็มแล้ว"}
	}
	if !contains(e.Chain(st.ClassID), s.Class) {
		return Decision{false, "ไม่ใช่สกิลของสายนี้"}
	}
	if have := e.jobLvFor(s.Class, st); have < s.JobLvReq {
		return Decision{false, fmt.Sprintf("ต้องการ Job Lv.%d", s.JobLvReq)}
	}
	if name, rl, bad := e.reqBad(s, st); bad {
		return Decision{false, fmt.Sprintf("ต้องมี %s Lv.%d", name, rl)}
	}
	for _, p := range e.PointInfo(st) {
		if p.ClassID == s.Class {
			if p.Left <= 0 {
				return Decision{false, "แต้มของ " + p.Name + " หมด"}
			}
			return Decision{true, ""}
		}
	}
	return Decision{false, "แต้มของ " + s.Class + " หมด"}
}

func (e *Engine) CanUnlearn(s *gamedata.Skill, st *State) Decision {
	lv := st.learnedLv(s.ID)
	if lv <= 0 {
		return Decision{false, "ยังไม่ได้เรียน"}
	}
	for i := range e.D.Skills {
		d := &e.D.Skills[i]
		if st.learnedLv(d.ID) <= 0 {
			continue
		}
		for _, r := range d.Requires {
			if r.ID == s.ID && r.Lv > lv-1 {
				return Decision{false, "ถูกใช้เป็นเงื่อนไขของ " + d.Name}
			}
		}
	}
	return Decision{true, ""}
}

// WeaponOK เงื่อนไขอาวุธ/โล่ของสกิล
func (e *Engine) WeaponOK(s *gamedata.Skill, w *gamedata.Weapon, hasShield bool) bool {
	r := s.WeaponReq
	if s.NeedShield && !(hasShield && w != nil && w.SlotType == "1H") {
		return false
	}
	if w == nil {
		return !(r.SlotType != "" || r.DamageType != "" || len(r.Include) > 0)
	}
	if r.SlotType != "" && w.SlotType != r.SlotType {
		return false
	}
	if r.DamageType != "" && w.DamageType != r.DamageType {
		return false
	}
	if len(r.Include) > 0 && !contains(r.Include, w.WeaponClass) {
		return false
	}
	if len(r.Exclude) > 0 && contains(r.Exclude, w.WeaponClass) {
		return false
	}
	return true
}

func IsCastable(s *gamedata.Skill) bool {
	return s.Type == "active" || s.Type == "buff" || s.Type == "toggle"
}

// DefaultRotation ลำดับสกิลอัตโนมัติ: บัฟ/toggle → ดีบัฟ → สกิลดาเมจ (แรงสุดก่อน) → ฮีล
func (e *Engine) DefaultRotation(st *State) []RotationRule {
	type item struct {
		s     *gamedata.Skill
		rank  int
		score float64
	}
	var items []item
	for _, s := range e.VisibleSkills(st.ClassID) {
		lv := st.learnedLv(s.ID)
		if lv <= 0 || !IsCastable(s) {
			continue
		}
		rank, score := 2, 0.0
		dmg := s.Damage.Kind != ""
		switch {
		case s.Type == "buff" || s.Type == "toggle":
			rank = 0
		case !dmg && s.Heal != nil:
			rank = 3
		case !dmg:
			rank = 1
		}
		if dmg {
			for _, t := range s.Damage.Terms {
				v := t.Mult.Val(lv)
				if v < 0 {
					v = -v
				}
				score += v
			}
		}
		items = append(items, item{s, rank, score})
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].rank != items[j].rank {
			return items[i].rank < items[j].rank
		}
		return items[i].score > items[j].score
	})
	out := make([]RotationRule, 0, len(items))
	for _, it := range items {
		maxHp := Num(1)
		if it.rank == 3 {
			maxHp = 0.7
		}
		t := true
		out = append(out, RotationRule{ID: it.s.ID, MaxHpPct: &maxHp, SkipIfActive: &t})
	}
	return out
}
