import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { newState, startTurnOf, serialize, deserialize, migrate, writeSave, readSave, store, SAVE_KEY, SAVE_VERSION } from '../js/engine/state.js';
import { guardHidden } from './helpers.mjs';
import { playToEnd, startTurn, chooseCard, nextCard, finishTurn } from '../js/engine/turn.js';
import { botPolicy } from '../tools/simulate.mjs';

const data = loadData();
const PLAYABLE = data.calendar.playableTurns;
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
  assert.equal(restored.turn, PLAYABLE);
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

/* ───── 存檔升級：v1 存檔（tests/fixtures/m1-save.json，用 M1 的引擎在 v1 回合 24 存下來；v1＝92 回合日曆）───── */
const m1 = () => JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/m1-save.json', import.meta.url)), 'utf8'));
// v1 日曆的回合 → 月齡（獨立寫一份，不用引擎裡的，才測得出引擎對不對）
const v1Months = (t) => (t < 8 ? t * 3 : t < 20 ? 24 + (t - 8) * 4 : 72 + (t - 20) * 2);
const firstTurnAtOrAfter = (m) => data.timeline.findIndex((t) => t.ageMonths >= m);

test('v1 存檔升級成 v2：版本號、補上新欄位的預設值、每次選擇的隱藏變化被丟掉、當前卡清掉讓這一回合重玩', () => {
  const raw = m1();
  assert.equal(raw.v, 1); assert.equal(SAVE_VERSION, 2);
  assert.ok(raw.hist.some((h) => h.h), 'fixture 應該帶有 M1 的 hist[].h');
  assert.equal(raw.costEMA, undefined); assert.equal(raw.startHidden, undefined);
  const st = migrate(deserialize(JSON.stringify(raw)), data);
  assert.equal(st.v, 2);
  for (const k of Object.keys(data.tags.hidden)) { assert.equal(typeof st.hidden[k], 'number'); assert.equal(typeof st.startHidden[k], 'number'); }
  assert.deepEqual(st.costEMA, { 體力: 0, 耐心: 0 });
  assert.equal(st.vars.孩子主動開口, 0); assert.equal(st.vars.孩子不再開口, 0);
  assert.ok(st.hist.every((h) => h.h === undefined));
  // startHidden 就是這個種子、這個身分開局時的值
  assert.deepEqual(st.startHidden, newState(raw.seed, data, { role: raw.role, startMode: raw.startMode }).startHidden);
  assert.equal(st.cur, null); assert.equal(st.cardScope, null);
});

test('v1 → v2：每個回合序號經 舊回合 → 月齡 → 新回合（第一個月齡 ≥ 舊月齡的回合）重新對應', () => {
  const raw = m1();
  raw.delayed = [{ card: 'fu_ask_again', due: 30, from: 28 }];
  raw.openPools = { 孩子重提: { x: 4, until: 35 } };
  raw.parentGrowth = [{ turn: 22, slot: '球類', value: '樂樂棒球' }, { turn: 9, tag: '放下手機陪' }];
  const before = structuredClone(raw);
  const st = migrate(raw, data);
  const nt = (t) => firstTurnAtOrAfter(v1Months(t));
  assert.equal(st.turn, nt(before.turn));
  assert.deepEqual(st.hist.map((h) => h.turn), before.hist.map((h) => nt(h.turn)));
  assert.deepEqual(st.curves.map((c) => c.t), before.curves.map((c) => nt(c.t)));
  assert.deepEqual(st.vcurves.map((c) => c.t), before.vcurves.map((c) => nt(c.t)));
  assert.deepEqual(Object.fromEntries(Object.entries(st.cooldowns)), Object.fromEntries(Object.entries(before.cooldowns).map(([k, v]) => [k, nt(v)])));
  assert.deepEqual(st.delayed, [{ card: 'fu_ask_again', due: nt(30), from: nt(28) }]);
  assert.equal(st.openPools.孩子重提.until, nt(35)); assert.equal(st.openPools.孩子重提.x, 4);
  assert.deepEqual(st.parentGrowth.map((g) => g.turn), [nt(22), nt(9)]);
  // 月齡不倒退：新回合的月齡 ≥ 舊月齡，而且比舊月齡晚不到一個回合的間隔
  for (const [o, n] of before.hist.map((h, i) => [h.turn, st.hist[i].turn])) assert.ok(data.timeline[n].ageMonths >= v1Months(o) && (n === 0 || data.timeline[n - 1].ageMonths < v1Months(o)), `舊回合 ${o}`);
  // 學前的轉換例子：舊回合 10（32 個月）→ 新回合 11（33 個月）；舊回合 20（72 個月）→ 新回合 24
  assert.equal(nt(10), 11); assert.equal(data.timeline[nt(10)].ageMonths, 33); assert.equal(nt(20), startTurnOf(data, 'elementary'));
});

test('v1 → v2：手足的 arriveTurn 換成 arriveMonths（舊回合的月齡）；年長手足是 null', () => {
  const raw = m1();
  raw.family.siblings = [{ rel: '弟弟', older: false, ageGap: 0, arriveTurn: 14 }, { rel: '哥哥', older: true, ageGap: 3, arriveTurn: null }];
  const st = migrate(raw, data);
  assert.deepEqual(st.family.siblings, [{ rel: '弟弟', older: false, ageGap: 0, arriveMonths: 24 + 6 * 4 }, { rel: '哥哥', older: true, ageGap: 3, arriveMonths: null }]);
});

test('v1 → v2：舊的最後一個可玩回合（國小六年級暑假）夾在新的可玩範圍內，不會被算成國中；已結束的存檔仍是結束', () => {
  const late = m1(); late.turn = 55; late.hist.push({ turn: 55, card: late.hist.at(-1).card, title: 't', ch: 0, label: 'l', tags: [], d: {} });
  const a = migrate(late, data);
  assert.equal(a.turn, PLAYABLE - 1); assert.equal(a.hist.at(-1).turn, PLAYABLE - 1); assert.equal(data.timeline[a.turn].stage, '國小中高');
  const done = m1(); done.turn = 56; done.ended = true; done.endReason = '待續';
  const b = migrate(done, data);
  assert.equal(b.turn, PLAYABLE); assert.equal(b.ended, true);
});

test('v1 存檔經 writeSave／readSave 路徑讀得進來（存檔鍵不變）', () => {
  store.set(JSON.stringify(m1()));
  const st = readSave(data);
  assert.ok(st && st.v === 2); assert.equal(st.turn, firstTurnAtOrAfter(v1Months(24)));
  store.del();
});

test('舊存檔沒有職位、交通工具、通勤距離（與父母的收穫紀錄）：升級時補上，值和同一個種子新開局抽到的一樣', () => {
  const raw = m1();
  assert.equal(raw.family.rank, undefined); assert.equal(raw.family.transport, undefined);
  const st = migrate(raw, data);
  const fresh = newState(raw.seed, data, { role: raw.role, startMode: raw.startMode }).family;
  assert.deepEqual([st.family.rank, st.family.transport, st.family.commute], [fresh.rank, fresh.transport, fresh.commute]);
  assert.deepEqual(st.parentGrowth, []);
  assert.equal(st.hidden.父母的收穫, 0);
});

test('升級時丟掉已經不存在的後續卡；舊的 delayed 補上 from', () => {
  const raw = m1();
  raw.delayed = [{ card: 'fu_ask_again', due: 30 }, { card: '已經刪掉的卡', due: 31 }];
  raw.cur = { cardId: '已經刪掉的卡' };
  raw.cooldowns['已經刪掉的卡'] = 99;
  const st = migrate(raw, data);
  assert.deepEqual(st.delayed.map((d) => d.card), ['fu_ask_again']);
  assert.equal(st.delayed[0].from, firstTurnAtOrAfter(v1Months(29)));
  assert.equal(st.cur, null);
  assert.ok(!('已經刪掉的卡' in st.cooldowns));
});

test('v1 存檔升級後可以接著玩到結局（隱藏數值只被 tags.js 寫），而且結局能產生', async () => {
  for (const bot of ['warmFirm', 'random']) {
    const st = guardHidden(migrate(m1(), data));
    playToEnd(st, data, botPolicy(bot, 1));
    assert.equal(st.turn, PLAYABLE); assert.equal(st.ended, true);
    const { buildEnding } = await import('../js/engine/ending.js');
    const e = buildEnding(st, data);
    assert.ok(e.wellbeing.child > 0 && e.moments.length > 0);
  }
});

test('版本不符的存檔（真的不相容）仍然拒絕', () => {
  assert.throws(() => migrate({ v: 3 }, data), /版本不符/);
  assert.throws(() => migrate({ v: 0 }, data), /版本不符/);
  assert.throws(() => deserialize(JSON.stringify({ v: 0 })), /版本不符/);
});
