// 用法：node tools/simulate.mjs [局數=200] [起始種子=1]
// 策略機器人各玩 N 局（同一批種子＝成對比較，worker_threads 平行），印出三條結果軸（P10/P50/P90）、幸福、教養路線、七種組合、
// 校準目標的現況（tools/calibration.mjs）與參數曝光表（DESIGN §3.4、§3.6）。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) tools/simulate.mjs 的作法：同一批種子、決定性的策略、批次統計。
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { stateRng } from '../js/engine/rng.js';
import { newState, startTurnOf } from '../js/engine/state.js';
import { playTurn } from '../js/engine/turn.js';
import { approachTracker } from './approach-log.mjs';
import { outcomeAxes, wellbeing, routePosition, comboOf, COMBOS, estimateDeltas, chainRecords, endingContext, pickLines, lineContradictions } from '../js/engine/ending.js';
import { setTagObserver } from '../js/engine/tags.js';
import { buildChains, classroomSummary } from '../js/engine/chains.js';
import { outcomeWeights, AXES, edgeForTagEffect } from '../js/engine/model.js';
import { cardDoseK } from '../js/engine/timescale.js';
import { mechRecord } from './mech.mjs';
import { loadRaw, loadData } from './data-node.mjs';
import { avg, pct, median, paired } from './stats.mjs';
export { avg, pct, median, se, paired, share } from './stats.mjs';

import { BOTS, HUMAN_BOTS, HUMAN_MIX, ALL_BOTS, SALT, botPolicy } from './bots.mjs';
export { BOTS, HUMAN_BOTS, HUMAN_MIX, ALL_BOTS, botPolicy };

/* ───── 影響量測（DESIGN §3.7 第 2 點）：每個標籤／卡片／池對三條結果軸的影響（整局累計的絕對值），與每條邊的單回合最大變動、整局累計 ───── */
export function influenceMeter(st, data) {
  const W = outcomeWeights(data.model);
  const tag = {}, card = {}, pool = {}, edgeTurn = {}, edgeGame = {};
  let curTurn = -1, turnAcc = {};
  const flush = () => { for (const [e, v] of Object.entries(turnAcc)) edgeTurn[e] = Math.max(edgeTurn[e] || 0, v); turnAcc = {}; };
  const add = (m, key, vec) => { const a = (m[key] ||= [0, 0, 0]); for (let i = 0; i < 3; i++) a[i] += vec[i]; };
  setTagObserver(({ turn, perTag, scale }) => {
    if (turn !== curTurn) { flush(); curTurn = turn; }
    const cid = st.cur && st.cur.cardId, p = cid && data.cardIndex[cid] ? data.cardIndex[cid].pool : null;
    // 單回合的邊變動用『參考劑量』（÷ 這張卡的劑量倍率 k）記，maxTurn 以每 2 個月的一次為單位；整局累計（edgeGame）仍用實際值
    const kk = scale || (cid && data.cardIndex[cid] ? cardDoseK(data.model, data.timeline[Math.min(turn, data.timeline.length - 1)].span ?? 2, data.cardIndex[cid]) : 1); // 實際套用的劑量倍率（循環卡依間隔，paceMonths）；沒帶就用卡片的
    for (const [t, ds] of Object.entries(perTag)) {
      const vec = [0, 0, 0];
      for (const [k, d] of Object.entries(ds)) {
        if (!d) continue;
        AXES.forEach((ax, i) => { vec[i] += Math.abs((W[ax][k] || 0) * d); });
        const e = t === '@父母的收穫' ? data.model.edges.find((x) => x.id === 'h:父母的收穫+') : edgeForTagEffect(data.model, t, k, d);
        if (e) { turnAcc[e.id] = (turnAcc[e.id] || 0) + Math.abs(d) / kk; edgeGame[e.id] = (edgeGame[e.id] || 0) + Math.abs(d); }
      }
      if (vec.some((x) => x)) { add(tag, t, vec); if (cid) add(card, cid, vec); if (p) add(pool, p, vec); }
    }
  });
  const r2 = (m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => Math.round(x * 100) / 100) : Math.round(v * 100) / 100]));
  return { stop() { setTagObserver(null); }, result() { flush(); return { tag: r2(tag), card: r2(card), pool: r2(pool), edgeTurn: r2(edgeTurn), edgeGame: r2(edgeGame) }; } };
}

/** 『第 30 回合的錢』的月份版：國小開始之後第一個月齡 ≥ 6 個月的回合的錢（用回合序號 t 找曲線，從國小開始的局曲線不從 0 起，不能用陣列位置）；沒玩到就是 null */
export function moneyAtSchoolPlus(st, data, e, months = 6) {
  const tl = data.timeline, t = tl.findIndex((x, i) => i >= e && x.ageMonths >= tl[e].ageMonths + months);
  const c = st.vcurves.find((x) => x.t === t);
  return c ? c.錢 : null;
}

/* ───── 一局 ───── */
export function playGame(data, bot, seed, opts = {}) {
  const st = newState(seed, data, { role: opts.role || (seed % 2 ? '媽媽' : '爸爸'), startMode: opts.startMode || 'birth' });
  const meter = opts.influence ? influenceMeter(st, data) : null;
  const tracker = approachTracker(data), policy = botPolicy(bot, SALT, opts.only ? new Set(opts.only) : null);
  // 習慣量測（opts.habits；tools/checks/habits.mjs）：偵測結果、第 63 回合（進高中）時的習慣、整局的習慣，以及第 50 回合起所有 applyTags 的 |Δ| 合計（含自動套用）
  const jh0 = data.timeline.findIndex((t) => t.stage === '國中'), sh0 = data.timeline.findIndex((t) => t.stage === '高中');
  const hab = opts.habits && !meter ? { det: null, atSH: null, absAll: 0 } : null;
  if (hab) setTagObserver(({ turn, deltas }) => { if (turn >= jh0) for (const d of Object.values(deltas)) hab.absAll += Math.abs(d); });
  // 路線量測（opts.paths；tools/checks/paths.mjs）：第 62 回合（選高中之前）的興趣與成績，以及最後的學制、去向、中途離校
  const hs0 = data.timeline.findIndex((t) => t.stage === '國中' && t.fixed.includes('fx_choose_hs'));
  let pathSnap = null;
  const axAt = {}; // opts.snap（回合序號陣列）：玩完那個回合、準備進入第 n 回合時的三條結果軸（階段可塑性的『同劑量嚴厲』比較要在劑量剛結束時量）
  try { let guard = 0; while (!st.ended && guard++ < 200) { const t = st.turn; if (opts.paths && t === hs0 && !pathSnap) pathSnap = { 手: st.interest.動手做, 美術: st.interest.美術, 績: st.child.成績, 心情: st.child.心情, 往來: st.child.同學往來 }; playTurn(st, data, policy); tracker.observe(st, t); if (hab) { if (st.turn === jh0 + 1 && !hab.det) hab.det = structuredClone(st.habits); if (st.turn === sh0 && !hab.atSH) hab.atSH = structuredClone(st.habits); } if (opts.snap && opts.snap.includes(st.turn) && !(st.turn in axAt)) { const a = outcomeAxes(st); axAt[st.turn] = [a.親子, a.人際, a.學習]; } } } finally { if (meter) meter.stop(); if (hab) setTagObserver(null); } // = playToEnd，另外記下『不太來找你』的進出
  const ax = outcomeAxes(st), w = wellbeing(st, data.identities.parentModel), rp = routePosition(st);
  const f = st.family;
  const e = startTurnOf(data, 'elementary'); // 國小開始的回合（由日曆算出）
  const elemTurns = st.hist.filter((h) => h.turn >= e).length;
  const elemNonFixed = st.hist.filter((h) => h.turn >= e && !data.cardIndex[h.card].pool.startsWith('_')).length;
  const nTurnsElem = Math.max(1, st.curves.filter((c) => c.t >= e).length);
  // 預先登記的指標（A2.5 審查）：開學後前 24 個月的可見成績平均，用來成對比較 controlling 與 warmFirm（短期的學業收益，§3.2）
  const sm = data.timeline[e].ageMonths;
  const g24 = avg(st.vcurves.filter((c) => c.m >= sm && c.m < sm + 24).map((c) => c.成績));
  const rec = {
    g24, sens: f.child.temperament.敏感度,
    bot, seed, partner: f.partner.attitude || '無', econ: f.econ, pattern: f.pattern, support: f.support, struct: f.structure,
    ax: [ax.親子, ax.人際, ax.學習], w: [w.child, w.parent, w.between], route: rp.kind, combo: comboOf(ax),
    axAt,
    episodes: tracker.episodes.map((x) => ({ ...x })), // 『不太來找你』的進出（月齡；tools/checks/plasticity.mjs 看某個回合時是否在裡面）
    hid: { ...st.hidden }, money30: moneyAtSchoolPlus(st, data, e), lowBody: st.vcurves.filter((c) => c.體力 < 35).length / st.vcurves.length,
    elemTurns, elemNonFixed, nTurnsElem, fu: st.hist.filter((h) => h.fu != null).map((h) => h.fu), // 後續卡的延遲（月） cards: st.hist.length,
  };
  if (opts.mech) {
    rec.mech = mechRecord(st, data, { approachEpisodes: tracker.episodes });
    const lines = pickLines(endingContext({ axes: ax, wellbeing: w, route: rp, combo: rec.combo }, chainRecords(st, data.ending), data.ending), data.ending);
    rec.ending = { ids: lines.map((l) => l.id), facets: lines.map((l) => l.facet), contra: lineContradictions(lines, data.ending).length };
  }
  if (hab) rec.hab = { det: hab.det, atSH: hab.atSH, end: structuredClone(st.habits), absAll: hab.absAll, autoAbs: st.autoLog.reduce((a, e) => a + e.abs, 0), nAuto: st.autoLog.filter((e) => e.tags.length).length, nChange: st.hist.filter((h) => h.card === 'jh_habit_change').length, jhChange: st.hist.filter((h) => h.card === 'jh_habit_change' && data.timeline[h.turn].stage === '國中').length, shChange: st.hist.filter((h) => h.card === 'jh_habit_change' && data.timeline[h.turn].stage === '高中').length };
  if (opts.paths) rec.paths = { snap: pathSnap, type: st.vars.學制, dest: st.vars.去向, drop: st.vars.中途離校, sex: f.child.sex, override: !!st.flags.志願被決定, pref: st.vars.志願偏好, chain: st.hist.some((h) => h.card === 'sh_drop_signal') };
  if (opts.chains) { // 決定鏈量測（opts.chains；tools/checks/chains.mjs）：每局挑到幾條、幾條往好的方向、12 歲以後有沒有往好的方向轉、各條的內容是否齊全
    const C = data.chains, late = C ? C.settings.lateAfterMonths : 144, r = buildChains(st, data), cl = classroomSummary(st, data);
    rec.chains = {
      n: r.chains.length, pos: r.chains.filter((c) => c.positive).length, cands: r.all, latePos: r.chains.some((c) => c.positive && c.m0 >= late), latePosCand: (r.cands || []).some((c) => c.positive && c.m0 >= late),
      themes: r.chains.map((c) => c.theme), traced: r.chains.filter((c) => c.trace).length, curved: r.chains.filter((c) => c.curve).length, researched: r.chains.filter((c) => c.research).length,
      shortChoices: r.chains.filter((c) => c.choices.length < 3 || c.choices.length > 5).length, noSituation: r.chains.filter((c) => !c.situation).length, auto: r.chains.reduce((a, c) => a + c.autoN, 0),
      classLines: cl.lines.length, lowGrades: cl.lowGrades.length, reports: cl.reports.length,
    };
  }
  if (meter) rec.inf = meter.result();
  if (opts.axRecent) { // 只看近期的三條軸（關掉『整個童年』混合）：tools/bands-fit.mjs 用它對齊各軸的好／差門檻
    const E = data.ending, keep = E.outcomeBlend;
    E.outcomeBlend = { ...keep, recent: 1, whole: 0 };
    try { const a0 = outcomeAxes(st); rec.axRecent = [a0.親子, a0.人際, a0.學習]; } finally { E.outcomeBlend = keep; }
  }
  if (opts.trust) { // 單步擺幅（opts.trust；tools/checks/plasticity.mjs）：每個回合結束後親子信任的絕對變動，記在『剛玩完的那個回合』的階段
    const c = st.curves, steps = [];
    for (let i = 1; i < c.length; i++) steps.push([data.timeline[c[i - 1].t]?.stage, Math.abs(c[i].親子信任 - c[i - 1].親子信任)]);
    rec.trustSteps = steps;
  }
  if (opts.st) rec.st = st;
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

export async function execute(tasks, opts) {
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
    const w = new Worker(url, { workerData: { __sim: true, tasks: ts, tagScale: opts.tagScale, variants: opts.variants, synthetic: opts.synthetic, exposure: opts.exposure, startMode: opts.startMode, snap: opts.snap, mech: opts.mech, influence: opts.influence, trust: opts.trust, axRecent: opts.axRecent, role: opts.role, only: opts.only, habits: opts.habits, paths: opts.paths, chains: opts.chains } });
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

/**
 * 「真人混合」：N 局，第 i 局（種子 s0+i）依 HUMAN_MIX 輪流換機器人。回傳 records 陣列（依種子排序，每筆有 bot、mech，opts.influence 時有 inf）。
 */
export async function runMix(N, s0 = 1, opts = {}) {
  const mix = opts.mix || HUMAN_MIX;
  const tasks = [];
  for (let i = 0; i < N; i++) tasks.push([mix[i % mix.length], s0 + i, 0]);
  const recs = await execute(tasks, { mech: true, ...opts });
  return recs.sort((a, b) => a.seed - b.seed);
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
