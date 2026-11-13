package config

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strconv"
	"strings"
	"sync"
)

// ANSI สี — ใช้เฉพาะตอนเขียนลงเทอร์มินัลจริง (ไม่ใช้เมื่อ pipe ลงไฟล์ หรือตั้ง NO_COLOR)
const (
	cReset  = "\x1b[0m"
	cDim    = "\x1b[2m"
	cRed    = "\x1b[31m"
	cGreen  = "\x1b[32m"
	cYel    = "\x1b[33m"
	cBold   = "\x1b[1m"
	cCyan   = "\x1b[36m"
	cMag    = "\x1b[35m"
	cBlue   = "\x1b[94m"
	cOrange = "\x1b[38;5;208m"
)

// ColorEnabled บอกว่าควรแต่งสี log ไหม: stderr เป็นเทอร์มินัล และไม่ได้ตั้ง NO_COLOR (LOG_COLOR=1 = บังคับเปิด)
func ColorEnabled() bool {
	if os.Getenv("NO_COLOR") != "" {
		return false
	}
	if os.Getenv("LOG_COLOR") == "1" {
		return enableVT()
	}
	fi, err := os.Stderr.Stat()
	return err == nil && fi.Mode()&os.ModeCharDevice != 0 && enableVT()
}

// ColorHandler = slog.Handler สำหรับตอนพัฒนา: ข้อมูลชุดเดิม (time level msg key=value) แต่จัดเป็นคอลัมน์และแบ่งกลุ่มด้วย │
//
//	เวลา │ ระดับ │ ข้อความ │ key=value …
type ColorHandler struct {
	mu    *sync.Mutex
	w     io.Writer
	level slog.Level
	attrs []slog.Attr
	group string
}

func NewColorHandler(w io.Writer, level slog.Level) *ColorHandler {
	return &ColorHandler{mu: &sync.Mutex{}, w: w, level: level}
}

func (h *ColorHandler) Enabled(_ context.Context, l slog.Level) bool { return l >= h.level }

func (h *ColorHandler) WithAttrs(a []slog.Attr) slog.Handler {
	c := *h
	c.attrs = append(append([]slog.Attr{}, h.attrs...), a...)
	return &c
}

func (h *ColorHandler) WithGroup(name string) slog.Handler {
	c := *h
	if c.group != "" {
		c.group += "."
	}
	c.group += name
	return &c
}

const sep = cDim + " │ " + cReset

func (h *ColorHandler) Handle(_ context.Context, r slog.Record) error {
	vals := map[string]string{}
	var order []string
	add := func(a slog.Attr) {
		k := a.Key
		if h.group != "" {
			k = h.group + "." + k
		}
		v := fmt.Sprint(a.Value.Resolve().Any())
		if strings.ContainsAny(v, " \t\"") {
			v = strconv.Quote(v)
		}
		if _, ok := vals[k]; !ok {
			order = append(order, k)
		}
		vals[k] = v
	}
	for _, a := range h.attrs {
		add(a)
	}
	r.Attrs(func(a slog.Attr) bool { add(a); return true })

	lc, ln := cGreen, "INFO"
	switch {
	case r.Level >= slog.LevelError:
		lc, ln = cRed+cBold, "ERROR"
	case r.Level >= slog.LevelWarn:
		lc, ln = cYel, "WARN"
	case r.Level < slog.LevelInfo:
		lc, ln = cDim, "DEBUG"
	}

	var b strings.Builder
	b.WriteString(cDim + r.Time.Format("15:04:05") + cReset + sep)
	b.WriteString(lc + fmt.Sprintf("%-5s", ln) + cReset + sep)

	kv := func(k, pad string) {
		v, ok := vals[k]
		if !ok {
			return
		}
		delete(vals, k)
		b.WriteString(cDim + k + "=" + cReset)
		if k == "status" {
			sc := cGreen
			if n, _ := strconv.Atoi(v); n >= 500 {
				sc = cRed + cBold
			} else if n >= 400 {
				sc = cYel
			}
			v = sc + v + cReset
			pad = "" // รหัสสีทำให้ความยาวเพี้ยน — status ยาว 3 หลักเสมออยู่แล้ว
		} else if k == "err" {
			v = cRed + v + cReset
		} else {
			vc := cCyan // ค่าทั่วไปสีฟ้า
			switch k {
			case "method":
				vc = cMag + cBold
				if v == "GET" {
					vc = cMag
				}
			case "path":
				vc = cBlue
			case "ms": // เร็วเขียว / ช้าเหลือง / ช้ามากแดง
				vc = cGreen
				if n, _ := strconv.Atoi(v); n >= 500 {
					vc = cRed + cBold
				} else if n >= 100 {
					vc = cYel
				}
			case "ip":
				vc = cOrange
			}
			v = vc + v + cReset
		}
		b.WriteString(v)
		if pad != "" {
			if n := len(pad) - visibleLen(v); n > 0 {
				b.WriteString(strings.Repeat(" ", n))
			}
		}
		b.WriteString("  ")
	}

	if r.Message == "http" {
		// คำขอ HTTP: ข้อความคอลัมน์เดียวกันทุกบรรทัด; ฟิลด์เรียงเป็นกลุ่ม  method path │ status ms │ ip
		b.WriteString(cBold + "http" + cReset + "   ")
		b.WriteString(sep)
		kv("method", "      ")
		b.WriteString(sep)
		kv("path", strings.Repeat(" ", 28))
		b.WriteString(sep)
		kv("status", "")
		kv("ms", "     ")
		b.WriteString(sep)
		kv("ip", "")
	} else {
		b.WriteString(cBold + r.Message + cReset)
		if len(order) > 0 {
			b.WriteString(sep)
		}
	}
	for _, k := range order { // ฟิลด์ที่เหลือ (ตามลำดับที่ส่งมา)
		kv(k, "")
	}
	b.WriteString("\n")

	h.mu.Lock()
	defer h.mu.Unlock()
	_, err := io.WriteString(h.w, b.String())
	return err
}

// visibleLen นับความกว้างตัวอักษรโดยไม่รวมรหัสสี ANSI
func visibleLen(s string) int {
	n, in := 0, false
	for _, r := range s {
		switch {
		case r == '\x1b':
			in = true
		case in && r == 'm':
			in = false
		case !in:
			n++
		}
	}
	return n
}
