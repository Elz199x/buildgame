"use client";
import { useEffect } from "react";

// พอร์ตตรงจาก ro-skill-lab.standalone.html : โมดูล vanilla JS (00–99) อยู่ที่ public/skill-lab/js
// ถูกโหลดตามลำดับเลขนำหน้าเหมือน build.py แล้ว 99-main.js จะผูกกับ #view / #tabs / #toast
const BASE = "/skill-lab";
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=IBM+Plex+Sans+Thai:wght@400;500;600&display=swap";

const TABS: [string, string][] = [
  ["world", "🎮 เล่นเกม (2.5D)"],
  ["formulas", "⚙️ สเตตัส & สูตร"],
  ["tree", "🌳 ต้นไม้สกิล"],
  ["editor", "🛠️ แก้ไขสกิล"],
  ["models", "🎨 โมเดล & ริก"],
  ["sim", "⚔️ จำลอง DPS"],
  ["data", "📦 ข้อมูลระบบ"],
];

type W = typeof window & { __SL_BOOTED?: boolean; __SL_BOOTING?: boolean };

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("โหลดไม่สำเร็จ: " + src));
    document.body.appendChild(s);
  });
}

export default function SkillLabApp() {
  useEffect(() => {
    const w = window as W;
    // CSS ของ Skill Lab มีกฎระดับ body/* จึงใส่เฉพาะตอนอยู่หน้านี้
    const links = [FONT_URL].map((href) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      document.head.appendChild(l);
      return l;
    });

    // โมดูลผูก event/DOM ครั้งเดียว: ถ้าเคยบูตแล้วและกลับมาด้วย client navigation ให้โหลดหน้าใหม่ทั้งหน้า
    if (w.__SL_BOOTED) {
      location.reload();
    } else if (!w.__SL_BOOTING) {
      w.__SL_BOOTING = true;
      (async () => {
        try {
          const { v, files }: { v: string; files: string[] } = await (await fetch(`${BASE}/modules.json`, { cache: "no-store" })).json();
          const css = document.createElement("link");
          css.rel = "stylesheet";
          css.href = `${BASE}/skill-lab.css?v=${v}`;
          document.head.appendChild(css);
          links.push(css);
          for (const f of files) await loadScript(`${BASE}/js/${f}?v=${v}`);
          w.__SL_BOOTED = true;
        } catch (e) {
          console.error(e);
          const v = document.getElementById("view");
          if (v) v.textContent = String((e as Error).message);
        } finally {
          w.__SL_BOOTING = false;
        }
      })();
    }
    return () => links.forEach((l) => l.remove());
  }, []);

  return (
    <>
      <div className="wrap">
        <header className="top">
          <div className="brand">
            RO <b>Cat Quest World</b>
            <span className="sub">2.5D Action RPG · Status &amp; Skill Lab Studio</span>
          </div>
          <nav className="tabs" id="tabs">
            {TABS.map(([id, label]) => (
              <a key={id} href={`#${id}`} data-tab={id}>{label}</a>
            ))}
            <a href="/online">🌐 ออนไลน์</a>
          </nav>
        </header>
        <main id="view" />
      </div>
      <div className="toast" id="toast" role="status" aria-live="polite" />
    </>
  );
}
