// 習慣（M3 B2，js/engine/habits.js、data/habits.json）：偵測的決定性、混合退路、套用的劑量、翻過去的條件、
// 只寫 autoLog 不進 hist、規則 18 的例外（自動套用的標籤必須是玩家選過的）、自動套用不給『不太來找你』的離開份、保證出現的『改變習慣』卡。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { buildCtx, applyChoice } from '../js/engine/events.js';
import { applyTags } from '../js/engine/tags.js';
import { startTurn, finishTurn } from '../js/engine/turn.js';
import { detectHabits, autoHabit, assertAppliedSubset, chosenWeights, familyOf } from '../js/engine/habits.js';
import { cardDoseK } from '../js/engine/timescale.js';
import { playGame } from '../tools/simulate.mjs';

const data = loadData(), H = data.habits;
const firstOf = (stage) => data.timeline.findIndex((t) => t.stage === stage);
const JH0 = firstOf('國中'), SH0 = firstOf('高中');
const turnsOf = (stage) => data.timeline.filter((t) => t.stage === stage).map((t) => t.turn);
const MID = turnsOf('國小中高'), LOW = turnsOf('國小低');

/** 偽造一筆選擇紀錄（和 applyChoice 寫的 hist 欄位一致） */
const pick = (turn, card, tags) => ({ turn, m: data.timeline[turn].ageMonths, k: 1, card, title: '', ch: 0, label: '', tags, d: {} });
/** 國中第一個回合的狀態，hist 是給定的紀錄 */
function atJH(hist, seed = 1) {
  const st = newState(seed, data, { role: '媽媽' });
  st.turn = JH0; st.hist = hist;
  return st;
}
const ctxOf = (st) => buildCtx(st, data.timeline[st.turn]);

test('偵測：只看帶 habit 的卡；勝出的模式要 ≥ minWeight 且占 ≥ dominance；決定性、重複呼叫不變', () => {
  const hist = [...MID.slice(0, 3).map((t) => pick(t, 'hi_home_first', ['只問成績或學校怎樣'])), pick(MID[3], 'hi_home_first', ['放下手機陪']),
    ...MID.slice(4, 8).map((t) => pick(t, 'hi_phone', ['事前訂規則'])), ...LOW.slice(0, 5).map((t) => pick(t, 'lo_hw', ['替他決定']))]; // lo_hw 不是習慣卡
  const a = atJH(hist), b = atJH(structuredClone(hist));
  detectHabits(a, data); detectHabits(b, data);
  assert.deepEqual(a.habits, b.habits); // 決定性
  const snap = structuredClone(a.habits); detectHabits(a, data);
  assert.deepEqual(a.habits, snap); // 已偵測過就不再改
  const h = a.habits['回家第一句'];
  assert.equal(h.pattern, '問功課分數'); assert.deepEqual(h.tags, ['只問成績或學校怎樣']);
  assert.equal(h.weight, 4); assert.equal(h.share, 0.75);
  assert.equal(a.habits['餐桌'].pattern, H.mixedPattern); // 餐桌沒有任何紀錄
  assert.equal(a.habits['手機規則'].pattern, '說到做到'); // 4 張手機規則卡，每張 1.0
});

test('偵測：票重要乘上 lookback（幼兒園 0.3、國小低 0.6、國小中高 1.0）', () => {
  const kg = turnsOf('幼兒園');
  const st = atJH([pick(kg[0], 'kid_home_first', ['敷衍帶過']), pick(LOW[0], 'lo_home_first', ['敷衍帶過']), pick(MID[0], 'hi_home_first', ['敷衍帶過'])]);
  const cw = chosenWeights(st, data, '回家第一句');
  assert.ok(Math.abs(cw.total - 1.9) < 1e-9 && Math.abs(cw.tagW['敷衍帶過'] - 1.9) < 1e-9, JSON.stringify(cw));
  assert.deepEqual(H.lookback, { 幼兒園: 0.3, 國小低: 0.6, 國小中高: 1 });
});

test('混合退路：不到 minWeight、或沒有任何模式占過半 → 混合，不帶任何標籤，只有一句中性的話，也不改隱藏數值', () => {
  const thin = atJH([pick(MID[0], 'hi_home_first', ['只問成績或學校怎樣']), pick(MID[1], 'hi_home_first', ['只問成績或學校怎樣'])]); // 2.0 < 2.5
  const split = atJH(MID.slice(0, 6).map((t, i) => pick(t, 'hi_home_first', [['只問成績或學校怎樣'], ['問具體的事'], ['放下手機陪']][i % 3]))); // 各 2.0、各占 1/3
  for (const st of [thin, split]) {
    detectHabits(st, data);
    const h = st.habits['回家第一句'];
    assert.equal(h.pattern, H.mixedPattern); assert.deepEqual(h.tags, []);
    const before = structuredClone(st.hidden);
    const r = autoHabit(st, data, data.timeline[st.turn], ctxOf(st));
    assert.ok(r && r.line.startsWith(H.prefix) && r.pattern === H.mixedPattern, '都是混合時顯示中性的一句話');
    assert.deepEqual(st.hidden, before, '混合不套用任何標籤');
    assert.deepEqual(st.autoLog.at(-1).tags, []);
  }
});

test('手機規則：只偵測、不自動套用（auto:false）', () => {
  assert.equal(H.families['手機規則'].auto, false);
  const st = atJH([...MID.slice(0, 4).map((t) => pick(t, 'hi_phone', ['事前訂規則'])), ...MID.slice(4, 8).map((t) => pick(t, 'hi_home_first', ['敷衍帶過'])), ...MID.slice(8, 12).map((t) => pick(t, 'hi_table', ['放下手機陪']))]);
  for (let i = 0; i < 6; i++) { st.turn = JH0 + i; autoHabit(st, data, data.timeline[st.turn], ctxOf(st)); }
  assert.equal(st.habits['手機規則'].pattern, '說到做到');
  assert.ok(st.autoLog.length >= 6 && st.autoLog.every((e) => e.family !== '手機規則'));
  assert.deepEqual([...new Set(st.autoLog.map((e) => e.family))].sort(), ['回家第一句', '餐桌']); // 兩個 auto 家族輪流
});

test('套用的劑量：國中 0.5、高中 0.4（乘上這個回合的劑量倍率）；approach:false；只寫 autoLog，不進 hist', () => {
  assert.deepEqual(H.scale, { 國中: 0.5, 高中: 0.4 });
  const hist = MID.slice(0, 4).map((t) => pick(t, 'hi_home_first', ['放下手機陪']));
  for (const [t0, stage, f] of [[JH0, '國中', 0.5], [SH0, '高中', 0.4]]) {
    const a = atJH(hist); a.turn = t0;
    detectHabits(a, data);
    a.habits['餐桌'] = { pattern: H.mixedPattern, tags: [], shift: { n: 0, to: '' }, flipped: false, flips: 0 }; // 只讓回家第一句輪到
    const tl = data.timeline[t0], ctx = ctxOf(a);
    const b = structuredClone(a); b.turn = t0;
    const nHist = a.hist.length;
    const r = autoHabit(a, data, tl, ctx);
    assert.equal(r.family, '回家第一句');
    assert.equal(a.hist.length, nHist, 'hist 不變'); assert.equal(a.autoLog.length, 1); assert.equal(a.autoLog[0].turn, t0);
    const k = f * cardDoseK(data.model, tl.span, { scale: true }, false);
    applyTags(b, ['放下手機陪'], data.tags, { turn: t0, months: tl.ageMonths, span: tl.span, scale: k, stage, ctx: ctxOf(b), approach: false, initiate: false });
    assert.deepEqual(a.hidden, b.hidden, `${stage} 的劑量應該是 ${f} × 回合倍率`);
    assert.ok(Object.keys(a.hidden).some((key) => a.hidden[key] !== newState(1, data, { role: '媽媽' }).hidden[key]), '確實改了隱藏數值');
  }
});

test('自動套用永遠不給『不太來找你』的離開份', () => {
  const st = atJH(MID.slice(0, 4).map((t) => pick(t, 'hi_home_first', ['放下手機陪'])));
  st.vars.不太來找你 = 1; st.vars.孩子來找_回來連續 = 0;
  for (let i = 0; i < 12; i++) { st.turn = JH0 + i; autoHabit(st, data, data.timeline[st.turn], ctxOf(st)); }
  assert.ok(st.autoLog.length >= 6);
  assert.equal(st.vars.不太來找你, 1); assert.equal(st.vars.孩子來找_回來連續, 0);
});

test('同一回合出現同家族的卡就跳過那個家族', () => {
  const st = atJH(MID.slice(0, 4).map((t) => pick(t, 'hi_home_first', ['放下手機陪'])));
  const r = autoHabit(st, data, data.timeline[st.turn], ctxOf(st), new Set(['回家第一句']));
  assert.equal(r, null, '只有回家第一句是非混合，其他是混合 → 這回合不補中性句');
  assert.equal(st.autoLog.length, 0);
});

test('換習慣：連續兩次選同一個新模式才翻過去；選回目前的模式進度歸零；中途改選別的從 1 重算；翻過去後孩子的回應鬆動', () => {
  assert.deepEqual(H.shiftAt, { 國中: 2, 高中: 2 });
  const st = atJH(MID.slice(0, 4).map((t) => pick(t, 'hi_home_first', ['只問成績或學校怎樣'])));
  detectHabits(st, data);
  const card = data.cardIndex.jh_habit_change, r = () => 0.5;
  const choose = (label, turn) => { st.turn = turn; const tl = data.timeline[turn]; return applyChoice(st, data, card, card.choices.findIndex((c) => c.label.startsWith(label)), tl, r); };
  const h = () => st.habits['回家第一句'];
  assert.equal(h().pattern, '問功課分數');
  choose('把手機留在客廳', JH0 + 1); // 先抱一下
  assert.equal(h().pattern, '問功課分數'); assert.equal(h().shift.n, 1);
  choose('在門口問', JH0 + 2); // 選回原本的 → 歸零
  assert.equal(h().shift.n, 0);
  choose('把手機留在客廳', JH0 + 3); choose('敲門，隔著門', JH0 + 4); // 中途改選別的 → 從 1 重算
  assert.equal(h().pattern, '問功課分數'); assert.equal(h().shift.n, 1); assert.equal(h().shift.to, '問好玩的');
  choose('敲門，隔著門', JH0 + 5); // 連續兩次 → 翻過去
  assert.equal(h().pattern, '問好玩的'); assert.equal(h().flipped, true); assert.equal(h().flips, 1);
  assert.deepEqual(h().tags, ['問具體的事']); assert.equal(buildCtx(st, data.timeline[JH0 + 6]).習慣改變_回家第一句, 2);
  const r2 = choose('敲門，隔著門', JH0 + 6); // 翻過去之後再選同一個：結果文字讀 習慣改變 ≥ 1（鬆動的回應）
  assert.match(r2.result, /賣完了|椅子轉過來/);
  assert.equal(h().pattern, '問好玩的');
  // 翻過去的標籤算規則 18 的例外：玩家在國中以後連續選了 shiftAt 次
  assert.doesNotThrow(() => assertAppliedSubset(st, data, '回家第一句', ['問具體的事']));
  assert.throws(() => assertAppliedSubset(st, data, '回家第一句', ['放下手機陪']), /不是玩家/);
});

test('規則 18 的例外：自動套用的標籤必須是玩家選過、票重 ≥ minWeight 的標籤；選不過的標籤（直接改他的計畫、替他決定）會丟錯', () => {
  const st = atJH(MID.slice(0, 4).map((t) => pick(t, 'hi_home_first', ['放下手機陪'])));
  detectHabits(st, data);
  assert.doesNotThrow(() => assertAppliedSubset(st, data, '回家第一句', st.habits['回家第一句'].tags));
  for (const t of ['直接改他的計畫', '替他決定', '全部替他做', '只問成績或學校怎樣', '敷衍帶過']) assert.throws(() => assertAppliedSubset(st, data, '回家第一句', [t]), /規則 18/, t);
  // 票重不到 minWeight 的標籤也不行：餐桌 minWeight 1.5，只選過一次（1.0）的標籤
  const st2 = atJH([pick(MID[0], 'hi_table', ['放下手機陪', '問具體的事'])]);
  assert.throws(() => assertAppliedSubset(st2, data, '餐桌', ['放下手機陪']), /規則 18/);
  // 資料裡的 minWeight 就是規劃者決定的值
  assert.equal(H.families['回家第一句'].minWeight, 2.5); assert.equal(H.families['餐桌'].minWeight, 1.5); assert.equal(H.dominance, 0.5);
});

test('國小選了「替他決定」這一類標籤的玩家：autoLog 裡不會出現沒選過的標籤（直接改他的計畫、替他決定……）', () => {
  // 偽造：國小一路選替他決定／直接改他的計畫（不在習慣卡上），習慣卡上只選過敷衍帶過 4 次
  const hist = [...LOW.slice(0, 5).map((t) => pick(t, 'lo_hw', ['替他決定'])), ...MID.slice(0, 6).map((t) => pick(t, 'hi_hw', ['直接改他的計畫', '全部替他做'])), ...MID.slice(6, 10).map((t) => pick(t, 'hi_home_first', ['敷衍帶過']))];
  const st = atJH(hist);
  for (let i = 0; i < 8; i++) { st.turn = JH0 + i; autoHabit(st, data, data.timeline[st.turn], ctxOf(st)); }
  const used = new Set(st.autoLog.flatMap((e) => e.tags));
  assert.deepEqual([...used], ['敷衍帶過']);
  for (const t of ['直接改他的計畫', '替他決定', '全部替他做']) assert.ok(!used.has(t), t);
  // 完全沒選過習慣卡的玩家：全部混合、不套任何標籤
  const st2 = atJH(hist.slice(0, 11));
  for (let i = 0; i < 4; i++) { st2.turn = JH0 + i; autoHabit(st2, data, data.timeline[st2.turn], ctxOf(st2)); }
  assert.ok(st2.autoLog.every((e) => e.tags.length === 0));
});

test('整局：控制型、溫暖型、習慣反應型的機器人，autoLog 的標籤都是玩家真的選過的、不進 hist、同家族的卡出現的回合不自動套用', () => {
  for (const bot of ['controlling', 'warmFirm', 'commonReaction', 'permissive']) for (const seed of [3, 4, 5, 6, 7]) {
    const { st } = playGame(data, bot, seed, { preview: true, st: true });
    assert.ok(st.autoLog.length > 0, `${bot}#${seed} 有自動套用的紀錄`);
    const patternTags = new Set(Object.values(H.families).flatMap((f) => Object.values(f.patterns).flatMap((p) => p.tags)));
    for (const e of st.autoLog) {
      for (const t of e.tags) assert.ok(patternTags.has(t), `${bot}#${seed}：${t} 不是任何模式的標籤`);
      const sameTurn = st.hist.filter((h) => h.turn === e.turn);
      assert.ok(!sameTurn.some((h) => familyOf(data, h.card) === e.family && e.tags.length), `${bot}#${seed} 第 ${e.turn} 回合：同家族的卡出現，卻還是自動套用`);
      // 自動套用的紀錄不在 hist（hist 的每一筆都有 ch 索引，autoLog 沒有）
      assert.ok(!sameTurn.some((h) => h.line !== undefined));
    }
    assert.ok(!st.hist.some((h) => h.card === undefined || h.family !== undefined));
    // 規則 18 的例外，獨立重算一遍：每個標籤都在玩家的 hist 裡出現過
    for (const e of st.autoLog) for (const t of e.tags) assert.ok(st.hist.some((h) => familyOf(data, h.card) === e.family && h.tags.includes(t)), `${bot}#${seed}：${e.family} 的 ${t} 玩家沒選過`);
  }
});

test('startTurn：第一個國中回合給一次性的說明並偵測；每個國中、高中回合有 habitLine（以「照平常那樣，」開頭）；說明只出現一次', () => {
  const st = newState(9, data, { role: '爸爸', preview: true });
  st.turn = JH0;
  const first = startTurn(st, data);
  assert.equal(first.habitExplainer, '上了國中，見面的時間少了，很多日常會照你們家平常的樣子過。');
  assert.equal(Object.keys(st.habits).length, Object.keys(H.families).length, '第一個國中回合偵測完所有家族');
  assert.ok(first.habitLine && first.habitLine.startsWith('照平常那樣，'));
  assert.equal(first.card.habitExplainer, first.habitExplainer);
  st.cur = null; finishTurn(st, data);
  const second = startTurn(st, data);
  assert.equal(second.habitExplainer, undefined);
  assert.ok(second.habitLine === undefined || second.habitLine.startsWith('照平常那樣，'));
});

test('保證出現：國中一年級第 2 回合一定有 jh_habit_change（日曆 fixed），而且不增加國中有固定事件的回合數', () => {
  assert.equal(data.timeline[JH0 + 1].fixed[0], 'jh_habit_change');
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    const { st } = playGame(data, seed % 2 ? 'commonReaction' : 'warmFirm', seed, { preview: true, st: true });
    assert.ok(st.hist.some((h) => h.card === 'jh_habit_change' && h.turn === JH0 + 1), `seed ${seed}`);
  }
  const fixedJH = data.timeline.filter((t) => t.stage === '國中' && t.fixed.length).length;
  assert.equal(fixedJH, 5); assert.ok(fixedJH / 13 <= 0.5); // B4 之前是 6：fx_choose_jh（國中開學前一週）搬到國小六年級的暑假之後，國中第一回合不再是固定事件
});

test('lineIf 只換孩子的回應：高低兩版以同一段「家長做的事」開頭、字數相近', () => {
  for (const [f, fam] of Object.entries(H.families)) if (fam.auto) for (const [p, def] of Object.entries(fam.patterns)) {
    const lo = def.lineIf.find((v) => v.if === '親子信任低').value, hi = def.lineIf.find((v) => v.if === '親子信任高').value, act = def.line.split('，')[0];
    assert.ok(lo.startsWith(act) && hi.startsWith(act), `${f}／${p}`);
    assert.ok(Math.max([...lo].length, [...hi].length) / Math.min([...lo].length, [...hi].length) <= 1.3, `${f}／${p} 字數`);
  }
});
