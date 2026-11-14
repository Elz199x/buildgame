package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"catquest-ro/server/internal/sim"
)

// ตัวจำลองเป็นงาน CPU: จำกัดเวลาที่จำลอง ความถี่ต่อผู้ใช้ จำนวนงานพร้อมกัน และจำนวน session
const (
	maxSimSeconds      = 300.0
	maxBuildSimSeconds = 120.0
	maxSimBody         = 128 << 10
	maxAdvanceDt       = 2.0 // ก้าวเวลาต่อคำขอของ session (วินาทีในเกม)
	maxCastsPerStep    = 5
)

func (s *Server) simGate(c *gin.Context) func() {
	u := userOf(c)
	if !s.simLimit.Allow(u.ID) {
		writeErr(c, http.StatusTooManyRequests, "จำลองถี่เกินไป กรุณารอสักครู่")
		return nil
	}
	select {
	case s.simSem <- struct{}{}:
		return func() { <-s.simSem }
	case <-time.After(2 * time.Second):
		writeErr(c, http.StatusServiceUnavailable, "เซิร์ฟเวอร์กำลังจำลองงานอื่นอยู่ ลองใหม่อีกครั้ง")
		return nil
	case <-c.Request.Context().Done():
		return nil
	}
}

type simRequest struct {
	State    json.RawMessage `json:"state"`
	Statuses []sim.Status    `json:"statuses"`
	AutoSync bool            `json:"autoSync"` // ซิงก์ชีตจากแต้มดิบก่อน (เหมือนในเกม)
	Seconds  float64         `json:"seconds"`
	Seed     *int64          `json:"seed"`
}

func (s *Server) parseSimState(c *gin.Context, raw json.RawMessage, autoSync bool) (*sim.State, *sim.Engine, bool) {
	st, err := sim.ParseState(raw)
	if err != nil || st == nil || st.ClassID == "" {
		writeErr(c, http.StatusBadRequest, "state ไม่ถูกต้อง")
		return nil, nil, false
	}
	_, eng, _ := s.data.Current()
	if eng.D.Class(st.ClassID) == nil {
		writeErr(c, http.StatusBadRequest, "ไม่รู้จักคลาส "+st.ClassID)
		return nil, nil, false
	}
	if autoSync {
		eng.ApplyAutoSync(st)
	}
	return st, eng, true
}

func (s *Server) readSim(c *gin.Context) (*simRequest, *sim.State, *sim.Engine, bool) {
	var in simRequest
	if !decodeJSON(c, &in, maxSimBody, false) {
		return nil, nil, nil, false
	}
	st, eng, ok := s.parseSimState(c, in.State, in.AutoSync)
	return &in, st, eng, ok
}

func seedOr(in *simRequest, def int64) int64 {
	if in.Seed != nil {
		return *in.Seed
	}
	return def
}

// POST /api/sim/stats → สเตตัสสุดท้ายของผู้เล่น (+ มอนสเตอร์เป้าหมาย) จากสูตรฝั่งเซิร์ฟเวอร์
func (s *Server) simStats(c *gin.Context) {
	in, st, eng, ok := s.readSim(c)
	if !ok {
		return
	}
	P := eng.Player(st, in.Statuses)
	M := eng.Monster(&st.Monster.Monster, in.Statuses)
	c.JSON(http.StatusOK, gin.H{
		"stats": P.Stats, "aps": P.APS, "attackElement": P.AttackElement, "defenseElement": P.DefenseElement,
		"hasShield": P.HasShield, "weaponId": st.WeaponID, "sources": P.Sources,
		"monster": gin.H{"def": M.Def, "mdef": M.MDef, "flee": M.Flee, "hit": M.Hit, "atk": M.Atk, "maxHp": M.MaxHP,
			"damageTaken": M.DamageTaken, "interval": M.Interval, "element": M.Element, "size": M.Size, "dps": eng.MonsterDPS(P, M)},
	})
}

// POST /api/sim/benchmark → จำลอง N วินาทีกับเป้านิ่งอมตะ (ลำดับสกิลตาม state.rotation)
func (s *Server) simBenchmark(c *gin.Context) {
	in, st, eng, ok := s.readSim(c)
	if !ok {
		return
	}
	secs := in.Seconds
	if secs <= 0 {
		secs = 60
	}
	if secs > maxSimSeconds {
		secs = maxSimSeconds
	}
	release := s.simGate(c)
	if release == nil {
		return
	}
	defer release()
	c.JSON(http.StatusOK, eng.Benchmark(st, secs, seedOr(in, 777)))
}

// POST /api/sim/builds → เปรียบเทียบบิลด์สำเร็จรูปทุกแบบ (DPS ต่อบิลด์)
func (s *Server) simBuilds(c *gin.Context) {
	in, st, eng, ok := s.readSim(c)
	if !ok {
		return
	}
	secs := in.Seconds
	if secs <= 0 {
		secs = 60
	}
	if secs > maxBuildSimSeconds {
		secs = maxBuildSimSeconds
	}
	release := s.simGate(c)
	if release == nil {
		return
	}
	defer release()
	seed := seedOr(in, 777)
	type row struct {
		BuildID string      `json:"buildId"`
		Name    string      `json:"name"`
		Summary sim.Summary `json:"summary"`
	}
	out := make([]row, 0, len(eng.D.Builds))
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	for _, b := range eng.D.Builds {
		if ctx.Err() != nil {
			writeErr(c, http.StatusGatewayTimeout, "จำลองนานเกินไป")
			return
		}
		if bs := eng.StateFromBuild(st, b.ID); bs != nil {
			out = append(out, row{b.ID, b.Name, eng.Benchmark(bs, secs, seed)})
		}
	}
	c.JSON(http.StatusOK, out)
}

// SkillRow = แถวของตารางดาเมจคาดการณ์ต่อสกิล
type SkillRow struct {
	ID         string         `json:"id"`
	Name       string         `json:"name"`
	Lv         int            `json:"lv"`
	Cooldown   float64        `json:"cooldown"`
	SP         float64        `json:"sp"`
	AoE        bool           `json:"aoe"`
	WeaponOK   bool           `json:"weaponOk"`
	Components sim.Components `json:"components"`
}

// POST /api/sim/skills → ตารางดาเมจต่อสกิลที่เรียนไว้ (ไม่สุ่ม) เทียบกับมอนสเตอร์ใน state
func (s *Server) simSkills(c *gin.Context) {
	in, st, eng, ok := s.readSim(c)
	if !ok {
		return
	}
	P := eng.Player(st, in.Statuses)
	M := eng.Monster(&st.Monster.Monster, in.Statuses)
	rows := []SkillRow{{ID: "basic", Name: "ตีธรรมดา", Lv: 1, WeaponOK: true, Components: eng.Components(&sim.Basic, 1, P, M)}}
	for _, sk := range eng.VisibleSkills(st.ClassID) {
		lv := st.LearnedLv(sk.ID)
		if lv <= 0 || sk.Damage.Kind == "" || !sim.IsCastable(sk) {
			continue
		}
		u := eng.Usage(sk, lv)
		rows = append(rows, SkillRow{sk.ID, sk.Name, lv, u.Cooldown, u.SP, sk.Damage.AoE, eng.WeaponOK(sk, P.Weapon, P.HasShield), eng.Components(&sk.Damage, lv, P, M)})
	}
	c.JSON(http.StatusOK, rows)
}

// POST /api/sim/rotation → ลำดับสกิลอัตโนมัติจากสกิลที่เรียนไว้
func (s *Server) simRotation(c *gin.Context) {
	_, st, eng, ok := s.readSim(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, gin.H{"rotation": eng.DefaultRotation(st)})
}

// ---------- session จำลองแบบเรียลไทม์ (หน้า DPS) ----------

const (
	maxSessionsPerUser = 3
	sessionIdleTTL     = 10 * time.Minute
)

type simSession struct {
	id, userID string
	mu         sync.Mutex // การก้าวเวลาของ session เดียวกันต้องเรียงทีละคำขอ
	s          *sim.Sim
	last       time.Time
}

type simManager struct {
	mu   sync.Mutex
	byID map[string]*simSession
}

func newSimManager() *simManager { return &simManager{byID: map[string]*simSession{}} }

func (m *simManager) create(userID string, s *sim.Sim) *simSession {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	ss := &simSession{id: hex.EncodeToString(b), userID: userID, s: s, last: time.Now()}
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now()
	var mine []*simSession
	for id, x := range m.byID { // ล้าง session ที่ไม่ได้ใช้นาน + นับของผู้ใช้คนนี้
		if now.Sub(x.last) > sessionIdleTTL {
			delete(m.byID, id)
		} else if x.userID == userID {
			mine = append(mine, x)
		}
	}
	for len(mine) >= maxSessionsPerUser { // เกินโควตา: ปิดอันที่เก่าสุด
		oldest := 0
		for i, x := range mine {
			if x.last.Before(mine[oldest].last) {
				oldest = i
			}
		}
		delete(m.byID, mine[oldest].id)
		mine = append(mine[:oldest], mine[oldest+1:]...)
	}
	m.byID[ss.id] = ss
	return ss
}

func (m *simManager) get(userID, id string) *simSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	if x := m.byID[id]; x != nil && x.userID == userID { // ผูกกับเจ้าของเสมอ (กัน IDOR)
		x.last = time.Now()
		return x
	}
	return nil
}

func (m *simManager) remove(userID, id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if x := m.byID[id]; x != nil && x.userID == userID {
		delete(m.byID, id)
	}
}

// POST /api/sim/sessions {state, seed?} → สร้างการจำลองแบบเรียลไทม์ ไคลเอนต์ก้าวเวลาด้วย .../advance แล้ววาดภาพจาก view
func (s *Server) simCreateSession(c *gin.Context) {
	u := userOf(c)
	in, st, eng, ok := s.readSim(c)
	if !ok {
		return
	}
	if !s.simLimit.Allow(u.ID) {
		writeErr(c, http.StatusTooManyRequests, "สร้าง session ถี่เกินไป")
		return
	}
	seed := seedOr(in, time.Now().UnixNano()&0xffff+1)
	ss := s.sims.create(u.ID, eng.NewSim(st, seed))
	ss.mu.Lock()
	defer ss.mu.Unlock()
	c.JSON(http.StatusCreated, gin.H{"id": ss.id, "view": ss.s.View(), "summary": ss.s.Summary()})
}

// POST /api/sim/sessions/:id/advance {dt, casts[], state?, reset?}
// ลำดับ: ซิงก์ state (ถ้ามี) → รีเซ็ต (ถ้าขอ) → สั่งสกิลที่เข้าคิว → ก้าวเวลา dt → ตอบ view + เหตุการณ์ + สรุป
func (s *Server) simAdvance(c *gin.Context) {
	u := userOf(c)
	if !s.advanceLimit.Allow(u.ID) {
		writeErr(c, http.StatusTooManyRequests, "ก้าวเวลาถี่เกินไป")
		return
	}
	ss := s.sims.get(u.ID, c.Param("id"))
	if ss == nil {
		writeErr(c, http.StatusNotFound, "ไม่พบ session จำลอง (อาจหมดอายุ) — สร้างใหม่")
		return
	}
	var in struct {
		Dt    float64         `json:"dt"`
		Casts []string        `json:"casts"`
		State json.RawMessage `json:"state"`
		Reset bool            `json:"reset"`
	}
	if !decodeJSON(c, &in, maxSimBody, false) {
		return
	}
	var newState *sim.State
	if len(in.State) > 0 {
		var ok bool
		if newState, _, ok = s.parseSimState(c, in.State, false); !ok {
			return
		}
	}
	dt := in.Dt
	if !(dt > 0) {
		dt = 0
	}
	if dt > maxAdvanceDt {
		dt = maxAdvanceDt
	}
	if len(in.Casts) > maxCastsPerStep {
		in.Casts = in.Casts[:maxCastsPerStep]
	}
	ss.mu.Lock()
	defer ss.mu.Unlock()
	if newState != nil {
		ss.s.Sync(newState)
	}
	if in.Reset {
		ss.s.Reset()
	}
	for _, id := range in.Casts {
		ss.s.Cast(id)
	}
	if dt > 0 {
		ss.s.Advance(dt)
	}
	events := ss.s.Drain()
	if events == nil {
		events = []sim.Event{} // JSON ต้องเป็น [] ไม่ใช่ null
	}
	c.JSON(http.StatusOK, gin.H{"view": ss.s.View(), "events": events, "summary": ss.s.Summary()})
}

func (s *Server) simDeleteSession(c *gin.Context) {
	s.sims.remove(userOf(c).ID, c.Param("id"))
	c.Status(http.StatusNoContent)
}
