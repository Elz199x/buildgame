package httpapi

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
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

// DataManager ถือข้อมูลเกมที่ใช้งานอยู่ (ประกอบจากหมวดเอกสาร + ตารางรายการใน Postgres) + ตัวจำลองที่ผูกกับข้อมูลนั้น
// และแจ้งโลกเกมเมื่อข้อมูลเปลี่ยน
type DataManager struct {
	db       *store.Store
	onChange func(*gamedata.Data)

	writeMu sync.Mutex // เรียงการเขียนในอินสแตนซ์นี้ (ข้ามอินสแตนซ์ใช้ advisory lock ใน DB)
	mu      sync.RWMutex
	data    *gamedata.Data
	eng     *sim.Engine
	version int64  // นับการโหลดข้อมูลใหม่ในโปรเซสนี้
	payload []byte // เอกสารข้อมูลเกม + _meta สำหรับส่งให้ไคลเอนต์ (แคชไว้จนกว่าข้อมูลเปลี่ยน)
	etag    string // แฮชของ payload (เปลี่ยนเมื่อเนื้อหาเปลี่ยนจริง ไม่ขึ้นกับจำนวนครั้งที่โหลด)
}

var (
	ErrInvalidData = errors.New("ข้อมูลเกมไม่ถูกต้อง")
	ErrUnknownCat  = errors.New("ไม่มีหมวดหรือตารางข้อมูลนี้")
	ErrConflict    = store.ErrConfigConflict
	ErrRefs        = store.ErrRefIntegrity
)

// NewDataManager โหลดข้อมูลเกมจากฐานข้อมูล (ถ้ายังไม่มีเลยใส่ข้อมูลตั้งต้นก่อน)
func NewDataManager(ctx context.Context, db *store.Store) (*DataManager, error) {
	cfg, tables, err := gamedata.SplitDoc(gamedata.Seed())
	if err != nil {
		return nil, fmt.Errorf("ข้อมูลตั้งต้นในไบนารีใช้ไม่ได้: %w", err)
	}
	seedCfg := make(map[string][]byte, len(cfg))
	for k, v := range cfg {
		seedCfg[k] = v
	}
	if err := db.SeedGameDataIfEmpty(ctx, seedCfg, tables); err != nil {
		return nil, fmt.Errorf("ใส่ข้อมูลเกมตั้งต้นไม่สำเร็จ: %w", err)
	}
	m := &DataManager{db: db}
	if err := m.reload(ctx); err != nil {
		return nil, err
	}
	return m, nil
}

// reload อ่านข้อมูลทั้งหมดจาก DB แล้วสร้างข้อมูล/ตัวจำลองใหม่ (เรียกภายใต้ writeMu หรือตอนเริ่ม)
func (m *DataManager) reload(ctx context.Context) error {
	cfgRows, tableRows, err := m.db.ActiveGameData(ctx)
	if err != nil {
		return err
	}
	cfg := make(map[string][]byte, len(cfgRows))
	catVer := make(map[string]int64, len(cfgRows))
	for name, r := range cfgRows {
		cfg[name] = r.Data
		catVer[name] = r.ID
	}
	items := make(map[string][]json.RawMessage, len(tableRows))
	rowVer := make(map[string]map[string]int64, len(tableRows))
	for name, rows := range tableRows {
		rowVer[name] = make(map[string]int64, len(rows))
		list := make([]json.RawMessage, len(rows))
		for i, r := range rows {
			list[i] = r.Data
			rowVer[name][r.ID] = r.Version
		}
		items[name] = list
	}
	raw, err := gamedata.ComposeDoc(cfg, items)
	if err != nil {
		return err
	}
	d, err := gamedata.Parse(raw)
	if err != nil {
		return fmt.Errorf("ข้อมูลเกมใช้งานไม่ได้: %w", err)
	}
	payload, err := withMeta(d.Raw, catVer, rowVer)
	if err != nil {
		return err
	}
	h := sha256.Sum256(payload)
	m.mu.Lock()
	m.data, m.eng, m.payload, m.etag = d, sim.New(d), payload, hex.EncodeToString(h[:12])
	m.version++
	m.mu.Unlock()
	return nil
}

// withMeta ใส่ _meta ท้ายเอกสาร เพื่อให้ไคลเอนต์ส่งแก้ได้เฉพาะส่วนที่เปลี่ยนโดยไม่ฝังรายชื่อหมวด/ตารางในโค้ด
//
//	versions:    id เวอร์ชันของหมวดเอกสารแต่ละหมวด (ใช้เป็น If-Match ของ PUT /api/data/{หมวด})
//	categories:  คีย์ในเอกสารที่อยู่ในแต่ละหมวด
//	tables:      ตาราง → { id รายการ → เวอร์ชันของแถว } (ใช้เป็น If-Match ของ PUT /api/tables/{ตาราง}/{id})
//	tableKeys:   ตาราง → คีย์ในเอกสาร (เรียงตามลำดับพึ่งพา)
func withMeta(doc []byte, versions map[string]int64, rows map[string]map[string]int64) ([]byte, error) {
	cats := map[string][]string{}
	for _, c := range gamedata.Categories {
		cats[c.Name] = c.Keys
	}
	keys := map[string]string{}
	order := make([]string, 0, len(gamedata.Tables))
	for _, t := range gamedata.Tables {
		keys[t.Name] = t.Key
		order = append(order, t.Name)
	}
	meta, err := json.Marshal(map[string]any{"versions": versions, "categories": cats, "tables": rows, "tableKeys": keys, "tableOrder": order})
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

// Payload คืนเอกสารข้อมูลเกม (+ _meta) และ ETag (แฮชของเนื้อหา) สำหรับ GET /api/data
func (m *DataManager) Payload() ([]byte, string) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.payload, m.etag
}

// validateAll ประกอบข้อมูลทั้งหมดเป็นเอกสารเดียวแล้วตรวจ (โครงสร้าง + ค่า config ครบ + การอ้างอิงข้ามส่วน)
func validateAll(cfg map[string][]byte, tables map[string][]json.RawMessage) error {
	for _, c := range gamedata.Categories {
		if _, ok := cfg[c.Name]; !ok {
			return fmt.Errorf("ขาดหมวด %q", c.Name)
		}
	}
	raw, err := gamedata.ComposeDoc(cfg, tables)
	if err != nil {
		return err
	}
	_, err = gamedata.Parse(raw)
	return err
}

func invalid(err error) error { return fmt.Errorf("%w: %v", ErrInvalidData, err) }

// validateItem ตรวจรายการของตารางทั้งชั้นเอกสาร (มี id) และชั้นคอลัมน์ (ชนิด/ค่า/ฟิลด์ที่ไม่รู้จัก) แล้วคืน JSON รูป canonical
func validateItem(table, id string, raw []byte) ([]byte, error) {
	b, err := gamedata.ValidateItem(table, id, raw)
	if err != nil {
		return nil, err
	}
	return store.CanonItem(table, id, b)
}

// Save ตรวจ → บันทึกชุดการเปลี่ยนแปลง (ทรานแซกชันเดียว) → โหลดใหม่และใช้งานทันที (โลกเกมโหลดนิยามใหม่)
func (m *DataManager) Save(ctx context.Context, in store.SaveInput) (store.SaveResult, error) {
	if len(in.Config) == 0 && len(in.Ops) == 0 {
		return store.SaveResult{ConfigIDs: map[string]int64{}, RowIDs: map[string]int64{}}, nil
	}
	if len(in.Note) > 200 {
		in.Note = in.Note[:200]
	}
	m.writeMu.Lock()
	defer m.writeMu.Unlock()
	res, err := m.db.SaveGameData(ctx, in, func(cfg map[string][]byte, tables map[string][]json.RawMessage) error {
		if err := validateAll(cfg, tables); err != nil {
			return invalid(err)
		}
		return nil
	})
	if err != nil {
		return store.SaveResult{}, err
	}
	if err := m.reload(ctx); err != nil {
		return store.SaveResult{}, err
	}
	cats := make([]string, 0, len(res.ConfigIDs))
	for c := range res.ConfigIDs {
		cats = append(cats, c)
	}
	sort.Strings(cats)
	slog.Info("อัปเดตข้อมูลเกม", "categories", cats, "rows", len(res.RowIDs), "note", in.Note, "by", in.UserID)
	if m.onChange != nil {
		m.onChange(m.data)
	}
	return res, nil
}

// ApplyCategory แก้หมวดเอกสารหนึ่งหมวด (expect = id เวอร์ชันที่ไคลเอนต์เห็นล่าสุด; ไม่ตรง = ErrConflict)
func (m *DataManager) ApplyCategory(ctx context.Context, category string, raw []byte, expect int64, note, userID string) (int64, error) {
	if gamedata.CategoryByName(category) == nil {
		return 0, fmt.Errorf("%w: %s", ErrUnknownCat, category)
	}
	b, err := gamedata.ValidatePart(category, raw)
	if err != nil {
		return 0, invalid(err)
	}
	res, err := m.Save(ctx, store.SaveInput{Config: map[string][]byte{category: b}, ConfigExpect: map[string]int64{category: expect}, Note: note, UserID: userID})
	if err != nil {
		return 0, err
	}
	return res.ConfigIDs[category], nil
}

// ApplyItem สร้าง/แก้รายการหนึ่งของตาราง (expect: 0 = ต้องยังไม่มี, >0 = ต้องเป็นเวอร์ชันนี้) คืนเวอร์ชันแถวใหม่
func (m *DataManager) ApplyItem(ctx context.Context, table, id string, raw []byte, expect int64, note, userID string) (int64, error) {
	if gamedata.TableByName(table) == nil {
		return 0, fmt.Errorf("%w: %s", ErrUnknownCat, table)
	}
	b, err := validateItem(table, id, raw)
	if err != nil {
		return 0, invalid(err)
	}
	res, err := m.Save(ctx, store.SaveInput{Ops: []store.TableOp{{Table: table, ID: id, Data: b, Expect: &expect}}, Note: note, UserID: userID})
	if err != nil {
		return 0, err
	}
	return res.RowIDs[table+"/"+id], nil
}

// DeleteItem ลบรายการหนึ่งของตาราง (ถูกอ้างอิงอยู่ = ErrRefs)
func (m *DataManager) DeleteItem(ctx context.Context, table, id string, expect int64, note, userID string) error {
	if gamedata.TableByName(table) == nil {
		return fmt.Errorf("%w: %s", ErrUnknownCat, table)
	}
	_, err := m.Save(ctx, store.SaveInput{Ops: []store.TableOp{{Table: table, ID: id, Delete: true, Expect: &expect}}, Note: note, UserID: userID})
	return err
}

// Replace นำเข้าเอกสารทั้งชุด: เขียนเฉพาะส่วนที่ต่างจากที่ใช้งานอยู่ (ไม่ตรวจ If-Match — ใช้กับการนำเข้า/สคริปต์)
// รายการของตารางที่หายไปจากเอกสารที่นำเข้าจะถูกลบ
func (m *DataManager) Replace(ctx context.Context, raw []byte, note, userID string) (store.SaveResult, error) {
	cfg, tables, err := gamedata.SplitDoc(raw)
	if err != nil {
		return store.SaveResult{}, invalid(err)
	}
	m.mu.RLock()
	cur := m.data.Raw
	m.mu.RUnlock()
	curCfg, curTables, err := gamedata.SplitDoc(cur)
	if err != nil {
		return store.SaveResult{}, err
	}
	in := store.SaveInput{Config: map[string][]byte{}, Note: note, UserID: userID}
	for name, p := range cfg {
		var a, b bytes.Buffer
		if json.Compact(&a, p) != nil || json.Compact(&b, curCfg[name]) != nil {
			return store.SaveResult{}, invalid(fmt.Errorf("หมวด %s ไม่ใช่ JSON", name))
		}
		if !bytes.Equal(a.Bytes(), b.Bytes()) {
			in.Config[name] = a.Bytes()
		}
	}
	var upserts, deletes []store.TableOp
	for _, t := range gamedata.Tables {
		want := map[string]bool{}
		have := map[string][]byte{}
		for _, it := range curTables[t.Name] {
			var h struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(it, &h)
			var c bytes.Buffer
			_ = json.Compact(&c, it)
			have[h.ID] = c.Bytes()
		}
		for _, it := range tables[t.Name] {
			b, err := validateItem(t.Name, "", it)
			if err != nil {
				return store.SaveResult{}, invalid(err)
			}
			var h struct {
				ID string `json:"id"`
			}
			_ = json.Unmarshal(b, &h)
			if want[h.ID] {
				return store.SaveResult{}, invalid(fmt.Errorf("id ซ้ำใน %s: %s", t.Name, h.ID))
			}
			want[h.ID] = true
			if !bytes.Equal(have[h.ID], b) {
				upserts = append(upserts, store.TableOp{Table: t.Name, ID: h.ID, Data: b})
			}
		}
		for id := range have {
			if !want[id] {
				deletes = append(deletes, store.TableOp{Table: t.Name, ID: id, Delete: true})
			}
		}
	}
	// ลบรายการที่ถูกอ้างอิงก่อน (ตารางท้ายลำดับพึ่งพาก่อน) แล้วค่อยสร้าง/แก้ตามลำดับพึ่งพา
	for i := len(deletes) - 1; i >= 0; i-- {
		in.Ops = append(in.Ops, deletes[i])
	}
	in.Ops = append(in.Ops, upserts...)
	return m.Save(ctx, in)
}

// RollbackCategory ย้อนหมวดเอกสารไปเป็นข้อมูลของเวอร์ชันที่เลือก (สร้างเป็นเวอร์ชันใหม่ ไม่ลบประวัติ; ตรวจความสอดคล้องก่อน)
func (m *DataManager) RollbackCategory(ctx context.Context, category string, versionID int64, userID string) (int64, error) {
	if gamedata.CategoryByName(category) == nil {
		return 0, fmt.Errorf("%w: %s", ErrUnknownCat, category)
	}
	row, err := m.db.GameConfigVersion(ctx, category, versionID)
	if err != nil {
		return 0, err
	}
	res, err := m.Save(ctx, store.SaveInput{Config: map[string][]byte{category: row.Data}, Note: "rollback to #" + strconv.FormatInt(versionID, 10), UserID: userID})
	if err != nil {
		return 0, err
	}
	return res.ConfigIDs[category], nil
}

// RestoreItem กู้รายการของตารางไปเป็นสถานะตามบรรทัดประวัติที่เลือก (ถ้ารายการถูกลบไปแล้วจะสร้างกลับ)
func (m *DataManager) RestoreItem(ctx context.Context, table, id string, auditID int64, userID string) (int64, error) {
	if gamedata.TableByName(table) == nil {
		return 0, fmt.Errorf("%w: %s", ErrUnknownCat, table)
	}
	snap, err := m.db.AuditSnapshot(ctx, table, id, auditID)
	if err != nil {
		return 0, err
	}
	b, err := validateItem(table, id, snap)
	if err != nil {
		return 0, invalid(err)
	}
	res, err := m.Save(ctx, store.SaveInput{Ops: []store.TableOp{{Table: table, ID: id, Data: b}}, Note: "restore from audit #" + strconv.FormatInt(auditID, 10), UserID: userID})
	if err != nil {
		return 0, err
	}
	return res.RowIDs[table+"/"+id], nil
}
