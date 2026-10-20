// 「這一年」生日小卡的內容（M3 B3；DESIGN §6 每年的生日總結）。純函式：不改 st、不抽 st 的亂數、不寫任何東西，所以小卡不會改變任何一局的結果。
// 回傳 { age, events, fact, together }；該回合不是新的一歲就回傳 null。
//   events：過去 12 個月的 hist 裡，變化（hist.d 記下的可見數值變化）最大的最多 3 筆，只給卡片標題與選項文字，不含任何分數；依時間排列。
//   fact：data.yearly.ages[歲數].facts 裡條件（if）通過的事實，用 rngAt(seed, 歲數, 'yearly') 挑一則（同一局同一歲永遠同一則）。
//   together：M3.5 的線上統計（snap.byAge[歲數]）；目前沒有就是 null。
import { rngAt } from './rng.js';
import { buildCtx, evalCond } from './events.js';

export const YEARLY_MAX_EVENTS = 3;

const magnitude = (e) => (e.d ? Object.values(e.d).reduce((s, v) => s + Math.abs(v), 0) : 0);

export function yearSummary(st, data, turn, snap) {
  const tl = data.timeline[turn];
  if (!tl || !tl.newAge) return null;
  const age = Math.floor(tl.ageMonths / 12);
  const Y = data.yearly || {};
  const monthOf = (e) => e.m ?? (data.timeline[e.turn] ? data.timeline[e.turn].ageMonths : -1);
  const limit = Math.max(0, Math.min(YEARLY_MAX_EVENTS, Y.eventsPerYear ?? YEARLY_MAX_EVENTS));
  const events = st.hist
    .map((e, i) => ({ e, i, m: monthOf(e), mag: magnitude(e) }))
    .filter((x) => x.m >= tl.ageMonths - 12 && x.m < tl.ageMonths && x.e.title && x.e.label)
    .sort((a, b) => b.mag - a.mag || b.i - a.i)
    .slice(0, limit)
    .sort((a, b) => a.i - b.i)
    .map((x) => ({ title: x.e.title, label: x.e.label }));
  const facts = (Y.ages && Y.ages[age] && Y.ages[age].facts) || [];
  let ctx = null;
  const ok = (f) => {
    if (!f.if) return true;
    ctx ||= buildCtx(st, tl);
    try { return evalCond(f.if, ctx); } catch { return false; }
  };
  const live = facts.filter(ok);
  const f = live.length ? live[Math.floor(rngAt(st.seed, age, 'yearly') * live.length) % live.length] : null;
  const fact = f ? { id: f.id, kind: f.kind, evidence: f.evidence, text: f.text, source: { who: f.source.who, year: f.source.year } } : null;
  const together = (snap && snap.byAge && snap.byAge[age]) || null;
  return { age, events, fact, together };
}
