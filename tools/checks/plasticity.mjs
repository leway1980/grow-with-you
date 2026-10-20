// 階段可塑性的設計檢驗（M3 B1；計畫 §2.1、§8 第 2–4 項）。由 tools/check-design.mjs 透過 tools/plugins.mjs 載入。
// 用分段機器人（tools/bots.mjs PLASTICITY_BOTS）在預覽模式（玩到第 72 回合）各玩 games 局，比較親子軸（ax.0）與彼此之間的幸福（w.2）。
// 目標在 tools/targets/plasticity.json，pending:true ＝ 只報告、不擋 CI（預覽內容還薄，E1 會強制）。
// 掃描：node tools/checks/plasticity.mjs --sweep [局數=600] [起始種子=1]  → 依序試 byStage 候選（環境變數 GWY_BYSTAGE 覆蓋，不改檔），印表格，挑第一組全部通過的。
import { fileURLToPath } from 'node:url';
import { avg } from '../stats.mjs';

const mean = (games, f) => avg(games.map(f));
const ax0 = (r) => r.ax[0], w2 = (r) => r.w[2];

/** 一個機器人在第 turn 回合開始時是否在『不太來找你』裡，以及之後是否離開 */
function inApproachAtSwitch(r, data, turn) {
  const m = data.timeline[Math.max(0, turn - 1)].ageMonths; // 切換前最後玩的回合
  const ep = (r.episodes || []).find((e) => e.enter <= m && (e.exit == null || e.exit > m));
  return ep ? { exited: ep.exit != null } : null;
}

/** 量測：回傳 { v（各項數值）, rows（check-design 的列）, table（掃描用的一行） } */
export async function measure({ runBots, data, T, N, s0 }) {
  const bots = T.bots;
  const g = await runBots(T.games ?? N, s0 + 400000, { bots, preview: true, snap: [50] });
  const A = Object.fromEntries(bots.map((b) => [b, mean(g[b], ax0)])), W = Object.fromEntries(bots.map((b) => [b, mean(g[b], w2)]));
  const early = 'earlyGood', late = 'lateStarter', vl = 'veryLateStarter', never = 'neverChange';
  const sw = T.veryLateApproachExit.switchTurn;
  const inState = g[vl].map((r) => inApproachAtSwitch(r, data, sw)).filter(Boolean);
  const exitRate = inState.length ? inState.filter((x) => x.exited).length / inState.length : NaN;
  // 同劑量的嚴厲：earlyHarshLate 的嚴厲在遊戲最後（第 50–71 回合），在遊戲結束時量；elemHarsh 的嚴厲在第 28–49 回合，在第 50 回合開始時（劑量剛結束）量；
  // 兩者都對『同一批種子的 earlyGood 在同一時間點』取差。（不能都在遊戲結束時量：結果軸看最近 24 個月，國小的嚴厲後來被溫暖蓋過，會讓比值虛高。）
  const at50 = (b) => mean(g[b], (r) => r.axAt[50][0]);
  const dropHarsh = A[early] - A.earlyHarshLate, dropElem = at50(early) - at50('elemHarsh');
  const v = {
    repair: (A[late] - A[never]) / (A[early] - A[never]), earlyLate: A[early] - A[late], vlNever: A[vl] - A[never], exitRate, nIn: inState.length,
    harshRatio: dropHarsh / dropElem, dropHarsh, dropElem, lapse: A[early] - A.earlyLapse,
    wEarlyLate: W[early] - W[late], wLateNever: W[late] - W[never], wVlNever: W[vl] - W[never], wLapse: W[early] - W.earlyLapse,
  };
  const ok = (x, R) => Number.isFinite(x) && (R.min == null || x >= R.min) && (R.max == null || x <= R.max);
  const f1 = (x) => (x >= 0 ? '+' : '') + x.toFixed(1), rng = (R) => (R.min != null && R.max != null ? `${R.min}–${R.max}` : R.min != null ? `≥ ${R.min}` : `≤ ${R.max}`);
  const n = `（各 ${g[early].length} 局）`;
  const row = (R, name, value, note = '', range = rng(R)) => ({ ok: ok(value.x, R), pending: !!T.pending, group: '階段可塑性', name: name + n, value: value.s, range, note: `${T.pending ? 'pending：預覽內容還薄，E1 強制。' : ''}${note}${R.note ? '　[' + R.note + ']' : ''}` });
  const rows = [
    row(T.repairRatio, '補救比例 (lateStarter−neverChange)/(earlyGood−neverChange)，親子軸', { x: v.repair, s: v.repair.toFixed(2) }, `earlyGood ${A[early].toFixed(1)}、lateStarter ${A[late].toFixed(1)}、neverChange ${A[never].toFixed(1)}`),
    row(T.earlyMinusLate, 'earlyGood − lateStarter，親子軸', { x: v.earlyLate, s: f1(v.earlyLate) }, `彼此之間幸福 w.2：${f1(v.wEarlyLate)}`),
    row(T.veryLateMinusNever, 'veryLateStarter − neverChange，親子軸', { x: v.vlNever, s: f1(v.vlNever) }, `veryLateStarter ${A[vl].toFixed(1)}；w.2：${f1(v.wVlNever)}`),
    row(T.veryLateApproachExit, `veryLateStarter：第 ${sw} 回合時在『不太來找你』的局，之後離開的比例（${inState.length} 局）`, { x: v.exitRate, s: (v.exitRate * 100).toFixed(0) + '%' }, '', `≥ ${T.veryLateApproachExit.min * 100}%`),
    row(T.harshLateVsElem, 'earlyHarshLate 的親子軸下降 ÷ 同劑量嚴厲放在國小（elemHarsh）的下降', { x: v.harshRatio, s: v.harshRatio.toFixed(2) }, `國中起嚴厲，到第 72 回合下降 ${v.dropHarsh.toFixed(1)}；國小嚴厲，到第 50 回合下降 ${v.dropElem.toFixed(1)}`),
    row(T.earlyMinusLapse, 'earlyGood − earlyLapse，親子軸', { x: v.lapse, s: f1(v.lapse) }, `w.2：${f1(v.wLapse)}`),
    { ok: true, pending: false, group: '階段可塑性', name: `報告：lateStarter − neverChange 的 w.2 ${n}`, value: f1(v.wLateNever), range: '（只報告）', note: `ax.0：${f1(A[late] - A[never])}` },
  ];
  return { v, rows, A, W };
}

export default async function check(ctx) {
  const T = ctx.TARGETS.plasticity;
  if (!T) return [];
  return (await measure({ runBots: ctx.runBots, data: ctx.data, T, N: ctx.N, s0: ctx.s0 })).rows;
}

/* ───── 掃描 ───── */
const STAGES = ['嬰幼兒', '幼兒園', '國小低', '國小中高', '國中', '高中', '離家'];
const FROM = [1, 1, 0.9, 0.8, 0.65, 0.5, 0.4], TO = [1, 1, 0.95, 0.9, 0.8, 0.7, 0.6];
const candidate = (t) => Object.fromEntries(STAGES.map((s, i) => [s, +(FROM[i] + (TO[i] - FROM[i]) * t).toFixed(3)]));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--sweep')) {
  const nums = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
  const { runBots } = await import('../simulate.mjs');
  const { loadRaw, loadData } = await import('../data-node.mjs');
  const { loadTargets } = await import('../plugins.mjs');
  const T = loadTargets().plasticity, N = nums[0] || T.games, s0 = nums[1] || 1;
  const sets = [['全部 1', Object.fromEntries(STAGES.map((s) => [s, 1]))], ...[0, 0.25, 0.5, 0.75, 1].map((t) => [`t=${t}`, candidate(t)])];
  const only = process.argv.find((a) => a.startsWith('--only='));
  let first = null;
  for (const [name, bs] of sets) {
    if (only && !only.slice(7).split(',').includes(name)) continue;
    process.env.GWY_BYSTAGE = JSON.stringify(bs);
    const data = loadData(loadRaw());
    const res = await measure({ runBots, data, T: { ...T, games: N }, N, s0 });
    const v = res.v, bad = res.rows.filter((r) => !r.ok);
    console.log(`\n【${name}】byStage = ${STAGES.map((s) => bs[s]).join(', ')}`);
    for (const r of res.rows) console.log(`  ${r.ok ? '✓' : '✗'} ${r.name}：${r.value}（${r.range}）${r.note.replace('pending：預覽內容還薄，E1 強制。', '')}`);
    console.log(`  → ${bad.length ? '未通過 ' + bad.length + ' 項' : '全部通過'}；w.2 early−late ${v.wEarlyLate.toFixed(1)}、late−never ${v.wLateNever.toFixed(1)}`);
    if (!bad.length && !first && name !== '全部 1') first = [name, bs];
  }
  console.log(first ? `\n第一組全部通過：${first[0]} ${JSON.stringify(first[1])}` : '\n沒有任何一組通過全部目標');
}
