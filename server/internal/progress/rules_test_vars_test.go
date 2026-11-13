package progress

import (
	"catquest-ro/server/internal/gamedata"
	"catquest-ro/server/internal/sim"
)

// ค่ากติกาในเทสต์อ่านจากข้อมูลตั้งต้น (seed) — ไม่ฝังค่าซ้ำในเทสต์
var (
	seedRules     = mustSeedRules()
	StarterGold   = sim.Num(seedRules.StarterGold)
	StarterPotion = seedRules.StarterItems[0].ID
	StarterPotQty = int(seedRules.StarterItems[0].Qty)
	MaxBaseLevel  = sim.Num(seedRules.MaxBaseLevel)
)

func mustSeedRules() gamedata.ProgressionRules {
	d, err := gamedata.Parse(gamedata.Seed())
	if err != nil {
		panic(err)
	}
	return d.Rules.Progression
}
