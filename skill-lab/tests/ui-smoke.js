/* ทดสอบ UI ด้วย Playwright (ต้องติดตั้ง: npm i && npx playwright install chromium)
   รัน: node tests/ui-smoke.js   (ต้อง build ก่อน: python3 build.py)  ภาพหน้าจอจะอยู่ใน tests/out/ */
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'out' + path.sep); fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.join(__dirname, '..', 'dist', 'ro-skill-lab.standalone.html');
const BLOCK_FONTS = !!process.env.BLOCK_FONTS;   // ตั้ง BLOCK_FONTS=1 ถ้าออฟไลน์ (กัน Google Fonts ค้าง)
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text()); });
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  if (BLOCK_FONTS) await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const out = {};
  out.simSkillBtns = await page.locator('#page-sim .sk').count();
  out.live = (await page.locator('#page-sim .panel', { hasText: 'DPS เฉลี่ย' }).innerText()).slice(0, 120).replace(/\n/g, ' | ');
  out.logLines = await page.locator('#page-sim .log div').count();
  await page.screenshot({ path: OUT + 'shot-sim.png', fullPage: true });

  // manual cast + speed + reset
  await page.locator('#page-sim .sk').first().click();
  await page.getByRole('button', { name: '8×' }).click(); await page.waitForTimeout(1500);
  await page.getByRole('button', { name: '1×', exact: true }).click();
  // benchmark
  await page.getByRole('button', { name: 'เทียบทุกบิลด์ตัวอย่าง' }).click(); await page.waitForTimeout(800);
  out.benchRows = await page.locator('#page-sim .panel', { hasText: 'ทดสอบเร็ว' }).locator('tbody tr').count();
  await page.getByRole('button', { name: 'รันตัวละครปัจจุบัน' }).click(); await page.waitForTimeout(400);

  // tree
  await page.click('#tabs a[data-tab=tree]'); await page.waitForTimeout(500);
  out.treeNodes = await page.locator('#page-tree .node').count();
  out.treeEdges = await page.locator('#page-tree path.edge').count();
  await page.locator('#page-tree .node', { hasText: 'ฟันกระแทก' }).first().click(); await page.waitForTimeout(200);
  out.detail = (await page.locator('#page-tree .panel', { has: page.locator('h4') }).innerText()).slice(0, 100).replace(/\n/g, ' | ');
  await page.screenshot({ path: OUT + 'shot-tree.png', fullPage: true });
  // unlearn dependents blocking: try to unlearn swBash (should be blocked by Provoke etc.)
  const before = await page.locator('#page-tree .node', { hasText: 'ฟันกระแทก' }).first().textContent();
  await page.getByRole('button', { name: 'ลด −1' }).click(); await page.waitForTimeout(100);
  const after = await page.locator('#page-tree .node', { hasText: 'ฟันกระแทก' }).first().textContent();
  out.unlearn = before.replace(/\n/g, ' ') + ' -> ' + after.replace(/\n/g, ' ');
  await page.getByRole('button', { name: 'แสดงทุกคลาส' }).first().click().catch(() => {});
  await page.locator('#page-tree label:has-text("แสดงทุกคลาส") input').check(); await page.waitForTimeout(300);
  out.treeNodesAll = await page.locator('#page-tree .node').count();
  out.treeHeads = await page.locator('#page-tree .colhead').allTextContents();

  // editor
  await page.click('#tabs a[data-tab=editor]'); await page.waitForTimeout(400);
  out.edListItems = await page.locator('#page-editor .list .li').count();
  await page.getByRole('button', { name: '＋ สกิลใหม่' }).click(); await page.waitForTimeout(300);
  out.edFormPanels = await page.locator('#page-editor .panel.flat').count();
  // wire new skill requires swBash via select
  const sel = page.locator('#page-editor select[aria-label="เพิ่มเงื่อนไข"]');
  await sel.selectOption('swBash'); await page.waitForTimeout(300);
  out.reqRows = await page.locator('#page-editor select[aria-label="สกิลที่ต้องมี"]').count();
  // change type to active & add damage
  await page.locator('#page-editor select').filter({ has: page.locator('option[value=trigger]') }).selectOption('active'); await page.waitForTimeout(300);
  await page.locator('#page-editor select').filter({ has: page.locator('option[value=physical]') }).selectOption('physical'); await page.waitForTimeout(300);
  out.hasDamageTerms = await page.locator('#page-editor select[aria-label="สเตตัส"]').count();
  await page.screenshot({ path: OUT + 'shot-editor.png', fullPage: true });
  // class mode
  await page.getByRole('button', { name: 'คลาส & สาย' }).click(); await page.waitForTimeout(200);
  await page.getByRole('button', { name: '＋ คลาสใหม่' }).click(); await page.waitForTimeout(300);
  out.classFormH = await page.locator('#page-editor .panel.flat h3').first().innerText();

  // data
  await page.click('#tabs a[data-tab=data]'); await page.waitForTimeout(500);
  out.issues = await page.locator('#page-data .issue').count();
  out.exportLen = (await page.locator('#page-data textarea').first().inputValue()).length;
  await page.locator('#page-data textarea[aria-label="นำเข้า JSON"]').fill('{"id":"swTest","class":"swordman","name":"ทดสอบนำเข้า","type":"passive","tier":1,"jobLvReq":2,"maxLevel":3,"effects":[{"stat":"atk","mode":"flat","value":3}]}');
  await page.getByRole('button', { name: 'รวมเข้า (เพิ่ม/แทนที่ตามรหัส)' }).click(); await page.waitForTimeout(300);
  out.importMsg = await page.locator('#page-data .small.ok').first().innerText().catch(() => 'none');
  await page.screenshot({ path: OUT + 'shot-data.png', fullPage: true });

  // back to tree: new skill present?
  await page.click('#tabs a[data-tab=tree]'); await page.waitForTimeout(400);
  out.treeAfter = await page.locator('#page-tree .node', { hasText: 'ทดสอบนำเข้า' }).count() + '/' + await page.locator('#page-tree .node', { hasText: 'สกิลใหม่' }).count();

  // mobile
  await page.setViewportSize({ width: 400, height: 800 });
  for (const t of ['sim', 'tree', 'editor', 'data']) {
    await page.click('#tabs a[data-tab=' + t + ']'); await page.waitForTimeout(400);
    out['hscroll_' + t] = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  }
  await page.click('#tabs a[data-tab=sim]'); await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + 'shot-mobile.png', fullPage: false });
  console.log(JSON.stringify(out, null, 1));
  console.log('ERRORS:', errs.length ? errs : 'none'); process.exitCode = errs.length ? 1 : 0;
  await browser.close();
})();
