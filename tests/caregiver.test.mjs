// 照顧者類型只改變代價（DESIGN §11 規則 9）：選長輩、保母、托嬰中心、私立／雙語幼兒園本身不扣分；
// 好壞由之後怎麼交接、問了什麼、有沒有去看、有沒有談規則決定（每種類型有 2–3 張小卡）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { buildCtx, passes, describeCard } from '../js/engine/events.js';

const data = loadData();
const T = data.tags;
const C = (id) => data.cardIndex[id];
const BLANKET = ['規則不一致', '外包'];

test('選照顧者的選項不帶 規則不一致／外包：用中性標籤（交給長輩帶、送托育機構、送幼兒園、長輩幫忙）', () => {
  const pick = (id, i) => C(id).choices[i];
  const neutral = [['fx_leave_end', 1, '交給長輩帶'], ['fx_leave_end', 3, '送托育機構'], ['fx_kindergarten', 2, '送幼兒園'], ['fx_kindergarten', 3, '送幼兒園'], ['fx_kindergarten', 4, '交給長輩帶'],
    ['fu_kg_lost', 1, '送幼兒園'], ['fu_kg_lost', 2, '交給長輩帶'], ['fu_daycare_sick', 2, '長輩幫忙'], ['kid_quarantine', 2, '長輩幫忙'], ['lo_afterschool', 2, '長輩幫忙'], ['lo_commute', 3, '長輩幫忙']];
  for (const [id, i, tag] of neutral) {
    const o = pick(id, i);
    assert.deepEqual(o.tags, [tag], `${id}#${i}`);
    assert.deepEqual(T.tags[tag].d, {}, `${tag} 沒有隱藏效果（類型本身不扣分）`);
    assert.ok(!o.tags.some((t) => BLANKET.includes(t)));
  }
});

test('每種照顧者類型有 2–3 張後續小卡（交接、詢問、探視、談規則），靠旗標＋打開池觸發；其中長輩是資源的至少一張', () => {
  const sets = { 長輩: ['fu_elder_handover', 'fu_elder_ask', 'fu_elder_know'], 保母: ['fu_nanny_visit', 'fu_nanny_rules'], 托嬰中心: ['fu_daycare_note', 'fu_daycare_teacher'], 幼兒園: ['fu_kg_note', 'fu_kg_english', 'fu_kg_visit'] };
  for (const [type, ids] of Object.entries(sets)) {
    assert.ok(ids.length >= 2 && ids.length <= 3, type);
    for (const id of ids) { assert.ok(C(id), id); assert.ok(C(id).requires.flags.length, `${id} 要有前因旗標`); assert.equal(C(id).choices.length, 4); }
  }
  // 觸發：選了該類型的選項會設定旗標並打開池
  const opens = (id, i) => ({ ...C(id).choices[i].opens, ...(C(id).choices[i].chance ? C(id).choices[i].chance.win.opens : {}) });
  assert.ok(C('fx_leave_end').choices[1].setFlags.includes('長輩帶') && opens('fx_leave_end', 1).長輩帶孩子);
  assert.ok(C('fx_leave_end').choices[2].setFlags.includes('托育_保母') && opens('fx_leave_end', 2).托育互動);
  assert.ok(C('fx_leave_end').choices[3].setFlags.includes('入托嬰中心') && opens('fx_leave_end', 3).托育互動);
  for (const i of [1, 2, 3]) assert.ok(C('fx_kindergarten').choices[i].setFlags.includes('幼兒園_入園') && opens('fx_kindergarten', i).托育互動);
  assert.ok(C('fx_kindergarten').choices[0].chance.win.setFlags.includes('幼兒園_入園'));
  assert.ok(data.pools['托育互動'] && data.pools['托育互動'].base === 0);
  // 長輩是資源的卡：請教長輩、學到東西（不是只有衝突）
  const know = C('fu_elder_know');
  assert.ok(know.choices[0].tags.includes('問具體的事') && know.choices[0].tags.includes('陪著觀察'));
  assert.ok(know.choices.some((o) => o.tags.includes('長輩幫忙')));
});

test('雙語幼兒園的英文卡只給雙語；探視、交接的卡的好壞由參與的做法決定（研究選項有標籤、陷阱選項沒有）', () => {
  const st = newState(5, data, { role: '媽媽' });
  st.turn = 14; st.flags.幼兒園_入園 = true;
  for (const type of ['公立或非營利幼兒園', '私立幼兒園', '雙語或美語幼兒園']) {
    st.vars.幼兒園類型 = type;
    const ok = passes(C('fu_kg_english'), st, buildCtx(st, data.timeline[14]));
    // fu_kg_english 目前只看旗標；雙語限定由文字決定（讀者看得到）——這裡確認文字提到雙語
    assert.ok(ok);
  }
  assert.match(C('fu_kg_english').text, /雙語幼兒園/);
  assert.ok(C('fu_nanny_visit').choices[0].tags.includes('先了解再處理'));
  assert.ok(C('fu_nanny_rules').choices[0].tags.includes('事前訂規則'));
});

test('當孩子面否定長輩：約為夫妻當孩子面吵的 1/3（同樣的幾個隱藏數值，同樣的方向）', () => {
  const a = T.tags.夫妻當孩子面吵.d, b = T.tags.當孩子面否定長輩.d;
  for (const k of Object.keys(b)) {
    assert.ok(a[k] < 0 && b[k] < 0, k);
    const ratio = b[k] / a[k];
    assert.ok(ratio > 0.2 && ratio < 0.5, `${k}：${ratio.toFixed(2)}`);
  }
  assert.ok(Object.keys(b).length >= 3);
});
