/* โหลดโมดูล lab ใน Node สำหรับเทสต์/เครื่องมือ — ข้อมูลเกมมาจากไฟล์ seed ซึ่งเป็นฟิกซ์เจอร์ของเทสต์ (ตัวเดียวกับที่เซิร์ฟเวอร์ใช้ใส่ DB ว่าง; ระบบจริงอ่านจาก DB)
   ไม่มีค่าเริ่มต้นฝังในโค้ด: เบราว์เซอร์รับข้อมูลจาก /api/data เหมือนกัน (ที่นี่จำลองเป็น __SL_REMOTE_DATA) */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');
const SEED = path.join(__dirname, '..', '..', '..', 'server', 'internal', 'gamedata', 'seed', 'game-data.json');
const ROOT = path.join(__dirname, '..', '..', '..');

module.exports = function loadLab(modules, seedPath) {
  global.window = global;
  global.__SL_REMOTE_API = 'http://lab.invalid';          // โหมดเซิร์ฟเวอร์ (ไม่มีการเรียกเครือข่ายจริง)
  global.__SL_REMOTE_DATA = JSON.parse(fs.readFileSync(seedPath || SEED, 'utf8'));
  global.fetch = () => Promise.reject(new Error('offline'));
  modules.forEach(f => (0, eval)(fs.readFileSync(path.join(SRC, f + '.js'), 'utf8')));
  globalThis.SL.loadAll();
  return globalThis.SL;
};
module.exports.ROOT = ROOT;
module.exports.SEED = SEED;
