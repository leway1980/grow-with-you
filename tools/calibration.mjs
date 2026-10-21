// 校準目標（DESIGN §3.4 修訂版）。tests/calibration.test.mjs 與 tools/simulate.mjs 共用這一份：現況對目標，一個地方定義。
// 範圍（目標數字）寫在 tools/design-targets.json 的 calibration；這裡只負責「量現況」與「對範圍」（DESIGN §3.7 第 5 點）。
import { loadTargets } from './plugins.mjs';
import { avg, median, share, pct } from './stats.mjs';
import { loadData } from './data-node.mjs';
import { meanCorrelation, CORRELATION_BOUND } from './metrics.mjs';
import { COMBOS } from '../js/engine/ending.js';

export const groupBy = (arr, f) => { const m = {}; for (const x of arr) (m[f(x)] ||= []).push(x); return m; };
export const TARGETS = loadTargets(); // tools/design-targets.json ＋ tools/targets/*.json（plugins.mjs）
const f1 = (x) => x.toFixed(1);
const rangeOf = (id) => { const r = TARGETS.calibration[id]; if (!r) throw new Error(`design-targets.json 沒有校準目標 ${id}`); return r; };
const inRange = (v, r) => (r.min == null || v >= r.min) && (r.max == null || v <= r.max) && (r.gt == null || v > r.gt);
const nf = (x) => (Math.abs(x) < 1 && x !== 0 && !Number.isInteger(x * 100) ? String(x) : String(x)).replace('-', '−');
/** 範圍的文字：≤ 3、≥ 15、> 0、−15 … −5 */
export const rangeText = (r, pct100 = false) => {
  const v = (x) => nf(pct100 ? x * 100 : x) + (pct100 ? '%' : '');
  if (r.gt != null) return `> ${v(r.gt)}`;
  if (r.min != null && r.max != null) return `${v(r.min)} … ${v(r.max)}`;
  return r.min != null ? `≥ ${v(r.min)}` : `≤ ${v(r.max)}`;
};
const ax = (g, i) => avg(g.map((x) => x.ax[i]));
const wb = (g, i) => avg(g.map((x) => x.w[i]));
const hid = (g, k) => avg(g.map((x) => x.hid[k]));

/** 成對差（controlling − warmFirm）的平均與 95% 信賴區間（常態近似）；rows 依種子成對 */
function pairedCI(C, W, pick) {
  const idx = C.map((_, i) => i).filter((i) => pick(C[i]));
  const d = idx.map((i) => C[i].g24 - W[i].g24);
  const m = avg(d), h = d.length > 1 ? 1.96 * Math.sqrt(avg(d.map((x) => (x - m) ** 2)) / (d.length - 1)) : NaN;
  return { n: d.length, mean: m, lo: m - h, hi: m + h };
}
/**
 * 預先登記的 controlling-learn 指標（A2.5 審查 Issue 4）：同一批種子，controlling 與 warmFirm 在開學後前 24 個月的平均可見成績之差。
 * 閘門：整體平均 > 0，且孩子敏感度 ≤ 2 的 95% 信賴區間下界 > 0。敏感度 ≥ 4 的反轉另列為資訊（規則 21 的教學點：壓力對敏感的孩子會反效果），不進閘門。
 */
export function controllingLearn(C, W) {
  const all = pairedCI(C, W, () => true), lowS = pairedCI(C, W, (r) => r.sens <= 2), hiS = pairedCI(C, W, (r) => r.sens >= 4);
  const f = (o) => `${o.mean >= 0 ? '+' : ''}${o.mean.toFixed(2)} [${o.lo.toFixed(2)}, ${o.hi.toFixed(2)}] n=${o.n}`;
  return { id: 'controlling-learn', desc: 'controlling − warmFirm 開學後 24 個月的平均成績（成對）：整體；敏感度 ≤ 2；敏感度 ≥ 4（資訊）', value: `整體 ${f(all)}；敏感度≤2 ${f(lowS)}；敏感度≥4（資訊）${f(hiS)}`, target: '整體 > 0 且 敏感度 ≤ 2 的區間下界 > 0', ok: all.mean > 0 && lowS.lo > 0, detail: { all, lowS, hiS } };
}

/** games: { bot: [紀錄…] }（從出生開始、各策略共用同一批種子） */
export function evaluateCalibration(games) {
  const out = [];
  /** 數字 num 對 design-targets.json 的 calibration[id] 範圍；display 是要印的現況文字（預設 num 一位小數）；pct100：範圍是比例，印成 % */
  const chk = (id, desc, num, display, pct100 = false) => {
    const r = rangeOf(id);
    out.push({ id, desc, value: display ?? (pct100 ? `${(num * 100).toFixed(0)}%` : f1(num)), target: rangeText(r, pct100), ok: inRange(num, r) });
  };
  const { random: R, permissive: P, doseGreedy: D, warmFirm: W, warmFirmRest: WR, antiDose: A, controlling: C } = games;

  chk('dose-vs-random', 'doseGreedy 親子 − random 親子', ax(D, 0) - ax(R, 0));
  chk('wf-vs-dose', 'warmFirm 親子 − doseGreedy 親子', ax(W, 0) - ax(D, 0));
  const worse = { 主見: hid(R, '主見') - hid(D, '主見'), 自我效能: hid(R, '自我效能') - hid(D, '自我效能'), 試探度: hid(D, '試探度') - hid(R, '試探度') };
  chk('dose-worse-hidden', 'doseGreedy 比 random 差的幅度（主見／自我效能／試探度，取最大）', Math.max(...Object.values(worse)));
  const others = Math.min(wb(R, 1), wb(P, 1), wb(D, 1));
  chk('wf-parent', 'warmFirm 父母幸福 − min(random, permissive, doseGreedy)（辛苦但可持續）', wb(W, 1) - others);
  const keys = Object.keys(W[0].hid).filter((k) => k !== '承受度');
  chk('wf-saturation', 'warmFirm 有任何隱藏數值 ≥ 98 的局數比例', share(W, (g) => keys.some((k) => g.hid[k] >= 98)), null, true);
  chk('wf-range', 'warmFirm 親子', ax(W, 0));
  const rc = {};
  R.forEach((g) => { rc[g.route] = (rc[g.route] || 0) + 1; });
  const rmax = Math.max(...Object.values(rc)) / R.length, rwf = (rc['陪又要求'] || 0) / R.length;
  const rr = rangeOf('random-route');
  out.push({ id: 'random-route', desc: 'random 路線最大類別 / 陪又要求', value: `${(rmax * 100).toFixed(0)}% / ${(rwf * 100).toFixed(0)}%（${Object.entries(rc).map(([k, v]) => `${k} ${(v / R.length * 100).toFixed(0)}%`).join('、')}）`, target: `≤ ${rr.maxLargest * 100}% / ≤ ${rr.maxWarmFirm * 100}%`, ok: rmax <= rr.maxLargest && rwf <= rr.maxWarmFirm });
  chk('permissive-collapse', 'permissive 走到「三邊都垮」的比例', share(P, (g) => g.combo === '三邊都垮'), null, true);
  // A2.5 護欄：時間尺度改了之後，兩條路線／組合的比例不能掉出範圍
  chk('dose-high-route', 'doseGreedy 走到「高壓做主」路線的比例', share(D, (g) => g.route === '高壓做主'), null, true);
  chk('wf-all-good', 'warmFirm 走到「三邊都顧到」的比例', share(W, (g) => g.combo === '三邊都顧到'), null, true);
  // 組合分類器要真的可達（E1 審查：以前這一條的 ok 寫死 true，只分類到 3/7 也會過）：主要策略合起來至少分類到 5 種（不含『其他』）
  const classified = new Set(Object.values(games).flat().map((g) => g.combo));
  const hit = COMBOS.filter((c) => c !== '其他' && classified.has(c));
  chk('combos-classified', '主要策略合起來分類到的組合數（七種，不含「其他」）', hit.length, `${hit.length}/7（${hit.join('、')}）`);
  // 方向（E1 審查）：三邊都垮的常見路是放任（DESIGN §3.1），不是高壓；高壓的典型結局是「成績好、關係冷」「成績好、人際孤立」
  const collapse = (g) => share(g, (x) => x.combo === '三邊都垮');
  chk('perm-gt-ctrl-collapse', 'permissive 三邊都垮的比例 − controlling 三邊都垮的比例', collapse(P) - collapse(C), `${((collapse(P) - collapse(C)) * 100).toFixed(0)} 個百分點（permissive ${(collapse(P) * 100).toFixed(0)}%、controlling ${(collapse(C) * 100).toFixed(0)}%）`);
  chk('ctrl-achiever', 'controlling 走到「成績好、關係冷」或「成績好、人際孤立」的比例（高壓的典型結局）', share(C, (x) => x.combo === '成績好、關係冷' || x.combo === '成績好、人際孤立'), null, true);
  // 家境：同一個機器人，寬裕 vs 吃緊
  let worstGap = 0, worstBot = '';
  for (const [bot, g] of Object.entries(games)) {
    const e = groupBy(g, (x) => x.econ);
    if (e.寬裕 && e.吃緊) { const gap = Math.abs(wb(e.寬裕, 1) - wb(e.吃緊, 1)); if (gap > worstGap) { worstGap = gap; worstBot = bot; } }
  }
  chk('econ-parent-gap', '同一個機器人，寬裕 vs 吃緊的父母幸福差距（各策略取最大）', worstGap, `${f1(worstGap)}（${worstBot}）`);
  let worstBroke = 0;
  for (const [, g] of Object.entries(games)) { const t = (groupBy(g, (x) => x.econ).吃緊 || []).filter((x) => x.money30 != null); if (t.length) worstBroke = Math.max(worstBroke, share(t, (x) => x.money30 < 5)); }
  chk('broke-share', '吃緊的局，國小開始後 6 個月（第一個月齡 ≥ 開學 + 6 的回合）錢 < 5 的比例（各策略取最大）', worstBroke, null, true);
  // 開局條件
  let worst = 0, worstVar = '';
  for (const [name, f] of [['家境', (g) => g.econ], ['工時', (g) => g.pattern], ['升學資源', (g) => g.support]]) {
    const grp = Object.values(groupBy(W, f)).filter((a) => a.length >= 8).map((a) => ax(a, 0));
    const gap = Math.max(...grp) - Math.min(...grp);
    if (gap > worst) { worst = gap; worstVar = name; }
  }
  chk('opening-gap', 'warmFirm 親子在各開局條件之間的最大差距（家境、工時、升學資源；組內 ≥ 8 局）', worst, `${f1(worst)}（${worstVar}）`);
  // 休息
  chk('rest-parent', 'warmFirmRest 父母幸福 − warmFirm', wb(WR, 1) - wb(W, 1));
  chk('rest-loss', 'warmFirm 親子 − warmFirmRest 親子', ax(W, 0) - ax(WR, 0));
  // 第二輪（紅隊審查）：反向洩漏、結果的不確定性、父母的代價
  chk('anti-vs-random', 'antiDose（每次選看得到的變化最差的）親子 − random 親子', ax(A, 0) - ax(R, 0));
  chk('anti-vs-wf', 'antiDose 親子 − warmFirm 親子', ax(A, 0) - ax(W, 0));
  const data = loadData();
  const mc = meanCorrelation(data.tags, data.events.cards);
  const cr = rangeOf('dose-hidden-corr');
  out.push({ id: 'dose-hidden-corr', desc: '各卡「劑量表分數 vs 隱藏分數」Spearman 相關的平均', value: f1(mc), target: `±${cr.absMax}`, ok: Math.abs(mc) <= cr.absMax });
  const wfAx = W.map((g) => g.ax[0]);
  chk('wf-width', 'warmFirm 親子 P10–P90 的寬度（教養是機率，不是必然）', pct(wfAx, 0.9) - pct(wfAx, 0.1));
  chk('wf-outside-good', 'warmFirm 的局落在兩個好組合之外的比例', share(W, (g) => g.combo !== '三邊都顧到' && g.combo !== '關係好、人際好，成績普通'), null, true);
  out.push(controllingLearn(C, W));
  const pg = groupBy(W, (x) => x.partner);
  const together = pg['一起陪'] || [], absent = [...(pg['只出錢'] || []), ...(pg['幾乎不在家'] || [])];
  const pgap = wb(together, 1) - wb(absent, 1);
  chk('partner-gap', 'warmFirm 父母幸福：另一半一起陪 − 只出錢／幾乎不在家', pgap, `${f1(pgap)}（${together.length} 局 vs ${absent.length} 局）`);
  // 節奏
  const ns = avg(W.map((g) => g.elemNonFixed / g.nTurnsElem)), nsMin = Math.min(...W.map((g) => g.elemNonFixed / g.nTurnsElem));
  chk('nonfixed-share', '非固定事件的卡 ÷ 國小回合數（warmFirm 平均／最低）', ns, `${f1(ns * 100)}% / ${f1(nsMin * 100)}%`, true);
  const fu = Object.values(games).flat().flatMap((g) => g.fu);
  const fr = rangeOf('followup-delay');
  out.push({ id: 'followup-delay', desc: '後續卡的延遲（從排進去到出現，月）中位數', value: fu.length ? f1(median(fu)) : 'NaN', target: rangeText(fr), ok: fu.length > 0 && inRange(median(fu), fr) });
  return out;
}
