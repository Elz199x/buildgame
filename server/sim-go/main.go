// ============================================================
// Cat Quest × RO — Go Authoritative Simulation Server (30–60 Hz Tick Loop)
// หน้าที่หลัก:
// 1. รัน Fixed Timestep Tick Loop ที่ 30 Hz (33.33ms) หรือ 60 Hz (16.66ms)
// 2. คำนวณการเคลื่อนที่, AOI และวงแดง Telegraph (Circle/Cone/Line)
// 3. คำนวณสูตรดาเมจ RO แท้ (Soft/Hard DEF, Crit Bypass, i-frame Roll)
// 4. รับ-ส่งเฟรมไบนารี (0xC7 Wire Format) กับ Go Gateway ผ่าน TCP IPC
// ============================================================
package main

import (
	"encoding/binary"
	"log"
	"math"
	"net"
	"sync"
	"time"
)

const (
	Magic   byte = 0xC7
	Version byte = 1

	OpMove          byte = 0x10
	OpAttack        byte = 0x11
	OpSkill         byte = 0x12
	OpWorldSnapshot byte = 0x20
	OpDamageEvent   byte = 0x21

	TickHz         = 30
	WorldW float32 = 2400
	WorldH float32 = 1700
)

type PlayerEntity struct {
	UID            uint32
	X, Y           float32
	VX, VY         int16
	Facing         int8
	Anim           uint8
	ClassID        uint8
	WeaponID       uint8
	HP, MaxHP      uint16
	Atk, Matk      float32
	Hit, Flee      float32
	PhysCrit       float32
	Aspd           float32
	RollIframeLeft float32
}

type MonsterEntity struct {
	UID            uint32
	MonsterID      string
	X, Y           float32
	HomeX, HomeY   float32
	HP, MaxHP      uint32
	Atk, Def, Mdef float32
	Flee, Hit      float32
	MoveSpeed      float32
	AggroRange     float32
	AttackRange    float32
	Alive          bool
	RespawnLeft    float32
	Facing         int8
	Anim           uint8
	Casting        bool
	SkillCD        float32
}

type TelegraphZone struct {
	MobUID   uint32
	Shape    uint8 // 0=Circle, 1=Cone, 2=Line
	X, Y     float32
	Angle    float32
	Radius   float32
	ConeRad  float32
	Mult     float32
	Elapsed  float32
	Duration float32
}

type WorldState struct {
	mu            sync.Mutex
	Tick          uint32
	Players       map[uint32]*PlayerEntity
	Mobs          []*MonsterEntity
	Telegraphs    []*TelegraphZone
	PendingEvents [][]byte
}

func spawnMob(uid uint32, id string, x, y float32, hp uint32, atk, def, spd, aggro float32) *MonsterEntity {
	return &MonsterEntity{
		UID: uid, MonsterID: id, X: x, Y: y, HomeX: x, HomeY: y,
		HP: hp, MaxHP: hp, Atk: atk, Def: def, Mdef: def * 0.5,
		Flee: 60, Hit: 100, MoveSpeed: spd, AggroRange: aggro, AttackRange: 70,
		Alive: true, Facing: -1, SkillCD: 6,
	}
}

func NewWorldState() *WorldState {
	return &WorldState{
		Players: make(map[uint32]*PlayerEntity),
		Mobs: []*MonsterEntity{
			spawnMob(1, "dummy", 820, 790, 20000, 80, 40, 0, 0),
			spawnMob(2, "dummy", 820, 920, 20000, 80, 40, 0, 0),
			spawnMob(3, "armor", 960, 855, 40000, 150, 200, 70, 210),
			spawnMob(4, "poring", 860, 340, 1800, 42, 15, 85, 190),
			spawnMob(5, "poring", 1020, 310, 1800, 42, 15, 85, 190),
			spawnMob(6, "wolf", 1420, 1180, 6200, 115, 65, 145, 250),
			spawnMob(7, "boss", 1960, 580, 150000, 400, 400, 105, 310),
		},
	}
}

func clampf(v, lo, hi float32) float32 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func dist(ax, ay, bx, by float32) float32 {
	dx, dy := float64(ax-bx), float64(ay-by)
	return float32(math.Sqrt(dx*dx + dy*dy))
}

func toU16(v float32) uint16 {
	r := math.Round(float64(v))
	if r < 0 {
		return 0
	}
	if r > 65535 {
		return 65535
	}
	return uint16(r)
}

// สูตรคำนวณดาเมจ RO แท้ (Soft/Hard DEF Reduction + Crit Bypass)
func CalcRODamage(atk, def, critChance float32, seed uint32) (uint32, bool) {
	pseudo := float32((seed*1664525+1013904223)%1000) / 1000
	isCrit := pseudo < critChance/100
	const softDefK float32 = 300
	var red float32
	if !isCrit {
		red = def / (def + softDefK)
		if red > 0.80 {
			red = 0.80
		}
	}
	var mult float32 = 1
	if isCrit {
		mult = 1.5
	}
	dmg := float32(math.Round(float64(atk * mult * (1 - red))))
	if dmg < 1 {
		dmg = 1
	}
	return uint32(dmg), isCrit
}

// อัปเดตโลก 1 Tick (33.33ms @ 30Hz)
func (w *WorldState) Step(dt float32) {
	w.Tick++

	type pos struct{ x, y float32 }
	players := make([]pos, 0, len(w.Players))
	for _, p := range w.Players {
		players = append(players, pos{p.X, p.Y})
	}

	// 1. AI มอนสเตอร์และการเกิดใหม่
	for _, m := range w.Mobs {
		if !m.Alive {
			m.RespawnLeft -= dt
			if m.RespawnLeft <= 0 {
				m.Alive = true
				m.HP = m.MaxHP
				m.X, m.Y = m.HomeX, m.HomeY
				m.Casting = false
			}
			continue
		}
		m.SkillCD = float32(math.Max(0, float64(m.SkillCD-dt)))

		if m.AggroRange > 0 {
			found := false
			var nx, ny, nd float32
			for _, p := range players {
				d := dist(p.x, p.y, m.X, m.Y)
				if d <= m.AggroRange && (!found || d < nd) {
					found, nx, ny, nd = true, p.x, p.y, d
				}
			}
			if found {
				if nx >= m.X {
					m.Facing = 1
				} else {
					m.Facing = -1
				}
				if nd > m.AttackRange && m.MoveSpeed > 0 && !m.Casting {
					ang := math.Atan2(float64(ny-m.Y), float64(nx-m.X))
					m.X = clampf(m.X+float32(math.Cos(ang))*m.MoveSpeed*dt, 50, WorldW-50)
					m.Y = clampf(m.Y+float32(math.Sin(ang))*m.MoveSpeed*dt, 50, WorldH-50)
					m.Anim = 1 // walk
				} else {
					m.Anim = 0 // idle
				}
			}
		}
	}

	// 2. วงแดง Telegraph
	kept := w.Telegraphs[:0]
	for _, tg := range w.Telegraphs {
		tg.Elapsed += dt
		if tg.Elapsed < tg.Duration {
			kept = append(kept, tg)
			continue
		}
		for _, p := range w.Players {
			if p.RollIframeLeft > 0 {
				continue // อมตะขณะกลิ้งหลบ Dodge Roll!
			}
			d := dist(p.X, p.Y, tg.X, tg.Y)
			var hit bool
			switch tg.Shape {
			case 1:
				diff := math.Atan2(float64(p.Y-tg.Y), float64(p.X-tg.X)) - float64(tg.Angle)
				for diff > math.Pi {
					diff -= math.Pi * 2
				}
				for diff < -math.Pi {
					diff += math.Pi * 2
				}
				hit = d <= tg.Radius && math.Abs(diff) <= float64(tg.ConeRad)*0.5
			default:
				hit = d <= tg.Radius
			}
			if hit {
				if p.HP > 120 {
					p.HP -= 120
				} else {
					p.HP = 0
				}
			}
		}
	}
	w.Telegraphs = kept
}

// บีบอัดสถานะโลกเป็นเฟรมไบนารี 0xC7 OP_WORLD_SNAPSHOT (Peer 16B, Mob 16B)
func (w *WorldState) EncodeSnapshot() []byte {
	pCount := len(w.Players)
	if pCount > 255 {
		pCount = 255
	}
	mCount := len(w.Mobs)
	if mCount > 255 {
		mCount = 255
	}
	buf := make([]byte, 0, 10+pCount*16+mCount*16)
	buf = append(buf, Magic, Version, OpWorldSnapshot, 1)
	buf = binary.LittleEndian.AppendUint32(buf, w.Tick)
	buf = append(buf, byte(pCount), byte(mCount))

	n := 0
	for _, p := range w.Players {
		if n >= pCount {
			break
		}
		n++
		buf = binary.LittleEndian.AppendUint32(buf, p.UID)
		buf = binary.LittleEndian.AppendUint16(buf, toU16(p.X))
		buf = binary.LittleEndian.AppendUint16(buf, toU16(p.Y))
		buf = binary.LittleEndian.AppendUint16(buf, p.HP)
		buf = binary.LittleEndian.AppendUint16(buf, p.MaxHP)
		buf = append(buf, p.ClassID, p.WeaponID, byte(p.Facing), p.Anim)
	}

	for _, m := range w.Mobs[:mCount] {
		buf = binary.LittleEndian.AppendUint32(buf, m.UID)
		buf = binary.LittleEndian.AppendUint16(buf, toU16(m.X))
		buf = binary.LittleEndian.AppendUint16(buf, toU16(m.Y))
		buf = binary.LittleEndian.AppendUint32(buf, m.HP)
		buf = append(buf, b2u(m.Alive), byte(m.Facing), m.Anim, b2u(m.Casting))
	}
	return buf
}

func b2u(b bool) byte {
	if b {
		return 1
	}
	return 0
}

func f32le(b []byte) float32 { return math.Float32frombits(binary.LittleEndian.Uint32(b)) }

// ประมวลผลคำสั่งไบนารีจากผู้เล่น (OP_MOVE / OP_ATTACK / OP_SKILL)
func (w *WorldState) HandleClientFrame(uid uint32, frame []byte) {
	if len(frame) < 4 || frame[0] != Magic {
		return
	}
	op := frame[2]
	switch {
	case op == OpMove && len(frame) >= 22:
		x := f32le(frame[8:12])
		y := f32le(frame[12:16])
		vx := int16(binary.LittleEndian.Uint16(frame[16:18]))
		vy := int16(binary.LittleEndian.Uint16(frame[18:20]))
		facing := int8(frame[20])
		anim := frame[21]
		p, ok := w.Players[uid]
		if !ok {
			p = &PlayerEntity{
				UID: uid, ClassID: 1, WeaponID: 2, HP: 1900, MaxHP: 1900,
				Atk: 120, Matk: 75, Hit: 110, Flee: 90, PhysCrit: 15, Aspd: 135,
			}
			w.Players[uid] = p
		}
		p.X = clampf(x, 40, WorldW-40)
		p.Y = clampf(y, 40, WorldH-40)
		p.VX, p.VY, p.Facing, p.Anim = vx, vy, facing, anim

	case (op == OpAttack || op == OpSkill) && len(frame) >= 16:
		var targetUID uint32
		if op == OpAttack {
			targetUID = binary.LittleEndian.Uint32(frame[8:12])
		} else {
			targetUID = binary.LittleEndian.Uint32(frame[12:16])
		}
		var atk, crit float32 = 100, 10
		if p, ok := w.Players[uid]; ok {
			atk, crit = p.Atk, p.PhysCrit
		}
		for _, mob := range w.Mobs {
			if mob.UID != targetUID || !mob.Alive {
				continue
			}
			dmg, isCrit := CalcRODamage(atk, mob.Def, crit, w.Tick^uid)
			if dmg >= mob.HP {
				mob.HP = 0
			} else {
				mob.HP -= dmg
			}
			killed := mob.HP == 0
			if killed {
				mob.Alive = false
				mob.RespawnLeft = 3.5
			}
			// เฟรม OP_DAMAGE_EVENT (21 ไบต์)
			ev := make([]byte, 0, 21)
			ev = append(ev, Magic, Version, OpDamageEvent, 1)
			ev = binary.LittleEndian.AppendUint32(ev, uid)
			ev = binary.LittleEndian.AppendUint32(ev, targetUID)
			ev = binary.LittleEndian.AppendUint32(ev, dmg)
			ev = binary.LittleEndian.AppendUint32(ev, mob.HP)
			var flags byte
			if isCrit {
				flags |= 1
			}
			if killed {
				flags |= 8
			}
			ev = append(ev, flags)
			w.PendingEvents = append(w.PendingEvents, ev)
			break
		}
	}
}

func main() {
	ln, err := net.Listen("tcp", "127.0.0.1:9001")
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("[Go Sim Server] Running %dHz Authoritative Loop on %s", TickHz, ln.Addr())

	world := NewWorldState()

	// Fixed Timestep Simulation Loop
	go func() {
		ticker := time.NewTicker(time.Second / TickHz)
		defer ticker.Stop()
		dt := float32(1.0) / float32(TickHz)
		for range ticker.C {
			world.mu.Lock()
			world.Step(dt)
			world.mu.Unlock()
		}
	}()

	// รับการเชื่อมต่อ IPC จาก Go Gateway
	for {
		conn, err := ln.Accept()
		if err != nil {
			continue
		}
		log.Printf("[Go Sim Server] Gateway connected from %s", conn.RemoteAddr())
		go func(c net.Conn) {
			defer c.Close()
			buf := make([]byte, 1024)
			for {
				n, err := c.Read(buf)
				if err != nil || n == 0 {
					return
				}
				world.mu.Lock()
				world.HandleClientFrame(1, buf[:n])
				snap := world.EncodeSnapshot()
				world.mu.Unlock()
				if _, err := c.Write(snap); err != nil {
					return
				}
			}
		}(conn)
	}
}
