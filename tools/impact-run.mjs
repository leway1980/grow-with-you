// tools/impact.mjs 的執行端：在「某一個版本的資料夾」裡玩一批局，輸出 JSON。
// impact.mjs 會把這個檔案連同 bots.mjs、mech.mjs、stats.mjs 複製進舊版本的 tools/ 再執行，所以只依賴引擎的舊介面
// （newState／playToEnd／outcomeAxes／wellbeing／routePosition／comboOf／buildEnding）與該版本自己的 data-node.mjs、metrics.mjs。
// 用法：node tools/impact-run.mjs <N> <起始種子> <黃金範例 families.json> <輸出 json>
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadData } from './data-node.mjs';
import { newState } from '../js/engine/state.js';
import { playTurn } from '../js/engine/turn.js';
import { approachTracker } from './approach-log.mjs';
import { outcomeAxes, wellbeing, routePosition, comboOf, buildEnding } from '../js/engine/ending.js';
import { botPolicy, SALT, HUMAN_MIX, BOTS, ALL_BOTS } from './bots.mjs';
import { mechRecord, goldenSnapshot, signature } from './mech.mjs';

function play(data, bot, seed, def, tracker = null) {
  const st = newState(seed, data, { role: def?.role || (seed % 2 ? '媽媽' : '爸爸'), startMode: def?.startMode || 'birth' });
  const policy = botPolicy(bot, SALT);
  let guard = 0;
  while (!st.ended && guard++ < 200) { const t = st.turn; playTurn(st, data, policy); if (tracker) tracker.observe(st, t); } // = playToEnd，另外記下『不太來找你』的進出
  return st;
}
function record(data, bot, seed) {
  const tracker = approachTracker(data);
  const st = play(data, bot, seed, null, tracker);
  const ax = outcomeAxes(st), w = wellbeing(st, data.identities.parentModel);
  return { bot, seed, ax: [ax.親子, ax.人際, ax.學習], w: [w.child, w.parent, w.between], route: routePosition(st).kind, combo: comboOf(ax), hid: { ...st.hidden }, mech: mechRecord(st, data, { approachEpisodes: tracker.episodes }),
    tags: Object.entries(st.tagCounts || {}).filter(([, n]) => n >= 3).map(([t]) => t) };
}
function golden(data, families) {
  return Object.fromEntries(families.map((f) => {
    try { const st = play(data, f.bot, f.seed, f); const s = goldenSnapshot(st, data, buildEnding(st, data)); return [f.id, { ...s, sig: signature(s) }]; } catch (e) { return [f.id, { error: String(e.message || e) }]; }
  }));
}

if (!isMainThread && workerData && workerData.__impact) {
  const data = loadData();
  parentPort.postMessage(workerData.tasks.map(([b, s]) => record(data, b, s)));
} else if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [N, s0, famPath, outPath] = [parseInt(process.argv[2], 10), parseInt(process.argv[3], 10), process.argv[4], process.argv[5]];
  const NX = Math.max(60, Math.floor(N / 12));
  const tasks = [];
  for (let i = 0; i < N; i++) tasks.push([HUMAN_MIX[i % HUMAN_MIX.length], s0 + i]);
  const extra = Object.keys(ALL_BOTS).filter((b) => b in BOTS || ['surface', 'shortest', 'warmest'].includes(b));
  for (let i = 0; i < NX; i++) for (const b of extra) tasks.push([b, s0 + 100000 + i]);
  const nw = Math.min(availableParallelism(), 8);
  const parts = Array.from({ length: nw }, () => []);
  tasks.forEach((t, i) => parts[i % nw].push(t));
  const t0 = Date.now();
  const recs = (await Promise.all(parts.filter((p) => p.length).map((ts) => new Promise((res, rej) => {
    const w = new Worker(new URL(import.meta.url), { workerData: { __impact: true, tasks: ts } });
    w.once('message', res); w.once('error', rej);
  })))).flat();
  let gold = {};
  try { gold = golden(loadData(), JSON.parse(readFileSync(famPath, 'utf8')).families); } catch (e) { gold = { _error: String(e.message || e) }; }
  writeFileSync(outPath, JSON.stringify({ N, NX, recs, golden: gold, ms: Date.now() - t0 }));
}
