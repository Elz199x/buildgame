/* ============================================================
   MODULE 05c — remote : ติดต่อเซิร์ฟเวอร์เกม Go (REST + cookie เซสชัน)
   - SL.remote : ตัวช่วยเรียก API
   - SL.game   : คำสั่งความก้าวหน้า (เรียนสกิล ทุ่มสเตตัส สวมใส่ ร้านค้า คลัง เลื่อนอาชีพ ฯลฯ) — เซิร์ฟเวอร์ตัดสิน
                 ผลลัพธ์คือ state ใหม่ที่ไคลเอนต์ "แทนที่" ของเดิม (ไม่คำนวณผลเอง)
   - SL.remoteSim : ตัวจำลองต่อสู้ของหน้า DPS ที่ทำงานบนเซิร์ฟเวอร์ (ไคลเอนต์แค่ส่งคำสั่ง/วาดภาพ)
   ไม่แตะ DOM — ข้อความแจ้งผู้ใช้ผ่าน SL.ui.toast (โหลดทีหลัง จึงเรียกแบบหน่วงเวลา)
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};

  const toast = msg => { try{ if(SL.ui && SL.ui.toast) SL.ui.toast(msg); else console.warn(msg); }catch(e){} };

  function call(method, path, body){
    if(!g.__SL_REMOTE_API) return Promise.reject(Object.assign(new Error('ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์เกม'), { status: 0 }));
    const init = { method: method, credentials: 'include', cache: 'no-store' };
    if(body !== undefined){ init.headers = { 'Content-Type': 'application/json' }; init.body = JSON.stringify(body); }
    return fetch(g.__SL_REMOTE_API + path, init).then(r => {
      if(r.status === 204) return null;
      return r.json().catch(() => null).then(j => {
        if(!r.ok){
          if(r.status === 401) setTimeout(() => { g.location.href = '/login'; }, 800); // เซสชันหมดอายุ
          throw Object.assign(new Error((j && j.error) || ('คำขอล้มเหลว (' + r.status + ')')), { status: r.status });
        }
        return j;
      });
    }, () => { throw Object.assign(new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้'), { status: 0 }); });
  }

  SL.remote = {
    enabled(){ return !!g.__SL_REMOTE_API; },
    get: path => call('GET', path),
    post: (path, body) => call('POST', path, body === undefined ? {} : body),
    put: (path, body) => call('PUT', path, body),
    del: path => call('DELETE', path),
  };

  /* ---------- คำสั่งเกม (โหมดเกม: เซิร์ฟเวอร์เป็นเจ้าของความก้าวหน้า) ---------- */
  const inflight = {};
  function run(name, body){
    // กันกดซ้ำคำสั่งเดียวกันระหว่างรอผล (เช่น ดับเบิลคลิกซื้อ) — คำสั่งต่างชนิดทำพร้อมกันได้
    const key = name + ':' + JSON.stringify(body);
    if(inflight[key]) return inflight[key];
    const p = SL.remote.post('/api/game/' + name, body).then(r => {
      if(r && r.state) SL.state.applyServer(r.state);
      return true;
    }).catch(e => { toast('⚠️ ' + e.message); return false; }).then(ok => { delete inflight[key]; return ok; });
    inflight[key] = p;
    return p;
  }

  SL.game = {
    active(){ return !!g.__SL_GAME; },
    learn: skillId => run('learn', { skillId: skillId }),
    unlearn: skillId => run('unlearn', { skillId: skillId }),
    stat: (stat, n) => run('stat', { stat: stat, n: n || 1 }),
    equip: (itemId, set) => run('equip', { itemId: itemId, set: !!set }),
    unequip: slot => run('unequip', { slot: slot }),
    weapon: weaponId => run('weapon', { weaponId: weaponId }),
    shield: on => run('shield', { on: !!on }),
    storage: (op, itemId, qty) => run('storage', { op: op, itemId: itemId, qty: qty || 1 }),
    shop: (op, itemId, qty) => run('shop', { op: op, itemId: itemId, qty: qty || 1 }),
    classChange: classId => run('class', { classId: classId }),
    // ค่าที่ปรับเองได้ทุกโหมด (ลำดับสกิล/ตัวเลือกจำลอง/มอนสเตอร์เป้าหมาย) — ไม่กระทบความก้าวหน้า
    prefs: patch => SL.remote.put('/api/characters/me/prefs', patch),
  };

  /* ---------- ตัวจำลองต่อสู้ระยะไกล (หน้า DPS) ---------- */
  const STEP_MIN_MS = 90;   // ส่งคำขอไม่ถี่กว่านี้ (เซิร์ฟเวอร์จำกัด ~20 ครั้ง/วินาทีต่อผู้ใช้)
  const STEP_MIN_DT = 0.08; // ก้าวเวลาขั้นต่ำต่อคำขอ

  function fixView(v){
    if(!v) return v;
    v.pst = v.pst || []; v.mst = v.mst || []; v.cd = v.cd || {}; v.queue = v.queue || []; v.why = v.why || {};
    // JSON เก็บ Infinity ไม่ได้: เซิร์ฟเวอร์ใช้ -1 แทน "ไม่หมดเวลา"
    [v.pst, v.mst].forEach(list => (list || []).forEach(x => { if(x.left < 0) x.left = Infinity; }));
    return v;
  }

  // getState() = สถานะที่ใช้จำลอง (SL.sandbox.get) ; โครงสร้างเมธอดเหมือน SL.sim.create เดิม แต่ผลมาจากเซิร์ฟเวอร์
  SL.remoteSim = function(getState){
    let id = null, view = null, summary = null, events = [];
    let pendingDt = 0, casts = [], needSync = true, needReset = false, inflightReq = false, lastAt = 0, failed = 0, disposed = false;

    function failure(e){
      failed++;
      if(failed === 1 || failed % 20 === 0) toast('⚠️ จำลองไม่ได้: ' + e.message);
    }
    function step(force){
      if(inflightReq || disposed) return;
      const now = Date.now();
      if(!force && now - lastAt < STEP_MIN_MS) return;
      if(!id){
        inflightReq = true; lastAt = now;
        SL.remote.post('/api/sim/sessions', { state: getState() }).then(j => {
          id = j.id; view = fixView(j.view); summary = j.summary; needSync = false; failed = 0;
        }).catch(failure).then(() => { inflightReq = false; });
        return;
      }
      const dt = Math.min(pendingDt, 2);
      if(!force && dt < STEP_MIN_DT && !casts.length && !needSync && !needReset) return;
      const body = { dt: dt, casts: casts.splice(0, 5) };
      pendingDt -= dt;
      if(needSync){ body.state = getState(); needSync = false; }
      if(needReset){ body.reset = true; needReset = false; events = []; }
      inflightReq = true; lastAt = now;
      SL.remote.post('/api/sim/sessions/' + id + '/advance', body).then(j => {
        view = fixView(j.view); summary = j.summary; failed = 0;
        if(j.events && j.events.length) events = events.concat(j.events).slice(-300);
      }).catch(e => {
        if(e.status === 404){ id = null; needSync = true; } else failure(e); // session หมดอายุ: สร้างใหม่
      }).then(() => { inflightReq = false; });
    }

    return {
      advance(dt){ pendingDt += dt; step(false); },
      cast(skillId){ if(casts.indexOf(skillId) < 0) casts.push(skillId); step(true); },
      sync(){ needSync = true; step(true); },
      reset(){ needReset = true; step(true); },
      view(){ return view; },
      summary(){ return summary; },
      drain(){ const e = events; events = []; return e; },
      why(skillId){ return view && view.why ? (view.why[skillId] || '') : ''; },
      ready(){ return !!view; },
      dispose(){ disposed = true; if(id) SL.remote.del('/api/sim/sessions/' + id).catch(() => {}); },
    };
  };
})(typeof window !== 'undefined' ? window : globalThis);
