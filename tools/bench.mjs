// 效能基準：500 張合成卡片（tools/simulate.mjs 的 makeSyntheticCards，只給這個基準用，不是遊戲資料）
// 用法：node tools/bench.mjs [每種策略的局數=200] [合成卡片數=500] [workers]
// 目標：每種策略 200 局在 20 秒內跑完（所有策略一起平行，成對種子）。
import { runBots, BOTS } from './simulate.mjs';

const N = parseInt(process.argv[2] || '200', 10);
const CARDS = parseInt(process.argv[3] || '500', 10);
const workers = process.argv[4] !== undefined ? parseInt(process.argv[4], 10) : undefined;
const t0 = Date.now();
const games = await runBots(N, 1, { synthetic: CARDS, workers });
const ms = Date.now() - t0;
const total = Object.values(games).reduce((a, g) => a + g.length, 0);
const distinct = new Set(Object.values(games).flat().flatMap((g) => g.cards)).size;
console.log(`${Object.keys(BOTS).length} 種策略 × ${N} 局 = ${total} 局，${CARDS} 張合成卡（另有遊戲本身的卡），耗時 ${(ms / 1000).toFixed(1)} 秒（${(ms / total).toFixed(1)} ms／局，workers=${workers ?? 'auto'}）`);
console.log(distinct > 0 ? `每局平均出卡 ${(Object.values(games).flat().reduce((a, g) => a + g.cards, 0) / total).toFixed(1)} 張` : '');
console.log(ms <= 20000 ? '✓ 在 20 秒內' : '✗ 超過 20 秒');
process.exit(ms <= 20000 ? 0 : 1);
