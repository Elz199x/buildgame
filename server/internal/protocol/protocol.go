// Binary Wire Protocol 0xC7 (Little-Endian) — ตรงกับ web/lab/src/05b-net-codec.js และ web/lib/codec.ts
//
//	Header (4B): [magic 0xC7][version 1][opcode][flags]
//
// ทุกฟังก์ชัน decode ตรวจความยาวเฟรมก่อนอ่านเสมอ (ข้อมูลจากไคลเอนต์ไม่น่าไว้ใจ)
package protocol

import (
	"encoding/binary"
	"math"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	Magic   byte = 0xC7
	Version byte = 1
)

const (
	OpPing        byte = 0x01
	OpPong        byte = 0x02
	OpAuth        byte = 0x03 // สงวนไว้ (เลิกใช้: เซิร์ฟเวอร์ใช้ตัวละครของบัญชีที่ล็อกอิน)
	OpWelcome     byte = 0x04 // เซิร์ฟเวอร์ → ไคลเอนต์: [hdr:4][uid:u32] บอก uid ของผู้เล่นคนนี้
	OpMove        byte = 0x10
	OpAttack      byte = 0x11
	OpSkill       byte = 0x12
	OpRoll        byte = 0x13
	OpUseItem     byte = 0x14 // ใช้ไอเทมฟื้นฟู: [hdr:4][seq:u32][itemIdx:u16] (itemIdx = ลำดับใน equipItems)
	OpSnapshot    byte = 0x20
	OpDamage      byte = 0x21
	OpTelegraph   byte = 0x22
	OpStateSync   byte = 0x24 // เซิร์ฟเวอร์ → เจ้าของ: state ตัวละครทั้งก้อน (JSON) หลังความก้าวหน้าเปลี่ยน: [hdr:4][len:u32][json]
	OpReward      byte = 0x25 // เซิร์ฟเวอร์ → เจ้าของ: รางวัลจากการล้มมอนสเตอร์
	OpPlayerState byte = 0x23 // เซิร์ฟเวอร์ → เจ้าของตัวละคร: HP/SP จริงที่เซิร์ฟเวอร์คำนวณ (5Hz)
	OpChat        byte = 0x30
)

// รหัสแอนิเมชัน (ลำดับต้องตรงกับ ANIM_CODES ฝั่งไคลเอนต์)
const (
	AnimIdle   uint8 = 0
	AnimWalk   uint8 = 1
	AnimAttack uint8 = 2
	AnimCast   uint8 = 3
	AnimRoll   uint8 = 4
	AnimHurt   uint8 = 5
	AnimDead   uint8 = 6
)

var ClassCodes = []string{"novice", "swordman", "thief", "archer", "mage"}
var WeaponCodes = []string{"unarmed", "sword_1h", "sword_2h", "axe", "mace", "dagger", "bow", "staff"}

const (
	MaxNameRunes = 24
	MaxChatRunes = 150
)

// ---------- ชนิดข้อความที่ถอดรหัสแล้ว ----------

type Move struct {
	Seq    uint32
	X, Y   float32
	VX, VY int16
	Facing int8
	Anim   uint8
}

type Attack struct {
	Seq       uint32
	TargetUID uint32
	X, Y      uint16
}

type Skill struct {
	Seq       uint32
	SkillIdx  uint16
	Lv        uint8
	TargetUID uint32
}

type UseItem struct {
	Seq     uint32
	ItemIdx uint16
}

type Roll struct {
	Seq    uint32
	X, Y   uint16
	DX, DY int16
}

type Chat struct {
	Channel uint8
	Sender  string
	Text    string
}

// ---------- ตัวช่วยอ่านอย่างปลอดภัย ----------

func validFrame(f []byte, minLen int) bool {
	return len(f) >= minLen && len(f) >= 4 && f[0] == Magic
}

func finite32(v float32) bool {
	f := float64(v)
	return !math.IsNaN(f) && !math.IsInf(f, 0)
}

// CleanText ตัดอักขระควบคุม ตัดช่องว่างหัวท้าย และจำกัดจำนวนตัวอักษร
func CleanText(s string, maxRunes int) string {
	if !utf8.ValidString(s) {
		s = strings.ToValidUTF8(s, "")
	}
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == ' ' || r == ' ' {
			return -1
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) > maxRunes {
		s = string([]rune(s)[:maxRunes])
	}
	return s
}

// ---------- DECODERS ----------

func DecodePing(f []byte) (float64, bool) {
	if !validFrame(f, 12) {
		return 0, false
	}
	return math.Float64frombits(binary.LittleEndian.Uint64(f[4:12])), true
}

func DecodeMove(f []byte) (Move, bool) {
	if !validFrame(f, 22) {
		return Move{}, false
	}
	m := Move{
		Seq:    binary.LittleEndian.Uint32(f[4:]),
		X:      math.Float32frombits(binary.LittleEndian.Uint32(f[8:])),
		Y:      math.Float32frombits(binary.LittleEndian.Uint32(f[12:])),
		VX:     int16(binary.LittleEndian.Uint16(f[16:])),
		VY:     int16(binary.LittleEndian.Uint16(f[18:])),
		Facing: int8(f[20]),
		Anim:   f[21],
	}
	if !finite32(m.X) || !finite32(m.Y) {
		return Move{}, false
	}
	if m.Facing >= 0 {
		m.Facing = 1
	} else {
		m.Facing = -1
	}
	if m.Anim > AnimDead {
		m.Anim = AnimIdle
	}
	return m, true
}

func DecodeAttack(f []byte) (Attack, bool) {
	if !validFrame(f, 16) {
		return Attack{}, false
	}
	return Attack{
		Seq:       binary.LittleEndian.Uint32(f[4:]),
		TargetUID: binary.LittleEndian.Uint32(f[8:]),
		X:         binary.LittleEndian.Uint16(f[12:]),
		Y:         binary.LittleEndian.Uint16(f[14:]),
	}, true
}

func DecodeSkill(f []byte) (Skill, bool) {
	if !validFrame(f, 18) {
		return Skill{}, false
	}
	return Skill{
		Seq:       binary.LittleEndian.Uint32(f[4:]),
		SkillIdx:  binary.LittleEndian.Uint16(f[8:]),
		Lv:        f[10],
		TargetUID: binary.LittleEndian.Uint32(f[12:]),
	}, true
}

func DecodeUseItem(f []byte) (UseItem, bool) {
	if !validFrame(f, 10) {
		return UseItem{}, false
	}
	return UseItem{Seq: binary.LittleEndian.Uint32(f[4:]), ItemIdx: binary.LittleEndian.Uint16(f[8:])}, true
}

func DecodeRoll(f []byte) (Roll, bool) {
	if !validFrame(f, 16) {
		return Roll{}, false
	}
	return Roll{
		Seq: binary.LittleEndian.Uint32(f[4:]),
		X:   binary.LittleEndian.Uint16(f[8:]),
		Y:   binary.LittleEndian.Uint16(f[10:]),
		DX:  int16(binary.LittleEndian.Uint16(f[12:])),
		DY:  int16(binary.LittleEndian.Uint16(f[14:])),
	}, true
}

func DecodeChat(f []byte) (Chat, bool) {
	if !validFrame(f, 8) {
		return Chat{}, false
	}
	sLen := int(f[5])
	mLen := int(binary.LittleEndian.Uint16(f[6:]))
	if 8+sLen > len(f) {
		return Chat{}, false
	}
	mEnd := 8 + sLen + mLen
	if mEnd > len(f) {
		mEnd = len(f)
	}
	return Chat{
		Channel: f[4],
		Sender:  CleanText(string(f[8:8+sLen]), MaxNameRunes),
		Text:    CleanText(string(f[8+sLen:mEnd]), MaxChatRunes),
	}, true
}

// ---------- ENCODERS ----------

// StatusView = บัฟ/toggle ที่ติดอยู่บนผู้เล่น (ใน PLAYER_STATE)
type StatusView struct {
	SkillIdx uint16 // ลำดับสกิลในอาร์เรย์ skills
	Lv       uint8
	LeftDs   uint16 // เวลาที่เหลือหน่วย 0.1 วินาที; 0xFFFF = ไม่หมดเวลา (toggle/trigger)
}

const StatusForever uint16 = 0xFFFF

// EncodePlayerState: [hdr:4][hp:f32][maxHp:f32][sp:f32][maxSp:f32][n:u8] + n×[skillIdx:u16][lv:u8][leftDs:u16]
// (ส่งให้เจ้าของตัวละครเท่านั้น; ส่งได้สูงสุด 32 สถานะ)
func EncodePlayerState(hp, maxHp, sp, maxSp float64, sts []StatusView) []byte {
	if len(sts) > 32 {
		sts = sts[:32]
	}
	b := header(OpPlayerState, 1)
	for _, v := range [...]float64{hp, maxHp, sp, maxSp} {
		b = binary.LittleEndian.AppendUint32(b, math.Float32bits(float32(v)))
	}
	b = append(b, byte(len(sts)))
	for _, s := range sts {
		b = binary.LittleEndian.AppendUint16(b, s.SkillIdx)
		b = append(b, s.Lv)
		b = binary.LittleEndian.AppendUint16(b, s.LeftDs)
	}
	return b
}

func header(op, flags byte) []byte {
	return []byte{Magic, Version, op, flags}
}

func EncodePong(clientTs float64, tick uint32) []byte {
	b := header(OpPong, 1)
	b = binary.LittleEndian.AppendUint64(b, math.Float64bits(clientTs))
	return binary.LittleEndian.AppendUint32(b, tick)
}

func EncodeWelcome(uid uint32) []byte {
	return binary.LittleEndian.AppendUint32(header(OpWelcome, 1), uid)
}

func clampU16(v float32) uint16 {
	r := math.Round(float64(v))
	if r < 0 {
		return 0
	}
	if r > 65535 {
		return 65535
	}
	return uint16(r)
}

func b2u(b bool) byte {
	if b {
		return 1
	}
	return 0
}

// PeerView / MobView คือข้อมูลที่ใช้เข้ารหัส snapshot (แยกจากสถานะภายในของโลก)
type PeerView struct {
	UID           uint32
	X, Y          float32
	HP, MaxHP     uint16
	Class, Weapon uint8
	Facing        int8
	Anim          uint8
}

type MobView struct {
	UID     uint32
	X, Y    float32
	HP      uint32
	Alive   bool
	Facing  int8
	Anim    uint8
	Casting bool
}

// EncodeSnapshot: [hdr:4][tick:u32][peerCount:u8][mobCount:u8] + peers(16B) + mobs(16B)
func EncodeSnapshot(tick uint32, peers []PeerView, mobs []MobView) []byte {
	if len(peers) > 255 {
		peers = peers[:255]
	}
	if len(mobs) > 255 {
		mobs = mobs[:255]
	}
	b := make([]byte, 0, 10+16*(len(peers)+len(mobs)))
	b = append(b, Magic, Version, OpSnapshot, 1)
	b = binary.LittleEndian.AppendUint32(b, tick)
	b = append(b, byte(len(peers)), byte(len(mobs)))
	for _, p := range peers {
		b = binary.LittleEndian.AppendUint32(b, p.UID)
		b = binary.LittleEndian.AppendUint16(b, clampU16(p.X))
		b = binary.LittleEndian.AppendUint16(b, clampU16(p.Y))
		b = binary.LittleEndian.AppendUint16(b, p.HP)
		mh := p.MaxHP
		if mh == 0 {
			mh = 1
		}
		b = binary.LittleEndian.AppendUint16(b, mh)
		b = append(b, p.Class, p.Weapon, byte(p.Facing), p.Anim)
	}
	for _, m := range mobs {
		b = binary.LittleEndian.AppendUint32(b, m.UID)
		b = binary.LittleEndian.AppendUint16(b, clampU16(m.X))
		b = binary.LittleEndian.AppendUint16(b, clampU16(m.Y))
		b = binary.LittleEndian.AppendUint32(b, m.HP)
		b = append(b, b2u(m.Alive), byte(m.Facing), m.Anim, b2u(m.Casting))
	}
	return b
}

const (
	DmgCrit  byte = 1
	DmgMiss  byte = 2
	DmgMagic byte = 4
	DmgKill  byte = 8
)

// EncodeDamage: [hdr:4][attacker:u32][target:u32][dmg:u32][hpLeft:u32][flags:u8] = 21B
func EncodeDamage(attacker, target, dmg, hpLeft uint32, flags byte) []byte {
	b := header(OpDamage, 1)
	b = binary.LittleEndian.AppendUint32(b, attacker)
	b = binary.LittleEndian.AppendUint32(b, target)
	b = binary.LittleEndian.AppendUint32(b, dmg)
	b = binary.LittleEndian.AppendUint32(b, hpLeft)
	return append(b, flags)
}

// EncodeTelegraph: [hdr:4][mobUid:u32][shape:u8][x:u16][y:u16][radius:u16][angleDeg:i16][castMs:u16][multPct:u16][pad:u8] = 22B
func EncodeTelegraph(mobUID uint32, shape uint8, x, y float32, radius float32, angleDeg int16, castMs uint16, multPct uint16) []byte {
	b := header(OpTelegraph, 1)
	b = binary.LittleEndian.AppendUint32(b, mobUID)
	b = append(b, shape)
	b = binary.LittleEndian.AppendUint16(b, clampU16(x))
	b = binary.LittleEndian.AppendUint16(b, clampU16(y))
	b = binary.LittleEndian.AppendUint16(b, clampU16(radius))
	b = binary.LittleEndian.AppendUint16(b, uint16(angleDeg))
	b = binary.LittleEndian.AppendUint16(b, castMs)
	b = binary.LittleEndian.AppendUint16(b, multPct)
	return append(b, 0)
}

// EncodeChat: [hdr:4][channel:u8][senderLen:u8][msgLen:u16][sender][msg]
func EncodeChat(channel uint8, sender, text string) []byte {
	s := []byte(TruncBytes(sender, 64))
	m := []byte(TruncBytes(text, 512))
	b := header(OpChat, 0)
	b = append(b, channel, byte(len(s)))
	b = binary.LittleEndian.AppendUint16(b, uint16(len(m)))
	b = append(b, s...)
	return append(b, m...)
}

// TruncBytes ตัดสตริงให้ไม่เกิน n ไบต์โดยไม่ตัดกลางอักขระ UTF-8 (ภาษาไทยใช้ 3 ไบต์/ตัว)
func TruncBytes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	for n > 0 && !utf8.RuneStart(s[n]) {
		n--
	}
	return s[:n]
}

// EncodeStateSync: [hdr:4][len:u32][state JSON] (ส่งให้เจ้าของตัวละครเท่านั้น)
func EncodeStateSync(stateJSON []byte) []byte {
	b := header(OpStateSync, 1)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(stateJSON)))
	return append(b, stateJSON...)
}

// ItemGain = ไอเทมที่ได้ (itemIdx = ลำดับใน equipItems)
type ItemGain struct {
	ItemIdx uint16
	Qty     uint8
}

// Reward flags
const (
	RewardBaseLevelUp byte = 1
	RewardJobLevelUp  byte = 2
)

// EncodeReward: [hdr:4][mobUid:u32][baseExp:u32][jobExp:u32][gold:u32][baseLv:u8][jobLv:u8][flags:u8][n:u8] + n×[itemIdx:u16][qty:u8]
func EncodeReward(mobUID, baseExp, jobExp, gold uint32, baseLv, jobLv uint8, flags byte, items []ItemGain) []byte {
	if len(items) > 32 {
		items = items[:32]
	}
	b := header(OpReward, 1)
	b = binary.LittleEndian.AppendUint32(b, mobUID)
	b = binary.LittleEndian.AppendUint32(b, baseExp)
	b = binary.LittleEndian.AppendUint32(b, jobExp)
	b = binary.LittleEndian.AppendUint32(b, gold)
	b = append(b, baseLv, jobLv, flags, byte(len(items)))
	for _, it := range items {
		b = binary.LittleEndian.AppendUint16(b, it.ItemIdx)
		b = append(b, it.Qty)
	}
	return b
}
