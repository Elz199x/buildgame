---
name: run-checks
description: รันชุดตรวจสอบทั้งโปรเจกต์ (gofmt, go vet, go test, lab:test, typecheck) แล้วสรุปผล — ใช้เฉพาะเมื่อผู้ใช้สั่งให้ test/ตรวจ/verify เท่านั้น (run all tests and checks, only when the user explicitly asks)
disable-model-invocation: true
---

# run-checks — รันเทสต์ทั้งโปรเจกต์ (เฉพาะเมื่อผู้ใช้สั่ง)

สกิลนี้เรียกได้โดยผู้ใช้เท่านั้น (`/run-checks`) — **ห้ามเรียกเองเมื่อผู้ใช้ยังไม่ได้ขอให้ทดสอบ** (กฎใน `CLAUDE.md`)

## ขั้นตอน (รันตามลำดับ หยุดเมื่อมีขั้นที่ล้มเหลว แล้วรายงานผลจริง)

1. **Go** (ที่ `server/`)
   ```bash
   gofmt -l ./internal ./cmd          # ต้องไม่มีไฟล์ที่ถูกแสดง
   go vet ./...
   go test ./internal/...             # เทสต์ที่ใช้ Postgres ใช้ storetest (ดู server/README.md)
   ```
2. **JS** (ที่ `web/`)
   ```bash
   npm run lab:test                   # ต้องขึ้น ALL CHECKS PASSED
   npm run typecheck
   ```
3. **เพิ่มเติมเมื่อผู้ใช้ขอ**
   - `npm run lab:golden` แล้วรัน `go test ./internal/sim` ซ้ำ (หลังแก้สูตร — ดู skill `js-go-parity`)
   - `npm run build` (ตรวจว่า Next build ผ่าน)

## การรายงาน
- บอกผลของแต่ละคำสั่งตามจริง (ผ่าน/ล้ม + ข้อความ error ที่เกี่ยวข้อง) ห้ามสรุปว่า "ผ่าน" ถ้าไม่ได้รัน
- ถ้าขั้นไหนข้าม (เช่น ไม่มี Postgres สำหรับเทสต์) ให้บอกว่าข้ามเพราะอะไร
- ห้ามแก้โค้ดเพื่อให้เทสต์ผ่านโดยไม่บอกผู้ใช้ — ถ้าเทสต์ล้ม ให้รายงานสาเหตุแล้วถามก่อนแก้ ยกเว้นผู้ใช้สั่งให้แก้
