// 行為標籤 → 隱藏數值（DESIGN §3.6）。隱藏數值只能在這個檔案裡被改變：事件卡只寫 tags，換算全部查 data/tags.json 這一份對照表。
// 換算會依情境調整：孩子的階段、重複次數（同標籤短時間內反覆出現會加速）、「父母傳遞的方向」計數、孩子的狀態與氣質。純函式，無 DOM。
import { evalCond } from './events.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
export const HIDDEN_KEYS = (T) => Object.keys(T.hidden);

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

/**
 * 套用一組標籤。回傳 { deltas }：這次每個隱藏數值實際改變了多少（只給結局回頭看用，不會顯示在遊戲中）。
 * opts: { turn, stage, ctx, topic, direction }
 */
export function applyTags(st, tags, T, opts) {
  const deltas = {};
  const { turn, stage, ctx, topic, direction } = opts;
  for (const tag of tags || []) {
    const def = T.tags[tag];
    if (!def) throw new Error('未知的行為標籤: ' + tag);
    let mult = stageMult(def, stage) * modifierFactor(T, tag, ctx);
    // 重複加速：同一個標籤在視窗內反覆出現，影響越來越快
    const rep = T.repetition;
    mult *= Math.min(rep.cap, 1 + rep.per * recentCount(st, tag, turn, T));
    // 方向加速（§3.3）：同一個方向（成績、醫科、檢定……）一直被提到，越來越快；順口的權重比特地小，但不是零
    if (def.dir != null) {
      const key = direction || '_';
      const prior = st.dirCount[key] || 0;
      mult *= Math.min(rep.directionCap, 1 + rep.directionPer * prior);
      st.dirCount[key] = prior + def.dir;
    }
    for (const [k, d] of Object.entries(def.d || {})) {
      const before = st.hidden[k];
      st.hidden[k] = clamp(before + d * mult, 0, 100);
      deltas[k] = (deltas[k] || 0) + (st.hidden[k] - before);
    }
    if (def.interest && topic && topic in st.interest) st.interest[topic] = clamp(st.interest[topic] + (def.interest / 100) * mult, 0, 1);
    st.tagCounts[tag] = (st.tagCounts[tag] || 0) + 1;
  }
  recomputeDerived(st, T);
  return { deltas };
}

/** 承受度：由氣質、安全感、自我效能、親子信任推出（隱藏；不能由選項直接改） */
export function recomputeDerived(st, T) {
  const h = st.hidden, tp = st.family.child.temperament;
  h.承受度 = clamp(50 + (3 - tp.敏感度) * 6 + (h.安全感 - 55) * 0.25 + (h.自我效能 - 50) * 0.25 + (h.親子信任 - 55) * 0.2 - (h.期待壓力 - 30) * 0.1, 0, 100);
}
