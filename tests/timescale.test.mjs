// 時間尺度（A2.5）：回合不再是固定長度，所有『每回合』的量都換成『每月』。
// 不變量：同一個策略，每個月的教養效果一樣（一張卡代表那段時間裡反覆出現的同類時刻）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRaw, loadData } from '../tools/data-node.mjs';
import { prepareData, playToEnd } from '../js/engine/turn.js';
import { newState } from '../js/engine/state.js';
import { REF_MONTHS, monthlyFromRef, perSpan, refRate, doseScale, scaleEffects, turnAtOrAfter } from '../js/engine/timescale.js';
import { guardHidden } from './helpers.mjs';

const data = loadData();

test('比率換算：1−(1−r)^月數 可以任意切分；舊的 2 個月回合的值完全不變', () => {
  for (const r of [0.01, 0.03, 0.1, 0.35]) {
    const m = monthlyFromRef(r);
    assert.ok(Math.abs(perSpan(m, REF_MONTHS) - r) < 1e-12, `r=${r}`);
    assert.ok(Math.abs(refRate(r, 2) - r) < 1e-12);
    // 走 6 次 1 個月＝走 1 次 6 個月＝走 3 次 2 個月
    const six = 1 - Math.pow(1 - perSpan(m, 1), 6), once = perSpan(m, 6), three = 1 - Math.pow(1 - r, 3);
    assert.ok(Math.abs(six - once) < 1e-12 && Math.abs(three - once) < 1e-12);
  }
  assert.equal(REF_MONTHS, 2);
});

test('劑量倍率：(月數/2)^α；國小舊的 2 個月回合不變；card.scale===false 的一次性事件不放大；α＝0 全部不變', () => {
  assert.equal(doseScale(0.5, 2, {}), 1);
  assert.ok(Math.abs(doseScale(0.5, 3, {}) - Math.sqrt(1.5)) < 1e-12);
  assert.ok(Math.abs(doseScale(1, 6, {}) - 3) < 1e-12);
  assert.equal(doseScale(1, 6, { scale: false }), 1);
  assert.equal(doseScale(0, 6, {}), 1);
  assert.deepEqual(scaleEffects({ 體力: -4, 心情: 2 }, 1.5), { 體力: -6, 心情: 3 });
  assert.equal(scaleEffects(undefined, 2), undefined);
  assert.equal(turnAtOrAfter([0, 3, 6, 9], 4), 2); assert.equal(turnAtOrAfter([0, 3, 6, 9], 9), 3); assert.equal(turnAtOrAfter([0, 3], 5), 2);
});

test('時間軸：每個回合有 span（到下一回合的月數），最後一個沿用前一個；ages 不進 JSON', () => {
  const tl = data.timeline;
  tl.forEach((t, i) => { if (i < tl.length - 1) assert.equal(t.span, tl[i + 1].ageMonths - t.ageMonths); });
  assert.equal(tl.at(-1).span, tl.at(-2).span);
  assert.ok(tl.every((t) => t.span >= 1 && t.span <= 7)); // 高中每年 2 回合（5–7 個月）、離家逐月（1 個月）；可玩範圍內是 2–3 個月
  assert.ok(!('ages' in JSON.parse(JSON.stringify(tl[0]))));
  assert.deepEqual([...new Set(tl.filter((t) => t.stage === "嬰幼兒" || t.stage === "幼兒園").map((t) => t.span))], [3]);
  assert.deepEqual([...new Set(tl.filter((t) => t.stage === '國小中高').map((t) => t.span))], [3]);
});

test('固定事件（一次性）不隨回合長度放大：_fixed 池的卡都有 scale:false；一般卡依 span 放大', () => {
  for (const c of data.events.cards) if (c.pool.startsWith('_')) assert.equal(c.scale, false, c.id);
  const α = data.model.timeScale.alpha;
  assert.equal(doseScale(α, 3, data.cardIndex.fx_sports_day), 1);
  assert.ok(Math.abs(doseScale(α, 3, data.cardIndex.lo_hw) - Math.pow(1.5, α)) < 1e-12);
});

test('嬰幼兒的『回合 >= 3』換成『月齡 >= 9』是等價的（嬰幼兒每回合 3 個月）', () => {
  const infant = data.timeline.filter((t) => t.stage === '嬰幼兒');
  for (const t of infant) assert.equal(t.turn >= 3, t.ageMonths >= 9, `回合 ${t.turn}`);
  for (const id of ['inf_phone_out', 'inf_bedtime', 'inf_pet']) assert.match(data.cardIndex[id].requires.expr, /月齡 >= 9/);
  assert.ok(!JSON.stringify(data.events.cards).includes('回合 >= 3'));
});

/* ───── 合成日曆：同一個策略，每月 1 回合 vs 每 6 個月 1 回合，走同一段年齡，隱藏數值要一樣 ───── */
const LABEL = { warmFirm: 0, permissive: 1, doNothing: 2 };
function synthetic(step, alpha) {
  const raw = loadRaw();
  const n = 48 / step;
  raw.calendar = { ...raw.calendar, stages: [{ id: '國小中高', turns: n, startMonths: 96, stepMonths: step }], totalTurns: n, playableTurns: n, fixed: [], schoolFixed: [] };
  raw.model.timeScale.alpha = alpha;
  raw.pools = { ...raw.pools, loads: [] }; // 隨機的情境負荷另外測
  raw.events = { ...raw.events, cards: [{
    id: 'syn_card', pool: '日常_國小中高', stages: ['國小中高'], title: '合成卡', text: '合成卡（時間尺度測試用）。', weight: 1, once: false,
    choices: [
      { label: '溫暖＋堅定', effects: { 耐心: -3, 體力: -2, 心情: 2 }, tags: ['放下手機陪', '事前訂規則', '說到做到'], result: '。' },
      { label: '放任', effects: { 耐心: 1, 心情: 3, '3C時間': 2 }, tags: ['說沒關係就結束', '規則不一致'], result: '。' },
      { label: '什麼都不做', effects: {}, tags: [], result: '。' },
    ],
  }] };
  return prepareData(raw);
}
const finalOf = (d, policy) => {
  const st = guardHidden(newState(11, d, { role: '媽媽', startMode: 'birth' }));
  st.turn = 0;
  const pol = { choose: (s, view) => view.choices.find((c) => c.i === LABEL[policy]).i };
  playToEnd(st, d, pol);
  return st;
};
const maxDiff = (a, b) => Math.max(...Object.keys(a.hidden).map((k) => Math.abs(a.hidden[k] - b.hidden[k])));

test('合成日曆：什麼都不做（只有自然回復與漂移）— 每月 1 回合與每 6 個月 1 回合，隱藏數值一樣（任何 α）', () => {
  for (const alpha of [0, 0.5, 1]) {
    const d1 = synthetic(1, alpha), d6 = synthetic(6, alpha);
    const a = finalOf(d1, 'doNothing'), b = finalOf(d6, 'doNothing');
    assert.ok(maxDiff(a, b) <= 2, `α=${alpha}：差 ${maxDiff(a, b).toFixed(2)}`);
  }
});

test('合成日曆（α＝1）：溫暖＋堅定、放任、什麼都不做 — 每月 1 回合與每 6 個月 1 回合，走同一段年齡，最終隱藏數值差 ≤ 2', () => {
  const d1 = synthetic(1, 1), d6 = synthetic(6, 1);
  assert.equal(d1.timeline.length, 48); assert.equal(d6.timeline.length, 8);
  assert.equal(d1.timeline.at(-1).ageMonths, 96 + 47); assert.equal(d6.timeline.at(-1).ageMonths, 96 + 42);
  for (const policy of Object.keys(LABEL)) {
    const a = finalOf(d1, policy), b = finalOf(d6, policy);
    assert.ok(maxDiff(a, b) <= 2, `${policy}：差 ${maxDiff(a, b).toFixed(2)}（${Object.keys(a.hidden).filter((k) => Math.abs(a.hidden[k] - b.hidden[k]) > 1).map((k) => `${k} ${a.hidden[k].toFixed(1)} vs ${b.hidden[k].toFixed(1)}`).join('、')}）`);
  }
});

test('合成日曆：策略真的有作用（放任與溫暖堅定的隱藏數值差得遠，不是兩邊都沒動）', () => {
  const d = synthetic(2, 1);
  const w = finalOf(d, 'warmFirm'), p = finalOf(d, 'permissive');
  assert.ok(w.hidden.溫暖陪伴 - p.hidden.溫暖陪伴 > 3 || w.hidden.規則一致性 - p.hidden.規則一致性 > 3);
});
