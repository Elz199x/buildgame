#!/usr/bin/env node
/* ============================================================
   Cat Quest × RO — Local Dev Binary Cluster (Gateway + 30Hz Authoritative Sim)
   รันได้ทันทีด้วย Node.js มาตรฐาน (ไม่ต้องลง npm package เพิ่ม):
     node server/dev-cluster.js
   จำลองการทำงานของ Go WebSocket Gateway (:8080/ws) + Go 30Hz Simulation Engine
   โดยใช้เฟรมไบนารี 0xC7 (SL.binCodec) ตัวเดียวกับ Production 100%
============================================================ */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// โหลดโมดูลคำนวณ RO และ Binary Codec จาก skill-lab/src
const SRC = path.resolve(__dirname, '..', 'skill-lab', 'src');
['00-util', '01-defaults', '02-store', '03-rules', '04-stats', '05-sim', '05b-net-codec'].forEach(f => {
  (0, eval)(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8'));
});
const SL = globalThis.SL;
SL.loadAll();

// โหลดไฟล์ shared-world-config.json อัตโนมัติหากมีการส่งออกจากหน้า Editor (#formulas)
const SHARED_CFG_PATH = path.join(__dirname, 'shared-world-config.json');
if(fs.existsSync(SHARED_CFG_PATH)){
  try {
    const extCfg = JSON.parse(fs.readFileSync(SHARED_CFG_PATH, 'utf8'));
    SL.store.change(d => {
      if(extCfg.globals) Object.assign(d.globals, extCfg.globals);
      if(extCfg.formulaConfig) Object.assign(d.formulaConfig, extCfg.formulaConfig);
      if(extCfg.elementSystem) Object.assign(d.elementSystem, extCfg.elementSystem);
      if(Array.isArray(extCfg.monsters)) d.monsters = extCfg.monsters;
      if(extCfg.worldMap) d.worldMap = extCfg.worldMap;
    });
  } catch(e){}
}

const codec = SL.binCodec, OP = codec.OP;

const PORT = Number(process.env.PORT) || 8080;
const TICK_HZ = 30;
let serverTick = 0;

// รายชื่อผู้เล่นที่เชื่อมต่อผ่าน WebSocket + บอทจำลองบนเซิร์ฟเวอร์
const clients = new Map();
let nextUid = 1001;

const serverPeers = [
  { uid: 9001, name: 'PoringHunter', classId: 'novice', weaponId: 'unarmed', x: 940, y: 390, hp: 350, maxHp: 350, facing: 1, animState: 'idle' },
  { uid: 9002, name: 'Shadow_Fang', classId: 'thief', weaponId: 'dagger', x: 1480, y: 1220, hp: 1450, maxHp: 1450, facing: -1, animState: 'idle' },
  { uid: 9003, name: 'Grand_Archmage', classId: 'mage', weaponId: 'staff', x: 460, y: 820, hp: 850, maxHp: 850, facing: 1, animState: 'idle' }
];

// สร้างมอนสเตอร์บนเซิร์ฟเวอร์จาก Single-Source-of-Truth (SL.store.get().worldMap.spawns)
const serverMobs = ((SL.store.get().worldMap && SL.store.get().worldMap.spawns) || []).map((sp, idx) => {
  const mDef = SL.store.find('monsters', sp.monsterId) || SL.store.get().monsters[0];
  return {
    uid: idx + 1,
    monsterId: mDef.id,
    x: sp.x, y: sp.y,
    hp: mDef.maxHp, maxHp: mDef.maxHp,
    alive: true, facing: -1, animState: 'idle', casting: false
  };
});

/* ---------- RFC-6455 Binary WebSocket Frame Helpers ---------- */
function encodeWsBinaryFrame(ab){
  const payload = Buffer.from(ab instanceof ArrayBuffer ? ab : ab.buffer);
  const len = payload.length;
  let header;
  if(len < 126){
    header = Buffer.alloc(2);
    header[0] = 0x82; // FIN + Binary opcode (0x02)
    header[1] = len;
  } else if(len < 65536){
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function decodeWsFrames(buffer){
  const frames = [];
  let offset = 0;
  while(offset + 2 <= buffer.length){
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let hdrLen = 2;
    if(len === 126){
      if(offset + 4 > buffer.length) break;
      len = buffer.readUInt16BE(offset + 2);
      hdrLen = 4;
    } else if(len === 127){
      if(offset + 10 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(offset + 2));
      hdrLen = 10;
    }
    const maskLen = masked ? 4 : 0;
    if(offset + hdrLen + maskLen + len > buffer.length) break;
    const payload = Buffer.alloc(len);
    if(masked){
      const mask = buffer.subarray(offset + hdrLen, offset + hdrLen + 4);
      const src = buffer.subarray(offset + hdrLen + 4, offset + hdrLen + 4 + len);
      for(let i = 0; i < len; i++) payload[i] = src[i] ^ mask[i & 3];
    } else {
      buffer.copy(payload, 0, offset + hdrLen, offset + hdrLen + len);
    }
    frames.push({ opcode, payload });
    offset += hdrLen + maskLen + len;
  }
  return { frames, remaining: buffer.subarray(offset) };
}

function broadcastBinary(ab, excludeUid){
  const wsFrame = encodeWsBinaryFrame(ab);
  for(const [uid, cl] of clients.entries()){
    if(uid !== excludeUid && !cl.socket.destroyed){
      cl.socket.write(wsFrame);
    }
  }
}

/* ---------- HTTP + WebSocket Upgrade Server ---------- */
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify({
    service: 'CatQuest×RO Authoritative Binary Cluster',
    tickHz: TICK_HZ,
    serverTick: serverTick,
    onlinePlayers: clients.size + serverPeers.length,
    protocol: 'FlatBuffers Binary Wire v1 (0xC7)'
  }));
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if(!key){ socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  const uid = nextUid++;
  const client = { uid, socket, buf: Buffer.alloc(0), x: 520, y: 850, hp: 1900, maxHp: 1900, classId: 'swordman', weaponId: 'sword_2h', facing: 1, animState: 'idle' };
  clients.set(uid, client);

  socket.on('data', chunk => {
    client.buf = Buffer.concat([client.buf, chunk]);
    const { frames, remaining } = decodeWsFrames(client.buf);
    client.buf = remaining;
    for(const f of frames){
      if(f.opcode === 0x08){ socket.end(); return; } // Close
      if(f.opcode === 0x02 || f.opcode === 0x01){
        const pkt = codec.decode(f.payload);
        if(!pkt) continue;
        if(pkt.op === OP.PING){
          const pong = codec.encodePong(pkt.clientTs, serverTick);
          socket.write(encodeWsBinaryFrame(pong));
        } else if(pkt.op === OP.AUTH){
          client.classId = pkt.classId;
          client.weaponId = pkt.weaponId;
          client.name = pkt.name;
        } else if(pkt.op === OP.MOVE){
          client.x = pkt.x; client.y = pkt.y; client.facing = pkt.facing; client.animState = pkt.animState;
        } else if(pkt.op === OP.CHAT){
          broadcastBinary(f.payload, 0);
        }
      }
    }
  });

  socket.on('close', () => clients.delete(uid));
  socket.on('error', () => clients.delete(uid));
});

/* ---------- 30Hz Fixed Timestep Simulation Loop ---------- */
setInterval(() => {
  serverTick++;
  // อัปเดตตำแหน่งบอทจำลองบนเซิร์ฟเวอร์
  serverPeers.forEach((p, idx) => {
    const t = serverTick / TICK_HZ + idx * 2;
    p.x += Math.cos(t * 0.7) * 0.8;
    p.y += Math.sin(t * 0.7) * 0.6;
    p.facing = Math.cos(t * 0.7) >= 0 ? 1 : -1;
    p.animState = (serverTick % 45 < 12) ? 'attack' : 'walk';
  });

  // ส่งเฟรม WORLD_SNAPSHOT ไบนารีไปยังผู้เล่นทุกคนที่เชื่อมต่ออยู่
  if(clients.size > 0 && serverTick % 2 === 0){
    const allPeers = serverPeers.slice();
    for(const cl of clients.values()) allPeers.push(cl);
    const snapBuf = codec.encodeWorldSnapshot({ tick: serverTick, peers: allPeers, mobs: serverMobs });
    broadcastBinary(snapBuf, 0);
  }
}, Math.round(1000 / TICK_HZ));

server.listen(PORT, () => {
  console.log('[CatQuest×RO Binary Cluster] Listening on ws://localhost:' + PORT + '/ws (' + TICK_HZ + 'Hz Tick Rate)');
});
