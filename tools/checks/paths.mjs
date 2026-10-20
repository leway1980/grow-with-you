// 路線的設計檢驗（M3 B4；計畫 §2.4、§8 第 8 項）。由 tools/check-design.mjs 透過 tools/plugins.mjs 載入。
// 在預覽模式（玩到第 72 回合）讓多種機器人各玩 games 局，量：學制比例、去向比例（依機器人、依經濟）、中途離校、技高的反污名、
// 大學的經濟差、孩子幸福在不同去向的差（只報告）。目標在 tools/targets/paths.json。
// 單獨執行：node tools/checks/paths.mjs [局數] [起始種子]  → 印出所有數值；加 --json 印出摘要的 JSON
import { fileURLToPath } from 'node:url';

const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : NaN);
const median = (a) => { const b = [...a].sort((x, y) => x - y); return b.length ? (b.length % 2 ? b[(b.length - 1) / 2] : (b[b.length / 2 - 1] + b[b.length / 2]) / 2) : NaN; };
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
export const LEFT = ['在家', '工作', '職訓', '實驗教育'];

export async function measure({ runBots, data, T, N, s0 }) {
  const P = data.paths, types = Object.keys(P.schoolTypes), dests = P.destinations.order;
  // 每個機器人用不同的一批種子（不同的家庭）：經濟分層要有足夠多的家庭才穩；機器人之間的差別由各自的比例報告
  const n = T.games ?? N, g = {};
  for (let i = 0; i < T.bots.length; i++) Object.assign(g, await runBots(n, s0 + 700000 + i * n, { bots: [T.bots[i]], preview: true, paths: true }));
  const all = T.bots.flatMap((b) => g[b]).filter((r) => r.paths);
  // 學制、去向的比例
  const typeShare = Object.fromEntries(types.map((t) => [t, share(all, (r) => r.paths.type === t)]));
  const typeByBot = Object.fromEntries(T.bots.map((b) => [b, Object.fromEntries(types.map((t) => [t, share(g[b], (r) => r.paths.type === t)]))]));
  const destByBot = Object.fromEntries(T.bots.map((b) => [b, Object.fromEntries(dests.map((d) => [d, share(g[b], (r) => r.paths.dest === d)]))]));
  const destByEcon = Object.fromEntries(['寬裕', '小康', '吃緊'].map((e) => [e, Object.fromEntries(dests.map((d) => [d, share(all.filter((r) => r.econ === e), (r) => r.paths.dest === d)]))]));
  const destAll = Object.fromEntries(dests.map((d) => [d, share(all, (r) => r.paths.dest === d)]));
  const maxDev = types.map((t) => [t, Math.abs(typeShare[t] - P.schoolTypes[t].base)]).sort((a, b) => b[1] - a[1])[0];
  const botDev = T.bots.map((b) => [b, types.map((t) => [t, Math.abs(typeByBot[b][t] - P.schoolTypes[t].base)]).sort((x, y) => y[1] - x[1])[0]]).sort((a, c) => c[1][1] - a[1][1])[0];
  // 中途離校
  const left = share(all, (r) => LEFT.includes(r.paths.drop)), chain = share(all, (r) => r.paths.chain), started = share(all, (r) => r.paths.drop !== '' && r.paths.drop != null);
  // 目標：沒有任何機器人的任何去向超過 destMax
  let top = { v: 0 };
  for (const b of T.bots) for (const d of dests) if (destByBot[b][d] > top.v) top = { v: destByBot[b][d], b, d };
  // 反污名
  const hands = all.filter((r) => r.paths.snap).map((r) => r.paths.snap.手 ?? 0), grades = all.filter((r) => r.paths.snap).map((r) => r.paths.snap.績);
  const mH = median(hands), mG = median(grades);
  const tech = all.filter((r) => r.paths.type === '技高' && r.paths.snap);
  const techHand = share(tech, (r) => r.paths.snap.手 > mH), techGrade = share(tech, (r) => r.paths.snap.績 > mG);
  // 大學的經濟差
  const pU = (e) => share(all.filter((r) => r.econ === e), (r) => r.paths.dest === '大學');
  const econGap = pU('寬裕') - pU('吃緊');
  const girlsEnlist = all.filter((r) => r.paths.sex === '女' && r.paths.dest === '入伍').length;
  const noDest = all.filter((r) => !r.paths.dest).length;
  // 幸福（只報告）：孩子幸福 w[0]，依機器人、依經濟，大學與就業的平均差
  const wGap = (rs) => { const a = rs.filter((r) => r.paths.dest === '大學').map((r) => r.w[0]), b = rs.filter((r) => r.paths.dest === '就業').map((r) => r.w[0]); return { gap: mean(a) - mean(b), n: [a.length, b.length] }; };
  const wByBot = Object.fromEntries(T.bots.map((b) => [b, wGap(g[b])]));
  const wByEcon = Object.fromEntries(['寬裕', '小康', '吃緊'].map((e) => [e, wGap(all.filter((r) => r.econ === e))]));
  const wByDest = Object.fromEntries(dests.map((d) => [d, { n: all.filter((r) => r.paths.dest === d).length, child: mean(all.filter((r) => r.paths.dest === d).map((r) => r.w[0])) }]));
  const overrideShare = share(all.filter((r) => r.paths.pref === '父母'), (r) => r.paths.override);
  return { all: all.length, typeShare, typeByBot, destByBot, destByEcon, destAll, maxDev, botDev, left, chain, started, top, mH, mG, techHand, techGrade, nTech: tech.length, econGap, pU: { 寬裕: pU('寬裕'), 小康: pU('小康'), 吃緊: pU('吃緊') }, girlsEnlist, noDest, wByBot, wByEcon, wByDest, overrideShare, T };
}

export function rows(v, T, data) {
  const P = data.paths;
  const ok = (x, R) => Number.isFinite(x) && (R.min == null || x >= R.min - 1e-9) && (R.max == null || x <= R.max + 1e-9);
  const row = (R, name, x, s, range, note = '') => ({ ok: ok(x, R), pending: !!T.pending, group: '路線', name, value: s, range, note: `${note}${R.note ? '　[' + R.note + ']' : ''}` });
  const types = Object.keys(P.schoolTypes);
  const fmtGap = (o) => Object.entries(o).map(([k, w]) => `${k} ${Number.isFinite(w.gap) ? (w.gap >= 0 ? '+' : '') + w.gap.toFixed(1) : '—'}（n=${w.n.join('/')}）`).join('、');
  return [
    row({ max: T.shareTol.max, note: T.shareTol.note }, `學制比例與 base 的最大差（各 ${T.games} 局 × ${T.bots.length} 個機器人合計；最大：${v.maxDev[0]}）`, v.maxDev[1], pct(v.maxDev[1]), `≤ ${T.shareTol.max * 100}pp`, types.map((t) => `${t} ${pct(v.typeShare[t])}（base ${pct(P.schoolTypes[t].base)}）`).join('、')),
    { ok: true, pending: false, group: '路線', name: `報告：各機器人學制比例離 base 最遠的一個（最遠：${v.botDev[0]}，${v.botDev[1][0]}）`, value: pct(v.botDev[1][1]), range: '（只報告）', note: Object.entries(v.typeByBot).map(([b, o]) => `${b} ${types.map((t) => pct(o[t])).join('／')}`).join('；') + `　[欄位：${types.join('／')}]` },
    row(T.dropout, `中途離校：孩子真的離開學校（在家、工作、職訓、實驗教育）的局占 ${v.all} 局`, v.left, pct(v.left), `${T.dropout.min * 100}–${T.dropout.max * 100}%`, `前兆出現 ${pct(v.chain)}、走完『我不想讀了』${pct(v.started)}`),
    row(T.destMax, `任何機器人的任何去向占比的最大值（${v.top.b}：${v.top.d}）`, v.top.v, pct(v.top.v), `≤ ${T.destMax.max * 100}%`, '去向合計：' + Object.entries(v.destAll).map(([d, x]) => `${d} ${pct(x)}`).join('、')),
    row(T.stigmaHand, `反污名：技高入學者（${v.nTech} 局）中，動手做興趣高於全體中位數（${v.mH.toFixed(2)}）的比例`, v.techHand, pct(v.techHand), `≥ ${T.stigmaHand.min * 100}%`),
    row(T.stigmaGrade, `反污名：技高入學者中，成績高於全體中位數（z＝${v.mG.toFixed(2)}）的比例`, v.techGrade, pct(v.techGrade), `≥ ${T.stigmaGrade.min * 100}%`),
    row(T.econGap, `P(大學|寬裕) − P(大學|吃緊)（寬裕 ${pct(v.pU.寬裕)}、小康 ${pct(v.pU.小康)}、吃緊 ${pct(v.pU.吃緊)}）`, v.econGap, (v.econGap * 100).toFixed(1) + 'pp', `${T.econGap.min * 100}–${T.econGap.max * 100}pp`),
    row(T.noGirlEnlist, '女生的入伍局數', v.girlsEnlist, String(v.girlsEnlist), '＝ 0', `每一局都有去向：沒有去向的局 ${v.noDest}`),
    { ok: true, pending: false, group: '路線', name: '報告：去向占比（依機器人）', value: Object.entries(v.destByBot).map(([b, o]) => `${b} ${Object.entries(o).map(([d, x]) => `${d}${(x * 100).toFixed(0)}`).join('/')}`).join('；'), range: '（只報告）', note: '' },
    { ok: true, pending: false, group: '路線', name: '報告：去向占比（依經濟）', value: Object.entries(v.destByEcon).map(([e, o]) => `${e} ${Object.entries(o).map(([d, x]) => `${d}${(x * 100).toFixed(0)}`).join('/')}`).join('；'), range: '（只報告）', note: '' },
    { ok: true, pending: false, group: '路線', name: '報告：孩子幸福（0–100）大學 − 就業的平均差（依機器人）', value: fmtGap(v.wByBot), range: '（只報告；沒有一條路是失敗結局）', note: T.wellbeingGapNote },
    { ok: true, pending: false, group: '路線', name: '報告：孩子幸福 大學 − 就業的平均差（依經濟）；各去向的平均', value: fmtGap(v.wByEcon) + '　各去向：' + Object.entries(v.wByDest).map(([d, o]) => `${d} ${Number.isFinite(o.child) ? o.child.toFixed(1) : '—'}（${o.n}）`).join('、'), range: '（只報告）', note: `父母的意見蓋過孩子而且孩子主見高（志願被決定）：父母主導的局中 ${pct(v.overrideShare)}` },
  ];
}

export default async function check(ctx) {
  const T = ctx.TARGETS.paths;
  if (!T) return [];
  const v = await measure({ runBots: ctx.runBots, data: ctx.data, T, N: ctx.N, s0: ctx.s0 });
  return rows(v, T, ctx.data);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const nums = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
  const { runBots } = await import('../simulate.mjs');
  const { loadRaw, loadData } = await import('../data-node.mjs');
  const { loadTargets } = await import('../plugins.mjs');
  const T = { ...loadTargets().paths }, data = loadData(loadRaw());
  if (nums[0]) T.games = nums[0];
  const t0 = Date.now();
  const v = await measure({ runBots, data, T, N: T.games, s0: nums[1] || 1 });
  for (const r of rows(v, T, data)) console.log(`${r.ok ? '✓' : r.pending ? '△' : '✗'} ${r.name}：${r.value}（${r.range}）${r.note}`);
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(0)} 秒，${v.all} 局`);
  if (process.argv.includes('--json')) console.log(JSON.stringify({ typeShare: v.typeShare, destAll: v.destAll, left: v.left, chain: v.chain }, null, 1));
}
