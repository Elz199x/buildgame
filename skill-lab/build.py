#!/usr/bin/env python3
"""
รวมโมดูลใน src/ เป็นไฟล์ HTML ไฟล์เดียว (ไม่มี dependency / ไม่ต้องใช้ bundler)

ผลลัพธ์ (ในโฟลเดอร์ dist/):
  ro-skill-lab.standalone.html  ← เปิดด้วยดับเบิลคลิกได้เลย (มี <!doctype>, <html>, <head> ครบ)
  ro-skill-lab.html             ← เนื้อหาเปล่า ๆ ไม่มี doctype สำหรับวางใน artifact/ระบบที่ห่อ skeleton ให้เอง

วิธีทำงาน: เรียงไฟล์ src/NN-*.js ตามเลขนำหน้า → ต่อกัน → แทนที่ /*__JS__*/ ใน src/shell.html
เพิ่มโมดูลใหม่ = สร้างไฟล์ src/NN-ชื่อ.js (เลขเรียงลำดับการโหลด) แล้วรันสคริปต์นี้ใหม่
"""
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'
DIST.mkdir(exist_ok=True)

files = sorted(p for p in SRC.glob('[0-9]*.js'))
if not files:
    sys.exit('ERROR: ไม่พบไฟล์โมดูลใน src/')

js = '\n'.join('/* ===== %s ===== */\n%s' % (p.name, p.read_text(encoding='utf-8')) for p in files)
if '</script' in js.lower():
    sys.exit('ERROR: โค้ดมี "</script" อยู่ข้างใน — ใช้ "<\\/script" แทน')

shell = (SRC / 'shell.html').read_text(encoding='utf-8')
if '/*__JS__*/' not in shell:
    sys.exit('ERROR: src/shell.html ไม่มี placeholder /*__JS__*/')

html = shell.replace('/*__JS__*/', js)
(DIST / 'ro-skill-lab.html').write_text(html, encoding='utf-8')
(DIST / 'ro-skill-lab.standalone.html').write_text(
    '<!doctype html>\n<html lang="th">\n<head>\n<meta charset="utf-8">\n'
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n</head>\n<body>\n'
    + html + '\n</body>\n</html>\n', encoding='utf-8')

print('modules (%d): %s' % (len(files), ', '.join(p.name for p in files)))
print('wrote dist/ro-skill-lab.standalone.html (%.1f KB)' % ((DIST / 'ro-skill-lab.standalone.html').stat().st_size / 1024))
print('wrote dist/ro-skill-lab.html            (%.1f KB)' % ((DIST / 'ro-skill-lab.html').stat().st_size / 1024))
