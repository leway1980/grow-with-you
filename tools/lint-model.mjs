// 因果模型與防呆的靜態檢查（DESIGN §3.7）：被 tools/lint-data.mjs 呼叫，tests/lint.test.mjs 也直接測。
// 1. 圖本身：節點、邊、層次；2. 標籤的效果方向必須和邊一致、每個效果都有邊涵蓋；3. 卡片不能碰第 3、4 層；
// 4. 邊上的單回合上限（靜態名義值）與結果軸的單選項影響上限；5. 結局句子只讀第 4 層與決定鏈紀錄、互斥群組、每個高中低都有後備句。
import { tokenize, compile } from '../js/engine/events.js';
import { stageMult } from '../js/engine/tags.js';
import { edgeById, tagEdgeIndex, edgeForTagEffect, outcomeWeights, AXES } from '../js/engine/model.js';
import { ROUTE_DELTA, pickLines, lineContradictions, endingContext } from '../js/engine/ending.js';
import { PLAYED_STAGES, BAD_WHEN_UP } from './metrics.mjs';

const NODE_LAYERS = new Set([0, 1, 2, 3, 4]);
const VISIBLE_NODE_OK = new Set(['耐心']);

/** 一個選項（標籤組）在某階段集合下，對每條邊的名義變動量（不含情境、飽和、重複加速）與對每條結果軸的名義影響 */
export function nominalChoice(T, W, tags, stages) {
  const edges = {}, axes = Object.fromEntries(AXES.map((a) => [a, 0]));
  for (const t of tags || []) {
    const def = T.tags[t]; if (!def) continue;
    const sm = Math.max(...stages.map((s) => stageMult(def, s)));
    for (const [k, d] of Object.entries(def.d || {})) {
      const x = Math.abs(d) * (T.gain ?? 1) * sm;
      const e = edgeForTagEffect(T.model, t, k, d);
      if (e) edges[e.id] = (edges[e.id] || 0) + x;
      for (const a of AXES) axes[a] += Math.abs((W[a][k] || 0) * d) * (T.gain ?? 1) * sm;
    }
  }
  return { edges, axes };
}

export function lintModel(raw, data, cards) {
  const errors = [], warns = [], stats = {};
  const M = raw.model, T = data.tags, E = raw.ending;
  if (!M) { errors.push('因果圖：缺少 data/model.json'); return { errors, warns, stats }; }
  const hiddenKeys = Object.keys(raw.tags.hidden);
  const byId = new Map();
  for (const e of M.edges) { if (byId.has(e.id)) errors.push(`因果圖：邊 id「${e.id}」重複`); byId.set(e.id, e); }

  // ── 節點 ──
  for (const [k, n] of Object.entries(M.nodes)) {
    if (!NODE_LAYERS.has(n.layer)) errors.push(`因果圖：節點「${k}」的 layer 要是 0–4`);
    if (!Array.isArray(n.writers) || !n.writers.length) errors.push(`因果圖：節點「${k}」沒有 writers`);
  }
  for (const k of hiddenKeys) {
    const n = M.nodes[k];
    if (!n) errors.push(`因果圖：隱藏數值「${k}」不在節點裡`);
    else if (n.layer !== 3) errors.push(`因果圖：隱藏數值「${k}」要在第 3 層`);
    else if (raw.tags.derived.includes(k) !== (n.kind === 'derived')) errors.push(`因果圖：「${k}」的 derived 與 tags.json 不一致`);
  }
  for (const [k, n] of Object.entries(M.nodes)) if (n.layer === 3 && !hiddenKeys.includes(k)) errors.push(`因果圖：第 3 層節點「${k}」不在 tags.json 的 hidden`);
  for (const k of Object.keys(raw.tags.hidden)) if (M.nodes[k]?.layer === 3 && n3(M, k) && !(M.nodes[k].writers.includes('tags') || M.nodes[k].writers.includes('derived'))) errors.push(`因果圖：「${k}」的 writers 要有 tags 或 derived`);

  // ── 邊 ──
  const nodeOrTag = (x) => M.nodes[x];
  for (const e of M.edges) {
    const W = `因果圖邊 ${e.id}`;
    if (e.sign !== '+' && e.sign !== '-') errors.push(`${W}：sign 要是 + 或 -`);
    if (!M.nodes[e.to]) errors.push(`${W}：to「${e.to}」不是節點`);
    if (!!e.fromTags === !!e.from) errors.push(`${W}：要有 fromTags（標籤）或 from（節點）其中一個`);
    if (e.from && !nodeOrTag(e.from)) errors.push(`${W}：from「${e.from}」不是節點`);
    for (const t of e.fromTags || []) if (!raw.tags.tags[t]) errors.push(`${W}：標籤「${t}」不在詞彙表`);
    if (!e.why || !e.src) errors.push(`${W}：要寫 why 與 src（研究或老師的判斷）`);
    // 方向的層次：只能往上一層（同層的推算除外）
    const lf = e.fromTags ? 1 : M.nodes[e.from]?.layer, lt = M.nodes[e.to]?.layer;
    if (lf != null && lt != null && lt < lf) errors.push(`${W}：不能由第 ${lf} 層指向更低的第 ${lt} 層`);
    if (e.fromTags && e.to && M.nodes[e.to] && ![2, 3].includes(M.nodes[e.to].layer)) errors.push(`${W}：標籤只能指向第 2、3 層`);
    if (e.id.startsWith('h:')) {
      for (const f of ['maxTurn', 'maxGame']) if (typeof e[f] !== 'number' || !(e[f] > 0)) errors.push(`${W}：缺少 ${f}（執行 node tools/check-design.mjs --write-caps 依模擬量測寫入）`);
      if (e.maxTurn > e.maxGame) errors.push(`${W}：maxTurn 不能大於 maxGame`);
    }
  }

  // ── 標籤 ↔ 邊：方向一致、每個效果都有邊涵蓋、邊上沒有多的標籤 ──
  const idx = tagEdgeIndex(M);
  for (const [t, def] of Object.entries(raw.tags.tags)) {
    for (const [k, d] of Object.entries(def.d || {})) {
      if (d === 0) continue;
      const list = idx.get(`${t}|${k}`) || [];
      if (!list.length) { errors.push(`標籤 ${t}：對「${k}」的效果（${d > 0 ? '+' : ''}${d}）在因果圖上沒有邊（請在 data/model.json 加上）`); continue; }
      if (!list.some((e) => e.sign === (d > 0 ? '+' : '-'))) errors.push(`標籤 ${t}：對「${k}」的效果 ${d > 0 ? '+' : ''}${d} 和因果圖的方向（${list.map((e) => e.sign).join('')}）矛盾`);
      if (list.length > 1) errors.push(`標籤 ${t}：對「${k}」在因果圖上有 ${list.length} 條邊`);
      if (!(M.nodes[k] && M.nodes[k].writers.includes('tags'))) errors.push(`標籤 ${t}：「${k}」不能由標籤改變（writers：${M.nodes[k]?.writers}）`);
    }
    for (const k of Object.keys(def.counts || {})) {
      if (!(idx.get(`${t}|${k}`) || []).some((e) => e.sign === '+')) errors.push(`標籤 ${t}：計數「${k}」在因果圖上沒有邊`);
      if (!(M.nodes[k] && M.nodes[k].layer === 2 && M.nodes[k].writers.includes('tags'))) errors.push(`標籤 ${t}：計數「${k}」要是第 2 層、writers 有 tags 的節點`);
    }
  }
  {
    const g = byId.get('h:父母的收穫+');
    if (g) { for (const t of raw.tags.growthTags || []) if (!g.fromTags.includes(t)) errors.push(`因果圖：growthTags「${t}」不在邊 h:父母的收穫+`); for (const t of g.fromTags) if (!(raw.tags.growthTags || []).includes(t)) errors.push(`因果圖：邊 h:父母的收穫+ 的標籤「${t}」不在 growthTags`); }
  }
  for (const e of M.edges) for (const t of e.fromTags || []) {
    const def = raw.tags.tags[t];
    if (!def || e.to === '父母的收穫' || e.id.startsWith('c:孩子來找') ) continue;
    if (e.id.startsWith('h:')) { const d = (def.d || {})[e.to]; if (!d || (d > 0 ? '+' : '-') !== e.sign) errors.push(`因果圖邊 ${e.id}：標籤「${t}」在 tags.json 沒有這個方向的效果（邊上多列了，或標籤改了）`); }
    if (e.id.startsWith('c:') && !e.id.startsWith('c:孩子來找')) { if (!(def.counts || {})[e.to]) errors.push(`因果圖邊 ${e.id}：標籤「${t}」沒有 counts.${e.to}`); }
  }
  // 孩子來找你：approach 的標籤清單 ↔ 邊
  {
    const A = raw.tags.approach;
    const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
    if (!same(byId.get('c:孩子來找_連續錯過+')?.fromTags || [], A.missTags)) errors.push('因果圖：邊 c:孩子來找_連續錯過+ 的標籤和 approach.missTags 不一致');
    if (!same(byId.get('c:孩子來找_連續錯過0')?.fromTags || [], A.attendTags)) errors.push('因果圖：邊 c:孩子來找_連續錯過0 的標籤和 approach.attendTags 不一致');
    if (!same(byId.get('c:孩子來找_回來連續+')?.fromTags || [], A.initiateTags)) errors.push('因果圖：邊 c:孩子來找_回來連續+ 的標籤和 approach.initiateTags 不一致');
    for (const t of A.missTags) if (A.attendTags.includes(t)) errors.push(`approach：標籤「${t}」同時是錯過與接住`);
  }
  // 推算值、規則、開口度、結果軸
  for (const [name, D] of Object.entries(M.derived || {})) for (const id of D.terms) {
    const e = byId.get(id); if (!e) { errors.push(`因果圖 derived.${name}：邊「${id}」不存在`); continue; }
    if (e.to !== name) errors.push(`因果圖 derived.${name}：邊「${id}」的 to 不是 ${name}`);
    if (typeof e.w !== 'number' || typeof e.center !== 'number') errors.push(`因果圖邊 ${id}：要有數字 w 與 center`);
  }
  for (const r of M.rules || []) { const e = byId.get(r.edge); if (!e) errors.push(`因果圖 rules ${r.id}：邊「${r.edge}」不存在`); else for (const [k, d] of Object.entries(r.d)) if (e.to !== k || e.from !== r.stat || (d < 0 ? '+' : '-') !== e.sign) errors.push(`因果圖 rules ${r.id}：規則是『${r.stat} 低 → ${k} ${d < 0 ? '下降' : '上升'}』，邊 ${r.edge} 的方向（${e.sign}）或端點不一致`); }
  for (const id of [M.openness.spoke, M.openness.silent]) if (!byId.get(id) || typeof byId.get(id).w !== 'number') errors.push(`因果圖 openness：邊「${id}」要有數字 w`);
  if (ROUTE_DELTA !== M.bands.routeDelta) errors.push(`ending.js 的 ROUTE_DELTA（${ROUTE_DELTA}）和 model.bands.routeDelta（${M.bands.routeDelta}）不一致`);
  const W = outcomeWeights(M);
  // 路線（M3 B4）：結果軸、推算值與邊都不能讀 學制、志願偏好、去向、中途離校——沒有一條路是失敗結局，路線只換文字與後面的事件
  {
    const PATH_NODES = ['學制', '志願偏好', '去向', '中途離校'];
    for (const [ax, O] of Object.entries(M.outcomes)) for (const it of [...(O.mean || []), ...(O.pen || [])]) if (PATH_NODES.includes(it.from)) errors.push(`因果圖 outcomes.${ax}：輸入「${it.from}」是路線（學制、去向），結果不能讀它——沒有一條路是失敗結局`);
    for (const e of M.edges) if (PATH_NODES.includes(e.from) || PATH_NODES.includes(e.to)) errors.push(`因果圖邊 ${e.id}：路線節點（${PATH_NODES.join('、')}）不能有邊`);
    for (const [name, D] of Object.entries(M.derived || {})) if (PATH_NODES.some((n) => JSON.stringify(D).includes(n))) errors.push(`因果圖 derived.${name}：不能讀路線節點`);
  }
  for (const [ax, O] of Object.entries(M.outcomes)) {
    if (!M.nodes[ax] || M.nodes[ax].layer !== 4) errors.push(`因果圖 outcomes：「${ax}」要是第 4 層節點`);
    for (const it of [...(O.mean || []), ...(O.pen || [])]) {
      if (it.as !== 'vis' && !M.nodes[it.from]) errors.push(`因果圖 outcomes.${ax}：輸入「${it.from}」不是節點`);
      if (it.as !== 'vis' && M.nodes[it.from] && M.nodes[it.from].layer > 3) errors.push(`因果圖 outcomes.${ax}：輸入「${it.from}」不能是第 4 層以上（結果只能由第 3 層算出）`);
    }
  }
  for (const [ax, w] of Object.entries(W)) for (const [k, x] of Object.entries(w)) {
    if (BAD_WHEN_UP.has(k) && x > 0) errors.push(`因果圖 outcomes.${ax}：「${k}」越高越糟，對 ${ax} 的權重不能是正的（${x.toFixed(2)}）`);
    if (M.nodes[k]?.layer === 3 && !BAD_WHEN_UP.has(k) && x < 0) warns.push(`因果圖 outcomes.${ax}：「${k}」對 ${ax} 的權重是負的（${x.toFixed(2)}），請確認`);
  }

  // ── 卡片不能碰第 3、4 層 ──
  const cardKeys = new Set(Object.entries(M.nodes).filter(([, n]) => n.writers.includes('card') && n.layer <= 2).map(([k]) => k));
  for (const c of cards) for (const ch of c.choices || []) for (const b of [ch, ...(ch.chance ? [ch.chance.win, ch.chance.lose] : [])]) {
    for (const f of ['setVars', 'incVars']) for (const k of Object.keys(b[f] || {})) if (!cardKeys.has(k)) errors.push(`卡片 ${c.id}／${ch.label}：${f}「${k}」不是卡片可以寫的節點（因果圖 writers 沒有 card，或在第 3 層以上）`);
    for (const k of Object.keys(b.effects || {})) if (M.nodes[k] && M.nodes[k].layer > 1 && !VISIBLE_NODE_OK.has(k)) errors.push(`卡片 ${c.id}／${ch.label}：effects「${k}」不是第 1 層（劑量表上看得到的）`);
  }
  for (const l of raw.pools.loads || []) for (const t of l.tags || []) if (!raw.tags.tags[t]) errors.push(`loads ${l.id}：標籤「${t}」不在詞彙表`);

  // ── 靜態上限：每個選項對每條邊的名義變動量 ≤ maxTurn；對每條結果軸的名義影響 ≤ perChoiceStatic ──
  const cap = M.influenceCaps || {};
  const worstEdge = {}, worstAxis = Object.fromEntries(AXES.map((a) => [a, { v: 0, who: '' }]));
  // A2.5：靜態上限（edge maxTurn、perChoiceStatic）以『參考劑量（一個 2 個月的回合）』為單位，比的是未乘劑量倍率的名義值；
  // check-design 量到的單回合變動也先除以那張卡的倍率 k 再比（tools/simulate.mjs influenceMeter），所以上限不會隨回合長度改寫。
  // stageK＝各階段在整條時間軸上的最大倍率（含預覽的國中、高中、離家）；只用來報告『實際會放大多少』，不參與上限比較。
  const alpha = (M.timeScale && M.timeScale.alpha) || 0, stageK = {};
  for (const t of data.timeline) stageK[t.stage] = Math.max(stageK[t.stage] || 0, Math.pow(t.span / 2, alpha));
  stats.stageK = stageK;
  let worstRealised = { v: 0, who: '' };
  for (const c of cards) {
    const stg = c.stages || PLAYED_STAGES;
    const k = c.scale === false ? 1 : Math.max(1, ...stg.map((s) => stageK[s] || 1));
    for (const ch of c.choices || []) {
      if (!(ch.tags || []).every((t) => raw.tags.tags[t])) continue;
      const nom = nominalChoice(T, W, ch.tags, stg);
      const real = Math.max(...AXES.map((a) => nom.axes[a])) * k;
      if (real > worstRealised.v) worstRealised = { v: real, who: `${c.id}／${ch.label.slice(0, 10)}（k＝${k}）` };
      for (const [id, v] of Object.entries(nom.edges)) {
        if (!worstEdge[id] || v > worstEdge[id].v) worstEdge[id] = { v, who: `${c.id}／${ch.label.slice(0, 10)}` };
        const e = byId.get(id);
        if (e && typeof e.maxTurn === 'number' && v > e.maxTurn + 1e-9) errors.push(`卡片 ${c.id}／${ch.label.slice(0, 12)}：對邊 ${id} 的名義變動 ${v.toFixed(1)} 超過單回合上限 ${e.maxTurn}`);
      }
      for (const a of AXES) {
        if (nom.axes[a] > worstAxis[a].v) worstAxis[a] = { v: nom.axes[a], who: `${c.id}／${ch.label.slice(0, 10)}` };
        const lim = cap.perChoiceStatic && cap.perChoiceStatic[a];
        if (typeof lim === 'number' && nom.axes[a] > lim + 1e-9) errors.push(`卡片 ${c.id}／${ch.label.slice(0, 12)}：對「${a}」軸的名義影響 ${nom.axes[a].toFixed(2)} 超過單一選項上限 ${lim}`);
      }
    }
  }
  for (const a of AXES) if (!cap.perChoiceStatic || typeof cap.perChoiceStatic[a] !== 'number') errors.push(`因果圖 influenceCaps.perChoiceStatic.${a}：缺少（執行 node tools/check-design.mjs --write-caps）`);
  for (const k of ['perTag', 'perCard', 'perPool']) if (!cap[k] || typeof cap[k] !== 'object') errors.push(`因果圖 influenceCaps.${k}：缺少（執行 node tools/check-design.mjs --write-caps）`);
  stats.worstRealised = worstRealised;
  stats.staticMax = Object.fromEntries(AXES.map((a) => [a, worstAxis[a].v.toFixed(2)]));
  stats.staticRaw = { axes: Object.fromEntries(AXES.map((a) => [a, worstAxis[a].v])), edges: Object.fromEntries(Object.entries(worstEdge).map(([k, v]) => [k, v.v])) };

  // ── 結局句子（第 5 層）──
  if (E) lintEnding(raw, E, M, errors, warns, stats);
  else errors.push('結局：缺少 data/ending.json');
  return { errors, warns, stats };
}
const n3 = (M, k) => M.nodes[k] && M.nodes[k].layer === 3;

/** 結局句子庫的檢查 */
export function lintEnding(raw, E, M, errors, warns, stats = {}) {
  const hiddenKeys = Object.keys(raw.tags.hidden);
  const recNames = E.records.map((r) => r.name);
  const bandVarNames = Object.values(E.bandVars);
  const allowed = new Set([...E.outcomeVars, ...bandVarNames, ...recNames]);
  const ids = new Set();
  const thresholds = {};
  let broken = false;
  for (const r of E.records) {
    if (r.kind === 'var' && !M.nodes[r.key]) errors.push(`結局 records「${r.name}」：節點「${r.key}」不存在`);
    if (r.kind === 'var' && M.nodes[r.key] && M.nodes[r.key].layer !== 2) errors.push(`結局 records「${r.name}」：要讀第 2 層的紀錄`);
    if (r.kind === 'streak' && !raw.tags.tags[r.tag]) errors.push(`結局 records「${r.name}」：標籤「${r.tag}」不存在`);
  }
  for (const s of E.sentences) {
    const W = `結局句子 ${s.id}`;
    if (ids.has(s.id)) errors.push(`${W}：id 重複`); ids.add(s.id);
    if (!E.facets.includes(s.facet)) errors.push(`${W}：facet「${s.facet}」不存在`);
    if (!['home', 'record', 'band'].includes(s.slot)) errors.push(`${W}：slot 要是 home／record／band`);
    let toks;
    try { toks = tokenize(s.when); compile(s.when); } catch (e) { errors.push(`${W}：條件寫錯：${e.message}`); broken = true; continue; }
    toks.forEach((t, i) => {
      if (t.t === 'flag') errors.push(`${W}：條件不能讀旗標（結局文字只能讀第 4 層的結果與決定鏈紀錄）`);
      if (t.t === 'var') {
        if (!allowed.has(t.v)) errors.push(`${W}：條件讀了「${t.v}」——結局文字只能讀第 4 層的結果（${E.outcomeVars.join('、')}）與決定鏈紀錄（${recNames.join('、')}）`);
        const n = toks[i + 2];
        if (toks[i + 1] && toks[i + 1].t === 'op' && n && n.t === 'num') (thresholds[t.v] ||= new Set()).add(n.v);
      }
    });
    if (hiddenKeys.some((k) => s.text.includes(k))) errors.push(`${W}：文字出現隱藏數值的名稱`);
    for (const m of s.text.matchAll(/\{([^{}]+)\}/g)) if (!['孩子', '他'].includes(m[1])) errors.push(`${W}：不認得的代稱 {${m[1]}}`);
    for (const [g, v] of Object.entries(s.claims || {})) {
      if (!E.claimGroups[g]) errors.push(`${W}：claims 的群組「${g}」不存在`);
      else if (!E.claimGroups[g].includes(v)) errors.push(`${W}：claims.${g} 的值「${v}」不在群組裡（${E.claimGroups[g].join('、')}）`);
    }
  }
  // 每個高中低都有後備句：fallback 的條件只讀自己那條軸的區間；home 有 when:true 的後備
  for (const [ax, vname] of Object.entries(E.bandVars)) for (const b of Object.values(E.bandNames)) {
    const ok = E.sentences.some((s) => s.facet === ax && s.slot === 'band' && s.fallback && s.when.replace(/\s/g, '') === `${vname}=='${b}'`);
    if (!ok) errors.push(`結局：「${ax}」的「${b}」沒有後備句（facet ${ax}、slot band、fallback、條件剛好是 ${vname} == '${b}'）`);
  }
  if (!E.sentences.some((s) => s.facet === 'home' && s.fallback && s.when.trim() === 'true')) errors.push('結局：home 沒有 when: true 的後備句');
  if (broken) return;
  // 實際跑：每個軸的高中低組合 × 幸福組合，都挑得到三個 facet 的後備句，而且沒有矛盾（在條件的邊界值格子上）
  const vals = (v) => [...new Set([0, 100, ...[...(thresholds[v] || [])].flatMap((t) => [t - 0.5, t])])].sort((a, b) => a - b);
  const bands = { hi: M.bands.good + 5, mid: (M.bands.good + M.bands.bad) / 2, lo: M.bands.bad - 5 };
  const recList = recNames.filter((n) => E.sentences.some((s) => tokenize(s.when).some((t) => t.t === 'var' && t.v === n)));
  let combos = 0, contradictions = 0, missing = 0;
  const examples = [];
  const route = { kind: '' };
  const axisSets = [];
  for (const a of Object.values(bands)) for (const p of Object.values(bands)) for (const l of Object.values(bands)) axisSets.push({ 親子: a, 人際: p, 學習: l });
  for (const axes of axisSets) {
    for (const c of vals('孩子幸福')) for (const pa of vals('父母幸福')) for (const bt of vals('彼此之間')) for (let mask = 0; mask < (1 << recList.length); mask++) {
      const rec = Object.fromEntries(recNames.map((n) => [n, 0]));
      recList.forEach((n, i) => { rec[n] = (mask >> i) & 1; });
      const ctx = endingContext({ axes, wellbeing: { child: c, parent: pa, between: bt }, route, combo: '' }, rec, E, M);
      const lines = pickLines(ctx, E);
      combos++;
      for (const f of E.facets) if (!lines.some((l) => l.facet === f)) { missing++; if (examples.length < 3) examples.push(`缺 ${f}：${JSON.stringify(ctx)}`); }
      const bad = lineContradictions(lines, E);
      if (bad.length) { contradictions++; if (examples.length < 3) examples.push(`矛盾 ${bad.map((x) => `${x.a}↔${x.b}`).join('、')}：孩子 ${c}／父母 ${pa}／彼此 ${bt}，紀錄 ${recNames.filter((n) => rec[n]).join('、') || '無'}`); }
    }
  }
  if (missing) errors.push(`結局：${missing} 個組合缺某個 facet 的句子（${examples.join('；')}）`);
  if (contradictions) errors.push(`結局：邊界值格子裡有 ${contradictions} 個組合的句子互相矛盾（${examples.join('；')}）；請在條件裡加上互斥的限制`);
  stats.endingGrid = combos;
}
