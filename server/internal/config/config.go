// Package config โหลดค่าตั้งค่าจากตัวแปรสภาพแวดล้อม (12-factor) พร้อมตรวจความถูกต้อง
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"catquest-ro/server/internal/auth"
)

type Config struct {
	Env              string // development | production
	ListenAddr       string
	DatabaseURL      string
	DBWait           time.Duration
	AllowedOrigins   []string
	CookieSecure     bool
	SessionTTL       time.Duration
	FirstUserIsAdmin bool
	MaxClients       int
	TrustProxy       bool
	Argon            auth.Params
	LogJSON          bool
}

// DevDatabaseURL ค่าเริ่มต้นสำหรับพัฒนา (ตรงกับ docker-compose.yml) — ห้ามใช้จริงใน production
const DevDatabaseURL = "postgres://catquest:catquest_dev_password@127.0.0.1:5433/catquest?sslmode=disable"

func get(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func getBool(key string, def bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	switch v {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	}
	return def
}

func getInt(key string, def int) (int, error) {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s ต้องเป็นจำนวนเต็ม", key)
	}
	return n, nil
}

// Load อ่านค่าและตรวจสอบ; ใน production บังคับตั้ง DATABASE_URL / ALLOWED_ORIGINS เองและห้ามใช้ค่าเริ่มต้นของ dev
func Load() (Config, error) {
	prod := strings.EqualFold(get("APP_ENV", "development"), "production")
	c := Config{
		Env:              map[bool]string{true: "production", false: "development"}[prod],
		ListenAddr:       get("LISTEN_ADDR", "127.0.0.1:8080"),
		DatabaseURL:      get("DATABASE_URL", ""),
		AllowedOrigins:   splitCSV(get("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")),
		CookieSecure:     getBool("COOKIE_SECURE", prod),
		FirstUserIsAdmin: getBool("FIRST_USER_IS_ADMIN", !prod),
		TrustProxy:       getBool("TRUST_PROXY", false),
		LogJSON:          getBool("LOG_JSON", prod),
		Argon:            auth.DefaultParams,
	}
	var err error
	if c.MaxClients, err = getInt("MAX_CLIENTS", 200); err != nil || c.MaxClients < 1 {
		return c, errors.New("MAX_CLIENTS ต้องเป็นจำนวนเต็มบวก")
	}
	days, err := getInt("SESSION_DAYS", 14)
	if err != nil || days < 1 || days > 365 {
		return c, errors.New("SESSION_DAYS ต้องอยู่ระหว่าง 1–365")
	}
	c.SessionTTL = time.Duration(days) * 24 * time.Hour
	wait, err := getInt("DB_WAIT_SECONDS", 30)
	if err != nil || wait < 0 {
		return c, errors.New("DB_WAIT_SECONDS ไม่ถูกต้อง")
	}
	c.DBWait = time.Duration(wait) * time.Second

	if c.DatabaseURL == "" {
		if prod {
			return c, errors.New("production ต้องตั้ง DATABASE_URL")
		}
		c.DatabaseURL = DevDatabaseURL
	}
	if prod {
		if c.DatabaseURL == DevDatabaseURL {
			return c, errors.New("ห้ามใช้ DATABASE_URL ของ dev ใน production")
		}
		if os.Getenv("ALLOWED_ORIGINS") == "" {
			return c, errors.New("production ต้องตั้ง ALLOWED_ORIGINS (โดเมนของเว็บ)")
		}
		if !c.CookieSecure {
			return c, errors.New("production ต้องใช้ COOKIE_SECURE=true (เว็บต้องเป็น HTTPS)")
		}
	}
	return c, nil
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
