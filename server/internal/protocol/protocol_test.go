package protocol

import (
	"bytes"
	"encoding/binary"
	"math"
	"strings"
	"testing"
)

func TestDecodersNeverPanicOnShortOrGarbage(t *testing.T) {
	for n := 0; n < 48; n++ {
		for _, fill := range []byte{0x00, 0xFF, 0xC7} {
			f := bytes.Repeat([]byte{fill}, n)
			if n > 0 {
				f[0] = Magic
			}
			DecodePing(f)
			DecodeMove(f)
			DecodeAttack(f)
			DecodeSkill(f)
			DecodeRoll(f)
			DecodeChat(f)
		}
	}
}

func TestMoveRejectsNaNAndNormalizes(t *testing.T) {
	f := make([]byte, 22)
	f[0], f[1], f[2] = Magic, Version, OpMove
	binary.LittleEndian.PutUint32(f[8:], math.Float32bits(float32(math.NaN())))
	if _, ok := DecodeMove(f); ok {
		t.Fatal("NaN ต้องถูกปฏิเสธ")
	}
	binary.LittleEndian.PutUint32(f[8:], math.Float32bits(100))
	binary.LittleEndian.PutUint32(f[12:], math.Float32bits(200))
	f[20], f[21] = 0xF0, 99 // facing ติดลบ, anim เกินช่วง
	m, ok := DecodeMove(f)
	if !ok || m.Facing != -1 || m.Anim != AnimIdle || m.X != 100 || m.Y != 200 {
		t.Fatalf("%+v %v", m, ok)
	}
}

func TestChatRoundTripThaiAndSanitize(t *testing.T) {
	text := strings.Repeat("สวัสดี", 40) // > 512 ไบต์ ต้องไม่ตัดกลางตัวอักษร
	m, ok := DecodeChat(EncodeChat(0, "ฮีโร่", text))
	if !ok || m.Sender != "ฮีโร่" || m.Text == "" || !strings.HasPrefix(text, m.Text) {
		t.Fatalf("decode: %+v", m)
	}
	if got := CleanText("  a\x00b\x1b[31mc\n ", 50); got != "ab[31mc" {
		t.Fatalf("got %q", got)
	}
	if got := CleanText(strings.Repeat("ก", 100), 10); len([]rune(got)) != 10 {
		t.Fatal("ต้องจำกัดจำนวนตัวอักษร")
	}
	if got := TruncBytes("กขค", 4); got != "ก" {
		t.Fatalf("ต้องตัดที่ขอบตัวอักษร: %q", got)
	}
}

func TestSnapshotLayout(t *testing.T) {
	b := EncodeSnapshot(7, []PeerView{{UID: 1001, X: 10, Y: 20, HP: 5, MaxHP: 9, Class: 2, Weapon: 5, Facing: -1, Anim: 3}},
		[]MobView{{UID: 3, X: 100, Y: 200, HP: 4242, Alive: true, Facing: 1, Anim: 2, Casting: true}})
	if len(b) != 10+16+16 || b[2] != OpSnapshot || b[8] != 1 || b[9] != 1 {
		t.Fatalf("โครงสร้างผิด len=%d", len(b))
	}
	if binary.LittleEndian.Uint32(b[10:]) != 1001 || b[10+12] != 2 || int8(b[10+14]) != -1 {
		t.Fatal("peer ผิด")
	}
	if binary.LittleEndian.Uint32(b[26+8:]) != 4242 || b[26+15] != 1 {
		t.Fatal("mob ผิด")
	}
}

func TestFrameSizes(t *testing.T) {
	cases := map[string]struct {
		got  []byte
		size int
		op   byte
	}{
		"pong":        {EncodePong(1, 2), 16, OpPong},
		"welcome":     {EncodeWelcome(7), 8, OpWelcome},
		"damage":      {EncodeDamage(1, 2, 3, 4, DmgCrit), 21, OpDamage},
		"telegraph":   {EncodeTelegraph(1, 0, 10, 20, 90, 45, 1300, 180), 22, OpTelegraph},
		"playerstate": {EncodePlayerState(10, 100, 5, 50, nil), 21, OpPlayerState},
	}
	for name, c := range cases {
		if len(c.got) != c.size || c.got[0] != Magic || c.got[2] != c.op {
			t.Errorf("%s: len=%d op=%#x", name, len(c.got), c.got[2])
		}
	}
	ps := EncodePlayerState(12.5, 100, 7.25, 50, []StatusView{{SkillIdx: 300, Lv: 4, LeftDs: 123}, {SkillIdx: 5, Lv: 1, LeftDs: StatusForever}})
	if math.Float32frombits(binary.LittleEndian.Uint32(ps[4:])) != 12.5 || math.Float32frombits(binary.LittleEndian.Uint32(ps[12:])) != 7.25 {
		t.Fatal("PLAYER_STATE ค่าผิด")
	}
	if ps[20] != 2 || binary.LittleEndian.Uint16(ps[21:]) != 300 || ps[23] != 4 || binary.LittleEndian.Uint16(ps[24:]) != 123 || binary.LittleEndian.Uint16(ps[29:]) != StatusForever || len(ps) != 31 {
		t.Fatalf("สถานะใน PLAYER_STATE ผิด: %v", ps[20:])
	}
	if u, ok := DecodeUseItem([]byte{Magic, Version, OpUseItem, 0, 9, 0, 0, 0, 0x34, 0x12}); !ok || u.Seq != 9 || u.ItemIdx != 0x1234 {
		t.Fatalf("UseItem: %+v", u)
	}
}
