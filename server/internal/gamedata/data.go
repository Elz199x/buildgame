package gamedata

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
)

// seedJSON คือข้อมูลตั้งต้นของเกม ใช้ 2 อย่างเท่านั้น: ใส่ให้ฐานข้อมูลที่ยังว่างตอนเริ่มครั้งแรก และเป็นฟิกซ์เจอร์ของเทสต์
// ไม่ใช่ที่ปรับสมดุล (ข้อมูลจริงอยู่ใน DB) และไม่มีการรีเซ็ตกลับค่านี้ตอนรัน — ย้อนด้วย rollback รายหมวด (ดู categories.go)
//
//go:embed seed/game-data.json
var seedJSON []byte

// MaxBytes ขนาดสูงสุดของเอกสารข้อมูลเกม
const MaxBytes = 8 << 20

// Seed คืนสำเนาข้อมูลตั้งต้น
func Seed() []byte { return append([]byte(nil), seedJSON...) }

// Data คือข้อมูลเกมที่ถอดรหัสแล้ว (อ่านอย่างเดียวหลังสร้าง — ปลอดภัยต่อการใช้พร้อมกันหลาย goroutine)
type Data struct {
	Raw           json.RawMessage
	Version       int
	Classes       []Class
	Branches      []Branch
	Skills        []Skill
	Weapons       []Weapon
	StatDefs      []StatDef
	Presets       []Preset
	Monsters      []Monster
	Builds        []Build
	Globals       Globals
	FormulaConfig FormulaConfig
	ElementSystem ElementSystem
	EquipItems    []EquipItem
	WorldMap      WorldMap
	Rules         Rules

	classIdx   map[string]*Class
	skillIdx   map[string]*Skill
	skillPos   map[string]int
	weaponIdx  map[string]*Weapon
	monsterIdx map[string]*Monster
	itemIdx    map[string]*EquipItem
	presetIdx  map[string]*Preset
	buildIdx   map[string]*Build
}

type document struct {
	Version       int           `json:"version"`
	Classes       []Class       `json:"classes"`
	Branches      []Branch      `json:"branches"`
	Skills        []Skill       `json:"skills"`
	Weapons       []Weapon      `json:"weapons"`
	StatDefs      []StatDef     `json:"statDefs"`
	Presets       []Preset      `json:"presets"`
	Monsters      []Monster     `json:"monsters"`
	Builds        []Build       `json:"builds"`
	Globals       Globals       `json:"globals"`
	FormulaConfig FormulaConfig `json:"formulaConfig"`
	ElementSystem ElementSystem `json:"elementSystem"`
	EquipItems    []EquipItem   `json:"equipItems"`
	WorldMap      WorldMap      `json:"worldMap"`
	Rules         Rules         `json:"rules"`
}

// Parse ถอดรหัส + ตรวจความถูกต้องเชิงโครงสร้างของเอกสารข้อมูลเกม
func Parse(raw []byte) (*Data, error) {
	if len(raw) == 0 || len(raw) > MaxBytes {
		return nil, fmt.Errorf("ขนาดข้อมูลต้องอยู่ระหว่าง 1 ไบต์ถึง %d MB", MaxBytes>>20)
	}
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, fmt.Errorf("JSON ไม่ถูกต้อง: %w", err)
	}
	for _, k := range []string{"classes", "skills", "weapons", "statDefs", "monsters", "globals", "formulaConfig", "worldMap", "rules"} {
		if _, ok := top[k]; !ok {
			return nil, fmt.Errorf("ขาดหมวด %q", k)
		}
	}
	var doc document
	dec := json.NewDecoder(bytes.NewReader(raw))
	if err := dec.Decode(&doc); err != nil {
		return nil, fmt.Errorf("โครงสร้างข้อมูลไม่ถูกต้อง: %w", err)
	}
	d := &Data{
		Raw: append(json.RawMessage(nil), raw...), Version: doc.Version, Classes: doc.Classes, Branches: doc.Branches,
		Skills: doc.Skills, Weapons: doc.Weapons, StatDefs: doc.StatDefs, Presets: doc.Presets, Monsters: doc.Monsters,
		Builds: doc.Builds, Globals: doc.Globals, FormulaConfig: doc.FormulaConfig, ElementSystem: doc.ElementSystem,
		EquipItems: doc.EquipItems, WorldMap: doc.WorldMap, Rules: doc.Rules,
	}
	if err := d.index(); err != nil {
		return nil, err
	}
	if err := d.validateConfig(top["globals"], top["formulaConfig"], top["rules"]); err != nil {
		return nil, err
	}
	d.applyDefaults()
	return d, nil
}

func (d *Data) index() error {
	d.classIdx = make(map[string]*Class, len(d.Classes))
	d.skillIdx = make(map[string]*Skill, len(d.Skills))
	d.skillPos = make(map[string]int, len(d.Skills))
	d.weaponIdx = make(map[string]*Weapon, len(d.Weapons))
	d.monsterIdx = make(map[string]*Monster, len(d.Monsters))
	d.itemIdx = make(map[string]*EquipItem, len(d.EquipItems))
	d.presetIdx = make(map[string]*Preset, len(d.Presets))
	d.buildIdx = make(map[string]*Build, len(d.Builds))
	for i := range d.Classes {
		c := &d.Classes[i]
		if c.ID == "" {
			return errors.New("คลาสที่ไม่มี id")
		}
		if _, dup := d.classIdx[c.ID]; dup {
			return fmt.Errorf("id คลาสซ้ำ: %s", c.ID)
		}
		d.classIdx[c.ID] = c
	}
	if len(d.Classes) == 0 {
		return errors.New("ต้องมีอย่างน้อย 1 คลาส")
	}
	for i := range d.Skills {
		s := &d.Skills[i]
		if s.ID == "" {
			return errors.New("สกิลที่ไม่มี id")
		}
		if _, dup := d.skillIdx[s.ID]; dup {
			return fmt.Errorf("id สกิลซ้ำ: %s", s.ID)
		}
		if s.MaxLevel < 1 {
			s.MaxLevel = 1
		}
		if s.JobLvReq < 1 {
			s.JobLvReq = 1
		}
		d.skillIdx[s.ID] = s
		d.skillPos[s.ID] = i
	}
	for i := range d.Weapons {
		d.weaponIdx[d.Weapons[i].ID] = &d.Weapons[i]
	}
	for i := range d.Monsters {
		m := &d.Monsters[i]
		if m.ID == "" || m.MaxHP <= 0 {
			return fmt.Errorf("มอนสเตอร์ %q ต้องมี id และ maxHp > 0", m.ID)
		}
		d.monsterIdx[m.ID] = m
	}
	for i := range d.EquipItems {
		d.itemIdx[d.EquipItems[i].ID] = &d.EquipItems[i]
	}
	for i := range d.Presets {
		d.presetIdx[d.Presets[i].ID] = &d.Presets[i]
	}
	for i := range d.Builds {
		d.buildIdx[d.Builds[i].ID] = &d.Builds[i]
	}
	if len(d.Monsters) == 0 {
		return errors.New("ต้องมีอย่างน้อย 1 มอนสเตอร์")
	}
	return nil
}

// applyDefaults เติมเฉพาะค่าเฉพาะตัวของมอนสเตอร์ที่เป็นทางเลือก (globals/formulaConfig ต้องมีครบจากฐานข้อมูล — ดู validateConfig)
func (d *Data) applyDefaults() {
	for i := range d.Monsters {
		m := &d.Monsters[i]
		if m.World.Scale <= 0 {
			m.World.Scale = 1
		}
		if m.World.AttackRange <= 0 {
			m.World.AttackRange = 60
		}
	}
}

func (d *Data) Class(id string) *Class     { return d.classIdx[id] }
func (d *Data) Skill(id string) *Skill     { return d.skillIdx[id] }
func (d *Data) Weapon(id string) *Weapon   { return d.weaponIdx[id] }
func (d *Data) Monster(id string) *Monster { return d.monsterIdx[id] }
func (d *Data) Item(id string) *EquipItem  { return d.itemIdx[id] }
func (d *Data) Preset(id string) *Preset   { return d.presetIdx[id] }
func (d *Data) Build(id string) *Build     { return d.buildIdx[id] }

// SkillIndex ลำดับของสกิลในอาร์เรย์ skills (ใช้เป็น skillIdx ในโปรโตคอลไบนารี)
func (d *Data) SkillIndex(id string) (int, bool) { i, ok := d.skillPos[id]; return i, ok }

// SkillAt คืนสกิลตามลำดับในอาร์เรย์ (nil ถ้าเกินช่วง)
func (d *Data) SkillAt(i int) *Skill {
	if i < 0 || i >= len(d.Skills) {
		return nil
	}
	return &d.Skills[i]
}

// SpawnsForCurrentMap จุดเกิดของแมพปัจจุบัน (ถ้าไม่มี ใช้ worldMap.spawns)
func (d *Data) SpawnsForCurrentMap() []Spawn {
	for _, m := range d.WorldMap.Maps {
		if m.ID == d.WorldMap.CurrentMapID && len(m.Spawns) > 0 {
			return m.Spawns
		}
	}
	return d.WorldMap.Spawns
}
