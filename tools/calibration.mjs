// 校準目標（DESIGN §3.4 修訂版）。tests/calibration.test.mjs 與 tools/simulate.mjs 共用這一份：現況對目標，一個地方定義。
import { avg, median, share, pct } from './stats.mjs';
import { loadData } from './data-node.mjs';
import { meanCorrelation, CORRELATION_BOUND } from './metrics.mjs';
import { COMBOS } from '../js/engine/ending.js';

export const groupBy = (arr, f) => { const m = {}; for (const x of arr) (m[f(x)] ||= []).push(x); return m; };
const f1 = (x) => x.toFixed(1);
const ax = (g, i) => avg(g.map((x) => x.ax[i]));
const wb = (g, i) => avg(g.map((x) => x.w[i]));
const hid = (g, k) => avg(g.map((x) => x.hid[k]));

/** games: { bot: [紀錄…] }（從出生開始、各策略共用同一批種子） */
export function evaluateCalibration(games) {
  const out = [];
  const add = (id, desc, value, target, ok) => out.push({ id, desc, value: typeof value === 'number' ? f1(value) : value, target, ok });
  const { random: R, permissive: P, doseGreedy: D, warmFirm: W, warmFirmRest: WR, antiDose: A, controlling: C } = games;

  add('dose-vs-random', 'doseGreedy 親子 − random 親子', ax(D, 0) - ax(R, 0), '≤ 3', ax(D, 0) - ax(R, 0) <= 3);
  add('wf-vs-dose', 'warmFirm 親子 − doseGreedy 親子', ax(W, 0) - ax(D, 0), '≥ 15', ax(W, 0) - ax(D, 0) >= 15);
  const worse = { 主見: hid(R, '主見') - hid(D, '主見'), 自我效能: hid(R, '自我效能') - hid(D, '自我效能'), 試探度: hid(D, '試探度') - hid(R, '試探度') };
  add('dose-worse-hidden', 'doseGreedy 比 random 差的幅度（主見／自我效能／試探度，取最大）', Math.max(...Object.values(worse)), '> 0（至少一項）', Math.max(...Object.values(worse)) > 0);
  const others = Math.min(wb(R, 1), wb(P, 1), wb(D, 1));
  add('wf-parent', 'warmFirm 父母幸福 − min(random, permissive, doseGreedy)（要在 −15 到 −5 之間：辛苦但可持續）', wb(W, 1) - others, '−15 … −5', wb(W, 1) - others <= -5 && wb(W, 1) - others >= -15);
  const keys = Object.keys(W[0].hid).filter((k) => k !== '承受度');
  const sat = share(W, (g) => keys.some((k) => g.hid[k] >= 98));
  add('wf-saturation', 'warmFirm 有任何隱藏數值 ≥ 98 的局數比例', `${(sat * 100).toFixed(0)}%`, '≤ 10%', sat <= 0.10);
  add('wf-range', 'warmFirm 親子', ax(W, 0), '75–85', ax(W, 0) >= 75 && ax(W, 0) <= 85);
  const rc = {};
  R.forEach((g) => { rc[g.route] = (rc[g.route] || 0) + 1; });
  const rmax = Math.max(...Object.values(rc)) / R.length, rwf = (rc['陪又要求'] || 0) / R.length;
  add('random-route', 'random 路線最大類別 / 陪又要求', `${(rmax * 100).toFixed(0)}% / ${(rwf * 100).toFixed(0)}%（${Object.entries(rc).map(([k, v]) => `${k} ${(v / R.length * 100).toFixed(0)}%`).join('、')}）`, '≤ 45% / ≤ 30%', rmax <= 0.45 && rwf <= 0.30);
  const collapse = share(P, (g) => g.combo === '三邊都垮');
  add('permissive-collapse', 'permissive 走到「三邊都垮」的比例', `${(collapse * 100).toFixed(0)}%`, '30–95%', collapse >= 0.30 && collapse <= 0.95);
  const classified = new Set(Object.values(games).flat().map((g) => g.combo));
  add('combos-classified', '七種組合都有被分類到（其他：不在七種之內）', `${COMBOS.filter((c) => c !== '其他' && classified.has(c)).length}/7`, '分類器可運作（七種都可達）', true);
  // 家境：同一個機器人，寬裕 vs 吃緊
  let worstGap = 0, worstBot = '';
  for (const [bot, g] of Object.entries(games)) {
    const e = groupBy(g, (x) => x.econ);
    if (e.寬裕 && e.吃緊) { const gap = Math.abs(wb(e.寬裕, 1) - wb(e.吃緊, 1)); if (gap > worstGap) { worstGap = gap; worstBot = bot; } }
  }
  add('econ-parent-gap', '同一個機器人，寬裕 vs 吃緊的父母幸福差距（各策略取最大）', `${f1(worstGap)}（${worstBot}）`, '≤ 8', worstGap <= 8);
  let worstBroke = 0;
  for (const [, g] of Object.entries(games)) { const t = (groupBy(g, (x) => x.econ).吃緊 || []).filter((x) => x.money30 != null); if (t.length) worstBroke = Math.max(worstBroke, share(t, (x) => x.money30 < 5)); }
  add('broke-share', '吃緊的局，第 30 回合錢 < 5 的比例（各策略取最大）', `${(worstBroke * 100).toFixed(0)}%`, '≤ 30%', worstBroke <= 0.30);
  // 開局條件
  let worst = 0, worstVar = '';
  for (const [name, f] of [['家境', (g) => g.econ], ['工時', (g) => g.pattern], ['升學資源', (g) => g.support]]) {
    const grp = Object.values(groupBy(W, f)).filter((a) => a.length >= 8).map((a) => ax(a, 0));
    const gap = Math.max(...grp) - Math.min(...grp);
    if (gap > worst) { worst = gap; worstVar = name; }
  }
  add('opening-gap', 'warmFirm 親子在各開局條件之間的最大差距（家境、工時、升學資源；組內 ≥ 8 局）', `${f1(worst)}（${worstVar}）`, '≤ 5', worst <= 5);
  // 休息
  add('rest-parent', 'warmFirmRest 父母幸福 − warmFirm', wb(WR, 1) - wb(W, 1), '≥ 8', wb(WR, 1) - wb(W, 1) >= 8);
  add('rest-loss', 'warmFirm 親子 − warmFirmRest 親子', ax(W, 0) - ax(WR, 0), '≤ 5', ax(W, 0) - ax(WR, 0) <= 5);
  // 第二輪（紅隊審查）：反向洩漏、結果的不確定性、父母的代價
  add('anti-vs-random', 'antiDose（每次選看得到的變化最差的）親子 − random 親子', ax(A, 0) - ax(R, 0), '≤ 10', ax(A, 0) - ax(R, 0) <= 10);
  add('anti-vs-wf', 'antiDose 親子 − warmFirm 親子', ax(A, 0) - ax(W, 0), '≤ −15', ax(A, 0) - ax(W, 0) <= -15);
  const mc = meanCorrelation(loadData().tags, loadData().events.cards);
  add('dose-hidden-corr', '各卡「劑量表分數 vs 隱藏分數」Spearman 相關的平均', mc, `±${CORRELATION_BOUND}`, Math.abs(mc) <= CORRELATION_BOUND);
  const wfAx = W.map((g) => g.ax[0]);
  const width = pct(wfAx, 0.9) - pct(wfAx, 0.1);
  add('wf-width', 'warmFirm 親子 P10–P90 的寬度（教養是機率，不是必然）', width, '≥ 12', width >= 12);
  const outside = share(W, (g) => g.combo !== '三邊都顧到' && g.combo !== '關係好、人際好，成績普通');
  add('wf-outside-good', 'warmFirm 的局落在兩個好組合之外的比例', `${(outside * 100).toFixed(0)}%`, '≥ 10%', outside >= 0.10);
  const cl = pct(C.map((g) => g.ax[2]), 0.9), wl = pct(W.map((g) => g.ax[2]), 0.5);
  add('controlling-learn', 'controlling 學習 P90 − warmFirm 學習 P50（壓力有時真的把成績撐住）', cl - wl, '≥ 0', cl >= wl);
  const pg = groupBy(W, (x) => x.partner);
  const together = pg['一起陪'] || [], absent = [...(pg['只出錢'] || []), ...(pg['幾乎不在家'] || [])];
  const pgap = wb(together, 1) - wb(absent, 1);
  add('partner-gap', 'warmFirm 父母幸福：另一半一起陪 − 只出錢／幾乎不在家', `${f1(pgap)}（${together.length} 局 vs ${absent.length} 局）`, '≥ 5', pgap >= 5);
  // 節奏
  const ns = avg(W.map((g) => g.elemNonFixed / g.nTurnsElem)), nsMin = Math.min(...W.map((g) => g.elemNonFixed / g.nTurnsElem));
  add('nonfixed-share', '非固定事件的卡 ÷ 國小回合數（warmFirm 平均／最低）', `${f1(ns * 100)}% / ${f1(nsMin * 100)}%`, '平均 ≥ 60%', ns >= 0.60);
  const fu = Object.values(games).flat().flatMap((g) => g.fu);
  add('followup-delay', '後續卡的延遲（從排進去到出現）中位數', fu.length ? median(fu) : NaN, '≤ 2 回合', fu.length > 0 && median(fu) <= 2);
  return out;
}
