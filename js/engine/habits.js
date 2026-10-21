// 習慣（M3 B2；DESIGN §4.34、§6『木已成舟』；資料在 data/habits.json）。純函式、無 DOM。
// 國中以後見面的時間少了：第一個國中回合偵測『這個家過去最常用的做法』（detectHabits），之後每個國中、高中回合
// 自動帶入其中一個（autoHabit），畫面上只多一句話。要改變，玩家得在『這次不一樣』這類卡片上連續選別的做法（onHabitChoice）。
// 隱藏數值仍然只經由 tags.js 的 applyTags 改變；自動套用的紀錄只寫 st.autoLog，不進 hist（keyMoments 與模擬的卡片查詢不受影響）。
import { rngAt } from './rng.js';
import { evalCond, fill, setHabitHook } from './events.js';
import { applyTags } from './tags.js';
import { cardDoseK } from './timescale.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const stageAt = (data, turn) => (data.timeline[Math.min(turn, data.timeline.length - 1)] || {}).stage;
export const mixedName = (data) => (data.habits && data.habits.mixedPattern) || '混合';

/** 這張卡屬於哪個習慣家族（沒有就是 undefined） */
export const familyOf = (data, cardId) => (data.cardIndex[cardId] || {}).habit;

/**
 * 玩家在國小以前（lookback 有列的階段）、這個家族的卡片上選過的選項：
 * 回傳 { total, byPattern:{模式:票重}, tagW:{標籤:票重} }。每個選項一張票（票重＝lookback[選的當時的階段]），投給它的標籤所在的模式；
 * 同時落在兩個模式就平分。標籤的票重＝選了含該標籤的選項的票重總和（規則 18 例外的『選過、票重 ≥ minWeight』看這個）。
 */
export function chosenWeights(st, data, family) {
  const cfg = data.habits.families[family], LB = data.habits.lookback;
  const out = { total: 0, byPattern: {}, tagW: {} };
  for (const h of st.hist) {
    if (familyOf(data, h.card) !== family) continue;
    const w = LB[stageAt(data, h.turn)];
    if (!w) continue;
    out.total += w;
    for (const t of h.tags || []) out.tagW[t] = (out.tagW[t] || 0) + w;
    const hit = Object.entries(cfg.patterns).filter(([, p]) => p.tags.some((t) => (h.tags || []).includes(t))).map(([n]) => n);
    for (const n of hit) out.byPattern[n] = (out.byPattern[n] || 0) + w / hit.length;
  }
  return out;
}

/** 國中以後、這個家族的卡片上選過含某標籤的選項幾次（換習慣的玩家用：連續選了 shiftAt 次） */
function laterPicks(st, data, family, tag) {
  let n = 0;
  for (const h of st.hist) {
    const s = stageAt(data, h.turn);
    if (familyOf(data, h.card) === family && (s === '國中' || s === '高中') && (h.tags || []).includes(tag)) n++;
  }
  return n;
}

const newEntry = (data, pattern, extra = {}) => ({ pattern, tags: [], shift: { n: 0, to: '' }, flipped: false, flips: 0, ...extra });

/**
 * 偵測：回傳 st.habits（每個家族一筆）。已經偵測過就什麼都不做（所以重讀存檔、重複呼叫都安全）。
 * 贏家要票重 ≥ minWeight 且占全部票重 ≥ dominance，而且贏家的標籤裡至少有一個『自己的票重』≥ minWeight（規則 18 的例外）；否則是混合。
 */
export function detectHabits(st, data) {
  const cfg = data.habits;
  if (!cfg) return null;
  const mixed = mixedName(data);
  for (const [family, fam] of Object.entries(cfg.families)) {
    if (st.habits[family]) continue;
    const cw = chosenWeights(st, data, family);
    let best = null;
    for (const name of Object.keys(fam.patterns)) { // 平手時取先列的（決定性）
      const v = cw.byPattern[name] || 0;
      if (!best || v > best.v + 1e-9) best = { name, v };
    }
    const share = cw.total > 0 && best ? best.v / cw.total : 0;
    const tags = best ? fam.patterns[best.name].tags.filter((t) => (cw.tagW[t] || 0) >= fam.minWeight - 1e-9) : [];
    const ok = best && best.v >= fam.minWeight - 1e-9 && share >= cfg.dominance - 1e-9 && tags.length > 0;
    st.habits[family] = newEntry(data, ok ? best.name : mixed, { tags: ok ? tags : [], share: Math.round(share * 1000) / 1000, weight: Math.round(cw.total * 100) / 100 });
  }
  return st.habits;
}

/** 規則 18 的例外：自動套用的標籤必須是這位玩家選過、票重 ≥ minWeight 的標籤（換過習慣的，改看國中以後連續選了 shiftAt 次的標籤）。違反就丟錯。 */
export function assertAppliedSubset(st, data, family, tags) {
  const fam = data.habits.families[family], h = st.habits[family], cw = chosenWeights(st, data, family);
  for (const t of tags) {
    const early = (cw.tagW[t] || 0) >= fam.minWeight - 1e-9;
    const later = h && h.flipped && (h.flipTags || []).includes(t) && laterPicks(st, data, family, t) >= (data.habits.shiftAt[stageAt(data, st.turn)] || 2);
    if (!early && !later) throw new Error(`習慣自動套用的標籤「${t}」不是玩家在「${family}」選過、票重 ≥ ${fam.minWeight} 的標籤（規則 18 的例外只限於玩家自己選過的）`);
  }
}

const lineOf = (def, ctx) => {
  for (const v of def.lineIf || []) if (evalCond(v.if, ctx)) return v.value;
  return def.line;
};

/**
 * 每個國中、高中回合的自動套用。skipFamilies＝這個回合出現的卡片所屬的家族（同家族的卡出現就跳過，不重複算）。
 * 回傳 { line, family, pattern } 或 null。挑選：非混合且 auto 的家族輪流（最久沒被帶入的先；平手用 rngAt）；
 * 都是混合時，只顯示中性的一句話、不套標籤。
 */
export function autoHabit(st, data, tl, ctx, skipFamilies = new Set()) {
  const cfg = data.habits;
  if (!cfg || (tl.stage !== '國中' && tl.stage !== '高中') || st.flags.國中_住宿) return null;
  detectHabits(st, data); // 從存檔中途接上的局也安全
  const auto = Object.entries(cfg.families).filter(([, f]) => f.auto);
  const mixed = mixedName(data);
  const live = auto.filter(([n]) => st.habits[n].pattern !== mixed && st.habits[n].tags.length && !skipFamilies.has(n));
  const last = (n) => { for (let i = st.autoLog.length - 1; i >= 0; i--) if (st.autoLog[i].family === n && st.autoLog[i].tags.length) return st.autoLog[i].turn; return -1; };
  let pick = null;
  if (live.length) {
    const lo = Math.min(...live.map(([n]) => last(n)));
    const tie = live.filter(([n]) => last(n) === lo);
    pick = tie[Math.floor(rngAt(st.seed, st.turn, 'habit_auto') * tie.length) % tie.length];
  } else {
    const calm = auto.filter(([n]) => !skipFamilies.has(n) && st.habits[n].pattern === mixed);
    if (!calm.length || auto.some(([n]) => st.habits[n].pattern !== mixed)) return null; // 有非混合的家族但這回合被跳過 → 不補中性句
    pick = calm[Math.floor(rngAt(st.seed, st.turn, 'habit_auto') * calm.length) % calm.length];
  }
  const [family, fam] = pick;
  const h = st.habits[family];
  const def = h.pattern === mixed ? fam.mixed : fam.patterns[h.pattern];
  const line = cfg.prefix + fill(lineOf(def, ctx), st, ctx, {});
  let abs = 0;
  if (h.pattern !== mixed) {
    assertAppliedSubset(st, data, family, h.tags);
    const refK = cardDoseK(data.model, tl.span ?? 2, { scale: true }), k = cfg.scale[tl.stage] * refK; // refK：參考劑量的基準（回合長度），不含習慣的階段 scale
    const { deltas } = applyTags(st, h.tags, data.tags, { turn: st.turn, months: tl.ageMonths, span: tl.span ?? 2, scale: k, refK, stage: tl.stage, ctx, approach: false, initiate: false, screen: !!fam.screen }); // screen：手機規則算在螢幕情境裡（DESIGN §4.39）
    abs = sum(Object.values(deltas).map(Math.abs));
  }
  st.autoLog.push({ turn: st.turn, family, pattern: h.pattern, tags: h.pattern === mixed ? [] : [...h.tags], line, abs: Math.round(abs * 1000) / 1000 });
  return { line, family, pattern: h.pattern };
}

/**
 * 選項的 habitPattern 掛鉤（events.js setHabitHook）：選和目前不同的模式，連續 shiftAt 次翻過去；選回目前的模式，進度歸零（還沒翻過的話）。
 * 『連續』的意思：進度只算同一個目標模式；中途改選別的目標，從 1 重新算。
 * 翻過去之後 shift.n 維持在 shiftAt（孩子的回應已經鬆動，結果文字讀 習慣改變_<家族> ≥ 1），直到玩家選了和目前不同的模式。
 */
export function onHabitChoice(st, data, hp, { tl, choice }) {
  const cfg = data.habits;
  if (!cfg) return;
  const fam = cfg.families[hp.family];
  if (!fam || !fam.patterns[hp.pattern]) throw new Error(`habitPattern 不存在：${hp.family}／${hp.pattern}`);
  const h = (st.habits[hp.family] ||= newEntry(data, mixedName(data)));
  const need = cfg.shiftAt[tl.stage] || 2;
  if (h.pattern === hp.pattern) { if (!h.flipped) h.shift = { n: 0, to: '' }; return; }
  h.shift = h.shift && h.shift.to === hp.pattern ? { n: h.shift.n + 1, to: hp.pattern } : { n: 1, to: hp.pattern };
  if (h.shift.n >= need) {
    const now = choice.tags || [];
    const flipTags = fam.patterns[hp.pattern].tags.filter((t) => laterPicks(st, data, hp.family, t) + (now.includes(t) ? 1 : 0) >= need); // 這次的選擇還沒進 hist
    Object.assign(h, { pattern: hp.pattern, tags: flipTags, flipTags, flipped: true, flips: (h.flips || 0) + 1, shift: { n: need, to: '' } });
  }
}
setHabitHook(onHabitChoice);

/** 第一個國中回合的一次性說明（只在偵測剛發生的那個回合給） */
export const explainerOf = (data) => (data.habits ? data.habits.explainer : '');
