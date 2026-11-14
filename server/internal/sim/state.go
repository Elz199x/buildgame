package sim

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"

	"catquest-ro/server/internal/gamedata"
)

// RotationRule = กติกาลำดับสกิลอัตโนมัติ 1 ข้อ
type RotationRule struct {
	ID           string `json:"id"`
	MinSpPct     Num    `json:"minSpPct"`
	MinHpPct     Num    `json:"minHpPct"`
	MaxHpPct     *Num   `json:"maxHpPct"`
	SkipIfActive *bool  `json:"skipIfActive"`
}

type Opts struct {
	Auto       *bool `json:"auto"`
	Immortal   bool  `json:"immortal"`
	Variance   *Num  `json:"variance"`
	AoeTargets *Num  `json:"aoeTargets"`
}

// MonsterState = มอนสเตอร์เป้าหมายใน state (นิยามมอนสเตอร์ + ตัวเลือกสวนกลับ)
type MonsterState struct {
	gamedata.Monster
	Counter bool `json:"counter"`
}

// State = สถานะของตัวละคร (ตรงกับ SL.state ฝั่งไคลเอนต์)
//
// ฟิลด์ที่ "เซิร์ฟเวอร์เป็นเจ้าของ" (เลเวล EXP ทอง สกิล สเตตัส อุปกรณ์ กระเป๋า คลัง) ถูก serialize ตามปกติ;
// ฟิลด์มุมมองสำหรับตัวจำลอง (Rotation/Opts/Monster) ถูกอ่านจาก JSON แต่ไม่เขียนกลับ — ค่าเดิมคงอยู่ใน Extra
// ฟิลด์อื่นทั้งหมดที่ไม่รู้จักถูกเก็บใน Extra และเขียนกลับครบ จึงไม่ทำให้ข้อมูลฝั่งไคลเอนต์สูญหาย
type State struct {
	ClassID       string            `json:"classId"`
	BaseLv        Num               `json:"baseLv"`
	JobLv         Num               `json:"jobLv"`
	BaseExp       Num               `json:"baseExp"`
	JobExp        Num               `json:"jobExp"`
	Gold          Num               `json:"gold"`
	Learned       map[string]Num    `json:"learned"`
	Sheet         map[string]Num    `json:"sheet"`
	RawStats      map[string]Num    `json:"rawStats"`
	WeaponID      string            `json:"weaponId"`
	HasShield     bool              `json:"hasShield"`
	AutoSyncStats bool              `json:"autoSyncStats"`
	Equipped      map[string]string `json:"equipped"`
	Inventory     []string          `json:"inventory"`
	ItemCounts    map[string]Num    `json:"itemCounts"`
	Storage       []string          `json:"storage"`
	StorageCounts map[string]Num    `json:"storageCounts"`

	// มุมมองสำหรับตัวจำลอง (อ่านจาก Extra["rotation"|"opts"|"monster"])
	Rotation []RotationRule `json:"-"`
	Opts     Opts           `json:"-"`
	Monster  MonsterState   `json:"-"`

	Extra map[string]json.RawMessage `json:"-"`
}

type plainState State // ไม่มีเมธอด → กัน recursion ตอน (un)marshal

var knownKeys = func() map[string]bool {
	m := map[string]bool{}
	t := reflect.TypeOf(plainState{})
	for i := 0; i < t.NumField(); i++ {
		tag := t.Field(i).Tag.Get("json")
		if name := strings.Split(tag, ",")[0]; name != "" && name != "-" {
			m[name] = true
		}
	}
	return m
}()

func (s *State) UnmarshalJSON(b []byte) error {
	var p plainState
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	*s = State(p)
	s.Extra = make(map[string]json.RawMessage)
	for k, v := range raw {
		if !knownKeys[k] {
			s.Extra[k] = v
		}
	}
	s.loadViews()
	return nil
}

// loadViews อ่านมุมมองตัวจำลองจาก Extra (ยอมรับข้อมูลหลวม ๆ — ผิดรูปแบบก็ใช้ค่าเริ่มต้น)
func (s *State) loadViews() {
	s.Rotation, s.Opts, s.Monster = nil, Opts{}, MonsterState{}
	if v, ok := s.Extra["rotation"]; ok {
		_ = json.Unmarshal(v, &s.Rotation)
	}
	if v, ok := s.Extra["opts"]; ok {
		_ = json.Unmarshal(v, &s.Opts)
	}
	if v, ok := s.Extra["monster"]; ok {
		_ = json.Unmarshal(v, &s.Monster)
	}
}

func (s State) MarshalJSON() ([]byte, error) {
	p := plainState(s)
	// map/slice ว่างต้องเป็น {} / [] ไม่ใช่ null (ไคลเอนต์เรียก Object.keys / .forEach โดยตรง)
	if p.Learned == nil {
		p.Learned = map[string]Num{}
	}
	if p.Sheet == nil {
		p.Sheet = map[string]Num{}
	}
	if p.RawStats == nil {
		p.RawStats = map[string]Num{}
	}
	if p.Equipped == nil {
		p.Equipped = map[string]string{}
	}
	if p.Inventory == nil {
		p.Inventory = []string{}
	}
	if p.ItemCounts == nil {
		p.ItemCounts = map[string]Num{}
	}
	if p.Storage == nil {
		p.Storage = []string{}
	}
	if p.StorageCounts == nil {
		p.StorageCounts = map[string]Num{}
	}
	b, err := json.Marshal(p)
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, err
	}
	for k, v := range s.Extra {
		if _, dup := m[k]; !dup {
			m[k] = v
		}
	}
	return json.Marshal(m)
}

// SetExtra ตั้งค่าฟิลด์ที่ไม่ใช่ของเซิร์ฟเวอร์ (เช่น rotation/opts/monster จากไคลเอนต์) แล้วรีเฟรชมุมมอง
func (s *State) SetExtra(key string, raw json.RawMessage) {
	if s.Extra == nil {
		s.Extra = map[string]json.RawMessage{}
	}
	s.Extra[key] = raw
	s.loadViews()
}

// SetMonster ตั้งมอนสเตอร์เป้าหมาย (ใช้ในเทสต์/ตัวสร้างตัวละคร) — เขียนทั้ง Extra และมุมมอง
func (s *State) SetMonster(m gamedata.Monster, counter bool) {
	raw, _ := json.Marshal(MonsterState{Monster: m, Counter: counter})
	s.SetExtra("monster", raw)
}

// ParseState ถอดรหัส JSON ของตัวละคร (ยอมรับค่าที่ไม่เป็นไปตามชนิดอย่างหลวม ๆ แบบ JS)
func ParseState(raw []byte) (*State, error) {
	var s State
	if err := json.Unmarshal(raw, &s); err != nil {
		return nil, err
	}
	return &s, nil
}

func (s *State) learnedLv(id string) int { return int(math.Round(s.Learned[id].F())) }

// LearnedLv เลเวลสกิลที่เรียนไว้ (0 = ยังไม่ได้เรียน)
func (s *State) LearnedLv(id string) int { return s.learnedLv(id) }
func (s *State) jobLv() int              { return int(jsRound(s.JobLv.F())) }
func (s *State) baseLv() float64         { return s.BaseLv.F() }

// Clone คัดลอกลึกพอสำหรับตัวจำลอง (แผนที่/สไลซ์ถูกคัดลอก)
func (s *State) Clone() *State {
	c := *s
	c.Learned = cloneMap(s.Learned)
	c.Sheet = cloneMap(s.Sheet)
	c.RawStats = cloneMap(s.RawStats)
	c.ItemCounts = cloneMap(s.ItemCounts)
	c.StorageCounts = cloneMap(s.StorageCounts)
	c.Inventory = append([]string(nil), s.Inventory...)
	c.Storage = append([]string(nil), s.Storage...)
	if s.Equipped != nil {
		c.Equipped = make(map[string]string, len(s.Equipped))
		for k, v := range s.Equipped {
			c.Equipped[k] = v
		}
	}
	c.Rotation = append([]RotationRule(nil), s.Rotation...)
	if s.Extra != nil {
		c.Extra = make(map[string]json.RawMessage, len(s.Extra))
		for k, v := range s.Extra {
			c.Extra[k] = v
		}
	}
	return &c
}

func cloneMap(m map[string]Num) map[string]Num {
	if m == nil {
		return nil
	}
	c := make(map[string]Num, len(m))
	for k, v := range m {
		c[k] = v
	}
	return c
}

func (o Opts) auto() bool {
	if o.Auto == nil {
		return true
	}
	return *o.Auto
}
func (o Opts) variance() float64 {
	if o.Variance == nil {
		return 0.08
	}
	return o.Variance.F()
}
func (o Opts) aoeTargets() int {
	if o.AoeTargets == nil {
		return 1
	}
	return int(math.Max(1, jsRound(o.AoeTargets.F())))
}
