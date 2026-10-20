// 用法：node tools/simulate.mjs [局數=200] [起始種子=1]
// 策略機器人各玩 N 局（同一批種子＝成對比較，worker_threads 平行），印出三條結果軸（P10/P50/P90）、幸福、教養路線、七種組合、
// 校準目標的現況（tools/calibration.mjs）與參數曝光表（DESIGN §3.4、§3.6）。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) tools/simulate.mjs 的作法：同一批種子、決定性的策略、批次統計。
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { stateRng } from '../js/engine/rng.js';
import { newState } from '../js/engine/state.js';
import { playToEnd } from '../js/engine/turn.js';
import { outcomeAxes, wellbeing, routePosition, comboOf, COMBOS, estimateDeltas } from '../js/engine/ending.js';
import { loadRaw, loadData } from './data-node.mjs';
import { tagVec, doseScore } from './metrics.mjs';

const hasTag = (ch, set) => (ch.tags || []).filter((t) => set.includes(t)).length;
const sum = (o, w) => Object.entries(w).reduce((a, [k, x]) => a + x * (o[k] || 0), 0);

export const BOTS = {
  random: { desc: '隨機', score: () => 0 },
  permissive: { desc: '放任（嘴巴尊重、兩手一攤、出事才收拾）', score: (T, ch) => {
    const v = tagVec(T, ch);
    return -v.規範監督 - v.替他做主 + 0.2 * (v.溫暖陪伴 || 0) + 3 * hasTag(ch, ['嘴巴尊重無跟進', '兩手一攤', '沒有下文', '說沒關係就結束', '吵了才讓步', '說了不算', '出事替他擺平', '外包', '3C當保母', '全部替他做']);
  } },
  controlling: { desc: '控制（替他決定、只看成績、比較）', score: (T, ch) => {
    const v = tagVec(T, ch);
    return 2 * (v.替他做主 || 0) + (v.規範監督 || 0) - 0.3 * (v.溫暖陪伴 || 0) + 3 * hasTag(ch, ['替他決定', '罵一頓', '只看成績', '送去補習', '拿別人比較', '轉述消息_特地', '全部替他做', '提議別的', '沒聽孩子重複的要求']);
  } },
  warmFirm: { desc: '溫暖＋堅定', score: (T, ch) => sum(tagVec(T, ch), { 溫暖陪伴: 1, 規範監督: 1, 親子信任: 0.5, 了解度: 0.5, 主見: 0.5, 替他做主: -1, 期待壓力: -0.5, 試探度: -0.5, 規則一致性: 0.3 }) },
  doseGreedy: { desc: '只看劑量表（每次選看得到的變化最好的）', score: (T, ch) => doseScore(ch) },
  warmFirmRest: { desc: '溫暖＋堅定，耐心見底時先休息', score: (T, ch) => BOTS.warmFirm.score(T, ch) },
};

export function botPolicy(botName, seedSalt) {
  const bot = BOTS[botName];
  let holder = null;
  return {
    choose(st, view, raw, data) {
      holder ??= { r: (st.seed ^ seedSalt) >>> 0 };
      const r = stateRng(holder, 'r');
      const opts = view.choices.filter((c) => !c.disabled);
      if (botName === 'random') return opts[Math.floor(r() * opts.length)].i;
      if (botName === 'warmFirmRest' && st.parent.耐心 < 35) {
        const rest = opts.find((o) => (raw.choices[o.i].tags || []).includes('父母自己休息'));
        if (rest) return rest.i;
      }
      let best = null, bs = -1e9;
      for (const o of opts) {
        const s = bot.score(data.tags, raw.choices[o.i]) + r() * 1e-6; // 平手時用亂數決定（決定性）
        if (s > bs) { bs = s; best = o.i; }
      }
      return best;
    },
  };
}

/* ───── 一局 ───── */
const SALT = 0x9e3779b1;
export function playGame(data, bot, seed, opts = {}) {
  const st = newState(seed, data, { role: seed % 2 ? '媽媽' : '爸爸', startMode: opts.startMode || 'birth' });
  playToEnd(st, data, botPolicy(bot, SALT));
  const ax = outcomeAxes(st), w = wellbeing(st), rp = routePosition(st);
  const f = st.family;
  const e = (st.startMode === 'birth' ? 20 : 0);
  const elemTurns = st.hist.filter((h) => h.turn >= e).length;
  const elemNonFixed = st.hist.filter((h) => h.turn >= e && !data.cardIndex[h.card].pool.startsWith('_')).length;
  const nTurnsElem = Math.max(1, st.curves.filter((c) => c.t >= e).length);
  const rec = {
    bot, seed, econ: f.econ, pattern: f.pattern, support: f.support, struct: f.structure,
    ax: [ax.親子, ax.人際, ax.學習], w: [w.child, w.parent, w.between], route: rp.kind, combo: comboOf(ax),
    hid: { ...st.hidden }, money30: st.vcurves[30]?.錢 ?? null, lowBody: st.vcurves.filter((c) => c.體力 < 35).length / st.vcurves.length,
    elemTurns, elemNonFixed, nTurnsElem, fu: st.hist.filter((h) => h.fu != null).map((h) => h.fu), cards: st.hist.length,
  };
  if (opts.exposure) {
    const ex = {};
    for (const h of st.hist) for (const [k, d] of Object.entries(estimateDeltas(h.tags, data.timeline[h.turn].stage, data.tags))) { const o = (ex[k] ||= { abs: 0, net: 0 }); o.abs += Math.abs(d); o.net += d; }
    rec.exposure = ex;
  }
  return rec;
}

/* ───── 平行執行（worker_threads）───── */
function chunk(arr, n) { const out = Array.from({ length: n }, () => []); arr.forEach((x, i) => out[i % n].push(x)); return out.filter((c) => c.length); }

function buildRaw(job, tagScale = job.tagScale) {
  const raw = loadRaw();
  if (tagScale) for (const [t, m] of Object.entries(tagScale)) for (const k of Object.keys(raw.tags.tags[t].d || {})) raw.tags.tags[t].d[k] *= m;
  if (job.synthetic) raw.events.cards.push(...makeSyntheticCards(raw, job.synthetic));
  return raw;
}

if (!isMainThread && workerData && workerData.__sim) {
  const job = workerData;
  const datas = new Map(); // 變體（敏感度分析用的權重調整）→ 資料，每個 worker 只建一次
  const out = [];
  for (const [bot, seed, v] of job.tasks) {
    if (!datas.has(v)) datas.set(v, loadData(buildRaw(job, job.variants ? job.variants[v] : job.tagScale)));
    const rec = playGame(datas.get(v), bot, seed, job);
    rec.variant = v;
    out.push(rec);
  }
  parentPort.postMessage(out);
}

async function execute(tasks, opts) {
  const nw = opts.workers ?? Math.min(availableParallelism(), 8);
  if (nw <= 1) {
    const datas = new Map();
    return tasks.map(([b, s, v]) => {
      if (!datas.has(v)) datas.set(v, loadData(buildRaw(opts, opts.variants ? opts.variants[v] : opts.tagScale)));
      const rec = playGame(datas.get(v), b, s, opts); rec.variant = v; return rec;
    });
  }
  const url = new URL(import.meta.url);
  const parts = await Promise.all(chunk(tasks, nw).map((ts) => new Promise((res, rej) => {
    const w = new Worker(url, { workerData: { __sim: true, tasks: ts, tagScale: opts.tagScale, variants: opts.variants, synthetic: opts.synthetic, exposure: opts.exposure, startMode: opts.startMode } });
    w.once('message', res); w.once('error', rej);
  })));
  return parts.flat();
}

/**
 * 每種策略玩 N 局（種子 s0…s0+N−1，所有策略共用同一批種子＝成對比較）。回傳 { bot: [紀錄…] }（依種子排序）。
 * opts: { bots, workers, tagScale, synthetic, exposure, startMode }
 */
export async function runBots(N, s0 = 1, opts = {}) {
  const bots = opts.bots || Object.keys(BOTS);
  const tasks = [];
  for (let i = 0; i < N; i++) for (const b of bots) tasks.push([b, s0 + i, 0]);
  const recs = await execute(tasks, opts);
  const games = Object.fromEntries(bots.map((b) => [b, []]));
  for (const r of recs) games[r.bot].push(r);
  for (const b of bots) games[b].sort((x, y) => x.seed - y.seed);
  return games;
}

/** 同一批種子、同樣的策略，各種標籤權重調整（variants：[{標籤: 倍率}, …]）一起平行跑。回傳 [games, …]，順序同 variants。 */
export async function runVariants(N, s0, variants, bots, opts = {}) {
  const tasks = [];
  variants.forEach((_, v) => { for (let i = 0; i < N; i++) for (const b of bots) tasks.push([b, s0 + i, v]); });
  const recs = await execute(tasks, { ...opts, variants });
  return variants.map((_, v) => {
    const g = Object.fromEntries(bots.map((b) => [b, []]));
    for (const r of recs) if (r.variant === v) g[r.bot].push(r);
    for (const b of bots) g[b].sort((x, y) => x.seed - y.seed);
    return g;
  });
}

/* ───── 合成卡片（只給效能基準用，不是遊戲資料）───── */
export function makeSyntheticCards(raw, n) {
  const stages = raw.tags.stages.slice(0, 4);
  const tagNames = Object.keys(raw.tags.tags);
  const pools = Object.keys(raw.pools.pools).filter((p) => p.startsWith('日常_'));
  const cards = [];
  let seed = 12345;
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < n; i++) {
    const pool = pools[Math.floor(rnd() * pools.length)];
    const stage = pool.slice(3);
    const nc = 3 + Math.floor(rnd() * 3);
    const choices = Array.from({ length: nc }, (_, k) => ({
      label: `合成選項 ${i}-${k}`, effects: { 心情: Math.round(rnd() * 8 - 4), 體力: Math.round(rnd() * 6 - 4), 耐心: Math.round(rnd() * 6 - 4) },
      tags: [tagNames[Math.floor(rnd() * tagNames.length)]], result: '合成結果。',
      ...(k === 0 && rnd() < 0.3 ? { showIf: '了解度高' } : {}),
    }));
    cards.push({ id: `syn_${i}`, pool, title: `合成卡 ${i}`, text: '合成卡片（效能基準用）。', choices, weight: 1, cooldown: 2 + Math.floor(rnd() * 6), stages: stages.includes(stage) ? [stage] : undefined,
      ...(rnd() < 0.2 ? { requires: { expr: '體力 < 90 and 耐心 > 5' } } : {}) });
  }
  return cards;
}

/* ───── 命令列 ───── */
if (isMainThread && process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { evaluateCalibration, groupBy } = await import('./calibration.mjs');
  const N = parseInt(process.argv[2] || '200', 10);
  const s0 = parseInt(process.argv[3] || '1', 10);
  const t0 = Date.now();
  const games = await runBots(N, s0, { exposure: true });
  const ms = Date.now() - t0;
  const f = (x, w = 5) => x.toFixed(1).padStart(w);
  console.log(`模擬：每種策略 ${N} 局（種子 ${s0}–${s0 + N - 1}，從出生開始，各策略共用同一批種子），耗時 ${ms} ms\n`);
  console.log('策略                ｜ 親子 P10/P50/P90      ｜ 人際 P10/P50/P90      ｜ 學習 P10/P50/P90      ｜ 孩子幸福 父母幸福 彼此之間');
  for (const [name, g] of Object.entries(games)) {
    const col = (i) => `${f(avg(g.map((x) => x.ax[i])))} ${f(pct(g.map((x) => x.ax[i]), 0.1))}/${f(pct(g.map((x) => x.ax[i]), 0.5))}/${f(pct(g.map((x) => x.ax[i]), 0.9))}`;
    console.log(`${name.padEnd(13)}${BOTS[name].desc.slice(0, 6).padEnd(7, '　')}｜ ${col(0)} ｜ ${col(1)} ｜ ${col(2)} ｜ ${f(avg(g.map((x) => x.w[0])))}    ${f(avg(g.map((x) => x.w[1])))}    ${f(avg(g.map((x) => x.w[2])))}`);
  }
  console.log('\n教養路線（相對開局的變化，|Δ|>8）：');
  for (const [name, g] of Object.entries(games)) { const c = {}; g.forEach((x) => { c[x.route] = (c[x.route] || 0) + 1; }); console.log(`  ${name.padEnd(13)}${Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / N * 100).toFixed(0)}%`).join('　')}`); }
  console.log('\n§3.1 七種組合的比例：');
  for (const [name, g] of Object.entries(games)) { const c = {}; g.forEach((x) => { c[x.combo] = (c[x.combo] || 0) + 1; }); console.log(`  ${name.padEnd(13)}${COMBOS.filter((k) => c[k]).map((k) => `${k} ${(c[k] / N * 100).toFixed(0)}%`).join('　')}`); }
  const ev = evaluateCalibration(games);
  console.log('\n校準目標（現況 vs 目標）：');
  for (const r of ev) console.log(`  ${r.ok ? '✓' : '✗'} ${r.desc}：${r.value}　目標 ${r.target}`);
  // 成對比較
  console.log('\n成對比較（同一批種子；平均差 ± 標準誤）：');
  for (const [a, b] of [['warmFirm', 'doseGreedy'], ['warmFirm', 'random'], ['doseGreedy', 'random'], ['warmFirmRest', 'warmFirm']]) {
    const p = paired(games[a], games[b], (g) => g.ax[0]), q = paired(games[a], games[b], (g) => g.w[1]);
    console.log(`  ${a} − ${b}：親子 ${f(p.mean)} ± ${p.se.toFixed(1)}，父母幸福 ${f(q.mean)} ± ${q.se.toFixed(1)}`);
  }
  // 隱藏數值終點（各策略平均）
  const keys = Object.keys(games.random[0].hid);
  console.log('\n隱藏數值終點（各策略平均）：');
  console.log('  ' + 'name'.padEnd(10, '　') + Object.keys(games).map((n) => n.slice(0, 8).padStart(9)).join(''));
  for (const k of keys) console.log('  ' + k.padEnd(10, '　') + Object.values(games).map((g) => f(avg(g.map((x) => x.hid[k])), 9)).join(''));
  // 靜態曝光
  const data = loadData();
  const cards = data.events.cards;
  const nChoices = cards.reduce((a, c) => a + c.choices.length, 0);
  const touch = {};
  for (const c of cards) for (const ch of c.choices) {
    const ks = new Set();
    for (const t of ch.tags) for (const k of Object.keys(data.tags.tags[t].d || {})) ks.add(k);
    for (const k of ks) touch[k] = (touch[k] || 0) + 1;
  }
  const exposure = {};
  for (const g of games.random) for (const [k, e] of Object.entries(g.exposure || {})) { const o = (exposure[k] ||= { abs: 0, net: 0 }); o.abs += e.abs; o.net += e.net; }
  console.log('\n參數曝光表（§3.6 第 1 點）：隱藏數值　被多少比例的選項推動｜隨機策略每局平均被推動的總量（絕對值）／淨變化');
  for (const k of Object.keys(data.tags.hidden)) {
    const e = exposure[k] || { abs: 0, net: 0 };
    console.log(`  ${k.padEnd(8, '　')} ${((touch[k] || 0) / nChoices * 100).toFixed(0).padStart(3)}%｜ ${(e.abs / N).toFixed(1).padStart(6)} ／ ${(e.net / N).toFixed(1).padStart(6)}${data.tags.derived.includes(k) ? '（推算值）' : ''}`);
  }
  void groupBy;
}
