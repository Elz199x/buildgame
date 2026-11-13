package gamedata

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

// jsonKeys คืนชื่อคีย์ JSON ทั้งหมดของ struct (ใช้บังคับว่าข้อมูลใน DB ต้องมีครบทุกค่า ไม่มี fallback ฝังในโค้ด)
func jsonKeys(v any) []string {
	t := reflect.TypeOf(v)
	var out []string
	for i := 0; i < t.NumField(); i++ {
		if tag := strings.Split(t.Field(i).Tag.Get("json"), ",")[0]; tag != "" && tag != "-" {
			out = append(out, tag)
		}
	}
	return out
}

func requireKeys(where string, obj any, keys []string) error {
	m, ok := obj.(map[string]any)
	if !ok {
		return fmt.Errorf("%s ต้องเป็นออบเจ็กต์", where)
	}
	for _, k := range keys {
		if _, ok := m[k]; !ok {
			return fmt.Errorf("%s ขาดค่า %q (ค่าคอนฟิกต้องมาจากฐานข้อมูลทั้งหมด ไม่มีค่า fallback ในโค้ด)", where, k)
		}
	}
	return nil
}

// validateConfig ตรวจว่า globals และ formulaConfig มีทุกค่าที่สูตรใช้ และมีโปรไฟล์ครบทุกคลาส/อาวุธ
func (d *Data) validateConfig(rawGlobals, rawFormula, rawRules json.RawMessage) error {
	var g, f, r map[string]any
	if err := json.Unmarshal(rawGlobals, &g); err != nil {
		return fmt.Errorf("globals ไม่ถูกต้อง: %w", err)
	}
	if err := json.Unmarshal(rawFormula, &f); err != nil {
		return fmt.Errorf("formulaConfig ไม่ถูกต้อง: %w", err)
	}
	if err := json.Unmarshal(rawRules, &r); err != nil {
		return fmt.Errorf("rules ไม่ถูกต้อง: %w", err)
	}
	if err := d.validateRules(r); err != nil {
		return err
	}
	if err := requireKeys("globals", g, jsonKeys(Globals{})); err != nil {
		return err
	}
	if err := requireKeys("formulaConfig", f, jsonKeys(FormulaConfig{})); err != nil {
		return err
	}
	sub := func(k string) any { return f[k] }
	if err := requireKeys("formulaConfig.statusPointSystem", sub("statusPointSystem"), jsonKeys(StatusPointSystem{})); err != nil {
		return err
	}
	if err := requireKeys("formulaConfig.baseConstants", sub("baseConstants"), jsonKeys(BaseConstants{})); err != nil {
		return err
	}
	if err := requireKeys("formulaConfig.shieldProfile", sub("shieldProfile"), jsonKeys(ShieldProfile{})); err != nil {
		return err
	}
	if err := requireKeys("formulaConfig.magicCrit", sub("magicCrit"), jsonKeys(MagicCritCfg{})); err != nil {
		return err
	}
	if err := requireKeys("formulaConfig.autospellGlobal", sub("autospellGlobal"), jsonKeys(AutospellGlobal{})); err != nil {
		return err
	}
	for _, k := range [...]string{"str", "agi", "vit", "int", "dex", "luk"} {
		c, ok := d.FormulaConfig.StatCurve[k]
		if !ok || len(c.Slopes) != len(c.Breakpoints)+1 {
			return fmt.Errorf("formulaConfig.statCurve.%s ต้องมี breakpoints และ slopes (slopes = breakpoints + 1)", k)
		}
	}
	classCoefs, _ := f["classCoefs"].(map[string]any)
	for _, c := range d.Classes {
		if err := requireKeys("formulaConfig.classCoefs."+c.ID, classCoefs[c.ID], jsonKeys(ClassCoef{})); err != nil {
			return err
		}
	}
	profiles, _ := f["weaponProfiles"].(map[string]any)
	for _, w := range d.Weapons {
		if err := requireKeys("formulaConfig.weaponProfiles."+w.ID, profiles[w.ID], jsonKeys(WeaponProfile{})); err != nil {
			return err
		}
	}
	return nil
}

// validateRules ตรวจกติกาเกม (rules): ต้องมีครบทุกค่า และอ้างถึงไอเทม/อาวุธ/คลาสที่มีจริง
func (d *Data) validateRules(r map[string]any) error {
	if err := requireKeys("rules", r, jsonKeys(Rules{})); err != nil {
		return err
	}
	p, _ := r["progression"].(map[string]any)
	if err := requireKeys("rules.progression", p, jsonKeys(ProgressionRules{})); err != nil {
		return err
	}
	for _, k := range [...]string{"baseExp", "jobExp"} {
		if err := requireKeys("rules.progression."+k, p[k], jsonKeys(ExpCurve{})); err != nil {
			return err
		}
	}
	if err := requireKeys("rules.progression.defaultKillExp", p["defaultKillExp"], jsonKeys(KillExp{})); err != nil {
		return err
	}
	if err := requireKeys("rules.lab", r["lab"], jsonKeys(LabRules{})); err != nil {
		return err
	}
	if err := requireKeys("rules.world", r["world"], jsonKeys(WorldRules{})); err != nil {
		return err
	}
	rp := d.Rules.Progression
	if rp.MaxBaseLevel < 1 || rp.MaxShopQty < 1 || rp.MinExpRequired < 1 {
		return fmt.Errorf("rules.progression: maxBaseLevel/maxShopQty/minExpRequired ต้อง ≥ 1")
	}
	if d.Weapon(rp.StarterWeaponID) == nil {
		return fmt.Errorf("rules.progression.starterWeaponId %q ไม่มีในรายการอาวุธ", rp.StarterWeaponID)
	}
	for _, it := range rp.StarterItems {
		if d.Item(it.ID) == nil || it.Qty < 1 {
			return fmt.Errorf("rules.progression.starterItems: ไอเทม %q ไม่มี หรือจำนวน < 1", it.ID)
		}
	}
	if d.Class(d.Rules.Lab.ClassID) == nil {
		return fmt.Errorf("rules.lab.classId %q ไม่มีในรายการคลาส", d.Rules.Lab.ClassID)
	}
	return nil
}
