import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { startTurn, chooseCard, finishTurn } from '../js/engine/turn.js';
import { selfChoice } from '../js/engine/auto.js';
import { doseView, meterView, levelOf, visibleKeys } from '../js/engine/dose.js';

const data = loadData();
const HIDDEN = Object.keys(data.tags.hidden);
const NAMES = [...HIDDEN, 'hidden', 'tags', '隱藏', '？後續']; // 隱藏數值的名稱與標記，都不能出現在遊玩畫面的資料裡
const leak = (obj) => { const s = JSON.stringify(obj); return NAMES.filter((n) => s.includes(n)); };

test('劑量表：只有看得到的數值，用方向與格數，不含精確數字或隱藏數值名稱', () => {
  const before = { 體力: 70, 耐心: 60, 錢: 50, 工作表現: 60, 夫妻關係: 60, 心情: 60, 成績: 50, 作業: 50, '3C時間': 20, 睡眠: 60, 同學往來: 50 };
  const after = { ...before, 體力: 62, 心情: 65, '3C時間': 29.5, 睡眠: 60.4 };
  const st = newState(1, data, {});
  const v = doseView(before, after, st, '國小中高');
  assert.deepEqual(v.parent.map((r) => [r.key, r.dir, r.level]), [['體力', -1, 2]]);
  assert.deepEqual(v.child.map((r) => [r.key, r.dir, r.level, r.good]), [['心情', 1, 2, true], ['3C時間', 1, 3, false]]); // 3C 往上是壞事
  for (const r of [...v.parent, ...v.child]) assert.deepEqual(Object.keys(r).sort(), ['dir', 'good', 'key', 'label', 'level']);
  assert.equal(levelOf(0.4), 0); assert.equal(levelOf(-1), 1); assert.equal(levelOf(4), 2); assert.equal(levelOf(9), 3);
  assert.deepEqual(leak(v), []);
});

test('學前不顯示成績與作業；沒有另一半時不顯示夫妻關係', () => {
  const st = newState(1, data, {});
  st.family.partner.present = false;
  const k = visibleKeys(st, '幼兒園');
  assert.ok(!k.child.includes('成績') && !k.child.includes('作業') && !k.parent.includes('夫妻關係'));
  assert.ok(visibleKeys(st, '國小低').child.includes('成績'));
});

test('整局玩下來：每張卡的畫面資料、劑量表、數值條都不含任何隱藏數值或標籤的名稱', () => {
  let cards = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const st = newState(seed, data, { role: seed % 2 ? '爸爸' : '媽媽', startMode: seed > 4 ? 'elementary' : 'birth' });
    while (!st.ended) {
      const res = startTurn(st, data);
      if (res.ended) break;
      assert.deepEqual(leak(meterView(st, res.tl.stage)), []);
      if (res.card) {
        cards++;
        assert.deepEqual(leak(res.card), [], res.card.id);
        const out = chooseCard(st, data, selfChoice(st, res.card));
        assert.deepEqual(leak(out), [], res.card.id);
        assert.deepEqual(leak(meterView(st, res.tl.stage)), []);
      } else assert.deepEqual(leak(res.quiet), []);
      finishTurn(st, data);
    }
  }
  assert.ok(cards > 150);
});

test('卡片畫面資料裡沒有標籤與數值：選項只有編號、文字、是否可選', () => {
  const st = newState(3, data, {});
  const res = startTurn(st, data);
  const c = res.card || { choices: [] };
  for (const ch of c.choices) assert.deepEqual(Object.keys(ch).sort(), ['disabled', 'i', 'label', 'reason']);
});
