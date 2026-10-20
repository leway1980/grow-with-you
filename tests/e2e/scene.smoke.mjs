// 瀏覽器煙霧測試（不屬於 npm test）：node tests/e2e/scene.smoke.mjs [截圖資料夾]
// 需要 playwright（全域安裝）與已裝好的 Chromium；做法同 tests/fake-dom.mjs 註解提到的 Playwright 檢查。
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
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
  const g = process.env.PLAYWRIGHT_PATH || '/opt/node-tools/node_modules/playwright/index.mjs';
  ({ chromium } = await import(g));
}
const browser = await chromium.launch();
try {
  for (const [scheme, width] of [['light', 360], ['dark', 800]]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme: scheme });
    page.on('dialog', (d) => d.accept());
    const errs = []; page.on('pageerror', (e) => errs.push(e.message));
    await page.goto(`http://localhost:${port}/?seed=11&ms=100`);
    await page.click('[data-act="new"]'); await page.click('[data-act="start"]');
    await page.waitForSelector('#scene svg');
    const label = await page.getAttribute('#scene svg', 'aria-label');
    assert.ok(label && label.length > 10, '場景有文字描述');
    assert.ok((await page.locator('#scene svg rect').count()) > 50);
    const noScroll = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.ok(await noScroll(), `${width}px 寬沒有水平捲軸`);
    if (shots && scheme === 'light') { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(shots, '1-infant.png') }); };
    for (let i = 0; i < 4; i++) { // 玩幾回合
      await page.locator('[data-act="choice"]:not([disabled])').first().click();
      await page.click('[data-act="next"]');
      while (await page.locator('[data-act="choice"]').count() === 0) {
        if (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]'); else await page.waitForTimeout(50);
      }
    }
    assert.ok(await page.locator('#scene svg').count() === 1);
    await page.click('[data-act="skip-end"]');
    await page.waitForSelector('#ending-portrait svg');
    assert.ok(await page.locator('#ending-portrait .album svg').count() >= 3, '成長相簿至少三張');
    assert.ok(await noScroll(), `${width}px 結局沒有水平捲軸`);
    if (shots && scheme === 'light') { await page.locator('#ending-portrait').scrollIntoViewIfNeeded(); await page.screenshot({ path: join(shots, '3-ending.png') }); }
    if (shots && scheme === 'dark') await page.screenshot({ path: join(shots, '4-ending-dark.png') });
    assert.deepEqual(errs, []);
    await page.close();
  }
  if (shots) { // 從國小開始的一回合
    const page = await browser.newPage({ viewport: { width: 360, height: 900 } });
    await page.goto(`http://localhost:${port}/?seed=11&ms=100`);
    await page.click('[data-act="new"]'); await page.click('[data-v="elementary"]'); await page.click('[data-act="start"]');
    await page.waitForSelector('#scene svg');
    assert.ok(/國小|小/.test(await page.getAttribute('#scene svg', 'aria-label')));
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(shots, '2-elementary.png') });
    await page.close();
  }
  console.log('scene smoke ok');
} finally { await browser.close(); server.close(); }
