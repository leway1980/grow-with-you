// 項目 10：訊號卡（DESIGN §11 規則 16）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { SIGNAL_COND } from '../tools/mech.mjs';

const data = loadData();
const R = data.tags.cardRules;
const C = data.cardIndex;

test('每張訊號卡有 requires 條件與一般孩子版；一般版沒有申請評估選項、有「兩週」觀察', () => {
  assert.deepEqual(Object.keys(R.signalCards).sort(), Object.keys(SIGNAL_COND).filter((k) => k !== 'lo_signal_read').sort());
  for (const [sig, gen] of Object.entries(R.signalCards)) {
    assert.match(C[sig].requires.expr, /有(ADHD|學習障礙|自閉症類群|發展遲緩)/, sig);
    assert.ok(C[gen], gen);
    assert.ok(!C[gen].choices.some((c) => c.tags.includes('申請評估或鑑定')), gen);
    assert.ok(C[gen].choices.some((c) => /兩週/.test(c.label)), gen);
    assert.ok(C[gen].weight < C[sig].weight, `${gen} 的權重要比條件版小（訊號卡 ≥60% 出現在有狀況的孩子身上）`);
  }
});

test('申請評估的選項會設 送評估 旗標並排鑑定後續；後續鑑定的卡存在', () => {
  for (const id of ['lo_signal_adhd', 'hi_signal_attention', 'kid_unclear', 'inf_talk_check']) {
    const ch = C[id].choices.filter((c) => c.tags.includes('申請評估或鑑定'));
    assert.ok(ch.length, id);
    for (const c of ch) { assert.ok((c.setFlags || []).includes('送評估'), id); assert.ok(c.followUp.some((f) => f.card === 'as_outcome'), id); }
  }
  for (const id of ['as_outcome', 'as_iep', 'as_med']) assert.equal(C[id].pool, '鑑定後續', id);
});

test('性別化的描述用 textIf（孩子性別）而不是寫死', () => {
  for (const id of ['lo_signal_adhd', 'hi_signal_attention', 'kid_route']) assert.ok((C[id].textIf || []).some((t) => /孩子性別 == '女'/.test(t.if)), id);
});
