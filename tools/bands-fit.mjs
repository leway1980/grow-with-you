// 用法：node tools/bands-fit.mjs [每種策略局數=400] [起始種子=1] [--write]
// 三條結果軸的好／差門檻（data/model.json bands.axes；E1 審查問題 10）：
// 同一批 72 回合的局，主要 7 種策略合併，把「結局混合後的軸」的門檻設成：
//   混合軸 ≥ 好門檻 的比例 ＝ 只看近期的軸 ≥ bands.good（60）的比例；混合軸 < 差門檻 的比例 ＝ 只看近期的軸 < bands.bad（45）的比例。
// 這只抵銷「混合讓分布變窄」，不抵銷長度（長度造成的差是真實的機制）。結果印出來；--write 才寫進 model.json（要在內容與公式修完之後量一次，凍結，
// 並且和改目標分開 commit；改了要重跑 lint 的結局句子邊界檢查）。
import { fileURLToPath } from 'node:url';
import { runBots } from './simulate.mjs';
import { readModel, writeModel } from './model-io.mjs';

export const MAIN_BOTS = ['random', 'permissive', 'controlling', 'warmFirm', 'doseGreedy', 'antiDose', 'warmFirmRest'];
const AXN = ['親子', '人際', '學習'];
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * s.length)))]; };

/** 回傳 { 親子: {good, bad}, … }；recs 是帶 ax（混合）與 axRecent（只看近期）的紀錄 */
export function fitBands(recs, good = 60, bad = 45) {
  const out = {};
  AXN.forEach((name, i) => {
    const B = recs.map((r) => r.ax[i]), R = recs.map((r) => r.axRecent[i]);
    const hi = R.filter((x) => x >= good).length / R.length, lo = R.filter((x) => x < bad).length / R.length;
    out[name] = { good: +q(B, 1 - hi).toFixed(1), bad: +q(B, lo).toFixed(1) };
  });
  return out;
}
export async function runFit(N = 400, s0 = 1, bots = MAIN_BOTS) {
  const g = await runBots(N, s0, { bots, axRecent: true });
  const recs = Object.values(g).flat();
  return { bands: fitBands(recs), games: recs.length };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), nums = args.filter((a) => !a.startsWith('--')).map(Number);
  const N = nums[0] || 400, s0 = nums[1] || 1;
  const { bands, games } = await runFit(N, s0);
  console.log(`主要 ${MAIN_BOTS.length} 種策略 × 種子 ${s0}–${s0 + N - 1}（${games} 局）：`, JSON.stringify(bands));
  if (args.includes('--write')) {
    const M = readModel();
    M.bands.axes = bands;
    writeModel(M);
    console.log('已寫進 data/model.json bands.axes（記得補 axesSource 與 changelog）');
  }
}
