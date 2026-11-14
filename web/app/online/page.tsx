"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import ChatPanel from "@/components/ChatPanel";
import WorldCanvas, { type SelfHud } from "@/components/WorldCanvas";
import { auth, NetworkError, wsUrl } from "@/lib/api";
import { useGateway } from "@/lib/useGateway";

// หน้าทดสอบ Gateway แบบเรียบ — ต้องล็อกอิน (เซิร์ฟเวอร์ตรวจ cookie เซสชันตอนต่อ WebSocket)
export default function OnlinePage() {
  const router = useRouter();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    auth
      .me()
      .then((me) => (me ? setName(me.character?.name ?? me.user.username) : router.replace("/login")))
      .catch((e) => setError(e instanceof NetworkError ? "เชื่อมต่อเซิร์ฟเวอร์เกมไม่ได้" : "เกิดข้อผิดพลาด"));
  }, [router]);

  if (error) return <main style={{ display: "block" }}><p>{error}</p></main>;
  if (!name) return <main style={{ display: "block" }}><p>กำลังตรวจสอบเซสชัน…</p></main>;
  return <Game name={name} />;
}

function Game({ name }: { name: string }) {
  const { status, ping, tick, chat, mobsRef, peersRef, selfUidRef, peerCount, send } = useGateway(name);
  const [hud, setHud] = useState<SelfHud>({ hp: 0, maxHp: 0, rollCd: 0, x: 0, y: 0 });
  const hpPct = hud.maxHp > 0 ? Math.round((hud.hp / hud.maxHp) * 100) : 0;

  return (
    <main>
      <header>
        <h1>Cat Quest × RO</h1>
        <span className={`chip ${status}`}>{status === "online" ? "ออนไลน์" : status === "connecting" ? "กำลังเชื่อมต่อ…" : "ออฟไลน์"}</span>
        <span className="chip">ping {ping ?? "—"} ms</span>
        <span className="chip">server tick {tick}</span>
        <span className="chip">ผู้เล่น {peerCount}</span>
        <a className="chip" href="/">
          เกม 2.5D →
        </a>
        <span className="chip" title="Gateway URL">
          {wsUrl()}
        </span>
      </header>
      <section className="panel">
        <div className="hud">
          <span className="who">{name}</span>
          <div className="bar" title="HP">
            <div className="fill hp" style={{ width: `${hpPct}%` }} />
            <span>{hud.maxHp > 0 ? `HP ${hud.hp} / ${hud.maxHp}` : "HP —"}</span>
          </div>
          <div className="bar roll" title="กลิ้งหลบ (Space)">
            <div className="fill" style={{ width: `${hud.rollCd > 0 ? Math.round((1 - hud.rollCd / 1.2) * 100) : 100}%` }} />
            <span>{hud.rollCd > 0 ? "กลิ้ง…" : "กลิ้งพร้อม"}</span>
          </div>
        </div>
        <div className="stage">
          <WorldCanvas mobsRef={mobsRef} peersRef={peersRef} selfUidRef={selfUidRef} send={send} onHud={setHud} />
          {status !== "online" && (
            <div className="overlay">
              {status === "connecting" ? "กำลังเชื่อมต่อ Gateway…" : "ขาดการเชื่อมต่อ — กำลังลองใหม่"}
              <small>ต้องเปิดเซิร์ฟเวอร์: cd server &amp;&amp; go run ./cmd/gameserver</small>
            </div>
          )}
        </div>
        <p className="hint">WASD / ลูกศร = เดิน · Space = กลิ้งหลบ (อมตะชั่วขณะ) · คลิกมอนสเตอร์ในระยะ = โจมตี (ดาเมจคำนวณที่เซิร์ฟเวอร์ Go)</p>
      </section>
      <ChatPanel lines={chat} send={send} name={name} />
    </main>
  );
}
