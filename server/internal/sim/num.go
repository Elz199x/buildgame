// Package sim คือตัวจำลองสกิล/สเตตัส/การต่อสู้ — พอร์ตจาก web/lab/src/03-rules.js, 04-stats.js, 05-sim.js
// เพื่อให้เซิร์ฟเวอร์ Go เป็นเจ้าของสูตรทั้งหมด (authoritative) ผลลัพธ์ตรงกับ JS ทุกบิต
// (ตรวจด้วยชุดทดสอบ golden ที่สร้างจาก JS: web/lab/tools/gen-golden.js)
package sim

import (
	"bytes"
	"encoding/json"
	"math"
	"math/big"
	"strconv"
)

// Num = ตัวเลขที่ยอมรับ JSON number/string/bool/null แบบเดียวกับ Number(x)||0 ใน JS
type Num float64

func (n *Num) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	*n = 0
	if len(b) == 0 {
		return nil
	}
	switch b[0] {
	case 'n': // null
		return nil
	case 't':
		*n = 1
		return nil
	case 'f':
		return nil
	case '"':
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return nil
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
			*n = Num(f)
		}
		return nil
	case '{', '[':
		return nil // Number({}) / Number([...]) ≈ NaN → 0
	}
	var f float64
	if err := json.Unmarshal(b, &f); err == nil && !math.IsNaN(f) && !math.IsInf(f, 0) {
		*n = Num(f)
	}
	return nil
}

func (n Num) F() float64 { return float64(n) }

func clamp(x, a, b float64) float64 { return math.Max(a, math.Min(b, x)) }

// jsRound เทียบเท่า Math.round (ปัดครึ่งขึ้นเสมอ)
func jsRound(x float64) float64 { return math.Floor(x + 0.5) }

// toFixed เทียบเท่า +(x).toFixed(d) ของ JS (ตัดสินด้วยค่าทศนิยมที่แท้จริงของ float; ครึ่งพอดีปัดขึ้น)
func toFixed(x float64, d int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	neg := x < 0
	if neg {
		x = -x
	}
	r := new(big.Rat)
	r.SetFloat64(x)
	scale := new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(d)), nil))
	r.Mul(r, scale)
	r.Add(r, big.NewRat(1, 2))
	q := new(big.Int).Div(r.Num(), r.Denom()) // floor
	res := new(big.Rat).Quo(new(big.Rat).SetInt(q), scale)
	f, _ := res.Float64()
	if neg {
		f = -f
	}
	return f
}

// mulberry32: เหมือน JS ทุกบิต (seed เดียวกัน ได้ลำดับสุ่มเดียวกัน)
type RNG struct{ a uint32 }

func NewRNG(seed int64) *RNG { return &RNG{a: uint32(int32(seed))} }

func (r *RNG) Float() float64 {
	r.a += 0x6D2B79F5
	a := r.a
	t := (a ^ (a >> 15)) * (1 | a)
	t = (t + (t^(t>>7))*(61|t)) ^ t
	return float64(t^(t>>14)) / 4294967296
}
