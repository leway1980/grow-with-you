// 版面煙霧測試（不屬於 npm test）：node tests/e2e/layout.smoke.mjs [截圖資料夾]
// 檢查：桌面 1366×768、1920×1080 每張卡的最後一個選項底部不超出視窗（含國中回合；E1 起預設就玩到 18 歲）；360px 沒有水平捲軸。
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
// 「這一年」小卡（B3）：每個新的一歲的第一回合先出現。量它的位置（桌面不用捲）、內容，再按「繼續」；shot 給了就截圖一次
const yearlyLog = [];
async function seeYearly(page, name, shot) {
  const m = await page.evaluate(() => {
    const r = (sel) => { const e = document.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().bottom) : -1; };
    return { title: document.querySelector('#yearly-title').textContent, events: document.querySelectorAll('.yearly-events li').length, fact: (document.querySelector('.yearly-fact p') || {}).textContent || '',
      src: (document.querySelector('.yearly-src') || {}).textContent || '', btn: r('[data-act="yearly-continue"]'), skip: r('[data-act="yearly-skip"]'), vh: innerHeight, sw: document.documentElement.scrollWidth <= innerWidth,
      ico: !!document.querySelector('.yearly-ico svg'), score: /[▲▼]|\d+\s*分/.test(document.querySelector('.yearly').textContent) };
  });
  yearlyLog.push({ name, ...m });
  assert.match(m.title, /^.+ \d+ 歲了$/, `${name} 小卡標題`);
  assert.ok(m.events <= 3 && m.fact.length > 0 && /・\d{4}$/.test(m.src) && m.ico && !m.score, `${name} 小卡內容 ${JSON.stringify(m)}`);
  assert.ok(m.sw, `${name} 小卡沒有水平捲軸`);
  if (name !== '360') assert.ok(m.btn <= m.vh && m.skip <= m.vh, `${name} 小卡的按鈕底部 ${m.btn} 超出視窗 ${m.vh}`);
  if (shot && shots) await page.screenshot({ path: join(shots, shot) });
  await page.click('[data-act="yearly-continue"]');
}
let yearlyShot = null;
async function advance(page) { // 選第一個可選的選項，按繼續，直到下一張卡（或結局）
  await page.locator('[data-act="choice"]:not([disabled])').first().click();
  for (let i = 0; i < 400; i++) {
    if (await page.locator('#ending-portrait').count()) return false;
    if (await page.locator('[data-act="choice"]').count()) return true;
    if (await page.locator('[data-act="yearly-continue"]').count()) await seeYearly(page, yearlyShot || '?', yearlyLog.some((x) => x.name === yearlyShot) ? null : `yearly-${yearlyShot}.png`);
    else if (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]'); else await page.waitForTimeout(20);
  }
  throw new Error('卡住了');
}
async function toCard(page) {
  for (let i = 0; i < 400; i++) {
    if (await hasCard(page)) return;
    if (await page.locator('[data-act="yearly-continue"]').count()) await seeYearly(page, yearlyShot || '?', yearlyLog.some((x) => x.name === yearlyShot) ? null : `yearly-${yearlyShot}.png`);
    else if (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]'); else await page.waitForTimeout(20);
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
    await page.goto(`http://localhost:${port}/?seed=11&ms=100`);
    await page.click('[data-act="new"]'); await page.click('[data-act="start"]');
    await page.waitForSelector('#scene svg'); yearlyShot = name; await toCard(page);
    const rows = [], habitLines = []; let junior = false, habitShot = false;
    for (let n = 0; n < 150 && rows.length < 120; n++) {
      const m = await page.evaluate(() => {
        const bs = [...document.querySelectorAll('[data-act="choice"]')]; const last = bs[bs.length - 1].getBoundingClientRect();
        return { label: document.querySelector('.date').textContent, n: bs.length, bottom: Math.round(last.bottom), vh: innerHeight, sw: document.documentElement.scrollWidth <= innerWidth,
          sceneH: Math.round(document.querySelector('#scene').getBoundingClientRect().height), chars: document.querySelector('.panel .body').textContent.length,
          habit: ([...document.querySelectorAll('.panel .habit')].pop() || {}).textContent || '', habits: document.querySelectorAll('.panel .habit').length };
      });
      rows.push(m);
      assert.ok(m.sw, `${name} 沒有水平捲軸`);
      assert.ok(m.bottom <= m.vh, `${name}「${m.label}」最後一個選項底部 ${m.bottom} 超出視窗 ${m.vh}（${m.n} 個選項、${m.chars} 字）`);
      if (/國中/.test(m.label)) { junior = true; if (m.habit) habitLines.push({ ...m, shot: shots && habitLines.length === 0 }); }
      if (shots && n === 3) await page.screenshot({ path: join(shots, `game-${name}.png`) });
      if (shots && /國中/.test(m.label) && m.habit && !habitShot) { habitShot = true; await page.screenshot({ path: join(shots, `habit-line-${name}.png`) }); }
      if (!(await advance(page))) break;
    }
    assert.ok(rows.length >= 10, `${name} 至少取樣 10 張卡（實際 ${rows.length}）`);
    const yl = yearlyLog.filter((x) => x.name === name);
    assert.ok(yl.length >= 5, `${name} 玩過的每個生日都出現「這一年」小卡（${yl.length}）`);
    console.log(name, `「這一年」小卡 ${yl.length} 張，按鈕最大底部 ${Math.max(...yl.map((x) => x.btn))} / 視窗 ${h}，例：${yl[1].title}｜${yl[1].fact}（${yl[1].src}）`);
    assert.ok(junior, `${name} 取樣包含國中回合`);
    // 習慣的一句話（M3 B2）：國中回合在卡片上方有灰色的『照平常那樣，…』，第一個國中回合多一句說明；最後一個選項仍在視窗內（上面的 bottom 斷言已涵蓋）
    assert.ok(habitLines.length >= 2, `${name} 國中回合有習慣的一句話（${habitLines.length}）`);
    assert.ok(habitLines.every((x) => x.habit.startsWith('照平常那樣，')), `${name} 習慣的一句話以「照平常那樣，」開頭`);
    assert.ok(habitLines.some((x) => x.habits === 2), `${name} 第一個國中回合有一次性的說明＋一句話`);
    console.log(name, `習慣的一句話 ${habitLines.length} 回合，例：${habitLines[0].habit}`);
    console.log(name, `取樣 ${rows.length} 張卡，最大底部 ${Math.max(...rows.map((r) => r.bottom))} / 視窗 ${h}，場景高 ${rows[0].sceneH}px，選項數 ${Math.min(...rows.map((r) => r.n))}–${Math.max(...rows.map((r) => r.n))}`);
    if (name === '1366') { // 結局
      if (!(await page.locator('#ending-portrait').count())) await page.click('[data-act="skip-end"]');
      await page.waitForSelector('#ending-portrait svg');
      const side = await page.evaluate(() => { const a = document.querySelector('#ending-portrait').getBoundingClientRect(), b = document.querySelector('#ending-wellbeing').getBoundingClientRect(); return Math.abs(a.top - b.top) < 4 && a.right <= b.left + 1; });
      assert.ok(side, '桌面結局：全家福與幸福摘要並排');
      assert.equal(await page.locator('#ending-yearly').count(), 1, '結局有「這些年你看過的小知識」');
      assert.equal(await page.locator('#ending-yearly li').count(), yl.length, '結局列出看過的每一則小知識');
      assert.equal(await page.evaluate(() => document.querySelector('#ending-yearly').open), false, '結局的小知識預設收合');
      // 決定鏈（M3 B5）：「回頭看」在成就之前；桌面兩欄、字夠大、沒有水平捲軸；每條鏈有年齡、選擇、小曲線、研究小卡
      const ch = await page.evaluate(() => {
        const sec = document.querySelector('#ending-chains'), cards = [...sec.querySelectorAll('article.chain:not(.classroom)')], r = (e) => e.getBoundingClientRect();
        const fs = (e) => parseFloat(getComputedStyle(e).fontSize);
        return {
          before: sec.getBoundingClientRect().top < document.querySelector('#ending-achievement').getBoundingClientRect().top, n: cards.length,
          twoCols: cards.length < 2 || Math.abs(r(cards[0]).top - r(cards[1]).top) < 4 && r(cards[0]).right <= r(cards[1]).left + 1,
          minFont: Math.min(...[...sec.querySelectorAll('li, p, summary')].map(fs)), noOverflow: document.documentElement.scrollWidth <= innerWidth && cards.every((c) => r(c).right <= innerWidth + 1),
          parts: cards.every((c) => c.querySelector('.chain-head b') && c.querySelectorAll('.chain-choices li').length >= 3 && c.querySelector('svg.chain-spark') && c.querySelector('.research .level')),
          cls: !!sec.querySelector('#ending-classroom li'),
        };
      });
      assert.ok(ch.before && ch.n >= 3 && ch.twoCols && ch.noOverflow && ch.parts && ch.cls && ch.minFont >= 13, `桌面結局的決定鏈 ${JSON.stringify(ch)}`);
      console.log(name, `結局決定鏈 ${ch.n} 條，兩欄，最小字 ${ch.minFont}px`);
      if (shots) { await page.screenshot({ path: join(shots, 'ending-1366.png') }); await page.locator('#ending-chains').scrollIntoViewIfNeeded(); await page.locator('#ending-chains').screenshot({ path: join(shots, 'ending-chains-1366.png') }); await page.evaluate(() => scrollTo(0, 0)); }
      await page.click('#ending-yearly summary'); await page.locator('#ending-yearly').scrollIntoViewIfNeeded();
      if (shots) await page.screenshot({ path: join(shots, 'ending-yearly-1366.png') });
    }
    assert.deepEqual(errs, []);
    await page.close();
  }
  { // 手機與平板
    const page = await browser.newPage({ viewport: { width: 360, height: 740 } });
    await page.goto(`http://localhost:${port}/?seed=11&ms=100`);
    await page.click('[data-act="new"]'); await page.click('[data-act="start"]'); await page.waitForSelector('#scene svg'); yearlyShot = '360'; await toCard(page);
    for (let n = 0; n < 8; n++) {
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '360px 沒有水平捲軸');
      assert.ok(await page.evaluate(() => document.querySelector('#scene').getBoundingClientRect().height <= 170), '手機場景橫幅不超過約 160px');
      if (n === 2 && shots) await page.screenshot({ path: join(shots, 'game-360.png') });
      if (!(await advance(page))) break;
    }
    await page.setViewportSize({ width: 800, height: 700 });
    const cols = await page.evaluate(() => { const a = document.querySelector('#scene').getBoundingClientRect(), b = document.querySelector('#panel').getBoundingClientRect(); return a.right <= b.left + 1; });
    assert.ok(cols, '平板 800px 兩欄');
    assert.ok(yearlyLog.some((x) => x.name === '360'), '360px 也看到「這一年」小卡');
    await page.close();
  }
  { // 深色模式的小卡（截圖）、「以後都跳過」存在 localStorage 而且之後不再出現、讓他自己過時停 3 秒就繼續
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${port}/?seed=11&ms=100`);
    await page.click('[data-act="new"]'); await page.click('[data-act="start"]'); await page.waitForSelector('#scene svg');
    const toYearly = async () => { for (let i = 0; i < 400 && !(await page.locator('[data-act="yearly-continue"]').count()); i++) { if (await page.locator('[data-act="choice"]:not([disabled])').count()) await page.locator('[data-act="choice"]:not([disabled])').first().click(); else if (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]'); else await page.waitForTimeout(20); } };
    await toYearly(); assert.ok(await page.locator('[data-act="yearly-continue"]').count(), '深色：出現小卡');
    assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), true);
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.yearly-fact')).backgroundColor);
    assert.notEqual(bg, 'rgb(247, 243, 236)', '深色模式的小卡底色不是淺色');
    if (shots) await page.screenshot({ path: join(shots, 'yearly-dark-1366.png') });
    // 讓他自己過：小卡停約 3 秒才繼續
    await page.click('[data-act="auto"]'); await page.waitForTimeout(1500);
    assert.ok(await page.locator('[data-act="yearly-continue"]').count(), '自動模式：1.5 秒時小卡還在');
    await page.waitForFunction(() => !document.querySelector('[data-act="yearly-continue"]'), null, { timeout: 4500 });
    await page.click('[data-act="auto"]'); // 關掉自動，回到手動
    // 以後都跳過
    for (let i = 0; i < 400 && !(await page.locator('[data-act="yearly-continue"]').count()); i++) { if (await page.locator('[data-act="choice"]:not([disabled])').count()) await page.locator('[data-act="choice"]:not([disabled])').first().click(); else if (await page.locator('[data-act="next"]').count()) await page.click('[data-act="next"]'); else await page.waitForTimeout(20); }
    await page.click('[data-act="yearly-skip"]');
    assert.equal(await page.evaluate(() => localStorage.getItem('gwy.prefs.skipYearly')), '1', '跳過偏好存在 localStorage');
    assert.ok(!(await page.evaluate(() => (localStorage.getItem('gwy.save') || localStorage.getItem('gwy.save.v1') || '') .includes('skipYearly'))), '偏好不在存檔裡');
    await page.waitForSelector('[data-act="choice"]');
    const before = yearlyLog.length; let n = 0;
    for (; n < 60; n++) if (!(await advance(page))) break;
    assert.ok(n >= 20, `跳過後又玩了 ${n} 張卡（至少跨過一個生日）`);
    const again = yearlyLog.length - before;
    assert.equal(again, 0, '選了「以後都跳過」之後不再出現小卡');
    await ctx.close();
  }
  console.log('layout smoke ok');
} finally { await browser.close(); server.close(); }
