"use client";
import { useEffect, useRef, useState } from "react";
import { encodeChat } from "@/lib/codec";
import type { ChatLine } from "@/lib/useGateway";

export default function ChatPanel({ lines, send, name }: { lines: ChatLine[]; send: (f: ArrayBuffer) => void; name: string }) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <section className="panel chat">
      <ul ref={listRef}>
        {lines.length === 0 && <li className="empty">ยังไม่มีข้อความ — ทักทายเพื่อนร่วมโลกได้เลย</li>}
        {lines.map((l, i) => (
          <li key={i} className={l.mine ? "mine" : undefined}><b>{l.sender}</b>: {l.text}</li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          send(encodeChat(name, t));
          setText("");
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`พิมพ์แชทในนาม ${name}…`} maxLength={200} />
        <button type="submit">ส่ง</button>
      </form>
    </section>
  );
}
