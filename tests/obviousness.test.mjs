import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportBlind } from '../tools/obviousness.mjs';
import { loadData } from '../tools/data-node.mjs';

test('明顯度盲測匯出：每張卡一筆，只有標題、內文、洗亂的選項文字；沒有標籤、效果、結果；槽已填好', () => {
  const data = loadData();
  const { blind, key } = exportBlind(data, 1);
  assert.equal(blind.length, data.events.cards.length);
  for (const b of blind) {
    assert.deepEqual(Object.keys(b).sort(), ['id', 'options', 'text', 'title']);
    const card = data.cardIndex[b.id];
    assert.equal(b.options.length, card.choices.length);
    assert.deepEqual([...key[b.id]].sort(), card.choices.map((_, i) => i));
    assert.ok(![b.title, b.text, ...b.options].some((t) => /[{}]/.test(t)), `${b.id} 還有沒填的槽`);
  }
  const s = JSON.stringify(blind);
  for (const w of ['effects', 'tags', 'result']) assert.ok(!s.includes(w), w);
  assert.deepEqual(exportBlind(data, 1), { blind, key }, '固定種子，結果相同');
  assert.ok(blind.some((b) => { const o = data.cardIndex[b.id].choices.map((c, i) => i); return key[b.id].some((v, i) => v !== o[i]); }), '選項有洗亂');
});

test('--context 匯出：每張卡 2 題；題目只有玩家看得到的欄位；key 記最佳選項；4 份平均且同卡分開', async () => {
  const { exportContext, childLine } = await import('../tools/obviousness.mjs');
  const data = loadData();
  const { blind, key, files } = exportContext(data, 1);
  assert.equal(blind.length, data.events.cards.length * 2);
  for (const b of blind) {
    assert.deepEqual(Object.keys(b).sort(), ['child', 'id', 'options', 'parent', 'text', 'title']);
    for (const o of b.options) assert.deepEqual(Object.keys(o).sort(), ['dose', 'label']);
    const k = key[b.id];
    assert.equal(k.order.length, b.options.length);
    assert.ok(k.best.length >= 1 && k.best.every((i) => i < b.options.length));
    assert.ok(![b.title, b.text, b.child, b.parent, ...b.options.flatMap((o) => [o.label, ...o.dose])].some((t) => /[{}]/.test(t)), `${b.id} 有未填的槽`);
  }
  assert.ok(!/tags|effects|result/.test(JSON.stringify(blind)));
  assert.ok(Object.values(key).some((k) => k.switch), '有最佳選項換人的變體題');
  for (const k of Object.values(key)) assert.equal(k.axisParent.length, k.axis.length, '舊的親子軸數字留在 key 當對照');
  // 最佳選項＝綜合幸福最高（compositeWeights），不是只看親子軸
  const { compositeWeights } = await import('../tools/metrics.mjs');
  const WC = compositeWeights(data.model);
  assert.ok(WC.自我效能 > 0 && WC.了解度 > 0 && WC.期待壓力 < 0, '綜合幸福含自我效能、了解度、期待壓力（反向）');
  for (const k of Object.values(key)) assert.ok(k.best.every((i) => k.axis[i] === Math.max(...k.axis)));
  const R = data.tags.cardRules.obviousOk, ids = new Set(data.events.cards.map((c) => c.id));
  for (const [id, cat] of Object.entries(R)) if (!id.startsWith('_')) { assert.ok(ids.has(id), id + ' 不是卡'); assert.ok(['醫療安全', '訊號', '一次性'].includes(cat), id); }
  assert.equal(files.flat().length, blind.length);
  assert.ok(Math.max(...files.map((f) => f.length)) - Math.min(...files.map((f) => f.length)) <= 2);
  for (const f of files) { const cs = f.map((b) => key[b.id].card); assert.equal(new Set(cs).size, cs.length, '同一份裡同一張卡只出現一次'); }
  assert.deepEqual(exportContext(data, 1).blind, blind, '固定種子，結果相同');
  assert.equal(childLine('小安', { 敏感度: 4, 活動量: 4, 堅持度: 3 }, { grade: 2, ageMonths: 84 }), '小安，小二，比較敏感、容易掉眼淚，坐不太住');
});
