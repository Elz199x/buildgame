// Package realtime: WebSocket hub — เชื่อมไคลเอนต์ที่ล็อกอินแล้วเข้ากับโลกเกม (เฟรมไบนารี 0xC7)
package realtime

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"

	"catquest-ro/server/internal/game"
	"catquest-ro/server/internal/protocol"
	"catquest-ro/server/internal/sim"
	"catquest-ro/server/internal/store"
)

const (
	maxFrameBytes        = 2048
	writeWait            = 10 * time.Second
	pongWait             = 75 * time.Second
	pingEvery            = 20 * time.Second
	sendBuffer           = 128
	maxDroppedBeforeKick = 300
	chatMinInterval      = 400 * time.Millisecond
	msgRatePerSec        = 250.0
	msgBurst             = 400.0
	chatHistory          = 20
)

// Identity คือผู้ใช้ที่ผ่านการยืนยันตัวตนแล้ว (กำหนดโดยชั้น HTTP)
type Identity struct {
	UserID   string
	Username string
}

type chatItem struct {
	channel          int
	charID, who, txt string
}

type Hub struct {
	world      *game.World
	db         *store.Store
	maxClients int
	origins    map[string]bool
	upgrader   websocket.Upgrader

	mu     sync.RWMutex
	byUID  map[uint32]*Client
	byUser map[string]*Client
	chatQ  chan chatItem
}

func NewHub(world *game.World, db *store.Store, maxClients int, origins []string) *Hub {
	h := &Hub{world: world, db: db, maxClients: maxClients, origins: map[string]bool{},
		byUID: map[uint32]*Client{}, byUser: map[string]*Client{}, chatQ: make(chan chatItem, 256)}
	for _, o := range origins {
		if o = strings.TrimRight(strings.TrimSpace(o), "/"); o != "" {
			h.origins[strings.ToLower(o)] = true
		}
	}
	h.upgrader = websocket.Upgrader{ReadBufferSize: 2048, WriteBufferSize: 8192, CheckOrigin: h.checkOrigin}
	return h
}

// OriginAllowed ใช้ร่วมกับ CORS ของ REST
func (h *Hub) OriginAllowed(o string) bool {
	return h.origins[strings.ToLower(strings.TrimRight(o, "/"))]
}

// checkOrigin: อนุญาต Origin ที่ตั้งไว้ หรือโฮสต์เดียวกัน; เบราว์เซอร์ที่ไม่มี Origin (เครื่องมือ CLI) ผ่านได้
// เพราะการเข้าถึงต้องมี session cookie อยู่แล้ว
func (h *Hub) checkOrigin(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	if h.OriginAllowed(o) {
		return true
	}
	u, err := url.Parse(o)
	return err == nil && strings.EqualFold(u.Host, r.Host)
}

func (h *Hub) Count() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return len(h.byUID)
}

// Run ทำงานเบื้องหลัง: บันทึกแชทลงฐานข้อมูล จนกว่า ctx จะถูกยกเลิก
func (h *Hub) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case it := <-h.chatQ:
			c, cancel := context.WithTimeout(ctx, 3*time.Second)
			if err := h.db.InsertChat(c, it.channel, it.charID, it.who, it.txt); err != nil {
				slog.Warn("บันทึกแชทไม่สำเร็จ", "err", err)
			}
			cancel()
		}
	}
}

// KickUser ตัดการเชื่อมต่อของผู้ใช้ (ตอนออกจากระบบ/ปิดบัญชี)
func (h *Hub) KickUser(userID string) {
	h.mu.RLock()
	c := h.byUser[userID]
	h.mu.RUnlock()
	if c != nil {
		c.conn.Close()
	}
}

// RefreshCharacter แจ้งโลกเกมว่า state ของตัวละครเปลี่ยน (คำนวณสเตตัสใหม่)
func (h *Hub) RefreshCharacter(userID string, state json.RawMessage) {
	h.mu.RLock()
	c := h.byUser[userID]
	h.mu.RUnlock()
	if c != nil {
		if err := h.world.RefreshState(c.player.UID, state); err != nil {
			slog.Warn("รีเฟรช state ไม่สำเร็จ", "uid", c.player.UID, "err", err)
		}
	}
}

// Broadcast ส่งเฟรมให้ทุกคน; ไคลเอนต์ที่ช้าเกินไปจะถูกตัดการเชื่อมต่อ
func (h *Hub) Broadcast(frame []byte) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, c := range h.byUID {
		c.push(frame)
	}
}

// Flush กระจายเหตุการณ์ที่โลกเกมสร้างขึ้น
func (h *Hub) Flush() {
	o := h.world.TakeOutbox()
	for _, f := range o.Broadcast {
		h.Broadcast(f)
	}
	if len(o.Direct) == 0 {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for uid, frames := range o.Direct {
		if c := h.byUID[uid]; c != nil {
			for _, f := range frames {
				c.push(f)
			}
		}
	}
}

type Client struct {
	hub      *Hub
	conn     *websocket.Conn
	player   *game.Player
	ident    Identity
	charID   string
	name     string
	send     chan []byte
	dropped  atomic.Int32
	tokens   float64
	refill   time.Time
	lastChat time.Time
	closed   sync.Once
}

func (c *Client) push(f []byte) {
	select {
	case c.send <- f:
		c.dropped.Store(0)
	default:
		if c.dropped.Add(1) > maxDroppedBeforeKick {
			go c.conn.Close()
		}
	}
}

// ServeWS อัปเกรดเป็น WebSocket สำหรับผู้ใช้ที่ล็อกอินแล้ว (ต้องมี Identity จากชั้น HTTP)
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request, id Identity) {
	if h.Count() >= h.maxClients {
		http.Error(w, "เซิร์ฟเวอร์เต็ม", http.StatusServiceUnavailable)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	char, err := h.db.CharacterByUser(ctx, id.UserID)
	cancel()
	if err != nil {
		http.Error(w, "ไม่พบตัวละคร", http.StatusNotFound)
		return
	}
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	p, err := h.world.AddPlayer(game.PlayerInit{UserID: id.UserID, CharID: char.ID, Name: char.Name, StateJSON: char.State, X: char.PosX, Y: char.PosY})
	if err != nil {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "state ไม่ถูกต้อง"), time.Now().Add(time.Second))
		conn.Close()
		return
	}
	c := &Client{hub: h, conn: conn, player: p, ident: id, charID: char.ID, name: char.Name,
		send: make(chan []byte, sendBuffer), tokens: msgBurst, refill: time.Now()}

	h.mu.Lock()
	old := h.byUser[id.UserID] // 1 ผู้ใช้ต่อ 1 การเชื่อมต่อ: เซสชันใหม่เตะอันเก่า
	h.byUID[p.UID] = c
	h.byUser[id.UserID] = c
	n := len(h.byUID)
	h.mu.Unlock()
	if old != nil {
		old.conn.Close()
	}
	slog.Info("ผู้เล่นเข้าร่วม", "uid", p.UID, "user", id.Username, "online", n)

	c.send <- protocol.EncodeWelcome(p.UID)
	// ประวัติแชทล่าสุด (เฉพาะผู้เข้าใหม่)
	hctx, hcancel := context.WithTimeout(context.Background(), 2*time.Second)
	if msgs, err := h.db.RecentChat(hctx, chatHistory); err == nil {
		for _, m := range msgs {
			c.send <- protocol.EncodeChat(uint8(m.Channel), m.Sender, m.Body)
		}
	}
	hcancel()

	go c.writePump()
	go c.readPump()
}

func (c *Client) close() {
	c.closed.Do(func() {
		h := c.hub
		uid := c.player.UID
		x, y, ok := h.world.Position(uid)
		h.mu.Lock()
		delete(h.byUID, uid)
		if h.byUser[c.ident.UserID] == c {
			delete(h.byUser, c.ident.UserID)
		}
		n := len(h.byUID)
		h.mu.Unlock()
		save := h.world.RemovePlayerSave(uid)
		c.conn.Close()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if ok {
			if err := h.db.SaveCharacterPosition(ctx, c.charID, "map_prontera", x, y); err != nil {
				slog.Warn("บันทึกตำแหน่งไม่สำเร็จ", "err", err)
			}
		}
		if save != nil { // ความก้าวหน้าที่ยังไม่ได้บันทึก (EXP/ไอเทม) ต้องไม่หายตอนออกจากเกม
			if err := h.saveDirty(ctx, *save); err != nil {
				slog.Error("บันทึกตัวละครตอนออกไม่สำเร็จ", "char", c.charID, "err", err)
			}
		}
		slog.Info("ผู้เล่นออก", "uid", uid, "user", c.ident.Username, "online", n)
	})
}

func (c *Client) allow(now time.Time) bool {
	c.tokens += now.Sub(c.refill).Seconds() * msgRatePerSec
	if c.tokens > msgBurst {
		c.tokens = msgBurst
	}
	c.refill = now
	if c.tokens < 1 {
		return false
	}
	c.tokens--
	return true
}

func (c *Client) readPump() {
	defer c.close()
	c.conn.SetReadLimit(maxFrameBytes)
	_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error { return c.conn.SetReadDeadline(time.Now().Add(pongWait)) })
	for {
		mt, frame, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(pongWait))
		if mt != websocket.BinaryMessage || len(frame) < 4 || frame[0] != protocol.Magic || frame[1] != protocol.Version {
			continue
		}
		if !c.allow(time.Now()) {
			continue
		}
		c.handle(frame)
		c.hub.Flush()
	}
}

func (c *Client) handle(f []byte) {
	w := c.hub.world
	uid := c.player.UID
	switch f[2] {
	case protocol.OpPing:
		if ts, ok := protocol.DecodePing(f); ok {
			c.push(protocol.EncodePong(ts, w.Tick()))
		}
	case protocol.OpMove:
		if m, ok := protocol.DecodeMove(f); ok {
			w.HandleMove(uid, m)
		}
	case protocol.OpAttack:
		if a, ok := protocol.DecodeAttack(f); ok {
			w.HandleAttack(uid, a.TargetUID)
		}
	case protocol.OpSkill:
		if s, ok := protocol.DecodeSkill(f); ok {
			w.HandleSkill(uid, int(s.SkillIdx), s.TargetUID)
		}
	case protocol.OpUseItem:
		if u, ok := protocol.DecodeUseItem(f); ok {
			w.HandleUseItem(uid, int(u.ItemIdx))
		}
	case protocol.OpRoll:
		if r, ok := protocol.DecodeRoll(f); ok {
			w.HandleRoll(uid, r)
		}
	case protocol.OpChat:
		m, ok := protocol.DecodeChat(f)
		now := time.Now()
		if !ok || m.Text == "" || now.Sub(c.lastChat) < chatMinInterval {
			return
		}
		c.lastChat = now
		ch := m.Channel
		if ch > 3 {
			ch = 0
		}
		// ไม่เชื่อชื่อผู้ส่งที่ไคลเอนต์บอกมา — ใช้ชื่อตัวละครที่ผูกกับบัญชี
		c.hub.Broadcast(protocol.EncodeChat(ch, c.name, m.Text))
		select {
		case c.hub.chatQ <- chatItem{int(ch), c.charID, c.name, m.Text}:
		default: // คิวเต็ม: ข้ามการบันทึก (ไม่ให้ถ่วงเกม)
		}
	}
}

func (c *Client) writePump() {
	t := time.NewTicker(pingEvery)
	defer func() {
		t.Stop()
		c.close()
	}()
	for {
		select {
		case f := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.BinaryMessage, f); err != nil {
				return
			}
		case <-t.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// RunLoop: Fixed-timestep 30Hz — อัปเดตโลก → กระจายเหตุการณ์ → ส่ง snapshot ทุก 2 tick (15Hz)
func (h *Hub) RunLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second / game.TickHz)
	defer ticker.Stop()
	last := time.Now()
	n := 0
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			dt := float32(now.Sub(last).Seconds())
			last = now
			if dt > 0.1 {
				dt = 0.1
			}
			h.world.Step(dt)
			h.Flush()
			if n++; n%2 == 0 && h.Count() > 0 {
				h.Broadcast(h.world.Snapshot())
			}
		}
	}
}

func (h *Hub) saveDirty(ctx context.Context, d game.DirtyChar) error {
	return h.db.SaveCharacterState(ctx, d.CharID, d.State, store.StateColumns{
		ClassID: d.Cols.ClassID, BaseLv: d.Cols.BaseLv, JobLv: d.Cols.JobLv, BaseExp: d.Cols.BaseExp, JobExp: d.Cols.JobExp, Gold: d.Cols.Gold,
	})
}

// FlushDirty บันทึกตัวละครที่ความก้าวหน้าเปลี่ยนลงฐานข้อมูล (ถ้าบันทึกไม่ได้ จะลองใหม่รอบถัดไป)
func (h *Hub) FlushDirty(ctx context.Context) {
	for _, d := range h.world.DrainDirty() {
		if err := h.saveDirty(ctx, d); err != nil {
			slog.Error("บันทึกตัวละครไม่สำเร็จ (จะลองใหม่)", "char", d.CharID, "err", err)
			h.world.Requeue(d.CharID)
		}
	}
}

// SaveLoop บันทึกความก้าวหน้าของผู้เล่นออนไลน์ทุก 3 วินาทีจนกว่า ctx จะถูกยกเลิก
func (h *Hub) SaveLoop(ctx context.Context) {
	t := time.NewTicker(3 * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c, cancel := context.WithTimeout(ctx, 5*time.Second)
			h.FlushDirty(c)
			cancel()
		}
	}
}

// MutateOnline แก้ state ของผู้เล่นที่ออนไลน์ (ใต้ล็อกของโลกเกม); found=false ถ้าไม่ได้ออนไลน์
func (h *Hub) MutateOnline(userID string, fn func(*sim.State) error) (json.RawMessage, bool, error) {
	return h.world.MutateByUser(userID, fn)
}

// PeekOnline คืน state สดของผู้เล่นที่ออนไลน์
func (h *Hub) PeekOnline(userID string) (json.RawMessage, bool) { return h.world.PeekByUser(userID) }
