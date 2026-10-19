import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintData } from '../tools/lint-data.mjs';
import { loadRaw } from '../tools/data-node.mjs';

test('資料檢查通過：沒有錯誤', () => {
  const { errors } = lintData();
  assert.deepEqual(errors, []);
});

test('lint 會擋下：沒有標籤、沒有可見效果、未知標籤、教養風格宣告、槽沒有後備值', () => {
  const clone = () => structuredClone(loadRaw());
  const run = (mut) => { const raw = clone(); mut(raw); return lintData(raw).errors.join('\n'); };
  assert.match(run((r) => { r.events.cards[2].choices[0].tags = []; }), /至少要有 1 個行為標籤/);
  assert.match(run((r) => { r.events.cards[2].choices[0].effects = {}; }), /至少要有 1 個看得到的效果/);
  assert.match(run((r) => { r.events.cards[2].choices[0].tags = ['不存在的標籤']; }), /不在詞彙表/);
  assert.match(run((r) => { r.events.cards[2].choices[0].label = '我是開明的父母，尊重孩子'; }), /教養風格宣告/);
  assert.match(run((r) => { r.events.cards[2].choices[0].label = '採用民主式溝通'; }), /教養風格宣告/);
  assert.match(run((r) => { r.slots.slots.球類 = r.slots.slots.球類.map((v) => ({ ...v, if: '年級 >= 1' })); }), /沒有無條件的值/);
  assert.match(run((r) => { r.events.cards[2].text += '主見'; }), /隱藏數值的名稱/);
});
