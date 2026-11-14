package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/progress"
	"catquest-ro/server/internal/sim"
	"catquest-ro/server/internal/store"
)

// ---------- ข้อมูลเกม (แยกหมวด + มีเวอร์ชัน) ----------

func (s *Server) getData(c *gin.Context) {
	payload, ver := s.data.Payload()
	etag := `"v` + strconv.FormatInt(ver, 10) + `"`
	c.Header("ETag", etag)
	c.Header("Cache-Control", "private, no-cache")
	if c.GetHeader("If-None-Match") == etag {
		c.Status(http.StatusNotModified)
		return
	}
	c.Data(http.StatusOK, "application/json; charset=utf-8", payload)
}

// dataErr แปลงข้อผิดพลาดของ DataManager เป็น HTTP status
func dataErr(c *gin.Context, err error, what string) {
	switch {
	case errors.Is(err, ErrInvalidData):
		writeErr(c, http.StatusBadRequest, err.Error())
	case errors.Is(err, ErrUnknownCat), errors.Is(err, store.ErrNotFound):
		writeErr(c, http.StatusNotFound, "ไม่พบหมวดหรือเวอร์ชันที่ระบุ")
	case errors.Is(err, ErrConflict):
		writeErr(c, http.StatusConflict, err.Error()+" — โหลดข้อมูลล่าสุดแล้วลองใหม่")
	default:
		slog.Error(what, "err", err)
		writeErr(c, http.StatusInternalServerError, "บันทึกไม่สำเร็จ")
	}
}

// putData (admin): นำเข้าเอกสารทั้งชุด — เขียนเฉพาะหมวดที่ต่างจากปัจจุบัน (ไม่ตรวจ If-Match; ใช้กับการนำเข้า/สคริปต์)
func (s *Server) putData(c *gin.Context) {
	var raw json.RawMessage
	if !decodeJSON(c, &raw, gamedata.MaxBytes+1, false) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	ids, err := s.data.Replace(ctx, raw, c.Query("note"), userOf(c).ID)
	if err != nil {
		dataErr(c, err, "บันทึกข้อมูลเกมล้มเหลว")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved", "versions": ids})
}

// putCategory (admin): แก้ข้อมูลรายหมวด — ต้องส่ง If-Match = id เวอร์ชันของหมวดที่โหลดมา (ไม่ตรง = 409, ไม่ส่ง = 428)
func (s *Server) putCategory(c *gin.Context) {
	cat := c.Param("category")
	if gamedata.CategoryByName(cat) == nil {
		writeErr(c, http.StatusNotFound, "ไม่มีหมวดข้อมูลนี้")
		return
	}
	ifMatch := strings.Trim(c.GetHeader("If-Match"), `"`)
	if ifMatch == "" {
		writeErr(c, http.StatusPreconditionRequired, "ต้องส่ง If-Match เป็น id เวอร์ชันของหมวดที่โหลดมา")
		return
	}
	want, err := strconv.ParseInt(ifMatch, 10, 64)
	if err != nil || want < 1 {
		writeErr(c, http.StatusBadRequest, "If-Match ไม่ถูกต้อง")
		return
	}
	var raw json.RawMessage
	if !decodeJSON(c, &raw, gamedata.MaxBytes+1, false) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	ids, err := s.data.Apply(ctx, map[string][]byte{cat: raw}, map[string]int64{cat: want}, c.Query("note"), userOf(c).ID)
	if err != nil {
		dataErr(c, err, "บันทึกข้อมูลเกมล้มเหลว")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved", "category": cat, "version": ids[cat]})
}

func (s *Server) listVersions(c *gin.Context) {
	cat := c.Query("category")
	if cat != "" && gamedata.CategoryByName(cat) == nil {
		writeErr(c, http.StatusNotFound, "ไม่มีหมวดข้อมูลนี้")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	vs, err := s.db.ListGameConfigVersions(ctx, cat, 50)
	if err != nil {
		writeErr(c, http.StatusInternalServerError, "อ่านรายการเวอร์ชันไม่สำเร็จ")
		return
	}
	type item struct {
		ID        int64     `json:"id"`
		Category  string    `json:"category"`
		Note      string    `json:"note"`
		By        *string   `json:"by"`
		CreatedAt time.Time `json:"createdAt"`
	}
	out := make([]item, len(vs))
	for i, v := range vs {
		out[i] = item{v.ID, v.Category, v.Note, v.CreatedBy, v.CreatedAt}
	}
	c.JSON(http.StatusOK, out)
}

func (s *Server) rollbackData(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id < 1 {
		writeErr(c, http.StatusBadRequest, "id ไม่ถูกต้อง")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	nid, err := s.data.Rollback(ctx, c.Param("category"), id, userOf(c).ID)
	if err != nil {
		dataErr(c, err, "ย้อนเวอร์ชันล้มเหลว")
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "rolled-back", "category": c.Param("category"), "version": nid})
}

// ---------- ตัวละคร ----------

const maxStateBytes = 256 << 10

func (s *Server) getCharacter(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	ch, state, err := s.svc.Load(ctx, userOf(c).ID)
	if err != nil {
		ruleStatus(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"character": toCharacterDTO(ch), "state": state})
}

// setMode (admin): สลับโหมดตัวละครของตัวเอง — game = เซิร์ฟเวอร์เป็นเจ้าของความก้าวหน้า, lab = แก้อิสระเพื่อทดลองออกแบบ
func (s *Server) setMode(c *gin.Context) {
	var in struct {
		Mode string `json:"mode"`
	}
	if !decodeJSON(c, &in, 1<<10, true) {
		return
	}
	if in.Mode != "game" && in.Mode != "lab" {
		writeErr(c, http.StatusBadRequest, "mode ต้องเป็น game หรือ lab")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	ch, err := s.db.CharacterByUser(ctx, userOf(c).ID)
	if err != nil {
		ruleStatus(c, err)
		return
	}
	if err := s.db.SetCharacterMode(ctx, ch.ID, in.Mode); err != nil {
		writeErr(c, http.StatusInternalServerError, "เปลี่ยนโหมดไม่สำเร็จ")
		return
	}
	c.JSON(http.StatusOK, gin.H{"mode": in.Mode})
}

// putPrefs: ค่าที่ผู้เล่นปรับเองได้ในทุกโหมด (ลำดับสกิลอัตโนมัติ/ตัวเลือกจำลอง/มอนสเตอร์เป้าหมายของแท็บ DPS) ไม่กระทบความก้าวหน้า
func (s *Server) putPrefs(c *gin.Context) {
	var patch map[string]json.RawMessage
	if !decodeJSON(c, &patch, 128<<10, false) {
		return
	}
	s.command(c, func(p *progress.Progress, st *sim.State) error { return p.Prefs(st, patch) })
}

// validateLabState ตรวจ/ทำความสะอาดขอบเขตของ state ที่ส่งมาในโหมด lab แล้วคืนคอลัมน์ที่ซิงก์
func validateLabState(d *gamedata.Data, raw json.RawMessage) (store.StateColumns, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil || top == nil {
		return store.StateColumns{}, errors.New("state ต้องเป็นอ็อบเจ็กต์ JSON")
	}
	st, err := sim.ParseState(raw)
	if err != nil {
		return store.StateColumns{}, errors.New("state มีโครงสร้างไม่ถูกต้อง")
	}
	cls := d.Class(st.ClassID)
	if cls == nil {
		return store.StateColumns{}, fmt.Errorf("ไม่รู้จักคลาส %q", st.ClassID)
	}
	chk := func(name string, v sim.Num, lo, hi float64) error {
		if f := v.F(); math.IsNaN(f) || f < lo || f > hi {
			return fmt.Errorf("%s ต้องอยู่ระหว่าง %v–%v", name, lo, hi)
		}
		return nil
	}
	capJob := float64(cls.JobLvCap)
	if capJob < 1 {
		capJob = 99
	}
	for _, p := range []struct {
		n      string
		v      sim.Num
		lo, hi float64
	}{{"baseLv", st.BaseLv, 1, 99}, {"jobLv", st.JobLv, 1, capJob}, {"gold", st.Gold, 0, 1e15}, {"baseExp", st.BaseExp, 0, 1e15}, {"jobExp", st.JobExp, 0, 1e15}} {
		if err := chk(p.n, p.v, p.lo, p.hi); err != nil {
			return store.StateColumns{}, err
		}
	}
	for id, lv := range st.Learned {
		sk := d.Skill(id)
		if sk == nil {
			return store.StateColumns{}, fmt.Errorf("ไม่รู้จักสกิล %q", id)
		}
		if f := lv.F(); f < 0 || f > float64(sk.MaxLevel) {
			return store.StateColumns{}, fmt.Errorf("เลเวลสกิล %s ต้องอยู่ระหว่าง 0–%d", id, sk.MaxLevel)
		}
	}
	c := progress.Cols(st)
	return store.StateColumns{ClassID: c.ClassID, BaseLv: c.BaseLv, JobLv: c.JobLv, BaseExp: c.BaseExp, JobExp: c.JobExp, Gold: c.Gold}, nil
}

// putCharacterState: โหมด lab เท่านั้น (แก้สถานะอิสระ) — โหมด game ความก้าวหน้าเปลี่ยนได้ผ่านคำสั่งเกมเท่านั้น
func (s *Server) putCharacterState(c *gin.Context) {
	u := userOf(c)
	if !s.writeLimit.Allow(u.ID) {
		writeErr(c, http.StatusTooManyRequests, "บันทึกถี่เกินไป")
		return
	}
	var raw json.RawMessage
	if !decodeJSON(c, &raw, maxStateBytes, false) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	ch, err := s.db.CharacterByUser(ctx, u.ID)
	if err != nil {
		ruleStatus(c, err)
		return
	}
	if ch.Mode != "lab" {
		writeErr(c, http.StatusForbidden, "โหมดเกม: ความก้าวหน้าของตัวละครถูกกำหนดโดยเซิร์ฟเวอร์ (ใช้คำสั่งในเกมแทน)")
		return
	}
	d, _, _ := s.data.Current()
	cols, err := validateLabState(d, raw)
	if err != nil {
		writeErr(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if err := s.db.SaveCharacterState(ctx, ch.ID, raw, cols); err != nil {
		slog.Error("บันทึกตัวละครล้มเหลว", "err", err)
		writeErr(c, http.StatusInternalServerError, "บันทึกไม่สำเร็จ")
		return
	}
	s.hub.RefreshCharacter(u.ID, raw)
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}

// ---------- คำสั่งเกม (เซิร์ฟเวอร์ตัดสินทั้งหมด) ----------

// command ใช้คำสั่งความก้าวหน้ากับตัวละครของผู้ใช้อย่างเป็นอะตอม แล้วตอบ state ใหม่ให้ไคลเอนต์แทนที่ของเดิม
func (s *Server) command(c *gin.Context, fn func(*progress.Progress, *sim.State) error) {
	u := userOf(c)
	if !s.writeLimit.Allow(u.ID) {
		writeErr(c, http.StatusTooManyRequests, "ทำรายการถี่เกินไป")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 8*time.Second)
	defer cancel()
	state, err := s.svc.Mutate(ctx, u.ID, fn)
	if err != nil {
		ruleStatus(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{"state": state})
}

func (s *Server) cmdLearn(c *gin.Context) {
	var in struct {
		SkillID string `json:"skillId"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.Learn(st, in.SkillID) })
	}
}

func (s *Server) cmdUnlearn(c *gin.Context) {
	var in struct {
		SkillID string `json:"skillId"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.Unlearn(st, in.SkillID) })
	}
}

func (s *Server) cmdStat(c *gin.Context) {
	var in struct {
		Stat string `json:"stat"`
		N    int    `json:"n"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { _, err := p.RaiseStat(st, in.Stat, in.N); return err })
	}
}

func (s *Server) cmdEquip(c *gin.Context) {
	var in struct {
		ItemID string `json:"itemId"`
		Set    bool   `json:"set"` // true = สวมเสมอ, false = สลับสวม/ถอด
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.Equip(st, in.ItemID, in.Set) })
	}
}

func (s *Server) cmdUnequip(c *gin.Context) {
	var in struct {
		Slot string `json:"slot"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.Unequip(st, in.Slot) })
	}
}

func (s *Server) cmdWeapon(c *gin.Context) {
	var in struct {
		WeaponID string `json:"weaponId"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.SetWeapon(st, in.WeaponID) })
	}
}

func (s *Server) cmdShield(c *gin.Context) {
	var in struct {
		On bool `json:"on"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.SetShield(st, in.On) })
	}
}

func (s *Server) cmdStorage(c *gin.Context) {
	var in struct {
		Op     string `json:"op"`
		ItemID string `json:"itemId"`
		Qty    int    `json:"qty"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.Storage(st, in.Op, in.ItemID, in.Qty) })
	}
}

func (s *Server) cmdShop(c *gin.Context) {
	var in struct {
		Op     string `json:"op"`
		ItemID string `json:"itemId"`
		Qty    int    `json:"qty"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.Shop(st, in.Op, in.ItemID, in.Qty) })
	}
}

func (s *Server) cmdClass(c *gin.Context) {
	var in struct {
		ClassID string `json:"classId"`
	}
	if decodeJSON(c, &in, 1<<10, true) {
		s.command(c, func(p *progress.Progress, st *sim.State) error { return p.ChangeClass(st, in.ClassID) })
	}
}

// ---------- แชท ----------

func (s *Server) recentChat(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	msgs, err := s.db.RecentChat(ctx, 50)
	if err != nil {
		writeErr(c, http.StatusInternalServerError, "อ่านแชทไม่สำเร็จ")
		return
	}
	c.JSON(http.StatusOK, msgs)
}
