// 用法：node tools/surface.mjs [檔名，例如 elem_low，省略＝全部] [局數=240] [起始種子=1]
// 逐檔報告 DESIGN §11 規則 11（表面對等）：研究選項是最長的比例、標記詞不對等的卡數，
// 並讓『字面機器人』只在該檔的卡上照字面選（其他卡隨機），顯示 親子 − 隨機。
import { loadRaw, loadData } from './data-node.mjs';
import { rule11, cardFileMap } from './rule11.mjs';
import { runBots } from './simulate.mjs';

const args = process.argv.slice(2);
const want = args.find((a) => !/^\d+$/.test(a));
const nums = args.filter((a) => /^\d+$/.test(a)).map(Number);
const N = nums[0] ?? 240, s0 = nums[1] ?? 1;
const raw = loadRaw(), cards = raw.events.cards, fileOf = cardFileMap();
const r = rule11(cards, raw.tags, fileOf);
const files = want ? [want.replace(/^events\//, '').replace(/\.json$/, '')] : Object.keys(r.perFile);
const avg = (rs) => rs.reduce((a, x) => a + x.ax[0], 0) / rs.length;
const base = (await runBots(N, s0, { bots: ['random'] })).random;
console.log(`逐檔表面對等（${N} 局，種子 ${s0}–${s0 + N - 1}；隨機親子平均 ${avg(base).toFixed(1)}）`);
console.log('檔案\t有研究選項的卡\t研究最長違規\t標記詞違規\t字面機器人(只限該檔) 親子 − 隨機');
for (const f of files) {
  const p = r.perFile[f];
  if (!p) { console.log(`${f}\t（沒有這個檔或沒有有研究選項的卡）`); continue; }
  const only = cards.filter((c) => fileOf[c.id] === f).map((c) => c.id);
  const sur = (await runBots(N, s0, { bots: ['surface'], only })).surface;
  const d = avg(sur) - avg(base);
  console.log(`${f}\t${p.cards}\t${(p.longShare * 100).toFixed(0)}%（${p.longFail}）\t${p.markFail}\t${d >= 0 ? '+' : ''}${d.toFixed(2)}`);
}
if (!want) {
  const sur = (await runBots(N, s0, { bots: ['surface'] })).surface;
  console.log(`全部\t${r.total.cards}\t${(r.total.longShare * 100).toFixed(0)}%（${r.total.longFail}）\t${r.total.markFail}\t${(avg(sur) - avg(base) >= 0 ? '+' : '') + (avg(sur) - avg(base)).toFixed(2)}`);
}
