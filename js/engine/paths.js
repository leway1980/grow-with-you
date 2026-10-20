// 路線（M3 B4；DESIGN §6.0，資料在 data/paths.json）：高中的學制、離家的去向、中途離校的前兆。純函式、無 DOM。
// 原則：興趣是主要的驅動力，成績是次要的，經濟與孩子自己的偏好會調整；卡片文字從不把成績寫成理由；每一條路都不是失敗結局。
// resolveRoute(st, data, decide, prefer)：由命運骰 rngAt(seed, turn, 'route') 決定，同一個種子、同一個回合、同一個偏好，結果相同。
// 登記方式：turn.js 的 prepareData 呼叫 setPaths(raw.events.paths)，這裡把 resolver 登記給 events.js（setRouteResolver），events.js 不必知道路線怎麼算。
// 隱藏數值與 model.json 的結果軸完全不讀 學制／去向（tests/paths.test.mjs、tools/lint-model.mjs）：路線只換文字與後面的事件，不直接改孩子的幸福。
import { rngAt } from './rng.js';
import { setRouteResolver, setCtxHook, fill } from './events.js';

let P = null;
export const getPaths = () => P;
/** turn.js 的 prepareData 呼叫；沒有資料（測試用的最小資料）時不登記任何東西 */
export function setPaths(paths) {
  P = paths && paths.schoolTypes ? paths : null;
  setRouteResolver(P ? hook : null);
  setCtxHook(P ? ctxHook : null);
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const z = (x, m, s) => clamp((x - m) / s, -2, 2);
const keysOf = (tbl) => Object.keys(tbl).filter((k) => !k.startsWith('_'));

/** 決定時的特徵（z 分數，夾在 ±2）。只讀 st，不改。 */
export function featuresOf(st, paths = P) {
  const N = paths.norm, I = st.interest || {}, C = st.child, H = st.hidden, T = st.family.child.temperament, F = st.flags;
  const zi = (k) => z(I[k] ?? N.interest.mean, N.interest.mean, N.interest.sd);
  return {
    手: 0.7 * zi('動手做') + 0.3 * zi('美術'),
    學: 0.5 * zi('閱讀') + 0.5 * zi('科學'),
    績: z(C.成績, N.grade.mean, N.grade.sd),
    緊: st.family.econ === '吃緊' ? 1 : 0,
    寬: st.family.econ === '寬裕' ? 1 : 0,
    離群: clamp((N.peer.cut - C.同學往來) / N.peer.sd, 0, 2),
    霸凌: F.霸凌_發生過 ? 1 : 0,
    堅: clamp((T.堅持度 - 3) / 1.2, -2, 2),
    敏: clamp((T.敏感度 - 3) / 1.2, -2, 2),
    主: z(H.主見, 55, 20),
    承: z(H.承受度, 50, 20),
    低心情: clamp((N.mood.cut - C.心情) / N.mood.sd, 0, 2),
  };
}

/** 孩子自己最強的興趣（理由那句話用）；沒有就是空字串 */
export function topInterest(st, keys) {
  let best = '', v = -1;
  for (const k of keys) if ((st.interest[k] ?? 0) > v) { v = st.interest[k] ?? 0; best = k; }
  return best;
}

/** 對數權重：ln(base) + bias + Σ 係數 × 特徵 × 該組倍率 + 推力 */
function logw(def, base, feats, mult, push) {
  let s = Math.log(base) + (def.bias || 0) + (push || 0);
  for (const [f, [c, g]] of Object.entries(def.coef || {})) s += c * (feats[f] || 0) * (mult[g] ?? 1);
  return s;
}
const normalize = (lw) => {
  const m = Math.max(...Object.values(lw)), e = Object.fromEntries(Object.entries(lw).map(([k, v]) => [k, Math.exp(v - m)]));
  const t = Object.values(e).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, v / t]));
};
const pickByDie = (probs, u) => { let a = 0, last = null; for (const [k, p] of Object.entries(probs)) { if (p <= 0) continue; last = k; a += p; if (u < a) return k; } return last; };

/** 學制的機率（不抽籤）。opts.lean＝某個選項額外的傾向（例如『先填綜合高中』）。 */
export function schoolProbs(st, paths = P, prefer = '孩子', opts = {}) {
  const feats = featuresOf(st, paths), pf = paths.prefer[prefer] || paths.prefer.孩子, lw = {};
  const carry = st.flags.學制_自學 ? paths.selfStudyCarry.push : {};
  for (const k of keysOf(paths.schoolTypes)) {
    const def = paths.schoolTypes[k];
    lw[k] = logw(def, def.base, feats, pf.mult, (pf.push[k] || 0) + (carry[k] || 0) + (opts.lean === k ? (opts.leanW ?? 2.5) : 0));
  }
  return normalize(lw);
}

/** 孩子自己最想走的學制（prefer＝孩子、不受父母推力）；用來判斷父母有沒有蓋過孩子 */
export function childWants(st, paths = P) {
  const pr = schoolProbs(st, paths, '孩子');
  return Object.entries(pr).sort((a, b) => b[1] - a[1])[0][0];
}

export function setSchoolType(st, type, paths = P) {
  for (const k of keysOf(paths.schoolTypes)) for (const f of paths.schoolTypes[k].flags) delete st.flags[f];
  st.vars.學制 = type;
  for (const f of paths.schoolTypes[type].flags) st.flags[f] = true;
  if (type === '自學') { const f = featuresOf(st, paths); st.flags[f.手 > f.學 ? '走技職' : '走學測'] = true; }
}

/** 去向的 prefer 解析：auto＝由高中選學制時的偏好與替他做主的程度換算 */
export function resolvePrefer(st, prefer, paths = P) {
  if (prefer && prefer !== 'auto') return prefer;
  if (st.vars.志願偏好) return st.vars.志願偏好;
  if (st.hidden.替他做主 >= paths.auto.controlAt) return '父母';
  if ((st.tagCounts['讓孩子參與決定'] || 0) >= paths.auto.togetherAt) return '一起';
  return '孩子';
}

/** 去向的機率（不抽籤）。女生的入伍一律是 0。 */
export function destProbs(st, paths = P, prefer = 'auto') {
  const D = paths.destinations, type = st.vars.學制 || '普高', feats = featuresOf(st, paths);
  const pf = paths.destPrefer[resolvePrefer(st, prefer, paths)] || paths.destPrefer.孩子;
  const male = st.family.child.sex === '男', dropMul = paths.afterDropout[st.vars.中途離校] || {}, lw = {};
  for (const d of D.order) {
    const def = D[d], b = (def.base || {})[type];
    if (!(b > 0)) continue;
    if (def.maleOnly && !male) continue;
    lw[d] = logw(def, b, feats, pf.mult, pf.push[d] || 0) + Math.log(dropMul[d] ?? 1);
  }
  if (!Object.keys(lw).length) lw['就業'] = 0; // 保底：沒有任何機率表時（不應該發生）
  return normalize(lw);
}

export function setDestination(st, dest, paths = P) {
  if (dest === '入伍' && st.family.child.sex !== '男') throw new Error('入伍只給男生');
  for (const d of paths.destinations.order) delete st.flags[`去向_${d}`];
  st.vars.去向 = dest;
  st.flags[`去向_${dest}`] = true;
  if (!st.flags.住宿_外地 && !st.flags.住宿_本地) rollHousing(st); // 大學與科大離家那天是住宿或通勤，由種子決定；之後離家的第一張卡的選項可以再改
}

/** 住宿（外地／本地）：只有大學與科大用得到；不依成績。選項（離家的第一張卡）可以再改。 */
export function rollHousing(st) {
  const urban = st.family.urban, away = urban === '偏鄉' || urban === '離島' ? 1.3 : urban === '都會核心' || urban === '都會外圍' ? 0.8 : 1; // 沿用舊卡 leave_pick 的修正：都會 ×0.8、偏鄉 ×1.3
  const p = clamp(0.55 * away * (st.family.econ === '吃緊' ? 0.85 : 1), 0.1, 0.9);
  const out = rngAt(st.seed, st.turn, 'route_housing') < p;
  delete st.flags.住宿_外地; delete st.flags.住宿_本地;
  st.flags[out ? '住宿_外地' : '住宿_本地'] = true;
}

/**
 * 路線的決定（M3 B4）。decide：'學制'（高中）或 '去向'（離家）；prefer：誰的意見大（孩子、一起、父母、距離、親友；去向另有 auto）。
 * 回傳 { value, probs, result? }：result 是要接在選項結果後面的一句話（學制才有）。opts.force＝直接指定結果（測試與反事實用）；opts.lean／leanW＝額外的傾向（某個選項偏向某個學制，例如『先填綜合高中』）。
 */
export function resolveRoute(st, data, decide, prefer = '孩子', opts = {}) {
  if (!P) return null;
  const u = rngAt(st.seed, st.turn, 'route');
  if (decide === '學制') {
    const probs = schoolProbs(st, P, prefer, opts), type = opts.force || pickByDie(probs, u), wants = childWants(st); // wants 要在設旗標之前算（國中自學的旗標會被 setSchoolType 換掉）
    setSchoolType(st, type);
    st.vars.志願偏好 = prefer;
    if (P.override.prefer.includes(prefer) && type !== wants && st.hidden.主見 >= P.override.minAssert) st.flags.志願被決定 = true; else delete st.flags.志願被決定;
    const O = P.outcome[type];
    let why = (O.why && (O.why[topInterest(st, Object.keys(O.why).filter((k) => k !== '_' && k in st.interest))] || O.why._)) || '';
    const F = featuresOf(st);
    for (const w of O.whyIf || []) if (F[w.if]) { why = w.text; break; }
    let result = O.line.replace('{why}', why);
    if (st.flags.志願被決定) result += P.outcome._overridden;
    return { value: type, probs, result: fill(result, st, null) };
  }
  if (decide === '去向') {
    if (st.vars.去向 && !opts.force) return { value: st.vars.去向 }; // 已經決定了（例如中途離校的結果直接指定）
    const probs = destProbs(st, P, prefer), dest = opts.force || pickByDie(probs, u);
    setDestination(st, dest);
    return { value: dest, probs };
  }
  throw new Error(`paths：不認得的 decide「${decide}」`);
}

function hook(st, data, route, env) { return resolveRoute(st, data, route.decide, route.prefer, { lean: route.lean, leanW: route.leanW }); }

/* ───────────── 中途離校的前兆 ───────────── */
/** 最近連續幾個回合心情偏低（讀 vcurves，最多數 6 個） */
export function lowMoodStreak(st, cut) {
  let n = 0;
  for (let i = st.vcurves.length - 1; i >= 0 && n < 6; i--) { if (st.vcurves[i].心情 < cut) n++; else break; }
  return n;
}
/** 有訊號時，這個回合出現前兆的機率；沒有訊號是 0。 */
export function dropoutP(st, paths = P) {
  const D = paths.dropout, C = st.child, F = st.flags;
  const streak = lowMoodStreak(st, D.moodCut);
  const signal = streak >= D.streak || C.同學往來 < D.peer || (F.霸凌_發生過 && C.同學往來 < D.peerBullied);
  if (!signal) return { p: 0, streak };
  const f = featuresOf(st, paths);
  let s = Math.log(D.p0) + Math.max(0, streak - D.streak) * D.streakGain;
  for (const [k, c] of Object.entries(D.coef)) s += c * (f[k] || 0);
  const x = D.stageX[st.vars.學制] ?? 1;
  return { p: clamp(Math.exp(s) * x, 0, D.pMax), streak };
}
function ctxHook(st, tl) {
  if (tl.stage !== '高中') return null;
  const { p, streak } = dropoutP(st);
  return { 心情低連續: streak, 離校機率: p, 離校骰: rngAt(st.seed, st.turn, 'drop_dice') };
}
