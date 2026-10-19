import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, loadRaw, ROOT } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { applyChoice, buildCtx, applyEffects } from '../js/engine/events.js';
import { applyTags, stageMult, modifierFactor } from '../js/engine/tags.js';
import { stateRng } from '../js/engine/rng.js';

const data = loadData();
const fresh = (seed = 5) => newState(seed, data, { role: '媽媽' });
// 造一張只有一個選項的測試卡，放進 cardIndex
function testCard(id, choice, extra = {}) {
  const card = { id, pool: '日常_國小中高', title: '測試', text: '測試', choices: [choice, { label: 'x', effects: { 心情: 1 }, tags: ['不轉述消息'], result: '' }], ...extra };
  data.cardIndex[id] = card;
  return card;
}
const tlAt = (turn) => data.timeline[turn];

test('隱藏數值只能經由標籤改變：沒有標籤、只有可見效果 → 隱藏數值完全不動', () => {
  const st = fresh(); st.turn = 30;
  const card = testCard('t_plain', { label: 'a', effects: { 心情: 5, 體力: -3 }, tags: [], result: '' });
  const before = structuredClone(st.hidden);
  const out = applyChoice(st, data, card, 0, tlAt(30), stateRng(st, 'rngS'));
  assert.deepEqual(st.hidden, before);
  assert.equal(out.dose.child.length, 1);
});

test('寫進 effects 的隱藏數值會被拒絕（可見數值才收）', () => {
  const st = fresh();
  assert.throws(() => applyEffects(st, { 主見: 5 }), /隱藏數值只能經由 tags/);
});

test('標籤的換算：結果＝對照表 × 階段倍率 × 情境倍率（第一次沒有重複加速）', () => {
  const st = fresh(); st.turn = 30;
  const tl = tlAt(30);
  const ctx = buildCtx(st, tl, {});
  const def = data.tags.tags['替他決定'];
  const before = st.hidden.主見;
  applyTags(st, ['替他決定'], data.tags, { turn: 30, stage: tl.stage, ctx });
  const expect = def.d.主見 * stageMult(def, tl.stage) * modifierFactor(data.tags, '替他決定', ctx);
  assert.ok(Math.abs(st.hidden.主見 - (before + expect)) < 1e-9, `${st.hidden.主見} vs ${before + expect}`);
  assert.ok(expect < 0);
});

test('階段倍率：同一個標籤，國小一年級的影響比國中小', () => {
  const def = data.tags.tags['替他決定'];
  assert.ok(stageMult(def, '國小低') < stageMult(def, '國小中高'));
  assert.ok(stageMult(def, '國小中高') < stageMult(def, '國中'));
  assert.equal(stageMult(def, '嬰幼兒'), 0);
});

test('重複加速：同一個標籤在視窗內反覆出現，影響越來越大', () => {
  const st = fresh(); st.turn = 30;
  const deltas = [];
  for (let i = 0; i < 4; i++) {
    const turn = 30 + i, tl = tlAt(turn), ctx = buildCtx(st, tl, {});
    const { deltas: d } = applyTags(st, ['替他決定'], data.tags, { turn, stage: tl.stage, ctx });
    st.hist.push({ turn, tags: ['替他決定'] });
    deltas.push(d.主見);
  }
  assert.ok(deltas[1] < deltas[0] && deltas[2] < deltas[1] && deltas[3] < deltas[2], JSON.stringify(deltas)); // 負值越來越負
  // 隔得夠久就不加速
  const st2 = fresh(); st2.turn = 30;
  st2.hist.push({ turn: 20, tags: ['替他決定'] });
  const tl = tlAt(30), ctx = buildCtx(st2, tl, {});
  const { deltas: d2 } = applyTags(st2, ['替他決定'], data.tags, { turn: 30, stage: tl.stage, ctx });
  assert.ok(Math.abs(d2.主見 - deltas[0]) < 1e-9);
});

test('方向加速（§3.3）：同一個方向一直被提到，越來越快；順口比特地小但不是零', () => {
  const run = (tag) => {
    const st = fresh(); st.turn = 30; const out = [];
    for (let i = 0; i < 6; i++) {
      const turn = 30 + i * 8, tl = tlAt(Math.min(turn, 55)), ctx = buildCtx(st, tl, {}); // 隔很遠，排除一般的重複視窗
      out.push(applyTags(st, [tag], data.tags, { turn, stage: tl.stage, ctx, direction: '升學競爭' }).deltas.期待壓力);
    }
    return out;
  };
  const casual = run('轉述消息_順口'), purposeful = run('轉述消息_特地');
  assert.ok(casual[5] > casual[0] * 1.5, JSON.stringify(casual));
  assert.ok(casual[0] > 0 && casual[0] < purposeful[0]);
  // 二十次順口 ≈ 好幾次特地
  const st = fresh(); st.turn = 30; let sum = 0;
  for (let i = 0; i < 20; i++) sum += applyTags(st, ['轉述消息_順口'], data.tags, { turn: 30 + i * 8, stage: '國小中高', ctx: buildCtx(st, tlAt(30), {}), direction: 'a' }).deltas.期待壓力;
  assert.ok(sum > purposeful[0] * 4);
});

test('情境倍率：孩子很想要時，替他決定的影響放大；敏感的孩子對責罵更有感', () => {
  const st = fresh(); st.turn = 30;
  const tl = tlAt(30);
  const lo = buildCtx(st, tl, {}); lo.意願強度 = 0;
  const hi = { ...lo, 意願強度: 2 };
  assert.ok(modifierFactor(data.tags, '替他決定', hi) > modifierFactor(data.tags, '替他決定', lo));
  assert.ok(modifierFactor(data.tags, '罵一頓', { ...lo, 孩子敏感度: 5 }) > modifierFactor(data.tags, '罵一頓', { ...lo, 孩子敏感度: 3 }));
});

test('承受度是推算值：標籤表不能直接改它，隱藏數值的寫入只出現在 tags.js 與 state.js', () => {
  const T = loadRaw().tags;
  for (const [n, d] of Object.entries(T.tags)) for (const k of Object.keys(d.d || {})) assert.ok(!T.derived.includes(k), `${n} → ${k}`);
  const dir = join(ROOT, 'js');
  const files = [...readdirSync(join(dir, 'engine')).map((f) => join(dir, 'engine', f)), join(dir, 'main.js'), join(dir, 'ui.js')];
  for (const f of files) {
    if (/tags\.js$|state\.js$/.test(f)) continue;
    const src = readFileSync(f, 'utf8');
    assert.ok(!/\.hidden\[[^\]]+\]\s*[-+*/]?=[^=]/.test(src), `${f} 不應寫入 hidden`);
    assert.ok(!/\.hidden\.[^\s=]+\s*[-+*/]?=[^=]/.test(src), `${f} 不應寫入 hidden`);
  }
});

test('選項的 hidden 欄位會被 lint 擋下（資料層保證）', async () => {
  const { lintData } = await import('../tools/lint-data.mjs');
  const raw = loadRaw();
  raw.events.cards[3].choices[0].hidden = { 主見: 5 };
  const { errors } = lintData(raw);
  assert.ok(errors.some((e) => /不能有 hidden/.test(e)));
});
