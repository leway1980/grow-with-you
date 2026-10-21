// 決定鏈的設計檢驗（M3 B5；計畫 §2.5、§8）。由 tools/check-design.mjs 透過 tools/plugins.mjs 載入。
// 用完整 72 回合的預設局讓多種機器人各玩 games 局，量：每局挑到幾條鏈、warmFirm 有沒有往好的方向轉的鏈、
// lateStarter 在 12 歲以後有沒有往好的方向轉的鏈、各鏈內容是否齊全（選擇數、處境、曲線、研究小卡）、主題分布、後來的痕跡（只報告）。目標在 tools/targets/chains.json。
// 單獨執行：node tools/checks/chains.mjs [局數] [起始種子]
import { fileURLToPath } from 'node:url';
import { rateVerdict } from '../mech.mjs';

const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : NaN);
const pct = (x) => (Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : '—');
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

export async function measure({ runBots, T, N, s0 }) {
  const n = T.games ?? N;
  const g = await runBots(n, s0 + 900000, { bots: T.bots, chains: true });
  const all = T.bots.flatMap((b) => g[b]);
  const themes = {};
  for (const r of all) for (const t of r.chains.themes) themes[t] = (themes[t] || 0) + 1;
  return {
    games: all.length, n,
    atLeast3: share(all, (r) => r.chains.n >= 3),
    byBot: Object.fromEntries(T.bots.map((b) => [b, { n3: share(g[b], (r) => r.chains.n >= 3), pos: share(g[b], (r) => r.chains.pos >= 1), late: share(g[b], (r) => r.chains.latePos), avg: sum(g[b].map((r) => r.chains.n)) / g[b].length }])),
    warmFirmPositive: share(g.warmFirm, (r) => r.chains.pos >= 1),
    lateStarterPositive: share(g.lateStarter, (r) => r.chains.latePos),
    lateStarterCand: share(g.lateStarter, (r) => r.chains.latePosCand),
    anyPositive: share(all, (r) => r.chains.pos >= 1),
    integrity: sum(all.map((r) => r.chains.shortChoices + r.chains.noSituation + (r.chains.n - r.chains.curved) + (r.chains.n - r.chains.researched))),
    traced: share(all.filter((r) => r.chains.n), (r) => r.chains.traced > 0),
    withAuto: share(all, (r) => r.chains.auto > 0),
    classroom: share(all, (r) => r.chains.classLines >= 2),
    themes,
  };
}

export function rows(v, T) {
  const ok = (x, R) => Number.isFinite(x) && (R.min == null || x >= R.min - 1e-9) && (R.max == null || x <= R.max + 1e-9);
  const row = (R, name, x, s, range, note = '') => ({ ok: ok(x, R), pending: !!T.pending, group: '決定鏈', name, value: s, range, note: `${note}${R.note ? '　[' + R.note + ']' : ''}` });
  // 比例用 Wilson 95% 區間（tools/mech.mjs rateVerdict，和機制發生率同一條規則）
  const rrow = (R, name, x, n, range, note = '') => { const vd = rateVerdict(x, n, R); return { ok: vd.ok, pending: !!T.pending || vd.pending, group: '決定鏈', name, value: `${pct(x)}，95% 區間 ${pct(vd.lo)}～${pct(vd.hi)}`, range, note: `${vd.small ? `只有 ${n} 局（<200）。` : ''}${note}${R.note ? '　[' + R.note + ']' : ''}` }; };
  const by = Object.entries(v.byBot).map(([b, o]) => `${b} ≥3條 ${pct(o.n3)}／有好鏈 ${pct(o.pos)}／12歲後好鏈 ${pct(o.late)}／平均 ${o.avg.toFixed(1)} 條`).join('；');
  return [
    rrow(T.atLeast3, `至少挑到 3 條鏈的局（${v.games} 局，${T.bots.length} 個機器人）`, v.atLeast3, v.games, `≥ ${T.atLeast3.min * 100}%`, by),
    rrow(T.warmFirmPositive, `warmFirm 至少有 1 條往好的方向轉的鏈（${v.n} 局）`, v.warmFirmPositive, v.n, `≥ ${T.warmFirmPositive.min * 100}%`),
    rrow(T.lateStarterPositive, `lateStarter 在 12 歲以後有至少 1 條往好的方向轉的鏈（${v.n} 局）`, v.lateStarterPositive, v.n, `≥ ${T.lateStarterPositive.min * 100}%`, `候選（不限挑中）${pct(v.lateStarterCand)}`),
    row(T.integrity, '挑到的鏈缺內容的次數（選擇數不在 3–5、沒有處境、沒有曲線、沒有研究小卡）', v.integrity, String(v.integrity), '＝ 0'),
    row(T.classroom, '「這些年，孩子的班上」至少有 2 行事實的局', v.classroom, pct(v.classroom), '＝ 100%'),
    { ok: true, pending: false, group: '決定鏈', name: '報告：主題分布（被挑到的次數）、有後來的痕跡的局、含習慣（自動帶入）的局、至少 1 條好鏈的局', value: Object.entries(v.themes).sort((a, b) => b[1] - a[1]).map(([t, k]) => `${t} ${k}`).join('、') + `；痕跡 ${pct(v.traced)}；習慣 ${pct(v.withAuto)}；好鏈 ${pct(v.anyPositive)}`, range: '（只報告）', note: '' },
  ];
}

export default async function check(ctx) {
  const T = ctx.TARGETS.chains;
  if (!T) return [];
  return rows(await measure({ runBots: ctx.runBots, T, N: ctx.N, s0: ctx.s0 }), T);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const nums = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
  const { runBots } = await import('../simulate.mjs');
  const { loadTargets } = await import('../plugins.mjs');
  const T = { ...loadTargets().chains };
  if (nums[0]) T.games = nums[0];
  const v = await measure({ runBots, T, N: T.games, s0: nums[1] || 1 });
  for (const r of rows(v, T)) console.log(`${r.ok ? '✓' : r.pending ? '△' : '✗'} ${r.name}：${r.value}（${r.range}）${r.note}`);
}
