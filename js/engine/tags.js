// 行為標籤 → 隱藏數值（DESIGN §3.6）。隱藏數值只能在這個檔案裡被改變：事件卡只寫 tags，換算全部查 data/tags.json 這一份對照表。
// 換算會依情境調整：孩子的階段、（只有害處會累積的標籤才有的）重複加速、「父母傳遞的方向」計數、孩子的狀態與氣質。
// 數值有飽和（越接近 0 或 100 越難動）與自然漂移（不維持就慢慢回到常態，例如了解度）。純函式，無 DOM。
import { evalCond } from './events.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const HIDDEN_KEYS = (T) => Object.keys(T.hidden);

/* ───── 唯一的寫入口：只有這個檔案的 applyTags / recomputeDerived / driftHidden 能改 st.hidden ─────
   tests 會把 st.hidden 換成 Proxy，任何在這三個函式之外的寫入都會丟錯。 */
let writing = 0;
export const hiddenWriteAllowed = () => writing > 0;
const writer = (fn) => (...a) => { writing++; try { return fn(...a); } finally { writing--; } };

/** 階段（孩子目前在哪個階段）：timeline 裡的 stage 字串 */
export function stageMult(def, stage) {
  return def.stage && stage in def.stage ? def.stage[stage] : 1;
}

/** 同一個標籤在最近 window 回合內出現過幾次（含這次之前的） */
export function recentCount(st, tag, turn, T) {
  const w = T.repetition.window;
  let n = 0;
  for (let i = st.hist.length - 1; i >= 0; i--) {
    const h = st.hist[i];
    if (turn - h.turn > w) break;
    if (h.tags && h.tags.includes(tag)) n++;
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

/** 重複加速的倍率（只有 accel:true 的標籤才會用到） */
export function repetitionMult(st, tag, turn, T) {
  const rep = T.repetition;
  return Math.min(rep.cap, 1 + rep.per * recentCount(st, tag, turn, T));
}

/** 「壓力那一側」的方向：期待壓力上升、主見下降。方向計數只放大這一側（§3.3） */
const pressureSide = (k, d) => (k === '期待壓力' ? d > 0 : k === '主見' ? d < 0 : false);

/**
 * 套用一組標籤。回傳 { deltas }：這次每個隱藏數值實際改變了多少（只給工具與測試用，遊戲畫面不會用到）。
 * opts: { turn, stage, ctx, topic, direction }
 */
export const applyTags = writer((st, tags, T, opts) => {
  const deltas = {};
  const { turn, stage, ctx, topic, direction } = opts;
  for (const tag of tags || []) {
    const def = T.tags[tag];
    if (!def) throw new Error('未知的行為標籤: ' + tag);
    let mult = (T.gain ?? 1) * stageMult(def, stage) * modifierFactor(T, tag, ctx);
    // 重複加速：只有「害處會累積」的標籤（accel:true）才會在短時間內越來越快
    if (def.accel) mult *= repetitionMult(st, tag, turn, T);
    // 方向加速（§3.3）：同一個方向一直被提到，壓力那一側越來越快；順口的權重比特地小，但不是零
    let dirMult = 1;
    if (def.dir != null) {
      const key = direction || '_';
      const prior = st.dirCount[key] || 0;
      dirMult = Math.min(T.repetition.directionCap, 1 + T.repetition.directionPer * prior);
      st.dirCount[key] = prior + def.dir;
    }
    for (const [k, d] of Object.entries(def.d || {})) {
      const m = mult * (def.dirAccel && def.dirAccel.includes(k) && pressureSide(k, d) ? dirMult : 1);
      const before = st.hidden[k];
      st.hidden[k] = clamp(before + saturate(before, d * m), 0, 100);
      deltas[k] = (deltas[k] || 0) + (st.hidden[k] - before);
    }
    if (def.interest && topic && topic in st.interest) st.interest[topic] = clamp(st.interest[topic] + (def.interest / 100) * mult, 0, 1);
    for (const [k, n] of Object.entries(def.counts || {})) st.vars[k] = (st.vars[k] || 0) + n;
    st.tagCounts[tag] = (st.tagCounts[tag] || 0) + 1;
  }
  recomputeDerived(st, T);
  return { deltas };
});

/** 承受度：由氣質、安全感、自我效能、親子信任推出（隱藏；不能由選項直接改） */
export const recomputeDerived = writer((st, T) => {
  const h = st.hidden, tp = st.family.child.temperament;
  h.承受度 = clamp(50 + (3 - tp.敏感度) * 6 + (h.安全感 - 55) * 0.25 + (h.自我效能 - 50) * 0.25 + (h.親子信任 - 55) * 0.2 - (h.期待壓力 - 30) * 0.1, 0, 100);
});

/**
 * 每回合結束時的自然變化（tags.json 的 drift）：
 * 1. 每個隱藏數值慢慢回到它的常態（了解度不維持就會下降；to:'start' 表示回到開局的值）；
 * 2. 規則式的漂移：耐心連續見底 ⇒ 父母情緒穩定度下降；
 * 3. 方向計數隨時間衰減。
 */
export const driftHidden = writer((st, T) => {
  const dr = T.drift;
  for (const [k, def] of Object.entries(dr.to)) {
    const target = def.to === 'start' ? (st.startHidden?.[k] ?? T.hidden[k]) : def.to;
    st.hidden[k] = clamp(st.hidden[k] + (target - st.hidden[k]) * def.rate, 0, 100);
  }
  for (const rule of dr.rules || []) {
    const prev = st.vcurves.slice(-(rule.turns - 1)).map((c) => c[rule.stat]);
    const vals = rule.turns > 1 ? [...prev, st.parent[rule.stat]] : [st.parent[rule.stat]];
    if (vals.length >= rule.turns && vals.every((v) => v < rule.lt)) {
      for (const [k, d] of Object.entries(rule.d)) st.hidden[k] = clamp(st.hidden[k] + d, 0, 100);
    }
  }
  for (const k of Object.keys(st.dirCount)) {
    st.dirCount[k] *= T.repetition.directionDecay ?? 1;
    if (st.dirCount[k] < 0.01) delete st.dirCount[k];
  }
  recomputeDerived(st, T);
});
