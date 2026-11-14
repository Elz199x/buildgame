package gamedata

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
)

// ข้อมูลเกมแบ่งเป็น 2 ชนิดการเก็บ:
//
//  1. หมวดเอกสาร (Category) — เก็บเป็นเอกสาร JSON แบบมีเวอร์ชัน ตาราง game_config_versions
//     (balance/entities/world/tools: ก้อนที่แก้ทีละหมวดและย้อนทั้งหมวด)
//  2. ตารางรายการ (Table) — หนึ่งแถวต่อหนึ่งรายการ มี FOREIGN KEY และ version ต่อแถว
//     (classes/branches/skills/weapons/stats: แก้และย้อนทีละรายการ) ตาราง game_classes ฯลฯ

// Category คือหมวดเอกสาร; ชื่อต้องตรงกับ CHECK ของ game_config_versions (migrations/0004)
type Category struct {
	Name string
	Keys []string // คีย์ระดับบนสุดของเอกสารข้อมูลเกมที่อยู่ในหมวดนี้
}

var Categories = []Category{
	{"balance", []string{"version", "formulaConfig", "globals", "rules"}},
	{"entities", []string{"monsters", "equipItems", "elementSystem"}},
	{"world", []string{"worldMap"}},
	{"tools", []string{"presets", "builds", "modelSlots"}},
}

// Table คือคอลเลกชันที่เก็บเป็นแถวต่อรายการ; Name = ชื่อใน API/ตาราง audit, Key = คีย์ในเอกสารข้อมูลเกม
type Table struct {
	Name string
	Key  string
}

// Tables เรียงตามลำดับพึ่งพา (ตัวหน้าถูกอ้างโดยตัวหลัง): สร้าง/แก้ตามลำดับนี้ ลบย้อนลำดับ
var Tables = []Table{
	{"classes", "classes"},
	{"branches", "branches"},
	{"weapons", "weapons"}, // ก่อน skills: สกิลอ้างชนิดอาวุธที่เกิดจากอาวุธ
	{"skills", "skills"},
	{"stats", "statDefs"},
}

func CategoryByName(name string) *Category {
	for i := range Categories {
		if Categories[i].Name == name {
			return &Categories[i]
		}
	}
	return nil
}

func TableByName(name string) *Table {
	for i := range Tables {
		if Tables[i].Name == name {
			return &Tables[i]
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

func knownKey(k string) bool {
	for i := range Categories {
		if Categories[i].has(k) {
			return true
		}
	}
	for _, t := range Tables {
		if t.Key == k {
			return true
		}
	}
	return false
}

// SplitDoc แยกเอกสารข้อมูลเกมทั้งชุดเป็น (หมวดเอกสาร, รายการของแต่ละตาราง) — คีย์ที่ไม่รู้จักถูกปฏิเสธ
func SplitDoc(raw []byte) (map[string]json.RawMessage, map[string][]json.RawMessage, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(raw, &top); err != nil {
		return nil, nil, fmt.Errorf("JSON ไม่ถูกต้อง: %w", err)
	}
	cfg := make(map[string]json.RawMessage, len(Categories))
	for _, c := range Categories {
		part := map[string]json.RawMessage{}
		for _, k := range c.Keys {
			if v, ok := top[k]; ok {
				part[k] = v
			}
		}
		b, err := json.Marshal(part)
		if err != nil {
			return nil, nil, err
		}
		cfg[c.Name] = b
	}
	tables := make(map[string][]json.RawMessage, len(Tables))
	for _, t := range Tables {
		var items []json.RawMessage
		if v, ok := top[t.Key]; ok {
			if err := json.Unmarshal(v, &items); err != nil {
				return nil, nil, fmt.Errorf("%s ต้องเป็นอาเรย์: %w", t.Key, err)
			}
		}
		tables[t.Name] = items
	}
	for k := range top {
		if k == "_meta" { // ข้อมูลประกอบที่เซิร์ฟเวอร์ใส่ตอนส่งออก ไม่เก็บ
			continue
		}
		if !knownKey(k) {
			return nil, nil, fmt.Errorf("คีย์ %q ไม่อยู่ในหมวดหรือตารางใดของข้อมูลเกม", k)
		}
	}
	return cfg, tables, nil
}

// ValidatePart ตรวจว่าข้อมูลของหมวดเอกสารเป็นออบเจ็กต์ และมีเฉพาะคีย์ของหมวดนั้น แล้วคืนรูปแบบกะทัดรัด
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

// ValidateItem ตรวจรายการของตาราง: ต้องเป็นออบเจ็กต์ที่มี id (ตรงกับ id ที่ระบุถ้าให้มา) แล้วคืนรูปแบบกะทัดรัด
func ValidateItem(table string, wantID string, raw []byte) ([]byte, error) {
	if TableByName(table) == nil {
		return nil, fmt.Errorf("ไม่มีตาราง %q", table)
	}
	var item struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, fmt.Errorf("รายการของ %s ต้องเป็นออบเจ็กต์ JSON", table)
	}
	if item.ID == "" || len(item.ID) > 64 {
		return nil, fmt.Errorf("รายการของ %s ต้องมี id (ไม่เกิน 64 ตัวอักษร)", table)
	}
	if wantID != "" && item.ID != wantID {
		return nil, fmt.Errorf("id ในข้อมูล (%s) ไม่ตรงกับ id ใน URL (%s)", item.ID, wantID)
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// ComposeDoc ประกอบหมวดเอกสาร + รายการของตารางกลับเป็นเอกสารเดียว (คีย์เรียงตามตัวอักษร ผลคงที่)
func ComposeDoc(cfg map[string][]byte, tables map[string][]json.RawMessage) ([]byte, error) {
	merged := map[string]json.RawMessage{}
	names := make([]string, 0, len(cfg))
	for n := range cfg {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		var part map[string]json.RawMessage
		if err := json.Unmarshal(cfg[n], &part); err != nil {
			return nil, fmt.Errorf("หมวด %s: %w", n, err)
		}
		for k, v := range part {
			merged[k] = v
		}
	}
	for _, t := range Tables {
		items := tables[t.Name]
		if items == nil {
			items = []json.RawMessage{}
		}
		b, err := json.Marshal(items)
		if err != nil {
			return nil, err
		}
		merged[t.Key] = b
	}
	return json.Marshal(merged)
}
