/* ============================================================
   MODULE 02 — store : ที่เก็บ "ข้อมูลสกิล" (data) และ "สถานะตัวละคร" (state) แยกกัน
   - data  = นิยามคลาส/สกิล/อาวุธ/... (แก้ในตัวแก้ไข) เก็บในฐานข้อมูลฝั่งเซิร์ฟเวอร์ (โหลดผ่าน /api/data)
   - state = ตัวละครที่กำลังทดสอบ (คลาส, Job Lv, สกิลที่ลง, สเตตัส, ม้อนสเตอร์, ลำดับสกิลอัตโนมัติ) คีย์ roSkillLabState_v1
   ทุกการแก้ไขผ่าน change() เพื่อ normalize + บันทึก + แจ้งผู้ฟัง (UI) — โมดูลอื่นไม่ต้องรู้จักกัน
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const { clone } = SL.util;

  const COLLECTIONS = ['classes','branches','skills','weapons','statDefs','presets','monsters','builds'];

  function normalizeSkill(s){
    const d = {
      id:'', class:'', name:'', desc:'', type:'passive', branch:'', tier:1, jobLvReq:1, maxLevel:1,
      requires:[], weaponReq:{ slotType:'', damageType:'', include:[], exclude:[] }, needShield:false,
      usage:{}, damage:{ kind:'', terms:[], noCrit:false, alwaysHit:false, aoe:false }, heal:null,
      effects:[], group:'', trigger:null, toggleOff:null, hooks:{}
    };
    const o = Object.assign(d, s);
    o.weaponReq = Object.assign({ slotType:'', damageType:'', include:[], exclude:[] }, s.weaponReq || {});
    o.weaponReq.include = o.weaponReq.include || []; o.weaponReq.exclude = o.weaponReq.exclude || [];
    o.damage = Object.assign({ kind:'', terms:[], noCrit:false, alwaysHit:false, aoe:false }, s.damage || {});
    o.damage.terms = (o.damage.terms || []).map(t => ({ stat: t.stat || 'atk', mult: t.mult === undefined ? 1 : t.mult }));
    o.effects = (s.effects || []).map(e => Object.assign({ stat:'atk', mode:'flat', value:0, appliesTo:'self' }, e));
    o.requires = (s.requires || []).map(r => ({ id: r.id, lv: Math.max(1, Number(r.lv) || 1) }));
    o.usage = Object.assign({}, s.usage || {});
    o.hooks = Object.assign({}, s.hooks || {});
    o.maxLevel = Math.max(1, Math.round(Number(o.maxLevel) || 1));
    o.tier = Math.max(1, Math.round(Number(o.tier) || 1));
    o.jobLvReq = Math.max(1, Math.round(Number(o.jobLvReq) || 1));
    return o;
  }

  // ฐานข้อมูลบนเซิร์ฟเวอร์เป็นแหล่งความจริงเดียวของข้อมูลเกม — ไม่มีค่าเริ่มต้นฝังในโค้ดเบราว์เซอร์
  // (เซิร์ฟเวอร์ตรวจความครบถ้วนทุกครั้งที่บันทึก/โหลด; ที่นี่แค่ตรวจโครงสร้างขั้นต่ำแล้วปรับสกิลให้อยู่ในรูปมาตรฐาน)
  function normalizeData(data){
    const out = (data && typeof data === 'object') ? data : {};
    if(!Array.isArray(out.skills) || !out.formulaConfig || !out.globals || !out.rules) throw new Error('ข้อมูลเกมจากเซิร์ฟเวอร์ไม่ครบ (ต้องมี skills/formulaConfig/globals/rules) — ให้แอดมินรีเซ็ตข้อมูลบนเซิร์ฟเวอร์');
    out.skills = out.skills.filter(s => s && s.id).map(normalizeSkill);
    out.version = 3;
    return out;
  }


  /* ---------------- DATA ---------------- */
  let DATA = null;
  const dataListeners = [];
  // ข้อมูลเกมใน DB มี 2 ชนิด — เซิร์ฟเวอร์ส่ง _meta มาให้ (ไม่ฝังรายชื่อในโค้ดฝั่งนี้):
  //   - หมวดเอกสาร (balance/entities/world/tools): META.versions[หมวด], META.categories[หมวด] = คีย์ในเอกสาร
  //   - ตารางรายการ (classes/branches/skills/weapons/stats): META.tables[ตาราง][id] = เวอร์ชันของแถว, META.tableKeys, META.tableOrder (ลำดับพึ่งพา)
  // ไคลเอนต์ส่งแก้เฉพาะสิ่งที่เปลี่ยนจริง (หมวดเดียว / สกิลทีละตัว) พร้อม If-Match เพื่อไม่ทับงานของแอดมินคนอื่น
  let META = { versions: {}, categories: {}, tables: {}, tableKeys: {}, tableOrder: [] };
  let SYNCED_T = {};                     // ตาราง -> { id -> JSON ของรายการ ณ ครั้งล่าสุดที่ตรงกับเซิร์ฟเวอร์ }
  let SYNCED = {};                       // หมวด -> JSON ของหมวดนั้น ณ ครั้งล่าสุดที่ตรงกับเซิร์ฟเวอร์
  const apiOpt = { credentials: 'include' };
  function partJSON(d, cat){
    const o = {}; (META.categories[cat] || []).forEach(k => { if(d[k] !== undefined) o[k] = d[k]; });
    return JSON.stringify(o);
  }
  function tableState(d, t){
    const m = {}; (d[META.tableKeys[t]] || []).forEach(it => { if(it && it.id) m[it.id] = JSON.stringify(it); });
    return m;
  }
  function snapshotSynced(){
    SYNCED = {}; Object.keys(META.categories).forEach(c => { SYNCED[c] = partJSON(DATA, c); });
    SYNCED_T = {}; META.tableOrder.forEach(t => { SYNCED_T[t] = tableState(DATA, t); });
  }
  // รับเอกสารข้อมูลเกมจากเซิร์ฟเวอร์ (มี _meta) เป็นข้อมูลปัจจุบัน
  function adopt(doc){
    const d = clone(doc); const meta = d._meta; delete d._meta;
    META = meta && meta.versions && meta.categories ? Object.assign({ tables: {}, tableKeys: {}, tableOrder: [] }, meta) : { versions: {}, categories: {}, tables: {}, tableKeys: {}, tableOrder: [] };
    DATA = normalizeData(d);
    snapshotSynced();
    return DATA;
  }
  function loadData(){
    if(!g.__SL_REMOTE_DATA || typeof g.__SL_REMOTE_DATA !== 'object') throw new Error('ไม่ได้รับข้อมูลเกมจากเซิร์ฟเวอร์');
    return adopt(g.__SL_REMOTE_DATA);
  }
  function refreshFromServer(){
    return fetch(g.__SL_REMOTE_API + '/api/data', apiOpt).then(r => r.json()).then(j => { adopt(j); SL.state.sanitize(); emitData('refresh'); });
  }
  function putCategory(cat){
    const body = partJSON(DATA, cat);
    return fetch(g.__SL_REMOTE_API + '/api/data/' + encodeURIComponent(cat) + '?note=web+editor', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json', 'If-Match': String(META.versions[cat]) }, body: body,
    }).then(r => {
      if(r.status === 409){
        // มีแอดมินคนอื่นแก้หมวดนี้ไปก่อน → ไม่ทับ: โหลดค่าล่าสุดมาแทน (การแก้ที่ยังไม่ได้บันทึกของหมวดนี้จะหายไป)
        return refreshFromServer().then(() => { if(SL.ui && SL.ui.toast) SL.ui.toast('หมวด ' + cat + ' ถูกแก้โดยผู้อื่นก่อนหน้า — โหลดค่าล่าสุดแล้ว กรุณาแก้ซ้ำ'); });
      }
      if(!r.ok){ console.warn('[Go server] บันทึกข้อมูลเกมหมวด', cat, 'ไม่สำเร็จ:', r.status); return; }
      return r.json().then(j => { META.versions[cat] = j.version; SYNCED[cat] = body; });
    });
  }
  function reportFail(r, what){
    return r.json().catch(() => ({})).then(j => { const msg = (j && j.error) || (what + ' ไม่สำเร็จ (' + r.status + ')'); console.warn('[Go server]', msg); if(SL.ui && SL.ui.toast) SL.ui.toast(msg); });
  }
  function conflict(r, what){
    // มีแอดมินคนอื่นแก้ไปก่อน หรือผิดความสัมพันธ์ → ไม่ทับ: โหลดค่าล่าสุดมาแทน (การแก้ที่ยังไม่ได้บันทึกของรายการนั้นจะหายไป)
    return r.json().catch(() => ({})).then(j => refreshFromServer().then(() => { if(SL.ui && SL.ui.toast) SL.ui.toast((j && j.error) || (what + ' ถูกแก้โดยผู้อื่นก่อนหน้า — โหลดค่าล่าสุดแล้ว')); }));
  }
  function putItem(t, id){
    const body = tableState(DATA, t)[id]; const exists = SYNCED_T[t] && SYNCED_T[t][id] !== undefined;
    const headers = { 'Content-Type': 'application/json' };
    if(exists) headers['If-Match'] = String((META.tables[t] || {})[id]); else headers['If-None-Match'] = '*';
    return fetch(g.__SL_REMOTE_API + '/api/tables/' + encodeURIComponent(t) + '/' + encodeURIComponent(id) + '?note=web+editor', { method: 'PUT', credentials: 'include', headers: headers, body: body }).then(r => {
      if(r.status === 409) return conflict(r, t + '/' + id);
      if(!r.ok) return reportFail(r, 'บันทึก ' + t + '/' + id);
      return r.json().then(j => { (META.tables[t] = META.tables[t] || {})[id] = j.version; SYNCED_T[t][id] = body; });
    });
  }
  function deleteItem(t, id){
    return fetch(g.__SL_REMOTE_API + '/api/tables/' + encodeURIComponent(t) + '/' + encodeURIComponent(id) + '?note=web+editor', { method: 'DELETE', credentials: 'include', headers: { 'If-Match': String((META.tables[t] || {})[id]) } }).then(r => {
      if(r.status === 409) return conflict(r, t + '/' + id);
      if(r.status === 404){ delete SYNCED_T[t][id]; return; }
      if(!r.ok) return reportFail(r, 'ลบ ' + t + '/' + id);
      delete SYNCED_T[t][id]; if(META.tables[t]) delete META.tables[t][id];
    });
  }
  // ลบก่อน (ตารางท้ายลำดับพึ่งพาก่อน) แล้วสร้าง/แก้ตามลำดับพึ่งพา — ให้ FOREIGN KEY ผ่าน
  function dirtyTableOps(){
    const dels = [], puts = [];
    META.tableOrder.forEach(t => {
      const cur = tableState(DATA, t), old = SYNCED_T[t] || {};
      Object.keys(old).forEach(id => { if(cur[id] === undefined) dels.unshift(() => deleteItem(t, id)); });
      Object.keys(cur).forEach(id => { if(cur[id] !== old[id]) puts.push(() => putItem(t, id)); });
    });
    return dels.concat(puts);
  }
  let remoteTimer = 0, saveChain = Promise.resolve();
  function saveRemote(){
    if(typeof fetch !== 'function') return;
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => {
      // ข้อมูลเกมเป็นของส่วนกลาง: เซิร์ฟเวอร์ให้เฉพาะ admin แก้ได้ (ผู้เล่นทั่วไปแก้ได้ในเครื่องเฉพาะเซสชันนี้)
      if(!g.__SL_USER || g.__SL_USER.role !== 'admin') return;
      saveChain = saveChain.then(() => {
        const jobs = dirtyTableOps().concat(Object.keys(META.categories).filter(c => partJSON(DATA, c) !== SYNCED[c]).map(c => () => putCategory(c)));
        return jobs.reduce((p, job) => p.then(job), Promise.resolve());
      }).catch(() => {});
    }, 800);
  }
  function saveData(){ saveRemote(); }
  // ประวัติเวอร์ชันของหมวดหนึ่งใน DB (แอดมินเท่านั้น)
  function listVersions(category){
    return fetch(g.__SL_REMOTE_API + '/api/data/versions?category=' + encodeURIComponent(category), apiOpt)
      .then(r => { if(!r.ok) throw new Error('อ่านประวัติเวอร์ชันไม่สำเร็จ (' + r.status + ') — ต้องเป็นแอดมิน'); return r.json(); });
  }
  // ย้อนหมวดไปเวอร์ชันที่เลือก: เซิร์ฟเวอร์สร้างเวอร์ชันใหม่จากข้อมูลของเวอร์ชันนั้น (ตรวจความสอดคล้องกับหมวดอื่นก่อนเสมอ) แล้วโหลดกลับมาใช้
  function rollbackTo(category, id){
    return fetch(g.__SL_REMOTE_API + '/api/data/rollback/' + encodeURIComponent(category) + '/' + encodeURIComponent(id), Object.assign({ method: 'POST' }, apiOpt))
      .then(r => { if(!r.ok) return r.json().catch(() => ({})).then(j => { throw new Error((j && j.error) || ('ย้อนเวอร์ชันไม่สำเร็จ (' + r.status + ')')); }); return refreshFromServer(); })
      .then(() => true);
  }
  // ประวัติการแก้ของรายการหนึ่งในตาราง (ใหม่→เก่า) และกู้รายการไปเป็นสถานะตามบรรทัดประวัติ (แอดมินเท่านั้น)
  function itemHistory(table, id){
    return fetch(g.__SL_REMOTE_API + '/api/tables/' + encodeURIComponent(table) + '/' + encodeURIComponent(id) + '/history', apiOpt)
      .then(r => { if(!r.ok) throw new Error('อ่านประวัติรายการไม่สำเร็จ (' + r.status + ') — ต้องเป็นแอดมิน'); return r.json(); });
  }
  function restoreItem(table, id, auditId){
    return fetch(g.__SL_REMOTE_API + '/api/tables/' + encodeURIComponent(table) + '/' + encodeURIComponent(id) + '/restore/' + encodeURIComponent(auditId), Object.assign({ method: 'POST' }, apiOpt))
      .then(r => { if(!r.ok) return r.json().catch(() => ({})).then(j => { throw new Error((j && j.error) || ('กู้คืนไม่สำเร็จ (' + r.status + ')')); }); return refreshFromServer(); })
      .then(() => true);
  }
  function emitData(reason){ dataListeners.slice().forEach(fn => { try{ fn(reason); }catch(e){ console.error(e); } }); }

  const store = {
    get(){ return DATA; },
    subscribe(fn){ dataListeners.push(fn); },
    // แก้ข้อมูลผ่านฟังก์ชันเดียว แล้ว normalize + sanitize state + บันทึก + แจ้งผู้ฟัง
    change(fn, reason){
      fn(DATA);
      DATA = normalizeData(DATA);
      saveData();
      SL.state.sanitize();
      emitData(reason || 'change');
    },
    replace(newData, reason){ DATA = normalizeData(newData); saveData(); SL.state.sanitize(); emitData(reason || 'replace'); },
    versions: listVersions,
    rollback: rollbackTo,
    categories(){ return Object.keys(META.categories); },
    tables(){ return META.tableOrder.slice(); },
    tableItems(t){ return (DATA[META.tableKeys[t]] || []).map(it => it.id); },
    itemHistory: itemHistory,
    restoreItem: restoreItem,
    exportJSON(){ return JSON.stringify(DATA, null, 2); },
    importJSON(text){
      const parsed = JSON.parse(text);
      if(!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.skills)) throw new Error('รูปแบบไม่ถูกต้อง: ต้องมีอาเรย์ skills');
      store.replace(parsed, 'import');
    },
    find(collection, id){ return (DATA[collection] || []).find(x => x.id === id); },
    // helper อ่านอย่างเดียว
    skill(id){ return DATA.skills.find(s => s.id === id); },
    klass(id){ return DATA.classes.find(c => c.id === id); },
    save: saveData,
  };

  /* ---------------- STATE (ตัวละครที่ทดสอบ) ---------------- */
  let STATE = null;
  const stateListeners = [];
  function defaultState(){
    const p = DATA.presets[0];
    const m = DATA.monsters[0];
    const sh = p ? p.sheet : {};
    const R = DATA.rules.lab;   // ตัวละครตั้งต้นของโหมดตัวแก้ไข — มาจากฐานข้อมูล (rules.lab)
    const toList = arr => arr.map(x => x.id);
    const toCounts = arr => { const o = {}; arr.forEach(x => { o[x.id] = x.qty; }); return o; };
    return {
      classId: R.classId,
      baseLv: R.baseLv, jobLv: R.jobLv, learned:{}, presetId: p ? p.id : '', weaponId: p ? p.weaponId : (DATA.weapons[0] || {}).id, hasShield: p ? !!p.hasShield : false,
      rawStats: clone(R.rawStats),
      autoSyncStats: true,
      equipped: { headgear: '', armor: '', garment: '', footgear: '', accessory: '', card: '' },
      inventory: toList(R.inventory),
      itemCounts: toCounts(R.inventory),
      storage: toList(R.storage),
      storageCounts: toCounts(R.storage),
      gold: R.gold,
      baseExp: 0,
      jobExp: 0,
      sheet: clone(sh), monsterPresetId: m.id, monster: Object.assign({}, m, { counter:false }),
      rotation: [], opts:{ auto:true, speed:1, benchSeconds:60 },
    };
  }
  function loadState(){
    let parsed = null;
    // ตัวละครของบัญชีเก็บในฐานข้อมูลฝั่งเซิร์ฟเวอร์ (ถ้ายังว่าง = ตัวละครใหม่ ใช้ค่าเริ่มต้น)
    { const rs = g.__SL_REMOTE_STATE;
      parsed = (rs && typeof rs === 'object' && Object.keys(rs).length) ? rs : null; }
    STATE = Object.assign(defaultState(), parsed || {});
    if(g.__SL_GAME){
      // โหมดเกม: ความก้าวหน้า (เลเวล/EXP/ทอง/ไอเทม/สกิล/สเตตัส) มาจากเซิร์ฟเวอร์ทั้งหมด — ห้ามเติมของแจกฟรีฝั่งไคลเอนต์
      STATE.inventory = Array.isArray(parsed && parsed.inventory) ? parsed.inventory : [];
      STATE.itemCounts = (parsed && parsed.itemCounts) || {}; STATE.storage = Array.isArray(parsed && parsed.storage) ? parsed.storage : [];
      STATE.storageCounts = (parsed && parsed.storageCounts) || {}; STATE.gold = Number(parsed && parsed.gold) || 0;
      STATE.opts = Object.assign({ auto:true, speed:1, benchSeconds:60 }, STATE.opts || {});
      sanitize(true);
      return STATE;
    }
    const R = DATA.rules.lab, rp = DATA.rules.progression;
    const toCounts = arr => { const o = {}; arr.forEach(x => { o[x.id] = x.qty; }); return o; };
    STATE.rawStats = Object.assign({}, R.rawStats, STATE.rawStats || {});
    STATE.equipped = Object.assign({ headgear:'', armor:'', garment:'', footgear:'', accessory:'', card:'' }, STATE.equipped || {});
    if(!Array.isArray(STATE.inventory) || !STATE.inventory.length){
      STATE.inventory = R.inventory.map(x => x.id);
      STATE.itemCounts = toCounts(R.inventory);
    }
    STATE.itemCounts = (STATE.itemCounts && typeof STATE.itemCounts === 'object') ? STATE.itemCounts : {};
    // ซิงก์รายการใน inventory ให้มีจำนวนใน itemCounts เสมอ
    STATE.inventory.forEach(id => {
      if(id && (!STATE.itemCounts[id] || STATE.itemCounts[id] < 1)) STATE.itemCounts[id] = 1;
    });
    // ซิงก์คลังเก็บของคาฟรา (Kafra Storage)
    if(!Array.isArray(STATE.storage)){
      STATE.storage = R.storage.map(x => x.id);
      STATE.storageCounts = toCounts(R.storage);
    }
    STATE.storageCounts = (STATE.storageCounts && typeof STATE.storageCounts === 'object') ? STATE.storageCounts : {};
    STATE.storage.forEach(id => {
      if(id && (!STATE.storageCounts[id] || STATE.storageCounts[id] < 1)){
        STATE.storageCounts[id] = 1;
      }
    });
    STATE.gold = Math.max(0, Number(STATE.gold) || 0);
    STATE.baseExp = Math.max(0, Number(STATE.baseExp) || 0);
    STATE.jobExp = Math.max(0, Number(STATE.jobExp) || 0);
    STATE.baseLv = Math.max(1, Math.min(rp.maxBaseLevel, Math.round(Number(STATE.baseLv) || R.baseLv)));
    STATE.opts = Object.assign({ auto:true, speed:1, benchSeconds:60 }, STATE.opts || {});
    sanitize(true);
    return STATE;
  }
  let stateTimer = 0;
  function saveState(){
    if(g.__SL_GAME){
      // โหมดเกม: ส่งเฉพาะค่าที่ปรับเองได้ (ลำดับสกิล/ตัวเลือก/เป้าหมาย) — ความก้าวหน้าเปลี่ยนผ่านคำสั่งเกมเท่านั้น
      clearTimeout(stateTimer);
      stateTimer = setTimeout(() => { try{ if(SL.game) SL.game.prefs({ rotation: STATE.rotation, opts: STATE.opts, monsterPresetId: STATE.monsterPresetId, monster: STATE.monster }).catch(() => {}); }catch(e){} }, 800);
      return;
    }
    // บันทึกลงบัญชีบนเซิร์ฟเวอร์ (หน่วง 0.8 วินาที รวมการแก้หลายครั้งเป็นครั้งเดียว)
    clearTimeout(stateTimer);
    stateTimer = setTimeout(() => {
      try{
        fetch(g.__SL_REMOTE_API + '/api/characters/me/state', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(STATE) })
          .then(r => { if(!r.ok) r.json().then(j => console.warn('[Go server] บันทึกตัวละครไม่สำเร็จ:', r.status, j && j.error)).catch(() => {}); })
          .catch(() => {});
      }catch(e){}
    }, 800);
  }
  // ล้างค่าที่อ้างถึงสิ่งที่ไม่มีแล้ว (สกิลถูกลบ คลาสหาย เลเวลเกิน max) — ทำให้แก้ข้อมูลได้โดยไม่ทำให้ตัวละครพัง
  function sanitize(silent){
    if(!STATE) return;
    fixState(STATE); if(SB) fixState(SB);
    if(!silent){ saveState(); stateListeners.slice().forEach(fn => { try{ fn(); }catch(e){ console.error(e); } }); }
  }
  function fixState(STATE){
    if(!store.klass(STATE.classId)) STATE.classId = DATA.classes[0].id;
    const cls = store.klass(STATE.classId);
    STATE.jobLv = SL.util.clamp(Math.round(Number(STATE.jobLv) || 1), 1, cls.jobLvCap);
    if(!store.find('weapons', STATE.weaponId)) STATE.weaponId = (DATA.weapons[0] || {}).id;
    STATE.equipped = Object.assign({ headgear:'', armor:'', garment:'', footgear:'', accessory:'', card:'' }, STATE.equipped || {});
    const learned = {};
    Object.keys(STATE.learned || {}).forEach(id => {
      const s = store.skill(id); const lv = Math.round(Number(STATE.learned[id]) || 0);
      if(s && lv > 0) learned[id] = Math.min(lv, s.maxLevel);
    });
    STATE.learned = learned;
    STATE.rotation = (STATE.rotation || []).filter(r => r && store.skill(r.id));
    // ซิงก์มอนสเตอร์ในหน้าจำลองการต่อสู้ (#sim) ทันทีเมื่อข้อมูลมอนสเตอร์ในคลังถูกแก้ไขจากหน้าอื่น
    if(STATE.monsterPresetId){
      const mDef = store.find('monsters', STATE.monsterPresetId);
      if(mDef){
        const keepCounter = STATE.monster && STATE.monster.counter;
        STATE.monster = Object.assign({}, clone(mDef), { counter: !!keepCounter });
      } else if(DATA.monsters[0]){
        STATE.monsterPresetId = DATA.monsters[0].id;
        STATE.monster = Object.assign({}, clone(DATA.monsters[0]), { counter: false });
      }
    }
    // ซิงก์ค่าสเตตัสปลายทาง (Derived Sheet) อัตโนมัติเมื่อเปิดโหมด Auto-Sync
    if(STATE.autoSyncStats && SL.calc && SL.calc.computeDerivedFromRaw){
      try {
        const dRes = SL.calc.computeDerivedFromRaw(STATE);
        if(dRes && dRes.sheet) STATE.sheet = Object.assign({}, STATE.sheet, dRes.sheet);
      } catch(e){}
    }
  }

  // ฟิลด์ที่เซิร์ฟเวอร์เป็นเจ้าของในโหมดเกม — ไคลเอนต์แก้ตรง ๆ ไม่ได้ (ถูกย้อนกลับ)
  const OWNED = ['classId','baseLv','jobLv','baseExp','jobExp','gold','learned','rawStats','weaponId','hasShield','equipped','inventory','itemCounts','storage','storageCounts'];
  const own = s => { const o = {}; OWNED.forEach(k => { o[k] = JSON.stringify(s[k]); }); return o; };
  let applying = false;

  /* ---------------- SANDBOX (แท็บ DPS: ตัวละครสำหรับ "ลองค่า" ไม่กระทบตัวละครจริง) ---------------- */
  let SB = null; const sbListeners = [];
  const sandbox = {
    get(){ if(!SB) sandbox.resetFromState(true); return SB; },
    subscribe(fn){ sbListeners.push(fn); },
    // คัดลอกตัวละครจริงมาเป็นจุดเริ่ม (autoSync ปิด เพื่อให้ชีตสเตตัสที่ผู้ใช้กรอกไม่ถูกทับ)
    resetFromState(silent){
      SB = clone(STATE); SB.autoSyncStats = false; SB.opts = Object.assign({ auto:true, speed:1, benchSeconds:60 }, SB.opts || {});
      fixState(SB); if(!silent) sbListeners.slice().forEach(fn => { try{ fn(); }catch(e){ console.error(e); } });
    },
    change(fn){ fn(sandbox.get()); fixState(SB); sbListeners.slice().forEach(fn2 => { try{ fn2(); }catch(e){ console.error(e); } }); },
    sanitize(){ if(SB) fixState(SB); },
  };
  const state = {
    get(){ return STATE; },
    subscribe(fn){ stateListeners.push(fn); },
    change(fn){
      if(g.__SL_GAME && !applying){
        const before = own(STATE); fn(STATE);
        const after = own(STATE); let bad = false;
        OWNED.forEach(k => { if(before[k] !== after[k]){ bad = true; STATE[k] = JSON.parse(before[k] === undefined ? 'null' : before[k]); } });
        if(bad && SL.ui && SL.ui.toast) SL.ui.toast('โหมดเกม: ค่านี้เปลี่ยนได้ผ่านเซิร์ฟเวอร์เท่านั้น');
      } else fn(STATE);
      sanitize();
    },
    // แทนที่ตัวละครด้วย state ที่เซิร์ฟเวอร์ตัดสินแล้ว (ไม่คำนวณเอง) แล้วแจ้งผู้ฟัง
    applyServer(obj){
      if(!obj || typeof obj !== 'object') return;
      applying = true;
      try{
        const keepOpts = STATE && STATE.opts;
        STATE = Object.assign(defaultState(), obj);
        STATE.opts = Object.assign({ auto:true, speed:1, benchSeconds:60 }, STATE.opts || {}, keepOpts && !obj.opts ? keepOpts : {});
        ['inventory','storage'].forEach(k => { if(!Array.isArray(STATE[k])) STATE[k] = []; });
        ['itemCounts','storageCounts'].forEach(k => { if(!STATE[k] || typeof STATE[k] !== 'object') STATE[k] = {}; });
        fixState(STATE);
      } finally { applying = false; }
      stateListeners.slice().forEach(fn => { try{ fn(); }catch(e){ console.error(e); } });
    },
    sanitize, save: saveState, saveSilent: saveState,
    reset(){ STATE = defaultState(); sanitize(); },
    getQty(itemId){
      if(!STATE || !itemId) return 0;
      if(STATE.itemCounts && STATE.itemCounts[itemId] !== undefined) return Math.max(0, Number(STATE.itemCounts[itemId]) || 0);
      return Array.isArray(STATE.inventory) && STATE.inventory.indexOf(itemId) >= 0 ? 1 : 0;
    },
    addItem(itemId, qty){
      if(!STATE || !itemId) return 0;
      if(g.__SL_GAME) return state.getQty(itemId); // ของที่ได้รับมาจากเซิร์ฟเวอร์เท่านั้น
      const n = Math.max(1, Math.round(Number(qty) || 1));
      const prev = state.getQty(itemId);
      if(!Array.isArray(STATE.inventory)) STATE.inventory = [];
      if(!STATE.itemCounts || typeof STATE.itemCounts !== 'object') STATE.itemCounts = {};
      if(STATE.inventory.indexOf(itemId) < 0) STATE.inventory.push(itemId);
      STATE.itemCounts[itemId] = prev + n;
      saveState();
      return STATE.itemCounts[itemId];
    },
    removeItem(itemId, qty){
      if(!STATE || !itemId) return 0;
      if(g.__SL_GAME && !applying) return state.getQty(itemId);
      const n = Math.max(1, Math.round(Number(qty) || 1));
      if(!Array.isArray(STATE.inventory)) STATE.inventory = [];
      if(!STATE.itemCounts || typeof STATE.itemCounts !== 'object') STATE.itemCounts = {};
      const cur = state.getQty(itemId);
      const next = Math.max(0, cur - n);
      if(next <= 0){
        delete STATE.itemCounts[itemId];
        STATE.inventory = STATE.inventory.filter(x => x !== itemId);
        // หากถอด/ขายจนหมดชิ้นสุดท้าย ให้ถอดออกจากช่องสวมใส่ด้วย
        Object.keys(STATE.equipped || {}).forEach(slot => {
          if(STATE.equipped[slot] === itemId) STATE.equipped[slot] = '';
        });
      } else {
        STATE.itemCounts[itemId] = next;
      }
      sanitize();
      return next;
    },
    equipItem(itemId){
      const it = store.find('equipItems', itemId);
      if(!it || !it.slot || it.slot === 'consumable' || it.slot === 'etc') return false;
      if(g.__SL_GAME){ SL.game.equip(itemId, STATE.equipped[it.slot] !== itemId); return true; }
      state.change(s => {
        if(!s.equipped) s.equipped = { headgear:'', armor:'', garment:'', footgear:'', accessory:'', card:'' };
        s.equipped[it.slot] = s.equipped[it.slot] === itemId ? '' : itemId;
      });
      return true;
    },
    unequipSlot(slot){
      if(g.__SL_GAME){ SL.game.unequip(slot); return; }
      state.change(s => {
        if(s.equipped && slot in s.equipped) s.equipped[slot] = '';
      });
    },
    getStorageQty(itemId){
      if(!STATE || !itemId) return 0;
      if(STATE.storageCounts && STATE.storageCounts[itemId] !== undefined) return Math.max(0, Number(STATE.storageCounts[itemId]) || 0);
      return Array.isArray(STATE.storage) && STATE.storage.indexOf(itemId) >= 0 ? 1 : 0;
    },
    depositToStorage(itemId, qty){
      if(!STATE || !itemId) return false;
      if(g.__SL_GAME){ SL.game.storage('deposit', itemId, qty); return true; }
      const curInv = state.getQty(itemId);
      if(curInv <= 0) return false;
      const n = Math.min(curInv, Math.max(1, Math.round(Number(qty) || 1)));
      const prevSt = state.getStorageQty(itemId);
      if(!Array.isArray(STATE.storage)) STATE.storage = [];
      if(!STATE.storageCounts || typeof STATE.storageCounts !== 'object') STATE.storageCounts = {};
      if(STATE.storage.indexOf(itemId) < 0) STATE.storage.push(itemId);
      STATE.storageCounts[itemId] = prevSt + n;
      state.removeItem(itemId, n);
      return true;
    },
    withdrawFromStorage(itemId, qty){
      if(!STATE || !itemId) return false;
      if(g.__SL_GAME){ SL.game.storage('withdraw', itemId, qty); return true; }
      const curSt = state.getStorageQty(itemId);
      if(curSt <= 0) return false;
      const n = Math.min(curSt, Math.max(1, Math.round(Number(qty) || 1)));
      const next = Math.max(0, curSt - n);
      if(next <= 0){
        delete STATE.storageCounts[itemId];
        STATE.storage = (STATE.storage || []).filter(x => x !== itemId);
      } else {
        STATE.storageCounts[itemId] = next;
      }
      state.addItem(itemId, n);
      sanitize();
      return true;
    },
    calcWeight(){
      if(!STATE) return { cur: 0, max: 2000 };
      const str = (STATE.rawStats && STATE.rawStats.str) || 40;
      const maxW = 2000 + str * 30;
      let curW = 0;
      const eqAll = (DATA && DATA.equipItems) || [];
      (STATE.inventory || []).forEach(id => {
        const q = state.getQty(id);
        if(q <= 0) return;
        const it = eqAll.find(x => x.id === id);
        const w = (it && it.weight) || (it && it.slot === 'card' ? 1 : (it && it.slot === 'consumable' ? 10 : 25));
        curW += w * q;
      });
      return { cur: Math.round(curW), max: Math.round(maxW) };
    },
    sortInventory(){
      if(!STATE || !Array.isArray(STATE.inventory)) return;
      const order = { headgear:1, armor:2, garment:3, footgear:4, accessory:5, card:6, consumable:7, etc:8 };
      const eqAll = (DATA && DATA.equipItems) || [];
      STATE.inventory.sort((a, b) => {
        const ia = eqAll.find(x => x.id === a) || {};
        const ib = eqAll.find(x => x.id === b) || {};
        return (order[ia.slot] || 99) - (order[ib.slot] || 99);
      });
      saveState();
    }
  };

  SL.store = store; SL.state = state; SL.sandbox = sandbox; SL.loadAll = function(){ loadData(); loadState(); };
})(typeof window !== 'undefined' ? window : globalThis);
