---
name: js-go-parity
description: แก้สูตร/กติกาที่มีทั้งฝั่ง JS (web/lab/src) และ Go (server/internal/sim) ให้ตรงกันทุกบิต — สูตรสเตตัส ดาเมจ ตัวจำลอง rules (use when editing stats/damage/sim formulas or any logic mirrored between JS and Go)
---

# js-go-parity — สูตรฝั่ง JS และ Go ต้องตรงกัน

JS เป็นต้นแบบของตัวจำลอง ส่วน Go (`server/internal/sim`) พอร์ตมาและ**เซิร์ฟเวอร์ใช้ Go เป็นตัวจริง**
ความตรงกันตรวจด้วย golden test (`server/internal/sim/testdata/golden.json` สร้างจากตัวจำลอง JS)

## ไฟล์ที่คู่กัน

| JS (`web/lab/src/`) | Go (`server/internal/`) |
|---|---|
| `03-rules.js` | `sim/rules.go` |
| `04-stats.js` (`calc`, `computeDerivedFromRaw`) | `sim/calc.go` |
| `05-sim.js` | `sim/engine.go` (+ `sim/state.go`, `sim/view.go`) |
| `05b-net-codec.js` | `protocol/` และ `web/lib/codec.ts` (3 ที่ต้องตรงกัน) |

## ขั้นตอนเมื่อแก้สูตร
1. แก้ฝั่ง JS ก่อน แล้วพอร์ตแบบเดียวกันไป Go (ลำดับการคำนวณทศนิยม, `jsRound`, `toFixed` ต้องเหมือนกัน — ดู `sim/num.go`)
2. **จำนวนที่เป็นกติกา/บาลานซ์ห้ามฝังในโค้ด** ให้อ่านจาก `formulaConfig`/`globals`/`rules` ใน DB (ดู skill `balance-config`)
3. **การใช้ตัวสุ่ม:** สุ่มเฉพาะเมื่อเงื่อนไขเป็นจริง (เช่น `chance > 0`) ทั้งสองฝั่งเหมือนกัน — ไม่งั้นลำดับสุ่มเพี้ยนและ golden ไม่ตรง
4. ถ้าเพิ่มสเตตัส/คีย์ใหม่: เพิ่ม `statDefs` + ค่าใน seed + struct ใน `gamedata/types.go` + `validate.go` ให้ครบ
5. หลังแก้ต้อง **สร้าง golden ใหม่แล้วให้ Go ผ่าน** — สองคำสั่งนี้คือ "การทดสอบ" จึงทำเฉพาะเมื่อผู้ใช้สั่ง:
   ```bash
   cd web && npm run lab:golden
   cd server && go test ./internal/sim
   ```
   ถ้าผู้ใช้ยังไม่สั่ง ให้จบงานด้วยข้อความว่า "แก้สูตรแล้ว ยังไม่ได้สร้าง golden/ทดสอบ — ต้องรัน 2 คำสั่งข้างบน"
6. อัปเดต `docs/FORMULAS.md` ถ้าสูตรเปลี่ยน

## ข้อห้าม
- ห้ามแก้ `golden.json` ด้วยมือ
- ห้ามแก้ Go ให้ "ผ่าน" โดยไม่ตรงกับ JS — ถ้าสองฝั่งต่างกันต้องหาว่าฝั่งไหนผิดแล้วแก้ให้ตรง
