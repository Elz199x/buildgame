// ไคลเอนต์ REST ของเซิร์ฟเวอร์เกม Go — เซสชันอยู่ใน cookie HttpOnly (ฝั่งเบราว์เซอร์อ่านโทเคนไม่ได้)
// ทุกคำขอต้องส่ง credentials: "include" เพื่อให้เบราว์เซอร์แนบ cookie ข้ามพอร์ต (localhost:3000 → localhost:8080)

export interface User {
  id: string;
  username: string;
  role: "player" | "admin";
}

export interface CharacterSummary {
  id: string;
  name: string;
  classId: string;
  baseLv: number;
  jobLv: number;
  gold: number;
}

export interface Me {
  user: User;
  character?: CharacterSummary;
}

/** ที่อยู่ REST API: ตั้งด้วย NEXT_PUBLIC_API_URL หรือใช้โฮสต์เดียวกับหน้าเว็บที่พอร์ต 8080 (กัน localhost/127.0.0.1 ปนกันแล้ว cookie ไม่ไป) */
export function apiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env) return env.replace(/[/]+$/, "");
  if (typeof window === "undefined") return "http://localhost:8080";
  return `${window.location.protocol}//${window.location.hostname}:8080`;
}

export function wsUrl(): string {
  const env = process.env.NEXT_PUBLIC_GATEWAY_URL;
  if (env) return env;
  if (typeof window === "undefined") return "ws://localhost:8080/ws";
  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.hostname}:8080/ws`;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** ติดต่อเซิร์ฟเวอร์ไม่ได้ (ปิดอยู่/เครือข่ายล่ม) — ต่างจาก ApiError ที่เซิร์ฟเวอร์ตอบกลับมาแล้ว */
export class NetworkError extends Error {}

async function call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  try {
    return await fetch(`${apiBase()}${path}`, { ...init, headers, body, credentials: "include", cache: "no-store" });
  } catch {
    throw new NetworkError("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้");
  }
}

async function parseError(r: Response): Promise<ApiError> {
  let msg = `คำขอล้มเหลว (${r.status})`;
  try {
    const j = await r.json();
    if (j && typeof j.error === "string") msg = j.error;
  } catch {
    /* ไม่ใช่ JSON */
  }
  return new ApiError(r.status, msg);
}

export const auth = {
  /** คืน null ถ้ายังไม่ได้ล็อกอิน (401); โยน NetworkError ถ้าเซิร์ฟเวอร์ไม่ตอบ */
  async me(): Promise<Me | null> {
    const r = await call("/api/auth/me");
    if (r.status === 401) return null;
    if (!r.ok) throw await parseError(r);
    return r.json();
  },
  async login(username: string, password: string): Promise<Me> {
    const r = await call("/api/auth/login", { method: "POST", json: { username, password } });
    if (!r.ok) throw await parseError(r);
    return r.json();
  },
  async register(username: string, password: string): Promise<Me> {
    const r = await call("/api/auth/register", { method: "POST", json: { username, password } });
    if (!r.ok) throw await parseError(r);
    return r.json();
  },
  async logout(): Promise<void> {
    try {
      await call("/api/auth/logout", { method: "POST" });
    } catch {
      /* ออกจากหน้าอยู่แล้ว — ถ้าเซิร์ฟเวอร์ปิด เซสชันจะหมดอายุเอง */
    }
  },
};

/** โหลดข้อมูลเกม + ตัวละครของบัญชี (ให้ Skill Lab ใช้ตอนเริ่ม) */
export async function loadGameBundle(): Promise<{ data: unknown; state: unknown; mode: "game" | "lab" }> {
  const [d, c] = await Promise.all([call("/api/data"), call("/api/characters/me")]);
  if (!d.ok) throw await parseError(d);
  if (!c.ok) throw await parseError(c);
  const ch = await c.json();
  return { data: await d.json(), state: ch.state ?? {}, mode: ch.character?.mode === "lab" ? "lab" : "game" };
}
