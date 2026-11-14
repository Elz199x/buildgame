// Package httpapi: REST API (gin) + ทางเข้า WebSocket — บัญชีผู้ใช้, ข้อมูลเกม, ตัวละคร, คำสั่งเกม, ตัวจำลอง
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"catquest-ro/server/internal/auth"
	"catquest-ro/server/internal/charsvc"
	"catquest-ro/server/internal/config"
	"catquest-ro/server/internal/game"
	"catquest-ro/server/internal/progress"
	"catquest-ro/server/internal/realtime"
	"catquest-ro/server/internal/sim"
	"catquest-ro/server/internal/store"
)

const (
	sessionCookie = "cq_session"
	userKey       = "user"
)

type Server struct {
	cfg   config.Config
	db    *store.Store
	hub   *realtime.Hub
	world *game.World
	data  *DataManager
	svc   *charsvc.Service
	sims  *simManager

	loginIP, loginUser, registerIP, writeLimit, simLimit, advanceLimit *auth.Limiter
	hashSem, simSem                                                    chan struct{} // จำกัดงานหนัก (argon2 / จำลอง) พร้อมกัน
}

type Deps struct {
	Cfg   config.Config
	DB    *store.Store
	Hub   *realtime.Hub
	World *game.World
	Data  *DataManager
}

func New(d Deps) *Server {
	s := &Server{
		cfg: d.Cfg, db: d.DB, hub: d.Hub, world: d.World, data: d.Data, sims: newSimManager(),
		loginIP:      auth.NewLimiter(30, 15),   // 30 ครั้ง/นาทีต่อ IP (burst 15)
		loginUser:    auth.NewLimiter(6, 5),     // 6 ครั้ง/นาทีต่อชื่อผู้ใช้ — กันเดารหัสผ่านบัญชีเดียวจากหลาย IP
		registerIP:   auth.NewLimiter(6, 5),     // สมัครได้ 6 บัญชี/นาทีต่อ IP
		writeLimit:   auth.NewLimiter(120, 30),  // คำสั่งเกม/บันทึกตัวละคร ต่อผู้ใช้
		simLimit:     auth.NewLimiter(30, 10),   // งานจำลองหนัก ต่อผู้ใช้
		advanceLimit: auth.NewLimiter(1200, 60), // ก้าวเวลาของ session หน้า DPS (~20 ครั้ง/วินาที)
		hashSem:      make(chan struct{}, 4),
		simSem:       make(chan struct{}, 4),
	}
	s.svc = &charsvc.Service{DB: d.DB, Online: d.Hub, Engine: func() *sim.Engine { _, e, _ := d.Data.Current(); return e }}
	return s
}

// Service ใช้ร่วมกับโค้ดอื่น (เช่น เทสต์)
func (s *Server) Service() *charsvc.Service { return s.svc }

// Handler คืน http.Handler (gin) พร้อม middleware ทั้งหมด
func (s *Server) Handler() http.Handler {
	gin.SetMode(gin.ReleaseMode)
	r := gin.New()
	r.HandleMethodNotAllowed = true
	r.RedirectTrailingSlash = false
	_ = r.SetTrustedProxies(nil) // เราตัดสิน IP ของลูกค้าเอง (TRUST_PROXY) ไม่ใช้ของ gin
	r.Use(recoverer(), s.accessLog(), securityHeaders(), s.cors(), s.originGuard())
	r.NoRoute(func(c *gin.Context) {
		writeErr(c, http.StatusNotFound, "ไม่พบเส้นทางนี้")
	})
	r.NoMethod(func(c *gin.Context) {
		writeErr(c, http.StatusMethodNotAllowed, "ไม่รองรับเมธอดนี้")
	})

	r.GET("/", func(c *gin.Context) {
		c.JSON(200, gin.H{"service": "catquest-ro game server", "docs": "server/README.md"})
	})
	r.GET("/api/health", s.health)

	a := r.Group("/api/auth")
	a.POST("/register", s.register)
	a.POST("/login", s.login)
	a.POST("/logout", s.logout)
	a.GET("/me", s.requireAuth, s.me)

	api := r.Group("/api", s.requireAuth)
	api.GET("/data", s.getData)
	adm := api.Group("/data", s.requireAdmin)
	adm.PUT("", s.putData)
	adm.PUT("/:category", s.putCategory)
	adm.GET("/versions", s.listVersions)
	adm.POST("/rollback/:category/:id", s.rollbackData)

	tbl := api.Group("/tables", s.requireAdmin)
	tbl.PUT("/:table/:id", s.putItem)
	tbl.DELETE("/:table/:id", s.deleteItem)
	tbl.GET("/:table/:id/history", s.itemHistory)
	tbl.POST("/:table/:id/restore/:auditId", s.restoreItem)

	ch := api.Group("/characters/me")
	ch.GET("", s.getCharacter)
	ch.PUT("/state", s.putCharacterState) // โหมด lab เท่านั้น
	ch.PUT("/prefs", s.putPrefs)
	ch.POST("/mode", s.requireAdmin, s.setMode)

	g := api.Group("/game") // คำสั่งความก้าวหน้า: เซิร์ฟเวอร์ตัดสินทั้งหมด
	g.POST("/learn", s.cmdLearn)
	g.POST("/unlearn", s.cmdUnlearn)
	g.POST("/stat", s.cmdStat)
	g.POST("/equip", s.cmdEquip)
	g.POST("/unequip", s.cmdUnequip)
	g.POST("/weapon", s.cmdWeapon)
	g.POST("/shield", s.cmdShield)
	g.POST("/storage", s.cmdStorage)
	g.POST("/shop", s.cmdShop)
	g.POST("/class", s.cmdClass)

	api.GET("/players", func(c *gin.Context) { c.JSON(200, s.world.Players()) })
	api.GET("/chat/recent", s.recentChat)

	sm := api.Group("/sim")
	sm.POST("/stats", s.simStats)
	sm.POST("/benchmark", s.simBenchmark)
	sm.POST("/builds", s.simBuilds)
	sm.POST("/skills", s.simSkills)
	sm.POST("/rotation", s.simRotation)
	sm.POST("/sessions", s.simCreateSession)
	sm.POST("/sessions/:id/advance", s.simAdvance)
	sm.DELETE("/sessions/:id", s.simDeleteSession)

	r.GET("/ws", s.requireAuth, func(c *gin.Context) {
		u := userOf(c)
		s.hub.ServeWS(c.Writer, c.Request, realtime.Identity{UserID: u.ID, Username: u.Username})
	})
	return r
}

// ---------- ตัวช่วยตอบ JSON ----------

func writeErr(c *gin.Context, status int, msg string) {
	c.Header("Cache-Control", "no-store")
	c.AbortWithStatusJSON(status, gin.H{"error": msg})
}

// decodeJSON อ่านเนื้อหา JSON แบบจำกัดขนาด ปฏิเสธฟิลด์แปลกปลอมเมื่อ strict
func decodeJSON(c *gin.Context, dst any, maxBytes int64, strict bool) bool {
	if ct := c.GetHeader("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		writeErr(c, http.StatusUnsupportedMediaType, "ต้องส่ง Content-Type: application/json")
		return false
	}
	dec := json.NewDecoder(http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes))
	if strict {
		dec.DisallowUnknownFields()
	}
	if err := dec.Decode(dst); err != nil {
		var mbe *http.MaxBytesError
		switch {
		case errors.As(err, &mbe):
			writeErr(c, http.StatusRequestEntityTooLarge, "ข้อมูลใหญ่เกินไป")
		case errors.Is(err, io.EOF):
			writeErr(c, http.StatusBadRequest, "ไม่มีข้อมูลที่ส่งมา")
		default:
			writeErr(c, http.StatusBadRequest, "JSON ไม่ถูกต้อง")
		}
		return false
	}
	return true
}

// clientIP: ใช้ X-Forwarded-For เฉพาะเมื่อตั้ง TRUST_PROXY (อยู่หลัง reverse proxy ที่เชื่อถือได้)
func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			if i := strings.IndexByte(xff, ','); i >= 0 {
				xff = xff[:i]
			}
			if ip := strings.TrimSpace(xff); net.ParseIP(ip) != nil {
				return ip
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// ---------- Middleware ----------

func (s *Server) accessLog() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		if c.Request.URL.Path == "/api/health" {
			return
		}
		st := c.Writer.Status()
		lvl := slog.LevelInfo
		switch {
		case st >= 500:
			lvl = slog.LevelError
		case st >= 400:
			lvl = slog.LevelWarn
		}
		slog.Log(c.Request.Context(), lvl, "http", "method", c.Request.Method, "path", c.Request.URL.Path, "status", st, "ms", time.Since(start).Milliseconds(), "ip", s.clientIP(c.Request))
	}
}

func recoverer() gin.HandlerFunc {
	return gin.CustomRecoveryWithWriter(io.Discard, func(c *gin.Context, v any) {
		slog.Error("panic", "err", v, "path", c.Request.URL.Path)
		writeErr(c, http.StatusInternalServerError, "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์")
	})
}

func securityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		c.Next()
	}
}

// cors อนุญาตเฉพาะ Origin ที่ตั้งไว้ พร้อม credentials (cookie เซสชัน)
func (s *Server) cors() gin.HandlerFunc {
	return func(c *gin.Context) {
		if o := c.GetHeader("Origin"); o != "" && s.hub.OriginAllowed(o) {
			h := c.Writer.Header()
			h.Set("Access-Control-Allow-Origin", o)
			h.Set("Access-Control-Allow-Credentials", "true")
			h.Add("Vary", "Origin")
			h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			h.Set("Access-Control-Allow-Headers", "Content-Type, If-None-Match")
			h.Set("Access-Control-Expose-Headers", "ETag")
			h.Set("Access-Control-Max-Age", "600")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

// originGuard (กัน CSRF): คำขอที่เปลี่ยนสถานะจากเบราว์เซอร์ต้องมาจาก Origin ที่อนุญาตหรือโฮสต์เดียวกัน
// (คู่กับ cookie SameSite=Lax); เครื่องมือที่ไม่มี Origin ผ่านได้เพราะต้องมี cookie อยู่แล้ว
func (s *Server) originGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
		default:
			if o := c.GetHeader("Origin"); o != "" && !s.hub.OriginAllowed(o) && !sameHost(o, c.Request.Host) {
				writeErr(c, http.StatusForbidden, "Origin ไม่ได้รับอนุญาต")
				return
			}
		}
		c.Next()
	}
}

func sameHost(origin, host string) bool {
	i := strings.Index(origin, "://")
	return i >= 0 && strings.EqualFold(origin[i+3:], host)
}

// ---------- เซสชัน ----------

type sessionUser struct {
	ID, Username, Role string
	SessionID          string
}

func userOf(c *gin.Context) *sessionUser {
	v, _ := c.Get(userKey)
	u, _ := v.(*sessionUser)
	return u
}

// requireAuth ตรวจ cookie เซสชัน (และต่ออายุแบบเลื่อน) แล้วใส่ผู้ใช้ลง context
func (s *Server) requireAuth(c *gin.Context) {
	ck, err := c.Cookie(sessionCookie)
	if err != nil || ck == "" || len(ck) > 100 {
		writeErr(c, http.StatusUnauthorized, "กรุณาเข้าสู่ระบบ")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	sess, err := s.db.SessionByTokenHash(ctx, auth.HashToken(ck))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			s.clearCookie(c.Writer)
			writeErr(c, http.StatusUnauthorized, "เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่")
		} else {
			slog.Error("ตรวจเซสชันล้มเหลว", "err", err)
			writeErr(c, http.StatusServiceUnavailable, "ฐานข้อมูลไม่พร้อม")
		}
		return
	}
	if time.Since(sess.LastSeenAt) > time.Hour { // เลื่อนอายุเซสชัน (ไม่เขียนทุกคำขอ)
		exp := time.Now().Add(s.cfg.SessionTTL)
		if err := s.db.ExtendSession(ctx, sess.ID, exp); err == nil {
			s.setCookie(c.Writer, ck, exp)
		}
	}
	c.Set(userKey, &sessionUser{ID: sess.User.ID, Username: sess.User.Username, Role: sess.User.Role, SessionID: sess.ID})
	c.Next()
}

func (s *Server) requireAdmin(c *gin.Context) {
	if u := userOf(c); u == nil || u.Role != "admin" {
		writeErr(c, http.StatusForbidden, "ต้องเป็นผู้ดูแลระบบ")
		return
	}
	c.Next()
}

func (s *Server) setCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: token, Path: "/", Expires: expires, MaxAge: int(time.Until(expires).Seconds()),
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) clearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: sessionCookie, Value: "", Path: "/", MaxAge: -1, Expires: time.Unix(0, 0),
		HttpOnly: true, Secure: s.cfg.CookieSecure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	c.Header("Cache-Control", "no-store")
	if err := s.db.Ping(ctx); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"status": "degraded", "db": false})
		return
	}
	c.JSON(200, gin.H{"status": "ok", "db": true})
}

// ruleStatus แปลงข้อผิดพลาดของคำสั่งเกมเป็น HTTP: ผิดกติกา = 422 (บอกเหตุผลให้ผู้เล่น), ไม่พบ = 404, อื่น ๆ = 500
func ruleStatus(c *gin.Context, err error) {
	var re *progress.RuleError
	switch {
	case errors.As(err, &re):
		writeErr(c, http.StatusUnprocessableEntity, re.Msg)
	case errors.Is(err, store.ErrNotFound):
		writeErr(c, http.StatusNotFound, "ไม่พบตัวละคร")
	default:
		slog.Error("คำสั่งเกมล้มเหลว", "err", err)
		writeErr(c, http.StatusInternalServerError, "ทำรายการไม่สำเร็จ")
	}
}
