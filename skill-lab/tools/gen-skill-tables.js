/* สร้างเอกสารตารางสกิล/ข้อมูลอ้างอิง จากข้อมูลจริงใน src/01-defaults.js → ../docs/SKILL_TABLES.md
   รัน: node tools/gen-skill-tables.js   (รันใหม่ทุกครั้งที่แก้ข้อมูลเริ่มต้น เอกสารจะไม่เพี้ยนจากของจริง) */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src'), OUT = path.join(__dirname, '..', '..', 'docs', 'SKILL_TABLES.md');
['00-util', '01-defaults', '02-store', '03-rules', '04-stats'].forEach(f => (0, eval)(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8')));
const SL = globalThis.SL; SL.loadAll();
const D = SL.store.get(), val = SL.util.val, C = SL.calc;

const num = x => String(+x.toFixed(3));
function fmtS(S, scale, unit) {
  scale = scale || 1; unit = unit || '';
  const m = SL.util.sMode(S);
  if (m === 'const') return num(S * scale) + unit;
  if (m === 'table') return '[' + S.table.map(v => num(v * scale)).join(', ') + ']' + unit;
  if (S.base === S.step) return num(S.base * scale) + unit + '×Lv';
  return num(S.base * scale) + unit + ' + ' + num(S.step * scale) + unit + '/Lv';
}
const esc = s => String(s).replace(/\|/g, '\\|');
const usageText = s => {
  const u = s.usage || [], p = [];
  if (u.sp) p.push('SP ' + fmtS(u.sp)); if (u.hp) p.push('HP ' + fmtS(u.hp, 100, '%')); if (u.cooldown) p.push('CD ' + fmtS(u.cooldown, 1, 's'));
  if (u.duration) p.push('นาน ' + fmtS(u.duration, 1, 's')); if (u.hpDrain) p.push('HP ไหล ' + fmtS(u.hpDrain, 100, '%') + '/s'); if (u.spDrain) p.push('SP ไหล ' + fmtS(u.spDrain) + '/s');
  if (s.trigger) p.push('trigger: HP ≤ ' + Math.round(s.trigger.hpBelow * 100) + '% ปิดเมื่อ > ' + Math.round((s.trigger.hpAbove === undefined ? 1 : s.trigger.hpAbove) * 100) + '% CD ' + s.trigger.cooldown + 's');
  if (s.toggleOff && s.toggleOff.hpBelow) p.push('ปิดเองเมื่อ HP < ' + Math.round(s.toggleOff.hpBelow * 100) + '%');
  return p.join(' · ') || '—';
};
const effText = s => {
  const p = [];
  if (s.damage.kind) p.push((s.damage.kind === 'magic' ? 'เวท ' : 'กายภาพ ') + s.damage.terms.map(t => { const f = fmtS(t.mult, 100, '%'); return (f.indexOf(' + ') >= 0 ? '(' + f + ')' : f) + ' ' + C.statName(t.stat); }).join(' + ') + (s.damage.aoe ? ' [AoE]' : '') + (s.damage.noCrit ? ' [ไม่คริ]' : ''));
  if (s.heal) p.push('ฟื้น HP ' + fmtS(s.heal.pctMaxHp, 100, '%') + ' ของสูงสุด');
  s.effects.forEach(e => { const a = C.fmtEffect(e.stat, e.mode, val(e.value, 1)), b = C.fmtEffect(e.stat, e.mode, val(e.value, s.maxLevel));
    p.push(s.maxLevel > 1 ? a + ' → ' + b.slice(C.statName(e.stat).length + 1) + (e.appliesTo === 'target' ? ' (เป้า)' : '') : a + (e.appliesTo === 'target' ? ' (เป้า)' : '')); });
  return p.join('<br>') || '—';
};
const reqText = s => s.requires.map(r => { const t = SL.store.skill(r.id); return (t ? t.name : r.id) + ' Lv' + r.lv; }).join(', ') || '—';
const wText = s => { const r = s.weaponReq, p = []; if (s.needShield) p.push('ต้องสวมโล่'); if (r.slotType) p.push(r.slotType); if (r.damageType) p.push(r.damageType); if (r.include.length) p.push('เฉพาะ ' + r.include.join('/')); if (r.exclude.length) p.push('ยกเว้น ' + r.exclude.join('/')); return p.join(', ') || '—'; };

const L = [];
L.push('# ตารางสกิลและข้อมูลอ้างอิง (สร้างอัตโนมัติ)', '', '> ไฟล์นี้สร้างจาก `skill-lab/src/01-defaults.js` ด้วย `node skill-lab/tools/gen-skill-tables.js` — **อย่าแก้มือ** ให้แก้ข้อมูลแล้วรันใหม่', '',
  'หน่วย: SP/ค่าแบน เป็นตัวเลขตรง ๆ · `HP x%` = เศษส่วนของ HP สูงสุด · `a + b/Lv` = ค่าที่ Lv1 บวกเพิ่มต่อเลเวล · `c×Lv` = ต่อเลเวลเท่ากันทุกเลเวล · `[...]` = ตารางระบุทุกเลเวล', '');
D.classes.forEach(c => {
  const sk = D.skills.filter(s => s.class === c.id);
  L.push('## ' + c.name + ' (`' + c.id + '`)', '');
  L.push('- คลาสแม่: ' + (c.parent ? '`' + c.parent + '`' : '— (คลาสเริ่มต้น)') + ' · Job Lv สูงสุด ' + c.jobLvCap + ' · แต้มสกิลต่อ Job Lv ' + c.pointsPerJobLv);
  if (!sk.length) { L.push('- ยังไม่มีสกิล (เป็นโครงเปล่าให้เพิ่มทีหลัง)', ''); return; }
  const lv = sk.reduce((a, s) => a + s.maxLevel, 0), pts = (c.jobLvCap - 1) * c.pointsPerJobLv;
  const cnt = t => sk.filter(s => s.type === t).length;
  L.push('- สกิล ' + sk.length + ' ตัว (passive ' + cnt('passive') + ' · active ' + cnt('active') + ' · buff ' + cnt('buff') + ' · toggle ' + cnt('toggle') + ' · trigger ' + cnt('trigger') + ') รวม **' + lv + ' เลเวล** เทียบแต้มที่ได้ **' + pts + '** (ซื้อได้ ' + Math.round(pts / lv * 100) + '%) → ต้องเลือกสร้างบิลด์', '');
  L.push('| รหัส | ชื่อ | ชนิด | สาย | Tier | Job Lv | Max | เงื่อนไขก่อนเรียน | อาวุธ | การใช้งาน | ผล (Lv1 → สูงสุด) |', '|---|---|---|---|---|---|---|---|---|---|---|');
  sk.slice().sort((a, b) => a.tier - b.tier || a.jobLvReq - b.jobLvReq).forEach(s => {
    const br = D.branches.find(b => b.id === s.branch);
    L.push('| `' + s.id + '` | ' + esc(s.name) + ' | ' + s.type + ' | ' + (br ? br.name : '—') + ' | ' + s.tier + ' | ' + s.jobLvReq + ' | ' + s.maxLevel + ' | ' + esc(reqText(s)) + ' | ' + esc(wText(s)) + ' | ' + esc(usageText(s)) + ' | ' + effText(s).replace(/\|/g, '\\|') + ' |');
  });
  L.push('', '### แผนผังการเชื่อมต่อ (Mermaid)', '', '```mermaid', 'graph TD');
  D.branches.filter(b => sk.some(s => s.branch === b.id)).forEach(b => {
    L.push('  subgraph ' + b.id + '["' + b.name + '"]');
    sk.filter(s => s.branch === b.id).forEach(s => L.push('    ' + s.id + '["' + s.name.replace(/"/g, "'") + '<br/>Lv' + s.maxLevel + ' · J' + s.jobLvReq + '"]'));
    L.push('  end');
  });
  sk.filter(s => !D.branches.some(b => b.id === s.branch)).forEach(s => L.push('  ' + s.id + '["' + s.name + '"]'));
  D.skills.filter(s => s.class === c.id).forEach(s => s.requires.forEach(r => L.push('  ' + r.id + (r.lv > 1 ? ' -->|Lv' + r.lv + '| ' : ' --> ') + s.id)));
  L.push('```', '');
});

L.push('## อาวุธ (`weapons`)', '', '| รหัส | ชื่อ | การถือ | ประเภทดาเมจ | weaponClass |', '|---|---|---|---|---|');
D.weapons.forEach(w => L.push('| `' + w.id + '` | ' + w.name + ' | ' + w.slotType + ' | ' + w.damageType + ' | ' + w.weaponClass + ' |'));
L.push('', '## นิยามสเตตัส (`statDefs`)', '', '| รหัส | ชื่อ | กลุ่ม | kind | ความหมายของ kind |', '|---|---|---|---|---|');
D.statDefs.forEach(s => L.push('| `' + s.id + '` | ' + s.name + ' | ' + s.group + ' | ' + s.kind + ' | ' + { num: 'ตัวเลขปกติ', frac: 'เศษส่วน (0.05 = 5%)', pct: 'หน่วยเป็น % อยู่แล้ว (7 = 7%)' }[s.kind] + ' |'));
L.push('', '## ชุดสเตตัสสำเร็จรูป (`presets`)', '', '| รหัส | ชื่อ | อาวุธ | โล่ | ATK | ASPD | HIT | FLEE | DEF | MDEF | HP | SP |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
D.presets.forEach(p => { const s = p.sheet; L.push('| `' + p.id + '` | ' + p.name + ' | ' + p.weaponId + ' | ' + (p.hasShield ? 'ใช่' : '—') + ' | ' + s.atk + ' | ' + s.aspd + ' | ' + s.hit + ' | ' + s.flee + ' | ' + s.def + ' | ' + s.mdef + ' | ' + s.maxHp + ' | ' + s.maxSp + ' |'); });
L.push('', '## มอนสเตอร์ทดสอบ (`monsters`)', '', '| รหัส | ชื่อ | DEF | MDEF | FLEE | HP | ATK | HIT | ตีทุก (วิ) |', '|---|---|---|---|---|---|---|---|---|');
D.monsters.forEach(m => L.push('| `' + m.id + '` | ' + m.name + ' | ' + m.def + ' | ' + m.mdef + ' | ' + m.flee + ' | ' + m.maxHp + ' | ' + m.atk + ' | ' + m.hit + ' | ' + m.interval + ' |'));
L.push('', '## บิลด์ตัวอย่าง (`builds`)', '', '| รหัส | ชื่อ | คลาส | Job Lv | พรีเซ็ต | สกิลที่ลง |', '|---|---|---|---|---|---|');
D.builds.forEach(b => L.push('| `' + b.id + '` | ' + b.name + ' | ' + b.classId + ' | ' + b.jobLv + ' | ' + b.presetId + ' | ' + Object.keys(b.learned).map(k => k + ':' + b.learned[k]).join(', ') + ' |'));
L.push('', '## ค่ากลาง (`globals`)', '', '```json', JSON.stringify(D.globals, null, 2), '```', '');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log('wrote', path.relative(process.cwd(), OUT), '(' + L.length + ' lines)');
