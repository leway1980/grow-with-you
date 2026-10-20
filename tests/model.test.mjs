// 因果模型與防呆（DESIGN §3.7）：圖本身的檢查、引擎真的讀圖、lint 擋得住壞改動、結局句子不矛盾且每個高中低都有後備句。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintData } from '../tools/lint-data.mjs';
import { loadRaw, loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { playToEnd } from '../js/engine/turn.js';
import { applyTags, setTagObserver, recomputeDerived } from '../js/engine/tags.js';
import { outcomeAxes, wellbeing, opennessOf, comboOf, bandOf, buildEnding, pickLines, lineContradictions, endingContext, chainRecords } from '../js/engine/ending.js';
import { edgeForTagEffect, outcomeWeights, AXES } from '../js/engine/model.js';
import { botPolicy, SALT } from '../tools/bots.mjs';

const data = loadData();
const M = data.model, E = data.ending;
const mut = (fn) => { const raw = structuredClone(loadRaw()); fn(raw); return lintData(raw).errors.join('\n'); };
const played = (seed = 4, bot = 'random') => { const st = newState(seed, data, {}); playToEnd(st, data, botPolicy(bot, SALT)); return st; };

test('因果圖：每個標籤效果都有方向一致的邊、每條標籤邊都有上限與理由、lint 通過', () => {
  const { errors } = lintData();
  assert.deepEqual(errors, []);
  for (const [t, def] of Object.entries(data.tags.tags)) for (const [k, d] of Object.entries(def.d || {})) assert.ok(edgeForTagEffect(M, t, k, d), `${t}→${k}`);
  for (const e of M.edges) { assert.ok(e.why && e.src, e.id); if (e.id.startsWith('h:')) assert.ok(e.maxTurn > 0 && e.maxGame >= e.maxTurn, e.id); }
  for (const k of ['perTag', 'perCard', 'perPool', 'perChoiceStatic']) for (const a of AXES) assert.ok(M.influenceCaps[k][a] > 0, `${k}.${a}`);
});

test('lint 擋得住：標籤方向和邊矛盾、標籤沒有邊、邊上有已經不存在的效果', () => {
  assert.match(mut((r) => { r.tags.tags.說了不算.d.規則一致性 = 2; }), /標籤 說了不算：對「規則一致性」的效果 \+2 和因果圖的方向（-）矛盾/);
  assert.match(mut((r) => { r.tags.tags.說了不算.d.班級風氣 = -1; }), /標籤 說了不算：對「班級風氣」的效果（-1）在因果圖上沒有邊/);
  assert.match(mut((r) => { delete r.tags.tags.聽他說完.d.了解度; }), /邊 h:了解度\+：標籤「聽他說完」在 tags.json 沒有這個方向的效果/);
  assert.match(mut((r) => { r.model.edges.find((e) => e.id === 'h:主見-').sign = '+'; }), /矛盾/);
  assert.match(mut((r) => { delete r.model.edges.find((e) => e.id === 'h:主見-').why; }), /要寫 why 與 src/);
});

test('lint 擋得住：卡片直接碰第 3、4 層（hidden、結果軸、隱藏數值的計數）', () => {
  const card = (r) => r.events.cards.find((c) => c.choices.length);
  assert.match(mut((r) => { card(r).choices[0].hidden = { 主見: 3 }; }), /不能有 hidden/);
  assert.match(mut((r) => { card(r).choices[0].setVars = { 孩子主動開口: 3 }; }), /setVars「孩子主動開口」不是卡片可以寫的節點/);
  assert.match(mut((r) => { card(r).choices[0].incVars = { 不太來找你: 1 }; }), /incVars「不太來找你」不是卡片可以寫的節點/);
  assert.match(mut((r) => { card(r).choices[0].effects = { 親子: 5 }; }), /可見數值「親子」不存在/);
  assert.match(mut((r) => { r.tags.tags.說了不算.d.承受度 = -1; }), /承受度.*推算出來的|在因果圖上沒有邊|不能由標籤改變/);
});

test('lint 擋得住：邊的單回合上限被某個選項的名義變動超過；結果軸的單選項影響超過上限', () => {
  assert.match(mut((r) => { r.model.edges.find((e) => e.id === 'h:溫暖陪伴+').maxTurn = 0.2; r.model.edges.find((e) => e.id === 'h:溫暖陪伴+').maxGame = 0.5; }), /超過單回合上限/);
  assert.match(mut((r) => { r.model.influenceCaps.perChoiceStatic.親子 = 0.3; }), /超過單一選項上限/);
  assert.match(mut((r) => { r.tags.tags.罵一頓.d.親子信任 = -30; }), /超過單回合上限|超過單一選項上限/);
});

test('結局句子：只能讀第 4 層的結果與決定鏈紀錄（讀隱藏數值、旗標、不認得的變數都會被擋）', () => {
  assert.match(mut((r) => { r.ending.sentences[1].when = '主見 < 20'; }), /條件讀了「主見」/);
  assert.match(mut((r) => { r.ending.sentences[1].when = '親子信任 > 40'; }), /條件讀了「親子信任」/);
  assert.match(mut((r) => { r.ending.sentences[1].when = '#看過醫生'; }), /不能讀旗標/);
  assert.match(mut((r) => { r.ending.sentences[1].when = '孩子幸福 >>'; }), /條件寫錯/);
  assert.match(mut((r) => { r.ending.sentences[1].text = '他的主見很強'; }), /隱藏數值的名稱/);
  assert.equal(mut(() => {}), '');
});

test('結局句子：每個高中低都要有後備句；home 要有 when:true 的後備', () => {
  assert.match(mut((r) => { r.ending.sentences = r.ending.sentences.filter((s) => s.id !== 'peer-lo'); }), /「人際」的「低」沒有後備句/);
  assert.match(mut((r) => { r.ending.sentences.find((s) => s.id === 'learn-mid').fallback = false; }), /「學習」的「中」沒有後備句/);
  assert.match(mut((r) => { r.ending.sentences = r.ending.sentences.filter((s) => s.id !== 'home-7'); }), /home 沒有 when: true 的後備句/);
});

test('結局句子：互斥群組——說「很少說話」和「什麼都說」同時出現會被擋（lint 在邊界值格子上檢查）', () => {
  assert.match(mut((r) => {
    // 加一句和 home-3（開口：少）在 親子 facet 同時成立、卻說『多』的句子
    r.ending.sentences.splice(8, 0, { id: 'rel-bad', facet: '親子', slot: 'record', when: '親子帶 == \'高\'', text: '他什麼都跟你說。', claims: { 開口: '多' } });
  }), /句子互相矛盾/);
  // 引擎層：差兩格才算矛盾，差一格不算
  const L = (id, v) => ({ id, claims: { 開口: v } });
  assert.equal(lineContradictions([L('a', '少'), L('b', '多')], E).length, 1);
  assert.equal(lineContradictions([L('a', '少'), L('b', '一半')], E).length, 0);
  assert.equal(lineContradictions([L('a', '多'), L('b', '多')], E).length, 0);
});

test('結局句子：三條軸的 27 種高低組合 × 幸福的高低，每個 facet 都有句子（不靠特定卡片的後備句）', () => {
  const bands = { hi: 70, mid: 52, lo: 30 };
  let n = 0;
  for (const a of Object.values(bands)) for (const p of Object.values(bands)) for (const l of Object.values(bands)) for (const c of Object.values(bands)) for (const pa of Object.values(bands)) for (const b of Object.values(bands)) {
    const axes = { 親子: a, 人際: p, 學習: l };
    const lines = pickLines(endingContext({ axes, wellbeing: { child: c, parent: pa, between: b }, route: { kind: '未成形' }, combo: comboOf(axes) }, Object.fromEntries(E.records.map((r) => [r.name, 0]))), E);
    for (const f of E.facets) assert.ok(lines.some((x) => x.facet === f), `${JSON.stringify(axes)} 缺 ${f}`);
    // 每個 band 的後備句存在，而且其條件只看自己那條軸
    for (const [ax, vn] of Object.entries(E.bandVars)) assert.ok(lines.some((x) => x.facet === ax && x.slot === 'band' && x.fallback), `${ax}`);
    assert.equal(lineContradictions(lines, E).length, 0);
    n++;
  }
  assert.equal(n, 729);
});

test('buildEnding：lines 有四個 facet、home 那句就是 line、不含隱藏數值的名稱、{孩子} 已替換', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const e = buildEnding(played(seed), data);
    for (const f of E.facets) assert.ok(e.lines.some((l) => l.facet === f));
    assert.equal(e.lines.find((l) => l.facet === 'home').text, e.line);
    for (const l of e.lines) { assert.ok(!/[{}]/.test(l.text), l.text); for (const k of Object.keys(data.tags.hidden)) assert.ok(!l.text.includes(k)); }
    assert.equal(lineContradictions(e.lines, E).length, 0);
  }
});

test('決定鏈紀錄：進入過「不太來找你」之後離開，紀錄還在；3C 連用要在 12 個月內 ≥ 3 次', () => {
  const st = played(3);
  assert.deepEqual(Object.keys(chainRecords(st, E)).sort(), E.records.map((r) => r.name).sort());
  const s2 = newState(5, data, {});
  s2.vars.不太來找你_曾 = 1; s2.vars.不太來找你 = 0;
  assert.equal(chainRecords(s2, E).曾不太來找你, 1); assert.equal(chainRecords(s2, E).現在不太來找你, 0);
  const at = (turns) => turns.map((turn) => ({ turn, m: data.timeline[turn].ageMonths, tags: ['3C當保母'] }));
  s2.hist = at([34, 35, 36]); // 國小中高：3 個月一回合，9 個月內三次
  assert.equal(chainRecords(s2, E).三C連用, 1);
  s2.hist = at([34, 36, 38]); // 6 個月一次，第一與第三次差 12 個月（窗口是『小於 12 個月』）
  assert.equal(chainRecords(s2, E).三C連用, 0);
  s2.hist = at([24, 25, 26]); // 國小低：2 個月一回合，4 個月內三次
  assert.equal(chainRecords(s2, E).三C連用, 1);
  s2.hist = at([24, 30, 40]);
  assert.equal(chainRecords(s2, E).三C連用, 0);
});

/* ───── 引擎真的在讀圖：和改圖之前寫死的公式逐項對照 ───── */
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const clamp = (x) => Math.max(0, Math.min(100, x));
const last = (st, k, n) => { const L = st.vcurves.at(-1).m; return mean(st.vcurves.filter((c) => c.m > L - 2 * n).map((c) => c[k])); }; // 最近 2n 個月（舊的最後 n 個國小回合）

test('結果軸、孩子幸福、彼此之間、開口度、承受度：和改用因果圖之前寫死的公式一致', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const bot of ['random', 'warmFirm', 'permissive']) {
    const st = played(seed, bot), h = st.hidden;
    const ax = outcomeAxes(st), w = wellbeing(st, data.identities.parentModel);
    const parent = mean([h.親子信任, h.了解度, h.溫暖陪伴, h.規則一致性]) - 0.3 * Math.max(0, h.期待壓力 - 50) - 0.3 * Math.max(0, 50 - h.父母情緒穩定度);
    const peer = mean([last(st, '同學往來', 12), h.師親信任, h.內在穩定, h.承受度]) - 0.15 * Math.max(0, h.試探度 - 40);
    const learn = mean([last(st, '成績', 12), last(st, '成績', 12), last(st, '作業', 12), h.自我效能, h.閱讀習慣, h.家庭學習環境, last(st, '睡眠', 12)]) - 0.3 * Math.max(0, last(st, '3C時間', 12) - 35);
    assert.ok(Math.abs(ax.親子 - clamp(parent)) < 1e-9 && Math.abs(ax.人際 - clamp(peer)) < 1e-9 && Math.abs(ax.學習 - clamp(learn)) < 1e-9, `${seed}/${bot}`);
    const open = clamp(30 + 7 * (st.vars.孩子主動開口 || 0) - 12 * (st.vars.孩子不再開口 || 0));
    assert.ok(Math.abs(opennessOf(st) - open) < 1e-9);
    const between = mean([h.親子信任, h.了解度, open]) - 0.25 * Math.max(0, h.期待壓力 - 50);
    assert.ok(Math.abs(w.between - clamp(between)) < 1e-9);
    const child = mean([last(st, '心情', 8), h.內在穩定, h.自我效能, h.安全感, 100 - h.期待壓力]);
    assert.ok(Math.abs(w.child - clamp(child)) < 1e-9);
    const tol = 50 + (3 - st.family.child.temperament.敏感度) * 6 + (h.安全感 - 55) * 0.25 + (h.自我效能 - 50) * 0.25 + (h.親子信任 - 55) * 0.2 - (h.期待壓力 - 30) * 0.1;
    assert.ok(Math.abs(h.承受度 - clamp(tol)) < 1e-9);
  }
});

test('改圖就改結果：把「期待壓力」對親子軸的懲罰權重改掉，引擎的結果跟著變（不是寫死在程式裡）', () => {
  const st = played(4);
  st.hidden.期待壓力 = 90;
  const a = outcomeAxes(st).親子;
  const M2 = structuredClone(M);
  M2.outcomes.親子.pen.find((p) => p.from === '期待壓力').w = 0.9;
  assert.ok(outcomeAxes(st, M2).親子 < a - 5);
  // 承受度的公式也是：改敏感度的權重，承受度跟著變
  const M3 = structuredClone(M);
  M3.edges.find((e) => e.id === 'd:敏感度→承受度').w = 12;
  const T3 = { ...data.tags, model: M3 };
  st.family.child.temperament.敏感度 = 5;
  const t0 = st.hidden.承受度;
  recomputeDerived(st, T3);
  assert.ok(st.hidden.承受度 < t0 - 5);
  recomputeDerived(st, data.tags);
  // 規則式漂移的幅度來自圖
  assert.equal(M.rules[0].d.父母情緒穩定度, -0.25); // 每月；2 個月的回合＝舊的每回合 −0.5
  assert.equal(M.rules[0].months, 4);
});

test('結果軸的權重表和因果圖一致：越高越糟的節點權重為負，其餘為正', () => {
  const W = outcomeWeights(M);
  for (const a of AXES) {
    for (const k of ['期待壓力', '試探度', '替他做主']) if (W[a][k] != null) assert.ok(W[a][k] < 0, `${a}.${k}`);
    for (const k of ['親子信任', '了解度', '溫暖陪伴', '規則一致性', '師親信任', '內在穩定', '自我效能', '閱讀習慣', '家庭學習環境']) if (W[a][k] != null) assert.ok(W[a][k] > 0, `${a}.${k}`);
  }
  assert.ok(Math.abs(W.親子.親子信任 - 0.25) < 1e-12 && Math.abs(W.親子.期待壓力 + 0.3) < 1e-12 && Math.abs(W.親子.父母情緒穩定度 - 0.3) < 1e-12);
});

test('量測用的觀察者：每個標籤的隱藏數值變化加起來等於整次的變化；沒設觀察者時不影響結果', () => {
  const seen = [];
  const st = newState(7, data, {}), st2 = newState(7, data, {});
  setTagObserver((o) => seen.push(o));
  try {
    const o = { turn: 30, stage: '國小低', ctx: {} };
    const r = applyTags(st, ['聽他說完', '放下手機陪', '敷衍帶過'], data.tags, o);
    assert.equal(seen.length, 1);
    for (const [k, d] of Object.entries(r.deltas)) assert.ok(Math.abs(Object.values(seen[0].perTag).reduce((a, t) => a + (t[k] || 0), 0) - d) < 1e-9, k);
  } finally { setTagObserver(null); }
  const r2 = applyTags(st2, ['聽他說完', '放下手機陪', '敷衍帶過'], data.tags, { turn: 30, stage: '國小低', ctx: {} });
  assert.deepEqual(st2.hidden, st.hidden);
  assert.equal(seen.length, 1);
  void r2; void bandOf;
});
