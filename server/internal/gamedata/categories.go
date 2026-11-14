package gamedata

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

// Category คือหมวดของข้อมูลเกมที่เก็บ/ทำเวอร์ชัน/ย้อนกลับแยกกันใน DB (ตาราง game_config_versions)
// แบ่งตามจังหวะการแก้และผู้รับผิดชอบ — หมวดที่ต้องสอดคล้องกันถูกตรวจรวมทุกครั้งก่อนบันทึก (ดู store.SaveGameConfig)
type Category struct {
	Name string
	Keys []string // คีย์ระดับบนสุดของเอกสารข้อมูลเกมที่อยู่ในหมวดนี้
}

// Categories: ลำดับคงที่ ชื่อหมวดต้องตรงกับ CHECK ในไฟล์ migrations/0003_game_config.sql
var Categories = []Category{
	{"balance", []string{"formulaConfig", "globals", "rules"}},
	{"content", []string{"version", "classes", "branches", "skills", "weapons", "statDefs"}},
	{"entities", []string{"monsters", "equipItems", "elementSystem"}},
	{"world", []string{"worldMap"}},
	{"tools", []string{"presets", "builds", "modelSlots"}},
}

// CategoryByName คืนหมวด (nil ถ้าไม่มี)
func CategoryByName(name string) *Category {
	for i := range Categories {
		if Categories[i].Name == name {
			return &Categories[i]
		}
	}
	return nil
}

func (c *Category) has(key string) bool {
	for _, k := range c.Keys {
		if k == key {
			return true
		}
	}
	return false
}

// SplitDoc แยกเอกสารข้อมูลเกมทั้งชุดเป็นหมวด (คีย์ที่ไม่รู้จักถูกปฏิเสธ — ไม่ปล่อยข้อมูลหลุดหมวด)
func SplitDoc(raw []byte) (map[string]json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, fmt.Errorf("JSON ไม่ถูกต้อง: %w", err)
	}
	out := make(map[string]json.RawMessage, len(Categories))
	for _, c := range Categories {
		part := map[string]json.RawMessage{}
		for _, k := range c.Keys {
			if v, ok := top[k]; ok {
				part[k] = v
			}
		}
		b, err := json.Marshal(part)
		if err != nil {
			return nil, err
		}
		out[c.Name] = b
	}
	for k := range top {
		if k == "_meta" { // ข้อมูลประกอบที่เซิร์ฟเวอร์ใส่ตอนส่งออก ไม่เก็บ
			continue
		}
		known := false
		for i := range Categories {
			if Categories[i].has(k) {
				known = true
				break
			}
		}
		if !known {
			return nil, fmt.Errorf("คีย์ %q ไม่อยู่ในหมวดใดของข้อมูลเกม", k)
		}
	}
	return out, nil
}

// ValidatePart ตรวจว่าข้อมูลของหมวดเป็นออบเจ็กต์ และมีเฉพาะคีย์ของหมวดนั้น แล้วคืนรูปแบบกะทัดรัด
func ValidatePart(category string, raw []byte) ([]byte, error) {
	c := CategoryByName(category)
	if c == nil {
		return nil, fmt.Errorf("ไม่มีหมวด %q", category)
	}
	var part map[string]json.RawMessage
	if err := json.Unmarshal(raw, &part); err != nil || part == nil {
		return nil, fmt.Errorf("ข้อมูลหมวด %s ต้องเป็นออบเจ็กต์ JSON", category)
	}
	for k := range part {
		if !c.has(k) {
			return nil, fmt.Errorf("คีย์ %q ไม่อยู่ในหมวด %s", k, category)
		}
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ComposeDoc ประกอบหมวดทั้งหมดกลับเป็นเอกสารเดียว (คีย์เรียงตามตัวอักษร ผลคงที่)
func ComposeDoc(parts map[string][]byte) ([]byte, error) {
	merged := map[string]json.RawMessage{}
	names := make([]string, 0, len(parts))
	for n := range parts {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		var part map[string]json.RawMessage
		if err := json.Unmarshal(parts[n], &part); err != nil {
			return nil, fmt.Errorf("หมวด %s: %w", n, err)
		}
		for k, v := range part {
			merged[k] = v
		}
	}
	return json.Marshal(merged)
}
