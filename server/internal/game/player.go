// Package game คือโลกเกมฝั่งเซิร์ฟเวอร์ (authoritative): ผู้เล่น มอนสเตอร์ AI วงแดง การต่อสู้ ใช้สูตรจาก package sim
package game

import (
	"math"
	"time"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/protocol"
	"catquest-ro/server/internal/sim"
)

// status = สถานะ (บัฟ/toggle/trigger) ที่ติดอยู่บนผู้เล่นหรือมอนสเตอร์
type status struct {
	id     string
	lv     int
	left   float64
	toggle bool
	group  string
}

// Player = ผู้เล่นหรือบอทในโลก
type Player struct {
	UID    uint32
	UserID string // ว่างสำหรับบอท
	CharID string
	Name   string
	Bot    bool

	X, Y       float32
	Facing     int8
	Anim       uint8
	lastMove   time.Time
	hasMoved   bool
	moveBudget float64 // โควตาระยะทางที่เดินได้ (px) — เติมตามเวลา จึงส่งข้อความถี่ ๆ ก็เดินเร็วเกินไม่ได้

	// ตัวละคร + สเตตัสจริง (คำนวณด้วย sim)
	st       *sim.State
	P        *sim.Player
	HP, SP   float64
	statuses []status
	cd       map[string]float64

	classIdx, weaponIdx uint8

	AtkCD, RollCD, RollLeft, DeadLeft float32

	dirty bool // state เปลี่ยนและยังไม่ได้บันทึกลงฐานข้อมูล

	// บอท
	homeX, homeY float32
	botMaxHP     float64
	phase        float32
	chatCD       float32
}

func (p *Player) alive() bool { return p.DeadLeft <= 0 && p.HP > 0 }

func (p *Player) maxHP() float64 { return p.P.S("maxHp") }
func (p *Player) maxSP() float64 { return p.P.S("maxSp") }

// Info = ข้อมูลสาธารณะของผู้เล่น (REST /api/players)
type Info struct {
	UID   uint32  `json:"uid"`
	Name  string  `json:"name"`
	Class string  `json:"class"`
	X     float32 `json:"x"`
	Y     float32 `json:"y"`
	HP    float64 `json:"hp"`
	MaxHP float64 `json:"maxHp"`
	Bot   bool    `json:"bot"`
}

func indexOf(list []string, v string) uint8 {
	for i, x := range list {
		if x == v {
			return uint8(i)
		}
	}
	return 0
}

func (p *Player) statusList() []sim.Status {
	out := make([]sim.Status, len(p.statuses))
	for i, s := range p.statuses {
		out[i] = sim.Status{ID: s.id, Lv: s.lv}
	}
	return out
}

// recompute คำนวณสเตตัสใหม่จาก state + สถานะที่ติดอยู่ (เรียกเมื่อโหลด/แก้ state/บัฟเปลี่ยน)
func (w *World) recompute(p *Player) {
	eng := w.eng
	st := p.st
	// ล้างสถานะที่สกิลถูกลบหรือไม่ได้เรียน
	kept := p.statuses[:0]
	for _, s := range p.statuses {
		if eng.D.Skill(s.id) != nil {
			kept = append(kept, s)
		}
	}
	p.statuses = kept
	p.P = eng.Player(st, p.statusList())
	p.classIdx = indexOf(protocol.ClassCodes, st.ClassID)
	p.weaponIdx = indexOf(protocol.WeaponCodes, st.WeaponID)
	p.HP = math.Min(p.HP, p.maxHP())
	p.SP = math.Min(p.SP, p.maxSP())
}

func (p *Player) weaponRange(d *gamedata.Data) float64 {
	if wp, ok := d.FormulaConfig.WeaponProfiles[p.st.WeaponID]; ok && wp.Range > 0 {
		return wp.Range
	}
	if p.st.WeaponID == "bow" || p.st.WeaponID == "staff" {
		return 240
	}
	return 82
}
