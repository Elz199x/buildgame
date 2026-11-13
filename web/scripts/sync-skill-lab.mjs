// คัดลอกโมดูล Skill Lab จาก ../skill-lab/src ไป public/skill-lab (แหล่งความจริงคือ skill-lab/src)
// แล้วเขียน modules.json พร้อม version (hash ของเนื้อหา) เพื่อกัน cache ค้างเวอร์ชันเก่า
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../skill-lab/src");
const out = path.resolve(here, "../public/skill-lab");
fs.mkdirSync(path.join(out, "js"), { recursive: true });

const files = fs.readdirSync(src).filter((f) => /^\d.*\.js$/.test(f)).sort();
const hash = crypto.createHash("sha1");
for (const f of files) {
  const buf = fs.readFileSync(path.join(src, f));
  hash.update(f).update(buf);
  fs.writeFileSync(path.join(out, "js", f), buf);
}
const shell = fs.readFileSync(path.join(src, "shell.html"), "utf8");
const css = shell.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? "";
hash.update(css);
fs.writeFileSync(path.join(out, "skill-lab.css"), css);
const v = hash.digest("hex").slice(0, 10);
fs.writeFileSync(path.join(out, "modules.json"), JSON.stringify({ v, files }));
console.log(`[sync-skill-lab] ${files.length} modules, version ${v}`);
