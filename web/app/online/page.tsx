"use client";
import { useEffect, useState } from "react";
import ChatPanel from "@/components/ChatPanel";
import WorldCanvas, { type SelfHud } from "@/components/WorldCanvas";
import { GATEWAY_URL, useGateway } from "@/lib/useGateway";

export default function Home() {
  const [name, setName] = useState("Hero");
  // สุ่มชื่อหลัง mount เท่านั้น (สุ่มตอน render ทำให้ SSR กับ client ไม่ตรงกัน → hydration error)
  useEffect(() => setName(`Hero${Math.floor(Math.random() * 900 + 100)}`), []);
  const { status, ping, tick, chat, mobsRef, peersRef, peerCount, send } = useGateway(name);
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
        <a className="chip" href="/">เกม 2.5D →</a>
        <span className="chip" title="Gateway URL">{GATEWAY_URL}</span>
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
          <WorldCanvas mobsRef={mobsRef} peersRef={peersRef} send={send} onHud={setHud} />
          {status !== "online" && (
            <div className="overlay">
              {status === "connecting" ? "กำลังเชื่อมต่อ Gateway…" : "ขาดการเชื่อมต่อ — กำลังลองใหม่"}
              <small>รันเซิร์ฟเวอร์: node server/dev-cluster.js</small>
            </div>
          )}
        </div>
        <p className="hint">WASD / ลูกศร = เดิน · Space = กลิ้งหลบ (อมตะชั่วขณะ) · คลิกมอนสเตอร์ในระยะ = โจมตี (ดาเมจคำนวณที่เซิร์ฟเวอร์)</p>
      </section>
      <ChatPanel lines={chat} send={send} name={name} />
    </main>
  );
}
