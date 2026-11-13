#!/usr/bin/env node
/* รวมโมดูลใน src/ เป็นไฟล์ HTML ไฟล์เดียว (เทียบเท่า build.py สำหรับเครื่องที่ใช้ Node.js) */
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });

const files = fs.readdirSync(SRC).filter(f => /^[0-9].*\.js$/.test(f)).sort();
if (!files.length) { console.error('ERROR: ไม่พบไฟล์โมดูลใน src/'); process.exit(1); }

const js = files.map(f => '/* ===== ' + f + ' ===== */\n' + fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n');
if (js.toLowerCase().includes('</script')) { console.error('ERROR: โค้ดมี "</script" อยู่ข้างใน — ใช้ "<\\/script" แทน'); process.exit(1); }

const shell = fs.readFileSync(path.join(SRC, 'shell.html'), 'utf8');
if (!shell.includes('/*__JS__*/')) { console.error('ERROR: src/shell.html ไม่มี placeholder /*__JS__*/'); process.exit(1); }

const html = shell.replace('/*__JS__*/', () => js);
const standalone = '<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n' +
  html + '\n</body>\n</html>\n';

fs.writeFileSync(path.join(DIST, 'ro-skill-lab.html'), html, 'utf8');
fs.writeFileSync(path.join(DIST, 'ro-skill-lab.standalone.html'), standalone, 'utf8');
const rootStandalone = path.resolve(ROOT, '..', 'ro-skill-lab.standalone.html');
if (fs.existsSync(rootStandalone)) fs.writeFileSync(rootStandalone, standalone, 'utf8');

console.log('modules (' + files.length + '): ' + files.join(', '));
console.log('wrote dist/ro-skill-lab.standalone.html (' + (fs.statSync(path.join(DIST, 'ro-skill-lab.standalone.html')).size / 1024).toFixed(1) + ' KB)');
console.log('wrote dist/ro-skill-lab.html            (' + (fs.statSync(path.join(DIST, 'ro-skill-lab.html')).size / 1024).toFixed(1) + ' KB)');
