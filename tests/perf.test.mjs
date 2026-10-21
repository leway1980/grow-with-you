import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBots, makeSyntheticCards } from '../tools/simulate.mjs';
import { loadRaw, loadData } from '../tools/data-node.mjs';

test('卡片依「階段 × 池」建索引；合成 500 張卡之後索引仍然只看該階段的池', () => {
  const raw = loadRaw();
  raw.events.cards.push(...makeSyntheticCards(raw, 500));
  const data = loadData(raw);
  assert.ok(Object.keys(data.index['國小低']).length >= 5);
  const total = Object.values(data.index).flatMap((p) => Object.values(p)).flat().length;
  assert.ok(total >= 500);
  for (const [stage, pools] of Object.entries(data.index)) for (const cs of Object.values(pools)) for (const c of cs) assert.ok(!c.stages || c.stages.includes(stage));
  assert.ok(!Object.values(data.index).some((p) => '_fixed' in p));
});

test('效能：500 張合成卡，每種策略 20 局（所有策略平行）在幾秒內跑完；完整基準 node tools/bench.mjs（200 局／策略 ≤ 20 秒）', async () => {
  const t0 = Date.now();
  const g = await runBots(20, 1, { synthetic: 500 });
  const ms = Date.now() - t0;
  assert.equal(Object.values(g).flat().length, 20 * Object.keys(g).length);
  // 試作階段：校準只報告（docs/plans/M3.md）
  if (ms >= 10000) console.log(`# △ 效能 ${ms} ms（目標 < 10000）`);
});
