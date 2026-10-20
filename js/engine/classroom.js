// 班級共享狀態（DESIGN §4.38）：老師投入度（0–100）。不是孩子的隱藏數值，不進結果模型；
// 它只經由因果圖的一條邊（老師投入度 → 班級風氣，data/model.json）慢慢推班級風氣。
// 換老師（小一、小三、小五、國一、高一，或轉班）時重置：先抽「班上常投訴的家長」人數，起點與背景下滑速度都由它決定。
// 玩家的做法：標籤自己帶的 classroom 效果（data/tags.json）。全部數字是設計估計（見 tags.json 的 classroom）。純函式、無 DOM。
import { rngAt } from './rng.js';
import { evalCond } from './events.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** 『對方家長在不在意』的機率（設計估計）：被輔導室提醒之後，對方真的有回應的機率；有人私下關心過是 CARE_P_CONCERNED */
export const CARE_P = 0.3;
export const CARE_P_CONCERNED = 0.5;
export const classroomCfg = (T) => T.classroom;

export function newClassroom(T) {
  return { grade: 0, parents: 0, v: T.classroom.start.default, resets: 0, hits: 0, unverified: 0 };
}

/** 抽「班上常投訴的家長」人數：0、1、2、3（以上）。命運骰：只由 (種子, 回合, 原因) 決定，和玩家的選擇無關 */
export function rollParents(seed, turn, salt, weights) {
  let x = rngAt(seed, turn, 'classroom:' + salt) * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < weights.length; i++) { x -= weights[i]; if (x < 0) return i; }
  return weights.length - 1;
}

/** 重置：換了老師（或轉班）。起點＝這個階段的基準 − 每位常投訴的家長 × perParent */
export function resetClassroom(st, T, tl, reason) {
  const C = T.classroom, cl = (st.classroom ||= newClassroom(T));
  const parents = rollParents(st.seed, tl.turn, reason + ':' + tl.grade, C.parentWeights);
  const base = C.start.base[tl.stage] ?? C.start.default;
  cl.parents = parents;
  cl.v = clamp(base - C.start.perParent * parents, C.min, C.max);
  cl.grade = tl.grade;
  cl.resets++;
  delete st.flags.科目冷掉; // 換了老師，那一科的冷淡從頭算
  return cl;
}

/** 回合開始時呼叫：年級換到換老師的年級就重置（冪等：同一個年級只重置一次） */
export function syncClassroom(st, data, tl) {
  const T = data.tags, cl = (st.classroom ||= newClassroom(T));
  if (tl.grade > 0 && T.classroom.teacherGrades.includes(tl.grade) && cl.grade !== tl.grade) resetClassroom(st, T, tl, 'teacher');
}

/** 回合結束時：背景下滑（每位常投訴的家長每月 dropPerParentMonth 點）＋ 那一科冷掉（成績與心情慢慢掉，換老師才停） */
export function driftClassroom(st, data, tl) {
  const C = data.tags.classroom, cl = st.classroom;
  if (!cl || tl.grade === 0) return;
  const sp = tl.span ?? 2;
  cl.v = clamp(cl.v - C.dropPerParentMonth * cl.parents * sp, C.min, C.max);
  if (st.flags.科目冷掉) {
    st.child.成績 = clamp(st.child.成績 - C.coolDown.成績 * sp, 0, 100);
    st.child.心情 = clamp(st.child.心情 - C.coolDown.心情 * sp, 0, 100);
  }
}

/** 玩家的做法：每個標籤自己帶的 classroom 效果（{d, when?}）。k＝這張卡的劑量倍率。回傳這次的變化量 */
export function applyClassroomTags(st, tags, T, ctx, k = 1) {
  const cl = st.classroom;
  if (!cl) return 0;
  let total = 0;
  for (const t of tags || []) {
    const e = T.tags[t] && T.tags[t].classroom;
    if (!e || (e.when && !evalCond(e.when, ctx))) continue;
    total += e.d * k;
    if (e.d < 0) { cl.hits++; if (e.unverified) cl.unverified++; }
  }
  cl.v = clamp(cl.v + total, T.classroom.min, T.classroom.max);
  return total;
}

/** 條件環境用：老師投入度（取整）與班上常投訴的家長人數 */
export const classroomCtx = (st) => ({ 老師投入度: Math.round(st.classroom ? st.classroom.v : 70), 班上投訴家長: st.classroom ? st.classroom.parents : 0 });
