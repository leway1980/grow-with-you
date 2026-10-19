import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState, serialize, deserialize, writeSave, readSave, store, SAVE_KEY } from '../js/engine/state.js';
import { playToEnd, startTurn, chooseCard, finishTurn } from '../js/engine/turn.js';
import { botPolicy } from '../tools/simulate.mjs';

const data = loadData();
function playTurns(st, n) {
  for (let i = 0; i < n && !st.ended; i++) {
    const res = startTurn(st, data);
    if (res.card) chooseCard(st, data, res.card.choices.filter((c) => !c.disabled)[0].i);
    finishTurn(st, data);
  }
}

test('存檔往返：序列化再讀回來完全相同', () => {
  const st = newState(42, data, { role: '媽媽', startMode: 'birth' });
  playTurns(st, 20);
  const back = deserialize(serialize(st));
  assert.deepEqual(back, st);
});

test('存檔讀回後繼續玩，結果和沒存檔直接玩完全一致（亂數流都在存檔裡）', () => {
  const a = newState(7, data, {}), b = newState(7, data, {});
  playTurns(a, 15); playTurns(b, 15);
  const restored = deserialize(serialize(b));
  const pol = () => botPolicy('warmFirm', 123);
  playToEnd(a, data, pol()); playToEnd(restored, data, pol());
  assert.deepEqual(restored.hist, a.hist);
  assert.deepEqual(restored.hidden, a.hidden);
  assert.equal(restored.turn, 56);
});

test('沒有 localStorage 也能玩：存取失敗時退回記憶體；壞檔與舊版本回傳 null', () => {
  assert.equal(typeof globalThis.localStorage, 'undefined'); // Node 沒有 localStorage，store 的 try/catch 要接住
  assert.equal(SAVE_KEY, 'gwy.save.v1');
  store.del();
  assert.equal(readSave(), null);
  const st = newState(9, data, {});
  assert.equal(writeSave(st), true);
  assert.deepEqual(readSave(), st);
  store.set('{壞掉了');
  assert.equal(readSave(), null);
  store.set(JSON.stringify({ v: 999 }));
  assert.equal(readSave(), null);
  store.del();
});

test('localStorage 丟例外（私密視窗等）時不影響遊戲', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  try {
    const st = newState(10, data, {});
    assert.doesNotThrow(() => writeSave(st));
    assert.doesNotThrow(() => readSave());
    assert.doesNotThrow(() => store.del());
  } finally { delete globalThis.localStorage; }
});
