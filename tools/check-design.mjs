// 用法：node tools/check-design.mjs [局數=3000] [起始種子=1] [--write-caps] [--calibration] [--json]
// 設計檢驗（DESIGN §3.7 第 5 點；沿用 47wan 的 tools/check-design.mjs 與 design-targets.json 的作法）：
// 用「真人混合」機器人（累了偷懶、照習慣反應、偶爾查研究、一點隨機）自動玩 N 局，再用校準用的極端策略各玩 N/12 局，
// 把『每個機制的發生率』『發生與沒發生的方向』『結局不矛盾』『標籤／卡片／池與每條邊的影響上限』和 tools/design-targets.json、data/model.json 比對。
// 有任何 ✗ 時結束碼為 1（CI 會紅燈）。--write-caps：依量測的最大值加餘裕，（已停用，見 tools/derive-caps.mjs）把上限寫回 data/model.json。
import { fileURLToPath } from 'node:url';
import { runMix, runBots, BOTS } from './simulate.mjs';
import { evaluateMechanisms, getPath } from './mech.mjs';
import { TARGETS, evaluateCalibration } from './calibration.mjs';
import { loadRaw, loadData } from './data-node.mjs';
import { lintModel } from './lint-model.mjs';
import { readModel, writeModel } from './model-io.mjs';
import { AXES } from '../js/engine/model.js';
import { fixedShareByStage } from './metrics.mjs';
import { loadPlugins } from './plugins.mjs';

/** tools/checks/*.mjs 外掛（plugins.mjs）：後面的工作包把自己的檢查放進這個資料夾，不必改這個檔 */
const CHECK_PLUGINS = await loadPlugins('checks', 'check');

const CLASSES = [['tag', 'perTag', '標籤'], ['card', 'perCard', '卡片'], ['pool', 'perPool', '池']];

/** 把每局的影響紀錄合併成最大值：{ class: { axis: { v, key } }, byKey: {class: {key: [3]}}, edgeTurn, edgeGame } */
export function aggregateInfluence(recs) {
  const byKey = { tag: {}, card: {}, pool: {} }, edgeTurn = {}, edgeGame = {}, edgeTurnWho = {};
  for (const r of recs) {
    if (!r.inf) continue;
    for (const [c] of CLASSES) for (const [k, v] of Object.entries(r.inf[c])) { const a = (byKey[c][k] ||= [0, 0, 0]); v.forEach((x, i) => { if (x > a[i]) a[i] = x; }); }
    for (const [k, v] of Object.entries(r.inf.edgeTurn)) if (v > (edgeTurn[k] || 0)) edgeTurn[k] = v;
    for (const [k, v] of Object.entries(r.inf.edgeGame)) if (v > (edgeGame[k] || 0)) edgeGame[k] = v;
  }
  const top = {};
  for (const [c] of CLASSES) {
    top[c] = {};
    AXES.forEach((ax, i) => {
      let best = { v: 0, key: '' };
      for (const [k, a] of Object.entries(byKey[c])) if (a[i] > best.v) best = { v: a[i], key: k };
      top[c][ax] = best;
    });
  }
  return { byKey, top, edgeTurn, edgeGame, edgeTurnWho };
}

const ceil1 = (x) => Math.ceil(x * 10) / 10;

export async function checkDesign(N = 3000, s0 = 1, opts = {}) {
  const raw = loadRaw(), data = loadData(raw);
  const M = data.model;
  const t0 = Date.now();
  const mix = await runMix(N, s0, { influence: true });
  const NX = Math.max(30, Math.floor(N / 12));
  const ext = await runBots(NX, s0 + 100000, { influence: true, mech: true });
  const extAll = Object.values(ext).flat();
  const everyone = [...mix, ...extAll];
  const rows = evaluateMechanisms(mix, TARGETS);
  const add = (ok, group, name, value, range, note = '') => rows.push({ ok, group, name, value, range, note });

  // ── 結局：不矛盾、每個 facet 都有句子 ──
  const E = TARGETS.ending;
  const contra = everyone.reduce((a, r) => a + r.ending.contra, 0);
  const bad = everyone.filter((r) => r.ending.contra).slice(0, 3).map((r) => `種子 ${r.seed}（${r.bot}）：${r.ending.ids.join('、')}`).join('；');
  add(contra <= E.contradictions.max, '結局', `結局句子互相矛盾的局數（共 ${everyone.length} 局）`, String(contra), `≤ ${E.contradictions.max}`, bad);
  const missing = everyone.filter((r) => new Set(r.ending.facets).size < data.ending.facets.length).length;
  add(missing === 0, '結局', '缺少某個 facet 的句子的局數（每個結果組合都要有後備句）', String(missing), '0');
  const fb = everyone.filter((r) => r.ending.ids.every((id) => data.ending.sentences.find((s) => s.id === id).fallback)).length / everyone.length;
  add(fb <= E.fallbackOnlyMax, '結局', '整局只用到後備句（沒有任何具體句）的比例', (fb * 100).toFixed(1) + '%', `≤ ${E.fallbackOnlyMax * 100}%`, '太高代表具體的決定鏈句子很少被用到');

  // ── 影響上限（§3.7 第 2 點）──
  const inf = aggregateInfluence(everyone);
  const cap = M.influenceCaps;
  for (const [c, capKey, label] of CLASSES) for (const ax of AXES) {
    const t = inf.top[c][ax], lim = cap[capKey] && cap[capKey][ax];
    add(typeof lim === 'number' && t.v <= lim, '影響上限', `單一${label}對「${ax}」軸的整局影響（最大：${t.key || '—'}）`, t.v.toFixed(1), `≤ ${lim ?? '（未設）'}`, lim ? `使用率 ${(t.v / lim * 100).toFixed(0)}%` : '');
  }
  let edgeWorst = { r: 0, id: '' }, edgeBad = [];
  for (const e of M.edges) if (e.id.startsWith('h:')) {
    const t = inf.edgeTurn[e.id] || 0, g = inf.edgeGame[e.id] || 0;
    edgeWorst = Math.max(t / e.maxTurn, g / e.maxGame) > edgeWorst.r ? { r: Math.max(t / e.maxTurn, g / e.maxGame), id: e.id } : edgeWorst;
    if (t > e.maxTurn) edgeBad.push(`${e.id} 單回合 ${t.toFixed(1)} > ${e.maxTurn}`);
    if (g > e.maxGame) edgeBad.push(`${e.id} 整局 ${g.toFixed(1)} > ${e.maxGame}`);
  }
  add(edgeBad.length === 0, '影響上限', '因果圖每條邊的單回合／整局變動量都在 maxTurn／maxGame 內', edgeBad.length ? `${edgeBad.length} 條超出` : `最高使用率 ${(edgeWorst.r * 100).toFixed(0)}%（${edgeWorst.id}）`, '全部 ≤ 100%', edgeBad.slice(0, 4).join('；'));

  // ── 節奏：每個階段『有固定事件的回合』的比例（由日曆算，不需要玩；M3 計畫 §8 第 11 項）──
  {
    const R = TARGETS.rhythm && TARGETS.rhythm.fixedShareMax, share = fixedShareByStage(data.timeline);
    for (const [stage, max] of Object.entries(R || {})) {
      const o = share[stage];
      if (!o) { add(false, '節奏', `${stage}：固定事件回合的比例`, '這個階段不在日曆裡', `≤ ${max * 100}%`); continue; }
      add(o.share <= max + 1e-9, '節奏', `${stage}：有固定事件的回合 ÷ 回合數（${o.fixed}/${o.turns}）`, (o.share * 100).toFixed(0) + '%', `≤ ${max * 100}%`, '日曆直接算，不是模擬');
    }
  }
  // ── 只看字面的機器人（DESIGN §3.7 第 5 點）──
  for (const [bot, B] of Object.entries(TARGETS.bots || {})) {
    if (bot.startsWith('_')) continue;
    const g = await runBots(B.games ?? 240, s0 + 200000, { bots: [B.baseline, bot] });
    const ax = (rs) => rs.reduce((a, r) => a + getPath(r, B.axis), 0) / rs.length;
    const diff = ax(g[bot]) - ax(g[B.baseline]);
    rows.push({ ok: B.maxAbs != null ? Math.abs(diff) <= B.maxAbs : diff <= B.maxOver, pending: !!B.pendingContentRewrite, group: '字面機器人', name: `${bot} ${B.axisName} − ${B.baseline} ${B.axisName}（各 ${g[bot].length} 局）`, value: (diff >= 0 ? '+' : '') + diff.toFixed(1), range: B.maxAbs != null ? `|差| ≤ ${B.maxAbs}` : `≤ +${B.maxOver}`, note: B.pendingContentRewrite ? '已知未達標（pendingContentRewrite）：內容改寫是下一個里程碑；CI 報告但不擋' : '' });
  }
  // ── 規則 21：情境感知 vs 情境盲（同一套溫暖＋堅定打分；盲的永遠看卡片原本的選項）。差越大＝情境版本越重要 ──
  {
    const g = await runBots(240, s0 + 300000, { bots: ['warmFirm', 'warmFirmBlind'] });
    const ax = (rs) => rs.reduce((a, r) => a + getPath(r, 'ax.0'), 0) / rs.length;
    const diff = ax(g.warmFirm) - ax(g.warmFirmBlind);
    rows.push({ ok: diff >= 0, group: '規則 21', name: `情境感知溫暖＋堅定 親子 − 情境盲（永遠照原本選項）親子（各 ${g.warmFirm.length} 局；感知 ${ax(g.warmFirm).toFixed(1)}、盲 ${ax(g.warmFirmBlind).toFixed(1)}）`, value: (diff >= 0 ? '+' : '') + diff.toFixed(1), range: '≥ 0（越大＝規則 21 越有意義）', note: '' });
  }
  if (opts.calibration) {
    const games = await runBots(200, 1);
    for (const r of evaluateCalibration(games)) add(r.ok, '校準', r.desc, r.value, r.target);
  }
  for (const p of CHECK_PLUGINS) { // 外掛的列接在最後；回傳列陣列，或自己呼叫 ctx.add
    const out = await p.fn({ N, s0, raw, data, TARGETS, mix, ext, everyone, inf, runBots, add });
    if (Array.isArray(out)) rows.push(...out);
  }
  return { rows, mix, ext, everyone, inf, ms: Date.now() - t0, NX, raw, data };
}

/** 量測到的最大值 + 餘裕 → 寫回 data/model.json（單回合／整局、單一標籤／卡片／池、單一選項的靜態名義影響） */
export function writeCaps(res) {
  const model = readModel();
  const head = model.influenceCaps.headroom ?? 1.3;
  const lm = lintModel(res.raw, res.data, res.raw.events.cards);
  for (const e of model.edges) if (e.id.startsWith('h:')) {
    const nominal = lm.stats.staticRaw.edges[e.id] || 0;
    const t = Math.max(res.inf.edgeTurn[e.id] || 0, nominal), g = Math.max(res.inf.edgeGame[e.id] || 0, t);
    e.maxTurn = ceil1(t * head); e.maxGame = ceil1(g * head);
  }
  const caps = { perTag: {}, perCard: {}, perPool: {}, perChoiceStatic: {} };
  for (const [c, key] of CLASSES) for (const ax of AXES) caps[key][ax] = ceil1(res.inf.top[c][ax].v * head);
  for (const ax of AXES) caps.perChoiceStatic[ax] = ceil1(lm.stats.staticRaw.axes[ax] * head);
  Object.assign(model.influenceCaps, caps, { measured: { games: res.everyone.length, perTagMax: Object.fromEntries(AXES.map((a) => [a, +res.inf.top.tag[a].v.toFixed(1)])), perCardMax: Object.fromEntries(AXES.map((a) => [a, +res.inf.top.card[a].v.toFixed(1)])), perPoolMax: Object.fromEntries(AXES.map((a) => [a, +res.inf.top.pool[a].v.toFixed(1)])), staticChoiceMax: Object.fromEntries(AXES.map((a) => [a, +lm.stats.staticRaw.axes[a].toFixed(2)])), note: '量測值（最大）；上限＝量測值×headroom，向上取到 0.1' } });
  writeModel(model);
  return model.influenceCaps;
}

export function printReport(res, N, s0) {
  const { rows } = res;
  console.log(`設計檢驗：真人混合 ${N} 局（種子 ${s0}–${s0 + N - 1}）＋ 校準策略各 ${res.NX} 局，${(res.ms / 1000).toFixed(0)} 秒\n`);
  for (const r of rows) console.log(`${r.ok ? '✓' : r.pending ? '△' : '✗'} [${r.group}] ${r.name}：${r.value}（預期 ${r.range}）${r.note ? '　' + r.note : ''}`);
  const bad = rows.filter((r) => !r.ok && !r.pending), pend = rows.filter((r) => !r.ok && r.pending);
  console.log(`${pend.length ? `\n已知待內容改寫（不擋 CI）：${pend.length} 項 △` : ''}${bad.length ? `\n共 ${bad.length} 項 ✗` : '\n全部在設計範圍內 ✓（不含已知待改寫項）'}`);
  return bad.length;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), flags = args.filter((a) => a.startsWith('--')), nums = args.filter((a) => !a.startsWith('--'));
  const N = parseInt(nums[0] || '3000', 10), s0 = parseInt(nums[1] || '1', 10);
  const res = await checkDesign(N, s0, { calibration: flags.includes('--calibration') });
  if (flags.includes('--write-caps')) {
    // E1 審查：不再把實測最大值回寫成上限（上限永遠等於現況 × 1.3，使用率全是 77%，守不住任何變化）。上限由 50 回合的基準推導：node tools/derive-caps.mjs --write
    if (!flags.includes('--measured-caps-i-know')) { console.error('--write-caps 已停用：影響上限改由 node tools/derive-caps.mjs --write 依 50 回合的量測 × 月數比 × 餘裕推導（E1 審查）。實測值比上限大代表還有問題要修，不是上限要調。'); process.exit(2); }
    const c = writeCaps(res);
    console.log('已把上限寫進 data/model.json：', JSON.stringify({ perTag: c.perTag, perCard: c.perCard, perPool: c.perPool, perChoiceStatic: c.perChoiceStatic }));
    process.exit(0);
  }
  if (flags.includes('--json')) console.log(JSON.stringify(res.rows));
  process.exitCode = printReport(res, N, s0) ? 1 : 0;
}
void BOTS;
