// 手機與平板的依賴度（DESIGN §4.39）與假日邀約（§4.40）的設計檢驗。由 tools/check-design.mjs 透過 tools/plugins.mjs 載入。
// 用 C3_BOTS（tools/bots.mjs）在同一批種子上各玩 games 局，比較成對差；判定是『平均差的單邊 95% 界限』（z＝1.645）加上幅度 ≥ minDiff。
// 目標在 tools/targets/3c.json。
export const meanSe = (xs) => {
  const n = xs.length, m = n ? xs.reduce((a, b) => a + b, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, se: sd / Math.sqrt(n) };
};
const f1 = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : 'NaN');
const pair = (A, B, f) => A.map((r, i) => f(r) - f(B[i]));

/** 量測：回傳 { rows } */
export async function measure({ runBots, T, N, s0 }) {
  const games = T.games ?? N, z = T.z ?? 1.645;
  const bots = ['c3Base', 'c3Agreed', 'c3Task', 'c3Confiscate', 'c3Companion', 'c3Trip', 'wkAccept', 'wkDecline'];
  const g = await runBots(games, s0 + 500000, { bots, c3: true });
  const rows = [];
  const add = (ok, name, value, range, note = '') => rows.push({ ok, group: '3C 與假日邀約', name, value, range, note });
  const end = (r) => r.dep.end;

  // 1. 持續的陪伴 vs 只強制收回
  {
    const R = T.companionVsConfiscate, s = meanSe(pair(g.c3Companion, g.c3Confiscate, end)), up = s.mean + z * s.se;
    add(up < 0 && s.mean <= -R.minDiff, `持續陪伴 − 只強制收回：終點依賴度（各 ${games} 局）`, `${f1(s.mean)}（單邊 95% 上界 ${f1(up)}）`, `≤ −${R.minDiff} 且上界 < 0`, R.note);
  }
  // 2. 任務型借用在給螢幕的做法裡最低
  {
    const R = T.taskLowest;
    for (const [other, label] of [['c3Agreed', '約定且在旁'], ['c3Base', '給了就不管']]) {
      const s = meanSe(pair(g.c3Task, g[other], end)), up = s.mean + z * s.se;
      add(up < 0 && s.mean <= -R.minDiff, `任務型借用 − ${label}：終點依賴度（各 ${games} 局）`, `${f1(s.mean)}（單邊 95% 上界 ${f1(up)}）`, `≤ −${R.minDiff} 且上界 < 0`, other === 'c3Agreed' ? R.note : '');
    }
  }
  // 3. 一次大活動：先降後彈回
  {
    const R = T.tripRebound, trips = g.c3Trip.filter((r) => r.dep.trip && r.dep.trip.pre - r.dep.base >= 5).map((r) => r.dep);
    if (trips.length < R.minTrips) add(false, '一次大活動：樣本', `只有 ${trips.length} 局有第一次大活動`, `≥ ${R.minTrips} 局`, R.note);
    else {
      const ex = meanSe(trips.map((d) => d.trip.d12 - d.base - R.min * (d.trip.pre - d.base))), lo = ex.mean - z * ex.se;
      const ratio = trips.reduce((a, d) => a + (d.trip.d12 - d.base), 0) / trips.reduce((a, d) => a + (d.trip.pre - d.base), 0);
      add(lo > 0, `一次大活動 ${R.windowMonths} 個月後的依賴度 ÷ 活動前超出起點的部分（${trips.length} 局）`, `${ratio.toFixed(2)}（(d12 − ${R.min}×活動前超出) 平均 ${f1(ex.mean)}，單邊 95% 下界 ${f1(lo)}）`, `≥ ${R.min}，下界 > 0`, R.note);
      const dip = meanSe(trips.map((d) => d.trip.pre - d.trip.post)), dl = dip.mean - z * dip.se;
      add(dl > 0 && dip.mean >= R.dipMin, `一次大活動當下的下降（活動前 − 活動後，${trips.length} 局）`, `${f1(dip.mean)}（單邊 95% 下界 ${f1(dl)}）`, `≥ ${R.dipMin} 且下界 > 0`);
    }
  }
  // 4. 假日邀約：一律接 vs 一律婉拒（只看開局就收得到邀約的家庭）
  {
    const R = T.weekend, idx = g.wkAccept.map((r, i) => i).filter((i) => g.wkAccept[i].dep.elig && g.wkDecline[i].dep.elig);
    const A = idx.map((i) => g.wkAccept[i]), D = idx.map((i) => g.wkDecline[i]);
    if (A.length < R.minElig) add(false, '假日邀約：樣本', `只有 ${A.length} 對符合資格`, `≥ ${R.minElig} 對`, R.note);
    else for (const [key, label, f, sign] of [['money', '錢（整局平均）', (r) => r.dep.money, 1], ['work', '工作表現（整局平均）', (r) => r.dep.work, 1], ['ax0', '親子軸', (r) => r.ax[0], -1]]) {
      const s = meanSe(pair(A, D, f)), bound = sign > 0 ? s.mean - z * s.se : s.mean + z * s.se;
      add(sign > 0 ? bound > 0 && s.mean >= R.minDiff[key] : bound < 0 && s.mean <= -R.minDiff[key], `一律接 − 一律婉拒：${label}（${A.length} 對）`, `${f1(s.mean)}（單邊 95% ${sign > 0 ? '下' : '上'}界 ${f1(bound)}）`, `${sign > 0 ? '≥ +' : '≤ −'}${R.minDiff[key]} 且界限${sign > 0 ? ' > ' : ' < '}0`, key === 'money' ? R.note : '');
    }
  }
  return { rows, g };
}

export default async function check(ctx) {
  const T = ctx.TARGETS.c3;
  if (!T) return [];
  return (await measure({ runBots: ctx.runBots, T, N: ctx.N, s0: ctx.s0 })).rows;
}
