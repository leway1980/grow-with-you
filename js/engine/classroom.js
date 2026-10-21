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
  return { grade: 0, parents: 0, v: T.classroom.start.default, resets: 0, hits: 0, unverified: 0, ...newTurnover() };
}
/** 一直換導師（§4.42）的狀態：目前這位導師是第幾次招考補到的（0＝學年開始時的正常分班）、本任期的投訴累積、本學年換了幾次、全部換過幾次、每位補上來的導師的紀錄（hires：量測用）、換導師的紀錄（log：終局『這些年，孩子的班上』用） */
const newTurnover = () => ({ hire: 0, hitsTenure: 0, tenureM: 0, yearChanges: 0, changes: 0, reason: '', checkedTurn: -1, hires: [], log: [] });

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
  closeHire(cl, tl.ageMonths, 'scheduled');
  Object.assign(cl, { hire: 0, hitsTenure: 0, tenureM: tl.ageMonths, yearChanges: 0, reason: '' });
  delete st.flags.導師換人;
  delete st.flags.科目冷掉; // 換了老師，那一科的冷淡從頭算
  return cl;
}

/** 收掉目前這位補上來的導師的紀錄（正常分班的導師沒有 hires 紀錄）：ended＝'quit'（中途離職）、'complaints'（投訴累積後請調）、'scheduled'（學年換班，沒有中途離開） */
function closeHire(cl, m, ended) {
  const h = cl.hires && cl.hires[cl.hires.length - 1];
  if (h && h.endM == null) { h.endM = m; h.ended = ended; }
}
/** 常態亂數（Box–Muller），命運骰：只由 (種子, 回合, 原因) 決定 */
const gaussAt = (seed, turn, salt) => Math.sqrt(-2 * Math.log(Math.max(1e-9, rngAt(seed, turn, salt + ':a')))) * Math.cos(2 * Math.PI * rngAt(seed, turn, salt + ':b'));

/**
 * 學年中換導師（DESIGN §4.42）：導師請調、留職停薪或離職，學校補上新導師。新導師的投入度依『第幾次招考補到』抽（命運骰，和玩家的選擇無關）：
 * 越後面補到，平均越低、範圍越寬，但每一輪都有 devotedP 的機率是很用心的老師（階段基準 + devotedOffset）。班上常投訴的家長不變，所以起點仍扣 perParent × 人數。
 */
export function changeTeacher(st, T, tl, reason) {
  const C = T.classroom, TO = C.turnover, cl = st.classroom;
  const n = cl.changes, nr = TO.hireRoundW.length;
  let x = rngAt(st.seed, tl.turn, 'cl_round:' + n) * TO.hireRoundW.reduce((a, b) => a + b, 0), round = nr;
  for (let i = 0; i < nr; i++) { x -= TO.hireRoundW[i]; if (x < 0) { round = i + 1; break; } }
  const base = C.start.base[tl.stage] ?? C.start.default;
  const devoted = rngAt(st.seed, tl.turn, 'cl_dev:' + n) < TO.devotedP[round - 1];
  const z = gaussAt(st.seed, tl.turn, 'cl_z:' + n);
  const v0 = devoted ? base + TO.devotedOffset + TO.devotedSd * z : base + TO.offset[round - 1] + TO.sd[round - 1] * z;
  closeHire(cl, tl.ageMonths, reason === 'quit' ? 'quit' : 'complaints');
  cl.hires.push({ round, v0: Math.round(v0 * 10) / 10, devoted: v0 >= base + TO.devotedFrom, startM: tl.ageMonths, endM: null, ended: null, reason });
  cl.v = clamp(v0 - C.start.perParent * cl.parents, C.min, C.max);
  Object.assign(cl, { hire: round, hitsTenure: 0, tenureM: tl.ageMonths, reason });
  cl.changes++; cl.yearChanges++;
  cl.log.push({ m: tl.ageMonths, grade: tl.grade, reason, round });
  st.vars.導師換人次數 = cl.changes;
  st.flags.導師換人 = true; // 池『導師更換』的通知卡讀它，卡片選完清掉
  delete st.flags.科目冷掉;
  return cl;
}

/** 回合開始時呼叫：年級換到換老師的年級就重置（冪等：同一個年級只重置一次）；沒有重置的回合，檢查學年中換導師（命運骰：投訴累積 → 請調；補上來的導師 → 中途離職） */
export function syncClassroom(st, data, tl) {
  const T = data.tags, cl = (st.classroom ||= newClassroom(T));
  for (const [k, v] of Object.entries(newTurnover())) if (cl[k] === undefined) cl[k] = v; // 舊存檔補欄位
  if (tl.grade > 0 && T.classroom.teacherGrades.includes(tl.grade) && cl.grade !== tl.grade) { resetClassroom(st, T, tl, 'teacher'); cl.checkedTurn = tl.turn; return; }
  const TO = T.classroom.turnover;
  if (!TO || tl.grade <= 0 || cl.grade === 0 || cl.checkedTurn === tl.turn || tl.ageMonths - cl.tenureM < TO.minTenureMonths) return;
  cl.checkedTurn = tl.turn;
  const X = TO.hazardX ?? 1, span = tl.span ?? 2;
  const hc = Math.min(TO.hazardMax, TO.hazardBaseMonth + TO.perComplaint * cl.hitsTenure + TO.perParent * cl.parents) * X;
  if (rngAt(st.seed, tl.turn, 'cl_change') < 1 - Math.pow(1 - hc, span)) { changeTeacher(st, T, tl, 'complaints'); return; }
  if (cl.hire > 0 && rngAt(st.seed, tl.turn, 'cl_quit') < 1 - Math.pow(1 - TO.quitMonth[cl.hire - 1] * X, span)) changeTeacher(st, T, tl, 'quit');
}

/** 回合結束時：背景下滑（每位常投訴的家長每月 dropPerParentMonth 點）＋ 那一科冷掉（成績與心情慢慢掉，換老師才停） */
export function driftClassroom(st, data, tl) {
  const C = data.tags.classroom, cl = st.classroom;
  if (!cl || tl.grade === 0) return;
  const sp = tl.span ?? 2;
  cl.v = clamp(cl.v - C.dropPerParentMonth * cl.parents * sp, C.min, C.max);
  if (cl.yearChanges > 0 && C.turnover) { // 一直換導師（§4.42）：本學年每多換一位，成績、同學往來、心情每月往下
    const H = C.turnover.harm;
    st.child.成績 = clamp(st.child.成績 - H.成績 * cl.yearChanges * sp, 0, 100);
    st.child.同學往來 = clamp(st.child.同學往來 - H.同學往來 * cl.yearChanges * sp, 0, 100);
    st.child.心情 = clamp(st.child.心情 - H.心情 * cl.yearChanges * sp, 0, 100);
  }
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
    if (e.d < 0) { cl.hits++; cl.hitsTenure = (cl.hitsTenure || 0) + (e.unverified && T.classroom.turnover ? T.classroom.turnover.unverifiedW : 1); if (e.unverified) cl.unverified++; }
  }
  cl.v = clamp(cl.v + total, T.classroom.min, T.classroom.max);
  return total;
}

/** 條件環境用：老師投入度（取整）與班上常投訴的家長人數 */
export const classroomCtx = (st) => ({
  老師投入度: Math.round(st.classroom ? st.classroom.v : 70), 班上投訴家長: st.classroom ? st.classroom.parents : 0,
  導師招考次數: st.classroom ? st.classroom.hire || 0 : 0, 導師換人_本年: st.classroom ? st.classroom.yearChanges || 0 : 0, 導師換人次數: st.classroom ? st.classroom.changes || 0 : 0, 導師離職: !!(st.classroom && st.classroom.reason === 'quit'), // 一直換導師（§4.42）
});
