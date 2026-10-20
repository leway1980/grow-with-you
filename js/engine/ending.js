// 終局（DESIGN §7、§3.1、§11）v0：先給「你們一起的幸福」，成就另外顯示，最後才「回頭看」把所有隱藏數值攤開。純函式、無 DOM。
// 『教養路線』由行為累積出來的位置計算，從不由玩家宣告。簡單的句子產生；組合式的信（47wan 的面向句庫）留到後面的里程碑。

import { stageMult } from './tags.js';
import { evalOutcome, opennessFrom, getModel, plasticityOf } from './model.js';
import { buildChains, classroomSummary } from './chains.js';
import { evalCond } from './events.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));

/** 隱藏數值的名稱分組（只在終局揭露用） */
export const REVEAL_GROUPS = [
  { title: '你和孩子之間', keys: ['溫暖陪伴', '規範監督', '親子信任', '了解度', '規則一致性', '替他做主'] },
  { title: '孩子心裡的樣子', keys: ['主見', '自我效能', '內在穩定', '安全感', '承受度', '期待壓力', '試探度'] },
  { title: '家裡的環境與習慣', keys: ['父母示範', '父母情緒穩定度', '自理與責任', '閱讀習慣', '家庭學習環境', '交通安全認知'] },
  { title: '學校那一邊', keys: ['師親信任', '班級風氣'] },
];
export const GOOD_WHEN_UP = (k) => k !== '期待壓力' && k !== '試探度' && k !== '替他做主';

/**
 * 最近 months 個月的紀錄（A2.5：窗口以月計，不以回合計）：月齡 m 在 (最後一筆的 m − months, 最後一筆的 m] 之內的。
 * 2 個月的回合時，24 個月＝最後 12 筆，和舊的『最後 12 個回合』相同。沒有 m 的舊紀錄（不該出現，migrate 會補）退回『每筆 2 個月』。
 */
export function lastMonths(rows, months) {
  if (months == null || !rows.length) return rows;
  const lastM = rows[rows.length - 1].m;
  if (lastM == null) return rows.slice(-Math.max(1, Math.round(months / 2)));
  return rows.filter((c) => c.m > lastM - months);
}
function avgHidden(st, key, months) { return mean(lastMonths(st.curves, months).map((c) => c[key]).filter((x) => x != null)); }
function avgVis(st, key, months) { return mean(lastMonths(st.vcurves, months).map((c) => c[key]).filter((x) => x != null)); }

/** 整個童年的月份加權平均：每一筆的權重＝它和前一筆相差的月數（第一筆從 0 歲算起），所以 1 個月和 6 個月的回合不會因為筆數不同而失衡 */
export function wholeAvg(rows, key) {
  let num = 0, den = 0, prev = 0;
  for (const c of rows) {
    const m = c.m ?? prev + 2, w = Math.max(1, m - prev);
    prev = m;
    if (c[key] == null) continue;
    num += w * c[key]; den += w;
  }
  return den ? num / den : null;
}
/** 結局軸的『整個童年』權重（data/ending.json 的 outcomeBlend）：軸＝recent × 近期（隱藏數值的終點、可見數值最近 months 個月）＋ whole × 整個童年的月份加權平均 */
function blendOf(st) {
  let b = { recent: 0.6, whole: 0.4 };
  try { b = getEnding().outcomeBlend || b; } catch { /* 句子庫還沒載入 */ }
  return b.appliesTo === 'none' ? { recent: 1, whole: 0 } : b; // E1：appliesTo:'all'＝每一局都混合（72 回合是標準）；'none' 只給測試關掉混合
}
const blend = (recent, whole, B) => (whole == null || !B.whole ? recent : B.recent * recent + B.whole * whole);

/** 結果節點的輸入怎麼讀：hidden＝終點的隱藏數值；vis＝可見數值最近 months 個月的平均（A2.5：以月計）；開口度由兩個計數算出（公式與權重在 data/model.json 的 outcomes）。
 *  開口度以外的輸入都再和『整個童年的月份加權平均』混合（0.6 近期＋0.4 整個童年；十八歲時的幸福反映整個童年，不只最後兩年） */
function reader(st, M) {
  const h = st.hidden, B = blendOf(st);
  return (it) => {
    if (it.from === '開口度') return opennessOf(st, M);
    if (it.as === 'vis') return blend(avgVis(st, it.from, it.months), wholeAvg(st.vcurves, it.from), B);
    return blend(h[it.from], wholeAvg(st.curves, it.from), B);
  };
}
const modelOf = (st, M) => M || getModel();

/**
 * 三條結果軸（§3.1）：親子、人際、學習。0–100。它們是各自獨立的軸，不會被加進幸福裡。
 * 公式（哪些輸入、權重、懲罰）全部在 data/model.json 的 outcomes：
 * 人際：孩子學到「吵就有、找理由」（試探度高）會被同學疏遠，所以扣分；學習：3C 超過一般的量會扣分（擠掉睡眠與共處時間，§10 第 7 點）。
 */
export function outcomeAxes(st, M) {
  M = modelOf(st, M);
  const r = reader(st, M), stg = endStage(st);
  return { 親子: evalOutcome(M, '親子', r, stg), 人際: evalOutcome(M, '人際', r, stg), 學習: evalOutcome(M, '學習', r, stg) };
}
/** 結局時孩子所在的階段（只用來查 model.json outcomes 的 overByStage）：看最後一筆紀錄的月齡；國小以前（或沒有紀錄）回 null＝用原本的 over */
export function endStage(st) {
  const rows = st.vcurves, m = rows && rows.length ? rows[rows.length - 1].m : null;
  return m == null ? null : m >= 216 ? '離家' : m >= 180 ? '高中' : m >= 144 ? '國中' : null;
}

/** 孩子願不願意開口（0–100）：被聽見的次數往上，說了沒人聽、後來不再開口的次數往下。計數來自事件，不是隱藏數值。 */
export function opennessOf(st, M) {
  return opennessFrom(modelOf(st, M), st.vars['孩子主動開口'] || 0, st.vars['孩子不再開口'] || 0);
}

/** 父母幸福的參數預設值（正式的值在 data/identities.json 的 parentModel；buildEnding 會帶進來） */
const DEFAULT_PM = { lowShareWeight: 60, lowThreshold: 35, levelWeight: 1, growthWeight: 0 };
/**
 * 共同的幸福（§7.1 第一個畫面）：孩子、父母、彼此之間。成績、去向不會被加進來（成就和幸福是兩條軸，§7.2）。
 * 父母那一項是整段時間的樣子（平均＋體力見底的回合比例），不是最後幾回合；錢不算（§2.3：家境改變代價，不改變能不能幸福）。
 */
export function wellbeing(st, PM = DEFAULT_PM, M) {
  M = modelOf(st, M);
  const h = st.hidden;
  const r = reader(st, M);
  const child = evalOutcome(M, '孩子幸福', r);
  const keys = ['體力', '耐心'];
  if (st.family.partner.present) keys.push('夫妻關係');
  const rows = st.vcurves;
  // 平均水準只算一半的權重（往 50 收）：辛苦但可持續——撐不住的那幾回合（體力或耐心見底）才是主要的扣分
  const whole = 50 + PM.levelWeight * (mean(rows.map((c) => mean(keys.map((k) => c[k])))) - 50);
  const lowShare = rows.length ? rows.filter((c) => c.體力 < PM.lowThreshold || c.耐心 < PM.lowThreshold).length / rows.length : 0;
  // 父母的收穫（§7.2b）：一起參與的活動補回一部分犧牲，權重中等，不會抵消全部（也不會讓沒參與的人扣分：收穫從 0 起算）
  const parent = mean([whole, avgHidden(st, '父母情緒穩定度')]) - PM.lowShareWeight * lowShare + (PM.growthWeight ?? 0) * (h.父母的收穫 ?? 0);
  const between = evalOutcome(M, '彼此之間', r);
  return { child: clamp(child), parent: clamp(parent), between: clamp(between) };
}

/* ───── 結局句子（data/ending.json；DESIGN §3.7 第 5 層）：只讀第 4 層的結果與決定鏈紀錄 ───── */
let currentEnding = null;
export const setEnding = (E) => { if (E) currentEnding = E; };
export const getEnding = () => {
  if (!currentEnding) throw new Error('結局句子庫還沒載入（先呼叫 prepareData）');
  return currentEnding;
};

/** 在連續 win 個月內，帶有某標籤的選擇累積的『劑量加權次數』（A2.5：以月齡 m 計；每筆算 h.k 次，舊存檔沒有 k 算 1）。atLeast 以 2 個月回合的一次為單位 */
export function maxInWindow(hist, tag, win) {
  const ev = hist.filter((h) => (h.tags || []).includes(tag)).map((h) => ({ m: h.m, k: h.k ?? 1 }));
  let best = 0;
  for (let i = 0; i < ev.length; i++) { let sum = 0; for (let j = i; j < ev.length && ev[j].m - ev[i].m < win; j++) sum += ev[j].k; best = Math.max(best, sum); }
  return best;
}
/** 決定鏈紀錄（ending.json 的 records）：{ 名稱: 0|1 }。結局句子只能讀這些，不能讀單張卡的選擇 */
export function chainRecords(st, E = getEnding()) {
  const out = {};
  for (const r of E.records) out[r.name] = (r.kind === 'var' ? (st.vars[r.key] || 0) >= r.atLeast : maxInWindow(st.hist, r.tag, r.windowMonths) >= r.atLeast) ? 1 : 0;
  return out;
}
/** 句子條件的環境：第 4 層的結果（含高中低）＋決定鏈紀錄 */
export function endingContext({ axes, wellbeing: w, route, combo }, records, E = getEnding(), M = getModel()) {
  const ctx = { ...records, 親子: axes.親子, 人際: axes.人際, 學習: axes.學習, 孩子幸福: w.child, 父母幸福: w.parent, 彼此之間: w.between, 路線: route.kind, 組合: combo };
  for (const [ax, name] of Object.entries(E.bandVars)) ctx[name] = E.bandNames[bandOf(axes[ax], M.bands)];
  return ctx;
}
const SLOTS = { home: ['home'] };
/** 每個 facet 依 slot 各挑第一句符合的（home 只挑一句） */
export function pickLines(ctx, E = getEnding()) {
  const out = [];
  for (const facet of E.facets) for (const slot of SLOTS[facet] || ['record', 'band']) {
    const s = E.sentences.find((x) => x.facet === facet && x.slot === slot && evalCond(x.when, ctx));
    if (s) out.push({ facet, slot, id: s.id, text: s.text, claims: s.claims || {}, fallback: !!s.fallback });
  }
  return out;
}
/** 矛盾：同一個 claimGroup 裡，被挑到的說法差兩格以上 */
export function lineContradictions(lines, E = getEnding()) {
  const found = [];
  for (const [g, order] of Object.entries(E.claimGroups)) {
    const said = lines.filter((l) => l.claims[g] != null).map((l) => ({ id: l.id, i: order.indexOf(l.claims[g]) }));
    for (let a = 0; a < said.length; a++) for (let b = a + 1; b < said.length; b++) if (Math.abs(said[a].i - said[b].i) >= 2) found.push({ group: g, a: said[a].id, b: said[b].id });
  }
  return found;
}
const fillName = (text, st) => text.replace(/\{孩子\}/g, st.family.child.given).replace(/\{他\}/g, st.family.child.pronoun || '他');

export function wellbeingLine(w, st, E = getEnding(), M = getModel()) {
  const ctx = endingContext({ axes: outcomeAxes(st, M), wellbeing: w, route: { kind: '' }, combo: '' }, chainRecords(st, E), E, M);
  const s = E.sentences.find((x) => x.facet === 'home' && evalCond(x.when, ctx));
  return fillName(s.text, st);
}

/** 路線判定的門檻：和開局相比，變化超過這個值才算「往那邊走」 */
export const ROUTE_DELTA = 8; // 值的來源是 data/model.json 的 bands.routeDelta（tests/lint 檢查兩者一致）；routePosition 讀因果圖
/**
 * 教養路線位置（§3、§7.1 第 5 項）：看「和開局相比」的變化，不是絕對值；不是玩家宣告的。
 * 溫暖、規範、替他做主都沒有明顯變化 ⇒ 未成形／混合。
 */
export function routePosition(st) {
  const s0 = st.startHidden || st.hidden;
  const end = (k) => avgHidden(st, k, getModel().bands.routeWindowMonths); // 最近 24 個月（舊的最後 12 個國小回合）
  const warm = end('溫暖陪伴'), firm = end('規範監督'), control = end('替他做主');
  const dw = warm - s0.溫暖陪伴, df = firm - s0.規範監督, dc = control - s0.替他做主;
  let kind, name;
  const RD = getModel().bands.routeDelta;
  if (dc > RD) { kind = '高壓做主'; name = '高壓做主：替孩子決定很多事'; }
  else if (Math.abs(dw) <= RD && Math.abs(df) <= RD) { kind = '未成形'; name = '未成形／混合：有時陪、有時不陪，還沒有形成固定的樣子'; }
  else if (dw < 0 && df < 0) { kind = '放任'; name = '放任：說是尊重，其實沒怎麼在管'; }
  else if (dw < 0) { kind = '盯但不陪'; name = '盯但不陪：規矩有，陪伴少'; }
  else if (df < 0) { kind = '溺愛'; name = '溺愛：關係很近，規矩比較少'; }
  else { kind = '陪又要求'; name = '陪又要求：陪著，也有規矩'; }
  return { warm: clamp(warm), firm: clamp(firm), control: clamp(control), delta: { warm: dw, firm: df, control: dc }, kind, name };
}

/** §3.1 的七種組合（結局用）。thresholds：好 ≥ 60、差 < 45。 */
/** 高低區間（結果軸與幸福共用）：好 ≥ bands.good、差 < bands.bad，其餘 mid；門檻在 data/model.json */
export const bandOf = (v, B = getModel().bands) => (v >= B.good ? 'hi' : v < B.bad ? 'lo' : 'mid');
export const COMBOS = ['三邊都顧到', '關係好、人際好，成績普通', '成績好、關係冷', '成績好、人際孤立', '關係好、自律弱', '人際好、在家說不上話', '三邊都垮', '其他'];
export function comboOf(ax) {
  const B = getModel().bands;
  const lv = (v) => bandOf(v, B);
  const a = lv(ax.親子), p = lv(ax.人際), l = lv(ax.學習);
  if (a === 'lo' && p === 'lo' && l === 'lo') return '三邊都垮';
  if (a === 'hi' && p === 'hi' && l === 'hi') return '三邊都顧到';
  if (a === 'hi' && p === 'hi' && l === 'mid') return '關係好、人際好，成績普通';
  if (a === 'lo' && p !== 'lo' && l === 'hi') return '成績好、關係冷';
  if (a !== 'hi' && p === 'lo' && l === 'hi') return '成績好、人際孤立';
  if (a === 'hi' && p !== 'hi' && l === 'lo') return '關係好、自律弱';
  if (a === 'lo' && p === 'hi' && l !== 'hi') return '人際好、在家說不上話';
  return '其他';
}

/** 一組標籤在這個階段大約推動了多少（只看對照表、階段倍率與階段可塑性，不含情境與飽和）：給「關鍵時刻」與決定鏈用，不需要存每次選擇的隱藏變化 */
export function estimateDeltas(tags, stage, T) {
  const out = {};
  for (const t of tags || []) {
    const def = T.tags[t]; if (!def) continue;
    const m = stageMult(def, stage);
    for (const [k, d] of Object.entries(def.d || {})) out[k] = (out[k] || 0) + d * m * plasticityOf(T.model, stage, k, def, Math.sign(d * m)); // 階段可塑性（B1）：和 tags.js applyTags 同一個倍率
  }
  return out;
}

/** 關鍵時刻：對隱藏數值影響最大的幾次選擇（從標籤重新推算，存檔裡不留每次的隱藏變化） */
export function keyMoments(st, data, n = 5) {
  const scored = st.hist.map((h) => {
    const est = estimateDeltas(h.tags, data.timeline[h.turn].stage, data.tags);
    return { h, est, s: Object.values(est).reduce((a, d) => a + Math.abs(d), 0) };
  }).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  const pick = scored.slice(0, n).sort((a, b) => a.h.turn - b.h.turn);
  return pick.map(({ h, est }) => {
    const tl = data.timeline[h.turn];
    const moved = Object.entries(est).filter(([, d]) => Math.abs(d) >= 0.8).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)
      .map(([k, d]) => ({ key: k, dir: d > 0 ? 1 : -1 }));
    return { when: tl.label, title: h.title, label: h.label, did: (h.tags || []).map((t) => data.tags.tags[t]?.desc).filter(Boolean), moved };
  });
}

/**
 * 『你也重新長大了一次』（§7.2b）：把父母一起參與過的活動寫成白話句子，最多 T.growth.max（5）條。
 * 有槽值的（打樂樂棒球、學游泳、去科學館……）比只有標籤的具體，先列；同一個槽挑次數最多的，盡量多樣；
 * 一條都沒有就給一句溫和的話（不責怪）。
 */
export function growthSection(st, T) {
  const G = T.growth, nm = st.family.child.given, f = (x) => x.replace(/\{孩子\}/g, nm);
  const recs = st.parentGrowth || [];
  const groups = new Map();
  for (const r of recs) {
    const key = r.slot ? r.slot + ':' + r.value : 'tag:' + r.tag;
    const g = groups.get(key) || { key, r, n: 0, first: r.turn };
    g.n++; groups.set(key, g);
  }
  const all = [...groups.values()];
  const named = all.filter((g) => g.r.slot).sort((a, b) => b.n - a.n || a.first - b.first);
  const tagged = all.filter((g) => !g.r.slot).sort((a, b) => b.n - a.n || a.first - b.first);
  const picked = [], usedSlot = new Set();
  for (const g of named) if (picked.length < G.max && !usedSlot.has(g.r.slot)) { picked.push(g); usedSlot.add(g.r.slot); }
  for (const g of named) if (picked.length < G.max && !picked.includes(g)) picked.push(g);
  for (const g of tagged) if (picked.length < G.max) picked.push(g);
  picked.sort((a, b) => a.first - b.first);
  const lines = picked.map((g) => f(g.r.slot ? G.phrases[g.r.slot].replace(/\{v\}/g, g.r.value) : G.tagPhrases[g.r.tag]));
  return { lines, none: lines.length ? '' : f(G.none) };
}

const POINTS = 8;
/** 每個隱藏數值的曲線資料（給 SVG 小圖用） */
export function curveSeries(st) {
  const out = {};
  for (const g of REVEAL_GROUPS) for (const k of g.keys) {
    const pts = st.curves.map((c) => c[k]);
    out[k] = { pts, start: pts[0], end: pts[pts.length - 1], good: GOOD_WHEN_UP(k) };
  }
  return out;
}

/** 成就欄的結尾句：看遊戲玩到哪裡。國小畢業（一般版）講還沒鋪好的後面；玩到離家（預覽）用離家的句子；其他停在中途的給一句泛用的 */
function endNote(nm, st, tl) {
  const he = st.family.child.pronoun || '他';
  if (tl.stage === '離家') return `${nm}離開家了。你陪到這一天為止；接下來的日子，是${he}自己的。`;
  if (tl.stage === '國小中高' && tl.grade === 6) return `${nm}國小畢業了。接下來是國中，這一版先寫到這裡，後面的路還沒有鋪好。`;
  return `${nm}現在是${tl.label}。這一版先寫到這裡，後面的路還沒有鋪好。`;
}

export function buildEnding(st, data) {
  const w = wellbeing(st, data.identities.parentModel);
  const axes = outcomeAxes(st);
  const nm = st.family.child.given;
  // 陪伴到哪裡：最後一個玩過的回合（遊戲結束時 st.turn 已經指向下一個回合，不能拿它當結束的地方）
  const lastTl = data.timeline[Math.max(0, Math.min(st.ended ? st.turn - 1 : st.turn, data.timeline.length - 1))];
  const score = avgVis(st, '成績', 24);
  const E = data.ending || getEnding(), route = routePosition(st), combo = comboOf(axes);
  const lines = pickLines(endingContext({ axes, wellbeing: w, route, combo }, chainRecords(st, E), E), E).map((l) => ({ ...l, text: fillName(l.text, st) }));
  const home = lines.find((l) => l.facet === 'home');
  return {
    name: nm,
    wellbeing: w,
    line: home.text,
    axes,                                  // 三條結果軸：獨立的一組，不在 achievement 裡，也不進幸福
    achievement: {                         // 只放成績與學校去向
      scoreWord: score >= 70 ? '課業穩穩跟得上' : score >= 55 ? '課業大致跟得上' : score >= 40 ? '課業有些吃力' : '課業很辛苦',
      note: endNote(nm, st, lastTl),
    },
    route,
    growth: growthSection(st, data.tags),  // 你也重新長大了一次（§7.2b）：UI 放在幸福畫面之後
    combo,
    lines,                                 // 結局句子（親子、人際、學習，各有一句不靠特定卡片的後備句；home 的那句＝line）
    moments: keyMoments(st, data),
    chains: buildChains(st, data).chains,   // 決定鏈（M3 B5）：最多 5 條，附年齡、處境、選擇、曲線、痕跡、研究小卡
    classroom: classroomSummary(st, data),  // 這些年，孩子的班上（§1 第二主軸）：只陳述
    groups: REVEAL_GROUPS,
    series: curveSeries(st),
    to: lastTl.stage === '離家' ? '離家' : lastTl.label,
    resources: [
      { name: '安心專線', tel: '1925', note: '24 小時，心理健康與情緒困擾，免費' },
      { name: '教育部家庭教育諮詢專線', tel: '412-8185（手機加 02）', note: '親職、親子溝通與家庭相處的諮詢' },
      { name: '1957 福利諮詢專線', tel: '1957', note: '社會福利與經濟協助的諮詢' },
      { name: '各縣市家庭教育中心', tel: '', note: '親職與親子溝通的諮詢，可上教育部家庭教育網查詢所在縣市的專線' },
      { name: '特教通報與鑑定', tel: '', note: '孩子的學習、注意力或情緒讓你擔心時，可向學校輔導室詢問特教通報與鑑定流程' },
    ],
    reminder: '遊戲裡的孩子是抽出來的，不能用來判斷真實的孩子。再玩一次，會是不同的家庭、不同的孩子。',
    turns: st.hist.length,
  };
}
