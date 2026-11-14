package sim

import (
	"encoding/json"
	"math"
	"os"
	"testing"

	"catquest-ro/server/internal/gamedata"
)

// ชุดทดสอบ golden: ผลจากตัวจำลอง JS ต้นฉบับ (web/lab/tools/gen-golden.js) ต้องเท่ากับผลของ Go
// สร้างใหม่ด้วย: node web/lab/tools/gen-golden.js

type goldenFile struct {
	Cases []struct {
		Name     string          `json:"name"`
		State    json.RawMessage `json:"state"`
		Statuses []Status        `json:"statuses"`
		Player0  struct {
			Stats          map[string]float64 `json:"stats"`
			APS            float64            `json:"aps"`
			AttackElement  string             `json:"attackElement"`
			DefenseElement string             `json:"defenseElement"`
		} `json:"player0"`
		Player1 struct {
			Stats map[string]float64 `json:"stats"`
			APS   float64            `json:"aps"`
		} `json:"player1"`
		Monster0   jsMonster             `json:"monster0"`
		Monster1   jsMonster             `json:"monster1"`
		Components map[string]Components `json:"components"`
		Bench      Summary               `json:"bench"`
		Fight      Summary               `json:"fight"`
	} `json:"cases"`
	Rules []struct {
		Name            string          `json:"name"`
		State           json.RawMessage `json:"state"`
		PointInfo       []PointInfo     `json:"pointInfo"`
		CanLearn        []Decision      `json:"canLearn"`
		CanUnlearn      []Decision      `json:"canUnlearn"`
		WeaponOK        []bool          `json:"weaponOk"`
		DefaultRotation []struct {
			ID       string  `json:"id"`
			MaxHpPct float64 `json:"maxHpPct"`
		} `json:"defaultRotation"`
	} `json:"rules"`
	Derived []struct {
		State       json.RawMessage    `json:"state"`
		Sheet       map[string]float64 `json:"sheet"`
		Eff         map[string]float64 `json:"eff"`
		WeaponRange float64            `json:"weaponRange"`
	} `json:"derived"`
	Misc struct {
		RNG []struct {
			Seed   int64     `json:"seed"`
			Values []float64 `json:"values"`
		} `json:"rng"`
		StatCost []struct {
			V, Cost, Reach float64
		} `json:"statCost"`
		StatusPoints []struct {
			Lv         int
			Total, Per float64
		} `json:"statusPoints"`
		Exp []struct {
			Lv        float64
			Base, Job float64
		} `json:"exp"`
		ToFixed []struct {
			X          float64
			D1, D2, D3 float64
		} `json:"toFixed"`
		ElementMult []struct {
			A, D string
			M    float64
		} `json:"elementMult"`
	} `json:"misc"`
}

type jsMonster struct {
	Def, MDef, Flee, Hit, Atk, MaxHP, DamageTaken, Interval float64
	Element, Size                                           string
}

func (m *jsMonster) UnmarshalJSON(b []byte) error {
	var o struct {
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
	if err := json.Unmarshal(b, &o); err != nil {
		return err
	}
	*m = jsMonster{o.Def, o.MDef, o.Flee, o.Hit, o.Atk, o.MaxHP, o.DamageTaken, o.Interval, o.Element, o.Size}
	return nil
}

func loadEngine(t testing.TB) *Engine {
	t.Helper()
	d, err := gamedata.Parse(gamedata.Seed())
	if err != nil {
		t.Fatal(err)
	}
	return New(d)
}

func loadGolden(t testing.TB) *goldenFile {
	t.Helper()
	raw, err := os.ReadFile("testdata/golden.json")
	if err != nil {
		t.Fatalf("ไม่พบ testdata/golden.json — รัน node web/lab/tools/gen-golden.js: %v", err)
	}
	var g goldenFile
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	return &g
}

func near(a, b float64) bool {
	if math.IsNaN(a) && math.IsNaN(b) {
		return true
	}
	return math.Abs(a-b) <= 1e-9+1e-9*math.Max(math.Abs(a), math.Abs(b))
}

type checker struct {
	t      testing.TB
	prefix string
	fails  int
}

func (c *checker) f(name string, got, want float64) {
	if !near(got, want) {
		c.fails++
		if c.fails <= 12 {
			c.t.Errorf("%s %s: got %.12g want %.12g", c.prefix, name, got, want)
		}
	}
}

func (c *checker) s(name, got, want string) {
	if got != want {
		c.fails++
		if c.fails <= 12 {
			c.t.Errorf("%s %s: got %q want %q", c.prefix, name, got, want)
		}
	}
}

func (c *checker) stats(name string, got, want map[string]float64) {
	for k, w := range want {
		c.f(name+"."+k, got[k], w)
	}
	if len(got) != len(want) {
		c.fails++
		c.t.Errorf("%s %s: จำนวนคีย์ต่างกัน got %d want %d", c.prefix, name, len(got), len(want))
	}
}

func (c *checker) summary(name string, got, want Summary) {
	c.f(name+".t", got.T, want.T)
	c.f(name+".dmg", got.Dmg, want.Dmg)
	c.f(name+".dps", got.DPS, want.DPS)
	c.f(name+".hits", float64(got.Hits), float64(want.Hits))
	c.f(name+".crits", float64(got.Crits), float64(want.Crits))
	c.f(name+".miss", float64(got.Miss), float64(want.Miss))
	c.f(name+".casts", float64(got.Casts), float64(want.Casts))
	c.f(name+".basic.n", float64(got.Basic.N), float64(want.Basic.N))
	c.f(name+".basic.dmg", got.Basic.Dmg, want.Basic.Dmg)
	c.f(name+".spUsed", got.SpUsed, want.SpUsed)
	c.f(name+".spNow", got.SpNow, want.SpNow)
	c.f(name+".spMax", got.SpMax, want.SpMax)
	c.f(name+".hpLost", got.HpLost, want.HpLost)
	c.f(name+".healed", got.Healed, want.Healed)
	c.f(name+".deaths", float64(got.Deaths), float64(want.Deaths))
	c.f(name+".kills", float64(got.Kills), float64(want.Kills))
	c.f(name+".aliveFrac", got.AliveFrac, want.AliveFrac)
	c.f(name+".aps", got.APS, want.APS)
	if len(got.Skills) != len(want.Skills) {
		c.fails++
		c.t.Errorf("%s %s: จำนวนสกิลต่างกัน got %d want %d", c.prefix, name, len(got.Skills), len(want.Skills))
		return
	}
	for i := range want.Skills {
		g, w := got.Skills[i], want.Skills[i]
		c.s(name+".skills.id", g.ID, w.ID)
		c.f(name+".skills."+w.ID+".casts", float64(g.Casts), float64(w.Casts))
		c.f(name+".skills."+w.ID+".dmg", g.Dmg, w.Dmg)
		c.f(name+".skills."+w.ID+".hits", float64(g.Hits), float64(w.Hits))
		c.f(name+".skills."+w.ID+".sp", g.SP, w.SP)
	}
	for id, w := range want.Uptime {
		c.f(name+".uptime."+id, got.Uptime[id], w)
	}
	if len(got.Uptime) != len(want.Uptime) {
		c.fails++
		c.t.Errorf("%s %s: uptime ต่างกัน got %d want %d", c.prefix, name, len(got.Uptime), len(want.Uptime))
	}
}

func TestGoldenSimulation(t *testing.T) {
	e := loadEngine(t)
	g := loadGolden(t)
	if len(g.Cases) < 100 {
		t.Fatalf("golden น้อยผิดปกติ: %d", len(g.Cases))
	}
	for _, tc := range g.Cases {
		c := &checker{t: t, prefix: tc.Name}
		st, err := ParseState(tc.State)
		if err != nil {
			t.Fatal(err)
		}
		// สเตตัสผู้เล่น/มอนสเตอร์
		P0 := e.Player(st, nil)
		c.stats("player0", P0.Stats, tc.Player0.Stats)
		c.f("player0.aps", P0.APS, tc.Player0.APS)
		c.s("player0.attackElement", P0.AttackElement, tc.Player0.AttackElement)
		c.s("player0.defenseElement", P0.DefenseElement, tc.Player0.DefenseElement)
		P1 := e.Player(st, tc.Statuses)
		c.stats("player1", P1.Stats, tc.Player1.Stats)
		c.f("player1.aps", P1.APS, tc.Player1.APS)
		for i, pair := range []struct {
			got  *MonsterStats
			want jsMonster
		}{{e.Monster(&st.Monster.Monster, nil), tc.Monster0}, {e.Monster(&st.Monster.Monster, tc.Statuses), tc.Monster1}} {
			n := "monster" + string(rune('0'+i))
			c.f(n+".def", pair.got.Def, pair.want.Def)
			c.f(n+".mdef", pair.got.MDef, pair.want.MDef)
			c.f(n+".flee", pair.got.Flee, pair.want.Flee)
			c.f(n+".hit", pair.got.Hit, pair.want.Hit)
			c.f(n+".atk", pair.got.Atk, pair.want.Atk)
			c.f(n+".maxHp", pair.got.MaxHP, pair.want.MaxHP)
			c.f(n+".damageTaken", pair.got.DamageTaken, pair.want.DamageTaken)
			c.f(n+".interval", pair.got.Interval, pair.want.Interval)
			c.s(n+".element", pair.got.Element, pair.want.Element)
		}
		// ส่วนประกอบดาเมจของทุกสกิลดาเมจ
		M0, M1 := e.Monster(&st.Monster.Monster, nil), e.Monster(&st.Monster.Monster, tc.Statuses)
		basic := e.Components(&Basic, 1, P0, M0)
		compare := func(name string, got, want Components) {
			c.f(name+".raw", got.Raw, want.Raw)
			c.f(name+".normal", got.Normal, want.Normal)
			c.f(name+".crit", got.Crit, want.Crit)
			c.f(name+".critChance", got.CritChance, want.CritChance)
			c.f(name+".hitChance", got.HitChance, want.HitChance)
			c.f(name+".expected", got.Expected, want.Expected)
			c.f(name+".elemMult", got.ElemMult, want.ElemMult)
		}
		compare("components.basic", basic, tc.Components["basic"])
		for id, want := range tc.Components {
			if id == "basic" {
				continue
			}
			sk := e.D.Skill(id)
			compare("components."+id, e.Components(&sk.Damage, st.learnedLv(id), P1, M1), want)
		}
		// จำลองการต่อสู้เต็มรูปแบบ
		c.summary("bench", e.Benchmark(st, 60, 777), tc.Bench)
		st2 := st.Clone()
		tr := true
		st2.Opts.Auto = &tr
		st2.Opts.Immortal = false
		st2.Monster.Counter = true
		sm := e.NewSim(st2, 42)
		sm.Advance(90)
		c.summary("fight", sm.Summary(), tc.Fight)
		if c.fails > 0 {
			t.Fatalf("%s: ไม่ตรงกับ JS %d จุด", tc.Name, c.fails)
		}
	}
	t.Logf("ตรวจ %d กรณี (สเตตัส/ดาเมจ/จำลองต่อสู้ 60 และ 90 วินาที) ตรงกับ JS ทั้งหมด", len(g.Cases))
}

func TestGoldenRules(t *testing.T) {
	e := loadEngine(t)
	g := loadGolden(t)
	for _, r := range g.Rules {
		c := &checker{t: t, prefix: r.Name}
		st, _ := ParseState(r.State)
		pi := e.PointInfo(st)
		if len(pi) != len(r.PointInfo) {
			t.Fatalf("%s pointInfo len", r.Name)
		}
		for i, w := range r.PointInfo {
			c.s("pointInfo.classId", pi[i].ClassID, w.ClassID)
			c.f("pointInfo.total", float64(pi[i].Total), float64(w.Total))
			c.f("pointInfo.spent", float64(pi[i].Spent), float64(w.Spent))
			c.f("pointInfo.left", float64(pi[i].Left), float64(w.Left))
		}
		for i := range e.D.Skills {
			s := &e.D.Skills[i]
			if got, want := e.CanLearn(s, st), r.CanLearn[i]; got != want {
				t.Errorf("%s canLearn(%s): got %+v want %+v", r.Name, s.ID, got, want)
			}
			if got, want := e.CanUnlearn(s, st), r.CanUnlearn[i]; got != want {
				t.Errorf("%s canUnlearn(%s): got %+v want %+v", r.Name, s.ID, got, want)
			}
			if got := e.WeaponOK(s, e.D.Weapon(st.WeaponID), st.HasShield); got != r.WeaponOK[i] {
				t.Errorf("%s weaponOk(%s): got %v want %v", r.Name, s.ID, got, r.WeaponOK[i])
			}
		}
		rot := e.DefaultRotation(st)
		if len(rot) != len(r.DefaultRotation) {
			t.Fatalf("%s defaultRotation len got %d want %d", r.Name, len(rot), len(r.DefaultRotation))
		}
		for i, w := range r.DefaultRotation {
			if rot[i].ID != w.ID || rot[i].MaxHpPct.F() != w.MaxHpPct {
				t.Errorf("%s defaultRotation[%d]: got %s/%v want %s/%v", r.Name, i, rot[i].ID, rot[i].MaxHpPct.F(), w.ID, w.MaxHpPct)
			}
		}
	}
}

func TestGoldenDerivedStats(t *testing.T) {
	e := loadEngine(t)
	g := loadGolden(t)
	for i, d := range g.Derived {
		st, _ := ParseState(d.State)
		got := e.ComputeDerivedFromRaw(st)
		c := &checker{t: t, prefix: "derived#" + string(rune('0'+i%10))}
		c.stats("sheet", got.Sheet, d.Sheet)
		c.stats("eff", got.Eff, d.Eff)
		c.f("weaponRange", got.WeaponRange, d.WeaponRange)
		if c.fails > 0 {
			t.Fatalf("derived[%d] %s: ไม่ตรงกับ JS", i, string(d.State))
		}
	}
	t.Logf("ตรวจชีตสเตตัส %d ชุด ตรงกับ JS ทั้งหมด", len(g.Derived))
}

func TestGoldenMisc(t *testing.T) {
	e := loadEngine(t)
	g := loadGolden(t)
	for _, r := range g.Misc.RNG {
		rng := NewRNG(r.Seed)
		for i, w := range r.Values {
			if got := rng.Float(); got != w {
				t.Fatalf("rng seed %d ตัวที่ %d: got %v want %v", r.Seed, i, got, w)
			}
		}
	}
	for _, s := range g.Misc.StatCost {
		if StatCost(s.V) != s.Cost || CostToReach(s.V) != s.Reach {
			t.Errorf("statCost(%v)", s.V)
		}
	}
	for _, s := range g.Misc.StatusPoints {
		if e.TotalStatusPoints(s.Lv) != s.Total || e.StatusPointsForLevel(float64(s.Lv)) != s.Per {
			t.Errorf("statusPoints(%d)", s.Lv)
		}
	}
	for _, s := range g.Misc.Exp {
		if e.NextBaseExp(s.Lv) != s.Base || e.NextJobExp(s.Lv) != s.Job {
			t.Errorf("exp(%v)", s.Lv)
		}
	}
	for _, s := range g.Misc.ToFixed {
		if toFixed(s.X, 1) != s.D1 || toFixed(s.X, 2) != s.D2 || toFixed(s.X, 3) != s.D3 {
			t.Errorf("toFixed(%v): got %v/%v/%v want %v/%v/%v", s.X, toFixed(s.X, 1), toFixed(s.X, 2), toFixed(s.X, 3), s.D1, s.D2, s.D3)
		}
	}
	for _, s := range g.Misc.ElementMult {
		if e.ElementMult(s.A, s.D) != s.M {
			t.Errorf("elementMult(%s,%s)", s.A, s.D)
		}
	}
}

func TestBenchmarkIsDeterministic(t *testing.T) {
	e := loadEngine(t)
	b := e.D.Builds[0]
	base := &State{Opts: Opts{}, Monster: MonsterState{Monster: e.D.Monsters[0]}}
	st := e.StateFromBuild(base, b.ID)
	st.Monster = MonsterState{Monster: e.D.Monsters[0]}
	a := e.Benchmark(st, 30, 5)
	c := e.Benchmark(st, 30, 5)
	if a.Dmg != c.Dmg || a.Casts != c.Casts {
		t.Fatal("ผลต้องเท่าเดิมทุกครั้งสำหรับ seed เดียวกัน")
	}
	if a.Dmg <= 0 {
		t.Fatal("ควรมีดาเมจ")
	}
}
