/* ทดสอบ UI ด้วย Playwright (ต้องติดตั้ง: npm i && npx playwright install chromium)
   รัน: node tests/ui-flow.js   (ต้อง build ก่อน: python3 build.py)  ภาพหน้าจอจะอยู่ใน tests/out/ */
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out' + path.sep); fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(__dirname, '..', 'dist', 'ro-skill-lab.standalone.html');
const BLOCK_FONTS = !!process.env.BLOCK_FONTS;   // ตั้ง BLOCK_FONTS=1 ถ้าออฟไลน์ (กัน Google Fonts ค้าง)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, colorScheme: 'dark' });
  const page = await ctx.newPage(); const errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  if (BLOCK_FONTS) await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const url = URL;
  await page.goto(url, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1200);
  const out = {};
  // 1) rename swBash -> swBashX via editor
  await page.click('#tabs a[data-tab=editor]'); await page.waitForTimeout(300);
  await page.locator('#page-editor .li', { hasText: 'ฟันกระแทก' }).first().click(); await page.waitForTimeout(200);
  const idInput = page.locator('#page-editor input[type=text]').first();
  await idInput.fill('swBashX'); await idInput.press('Enter'); await idInput.blur(); await page.waitForTimeout(400);
  out.rename = await page.evaluate(() => ({ learned: SL.state.get().learned.swBashX, old: SL.state.get().learned.swBash, provokeReq: SL.store.skill('swProvoke').requires.map(r => r.id).join(','),
    build: SL.store.find('builds', 'bld_striker').learned.swBashX, errors: SL.rules.validate(SL.store.get()).filter(i => i.level === 'error').length, rot: SL.state.get().rotation.map(r => r.id).join(',') }));
  // 2) new skill, wire as prerequisite of swMagnum from the other side
  await page.getByRole('button', { name: '＋ สกิลใหม่' }).click(); await page.waitForTimeout(300);
  const newId = await page.evaluate(() => SL.store.get().skills[SL.store.get().skills.length - 1].id);
  out.newId = newId;
  await page.locator('#page-editor select[aria-label="ต่อสกิลอื่น"]').selectOption('swMagnum'); await page.waitForTimeout(300);
  out.magnumReq = await page.evaluate(() => SL.store.skill('swMagnum').requires.map(r => r.id + ':' + r.lv).join(','));
  // cycle protection: options for "add requirement" must exclude descendants
  out.cycleOpts = await page.locator('#page-editor select[aria-label="เพิ่มเงื่อนไข"] option').allTextContents().then(a => a.some(t => t.includes('swMagnum')));
  // 3) tree shows new skill and edge
  await page.click('#tabs a[data-tab=tree]'); await page.waitForTimeout(400);
  out.treeNew = await page.locator('#page-tree .node', { hasText: 'สกิลใหม่' }).count();
  // learn new skill in tree (dbl-click) -> blocked? job Lv ok and class mismatch (novice skill in swordman chain is ok)
  await page.screenshot({ path: OUT + 'shot-tree2.png', fullPage: false });
  // 4) delete new skill
  await page.click('#tabs a[data-tab=editor]'); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'ลบสกิลนี้' }).first().click(); await page.getByRole('button', { name: 'กดอีกครั้งเพื่อยืนยัน' }).first().click(); await page.waitForTimeout(300);
  out.afterDelete = await page.evaluate(id => ({ exists: !!SL.store.skill(id), magnumReq: SL.store.skill('swMagnum').requires.map(r => r.id).join(',') }), newId);
  // 5) persistence after reload
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForTimeout(1000);
  out.persist = await page.evaluate(() => ({ hasX: !!SL.store.skill('swBashX'), hasOld: !!SL.store.skill('swBash'), learned: SL.state.get().learned.swBashX }));
  // 6) sim after rename: still casts
  await page.waitForTimeout(2500);
  out.simCasts = await page.evaluate(() => document.querySelectorAll('#page-sim .log .k-cast').length);
  await page.screenshot({ path: OUT + 'shot-sim-dark.png', fullPage: false });
  // 7) reset data page
  await page.click('#tabs a[data-tab=data]'); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'คืนข้อมูลสกิลทั้งหมดเป็นค่าเริ่มต้น' }).click(); await page.getByRole('button', { name: 'กดอีกครั้งเพื่อยืนยัน' }).first().click(); await page.waitForTimeout(400);
  out.afterReset = await page.evaluate(() => ({ bash: !!SL.store.skill('swBash'), bashX: !!SL.store.skill('swBashX'), learnedKeys: Object.keys(SL.state.get().learned).length }));
  console.log(JSON.stringify(out, null, 1)); console.log('ERRORS:', errs.length ? errs : 'none'); process.exitCode = errs.length ? 1 : 0;
  await browser.close();
})();
