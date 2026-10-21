// 父母自己的嗜好（DESIGN §4.41）與一直換導師（§4.42）的設計檢驗。由 tools/check-design.mjs 透過 tools/plugins.mjs 載入。目標在 tools/targets/hobby_teacher.json。
// 嗜好：hbKeep／hbReduce／hbAbandon（tools/bots.mjs HB_BOTS）各組只在『嗜好邀約』池的卡上不同，其他卡照同一個 fallback；只看開局就有固定夥伴的局，同一個種子成對比較。
// 導師：(a) 補上來的導師依招考次數的分布（投入度、中途離職率、很用心的比例）；(b) 同一個種子、同一個機器人，只差換導師的機率倍率（tcX＝0／3），學習與人際的成對比較。
import { meanSe } from './c3.mjs';

const f2 = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) : 'NaN');
const pair = (A, B, f) => A.map((r, i) => f(r) - f(B[i]));

export default async function check(ctx) {
  const T = ctx.TARGETS.hobbyTeacher;
  if (!T) return [];
  const rows = [], z = T.z ?? 1.645, g = T.games ?? 200;
  const add = (ok, name, value, range, note = '') => rows.push({ ok, group: '嗜好與換導師', name, value, range, note });
  // ── 嗜好 ──
  {
    const H = T.hobby, r = await ctx.runBots(g, ctx.s0 + 600000, { bots: ['hbKeep', 'hbReduce', 'hbAbandon'], hb: true });
    const idx = r.hbKeep.map((x, i) => i).filter((i) => r.hbKeep[i].hb.elig && r.hbReduce[i].hb.elig && r.hbAbandon[i].hb.elig);
    const K = idx.map((i) => r.hbKeep[i]), R = idx.map((i) => r.hbReduce[i]), A = idx.map((i) => r.hbAbandon[i]);
    if (idx.length < H.minElig) add(false, '嗜好：樣本', `只有 ${idx.length} 對有固定夥伴`, `≥ ${H.minElig}`, H.note);
    else {
      const w = meanSe(pair(A, R, (x) => x.w[1])), wu = w.mean + z * w.se;
      add(wu < 0 && w.mean <= -H.abandonWellbeing.minDiff, `乾脆退出 − 減量：父母幸福（${idx.length} 對）`, `${f2(w.mean)}（單邊 95% 上界 ${f2(wu)}）`, `≤ −${H.abandonWellbeing.minDiff} 且上界 < 0`, H.abandonWellbeing.note);
      const c = meanSe(pair(K, R, (x) => x.ax[0])), cu = c.mean + z * c.se;
      add(cu < 0 && c.mean <= -H.keepCloseness.minDiff, `一律照去 − 減量：親子軸（${idx.length} 對）`, `${f2(c.mean)}（單邊 95% 上界 ${f2(cu)}）`, `≤ −${H.keepCloseness.minDiff} 且上界 < 0`, H.keepCloseness.note);
      const inv = meanSe(R.map((x) => x.hb.invites));
      add(inv.mean >= H.minInvites, `減量組每局收到的嗜好邀約（${R.length} 局）`, inv.mean.toFixed(2), `≥ ${H.minInvites}`, '');
    }
  }
  // ── 導師：招考次數 ──
  {
    const Hh = T.hire, r = await ctx.runBots(Hh.games ?? g, ctx.s0 + 610000, { bots: Hh.bots, tc: true }), hires = Object.values(r).flat().flatMap((x) => x.tc.hires.filter((h) => h.round > 0));
    const early = hires.filter((h) => h.round === 1), late = hires.filter((h) => h.round >= Hh.lateFrom);
    const quitRate = (hs) => hs.filter((h) => h.ended === 'quit').length / Math.max(1, hs.reduce((a, h) => a + h.months, 0)) * 100;
    if (early.length < Hh.minHires || late.length < Hh.minHires) add(false, '換導師：樣本', `第一輪 ${early.length}、第 ${Hh.lateFrom} 輪以後 ${late.length} 位補上來的導師`, `各 ≥ ${Hh.minHires}`, Hh.note);
    else {
      const me = meanSe(early.map((h) => h.v0)), ml = meanSe(late.map((h) => h.v0)), d = ml.mean - me.mean, se = Math.sqrt(me.se ** 2 + ml.se ** 2);
      add(d + z * se < 0 && d <= -Hh.v0.minDiff, `補上來的導師：第 ${Hh.lateFrom} 輪以後 − 第一輪的平均投入度（${late.length}／${early.length} 位）`, `${f2(d)}（單邊 95% 上界 ${f2(d + z * se)}）`, `≤ −${Hh.v0.minDiff} 且上界 < 0`, Hh.v0.note);
      const sdE = me.sd, sdL = ml.sd;
      add(sdL > sdE, '補上來的導師：投入度的標準差（越後面範圍越寬）', `${sdL.toFixed(1)} vs ${sdE.toFixed(1)}`, '第 4 輪以後 > 第一輪', '');
      const qe = quitRate(early), ql = quitRate(late);
      add(ql >= qe * Hh.quit.ratio, '補上來的導師：中途離職率（每 100 個導師月）', `${ql.toFixed(2)} vs ${qe.toFixed(2)}`, `後面 ≥ 第一輪 × ${Hh.quit.ratio}`, Hh.quit.note);
      const ds = late.filter((h) => h.devoted).length / late.length;
      add(ds >= Hh.devotedMin, `第 ${Hh.lateFrom} 輪以後補上來的導師：很用心的比例（${late.length} 位）`, `${(ds * 100).toFixed(0)}%`, `≥ ${Hh.devotedMin * 100}%`, Hh.devoted_note);
    }
  }
  // ── 導師：換得越多，孩子越吃虧（同種子成對）──
  {
    const U = T.instability, r0 = await ctx.runBots(U.games ?? g, ctx.s0 + 620000, { bots: [U.bot], tcX: 0, tc: true }), r3 = await ctx.runBots(U.games ?? g, ctx.s0 + 620000, { bots: [U.bot], tcX: U.x, tc: true });
    const A = r0[U.bot], B = r3[U.bot];
    const ch = meanSe(B.map((x) => x.tc.changes));
    ['親子', '人際', '學習'].forEach((nm, i) => {
      if (nm === '親子') return;
      const s = meanSe(pair(A, B, (x) => x.ax[i])), lo = s.mean - z * s.se;
      add(lo > 0 && s.mean >= U.minDiff[nm], `不換導師 − 常換導師（hazard ×${U.x}，平均換 ${ch.mean.toFixed(2)} 次）：${nm}軸（${A.length} 對）`, `${f2(s.mean)}（單邊 95% 下界 ${f2(lo)}）`, `≥ +${U.minDiff[nm]} 且下界 > 0`, U.note);
    });
  }
  return rows;
}
