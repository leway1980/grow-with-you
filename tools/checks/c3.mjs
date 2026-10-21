// 手機與平板的依賴度（DESIGN §4.39）與假日邀約（§4.40）的設計檢驗。由 tools/check-design.mjs 透過 tools/plugins.mjs 載入。
// 用 C3_BOTS（tools/bots.mjs）在同一批種子上各玩 games 局，比較成對差；判定是『平均差的單邊 95% 界限』（z＝1.645）加上幅度 ≥ minDiff。
// 各組除了螢幕（或邀約）的做法，其他選擇完全一樣（同一個 fallback、avoid 3C當保母），所以組間的差是那個做法造成的。目標在 tools/targets/3c.json。
import { C3_PERM_BASES } from '../bots.mjs';

export const meanSe = (xs) => {
  const n = xs.length, m = n ? xs.reduce((a, b) => a + b, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, se: sd / Math.sqrt(n), sd };
};
const f1 = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : 'NaN');
const pair = (A, B, f) => A.map((r, i) => f(r) - f(B[i]));

/**
 * 一次大活動的回彈判定（純函式，測試也用它）。pairs＝[{ trip:{post,d12}, base:{post,d12} }]：同一個種子、只差在旅行卡那一個選擇的兩局，
 * 各自在旅行那個回合結束時（post）與 12 個月後（d12）的依賴度。dip＝base.post − trip.post（當下的下降）；留下的＝base.d12 − trip.d12。
 * 『彈回去』＝留下的 ≤ retain × dip（預設 20%）：每對算 y＝留下的 − retain × dip，y 平均的單邊 95% 上界 < 0；而且當下確實下降（dip 平均 ≥ dipMin、下界 > 0）。
 * 和活動前的水準比較不行：依賴度本來就隨時間上升，『回到活動前的水準』在沒有任何回彈機制時也成立（審查發現）。
 */
export function reboundVerdict(pairs, R, z = 1.645) {
  const dip = meanSe(pairs.map((p) => p.base.post - p.trip.post));
  const y = meanSe(pairs.map((p) => (p.base.d12 - p.trip.d12) - R.retain * (p.base.post - p.trip.post)));
  const left = pairs.length ? pairs.reduce((a, p) => a + (p.base.d12 - p.trip.d12), 0) / pairs.length : NaN;
  const up = y.mean + z * y.se, dl = dip.mean - z * dip.se;
  return { n: pairs.length, dip: dip.mean, dipLo: dl, left, retained: left / dip.mean, yMean: y.mean, yUp: up, ok: pairs.length >= R.minTrips && up < 0 && dl > 0 && dip.mean >= R.dipMin };
}

/** 量測：回傳 { rows } */
export async function measure({ runBots, T, N, s0, data }) {
  const games = T.games ?? N, z = T.z ?? 1.645;
  const core = ['c3Base', 'c3Agreed', 'c3Task', 'c3Limit', 'c3Confiscate', 'c3Companion', 'c3LateCompanion', 'c3Trip', 'c3NoTrip', 'wkAccept', 'wkMonthly', 'wkDecline'];
  const perm = C3_PERM_BASES.flatMap((b) => [`c3Ctrl_${b}`, `c3Perm_${b}`]);
  const g = await runBots(games, s0 + 500000, { bots: core, c3: true });
  const gp = await runBots(T.permissive.games ?? games, s0 + 500000, { bots: perm, c3: true });
  const rows = [];
  const add = (ok, name, value, range, note = '', pending = false) => rows.push({ ok, pending: pending && !ok, group: '3C 與假日邀約', name, value, range, note });
  const end = (r) => r.dep.end;
  const ordering = (A, B, label, R, kind) => { // kind: 'lt'＝A 比 B 低（嚴格，幅度 ≥ minDiff）；'le'＝A 不比 B 高（沒有顯著較高：下界 ≤ 0）
    const s = meanSe(pair(g[A], g[B], end)), up = s.mean + z * s.se, lo = s.mean - z * s.se;
    if (kind === 'lt') add(up < 0 && s.mean <= -R.minDiff, `${label}：終點依賴度（各 ${games} 局）`, `${f1(s.mean)}（單邊 95% 上界 ${f1(up)}）`, `≤ −${R.minDiff} 且上界 < 0`, R.note);
    else add(s.mean <= R.tol, `${label}：終點依賴度（各 ${games} 局）`, `${f1(s.mean)}（單邊 95% 下界 ${f1(lo)}）`, `平均差 ≤ +${R.tol}（打平的容許）`, R.note);
  };
  // 1. 排序：任務借用 ＜ 約定且在旁 ≤ 只限時間 ＜ 只沒收 ＜ 什麼都不管；持續陪伴 ＜ 只沒收；已經升高的依賴度能被陪伴拉下來
  ordering('c3Task', 'c3Agreed', '任務型借用 − 約定且在旁', T.order.taskAgreed, 'lt');
  ordering('c3Agreed', 'c3Limit', '約定且在旁 − 只加時間管控', T.order.agreedLimit, 'lt');
  ordering('c3Limit', 'c3Confiscate', '只加時間管控 − 只強制收回', T.order.limitConfiscate, 'lt');
  ordering('c3Confiscate', 'c3Base', '只強制收回 − 給了就不管', T.order.confiscateBase, 'lt');
  ordering('c3Companion', 'c3Confiscate', '持續陪伴 − 只強制收回', T.companionVsConfiscate, 'lt');
  ordering('c3LateCompanion', 'c3Base', '前半給了就不管、後來改持續陪伴 − 一路給了就不管（已經升高的依賴度被拉下來）', T.lateCompanion, 'lt');
  // 2. 一次大活動：先降，12 個月後留下的 ≤ 20%（和配對的對照比，不是和活動前的水準比）
  {
    const R = T.tripRebound;
    const pairs = g.c3Trip.map((r, i) => [r, g.c3NoTrip[i]]).filter(([a, b]) => a.dep.trip && b.dep.trip && a.dep.trip.took && !b.dep.trip.took && a.dep.trip.turn === b.dep.trip.turn && a.dep.trip.pre - a.dep.base >= 5).map(([a, b]) => ({ trip: a.dep.trip, base: b.dep.trip }));
    const v = reboundVerdict(pairs, R, z);
    add(v.ok, `一次大活動 ${R.windowMonths} 個月後留下的 ÷ 當下的下降（和配對的對照比，${v.n} 對）`, `${(v.retained * 100).toFixed(0)}%（留下 ${f1(v.left)}，下降 ${f1(v.dip)}；y 平均 ${f1(v.yMean)}，單邊 95% 上界 ${f1(v.yUp)}）`, `≤ ${R.retain * 100}%（y 上界 < 0），下降 ≥ ${R.dipMin} 且下界 > 0，≥ ${R.minTrips} 對`, R.note);
  }
  // 3. 假日邀約：每個符合資格的局，一律接收到幾次邀約；滾雪球；一律接 vs 一律婉拒；接但每月一次不是嚴格優勢
  {
    const R = T.weekend, idx = g.wkAccept.map((r, i) => i).filter((i) => g.wkAccept[i].dep.elig && g.wkDecline[i].dep.elig && g.wkMonthly[i].dep.elig);
    const A = idx.map((i) => g.wkAccept[i]), D = idx.map((i) => g.wkDecline[i]), M = idx.map((i) => g.wkMonthly[i]);
    if (A.length < R.minElig) add(false, '假日邀約：樣本', `只有 ${A.length} 對符合資格`, `≥ ${R.minElig} 對`, R.note);
    else {
      const ia = meanSe(A.map((r) => r.dep.invites)), id = meanSe(D.map((r) => r.dep.invites));
      add(ia.mean >= R.minInvites, `一律接：每個符合資格的局收到的邀約（${A.length} 局）`, `${ia.mean.toFixed(2)} 次`, `≥ ${R.minInvites}`, R.noteSnowball);
      add(ia.mean >= R.snowballRatio * id.mean, `滾雪球：一律接 ÷ 一律婉拒的邀約次數`, `${ia.mean.toFixed(2)} ÷ ${id.mean.toFixed(2)} ＝ ${(ia.mean / id.mean).toFixed(2)}`, `≥ ${R.snowballRatio}`);
      for (const [key, label, f, sign] of [['money', '錢（整局平均）', (r) => r.dep.money, 1], ['work', '工作表現（整局平均）', (r) => r.dep.work, 1], ['ax0', '親子軸', (r) => r.ax[0], -1]]) {
        const s = meanSe(pair(A, D, f)), bound = sign > 0 ? s.mean - z * s.se : s.mean + z * s.se;
        const dz = s.mean / s.sd;
        add(sign > 0 ? bound > 0 && s.mean >= R.minDiff[key] : bound < 0 && s.mean <= -R.minDiff[key], `一律接 − 一律婉拒：${label}（${A.length} 對）`, `${f1(s.mean)}（單邊 95% ${sign > 0 ? '下' : '上'}界 ${f1(bound)}；差的標準差 ${s.sd.toFixed(2)}，標準化大小 ${dz.toFixed(2)}）`, `${sign > 0 ? '≥ +' : '≤ −'}${R.minDiff[key]} 且界限${sign > 0 ? ' > ' : ' < '}0`, key === 'ax0' ? R.noteAx0 : key === 'money' ? R.note : '');
      }
      // 接但每月一次：錢與工作表現比婉拒高、比一律接低；親子軸不比婉拒高（沒有顯著較高）、比一律接高 —— 不是每一項都贏
      const mk = (f) => ({ md: meanSe(pair(M, D, f)), am: meanSe(pair(A, M, f)) });
      for (const [label, f] of [['錢', (r) => r.dep.money], ['工作表現', (r) => r.dep.work]]) {
        const { md, am } = mk(f);
        add(md.mean - z * md.se > 0 && am.mean - z * am.se > 0, `接但每月一次介於中間：${label}（接 − 每月一次 ${f1(am.mean)}、每月一次 − 婉拒 ${f1(md.mean)}）`, `兩個差的單邊 95% 下界 ${f1(am.mean - z * am.se)}／${f1(md.mean - z * md.se)}`, '都 > 0', R.noteMonthly);
      }
      {
        const { md } = mk((r) => r.ax[0]);
        add(md.mean - z * md.se <= 0, `接但每月一次不比婉拒好：親子軸（每月一次 − 婉拒）`, `${f1(md.mean)}（單邊 95% 下界 ${f1(md.mean - z * md.se)}）`, '下界 ≤ 0（沒有顯著較高）', '不是嚴格優勢：錢與工作表現較高，親子軸不會比婉拒好');
      }
    }
  }
  // 4. 放任型 3C（DESIGN §4.39 依賴度的後果）：同一個基底機器人，只在螢幕卡上放任 vs 只加時間管控；三軸明顯較差；上大學且學習軸好的比例 ≤ 10%，其中親子軸「差」的比例
  {
    const R = T.permissive, B = data && data.model.bands.axes;
    const ctrl = C3_PERM_BASES.flatMap((b) => gp[`c3Ctrl_${b}`]), prm = C3_PERM_BASES.flatMap((b) => gp[`c3Perm_${b}`]);
    ['親子', '人際', '學習'].forEach((nm, i) => {
      const s = meanSe(pair(prm, ctrl, (r) => r.ax[i])), up = s.mean + z * s.se;
      add(up < 0 && s.mean <= -R.minDiff[nm], `放任型 3C − 對照：${nm}軸（${prm.length} 對，${C3_PERM_BASES.length} 種基底）`, `${f1(s.mean)}（單邊 95% 上界 ${f1(up)}；標準化大小 ${(s.mean / s.sd).toFixed(2)}）`, `≤ −${R.minDiff[nm]} 且上界 < 0`, i === 0 ? R.note : '');
    });
    if (B) {
      const top = prm.filter((r) => r.dep.dest === '大學' && r.ax[2] >= B.學習.good), share = top.length / prm.length;
      add(share <= R.topMax, `放任型 3C：上大學且學習軸好的比例（${prm.length} 局）`, `${(share * 100).toFixed(1)}%（${top.length} 局；對照 ${(ctrl.filter((r) => r.dep.dest === '大學' && r.ax[2] >= B.學習.good).length / ctrl.length * 100).toFixed(1)}%）`, `≤ ${R.topMax * 100}%`, R.noteTop);
      // 對照組會上大學且學習軸好的那些局（用對照組挑，不用放任組的結果挑，才沒有選擇偏誤）：同一個種子在放任組的親子軸
      const idx = ctrl.map((r, i) => i).filter((i) => ctrl[i].dep.dest === '大學' && ctrl[i].ax[2] >= B.學習.good);
      const s = meanSe(idx.map((i) => prm[i].ax[0] - ctrl[i].ax[0])), up = s.mean + z * s.se;
      const still = idx.filter((i) => prm[i].dep.dest === '大學' && prm[i].ax[2] >= B.學習.good).length;
      add(idx.length >= R.minTop && up < 0 && s.mean <= -R.topAx0MinDiff, `放任型 3C − 對照：對照組上大學且學習軸好的局（${idx.length} 局）的親子軸`, `${f1(s.mean)}（單邊 95% 上界 ${f1(up)}；其中 ${still} 局在放任組仍上大學且學習軸好）`, `≤ −${R.topAx0MinDiff} 且上界 < 0（至少 ${R.minTop} 局）`, R.noteFar);
      const hi = top.filter((r) => r.dep.hi50).length;
      add(true, '放任型 3C 且上大學、學習軸好的局：到終局依賴度仍 ≥ 50 的局數（結局會寫『成績很好。家裡很安靜…』，見 tests/c3.test.mjs）', `${hi}／${top.length} 局`, '僅報告', '');
    }
  }
  return { rows, g, gp };
}

export default async function check(ctx) {
  const T = ctx.TARGETS.c3;
  if (!T) return [];
  return (await measure({ runBots: ctx.runBots, T, N: ctx.N, s0: ctx.s0, data: ctx.data })).rows;
}
