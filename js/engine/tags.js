// 行為標籤 → 隱藏數值（DESIGN §3.6）。隱藏數值只能在這個檔案裡被改變：事件卡只寫 tags，換算全部查 data/tags.json 這一份對照表。
// 換算會依情境調整：孩子的階段、（只有害處會累積的標籤才有的）重複加速、「父母傳遞的方向」計數、孩子的狀態與氣質。
// 數值有飽和（越接近 0 或 100 越難動）與自然漂移（不維持就慢慢回到常態，例如了解度）。純函式，無 DOM。
import { evalCond } from './events.js';
import { derivedValue, plasticityOf, edgeForTagEffect, edgeById } from './model.js';
import { perSpan, decaySpan } from './timescale.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const HIDDEN_KEYS = (T) => Object.keys(T.hidden);

/* ───── 唯一的寫入口：只有這個檔案的 applyTags / recomputeDerived / driftHidden 能改 st.hidden ─────
   tests 會把 st.hidden 換成 Proxy，任何在這三個函式之外的寫入都會丟錯。 */
let writing = 0;
export const hiddenWriteAllowed = () => writing > 0;
/** 量測用的觀察者（tools/check-design.mjs、impact）：每次 applyTags 結束時呼叫 fn({ st, turn, stage, tags, perTag, deltas })；不改變任何數值。 */
let observer = null;
export const setTagObserver = (fn) => { observer = fn; };
const writer = (fn) => (...a) => { writing++; try { return fn(...a); } finally { writing--; } };

/** 階段（孩子目前在哪個階段）：timeline 裡的 stage 字串 */
export function stageMult(def, stage) {
  return def.stage && stage in def.stage ? def.stage[stage] : 1;
}

/**
 * 父母的收穫（§7.2b）：這組標籤算不算『父母一起參與』。growthTags 裡的標籤才算；joinOnly 的標籤（嘗試新活動）
 * 要同一個選項裡還有別的參與標籤才算（光是把孩子送去不算）。
 */
export function isGrowthChoice(T, tags) {
  const list = T.growthTags || [], only = (T.growth && T.growth.joinOnly) || [];
  const g = (tags || []).filter((t) => list.includes(t));
  return g.some((t) => !only.includes(t));
}

/** 同一個標籤在最近 windowMonths 個月內出現過幾次（含這次之前的；依劑量加權）；months＝現在的月齡（A2.5：窗口以月計，不隨回合長度變） */
export function recentCount(st, tag, months, T) {
  const w = T.repetition.windowMonths;
  let n = 0;
  for (let i = st.hist.length - 1; i >= 0; i--) {
    const h = st.hist[i];
    if (months - h.m > w) break;
    if (h.tags && h.tags.includes(tag)) n += (h.k ?? 1); // 劑量加權：一張 3 倍劑量的卡算 3 次反覆出現的時刻
  }
  return n;
}

/** 孩子的狀態與氣質等條件（供標籤的 modifiers 使用） */
export function modifierFactor(T, tag, ctx) {
  let x = 1;
  for (const m of T.modifiers) if (m.tags.includes(tag) && evalCond(m.if, ctx)) x *= m.x;
  return x;
}

/** 飽和：往上加時，越接近 100 越難加；往下減時，越接近 0 越難減（50 附近 ×1） */
export const saturate = (v, d) => (d >= 0 ? d * (100 - v) / 50 : d * v / 50);

/**
 * 特殊需求的一致性倍率（tags.json 的 needsMult，DESIGN §5 第 7 點）：孩子有 ADHD 或情緒行為障礙（且已過發作月齡）時，
 * 『說到做到』『事前訂規則』加大、『吵了才讓步』『說了不算』加大、單獨的『先接住情緒』打折。倍率隨輕重遞減：1 + (x − 1) × needsSeverityShare。
 * 有兩類時取偏離 1 最多的；沒有特殊需求（或舊存檔沒有輕重，當輕度）時是 1。tags＝這個選項全部的標籤（unlessWith 看它）。
 */
export function needsFactor(st, T, tag, tags, months) {
  const NM = T.needsMult;
  if (!NM) return 1;
  let best = 1;
  for (const n of st.family.child.needs) {
    let def = NM[n.kind];
    if (!def || months < n.onsetMonths) continue;
    if (def.same) def = NM[def.same];
    const e = def[tag];
    if (e == null) continue;
    const x = typeof e === 'number' ? e : e.x;
    if (e.unlessWith && (tags || []).some((t) => e.unlessWith.includes(t))) continue;
    const m = 1 + (x - 1) * (T.needsSeverityShare[n.severity ?? '輕'] ?? 1);
    if (Math.abs(m - 1) > Math.abs(best - 1)) best = m;
  }
  return best;
}

/**
 * 用藥要盯著吃（tags.json 的 adherence，DESIGN §5.0）：只看『連續』，和工作插播同一種算法。
 * 選項帶 missTags ⇒ 連續漏盯 +1（達 enterAt 進入『用藥打折』）；帶 attendTags ⇒ 漏盯歸零、連續盯著 +1（達 exitAt 離開）。st.vars 由這個檔案唯一寫入。
 */
export function updateAdherence(st, tags, T) {
  const A = T.adherence;
  if (!A) return;
  const v = st.vars, set = new Set(tags || []);
  const attend = A.attendTags.some((t) => set.has(t)), miss = !attend && A.missTags.some((t) => set.has(t));
  if (!attend && !miss) return;
  v.用藥_連續漏盯 ||= 0; v.用藥_連續盯著 ||= 0; v.用藥打折 ||= 0;
  if (miss) {
    v.用藥_連續盯著 = 0; v.用藥_連續漏盯++;
    if (v.用藥_連續漏盯 >= A.enterAt) { if (!v.用藥打折) v.用藥打折_曾 = (v.用藥打折_曾 || 0) + 1; v.用藥打折 = 1; }
  } else {
    v.用藥_連續漏盯 = 0; v.用藥_連續盯著++;
    if (v.用藥打折 && v.用藥_連續盯著 >= A.exitAt) v.用藥打折 = 0;
  }
}

/** 重複加速的倍率（只有 accel:true 的標籤才會用到） */
export function repetitionMult(st, tag, months, T) {
  const rep = T.repetition;
  return Math.min(rep.cap, 1 + rep.per * recentCount(st, tag, months, T));
}

/** 「壓力那一側」的方向：期待壓力上升、主見下降。方向計數只放大這一側（§3.3） */
const pressureSide = (k, d) => (k === '期待壓力' ? d > 0 : k === '主見' ? d < 0 : false);

/**
 * 套用一組標籤。回傳 { deltas }：這次每個隱藏數值實際改變了多少（只給工具與測試用，遊戲畫面不會用到）。
 * opts: { turn, months, span, scale, stage, ctx, topic, direction, approach, initiate }
 * months＝現在的月齡（重複加速的窗口用；沒給就取 ctx.月齡，再沒有就是最近一筆紀錄的月齡）；scale＝這張卡的劑量倍率（timescale.js doseScale，沒給是 1）：
 * 放大『隱藏數值的變化量』（d、興趣、父母的收穫、休息的減輕），不放大事件計數（counts、方向計數、approach 的連續數是『幾次』，不是『多久』）。
 */
/**
 * 孩子來找你（DESIGN §4.28 連續才是關鍵）：只看『連續』。approach 卡上選項帶 missTags ⇒ 連續錯過 +1（達門檻進入『不太來找你』）；
 * 帶 attendTags ⇒ 連續錯過歸零。進入之後，要連續 exitStreak 次（approach 卡上的 attendTags，或 initiate:true 的卡上的 initiateTags）才離開；
 * approach 卡上的錯過讓『回來的連續數』歸零；其他卡上的補償（禮物、出遊）不算也不歸零。st.vars 由這個檔案唯一寫入（同其他計數）。
 */
export function updateApproach(st, tags, T, opts) {
  const A = T.approach;
  if (!A) return;
  const v = st.vars, set = new Set(tags || []);
  const has = (list) => list.some((t) => set.has(t));
  const attend = has(A.attendTags), miss = !attend && has(A.missTags);
  v.孩子來找_連續錯過 ||= 0; v.孩子來找_回來連續 ||= 0; v.不太來找你 ||= 0;
  if (opts.approach) {
    if (attend) { v.孩子來找_連續錯過 = 0; if (v.不太來找你) v.孩子來找_回來連續 += A.approachCredit ?? 1; } // 孩子自己又來找你、你停下來聽：最強的一步（approachCredit 份）
    else if (miss) {
      v.孩子來找_回來連續 = 0;
      if (!v.不太來找你) {
        v.孩子來找_連續錯過++;
        const sens = st.family.child.temperament.敏感度 >= A.sensitiveFrom;
        if (v.孩子來找_連續錯過 >= (sens ? A.enterAtSensitive : A.enterAt)) { v.不太來找你 = 1; v.不太來找你_曾 = (v.不太來找你_曾 || 0) + 1; v.孩子來找_回來連續 = 0; }
      }
    }
  } else if (!v.不太來找你 && A.absenceTags && has(A.absenceTags)) {
    // 假日缺席（§4.40）：假日是孩子最常主動找你的時間；接了邀約而人不在家，算半次沒被接住（只在不是 approach 的卡上算）
    v.孩子來找_連續錯過 += A.absenceWeight ?? 0.5;
    const sens = st.family.child.temperament.敏感度 >= A.sensitiveFrom;
    if (v.孩子來找_連續錯過 >= (sens ? A.enterAtSensitive : A.enterAt)) { v.不太來找你 = 1; v.不太來找你_曾 = (v.不太來找你_曾 || 0) + 1; v.孩子來找_回來連續 = 0; }
  } else if (v.不太來找你 && opts.initiate && has(A.initiateTags)) v.孩子來找_回來連續++; // 只有『父母主動去找孩子』的卡（initiate:true：睡前談話、走去找他、一起看手機…）算；固定事件、出遊、買禮物都不算（§4.28 一次的補償不算）
  if (v.不太來找你 && v.孩子來找_回來連續 >= (A.exitStreak[opts.stage] ?? 3)) { const k = opts.approach ? '不太來找你_離開_接住' : '不太來找你_離開_主動'; v[k] = (v[k] || 0) + 1; v.不太來找你 = 0; v.孩子來找_連續錯過 = 0; v.孩子來找_回來連續 = 0; }
}

/**
 * 手機與平板（DESIGN §4.39）：使用方式與連續的陪伴。
 * ・modes：選項帶的標籤把『無人陪伴的比例』（vars 3C無人陪）往各自的目標靠（screenOnly 的標籤只在 screen 卡上算）；
 * ・screen 卡上：選項有 companionTags 就連續 +1；既不是陪伴、也不是 neutralTags 就歸零（只強制收回、只加時間管控都歸零）；
 * ・連續達階段門檻（need）之後，陪伴使一次大活動待回彈的量清零（連續的陪伴一建立，下降就留得住）。
 * st.vars 由這個檔案唯一寫入（同其他計數）。opts: { screen, scale, stage }
 */
export function updateScreen(st, tags, T, opts) {
  const S = T.screen;
  if (!S) return;
  const v = st.vars, set = new Set(tags || []), scale = opts.scale ?? 1;
  v[S.useVar] ??= S.useDefault; v[S.streakVar] ??= 0; v[S.trip.reboundVar] ??= 0;
  let sum = 0, n = 0, w = 0;
  for (const [tag, m] of Object.entries(S.modes)) if (set.has(tag) && (!m.screenOnly || opts.screen)) { sum += m.to; n++; w = Math.max(w, m.w); }
  if (n) v[S.useVar] = clamp(v[S.useVar] + (sum / n - v[S.useVar]) * Math.min(1, w * scale), 0, 1);
  if (!opts.screen) return;
  const comp = S.companionTags.some((t) => set.has(t)), neutral = !comp && S.neutralTags.some((t) => set.has(t));
  if (comp) {
    v[S.streakVar]++;
    v['3C陪伴_最長'] = Math.max(v['3C陪伴_最長'] || 0, v[S.streakVar]);
    if (v[S.streakVar] >= (S.need[opts.stage] ?? 3)) v[S.trip.reboundVar] = 0;
  } else if (!neutral) v[S.streakVar] = 0;
}

/** 依賴度的『傷害係數』0–1（DESIGN §4.39 依賴度怎麼影響孩子；tags.json screen.harm.lo／hi 之間線性）。沒有設定就是 0 */
export function depFactor(st, T) {
  const S = T.screen, H = S && S.harm;
  if (!H) return 0;
  return clamp(((st.hidden[S.dep] ?? 0) - H.lo) / (H.hi - H.lo), 0, 1);
}
/** 學習面的傷害係數：依賴度的傷害係數 ×（1 − resilMax × 抗性）；抗性＝國語與數學天賦平均從 resilFrom 到 resilTo 線性 0→1（天賦好的孩子，即使放任 3C 成績還撐得住，這是『少數例外』；但和家人的互動照樣變少，§4.39） */
export function learnFactor(st, T) {
  const H = T.screen && T.screen.harm, f = depFactor(st, T);
  if (!H || !f) return 0;
  const t = st.family.child.talents, a = ((t.國語 || 0) + (t.數學 || 0)) / 2;
  return f * (1 - H.resilMax * clamp((a - H.resilFrom) / (H.resilTo - H.resilFrom), 0, 1));
}
/** 作業▲打折：依賴度高的孩子作業會寫完，但草草了事（只打折正的效果，不動花費） */
export function discountHomework(st, T, eff) {
  const f = learnFactor(st, T), H = T.screen && T.screen.harm;
  if (!f || !eff || !(eff.作業 > 0)) return eff;
  return { ...eff, 作業: eff.作業 * (1 - H.homeworkDiscount * f) };
}

/* ───── 單回合邊預算（DESIGN §3.7 第 2 點）：一個回合裡推到同一條 h: 因果邊（隱藏數值＋方向）的總量，以『參考劑量』（÷ 劑量倍率 refK）計，不超過那條邊的 maxTurn ─────
   同一個回合的兩張卡、自動帶入的習慣、父母的收穫都算同一份預算；超出的部分在套用時直接截掉（照比例縮小這一次的變化量）。
   預算只活在這個 WeakMap（以 st 物件為鍵、依回合重置），不進 st，存檔格式不變；從存檔讀回來的局在該回合的預算從頭算。 */
const TURN_BUDGET = new WeakMap();
function turnBudget(st, T, opts, edge, raw) {
  if (!raw || !edge || !edge.maxTurn || opts.turn == null) return raw;
  let b = TURN_BUDGET.get(st);
  if (!b || b.turn !== opts.turn) { b = { turn: opts.turn, used: {} }; TURN_BUDGET.set(st, b); }
  const k = opts.refK || opts.scale || 1, ref = Math.abs(raw) / k;
  const use = Math.min(ref, Math.max(0, edge.maxTurn - (b.used[edge.id] || 0)));
  b.used[edge.id] = (b.used[edge.id] || 0) + use;
  return ref > 0 ? raw * (use / ref) : raw;
}

export const applyTags = writer((st, tags, T, opts) => {
  const deltas = {}, perTag = observer ? {} : null;
  const { stage, ctx, topic, direction } = opts;
  const scale = opts.scale ?? 1;
  const months = opts.months ?? (ctx && ctx.月齡) ?? (st.hist.length ? st.hist[st.hist.length - 1].m : 0);
  updateScreen(st, tags, T, { screen: !!opts.screen, scale, stage });
  const SC = T.screen, depF = learnFactor(st, T); // 依賴度高：閱讀習慣、嘗試新活動的正面效果打折（§4.39 內在的動力變弱）
  for (const tag of tags || []) {
    const def = T.tags[tag];
    if (!def) throw new Error('未知的行為標籤: ' + tag);
    let mult = (T.gain ?? 1) * (st.family.child.responsive ?? 1) * stageMult(def, stage) * modifierFactor(T, tag, ctx) * needsFactor(st, T, tag, tags, months) * scale;
    // 重複加速：只有「害處會累積」的標籤（accel:true）才會在短時間內越來越快
    if (def.accel) mult *= repetitionMult(st, tag, months, T);
    // 方向加速（§3.3）：同一個方向一直被提到，壓力那一側越來越快；順口的權重比特地小，但不是零
    let dirMult = 1;
    if (def.dir != null) {
      const key = direction || '_';
      const prior = st.dirCount[key] || 0;
      dirMult = Math.min(T.repetition.directionCap, 1 + T.repetition.directionPer * prior);
      st.dirCount[key] = prior + def.dir * scale; // 劑量加權（scale＝這張卡的劑量倍率）
    }
    for (const [k, d] of Object.entries(def.d || {})) {
      if (def.streakGate && SC && k === SC.dep && !(st.vars[SC.streakVar] >= (SC.need[stage] ?? 3))) continue; // 3C陪伴同行：連續的陪伴達門檻才把依賴度往下拉（§4.39）
      const m = mult * (def.dirAccel && def.dirAccel.includes(k) && pressureSide(k, d) ? dirMult : 1) * plasticityOf(T.model, stage, k, def, Math.sign(d)); // 階段可塑性（B1）
      const before = st.hidden[k];
      const drive = depF && d > 0 && ((SC.harm.driveKeys || []).includes(k) || (SC.harm.driveTags || []).includes(tag)) ? 1 - SC.harm.driveDiscount * depF : 1;
      st.hidden[k] = clamp(before + turnBudget(st, T, opts, T.model ? edgeForTagEffect(T.model, tag, k, d) : null, saturate(before, d * m * drive)), 0, 100);
      deltas[k] = (deltas[k] || 0) + (st.hidden[k] - before);
      if (SC && tag === SC.trip.tag && k === SC.dep && st.hidden[k] < before) st.vars[SC.trip.reboundVar] = (st.vars[SC.trip.reboundVar] || 0) + (before - st.hidden[k]); // 一次大活動：下降的量記成待回彈
      if (perTag) ((perTag[tag] ||= {})[k] = (perTag[tag][k] || 0) + (st.hidden[k] - before));
    }
    if (def.interest && topic && topic in st.interest) st.interest[topic] = clamp(st.interest[topic] + (def.interest / 100) * mult, 0, 1);
    if (def.relief) for (const k of ['體力', '耐心']) st.costEMA[k] *= Math.pow(1 - def.relief, scale); // 真的休息：累積的疲勞減輕（不是隱藏數值）
    for (const [k, n] of Object.entries(def.counts || {})) st.vars[k] = (st.vars[k] || 0) + n;
    st.tagCounts[tag] = (st.tagCounts[tag] || 0) + 1;
  }
  updateApproach(st, tags, T, opts);
  updateAdherence(st, tags, T);
  // 父母的收穫：一個選項只算一次，只在這裡寫（單一寫入口）；飽和與其他隱藏數值相同
  if (isGrowthChoice(T, tags)) {
    const before = st.hidden.父母的收穫 ?? 0;
    st.hidden.父母的收穫 = clamp(before + turnBudget(st, T, opts, T.model ? edgeById(T.model).get('h:父母的收穫+') : null, saturate(before, T.growth.gain * scale)), 0, 100);
    deltas.父母的收穫 = (deltas.父母的收穫 || 0) + (st.hidden.父母的收穫 - before);
    if (perTag) perTag['@父母的收穫'] = { 父母的收穫: st.hidden.父母的收穫 - before };
  }
  recomputeDerived(st, T);
  if (observer) observer({ st, turn: opts.turn, stage, tags: tags || [], perTag, deltas, scale, refK: opts.refK });
  return { deltas };
});

/** 承受度：由氣質、安全感、自我效能、親子信任、期待壓力推出（隱藏；不能由選項直接改）。公式的方向與權重在 data/model.json 的 derived／邊 */
export const recomputeDerived = writer((st, T) => {
  const h = st.hidden, tp = st.family.child.temperament;
  h.承受度 = derivedValue(T.model, '承受度', (k) => (k === '敏感度' ? tp.敏感度 : h[k]));
});

/**
 * 每回合結束時的自然變化（tags.json 的 drift）：
 * 1. 每個隱藏數值慢慢回到它的常態（了解度不維持就會下降；to:'start' 表示回到開局的值）；
 * 2. 規則式的漂移：耐心連續見底 ⇒ 父母情緒穩定度下降；
 * 3. 方向計數隨時間衰減。
 * A2.5：全部以月計。opts.span＝這個回合涵蓋的月數（沒給＝2，舊的國小回合）、opts.months＝這個回合的月齡。
 * 回復率 rateMonth 是每月的值，span 個月回復 1−(1−r)^span；規則式漂移看『連續低於門檻的月數』（每個回合涵蓋的月數累計），每月的變化量 × span；
 * 方向計數每月衰減 directionDecayMonth。
 */
export const driftHidden = writer((st, T, opts = {}) => {
  const dr = T.drift, span = opts.span ?? 2;
  const months = opts.months ?? (st.vcurves.length ? st.vcurves[st.vcurves.length - 1].m + span : 0);
  for (const [k, def] of Object.entries(dr.to)) {
    const target = def.to === 'start' ? (st.startHidden?.[k] ?? T.hidden[k]) : def.to;
    st.hidden[k] = clamp(st.hidden[k] + (target - st.hidden[k]) * perSpan(def.rateMonth, span), 0, 100);
  }
  // 班級共享狀態（§4.38）：老師投入度（不是隱藏數值）經由因果圖的邊推班級風氣；每月的推力 = w × (投入度 − center)
  if (st.classroom) for (const e of T.model.edges) if (e.from === '老師投入度') st.hidden[e.to] = clamp(st.hidden[e.to] + (e.sign === '+' ? 1 : -1) * e.w * (st.classroom.v - e.center) * span, 0, 100);
  for (const rule of T.model.rules || []) {
    const now = st.parent[rule.stat];
    if (!(now < rule.lt)) continue;
    // 連續低於門檻涵蓋的月數：這個回合本身（span）＋往回數、一路低於門檻的那些回合（每個回合涵蓋到下一個回合的月齡）
    let since = months, covered = span;
    for (let i = st.vcurves.length - 1; i >= 0; i--) {
      const c = st.vcurves[i];
      if (!(c[rule.stat] < rule.lt)) break;
      since = c.m ?? since; covered = months + span - since;
    }
    if (covered >= rule.months) for (const [k, d] of Object.entries(rule.d)) st.hidden[k] = clamp(st.hidden[k] + d * span, 0, 100);
  }
  for (const k of Object.keys(st.dirCount)) {
    st.dirCount[k] *= decaySpan(T.repetition.directionDecayMonth ?? 1, span);
    if (st.dirCount[k] < 0.01) delete st.dirCount[k];
  }
  // 孩子不再主動說，父母的了解就慢慢變少（DESIGN §6 2026-10-21）：『不太來找你』期間了解度每月小幅下滑，幅度在因果圖邊 k:不太來找你→了解度 的 w
  if (st.vars.不太來找你) {
    const e = T.model && edgeById(T.model).get('k:不太來找你→了解度');
    if (e) st.hidden.了解度 = clamp(st.hidden.了解度 - e.w * span, 0, 100);
  }
  // 手機與平板的依賴度（DESIGN §4.39）：使用方式慢慢回預設、一次大活動回彈、每月被動累積（讀孩子實際的 3C 時間）
  const SC = T.screen;
  if (SC) {
    const v = st.vars, dep = SC.dep;
    v[SC.useVar] = clamp((v[SC.useVar] ?? SC.useDefault) + (SC.useDefault - (v[SC.useVar] ?? SC.useDefault)) * perSpan(SC.useRelaxMonth, span), 0, 1);
    const rem = v[SC.trip.reboundVar] || 0;
    if (rem > 0) { const mv = rem * perSpan(SC.trip.reboundMonth, span); st.hidden[dep] = clamp(st.hidden[dep] + mv, 0, 100); v[SC.trip.reboundVar] = rem - mv < 0.05 ? 0 : rem - mv; }
    // 依賴度直接帶來的三件事（§4.39，遊戲設定）：和家人的互動變少（親子信任、了解度每月往下）、學習習慣往下（閱讀習慣）
    v['3C依賴高'] = (st.hidden[dep] ?? 0) >= 50 ? 1 : 0; // 結局句子讀（第 2 層的紀錄，隱藏數值本身不進結局）
    const H = SC.harm, f = depFactor(st, T);
    if (H && f > 0) {
      st.hidden.親子信任 = clamp(st.hidden.親子信任 - H.trustPerMonth * f * span, 0, 100);
      st.hidden.了解度 = clamp(st.hidden.了解度 - H.knowPerMonth * f * span, 0, 100);
      st.hidden.閱讀習慣 = clamp(st.hidden.閱讀習慣 - H.readPerMonth * learnFactor(st, T) * span, 0, 100);
    }
    const R = SC.rise, vis = st.child['3C時間'] ?? 0;
    const raw = R.perMonth * span * (vis / R.ref) * (R.floor + (1 - R.floor) * v[SC.useVar]) * (R.byStage[opts.stage] ?? 1);
    st.hidden[dep] = clamp(st.hidden[dep] + saturate(st.hidden[dep], raw), 0, 100);
  }
  recomputeDerived(st, T);
});
