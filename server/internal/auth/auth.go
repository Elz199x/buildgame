// Package auth: การยืนยันตัวตน — แฮชรหัสผ่าน (argon2id), โทเคนเซสชัน (opaque, เก็บเฉพาะแฮช), ตรวจรูปแบบอินพุต, จำกัดอัตราล็อกอิน
package auth

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Params พารามิเตอร์ argon2id (ค่าเริ่มต้นตามคำแนะนำ OWASP: m=64MiB, t=3, p=2)
type Params struct {
	Memory  uint32 // KiB
	Time    uint32
	Threads uint8
}

var DefaultParams = Params{Memory: 64 * 1024, Time: 3, Threads: 2}

const (
	saltLen = 16
	keyLen  = 32
)

// HashPassword คืน PHC string: $argon2id$v=19$m=65536,t=3,p=2$<salt>$<hash>
func HashPassword(pw string, p Params) (string, error) {
	salt := make([]byte, saltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(pw), salt, p.Time, p.Memory, p.Threads, keyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s", argon2.Version, p.Memory, p.Time, p.Threads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

var ErrBadHash = errors.New("รูปแบบแฮชไม่ถูกต้อง")

func parseHash(h string) (Params, []byte, []byte, error) {
	parts := strings.Split(h, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return Params{}, nil, nil, ErrBadHash
	}
	var ver int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &ver); err != nil || ver != argon2.Version {
		return Params{}, nil, nil, ErrBadHash
	}
	var p Params
	var th uint
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &p.Memory, &p.Time, &th); err != nil || th == 0 || th > 255 {
		return Params{}, nil, nil, ErrBadHash
	}
	p.Threads = uint8(th)
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return Params{}, nil, nil, ErrBadHash
	}
	key, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(key) == 0 {
		return Params{}, nil, nil, ErrBadHash
	}
	return p, salt, key, nil
}

// VerifyPassword ตรวจรหัสผ่านแบบเวลาคงที่ และบอกว่าควรแฮชใหม่ด้วยพารามิเตอร์ปัจจุบันหรือไม่
func VerifyPassword(pw, hash string, current Params) (ok bool, needsRehash bool) {
	p, salt, key, err := parseHash(hash)
	if err != nil {
		return false, false
	}
	// กัน DoS จากแฮชที่ถูกแก้ให้ใช้หน่วยความจำมหาศาล
	if p.Memory > 1<<20 || p.Time > 20 {
		return false, false
	}
	got := argon2.IDKey([]byte(pw), salt, p.Time, p.Memory, p.Threads, uint32(len(key)))
	if subtle.ConstantTimeCompare(got, key) != 1 {
		return false, false
	}
	return true, p != current
}

var dummyHash string
var dummyOnce sync.Once

// BurnTime ใช้เวลาเท่ากับการตรวจรหัสผ่านจริง เพื่อไม่ให้เดาได้ว่า username มีอยู่หรือไม่ (timing side-channel)
func BurnTime(pw string, p Params) {
	dummyOnce.Do(func() { dummyHash, _ = HashPassword("dummy-password", p) })
	VerifyPassword(pw, dummyHash, p)
}

// ---------- โทเคนเซสชัน ----------

// NewToken สร้างโทเคนสุ่ม 256 บิต: raw ส่งให้ผู้ใช้ (cookie) / hash เก็บในฐานข้อมูล
func NewToken() (raw string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err = rand.Read(b); err != nil {
		return "", nil, err
	}
	raw = base64.RawURLEncoding.EncodeToString(b)
	return raw, HashToken(raw), nil
}

func HashToken(raw string) []byte {
	h := sha256.Sum256([]byte(raw))
	return h[:]
}

// ---------- ตรวจรูปแบบอินพุต ----------

var usernameRe = regexp.MustCompile(`^[A-Za-z0-9_]{3,20}$`)

func ValidUsername(u string) bool { return usernameRe.MatchString(u) }

const (
	MinPasswordRunes = 8
	MaxPasswordBytes = 128
)

// ValidatePassword คืนข้อความอธิบายถ้าไม่ผ่าน ("" = ผ่าน)
func ValidatePassword(pw, username string) string {
	if utf8.RuneCountInString(pw) < MinPasswordRunes {
		return fmt.Sprintf("รหัสผ่านต้องยาวอย่างน้อย %d ตัวอักษร", MinPasswordRunes)
	}
	if len(pw) > MaxPasswordBytes {
		return fmt.Sprintf("รหัสผ่านยาวเกิน %d ไบต์", MaxPasswordBytes)
	}
	if strings.EqualFold(pw, username) {
		return "รหัสผ่านต้องไม่เหมือนชื่อผู้ใช้"
	}
	return ""
}

// ---------- จำกัดอัตรา ----------

// Limiter = token bucket ต่อคีย์ (เช่น IP หรือ ip+username) พร้อมล้างคีย์เก่าอัตโนมัติ
type Limiter struct {
	mu      sync.Mutex
	rate    float64 // โทเคนต่อวินาที
	burst   float64
	buckets map[string]*bucket
	lastGC  time.Time
	now     func() time.Time
}

type bucket struct {
	tokens float64
	last   time.Time
}

func NewLimiter(perMinute float64, burst int) *Limiter {
	return &Limiter{rate: perMinute / 60, burst: float64(burst), buckets: map[string]*bucket{}, now: time.Now}
}

// Allow ใช้ 1 โทเคน; false = เกินอัตรา
func (l *Limiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.burst, last: now}
		l.buckets[key] = b
	}
	b.tokens = minF(l.burst, b.tokens+now.Sub(b.last).Seconds()*l.rate)
	b.last = now
	if now.Sub(l.lastGC) > 5*time.Minute {
		l.lastGC = now
		for k, v := range l.buckets {
			if now.Sub(v.last) > 10*time.Minute {
				delete(l.buckets, k)
			}
		}
	}
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

func minF(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
