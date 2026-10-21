// 習慣的設計檢驗（M3 B2；計畫 §2.2、§8 第 5、6 項）。由 tools/check-design.mjs 透過 tools/plugins.mjs 載入。
// 完整 72 回合（E1 起是預設）讓多種機器人各玩 games 局，量：回家第一句的偵測結果、想改變的機器人翻轉習慣的比例（國中、高中）、
// 『不太來找你』的離開比例（國中、高中）、自動套用占隱藏數值變動的比例。目標在 tools/targets/habits.json（pending:true＝只報告、不擋 CI；E1 起群組是 false，個別目標可自己標 pending:true）。
// 單獨執行：node tools/checks/habits.mjs [局數] [起始種子]  → 印出所有數值（含各機器人的偵測分布）
import { fileURLToPath } from 'node:url';

const share = (xs, f) => (xs.length ? xs.filter(f).length / xs.length : NaN);
const pctS = (x) => (Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : '—');

/** 一個機器人在第 turn 回合開始時是否在『不太來找你』裡，以及離開的月齡 */
function episodeAt(r, data, turn) {
  const m = data.timeline[Math.max(0, turn - 1)].ageMonths;
  return (r.episodes || []).find((e) => e.enter <= m && (e.exit == null || e.exit > m)) || null;
}

export async function measure({ runBots, data, T, N, s0 }) {
  const jh0 = data.timeline.findIndex((t) => t.stage === '國中'), sh0 = data.timeline.findIndex((t) => t.stage === '高中');
  const warm = new Set(T.warmPatterns);
  const g = await runBots(T.games ?? N, s0 + 500000, { bots: T.bots, habits: true });
  const fam = (r, which, f) => (r.hab[which] || {})[f];
  const per = {};
  for (const b of T.bots) {
    const rs = g[b];
    const dist = {};
    for (const r of rs) { const p = fam(r, 'det', '回家第一句').pattern; dist[p] = (dist[p] || 0) + 1; }
    per[b] = {
      n: rs.length,
      first: share(rs, (r) => fam(r, 'det', '回家第一句').pattern !== '混合'),
      table: share(rs, (r) => fam(r, 'det', '餐桌').pattern !== '混合'),
      phone: share(rs, (r) => fam(r, 'det', '手機規則').pattern !== '混合'),
      dist,
      auto: rs.reduce((a, r) => a + r.hab.autoAbs, 0) / Math.max(1e-9, rs.reduce((a, r) => a + r.hab.absAll, 0)),
      nAuto: rs.reduce((a, r) => a + r.hab.nAuto, 0) / rs.length,
      jhChange: rs.reduce((a, r) => a + r.hab.jhChange, 0) / rs.length,
      shChange: rs.reduce((a, r) => a + r.hab.shChange, 0) / rs.length,
    };
  }
  // 想改變的機器人翻轉習慣
  const late = g.lateStarter, vl = g.veryLateStarter;
  const jhPool = late.filter((r) => !warm.has(fam(r, 'det', '回家第一句').pattern));
  const flipJH = share(jhPool, (r) => warm.has(fam(r, 'atSH', '回家第一句').pattern));
  const shPool = vl.filter((r) => !warm.has(fam(r, 'atSH', '回家第一句').pattern));
  const flipSH = share(shPool, (r) => warm.has(fam(r, 'end', '回家第一句').pattern));
  // 『不太來找你』的離開
  const endJH = data.timeline[sh0].ageMonths;
  const inJH = late.map((r) => episodeAt(r, data, jh0)).filter(Boolean);
  const exitJH = inJH.length ? inJH.filter((e) => e.exit != null && e.exit < endJH).length / inJH.length : NaN;
  const inSH = vl.map((r) => episodeAt(r, data, sh0)).filter(Boolean);
  const exitSH = inSH.length ? inSH.filter((e) => e.exit != null).length / inSH.length : NaN;
  const detectMin = Math.min(...T.bots.map((b) => per[b].first)), detectWorst = T.bots.find((b) => per[b].first === detectMin);
  const NOISY = new Set(['random', 'tiredLazy', 'occasionalResearch']);
  const steady = T.bots.filter((b) => !NOISY.has(b)), steadyMin = Math.min(...steady.map((b) => per[b].first)), steadyWorst = steady.find((b) => per[b].first === steadyMin);
  const autoMax = Math.max(...T.bots.map((b) => per[b].auto)), autoWorst = T.bots.find((b) => per[b].auto === autoMax);
  const v = { flipJH, flipSH, nJH: jhPool.length, nSH: shPool.length, detectMin, detectWorst, exitJH, exitSH, nExitJH: inJH.length, nExitSH: inSH.length, autoMax, autoWorst, per };
  const ok = (x, R) => Number.isFinite(x) && (R.min == null || x >= R.min) && (R.max == null || x <= R.max);
  const row = (R, name, value, range, note = '') => ({ ok: ok(value.x, R), pending: R.pending ?? !!T.pending, group: '習慣', name, value: value.s, range, note: `${R.pending ?? T.pending ? 'pending：只報告、不擋 CI。' : ''}${note}${R.note ? '　[' + R.note + ']' : ''}` });
  const rows = [
    row(T.flipJH, `國中翻轉習慣：lateStarter 在（非溫暖模式的 ${jhPool.length} 局）中翻成溫暖模式的比例`, { x: flipJH, s: pctS(flipJH) }, `≥ ${T.flipJH.min * 100}%`),
    row(T.flipSH, `高中翻轉習慣：veryLateStarter 在（非溫暖模式的 ${shPool.length} 局）中翻成溫暖模式的比例`, { x: flipSH, s: pctS(flipSH) }, `≥ ${T.flipSH.min * 100}%`),
    row(T.detectFirstWords, `回家第一句偵測為非混合的比例（每個機器人；最低：${detectWorst}，各 ${T.games} 局）`, { x: detectMin, s: pctS(detectMin) }, `≥ ${T.detectFirstWords.min * 100}%`, T.bots.map((b) => `${b} ${pctS(per[b].first)}`).join('、')),
    row({ ...T.detectFirstWords, note: '同一個目標，只算會一致地用同一種做法的策略機器人（不含 random、tiredLazy、occasionalResearch 這三個本來就會亂選的機器人；它們的選擇分散，混合是正確的結果）：給規劃者決定目標該看哪一組' }, `回家第一句偵測為非混合的比例（只算一致的策略機器人；最低：${steadyWorst}）`, { x: steadyMin, s: pctS(steadyMin) }, `≥ ${T.detectFirstWords.min * 100}%`),
    row(T.approachExitJH, `lateStarter 進國中時在『不太來找你』（${inJH.length} 局），國中結束前離開的比例`, { x: exitJH, s: pctS(exitJH) }, `≥ ${T.approachExitJH.min * 100}%`),
    row(T.approachExitSH, `veryLateStarter 進高中時在『不太來找你』（${inSH.length} 局），遊戲結束前離開的比例`, { x: exitSH, s: pctS(exitSH) }, `≥ ${T.approachExitSH.min * 100}%`),
    row(T.autoShareMax, `第 50–71 回合自動套用的 |Δ| 占全部的比例（各機器人最高：${autoWorst}）`, { x: autoMax, s: pctS(autoMax) }, `≤ ${T.autoShareMax.max * 100}%`, T.bots.map((b) => `${b} ${pctS(per[b].auto)}`).join('、')),
    { ok: true, pending: false, group: '習慣', name: '報告：餐桌／手機規則偵測為非混合的比例（各機器人）', value: T.bots.map((b) => `${b} ${pctS(per[b].table)}／${pctS(per[b].phone)}`).join('、'), range: '（只報告；手機規則 auto:false，先量再決定）', note: '' },
    { ok: true, pending: false, group: '習慣', name: '報告：每局『改變習慣』卡的次數（國中／高中，各機器人）', value: T.bots.map((b) => `${b} ${per[b].jhChange.toFixed(1)}／${per[b].shChange.toFixed(1)}`).join('、'), range: '（只報告）', note: '' },
  ];
  return { v, rows };
}

export default async function check(ctx) {
  const T = ctx.TARGETS.habits;
  if (!T) return [];
  return (await measure({ runBots: ctx.runBots, data: ctx.data, T, N: ctx.N, s0: ctx.s0 })).rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const nums = process.argv.slice(2).filter((a) => !a.startsWith('--')).map(Number);
  const { runBots } = await import('../simulate.mjs');
  const { loadRaw, loadData } = await import('../data-node.mjs');
  const { loadTargets } = await import('../plugins.mjs');
  const T = { ...loadTargets().habits }, data = loadData(loadRaw());
  if (nums[0]) T.games = nums[0];
  const res = await measure({ runBots, data, T, N: T.games, s0: nums[1] || 1 });
  for (const r of res.rows) console.log(`${r.ok ? '✓' : r.pending ? '△' : '✗'} ${r.name}：${r.value}（${r.range}）${r.note.replace('pending：只報告、不擋 CI。', '')}`);
  console.log('\n回家第一句偵測分布（第一個國中回合）：');
  for (const b of T.bots) console.log(`  ${b.padEnd(18)} ${Object.entries(res.v.per[b].dist).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${(n / res.v.per[b].n * 100).toFixed(0)}%`).join('　')}　（每局自動套用 ${res.v.per[b].nAuto.toFixed(1)} 次）`);
}
