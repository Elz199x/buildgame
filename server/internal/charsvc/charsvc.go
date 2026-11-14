// Package charsvc ประสานการแก้ตัวละครให้ถูกต้องไม่ว่าผู้เล่นจะออนไลน์หรือไม่:
//   - ออนไลน์: แก้ใน "โลกเกม" (หน่วยความจำ ใต้ล็อกเดียวกับการต่อสู้/รางวัล) แล้วบันทึกลงฐานข้อมูลทันที
//   - ออฟไลน์: อ่าน-แก้-เขียนในฐานข้อมูลภายใน transaction ที่ล็อกแถว (FOR UPDATE)
//
// จึงมีแหล่งความจริงเดียวเสมอและไม่เกิดการเขียนทับกัน
package charsvc

import (
	"context"
	"encoding/json"

	"catquest-ro/server/internal/progress"
	"catquest-ro/server/internal/sim"
	"catquest-ro/server/internal/store"
)

// Online คือโลกเกมที่ผู้เล่นออนไลน์อยู่ (realtime.Hub)
type Online interface {
	MutateOnline(userID string, fn func(*sim.State) error) (json.RawMessage, bool, error)
	PeekOnline(userID string) (json.RawMessage, bool)
}

type Service struct {
	DB     *store.Store
	Online Online
	Engine func() *sim.Engine // เอนจินของข้อมูลเกมเวอร์ชันปัจจุบัน
}

func columns(st *sim.State) store.StateColumns {
	c := progress.Cols(st)
	return store.StateColumns{ClassID: c.ClassID, BaseLv: c.BaseLv, JobLv: c.JobLv, BaseExp: c.BaseExp, JobExp: c.JobExp, Gold: c.Gold}
}

// parseOrNew อ่าน state จากฐานข้อมูล; ถ้าว่าง/ใช้ไม่ได้ (บัญชีเก่า) สร้างตัวละครใหม่ให้
func parseOrNew(p *progress.Progress, raw []byte) (st *sim.State, created bool) {
	if len(raw) > 2 {
		if s, err := sim.ParseState(raw); err == nil && s.ClassID != "" && p.E.D.Class(s.ClassID) != nil {
			p.E.ApplyAutoSync(s)
			return s, false
		}
	}
	return p.NewCharacter(), true
}

// NewState สร้าง state ตัวละครใหม่ (ใช้ตอนสมัครสมาชิก)
func (s *Service) NewState() (json.RawMessage, store.StateColumns, error) {
	st := progress.New(s.Engine()).NewCharacter()
	js, err := json.Marshal(st)
	return js, columns(st), err
}

// Load คืนตัวละคร + state ล่าสุด (สดถ้าออนไลน์) พร้อมชีตสเตตัสที่ซิงก์แล้ว; บัญชีเก่าที่ state ว่างจะถูกสร้างตัวละครให้
func (s *Service) Load(ctx context.Context, userID string) (store.Character, json.RawMessage, error) {
	c, err := s.DB.CharacterByUser(ctx, userID)
	if err != nil {
		return c, nil, err
	}
	if live, ok := s.Online.PeekOnline(userID); ok {
		return c, live, nil
	}
	prog := progress.New(s.Engine())
	st, created := parseOrNew(prog, c.State)
	js, err := json.Marshal(st)
	if err != nil {
		return c, nil, err
	}
	if created {
		if err := s.DB.SaveCharacterState(ctx, c.ID, js, columns(st)); err != nil {
			return c, nil, err
		}
	}
	return c, js, nil
}

// Mutate ใช้คำสั่งความก้าวหน้า fn กับตัวละครของผู้ใช้อย่างเป็นอะตอม คืน state ใหม่ (RuleError ถ้าผิดกติกา — ไม่เปลี่ยนอะไร)
func (s *Service) Mutate(ctx context.Context, userID string, fn func(*progress.Progress, *sim.State) error) (json.RawMessage, error) {
	prog := progress.New(s.Engine())
	js, found, err := s.Online.MutateOnline(userID, func(st *sim.State) error { return fn(prog, st) })
	if found {
		if err != nil {
			return nil, err
		}
		// บันทึกทันที (คำสั่งเงิน/ไอเทมต้องไม่หายถ้าเซิร์ฟเวอร์ล่ม) — ลูปบันทึกอัตโนมัติจะเขียนซ้ำซึ่งไม่เป็นไร
		if c, e := s.DB.CharacterByUser(ctx, userID); e == nil {
			if st, e := sim.ParseState(js); e == nil {
				if e := s.DB.SaveCharacterState(ctx, c.ID, js, columns(st)); e != nil {
					return js, e
				}
			}
		}
		return js, nil
	}
	return s.DB.MutateCharacter(ctx, userID, func(c store.Character) (json.RawMessage, store.StateColumns, error) {
		st, _ := parseOrNew(prog, c.State)
		if err := fn(prog, st); err != nil {
			return nil, store.StateColumns{}, err
		}
		prog.E.ApplyAutoSync(st)
		out, err := json.Marshal(st)
		return out, columns(st), err
	})
}
