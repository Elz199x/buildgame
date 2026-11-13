/* ============================================================
   MODULE 08 — ui-panels : แผงย่อยของหน้าจำลอง (ลำดับสกิลอัตโนมัติ / สเตตัสสุดท้าย / ตารางดาเมจ / Benchmark)
   แต่ละแผงเป็นฟังก์ชันที่คืน {el, update()} — หน้าจำลองแค่ประกอบเข้าด้วยกัน
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h, R = SL.rules, fmt = SL.util.fmt, val = SL.util.val;
  const P = ui.panels = {};
  const pctv = x => +(x * 100).toFixed(1);

  /* ---------- ลำดับสกิลอัตโนมัติ ---------- */
  P.rotation = function(){
    const el = h('div', { class:'col' }); let sig = '', refs = [], addSel = null;
    const castables = st => R.visibleSkills(st.classId).filter(R.isCastable);
    function build(st){
      ui.clear(el); refs = [];
      el.appendChild(h('div', { class:'small muted' }, 'เรียงจากบนลงล่าง: ถึงจังหวะตี ระบบเลือกสกิลแรกที่ใช้ได้ (SP/คูลดาวน์/เงื่อนไขครบ) ถ้าไม่มีจึงตีธรรมดา'));
      st.rotation.forEach((r, i) => {
        const s = SL.store.skill(r.id), ref = {};
        ref.min = ui.num(pctv(r.minSpPct || 0), v => SL.state.change(x => { x.rotation[i].minSpPct = v / 100; }), { min:0, max:100, label:'SP ขั้นต่ำ %' });
        ref.hmin = ui.num(pctv(r.minHpPct || 0), v => SL.state.change(x => { x.rotation[i].minHpPct = v / 100; }), { min:0, max:100, label:'HP ขั้นต่ำ %' });
        ref.hmax = ui.num(pctv(r.maxHpPct === undefined ? 1 : r.maxHpPct), v => SL.state.change(x => { x.rotation[i].maxHpPct = v / 100; }), { min:0, max:100, label:'HP สูงสุด %' });
        ref.skip = ui.check('ไม่ซ้ำถ้ายังติดอยู่', r.skipIfActive !== false, v => SL.state.change(x => { x.rotation[i].skipIfActive = v; }));
        refs.push(ref);
        el.appendChild(h('div', { class:'panel flat', style:{ padding:'8px' } },
          h('div', { class:'row' }, h('b', (i + 1) + '.'), h('span', s ? s.name : r.id), s ? ui.typeChip(s.type) : null,
            h('span', { class:'right row', style:{ gap:'4px' } },
              h('button', { class:'btn sm', type:'button', disabled: i === 0, onclick: () => SL.state.change(x => { x.rotation.splice(i - 1, 0, x.rotation.splice(i, 1)[0]); }) }, '↑'),
              h('button', { class:'btn sm', type:'button', disabled: i === st.rotation.length - 1, onclick: () => SL.state.change(x => { x.rotation.splice(i + 1, 0, x.rotation.splice(i, 1)[0]); }) }, '↓'),
              h('button', { class:'btn sm danger', type:'button', onclick: () => SL.state.change(x => { x.rotation.splice(i, 1); }) }, '✕'))),
          h('div', { class:'row' }, ui.field('SP ≥ %', ref.min), ui.field('HP ≥ %', ref.hmin), ui.field('HP ≤ %', ref.hmax), ref.skip)));
      });
      const free = castables(st).filter(s => !st.rotation.some(r => r.id === s.id));
      addSel = ui.select([{ v:'', t:'— เพิ่มสกิลเข้าลำดับ —' }].concat(free.map(s => ({ v: s.id, t: s.name + (st.learned[s.id] ? '' : ' (ยังไม่ได้เรียน)') }))), '', v => {
        if(v) SL.state.change(x => { x.rotation.push({ id: v, minSpPct: 0, minHpPct: 0, maxHpPct: 1, skipIfActive: true }); }); });
      el.appendChild(h('div', { class:'row' }, addSel,
        h('button', { class:'btn sm primary', type:'button', onclick: () => SL.state.change(x => { x.rotation = R.defaultRotation(x); }) }, 'จัดอัตโนมัติจากสกิลที่เรียน'),
        h('button', { class:'btn sm', type:'button', onclick: () => SL.state.change(x => { x.rotation = []; }) }, 'ล้าง')));
    }
    function update(){
      const st = SL.state.get(), key = st.rotation.map(r => r.id).join(',') + '|' + castables(st).map(s => s.id + (st.learned[s.id] ? 1 : 0)).join(',');
      if(key !== sig){ sig = key; build(st); return; }
      st.rotation.forEach((r, i) => { const f = refs[i]; if(!f) return;
        if(document.activeElement !== f.min) f.min.value = pctv(r.minSpPct || 0);
        if(document.activeElement !== f.hmin) f.hmin.value = pctv(r.minHpPct || 0);
        if(document.activeElement !== f.hmax) f.hmax.value = pctv(r.maxHpPct === undefined ? 1 : r.maxHpPct);
        f.skip.querySelector('input').checked = r.skipIfActive !== false; });
    }
    return { el: el, update: update };
  };

  /* ---------- สเตตัสสุดท้ายหลังคิดสกิล ---------- */
  P.finalStats = function(){
    const el = h('div'); let key = '';
    function update(v){
      const D = SL.store.get(), st = SL.state.get(), S = v.P.stats; const rows = [];
      const k = D.statDefs.map(sd => S[sd.id].toFixed(3) + '/' + (+st.sheet[sd.id] || 0)).join(',') + (v.P.aps).toFixed(3) + st.monster.counter + D.globals.aspdCap;
      if(k === key) return; key = k;
      let grp = '';
      D.statDefs.forEach(sd => { const sheet = +st.sheet[sd.id] || 0, fin = S[sd.id]; if(!sheet && !fin) return;
        if(sd.group !== grp){ grp = sd.group; rows.push(h('tr', h('td', { colspan:3, class:'muted tiny', style:{ paddingTop:'8px' } }, grp))); }
        const diff = Math.abs(fin - sheet) > 1e-6, src = v.P.sources[sd.id] || [];
        rows.push(h('tr', { title: src.map(q => q.name + ' ' + q.text + (q.buff ? ' (บัฟ)' : '')).join('\n') },
          h('td', sd.name), h('td', { class:'n muted' }, SL.calc.fmtStat(sd.id, sheet)),
          h('td', { class:'n', style: diff ? { color:'var(--accent)', fontWeight:600 } : null }, SL.calc.fmtStat(sd.id, fin), sd.id === 'aspd' && fin >= D.globals.aspdCap ? ' (เพดาน)' : ''))); });
      rows.push(h('tr', h('td', { colspan:3, class:'muted tiny', style:{ paddingTop:'8px' } }, 'ผลลัพธ์')));
      rows.push(h('tr', h('td', 'ตี/วินาที (APS)'), h('td'), h('td', { class:'n' }, v.P.aps.toFixed(2))));
      rows.push(h('tr', h('td', 'ดาเมจที่มอนสเตอร์ทำ/วิ (คาดการณ์)'), h('td'), h('td', { class:'n' }, st.monster.counter ? fmt(SL.calc.monsterDps(v.P, v.M), 1) : 'ปิดการสวนกลับ')));
      ui.clear(el).appendChild(h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', 'สเตตัส'), h('th', { class:'n' }, 'ชีต'), h('th', { class:'n' }, 'สุดท้าย'))), h('tbody', rows))));
      el.appendChild(h('div', { class:'tiny muted', style:{ marginTop:'6px' } }, 'ชีต = ค่าที่ใส่เอง · สุดท้าย = หลังรวม passive และบัฟที่ติดอยู่ (เอาเมาส์วางที่แถวเพื่อดูที่มา)'));
    }
    return { el: el, update: update };
  };

  /* ---------- ตารางดาเมจคาดการณ์ต่อสกิล ---------- */
  P.damage = function(){
    const el = h('div'); let key = '';
    function update(v){
      const st = SL.state.get(), C = SL.calc, rows = [];
      const items = [{ name:'ตีธรรมดา', spec: C.BASIC, lv: 1, cd: 0, sp: 0 }];
      R.visibleSkills(st.classId).forEach(s => { const lv = st.learned[s.id] || 0;
        if(lv > 0 && s.damage.kind && R.isCastable(s)){ const u = C.usage(s, lv); items.push({ name: s.name + ' Lv.' + lv, spec: s.damage, lv: lv, cd: u.cooldown, sp: u.sp, aoe: s.damage.aoe, ok: R.weaponOk(s, v.P.weapon, v.P.hasShield) }); } });
      items.forEach(it => { const c = C.components(it.spec, it.lv, v.P, v.M), cyc = Math.max(it.cd, 1 / v.P.aps);
        rows.push(h('tr', { style: it.ok === false ? { opacity:.5 } : null, title: it.ok === false ? 'อาวุธ/โล่ไม่ตรงเงื่อนไข ใช้ไม่ได้' : '' },
          h('td', it.name + (it.aoe ? ' ◎' : '')), h('td', { class:'n' }, fmt(c.normal, 0)), h('td', { class:'n' }, fmt(c.crit, 0)),
          h('td', { class:'n' }, Math.round(c.hitChance * 100) + '%'), h('td', { class:'n' }, +(c.critChance * 100).toFixed(1) + '%'),
          h('td', { class:'n', style:{ fontWeight:600 } }, fmt(c.expected, 0)), h('td', { class:'n' }, fmt(c.expected / cyc, 1)),
          h('td', { class:'n muted' }, it.sp ? fmt(c.expected / it.sp, 1) : '—'))); });
      const k = rows.map(r => r.textContent).join('|'); if(k === key) return; key = k;
      ui.clear(el).appendChild(h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', 'สกิล'), h('th', { class:'n' }, 'ปกติ'), h('th', { class:'n' }, 'คริ'),
        h('th', { class:'n' }, 'โดน'), h('th', { class:'n' }, 'คริ%'), h('th', { class:'n' }, 'เฉลี่ย'), h('th', { class:'n' }, 'DPS*'), h('th', { class:'n' }, 'ดาเมจ/SP'))), h('tbody', rows))));
      el.appendChild(h('div', { class:'tiny muted', style:{ marginTop:'6px' } }, 'ค่าคาดหวังต่อเป้านี้ (หักเกราะ/พลาดแล้ว) · DPS* = ถ้ากดซ้ำทุกครั้งที่พร้อม (รอบ = max(คูลดาวน์, 1/APS)) · ◎ ระยะกว้าง ต่อ 1 เป้า'));
    }
    return { el: el, update: update };
  };

  /* ---------- Benchmark / เทียบบิลด์ ---------- */
  P.bench = function(){
    let secs = 60; const out = h('div', { class:'col' });
    const sel = ui.select([{ v:'30', t:'30 วินาที' }, { v:'60', t:'60 วินาที' }, { v:'120', t:'120 วินาที' }, { v:'300', t:'300 วินาที' }], '60', v => { secs = +v; }, { label:'ระยะเวลา' });
    function table(rows){
      const maxD = Math.max.apply(null, rows.map(r => r.dps).concat([1]));
      return h('div', { class:'scroll-x' }, h('table', { class:'tbl' }, h('thead', h('tr', h('th', 'บิลด์'), h('th', { class:'n' }, 'DPS'), h('th', { class:'n' }, 'ตีธรรมดา'), h('th', { class:'n' }, 'SP/วิ'), h('th', { class:'n' }, 'SP เหลือ'), h('th', { class:'n' }, 'ตาย'))),
        h('tbody', rows.map(r => [h('tr', h('td', r.name), h('td', { class:'n', style:{ fontWeight:600 } }, fmt(r.dps, 1)), h('td', { class:'n' }, Math.round(r.basic.share * 100) + '%'),
          h('td', { class:'n' }, fmt(r.spPerSec, 2)), h('td', { class:'n' }, Math.round(r.spNow) + '/' + Math.round(r.spMax)), h('td', { class:'n ' + (r.deaths ? 'bad' : '') }, r.deaths)),
          h('tr', h('td', { colspan:6, class:'tiny muted' }, h('div', { style:{ height:'5px', width: (r.dps / maxD * 100) + '%', background:'var(--accent)', borderRadius:'3px', marginBottom:'3px' } }),
            r.skills.slice(0, 4).map(s => s.name + ' ' + Math.round(s.share * 100) + '% (' + s.casts + ' ครั้ง)').join(' · ') || 'ไม่ได้ใช้สกิลเลย'))]))));
    }
    const el = h('div', { class:'col' },
      h('div', { class:'row' }, ui.field('ระยะเวลาทดสอบ', sel),
        h('button', { class:'btn primary sm', type:'button', onclick: () => { const r = SL.sim.benchmark(SL.state.get(), secs); r.name = 'ตัวละครปัจจุบัน'; ui.clear(out).appendChild(table([r])); } }, 'รันตัวละครปัจจุบัน'),
        h('button', { class:'btn sm', type:'button', onclick: () => { const rs = SL.sim.benchBuilds(secs); rs.forEach(r => { r.name = r.build.name; }); ui.clear(out).appendChild(table(rs)); } }, 'เทียบทุกบิลด์ตัวอย่าง')),
      h('div', { class:'tiny muted' }, 'รันเร็วเต็มที่ไม่มีภาพ: เป้านิ่งอมตะ + ลำดับสกิลอัตโนมัติ (บิลด์ตัวอย่างใช้ลำดับที่จัดให้เอง) · เป้าหมาย/สวนกลับใช้ตามที่ตั้งไว้'), out);
    return { el: el, update: function(){} };
  };
})(typeof window !== 'undefined' ? window : globalThis);
