// 用法：node tools/rule21-gap.mjs [局數=300] [起始種子=1] [顯示前幾名=25]
// 規則 21 差距診斷：check-design 的『情境感知 − 情境盲』只告訴你總差距，這支告訴你差距從哪幾張卡、哪種孩子來。
// 作法：用『情境感知溫暖＋堅定』機器人（warmFirm）玩 N 局；每次遇到有情境版本（labelIf／tagsIf／effectsIf）的卡，
// 在當下的狀態同時問情境盲機器人（warmFirmBlind，永遠照卡片原本的選項打分）會選哪個。
// 兩者選得不一樣（＝這個情境讓最佳選項換了人）時，把兩個『套用情境版本後實際發生的選項』用和機器人相同的算法比較：
//   打分差    ＝ warmFirm 的打分（tagVec 加權）感知 − 盲
//   幸福差    ＝ 標籤換算的隱藏數值，乘上『綜合幸福』的權重（compositeWeights：和終局 wellbeing 同一個組合），感知 − 盲（主要指標；『最佳選項』以它定義）
//   親子差    ＝ 同上，但只用『親子』軸的權重（舊定義，留作對照欄）
//   劑量差    ＝ 看得到的變化（doseScore），感知 − 盲（負的＝盲的選擇當下看起來比較好）
// 依『幸福差』的總貢獻（每局平均）排序。
import { fileURLToPath } from 'node:url';
import { newState } from '../js/engine/state.js';
import { playTurn } from '../js/engine/turn.js';
import { outcomeWeights } from '../js/engine/model.js';
import { evalCond, choiceCtx, resolveChoice, VARIANT_FIELDS } from '../js/engine/events.js';
import { loadRaw, loadData } from './data-node.mjs';
import { botPolicy, BOTS, SALT } from './bots.mjs';
import { tagVec, doseScore, compositeWeights } from './metrics.mjs';

export function measureGap(N = 300, s0 = 1) {
  const raw = loadRaw(), data = loadData(raw);
  const W = outcomeWeights(data.model)['親子'], WC = compositeWeights(data.model);
  const dot = (w) => (ch, stages) => Object.entries(tagVec(data.tags, ch, stages)).reduce((a, [k, v]) => a + (w[k] || 0) * v, 0);
  const axisOf = dot(W), compOf = dot(WC);
  const rows = new Map(); // `${卡}\t${情境}` → 累計
  let total = 0, totalAxis = 0, occurrences = 0, diffs = 0;
  for (let seed = s0; seed < s0 + N; seed++) {
    const st = newState(seed, data, { role: seed % 2 ? '媽媽' : '爸爸', startMode: 'birth' });
    const aware = botPolicy('warmFirm', SALT), blind = botPolicy('warmFirmBlind', SALT);
    const policy = {
      choose(s, view, rawCard, d) {
        const a = aware.choose(s, view, rawCard, d);
        if (!rawCard.choices.some((c) => Object.keys(VARIANT_FIELDS).some((k) => c[k]))) return a;
        occurrences++;
        const b = blind.choose(s, view, rawCard, d);
        if (a === b) return a;
        diffs++;
        const tl = d.timeline[s.turn], stages = rawCard.stages || null;
        const res = (i) => { const base = rawCard.choices[i]; return resolveChoice(base, choiceCtx(s, tl, rawCard, base)); };
        const ra = res(a), rb = res(b);
        const gap = compOf(ra, stages) - compOf(rb, stages), axGap = axisOf(ra, stages) - axisOf(rb, stages);
        const score = BOTS.warmFirm.score(d.tags, ra) - BOTS.warmFirm.score(d.tags, rb);
        const dose = doseScore(ra) - doseScore(rb);
        // 情境＝這張卡所有選項的情境版本裡，當下成立的 if
        const ifs = new Set();
        for (const c of rawCard.choices) for (const k of Object.keys(VARIANT_FIELDS)) for (const v of c[k] || []) if (v.if && evalCond(v.if, choiceCtx(s, tl, rawCard, c))) ifs.add(v.if);
        const key = `${rawCard.id}\t${[...ifs].join(' | ') || '（無）'}\t${a}\t${b}`;
        const o = rows.get(key) || { card: rawCard.id, ctx: [...ifs].join(' | ') || '（無）', aware: a, blind: b, n: 0, gap: 0, axGap: 0, score: 0, dose: 0, la: ra.label, lb: rb.label };
        o.n++; o.gap += gap; o.axGap += axGap; o.score += score; o.dose += dose; rows.set(key, o);
        total += gap; totalAxis += axGap;
        return a;
      },
    };
    let guard = 0;
    while (!st.ended && guard++ < 200) playTurn(st, data, policy);
  }
  const list = [...rows.values()].sort((x, y) => y.gap - x.gap);
  return { list, total, totalAxis, N, occurrences, diffs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [N = 300, s0 = 1, top = 25] = process.argv.slice(2).map(Number);
  const { list, total, totalAxis, occurrences, diffs } = measureGap(N, s0);
  console.log(`規則 21 差距診斷：${N} 局（種子 ${s0}–${s0 + N - 1}）；有情境版本的卡出現 ${(occurrences / N).toFixed(1)} 次／局，其中盲的選得不一樣 ${(diffs / N).toFixed(1)} 次／局`);
  console.log(`幸福差總計（綜合幸福，主要）${(total / N).toFixed(2)}；親子差總計（舊定義，僅親子軸）${(totalAxis / N).toFixed(2)}（隱藏數值點數／局，感知 − 盲；越大＝情境越重要）\n`);
  console.log('排名 | 貢獻%  | 幸福差/次 | 親子差/次 | 打分差/次 | 劑量差/次 | 次/局 | 卡片 ｜ 情境 ｜ 感知選 → 盲選');
  list.slice(0, top).forEach((o, i) => console.log(`${String(i + 1).padStart(3)} | ${(o.gap / total * 100).toFixed(1).padStart(5)}% | ${(o.gap / o.n).toFixed(2).padStart(8)} | ${(o.axGap / o.n).toFixed(2).padStart(8)} | ${(o.score / o.n).toFixed(2).padStart(8)} | ${(o.dose / o.n).toFixed(1).padStart(8)} | ${(o.n / N).toFixed(2).padStart(5)} | ${o.card} ｜ ${o.ctx} ｜ #${o.aware}「${o.la}」→ #${o.blind}「${o.lb}」`));
  const byCard = new Map();
  for (const o of list) byCard.set(o.card, (byCard.get(o.card) || 0) + o.gap);
  console.log('\n依卡片合計（前 15）：');
  [...byCard].sort((x, y) => y[1] - x[1]).slice(0, 15).forEach(([c, g]) => console.log(`  ${c.padEnd(28)} ${(g / N).toFixed(3)}  ${(g / total * 100).toFixed(1)}%`));
}
