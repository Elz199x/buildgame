/* ============================================================
   MODULE 05b — net-codec : โปรโตคอลไบนารีความเร็วสูง (FlatBuffers-style Binary Wire Codec)
   ไม่มีการแตะ DOM (รันได้ทั้งใน Browser, WebWorker และ Node.js Server)
   โครงสร้างแพ็กเก็ตไบนารี (Little-Endian, Zero-GC DataView):
   Header (4 bytes):
     [0] magic   : uint8  (0xC7 = CatQuest×RO Binary Frame)
     [1] version : uint8  (0x01)
     [2] opcode  : uint8  (OP_*)
     [3] flags   : uint8  (bit0 = compressed/delta, bit1 = authoritative)
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};

  const MAGIC = 0xC7;
  const VERSION = 1;

  // รหัส Opcode มาตรฐานตรงกันทั้ง Client (JS), Gateway (Go) และ Simulation Server (Go)
  const OP = {
    PING:           0x01, // 12B : [hdr:4][clientTs:f64]
    PONG:           0x02, // 16B : [hdr:4][clientTs:f64][serverTick:u32]
    WELCOME:        0x04, // 8B  : [hdr:4][uid:u32]  เซิร์ฟเวอร์บอก uid ของผู้เล่นคนนี้
    AUTH:           0x03, // [hdr:4][classIdx:u8][weaponIdx:u8][baseLv:u8][jobLv:u8][nameLen:u8][nameBytes...]
    MOVE:           0x10, // 22B : [hdr:4][seq:u32][x:f32][y:f32][vx:i16][vy:i16][facing:i8][anim:u8]
    USEITEM:        0x14, // 10B : [hdr:4][seq:u32][itemIdx:u16]  ใช้ไอเทมฟื้นฟู (itemIdx = ลำดับใน equipItems)
    ATTACK:         0x11, // 16B : [hdr:4][seq:u32][targetUid:u32][x:u16][y:u16]
    SKILL:          0x12, // 18B : [hdr:4][seq:u32][skillIdx:u16][lv:u8][pad:u8][targetUid:u32][x:u16][y:u16]
    ROLL:           0x13, // 16B : [hdr:4][seq:u32][x:u16][y:u16][dx:i16][dy:i16]
    WORLD_SNAPSHOT: 0x20, // [hdr:4][serverTick:u32][peerCount:u8][mobCount:u8][peers...][mobs...]
    DAMAGE_EVENT:   0x21, // 20B : [hdr:4][attackerUid:u32][targetUid:u32][dmg:u32][hpLeft:u32][flags:u8(bit0:crit,bit1:miss,bit2:magic,bit3:kill)]
    PLAYER_STATE:   0x23, // [hdr:4][hp:f32][maxHp:f32][sp:f32][maxSp:f32][n:u8] + n×[skillIdx:u16][lv:u8][leftDs:u16]  (เซิร์ฟเวอร์→เจ้าของตัวละคร)
    STATE_SYNC:     0x24, // [hdr:4][len:u32][state JSON utf8]  ตัวละครทั้งก้อนที่เซิร์ฟเวอร์ตัดสินแล้ว (เซิร์ฟเวอร์→เจ้าของ)
    REWARD:         0x25, // [hdr:4][mobUid:u32][baseExp:u32][jobExp:u32][gold:u32][baseLv:u8][jobLv:u8][flags:u8(bit0 baseLvUp,bit1 jobLvUp)][n:u8] + n×[itemIdx:u16][qty:u8]
    TELEGRAPH:      0x22, // 22B : [hdr:4][mobUid:u32][shape:u8][x:u16][y:u16][radius:u16][angleDeg:i16][castMs:u16][multPct:u16]
    CHAT:           0x30  // [hdr:4][channel:u8][senderLen:u8][sender...][msgLen:u16][msg...]
  };

  const ANIM_CODES = ['idle', 'walk', 'attack', 'cast', 'roll', 'hurt', 'dead'];
  const CLASS_CODES = ['novice', 'swordman', 'thief', 'archer', 'mage'];
  const WEAPON_CODES = ['unarmed', 'sword_1h', 'sword_2h', 'axe', 'mace', 'dagger', 'bow', 'staff'];
  const SHAPE_CODES = ['circle', 'cone', 'line'];

  const textEnc = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;
  const textDec = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;

  function encodeUTF8(str){
    str = String(str || '');
    if(textEnc) return textEnc.encode(str);
    const arr = [];
    for(let i = 0; i < str.length; i++){
      let c = str.charCodeAt(i);
      if(c < 0x80) arr.push(c);
      else if(c < 0x800) arr.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return new Uint8Array(arr);
  }

  function decodeUTF8(bytes){
    if(textDec) return textDec.decode(bytes);
    let out = '', i = 0;
    while(i < bytes.length){
      const c = bytes[i++];
      if(c < 0x80) out += String.fromCharCode(c);
      else if((c & 0xe0) === 0xc0) out += String.fromCharCode(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
      else out += String.fromCharCode(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    }
    return out;
  }

  function writeHeader(dv, op, flags){
    dv.setUint8(0, MAGIC);
    dv.setUint8(1, VERSION);
    dv.setUint8(2, op);
    dv.setUint8(3, flags || 0);
  }

  const codec = {
    MAGIC: MAGIC,
    VERSION: VERSION,
    OP: OP,
    ANIM_CODES: ANIM_CODES,
    CLASS_CODES: CLASS_CODES,
    WEAPON_CODES: WEAPON_CODES,
    SHAPE_CODES: SHAPE_CODES,

    // สถิติเปรียบเทียบขนาด Binary vs JSON เพื่อแสดงผลใน HUD
    stats: {
      packetsSent: 0,
      packetsRecv: 0,
      binaryBytes: 0,
      jsonEquivBytes: 0,
      lastFrameBytes: 0,
      lastJsonBytes: 0
    },

    resetStats(){
      this.stats.packetsSent = 0;
      this.stats.packetsRecv = 0;
      this.stats.binaryBytes = 0;
      this.stats.jsonEquivBytes = 0;
      this.stats.lastFrameBytes = 0;
      this.stats.lastJsonBytes = 0;
    },

    recordStats(binLen, jsonObj, isRecv){
      if(isRecv) this.stats.packetsRecv++; else this.stats.packetsSent++;
      const jLen = encodeUTF8(JSON.stringify(jsonObj)).byteLength;
      this.stats.binaryBytes += binLen;
      this.stats.jsonEquivBytes += jLen;
      this.stats.lastFrameBytes = binLen;
      this.stats.lastJsonBytes = jLen;
    },

    savingsRatio(){
      if(!this.stats.jsonEquivBytes) return 0.85;
      return Math.max(0, 1 - (this.stats.binaryBytes / this.stats.jsonEquivBytes));
    },

    /* ---------- ENCODERS (สร้าง ArrayBuffer ขนาดกะทัดรัด) ---------- */
    encodePing(clientTs){
      const buf = new ArrayBuffer(12), dv = new DataView(buf);
      writeHeader(dv, OP.PING, 0);
      dv.setFloat64(4, clientTs || Date.now(), true);
      this.recordStats(12, { op: 'ping', clientTs: clientTs || Date.now() }, false);
      return buf;
    },

    encodePong(clientTs, serverTick){
      const buf = new ArrayBuffer(16), dv = new DataView(buf);
      writeHeader(dv, OP.PONG, 1);
      dv.setFloat64(4, clientTs || 0, true);
      dv.setUint32(12, serverTick || 0, true);
      return buf;
    },

    encodeAuth(p){
      const nameBytes = encodeUTF8((p && p.name) || 'Hero').slice(0, 64);
      const buf = new ArrayBuffer(9 + nameBytes.byteLength), dv = new DataView(buf);
      writeHeader(dv, OP.AUTH, 0);
      dv.setUint8(4, Math.max(0, CLASS_CODES.indexOf(p.classId)));
      dv.setUint8(5, Math.max(0, WEAPON_CODES.indexOf(p.weaponId)));
      dv.setUint8(6, Math.min(255, Math.max(1, p.baseLv || 50)));
      dv.setUint8(7, Math.min(255, Math.max(1, p.jobLv || 50)));
      dv.setUint8(8, nameBytes.byteLength);
      new Uint8Array(buf, 9).set(nameBytes);
      this.recordStats(buf.byteLength, { op: 'auth', payload: p }, false);
      return buf;
    },

    // MOVE ใช้เพียง 22 ไบต์ (เทียบกับ JSON ~155 ไบต์ ประหยัด 85.8%)
    encodeMove(m){
      const buf = new ArrayBuffer(22), dv = new DataView(buf);
      writeHeader(dv, OP.MOVE, 0);
      dv.setUint32(4, m.seq || 0, true);
      dv.setFloat32(8, m.x || 0, true);
      dv.setFloat32(12, m.y || 0, true);
      dv.setInt16(16, Math.round(m.vx || 0), true);
      dv.setInt16(18, Math.round(m.vy || 0), true);
      dv.setInt8(20, (m.facing || 1) >= 0 ? 1 : -1);
      dv.setUint8(21, Math.max(0, ANIM_CODES.indexOf(m.animState || 'idle')));
      this.recordStats(22, { op: 'move', seq: m.seq, x: m.x, y: m.y, vx: m.vx, vy: m.vy, facing: m.facing, animState: m.animState }, false);
      return buf;
    },

    // USEITEM 10 ไบต์ : [hdr:4][seq:u32][itemIdx:u16]
    encodeUseItem(u){
      const buf = new ArrayBuffer(10), dv = new DataView(buf);
      writeHeader(dv, OP.USEITEM, 0);
      dv.setUint32(4, u.seq || 0, true);
      dv.setUint16(8, Math.max(0, u.itemIdx || 0), true);
      this.recordStats(10, { op: 'useitem', itemIdx: u.itemIdx }, false);
      return buf;
    },

    // ROLL 16 ไบต์ : [hdr:4][seq:u32][x:u16][y:u16][dx:i16][dy:i16]
    encodeRoll(r){
      const buf = new ArrayBuffer(16), dv = new DataView(buf);
      writeHeader(dv, OP.ROLL, 0);
      dv.setUint32(4, r.seq || 0, true);
      dv.setUint16(8, Math.max(0, Math.round(r.x || 0)), true);
      dv.setUint16(10, Math.max(0, Math.round(r.y || 0)), true);
      dv.setInt16(12, Math.round(r.dx || 0), true);
      dv.setInt16(14, Math.round(r.dy || 0), true);
      this.recordStats(16, { op: 'roll', seq: r.seq, x: r.x, y: r.y }, false);
      return buf;
    },

    // ATTACK ใช้เพียง 16 ไบต์
    encodeAttack(a){
      const buf = new ArrayBuffer(16), dv = new DataView(buf);
      writeHeader(dv, OP.ATTACK, 0);
      dv.setUint32(4, a.seq || 0, true);
      dv.setUint32(8, a.targetUid || 0, true);
      dv.setUint16(12, Math.max(0, Math.round(a.x || 0)), true);
      dv.setUint16(14, Math.max(0, Math.round(a.y || 0)), true);
      this.recordStats(16, { op: 'attack', seq: a.seq, targetUid: a.targetUid, x: a.x, y: a.y }, false);
      return buf;
    },

    // SKILL ใช้เพียง 18 ไบต์
    encodeSkill(s){
      const buf = new ArrayBuffer(18), dv = new DataView(buf);
      writeHeader(dv, OP.SKILL, 0);
      dv.setUint32(4, s.seq || 0, true);
      dv.setUint16(8, s.skillIdx || 0, true);
      dv.setUint8(10, s.lv || 1);
      dv.setUint8(11, 0);
      dv.setUint32(12, s.targetUid || 0, true);
      dv.setUint16(16, Math.max(0, Math.round(s.x || 0)), true);
      this.recordStats(18, { op: 'skill', seq: s.seq, skillId: s.skillId, lv: s.lv, targetUid: s.targetUid, x: s.x, y: s.y }, false);
      return buf;
    },

    // DAMAGE_EVENT ใช้เพียง 21 ไบต์
    encodeDamageEvent(ev){
      const buf = new ArrayBuffer(21), dv = new DataView(buf);
      writeHeader(dv, OP.DAMAGE_EVENT, 1);
      dv.setUint32(4, ev.attackerUid || 0, true);
      dv.setUint32(8, ev.targetUid || 0, true);
      dv.setUint32(12, Math.max(0, Math.round(ev.dmg || 0)), true);
      dv.setUint32(16, Math.max(0, Math.round(ev.hpLeft || 0)), true);
      const flags = (ev.crit ? 1 : 0) | (ev.miss ? 2 : 0) | (ev.isMagic ? 4 : 0) | (ev.kill ? 8 : 0);
      dv.setUint8(20, flags);
      this.recordStats(21, { op: 'damage', attackerUid: ev.attackerUid, targetUid: ev.targetUid, dmg: ev.dmg, hpLeft: ev.hpLeft, crit: ev.crit, miss: ev.miss }, true);
      return buf;
    },

    // WORLD_SNAPSHOT บีบอัดผู้เล่นและมอนสเตอร์ทั้งแมพในเฟรมเดียว (Peer ละ 16B, Mob ละ 16B)
    encodeWorldSnapshot(snapOrTick, peersArg, mobsArg){
      const snap = (typeof snapOrTick === 'object' && snapOrTick !== null)
        ? snapOrTick
        : { tick: snapOrTick || 0, peers: peersArg || [], mobs: mobsArg || [] };
      const peers = (snap && snap.peers) || [];
      const mobs = (snap && snap.mobs) || [];
      const pCount = Math.min(255, peers.length);
      const mCount = Math.min(255, mobs.length);
      const totalBytes = 10 + pCount * 16 + mCount * 16;
      const buf = new ArrayBuffer(totalBytes), dv = new DataView(buf);
      writeHeader(dv, OP.WORLD_SNAPSHOT, 1);
      dv.setUint32(4, (snap && snap.tick) || 0, true);
      dv.setUint8(8, pCount);
      dv.setUint8(9, mCount);
      let off = 10;
      for(let i = 0; i < pCount; i++){
        const p = peers[i];
        dv.setUint32(off, p.uid || 0, true);
        dv.setUint16(off + 4, Math.max(0, Math.round(p.x || 0)), true);
        dv.setUint16(off + 6, Math.max(0, Math.round(p.y || 0)), true);
        dv.setUint16(off + 8, Math.max(0, Math.round(p.hp || 0)), true);
        dv.setUint16(off + 10, Math.max(1, Math.round(p.maxHp || 1)), true);
        dv.setUint8(off + 12, Math.max(0, CLASS_CODES.indexOf(p.classId || 'novice')));
        dv.setUint8(off + 13, Math.max(0, WEAPON_CODES.indexOf(p.weaponId || 'unarmed')));
        dv.setInt8(off + 14, (p.facing || 1) >= 0 ? 1 : -1);
        dv.setUint8(off + 15, Math.max(0, ANIM_CODES.indexOf(p.animState || 'idle')));
        off += 16;
      }
      for(let j = 0; j < mCount; j++){
        const m = mobs[j];
        dv.setUint32(off, m.uid || 0, true);
        dv.setUint16(off + 4, Math.max(0, Math.round(m.x || 0)), true);
        dv.setUint16(off + 6, Math.max(0, Math.round(m.y || 0)), true);
        dv.setUint32(off + 8, Math.max(0, Math.round(m.hp || 0)), true);
        dv.setUint8(off + 12, m.alive ? 1 : 0);
        dv.setInt8(off + 13, (m.facing || -1) >= 0 ? 1 : -1);
        dv.setUint8(off + 14, Math.max(0, ANIM_CODES.indexOf(m.animState || 'idle')));
        dv.setUint8(off + 15, m.casting ? 1 : 0);
        off += 16;
      }
      this.recordStats(totalBytes, snap, true);
      return buf;
    },

    encodeChat(c){
      const sBytes = encodeUTF8((c && c.sender) || 'Player').slice(0, 64);
      const mBytes = encodeUTF8((c && c.text) || '').slice(0, 512);
      const buf = new ArrayBuffer(8 + sBytes.byteLength + mBytes.byteLength);
      const dv = new DataView(buf);
      writeHeader(dv, OP.CHAT, 0);
      dv.setUint8(4, c.channel || 0);
      dv.setUint8(5, sBytes.byteLength);
      dv.setUint16(6, mBytes.byteLength, true);
      const u8 = new Uint8Array(buf);
      u8.set(sBytes, 8);
      u8.set(mBytes, 8 + sBytes.byteLength);
      this.recordStats(buf.byteLength, { op: 'chat', sender: c.sender, text: c.text }, false);
      return buf;
    },

    /* ---------- DECODER (ถอดรหัส ArrayBuffer กลับเป็น Object ทันที) ---------- */
    decode(buf){
      if(!buf) return null;
      const ab = buf instanceof ArrayBuffer ? buf : (buf.buffer ? buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) : null);
      if(!ab || ab.byteLength < 4) return null;
      const dv = new DataView(ab);
      const magic = dv.getUint8(0);
      if(magic !== MAGIC) return null;
      const ver = dv.getUint8(1);
      const op = dv.getUint8(2);
      const flags = dv.getUint8(3);

      if(op === OP.PING && ab.byteLength >= 12){
        return { op: OP.PING, ver: ver, clientTs: dv.getFloat64(4, true) };
      }
      if(op === OP.PONG && ab.byteLength >= 16){
        return { op: OP.PONG, ver: ver, clientTs: dv.getFloat64(4, true), serverTick: dv.getUint32(12, true) };
      }
      if(op === OP.AUTH && ab.byteLength >= 9){
        const nLen = dv.getUint8(8);
        const name = decodeUTF8(new Uint8Array(ab, 9, Math.min(nLen, ab.byteLength - 9)));
        return {
          op: OP.AUTH,
          classId: CLASS_CODES[dv.getUint8(4)] || 'novice',
          weaponId: WEAPON_CODES[dv.getUint8(5)] || 'unarmed',
          baseLv: dv.getUint8(6),
          jobLv: dv.getUint8(7),
          name: name
        };
      }
      if(op === OP.MOVE && ab.byteLength >= 22){
        return {
          op: OP.MOVE,
          seq: dv.getUint32(4, true),
          x: dv.getFloat32(8, true),
          y: dv.getFloat32(12, true),
          vx: dv.getInt16(16, true),
          vy: dv.getInt16(18, true),
          facing: dv.getInt8(20),
          animState: ANIM_CODES[dv.getUint8(21)] || 'idle'
        };
      }
      if(op === OP.PLAYER_STATE && ab.byteLength >= 21){
        const n = Math.min(dv.getUint8(20), Math.floor((ab.byteLength - 21) / 5));
        const statuses = [];
        for(let i = 0; i < n; i++){
          const o = 21 + i * 5, ds = dv.getUint16(o + 3, true);
          statuses.push({ skillIdx: dv.getUint16(o, true), lv: dv.getUint8(o + 2), left: ds === 0xFFFF ? Infinity : ds / 10 });
        }
        return { op: OP.PLAYER_STATE, hp: dv.getFloat32(4, true), maxHp: dv.getFloat32(8, true), sp: dv.getFloat32(12, true), maxSp: dv.getFloat32(16, true), statuses: statuses };
      }
      if(op === OP.STATE_SYNC && ab.byteLength >= 8){
        const len = dv.getUint32(4, true);
        if(len > ab.byteLength - 8) return null;
        let obj = null;
        try{ obj = JSON.parse(decodeUTF8(new Uint8Array(ab, 8, len))); }catch(e){ return null; }
        return { op: OP.STATE_SYNC, state: obj };
      }
      if(op === OP.REWARD && ab.byteLength >= 24){
        const n = Math.min(dv.getUint8(23), Math.floor((ab.byteLength - 24) / 3)), items = [];
        for(let i = 0; i < n; i++){ const o = 24 + i * 3; items.push({ itemIdx: dv.getUint16(o, true), qty: dv.getUint8(o + 2) }); }
        const fl = dv.getUint8(22);
        return { op: OP.REWARD, mobUid: dv.getUint32(4, true), baseExp: dv.getUint32(8, true), jobExp: dv.getUint32(12, true), gold: dv.getUint32(16, true),
          baseLv: dv.getUint8(20), jobLv: dv.getUint8(21), baseLvUp: !!(fl & 1), jobLvUp: !!(fl & 2), items: items };
      }
      if(op === OP.WELCOME && ab.byteLength >= 8){
        return { op: OP.WELCOME, uid: dv.getUint32(4, true) };
      }
      if(op === OP.TELEGRAPH && ab.byteLength >= 21){
        return {
          op: OP.TELEGRAPH,
          mobUid: dv.getUint32(4, true),
          shape: SHAPE_CODES[dv.getUint8(8)] || 'circle',
          x: dv.getUint16(9, true),
          y: dv.getUint16(11, true),
          radius: dv.getUint16(13, true),
          angleDeg: dv.getInt16(15, true),
          castMs: dv.getUint16(17, true),
          multPct: dv.getUint16(19, true)
        };
      }
      if(op === OP.ATTACK && ab.byteLength >= 16){
        return {
          op: OP.ATTACK,
          seq: dv.getUint32(4, true),
          targetUid: dv.getUint32(8, true),
          x: dv.getUint16(12, true),
          y: dv.getUint16(14, true)
        };
      }
      if(op === OP.SKILL && ab.byteLength >= 18){
        return {
          op: OP.SKILL,
          seq: dv.getUint32(4, true),
          skillIdx: dv.getUint16(8, true),
          lv: dv.getUint8(10),
          targetUid: dv.getUint32(12, true),
          x: dv.getUint16(16, true)
        };
      }
      if(op === OP.DAMAGE_EVENT && ab.byteLength >= 21){
        const fl = dv.getUint8(20);
        return {
          op: OP.DAMAGE_EVENT,
          attackerUid: dv.getUint32(4, true),
          targetUid: dv.getUint32(8, true),
          dmg: dv.getUint32(12, true),
          hpLeft: dv.getUint32(16, true),
          crit: !!(fl & 1),
          miss: !!(fl & 2),
          isMagic: !!(fl & 4),
          kill: !!(fl & 8)
        };
      }
      if(op === OP.WORLD_SNAPSHOT && ab.byteLength >= 10){
        const tick = dv.getUint32(4, true);
        const pCount = dv.getUint8(8);
        const mCount = dv.getUint8(9);
        const peers = [], mobs = [];
        let off = 10;
        for(let i = 0; i < pCount && off + 16 <= ab.byteLength; i++){
          peers.push({
            uid: dv.getUint32(off, true),
            x: dv.getUint16(off + 4, true),
            y: dv.getUint16(off + 6, true),
            hp: dv.getUint16(off + 8, true),
            maxHp: dv.getUint16(off + 10, true),
            classId: CLASS_CODES[dv.getUint8(off + 12)] || 'novice',
            weaponId: WEAPON_CODES[dv.getUint8(off + 13)] || 'unarmed',
            facing: dv.getInt8(off + 14),
            animState: ANIM_CODES[dv.getUint8(off + 15)] || 'idle'
          });
          off += 16;
        }
        for(let j = 0; j < mCount && off + 16 <= ab.byteLength; j++){
          mobs.push({
            uid: dv.getUint32(off, true),
            x: dv.getUint16(off + 4, true),
            y: dv.getUint16(off + 6, true),
            hp: dv.getUint32(off + 8, true),
            alive: dv.getUint8(off + 12) === 1,
            facing: dv.getInt8(off + 13),
            animState: ANIM_CODES[dv.getUint8(off + 14)] || 'idle',
            casting: dv.getUint8(off + 15) === 1
          });
          off += 16;
        }
        return { op: OP.WORLD_SNAPSHOT, flags: flags, tick: tick, peers: peers, mobs: mobs };
      }
      if(op === OP.CHAT && ab.byteLength >= 8){
        const ch = dv.getUint8(4);
        const sLen = dv.getUint8(5);
        const mLen = dv.getUint16(6, true);
        const sender = decodeUTF8(new Uint8Array(ab, 8, Math.min(sLen, ab.byteLength - 8)));
        const text = decodeUTF8(new Uint8Array(ab, 8 + sLen, Math.min(mLen, Math.max(0, ab.byteLength - 8 - sLen))));
        return { op: OP.CHAT, channel: ch, sender: sender, text: text };
      }
      return { op: op, ver: ver, flags: flags };
    }
  };

  SL.binCodec = codec;
})(typeof window !== 'undefined' ? window : globalThis);
