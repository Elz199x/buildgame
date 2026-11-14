package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"catquest-ro/server/internal/auth"
	"catquest-ro/server/internal/store"
)

type credentials struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type userDTO struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type characterDTO struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	ClassID   string    `json:"classId"`
	BaseLv    int       `json:"baseLv"`
	JobLv     int       `json:"jobLv"`
	Gold      int64     `json:"gold"`
	Mode      string    `json:"mode"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func toCharacterDTO(c store.Character) characterDTO {
	return characterDTO{c.ID, c.Name, c.ClassID, c.BaseLv, c.JobLv, c.Gold, c.Mode, c.UpdatedAt}
}

// withHashSlot จำกัดงาน argon2 พร้อมกัน (ใช้หน่วยความจำ/CPU มาก — กัน DoS)
func (s *Server) withHashSlot(ctx context.Context, f func()) error {
	select {
	case s.hashSem <- struct{}{}:
		defer func() { <-s.hashSem }()
		f()
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Server) hash(ctx context.Context, pw string) (h string, err error) {
	if e := s.withHashSlot(ctx, func() { h, err = auth.HashPassword(pw, s.cfg.Argon) }); e != nil {
		return "", e
	}
	return h, err
}

func (s *Server) verify(ctx context.Context, pw, hash string) (ok, rehash bool, err error) {
	err = s.withHashSlot(ctx, func() { ok, rehash = auth.VerifyPassword(pw, hash, s.cfg.Argon) })
	return ok, rehash, err
}

func (s *Server) burn(ctx context.Context, pw string) {
	_ = s.withHashSlot(ctx, func() { auth.BurnTime(pw, s.cfg.Argon) })
}

// startSession สร้างเซสชันใหม่ทุกครั้ง (กัน session fixation) แล้วตั้ง cookie
func (s *Server) startSession(ctx context.Context, c *gin.Context, userID string) error {
	raw, hash, err := auth.NewToken()
	if err != nil {
		return err
	}
	exp := time.Now().Add(s.cfg.SessionTTL)
	if err := s.db.CreateSession(ctx, userID, hash, exp, s.clientIP(c.Request), c.Request.UserAgent()); err != nil {
		return err
	}
	s.setCookie(c.Writer, raw, exp)
	return nil
}

func (s *Server) register(c *gin.Context) {
	var in credentials
	if !decodeJSON(c, &in, 4<<10, true) {
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if !auth.ValidUsername(in.Username) {
		writeErr(c, http.StatusBadRequest, "ชื่อผู้ใช้ต้องเป็น a-z A-Z 0-9 _ ยาว 3–20 ตัวอักษร")
		return
	}
	if msg := auth.ValidatePassword(in.Password, in.Username); msg != "" {
		writeErr(c, http.StatusBadRequest, msg)
		return
	}
	// จำกัดอัตราหลังตรวจรูปแบบแล้วเท่านั้น (คำขอที่ผิดรูปแบบไม่มีต้นทุน จึงไม่นับ)
	if !s.registerIP.Allow(s.clientIP(c.Request)) {
		writeErr(c, http.StatusTooManyRequests, "สมัครถี่เกินไป กรุณารอสักครู่")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	hash, err := s.hash(ctx, in.Password)
	if err != nil {
		writeErr(c, http.StatusServiceUnavailable, "เซิร์ฟเวอร์ไม่ว่าง ลองใหม่อีกครั้ง")
		return
	}
	state, cols, err := s.svc.NewState()
	if err != nil {
		slog.Error("สร้างตัวละครใหม่ไม่สำเร็จ", "err", err)
		writeErr(c, http.StatusInternalServerError, "สมัครสมาชิกไม่สำเร็จ")
		return
	}
	u, ch, err := s.db.CreateUserWithCharacter(ctx, in.Username, hash, s.cfg.FirstUserIsAdmin, state, cols)
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			writeErr(c, http.StatusConflict, "ชื่อผู้ใช้นี้ถูกใช้แล้ว")
			return
		}
		slog.Error("สมัครสมาชิกล้มเหลว", "err", err)
		writeErr(c, http.StatusInternalServerError, "สมัครสมาชิกไม่สำเร็จ")
		return
	}
	if err := s.startSession(ctx, c, u.ID); err != nil {
		slog.Error("สร้างเซสชันล้มเหลว", "err", err)
		writeErr(c, http.StatusInternalServerError, "สร้างเซสชันไม่สำเร็จ")
		return
	}
	slog.Info("สมัครสมาชิกใหม่", "user", u.Username, "role", u.Role)
	c.JSON(http.StatusCreated, gin.H{"user": userDTO{u.ID, u.Username, u.Role}, "character": toCharacterDTO(ch)})
}

const badLogin = "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"

func (s *Server) login(c *gin.Context) {
	if !s.loginIP.Allow(s.clientIP(c.Request)) {
		writeErr(c, http.StatusTooManyRequests, "ลองถี่เกินไป กรุณารอสักครู่")
		return
	}
	var in credentials
	if !decodeJSON(c, &in, 4<<10, true) {
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if in.Username == "" || in.Password == "" || len(in.Password) > auth.MaxPasswordBytes || len(in.Username) > 64 {
		writeErr(c, http.StatusUnauthorized, badLogin)
		return
	}
	if !s.loginUser.Allow(strings.ToLower(in.Username)) {
		writeErr(c, http.StatusTooManyRequests, "บัญชีนี้ถูกลองเข้าสู่ระบบถี่เกินไป กรุณารอสักครู่")
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	u, err := s.db.UserByUsername(ctx, in.Username)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			s.burn(ctx, in.Password) // ใช้เวลาเท่ากรณีรหัสผิด
			writeErr(c, http.StatusUnauthorized, badLogin)
			return
		}
		slog.Error("ค้นหาผู้ใช้ล้มเหลว", "err", err)
		writeErr(c, http.StatusServiceUnavailable, "ฐานข้อมูลไม่พร้อม")
		return
	}
	ok, rehash, err := s.verify(ctx, in.Password, u.PasswordHash)
	if err != nil {
		writeErr(c, http.StatusServiceUnavailable, "เซิร์ฟเวอร์ไม่ว่าง ลองใหม่อีกครั้ง")
		return
	}
	if !ok || u.Disabled {
		writeErr(c, http.StatusUnauthorized, badLogin)
		return
	}
	if rehash { // พารามิเตอร์แฮชเก่ากว่าปัจจุบัน: อัปเกรดเงียบ ๆ
		if h, err := s.hash(ctx, in.Password); err == nil {
			_ = s.db.UpdatePasswordHash(ctx, u.ID, h)
		}
	}
	_ = s.db.TouchLogin(ctx, u.ID)
	if err := s.startSession(ctx, c, u.ID); err != nil {
		slog.Error("สร้างเซสชันล้มเหลว", "err", err)
		writeErr(c, http.StatusInternalServerError, "สร้างเซสชันไม่สำเร็จ")
		return
	}
	slog.Info("เข้าสู่ระบบ", "user", u.Username)
	resp := gin.H{"user": userDTO{u.ID, u.Username, u.Role}}
	if ch, err := s.db.CharacterByUser(ctx, u.ID); err == nil {
		resp["character"] = toCharacterDTO(ch)
	}
	c.JSON(http.StatusOK, resp)
}

// logout ลบเซสชันฝั่งเซิร์ฟเวอร์ ตัดการเชื่อมต่อเกมของผู้ใช้ และล้าง cookie (ทำงานแม้ cookie ไม่ถูกต้อง)
func (s *Server) logout(c *gin.Context) {
	if ck, err := c.Cookie(sessionCookie); err == nil && ck != "" {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		defer cancel()
		if uid, err := s.db.DeleteSessionByTokenHash(ctx, auth.HashToken(ck)); err == nil {
			s.hub.KickUser(uid)
		}
	}
	s.clearCookie(c.Writer)
	c.Status(http.StatusNoContent)
}

func (s *Server) me(c *gin.Context) {
	u := userOf(c)
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()
	resp := gin.H{"user": userDTO{u.ID, u.Username, u.Role}}
	if ch, err := s.db.CharacterByUser(ctx, u.ID); err == nil {
		resp["character"] = toCharacterDTO(ch)
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, resp)
}
