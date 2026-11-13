/* ============================================================
   MODULE 02 — store : ที่เก็บ "ข้อมูลสกิล" (data) และ "สถานะตัวละคร" (state) แยกกัน
   - data  = นิยามคลาส/สกิล/อาวุธ/... (แก้ในตัวแก้ไข) เก็บที่ localStorage คีย์ roSkillLabData_v1
   - state = ตัวละครที่กำลังทดสอบ (คลาส, Job Lv, สกิลที่ลง, สเตตัส, ม้อนสเตอร์, ลำดับสกิลอัตโนมัติ) คีย์ roSkillLabState_v1
   ทุกการแก้ไขผ่าน change() เพื่อ normalize + บันทึก + แจ้งผู้ฟัง (UI) — โมดูลอื่นไม่ต้องรู้จักกัน
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const { clone } = SL.util;
  const LS_DATA = 'roSkillLabData_v1', LS_STATE = 'roSkillLabState_v1';

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

  function normalizeData(data){
    const D = SL.DEFAULT_DATA;
    const out = (data && typeof data === 'object') ? data : {};
    COLLECTIONS.forEach(k => { if(!Array.isArray(out[k])) out[k] = clone(D[k] || []); });
    out.globals = Object.assign(clone(D.globals), out.globals || {});
    out.globals.buffPercentCap = Object.assign({}, D.globals.buffPercentCap || {}, out.globals.buffPercentCap || {});
    out.formulaConfig = Object.assign(clone(D.formulaConfig || {}), out.formulaConfig || {});
    ['statusPointSystem','baseConstants','statCurve','classCoefs','weaponProfiles','shieldProfile','magicCrit'].forEach(k => {
      if(D.formulaConfig && D.formulaConfig[k]) out.formulaConfig[k] = Object.assign(clone(D.formulaConfig[k]), out.formulaConfig[k] || {});
    });
    out.modelSlots = Object.assign(clone(D.modelSlots || { classes:{}, monsters:{} }), out.modelSlots || {});
    out.modelSlots.classes = Object.assign(clone((D.modelSlots || {}).classes || {}), out.modelSlots.classes || {});
    out.modelSlots.monsters = Object.assign(clone((D.modelSlots || {}).monsters || {}), out.modelSlots.monsters || {});

    // ระบบธาตุ 13 ธาตุ (13×13 Elemental Matrix): เติมธาตุและช่องตารางที่ยังไม่มีใน localStorage เดิมให้ครบเสมอ
    const defEs = D.elementSystem || { elements:[], matrix:{}, sizeMatrix:{} };
    out.elementSystem = Object.assign(clone(defEs), out.elementSystem || {});
    if(!Array.isArray(out.elementSystem.elements) || out.elementSystem.elements.length < defEs.elements.length){
      const existingEls = Array.isArray(out.elementSystem.elements) ? out.elementSystem.elements : [];
      const mergedEls = clone(defEs.elements);
      existingEls.forEach(el => {
        const idx = mergedEls.findIndex(x => x.id === el.id);
        if(idx >= 0) mergedEls[idx] = Object.assign(mergedEls[idx], el);
        else mergedEls.push(el);
      });
      out.elementSystem.elements = mergedEls;
    }
    const mergedMat = clone(defEs.matrix || {});
    Object.keys(out.elementSystem.matrix || {}).forEach(atkK => {
      mergedMat[atkK] = Object.assign({}, mergedMat[atkK] || {}, out.elementSystem.matrix[atkK] || {});
    });
    out.elementSystem.matrix = mergedMat;
    out.elementSystem.sizeMatrix = Object.assign(clone(defEs.sizeMatrix || {}), out.elementSystem.sizeMatrix || {});

    // คลังอุปกรณ์ การ์ดธาตุ และไอเทมกดใช้: เติมไอเทมมาตรฐานให้ครบ 28+ ชิ้นเสมอ
    if(!Array.isArray(out.equipItems)) out.equipItems = [];
    const haveEq = {};
    out.equipItems.forEach((it, idx) => {
      if(it && it.id){
        const defIt = (D.equipItems || []).find(x => x.id === it.id);
        if(defIt) out.equipItems[idx] = Object.assign(clone(defIt), it);
        haveEq[it.id] = 1;
      }
    });
    (D.equipItems || []).forEach(defIt => {
      if(defIt && defIt.id && !haveEq[defIt.id]) out.equipItems.push(clone(defIt));
    });

    // เติมมอนสเตอร์ธาตุใหม่ๆ หากยังไม่มีในคลัง
    const haveMon = {};
    out.monsters.forEach(m => { if(m && m.id) haveMon[m.id] = 1; });
    (D.monsters || []).forEach(dm => { if(dm && dm.id && !haveMon[dm.id]) out.monsters.push(clone(dm)); });

    out.worldMap = Object.assign(clone(D.worldMap || { currentMapId:'map_prontera', zones:[], spawns:[], portals:[], maps:[] }), out.worldMap || {});
    if(!Array.isArray(out.worldMap.maps) || !out.worldMap.maps.length){
      out.worldMap.maps = clone((D.worldMap || {}).maps || []);
    }
    const curMapId = out.worldMap.currentMapId || 'map_prontera';
    const curMapObj = out.worldMap.maps.find(mp => mp.id === curMapId) || out.worldMap.maps[0];
    if(curMapObj){
      out.worldMap.currentMapId = curMapObj.id;
      if(!Array.isArray(out.worldMap.zones) || !out.worldMap.zones.length) out.worldMap.zones = curMapObj.zones;
      if(!Array.isArray(out.worldMap.spawns)) out.worldMap.spawns = curMapObj.spawns;
      if(!Array.isArray(out.worldMap.portals)) out.worldMap.portals = curMapObj.portals || [];
      // ซิงก์โซนและจุดเกิดของแมพปัจจุบันกลับเข้า curMapObj เสมอ
      curMapObj.zones = out.worldMap.zones;
      curMapObj.spawns = out.worldMap.spawns;
      curMapObj.portals = out.worldMap.portals;
    }

    out.monsters = out.monsters.map(m => {
      const dm = (D.monsters || []).find(x => x.id === m.id) || {};
      const w = Object.assign(clone(dm.world || { bodyType:'slime', color:'#f27ca4', scale:1, moveSpeed:80, aggroRange:180, attackRange:65, telegraph:{ name:'โจมตีหนัก', cd:8, castTime:1.3, shape:'circle', radius:95, angle:360, mult:1.8 } }), m.world || {});
      // ซิงก์ modelSlots.monsters กับ m.world ให้ตรงกันเสมอไม่ว่าจะแก้จากหน้าไหน
      const ms = out.modelSlots.monsters[m.id] || {};
      out.modelSlots.monsters[m.id] = Object.assign({
        name: m.name,
        bodyType: w.bodyType || 'slime',
        color: w.color || '#f27ca4',
        scale: w.scale || 1,
        modelUrl: '',
        spriteUrl: ''
      }, ms, {
        name: m.name,
        bodyType: w.bodyType || ms.bodyType || 'slime',
        color: w.color || ms.color || '#f27ca4',
        scale: w.scale || ms.scale || 1
      });
      return Object.assign({
        element: dm.element || 'neutral',
        size: dm.size || 'medium',
        exp: clone(dm.exp || { base: 30, job: 20 }),
        gold: clone(dm.gold || [10, 25]),
        drops: clone(dm.drops || []),
        def:40, mdef:30, flee:60, maxHp:20000, atk:80, hit:100, interval:2
      }, m, { world: w });
    });
    out.skills = out.skills.filter(s => s && s.id).map(normalizeSkill);
    out.classes = out.classes.map(c => Object.assign({ parent:'', jobLvCap:10, pointsPerJobLv:1, desc:'' }, c));
    out.version = 3;
    return out;
  }

  // เติมรายการค่าเริ่มต้นใหม่ (เช่น สกิล/สาย/บิลด์/มอนสเตอร์ที่เพิ่งเพิ่มใน v3) เข้ากับข้อมูลเดิมใน localStorage โดยไม่ทับสิ่งที่ผู้ใช้แก้ไว้
  function migrateDefaults(parsed){
    if(!parsed || typeof parsed !== 'object' || (parsed.version || 1) >= 3) return parsed;
    const D = SL.DEFAULT_DATA;
    ['branches','skills','presets','builds','monsters'].forEach(k => {
      if(!Array.isArray(parsed[k])) return;
      const have = {}; parsed[k].forEach(x => { if(x && x.id) have[x.id] = 1; });
      (D[k] || []).forEach(x => { if(x && x.id && !have[x.id]) parsed[k].push(clone(x)); });
    });
    if(Array.isArray(parsed.classes)){
      parsed.classes.forEach(c => {
        const dc = (D.classes || []).find(x => x.id === c.id);
        if(dc && (!c.desc || c.desc.indexOf('ยังไม่มีสกิล') >= 0)) c.desc = dc.desc;
      });
    }
    parsed.version = 3;
    return parsed;
  }

  /* ---------------- DATA ---------------- */
  let DATA = null;
  const dataListeners = [];
  function loadData(){
    let parsed = null;
    try{ const raw = localStorage.getItem(LS_DATA); if(raw) parsed = migrateDefaults(JSON.parse(raw)); }catch(e){}
    DATA = normalizeData(parsed || clone(SL.DEFAULT_DATA));
    saveData();
    return DATA;
  }
  function saveData(){ try{ localStorage.setItem(LS_DATA, JSON.stringify(DATA)); }catch(e){} }
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
    reset(){ DATA = normalizeData(clone(SL.DEFAULT_DATA)); saveData(); SL.state.sanitize(); emitData('reset'); },
    resetCollection(k){ DATA[k] = clone(SL.DEFAULT_DATA[k]); DATA = normalizeData(DATA); saveData(); SL.state.sanitize(); emitData('reset-' + k); },
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
    const m = DATA.monsters[0] || { id:'', def:40, mdef:30, flee:60, maxHp:20000, atk:80, hit:100, interval:2 };
    const sh = p ? p.sheet : {};
    const starterInv = ['card_poring', 'card_vadon', 'card_marina', 'card_hatii', 'eq_helm_valkyrie', 'eq_armor_odin', 'eq_armor_ignis', 'eq_cape_wind', 'eq_boots_hermes', 'eq_ring_str', 'pot_red', 'pot_blue', 'pot_aspd', 'etc_jellopy', 'etc_fang'];
    const starterCounts = { card_poring: 1, card_vadon: 1, card_marina: 1, card_hatii: 1, eq_helm_valkyrie: 1, eq_armor_odin: 1, eq_armor_ignis: 1, eq_cape_wind: 1, eq_boots_hermes: 1, eq_ring_str: 1, pot_red: 5, pot_blue: 3, pot_aspd: 2, etc_jellopy: 8, etc_fang: 3 };
    const starterStorage = ['card_sandman', 'card_griffon', 'card_angeling', 'eq_greaves_titan', 'eq_cape_dragon', 'etc_oridecon', 'etc_ice_heart'];
    const starterStorageCounts = { card_sandman: 1, card_griffon: 1, card_angeling: 1, eq_greaves_titan: 1, eq_cape_dragon: 1, etc_oridecon: 4, etc_ice_heart: 2 };
    return {
      classId: DATA.classes.find(c => c.id === 'swordman') ? 'swordman' : DATA.classes[0].id,
      baseLv: 50, jobLv: 50, learned:{}, presetId: p ? p.id : '', weaponId: p ? p.weaponId : (DATA.weapons[0] || {}).id, hasShield: p ? !!p.hasShield : false,
      rawStats: { str: sh.str || 40, agi: sh.agi || 40, vit: sh.vit || 30, int: sh.int || 30, dex: sh.dex || 40, luk: sh.luk || 20 },
      autoSyncStats: true,
      equipped: { headgear: '', armor: '', garment: '', footgear: '', accessory: '', card: '' },
      inventory: starterInv,
      itemCounts: starterCounts,
      storage: starterStorage,
      storageCounts: starterStorageCounts,
      gold: 450,
      baseExp: 0,
      jobExp: 0,
      sheet: clone(sh), monsterPresetId: m.id, monster: Object.assign({}, m, { counter:false }),
      rotation: [], opts:{ auto:true, speed:1, benchSeconds:60 },
    };
  }
  function loadState(){
    let parsed = null;
    try{ const raw = localStorage.getItem(LS_STATE); if(raw) parsed = JSON.parse(raw); }catch(e){}
    STATE = Object.assign(defaultState(), parsed || {});
    STATE.rawStats = Object.assign({ str:40, agi:40, vit:30, int:30, dex:40, luk:20 }, STATE.rawStats || {});
    STATE.equipped = Object.assign({ headgear:'', armor:'', garment:'', footgear:'', accessory:'', card:'' }, STATE.equipped || {});
    if(!Array.isArray(STATE.inventory) || !STATE.inventory.length){
      STATE.inventory = ['card_poring', 'card_vadon', 'card_marina', 'card_hatii', 'eq_helm_valkyrie', 'eq_armor_odin', 'eq_armor_ignis', 'eq_cape_wind', 'eq_boots_hermes', 'eq_ring_str', 'pot_red', 'pot_blue', 'pot_aspd', 'etc_jellopy', 'etc_fang'];
    }
    STATE.itemCounts = (STATE.itemCounts && typeof STATE.itemCounts === 'object') ? STATE.itemCounts : {};
    // ซิงก์รายการใน inventory ให้มีจำนวนใน itemCounts เสมอ และเติมยา/วัตถุดิบเริ่มต้นให้หากยังไม่มี
    ['pot_red', 'pot_blue', 'pot_aspd', 'eq_armor_ignis', 'eq_cape_wind', 'eq_boots_hermes', 'eq_ring_str', 'etc_jellopy', 'etc_fang'].forEach(stId => {
      if(STATE.inventory.indexOf(stId) < 0 && STATE.itemCounts[stId] === undefined){
        STATE.inventory.push(stId);
        STATE.itemCounts[stId] = stId.indexOf('pot_') === 0 ? 3 : (stId.indexOf('etc_') === 0 ? 5 : 1);
      }
    });
    STATE.inventory.forEach(id => {
      if(id && (!STATE.itemCounts[id] || STATE.itemCounts[id] < 1)) STATE.itemCounts[id] = 1;
    });
    // ซิงก์คลังเก็บของคาฟรา (Kafra Storage)
    if(!Array.isArray(STATE.storage)){
      STATE.storage = ['card_sandman', 'card_griffon', 'card_angeling', 'eq_greaves_titan', 'eq_cape_dragon', 'etc_oridecon', 'etc_ice_heart'];
    }
    STATE.storageCounts = (STATE.storageCounts && typeof STATE.storageCounts === 'object') ? STATE.storageCounts : {};
    STATE.storage.forEach(id => {
      if(id && (!STATE.storageCounts[id] || STATE.storageCounts[id] < 1)){
        STATE.storageCounts[id] = id === 'etc_oridecon' ? 4 : (id === 'etc_ice_heart' ? 2 : 1);
      }
    });
    STATE.gold = Math.max(0, Number(STATE.gold) || 0);
    STATE.baseExp = Math.max(0, Number(STATE.baseExp) || 0);
    STATE.jobExp = Math.max(0, Number(STATE.jobExp) || 0);
    STATE.baseLv = Math.max(1, Math.min(99, Math.round(Number(STATE.baseLv) || 50)));
    STATE.opts = Object.assign({ auto:true, speed:1, benchSeconds:60 }, STATE.opts || {});
    sanitize(true);
    return STATE;
  }
  function saveState(){ try{ localStorage.setItem(LS_STATE, JSON.stringify(STATE)); }catch(e){} }
  // ล้างค่าที่อ้างถึงสิ่งที่ไม่มีแล้ว (สกิลถูกลบ คลาสหาย เลเวลเกิน max) — ทำให้แก้ข้อมูลได้โดยไม่ทำให้ตัวละครพัง
  function sanitize(silent){
    if(!STATE) return;
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
    if(!silent){ saveState(); stateListeners.slice().forEach(fn => { try{ fn(); }catch(e){ console.error(e); } }); }
  }
  const state = {
    get(){ return STATE; },
    subscribe(fn){ stateListeners.push(fn); },
    change(fn){ fn(STATE); sanitize(); },
    sanitize, save: saveState, saveSilent: saveState,
    reset(){ STATE = defaultState(); sanitize(); },
    getQty(itemId){
      if(!STATE || !itemId) return 0;
      if(STATE.itemCounts && STATE.itemCounts[itemId] !== undefined) return Math.max(0, Number(STATE.itemCounts[itemId]) || 0);
      return Array.isArray(STATE.inventory) && STATE.inventory.indexOf(itemId) >= 0 ? 1 : 0;
    },
    addItem(itemId, qty){
      if(!STATE || !itemId) return 0;
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
      state.change(s => {
        if(!s.equipped) s.equipped = { headgear:'', armor:'', garment:'', footgear:'', accessory:'', card:'' };
        s.equipped[it.slot] = s.equipped[it.slot] === itemId ? '' : itemId;
      });
      return true;
    },
    unequipSlot(slot){
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

  SL.store = store; SL.state = state; SL.loadAll = function(){ loadData(); loadState(); };
})(typeof window !== 'undefined' ? window : globalThis);
