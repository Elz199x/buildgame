// Cat Quest × RO — Go Game Server
//
// รวม: REST API (auth/ข้อมูลเกม/ตัวละคร/ตัวจำลอง) + WebSocket เกมออนไลน์ 30Hz + Postgres
// รัน:  go run ./cmd/gameserver     (ต้องมี Postgres — ดู docker-compose.yml และ server/README.md)
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"catquest-ro/server/internal/config"
	"catquest-ro/server/internal/game"
	"catquest-ro/server/internal/httpapi"
	"catquest-ro/server/internal/realtime"
	"catquest-ro/server/internal/store"
)

func main() {
	if err := run(); err != nil {
		slog.Error("เซิร์ฟเวอร์หยุดทำงาน", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	var handler slog.Handler = slog.NewTextHandler(os.Stderr, nil)
	if cfg.LogJSON {
		handler = slog.NewJSONHandler(os.Stderr, nil)
	} else if config.ColorEnabled() {
		handler = config.NewColorHandler(os.Stderr, slog.LevelInfo) // เทอร์มินัลตอนพัฒนา: log แต่งสี (NO_COLOR=1 เพื่อปิด)
	}
	slog.SetDefault(slog.New(handler))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := store.Open(ctx, cfg.DatabaseURL, cfg.DBWait)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.Migrate(ctx); err != nil {
		return err
	}

	data, err := httpapi.NewDataManager(ctx, db)
	if err != nil {
		return err
	}
	d, _, ver := data.Current()
	world := game.NewWorld(d)
	data.SetOnChange(world.SetData)
	hub := realtime.NewHub(world, db, cfg.MaxClients, cfg.AllowedOrigins)
	api := httpapi.New(httpapi.Deps{Cfg: cfg, DB: db, Hub: hub, World: world, Data: data})

	srv := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	go hub.Run(ctx)
	go hub.RunLoop(ctx)
	go hub.SaveLoop(ctx) // บันทึกความก้าวหน้า (EXP/ไอเทม/ทอง) ลงฐานข้อมูลทุก 3 วินาที
	go housekeeping(ctx, db)

	errc := make(chan error, 1)
	go func() {
		slog.Info("เซิร์ฟเวอร์เกมเริ่มทำงาน", "listen", cfg.ListenAddr, "env", cfg.Env, "dataVersion", ver, "tickHz", game.TickHz, "origins", cfg.AllowedOrigins)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
	}
	slog.Info("กำลังปิดเซิร์ฟเวอร์…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	err = srv.Shutdown(shutdownCtx)
	hub.FlushDirty(shutdownCtx) // บันทึกครั้งสุดท้ายก่อนปิด — ความก้าวหน้าของผู้เล่นที่ยังออนไลน์ต้องไม่หาย
	return err
}

// housekeeping ล้างเซสชันหมดอายุและแชทเก่าเป็นระยะ
func housekeeping(ctx context.Context, db *store.Store) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			c, cancel := context.WithTimeout(ctx, 30*time.Second)
			if n, err := db.PurgeExpiredSessions(c); err != nil {
				slog.Warn("ล้างเซสชันหมดอายุไม่สำเร็จ", "err", err)
			} else if n > 0 {
				slog.Info("ล้างเซสชันหมดอายุ", "count", n)
			}
			if n, err := db.PurgeOldChat(c, 30*24*time.Hour); err != nil {
				slog.Warn("ล้างแชทเก่าไม่สำเร็จ", "err", err)
			} else if n > 0 {
				slog.Info("ล้างแชทเก่า", "count", n)
			}
			cancel()
		}
	}
}
