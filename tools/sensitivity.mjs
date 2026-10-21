// 敏感度分析（DESIGN §3.6 第 5 點）：把對照表裡每個標籤的權重各調高、調低兩成，重跑 warmFirm 與 doseGreedy，
// 看「溫暖＋堅定」是否仍然比「只看劑量表」的親子軸高 10 以上。越敏感的權重，越需要研究依據與老師複核。
// 用法：node tools/sensitivity.mjs [每種策略的局數=30] [起始種子=1]
import { fileURLToPath } from 'node:url';
import { isMainThread } from 'node:worker_threads';
import { runBots, runVariants } from './simulate.mjs';
import { loadRaw } from './data-node.mjs';
import { avg } from './stats.mjs';

export const SENSITIVITY_FLOOR = 10;
export async function sensitivity(N = 30, s0 = 1, factors = [0.8, 1.2]) {
  const raw = loadRaw();
  const tags = Object.entries(raw.tags.tags).filter(([, d]) => Object.keys(d.d || {}).length).map(([n]) => n);
  const gap = (g) => avg(g.warmFirm.map((x) => x.ax[0])) - avg(g.doseGreedy.map((x) => x.ax[0]));
  const base = gap(await runBots(N, s0, { bots: ['warmFirm', 'doseGreedy'] }));
  const variants = [], meta = [];
  for (const t of tags) for (const f of factors) { variants.push({ [t]: f }); meta.push({ tag: t, f }); }
  const res = await runVariants(N, s0, variants, ['warmFirm', 'doseGreedy']);
  const rows = meta.map((m, i) => ({ ...m, gap: gap(res[i]) }));
  return { base, rows, min: Math.min(...rows.map((r) => r.gap)) };
}

if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const N = parseInt(process.argv[2] || '30', 10), s0 = parseInt(process.argv[3] || '1', 10);
  const t0 = Date.now();
  const { base, rows, min } = await sensitivity(N, s0);
  console.log(`基準：warmFirm − doseGreedy 親子 = ${base.toFixed(1)}（每種策略 ${N} 局）\n`);
  const bad = rows.filter((r) => r.gap < SENSITIVITY_FLOOR);
  const worst = [...rows].sort((a, b) => a.gap - b.gap).slice(0, 8);
  console.log('最敏感的八個權重調整（差距最小的）：');
  for (const r of worst) console.log(`  ${r.tag.padEnd(12, '　')} ×${r.f}　差距 ${r.gap.toFixed(1)}`);
  console.log(`\n所有 ${rows.length} 種調整中的最小差距：${min.toFixed(1)}　${bad.length ? `✗ ${bad.length} 種低於 ${SENSITIVITY_FLOOR}` : `✓ 都 ≥ ${SENSITIVITY_FLOOR}`}　耗時 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  process.exit(bad.length ? 1 : 0);
}
