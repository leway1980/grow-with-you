// 回合流程：資料整備、日曆（92 回合）、開始／選擇／結束回合。純函式、無 DOM。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) turn.js 的結構（prepareData、startTurn/chooseCard/finishTurn、playToEnd），
// 改為：每回合一張卡、學前節奏較快、固定事件＋延遲後續卡＋兩段式抽卡，並在每回合結束記錄隱藏曲線給結局用。
import { stateRng, rngAt } from './rng.js';
import { setSlotData } from './slots.js';
import { buildCtx, pickFixed, pickDelayed, drawCard, describeCard, applyChoice, fill, cardById } from './events.js';
import { recomputeDerived } from './tags.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/* ───────────── 日曆 ───────────── */
const ZH = ['零', '一', '二', '三', '四', '五', '六'];
export const gradeName = (g) => (g <= 6 ? `國小${ZH[g]}年級` : g <= 9 ? `國中${ZH[g - 6]}年級` : `高${ZH[g - 9]}`);
export function ageLabel(m) {
  if (m === 0) return '剛出生';
  if (m < 12) return `${m} 個月`;
  const y = Math.floor(m / 12), mm = m % 12;
  return mm ? `${y} 歲 ${mm} 個月` : `${y} 歲`;
}

export function buildTimeline(cal) {
  const tl = [];
  for (const s of cal.stages) {
    if (s.turns) {
      for (let i = 0; i < s.turns; i++) {
        const ageMonths = s.startMonths + i * s.stepMonths;
        tl.push({ turn: tl.length, stage: s.id, ageMonths, grade: 0, seg: -1, vacation: false, month: null, label: ageLabel(ageMonths), fixed: [] });
      }
    } else {
      for (const g of s.grades) {
        cal.segments.forEach((seg, k) => {
          const ageMonths = 72 + (g - 1) * 12 + k * 2;
          tl.push({ turn: tl.length, stage: s.id, ageMonths, grade: g, seg: k, vacation: seg.vacation, month: seg.month, label: `${gradeName(g)}・${seg.name}`, months: seg.months, fixed: [] });
        });
      }
    }
  }
  if (tl.length !== cal.totalTurns) throw new Error(`日曆回合數不對：${tl.length} ≠ ${cal.totalTurns}`);
  for (const f of cal.fixed) tl[f.turn].fixed.push(f.event);
  for (const f of cal.schoolFixed) for (const t of tl) if (t.grade && f.grade.includes(t.grade) && t.seg === f.seg) t.fixed.push(f.event);
  return tl;
}

export function prepareData(raw) {
  setSlotData(raw.slots);
  const events = raw.events;
  const data = {
    identities: raw.identities, tags: raw.tags, events, pools: raw.pools.pools, calendar: raw.calendar,
    cardIndex: Object.fromEntries(events.cards.map((c) => [c.id, c])),
    timeline: buildTimeline(raw.calendar),
  };
  return data;
}
export const timelineOf = (st, data) => data.timeline[Math.min(st.turn, data.timeline.length - 1)];

/* ───────────── 回合 ───────────── */
function quietLine(st, data, tl, ctx) {
  const list = data.calendar.flavor[tl.stage] || data.calendar.flavor['國小中高'];
  const s = list[Math.floor(rngAt(st.seed, st.turn, 'flavor') * list.length)];
  return fill(s, st, ctx, {});
}

/** 開始一個回合：固定事件 → 到期的後續卡 → 抽卡。沒有卡時回傳一句平靜日子的描述。 */
export function startTurn(st, data) {
  if (st.turn >= data.calendar.playableTurns) { st.ended = true; st.endReason = '待續'; return { ended: true, tl: timelineOf(st, data) }; }
  const tl = data.timeline[st.turn];
  for (const [k, v] of Object.entries(st.openPools)) if (v.until <= st.turn) delete st.openPools[k];
  const ctx = buildCtx(st, tl);
  const r = stateRng(st, 'rngS');
  const card = pickFixed(st, data, tl, ctx) || pickDelayed(st, data, tl, ctx) || drawCard(st, data, ctx, tl, r);
  if (!card) { st.cur = { quiet: true }; return { tl, card: null, quiet: quietLine(st, data, tl, ctx) }; }
  st.cur = { cardId: card.id };
  return { tl, card: describeCard(card, st, buildCtx(st, tl, { topic: card.topic })), raw: card };
}

/** 玩家選擇（idx 是 card.choices 的原始索引）。回傳 { result, dose }。 */
export function chooseCard(st, data, idx) {
  const tl = data.timeline[st.turn];
  const card = cardById(data, st.cur.cardId);
  const r = stateRng(st, 'rngS');
  const out = applyChoice(st, data, card, idx, tl, r);
  st.cur.chosen = idx;
  return out;
}

/** 每個回合的自然變化：往「這個家庭、這個階段」的常態慢慢回復，並受隱藏數值的長期影響。 */
function drift(st, data, tl) {
  const P = st.parent, C = st.child, f = st.family, h = st.hidden, tp = f.child.temperament;
  const pat = data.identities.patterns[f.pattern];
  const to = (o, k, target, rate) => { o[k] = clamp(o[k] + (target - o[k]) * rate, 0, 100); };
  const school = tl.grade > 0, adhd = f.child.needs.some((n) => n.kind === 'ADHD' && st.turn >= n.onset);
  // 父母
  to(P, '體力', 74 + pat.體力, 0.3);
  const load = (tp.活動量 >= 4 ? 3 : 0) + (tp.敏感度 >= 4 ? 3 : 0) + (adhd ? 4 : 0) + (st.flags.等公托候補 && tl.stage === '嬰幼兒' ? 3 : 0);
  to(P, '耐心', 68 - load - (P.體力 < 35 ? 8 : 0), 0.3);
  P.錢 = clamp(P.錢 + { 寬裕: 0.8, 小康: 0, 吃緊: -1.2 }[f.econ] + (st.vars.托育方式 === '送托' && !school ? -0.6 : 0), 0, 100);
  to(P, '工作表現', st.flags.育嬰留停 && !school ? 52 : 62, 0.12);
  if (f.partner.present) to(P, '夫妻關係', data.identities.partner.startCouple[f.partner.attitude] - (P.耐心 < 30 ? 8 : 0), 0.08);
  // 孩子
  to(C, '3C時間', { 嬰幼兒: 6, 幼兒園: 20, 國小低: 30, 國小中高: 42 }[tl.stage] ?? 45 + (50 - h.規範監督) * 0.25, 0.2);
  to(C, '睡眠', 68 - Math.max(0, C['3C時間'] - 40) * 0.3, 0.3);
  to(C, '心情', 62 + (C.睡眠 - 60) * 0.1 - Math.max(0, C['3C時間'] - 60) * 0.1 + (h.安全感 - 55) * 0.1, 0.35);
  if (tl.stage !== '嬰幼兒') to(C, '同學往來', 50 + f.child.talents.人際 * 6 + (C.心情 - 60) * 0.2, 0.15);
  if (school) {
    to(C, '成績', 50 + (f.child.talents.國語 + f.child.talents.數學) * 3 + (h.家庭學習環境 - 45) * 0.25 + (h.閱讀習慣 - 40) * 0.2 + (C.睡眠 - 60) * 0.1 - Math.max(0, C['3C時間'] - 50) * 0.1 - (adhd ? 3 : 0), 0.12);
    to(C, '作業', 55 + (h.自理與責任 - 40) * 0.3 + (h.規範監督 - 50) * 0.15 + (C.睡眠 - 60) * 0.05 - (adhd ? 6 : 0), 0.25);
  }
}

export function finishTurn(st, data) {
  const tl = data.timeline[st.turn];
  drift(st, data, tl);
  recomputeDerived(st, data.tags);
  const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  st.curves.push({ t: st.turn, ...r1(st.hidden) });
  st.vcurves.push({ t: st.turn, ...r1(st.parent), ...r1(st.child) });
  st.cur = null;
  st.turn++;
  if (st.turn >= data.calendar.playableTurns) { st.ended = true; st.endReason = '待續'; }
  return { tl: data.timeline[Math.min(st.turn, data.timeline.length - 1)], ended: st.ended };
}

/** 從目前狀態一路玩到結局。policy.choose(st, view, raw, data) 回傳選項的原始索引 i。 */
export function playToEnd(st, data, policy) {
  let guard = 0;
  while (!st.ended && guard++ < 200) {
    const res = startTurn(st, data);
    if (res.ended) break;
    if (res.card) chooseCard(st, data, policy.choose(st, res.card, res.raw, data));
    finishTurn(st, data);
  }
  return st;
}
