// M3 A3 管線：新存檔欄位、舊存檔補預設、route／habitPattern 掛鉤、外掛載入器的合併規則。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData } from '../tools/data-node.mjs';
import { newState, migrate } from '../js/engine/state.js';
import { buildCtx, applyChoice, setRouteResolver, setHabitHook } from '../js/engine/events.js';
import { deepMerge, loadTargets } from '../tools/plugins.mjs';

const data = loadData();
const tl = data.timeline[data.timeline.findIndex((t) => t.grade === 1)];

test('新存檔預先登記習慣與路線變數', () => {
  const st = newState(1, data, {});
  assert.deepEqual(st.habits, {});
  assert.deepEqual(st.autoLog, []);
  for (const k of ['學制', '國中類型', '去向', '中途離校', '實驗教育', '選組']) assert.equal(st.vars[k], '', k);
});

test('舊存檔（沒有 habits、autoLog、路線變數）由 migrate 補上，ctx 讀得到', () => {
  const st = newState(2, data, {});
  delete st.habits; delete st.autoLog; for (const k of ['學制', '國中類型', '去向', '中途離校', '實驗教育', '選組']) delete st.vars[k];
  migrate(st, data);
  assert.deepEqual(st.habits, {}); assert.deepEqual(st.autoLog, []);
  const ctx = buildCtx(st, tl);
  for (const k of ['學制', '國中類型', '去向', '中途離校', '實驗教育', '選組']) assert.equal(ctx[k], '', k);
});

test('ctx：變數優先，沒有才讀旗標；習慣_／習慣改變_ 由 st.habits 產生', () => {
  const st = newState(3, data, {});
  st.flags['學制_普高'] = true;
  assert.equal(buildCtx(st, tl).學制, '普高');
  st.vars.學制 = '技高';
  assert.equal(buildCtx(st, tl).學制, '技高');
  st.habits['回家第一句'] = { pattern: '先抱一下', shift: { n: 2 } };
  const c = buildCtx(st, tl);
  assert.equal(c.習慣_回家第一句, '先抱一下'); assert.equal(c.習慣改變_回家第一句, 2);
});

test('route／habitPattern 掛鉤：有登記才呼叫，選項沒寫就不呼叫', () => {
  const st = newState(4, data, {});
  const card = data.cardIndex[Object.keys(data.cardIndex).find((id) => !data.cardIndex[id].pool.startsWith('_') && data.cardIndex[id].stages?.includes('國小低'))];
  const seen = [];
  setRouteResolver((s, d, route) => seen.push(['route', route]));
  setHabitHook((s, d, hp) => seen.push(['habit', hp]));
  try {
    const r = () => 0.5;
    applyChoice(st, data, card, 0, tl, r);
    assert.deepEqual(seen, []);
    const c2 = { ...card, id: 'zz_probe', choices: card.choices.map((ch, i) => (i === 0 ? { ...ch, route: { decide: '學制' }, habitPattern: { family: 'f', pattern: 'p' } } : ch)) };
    applyChoice(st, data, c2, 0, tl, r);
    assert.deepEqual(seen, [['route', { decide: '學制' }], ['habit', { family: 'f', pattern: 'p' }]]);
  } finally { setRouteResolver(null); setHabitHook(null); }
});

test('外掛載入器：目標逐層合併；design-targets.json 的每個鍵都還在', () => {
  assert.deepEqual(deepMerge({ a: { b: 1, c: [1] }, d: 1 }, { a: { b: 2, c: [2] }, e: 3 }), { a: { b: 2, c: [2] }, d: 1, e: 3 });
  const base = JSON.parse(readFileSync(new URL('../tools/design-targets.json', import.meta.url), 'utf8'));
  const merged = loadTargets();
  for (const k of Object.keys(base)) assert.ok(k in merged, k);
});

test('A4：親子信任高／低門檻（低＝小於）；為孩子隱忍沒有隱藏效果、要孩子保密是負向、打手心短期順從長期傷', () => {
  const T = data.tags, st = newState(5, data, {});
  assert.ok(T.gates.親子信任.高 > T.gates.親子信任.低);
  st.hidden.親子信任 = T.gates.親子信任.低 - 0.1;
  let c = buildCtx(st, tl); assert.equal(c.親子信任低, true); assert.equal(c.親子信任高, false);
  st.hidden.親子信任 = T.gates.親子信任.低; c = buildCtx(st, tl); assert.equal(c.親子信任低, false);
  st.hidden.親子信任 = T.gates.親子信任.高; c = buildCtx(st, tl); assert.equal(c.親子信任高, true);
  assert.deepEqual(T.tags.為孩子隱忍.d, {});
  assert.ok(Object.values(T.tags.要孩子保密.d).every((v) => v < 0));
  const h = T.tags.打手心;
  assert.equal(h.now.作業, '+0'); assert.equal(h.now.心情, '-0');
  assert.ok(h.d.親子信任 < 0 && h.d.安全感 < 0 && h.d.試探度 > 0 && h.accel);
});
