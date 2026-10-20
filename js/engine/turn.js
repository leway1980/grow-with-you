// 回合流程：資料整備、日曆（92 回合）、開始／選擇／結束回合。純函式、無 DOM。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) turn.js 的結構（prepareData、startTurn/chooseCard/finishTurn、playToEnd），
// 改為：每回合一張卡、學前節奏較快、固定事件＋延遲後續卡＋兩段式抽卡，並在每回合結束記錄隱藏曲線給結局用。
import { stateRng, rngAt } from './rng.js';
import { setSlotData } from './slots.js';
import { buildCtx, pickFixed, pickDelayed, drawCard, describeCard, applyChoice, applyEffects, rollLoads, fill, cardById, setGates } from './events.js';
import { driftHidden, applyTags } from './tags.js';
import { doseView } from './dose.js';

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
  setGates(raw.tags.gates);
  const events = raw.events;
  // 卡片依「階段 × 池」建索引：每回合只看這個階段的池，不必掃全部卡（500 張時也夠快）。
  const index = {};
  for (const st of raw.tags.stages) index[st] = {};
  for (const c of events.cards) {
    if (c.pool.startsWith('_')) continue;
    for (const st of c.stages || raw.tags.stages) ((index[st] ||= {})[c.pool] ||= []).push(c);
  }
  const data = {
    identities: raw.identities, tags: raw.tags, events, pools: raw.pools.pools, loads: raw.pools.loads || [], calendar: raw.calendar,
    cardIndex: Object.fromEntries(events.cards.map((c) => [c.id, c])), index,
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

/**
 * 開始一個回合：固定事件 → 到期的後續卡 → 抽卡。沒有卡時回傳一句平靜日子的描述。
 * 有固定事件的回合有第二張卡（日常或後續卡）：選完第一張後呼叫 nextCard；劑量表在第二張之後合計。
 */
export function startTurn(st, data) {
  if (st.turn >= data.calendar.playableTurns) { st.ended = true; st.endReason = '待續'; return { ended: true, tl: timelineOf(st, data) }; }
  const tl = data.timeline[st.turn];
  for (const [k, v] of Object.entries(st.openPools)) if (v.until <= st.turn) delete st.openPools[k];
  const ctx = buildCtx(st, tl);
  const r = stateRng(st, 'rngS');
  let card = pickFixed(st, data, tl, ctx), fu = null;
  const twoSlot = !!card;
  if (!card) {
    const d = pickDelayed(st, data, tl, ctx);
    if (d) { card = d.card; fu = d.delay; } else card = drawCard(st, data, ctx, tl, r);
  }
  if (!card) { st.cur = { quiet: true }; return { tl, card: null, quiet: quietLine(st, data, tl, ctx) }; }
  const loads = rollLoads(st, data, ctx);
  st.cur = { cardId: card.id, slot: 0, twoSlot, fu, acc: {}, loads };
  const view = describeCard(card, st, data, tl);
  view.loads = loads.map((l) => fill(l.text, st, ctx, {}));
  return { tl, card: view, raw: card, twoSlot };
}

/**
 * 玩家選擇（idx 是 card.choices 的原始索引）。回傳 { result, dose, more }：
 * more＝true 表示這回合還有第二張卡（用 nextCard 取），此時 dose 為 null；第二張選完後 dose 是兩張卡加情境負荷的合計。
 */
export function chooseCard(st, data, idx) {
  const tl = data.timeline[st.turn];
  const cur = st.cur;
  const card = cardById(data, cur.cardId);
  const r = stateRng(st, 'rngS');
  if (cur.slot === 0) {
    for (const l of cur.loads || []) {
      applyEffects(st, l.effects, cur.acc);
      if (l.tags && l.tags.length) applyTags(st, l.tags, data.tags, { turn: st.turn, stage: tl.stage, ctx: buildCtx(st, tl) }); // 家庭變故也經由標籤改變隱藏數值（唯一的寫入口）
    }
  }
  const out = applyChoice(st, data, card, idx, tl, r, { fu: cur.fu });
  for (const [k, v] of Object.entries(out.acc)) cur.acc[k] = (cur.acc[k] || 0) + v;
  cur.chosen = idx;
  if (cur.twoSlot && cur.slot === 0) {
    const ctx = buildCtx(st, tl);
    const d = pickDelayed(st, data, tl, ctx, card.id);
    const c2 = d ? d.card : drawCard(st, data, ctx, tl, r, card.id);
    if (c2) { cur.next = { id: c2.id, fu: d ? d.delay : null }; return { result: out.result, dose: null, more: true }; }
  }
  return { result: out.result, dose: doseView(cur.acc, st, tl.stage), more: false };
}

/** 固定事件回合的第二張卡 */
export function nextCard(st, data) {
  const tl = data.timeline[st.turn];
  const cur = st.cur;
  if (!cur.next) return null;
  const card = cardById(data, cur.next.id);
  cur.cardId = card.id; cur.slot = 1; cur.fu = cur.next.fu; cur.next = null; cur.chosen = undefined;
  return { tl, card: describeCard(card, st, data, tl), raw: card };
}

/** 每個回合的自然變化：往「這個家庭、這個階段」的常態慢慢回復，並受隱藏數值的長期影響。 */
function drift(st, data, tl) {
  const P = st.parent, C = st.child, f = st.family, h = st.hidden, tp = f.child.temperament;
  const pat = data.identities.patterns[f.pattern];
  const M = data.identities.parentModel;
  const to = (o, k, target, rate) => { o[k] = clamp(o[k] + (target - o[k]) * rate, 0, 100); };
  const school = tl.grade > 0, adhd = f.child.needs.some((n) => n.kind === 'ADHD' && st.turn >= n.onset);
  // 父母：花費會累積。目標 = 常態 − k × 最近花費的指數移動平均，回復速度慢（0.1），所以連續幾回合的付出不會一回合就被洗掉。
  const acc = (st.cur && st.cur.acc) || {};
  const a = 2 / (M.emaTurns + 1);
  // 花費可以是負的（休息那一回合是「還債」），累積的疲勞不會低於 0
  for (const k of ['體力', '耐心']) st.costEMA[k] = Math.max(0, st.costEMA[k] + a * (-(acc[k] || 0) - st.costEMA[k]));
  to(P, '體力', 74 + pat.體力 - M.kBody * st.costEMA.體力, M.recover);
  const load = (tp.活動量 >= 4 ? 3 : 0) + (tp.敏感度 >= 4 ? 3 : 0) + (adhd ? 4 : 0) + (st.flags.等公托候補 && tl.stage === '嬰幼兒' ? 3 : 0);
  to(P, '耐心', 68 - load - (P.體力 < 35 ? 8 : 0) - M.kPatience * st.costEMA.耐心, M.recover);
  to(P, '錢', M.moneyTarget[f.econ], M.moneyRate); // 回歸家境的常態；帳單是偶爾壓下來的情境負荷（pools.json loads），不是單調的扣款
  to(P, '工作表現', st.flags.育嬰留停 && !school ? 52 : 62, 0.12);
  if (f.partner.present) to(P, '夫妻關係', data.identities.partner.startCouple[f.partner.attitude] - (P.耐心 < 30 ? 8 : 0), 0.08);
  // 孩子的可見數值：往「這個家、這個階段」的常態回復，常態會受隱藏數值的長期影響（§3.2 放任的連鎖：沒規則 → 3C 多 → 睡不好 → 成績與同儕往來都吃虧）。
  // 3C 的常態＝階段的基準 + 規範監督與試探度的影響；注意括號：先取基準，再加影響（M1 的運算子優先順序錯誤已修正）。
  const base3c = { 嬰幼兒: 6, 幼兒園: 20, 國小低: 30, 國小中高: 42 }[tl.stage] ?? 45;
  to(C, '3C時間', base3c + (50 - h.規範監督) * 0.25 + (h.試探度 - 25) * 0.12, 0.2);
  to(C, '睡眠', 68 - Math.max(0, C['3C時間'] - 40) * 0.3 + (h.規則一致性 - 50) * 0.06, 0.3);
  to(C, '心情', 62 + (C.睡眠 - 60) * 0.1 - Math.max(0, C['3C時間'] - 60) * 0.1 + (h.安全感 - 55) * 0.1 + (h.內在穩定 - 50) * 0.08, 0.35);
  if (tl.stage !== '嬰幼兒') to(C, '同學往來', 50 + f.child.talents.人際 * 6 + (C.心情 - 60) * 0.2 + (h.內在穩定 - 50) * 0.1 - (h.試探度 - 25) * 0.3, 0.15);
  if (school) {
    // 壓力有時候「有用」（§3.1：盯成績在國小常常真的把分數撐住）：不敏感的孩子，期待壓力與替他做主會推高成績與作業；敏感的孩子反過來被拖累
    const press = (h.期待壓力 - 30) * (tp.敏感度 <= 2 ? 0.35 : tp.敏感度 >= 4 ? -0.12 : 0.12) + (h.替他做主 - 30) * (tp.敏感度 <= 3 ? 0.12 : -0.04);
    to(C, '成績', 50 + (f.child.talents.國語 + f.child.talents.數學) * 3 + press + (h.家庭學習環境 - 45) * 0.25 + (h.閱讀習慣 - 40) * 0.2 + (h.自我效能 - 50) * 0.2 + (C.睡眠 - 60) * 0.1 - Math.max(0, C['3C時間'] - 50) * 0.1 - (adhd ? 3 : 0), 0.12);
    to(C, '作業', 55 + press * 0.8 + (h.自理與責任 - 40) * 0.3 + (h.規範監督 - 50) * 0.15 + (C.睡眠 - 60) * 0.05 - (adhd ? 6 : 0), 0.25);
  }
}

export function finishTurn(st, data) {
  const tl = data.timeline[st.turn];
  drift(st, data, tl);
  driftHidden(st, data.tags);
  const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  st.curves.push({ t: st.turn, ...r1(st.hidden) });
  st.vcurves.push({ t: st.turn, ...r1(st.parent), ...r1(st.child) });
  st.cur = null;
  st.turn++;
  if (st.turn >= data.calendar.playableTurns) { st.ended = true; st.endReason = '待續'; }
  return { tl: data.timeline[Math.min(st.turn, data.timeline.length - 1)], ended: st.ended };
}

/** 玩完一個回合（含固定事件回合的第二張卡）。policy.choose(st, view, raw, data) 回傳選項的原始索引 i。 */
export function playTurn(st, data, policy) {
  const res = startTurn(st, data);
  if (res.ended) return res;
  if (res.card) {
    let view = res.card, raw = res.raw;
    for (let guard = 0; guard < 3; guard++) {
      const out = chooseCard(st, data, policy.choose(st, view, raw, data));
      if (!out.more) break;
      ({ card: view, raw } = nextCard(st, data));
    }
  }
  finishTurn(st, data);
  return res;
}

/** 從目前狀態一路玩到結局。 */
export function playToEnd(st, data, policy) {
  let guard = 0;
  while (!st.ended && guard++ < 200) playTurn(st, data, policy);
  return st;
}
