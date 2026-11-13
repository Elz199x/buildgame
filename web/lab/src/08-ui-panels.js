/* ============================================================
   MODULE 08 — ui-panels : แผงย่อยของหน้า DPS (ลำดับสกิลอัตโนมัติ / สเตตัสสุดท้าย / ตารางดาเมจ / Benchmark)
   แต่ละแผงเป็นฟังก์ชันที่คืน {el, update()} — หน้า DPS แค่ประกอบเข้าด้วยกัน
   ทุกการคำนวณ (สเตตัสสุดท้าย ดาเมจ จำลอง ลำดับสกิลอัตโนมัติ) ทำบนเซิร์ฟเวอร์ผ่าน API — ที่นี่มีแต่การวาดผล
   ใช้ "แซนด์บ็อกซ์" (SL.sandbox = สำเนาตัวละครสำหรับลองค่า) จึงแก้อะไรก็ไม่กระทบตัวละครจริง
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h, R = SL.rules, fmt = SL.util.fmt;
  const P = ui.panels = {};
  const pctv = x => +(x * 100).toFixed(1);
  const SB = SL.sandbox;

  const errBox = e => h('div', { class:'small bad' }, '⚠️ ' + e.message);
  const uniqStatuses = v => { const seen = {}, out = [];
    (v.pst || []).concat(v.mst || []).forEach(x => { const k = x.id + ':' + x.lv; if(!seen[k]){ seen[k] = 1; out.push({ id: x.id, lv: x.lv }); } }); return out; };

  /* ---------- ลำดับสกิลอัตโนมัติ ---------- */
  P.rotation = function(){
    const el = h('div', { class:'col' }); let sig = '', refs = [], addSel = null;
    const castables = st => R.visibleSkills(st.classId).filter(R.isCastable);
    function build(st){
      ui.clear(el); refs = [];
      el.appendChild(h('div', { class:'small muted' }, 'เรียงจากบนลงล่าง: ถึงจังหวะตี ระบบเลือกสกิลแรกที่ใช้ได้ (SP/คูลดาวน์/เงื่อนไขอาวุธ/HP) ถ้าไม่มีก็ตีธรรมดา'));
      st.rotation.forEach((r, i) => {
        const s = SL.store.skill(r.id), ref = {};
        ref.min = ui.num(pctv(r.minSpPct || 0), v => SB.change(x => { x.rotation[i].minSpPct = v / 100; }), { min:0, max:100, label:'SP ขั้นต่ำ %' });
        ref.hmin = ui.num(pctv(r.minHpPct || 0), v => SB.change(x => { x.rotation[i].minHpPct = v / 100; }), { min:0, max:100, label:'HP ขั้นต่ำ %' });
        ref.hmax = ui.num(pctv(r.maxHpPct === undefined ? 1 : r.maxHpPct), v => SB.change(x => { x.rotation[i].maxHpPct = v / 100; }), { min:0, max:100, label:'HP สูงสุด %' });
        ref.skip = ui.check('ไม่ซ้ำถ้ายังติดอยู่', r.skipIfActive !== false, v => SB.change(x => { x.rotation[i].skipIfActive = v; }));
        refs.push(ref);
        el.appendChild(h('div', { class:'panel flat', style:{ padding:'8px' } },
          h('div', { class:'row' }, h('b', (i + 1) + '.'), h('span', s ? s.name : r.id), s ? ui.typeChip(s.type) : null,
            h('span', { class:'right row', style:{ gap:'4px' } },
              h('button', { class:'btn sm', type:'button', disabled: i === 0, onclick: () => SB.change(x => { x.rotation.splice(i - 1, 0, x.rotation.splice(i, 1)[0]); }) }, '↑'),
              h('button', { class:'btn sm', type:'button', disabled: i === st.rotation.length - 1, onclick: () => SB.change(x => { x.rotation.splice(i + 1, 0, x.rotation.splice(i, 1)[0]); }) }, '↓'),
              h('button', { class:'btn sm danger', type:'button', onclick: () => SB.change(x => { x.rotation.splice(i, 1); }) }, '✕'))),
          h('div', { class:'row' }, ui.field('SP ≥ %', ref.min), ui.field('HP ≥ %', ref.hmin), ui.field('HP ≤ %', ref.hmax), ref.skip)));
      });
      const free = castables(st).filter(s => !st.rotation.some(r => r.id === s.id));
      addSel = ui.select([{ v:'', t:'— เพิ่มสกิลเข้าลำดับ —' }].concat(free.map(s => ({ v: s.id, t: s.name + (st.learned[s.id] ? '' : ' (ยังไม่ได้เรียน)') }))), '', v => {
        if(v) SB.change(x => { x.rotation.push({ id: v, minSpPct: 0, minHpPct: 0, maxHpPct: 1, skipIfActive: true }); }); });
      el.appendChild(h('div', { class:'row' }, addSel,
        h('button', { class:'btn sm primary', type:'button', onclick: () => {
          // ให้เซิร์ฟเวอร์จัดลำดับ (บัฟ → ดีบัฟ → ดาเมจแรงสุดก่อน → ฮีล)
          SL.remote.post('/api/sim/rotation', { state: SB.get() }).then(j => SB.change(x => { x.rotation = j.rotation || []; })).catch(e => ui.toast('⚠️ ' + e.message));
        } }, 'จัดอัตโนมัติจากสกิลที่เรียน'),
        h('button', { class:'btn sm', type:'button', onclick: () => SB.change(x => { x.rotation = []; }) }, 'ล้าง')));
    }
    function update(){
      const st = SB.get(), key = st.rotation.map(r => r.id).join(',') + '|' + castables(st).map(s => s.id + (st.learned[s.id] ? 1 : 0)).join(',');
      if(key !== sig){ sig = key; build(st); return; }
      st.rotation.forEach((r, i) => { const f = refs[i]; if(!f) return;
        if(document.activeElement !== f.min) f.min.value = pctv(r.minSpPct || 0);
        if(document.activeElement !== f.hmin) f.hmin.value = pctv(r.minHpPct || 0);
        if(document.activeElement !== f.hmax) f.hmax.value = pctv(r.maxHpPct === undefined ? 1 : r.maxHpPct);
        f.skip.querySelector('input').checked = r.skipIfActive !== false; });
    }
    return { el: el, update: update };
  };

  /* ---------- สเตตัสสุดท้ายหลังคิดสกิล (ค่าจาก view ของเซิร์ฟเวอร์) ---------- */
  P.finalStats = function(){
    const el = h('div'); let key = '';
    function update(v){
      const D = SL.store.get(), st = SB.get(), S = v.P.stats; const rows = [];
      const k = D.statDefs.map(sd => (S[sd.id] || 0).toFixed(3) + '/' + (+st.sheet[sd.id] || 0)).join(',') + (v.P.aps).toFixed(3) + st.monster.counter + D.globals.aspdCap;
      if(k === key) return; key = k;
      let grp = '';
      D.statDefs.forEach(sd => { const sheet = +st.sheet[sd.id] || 0, fin = S[sd.id] || 0; if(!sheet && !fin) return;
        if(sd.group !== grp){ grp = sd.group; rows.push(h('tr', h('td', { colspan:3, class:'muted tiny', style:{ paddingTop:'8px' } }, grp))); }
        const diff = Math.abs(fin - sheet) > 1e-6, src = (v.P.sources || {})[sd.id] || [];
        rows.push(h('tr', { title: src.map(q => q.name + ' ' + q.text + (q.buff ? ' (บัฟ)' : '')).join('\n') },
          h('td', sd.name), h('td', { class:'n muted' }, SL.calc.fmtStat(sd.id, sheet)),
          h('td', { class:'n', style: diff ? { color:'var(--accent)', fontWeight:600 } : null }, SL.calc.fmtStat(sd.id, fin), sd.id === 'aspd' && fin >= D.globals.aspdCap ? ' (เพดาน)' : ''))); });
      rows.push(h('tr', h('td', { colspan:3, class:'muted tiny', style:{ paddingTop:'8px' } }, 'ผลลัพธ์')));
      rows.push(h('tr', h('td', 'ตี/วินาที (APS)'), h('td'), h('td', { class:'n' }, v.P.aps.toFixed(2))));
      rows.push(h('tr', h('td', 'ดาเมจที่มอนสเตอร์ทำ/วิ (คาดการณ์)'), h('td'), h('td', { class:'n' }, st.monster.counter ? fmt(v.monsterDps, 1) : 'ปิดการสวนกลับ')));
      ui.clear(el).appendChild(h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', 'สเตตัส'), h('th', { class:'n' }, 'ชีต'), h('th', { class:'n' }, 'สุดท้าย'))), h('tbody', rows))));
      el.appendChild(h('div', { class:'tiny muted', style:{ marginTop:'6px' } }, 'ชีต = ค่าที่ใส่เอง · สุดท้าย = หลังรวม passive และบัฟที่ติดอยู่ (คำนวณโดยเซิร์ฟเวอร์ · เอาเมาส์ชี้ที่แถวเพื่อดูที่มาของโบนัส)'));
    }
    return { el: el, update: update };
  };

  /* ---------- ตารางดาเมจคาดการณ์ต่อสกิล (เซิร์ฟเวอร์คำนวณ) ---------- */
  P.damage = function(){
    const el = h('div'); let key = '', reqId = 0;
    function render(rows){
      const trs = rows.map(r => { const c = r.components, cyc = Math.max(r.cooldown, 1 / (r._aps || 1));
        return h('tr', { style: r.weaponOk === false ? { opacity:.5 } : null, title: r.weaponOk === false ? 'อาวุธ/โล่ไม่ตรงเงื่อนไข ใช้ไม่ได้' : '' },
          h('td', r.name + (r.id === 'basic' ? '' : ' Lv.' + r.lv) + (r.aoe ? ' ◎' : '')), h('td', { class:'n' }, fmt(c.normal, 0)), h('td', { class:'n' }, fmt(c.crit, 0)),
          h('td', { class:'n' }, Math.round(c.hitChance * 100) + '%'), h('td', { class:'n' }, +(c.critChance * 100).toFixed(1) + '%'),
          h('td', { class:'n', style:{ fontWeight:600 } }, fmt(c.expected, 0)), h('td', { class:'n' }, fmt(c.expected / cyc, 1)),
          h('td', { class:'n muted' }, r.sp ? fmt(c.expected / r.sp, 1) : '—')); });
      ui.clear(el).appendChild(h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', 'สกิล'), h('th', { class:'n' }, 'ปกติ'), h('th', { class:'n' }, 'คริ'),
        h('th', { class:'n' }, 'โดน'), h('th', { class:'n' }, 'คริ%'), h('th', { class:'n' }, 'เฉลี่ย'), h('th', { class:'n' }, 'DPS*'), h('th', { class:'n' }, 'ดาเมจ/SP'))), h('tbody', trs))));
      el.appendChild(h('div', { class:'tiny muted', style:{ marginTop:'6px' } }, 'ค่าคาดหวังต่อเป้านี้ (หักเกราะ/พลาดแล้ว · คำนวณโดยเซิร์ฟเวอร์) · DPS* = ถ้ากดซ้ำทุกครั้งที่พร้อม · ◎ = AoE'));
    }
    function update(v){
      const st = SB.get(), statuses = uniqStatuses(v);
      const sig = JSON.stringify([st.classId, st.learned, st.sheet, st.weaponId, st.hasShield, st.equipped, st.monster, statuses]);
      if(sig === key) return; key = sig;
      const my = ++reqId;
      SL.remote.post('/api/sim/skills', { state: SB.get(), statuses: statuses }).then(rows => {
        if(my !== reqId) return; // มีคำขอใหม่กว่า — ทิ้งผลเก่า
        rows.forEach(r => { r._aps = v.P.aps; }); render(rows);
      }).catch(e => { if(my === reqId){ key = ''; ui.clear(el).appendChild(errBox(e)); } });
    }
    return { el: el, update: update };
  };

  /* ---------- Benchmark / เทียบบิลด์ (เซิร์ฟเวอร์จำลอง) ---------- */
  P.bench = function(){
    let secs = 60; const out = h('div', { class:'col' });
    const sel = ui.select([{ v:'30', t:'30 วินาที' }, { v:'60', t:'60 วินาที' }, { v:'120', t:'120 วินาที' }, { v:'300', t:'300 วินาที' }], '60', v => { secs = +v; }, { label:'ระยะเวลา' });
    function table(rows){
      const maxD = Math.max.apply(null, rows.map(r => r.dps).concat([1]));
      return h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', 'บิลด์'), h('th', { class:'n' }, 'DPS'), h('th', { class:'n' }, 'ตีธรรมดา'), h('th', { class:'n' }, 'SP/วิ'), h('th', { class:'n' }, 'SP เหลือ'), h('th', { class:'n' }, 'ล้ม'))),
        h('tbody', rows.map(r => [h('tr', h('td', r.name), h('td', { class:'n', style:{ fontWeight:600 } }, fmt(r.dps, 1)), h('td', { class:'n' }, Math.round(r.basic.share * 100) + '%'),
          h('td', { class:'n' }, fmt(r.spPerSec, 2)), h('td', { class:'n' }, Math.round(r.spNow) + '/' + Math.round(r.spMax)), h('td', { class:'n ' + (r.deaths ? 'bad' : '') }, r.deaths)),
          h('tr', h('td', { colspan:6, class:'tiny muted' }, h('div', { style:{ height:'5px', width: (r.dps / maxD * 100) + '%', background:'var(--accent)', borderRadius:'3px', marginBottom:'3px' } }),
            r.skills.slice(0, 4).map(s => s.name + ' ' + Math.round(s.share * 100) + '% (' + s.casts + ' ครั้ง)').join(' · ') || 'ไม่ได้ใช้สกิลเลย'))]))));
    }
    let busy = false;
    function run(label, path, body, mapRows){
      if(busy) return; busy = true;
      ui.clear(out).appendChild(h('div', { class:'small muted' }, '⏳ ' + label + ' — เซิร์ฟเวอร์กำลังจำลอง ' + secs + ' วินาที…'));
      SL.remote.post(path, body).then(r => { ui.clear(out).appendChild(table(mapRows(r))); })
        .catch(e => { ui.clear(out).appendChild(errBox(e)); }).then(() => { busy = false; });
    }
    const el = h('div', { class:'col' },
      h('div', { class:'row' }, ui.field('ระยะเวลาทดสอบ', sel),
        h('button', { class:'btn primary sm', type:'button', onclick: () => run('ตัวละครปัจจุบัน', '/api/sim/benchmark', { state: SB.get(), seconds: secs }, r => { r.name = 'ตัวละครในแซนด์บ็อกซ์'; return [r]; }) }, 'รันตัวละครนี้'),
        h('button', { class:'btn sm', type:'button', onclick: () => run('ทุกบิลด์ตัวอย่าง', '/api/sim/builds', { state: SB.get(), seconds: secs }, rows => rows.map(x => Object.assign({ name: x.name }, x.summary))) }, 'เทียบทุกบิลด์ตัวอย่าง')),
      h('div', { class:'tiny muted' }, 'รันเร็วเต็มที่ไม่มีภาพ: เป้านิ่งอมตะ + ลำดับสกิลอัตโนมัติ (บิลด์ตัวอย่างใช้ลำดับอัตโนมัติของตัวเอง) · เมล็ดสุ่มคงที่จึงเทียบก่อน/หลังปรับค่าได้ · คำนวณโดยเซิร์ฟเวอร์'), out);
    return { el: el, update: function(){} };
  };
})(typeof window !== 'undefined' ? window : globalThis);
