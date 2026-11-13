package auth

import (
	"strings"
	"testing"
	"time"
)

var fast = Params{Memory: 8 * 1024, Time: 1, Threads: 1}

func TestPasswordHashVerify(t *testing.T) {
	h, err := HashPassword("correct horse", fast)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(h, "$argon2id$v=19$m=8192,t=1,p=1$") {
		t.Fatalf("รูปแบบ PHC ผิด: %s", h)
	}
	if ok, rehash := VerifyPassword("correct horse", h, fast); !ok || rehash {
		t.Fatalf("ต้องผ่านและไม่ต้องแฮชใหม่: %v %v", ok, rehash)
	}
	if ok, _ := VerifyPassword("wrong", h, fast); ok {
		t.Fatal("รหัสผิดต้องไม่ผ่าน")
	}
	if ok, rehash := VerifyPassword("correct horse", h, Params{Memory: 16 * 1024, Time: 2, Threads: 1}); !ok || !rehash {
		t.Fatalf("พารามิเตอร์ใหม่ต้องสั่งให้แฮชใหม่: %v %v", ok, rehash)
	}
	h2, _ := HashPassword("correct horse", fast)
	if h == h2 {
		t.Fatal("salt ต้องสุ่มใหม่ทุกครั้ง")
	}
	for _, bad := range []string{"", "plain", "$argon2id$v=19$m=1,t=1,p=1$$", "$bcrypt$x$y$z$w", "$argon2id$v=19$m=999999999,t=99,p=1$QQ$QQ"} {
		if ok, _ := VerifyPassword("x", bad, fast); ok {
			t.Fatalf("แฮชเสียต้องไม่ผ่าน: %q", bad)
		}
	}
}

func TestTokens(t *testing.T) {
	a, ha, err := NewToken()
	b, hb, _ := NewToken()
	if err != nil || a == b || len(a) < 40 || len(ha) != 32 {
		t.Fatalf("token: %q %q", a, b)
	}
	if string(HashToken(a)) != string(ha) || string(ha) == string(hb) {
		t.Fatal("HashToken ต้องตรงกัน/ต่างกันตาม token")
	}
}

func TestValidation(t *testing.T) {
	for u, want := range map[string]bool{"abc": true, "Hero_99": true, "ab": false, "has space": false, "ไทย": false, strings.Repeat("a", 21): false, "a-b": false, "": false} {
		if ValidUsername(u) != want {
			t.Errorf("ValidUsername(%q) ควรเป็น %v", u, want)
		}
	}
	if ValidatePassword("short", "u") == "" || ValidatePassword("longenough1", "u") != "" || ValidatePassword("alicealice", "AliceAlice") == "" {
		t.Fatal("กติการหัสผ่านผิด")
	}
	if ValidatePassword(strings.Repeat("ก", 50), "u") == "" { // 150 ไบต์ > 128
		t.Fatal("ต้องจำกัดความยาวเป็นไบต์")
	}
	if ValidatePassword("รหัสผ่านภาษาไทย", "u") != "" {
		t.Fatal("ภาษาไทยต้องใช้เป็นรหัสผ่านได้")
	}
}

func TestLimiter(t *testing.T) {
	l := NewLimiter(60, 3) // 1 โทเคน/วินาที burst 3
	now := time.Unix(1000, 0)
	l.now = func() time.Time { return now }
	for i := 0; i < 3; i++ {
		if !l.Allow("k") {
			t.Fatalf("ครั้งที่ %d ต้องผ่าน", i)
		}
	}
	if l.Allow("k") {
		t.Fatal("เกิน burst ต้องถูกปฏิเสธ")
	}
	if !l.Allow("other") {
		t.Fatal("คนละคีย์ต้องไม่กระทบกัน")
	}
	now = now.Add(2 * time.Second)
	if !l.Allow("k") || !l.Allow("k") || l.Allow("k") {
		t.Fatal("ต้องเติมโทเคนตามเวลา (2 วินาที = 2 ครั้ง)")
	}
	now = now.Add(time.Hour)
	l.Allow("zzz") // กระตุ้นการล้างคีย์เก่า
	l.mu.Lock()
	n := len(l.buckets)
	l.mu.Unlock()
	if n > 2 {
		t.Fatalf("ต้องล้างคีย์เก่า เหลือ %d", n)
	}
}
