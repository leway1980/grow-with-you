// 路線（M3 B4；js/engine/paths.js、data/paths.json、離家三張卡的去向文字、中途離校的鏈、tools/lint/paths.mjs）：
// resolver 是決定性的、興趣是主要的驅動力（成績其次）、入伍只給男生、離家的文字每個去向恰好一個、反事實（強制不同去向，離家前的幸福完全相同）、
// model.json 的結果軸不讀學制與去向、fx_choose_jh 的時間、中途離校的前兆與鏈、預覽冒煙測試（幾種去向都玩得到離家）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, loadRaw } from '../tools/data-node.mjs';
import { newState, serialize, deserialize } from '../js/engine/state.js';
import { buildCtx, applyChoice, pickText, setRouteResolver } from '../js/engine/events.js';
import { startTurn, chooseCard, nextCard, finishTurn } from '../js/engine/turn.js';
import { botPolicy } from '../tools/bots.mjs';
import { wellbeing, outcomeAxes } from '../js/engine/ending.js';
import { resolveRoute, schoolProbs, destProbs, setDestination, setSchoolType, featuresOf, dropoutP, lowMoodStreak, childWants } from '../js/engine/paths.js';
import lintPaths, { DROP_VALUES, CHAIN } from '../tools/lint/paths.mjs';
import { lintModel } from '../tools/lint-model.mjs';

const raw = loadRaw(), data = loadData(raw), P = data.paths;
const DESTS = P.destinations.order, TYPES = Object.keys(P.schoolTypes);
const T = (stage) => data.timeline.findIndex((t) => t.stage === stage);
const HS = data.timeline.findIndex((t) => t.fixed.includes('fx_choose_hs')), SH0 = T('高中'), LV0 = T('離家'), GRAD = data.timeline.findIndex((t) => t.fixed.includes('fx_sh_grad'));

/** 玩到第 turn 回合開始（還沒開始那個回合）。policy 是機器人名稱。 */
function playTo(seed, turn, bot = 'warmFirm') {
  const st = newState(seed, data, { role: seed % 2 ? '媽媽' : '爸爸' });
  const pol = botPolicy(bot, seed);
  while (st.turn < turn && !st.ended) {
    const r = startTurn(st, data);
    if (r.card) { let v = r.card, rw = r.raw; for (let g = 0; g < 3; g++) { const o = chooseCard(st, data, pol.choose(st, v, rw, data)); if (!o.more) break; ({ card: v, raw: rw } = nextCard(st, data)); } }
    finishTurn(st, data);
  }
  return st;
}
/** 從目前狀態玩到結束；每個回合都選第 0 個選項（所有去向都看得到，效果也相同）。回傳每個回合看到的卡文字 */
function playFixed(st) {
  const seen = [];
  while (!st.ended) {
    const r = startTurn(st, data);
    if (r.ended) break;
    if (r.card) { let v = r.card, rw = r.raw; for (let g = 0; g < 3; g++) { seen.push({ turn: st.turn, id: v.id, text: v.text, labels: v.choices.map((c) => c.label) }); const o = chooseCard(st, data, 0); if (!o.more) break; ({ card: v, raw: rw } = nextCard(st, data)); } }
    finishTurn(st, data);
  }
  return seen;
}
const clone = (st) => deserialize(serialize(st));
const wb = (st) => { const w = wellbeing(st, data.identities.parentModel); return [w.child, w.parent, w.between]; };

test('資料：paths.json 與 manifest 的 extras 一起載入；網頁版 prepareData 只收 events／slots，paths 掛在 events.paths', () => {
  assert.ok(raw.events.paths && data.paths === raw.events.paths);
  assert.deepEqual(DESTS, ['大學', '科大', '五專續讀', '就業', '重考', '出國', '在家', '入伍']);
  assert.deepEqual(TYPES, ['普高', '技高', '綜高', '五專', '自學', '未升學']);
  assert.ok(Math.abs(TYPES.reduce((a, k) => a + P.schoolTypes[k].base, 0) - 1) < 0.002);
  assert.equal(P.schoolTypes.普高.base + P.schoolTypes.技高.base >= 0.8, true);
});

test('lint 外掛：路線的資料檢查 0 個錯誤；故意拿掉一個去向的版本會被抓到', () => {
  const r = lintPaths({ raw, data, cards: raw.events.cards });
  assert.deepEqual(r.errors, []);
  const c = data.cardIndex.fx_leave_day, keep = c.textIf;
  c.textIf = keep.filter((t) => !t.if.includes('重考'));
  try { assert.ok(lintPaths({ raw, data, cards: raw.events.cards }).errors.some((e) => /重考/.test(e))); } finally { c.textIf = keep; }
});

test('resolveRoute：同一個種子、同一個偏好結果相同；不同偏好可以不同；重新載入存檔也一樣', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const a = playTo(seed, HS), b = playTo(seed, HS);
    const ra = resolveRoute(a, data, '學制', '孩子'), rb = resolveRoute(b, data, '學制', '孩子');
    assert.equal(ra.value, rb.value); assert.deepEqual(ra.probs, rb.probs);
    const c = clone(playTo(seed, HS)); assert.equal(resolveRoute(c, data, '學制', '孩子').value, ra.value);
    const s2 = playTo(seed, HS); assert.equal(schoolProbs(s2, P, '孩子').普高, ra.probs.普高);
  }
  let differ = 0;
  for (let seed = 1; seed <= 40; seed++) { const a = playTo(seed, HS, 'random'); const x = resolveRoute(clone(a), data, '學制', '孩子').value, y = resolveRoute(clone(a), data, '學制', '父母').value; if (x !== y) differ++; }
  assert.ok(differ > 0, '父母主導與孩子主導應該會讓一些局的結果不同');
});

test('resolveRoute 透過 A3 的 setRouteResolver 登記：選項寫 route 就會寫入 st.vars.學制 與旗標，並把一句話接在結果後面；沒登記時什麼都不做', () => {
  const st = playTo(3, HS);
  const card = data.cardIndex.fx_choose_hs, tl = data.timeline[st.turn];
  const out = applyChoice(st, data, card, 0, tl, () => 0.5);
  assert.ok(TYPES.includes(st.vars.學制), st.vars.學制);
  assert.ok(st.flags[`學制_${st.vars.學制}`]);
  assert.match(out.result, /志願表|志願/);
  assert.equal(st.vars.志願偏好, '孩子');
  assert.equal(buildCtx(st, tl).學制, st.vars.學制);
  // 沒登記：行為中性
  setRouteResolver(null);
  try {
    const st2 = playTo(3, HS), o2 = applyChoice(st2, data, card, 0, data.timeline[st2.turn], () => 0.5);
    assert.equal(st2.vars.學制, ''); assert.ok(!/第一志願/.test(o2.result));
  } finally { loadData(raw); } // prepareData 會重新登記
});

test('興趣是主要的驅動力，成績其次：動手做興趣高一個標準差對技高的影響，大於成績低一個標準差；經濟與孩子自己的偏好會調整', () => {
  const base = playTo(5, HS);
  const mk = (f) => { const s = clone(base); f(s); return s; };
  const N = P.norm;
  const hi = mk((s) => { s.interest.動手做 = N.interest.mean + N.interest.sd; s.interest.美術 = N.interest.mean + N.interest.sd; }), lo = mk((s) => { s.interest.動手做 = N.interest.mean - N.interest.sd; s.interest.美術 = N.interest.mean - N.interest.sd; });
  const gHi = mk((s) => { s.child.成績 = N.grade.mean + N.grade.sd; }), gLo = mk((s) => { s.child.成績 = N.grade.mean - N.grade.sd; });
  const p = (s, pf = '孩子') => schoolProbs(s, P, pf).技高;
  const dInterest = p(hi) - p(lo), dGrade = p(gLo) - p(gHi);
  assert.ok(dInterest > 0 && dGrade > 0, `興趣 ${dInterest}、成績 ${dGrade}`);
  assert.ok(dInterest > 1.4 * dGrade, `興趣的影響 ${dInterest.toFixed(3)} 要明顯大於成績的影響 ${dGrade.toFixed(3)}`);
  // 經濟：吃緊的家庭技高比較多、寬裕比較少
  const tight = mk((s) => { s.family.econ = '吃緊'; }), rich = mk((s) => { s.family.econ = '寬裕'; });
  assert.ok(p(tight) > p(rich));
  // 孩子自己決定時興趣的比重大；父母決定時成績與父母的期待（普高）比重大
  assert.ok(Math.abs(p(hi, '孩子') - p(lo, '孩子')) > Math.abs(p(hi, '父母') - p(lo, '父母')));
  let sumP = 0, sumC = 0; // 平均來說，父母主導比孩子主導更偏向普高（個別孩子的興趣若就是學術，孩子主導也會選普高）
  for (let seed = 1; seed <= 30; seed++) { const s = playTo(seed, HS, 'random'); sumP += schoolProbs(s, P, '父母').普高; sumC += schoolProbs(s, P, '孩子').普高; }
  assert.ok(sumP > sumC, `${sumP} vs ${sumC}`);
  // 每個機率表加起來是 1
  for (const s of [hi, lo, gHi, gLo, tight, rich]) for (const pf of ['孩子', '一起', '父母', '距離', '親友']) assert.ok(Math.abs(Object.values(schoolProbs(s, P, pf)).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});

test('卡片文字從不把成績寫成選學制的理由：outcome 的句子與 fx_choose_hs 的結果都不含成績、分數、會考成績這類字眼', () => {
  const words = /成績|分數|考不好|考得|排名|PR|落點/;
  for (const [k, O] of Object.entries(P.outcome)) { if (k === '_why') continue; const strs = typeof O === 'string' ? [O] : [O.line, ...Object.values(O.why || {}), ...(O.whyIf || []).map((w) => w.text)]; for (const s of strs) assert.ok(!words.test(s), `${k}：${s}`); }
  const c = data.cardIndex.fx_choose_hs;
  for (const ch of c.choices) { assert.ok(ch.route && ch.route.decide === '學制', ch.label); assert.ok(!(ch.setFlags || []).length, '選項不再直接設旗標'); assert.ok(!words.test(ch.result || ''), ch.result); }
  // 實際玩出來的結果句子
  for (let seed = 1; seed <= 30; seed++) { const st = playTo(seed, HS, 'random'); const r = resolveRoute(st, data, '學制', ['孩子', '父母', '一起', '距離'][seed % 4]); assert.ok(!words.test(r.result), r.result); }
});

test('入伍只給男生：機率表沒有入伍；resolveRoute 與 setDestination 都不會給女生入伍；男生的入伍有機率', () => {
  let males = 0, enlistedMale = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const st = playTo(seed, GRAD, 'random');
    st.vars.學制 = st.vars.學制 || '技高';
    const pr = destProbs(st, P, 'auto');
    if (st.family.child.sex === '女') {
      assert.ok(!('入伍' in pr), `女生 ${seed} 的機率表有入伍`);
      assert.throws(() => setDestination(clone(st), '入伍'), /男生/);
      for (const pf of ['孩子', '父母', '一起', 'auto']) assert.notEqual(resolveRoute(clone(st), data, '去向', pf).value, '入伍');
    } else { males++; assert.ok(st.vars.學制 === '五專' || pr.入伍 > 0); if (resolveRoute(clone(st), data, '去向', 'auto').value === '入伍') enlistedMale++; }
  }
  assert.ok(males > 10);
  assert.ok(enlistedMale >= 0);
});

test('去向：每一局到離家前都有去向；中途離校在家的孩子在家的機率變大、工作或職訓的孩子就業變大；學制五專只會是五專續讀為主', () => {
  const st = playTo(7, GRAD, 'warmFirm');
  assert.ok(DESTS.includes(st.vars.去向) || !st.vars.去向); // 還沒到 fx_sh_grad 的選擇
  const a = clone(st); a.vars.學制 = '普高'; a.vars.中途離校 = ''; const b = clone(a); b.vars.中途離校 = '在家'; const c = clone(a); c.vars.中途離校 = '工作';
  assert.ok(destProbs(b, P, '孩子').在家 > destProbs(a, P, '孩子').在家 * 2);
  assert.ok(destProbs(c, P, '孩子').就業 > destProbs(a, P, '孩子').就業 * 2);
  const f = clone(a); f.vars.學制 = '五專';
  assert.ok(destProbs(f, P, '孩子').五專續讀 > 0.8);
  for (let seed = 1; seed <= 30; seed++) { const s = playTo(seed, LV0, 'random'); assert.ok(DESTS.includes(s.vars.去向), `種子 ${seed} 到離家沒有去向`); }
});

test('離家三張卡：每個去向 × 性別 × 經濟 × 住宿都恰好一個去向版本的文字，離家那一天的文字有該去向的標記詞；六種場面各自不同', () => {
  const legs = data.timeline.filter((t) => t.stage === '離家');
  assert.equal(legs.length, 3);
  const texts = {};
  for (const tl of legs) {
    const card = data.cardIndex[tl.fixed[0]];
    for (const d of DESTS) for (const sex of ['男', '女']) {
      if (sex === '女' && d === '入伍') continue;
      const st = newState(2, data, {}); st.family.child.sex = sex; st.family.econ = '小康'; st.vars.去向 = d; st.flags.住宿_外地 = true; st.child.成績 = 70;
      const ctx = buildCtx(st, tl);
      const hits = (card.textIf || []).filter((t) => /去向/.test(t.if)).filter((t) => ctx && require_(t.if, ctx));
      assert.equal(hits.length, 1, `${card.id}／${d}／${sex}`);
      (texts[card.id] ||= {})[d] = pickText(card, ctx, st);
    }
  }
  for (const id of Object.keys(texts)) assert.equal(new Set(Object.values(texts[id])).size >= 7, true, `${id} 的去向文字太少種`);
  const day = texts.fx_leave_day;
  assert.match(day.入伍, /入伍前一晚/); assert.match(day.就業, /第一天上班/); assert.match(day.重考, /重考班開課/); assert.match(day.出國, /登機證/); assert.match(day.在家, /普通早上/); assert.match(day.大學, /後車廂/); assert.match(day.五專續讀, /宿舍/);
  // 在家的那天不是失敗：文字裡有『清單』上的下一步，沒有失敗字眼
  assert.match(day.在家, /修腳踏車/); assert.ok(!/失敗|沒出息|還在家|窩在家|啃老/.test(Object.values(texts).map((o) => o.在家).join('')));
});
import { compile } from '../js/engine/events.js';
const require_ = (expr, ctx) => !!compile(expr)(ctx);

test('反事實：從離家前的同一個狀態，強制不同去向，離家三回合結束時的幸福、三條軸、可見數值與隱藏數值完全相同（去向不改任何結果，只改自己的文字）', () => {
  let n = 0;
  for (const [seed, bot] of [[1, 'warmFirm'], [2, 'permissive'], [3, 'controlling'], [4, 'random'], [5, 'warmFirm'], [6, 'tiredLazy']]) {
    const base = playTo(seed, GRAD, bot);
    const sex = base.family.child.sex;
    const outs = [];
    for (const d of DESTS) {
      if (sex === '女' && d === '入伍') continue;
      const st = clone(base);
      st.vars.學制 = st.vars.學制 || '普高'; setDestination(st, d);
      playFixed(st);
      assert.equal(st.turn, 72, `${seed}／${d} 沒有玩到 72`);
      outs.push({ d, w: wb(st), ax: Object.values(outcomeAxes(st)), vis: [st.parent, st.child].map((o) => Object.values(o)).flat(), hid: Object.values(st.hidden) });
      n++;
    }
    for (const o of outs.slice(1)) for (const k of ['w', 'ax', 'vis', 'hid']) o[k].forEach((x, i) => assert.ok(Math.abs(x - outs[0][k][i]) < 1e-9, `${seed}／${o.d} 的 ${k}[${i}] 與 ${outs[0].d} 不同：${x} vs ${outs[0][k][i]}`));
  }
  assert.ok(n >= 40);
});

test('報告（不擋）：自然局中各去向的孩子幸福，依機器人與經濟', (t) => {
  const rows = {};
  for (const bot of ['warmFirm', 'permissive', 'controlling', 'random']) for (let seed = 1; seed <= 25; seed++) {
    const st = playTo(seed, 72, bot);
    const k = `${bot}／${st.family.econ}`; (rows[k] ||= {}); (rows[k][st.vars.去向] ||= []).push(wb(st)[0]);
  }
  const m = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  t.diagnostic('孩子幸福平均（去向：n，平均）\n' + Object.entries(rows).map(([k, o]) => `${k}　` + Object.entries(o).map(([d, a]) => `${d} ${a.length}/${m(a)}`).join('　')).join('\n'));
});

test('model.json 的結果軸、邊、推算值不讀 學制、志願偏好、去向、中途離校（沒有一條路是失敗結局）；tags.json 的標籤也不寫它們', () => {
  const FORBID = ['學制', '志願偏好', '去向', '中途離校'];
  const M = raw.model;
  for (const [ax, O] of Object.entries(M.outcomes)) for (const it of [...(O.mean || []), ...(O.pen || [])]) assert.ok(!FORBID.includes(it.from), `outcomes.${ax} 讀了 ${it.from}`);
  for (const e of M.edges) { assert.ok(!FORBID.includes(e.from) && !FORBID.includes(e.to), `邊 ${e.id}`); }
  for (const [k, D] of Object.entries(M.derived || {})) assert.ok(!JSON.stringify(D).match(new RegExp(FORBID.join('|'))), `derived.${k}`);
  assert.ok(!JSON.stringify(raw.tags.tags).match(new RegExp(FORBID.join('|'))));
  for (const n of FORBID) { assert.ok(M.nodes[n], `${n} 要登記成節點`); assert.equal(M.nodes[n].layer, 2); }
  // ending.js 的幸福與軸的函式不讀它們：把這四個值改掉，三條軸與三種幸福不變
  const st = playTo(2, 72, 'warmFirm'), a = [wb(st), Object.values(outcomeAxes(st))];
  st.vars.學制 = '未升學'; st.vars.去向 = '在家'; st.vars.中途離校 = '在家'; st.vars.志願偏好 = '父母';
  assert.deepEqual([wb(st), Object.values(outcomeAxes(st))], a);
  assert.deepEqual(lintModel(raw, data, raw.events.cards).errors.filter((e) => /學制|去向|中途離校|志願偏好/.test(e)), []);
});

test('fx_choose_jh 的時間：「國中開學前一週」排在國小六年級的期末與暑假（假期的回合），是畢業典禮那一回合的第二張卡；國中第一回合不再有它', () => {
  const tl = data.timeline.filter((t) => t.fixed.includes('fx_choose_jh'));
  assert.equal(tl.length, 1);
  assert.equal(tl[0].grade, 6); assert.equal(tl[0].vacation, true); assert.match(tl[0].label, /期末與暑假/);
  assert.deepEqual(tl[0].fixed, ['fx_graduation', 'fx_choose_jh'], '畢業典禮是第一張，開學前一週是第二張');
  assert.ok(tl[0].turn < data.calendar.playableTurns, '在 CI 的 50 回合內（國小畢業那個暑假）');
  const jh = data.timeline.find((t) => t.stage === '國中');
  assert.ok(!jh.fixed.includes('fx_choose_jh'));
  assert.match(data.cardIndex.fx_choose_jh.text, /^國中開學前一週/);
  assert.deepEqual(data.cardIndex.fx_choose_jh.stages, ['國小中高']);
});

test('中途離校的前兆：沒有訊號是 0；心情低連續、同學往來低、被霸凌過各自是訊號；風險因子把機率往上推；自學與未升學不會出現', () => {
  const st = playTo(4, SH0 + 1, 'warmFirm');
  const calm = clone(st); calm.child.同學往來 = 70; calm.flags = {}; calm.vcurves.forEach((c) => { c.心情 = 70; });
  assert.equal(dropoutP(calm).p, 0);
  const lowPeer = clone(calm); lowPeer.child.同學往來 = 30;
  const lowMood = clone(calm); lowMood.vcurves.slice(-3).forEach((c) => { c.心情 = 30; });
  const bullied = clone(calm); bullied.flags.霸凌_發生過 = true; bullied.child.同學往來 = 50;
  for (const s of [lowPeer, lowMood, bullied]) assert.ok(dropoutP(s).p > 0);
  assert.equal(lowMoodStreak(lowMood, P.dropout.moodCut), 3);
  const worse = clone(lowPeer); worse.flags.霸凌_發生過 = true; worse.child.同學往來 = 20; worse.hidden.承受度 = 20; worse.family.econ = '吃緊'; worse.vars.學制 = '技高';
  assert.ok(dropoutP(worse).p > 2 * dropoutP(lowPeer).p);
  assert.ok(dropoutP(worse).p <= P.dropout.pMax);
  for (const t of ['自學', '未升學']) { const s = clone(worse); s.vars.學制 = t; assert.equal(dropoutP(s).p, 0); }
  // ctx：高中才有機率；在學 的條件變數
  const ctxHS = buildCtx(worse, data.timeline[SH0]), ctxJH = buildCtx(worse, data.timeline[SH0 - 3]);
  assert.ok(ctxHS.離校機率 > 0); assert.equal(ctxJH.離校機率, 0);
  assert.equal(buildCtx(Object.assign(clone(worse), { vars: { ...worse.vars, 中途離校: '在家', 學制: '普高' } }), data.timeline[SH0]).在學, false);
  assert.equal(buildCtx(Object.assign(clone(worse), { vars: { ...worse.vars, 中途離校: '轉學', 學制: '普高' } }), data.timeline[SH0]).在學, true);
  assert.equal(buildCtx(Object.assign(clone(worse), { vars: { ...worse.vars, 中途離校: '', 學制: '未升學' } }), data.timeline[SH0]).在學, false);
});

test('中途離校的鏈：5 張卡都明寫 scale:false、在高中；四個做法（強迫回去、讓他在家、陪他找下一步、找輔導資源）；陪他找下一步花最多力氣且是研究支持的；每個結果都設 中途離校 或 學制', () => {
  assert.equal(CHAIN.length, 5);
  for (const id of CHAIN) { const c = data.cardIndex[id]; assert.equal(c.scale, false, id); assert.deepEqual(c.stages, ['高中']); }
  const ask = data.cardIndex.sh_drop_ask;
  assert.equal(ask.choices.length, 4);
  const vals = ask.choices.map((c) => c.setVars.中途離校);
  assert.deepEqual(vals, ['強迫回校', '在家', '找下一步', '輔導中']);
  const cost = (ch) => -((ch.effects.體力 || 0) + (ch.effects.耐心 || 0));
  assert.equal(ask.choices.map(cost).indexOf(Math.max(...ask.choices.map(cost))), 2, '陪他找下一步花最多體力與耐心');
  assert.ok(ask.choices[2].tags.includes('讓孩子參與決定') && ask.choices[2].tags.includes('先了解再處理'));
  assert.ok(ask.choices[0].tags.includes('規定不談判') && ask.choices[1].tags.includes('迴避不談'));
  const next = data.cardIndex.sh_drop_next;
  const res = next.choices.map((c) => c.setVars.中途離校);
  assert.deepEqual(res, ['工作', '職訓', '轉學', '實驗教育', '在家']);
  assert.equal(next.choices[0].setVars.學制, '未升學'); assert.equal(next.choices[3].setVars.學制, '自學'); assert.ok(next.choices[3].setFlags.includes('學制_自學'));
  for (const id of CHAIN) for (const ch of data.cardIndex[id].choices) for (const b of [ch, ...(ch.chance ? [ch.chance.win, ch.chance.lose] : [])]) { const v = (b.setVars || {}).中途離校; if (v) assert.ok(DROP_VALUES.includes(v)); }
});

test('預覽冒煙：每種去向（男女各一）都玩得到離家、第 72 回合結束；離家三回合看到的卡就是該去向的版本；沒有例外', () => {
  const seen = new Set();
  for (const d of DESTS) for (const sexWanted of ['男', '女']) {
    if (sexWanted === '女' && d === '入伍') continue;
    let st = null;
    for (let seed = 1; seed < 60 && !st; seed++) { const s = newState(seed, data, {}); if (s.family.child.sex === sexWanted) st = s; }
    const pol = botPolicy('warmFirm', st.seed);
    const legs = [];
    while (!st.ended) {
      if (st.turn === SH0) { st.vars.學制 = d === '五專續讀' ? '五專' : st.vars.學制 || '普高'; setDestination(st, d); }
      const r = startTurn(st, data);
      if (r.ended) break;
      if (r.card) { let v = r.card, rw = r.raw; for (let g = 0; g < 3; g++) { if (st.turn >= LV0) legs.push({ id: v.id, text: v.text }); const o = chooseCard(st, data, pol.choose(st, v, rw, data)); if (!o.more) break; ({ card: v, raw: rw } = nextCard(st, data)); } }
      finishTurn(st, data);
    }
    assert.equal(st.turn, 72); assert.equal(st.vars.去向, d);
    assert.deepEqual(legs.map((x) => x.id), ['fx_leave_apply', 'fx_leave_offer', 'fx_leave_day'], `${d}／${sexWanted}`);
    const marker = P.leaveMarkers[d]; assert.ok(marker.some((w) => legs[2].text.includes(w)), `${d}：${legs[2].text}`);
    seen.add(d);
  }
  assert.equal(seen.size, 8);
});

test('預覽冒煙：自然局（四種策略）到離家的學制與去向合理——五專只續讀、未升學不會去大學以外的矛盾；沒有任何局缺學制或去向', () => {
  for (let seed = 1; seed <= 24; seed++) {
    const st = playTo(seed, 72, ['warmFirm', 'random', 'controlling', 'permissive'][seed % 4]);
    assert.ok(TYPES.includes(st.vars.學制), `種子 ${seed}`); assert.ok(DESTS.includes(st.vars.去向), `種子 ${seed}`);
    if (st.family.child.sex === '女') assert.notEqual(st.vars.去向, '入伍');
    if (st.vars.學制 === '五專') assert.ok(['五專續讀', '就業', '出國', '在家'].includes(st.vars.去向));
    assert.ok(Object.keys(st.flags).filter((k) => /^學制_/.test(k)).length <= 1, '只會有一個學制旗標');
    assert.equal(st.endReason, '待續');
  }
});

test('志願被決定：父母蓋過孩子的傾向、而且孩子的主見夠高才設旗標；孩子主導不會設', () => {
  let set = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const a = playTo(seed, HS, 'random'); a.hidden.主見 = 80;
    const wants = childWants(a);
    const r = resolveRoute(clone(a), data, '學制', '父母');
    const s = clone(a); resolveRoute(s, data, '學制', '父母');
    assert.equal(!!s.flags.志願被決定, r.value !== wants);
    if (s.flags.志願被決定) set++;
    const k = clone(a); resolveRoute(k, data, '學制', '孩子'); assert.ok(!k.flags.志願被決定);
    const low = clone(a); low.hidden.主見 = 30; resolveRoute(low, data, '學制', '父母'); assert.ok(!low.flags.志願被決定);
  }
  assert.ok(set > 0);
});

test('國中已經選了自學的孩子，進高中多半繼續自學', () => {
  let n = 0, k = 0;
  for (let seed = 1; seed <= 60; seed++) { const st = playTo(seed, HS, 'random'); st.flags.學制_自學 = true; n++; if (resolveRoute(st, data, '學制', '孩子').value === '自學') k++; }
  assert.ok(k / n > 0.55, `${k}/${n}`);
});

test('setSchoolType：只留一個學制旗標，走學測／走技職跟著換；featuresOf 的特徵都是有限數', () => {
  const st = playTo(2, HS);
  setSchoolType(st, '技高'); assert.ok(st.flags.學制_技高 && st.flags.走技職 && !st.flags.走學測);
  setSchoolType(st, '普高'); assert.ok(st.flags.學制_普高 && st.flags.走學測 && !st.flags.學制_技高 && !st.flags.走技職);
  setSchoolType(st, '未升學'); assert.ok(st.flags.學制_未升學 && !st.flags.走學測 && !st.flags.走技職);
  for (const v of Object.values(featuresOf(st))) assert.ok(Number.isFinite(v));
});
