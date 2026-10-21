// 設計檢驗的判定函式（tools/mech.mjs）：配對月齡的方向檢查
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchedAge } from '../tools/mech.mjs';

// 合成資料：每局 4 個回合（月齡 0、12、24、36），了解度每回合 −1；進入『不太來找你』的局（enter＝12）在進入後再多掉 shift
const game = (bot, i, enter, shift) => ({ bot, episodes: enter == null ? [] : [{ enter, exit: null }], und: [0, 12, 24, 36].map((m, k) => [m, 50 - k + (i % 3) * 0.1 - (enter != null && m >= enter + 12 ? shift : 0)]) });
const mk = (shift) => [...Array.from({ length: 80 }, (_, i) => game('a', i, null, 0)), ...Array.from({ length: 40 }, (_, i) => game('a', i, 12, shift)), ...Array.from({ length: 40 }, (_, i) => game('b', i, null, 0))];

test('matchedAge：進入後 12 個月的了解度和同機器人、同月齡還沒進入的局比', () => {
  const r = matchedAge(mk(2), { lag: 12 });
  assert.equal(r.n, 40);
  assert.ok(Math.abs(r.mean + 2) < 0.05, `平均差 ${r.mean}`);
  assert.ok(r.upper < 0);
});
test('matchedAge：沒有差別時，單邊 95% 上界不會小於 0 很多；進入太晚（量不到 12 個月後）的局不算', () => {
  const r = matchedAge(mk(0), { lag: 12 });
  assert.ok(Math.abs(r.mean) < 0.05 && r.upper > -0.1);
  const late = [...mk(2).filter((g) => !g.episodes.length), ...Array.from({ length: 30 }, (_, i) => game('a', i, 30, 2))]; // 30 + 12 > 36：量不到
  assert.equal(matchedAge(late, { lag: 12 }).n, 0);
});

import { rateVerdict, wilson } from '../tools/mech.mjs';
test('rateVerdict：整段 Wilson 區間都在範圍外才 ✗；有重疊時 n ≥ 200 算過、n < 200 只是 pending', () => {
  assert.deepEqual(rateVerdict(0.5, 1000, { max: 0.6 }).ok, true);
  assert.equal(rateVerdict(0.7, 1000, { max: 0.6 }).ok, false); // 區間 0.67–0.73 全在範圍外
  assert.equal(rateVerdict(0.7, 1000, { max: 0.6 }).pending, false);
  const near = rateVerdict(0.61, 1000, { max: 0.6 }); // 點估計超過，但區間 0.58–0.64 與範圍重疊
  assert.equal(near.ok, true);
  const small = rateVerdict(0.65, 100, { max: 0.6 });
  assert.equal(small.ok, false); assert.equal(small.pending, true);
  assert.deepEqual(rateVerdict(0.3, 500, { min: 0.2, max: 0.4 }).lo, wilson(150, 500)[0]);
  assert.equal(rateVerdict(0.1, 1000, { min: 0.2 }).ok, false);
});
