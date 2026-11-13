// Binary Wire Codec (0xC7) — ตรงกับ skill-lab/src/05b-net-codec.js และ Go Gateway/Sim
export const MAGIC = 0xc7;
export const VERSION = 1;
export const OP = {
  PING: 0x01,
  PONG: 0x02,
  AUTH: 0x03,
  MOVE: 0x10,
  ATTACK: 0x11,
  ROLL: 0x13,
  WORLD_SNAPSHOT: 0x20,
  CHAT: 0x30,
} as const;

export const CLASS_CODES = ["novice", "swordman", "thief", "archer", "mage"] as const;
export const CLASS_TH: Record<string, string> = { novice: "โนวิซ", swordman: "นักดาบ", thief: "โจร", archer: "นักธนู", mage: "จอมเวท" };
export const WEAPON_CODES = ["unarmed", "sword_1h", "sword_2h", "axe", "mace", "dagger", "bow", "staff"] as const;

export interface Peer { uid: number; x: number; y: number; hp: number; maxHp: number; classId: string; facing: number; anim: number }
export interface Mob { uid: number; x: number; y: number; hp: number; alive: boolean; facing: number; casting: boolean }

export type Decoded =
  | { op: typeof OP.PONG; clientTs: number; serverTick: number }
  | { op: typeof OP.WORLD_SNAPSHOT; tick: number; peers: Peer[]; mobs: Mob[] }
  | { op: typeof OP.CHAT; channel: number; sender: string; text: string }
  | { op: number };

const enc = new TextEncoder();
const dec = new TextDecoder();

function header(dv: DataView, op: number) {
  dv.setUint8(0, MAGIC);
  dv.setUint8(1, VERSION);
  dv.setUint8(2, op);
  dv.setUint8(3, 0);
}

export function encodePing(ts = Date.now()): ArrayBuffer {
  const buf = new ArrayBuffer(12);
  const dv = new DataView(buf);
  header(dv, OP.PING);
  dv.setFloat64(4, ts, true);
  return buf;
}

export function encodeMove(m: { seq: number; x: number; y: number; vx: number; vy: number; facing: number; anim: number }): ArrayBuffer {
  const buf = new ArrayBuffer(22);
  const dv = new DataView(buf);
  header(dv, OP.MOVE);
  dv.setUint32(4, m.seq >>> 0, true);
  dv.setFloat32(8, m.x, true);
  dv.setFloat32(12, m.y, true);
  dv.setInt16(16, Math.round(m.vx), true);
  dv.setInt16(18, Math.round(m.vy), true);
  dv.setInt8(20, m.facing >= 0 ? 1 : -1);
  dv.setUint8(21, m.anim);
  return buf;
}

export function encodeAttack(a: { seq: number; targetUid: number; x: number; y: number }): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  header(dv, OP.ATTACK);
  dv.setUint32(4, a.seq >>> 0, true);
  dv.setUint32(8, a.targetUid >>> 0, true);
  dv.setUint16(12, Math.max(0, Math.round(a.x)), true);
  dv.setUint16(14, Math.max(0, Math.round(a.y)), true);
  return buf;
}

export function encodeAuth(p: { name: string; classId: string; weaponId: string; baseLv?: number; jobLv?: number }): ArrayBuffer {
  const n = enc.encode(p.name).slice(0, 64);
  const buf = new ArrayBuffer(9 + n.byteLength);
  const dv = new DataView(buf);
  header(dv, OP.AUTH);
  dv.setUint8(4, Math.max(0, (CLASS_CODES as readonly string[]).indexOf(p.classId)));
  dv.setUint8(5, Math.max(0, (WEAPON_CODES as readonly string[]).indexOf(p.weaponId)));
  dv.setUint8(6, p.baseLv ?? 50);
  dv.setUint8(7, p.jobLv ?? 50);
  dv.setUint8(8, n.byteLength);
  new Uint8Array(buf, 9).set(n);
  return buf;
}

export function encodeRoll(r: { seq: number; x: number; y: number; dx: number; dy: number }): ArrayBuffer {
  const buf = new ArrayBuffer(16);
  const dv = new DataView(buf);
  header(dv, OP.ROLL);
  dv.setUint32(4, r.seq >>> 0, true);
  dv.setUint16(8, Math.max(0, Math.round(r.x)), true);
  dv.setUint16(10, Math.max(0, Math.round(r.y)), true);
  dv.setInt16(12, Math.round(r.dx), true);
  dv.setInt16(14, Math.round(r.dy), true);
  return buf;
}

export function encodeChat(sender: string, text: string, channel = 0): ArrayBuffer {
  const s = enc.encode(sender).slice(0, 64);
  const m = enc.encode(text).slice(0, 512);
  const buf = new ArrayBuffer(8 + s.byteLength + m.byteLength);
  const dv = new DataView(buf);
  header(dv, OP.CHAT);
  dv.setUint8(4, channel);
  dv.setUint8(5, s.byteLength);
  dv.setUint16(6, m.byteLength, true);
  const u8 = new Uint8Array(buf);
  u8.set(s, 8);
  u8.set(m, 8 + s.byteLength);
  return buf;
}

export function decode(ab: ArrayBuffer): Decoded | null {
  if (ab.byteLength < 4) return null;
  const dv = new DataView(ab);
  if (dv.getUint8(0) !== MAGIC) return null;
  const op = dv.getUint8(2);

  if (op === OP.PONG && ab.byteLength >= 16) {
    return { op: OP.PONG, clientTs: dv.getFloat64(4, true), serverTick: dv.getUint32(12, true) };
  }
  if (op === OP.WORLD_SNAPSHOT && ab.byteLength >= 10) {
    const pCount = dv.getUint8(8);
    const mCount = dv.getUint8(9);
    const peers: Peer[] = [];
    const mobs: Mob[] = [];
    let off = 10;
    for (let i = 0; i < pCount && off + 16 <= ab.byteLength; i++, off += 16) {
      peers.push({
        uid: dv.getUint32(off, true),
        x: dv.getUint16(off + 4, true),
        y: dv.getUint16(off + 6, true),
        hp: dv.getUint16(off + 8, true),
        maxHp: dv.getUint16(off + 10, true),
        classId: CLASS_CODES[dv.getUint8(off + 12)] ?? "novice",
        facing: dv.getInt8(off + 14),
        anim: dv.getUint8(off + 15),
      });
    }
    for (let j = 0; j < mCount && off + 16 <= ab.byteLength; j++, off += 16) {
      mobs.push({
        uid: dv.getUint32(off, true),
        x: dv.getUint16(off + 4, true),
        y: dv.getUint16(off + 6, true),
        hp: dv.getUint32(off + 8, true),
        alive: dv.getUint8(off + 12) === 1,
        facing: dv.getInt8(off + 13),
        casting: dv.getUint8(off + 15) === 1,
      });
    }
    return { op: OP.WORLD_SNAPSHOT, tick: dv.getUint32(4, true), peers, mobs };
  }
  if (op === OP.CHAT && ab.byteLength >= 8) {
    const sLen = dv.getUint8(5);
    const mLen = dv.getUint16(6, true);
    const sender = dec.decode(new Uint8Array(ab, 8, Math.min(sLen, ab.byteLength - 8)));
    const text = dec.decode(new Uint8Array(ab, 8 + sLen, Math.max(0, Math.min(mLen, ab.byteLength - 8 - sLen))));
    return { op: OP.CHAT, channel: dv.getUint8(4), sender, text };
  }
  return { op };
}
