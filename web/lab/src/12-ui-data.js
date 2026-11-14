/* ============================================================
   MODULE 12 — ui-data : หน้า "ข้อมูล / ตรวจสอบ" — ตรวจความถูกต้อง, ค่ากลาง (globals), ส่งออก/นำเข้า/รวมข้อมูล, แก้ JSON ทีละหมวด, รีเซ็ต
============================================================ */
(function(g){
  const SL = g.SL = g.SL || {};
  const ui = SL.ui, h = ui.h;
  let root, vBox, gBox, exp, imp, impMsg, colSel, colTa, colMsg, colKey = 'weapons';
  const GLOBAL_LABELS = { aspdCap:'เพดาน ASPD', softDefK:'ค่า K ของสูตร DEF/(DEF+K)', maxPhysReduction:'ลดดาเมจกายภาพสูงสุด (0–1)', maxMagicReduction:'ลดดาเมจเวทสูงสุด (0–1)', maxDodge:'หลบสูงสุด (0–1)',
    critMult:'ตัวคูณคริติคอล', blockReduction:'บล็อกลดดาเมจ (0–1)', hitBase:'โอกาสโดนพื้นฐาน', hitPerPoint:'โอกาสโดนต่อ HIT−FLEE 1 แต้ม', respawnDelay:'มอนสเตอร์เกิดใหม่ (วิ)', reviveDelay:'ตัวละครฟื้น (วิ)' };
  const COLS = [['weapons', 'อาวุธ'], ['statDefs', 'นิยามสเตตัส'], ['presets', 'ชุดสเตตัสสำเร็จรูป'], ['monsters', 'มอนสเตอร์'], ['builds', 'บิลด์ตัวอย่าง'], ['branches', 'สาย'], ['classes', 'คลาส (ดิบ)'], ['skills', 'สกิล (ดิบ)'], ['globals', 'ค่ากลาง (ดิบ)']];

  function drawValidate(){
    const list = SL.rules.validate(SL.store.get()), ord = { error:0, warn:1, info:2 };
    list.sort((a, b) => ord[a.level] - ord[b.level]);
    const nE = list.filter(i => i.level === 'error').length, nW = list.filter(i => i.level === 'warn').length;
    ui.clear(vBox).appendChild(h('div', { class:'col' },
      h('div', { class:'row' }, h('b', { class: nE ? 'bad' : 'ok' }, nE ? nE + ' ข้อผิดพลาด' : 'ไม่มีข้อผิดพลาด'), h('span', { class: nW ? 'warn' : 'muted' }, nW + ' คำเตือน'), h('span', { class:'muted' }, SL.store.get().skills.length + ' สกิล · ' + SL.store.get().classes.length + ' คลาส')),
      list.map(i => h('div', { class:'issue' }, h('span', { class:'lvl ' + (i.level === 'error' ? 'bad' : i.level === 'warn' ? 'warn' : 'muted') }, i.level === 'error' ? 'ผิดพลาด' : i.level === 'warn' ? 'เตือน' : 'ข้อมูล'),
        h('span', { class:'grow' }, i.msg), SL.store.skill(i.ref) ? h('button', { class:'btn sm', type:'button', onclick: () => { ui.nav = { skill: i.ref }; location.hash = '#editor'; } }, 'แก้ไข') : null))));
  }
  function drawGlobals(){
    const G = SL.store.get().globals; ui.clear(gBox);
    const row = h('div', { class:'row' });
    Object.keys(GLOBAL_LABELS).forEach(k => row.appendChild(ui.field(GLOBAL_LABELS[k], ui.num(G[k], v => SL.store.change(d => { d.globals[k] = v; }, 'data'), { label: GLOBAL_LABELS[k] }))));
    gBox.appendChild(row); gBox.appendChild(h('hr'));
    gBox.appendChild(h('div', { class:'small muted' }, 'เพดานรวมของ "% จากบัฟชั่วคราว" ต่อสเตตัส (0.6 = 60%) — passive ไม่ถูกจำกัด'));
    const caps = G.buffPercentCap || {}, rows = h('div', { class:'col' });
    Object.keys(caps).forEach(k => rows.appendChild(h('div', { class:'row' }, h('span', { style:{ minWidth:'90px' } }, SL.calc.statName(k)),
      ui.num(+(caps[k] * 100).toFixed(2), v => SL.store.change(d => { d.globals.buffPercentCap[k] = v / 100; }, 'data'), { min:0, label:'เพดาน %' }), h('span', { class:'muted' }, '%'),
      h('button', { class:'btn sm danger', type:'button', onclick: () => { SL.store.change(d => { delete d.globals.buffPercentCap[k]; }, 'data'); } }, '✕'))));
    gBox.appendChild(rows);
    gBox.appendChild(ui.select([{ v:'', t:'＋ เพิ่มเพดานให้สเตตัส…' }].concat(SL.store.get().statDefs.filter(s => caps[s.id] === undefined).map(s => ({ v: s.id, t: s.name }))), '', v => { if(v) SL.store.change(d => { d.globals.buffPercentCap[v] = 0.5; }, 'data'); }, { label:'เพิ่มเพดาน' }));
  }
  function drawExport(){ if(document.activeElement !== exp) exp.value = SL.store.exportJSON(); }
  function drawCol(){
    const d = SL.store.get(); if(document.activeElement !== colTa) colTa.value = JSON.stringify(d[colKey], null, 2);
  }
  function doImport(replace){
    try{
      const o = JSON.parse(imp.value);
      if(replace){ SL.store.importJSON(imp.value); impMsg.textContent = 'แทนที่ข้อมูลทั้งหมดแล้ว'; }
      else {
        if(!o || typeof o !== 'object') throw new Error('ต้องเป็นอ็อบเจ็กต์');
        const pack = Array.isArray(o) ? { skills: o } : (o.id && o.type ? { skills: [o] } : o); let n = 0;
        SL.store.change(d => { ['classes','branches','skills','weapons','statDefs','presets','monsters','builds'].forEach(k => { if(!Array.isArray(pack[k])) return;
          pack[k].forEach(item => { if(!item || !item.id) return; const i = d[k].findIndex(x => x.id === item.id); if(i >= 0) d[k][i] = item; else d[k].push(item); n++; }); }); }, 'data');
        impMsg.textContent = 'รวมเข้าแล้ว ' + n + ' รายการ (รหัสซ้ำ = แทนที่)';
      }
      impMsg.className = 'small ok';
    }catch(e){ impMsg.textContent = 'ไม่สำเร็จ: ' + e.message; impMsg.className = 'small bad'; }
  }
  function update(){ if(!root) return; drawValidate(); drawGlobals(); drawExport(); drawCol(); }

  ui.pages.data = {
    mount(r){
      root = r; vBox = h('div'); gBox = h('div', { class:'col' });
      exp = h('textarea', { rows:10, readonly:true, 'aria-label':'ข้อมูลทั้งหมด JSON', onfocus: ev => ev.target.select() });
      imp = h('textarea', { rows:6, placeholder:'วาง JSON ที่ส่งออกไว้ หรือสกิลเดียว {"id":...} / อาเรย์สกิล / ชุดข้อมูลบางส่วน', 'aria-label':'นำเข้า JSON' }); impMsg = h('div', { class:'small' });
      colTa = h('textarea', { rows:14, 'aria-label':'แก้ JSON ของหมวด' }); colMsg = h('div', { class:'small' });
      colSel = ui.select(COLS.map(c => ({ v: c[0], t: c[1] })), colKey, v => { colKey = v; colMsg.textContent = ''; drawCol(); }, { label:'หมวดข้อมูล' });
      root.appendChild(h('div', { class:'cols c2' },
        h('div', { class:'col gap-lg' },
          h('div', { class:'panel' }, h('h3', 'ตรวจสอบความถูกต้อง'), vBox),
          h('div', { class:'panel' }, h('h3', 'ค่ากลางของสูตร (globals)'), gBox)),
        h('div', { class:'col gap-lg' },
          h('div', { class:'panel' }, h('h3', 'ส่งออกข้อมูลทั้งหมด'), exp, h('div', { class:'row', style:{ marginTop:'8px' } }, h('button', { class:'btn sm primary', type:'button', onclick: () => ui.copy(exp.value, exp) }, 'คัดลอก JSON'),
            h('span', { class:'tiny muted' }, 'เก็บเป็นไฟล์สำรอง หรือส่งต่อให้โปรเจกต์อื่นได้'))),
          h('div', { class:'panel' }, h('h3', 'นำเข้า / รวมข้อมูล'), imp, h('div', { class:'row', style:{ marginTop:'8px' } },
            h('button', { class:'btn sm primary', type:'button', onclick: () => doImport(false) }, 'รวมเข้า (เพิ่ม/แทนที่ตามรหัส)'), ui.confirmBtn('แทนที่ทั้งหมด', () => doImport(true), 'sm')), impMsg),
          h('div', { class:'panel' }, h('h3', 'แก้ JSON ทีละหมวด (ขั้นสูง)'), h('div', { class:'row', style:{ marginBottom:'8px' } }, colSel,
            h('button', { class:'btn sm primary', type:'button', onclick: () => { try{ const v = JSON.parse(colTa.value);
              if(colKey !== 'globals' && !Array.isArray(v)) throw new Error('ต้องเป็นอาเรย์'); SL.store.change(d => { d[colKey] = v; }, 'data'); colMsg.textContent = 'ใช้งานแล้ว'; colMsg.className = 'small ok'; }
              catch(e){ colMsg.textContent = 'ไม่สำเร็จ: ' + e.message; colMsg.className = 'small bad'; } } }, 'ใช้งานการแก้ไข')), colTa, colMsg),
          (() => {
            const catSel = h('select', { class:'sel' }), sel = h('select', { class:'sel' }), msg = h('span', { class:'small muted' }, '');
            SL.store.categories().forEach(c => catSel.appendChild(h('option', { value: c }, c)));
            const load = () => {
              msg.textContent = 'กำลังโหลดประวัติเวอร์ชัน…'; ui.clear(sel);
              SL.store.versions(catSel.value).then(vs => { vs.forEach(v => sel.appendChild(h('option', { value: String(v.id) }, '#' + v.id + ' · ' + new Date(v.createdAt).toLocaleString() + ' · ' + (v.by || '-') + ' · ' + (v.note || '')))); msg.textContent = vs.length ? '' : 'ยังไม่มีประวัติ'; }).catch(e => { msg.textContent = e.message; });
            };
            catSel.addEventListener('change', load); load();
            return h('div', { class:'panel' }, h('h3', 'ประวัติเวอร์ชันข้อมูลเกม (ใน DB แยกตามหมวด)'),
              h('div', { class:'row' }, catSel, sel, ui.confirmBtn('ย้อนหมวดนี้ไปเวอร์ชันนี้', () => { if(!sel.value) return; SL.store.rollback(catSel.value, sel.value).then(() => { ui.toast('ย้อนกลับแล้ว (สร้างเป็นเวอร์ชันใหม่)'); load(); }).catch(e => ui.toast(e.message)); }),
                ui.confirmBtn('รีเซ็ตตัวละครทดสอบ', () => { SL.state.reset(); ui.toast('รีเซ็ตตัวละครแล้ว'); })), msg,
              h('div', { class:'tiny muted', style:{ marginTop:'6px' } }, 'ข้อมูลเกมเก็บในฐานข้อมูลเซิร์ฟเวอร์แยกเป็นหมวด — ย้อนทีละหมวด (สร้างเวอร์ชันใหม่ ไม่ลบประวัติ), ต้องสอดคล้องกับหมวดอื่น และต้องเป็นแอดมิน'));
          })())));
      update();
    },
    update: update,
  };
})(typeof window !== 'undefined' ? window : globalThis);
