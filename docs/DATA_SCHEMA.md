# โครงสร้างข้อมูล (Data Schema)

ข้อมูลทั้งหมดของ Skill Lab เป็น JSON ล้วน เก็บเป็นอ็อบเจ็กต์เดียว (`SL.store.get()`) ที่มี 9 ส่วน นิยามเริ่มต้นอยู่ที่ `skill-lab/src/01-defaults.js`
ฟิลด์ที่ไม่ใส่ จะถูกเติมค่าเริ่มต้นโดย `normalizeData/normalizeSkill` ใน `02-store.js` (ระบุสกิลแบบย่อได้ เช่น `{id, class, name, effects:[{stat:'atk', value:1}]}`)

```jsonc
{
  "version": 1,
  "classes":  [ ... ], "branches": [ ... ], "skills": [ ... ],
  "weapons":  [ ... ], "statDefs": [ ... ], "presets": [ ... ],
  "monsters": [ ... ], "builds":   [ ... ], "globals": { ... }
}
```

## 1. ค่าที่ขยายตามเลเวลได้ (Scalable value, เรียกว่า **S**)

ฟิลด์ตัวเลขที่เปลี่ยนตามเลเวลสกิลใช้ S เสมอ (`usage.*`, `damage.terms[].mult`, `effects[].value`, `heal.*`) มี 3 รูปแบบ — คำนวณด้วย `SL.util.val(S, lv)`:

| รูปแบบ | ตัวอย่าง | ความหมาย |
|---|---|---|
| ตัวเลข | `0.04` | คงที่ทุกเลเวล |
| เส้นตรง | `{"base":1.3,"step":0.3}` | `base + step × (Lv−1)` → Lv1=1.3, Lv10=4.0 |
| ตาราง | `{"table":[6,6,7,7,8,8,9,9,10,10]}` | ระบุทุกเลเวล (เกินความยาวใช้ค่าสุดท้าย) |

ตัวช่วย "ต่อเลเวล" `lin(v)` = `{base:v, step:v}` (Lv1 = v, Lv2 = 2v, …) ใช้ใน defaults · ในตัวแก้ไขมีวิดเจ็ต 3 โหมด (คงที่ / ต่อเลเวล / ตาราง) พร้อมพรีวิวค่าทุกเลเวล

## 2. `classes`

```json
{ "id":"swordman", "name":"นักดาบ", "parent":"novice", "jobLvCap":50, "pointsPerJobLv":1, "desc":"..." }
```

| ฟิลด์ | ความหมาย |
|---|---|
| `parent` | คลาสแม่ (สายอาชีพ) — `""` = คลาสเริ่มต้น; สายลูกโซ่เกิดจาก parent ต่อกัน (`rules.chain`) |
| `jobLvCap` | Job Lv สูงสุดของคลาสนั้น |
| `pointsPerJobLv` | แต้มสกิลที่ได้ต่อ Job Lv ที่เพิ่ม |

**งบแต้ม:** คลาสบรรพบุรุษถือว่า "จบแล้ว" ได้แต้ม `(jobLvCap−1)×pointsPerJobLv` เต็ม; คลาสปัจจุบันได้ `(jobLv−1)×pointsPerJobLv`; สกิลใช้แต้มจากกองของคลาสตัวเอง สกิลติดตัวข้ามคลาส (เปลี่ยนอาชีพแล้วสกิลคลาสก่อนหน้ายังอยู่)

## 3. `branches` (สาย = คอลัมน์ในกราฟ)

```json
{ "id":"sw_strike", "class":"swordman", "name":"สายดาบ" }
```

## 4. `skills`

```jsonc
{
  // ตัวอย่างรวมทุกฟิลด์ (ไม่ใช่สกิลจริงตัวเดียว — ค่าจริงดู docs/SKILL_TABLES.md)
  "id": "swMagnum", "class": "swordman", "name": "ระเบิดคลื่นดาบ", "desc": "...",
  "type": "active",              // passive | active | buff | toggle | trigger
  "branch": "sw_strike", "tier": 3, "jobLvReq": 25, "maxLevel": 5,
  "requires": [ { "id": "swBash", "lv": 5 }, { "id": "swProvoke", "lv": 2 } ],   // ต้องมีครบทุกข้อ (AND) — "การเชื่อมต่อ"
  "weaponReq": { "slotType": "", "damageType": "", "include": [], "exclude": ["staff"] },
  "needShield": false,
  "usage":  { "sp": {...S}, "hp": 0.04, "cooldown": 3, "duration": 8, "hpDrain": 0.003, "spDrain": 0, "usesAction": true },
  "damage": { "kind": "physical", "terms": [ { "stat": "atk", "mult": {"base":1.3,"step":0.3} } ], "noCrit": false, "alwaysHit": false, "aoe": false },
  "heal":   { "pctMaxHp": {...S}, "flat": {...S} },   // หรือ null
  "effects":[ { "stat": "atk", "mode": "percent", "appliesTo": "self", "value": {...S} } ],
  "group": "stance",
  "trigger":   { "hpBelow": 0.25, "hpAbove": 0.5, "cooldown": 90 },   // เฉพาะ type: trigger
  "toggleOff": { "hpBelow": 0.15 },                                    // เฉพาะ type: toggle
  "hooks": { "knockback": 2 }                                          // อิสระ เก็บไว้สำหรับระบบอนาคต
}
```

### 4.1 ชนิดสกิล (`type`)

| type | พฤติกรรม |
|---|---|
| `passive` | ได้ผลตลอดเมื่อเรียนแล้วและผ่านเงื่อนไขอาวุธ/โล่ (`effects` ใช้กับตัวเอง) |
| `active` | กดใช้ (หรือเข้าลำดับอัตโนมัติ): จ่าย SP/HP, ตั้งคูลดาวน์, ทำดาเมจ/ฟื้นฟู, และติดสถานะ (ถ้ามี `effects` + `usage.duration > 0`) |
| `buff` | เหมือน active แต่ปกติไม่มีดาเมจ; ผลติดตัวตาม `duration` |
| `toggle` | สลับเปิด/ปิด จ่าย SP ตอนเปิด ดูด `hpDrain` (เศษส่วน HP สูงสุด/วิ) และ `spDrain` (SP/วิ); ปิดเองเมื่อ HP < `toggleOff.hpBelow` หรือ SP หมด; ไม่เสียจังหวะตี |
| `trigger` | ทำงานเอง: เปิดเมื่อ HP ≤ `trigger.hpBelow` (และคูลดาวน์พร้อม) ปิดเมื่อ HP > `trigger.hpAbove` หรือหมด `usage.duration` (ถ้ากำหนด) |

### 4.2 `effects[]` (ผลต่อสเตตัส)

| ฟิลด์ | ค่า | ความหมาย |
|---|---|---|
| `stat` | รหัสใน `statDefs` | สเตตัสที่กระทบ (ไม่มีนิยาม = validator แจ้ง error) |
| `mode` | `flat` / `percent` | `flat` = บวกตรง ๆ ก่อนคูณ · `percent` = **เศษส่วน** (0.03 = +3%) รวมกันแล้วคูณทั้งก้อน (ค่าติดลบได้ เช่น −0.06) |
| `appliesTo` | `self` / `target` | `target` = ลงบนมอนสเตอร์ (เช่น ยั่วยุ ลด DEF เป้า) — มีผลเฉพาะ DEF/MDEF/FLEE/HIT/ATK/maxHp/damageTaken ของมอนสเตอร์ |
| `value` | S | ค่าต่อเลเวล |

สำหรับสเตตัส `kind:"frac"` (เช่น `blockChance`, `physReduction`, `damageTaken`) ค่า flat เป็นเศษส่วน (0.05 = 5%) · `kind:"pct"` (เช่น `physCrit`) ค่า flat เป็นจุด % (1 = +1%)

### 4.3 `usage` (ค่าใช้งาน; ทุกตัวเป็น S; ไม่ใส่ = 0)

`sp` · `hp` (เศษส่วนของ HP สูงสุดที่จ่ายตอนใช้; ต้องมี HP เหลือมากกว่านั้น) · `cooldown` (วินาที) · `duration` (วินาทีของสถานะ) · `hpDrain` / `spDrain` (ต่อวินาที เฉพาะ toggle) · `usesAction` (boolean; ค่าเริ่มต้น `true` ยกเว้น toggle = `false`)

### 4.4 `damage`

| ฟิลด์ | ความหมาย |
|---|---|
| `kind` | `""` ไม่มีดาเมจ · `physical` (คิด DEF/HIT/FLEE) · `magic` (คิด MDEF, ไม่พลาด) |
| `terms[]` | `{stat, mult:S}` — ดาเมจดิบ = Σ (`mult` × ค่าสเตตัสผู้เล่น) เช่น `atk×1.3` หรือ `atk×1.1 + def×(0.8+0.3/Lv)` |
| `noCrit` / `alwaysHit` / `aoe` | ห้ามคริ / โดนเสมอ / ระยะกว้าง (คูณด้วยจำนวนเป้า `opts.aoeTargets`) |

### 4.5 `weaponReq` และ `needShield`

เงื่อนไขอาวุธ (ใช้ทั้ง passive และการกดใช้สกิล) — ตรวจด้วย `rules.weaponOk`:
`slotType` ('1H'/'2H') · `damageType` (slash/blunt/pierce/magic ตาม `weapons`) · `include[]` (ต้องเป็น `weaponClass` ใดใดหนึ่ง) · `exclude[]` (ห้ามเป็น) · `needShield` = ต้องสวมโล่ **และ** อาวุธ 1 มือ

### 4.6 `group` (กลุ่มสถานะ)

สถานะที่มี `group` เดียวกันบนผู้ถือเดียวกัน **แทนที่กัน** (เช่น `stance`, `guard`, `provoke`) ใช้กันบัฟซ้อน

### 4.7 `hooks`

อ็อบเจ็กต์อิสระ ตอนนี้ระบบจำลองยังไม่อ่าน (เก็บ/ส่งออกให้) — จุดต่อสำหรับ stun, knockback, partyShare ฯลฯ ดู `docs/EXTENDING.md` หัวข้อ "เพิ่มกลไกใหม่"

### 4.8 การตรวจสอบ (`rules.validate`)

| ระดับ | กรณี |
|---|---|
| error | id ซ้ำ · ไม่พบคลาส · parent ไม่มี/วนเป็นวง · `requires` อ้างสกิลไม่มี/อ้างตัวเอง/ต้องการเลเวลเกิน max · เงื่อนไขวนเป็นวงกลม · `effects`/`terms` อ้างสเตตัสที่ไม่มี · `trigger` ไม่มีเงื่อนไข |
| warn | สายไม่ตรงคลาส · `jobLvReq` เกิน `jobLvCap` (เรียนไม่ได้) · เงื่อนไขปลดล็อกหลังตัวสกิลเอง · เงื่อนไขมาจากคลาสนอกสาย · มีชนิดดาเมจแต่ไม่มี terms · active ที่ไม่ทำอะไร · มี effect แต่ไม่มี `duration` · toggle/passive ที่ไม่มี effect |
| info | สรุปงบแต้มต่อคลาส (จำนวนเลเวลรวมเทียบแต้ม) |

## 5. `weapons`

```json
{ "id":"sword_2h", "name":"ดาบ 2 มือ", "slotType":"2H", "damageType":"slash", "weaponClass":"sword" }
```
ใน Skill Lab อาวุธมีไว้ **ตรวจเงื่อนไขสกิล** เท่านั้น (ATK/ASPD ของอาวุธอยู่ในชีตสเตตัส) ต่างจาก Status Lab ที่คำนวณจากสูตรอาวุธ

## 6. `statDefs`

```json
{ "id":"physCrit", "name":"Phys Crit %", "group":"โจมตี", "kind":"pct" }
```
`kind`: `num` ตัวเลขปกติ · `frac` เศษส่วน (0.05 = 5%) · `pct` หน่วยเป็น % อยู่แล้ว (7 = 7%) — ใช้กำหนดวิธีแสดงผลและสเกลของช่องกรอก · รหัสเริ่มต้น 25 ตัว: `str agi vit int dex luk atk matk hit aspd physCrit magicCrit mdefIgnore critDmg defPen def mdef flee blockChance physReduction damageTaken maxHp maxSp hpRegen spRegen`
สเตตัสใหม่: เพิ่มใน `statDefs` + ใส่ค่า (ถ้าไม่ใส่ = 0) ในชีตของ preset → ใช้ใน `effects`/`terms` ได้ทันที (ถ้าจะให้ "มีความหมาย" ในสูตร ต้องแก้ `04-stats.js`)

## 7. `presets` (ชุดสเตตัสสำเร็จรูป)

```json
{ "id":"sw50_1h", "name":"...", "weaponId":"sword_1h", "hasShield":false, "sheet": { "str":40, "atk":40, "aspd":120, "maxHp":1904, "...": 0 } }
```
`sheet` = ค่าสเตตัส "ก่อนคิดสกิล" (ของจริงมาจาก Status Lab) — passive/บัฟจะบวกทับตอนคำนวณ (`SL.calc.player`)

## 8. `monsters`, `builds`, `globals`

```json
{ "id":"dummy", "name":"ดัมมี่ธรรมดา", "def":40, "mdef":30, "flee":60, "maxHp":20000, "atk":80, "hit":100, "interval":2.0 }
{ "id":"bld_striker", "name":"...", "classId":"swordman", "jobLv":50, "presetId":"sw50_2h", "learned": { "swBash":10, "...": 0 } }
```

`globals` (แก้ได้ในหน้า "ข้อมูล"): `aspdCap` 193 · `softDefK` 300 · `maxPhysReduction` 0.8 · `maxMagicReduction` 0.8 · `maxDodge` 0.6 · `critMult` 1.5 · `blockReduction` 0.3 · `hitBase` 0.5 · `hitPerPoint` 0.01 · `respawnDelay` 1.2 · `reviveDelay` 2.0 · `buffPercentCap` `{ "atk": 0.6 }` (เพดานรวมของ **% ที่มาจากบัฟชั่วคราว** ต่อสเตตัส; passive ไม่ถูกจำกัด)

## 9. state ของตัวละครทดสอบ (`SL.state.get()`)

```jsonc
{
  "classId": "swordman", "jobLv": 50,
  "learned": { "swBash": 10, "...": 0 },                 // เลเวลสกิลที่ลง
  "presetId": "sw50_2h", "weaponId": "sword_2h", "hasShield": false,
  "sheet": { "str": 40, "...": 0 },                       // ค่าสเตตัสก่อนคิดสกิล
  "monsterPresetId": "dummy",
  "monster": { "def": 40, "mdef": 30, "flee": 60, "maxHp": 20000, "atk": 80, "hit": 100, "interval": 2, "counter": false },
  "rotation": [ { "id": "swBash", "minSpPct": 0, "minHpPct": 0, "maxHpPct": 1, "skipIfActive": true } ],
  "opts": { "auto": true, "speed": 1, "benchSeconds": 60, "immortal": false, "aoeTargets": 1, "variance": 0.08 }
}
```
`rotation` = กฎเลือกสกิลอัตโนมัติ เรียงลำดับความสำคัญ: `minSpPct`/`minHpPct`/`maxHpPct` เป็นเศษส่วน 0–1 · `skipIfActive` ไม่ใช้ซ้ำถ้าสถานะยังติด (ใช้เฉพาะสกิลที่ไม่มีดาเมจ)

## 10. รูปแบบ JSON สำหรับนำเข้า/รวม (หน้า "ข้อมูล")

- **แทนที่ทั้งหมด:** วาง JSON ที่ส่งออกมา (ต้องมีอาเรย์ `skills`)
- **รวมเข้า (merge):** วางได้ 3 แบบ — (1) สกิลเดียว `{ "id":..., "type":... }` (2) อาเรย์ของสกิล (3) ชุดบางส่วน `{ "classes":[...], "branches":[...], "skills":[...] }` · แต่ละรายการที่ `id` ตรงกับของเดิมจะ **แทนที่**, ที่ไม่มีจะ **เพิ่ม** (รองรับคอลเลกชัน classes/branches/skills/weapons/statDefs/presets/monsters/builds)
