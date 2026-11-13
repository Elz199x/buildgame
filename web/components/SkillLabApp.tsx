"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiBase, auth, loadGameBundle, NetworkError, wsUrl, type User } from "@/lib/api";

// เกมหลัก = โมดูล vanilla JS (00–99) ใน public/skill-lab/js (สร้างจาก web/lab/src โดย npm run sync:lab)
// ลำดับ: ตรวจล็อกอิน → โหลดข้อมูลเกม+ตัวละครจากเซิร์ฟเวอร์ Go → โหลดโมดูล (99-main.js ผูกกับ #view / #tabs / #toast)
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

type W = typeof window & {
  __SL_BOOTED?: boolean;
  __SL_BOOTING?: boolean;
  __SL_REMOTE_DATA?: unknown;
  __SL_REMOTE_STATE?: unknown;
  __SL_REMOTE_API?: string;
  __SL_GATEWAY_URL?: string;
  __SL_USER?: User;
  __SL_GAME?: boolean;
};

type Phase =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; user: User };

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
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  // 1) ตรวจล็อกอิน + ดึงข้อมูลจากเซิร์ฟเวอร์
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const w = window as W;
      try {
        const me = await auth.me();
        if (cancelled) return;
        if (!me) {
          router.replace("/login");
          return;
        }
        const bundle = await loadGameBundle();
        if (cancelled) return;
        w.__SL_REMOTE_API = apiBase();
        w.__SL_GATEWAY_URL = wsUrl();
        w.__SL_REMOTE_DATA = bundle.data;
        w.__SL_REMOTE_STATE = bundle.state;
        w.__SL_USER = me.user;
        w.__SL_GAME = bundle.mode === "game"; // โหมดเกม: เซิร์ฟเวอร์เป็นเจ้าของความก้าวหน้าทั้งหมด
        setPhase({ kind: "ready", user: me.user });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          router.replace("/login");
          return;
        }
        setPhase({
          kind: "error",
          message:
            e instanceof NetworkError
              ? "เชื่อมต่อเซิร์ฟเวอร์เกมไม่ได้ — รัน: docker compose up -d db แล้ว cd server && go run ./cmd/gameserver"
              : e instanceof Error
                ? e.message
                : "เกิดข้อผิดพลาด",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  // 2) พร้อมแล้ว → ใส่ CSS และโหลดโมดูลเกม
  useEffect(() => {
    if (phase.kind !== "ready") return;
    const w = window as W;
    const links: HTMLLinkElement[] = [];
    const addLink = (href: string) => {
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      document.head.appendChild(l);
      links.push(l);
    };
    addLink(FONT_URL);

    // โมดูลผูก event/DOM ครั้งเดียว: ถ้าเคยบูตแล้วและกลับมาด้วย client navigation ให้โหลดหน้าใหม่ทั้งหน้า
    if (w.__SL_BOOTED) {
      location.reload();
    } else if (!w.__SL_BOOTING) {
      w.__SL_BOOTING = true;
      (async () => {
        try {
          const { v, files }: { v: string; files: string[] } = await (await fetch(`${BASE}/modules.json`, { cache: "no-store" })).json();
          addLink(`${BASE}/skill-lab.css?v=${v}`);
          for (const f of files) await loadScript(`${BASE}/js/${f}?v=${v}`);
          w.__SL_BOOTED = true;
        } catch (e) {
          console.error(e);
          const view = document.getElementById("view");
          if (view) view.textContent = String((e as Error).message);
        } finally {
          w.__SL_BOOTING = false;
        }
      })();
    }
    return () => links.forEach((l) => l.remove());
  }, [phase.kind]);

  async function logout() {
    await auth.logout();
    location.href = "/login"; // โหลดหน้าใหม่ทั้งหมด: ล้างสถานะโมดูลเกมและข้อมูลของบัญชีเดิม
  }

  if (phase.kind === "loading") {
    return <p style={{ padding: 24, fontFamily: "system-ui", color: "#8d96a8" }}>กำลังโหลดเกม…</p>;
  }
  if (phase.kind === "error") {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui", maxWidth: 560 }}>
        <p style={{ color: "#ff7b72" }}>{phase.message}</p>
        <button
          onClick={() => {
            setPhase({ kind: "loading" });
            setAttempt((n) => n + 1);
          }}
        >
          ลองใหม่
        </button>
      </div>
    );
  }

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
              <a key={id} href={`#${id}`} data-tab={id}>
                {label}
              </a>
            ))}
            <a href="/online">🌐 ออนไลน์</a>
          </nav>
          <div className="row" style={{ marginLeft: "auto", gap: 8 }}>
            <span className="chip" title={phase.user.role === "admin" ? "ผู้ดูแลระบบ: แก้ข้อมูลเกมส่วนกลางได้" : "ผู้เล่น"}>
              {phase.user.role === "admin" ? "🛡️" : "👤"} {phase.user.username}
            </span>
            <button className="btn sm" type="button" onClick={logout}>
              ออกจากระบบ
            </button>
          </div>
        </header>
        <main id="view" />
      </div>
      <div className="toast" id="toast" role="status" aria-live="polite" />
    </>
  );
}
