"use client";
import { useEffect, useRef } from "react";
import { CLASS_TH, encodeAttack, encodeMove, encodeRoll, type Mob, type Peer } from "@/lib/codec";

const WORLD_W = 2400;
const WORLD_H = 1700;
const SPEED = 220; // px/s
const ROLL_SPEED = 620;
const ROLL_TIME = 0.28; // วินาที (i-frame ฝั่งเซิร์ฟเวอร์)
const ROLL_CD = 1.2;
const ATTACK_RANGE = 130; // ระยะที่ UI อนุญาตให้ส่งคำสั่งตี (เซิร์ฟเวอร์ยังเป็นผู้ตัดสินจริง)
const SEND_MS = 50;
const HUD_MS = 200;

export interface SelfHud { hp: number; maxHp: number; rollCd: number; x: number; y: number }

interface Props {
  mobsRef: React.RefObject<Mob[]>;
  peersRef: React.RefObject<Peer[]>;
  selfUidRef: React.RefObject<number>;
  send: (f: ArrayBuffer) => void;
  onHud?: (h: SelfHud) => void;
}

interface Floater { x: number; y: number; text: string; color: string; life: number }

export default function WorldCanvas({ mobsRef, peersRef, selfUidRef, send, onHud }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const hudRef = useRef(onHud);
  hudRef.current = onHud;

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    const me = { x: 800, y: 800, facing: 1, hp: 0, maxHp: 0 };
    const keys = new Set<string>();
    const floaters: Floater[] = [];
    const prevHp = new Map<number, number>(); // uid → hp ล่าสุด (คำนวณดาเมจจากส่วนต่าง)
    const maxHp = new Map<number, number>(); // uid → hp สูงสุดที่เคยเห็น
    let seq = 0;
    let last = performance.now();
    let sentAt = 0;
    let hudAt = 0;
    let rollLeft = 0;
    let rollCd = 0;
    let rollDx = 1;
    let rollDy = 0;
    let atkFlash = 0;
    let raf = 0;

    const doRoll = (dx: number, dy: number) => {
      if (rollCd > 0) return;
      const len = Math.hypot(dx, dy);
      rollDx = len ? dx / len : me.facing;
      rollDy = len ? dy / len : 0;
      rollLeft = ROLL_TIME;
      rollCd = ROLL_CD;
      sendRef.current(encodeRoll({ seq: ++seq, x: me.x, y: me.y, dx: rollDx * ROLL_SPEED, dy: rollDy * ROLL_SPEED }));
    };

    const MOVE_KEYS = ["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"];
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.includes(k)) {
        e.preventDefault();
        if (down) keys.add(k);
        else keys.delete(k);
      } else if (k === " " && down && !e.repeat) {
        e.preventDefault();
        const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
        const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
        doRoll(dx, dy);
      }
    };
    const kd = onKey(true);
    const ku = onKey(false);
    const blur = () => keys.clear();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);

    const onClick = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * WORLD_W;
      const py = ((e.clientY - r.top) / r.height) * WORLD_H;
      let best: Mob | null = null;
      let bd = 60;
      for (const m of mobsRef.current ?? []) {
        if (!m.alive) continue;
        const d = Math.hypot(m.x - px, m.y - py);
        if (d < bd) { bd = d; best = m; }
      }
      if (!best) return;
      if (Math.hypot(best.x - me.x, best.y - me.y) > ATTACK_RANGE) {
        floaters.push({ x: me.x, y: me.y - 50, text: "ไกลเกินไป", color: "#8a93a6", life: 0.8 });
        return;
      }
      atkFlash = 0.15;
      sendRef.current(encodeAttack({ seq: ++seq, targetUid: best.uid, x: me.x, y: me.y }));
    };
    cv.addEventListener("pointerdown", onClick);

    const trackDamage = () => {
      for (const m of mobsRef.current ?? []) {
        maxHp.set(m.uid, Math.max(maxHp.get(m.uid) ?? 0, m.hp));
        const p = prevHp.get(m.uid);
        if (p !== undefined && m.alive && m.hp < p) {
          floaters.push({ x: m.x + (Math.random() - 0.5) * 30, y: m.y - 50, text: String(p - m.hp), color: "#ffd166", life: 1 });
        } else if (p !== undefined && !m.alive && p > 0) {
          floaters.push({ x: m.x, y: m.y - 50, text: "KILL", color: "#ff6b6b", life: 1.2 });
        }
        prevHp.set(m.uid, m.alive ? m.hp : 0);
        if (m.alive && p === 0) maxHp.set(m.uid, m.hp); // เกิดใหม่
      }
    };

    const hpBar = (x: number, y: number, w: number, ratio: number, color: string) => {
      ctx.fillStyle = "#000a";
      ctx.fillRect(x - w / 2, y, w, 6);
      ctx.fillStyle = color;
      ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, ratio)), 6);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      rollCd = Math.max(0, rollCd - dt);
      atkFlash = Math.max(0, atkFlash - dt);

      const dx = (keys.has("d") || keys.has("arrowright") ? 1 : 0) - (keys.has("a") || keys.has("arrowleft") ? 1 : 0);
      const dy = (keys.has("s") || keys.has("arrowdown") ? 1 : 0) - (keys.has("w") || keys.has("arrowup") ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      let vx = (dx / len) * SPEED;
      let vy = (dy / len) * SPEED;
      if (rollLeft > 0) {
        rollLeft -= dt;
        vx = rollDx * ROLL_SPEED;
        vy = rollDy * ROLL_SPEED;
      }
      me.x = Math.min(WORLD_W - 40, Math.max(40, me.x + vx * dt));
      me.y = Math.min(WORLD_H - 40, Math.max(40, me.y + vy * dt));
      if (vx) me.facing = vx > 0 ? 1 : -1;

      // ส่ง MOVE ต่อเนื่อง (Sim ตอบ snapshot กลับทุกครั้งที่รับเฟรม)
      if (now - sentAt >= SEND_MS) {
        sentAt = now;
        const anim = rollLeft > 0 ? 4 : dx || dy ? 1 : 0;
        sendRef.current(encodeMove({ seq: ++seq, x: me.x, y: me.y, vx, vy, facing: me.facing, anim }));
      }

      trackDamage();

      // peer ที่ uid ตรงกับที่เซิร์ฟเวอร์กำหนดให้เรา (WELCOME) คือตัวเรา — ใช้ดึง HP จริงจากเซิร์ฟเวอร์
      const others: Peer[] = [];
      for (const p of peersRef.current ?? []) {
        if (p.uid === selfUidRef.current) { me.hp = p.hp; me.maxHp = p.maxHp; }
        else others.push(p);
      }
      if (now - hudAt >= HUD_MS) {
        hudAt = now;
        hudRef.current?.({ hp: me.hp, maxHp: me.maxHp, rollCd, x: me.x, y: me.y });
      }

      // ---- วาด ----
      const s = cv.width / WORLD_W;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.strokeStyle = "#1d2230";
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= WORLD_W; gx += 200) { ctx.beginPath(); ctx.moveTo(gx * s, 0); ctx.lineTo(gx * s, WORLD_H * s); ctx.stroke(); }
      for (let gy = 0; gy <= WORLD_H; gy += 200) { ctx.beginPath(); ctx.moveTo(0, gy * s); ctx.lineTo(WORLD_W * s, gy * s); ctx.stroke(); }

      ctx.font = "14px system-ui";
      ctx.textAlign = "center";

      for (const m of mobsRef.current ?? []) {
        const x = m.x * s, y = m.y * s, r = 40 * s;
        ctx.globalAlpha = m.alive ? 1 : 0.35;
        ctx.fillStyle = m.alive ? (m.casting ? "#ff9f43" : "#e0556b") : "#444a58";
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        if (m.casting && m.alive) {
          ctx.strokeStyle = "#ff9f43"; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, r + 8, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#cfd5e3";
        if (m.alive) {
          hpBar(x, y - r - 12, r * 2, m.hp / (maxHp.get(m.uid) || m.hp || 1), "#e0556b");
          ctx.fillText(`#${m.uid} · ${m.hp.toLocaleString()}`, x, y - r - 18);
        } else {
          ctx.fillText(`#${m.uid} (เกิดใหม่)`, x, y - r - 6);
        }
      }

      for (const p of others) {
        const x = p.x * s, y = p.y * s, r = 30 * s;
        ctx.fillStyle = "#7bd88f";
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        hpBar(x, y - r - 12, r * 2, p.hp / (p.maxHp || 1), "#4cd08a");
        ctx.fillStyle = "#cfd5e3";
        ctx.fillText(`${CLASS_TH[p.classId] ?? p.classId} #${p.uid}`, x, y - r - 18);
      }

      // ตัวเรา
      const mr = 32 * s;
      ctx.globalAlpha = rollLeft > 0 ? 0.45 : 1;
      ctx.fillStyle = atkFlash > 0 ? "#bdeaff" : "#4cc3ff";
      ctx.beginPath(); ctx.arc(me.x * s, me.y * s, mr, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc((me.x + me.facing * 18) * s, me.y * s - 4 * s, 4 * s, 0, Math.PI * 2); ctx.fill();
      if (me.maxHp > 0) hpBar(me.x * s, me.y * s - mr - 12, mr * 2, me.hp / me.maxHp, "#4cc3ff");
      ctx.fillStyle = "#fff";
      ctx.fillText("คุณ", me.x * s, me.y * s - mr - 18);

      // ตัวเลขดาเมจลอย
      ctx.font = "bold 18px system-ui";
      for (let i = floaters.length - 1; i >= 0; i--) {
        const f = floaters[i];
        f.life -= dt;
        f.y -= 40 * dt;
        if (f.life <= 0) { floaters.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x * s, f.y * s);
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      cv.removeEventListener("pointerdown", onClick);
    };
  }, [mobsRef, peersRef, selfUidRef]);

  return <canvas ref={canvasRef} width={1200} height={850} />;
}
