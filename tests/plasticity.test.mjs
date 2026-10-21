// 階段可塑性（M3 B1，data/model.json 的 plasticity）：plasticityOf 的規則與 applyTags 的實際效果。
// 用合成的 byStage（不依賴正式資料裡調出來的數字），另外檢查正式資料的結構與 50 回合遊戲的邊界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRaw, loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { buildCtx } from '../js/engine/events.js';
import { applyTags } from '../js/engine/tags.js';
import { plasticityOf } from '../js/engine/model.js';

const BY = { 嬰幼兒: 1, 幼兒園: 1, 國小低: 0.9, 國小中高: 0.8, 國中: 0.6, 高中: 0.5, 離家: 0.4 };
const NODES = ['親子信任', '安全感', '內在穩定', '自我效能', '自理與責任', '閱讀習慣', '溫暖陪伴'];
const synth = { plasticity: { byStage: BY, nodes: NODES, exemptIfTagHasStageMap: true, negativeFloor: { nodes: ['親子信任', '安全感', '內在穩定'], min: 0.85 } } };

test('plasticityOf：不在 nodes 的節點是 1；正向取 byStage', () => {
  assert.equal(plasticityOf(synth, '國中', '主見', {}, 1), 1);
  assert.equal(plasticityOf(synth, '國中', '期待壓力', {}, 1), 1);
  assert.equal(plasticityOf(synth, '國中', '了解度', {}, -1), 1);
  assert.equal(plasticityOf(synth, '國中', '親子信任', {}, 1), 0.6);
  assert.equal(plasticityOf(synth, '離家', '自我效能', {}, 1), 0.4);
  assert.equal(plasticityOf(synth, '嬰幼兒', '親子信任', {}, 1), 1);
});

test('plasticityOf：負向在親子信任、安全感、內在穩定取 max(byStage, 0.85)；其他節點的負向照 byStage', () => {
  for (const k of ['親子信任', '安全感', '內在穩定']) {
    assert.equal(plasticityOf(synth, '國中', k, {}, -1), 0.85);
    assert.equal(plasticityOf(synth, '離家', k, {}, -1), 0.85);
    assert.equal(plasticityOf(synth, '嬰幼兒', k, {}, -1), 1); // 地板不會把 1 拉低
  }
  assert.equal(plasticityOf(synth, '國中', '溫暖陪伴', {}, -1), 0.6);
  assert.equal(plasticityOf(synth, '國中', '自我效能', {}, -1), 0.6);
});

test('plasticityOf：只有「標籤有 stage 表且當前階段在表中」才豁免；表裡沒有這個階段、或沒有 stage 表都照乘', () => {
  assert.equal(plasticityOf(synth, '國中', '親子信任', { stage: { 國中: 1.6 } }, 1), 1);
  assert.equal(plasticityOf(synth, '國中', '親子信任', { stage: { 國中: 1.6 } }, -1), 1);
  assert.equal(plasticityOf(synth, '國中', '親子信任', { stage: { 高中: 1.6 } }, 1), 0.6);
  assert.equal(plasticityOf(synth, '國中', '親子信任', { stage: {} }, 1), 0.6);
  assert.equal(plasticityOf(synth, '國中', '親子信任', undefined, 1), 0.6);
});

test('plasticityOf：沒有 plasticity 區塊（舊資料）→ 1', () => {
  assert.equal(plasticityOf({}, '國中', '親子信任', {}, 1), 1);
  assert.equal(plasticityOf(undefined, '國中', '親子信任', {}, -1), 1);
});

/* ───── applyTags：同一組標籤、同一個狀態，只換階段 ───── */
const raw = loadRaw(); raw.model.plasticity = structuredClone(synth.plasticity);
const SYNTH = raw.model.plasticity;
const data = loadData(raw), T = data.tags;
const ones = structuredClone(SYNTH); for (const k of Object.keys(ones.byStage)) ones.byStage[k] = 1;
T.tags['_可塑性測試_無表'] = { desc: '合成', d: { 親子信任: 2, 自我效能: 2, 主見: 2, 了解度: 2, 期待壓力: 1 } };
T.tags['_可塑性測試_負向'] = { desc: '合成', d: { 親子信任: -2, 安全感: -2, 內在穩定: -2, 溫暖陪伴: -2, 自理與責任: -2, 期待壓力: 1 } };
T.tags['_可塑性測試_有表'] = { desc: '合成', d: { 親子信任: 2, 自我效能: 2 }, stage: { 國中: 1.5 } };

/** 同一個起點（所有隱藏數值 50，其中飽和對正負都是 ×1）下，在 stage 套用 tags，回傳每個節點的變化量 */
function run(tags, stage, plasticity) {
  T.model.plasticity = plasticity;
  try {
    const st = newState(7, data, { role: '媽媽' }); st.turn = 30;
    for (const k of Object.keys(st.hidden)) if (!T.derived.includes(k)) st.hidden[k] = 50;
    const ctx = buildCtx(st, data.timeline[30], {});
    return applyTags(st, tags, T, { turn: 30, stage, ctx, months: 120, scale: 1 }).deltas;
  } finally { T.model.plasticity = SYNTH; }
}

test('applyTags：同一組正向標籤在國小低 vs 國中，孩子端節點的比值恰好是 byStage 的比值；排除的節點不變', () => {
  const lo = run(['_可塑性測試_無表'], '國小低', SYNTH), hi = run(['_可塑性測試_無表'], '國中', SYNTH);
  for (const k of ['親子信任', '自我效能']) assert.ok(Math.abs(hi[k] / lo[k] - BY.國中 / BY.國小低) < 1e-9, `${k}: ${hi[k] / lo[k]}`);
  for (const k of ['主見', '了解度', '期待壓力']) assert.ok(Math.abs(hi[k] - lo[k]) < 1e-12, `${k} 應該不受影響`);
});

test('applyTags：與「全部 1」相比，國中的正向是 ×0.6，負向的親子信任、安全感、內在穩定是 ×0.85，其他孩子端負向是 ×0.6', () => {
  const a = run(['_可塑性測試_無表'], '國中', SYNTH), b = run(['_可塑性測試_無表'], '國中', ones);
  assert.ok(Math.abs(a.親子信任 / b.親子信任 - 0.6) < 1e-9);
  const n = run(['_可塑性測試_負向'], '國中', SYNTH), m = run(['_可塑性測試_負向'], '國中', ones);
  for (const k of ['親子信任', '安全感', '內在穩定']) assert.ok(Math.abs(n[k] / m[k] - 0.85) < 1e-9, `${k}: ${n[k] / m[k]}`);
  for (const k of ['溫暖陪伴', '自理與責任']) assert.ok(Math.abs(n[k] / m[k] - 0.6) < 1e-9, `${k}: ${n[k] / m[k]}`);
  assert.ok(Math.abs(n.期待壓力 - m.期待壓力) < 1e-12);
});

test('applyTags：標籤有自己的 stage 表且當前階段在表中 → 不再乘可塑性（只有它自己的 stage 倍率）；階段不在表中 → 照乘', () => {
  const a = run(['_可塑性測試_有表'], '國中', SYNTH), b = run(['_可塑性測試_有表'], '國中', ones);
  assert.ok(Math.abs(a.親子信任 - b.親子信任) < 1e-12 && Math.abs(a.自我效能 - b.自我效能) < 1e-12);
  const c = run(['_可塑性測試_有表'], '高中', SYNTH), d = run(['_可塑性測試_有表'], '高中', ones);
  assert.ok(Math.abs(c.親子信任 / d.親子信任 - BY.高中) < 1e-9);
});

/* ───── 正式資料：檢查結構與 E1 審查定下的值（高中、離家 0.7；單步擺幅另有強制目標 tools/targets/plasticity.json stepSwing）；機制由上面的合成數值測試 ───── */
test('正式資料：七個孩子端節點、不含排除的節點；byStage 涵蓋每個階段、在 (0, 1]、嬰幼兒與幼兒園是 1、越大越小或持平；沒有錨點', () => {
  const R = loadRaw(), P = R.model.plasticity, stages = R.tags.stages;
  assert.deepEqual([...P.nodes].sort(), [...NODES].sort());
  for (const k of ['主見', '替他做主', '期待壓力', '試探度', '了解度', '規則一致性', '父母示範']) assert.ok(!P.nodes.includes(k), `${k} 不該在 nodes`);
  assert.deepEqual(Object.keys(P.byStage), stages);
  for (const s of stages) assert.ok(P.byStage[s] > 0 && P.byStage[s] <= 1, `${s}: ${P.byStage[s]}`);
  assert.equal(P.byStage.嬰幼兒, 1); assert.equal(P.byStage.幼兒園, 1);
  assert.equal(P.byStage.高中, 0.7); // E1 審查：高中每一次決定對親子關係隱藏值的單次影響比小時候小（DESIGN §6）
  stages.forEach((s, i) => { if (i) assert.ok(P.byStage[s] <= P.byStage[stages[i - 1]], `${s} 不該比前一階段大`); });
  assert.equal(P.exemptIfTagHasStageMap, true);
  assert.deepEqual([...P.negativeFloor.nodes].sort(), ['內在穩定', '安全感', '親子信任']);
  assert.equal(P.negativeFloor.min, 0.85);
  assert.equal(P.anchor, undefined); // v1 不設錨點（計畫 §8 第 4 項）
  for (const k of P.nodes) assert.ok(k in R.tags.hidden, `${k} 要是隱藏數值`);
});
