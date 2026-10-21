// 回合流程：資料整備、日曆（v2 schema）、開始／選擇／結束回合。純函式、無 DOM。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) turn.js 的結構（prepareData、startTurn/chooseCard/finishTurn、playToEnd），
// 改為：每回合一張卡、學前節奏較快、固定事件＋延遲後續卡＋兩段式抽卡，並在每回合結束記錄隱藏曲線給結局用。
import { stateRng, rngAt } from './rng.js';
import { setSlotData } from './slots.js';
import { buildCtx, passes, pickFixed, pickDelayed, drawCard, describeCard, applyChoice, applyEffects, rollLoads, fill, cardById, setGates } from './events.js';
import { driftHidden, learnFactor } from './tags.js';
import { detectHabits, autoHabit, explainerOf, familyOf } from './habits.js';
import { doseView } from './dose.js';
import { setModel } from './model.js';
import { setEnding } from './ending.js';
import { syncClassroom, driftClassroom } from './classroom.js';
import { refRate, perSpan, monthlyFromRef, REF_MONTHS } from './timescale.js';
import { setPaths } from './paths.js';

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

/**
 * 日曆 v2：stages 有兩種——定長（turns＋startMonths＋stepMonths）和學年（grades:[{g, segs}]，segs 是 segmentSets 的名字）。
 * 學年內每段的月齡 = 72 + (g-1)·12 + ((month-9+12)%12)（9 月開學）。
 * fixed：{atMonths, event}（第一個 ageMonths ≥ 該值的回合）或 {at:{stage, i}, event}（該階段第 i 回合）。
 * schoolFixed：{grade:[…], seg:'段名', event}，段用名字找，不用序號。
 * tl.newAge：該回合是新的一歲（floor(ageMonths/12) 與前一回合不同）。
 */
/** 開放玩的階段：回合序號從 0 起算，起點在 playableTurns 之前的階段（工具用它代替寫死的階段清單） */
export function playedStages(cal) {
  const out = [];
  let n = 0;
  for (const s of cal.stages) {
    if (n < cal.playableTurns) out.push(s.id);
    n += s.turns ?? s.grades.reduce((a, g) => a + cal.segmentSets[g.segs].length, 0);
  }
  return out;
}

/**
 * 遊戲玩到哪一回合結束：就是日曆的 playableTurns（E1 起是 72，離家那天）。
 * 第二個參數（舊的預覽旗標）只為相容保留，沒有作用：?preview=1 不再改變終點。
 */
export function playableEnd(data) {
  return data.calendar.playableTurns;
}
const endOf = (st, data) => playableEnd(data);

export function buildTimeline(cal) {
  const tl = [];
  const stageStart = {}, segNameAt = [];
  for (const s of cal.stages) {
    stageStart[s.id] = tl.length;
    if (s.turns) {
      for (let i = 0; i < s.turns; i++) {
        const ageMonths = s.startMonths + i * s.stepMonths;
        tl.push({ turn: tl.length, stage: s.id, ageMonths, grade: 0, seg: -1, vacation: false, month: null, label: (s.labels && s.labels[i]) || ageLabel(ageMonths), fixed: [] });
      }
    } else {
      for (const { g, segs } of s.grades) {
        const set = cal.segmentSets[segs];
        if (!set) throw new Error(`日曆：年級 ${g} 的段落組「${segs}」不存在`);
        set.forEach((seg, k) => {
          const ageMonths = 72 + (g - 1) * 12 + ((seg.month - 9 + 12) % 12);
          const t = { turn: tl.length, stage: s.id, ageMonths, grade: g, seg: k, vacation: !!seg.vacation, month: seg.month, label: `${gradeName(g)}・${seg.name}`, fixed: [] };
          if (seg.months) t.months = seg.months;
          segNameAt[t.turn] = seg.name;
          tl.push(t);
        });
      }
    }
    stageStart[s.id + '#end'] = tl.length;
  }
  if (tl.length !== cal.totalTurns) throw new Error(`日曆回合數不對：${tl.length} ≠ ${cal.totalTurns}`);
  tl.forEach((t, i) => { t.newAge = i > 0 && Math.floor(t.ageMonths / 12) !== Math.floor(tl[i - 1].ageMonths / 12); });
  // span：這個回合涵蓋的月數（到下一回合的月齡差；最後一個回合沿用前一個）。所有『每回合』的量都用它換算（js/engine/timescale.js）。
  tl.forEach((t, i) => { t.span = i < tl.length - 1 ? tl[i + 1].ageMonths - t.ageMonths : 0; });
  if (tl.length > 1) tl[tl.length - 1].span = tl[tl.length - 2].span;
  // ages：整張時間軸的月齡（不可列舉，不進 JSON／deepEqual）：把『幾個月後』換成回合序號用
  const ages = tl.map((t) => t.ageMonths);
  for (const t of tl) Object.defineProperty(t, 'ages', { value: ages, enumerable: false });
  for (const f of cal.fixed) {
    let at;
    if (f.at) {
      const lo = stageStart[f.at.stage];
      if (lo === undefined) throw new Error(`日曆 fixed：階段「${f.at.stage}」不存在`);
      at = lo + f.at.i;
      if (at >= stageStart[f.at.stage + '#end']) throw new Error(`日曆 fixed：階段「${f.at.stage}」沒有第 ${f.at.i} 回合`);
    } else if (f.atMonths !== undefined) {
      at = tl.findIndex((t) => t.ageMonths >= f.atMonths);
      if (at < 0) throw new Error(`日曆 fixed：找不到 ≥ ${f.atMonths} 個月的回合`);
    } else throw new Error('日曆 fixed：要有 atMonths 或 at');
    tl[at].fixed.push(f.event);
  }
  const segNames = new Set(Object.values(cal.segmentSets).flat().map((x) => x.name));
  for (const f of cal.schoolFixed) {
    if (!segNames.has(f.seg)) throw new Error(`日曆 schoolFixed：沒有叫「${f.seg}」的段`);
    for (const t of tl) if (t.grade && f.grade.includes(t.grade) && segNameAt[t.turn] === f.seg) t.fixed.push(f.event);
  }
  return tl;
}

/**
 * 標籤自帶的可見代價（tags.json 的 tagCosts，例如 硬撐）：載入時加進選項的 effects，不改原始資料。
 * 這樣劑量表、疲勞累積、資料檢查與機器人看到的都是同一份效果；新卡不必每次記得寫。
 */
export function withTagCosts(events, tagCosts) {
  if (!tagCosts || !Object.keys(tagCosts).length) return events;
  const cards = events.cards.map((c) => ({
    ...c,
    choices: c.choices.map((ch) => {
      const add = (ch.tags || []).filter((t) => tagCosts[t]);
      if (!add.length) return ch;
      const plus = (e) => { const eff = { ...(e || {}) }; for (const t of add) for (const [k, d] of Object.entries(tagCosts[t])) eff[k] = (eff[k] || 0) + d; return eff; };
      const out = { ...ch, effects: plus(ch.effects) };
      if (ch.effectsIf) out.effectsIf = ch.effectsIf.map((v) => ({ ...v, value: plus(v.value) })); // 情境版本的效果也加上標籤自帶的代價（tagsIf 不能換掉有代價的標籤，lint 檢查）
      return out;
    }),
  }));
  return { ...events, cards };
}

export function prepareData(raw) {
  setSlotData(raw.slots);
  setGates(raw.tags.gates);
  const events = withTagCosts(raw.events, raw.tags.tagCosts);
  // 卡片依「階段 × 池」建索引：每回合只看這個階段的池，不必掃全部卡（500 張時也夠快）。
  const index = {};
  for (const st of raw.tags.stages) index[st] = {};
  for (const c of events.cards) {
    if (c.pool.startsWith('_')) continue;
    for (const st of c.stages || raw.tags.stages) ((index[st] ||= {})[c.pool] ||= []).push(c);
  }
  // 因果圖（data/model.json，§3.7）掛在標籤對照表上，tags.js 只認 T.model
  setModel(raw.model); setEnding(raw.ending);
  setPaths(raw.events.paths); // 路線（M3 B4）：學制、去向、中途離校的前兆；沒有 paths 資料時不登記
  const tags = raw.model ? { ...raw.tags, model: raw.model } : raw.tags;
  const data = {
    identities: raw.identities, tags, model: raw.model, ending: raw.ending, habits: raw.habits || null, paths: raw.events.paths || null, chains: raw.events.chains || null, research: raw.events.research || null, events, pools: raw.pools.pools, loads: raw.pools.loads || [], calendar: raw.calendar,
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

/** 有期限的旗標（打石膏、戴牙套；選項的 flagMonths 設定）：月齡到了就清掉旗標與期限。回合開始時呼叫。 */
export function expireFlags(st, ageMonths) {
  if (!st.flagExpiry) return;
  for (const [f, until] of Object.entries(st.flagExpiry)) if (ageMonths >= until) { delete st.flags[f]; delete st.flagExpiry[f]; }
}

/** 習慣步驟：回傳 { habitLine?, habitExplainer? }。skip＝這個回合出現的卡片所屬的習慣家族（抽到的那張、固定事件的每一張） */
function habitStep(st, data, tl, ctx, card) {
  if (!data.habits) return {};
  const out = {};
  if (tl.stage === '國中' && !Object.keys(st.habits).length) { detectHabits(st, data); out.habitExplainer = explainerOf(data); }
  const skip = new Set([card && card.habit, ...(tl.fixed || []).map((id) => familyOf(data, id))].filter(Boolean));
  const r = autoHabit(st, data, tl, ctx, skip);
  if (r) out.habitLine = r.line;
  return out;
}

/**
 * 開始一個回合：固定事件 → 到期的後續卡 → 抽卡。沒有卡時回傳一句平靜日子的描述。
 * 有固定事件的回合有第二張卡（日常或後續卡）：選完第一張後呼叫 nextCard；劑量表在第二張之後合計。
 */
export function startTurn(st, data) {
  if (st.turn >= endOf(st, data)) { st.ended = true; st.endReason = '待續'; return { ended: true, tl: timelineOf(st, data) }; }
  const tl = data.timeline[st.turn];
  expireFlags(st, tl.ageMonths);
  syncClassroom(st, data, tl); // 換老師的年級（小一、小三、小五、國一、高一）重抽班級（§4.38）
  for (const [k, v] of Object.entries(st.openPools)) if (v.until < tl.ageMonths) delete st.openPools[k]; // until＝最後一個還開著的月齡
  const ctx = buildCtx(st, tl);
  const r = stateRng(st, 'rngS');
  let card = pickFixed(st, data, tl, ctx), fu = null;
  const twoSlot = !!card;
  // 同一回合有兩個固定事件（例如一年級開學日：開學第一天、上下學怎麼走）：第二個排成到期的後續卡，當作第二張卡
  if (card) for (const id of tl.fixed || []) {
    const c2 = data.cardIndex[id];
    if (id !== card.id && c2 && passes(c2, st, ctx) && !st.delayed.some((d) => d.card === id)) st.delayed.push({ card: id, due: st.turn, from: st.turn });
  }
  if (!card) {
    const d = pickDelayed(st, data, tl, ctx);
    if (d) { card = d.card; fu = d.delay; } else card = drawCard(st, data, ctx, tl, r);
  }
  // 習慣（M3 B2）：第一個國中回合偵測；國中、高中每個回合自動帶入一個家族（同家族的卡出現就跳過）
  const habit = habitStep(st, data, tl, ctx, card);
  if (!card) { st.cur = { quiet: true }; return { tl, card: null, quiet: quietLine(st, data, tl, ctx), ...habit }; }
  const loads = rollLoads(st, data, ctx);
  st.cur = { cardId: card.id, slot: 0, twoSlot, fu, acc: {}, loads };
  const view = describeCard(card, st, data, tl);
  view.loads = loads.map((l) => fill(l.text, st, ctx, {}));
  if (habit.habitLine) view.habitLine = habit.habitLine;
  if (habit.habitExplainer) view.habitExplainer = habit.habitExplainer;
  return { tl, card: view, raw: card, twoSlot, ...habit };
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
    for (const l of cur.loads || []) applyEffects(st, l.effects, cur.acc); // 命運事件只改看得見的數值（規則 18）
  }
  const out = applyChoice(st, data, card, idx, tl, r, { fu: cur.fu });
  for (const [k, v] of Object.entries(out.acc)) cur.acc[k] = (cur.acc[k] || 0) + v;
  cur.chosen = idx;
  if (cur.twoSlot && cur.slot === 0) {
    const ctx = buildCtx(st, tl);
    const auto = st.autoLog.length ? st.autoLog[st.autoLog.length - 1] : null; // 這個回合已經自動帶入的習慣家族：第二張卡不再抽同家族的（M3 B2）
    const d = pickDelayed(st, data, tl, ctx, card.id);
    const c2 = d ? d.card : drawCard(st, data, ctx, tl, r, card.id, auto && auto.turn === st.turn && auto.tags.length ? auto.family : null);
    if (c2) { cur.next = { id: c2.id, fu: d ? d.delay : null }; return { result: out.result, note: out.note, dose: null, more: true }; }
  }
  return { result: out.result, note: out.note, dose: doseView(cur.acc, st, tl.stage, tl.span), more: false };
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

/**
 * 每個回合的自然變化：往「這個家庭、這個階段」的常態慢慢回復，並受隱藏數值的長期影響。
 * A2.5：所有回復率都是每月的比率，span 個月的回合回復 1−(1−r)^span。程式裡寫死的數字是『一個 2 個月的國小回合』的舊值，
 * 用 refRate 換成這個回合的比率（2 個月的回合與舊值完全相同）；資料裡的比率（parentModel、tags.drift）本來就存每月值。
 */
function drift(st, data, tl) {
  const P = st.parent, C = st.child, f = st.family, h = st.hidden, tp = f.child.temperament;
  const pat = data.identities.patterns[f.pattern];
  const M = data.identities.parentModel;
  const sp = tl.span;
  const R = (r) => refRate(r, sp); // 舊的每回合比率（2 個月）→ 這個回合的比率
  const to = (o, k, target, rate) => { o[k] = clamp(o[k] + (target - o[k]) * rate, 0, 100); };
  const school = tl.grade > 0, adhd = f.child.needs.some((n) => n.kind === 'ADHD' && tl.ageMonths >= n.onsetMonths);
  // 父母：花費會累積。目標 = 常態 − k × 最近花費的指數移動平均，回復速度慢（每月 ~5%），所以連續幾個月的付出不會一回合就被洗掉。
  const acc = (st.cur && st.cur.acc) || {};
  const a = perSpan(monthlyFromRef(2 / (M.emaMonths / REF_MONTHS + 1)), sp); // 平均的跨度 emaMonths 個月；2 個月的回合 a＝2/(emaMonths/2+1)
  // acc 已經乘過這回合的劑量倍率（k），而 a 又是跨 span 的權重：把花費除回『每參考回合（2 個月）』的速率再進 EMA，疲勞才不會隨回合變長而加深（A2.5 審查 Issue 1）
  // 花費可以是負的（休息那一回合是「還債」），累積的疲勞不會低於 0
  for (const k of ['體力', '耐心']) st.costEMA[k] = Math.max(0, st.costEMA[k] + a * (-(acc[k] || 0) / (sp / REF_MONTHS) - st.costEMA[k]));
  const recover = perSpan(M.recoverMonth, sp);
  to(P, '體力', 74 + pat.體力 - M.kBody * st.costEMA.體力, recover);
  // 用藥（DESIGN §5.0）：用藥中的 ADHD 孩子，成績與作業被拖累的部分減少；沒有盯著吃（用藥打折）時只剩一點點，學校看到的仍是老樣子
  const A = data.tags.adherence, medCut = adhd && st.flags.用藥中 && A ? (st.vars.用藥打折 ? A.slipped : A.supervised) : 0;
  const load = (tp.活動量 >= 4 ? 3 : 0) + (tp.敏感度 >= 4 ? 3 : 0) + (adhd ? 4 : 0) + (st.flags.等公托候補 && tl.stage === '嬰幼兒' ? 3 : 0);
  to(P, '耐心', 68 - load - (P.體力 < 35 ? 8 : 0) - M.kPatience * st.costEMA.耐心, recover);
  to(P, '錢', M.moneyTarget[f.econ], perSpan(M.moneyRateMonth, sp)); // 回歸家境的常態；帳單是偶爾壓下來的情境負荷（pools.json loads），不是單調的扣款
  to(P, '工作表現', st.flags.育嬰留停 && !school ? 52 : 62, R(0.12));
  if (f.partner.present) to(P, '夫妻關係', data.identities.partner.startCouple[f.partner.attitude] - (P.耐心 < 30 ? 8 : 0), R(0.08));
  // 孩子的可見數值：往「這個家、這個階段」的常態回復，常態會受隱藏數值的長期影響（§3.2 放任的連鎖：沒規則 → 3C 多 → 睡不好 → 成績與同儕往來都吃虧）。
  // 3C 的常態＝階段的基準 + 規範監督與試探度的影響；注意括號：先取基準，再加影響（M1 的運算子優先順序錯誤已修正）。
  const base3c = { 嬰幼兒: 6, 幼兒園: 20, 國小低: 30, 國小中高: 42, 國中: 50, 高中: 55, 離家: 55 }[tl.stage] ?? 45;
  // 依賴度高的孩子，3C 時間往更高的水準漂（DESIGN §4.39 依賴度怎麼影響孩子）：基準 + baseLift 每點依賴度；依賴度透過既有的 3C 時間效果（睡眠、心情、成績、親子）發生作用，不另外重複扣分
  const lift = ((data.tags.screen && data.tags.screen.baseLift) || 0) * (h['3C依賴度'] ?? 0);
  const depF = learnFactor(st, data.tags); // 依賴度高：成績往下（草草了事，§4.39）
  to(C, '3C時間', base3c + (50 - h.規範監督) * 0.25 + (h.試探度 - 25) * 0.12 + lift, R(0.2));
  to(C, '睡眠', 68 - Math.max(0, C['3C時間'] - 40) * 0.3 + (h.規則一致性 - 50) * 0.06, R(0.3));
  to(C, '心情', 62 + (C.睡眠 - 60) * 0.1 - Math.max(0, C['3C時間'] - 60) * 0.1 + (h.安全感 - 55) * 0.1 + (h.內在穩定 - 50) * 0.08, R(0.35));
  if (tl.stage !== '嬰幼兒') to(C, '同學往來', 50 + f.child.talents.人際 * 6 + (C.心情 - 60) * 0.2 + (h.內在穩定 - 50) * 0.1 - (h.試探度 - 25) * 0.3, R(0.15));
  if (school) {
    // 壓力有時候「有用」（§3.1：盯成績在國小常常真的把分數撐住）：不敏感的孩子，期待壓力與替他做主會推高成績與作業；敏感的孩子反過來被拖累
    const examMult = (data.model.examPressure && data.model.examPressure.stageMult[tl.stage]) ?? 1; // 國中、高中的考試年：盯功課、補習、排名壓力短期真的拉得動分數（代價在親子那一條軸），倍率只套在壓力這一項
    const press = ((h.期待壓力 - 30) * (tp.敏感度 <= 2 ? 0.35 : tp.敏感度 >= 4 ? -0.12 : 0.12) + (h.替他做主 - 30) * (tp.敏感度 <= 3 ? 0.12 : -0.04)) * examMult;
    to(C, '成績', 50 + (f.child.talents.國語 + f.child.talents.數學) * 3 + press + (h.家庭學習環境 - 45) * 0.25 + (h.閱讀習慣 - 40) * 0.2 + (h.自我效能 - 50) * 0.2 + (C.睡眠 - 60) * 0.1 - Math.max(0, C['3C時間'] - 50) * 0.1 - (data.tags.screen.harm ? data.tags.screen.harm.gradeDrift : 0) * depF - (adhd ? 3 * (1 - medCut) : 0), R(0.12));
    to(C, '作業', 55 + press * 0.8 + (h.自理與責任 - 40) * 0.3 + (h.規範監督 - 50) * 0.15 + (C.睡眠 - 60) * 0.05 - (adhd ? 6 * (1 - medCut) : 0), R(0.25));
  }
}

export function finishTurn(st, data) {
  const tl = data.timeline[st.turn];
  drift(st, data, tl);
  driftClassroom(st, data, tl);
  driftHidden(st, data.tags, { span: tl.span, months: tl.ageMonths, stage: tl.stage });
  const r1 = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 10) / 10]));
  st.curves.push({ t: st.turn, m: tl.ageMonths, ...r1(st.hidden) });
  st.vcurves.push({ t: st.turn, m: tl.ageMonths, ...r1(st.parent), ...r1(st.child) });
  if (tl.grade > 0 && st.classroom) (st.classLog ||= []).push({ t: st.turn, m: tl.ageMonths, grade: tl.grade, v: Math.round(st.classroom.v), cold: !!st.flags.科目冷掉 }); // 終局的班級段落（chains.js classroomSummary）
  st.cur = null;
  st.turn++;
  if (st.turn >= endOf(st, data)) { st.ended = true; st.endReason = '待續'; }
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
