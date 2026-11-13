package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strconv"
	"sync"

	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/sim"
	"catquest-ro/server/internal/store"
)

// DataManager ถือข้อมูลเกมที่ใช้งานอยู่ (ประกอบจากทุกหมวดใน Postgres) + ตัวจำลองที่ผูกกับข้อมูลนั้น
// และแจ้งโลกเกมเมื่อข้อมูลเปลี่ยน
type DataManager struct {
	db       *store.Store
	onChange func(*gamedata.Data)

	writeMu sync.Mutex // เรียงการเขียนในอินสแตนซ์นี้ (ข้ามอินสแตนซ์ใช้ advisory lock ใน DB)
	mu      sync.RWMutex
	data    *gamedata.Data
	eng     *sim.Engine
	version int64            // id สูงสุดของทุกหมวด = "เวอร์ชันรวม" ใช้เป็น ETag
	cats    map[string]int64 // id เวอร์ชันที่ใช้งานของแต่ละหมวด
	payload []byte           // เอกสารข้อมูลเกม + _meta สำหรับส่งให้ไคลเอนต์ (แคชไว้จนกว่าข้อมูลเปลี่ยน)
}

var (
	ErrInvalidData = errors.New("ข้อมูลเกมไม่ถูกต้อง")
	ErrUnknownCat  = errors.New("ไม่มีหมวดข้อมูลนี้")
	ErrConflict    = store.ErrConfigConflict
)

// NewDataManager โหลดเวอร์ชันล่าสุดของทุกหมวดจากฐานข้อมูล (ถ้าว่างใส่ข้อมูลตั้งต้นก่อน)
func NewDataManager(ctx context.Context, db *store.Store) (*DataManager, error) {
	parts, err := gamedata.SplitDoc(gamedata.Seed())
	if err != nil {
		return nil, fmt.Errorf("ข้อมูลตั้งต้นในไบนารีใช้ไม่ได้: %w", err)
	}
	seed := make(map[string][]byte, len(parts))
	for k, v := range parts {
		seed[k] = v
	}
	if err := db.SeedGameConfigIfEmpty(ctx, seed); err != nil {
		return nil, fmt.Errorf("ใส่ข้อมูลเกมตั้งต้นไม่สำเร็จ: %w", err)
	}
	m := &DataManager{db: db}
	if err := m.reload(ctx); err != nil {
		return nil, err
	}
	return m, nil
}

// reload อ่านเวอร์ชันที่ใช้งานของทุกหมวดจาก DB แล้วสร้างข้อมูล/ตัวจำลองใหม่ (เรียกภายใต้ writeMu หรือตอนเริ่ม)
func (m *DataManager) reload(ctx context.Context) error {
	rows, err := m.db.ActiveGameConfig(ctx)
	if err != nil {
		return err
	}
	parts := make(map[string][]byte, len(rows))
	cats := make(map[string]int64, len(rows))
	var maxID int64
	for name, r := range rows {
		parts[name] = r.Data
		cats[name] = r.ID
		if r.ID > maxID {
			maxID = r.ID
		}
	}
	raw, err := gamedata.ComposeDoc(parts)
	if err != nil {
		return err
	}
	d, err := gamedata.Parse(raw)
	if err != nil {
		return fmt.Errorf("ข้อมูลเกม (เวอร์ชันรวม #%d) ใช้งานไม่ได้: %w", maxID, err)
	}
	payload, err := withMeta(d.Raw, cats)
	if err != nil {
		return err
	}
	m.mu.Lock()
	m.data, m.eng, m.version, m.cats, m.payload = d, sim.New(d), maxID, cats, payload
	m.mu.Unlock()
	return nil
}

// withMeta ใส่ _meta (เวอร์ชันของแต่ละหมวด + รายการคีย์ของหมวด) ท้ายเอกสาร เพื่อให้ไคลเอนต์ส่งแก้รายหมวดได้โดยไม่ฝังรายชื่อหมวด
func withMeta(doc []byte, versions map[string]int64) ([]byte, error) {
	cats := map[string][]string{}
	for _, c := range gamedata.Categories {
		cats[c.Name] = c.Keys
	}
	meta, err := json.Marshal(map[string]any{"versions": versions, "categories": cats})
	if err != nil {
		return nil, err
	}
	doc = bytes.TrimSpace(doc)
	if len(doc) < 2 || doc[len(doc)-1] != '}' {
		return nil, errors.New("เอกสารข้อมูลเกมไม่ใช่ออบเจ็กต์")
	}
	var out bytes.Buffer
	out.Write(doc[:len(doc)-1])
	out.WriteString(`,"_meta":`)
	out.Write(meta)
	out.WriteByte('}')
	return out.Bytes(), nil
}

func (m *DataManager) SetOnChange(f func(*gamedata.Data)) { m.onChange = f }

func (m *DataManager) Current() (*gamedata.Data, *sim.Engine, int64) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.data, m.eng, m.version
}

// Payload คืนเอกสารข้อมูลเกม (+ _meta) และเวอร์ชันรวม สำหรับ GET /api/data
func (m *DataManager) Payload() ([]byte, int64) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.payload, m.version
}

// validateAll ประกอบทุกหมวดเป็นเอกสารเดียวแล้วตรวจ (โครงสร้าง + ค่า config ครบ + การอ้างอิงข้ามหมวด)
func validateAll(all map[string][]byte) error {
	for _, c := range gamedata.Categories {
		if _, ok := all[c.Name]; !ok {
			return fmt.Errorf("ขาดหมวด %q", c.Name)
		}
	}
	raw, err := gamedata.ComposeDoc(all)
	if err != nil {
		return err
	}
	_, err = gamedata.Parse(raw)
	return err
}

// Apply ตรวจ → บันทึกเฉพาะหมวดที่เปลี่ยน (ทรานแซกชันเดียว) → ใช้งานทันที (โลกเกมโหลดนิยามใหม่)
// expect[หมวด] = id เวอร์ชันที่ไคลเอนต์เห็นล่าสุด (ไม่ตรง = ErrConflict)
func (m *DataManager) Apply(ctx context.Context, changes map[string][]byte, expect map[string]int64, note, userID string) (map[string]int64, error) {
	if len(changes) == 0 {
		return map[string]int64{}, nil
	}
	clean := make(map[string][]byte, len(changes))
	for cat, raw := range changes {
		if gamedata.CategoryByName(cat) == nil {
			return nil, fmt.Errorf("%w: %s", ErrUnknownCat, cat)
		}
		b, err := gamedata.ValidatePart(cat, raw)
		if err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidData, err)
		}
		clean[cat] = b
	}
	if len(note) > 200 {
		note = note[:200]
	}
	m.writeMu.Lock()
	defer m.writeMu.Unlock()
	ids, err := m.db.SaveGameConfig(ctx, clean, expect, note, userID, func(all map[string][]byte) error {
		if err := validateAll(all); err != nil {
			return fmt.Errorf("%w: %v", ErrInvalidData, err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if err := m.reload(ctx); err != nil {
		return nil, err
	}
	cats := make([]string, 0, len(ids))
	for c := range ids {
		cats = append(cats, c)
	}
	sort.Strings(cats)
	slog.Info("อัปเดตข้อมูลเกม", "categories", cats, "version", m.version, "note", note, "by", userID)
	if m.onChange != nil {
		m.onChange(m.data)
	}
	return ids, nil
}

// Replace นำเข้าเอกสารทั้งชุด: เขียนเฉพาะหมวดที่ต่างจากที่ใช้งานอยู่ (ไม่ตรวจ If-Match — ใช้กับการนำเข้า/สคริปต์)
func (m *DataManager) Replace(ctx context.Context, raw []byte, note, userID string) (map[string]int64, error) {
	parts, err := gamedata.SplitDoc(raw)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidData, err)
	}
	m.mu.RLock()
	cur := m.data.Raw
	m.mu.RUnlock()
	curParts, err := gamedata.SplitDoc(cur)
	if err != nil {
		return nil, err
	}
	changes := map[string][]byte{}
	for name, p := range parts {
		var a, b bytes.Buffer
		if json.Compact(&a, p) != nil || json.Compact(&b, curParts[name]) != nil {
			return nil, fmt.Errorf("%w: หมวด %s", ErrInvalidData, name)
		}
		if !bytes.Equal(a.Bytes(), b.Bytes()) {
			changes[name] = a.Bytes()
		}
	}
	return m.Apply(ctx, changes, nil, note, userID)
}

// Rollback ย้อนหมวดหนึ่งไปเป็นข้อมูลของเวอร์ชันที่เลือก (สร้างเป็นเวอร์ชันใหม่ ไม่ลบประวัติ; ตรวจความสอดคล้องกับหมวดอื่นก่อน)
func (m *DataManager) Rollback(ctx context.Context, category string, versionID int64, userID string) (int64, error) {
	if gamedata.CategoryByName(category) == nil {
		return 0, fmt.Errorf("%w: %s", ErrUnknownCat, category)
	}
	row, err := m.db.GameConfigVersion(ctx, category, versionID)
	if err != nil {
		return 0, err
	}
	ids, err := m.Apply(ctx, map[string][]byte{category: row.Data}, nil, "rollback to #"+strconv.FormatInt(versionID, 10), userID)
	if err != nil {
		return 0, err
	}
	return ids[category], nil
}
