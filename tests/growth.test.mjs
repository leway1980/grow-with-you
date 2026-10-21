// 父母的收穫（DESIGN §7.2b）與標籤自帶的代價（硬撐不是免費的）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, loadRaw } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { prepareData, startTurn, chooseCard, finishTurn, withTagCosts } from '../js/engine/turn.js';
import { applyChoice, describeCard, buildCtx } from '../js/engine/events.js';
import { applyTags, isGrowthChoice, saturate } from '../js/engine/tags.js';
import { wellbeing, growthSection, buildEnding, GROWTH_HORIZON_MONTHS } from '../js/engine/ending.js';
import { cardDoseK } from '../js/engine/timescale.js';
import { stateRng } from '../js/engine/rng.js';
import { guardHidden } from './helpers.mjs';
import { installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

const data = loadData();
const T = data.tags;
const fresh = (seed = 5) => guardHidden(newState(seed, data, { role: '媽媽' }));
const tlAt = (turn) => data.timeline[turn];
const gain = (st, tags, turn = 30) => { const b = st.hidden.父母的收穫; applyTags(st, tags, T, { turn, stage: tlAt(turn).stage, ctx: buildCtx(st, tlAt(turn), {}) }); return st.hidden.父母的收穫 - b; };

test('父母的收穫：只有一起參與的標籤會讓它上升；送去上課（嘗試新活動單獨出現）不算；其他標籤不動', () => {
  const st = fresh();
  assert.equal(st.hidden.父母的收穫, 0);
  for (const t of T.growthTags.filter((x) => !T.growth.joinOnly.includes(x))) assert.ok(gain(fresh(), [t]) > 0, t);
  assert.equal(gain(fresh(), ['嘗試新活動']), 0);
  assert.ok(gain(fresh(), ['嘗試新活動', '陪著觀察']) > 0);
  assert.equal(gain(fresh(), ['罵一頓']), 0);
  assert.equal(gain(fresh(), ['硬撐']), 0);
  assert.equal(isGrowthChoice(T, ['嘗試新活動']), false);
});

test('父母的收穫：一個選項只算一次（帶三個參與標籤也只加一次），而且有飽和', () => {
  const a = gain(fresh(), ['陪讀共讀']), b = gain(fresh(), ['陪讀共讀', '放下手機陪', '陪著觀察']);
  assert.ok(Math.abs(a - saturate(0, T.growth.gain)) < 1e-9 && Math.abs(b - a) < 1e-9);
  const st = fresh();
  for (let i = 0; i < 400; i++) gain(st, ['陪讀共讀'], 30 + (i % 40)); // 每次換一個回合：同一個回合的總量受單回合邊預算限制（tags.js turnBudget），這裡測的是飽和
  assert.ok(st.hidden.父母的收穫 > 90 && st.hidden.父母的收穫 <= 100);
});

test('父母的收穫：隱藏數值只在 tags.js 寫入（recordGrowth 與 applyChoice 不會直接碰 st.hidden）', () => {
  const st = fresh(); st.turn = 30;
  const card = { id: 'g_hidden', pool: '日常_國小中高', title: 't', text: '今天{球類}', choices: [{ label: '陪{他}打{球類}', effects: { 體力: -2 }, tags: ['一起參與'], result: '' }, { label: 'x', effects: { 心情: 1 }, tags: ['罵一頓'], result: '' }] };
  data.cardIndex[card.id] = card;
  describeCard(card, st, data, tlAt(30));
  assert.doesNotThrow(() => applyChoice(st, data, card, 0, tlAt(30), stateRng(st, 'rngS')));
  assert.ok(st.hidden.父母的收穫 > 0);
});

test('父母的收穫：記下這張卡抽到的槽值（球類、才藝、出遊、營隊）；沒有槽的卡記下標籤；送去的選項什麼都不記', () => {
  const st = fresh(); st.turn = 30;
  const card = { id: 'g_slot', pool: '日常_國小中高', title: 't', text: '他想打{球類}，也想去{營隊}', choices: [
    { label: '跟{他}一起去打{球類}', effects: { 體力: -2 }, tags: ['陪著觀察'], result: '' },
    { label: '幫{他}報名{營隊}', effects: { 錢: -2 }, tags: ['嘗試新活動'], result: '' },
    { label: 'x', effects: { 心情: 1 }, tags: ['罵一頓'], result: '' }] };
  data.cardIndex[card.id] = card;
  describeCard(card, st, data, tlAt(30));
  applyChoice(st, data, card, 1, tlAt(30), stateRng(st, 'rngS'));
  assert.deepEqual(st.parentGrowth, []);
  applyChoice(st, data, card, 2, tlAt(30), stateRng(st, 'rngS'));
  assert.deepEqual(st.parentGrowth, []);
  applyChoice(st, data, card, 0, tlAt(30), stateRng(st, 'rngS'));
  assert.deepEqual(st.parentGrowth.map((r) => r.slot).sort(), ['營隊', '球類']);
  assert.ok(st.parentGrowth.every((r) => typeof r.value === 'string' && r.value && r.turn === 30));
  const plain = { id: 'g_tag', pool: '日常_國小中高', title: 't', text: 't', choices: [{ label: 'a', effects: { 體力: -1 }, tags: ['陪讀共讀'], result: '' }, { label: 'b', effects: { 心情: 1 }, tags: ['罵一頓'], result: '' }, { label: 'c', effects: { 心情: 1 }, tags: ['罵一頓'], result: '' }] };
  data.cardIndex[plain.id] = plain;
  describeCard(plain, st, data, tlAt(30));
  applyChoice(st, data, plain, 0, tlAt(30), stateRng(st, 'rngS'));
  assert.deepEqual(st.parentGrowth.at(-1), { turn: 30, tag: '陪讀共讀' });
});

test('終局：你也重新長大了一次——最多 5 條白話句子，有名字的活動先列，同一個槽盡量不重複；沒有就是一句溫和的話', () => {
  const st = fresh();
  assert.deepEqual(growthSection(st, T).lines, []);
  assert.ok(growthSection(st, T).none.length > 10 && !/\{/.test(growthSection(st, T).none));
  st.parentGrowth = [
    { turn: 3, tag: '陪讀共讀' }, { turn: 5, tag: '陪讀共讀' },
    { turn: 22, slot: '球類', value: '樂樂棒球' }, { turn: 24, slot: '球類', value: '樂樂棒球' }, { turn: 25, slot: '球類', value: '籃球' },
    { turn: 30, slot: '才藝', value: '游泳' }, { turn: 33, slot: '出遊', value: '露營' }, { turn: 40, slot: '營隊', value: '科學營' },
    { turn: 44, slot: '寵物', value: '倉鼠' }, { turn: 50, slot: '流行', value: '卡牌' },
  ];
  const g = growthSection(st, T);
  assert.equal(g.lines.length, 5);
  assert.equal(g.none, '');
  const txt = g.lines.join('\n');
  assert.ok(txt.includes('樂樂棒球') && !txt.includes('籃球'), '同一個槽挑次數最多的'); // 先挑每個槽各一條
  assert.ok(!/\{|undefined/.test(txt));
  assert.ok(g.lines.every((l) => l.endsWith('。')));
  st.parentGrowth = [{ turn: 3, tag: '陪讀共讀' }];
  assert.equal(growthSection(st, T).lines.length, 1);
  assert.ok(buildEnding(st, data).growth.lines.length === 1);
});

test('終局畫面：幸福之後有『你也重新長大了一次』；沒有紀錄時顯示溫和的話，有紀錄時列出句子', async () => {
  const ui = await import('../js/ui.js');
  const { root } = installFakeDom();
  try {
    const st = fresh(); st.turn = data.calendar.playableTurns;
    const e = buildEnding(st, data);
    ui.renderEnding(root, e, { seed: 5, onSame() {}, onNew() {} });
    assert.deepEqual(root.querySelectorAll('section').map((s) => s.attrs.id).slice(0, 2), ['ending-wellbeing', 'ending-growth']);
    assert.ok(root.querySelector('#ending-growth').textContent.includes('你也重新長大了一次') && root.querySelector('#ending-growth').textContent.includes(e.growth.none));
    st.parentGrowth = [{ turn: 22, slot: '球類', value: '樂樂棒球' }];
    ui.renderEnding(root, buildEnding(st, data), { seed: 5, onSame() {}, onNew() {} });
    assert.ok(root.querySelector('#ending-growth').textContent.includes('樂樂棒球'));
  } finally { uninstallFakeDom(); }
});

test('父母幸福算進父母的收穫：權重中等，補回一部分犧牲，不會抵消全部', () => {
  const st = newState(5, data, { role: '媽媽' }); st.turn = data.calendar.playableTurns; // 這個測試要直接改隱藏數值，所以不用 guardHidden
  for (let i = 0; i < 30; i++) st.vcurves.push({ t: i, 體力: 60, 耐心: 55, 夫妻關係: 60, 錢: 50, 心情: 60 });
  for (let i = 0; i < 30; i++) st.curves.push({ t: i, ...st.hidden });
  const M = data.identities.parentModel;
  const w0 = wellbeing(st, M).parent;
  st.hidden.父母的收穫 = 0; const base = wellbeing(st, M).parent;
  st.hidden.父母的收穫 = 40; const w40 = wellbeing(st, M).parent;
  assert.ok(M.growthWeight > 0.1 && M.growthWeight <= 0.4, '權重中等');
  const played = st.vcurves.length * 2; // 沒有 m 的舊紀錄每筆算 2 個月
  assert.ok(Math.abs((w40 - base) - M.growthWeight * 40 * GROWTH_HORIZON_MONTHS / played) < 1e-6 || w40 >= 99.9);
  assert.ok(w0 === base);
  assert.equal(wellbeing(st, { ...M, growthWeight: 0 }).parent, base, '權重 0 就等於沒有這一項');
  // 沒有任何參與的人不被扣分：收穫從 0 起算
  st.hidden.父母的收穫 = 0; assert.equal(wellbeing(st, M).parent, base);
});

test('硬撐有真的代價：載入時加進選項的效果（體力、耐心下降），原始資料不被改，重複載入結果相同', () => {
  const raw = loadRaw();
  const costs = raw.tags.tagCosts.硬撐;
  assert.ok(costs.體力 <= -2 && costs.耐心 <= -2);
  const d1 = prepareData(raw), d2 = prepareData(raw);
  let n = 0;
  for (const c of raw.events.cards) c.choices.forEach((ch, i) => {
    if (!(ch.tags || []).includes('硬撐')) return;
    n++;
    const a = d1.cardIndex[c.id].choices[i].effects, b = d2.cardIndex[c.id].choices[i].effects;
    assert.deepEqual(a, b);
    assert.equal(a.體力, (ch.effects?.體力 || 0) + costs.體力);
    assert.equal(a.耐心, (ch.effects?.耐心 || 0) + costs.耐心);
  });
  assert.ok(n >= 5, '資料裡有硬撐的選項');
  assert.deepEqual(withTagCosts(raw.events, {}), raw.events);
});

test('硬撐：選了之後體力與耐心立刻下降，劑量表看得到，疲勞累積（EMA）上升', () => {
  const card = data.events.cards.find((c) => c.choices.some((ch) => (ch.tags || []).includes('硬撐')) && c.pool === '父母自己');
  const idx = card.choices.findIndex((ch) => (ch.tags || []).includes('硬撐'));
  const st = fresh(11); st.turn = 30;
  const tl = tlAt(30);
  st.cur = { cardId: card.id, slot: 0, twoSlot: false, fu: null, acc: {}, loads: [] };
  const b = { ...st.parent };
  const out = chooseCard(st, data, idx);
  assert.ok(st.parent.體力 <= b.體力 - 2 && st.parent.耐心 <= b.耐心 - 2, JSON.stringify([b, st.parent])); // 另一半一起陪時花費 ×0.7
  assert.ok(out.dose.parent.some((r) => r.key === '體力' && r.dir < 0) && out.dose.parent.some((r) => r.key === '耐心' && r.dir < 0));
  const e0 = st.costEMA.體力 + st.costEMA.耐心;
  finishTurn(st, data);
  assert.ok(st.costEMA.體力 + st.costEMA.耐心 > e0 + 0.5);
});

// 父母的收穫的劑量走和其他標籤一樣的劑量倍率：自動習慣、一次性固定卡都不會比一張 2 個月的參考卡多拿
const gainAt = (scale, turn = 30) => { const st = fresh(); const b = st.hidden.父母的收穫; applyTags(st, ['陪讀共讀'], T, { turn, stage: tlAt(turn).stage, scale, ctx: buildCtx(st, tlAt(turn), {}) }); return st.hidden.父母的收穫 - b; };

test('父母的收穫：自動習慣每次套用的量不超過一張 2 個月參考卡', () => {
  const ref = gainAt(cardDoseK(data.model, 2, { scale: true }));
  assert.ok(ref > 0);
  const cfg = data.habits.config ?? data.habits;
  let n = 0;
  for (const tl of data.timeline) {
    if (cfg.scale[tl.stage] == null) continue;
    n++;
    const k = cfg.scale[tl.stage] * cardDoseK(data.model, tl.span ?? 2, { scale: true });
    // 回合 ≤ 5 個月：一次套用不超過一張參考卡；7 個月的回合（高一下、高二下）一次是 1.4 倍，但每個月的量仍低於參考卡的每月量（0.2 < 0.5 倍）
    if ((tl.span ?? 2) <= 5) assert.ok(gainAt(k) <= ref + 1e-9, `turn ${tl.turn} ${tl.stage} span ${tl.span}`);
    assert.ok(gainAt(k) / (tl.span ?? 2) <= ref / 2 + 1e-9, `每月 turn ${tl.turn}`);
  }
  assert.ok(n > 0);
});

test('父母的收穫：scale:false 的卡在 7 個月的回合也不超過一張 2 個月參考卡', () => {
  const ref = gainAt(cardDoseK(data.model, 2, { scale: true }));
  assert.ok(gainAt(cardDoseK(data.model, 7, { scale: false })) <= ref + 1e-9);
});

test('父母幸福：固定的每月收穫速率，144 個月與 216 個月的水準貢獻相同', () => {
  const M = data.identities.parentModel, rate = 0.2;
  const contribution = (months) => {
    const st = newState(5, data, { role: '媽媽' }); st.turn = data.calendar.playableTurns;
    for (let m = 2; m <= months; m += 2) { st.vcurves.push({ t: m / 2, m, 體力: 60, 耐心: 55, 夫妻關係: 60, 錢: 50, 心情: 60 }); st.curves.push({ t: m / 2, m, ...st.hidden }); }
    st.hidden.父母的收穫 = 0; const base = wellbeing(st, M).parent;
    st.hidden.父母的收穫 = rate * months; return wellbeing(st, M).parent - base;
  };
  assert.ok(Math.abs(contribution(144) - contribution(216)) < 1e-6);
  assert.ok(Math.abs(contribution(144) - M.growthWeight * rate * GROWTH_HORIZON_MONTHS) < 1e-6);
});
