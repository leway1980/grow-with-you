import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newState, serialize, deserialize, migrate, writeSave, readSave, store, SAVE_KEY, SAVE_VERSION } from '../js/engine/state.js';
import { guardHidden } from './helpers.mjs';
import { playToEnd, startTurn, chooseCard, nextCard, finishTurn } from '../js/engine/turn.js';
import { botPolicy } from '../tools/simulate.mjs';

const data = loadData();
function playTurns(st, n) {
  for (let i = 0; i < n && !st.ended; i++) {
    const res = startTurn(st, data);
    if (res.card) {
      let view = res.card;
      for (let k = 0; k < 3; k++) { const out = chooseCard(st, data, view.choices.filter((c) => !c.disabled)[0].i); if (!out.more) break; view = nextCard(st, data).card; }
    }
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
  assert.equal(readSave(data), null);
  const st = newState(9, data, {});
  assert.equal(writeSave(st), true);
  assert.deepEqual(readSave(data), migrate(structuredClone(st), data));
  store.set('{壞掉了');
  assert.equal(readSave(data), null);
  store.set(JSON.stringify({ v: 999 }));
  assert.equal(readSave(data), null);
  store.del();
});

test('localStorage 丟例外（私密視窗等）時不影響遊戲', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  try {
    const st = newState(10, data, {});
    assert.doesNotThrow(() => writeSave(st));
    assert.doesNotThrow(() => readSave(data));
    assert.doesNotThrow(() => store.del());
  } finally { delete globalThis.localStorage; }
});

/* ───── 存檔升級：M1 版本的存檔（tests/fixtures/m1-save.json，用 M1 的引擎在第 24 回合存下來）───── */
const m1 = () => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/m1-save.json', import.meta.url)), 'utf8'));

test('M1 的存檔可以升級：補上新欄位的預設值，每次選擇的隱藏變化被丟掉，版本號沒變（欄位只增不改意思）', () => {
  const raw = m1();
  assert.equal(raw.v, SAVE_VERSION); assert.equal(SAVE_VERSION, 1);
  assert.ok(raw.hist.some((h) => h.h), 'fixture 應該帶有 M1 的 hist[].h');
  assert.equal(raw.costEMA, undefined); assert.equal(raw.startHidden, undefined);
  const st = migrate(deserialize(JSON.stringify(raw)), data);
  for (const k of Object.keys(data.tags.hidden)) { assert.equal(typeof st.hidden[k], 'number'); assert.equal(typeof st.startHidden[k], 'number'); }
  assert.deepEqual(st.costEMA, { 體力: 0, 耐心: 0 });
  assert.equal(st.vars.孩子主動開口, 0); assert.equal(st.vars.孩子不再開口, 0);
  assert.ok(st.hist.every((h) => h.h === undefined));
  // startHidden 就是這個種子、這個身分開局時的值
  assert.deepEqual(st.startHidden, newState(raw.seed, data, { role: raw.role, startMode: raw.startMode }).startHidden);
  assert.equal(st.cur.cardId, 'lo_silkworm'); assert.deepEqual(st.cur.acc, {});
});

test('升級時丟掉已經不存在的後續卡與當前卡；舊的 delayed 補上 from', () => {
  const raw = m1();
  raw.delayed = [{ card: 'fu_ask_again', due: 30 }, { card: '已經刪掉的卡', due: 31 }];
  raw.cur = { cardId: '已經刪掉的卡' };
  raw.cooldowns['已經刪掉的卡'] = 99;
  const st = migrate(raw, data);
  assert.deepEqual(st.delayed.map((d) => d.card), ['fu_ask_again']);
  assert.equal(st.delayed[0].from, 29);
  assert.equal(st.cur, null);
  assert.ok(!('已經刪掉的卡' in st.cooldowns));
});

test('M1 的存檔升級後可以接著玩到結局（隱藏數值只被 tags.js 寫），而且結局能產生', async () => {
  const st = guardHidden(migrate(m1(), data));
  playToEnd(st, data, botPolicy('warmFirm', 1));
  assert.equal(st.turn, 56);
  const { buildEnding } = await import('../js/engine/ending.js');
  const e = buildEnding(st, data);
  assert.ok(e.wellbeing.child > 0 && e.moments.length > 0);
});

test('版本不符的存檔（真的不相容）仍然拒絕', () => {
  assert.throws(() => migrate({ v: 2 }, data), /版本不符/);
  assert.throws(() => deserialize(JSON.stringify({ v: 0 })), /版本不符/);
});
