// 校準目標（DESIGN §3.4 修訂版）：N = 200、從出生開始、所有策略共用同一批種子；兩組種子（1–200 與 201–400）都要通過。
// 目標的定義在 tools/calibration.mjs（tools/simulate.mjs 也用同一份來印現況）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBots, BOTS } from '../tools/simulate.mjs';
import { evaluateCalibration, controllingLearn } from '../tools/calibration.mjs';
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

// controlling-learn（預先登記的指標，A2.5 審查 Issue 4）：兩組種子合併成 400 局成對種子；
// 指標＝開學後前 24 個月的平均可見成績，controlling − warmFirm。閘門：整體 > 0，且孩子敏感度 ≤ 2 的 95% 區間下界 > 0。
// 敏感度 ≥ 4 的反轉（壓力對敏感的孩子反效果，規則 21 的教學點）只報告、不進閘門。
const POOLED = ['controlling-learn'];
const pooledGames = Object.fromEntries(Object.keys(sets[0].games).map((b) => [b, [...sets[0].games[b], ...sets[1].games[b]]]));
{
  const cl = controllingLearn(pooledGames.controlling, pooledGames.warmFirm);
  assertPaired(pooledGames);
  test(`校準（合併種子 1–400，成對）：${cl.desc}＝${cl.value}`, () => {
    assert.ok(cl.ok, `${cl.desc}：${cl.value}；目標 ${cl.target}`);
  });
  test('校準：controlling-learn 的資訊列——敏感度 ≥ 4 的孩子，壓力反而拖累成績（平均差 < 0），這是規則 21 要教的', () => {
    assert.ok(cl.detail.hiS.n >= 30);
    assert.ok(cl.detail.hiS.mean < 0, `敏感度 ≥ 4：${cl.detail.hiS.mean.toFixed(2)}`);
  });
}
function assertPaired(g) { assert.deepEqual(g.controlling.map((x) => x.seed), g.warmFirm.map((x) => x.seed)); }

for (const { s0, results } of sets) {
  for (const r of results.filter((x) => !POOLED.includes(x.id))) {
    test(`校準（種子 ${s0}–${s0 + 199}）：${r.desc}＝${r.value}（目標 ${r.target}）`, () => {
      // 試作階段：校準只報告（docs/plans/M3.md）
      if (!r.ok) console.log(`# △ ${r.desc}：現況 ${r.value}，目標 ${r.target}`);
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

// E1 審查：combos-classified 以前的 ok 寫死 true（只分類到 3/7 也會過）；方向檢查要擋得住退化
test('組合分類器是真的檢查：全部歸成同一種組合會判 ✗；controlling 比 permissive 更常三邊都垮會判 ✗；controlling 沒有「成績好」的結局會判 ✗', () => {
  const force = (f) => Object.fromEntries(Object.entries(games).map(([b, g]) => [b, g.map((x) => ({ ...x, combo: f(b, x) }))]));
  const row = (g, id) => evaluateCalibration(g).find((r) => r.id === id);
  assert.equal(row(force(() => '三邊都垮'), 'combos-classified').ok, false);
  const flip = force((b, x) => (b === 'permissive' ? '其他' : b === 'controlling' ? '三邊都垮' : x.combo));
  assert.equal(row(flip, 'perm-gt-ctrl-collapse').ok, false);
  assert.equal(row(force((b, x) => (b === 'controlling' ? '其他' : x.combo)), 'ctrl-achiever').ok, false);
  assert.equal(row(force((b, x) => (b === 'controlling' ? '成績好、關係冷' : x.combo)), 'ctrl-achiever').ok, true);
  const real = row(games, 'combos-classified');
  assert.ok(Number(real.value.split('/')[0]) >= 5, real.value);
});
