// 控制器：時間流動、事件暫停、存檔，把引擎和畫面接起來。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) main.js 的結構（安全儲存、?seed=、暫停／加速、讓他自己過、資料一次載入），
// 改為一回合一張卡：選擇 → 劑量表 → 時間流動 → 下一回合；沒有線上統計。
import { mergeData, manifestFiles } from './engine/dataload.js';
import { prepareData, playableEnd, startTurn, chooseCard, nextCard, finishTurn } from './engine/turn.js';
import { newState, writeSave, readSave, store } from './engine/state.js';
import { buildEnding } from './engine/ending.js';
import { selfChoice, playRestAuto } from './engine/auto.js';
import { meterView } from './engine/dose.js';
import { yearSummary } from './engine/yearly.js';
import { sceneSpec, sceneSVG, albumSpecs } from './engine/scene.js';
import { introSections, rollRole } from './intro.js';
import * as ui from './ui.js';

const root = document.getElementById('app');
const params = new URLSearchParams(location.search);
const TURN_MS = Math.max(100, parseInt(params.get('ms') || '3500', 10) || 3500); // 1× 時回合之間的時間流動約 3.5 秒
const seedParam = () => { const v = parseInt(params.get('seed') || '', 10); return Number.isFinite(v) ? v >>> 0 : null; };
const PREVIEW = params.get('preview') === '1'; // 預覽版（開發中）：玩到 18 歲離家，用 previewTurns 當終點
const newSeed = () => (Math.floor(Math.random() * 4294967296) >>> 0) || 1;

let data, st = null, refs = null, speed = 1, auto = false, phase = 'idle', curView = null;
let timer = null, pending = null, tickTimer = null;
let yearlyShown = -1, seenFacts = []; // 「這一年」小卡：已經顯示過的回合（不進存檔，重新整理後在 st.cur 之前才會再出現一次）；這一局看過的小知識（結局用）
const SKIP_KEY = 'gwy.prefs.skipYearly'; // 偏好設定放 localStorage，不進存檔；讀寫都包 try/catch（無痕視窗、被封鎖時照常運作）
const skipYearly = () => { try { return localStorage.getItem(SKIP_KEY) === '1'; } catch { return false; } };
const setSkipYearly = () => { try { localStorage.setItem(SKIP_KEY, '1'); } catch { /* 存不下就只跳過這一次 */ } };

async function loadData() {
  const get = async (f) => { const r = await fetch(`data/${f}`); if (!r.ok) throw new Error(`載入 ${f} 失敗 (${r.status})`); return r.json(); };
  const manifest = await get('manifest.json');
  const names = manifestFiles(manifest);
  const [identities, tags, pools, calendar, model, ending, habits, ...rest] = await Promise.all(['identities.json', 'tags.json', 'pools.json', 'calendar.json', 'model.json', 'ending.json', 'habits.json', ...names].map(get));
  const m = mergeData(manifest, Object.fromEntries(names.map((f, i) => [f, rest[i]])));
  if (m.problems.length) throw new Error('資料檔有問題：' + m.problems.join('；'));
  data = prepareData({ identities, tags, model, ending, habits, events: m.events, pools, slots: m.slots, calendar });
  try { data.yearly = await get('yearly.json'); } catch { data.yearly = null; } // 小卡的資料缺了不影響遊戲：沒有『你知道嗎』，其他照常
  if (PREVIEW) data.preview = true;
}

/* ───── 排程：暫停（速度 0）時不走；改速度時重新排 ───── */
function clearTimers() { clearTimeout(timer); timer = null; pending = null; clearInterval(tickTimer); tickTimer = null; }
function schedule(ms, fn) {
  clearTimeout(timer); pending = { ms, fn };
  if (speed > 0) timer = setTimeout(() => { const f = pending && pending.fn; pending = null; timer = null; if (f) f(); }, ms / speed);
}
function setSpeed(v) {
  speed = v; if (refs) ui.setSpeedButtons(refs, speed);
  clearTimeout(timer); timer = null;
  if (speed > 0 && pending) schedule(pending.ms, pending.fn);
}
function toggleAuto() {
  auto = !auto; ui.setAutoButton(refs, auto);
  if (auto && speed === 0) setSpeed(1);
  if (auto) { if (phase === 'card' && st.cur) autoPick(); else if (phase === 'result' || phase === 'quiet') schedule(1200, endTurn); else if (phase === 'yearly') schedule(3000, () => { if (phase === 'yearly') { clearTimers(); beginTurn(); } }); }
  else if (pending && (phase === 'card' || phase === 'result' || phase === 'quiet' || phase === 'yearly')) { clearTimeout(timer); timer = null; pending = null; }
}

/* ───── 畫面流程 ───── */
function showTitle() {
  clearTimers(); phase = 'idle'; st = null;
  const sv = readSave(data);
  ui.renderTitle(root, { hasSave: !!sv, preview: PREVIEW, previewHref: previewHref(), onNew: () => showIntro(seedParam() ?? newSeed()), onContinue: resume });
}

// 標題頁的預覽開關：開著就連回一般版，關著就帶 ?preview=1（保留 ?seed= 等其他參數）
function previewHref() {
  const p = new URLSearchParams(location.search);
  if (PREVIEW) p.delete('preview'); else p.set('preview', '1');
  const q = p.toString();
  return (location.pathname || '') + (q ? '?' + q : '');
}
const newOpts = (o) => ({ ...o, preview: PREVIEW });

// 開場：爸爸或媽媽也是骰子（只由種子決定）；UI 一律從出生開始（引擎的國小起點留給測試與工具）
function showIntro(seed) {
  const role = rollRole(seed);
  const draft = newState(seed, data, newOpts({ role, startMode: 'birth' }));
  const tl = data.timeline[draft.turn] || data.timeline[0];
  ui.renderIntro(root, {
    sections: introSections(draft.family, role), role,
    portrait: sceneSVG(sceneSpec(draft, data, tl, { portrait: true })),
    flavour: `接下來要陪${draft.family.child.pronoun}長大了。`,
    seed,
    onStart: () => startGame(newState(seed, data, newOpts({ role, startMode: 'birth' }))),
  });
}

function startGame(state) {
  clearTimers(); st = state; auto = false; speed = 1; yearlyShown = -1; seenFacts = [];
  buildGame();
  ui.appendLog(refs, `${st.family.child.given}出生了。你是${st.role}，從現在開始陪著${st.family.child.pronoun}。`);
  if (st.startMode === 'elementary') ui.appendLog(refs, `${st.family.child.given}要上國小了。`);
  writeSave(st);
  beginTurn();
}
function resume() {
  const s = readSave(data);
  if (!s) { showTitle(); return; }
  clearTimers(); st = s; auto = false; speed = 1; yearlyShown = -1; seenFacts = [];
  buildGame();
  ui.appendLog(refs, '（接續上次的存檔）');
  beginTurn();
}
function buildGame() {
  refs = ui.renderGame(root, { speed, onSpeed: setSpeed, onAuto: toggleAuto, onSkipEnd: skipToEnd, onQuit: showTitle });
  ui.setAutoButton(refs, auto);
}
const tlNow = () => data.timeline[Math.min(st.turn, data.timeline.length - 1)];
const endTurnIdx = () => playableEnd(data, { preview: !!(data.preview || st.preview) });
const progress = () => st.turn / endTurnIdx();

function beginTurn() {
  clearTimers();
  if (st.ended) { showEnding(); return; }
  if (maybeYearly()) return;
  const res = startTurn(st, data);
  if (res.ended) { showEnding(); return; }
  const tl = res.tl;
  ui.setHeader(refs, tl.label, progress());
  ui.renderMeters(refs, meterView(st, tl.stage));
  ui.setScene(refs, sceneSpec(st, data, tl));
  if (res.card) {
    showCurrentCard(res.card, tl);
  } else {
    phase = 'quiet'; curView = null;
    ui.showQuiet(refs, tl.label, res.quiet, endTurn, res);
    ui.appendLog(refs, res.quiet);
    if (auto) schedule(1400, endTurn);
  }
}
// 新的一歲的第一回合，在回合開始前先放一張「這一年」小卡（純顯示，不改任何狀態）。回傳 true 表示小卡正在顯示、由它接手往下走
function maybeYearly() {
  const tl = tlNow();
  if (!tl.newAge || st.cur || yearlyShown === st.turn || st.turn >= endTurnIdx() || skipYearly()) return false;
  const y = yearSummary(st, data, st.turn);
  if (!y) return false;
  yearlyShown = st.turn; phase = 'yearly'; curView = null;
  if (y.fact) seenFacts.push({ age: y.age, text: y.fact.text, who: y.fact.source.who, year: y.fact.source.year });
  ui.setHeader(refs, tl.label, progress());
  ui.renderMeters(refs, meterView(st, tl.stage));
  ui.setScene(refs, sceneSpec(st, data, tl));
  const go = () => { if (phase !== 'yearly') return; clearTimers(); beginTurn(); };
  ui.showYearly(refs, { name: st.family.child.given, y, auto }, go, () => { setSkipYearly(); go(); });
  ui.appendLog(refs, `${st.family.child.given} ${y.age} 歲了。`);
  if (auto) schedule(3000, go);
  return true;
}
function showCurrentCard(view, tl) {
  phase = 'card'; curView = view;
  ui.showCard(refs, view, `${tl.label}${tl.months ? '（' + tl.months + '）' : ''}`, (c) => pick(c));
  if (auto) autoPick();
}
function autoPick() {
  const view = curView;
  if (!view) return;
  schedule(1200, () => { const i = selfChoice(st, view); const c = view.choices.find((x) => x.i === i); ui.markPicked(refs, c.pos); schedule(500, () => pick(c)); });
}

// c 是畫面上的選項（含引擎用的原始索引 i；原始索引只存在閉包裡，不會寫進 DOM）
function pick(c) {
  if (phase !== 'card') return;
  clearTimers();
  const tl = tlNow();
  const view = curView;
  const out = chooseCard(st, data, c.i);
  phase = 'result';
  ui.renderMeters(refs, meterView(st, tl.stage));
  ui.setScene(refs, sceneSpec(st, data, tl));
  const next = out.more ? continueTurn : endTurn;
  ui.showResult(refs, { title: view.title, label: c.label, result: out.result, dose: out.dose, note: out.note }, next, out.more ? '繼續（還有一件事）' : '繼續');
  ui.appendLog(refs, `${tl.label}・${view.title}：${c.label}`);
  if (auto) schedule(2400, next);
}
// 有固定事件的回合還有第二張卡
function continueTurn() {
  if (phase !== 'result') return;
  clearTimers();
  const nx = nextCard(st, data);
  if (!nx) { endTurn(); return; }
  showCurrentCard(nx.card, nx.tl);
}

function endTurn() {
  if (phase !== 'result' && phase !== 'quiet') return;
  clearTimers();
  const from = tlNow().label;
  finishTurn(st, data);
  if (st.ended) { showEnding(); return; }
  writeSave(st);
  startTime(from);
}
function startTime(from) {
  phase = 'time';
  const to = tlNow();
  ui.setHeader(refs, to.label, progress());
  ui.showTime(refs, { from, to: to.label }, () => { clearTimers(); beginTurn(); });
  let frac = 0;
  tickTimer = setInterval(() => {
    if (speed === 0) return;
    frac += (100 * speed) / TURN_MS;
    ui.setTick(refs, Math.min(1, frac));
    if (frac >= 1) { clearTimers(); beginTurn(); }
  }, 100);
}

function skipToEnd() {
  if (!st || phase === 'ended') return;
  if (!confirm('剩下的日子讓他們自己過，直接看結局？')) return;
  clearTimers();
  if (st.cur && !st.cur.quiet && phase === 'card') st.cur = null;
  playRestAuto(st, data);
  showEnding();
}

function showEnding() {
  clearTimers(); phase = 'ended';
  const e = buildEnding(st, data);
  store.del();
  const seed = st.seed, role = st.role, mode = st.startMode;
  const last = data.timeline[Math.max(0, Math.min(st.turn, endTurnIdx()) - 1)]; // 最後一個玩過的回合：一般版是國小六年級，預覽版是離家那天
  const portrait = sceneSVG(sceneSpec(st, data, last, { portrait: true }));
  const album = albumSpecs(st, data).map((a) => ({ label: a.label, svg: sceneSVG(a) }));
  ui.renderEnding(root, e, {
    seed, portrait, album, yearly: seenFacts,
    onSame: () => { startGame(newState(seed, data, newOpts({ role, startMode: mode }))); },
    onNew: () => showIntro(newSeed()),
  });
  window.scrollTo(0, 0);
}

/* ───── 啟動 ───── */
(async function boot() {
  try { await loadData(); } catch (err) {
    root.textContent = '載入失敗：' + err.message + '。請用 http 伺服器開啟（例如 python3 -m http.server），不要直接雙擊 index.html。';
    return;
  }
  showTitle();
})();

// 除錯用的入口只在網址帶 ?debug=1 時才有；一般玩家的頁面上不會有任何可以看到內部狀態的東西
if (params.get('debug') === '1') window.__gwy = { get state() { return st; }, get phase() { return phase; }, get auto() { return auto; } };
