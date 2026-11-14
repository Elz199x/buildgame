/* รันทดสอบความสมดุลของบิลด์ตัวอย่างหลายสถานการณ์ → ../docs/BENCHMARK_REPORT.md
   รัน: node tools/bench-report.js   (seed คงที่ ผลซ้ำได้ — ใช้เทียบก่อน/หลังแก้ตัวเลขสกิล) */
const fs = require('fs'), path = require('path');
const OUT = path.join(__dirname, '..', '..', '..', 'docs', 'BENCHMARK_REPORT.md');
require('./lab-env')(['00-util', '02-store', '03-rules', '04-stats', '05-sim']);
const SL = globalThis.SL; SL.loadAll();
const SECONDS = 120, SEED = 1;
const scenarios = [
  { name: 'ดัมมี่ธรรมดา ไม่สวนกลับ (วัดดาเมจล้วน)', mon: 'dummy', counter: false },
  { name: 'ดัมมี่ธรรมดา สวนกลับ (วัดความทน)', mon: 'dummy', counter: true },
  { name: 'หุ่นเกราะหนา สวนกลับ', mon: 'armor', counter: true },
  { name: 'บอสทดสอบ สวนกลับ', mon: 'boss', counter: true },
];
const L = ['# รายงาน Benchmark ความสมดุลบิลด์ตัวอย่าง (สร้างอัตโนมัติ)', '',
  '> สร้างด้วย `npm run lab:docs (web/)` · ทดสอบ ' + SECONDS + ' วินาที · seed ' + SEED + ' · เป้านิ่งอมตะ · ใช้ลำดับสกิลอัตโนมัติ (`defaultRotation`) · **ยังไม่มีระบบยา/ฮีลเอง** (มีแค่ regen + สกิลฟื้น HP ที่เรียน)', '',
  'คอลัมน์: DPS เฉลี่ย · สัดส่วนดาเมจจากตีธรรมดา · SP ที่ใช้ต่อวินาที · SP คงเหลือตอนจบ · จำนวนครั้งที่ตัวละครล้ม · HP ที่เสียรวม', ''];
scenarios.forEach(sc => {
  const m = SL.store.find('monsters', sc.mon);
  SL.state.change(s => { s.monster = Object.assign({}, m, { counter: sc.counter }); s.monsterPresetId = m.id; });
  const rows = SL.sim.benchBuilds(SECONDS, SEED);
  L.push('## ' + sc.name, '', '| บิลด์ | DPS | ตีธรรมดา % | SP/วิ | SP เหลือ | ล้ม | HP เสีย | สกิลหลัก |', '|---|---|---|---|---|---|---|---|');
  rows.forEach(r => L.push('| ' + r.build.name + ' | ' + r.dps.toFixed(1) + ' | ' + Math.round(r.basic.share * 100) + '% | ' + r.spPerSec.toFixed(2) + ' | ' + Math.round(r.spNow) + '/' + Math.round(r.spMax) + ' | ' + r.deaths + ' | ' + Math.round(r.hpLost) + ' | ' +
    (r.skills.filter(s => s.dmg > 0).slice(0, 3).map(s => s.name + ' ' + Math.round(s.share * 100) + '%').join(', ') || '—') + ' |'));
  L.push('');
});
L.push('## วิธีอ่านผล', '',
  '- **DPS เทียบกันระหว่างบิลด์** เป็นตัวบอกว่าสกิลเซ็ตไหนแรงเกินหรือเบาเกิน (ตั้งเป้าให้ใกล้เคียงกัน ±20–30% ในสถานการณ์ที่บิลด์นั้นถนัด)',
  '- **SP/วิ สูงกว่า regen มาก + SP เหลือต่ำ** = ติดคอขวด SP: สกิลดาเมจหลักจะถูกใช้ไม่ครบรอบ คูลดาวน์ → ปรับ `usage.sp` หรือ `spRegen`',
  '- **ล้าง > 0 ในสถานการณ์สวนกลับ** = บิลด์นั้นทนไม่พอเมื่อไม่มียา/ฮีล เช่น Berserk ที่ HP ไหล + รับดาเมจเพิ่ม',
  '- ผลทั้งหมดเป็นค่าจากตัวจำลองแบบเรียบง่าย (ไม่มีหลายเป้า ไม่มีระบบยา) ใช้เทียบ "ก่อน/หลังแก้ตัวเลข" มากกว่ายึดค่าสัมบูรณ์', '');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join('\n'), 'utf8');
console.log('wrote', path.relative(process.cwd(), OUT));
