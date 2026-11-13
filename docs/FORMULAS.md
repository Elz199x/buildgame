# สูตรคำนวณของ Skill Lab

สูตรทั้งหมดอยู่ใน `web/lab/src/04-stats.js` (ฟังก์ชันล้วน) และ `05-sim.js` (เวลา/สถานะ) ค่าคงที่มาจาก `globals` (แก้ได้ในหน้า "ข้อมูล")
> สูตรของ **Status Lab** (สเตตัสพื้นฐาน, curve, อาวุธ ฯลฯ) อยู่ใน `docs/STATUS_LAB.md` — ที่นี่เป็นเฉพาะส่วนสกิล

## 1. สเตตัสสุดท้ายของผู้เล่น (`SL.calc.player`)

```
final[stat] = ( sheet[stat] + Σ flat ) × ( 1 + Σ passive% + min( Σ buff%, buffPercentCap[stat] ) )
```
- `sheet` = ค่าชีตของตัวละครทดสอบ (ก่อนคิดสกิล)
- `Σ flat` = effects แบบ `flat` จาก passive ที่ผ่านเงื่อนไขอาวุธ/โล่ + สถานะที่ติดอยู่ (buff/toggle/trigger)
- `passive%` / `buff%` = effects แบบ `percent` แยกตามที่มา: **passive ไม่ถูกจำกัด**, **% จากบัฟ** รวมกันแล้วถูกจำกัดที่ `globals.buffPercentCap[stat]` (ค่าเริ่มต้น `atk: 0.6`) — กันบัฟซ้อนจนแรงเกิน
- effect ที่ `appliesTo:'target'` **ไม่** นับกับผู้เล่น

การ clamp หลังคำนวณ:

| สเตตัส | ช่วง |
|---|---|
| `aspd` | 0 … `aspdCap` (193) |
| `physReduction` | 0 … `maxPhysReduction` (0.8) |
| `blockChance` | 0 … 1 |
| `damageTaken` | ≥ −0.9 |
| `maxHp` | ≥ 1 · `maxSp` ≥ 0 |
| `def mdef flee hit atk matk` | ≥ 0 |

**ความเร็วโจมตีแบบ RO:** `APS = max(0.1, 100 / (200 − min(ASPD,199)))` ครั้ง/วินาที (ช่วงห่าง = (200−ASPD)×0.01 วิ) — ASPD 120 → 1.25 · ASPD 150 → 2.0 · ASPD 193 → 14.3
> เคยใช้สูตรเส้นตรง ASPD/100 ผิด แก้ใน Status Lab V8 และ Skill Lab ใช้สูตรที่ถูกต้องตั้งแต่ต้น

## 2. สถานะบนมอนสเตอร์ (`SL.calc.monster`)

เริ่มจาก `def/mdef/flee/hit/atk/maxHp` ของมอนสเตอร์ แล้วรวม effects `appliesTo:'target'`: `flat` บวกตรง, `percent` รวมกันแล้วคูณ (เช่น ยั่วยุ: DEF −6%/Lv, ATK +4%/Lv) · `damageTaken` ของมอนสเตอร์ (ถ้ามี effect) คูณดาเมจที่ผู้เล่นทำ · ค่าติดลบถูกตัดที่ 0 · `interval` ขั้นต่ำ 0.2 วินาที

## 3. ดาเมจของผู้เล่น (`SL.calc.components` / `roll`)

ดาเมจดิบ: `raw = Σ ( mult(Lv) × stat )` ตาม `damage.terms` — การตีธรรมดา = `atk × 1.0` กายภาพ

### กายภาพ
```
effDef  = M.def × (1 − clamp(defPen, 0, 1))
red     = min( maxPhysReduction, effDef / (effDef + softDefK) )          // soft-DEF
normal  = raw × (1 − red)
crit    = raw × critMult                                                  // คริข้าม DEF
critChance = noCrit ? 0 : clamp(physCrit/100, 0, 1)
hitChance  = alwaysHit ? 1 : clamp(hitBase + (HIT − M.flee) × hitPerPoint, 0.05, 0.95)
```
### เวท
```
red     = min( maxMagicReduction, M.mdef / (M.mdef + softDefK) )
critRed = min( maxMagicReduction, M' / (M' + softDefK) ),   M' = M.mdef × (1 − clamp(mdefIgnore,0,1))
normal  = raw × (1 − red)
crit    = raw × ( critMult + critDmg ) × (1 − critRed)                  // คริเวทข้าม MDEF บางส่วน + โบนัสดาเมจ
critChance = noCrit ? 0 : clamp(magicCrit/100, 0, 1)
hitChance  = 1                                                           // เวทไม่พลาด
```
### รวม
```
normal, crit ← max(1, × (1 + M.damageTaken))
expected = critChance × crit + (1 − critChance) × hitChance × normal    // คริติคอลถือว่าโดนเสมอ
```
การทอยจริง (`roll`): ทอยคริก่อน → ถ้าไม่คริค่อยทอยโดน/พลาด → คูณความแปรปรวน `1 ± variance` (ค่าเริ่มต้น `opts.variance` = 0.08) → ปัดเศษ ขั้นต่ำ 1

## 4. มอนสเตอร์ตีผู้เล่น (`calc.monsterStrike`, เมื่อเปิด `monster.counter`)

```
hit chance = clamp( hitBase + (M.hit − FLEE) × hitPerPoint , max(0.05, 1 − maxDodge), 0.95 )
dmg = M.atk × (1 − min(maxPhysReduction, DEF/(DEF + softDefK))) × (1 − physReduction) × (1 + damageTaken)
ถ้าสวมโล่ และสุ่มได้ < blockChance:  dmg × (1 − blockReduction)       // 0.3
dmg ≥ 1
```
`calc.monsterDps` = ค่าคาดหวังต่อวินาที (ใช้โชว์ในแผง "สเตตัสสุดท้าย")

## 5. ตัวจำลอง (`05-sim.js`)

| หัวข้อ | กติกา |
|---|---|
| เวลา | tick 0.05 วิ; `act` นับถอยหลังถึงจังหวะ; หลังทำ 1 อย่าง `act += 1/APS` (ทำได้หลายครั้งต่อ tick ถ้า APS สูงมาก สูงสุด 8) |
| ใช้สกิลได้เมื่อ | เรียนแล้ว · อยู่ในสายคลาส · ผ่าน `weaponOk` · พ้นคูลดาวน์ · `SP ≥ ค่าใช้` · `HP > ค่า HP ที่ต้องจ่าย` · (ถ้ามีดาเมจ) มีเป้า |
| จ่ายค่าใช้ | หัก SP/HP → ตั้งคูลดาวน์ → ทำดาเมจ (AoE ทอยต่อจำนวนเป้า) → ฟื้นฟู (`pctMaxHp × maxHp + flat`, ไม่เกิน HP เต็ม) → ติดสถานะ (ถ้า `effects` ไม่ว่าง และ `duration > 0`; toggle ติดไม่มีหมดเวลา) |
| สถานะซ้ำ | id เดียวกัน หรือ `group` เดียวกัน = แทนที่ (ต่อผู้ถือ) |
| Toggle | ดูด `hpDrain × maxHp` และ `spDrain` ต่อวินาที; ปิดอัตโนมัติเมื่อ `HP/maxHP < toggleOff.hpBelow` หรือ SP < 0 |
| Trigger | ไม่ติดอยู่ + พ้นคูลดาวน์ + `HP/maxHP ≤ hpBelow` → ติด (คูลดาวน์เริ่มตอนติด); ติดอยู่ + `HP/maxHP > hpAbove` → ปิด |
| Regen | ทุก tick `+hpRegen×dt`, `+spRegen×dt` (ใช้ค่าสเตตัสสุดท้าย) |
| ตาย/ฟื้น | HP ≤ 0 → ล้ม, ล้างสถานะ/คูลดาวน์/คิว, นับ `reviveDelay` แล้วฟื้นเต็ม HP/SP |
| มอนสเตอร์ตาย | `respawnDelay` วินาทีแล้วเกิดใหม่ (ล้างสถานะบนมอนสเตอร์) · ถ้าเป้านิ่งอมตะ = HP เต็มทันที |
| ลำดับสกิลอัตโนมัติ | คิวสั่งมือ → กฎ `rotation` ทีละข้อ (เงื่อนไข SP/HP%, `skipIfActive`) → ตีธรรมดา · `defaultRotation`: บัฟ/toggle → ดีบัฟ → สกิลดาเมจ (ค่า mult รวมสูงสุดก่อน) → ฟื้นฟู (ใช้เมื่อ HP ≤ 70%) |

## 6. ตัวเลขอ้างอิงที่ใช้ตอนออกแบบ (นักดาบ Lv50 ดาบ 1 มือ)

ATK 40 · HIT 90 · FLEE 88 · ASPD 120 (1.25 ครั้ง/วิ) · HP 1904 · SP 384 · regen HP 1.5/วิ, SP 1.5/วิ · DEF 14.4 — ดูเหตุผลการปรับตัวเลขใน `docs/BALANCE_NOTES.md`
