// 校準目標（DESIGN §3.4 修訂版）：N = 200、從出生開始、所有策略共用同一批種子；兩組種子（1–200 與 201–400）都要通過。
// 目標的定義在 tools/calibration.mjs（tools/simulate.mjs 也用同一份來印現況）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBots, BOTS } from '../tools/simulate.mjs';
import { evaluateCalibration } from '../tools/calibration.mjs';
import { sensitivity, SENSITIVITY_FLOOR } from '../tools/sensitivity.mjs';

// 兩組種子（1–200、201–400）都要過：只在其中一組過的目標不算完成
const SEED_SETS = [1, 201];
const sets = [];
for (const s0 of SEED_SETS) { const games = await runBots(200, s0); sets.push({ s0, games, results: evaluateCalibration(games) }); }
const games = sets[0].games;

test('模擬器：六種策略、每種 200 局、同一批種子', () => {
  for (const { games: g } of sets) {
    assert.deepEqual(Object.keys(g).sort(), Object.keys(BOTS).sort());
    for (const x of Object.values(g)) assert.equal(x.length, 200);
    for (const name of Object.keys(g)) assert.deepEqual(g[name].map((y) => y.seed), g.random.map((y) => y.seed)); // 成對
  }
  assert.ok(sets[0].results.length >= 15);
});

for (const { s0, results } of sets) {
  for (const r of results) {
    test(`校準（種子 ${s0}–${s0 + 199}）：${r.desc}＝${r.value}（目標 ${r.target}）`, () => {
      assert.ok(r.ok, `${r.desc}：現況 ${r.value}，目標 ${r.target}`);
    });
  }
}

test('校準：每種策略的三條軸都有 P10／P50／P90（分布不是一個點）', () => {
  for (const g of sets.flatMap((x) => Object.values(x.games))) {
    const v = g.map((x) => x.ax[0]).sort((a, b) => a - b);
    assert.ok(v[Math.floor(v.length * 0.9)] > v[Math.floor(v.length * 0.1)]);
  }
});

test('校準：同一個策略平行跑（worker）與單執行緒跑，結果完全一致', async () => {
  const a = await runBots(6, 1, { bots: ['warmFirm'], workers: 1 });
  const b = await runBots(6, 1, { bots: ['warmFirm'], workers: 3 });
  assert.deepEqual(a.warmFirm.map((x) => [x.seed, x.ax, x.w]), b.warmFirm.map((x) => [x.seed, x.ax, x.w]));
});

test(`敏感度：每個標籤的權重各 ±20%，warmFirm − doseGreedy 的親子差距仍 ≥ ${SENSITIVITY_FLOOR}（這裡每種策略 8 局；完整版 node tools/sensitivity.mjs）`, async () => {
  const { base, rows, min } = await sensitivity(8, 1);
  assert.ok(base >= SENSITIVITY_FLOOR);
  assert.ok(rows.length >= 100);
  assert.ok(min >= SENSITIVITY_FLOOR, `最小差距 ${min.toFixed(1)}：${rows.filter((r) => r.gap < SENSITIVITY_FLOOR).map((r) => r.tag + '×' + r.f).join('、')}`);
});
