import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, loadRaw } from '../tools/data-node.mjs';
import { newState, serialize, deserialize, migrate } from '../js/engine/state.js';
import { buildCtx, applyChoice, applyEffects, resolveDirection, cardScope, describeCard } from '../js/engine/events.js';
import { applyTags, stageMult, modifierFactor, saturate, driftHidden, repetitionMult, hiddenWriteAllowed } from '../js/engine/tags.js';
import { stateRng } from '../js/engine/rng.js';

const data = loadData();
const T = data.tags;
const fresh = (seed = 5) => newState(seed, data, { role: '媽媽' });
const tlAt = (turn) => data.timeline[turn];
const apply = (st, tags, turn, extra = {}) => { const tl = tlAt(Math.min(turn, data.calendar.playableTurns - 1)); return applyTags(st, tags, T, { turn, stage: tl.stage, ctx: buildCtx(st, tl, {}), ...extra }); };
// 把「飽和」與「增益」排除，直接算對照表的預期值
const expected = (def, k, st, tl, ctx, tag, mult = 1) => saturate(st.hidden[k], def.d[k] * (T.gain ?? 1) * (st.family?.child.responsive ?? 1) * stageMult(def, tl.stage) * modifierFactor(T, tag, ctx) * mult);

test('隱藏數值只能經由標籤改變：沒有標籤、只有可見效果 → 隱藏數值完全不動', () => {
  const st = fresh(); st.turn = 30;
  const card = { id: 't_plain', pool: '日常_國小中高', title: 't', text: 't', choices: [{ label: 'a', effects: { 心情: 5, 體力: -3 }, tags: [], result: '' }, { label: 'x', effects: { 心情: 1 }, tags: ['不轉述消息'], result: '' }] };
  data.cardIndex[card.id] = card;
  const before = structuredClone(st.hidden);
  const out = applyChoice(st, data, card, 0, tlAt(30), stateRng(st, 'rngS'));
  assert.deepEqual(st.hidden, before);
  assert.equal(out.acc.心情, 5);
});

test('寫進 effects 的隱藏數值會被拒絕（可見數值才收）', () => {
  assert.throws(() => applyEffects(fresh(), { 主見: 5 }), /隱藏數值只能經由 tags/);
});

test('標籤的換算：結果＝對照表 × 增益 × 階段倍率 × 情境倍率，再經過飽和', () => {
  const st = fresh(); st.turn = 30;
  const tl = tlAt(30), ctx = buildCtx(st, tl, {});
  const def = T.tags['替他決定'];
  const before = st.hidden.主見;
  apply(st, ['替他決定'], 30);
  const exp = expected(def, '主見', { hidden: { 主見: before }, family: st.family }, tl, ctx, '替他決定');
  assert.ok(Math.abs(st.hidden.主見 - (before + exp)) < 1e-9, `${st.hidden.主見} vs ${before + exp}`);
  assert.ok(exp < 0);
});

test('階段倍率：同一個標籤，國小一年級的影響比國中小；嬰幼兒是 0', () => {
  const def = T.tags['替他決定'];
  assert.ok(stageMult(def, '國小低') < stageMult(def, '國小中高'));
  assert.ok(stageMult(def, '國小中高') < stageMult(def, '國中'));
  assert.equal(stageMult(def, '嬰幼兒'), 0);
});

test('飽和：越接近 100 越難往上，越接近 0 越難往下；50 附近不變', () => {
  assert.equal(saturate(50, 2), 2); assert.equal(saturate(50, -2), -2);
  assert.ok(saturate(90, 2) < 0.5 && saturate(90, 2) > 0);
  assert.ok(saturate(10, -2) > -0.5 && saturate(10, -2) < 0);
  assert.ok(Math.abs(saturate(100, 5)) < 1e-12 && Math.abs(saturate(0, -5)) < 1e-12);
  // 實際反覆推同一個數值也到不了 100
  const st = fresh(); st.turn = 30;
  for (let i = 0; i < 400; i++) apply(st, ['放下手機陪'], 30 + i * 10);
  assert.ok(st.hidden.溫暖陪伴 < 100 && st.hidden.溫暖陪伴 > 90, String(st.hidden.溫暖陪伴));
});

test('重複加速是逐標籤開啟的（accel）：替他決定越來越快；沒開的（給他選）每次一樣', () => {
  const run = (tag, k) => {
    const st = fresh(); st.turn = 30; const out = [];
    for (let i = 0; i < 4; i++) {
      const turn = 30 + i, before = st.hidden[k];
      apply(st, [tag], turn, { stage: '國小中高' }); st.hist.push({ turn, m: tlAt(turn).ageMonths, tags: [tag] });
      const d = st.hidden[k] - before;
      out.push(d / saturate(before, Math.sign(d))); // 去掉飽和的影響
    }
    return out;
  };
  const harm = run('替他決定', '主見'), good = run('給他選', '主見');
  assert.ok(harm[1] > harm[0] && harm[2] > harm[1] && harm[3] > harm[2], JSON.stringify(harm)); // 扣掉飽和之後，影響一次比一次大
  for (let i = 1; i < 4; i++) assert.ok(Math.abs(good[i] - good[0]) < 1e-9, JSON.stringify(good));
  assert.equal(T.tags['給他選'].accel, undefined);
  assert.equal(T.tags['替他決定'].accel, true);
  // 隔得夠久就不加速
  const st = fresh(); st.turn = 30; st.hist.push({ turn: 20, m: tlAt(20).ageMonths, tags: ['替他決定'] });
  assert.equal(repetitionMult(st, '替他決定', tlAt(30).ageMonths, T), 1); // 窗口以月計（windowMonths 12）：隔 30 個月就不加速
  st.hist.push({ turn: 29, m: tlAt(29).ageMonths, tags: ['替他決定'] });
  assert.ok(repetitionMult(st, '替他決定', tlAt(30).ageMonths, T) > 1);
});

test('方向加速（§3.3）：只放大壓力那一側（期待壓力↑、主見↓）；問他想法不放大；順口比特地小但不是零', () => {
  const run = (tag, k) => {
    const st = fresh(); st.turn = 30; const out = [];
    for (let i = 0; i < 6; i++) {
      const turn = 30 + i * 8, before = st.hidden[k];
      const { deltas } = apply(st, [tag], turn, { direction: '科學', stage: '國小中高' });
      out.push(deltas[k] / saturate(before, Math.sign(deltas[k])));
    }
    return out;
  };
  const casual = run('轉述消息_順口', '期待壓力'), purposeful = run('轉述消息_特地', '期待壓力');
  assert.ok(casual[5] > casual[0] * 1.3, JSON.stringify(casual));
  assert.ok(casual[0] > 0 && casual[0] < purposeful[0]);
  // 問他想法：同樣記方向，但自己的數值完全不被放大
  const ask = run('轉述消息_問他想法', '期待壓力');
  for (let i = 1; i < ask.length; i++) assert.ok(Math.abs(ask[i] - ask[0]) < 1e-9, JSON.stringify(ask));
  // 不在 dirAccel 的那一側（替他做主）不被方向放大
  const st = fresh(); st.turn = 30; st.dirCount.科學 = 8;
  const b = st.hidden.替他做主;
  const { deltas } = apply(st, ['轉述消息_特地'], 30, { direction: '科學' });
  const base = T.tags['轉述消息_特地'].d.替他做主 * T.gain * st.family.child.responsive * modifierFactor(T, '轉述消息_特地', buildCtx(st, tlAt(30), {})) * 1.0 * repetitionMult(st, '轉述消息_特地', 30, T);
  assert.ok(Math.abs(deltas.替他做主 - saturate(b, base)) < 1e-9);
});

test('方向計數會隨時間衰減；不同方向分開計', () => {
  const st = fresh(); st.turn = 30;
  apply(st, ['轉述消息_特地'], 30, { direction: '科學' });
  apply(st, ['轉述消息_特地'], 31, { direction: '運動' });
  const a = st.dirCount.科學;
  assert.ok(a > 0 && st.dirCount.運動 > 0);
  for (let i = 0; i < 30; i++) driftHidden(st, T);
  assert.ok(st.dirCount.科學 < a * 0.5, `${st.dirCount.科學} vs ${a}`);
});

test('方向可以來自槽值（營隊→科學）或卡片；寫 @槽名 時取這張卡抽到的值', () => {
  const st = fresh(); st.turn = 25;
  const card = data.cardIndex.lo_news;
  const scope = cardScope(st, card.id);
  scope['#dir:營隊'] = '科學';
  assert.equal(resolveDirection(card, card.choices[1], scope), '科學');
  assert.equal(resolveDirection({ direction: '成績' }, {}, {}), '成績');
  assert.equal(resolveDirection({ direction: '成績' }, { direction: '@營隊' }, {}), '_');
  // 整張 lo_news 實際抽槽：不同種子抽到不同營隊，方向跟著槽值變（科學營→科學、運動營→運動）
  const camps = loadRaw().slots.slots.營隊;
  const seen = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    const s = newState(seed, data, {}); s.turn = 22;
    const view = describeCard(card, s, data, tlAt(22));
    const label = view.choices.find((c) => c.i === 1).label;
    const camp = camps.find((c) => label.includes(c.t));
    assert.ok(camp, label);
    assert.equal(resolveDirection(card, card.choices[1], cardScope(s, card.id)), camp.dir);
    seen.add(camp.dir);
  }
  assert.ok(seen.size >= 3, [...seen].join());
});

test('情境倍率：孩子很想要時，替他決定的影響放大；敏感的孩子對責罵更有感', () => {
  const st = fresh(); st.turn = 30;
  const lo = buildCtx(st, tlAt(30), {}); lo.意願強度 = 0;
  const hi = { ...lo, 意願強度: 2 };
  assert.ok(modifierFactor(T, '替他決定', hi) > modifierFactor(T, '替他決定', lo));
  assert.ok(modifierFactor(T, '罵一頓', { ...lo, 孩子敏感度: 5 }) > modifierFactor(T, '罵一頓', { ...lo, 孩子敏感度: 3 }));
});

test('自然漂移：了解度不維持就慢慢掉到 40、溫暖陪伴掉到 45（安靜的回合也一樣）', () => {
  const st = fresh();
  st.hidden.了解度 = 80; st.hidden.溫暖陪伴 = 90;
  for (let i = 0; i < 10; i++) driftHidden(st, T, { span: 2 }); // 2 個月的回合＝舊的國小回合：每回合 0.03／0.02（資料存的是每月值，1−(1−r)^2）
  assert.ok(Math.abs(st.hidden.了解度 - (40 + 40 * Math.pow(1 - 0.03, 10))) < 1e-3); // 資料存的每月值只有 6 位小數
  assert.ok(Math.abs(st.hidden.溫暖陪伴 - (45 + 45 * Math.pow(1 - 0.02, 10))) < 1e-3);
  assert.equal(T.drift.to.了解度.to, 40); assert.ok(Math.abs(1 - Math.pow(1 - T.drift.to.了解度.rateMonth, 2) - 0.03) < 1e-5);
  assert.equal(T.drift.to.溫暖陪伴.to, 45); assert.ok(Math.abs(1 - Math.pow(1 - T.drift.to.溫暖陪伴.rateMonth, 2) - 0.02) < 1e-5);
  // 以月計：走 6 個 1 個月的回合，和走 1 個 6 個月的回合，回復的量一樣（1−(1−r)^月數）
  const a = fresh(), b = fresh(); a.hidden.了解度 = b.hidden.了解度 = 80;
  for (let i = 0; i < 6; i++) driftHidden(a, T, { span: 1 });
  driftHidden(b, T, { span: 6 });
  assert.ok(Math.abs(a.hidden.了解度 - b.hidden.了解度) < 1e-9);
});

test('規則式漂移：耐心連續低於 30 滿 4 個月 → 父母情緒穩定度每月 −0.25（2 個月的回合＝連續兩回合、每回合 −0.5）；只低一個回合不扣', () => {
  const st = fresh();
  // 把其他的自然漂移排除，只看規則
  const T2 = structuredClone(T); T2.drift.to = {};
  st.parent.耐心 = 20; st.vcurves.push({ 耐心: 50, m: 0 });
  const h0 = st.hidden.父母情緒穩定度;
  driftHidden(st, T2, { span: 2, months: 2 });
  assert.equal(st.hidden.父母情緒穩定度, h0); // 上一回合不低（只低了 2 個月）→ 不扣
  st.vcurves.push({ 耐心: 20, m: 2 });
  driftHidden(st, T2, { span: 2, months: 4 });
  assert.ok(Math.abs(st.hidden.父母情緒穩定度 - (h0 - 0.5)) < 1e-12);
  st.parent.耐心 = 31;
  driftHidden(st, T2, { span: 2, months: 6 });
  assert.ok(Math.abs(st.hidden.父母情緒穩定度 - (h0 - 0.5)) < 1e-12);
  // 以月計：6 個月的回合只要低一個回合就滿 4 個月，扣 0.25×6；1 個月的回合要連續 4 個回合才扣，每回合 −0.25
  const s6 = fresh(); s6.parent.耐心 = 20; s6.vcurves.push({ 耐心: 50, m: 0 });
  driftHidden(s6, T2, { span: 6, months: 6 });
  assert.ok(Math.abs(s6.hidden.父母情緒穩定度 - (h0 - 1.5)) < 1e-12);
  const s1 = fresh(); s1.parent.耐心 = 20; const drops = [];
  for (let k = 0; k < 6; k++) { const before = s1.hidden.父母情緒穩定度; driftHidden(s1, T2, { span: 1, months: k + 1 }); drops.push(+(before - s1.hidden.父母情緒穩定度).toFixed(6)); s1.vcurves.push({ 耐心: 20, m: k + 1 }); }
  assert.deepEqual(drops, [0, 0, 0, 0.25, 0.25, 0.25]);
});

test('只有 tags.js 的寫入口能改隱藏數值（hiddenWriteAllowed 只在寫入口內為真）', () => {
  assert.equal(hiddenWriteAllowed(), false);
  const st = fresh();
  let inside = null;
  const proxy = new Proxy(st.hidden, { set(t, k, v) { inside = hiddenWriteAllowed(); t[k] = v; return true; } });
  st.hidden = proxy;
  apply(st, ['放下手機陪'], 30);
  assert.equal(inside, true);
  assert.equal(hiddenWriteAllowed(), false);
});

test('標籤表自洽：推算值不能被標籤直接改；dirAccel 與 dir 成對；counts 的鍵是已知計數', () => {
  const raw = loadRaw().tags;
  for (const [n, d] of Object.entries(raw.tags)) {
    for (const k of Object.keys(d.d || {})) assert.ok(!raw.derived.includes(k), `${n} → ${k}`);
    if (d.dirAccel) assert.ok(d.dir != null, n);
    for (const k of Object.keys(d.counts || {})) assert.ok(k in newState(1, data, {}).vars, `${n} counts ${k}`);
    assert.ok(d.now, `${n} 缺 now`);
  }
});

test('孩子不再開口／孩子主動開口：標籤的 counts 會累計到 vars', () => {
  const st = fresh(); st.turn = 30;
  apply(st, ['沒聽孩子重複的要求', '聽他說完', '聽孩子重複的要求'], 30);
  assert.equal(st.vars.孩子不再開口, 1);
  assert.equal(st.vars.孩子主動開口, 2);
});

/* ───── 單回合邊預算（DESIGN §3.7）：同一個回合推到同一條 h: 邊的總量（參考劑量）不超過 maxTurn ───── */
// 挑一條有兩個以上標籤餵它、且每個標籤自己就能推這個方向的邊
function budgetEdge() {
  let best = null;
  for (const e of data.model.edges) {
    if (!e.id.startsWith('h:') || e.to === '父母的收穫' || !e.maxTurn) continue;
    const tags = (e.fromTags || []).filter((t) => T.tags[t] && T.tags[t].d && Math.sign(T.tags[t].d[e.to]) === (e.sign === '+' ? 1 : -1)).sort((a, b) => Math.abs(T.tags[b].d[e.to]) - Math.abs(T.tags[a].d[e.to]));
    if (tags.length >= 2 && (!best || e.maxTurn < best.e.maxTurn)) best = { e, tags };
  }
  if (!best) throw new Error('找不到有兩個標籤的邊');
  return best;
}

test('單回合邊預算：兩張卡加一個習慣推同一條邊，一個回合的總和 ≤ maxTurn；下一個回合預算重置', () => {
  const { e, tags } = budgetEdge();
  const push = (st, turn) => { // 同一個回合：卡 A、卡 B（劑量 1）、習慣（劑量 0.5，參考劑量基準 1）各推好幾次
    const sum = () => st.hidden[e.to];
    const before = sum();
    for (let i = 0; i < 40; i++) { apply(st, [tags[0]], turn); apply(st, [tags[1]], turn); apply(st, [tags[0]], turn, { scale: 0.5, refK: 1 }); }
    return Math.abs(sum() - before);
  };
  const st = fresh(11); st.turn = 40;
  const first = push(st, 40);
  assert.ok(first <= e.maxTurn + 1e-9, `一個回合 ${first} > maxTurn ${e.maxTurn}`);
  // 沒有預算時（每次換一個回合號碼）會超過，才代表預算真的有擋
  const free = fresh(11); free.turn = 40;
  let n = 0; const b0 = free.hidden[e.to];
  for (let i = 0; i < 40; i++) { apply(free, [tags[0]], 40 + n++); apply(free, [tags[1]], 40 + n++); apply(free, [tags[0]], 40 + n++, { scale: 0.5, refK: 1 }); }
  assert.ok(Math.abs(free.hidden[e.to] - b0) > e.maxTurn + 1e-9, '對照組沒有超過 maxTurn，測試沒意義');
  const second = push(st, 41);
  assert.ok(second > 0 && second <= e.maxTurn + 1e-9, `下一個回合 ${second}`);
});

test('單回合邊預算：以參考劑量計——習慣的階段 scale 不讓它被當成一整張卡', () => {
  const { e, tags } = budgetEdge();
  // 同一個回合一直推到預算用完為止，數放得進幾次：refK 1、scale 0.4 的習慣每次只花約 0.4 份參考劑量，放得進的次數比整張卡（scale 1）多
  const fits = (extra) => { const s = fresh(12); s.turn = 40; let n = 0; for (; n < 500; n++) { const b = s.hidden[e.to]; apply(s, [tags[0]], 40, extra); if (Math.abs(s.hidden[e.to] - b) < 1e-9) break; } return n; };
  const full = fits({}), habit = fits({ scale: 0.4, refK: 1 });
  assert.ok(full >= 2 && habit > full * 1.5, `整張卡放得進 ${full} 次、scale 0.4 的習慣 ${habit} 次`);
});

test('單回合邊預算：父母的收穫也算 h:父母的收穫+ 的 maxTurn', () => {
  const e = data.model.edges.find((x) => x.id === 'h:父母的收穫+');
  const st = fresh(13); st.turn = 40; st.hidden.父母的收穫 = 10;
  const before = st.hidden.父母的收穫;
  for (let i = 0; i < 20; i++) apply(st, ['放下手機陪'], 40);
  assert.ok(st.hidden.父母的收穫 - before <= e.maxTurn + 1e-9, `${st.hidden.父母的收穫 - before} > ${e.maxTurn}`);
});

test('單回合邊預算不進存檔：序列化沒有預算欄位、讀回來完全相同，下一個回合照常', () => {
  const { tags } = budgetEdge();
  const st = fresh(14); st.turn = 40;
  for (let i = 0; i < 10; i++) apply(st, [tags[0], tags[1]], 40);
  const json = serialize(st);
  assert.ok(!/budget|預算/.test(json));
  assert.deepEqual(deserialize(json), st);
  assert.equal(serialize(deserialize(json)), json);
  const back = deserialize(json);
  apply(st, [tags[0]], 41); apply(back, [tags[0]], 41);
  assert.deepEqual(back.hidden, st.hidden);
});

/* ───── 整局邊上限（maxGame）：和單回合預算一樣在套用時截；累計量 st.edgeUsedGame 進存檔 ───── */
test('整局邊上限：每個回合都推同一條邊，整局的總量不超過 maxGame（對照：把上限拿掉會超過）；累計量以實際量記', () => {
  const { e, tags } = budgetEdge();
  const run = (cap) => {
    const st = fresh(21); const b0 = st.hidden[e.to], saved = e.maxGame;
    if (cap === false) e.maxGame = 0; // 0＝不設整局上限
    try { for (let t = 20; t < 20 + 400; t++) { apply(st, [tags[0]], t); apply(st, [tags[1]], t); } } finally { e.maxGame = saved; }
    return { moved: Math.abs(st.hidden[e.to] - b0), used: st.edgeUsedGame[e.id] };
  };
  const capped = run(true), free = run(false);
  assert.ok(capped.moved <= e.maxGame + 1e-6, `整局 ${capped.moved} > maxGame ${e.maxGame}`);
  assert.ok(capped.used <= e.maxGame + 1e-6 && capped.used > 0, `edgeUsedGame ${capped.used}`);
  assert.ok(free.moved > e.maxGame + 1e-6, `對照組 ${free.moved} 沒有超過 maxGame ${e.maxGame}，測試沒意義`);
});

test('整局邊上限：edgeUsedGame 進存檔，往返後相同；舊存檔沒有這個欄位時 migrate 補成空物件（從 0 起算）', () => {
  const { e, tags } = budgetEdge();
  const st = fresh(22);
  for (let t = 20; t < 40; t++) apply(st, [tags[0]], t);
  assert.ok(st.edgeUsedGame[e.id] > 0);
  const back = deserialize(serialize(st));
  assert.deepEqual(back.edgeUsedGame, st.edgeUsedGame);
  const old = JSON.parse(serialize(fresh(22))); delete old.edgeUsedGame;
  const mig = migrate(old, data);
  assert.deepEqual(mig.edgeUsedGame, {});
  apply(mig, [tags[0]], 40); // 補上之後可以照常累計
  assert.ok(mig.edgeUsedGame[e.id] > 0);
});
