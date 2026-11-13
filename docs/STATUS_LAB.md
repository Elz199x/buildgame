> **เลิกใช้แล้ว:** `status-lab/` ถูกลบออก สูตรด้านล่างย้ายไปอยู่ใน `web/lab/src/04-stats.js` + `formulaConfig` (ครบทุกสูตรสเตตัส; castReduction, Double Attack, Autospell cap/efficiency ย้ายมาเป็นสเตตัส `castReduction`/`doubleAttack`/`autospellChance`) · ส่วน Combat Engine/Passive tree 24 ตัว/Mitigation ของเครื่องมือเดิมไม่ได้ย้าย (เกมใช้ระบบสกิลและตัวจำลองของ Skill Lab แทน) เอกสารนี้เก็บไว้อ้างอิงประวัติเท่านั้น

# RO Status Lab — คู่มือเทคนิค

ไฟล์: `status-lab/ro-status-lab.html` (V8, ไฟล์เดียว เปิดได้เลยด้วยเบราว์เซอร์) · ค่าเริ่มต้นของ CONFIG แยกให้อ่านง่ายที่ `status-lab/default-config.json`

โครงสร้างหลัก: **CONFIG ก้อนเดียว** (อ่านจากแท็บ "ตั้งค่าสูตร (Backend)" แก้ได้ทุกค่า) → ห้องทดลอง (แท็บ "ห้องทดลอง") อ่าน CONFIG นั้นคำนวณสเตตัส/ดาเมจ · บันทึกลง localStorage คีย์ `roStatusLabConfig_v1` (best-effort ใน try/catch) · `mergeMissingKeys` เติมคีย์ใหม่จาก DEFAULT_CONFIG ให้ข้อมูลเก่าที่บันทึกไว้โดยไม่เขียนทับของผู้ใช้

## 1. CONFIG — หมวดหมู่

| หมวด | หน้าที่ | ค่าเริ่มต้นสำคัญ |
|---|---|---|
| `statusPointSystem` | ระบบแต้มสเตตัสแบบ RO | `startPoints 48`, `levelUpOffset 9`, `levelUpDivisor 4`, `statCap 99` |
| `baseConstants` | ค่าคงที่ที่แปลงสเตตัส → สเตตัสย่อย | ดูข้อ 3 |
| `statCurve` | diminishing returns แยกต่อสเตตัส | breakpoints `[50,100]`, slopes `[1, 0.7, 0.4]` (AGI `0.65/0.35`, VIT `0.75/0.45`, LUK `0.8/0.5`) |
| `classes` | สัมประสิทธิ์ HP/SP ของอาชีพ | novice 1/1 · นักดาบ 1.4/0.6 · โจร 1.1/0.9 · นักธนู 1/1 · จอมเวท 0.6/1.4 |
| `weapons` | โปรไฟล์อาวุธ 8 แบบ | ดูข้อ 4 |
| `shieldProfile` | โล่ | `aspdOffset −5`, `blockChance 0.15`, `defFlat 15` |
| `magicCrit` | คริติคอลของเวท (Triad: LUK→โอกาส, DEX→เจาะ MDEF, INT→ดาเมจ) | chance `lukScalar 0.45` · mdefIgnore `base 0.5 + dex×0.002 cap 0.7` · critDmg `base 0.1 + int×0.0008 cap 0.25` |
| `mitigation` | ลดดาเมจ | `maxDodgeChance 0.6`, `maxPhysicalReduction 0.8`, `maxMagicReduction 0.8`, `softDefK 300` |
| `autospellGlobal` | เพดานโอกาส autospell รวม | `maxCombinedTriggerChance 0.30` |
| `passives` | Passive Skill Tree 24 ตัว | ดูข้อ 5 |

## 2. ระบบแต้มสเตตัส
- แต้มเริ่ม 48 · ได้เพิ่มต่อเลเวล `floor((level + levelUpOffset) / levelUpDivisor)` (ค่าเริ่มต้นออกแบบให้ตรงกับ Lv.49 ของ RO)
- ค่ากดเพิ่ม 1 แต้มของสเตตัสปัจจุบัน `current`: `floor(current / 10) + 1` (`costForNextStatPoint`)
- เพดานสเตตัสดิบ 99 (`statCap`) · ปุ่ม +/− รองรับกดค้างเพื่อเร่ง (Pointer Events) · มีปุ่มรีเซ็ต

## 3. สูตรสเตตัสย่อย (`computeDerived`)
`eff[stat] = applyCurve(raw[stat])` — curve หลายช่วง: ช่วง 0–50 ใช้ slope 1.0, 50–100 ใช้ 0.7, เกิน 100 ใช้ 0.4 (ค่า default ของ STR)

```
atk   = eff[weapon.atk.stat]×coeff (+ eff[stat2]×coeff2) + Σ atkFlat
aspd  = min( aspdBase 100 + eff.agi×0.4 + eff.dex×0.1 + weapon.aspdOffset + shield(−5) + Σ aspdFlat , aspdCap 193 )
APS   = max(0.1, 100 / (200 − min(aspd, 199)))              // ครั้ง/วิ  (V8 แก้จากเส้นตรง)
hit   = 50 + eff.dex×1 + Σ hitFlat + weapon.hitBonus − weapon.hitPenalty
flee  = 50 + eff.agi×0.8 + eff.luk×0.3 + Σ fleeFlat
physCrit = 1 + eff.luk×0.3 + weapon.critBonus + Σ critFlat
matk  = eff.int×2.5 × (1 + Σ matkPercent + weapon.matkPercent)
hp    = round( (eff.vit×12 + level×20) × class.hpCoef × (1 + Σ hpPercent) )
sp    = round( (eff.int×8  + level×8 ) × class.spCoef × (1 + Σ spPercent) )
def   = ( eff.vit×0.5 + shield.defFlat ) × (1 − tension) + Σ defFlat     // tension = min(0.25, max(0, aspd−100)×0.002)
mdef  = eff.int×0.5 + Σ mdefFlat
hpRegen = eff.vit×0.05 + Σ hpRegenFlat
castReduction = min(100, eff.dex×0.15 + weapon.castBonus×100 + Σ castFlat×100)
magicCritChance = chance.base + eff.luk×critPerLuk(0.3)×lukScalar(0.45) + Σ magicCritChanceFlat
mdefIgnore = min(cap, base + eff.dex×dexScalar + Σ mdefIgnoreFlat)
critDamageBonus = min(cap, base + eff.int×intScalar + Σ critDamageBonusFlat)
```
`tension` = ตีเร็วมาก → DEF ลดลงได้สูงสุด 25% (กัน AGI-only ที่ทั้งตีเร็วและทน)

## 4. อาวุธ (8 โปรไฟล์)

| id | slot | damageType | ATK | ASPD offset | หมายเหตุ |
|---|---|---|---|---|---|
| unarmed | 1H | blunt | STR×0.5 | 0 | |
| sword_1h | 1H | slash | STR×1.0 | 0 | ใช้โล่ได้ · affinity นักดาบ |
| sword_2h | 2H | slash | STR×1.4 | −15 | ล็อกมือรอง |
| axe | 1H | slash | STR×1.1 | −8 | |
| mace | 1H | blunt | STR×0.8 + VIT×0.3 | 0 | |
| dagger | 1H | pierce | AGI×0.7 + LUK×0.3 | +20 | ตีไว |
| bow | 2H | pierce | DEX×1.0 | +5 | |
| staff | 2H | magic | STR×0.1 | 0 | `autospellEfficiency 0.4` |

ทุกอาวุธมี `special` (critBonusFlat, hitBonusFlat, hitPenalty, defPenetrationPercent, hpRegenOnHitPercent, matkPercent, castReductionBonus), `autospellEfficiency` และ `affinity[]`

## 5. Passive Skill Tree (24 ตัว)
โครงสร้าง `{id, name, classId('any'|class), tier, maxLevel, requires:{passiveId, minLevel}, effects:[{target, perLevel, weaponClassOnly, excludeWeaponClass}]}`
`applyPassive`: ข้าม effect ที่ไม่ตรงอาวุธ แล้ว `st[target] += level × perLevel` — `target` ที่รองรับ: `atkFlat hitFlat fleeFlat critFlat aspdFlat defFlat mdefFlat hpPercent matkPercent spPercent hpRegenFlat castReductionFlat doubleAttackChance passiveAutospellChance magicCritChanceFlat mdefIgnoreFlat critDamageBonusFlat`

| คลาส | T1 | T2 (ต้อง T1 Lv3) | T3 capstone (3 เลเวล, ต้อง T2 Lv3) |
|---|---|---|---|
| any | vitalityTraining(HP%+2/Lv), battleAwareness(HIT/FLEE+2), steadyBreathing(HP regen+0.03, SP%+2) | autospellCatalyst(โอกาส autospell +1.5%/Lv) | — |
| นักดาบ | swWeaponMastery(ATK+5), swToughness(DEF+2) | swProvokeStance(CRIT+1), swShieldDiscipline(DEF+3) | swBerserkerSoul(ATK+12) |
| โจร | thBladeMastery(ATK+4), thAgilityTraining(ASPD+2) | thDoubleAttack(+4%/Lv เฉพาะกริช), thEvasion(FLEE+4) | thShadowStrike(CRIT+3) |
| นักธนู | arBowMastery(ATK+4), arEagleEye(HIT+3) | arRapidFire(ASPD+3), arSharpshooter(CRIT+2) | arHuntersInstinct(ATK+8) |
| จอมเวท | mgSpellMastery(MATK%+3), mgManaTraining(SP%+4) | mgArcaneFocus(magicCrit+1.2), mgInsight(mdefIgnore+0.02) | mgArchmageWisdom(critDmg+0.03) |

> ATK flat ของ passive ใช้ `excludeWeaponClass:'staff'` (ไม้เท้าไม่ได้โบนัสกายภาพ)
> **ความต่างกับ Skill Lab:** Status Lab ใช้ `swBerserkerSoul` +12/Lv แต่ Skill Lab ปรับ `swSoul` เหลือ +9/Lv หลังตรวจ balance (ดู `BALANCE_NOTES.md` ข้อ 5)

## 6. ตัวจำลองต่อสู้ (live dummy)
- ลูป `requestAnimationFrame` จังหวะตีตาม `APS` จริง · ดัมมี่มี `def/mdef/flee/maxHp` ตั้งเองได้ · ล้มแล้วฟื้นใน 1.2 วิ
- ตีกายภาพ: ทอยโดน (`hit` vs `flee`) → ทอยคริ (`physCrit%`, ×1.5 ข้าม DEF) → ไม่คริ = `atk × (1 − reduction)`
- Double Attack: ทอยซ้ำหลังตีโดน (ดาเมจธรรมดา)
- Autospell: โอกาส = (ไอเทม + passive) × `weapon.autospellEfficiency` จำกัดที่ `maxCombinedTriggerChance` + cooldown `icd` วินาที; ดาเมจ = `matk × mult × (1 − magicMit)` ถ้า Magic Crit → เจาะ MDEF + คูณ `1 + critDamageBonus`
- ตัวเลือก "ทดสอบที่ ASPD ตัน" บังคับ ASPD = aspdCap โดยไม่แตะสเตตัสจริง

## 7. จุดที่ควรรู้ตอนต่อยอด
- `ro-status-lab.html` เป็นไฟล์เดียวที่ build ด้วยมือ (ไม่มี build step): แก้ได้ตรง ๆ ที่ `DEFAULT_CONFIG` (บรรทัด ~480) และ `computeDerived` (~805)
- เพิ่ม passive ใหม่: เพิ่มใน `DEFAULT_CONFIG.passives` (หรือผ่านตัวแก้ใน backend) — ถ้าอยากได้ `target` ใหม่ ต้องเพิ่มคีย์ใน `st` ที่ `computeDerived` และนำไปใช้ในสูตร
- เพิ่มอาวุธ/คลาสทำใน backend ได้เลย ไม่ต้องแตะโค้ด
- แนวทางรวมกับ Skill Lab: ให้ Skill Lab เป็นแหล่งความจริงของสกิล แล้วเพิ่มปุ่มส่งออกค่าสเตตัส → JSON ให้ Skill Lab (ดู `EXTENDING.md` ข้อ 9)
