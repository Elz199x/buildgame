"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { decode, encodeAuth, encodePing, OP, type Mob, type Peer } from "./codec";

export const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "ws://localhost:8080/ws";

export interface ChatLine { sender: string; text: string; mine?: boolean }
export type Status = "connecting" | "online" | "offline";

export function useGateway(name: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const mobsRef = useRef<Mob[]>([]);
  const peersRef = useRef<Peer[]>([]);
  const [peerCount, setPeerCount] = useState(0);
  const nameRef = useRef(name);
  nameRef.current = name;
  const [status, setStatus] = useState<Status>("connecting");
  const [ping, setPing] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [chat, setChat] = useState<ChatLine[]>([]);

  useEffect(() => {
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      setStatus("connecting");
      const ws = new WebSocket(GATEWAY_URL);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("online");
        ws.send(encodePing());
        ws.send(encodeAuth({ name: nameRef.current, classId: "swordman", weaponId: "sword_2h" }));
        pingTimer = setInterval(() => ws.readyState === 1 && ws.send(encodePing()), 2000);
      };
      ws.onmessage = (ev) => {
        if (!(ev.data instanceof ArrayBuffer)) return;
        const msg = decode(ev.data);
        if (!msg) return;
        if (msg.op === OP.PONG && "clientTs" in msg) {
          setPing(Math.max(0, Date.now() - msg.clientTs));
          setTick(msg.serverTick);
        } else if (msg.op === OP.WORLD_SNAPSHOT && "mobs" in msg) {
          mobsRef.current = msg.mobs;
          peersRef.current = msg.peers;
          setPeerCount((c) => (c === msg.peers.length ? c : msg.peers.length));
        } else if (msg.op === OP.CHAT && "text" in msg) {
          setChat((c) => [...c.slice(-99), { sender: msg.sender, text: msg.text, mine: msg.sender === nameRef.current }]);
        }
      };
      ws.onclose = () => {
        clearInterval(pingTimer);
        setStatus("offline");
        if (!closed) retry = setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      clearInterval(pingTimer);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback((frame: ArrayBuffer) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(frame);
  }, []);

  return { status, ping, tick, chat, mobsRef, peersRef, peerCount, send };
}
