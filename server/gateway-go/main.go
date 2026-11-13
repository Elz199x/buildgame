// ============================================================
// Cat Quest × RO — Go WebSocket Gateway & Room/Chat Server
// หน้าที่หลัก:
// 1. รับการเชื่อมต่อ WebSocket แบบ Binary Frame (0xC7 Wire Protocol) จากเบราว์เซอร์ผู้เล่นจำนวนมาก
// 2. จัดการห้อง (Zone Shards), กระจายข้อความแชท (OP_CHAT 0x30) และตอบรับ Ping/Pong (OP_PING 0x01)
// 3. ส่งต่อแพ็กเก็ตการเคลื่อนที่และโจมตี (0x10..0x13) ไปยัง Go Simulation Server (127.0.0.1:9001)
// ============================================================
package main

import (
	"bufio"
	"encoding/binary"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

const (
	MagicByte       byte = 0xC7
	ProtocolVersion byte = 0x01
	OpPing          byte = 0x01
	OpPong          byte = 0x02
	OpAuth          byte = 0x03
	OpMove          byte = 0x10
	OpAttack        byte = 0x11
	OpSkill         byte = 0x12
	OpRoll          byte = 0x13
	OpWorldSnapshot byte = 0x20
	OpDamageEvent   byte = 0x21
	OpChat          byte = 0x30
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  2048,
	WriteBufferSize: 2048,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type Client struct {
	uid   uint32
	conn  *websocket.Conn
	send  chan []byte
	hub   *Hub
	name  string
	class byte
}

type Hub struct {
	mu         sync.RWMutex
	clients    map[uint32]*Client
	broadcast  chan []byte
	simConn    net.Conn
	serverTick uint32
}

func NewHub() *Hub {
	h := &Hub{
		clients:   make(map[uint32]*Client),
		broadcast: make(chan []byte, 512),
	}
	// เชื่อมต่อ IPC ไปยัง Go Simulation Server (ถ้าเปิดอยู่)
	if conn, err := net.DialTimeout("tcp", "127.0.0.1:9001", 500*time.Millisecond); err == nil {
		log.Println("[Go Gateway] Connected to Go Simulation Engine at 127.0.0.1:9001")
		h.simConn = conn
		go h.readSim(conn)
	} else {
		log.Println("[Go Gateway] Go Sim Engine not running yet; running in standalone Gateway relay mode")
	}
	return h
}

// readSim อ่านเฟรม OP_WORLD_SNAPSHOT จาก Sim Server แล้วกระจายให้ผู้เล่นทุกคน
// ขนาดเฟรม = 10 + peers*16 + mobs*16 (ดู 05b-net-codec.js)
func (h *Hub) readSim(conn net.Conn) {
	r := bufio.NewReader(conn)
	for {
		hdr := make([]byte, 10)
		if _, err := io.ReadFull(r, hdr); err != nil {
			log.Println("[Go Gateway] Sim connection closed:", err)
			h.simConn = nil
			return
		}
		if hdr[0] != MagicByte || hdr[2] != OpWorldSnapshot {
			continue
		}
		rest := (int(hdr[8]) + int(hdr[9])) * 16
		frame := make([]byte, 10+rest)
		copy(frame, hdr)
		if _, err := io.ReadFull(r, frame[10:]); err != nil {
			return
		}
		select {
		case h.broadcast <- frame:
		default:
		}
	}
}

func (h *Hub) Run() {
	ticker := time.NewTicker(33 * time.Millisecond) // 30 Hz
	defer ticker.Stop()
	for {
		select {
		case frame := <-h.broadcast:
			h.mu.RLock()
			for _, cl := range h.clients {
				select {
				case cl.send <- frame:
				default:
				}
			}
			h.mu.RUnlock()
		case <-ticker.C:
			atomic.AddUint32(&h.serverTick, 1)
		}
	}
}

func makePongFrame(clientTs float64, tick uint32) []byte {
	buf := make([]byte, 16)
	buf[0] = MagicByte
	buf[1] = ProtocolVersion
	buf[2] = OpPong
	buf[3] = 1
	binary.LittleEndian.PutUint64(buf[4:12], math.Float64bits(clientTs))
	binary.LittleEndian.PutUint32(buf[12:16], tick)
	return buf
}

func (c *Client) readPump() {
	defer func() {
		c.hub.mu.Lock()
		delete(c.hub.clients, c.uid)
		c.hub.mu.Unlock()
		c.conn.Close()
	}()
	for {
		msgType, frame, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		if msgType != websocket.BinaryMessage || len(frame) < 4 || frame[0] != MagicByte {
			continue
		}
		op := frame[2]
		switch op {
		case OpPing:
			if len(frame) >= 12 {
				ts := math.Float64frombits(binary.LittleEndian.Uint64(frame[4:12]))
				pong := makePongFrame(ts, atomic.LoadUint32(&c.hub.serverTick))
				c.send <- pong
			}
		case OpChat:
			// กระจายเฟรมแชทไบนารีไปยังผู้เล่นทุกคนในห้องทันที
			c.hub.broadcast <- frame
		case OpMove, OpAttack, OpSkill, OpRoll:
			if c.hub.simConn != nil {
				_, _ = c.hub.simConn.Write(frame)
			}
			c.hub.broadcast <- frame
		}
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()
	for frame := range c.send {
		if err := c.conn.WriteMessage(websocket.BinaryMessage, frame); err != nil {
			break
		}
	}
}

var nextUID uint32 = 1000

func main() {
	hub := NewHub()
	go hub.Run()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		uid := atomic.AddUint32(&nextUID, 1)
		cl := &Client{
			uid:  uid,
			conn: conn,
			send: make(chan []byte, 128),
			hub:  hub,
		}
		hub.mu.Lock()
		hub.clients[uid] = cl
		hub.mu.Unlock()
		log.Printf("[Go Gateway] Player #%d connected (%d online)", uid, len(hub.clients))

		go cl.writePump()
		go cl.readPump()
	})

	log.Println("[Go Gateway] Listening on ws://localhost:8080/ws (Binary FlatBuffers Wire Protocol)")
	log.Fatal(http.ListenAndServe(":8080", nil))
}
