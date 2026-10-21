// 雙問題盲測的評分器（配合 tools/obviousness.mjs --context）。
// 輸入：blind.json（題目）、key.json（每題隱藏的最佳選項）、一個以上的評分檔（JSON 陣列 [{id, q1, q2}]，選項用 0 起算的顯示位置；多位評分者的檔案可以一起給）。
// 輸出：
//   Q1「專家會選哪個」命中率、Q2「你實際會選哪個」命中率：三組——主要（不含 data/tags.json cardRules.obviousOk 的卡，Q1/Q2 目標看這組）／obviousOk（醫療安全、訊號、一次性的卡，單獨報告）／全部；
//   主要組再分『最佳選項換人』的題（switch）／其他題。各附 Wilson 95% 信賴區間與機會率
//   Q2 選到 ▲ 最多的選項的比率（追著劑量表跑）
//   Q1 選到最長、最暖（bots.mjs 的字面啟發）選項的比率
// 追劑量／最長／最暖：這題所有選項平手（沒有線索可追）就不計入分母。
// 命中＝選到 key.best 裡的任何一個（平手都算）；機會率＝每題 |best|/選項數 的平均（沒有平手時就是 1/選項數）。
// 用法：node tools/obviousness-score.mjs blind.json key.json ratings1.json [ratings2.json …]
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { wilson } from './mech.mjs';
import { warmScore } from './bots.mjs';

const lenOf = (l) => [...String(l || '')].length;
const arrowsUp = (o) => (o.dose || []).join('').split('▲').length - 1;
const argmaxSet = (xs) => { const m = Math.max(...xs); return xs.map((x, i) => (x === m ? i : -1)).filter((i) => i >= 0); };

/** 一組觀察值 → { n, k, rate, ci:[lo,hi], chance } ；obs＝[{hit:boolean, chance:number}] */
export function summarize(obs) {
  const n = obs.length, k = obs.filter((o) => o.hit).length;
  return { n, k, rate: n ? k / n : NaN, ci: wilson(k, n), chance: n ? obs.reduce((a, o) => a + o.chance, 0) / n : NaN };
}

/**
 * 評分。ratings＝[{id,q1,q2}, …]（可含多位評分者，同一題出現多次就算多筆）。data（選填）給 warmScore 讀 data/tags.json 的暖語線索；不給就用預設線索。
 * 回傳 { rated, ignored, q1, q2, dose, longest, warmest }，其中 q1／q2／dose／longest／warmest 各有 all／switch／other。
 */
export function scoreRatings(blind, key, ratings, data = null) {
  const byId = new Map(blind.map((b) => [b.id, b]));
  const bins = { q1: [], q2: [], dose: [], longest: [], warmest: [] };
  const split = () => ({ all: [], main: [], ok: [], switch: [], other: [] });
  const okSet = new Set(Object.keys(data?.tags?.cardRules?.obviousOk || {}).filter((k) => !k.startsWith('_')));
  const S = Object.fromEntries(Object.keys(bins).map((k) => [k, split()]));
  let rated = 0, ignored = 0;
  for (const r of ratings) {
    const b = byId.get(r.id), kk = key[r.id];
    const n = b?.options.length;
    const ok = (x) => Number.isInteger(x) && x >= 0 && x < n;
    if (!b || !kk || !ok(r.q1) || !ok(r.q2)) { ignored++; continue; }
    rated++;
    const grp = kk.switch ? 'switch' : 'other', isOk = okSet.has(kk.card);
    const add = (name, hit, chance) => { const o = { hit, chance }; S[name].all.push(o); if (isOk) S[name].ok.push(o); else { S[name].main.push(o); S[name][grp].push(o); } };
    add('q1', kk.best.includes(r.q1), kk.best.length / n);
    add('q2', kk.best.includes(r.q2), kk.best.length / n);
    const most = argmaxSet(b.options.map(arrowsUp));
    if (most.length < n) add('dose', most.includes(r.q2), most.length / n); // 全部平手＝沒有線索，不計
    const longest = argmaxSet(b.options.map((o) => lenOf(o.label)));
    if (longest.length < n) add('longest', longest.includes(r.q1), longest.length / n);
    const warm = argmaxSet(b.options.map((o) => warmScore(o.label, data)));
    if (warm.length < n) add('warmest', warm.includes(r.q1), warm.length / n);
  }
  const out = { rated, ignored };
  for (const [name, s] of Object.entries(S)) out[name] = { all: summarize(s.all), main: summarize(s.main), ok: summarize(s.ok), switch: summarize(s.switch), other: summarize(s.other) };
  return out;
}

const pc = (x) => (Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—');
const line = (label, s) => `  ${label.padEnd(8)} ${String(s.k).padStart(4)}/${String(s.n).padEnd(4)} ${pc(s.rate).padStart(6)}  95% CI [${pc(s.ci[0])}, ${pc(s.ci[1])}]  機會率 ${pc(s.chance)}`;
export function formatReport(r) {
  const L = [`評分 ${r.rated} 筆（略過無效或不認得的 ${r.ignored} 筆）`];
  const block = (title, x) => { L.push('', title, line('主要', x.main), line('  換人題', x.switch), line('  其他題', x.other), line('obviousOk', x.ok), line('全部', x.all)); };
  block('Q1 專家會選哪一個：命中隱藏最佳選項', r.q1);
  block('Q2 你實際會選哪一個：命中隱藏最佳選項', r.q2);
  block('Q2 選到 ▲ 最多的選項（追著劑量表跑）', r.dose);
  block('Q1 選到最長的選項', r.longest);
  block('Q1 選到最暖的選項（bots.mjs 暖語線索）', r.warmest);
  L.push('', '主要＝不含 cardRules.obviousOk 的卡（醫療安全：難處在代價；訊號：難處在注意到；一次性）；換人題＝在這個情境下，最佳選項和預設情境不同的題；信賴區間重疊機會率＝和亂猜分不出來。');
  return L.join('\n');
}

const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [blindF, keyF, ...rf] = process.argv.slice(2);
  if (!blindF || !keyF || !rf.length) { console.error('用法：node tools/obviousness-score.mjs blind.json key.json ratings.json […]'); process.exit(2); }
  const { loadData } = await import('./data-node.mjs');
  console.log(formatReport(scoreRatings(readJson(blindF), readJson(keyF), rf.flatMap(readJson), loadData())));
}
