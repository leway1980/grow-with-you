// 選項的情境版本（labelIf／resultIf／tagsIf／effectsIf，規則 17／21）：引擎取代、lint 展開檢查、固定事件隨年級翻轉。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, loadRaw } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { stateRng } from '../js/engine/rng.js';
import { describeCard, applyChoice, buildCtx, choiceCtx, resolveChoice } from '../js/engine/events.js';
import { lintData } from '../tools/lint-data.mjs';
import { expandVariantCards } from '../tools/variants.mjs';
import { hiddenScore } from '../tools/metrics.mjs';

const data = loadData();
const tlOf = (grade) => data.timeline.find((t) => t.grade === grade && t.stage === (grade <= 2 ? '國小低' : '國小中高'));
const card = (id) => data.cardIndex[id];
const fresh = (grade) => { const st = newState(5, data, { role: '媽媽', startMode: 'elementary' }); const tl = tlOf(grade); st.turn = data.timeline.indexOf(tl); return { st, tl }; };

test('resolveChoice：第一個成立的版本取代該欄位，其他欄位不動；沒有版本的選項原樣回傳', () => {
  const ch = { label: 'A', result: 'r', tags: ['x'], effects: { 體力: -1 }, labelIf: [{ if: '年級 >= 5', value: 'B' }, { value: 'C' }], tagsIf: [{ if: '年級 >= 5', value: ['y'] }] };
  const { st, tl } = fresh(6), { st: st1, tl: tl1 } = fresh(1);
  const hi = resolveChoice(ch, buildCtx(st, tl)), lo = resolveChoice(ch, buildCtx(st1, tl1));
  assert.deepEqual([hi.label, hi.tags, hi.result], ['B', ['y'], 'r']);
  assert.deepEqual([lo.label, lo.tags], ['C', ['x']]); // 沒有 if 的版本一律成立
  const plain = { label: 'A', tags: ['x'] };
  assert.equal(resolveChoice(plain, buildCtx(st, tl)), plain);
});

test('引擎：顯示的文字、結果與套用的標籤都用同一個情境版本', () => {
  const c = card('fx_sports_day');
  const lowV = describeCard(c, fresh(1).st, data, fresh(1).tl), highV = describeCard(c, fresh(6).st, data, fresh(6).tl);
  const labelOf = (v, i) => v.choices.find((x) => x.i === i).label;
  assert.notEqual(labelOf(lowV, 0), labelOf(highV, 0));
  assert.match(labelOf(highV, 0), /跟同學自己比/);
  const { st, tl } = fresh(6);
  const out = applyChoice(st, data, c, 0, tl, stateRng(st, 'rngS'));
  assert.ok(out.entry.tags.includes('讓他試著自己做') && !out.entry.tags.includes('放下手機陪'));
  assert.equal(out.entry.label, labelOf(highV, 0));
  assert.match(out.result, /互相打氣/);
  const lo = fresh(1);
  const out2 = applyChoice(lo.st, data, c, 0, lo.tl, stateRng(lo.st, 'rngS'));
  assert.ok(out2.entry.tags.includes('放下手機陪'));
});

test('規則 17：年度固定事件沒有『永遠最好』的選項——低年級現場陪著最好、高年級放手讓他和同學去並事後問最好', () => {
  for (const id of ['fx_sports_day', 'fx_field_trip', 'fx_teacher_meet']) {
    const c = card(id), stg = c.stages;
    const best = (grade) => {
      const { st, tl } = fresh(grade);
      const hs = c.choices.map((raw) => hiddenScore(data.tags, resolveChoice(raw, choiceCtx(st, tl, c, raw)), stg));
      return hs.indexOf(Math.max(...hs));
    };
    const bests = new Set([2, 3, 4, 5, 6].map(best));
    assert.ok(bests.size >= 2, `${id}：各年級最好的選項都是同一個（${[...bests]}）`);
    assert.notEqual(best(2), best(6), id);
  }
});

test('lint：情境版本展開成虛擬卡，跟一般的卡跑同一套規則（這裡：版本標籤與 effects 方向矛盾、tagsIf 換掉有代價的標籤）', () => {
  const raw = structuredClone(loadRaw());
  const c = raw.events.cards.find((x) => x.id === 'fx_sports_day');
  assert.ok(expandVariantCards(raw.events.cards).some((v) => v._variantOf === 'fx_sports_day'));
  c.choices[0].effectsIf[0].value = { 體力: 4, 耐心: -1 };
  assert.match(lintData(raw).errors.join('\n'), /fx_sports_day~v1.*體力 \+4 和標籤的 now 矛盾/);
  const raw2 = structuredClone(loadRaw());
  raw2.events.cards.find((x) => x.id === 'fx_sports_day').choices[0].tagsIf[0].value = ['硬撐'];
  assert.match(lintData(raw2).errors.join('\n'), /tagsIf 不能改變有自帶代價的標籤/);
  const raw3 = structuredClone(loadRaw());
  raw3.events.cards.find((x) => x.id === 'fx_sports_day').choices[0].labelIf[0].if = '不存在的變數 > 1';
  assert.match(lintData(raw3).errors.join('\n'), /條件用到不存在的變數/);
});
