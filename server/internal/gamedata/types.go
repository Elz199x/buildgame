// Package gamedata คือโครงสร้างข้อมูลเกม (คลาส สกิล อาวุธ มอนสเตอร์ แมพ ฯลฯ) ที่ถอดจาก JSON
// ซึ่งเก็บเป็นเอกสาร JSONB ใน Postgres (ตาราง game_data_versions) — ตัวแก้ไขในหน้าเว็บอ่าน/เขียนเอกสารเดียวกันนี้
//
// ตรงกับสคีมาใน docs/DATA_SCHEMA.md; ฟิลด์ที่ไม่รู้จักถูกข้าม (ยังคงอยู่ใน JSON ดิบ)
package gamedata

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
)

// Scalable = "ค่าที่ขยายตามเลเวลได้": ตัวเลข | {base, step} | {table:[...]} | [...]
type Scalable struct {
	base, step float64
	table      []float64
}

func (s *Scalable) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	*s = Scalable{}
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	switch b[0] {
	case '[':
		return json.Unmarshal(b, &s.table)
	case '{':
		var o struct {
			Base  json.Number `json:"base"`
			Step  json.Number `json:"step"`
			Table []float64   `json:"table"`
		}
		if err := json.Unmarshal(b, &o); err != nil {
			return err
		}
		s.table = o.Table
		s.base = numOrZero(o.Base)
		s.step = numOrZero(o.Step)
		return nil
	case '"':
		var str string
		if err := json.Unmarshal(b, &str); err != nil {
			return err
		}
		s.base = parseLoose(str)
		return nil
	}
	var f float64
	if err := json.Unmarshal(b, &f); err != nil {
		return err
	}
	s.base = f
	return nil
}

func numOrZero(n json.Number) float64 {
	if n == "" {
		return 0
	}
	f, err := n.Float64()
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

func parseLoose(s string) float64 {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0
	}
	return f
}

// Const สร้างค่าคงที่ (ใช้ในเทสต์/โค้ด)
func Const(v float64) Scalable { return Scalable{base: v} }

// Val เทียบเท่า SL.util.val(S, lv) ฝั่ง JS
func (s Scalable) Val(lv int) float64 {
	if n := len(s.table); n > 0 {
		i := lv
		if i < 1 {
			i = 1
		}
		if i > n {
			i = n
		}
		return s.table[i-1]
	}
	if lv < 1 {
		lv = 1
	}
	return s.base + s.step*float64(lv-1)
}

// ---------- คลาส / สกิล ----------

type Class struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Parent         string `json:"parent"`
	JobLvCap       int    `json:"jobLvCap"`
	PointsPerJobLv int    `json:"pointsPerJobLv"`
}

type Branch struct {
	ID    string `json:"id"`
	Class string `json:"class"`
	Name  string `json:"name"`
}

type Require struct {
	ID string `json:"id"`
	Lv int    `json:"lv"`
}

type WeaponReq struct {
	SlotType   string   `json:"slotType"`
	DamageType string   `json:"damageType"`
	Include    []string `json:"include"`
	Exclude    []string `json:"exclude"`
}

type Usage struct {
	SP         Scalable `json:"sp"`
	HP         Scalable `json:"hp"`
	Cooldown   Scalable `json:"cooldown"`
	Duration   Scalable `json:"duration"`
	HPDrain    Scalable `json:"hpDrain"`
	SPDrain    Scalable `json:"spDrain"`
	UsesAction *bool    `json:"usesAction"`
}

type DamageTerm struct {
	Stat string   `json:"stat"`
	Mult Scalable `json:"mult"`
}

// DamageSpec = สูตรดาเมจของสกิล (หรือการตีธรรมดา)
type DamageSpec struct {
	Kind      string       `json:"kind"` // "" | physical | magic
	Terms     []DamageTerm `json:"terms"`
	NoCrit    bool         `json:"noCrit"`
	AlwaysHit bool         `json:"alwaysHit"`
	AoE       bool         `json:"aoe"`
	Element   string       `json:"element"`
}

type Heal struct {
	PctMaxHP Scalable `json:"pctMaxHp"`
	Flat     Scalable `json:"flat"`
}

type Effect struct {
	Stat      string   `json:"stat"`
	Mode      string   `json:"mode"` // flat | percent
	Value     Scalable `json:"value"`
	AppliesTo string   `json:"appliesTo"` // self | target
}

type ToggleOff struct {
	HPBelow float64 `json:"hpBelow"`
}

type Trigger struct {
	HPBelow  float64  `json:"hpBelow"`
	HPAbove  *float64 `json:"hpAbove"`
	Cooldown float64  `json:"cooldown"`
}

type Skill struct {
	ID         string     `json:"id"`
	Class      string     `json:"class"`
	Name       string     `json:"name"`
	Type       string     `json:"type"` // passive | active | buff | toggle | trigger
	Branch     string     `json:"branch"`
	JobLvReq   int        `json:"jobLvReq"`
	MaxLevel   int        `json:"maxLevel"`
	Requires   []Require  `json:"requires"`
	WeaponReq  WeaponReq  `json:"weaponReq"`
	NeedShield bool       `json:"needShield"`
	Usage      Usage      `json:"usage"`
	Damage     DamageSpec `json:"damage"`
	Heal       *Heal      `json:"heal"`
	Effects    []Effect   `json:"effects"`
	Group      string     `json:"group"`
	Trigger    *Trigger   `json:"trigger"`
	ToggleOff  *ToggleOff `json:"toggleOff"`
}

type Weapon struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	SlotType    string `json:"slotType"`
	DamageType  string `json:"damageType"`
	WeaponClass string `json:"weaponClass"`
}

type StatDef struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Kind string `json:"kind"` // num | pct | frac
}

type Preset struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	WeaponID  string             `json:"weaponId"`
	HasShield bool               `json:"hasShield"`
	Sheet     map[string]float64 `json:"sheet"`
}

type Build struct {
	ID       string         `json:"id"`
	Name     string         `json:"name"`
	ClassID  string         `json:"classId"`
	JobLv    int            `json:"jobLv"`
	PresetID string         `json:"presetId"`
	Learned  map[string]int `json:"learned"`
}

// ---------- มอนสเตอร์ / โลก ----------

type TelegraphDef struct {
	Name     string  `json:"name"`
	CD       float64 `json:"cd"`
	CastTime float64 `json:"castTime"`
	Shape    string  `json:"shape"` // circle | cone | line
	Radius   float64 `json:"radius"`
	Angle    float64 `json:"angle"`
	Mult     float64 `json:"mult"`
}

type MonsterWorld struct {
	Scale       float64       `json:"scale"`
	MoveSpeed   float64       `json:"moveSpeed"`
	AggroRange  float64       `json:"aggroRange"`
	AttackRange float64       `json:"attackRange"`
	Telegraph   *TelegraphDef `json:"telegraph"`
}

type Drop struct {
	ItemID string  `json:"itemId"`
	Chance float64 `json:"chance"`
}

type Monster struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Element  string  `json:"element"`
	Size     string  `json:"size"`
	Def      float64 `json:"def"`
	MDef     float64 `json:"mdef"`
	Flee     float64 `json:"flee"`
	MaxHP    float64 `json:"maxHp"`
	Atk      float64 `json:"atk"`
	Hit      float64 `json:"hit"`
	Interval float64 `json:"interval"`
	Exp      struct {
		Base float64 `json:"base"`
		Job  float64 `json:"job"`
	} `json:"exp"`
	Gold  []float64    `json:"gold"` // [ต่ำสุด, สูงสุด]
	Drops []Drop       `json:"drops"`
	World MonsterWorld `json:"world"`
}

type Spawn struct {
	ID        string  `json:"id"`
	MonsterID string  `json:"monsterId"`
	X         float64 `json:"x"`
	Y         float64 `json:"y"`
}

type MapDef struct {
	ID     string  `json:"id"`
	Spawns []Spawn `json:"spawns"`
}

type WorldMap struct {
	CurrentMapID string   `json:"currentMapId"`
	Spawns       []Spawn  `json:"spawns"`
	Maps         []MapDef `json:"maps"`
}

// ---------- ค่ากลาง / สูตร ----------

type Globals struct {
	AspdCap           float64            `json:"aspdCap"`
	SoftDefK          float64            `json:"softDefK"`
	MaxPhysReduction  float64            `json:"maxPhysReduction"`
	MaxMagicReduction float64            `json:"maxMagicReduction"`
	MaxDodge          float64            `json:"maxDodge"`
	CritMult          float64            `json:"critMult"`
	BlockReduction    float64            `json:"blockReduction"`
	HitBase           float64            `json:"hitBase"`
	HitPerPoint       float64            `json:"hitPerPoint"`
	RespawnDelay      float64            `json:"respawnDelay"`
	ReviveDelay       float64            `json:"reviveDelay"`
	BuffPercentCap    map[string]float64 `json:"buffPercentCap"`
}

type StatusPointSystem struct {
	StartPoints    float64 `json:"startPoints"`
	LevelUpOffset  float64 `json:"levelUpOffset"`
	LevelUpDivisor float64 `json:"levelUpDivisor"`
	StatCap        float64 `json:"statCap"`
}

type BaseConstants struct {
	HPPerVit            float64 `json:"hpPerVit"`
	HPPerLevel          float64 `json:"hpPerLevel"`
	SPPerInt            float64 `json:"spPerInt"`
	SPPerLevel          float64 `json:"spPerLevel"`
	MatkPerInt          float64 `json:"matkPerInt"`
	HitBase             float64 `json:"hitBase"`
	HitPerDex           float64 `json:"hitPerDex"`
	FleeBase            float64 `json:"fleeBase"`
	FleePerAgi          float64 `json:"fleePerAgi"`
	FleePerLuk          float64 `json:"fleePerLuk"`
	AspdBase            float64 `json:"aspdBase"`
	AspdPerAgi          float64 `json:"aspdPerAgi"`
	AspdPerDex          float64 `json:"aspdPerDex"`
	CritBase            float64 `json:"critBase"`
	CritPerLuk          float64 `json:"critPerLuk"`
	DefPerVit           float64 `json:"defPerVit"`
	MDefPerInt          float64 `json:"mdefPerInt"`
	HPRegenPerVit       float64 `json:"hpRegenPerVit"`
	CastReductionPerDex float64 `json:"castReductionPerDex"`
	SPRegenBase         float64 `json:"spRegenBase"`
	SPRegenPerInt       float64 `json:"spRegenPerInt"`
	RollCooldown        float64 `json:"rollCooldown"`
	RollDistance        float64 `json:"rollDistance"`
	RollDuration        float64 `json:"rollDuration"`
	MoveSpeedBase       float64 `json:"moveSpeedBase"`
}

type StatCurve struct {
	Breakpoints []float64 `json:"breakpoints"`
	Slopes      []float64 `json:"slopes"`
}

type ClassCoef struct {
	HPCoef float64 `json:"hpCoef"`
	SPCoef float64 `json:"spCoef"`
}

type WeaponProfile struct {
	Stat                string  `json:"stat"`
	Coeff               float64 `json:"coeff"`
	Stat2               string  `json:"stat2"`
	Coeff2              float64 `json:"coeff2"`
	AspdOffset          float64 `json:"aspdOffset"`
	Range               float64 `json:"range"`
	CritBonusFlat       float64 `json:"critBonusFlat"`
	HitBonusFlat        float64 `json:"hitBonusFlat"`
	HitPenalty          float64 `json:"hitPenalty"`
	DefPen              float64 `json:"defPen"`
	MatkPercent         float64 `json:"matkPercent"`
	CastReductionBonus  float64 `json:"castReductionBonus"`
	AutospellEfficiency float64 `json:"autospellEfficiency"`
}

type AutospellGlobal struct {
	MaxCombinedTriggerChance float64 `json:"maxCombinedTriggerChance"`
}

type ShieldProfile struct {
	AspdOffset  float64 `json:"aspdOffset"`
	BlockChance float64 `json:"blockChance"`
	DefFlat     float64 `json:"defFlat"`
}

type MagicCritCfg struct {
	ChanceBase     float64 `json:"chanceBase"`
	LukScalar      float64 `json:"lukScalar"`
	MdefIgnoreBase float64 `json:"mdefIgnoreBase"`
	DexScalar      float64 `json:"dexScalar"`
	MdefIgnoreCap  float64 `json:"mdefIgnoreCap"`
	CritDmgBase    float64 `json:"critDmgBase"`
	IntScalar      float64 `json:"intScalar"`
	CritDmgCap     float64 `json:"critDmgCap"`
}

type FormulaConfig struct {
	StatusPointSystem StatusPointSystem        `json:"statusPointSystem"`
	BaseConstants     BaseConstants            `json:"baseConstants"`
	StatCurve         map[string]StatCurve     `json:"statCurve"`
	ClassCoefs        map[string]ClassCoef     `json:"classCoefs"`
	WeaponProfiles    map[string]WeaponProfile `json:"weaponProfiles"`
	ShieldProfile     *ShieldProfile           `json:"shieldProfile"`
	MagicCrit         *MagicCritCfg            `json:"magicCrit"`
	AutospellGlobal   *AutospellGlobal         `json:"autospellGlobal"`
}

type Element struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Icon string `json:"icon"`
}

type ElementSystem struct {
	Elements   []Element                     `json:"elements"`
	Matrix     map[string]map[string]float64 `json:"matrix"`
	SizeMatrix map[string]map[string]float64 `json:"sizeMatrix"`
}

type ConsumeEffect struct {
	HPPct float64 `json:"hpPct"`
	SPPct float64 `json:"spPct"`
}

type EquipItem struct {
	ID             string         `json:"id"`
	Price          float64        `json:"price"`
	Slot           string         `json:"slot"`
	Name           string         `json:"name"`
	Effects        []Effect       `json:"effects"`
	AttackElement  string         `json:"attackElement"`
	DefenseElement string         `json:"defenseElement"`
	ConsumeEffect  *ConsumeEffect `json:"consumeEffect"`
}

// ---------- กติกาเกม (rules) — ค่าทั้งหมดมาจากฐานข้อมูล ไม่มีค่าฝังในโค้ด ----------

type ItemQty struct {
	ID  string  `json:"id"`
	Qty float64 `json:"qty"`
}

// ExpCurve: EXP ที่ต้องใช้เลื่อนเลเวล = round(base + เลเวล² × perLevelSq)
type ExpCurve struct {
	Base       float64 `json:"base"`
	PerLevelSq float64 `json:"perLevelSq"`
}

type KillExp struct {
	Base float64 `json:"base"`
	Job  float64 `json:"job"`
}

type ProgressionRules struct {
	MaxBaseLevel      float64   `json:"maxBaseLevel"`
	MaxShopQty        float64   `json:"maxShopQty"`
	StarterGold       float64   `json:"starterGold"`
	StarterWeaponID   string    `json:"starterWeaponId"`
	StarterStat       float64   `json:"starterStat"`
	StarterItems      []ItemQty `json:"starterItems"`
	BaseExp           ExpCurve  `json:"baseExp"`
	JobExp            ExpCurve  `json:"jobExp"`
	MinExpRequired    float64   `json:"minExpRequired"`
	DefaultKillExp    KillExp   `json:"defaultKillExp"`
	DefaultBuyPrice   float64   `json:"defaultBuyPrice"`
	SellRatio         float64   `json:"sellRatio"`
	MinSellPrice      float64   `json:"minSellPrice"`
	DefaultDropChance float64   `json:"defaultDropChance"`
}

// LabRules: ตัวละครตั้งต้นของโหมดตัวแก้ไข (ฝั่งเบราว์เซอร์) — เซิร์ฟเวอร์ไม่ใช้ แต่ต้องมีครบใน DB
type LabRules struct {
	ClassID   string             `json:"classId"`
	BaseLv    float64            `json:"baseLv"`
	JobLv     float64            `json:"jobLv"`
	Gold      float64            `json:"gold"`
	RawStats  map[string]float64 `json:"rawStats"`
	Inventory []ItemQty          `json:"inventory"`
	Storage   []ItemQty          `json:"storage"`
}

type WorldRules struct {
	TownX         float64 `json:"townX"`
	TownY         float64 `json:"townY"`
	RollIFrame    float64 `json:"rollIFrame"`
	MobRespawn    float64 `json:"mobRespawn"`
	PlayerRadius  float64 `json:"playerRadius"`
	MobBaseRadius float64 `json:"mobBaseRadius"`
	AoeRadius     float64 `json:"aoeRadius"`
	AoeMaxTargets float64 `json:"aoeMaxTargets"`
}

type Rules struct {
	Progression ProgressionRules `json:"progression"`
	Lab         LabRules         `json:"lab"`
	World       WorldRules       `json:"world"`
}
