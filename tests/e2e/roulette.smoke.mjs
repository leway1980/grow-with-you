// 開場轉盤煙霧測試（不屬於 npm test）：node tests/e2e/roulette.smoke.mjs [截圖資料夾]
// 檢查：捲軸存在、轉的時候開始鈕停用、停下後每個捲軸的字等於狀態表格的值、跳過立刻停、減少動態偏好時立刻顯示、總時間約 4 秒內。
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
const KEYS = ['身分', '氣質', '地點', '家庭型態', '經濟'];
const read = (page) => page.evaluate(() => ({
  reels: [...document.querySelectorAll('.reel')].map((e) => ({ key: e.dataset.reel, text: e.textContent, spinning: e.classList.contains('spinning') })),
  table: Object.fromEntries([...document.querySelectorAll('.sw-row')].map((r) => [r.querySelector('dt').textContent, r.querySelector('dd').textContent])),
  startDisabled: document.querySelector('[data-act="start"]').disabled,
  skip: !!document.querySelector('[data-act="skip-roulette"]'),
  sw: document.documentElement.scrollWidth <= innerWidth, sh: document.documentElement.scrollHeight, vh: innerHeight,
}));
const open = async (opts, w = 1366, h = 768) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, ...opts });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(`http://localhost:${port}/?seed=11`); await page.click('[data-act="new"]'); await page.waitForSelector('.status-win');
  return { page, errs };
};
try {
  { // 1) 自然播放：轉的時候開始鈕停用，停下後字等於表格
    const { page, errs } = await open();
    const t0 = Date.now();
    await page.waitForTimeout(500);
    let m = await read(page);
    assert.deepEqual(m.reels.map((r) => r.key).sort(), [...KEYS].sort(), '五個捲軸');
    assert.ok(m.startDisabled && m.skip && m.reels.every((r) => r.spinning), '轉的時候：開始鈕停用、有跳過鈕');
    const pre = await page.evaluate(() => ({ ph: [...document.querySelectorAll('.sw-row:not(.has-reel) dd')].every((d) => getComputedStyle(d, '::after').content.includes('？？？')), rows: [...document.querySelectorAll('.sw-row')].map((r) => Math.round(r.getBoundingClientRect().height)), top: Math.round(document.querySelector('[data-act="start"]').getBoundingClientRect().top) }));
    assert.ok(pre.ph, '沒轉的列顯示 ？？？');
    if (shots) await page.screenshot({ path: join(shots, 'spin-1366.png') });
    await page.waitForTimeout(2000);
    m = await read(page);
    assert.ok(m.reels.some((r) => r.spinning) && m.reels.some((r) => !r.spinning) && m.startDisabled, '中途：依序停下，還有沒停的');
    await page.waitForFunction(() => !document.querySelector('[data-act="start"]').disabled, null, { timeout: 6000 });
    const took = Date.now() - t0;
    assert.ok(took <= 4800, `總時間 ${took}ms`);
    m = await read(page);
    for (const r of m.reels) assert.equal(r.text, m.table[r.key], `${r.key} 停下的值等於表格`);
    const post = await page.evaluate(() => ({ rows: [...document.querySelectorAll('.sw-row')].map((r) => Math.round(r.getBoundingClientRect().height)), top: Math.round(document.querySelector('[data-act="start"]').getBoundingClientRect().top) }));
    assert.deepEqual(post, { rows: pre.rows, top: pre.top }, '轉的時候和停下後版面不位移');
    assert.ok(m.reels.every((r) => !r.spinning) && !m.skip && m.sw && m.sh <= m.vh, `停下後版面 ${JSON.stringify({ sh: m.sh, vh: m.vh })}`);
    await page.waitForTimeout(1500); // 落地閃光要在 0.8 秒內退乾淨
    const bg = await page.evaluate(() => [...document.querySelectorAll('.reel')].map((e) => getComputedStyle(e).backgroundColor));
    assert.ok(bg.every((c) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'), `停下 1.5 秒後捲軸背景要透明 ${bg}`);
    assert.equal(await page.locator('.roulette-on').count(), 0);
    if (shots) await page.screenshot({ path: join(shots, 'landed-1366.png') });
    assert.deepEqual(errs, []); await page.close();
    console.log('roulette 自然播放 ok', took, 'ms');
  }
  { // 2) 跳過
    const { page, errs } = await open();
    await page.waitForTimeout(300); await page.click('[data-act="skip-roulette"]');
    const m = await read(page);
    assert.ok(!m.startDisabled && !m.skip && m.reels.every((r) => !r.spinning && r.text === m.table[r.key]), '跳過後立刻停');
    assert.deepEqual(errs, []); await page.close(); console.log('roulette 跳過 ok');
  }
  { // 3) 減少動態：不轉
    const { page } = await open({ reducedMotion: 'reduce' });
    const m = await read(page);
    assert.ok(!m.startDisabled && !m.skip && m.reels.length === 5 && m.reels.every((r) => !r.spinning && r.text === m.table[r.key]), '減少動態：立刻顯示');
    await page.close(); console.log('roulette 減少動態 ok');
  }
  { // 4) 手機 360：中途與停下
    const { page } = await open({}, 360, 740);
    await page.waitForTimeout(1500);
    let m = await read(page); assert.ok(m.sw, '360 轉的時候沒有水平捲軸');
    if (shots) await page.screenshot({ path: join(shots, 'spin-360.png'), fullPage: true });
    await page.click('[data-act="skip-roulette"]'); m = await read(page); assert.ok(m.sw, '360 停下後沒有水平捲軸');
    await page.waitForTimeout(1500);
    if (shots) await page.screenshot({ path: join(shots, 'landed-360.png'), fullPage: true });
    await page.close(); console.log('roulette 360 ok');
  }
} finally { await browser.close(); server.close(); }
