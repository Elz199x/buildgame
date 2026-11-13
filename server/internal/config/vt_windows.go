//go:build windows

package config

import (
	"os"
	"syscall"
)

// enableVT เปิด ANSI escape ในคอนโซล Windows (ENABLE_VIRTUAL_TERMINAL_PROCESSING) — เทอร์มินัลรุ่นใหม่เปิดให้แล้ว ตัวนี้กันกรณีคอนโซลเก่า
func enableVT() bool {
	k := syscall.NewLazyDLL("kernel32.dll")
	get, set := k.NewProc("GetConsoleMode"), k.NewProc("SetConsoleMode")
	h := os.Stderr.Fd()
	var mode uint32
	if r, _, _ := get.Call(h, uintptr(unsafePtr(&mode))); r == 0 {
		return true // ไม่ใช่คอนโซล (เช่น Windows Terminal ผ่าน pty) — ถือว่ารองรับ
	}
	r, _, _ := set.Call(h, uintptr(mode|0x0004))
	return r != 0
}
