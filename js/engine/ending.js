// 終局（DESIGN §7、§3.1、§11）v0：先給「你們一起的幸福」，成就另外顯示，最後才「回頭看」把所有隱藏數值攤開。純函式、無 DOM。
// 『教養路線』由行為累積出來的位置計算，從不由玩家宣告。簡單的句子產生；組合式的信（47wan 的面向句庫）留到後面的里程碑。

import { stageMult } from './tags.js';
import { evalOutcome, opennessFrom, getModel } from './model.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const last = (arr, n) => arr.slice(-n);

/** 隱藏數值的名稱分組（只在終局揭露用） */
export const REVEAL_GROUPS = [
  { title: '你和孩子之間', keys: ['溫暖陪伴', '規範監督', '親子信任', '了解度', '規則一致性', '替他做主'] },
  { title: '孩子心裡的樣子', keys: ['主見', '自我效能', '內在穩定', '安全感', '承受度', '期待壓力', '試探度'] },
  { title: '家裡的環境與習慣', keys: ['父母示範', '父母情緒穩定度', '自理與責任', '閱讀習慣', '家庭學習環境', '交通安全認知'] },
  { title: '學校那一邊', keys: ['師親信任', '班級風氣'] },
];
export const GOOD_WHEN_UP = (k) => k !== '期待壓力' && k !== '試探度' && k !== '替他做主';

function avgHidden(st, key, n = 99) { return mean(last(st.curves, n).map((c) => c[key]).filter((x) => x != null)); }
function avgVis(st, key, n = 8) { return mean(last(st.vcurves, n).map((c) => c[key]).filter((x) => x != null)); }

/** 結果節點的輸入怎麼讀：hidden＝終點的隱藏數值；vis＝可見數值最近 n 回合的平均；開口度由兩個計數算出（公式與權重在 data/model.json 的 outcomes） */
function reader(st, M) {
  const h = st.hidden;
  return (it) => (it.as === 'vis' ? avgVis(st, it.from, it.n) : it.from === '開口度' ? opennessOf(st, M) : h[it.from]);
}
const modelOf = (st, M) => M || getModel();

/**
 * 三條結果軸（§3.1）：親子、人際、學習。0–100。它們是各自獨立的軸，不會被加進幸福裡。
 * 公式（哪些輸入、權重、懲罰）全部在 data/model.json 的 outcomes：
 * 人際：孩子學到「吵就有、找理由」（試探度高）會被同學疏遠，所以扣分；學習：3C 超過一般的量會扣分（擠掉睡眠與共處時間，§10 第 7 點）。
 */
export function outcomeAxes(st, M) {
  M = modelOf(st, M);
  const r = reader(st, M);
  return { 親子: evalOutcome(M, '親子', r), 人際: evalOutcome(M, '人際', r), 學習: evalOutcome(M, '學習', r) };
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

export function wellbeingLine(w, st) {
  const { child, parent, between } = w;
  const nm = st.family.child.given;
  if (child >= 62 && parent >= 58 && between >= 62) return `週末${nm}還是想跟你一起吃飯，吃完會在客廳多坐一會兒。`;
  if (child >= 60 && parent < 50) return `${nm}長得不錯，你卻累得快認不得自己了。這幾年，你把自己放在最後面。`;
  if (child < 48 && between < 50) return `你們住在同一個屋簷下，但很少真正說話。${nm}的房門常常是關著的。`;
  if (parent >= 60 && child < 52) return `你把日子過得還算穩，${nm}卻有些心事沒說出口。`;
  if (between >= 60) return `事情再難，你們還是會找對方說。這幾年，${nm}知道你在。`;
  if (child < 48 && parent < 48) return `這幾年，你們兩個都撐得很辛苦，很多話還沒來得及說。`;
  return `有好的日子，也有各自撐著的日子。這個家還在繼續。`;
}

/** 路線判定的門檻：和開局相比，變化超過這個值才算「往那邊走」 */
export const ROUTE_DELTA = 8; // 值的來源是 data/model.json 的 bands.routeDelta（tests/lint 檢查兩者一致）；routePosition 讀因果圖
/**
 * 教養路線位置（§3、§7.1 第 5 項）：看「和開局相比」的變化，不是絕對值；不是玩家宣告的。
 * 溫暖、規範、替他做主都沒有明顯變化 ⇒ 未成形／混合。
 */
export function routePosition(st) {
  const s0 = st.startHidden || st.hidden;
  const end = (k) => avgHidden(st, k, 12);
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

/** 一組標籤在這個階段大約推動了多少（只看對照表與階段倍率，不含情境與飽和）：給「關鍵時刻」用，不需要存每次選擇的隱藏變化 */
export function estimateDeltas(tags, stage, T) {
  const out = {};
  for (const t of tags || []) {
    const def = T.tags[t]; if (!def) continue;
    const m = stageMult(def, stage);
    for (const [k, d] of Object.entries(def.d || {})) out[k] = (out[k] || 0) + d * m;
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

export function buildEnding(st, data) {
  const w = wellbeing(st, data.identities.parentModel);
  const axes = outcomeAxes(st);
  const nm = st.family.child.given;
  const stageNow = data.timeline[Math.min(st.turn, data.timeline.length - 1)];
  const score = avgVis(st, '成績', 12);
  return {
    name: nm,
    wellbeing: w,
    line: wellbeingLine(w, st),
    axes,                                  // 三條結果軸：獨立的一組，不在 achievement 裡，也不進幸福
    achievement: {                         // 只放成績與學校去向
      scoreWord: score >= 70 ? '課業穩穩跟得上' : score >= 55 ? '課業大致跟得上' : score >= 40 ? '課業有些吃力' : '課業很辛苦',
      note: `${nm}國小畢業了。接下來是國中，這一版先寫到這裡，後面的路還沒有鋪好。`,
    },
    route: routePosition(st),
    growth: growthSection(st, data.tags),  // 你也重新長大了一次（§7.2b）：UI 放在幸福畫面之後
    combo: comboOf(axes),
    moments: keyMoments(st, data),
    groups: REVEAL_GROUPS,
    series: curveSeries(st),
    to: stageNow.label,
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
