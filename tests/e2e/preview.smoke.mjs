// 完整遊戲煙霧測試（不屬於 npm test）：node tests/e2e/preview.smoke.mjs [截圖資料夾]
// E1 起預設就是 72 回合：標題頁沒有「試玩」連結、?preview=1 沒有作用、每個生日的「這一年」小卡按「繼續」，從出生玩到 18 歲離家，結局標題寫「離家」。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const shots = process.argv[2];
if (shots) mkdirSync(shots, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = createServer((req, res) => {
  const p = join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
}).listen(0);
const port = server.address().port;

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  ({ chromium } = await import(process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright/index.mjs'));
}
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 900 } });
  page.on('dialog', (d) => d.accept());
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  // 標題：沒有「試玩到 18 歲（開發中）」的連結；?preview=1 也沒有作用（不出現試玩標記、存檔沒有預覽旗標）
  await page.goto(`http://localhost:${port}/?seed=11&ms=100&preview=1`);
  await page.waitForSelector('[data-act="new"]');
  assert.equal(await page.locator('[data-act="preview-on"], [data-act="preview-off"]').count(), 0, '標題沒有預覽開關');
  assert.ok(!/試玩|開發中/.test(await page.locator('body').textContent()), '標題沒有「試玩」字樣');
  await page.click('[data-act="new"]'); await page.click('[data-act="start"]');
  await page.waitForSelector('#scene svg');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gwy.save.v1')));
  assert.equal(saved.preview, undefined, '存檔沒有預覽旗標');
  let yearly = 0;
  let sawHigh = false, sawDoseLabel = new Set(), n = 0;
  while (!(await page.locator('#ending-portrait').count())) {
    if (++n > 3000) throw new Error('玩不完');
    const label = await page.locator('#age-label').textContent().catch(() => '');
    if (await page.locator('[data-act="choice"]:not([disabled])').count()) {
      if (!sawHigh && /^高/.test(label || '')) {
        sawHigh = true; await page.evaluate(() => window.scrollTo(0, 0));
        if (shots) await page.screenshot({ path: join(shots, '5-senior-high.png') });
      }
      await page.locator('[data-act="choice"]:not([disabled])').first().click();
    } else if (await page.locator('[data-act="yearly-continue"]').count()) { yearly++; await page.click('[data-act="yearly-continue"]'); // 每個生日的「這一年」小卡
    } else if (await page.locator('[data-act="next"]').count()) {
      const p = await page.locator('.dperiod').count() ? await page.locator('.dperiod').textContent() : '';
      if (p) sawDoseLabel.add(p);
      await page.click('[data-act="next"]');
    } else if (await page.locator('[data-act="skip-time"]').count()) await page.click('[data-act="skip-time"]');
    else await page.waitForTimeout(20);
  }
  assert.ok(sawHigh, '有玩到高中');
  assert.ok(yearly >= 15, `玩到離家，每個生日都有「這一年」小卡（${yearly}）`);
  assert.ok([...sawDoseLabel].some((x) => /這半年/.test(x)), `高中的劑量表有「這半年」：${[...sawDoseLabel]}`);
  const head = await page.locator('.head .small').first().textContent();
  assert.match(head, /陪伴到：離家/, head);
  const note = await page.locator('#ending-achievement').textContent();
  assert.ok(!/國小畢業了/.test(note), '結局不能再寫國小畢業了');
  assert.ok(/離開家了/.test(note), note);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '結局沒有水平捲軸');
  await page.locator('#ending-portrait').scrollIntoViewIfNeeded();
  if (shots) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(shots, '6-ending-top.png') }); await page.locator('#ending-portrait').screenshot({ path: join(shots, '7-ending-portrait.png') }); }
  assert.deepEqual(errs, []);
  console.log('full-game smoke ok（共 ' + n + ' 步，小卡 ' + yearly + ' 張）');
} finally { await browser.close(); server.close(); }
