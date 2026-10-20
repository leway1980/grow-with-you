// 版面煙霧測試（不屬於 npm test）：node tests/e2e/layout.smoke.mjs [截圖資料夾]
// 檢查：桌面 1366×768、1920×1080 每張卡的最後一個選項底部不超出視窗（含國中回合，?preview=1）；360px 沒有水平捲軸。
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
const hasCard = (page) => page.locator('[data-act="choice"]').count();
async function advance(page) { // 選第一個可選的選項，按繼續，直到下一張卡（或結局）
  await page.locator('[data-act="choice"]:not([disabled])').first().click();
  for (let i = 0; i < 400; i++) {
    if (await page.locator('#ending-portrait').count()) return false;
    if (await page.locator('[data-act="choice"]').count()) return true;
    if (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]'); else await page.waitForTimeout(20);
  }
  throw new Error('卡住了');
}
async function toCard(page) {
  for (let i = 0; i < 400; i++) {
    if (await hasCard(page)) return;
    if (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]'); else await page.waitForTimeout(20);
  }
  throw new Error('等不到第一張卡');
}
try {
  for (const [w, h, name] of [[1366, 768, '1366'], [1920, 1080, '1920'], [360, 740, '360']]) { // 開場狀態視窗：桌面不用捲、手機單欄無水平捲軸
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`http://localhost:${port}/?seed=11&ms=100`);
    await page.click('[data-act="new"]'); await page.waitForSelector('.status-win');
    assert.equal(await page.locator('[data-act="reroll"], [data-v]').count(), 0, '開場沒有換家庭／爸媽／起點的選項');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name} 開場沒有水平捲軸`);
    const fit = await page.evaluate(() => ({ sh: document.documentElement.scrollHeight, vh: innerHeight, btn: Math.round(document.querySelector('[data-act="start"]').getBoundingClientRect().bottom) }));
    if (w >= 900) assert.ok(fit.sh <= fit.vh && fit.btn <= fit.vh, `${name} 開場不用捲動（高 ${fit.sh} / 視窗 ${fit.vh}）`);
    console.log('intro', name, fit);
    if (shots && name !== '1920') await page.screenshot({ path: join(shots, `intro-${name}.png`), fullPage: w < 900 });
    await page.close();
  }
  for (const [w, h, name] of [[1366, 768, '1366'], [1920, 1080, '1920']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    page.on('dialog', (d) => d.accept());
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`http://localhost:${port}/?seed=11&ms=100&preview=1`);
    await page.click('[data-act="new"]'); await page.click('[data-act="start"]');
    await page.waitForSelector('#scene svg'); await toCard(page);
    const rows = []; let junior = false;
    for (let n = 0; n < 150 && rows.length < 120; n++) {
      const m = await page.evaluate(() => {
        const bs = [...document.querySelectorAll('[data-act="choice"]')]; const last = bs[bs.length - 1].getBoundingClientRect();
        return { label: document.querySelector('.date').textContent, n: bs.length, bottom: Math.round(last.bottom), vh: innerHeight, sw: document.documentElement.scrollWidth <= innerWidth,
          sceneH: Math.round(document.querySelector('#scene').getBoundingClientRect().height), chars: document.querySelector('.panel .body').textContent.length };
      });
      rows.push(m);
      assert.ok(m.sw, `${name} 沒有水平捲軸`);
      assert.ok(m.bottom <= m.vh, `${name}「${m.label}」最後一個選項底部 ${m.bottom} 超出視窗 ${m.vh}（${m.n} 個選項、${m.chars} 字）`);
      if (/國中/.test(m.label)) junior = true;
      if (shots && n === 3) await page.screenshot({ path: join(shots, `game-${name}.png`) });
      if (!(await advance(page))) break;
    }
    assert.ok(rows.length >= 10, `${name} 至少取樣 10 張卡（實際 ${rows.length}）`);
    assert.ok(junior, `${name} 取樣包含國中回合`);
    console.log(name, `取樣 ${rows.length} 張卡，最大底部 ${Math.max(...rows.map((r) => r.bottom))} / 視窗 ${h}，場景高 ${rows[0].sceneH}px，選項數 ${Math.min(...rows.map((r) => r.n))}–${Math.max(...rows.map((r) => r.n))}`);
    if (name === '1366') { // 結局
      if (!(await page.locator('#ending-portrait').count())) await page.click('[data-act="skip-end"]');
      await page.waitForSelector('#ending-portrait svg');
      const side = await page.evaluate(() => { const a = document.querySelector('#ending-portrait').getBoundingClientRect(), b = document.querySelector('#ending-wellbeing').getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && a.right <= b.left + 1; });
      assert.ok(side, '桌面結局：全家福與幸福摘要並排');
      if (shots) await page.screenshot({ path: join(shots, 'ending-1366.png') });
    }
    assert.deepEqual(errs, []);
    await page.close();
  }
  { // 手機與平板
    const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
    await page.goto(`http://localhost:${port}/?seed=11&ms=100&preview=1`);
    await page.click('[data-act="new"]'); await page.click('[data-act="start"]'); await page.waitForSelector('#scene svg'); await toCard(page);
    for (let n = 0; n < 8; n++) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '360px 沒有水平捲軸');
      assert.ok(await page.evaluate(() => document.querySelector('#scene').getBoundingClientRect().height <= 170), '手機場景橫幅不超過約 160px');
      if (n === 2 && shots) await page.screenshot({ path: join(shots, 'game-360.png') });
      if (!(await advance(page))) break;
    }
    await page.setViewportSize({ width: 800, height: 700 });
    const cols = await page.evaluate(() => { const a = document.querySelector('#scene').getBoundingClientRect(), b = document.querySelector('#panel').getBoundingClientRect(); return a.right <= b.left + 1; });
    assert.ok(cols, '平板 800px 兩欄');
    await page.close();
  }
  console.log('layout smoke ok');
} finally { await browser.close(); server.close(); }
