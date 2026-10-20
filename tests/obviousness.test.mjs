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
