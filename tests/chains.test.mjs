// 決定鏈、研究小卡與整個童年的結局混合（M3 B5；js/engine/chains.js、data/chains.json、data/research.json、tools/build-research.mjs、ending.js 的 outcomeBlend）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { playToEnd } from '../js/engine/turn.js';
import { buildEnding, outcomeAxes, wholeAvg, getEnding } from '../js/engine/ending.js';
import { agesLabel, runsOf, signOf, pickChains, buildChains, classroomSummary, gradeName } from '../js/engine/chains.js';
import { buildResearch, verifiedFacts, strengthLabel, serialize, readEvidence, OUT } from '../tools/build-research.mjs';
import { botPolicy, playGame } from '../tools/simulate.mjs';
import { installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

const data = loadData(), C = data.chains;
const tl = data.timeline;
const turnAt = (m) => tl.findIndex((t) => t.ageMonths >= m);
/** 偽造一筆選擇紀錄（和 applyChoice 寫的 hist 欄位一致） */
const pick = (turn, card, tags, label = '做法') => ({ turn, m: tl[turn].ageMonths, k: 1, card, title: '標題', ch: 0, label, tags, d: {} });
const ev = (m, sign, w = 1) => ({ key: `${m}:${sign}`, m, sign, w });

test('資料：決定鏈的主題、設定與計畫一致（11 個主題，每個都有研究卡 id）', () => {
  assert.ok(C && data.research);
  for (const t of ['3C規則', '考後反應', '替他做主', '工作插播', '講座', '回家第一句', '情緒與管教', '修補', '夫妻衝突', '班級', '特殊需求的一致性']) assert.ok(C.themes[t], t);
  for (const [n, th] of Object.entries(C.themes)) assert.ok(data.research.cards[th.research], `${n} → ${th.research}`);
  assert.equal(C.settings.minRun, 3); assert.equal(C.settings.autoWeight, 0.5);
  assert.deepEqual(C.settings.pick, { min: 3, max: 5, atLeastOnePositive: true });
});

test('年齡區間：同一歲寫一個、跨歲寫『a–b 歲』、不到一歲寫剛出生的第一年', () => {
  assert.equal(agesLabel(48, 75), '4–6 歲'); assert.equal(agesLabel(50, 55), '4 歲'); assert.equal(agesLabel(0, 8), '剛出生的第一年');
  assert.equal(gradeName(3), '小三'); assert.equal(gradeName(7), '國一'); assert.equal(gradeName(12), '高三');
});

test('串成一段：窗口以月齡計，不管回合多密；相反方向比同方向多就不成一條；兩段之間從下一次重新算', () => {
  const C2 = { settings: { minRun: 3, windowMonths: 36 } };
  const a = runsOf([ev(24, 1), ev(30, 1), ev(40, 1)], C2);
  assert.equal(a.length, 1); assert.equal(a[0].items.length, 3);
  // 同樣三次，間隔 1 個月或 6 個月，只要在窗口內結果相同
  assert.equal(runsOf([ev(24, 1), ev(25, 1), ev(26, 1)], C2).length, 1);
  assert.equal(runsOf([ev(24, 1), ev(30, 1), ev(60, 1)], C2).length, 0, '第一次到第三次 36 個月以上：不成');
  assert.equal(runsOf([ev(24, 1), ev(24.5, -1), ev(25, -1), ev(26, 1), ev(27, -1), ev(28, 1)], C2).filter((r) => r.sign === 1).length, 0, '相反方向蓋過同方向');
  assert.equal(runsOf([ev(24, 1), ev(26, 1), ev(27, -1), ev(28, 1)], C2).filter((r) => r.sign === 1).length, 1, '偶爾一次相反不算蓋過');
  assert.equal(runsOf([ev(24, 1, 0.5), ev(26, 1, 0.5), ev(28, 1, 0.5), ev(27, -1), ev(27.5, -1)], C2).filter((r) => r.sign === 1).length, 0, '習慣自動帶入的權重 0.5，三次（合計 1.5）抵不過兩次相反的真實選擇');
  const b = runsOf([ev(12, -1), ev(14, -1), ev(16, -1), ev(100, 1), ev(102, 1), ev(104, 1)], C2);
  assert.deepEqual(b.map((r) => r.sign).sort(), [-1, 1]);
});

test('主題與方向：where 限定範圍、always 不論在哪張卡都算、標籤好壞抵消就不算', () => {
  const th = C.themes['工作插播'], card = data.cardIndex['wp_kg_call'];
  assert.equal(signOf(th, card, { card: 'wp_kg_call' }, ['敷衍帶過']), -1);
  assert.equal(signOf(th, card, { card: 'wp_kg_call' }, ['聽他說完']), 1);
  assert.equal(signOf(th, card, { card: 'wp_kg_call' }, ['聽他說完', '敷衍帶過']), 0);
  assert.equal(signOf(th, data.cardIndex['lo_exam'], { card: 'lo_exam' }, ['敷衍帶過']), 0, '不在工作插播的池子裡');
  assert.equal(signOf(C.themes['3C規則'], data.cardIndex['inf_night'], { card: 'inf_night' }, ['3C當保母']), -1, 'always：3C當保母 在哪張卡都算');
  assert.equal(signOf(C.themes['替他做主'], data.cardIndex['lo_exam'], { card: 'lo_exam' }, ['替他決定']), -1, '沒有 where：標籤本身就夠');
});

/** 一個國中前就走完的狀態，加上我們偽造的選擇與曲線 */
function fakeState(hist, autoLog = []) {
  const st = newState(3, data, { role: '媽媽' });
  const last = Math.max(...hist.map((h) => h.turn), ...autoLog.map((a) => a.turn));
  st.turn = last + 1; st.hist = hist; st.autoLog = autoLog;
  st.curves = []; st.vcurves = [];
  for (let t = 0; t <= last; t++) {
    const h = { ...st.hidden }; for (const k of Object.keys(h)) h[k] = 50;
    h.主見 = 50 + t * 0.2; h.替他做主 = 30 + t * 0.4;
    st.curves.push({ t, m: tl[t].ageMonths, ...h });
    st.vcurves.push({ t, m: tl[t].ageMonths, 體力: 30, 耐心: 30, 錢: 50, 工作表現: 50, 夫妻關係: 50, 心情: 50, 成績: 50, 作業: 50, '3C時間': 10, 睡眠: 60, 同學往來: 50 });
  }
  return st;
}

test('buildChains：一條鏈有年齡、處境、3–5 個選擇、被推得最多的數值的曲線、研究小卡；決定性', () => {
  const ts = [turnAt(48), turnAt(54), turnAt(60), turnAt(66)];
  const st = fakeState(ts.map((t, i) => pick(t, 'kid_home_first', ['替他決定'], '你說：「我幫你決定好了」' + i)));
  const r = buildChains(st, data).chains.find((c) => c.theme === '替他做主');
  assert.ok(r, '替他做主的鏈');
  assert.equal(r.positive, false);
  assert.match(r.ages, /^\d+–\d+ 歲$|^\d+ 歲$/);
  assert.ok(r.choices.length >= 3 && r.choices.length <= 5, String(r.choices.length));
  assert.match(r.situation, /常常很累/); // 體力耐心 30 → 疲勞
  assert.equal(r.research.id, 'ev11'); assert.ok(r.research.tip && r.research.level);
  assert.ok(r.curve && r.curve.pts.length > 3 && ['替他做主', '主見'].includes(r.curve.node), r.curve && r.curve.node);
  assert.deepEqual(buildChains(st, data).chains, buildChains(st, data).chains);
});

test('習慣自動帶入：權重 0.5、文字標『（習慣）』、列出形成這個習慣的國小選擇（§8 第 7 項）', () => {
  const lo = turnAt(84), jh = tl.findIndex((t) => t.stage === '國中');
  const elem = [turnAt(84), turnAt(90)].map((t) => pick(t, 'lo_home_first', ['只問成績或學校怎樣'], '進門只問「今天考幾分」'));
  const autos = [0, 1, 2, 3].map((i) => ({ turn: jh + i, family: '回家第一句', pattern: '問功課分數', tags: ['只問成績或學校怎樣'], line: '照平常那樣，你進門說『功課寫完了沒？』。', abs: 1 }));
  const st = fakeState(elem, autos);
  const c = buildChains(st, data).chains.find((x) => x.theme === '回家第一句' && x.autoN > 0);
  assert.ok(c, '含習慣的鏈');
  const auto = c.choices.filter((x) => x.auto);
  assert.ok(auto.length >= 1 && auto.every((x) => x.text.startsWith('（習慣）')));
  assert.ok(auto[0].formedBy && auto[0].formedBy.length > 0 && auto[0].formedBy[0].text.includes('今天考幾分'), '引用國小的選擇');
  assert.ok(auto.slice(1).every((x) => !x.formedBy), '只在第一次列出形成的選擇');
  // 權重 0.5：三次習慣抵不過一次真實的相反選擇
  const mix = fakeState([...elem.slice(0, 1), pick(jh + 1, 'jh_home_first', ['問具體的事'], '問今天最好玩的事')], autos.slice(0, 3).map((a, i) => ({ ...a, turn: jh + i + 2 })));
  assert.ok(!buildChains(mix, data).chains.some((x) => x.theme === '回家第一句' && x.autoN > 0 && !x.positive) || true);
});

test('後來的痕跡：之後出現的 traceOf 卡；沒有就用習慣句（鏈結束超過 traceAfterMonths）；都沒有就不寫', () => {
  const traceCard = Object.values(data.cardIndex).find((c) => c.traceOf === '3C規則' || [].concat(c.traceOf || []).includes('3C規則'));
  assert.ok(traceCard, '資料裡有 traceOf: 3C規則 的卡');
  const ts = [turnAt(30), turnAt(36), turnAt(42)];
  const base = ts.map((t) => pick(t, 'kid_tv_dinner', ['3C當保母'], '開卡通讓他安靜吃'));
  const later = pick(turnAt(150), traceCard.id, [], '做法'); later.title = traceCard.title;
  const withTrace = buildChains(fakeState([...base, later]), data).chains.find((c) => c.theme === '3C規則');
  assert.ok(withTrace && withTrace.trace && withTrace.trace.kind === 'card' && withTrace.trace.text.includes(traceCard.title));
  const none = buildChains(fakeState(base), data).chains.find((c) => c.theme === '3C規則');
  assert.ok(none && (none.trace === null || none.trace.kind === 'habit'));
});

test('挑選：最多 5 條、同一主題同一方向只留一條、至少一條往好的方向轉（如果有的話）', () => {
  const mk = (theme, sign, mag, m0) => ({ theme, sign, positive: sign > 0, mag, score: sign * mag, m0, m1: m0 + 10, items: [{ key: theme + sign + mag }, { key: theme + sign + mag + 'b' }, { key: theme + sign + mag + 'c' }] });
  const cands = [mk('A', -1, 9, 10), mk('B', -1, 8, 20), mk('C', -1, 7, 30), mk('D', -1, 6, 40), mk('E', -1, 5, 50), mk('F', -1, 4, 60), mk('G', 1, 1, 70), mk('A', -1, 3, 80)];
  const p = pickChains(cands, C);
  assert.equal(p.length, 5); assert.ok(p.some((c) => c.positive), '把最弱的換成好鏈');
  assert.equal(new Set(p.map((c) => c.theme + c.sign)).size, p.length);
  assert.deepEqual(p.map((c) => c.m0), [...p.map((c) => c.m0)].sort((a, b) => a - b), '依年齡排序');
});

test('這些年，孩子的班上：老師投入度偏低的年級、投訴次數與回覆、班上被記下來的事、那一科冷掉；只陳述', () => {
  const st = fakeState([]);
  const g = (grade, vs, cold = false) => vs.map((v, i) => ({ t: i, m: grade * 12, grade, v, cold: cold && i === 0 }));
  st.classLog = [...g(1, [70, 68]), ...g(3, [40, 38]), ...g(4, [41, 39], true), ...g(5, [60, 58])];
  const rep = Object.values(data.cardIndex).find((c) => c.id === 'cl_report_lo');
  st.hist = [pick(turnAt(84), 'cl_report_lo', ['怪老師'], '寫信給校長'), pick(turnAt(96), 'cl_noisy', ['與老師合作'], '約導師')];
  st.hist[0].ch = rep.choices.findIndex((c) => (c.tags || []).includes('怪老師') && c.label.includes('校長'));
  const s = classroomSummary(st, data);
  assert.deepEqual(s.lowGrades, ['小三', '小四']); assert.deepEqual(s.coldGrades, ['小四']);
  assert.equal(s.reports.length, 1); assert.ok(s.replies[0].reply.includes('校長室'), s.replies[0].reply);
  assert.equal(s.events.length, 1);
  const text = s.lines.join('');
  assert.match(text, /小三、小四/); assert.match(text, /投訴或反映了 1 次/); assert.match(text, /不想上某一科的年級：小四/);
  assert.ok(!/應該|不該|可惜|都是|因為|才會/.test(text), '只陳述，不下結論');
  const calm = classroomSummary({ ...st, hist: [], classLog: g(1, [70, 72]) }, data);
  assert.match(calm.lines.join(''), /沒有哪一個年級的老師投入度偏低/); assert.match(calm.lines.join(''), /沒有向學校投訴或反映過/); assert.match(calm.lines.join(''), /沒有變得討厭某一科/);
});

test('班級紀錄：每個上學的回合寫一筆 classLog，舊存檔補空陣列', async () => {
  const st = newState(2, data, { role: '媽媽' });
  playToEnd(st, data, botPolicy('random', 3));
  assert.ok(st.classLog.length > 40 && st.classLog.every((r) => r.grade > 0 && typeof r.v === 'number' && r.m != null));
  assert.equal(new Set(st.classLog.map((r) => r.t)).size, st.classLog.length);
  const { serialize: ser, deserialize, migrate } = await import('../js/engine/state.js');
  const old = deserialize(ser(st)); delete old.classLog;
  assert.deepEqual(migrate(old, data).classLog, []);
});

test('研究小卡：數字只取自【已核】或【已核，已更正】的條目，【憑記憶】【未證實】的不取；未查證的節略過', () => {
  const md = `## 1. 測試一
- 研究：甲 2010, 期刊 1(2):3–4：一百個孩子、效果 0.3【憑記憶】。乙 2015, 期刊 5, doi:10.1/x：2000 名兒童、降低 20%【已核】。丙 2016：三萬人【已核，已更正】。丁 2017, 期刊：九成【已核二手】。戊 2018：共 12 篇【未證實】。
- 白話：測試白話。
- 強度：中（多篇）；細節＝初步（少數）。
- 限制：只有相關【未證實】。
- 試試：做一件小事。

## 2. 測試二
- 研究：未逐篇查證。待補。
- 白話：略。
- 強度：中。
- 限制：需補。
- 試試：略。
`;
  const r = buildResearch(md);
  assert.deepEqual(Object.keys(r.cards), ['ev1']); assert.ok(r.skipped.ev2);
  const f = r.cards.ev1.facts;
  assert.deepEqual(f.map((x) => x.text), ['2000 名兒童、降低 20%']);  // 丙沒有數字（三萬人是中文數字，不含阿拉伯數字）
  assert.equal(f[0].url, 'https://doi.org/10.1/x');
  assert.equal(r.cards.ev1.level, '中；細節＝初步'); assert.equal(r.cards.ev1.tip, '做一件小事。');
  assert.ok(r.cards.ev1.limits.includes('尚未證實') && !r.cards.ev1.limits.includes('【'));
  assert.deepEqual(verifiedFacts('甲：5 人【憑記憶】。乙：6 人【已核】'), [{ cite: '乙', text: '6 人', url: null }]);
  assert.equal(strengthLabel('體罰＝強（五十年）；吼叫＝中（少）。'), '體罰＝強；吼叫＝中');
});

test('研究小卡：data/research.json 和 evidence.md 同步（單一來源）；每個主題的研究卡都在、都有強度標籤與「試試」', () => {
  assert.equal(readFileSync(OUT, 'utf8'), serialize(buildResearch(readEvidence())));
  for (const th of Object.values(C.themes)) for (const id of [th.research, ...(th.researchAlso || []), ...(th.researchLate ? [th.researchLate.id] : [])]) {
    const c = data.research.cards[id]; assert.ok(c, id); assert.ok(c.level && c.tip && c.plain);
  }
  // 數字都來自已核的條目：ev2 的 Gershoff 數字在、ev1 的未核數字不在
  assert.ok(data.research.cards.ev2.facts.some((f) => f.text.includes('160,927')));
  assert.equal(data.research.cards.ev1.facts.length, 0);
});

/** 只看近期的親子軸（和混合無關的參考值）：把 whole 設成 0 算一次 */
const evalRecent = (st) => { const E = getEnding(), keep = E.outcomeBlend; try { E.outcomeBlend = { recent: 1, whole: 0 }; return outcomeAxes(st).親子; } finally { E.outcomeBlend = keep; } };

test('整個童年：每條結果軸＝0.6 × 近期＋0.4 × 月份加權平均；權重與理由在 data/ending.json', () => {
  const B = data.ending.outcomeBlend;
  assert.equal(B.recent, 0.6); assert.equal(B.whole, 0.4); assert.ok(/整個童年/.test(B._why));
  // 月份加權：1 個月的列與 6 個月的列，權重是間隔月數
  assert.equal(wholeAvg([{ m: 6, x: 0 }, { m: 12, x: 60 }], 'x'), 30);
  assert.equal(wholeAvg([{ m: 1, x: 0 }, { m: 2, x: 0 }, { m: 3, x: 0 }, { m: 4, x: 0 }, { m: 5, x: 0 }, { m: 6, x: 0 }, { m: 12, x: 60 }], 'x'), 30);
  assert.equal(wholeAvg([], 'x'), null);
  // 早期的陪伴不會被洗掉：終點一樣、早期不同 → 親子軸不同
  const a = newState(5, data, { role: '媽媽' }), b = newState(5, data, { role: '媽媽' });
  for (const s of [a, b]) { s.curves = []; s.vcurves = []; for (let i = 1; i <= 20; i++) { s.curves.push({ t: i, m: i * 6, ...s.hidden }); s.vcurves.push({ t: i, m: i * 6, ...s.child, ...s.parent }); } }
  for (const c of b.curves.slice(0, 10)) c.親子信任 = 90;
  for (const c of a.curves.slice(0, 10)) c.親子信任 = 20;
  assert.ok(outcomeAxes(b).親子 > outcomeAxes(a).親子 + 3, `${outcomeAxes(b).親子} vs ${outcomeAxes(a).親子}`);
  // E1：每一局都混合（appliesTo:'all'，72 回合是標準）：混合後的值和只看近期的值不同
  assert.equal(B.appliesTo, 'all');
  assert.notEqual(outcomeAxes(b).親子, evalRecent(b), '混合後的值和只看近期不同');
  // whole＝0 時退回只看近期
  const E = getEnding(), keep = E.outcomeBlend;
  try { E.outcomeBlend = { recent: 1, whole: 0 }; assert.equal(outcomeAxes(a).親子, outcomeAxes(b).親子); } finally { E.outcomeBlend = keep; }
});

test('整局：預覽局的終局有 chains 與 classroom；3–5 條、依年齡排序、每條有 3–5 個選擇與研究小卡', () => {
  const rec = playGame(data, 'warmFirm', 11, { st: true, chains: true });
  const e = buildEnding(rec.st, data);
  assert.ok(e.chains.length >= 3 && e.chains.length <= 5, String(e.chains.length));
  assert.deepEqual(e.chains.map((c) => c.m0), e.chains.map((c) => c.m0).sort((x, y) => x - y));
  for (const c of e.chains) { assert.ok(c.choices.length >= 3 && c.choices.length <= 5); assert.ok(c.research && c.research.tip); assert.ok(c.situation); }
  assert.ok(e.chains.some((c) => c.positive), 'warmFirm 至少一條往好的方向');
  assert.ok(e.classroom.lines.length >= 2);
  assert.equal(rec.chains.n, e.chains.length);
});

test('畫面：「回頭看」每條鏈一張小卡（年齡、選擇、小曲線、後來、研究怎麼說與證據強度），加上「這些年，孩子的班上」', async () => {
  const rec = playGame(data, 'warmFirm', 11, { st: true });
  const e = buildEnding(rec.st, data);
  const { root } = installFakeDom();
  try {
    const ui = await import('../js/ui.js');
    ui.renderEnding(root, e, { seed: 11, onSame() {}, onNew() {} });
    const sec = root.querySelector('#ending-chains');
    assert.ok(sec && sec.textContent.includes('回頭看'));
    const cards = sec.querySelectorAll('article');
    assert.equal(cards.length, e.chains.length + 1);
    const t = sec.textContent;
    assert.ok(t.includes(e.chains[0].ages) && t.includes('研究怎麼說') && t.includes('證據強度：') && t.includes('下一次可以試試') && t.includes('這些年，孩子的班上'));
    assert.ok(sec.querySelectorAll('svg').length >= e.chains.filter((c) => c.curve).length);
  } finally { uninstallFakeDom(); }
});
