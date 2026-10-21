// 畫面層的測試（用 tests/fake-dom.mjs 的極小 DOM，不需要瀏覽器）：從標題一路玩到終局，每一步檢查 DOM 的文字與屬性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, ROOT } from '../tools/data-node.mjs';
import { installFakeDom, uninstallFakeDom, dump } from './fake-dom.mjs';

const data = loadData();
const HIDDEN = Object.keys(data.tags.hidden);
const TAGS = Object.keys(data.tags.tags);
const BAD_WORDS = [...HIDDEN, 'hidden', 'dirCount', 'tagCounts', 'startHidden', 'costEMA', '隱藏']; // 標籤名稱是日常用語，可以出現在文字裡；但不能出現在屬性與 class 裡（見 checkLeak）
const BAD_ATTRS = ['data-i', 'data-idx', 'data-index', 'data-order', 'data-tags', 'data-hidden', 'data-card', 'data-orig'];

async function boot(search) {
  const { root } = installFakeDom({ search });
  globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => JSON.parse(readFileSync(join(ROOT, url), 'utf8')) });
  await import(`../js/main.js?${Math.random()}`);
  for (let i = 0; i < 50 && !root.querySelector('[data-act="new"]'); i++) await new Promise((r) => setTimeout(r, 10));
  return root;
}
const find = (root, sel) => root.querySelector(sel);
function checkLeak(root, where) {
  const d = dump(root);
  for (const w of BAD_WORDS) assert.ok(!d.all.includes(w), `${where}：畫面上出現「${w}」`);
  for (const t of TAGS) assert.ok(![...d.attrs, ...d.classes].some((x) => x.includes(t)), `${where}：屬性或 class 出現標籤名稱「${t}」`);
  for (const n of root.all()) for (const a of BAD_ATTRS) assert.ok(!(a in n.attrs), `${where}：出現屬性 ${a}`);
  // 沒有任何數字當選項索引、沒有 title 或 aria 提示洩漏效果
  for (const n of root.all()) for (const [k, v] of Object.entries(n.attrs)) {
    if (k === 'style') continue;
    assert.ok(!/[+-]\d/.test(v) || k === 'data-speed', `${where}：屬性 ${k}=${v} 像是數值`);
  }
}

test('window.__gwy 只有網址帶 ?debug=1 才存在（一般玩家的頁面上沒有任何內部狀態的入口）', async () => {
  try {
    await boot('?seed=7');
    assert.equal(globalThis.__gwy, undefined);
    assert.equal(typeof window.__gwy, 'undefined');
  } finally { uninstallFakeDom(); }
  try {
    await boot('?seed=7&debug=1');
    assert.equal(typeof globalThis.__gwy, 'object');
  } finally { uninstallFakeDom(); }
});

test('從標題玩到終局：每一步畫面的文字與屬性都沒有隱藏數值或標籤的名稱；選項按鈕的順序是洗過的，數量不變', async () => {
  const root = await boot('?seed=7&ms=100');
  try {
    checkLeak(root, '標題');
    find(root, '[data-act="new"]').click();
    checkLeak(root, '開場');
    find(root, '[data-act="start"]').click();
    let cards = 0, steps = 0, yearly = 0;
    const cardOrder = [];
    while (!find(root, '#ending-wellbeing') && steps++ < 400) {
      checkLeak(root, `第 ${steps} 步`);
      const choices = root.querySelectorAll('.choice');
      if (choices.length) {
        cards++;
        const positions = choices.map((b) => b.attrs['data-pos']);
        assert.deepEqual(positions, choices.map((_, i) => String(i)), '按鈕只帶顯示位置');
        cardOrder.push(choices.map((b) => b.textContent));
        // 點第一個沒變灰的；選完後 hist 的 label 要等於被點的按鈕文字
        const btn = choices.find((b) => !b.disabled);
        const labelText = btn.querySelector('.lab').textContent;
        btn.click();
        // 引擎的紀錄在 __gwy 才看得到；這裡改看畫面「你選了：…」
        assert.equal(find(root, '.picked-label').textContent, `你選了：${labelText}`);
        continue;
      }
      const yc = find(root, '[data-act="yearly-continue"]'); // 「這一年」小卡（B3）：每個新的一歲先出現，一樣要過畫面洩漏檢查（上面的 checkLeak 已經跑過）
      if (yc) { yearly++; assert.ok(find(root, '#yearly-title') && find(root, '.yearly-fact'), '小卡有標題與你知道嗎'); yc.click(); continue; }
      const next = find(root, '[data-act="next"]');
      if (next) { next.click(); continue; }
      const skip = find(root, '[data-act="skip-time"]');
      if (skip) { skip.click(); continue; }
      break;
    }
    assert.ok(cards >= 40, `只玩了 ${cards} 張卡`);
    assert.ok(yearly >= 5, `一般版（玩到國小六年級）每個生日都有小卡（${yearly}）`);
    assert.ok(find(root, '#ending-wellbeing'), '玩到終局');
  } finally { uninstallFakeDom(); }
});

test('終局的「回頭看」才揭露隱藏數值的名稱（遊戲中絕不出現）', async () => {
  const root = await boot('?seed=7&ms=100');
  try {
    find(root, '[data-act="new"]').click(); find(root, '[data-act="start"]').click();
    for (let s = 0; s < 600 && !find(root, '#ending-wellbeing'); s++) {
      const b = root.querySelectorAll('.choice').find((x) => !x.disabled);
      if (b) { b.click(); continue; }
      const n = find(root, '[data-act="yearly-continue"]') || find(root, '[data-act="next"]') || find(root, '[data-act="skip-time"]');
      if (!n) break; n.click();
    }
    const review = find(root, '#ending-review').textContent;
    assert.ok(review.includes('溫暖陪伴') && review.includes('親子信任'));
    assert.ok(find(root, '#ending-resources').textContent.includes('412-8185（手機加 02）'));
  } finally { uninstallFakeDom(); }
});

test('選項順序：同一張卡在不同種子下，畫面順序不同；同一個種子重開，順序相同', async () => {
  const firstCard = async (seed) => {
    const root = await boot(`?seed=${seed}&ms=100`);
    try {
      find(root, '[data-act="new"]').click(); find(root, '[data-act="start"]').click();
      // 嬰幼兒第一回合是 fx_leave_end 之前的日常卡：不固定，直接取第一張卡的選項文字
      for (let s = 0; s < 200; s++) {
        const bs = root.querySelectorAll('.choice');
        if (bs.length >= 4) return { title: find(root, 'h2').textContent, labels: bs.map((b) => b.textContent) };
        const n = find(root, '[data-act="yearly-continue"]') || find(root, '[data-act="next"]') || find(root, '[data-act="skip-time"]');
        if (!n) break;
        const c = root.querySelectorAll('.choice').find((x) => !x.disabled); if (c) c.click(); else n.click();
      }
    } finally { uninstallFakeDom(); }
  };
  const a = await firstCard(7), a2 = await firstCard(7);
  assert.deepEqual(a, a2);
  const orders = new Set();
  for (let seed = 20; seed < 26; seed++) { const r = await firstCard(seed); if (r) orders.add(r.title + r.labels.join('|')); }
  assert.ok(orders.size >= 2);
});
