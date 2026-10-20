import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { playToEnd, playTurn } from '../js/engine/turn.js';
import { playRestAuto, selfChoice } from '../js/engine/auto.js';
import { guardHidden } from './helpers.mjs';
import { BOTS, botPolicy } from '../tools/simulate.mjs';

const data = loadData();

test('守衛本身會擋：在 tags.js 以外寫隱藏數值 → 丟錯（不是只掃原始碼的正規表示式）', () => {
  const st = guardHidden(newState(1, data, {}));
  assert.throws(() => { st.hidden.主見 = 99; }, /只能由 tags\.js 寫入/);
  assert.throws(() => { delete st.hidden.主見; }, /只能由 tags\.js 寫入/);
  assert.throws(() => Object.defineProperty(st.hidden, '主見', { value: 1 }), /只能由 tags\.js 寫入/);
  assert.doesNotThrow(() => st.hidden.主見); // 讀取沒問題
});

test('整局在守衛下玩完：每種策略、從出生與從國小開始，隱藏數值只被 tags.js 寫過', () => {
  for (const bot of Object.keys(BOTS)) {
    for (const [seed, mode] of [[3, 'birth'], [8, 'elementary']]) {
      const st = guardHidden(newState(seed, data, { role: seed % 2 ? '爸爸' : '媽媽', startMode: mode }));
      playToEnd(st, data, botPolicy(bot, 1));
      assert.equal(st.turn, 56, `${bot}/${mode}`);
    }
  }
  // 讓他自己過（auto.js）也一樣
  const st = guardHidden(newState(5, data, {}));
  playTurn(st, data, { choose: (s, v) => selfChoice(s, v) });
  playRestAuto(st, data);
  assert.equal(st.turn, 56);
});

test('同一個種子、同一個策略 → 完全一樣的一局；不同策略 → 不一樣', () => {
  const run = (bot) => { const st = newState(11, data, {}); playToEnd(st, data, botPolicy(bot, 7)); return JSON.stringify([st.hist, st.hidden, st.parent]); };
  assert.equal(run('warmFirm'), run('warmFirm'));
  assert.notEqual(run('warmFirm'), run('permissive'));
});

test('存檔裡不留每次選擇的隱藏變化（hist 只有可見的 d 和標籤）', () => {
  const st = newState(4, data, {});
  playToEnd(st, data, botPolicy('random', 3));
  assert.ok(st.hist.length > 40);
  for (const h of st.hist) { assert.equal(h.h, undefined); assert.ok(Array.isArray(h.tags)); assert.equal(typeof h.d, 'object'); }
  assert.ok(!JSON.stringify(st.hist).includes('"h":'));
});
