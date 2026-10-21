// 項目 11：台灣現場的合理性
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { describeCard } from '../js/engine/events.js';

const data = loadData();
const C = data.cardIndex;
const all = (c) => JSON.stringify(c);

test('低年級多半中午放學；睡覺研究選項是九點；特休有薪；過年卡要有月份條件', () => {
  assert.match(C.lo_afterschool.text, /中午十二點就放學/);
  assert.ok(C.lo_sleep.choices[0].label.includes('九點'));
  assert.ok(!all(C.sf_leave).includes('扣的那半天'));
  for (const id of ['hi_news', 'kid_cny']) assert.match(C[id].requires.expr, /月 == 1/, id);
  assert.ok(!all(C.cm_car).includes('鋼琴'));
});

test('固定的年度事件有年級版文字；學校平板主要是中年級以後', () => {
  for (const id of ['fx_sports_day', 'fx_field_trip', 'fx_teacher_meet']) {
    const c = C[id], conds = c.textIf.map((t) => t.if).join('|');
    assert.match(conds, /年級 <= 2/, id); assert.match(conds, /年級 >= 5/, id);
    assert.ok(!c.choices.some((o) => /交棒|一百元/.test(o.label + o.result)), id + ' 的選項不能綁死某一個年級的情境');
  }
  assert.ok(C.lo_tablet.weight < C.hi_tablet.weight);
});

test('補習：國小的補習不會到十點', () => {
  assert.ok(!all(C.hi_exam).includes('十點才回到家'));
});
