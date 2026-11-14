// Package migrations ฝังไฟล์ SQL สำหรับสร้าง/อัปเกรดสคีมาฐานข้อมูล (เรียงตามชื่อไฟล์)
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
