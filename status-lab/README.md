# Status Lab

| ไฟล์ | คืออะไร |
|---|---|
| `ro-status-lab.html` | เวอร์ชัน V8 ใช้งานจริง — ดับเบิลคลิกเปิดในเบราว์เซอร์ได้เลย (ฟอนต์จาก Google Fonts ถ้าออฟไลน์จะใช้ฟอนต์สำรอง) |
| `default-config.json` | ค่าเริ่มต้นของ CONFIG ดึงมาเป็น JSON เพื่ออ่าน/diff ง่าย (คัดจาก `DEFAULT_CONFIG` ใน HTML) — ใช้เป็น import ใน backend ของ Status Lab ได้ |
| `ro-status-system.js` | ไลบรารี Node รุ่นแรก (แนวคิดและโครง modifier/class hook) ใช้เป็นเอกสารอ้างอิงเชิงโค้ด |

รายละเอียดสูตร/โครงสร้าง: [`../docs/STATUS_LAB.md`](../docs/STATUS_LAB.md)

ข้อมูลที่ผู้ใช้แก้ในหน้าเว็บอยู่ใน localStorage (`roStatusLabConfig_v1`) — ล้างด้วยปุ่ม "คืนค่าเริ่มต้น" ในแท็บ Backend หรือเคลียร์ข้อมูลไซต์
