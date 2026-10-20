// 用法：node tools/approach-censor.mjs <版本資料夾=.> [局數=3000] [起始種子=1]
// 在某個版本（例如 git worktree 的 c0a9214＝A0）玩『真人混合』N 局，印出『不太來找你』的右設限離開比例
// （進入時離可玩終點 ≥ 24 個月的進入者，在 24 個月內離開的比例）與舊指標（整局結束時曾經離開的比例）。
// 用來算 A0 的基準，也用來核對 check-design 裡同一列的數字。
import { resolve } from 'node:path';
import { approachTracker, playableEndMonths, censorStats } from './approach-log.mjs';

const root = resolve(process.argv[2] || '.'), N = parseInt(process.argv[3] || '3000', 10), s0 = parseInt(process.argv[4] || '1', 10);
const { loadData } = await import(root + '/tools/data-node.mjs');
const { newState } = await import(root + '/js/engine/state.js');
const { playTurn } = await import(root + '/js/engine/turn.js');
const { botPolicy, SALT, HUMAN_MIX } = await import(root + '/tools/bots.mjs');
const data = loadData(), end = playableEndMonths(data);
let games = 0, everGames = 0, exitGames = 0, entries = 0, eligible = 0, exited = 0;
const byStage = {};
for (let i = 0; i < N; i++) {
  const seed = s0 + i;
  const st = newState(seed, data, { role: seed % 2 ? '媽媽' : '爸爸', startMode: 'birth' });
  const pol = botPolicy(HUMAN_MIX[i % HUMAN_MIX.length], SALT), tr = approachTracker(data);
  let g = 0;
  while (!st.ended && g++ < 200) { const t = st.turn; playTurn(st, data, pol); tr.observe(st, t); }
  const c = censorStats(tr.episodes, end);
  games++; entries += c.entries; eligible += c.eligible; exited += c.exited;
  if (tr.episodes.length) { everGames++; if (tr.episodes.some((e) => e.exit != null)) exitGames++; }
  for (const e of tr.episodes) { const s = data.timeline.find((x) => x.ageMonths >= e.enter).stage; byStage[s] = (byStage[s] || 0) + 1; }
}
console.log(JSON.stringify({ root, games, playableEndMonths: end, everEntered: everGames / games, oldMetric_exitAnyShareOfEntered: exitGames / everGames, entries, eligible, exitedWithin24: exited, censoredExitShare: exited / eligible, entriesByStage: byStage }, null, 1));
