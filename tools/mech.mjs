// 機制健康度與黃金範例的紀錄（check-design、golden、impact 共用）。
// 重要：這個檔案只依賴「一局玩完之後的 st」與引擎的舊介面（vars／hist／curves／parentGrowth／buildEnding），
// 因為 tools/impact.mjs 會把它複製到別的 git 版本去跑，那個版本的引擎可能還沒有新的 API。
import { avg, share } from './stats.mjs';

const WINDOW = 6;
/** 在連續 WINDOW 回合內，帶有某標籤的選擇最多出現幾次（§4.33 3C 當保母的連用） */
export function maxInWindow(hist, tag, win = WINDOW) {
  const turns = hist.filter((h) => (h.tags || []).includes(tag)).map((h) => h.turn);
  let best = 0;
  for (let i = 0; i < turns.length; i++) { let j = i; while (j + 1 < turns.length && turns[j + 1] - turns[i] < win) j++; best = Math.max(best, j - i + 1); }
  return best;
}

/** 一局的機制紀錄：每個機制「有沒有發生」與「發生幾次」 */
export function mechRecord(st, data) {
  const hist = st.hist, idx = data.cardIndex;
  const ids = (id) => hist.filter((h) => h.card === id).length;
  const pool = (p) => hist.filter((h) => idx[h.card] && idx[h.card].pool === p).length;
  const approachSeen = hist.filter((h) => idx[h.card] && idx[h.card].approach).length;
  const mode = st.vars.上學方式 || '';
  const gap = st.curves.map((c) => (c.期待壓力 ?? 0) - (c.承受度 ?? 100));
  // 事故前的交通安全認知（只看第一次事故卡之前，避免「出事之後才學會」的反向因果）
  const accTurns = hist.filter((h) => ['cm_scrape', 'cm_near', 'cm_hospital'].includes(h.card)).map((h) => h.turn);
  const firstAcc = accTurns.length ? Math.min(...accTurns) : Infinity;
  const aw = st.curves.filter((c) => c.t < firstAcc).map((c) => c.交通安全認知 ?? 0);
  const relief = hist.filter((h) => (h.tags || []).some((t) => data.tags.tags[t] && data.tags.tags[t].relief)).length;
  return {
    avoid: { ever: (st.vars.不太來找你_曾 ?? (st.vars.不太來找你 ? 1 : 0)) > 0 ? 1 : 0, end: st.vars.不太來找你 ? 1 : 0, approachSeen, exitApproach: st.vars.不太來找你_離開_接住 || 0, exitInitiate: st.vars.不太來找你_離開_主動 || 0, exitAny: (st.vars.不太來找你_離開_接住 || 0) + (st.vars.不太來找你_離開_主動 || 0) > 0 ? 1 : 0 },
    c3: { count: st.tagCounts['3C當保母'] || 0, window: maxInWindow(hist, '3C當保母') },
    acc: { mode, scrape: ids('cm_scrape'), near: ids('cm_near'), hospital: ids('cm_hospital'), any: ids('cm_scrape') + ids('cm_near') + ids('cm_hospital'), any01: accTurns.length ? 1 : 0, awareBefore: aw.length ? aw.reduce((a, b) => a + b, 0) / aw.length : 0 },
    self: { cards: pool('父母自己'), rest: hist.filter((h) => (h.tags || []).includes('父母自己休息')).length, relief },
    growth: { entries: (st.parentGrowth || []).length, hidden: st.hidden.父母的收穫 ?? 0 },
    press: { share: gap.length ? gap.filter((g) => g > 0).length / gap.length : 0, max: gap.length ? Math.max(...gap) : 0 },
  };
}

/* ───── 取值與比較 ───── */
/** 'ax.0'、'mech.avoid.ever' 這樣的路徑從紀錄取值 */
export const getPath = (rec, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), rec);
const cmp = { '>=': (a, b) => a >= b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '<': (a, b) => a < b, '==': (a, b) => a === b };
export const fired = (rec, f) => cmp[f.op](getPath(rec, f.path), f.value);

/** 依機器人分層的差距（發生 − 沒發生）：每個機器人各算一個差距，再用較小那一組的局數當權重平均，避免「懶惰的機器人本來就比較差」混進來 */
export function stratifiedDiff(recs, pred, axis, minGroup = 10) {
  const byBot = {};
  for (const r of recs) (byBot[r.bot] ||= []).push(r);
  let num = 0, den = 0, n1 = 0, n0 = 0;
  for (const g of Object.values(byBot)) {
    const a = g.filter(pred), b = g.filter((r) => !pred(r));
    if (a.length < minGroup || b.length < minGroup) continue;
    const w = Math.min(a.length, b.length);
    num += w * (avg(a.map((r) => getPath(r, axis))) - avg(b.map((r) => getPath(r, axis)))); den += w; n1 += a.length; n0 += b.length;
  }
  return den ? { diff: num / den, n1, n0 } : { diff: NaN, n1: 0, n0: 0 };
}

const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : 'NaN');
const pc = (x) => (x * 100).toFixed(1) + '%';

/**
 * 依 tools/design-targets.json 的 mechanisms 檢查：每個機制的發生率在設計範圍內、方向檢查。
 * 回傳 rows：{ ok, group, name, value, range, note }。recs 是「真人混合」的局。
 */
export function evaluateMechanisms(recs, targets) {
  const rows = [];
  const N = recs.length;
  const add = (ok, group, name, value, range, note = '') => rows.push({ ok, group, name, value, range, note });
  for (const m of targets.mechanisms.rates || []) {
    let pool = m.mode ? recs.filter((r) => r.mech.acc.mode === m.mode) : recs;
    if (m.where) pool = pool.filter((r) => m.where.every((c) => fired(r, c)));
    if (pool.length < (m.minN ?? 30)) { add(false, '機制', m.name, `樣本只有 ${pool.length} 局`, `至少 ${m.minN ?? 30} 局`, m.note || ''); continue; }
    const v = m.kind === 'mean' ? avg(pool.map((r) => getPath(r, m.path))) : share(pool, (r) => fired(r, m.fired));
    const fmt = m.kind === 'mean' ? f2 : pc;
    add((m.min == null || v >= m.min) && (m.max == null || v <= m.max), '機制', m.name + (m.mode || m.where ? `（${pool.length} 局）` : ''), fmt(v), `${m.min == null ? '' : fmt(m.min)}～${m.max == null ? '' : fmt(m.max)}`, m.note || '');
  }
  for (const d of targets.mechanisms.directions || []) {
    const scoped = (d.where || []).length ? recs.filter((x) => d.where.every((c) => fired(x, c))) : recs;
    const r = stratifiedDiff(scoped, (x) => fired(x, d.fired), d.axis, d.minGroup ?? 10);
    const okSample = r.n1 >= (d.minN ?? 30) && r.n0 >= (d.minN ?? 30);
    const signed = d.expect === '-' ? -r.diff : r.diff;
    add(okSample && signed >= d.minDiff, '方向', d.name, okSample ? `${r.diff >= 0 ? '+' : ''}${f2(r.diff)}（發生 ${r.n1} 局、沒發生 ${r.n0} 局）` : `樣本不足（${r.n1}／${r.n0} 局）`, `${d.expect === '-' ? '≤ −' : '≥ +'}${d.minDiff}`, d.note || '');
  }
  return rows;
}
export { WINDOW };

/* ───── 黃金範例 ───── */
const bandOf = (v, B) => (v >= B.good ? 'hi' : v < B.bad ? 'lo' : 'mid');
/** 最長的標籤連用：同一個標籤在連續的選擇裡出現的最長一段（回合差 ≤ 1 算連續），取前三名 */
export function topStreams(hist, n = 3) {
  const runs = {};
  const cnt = {};
  const last = {};
  for (const h of hist) for (const t of new Set(h.tags || [])) {
    cnt[t] = (cnt[t] || 0) + 1;
    const cur = last[t] && h.turn - last[t].turn <= 1 ? last[t].len + 1 : 1;
    last[t] = { turn: h.turn, len: cur };
    runs[t] = Math.max(runs[t] || 0, cur);
  }
  return Object.keys(runs).map((t) => ({ tag: t, run: runs[t], total: cnt[t] })).sort((a, b) => b.run - a.run || b.total - a.total || (a.tag < b.tag ? -1 : 1)).slice(0, n);
}

/** 黃金範例的快照：只放「類別」（幸福區間、三條軸的區間、成就區間、組合、路線）與最長的三個標籤連用 */
export function goldenSnapshot(st, data, ending) {
  const B = (data.model && data.model.bands) || { good: 60, bad: 45 };
  const w = ending.wellbeing, mean = (w.child + w.parent + w.between) / 3;
  return {
    wellbeing: bandOf(mean, B),
    wellbeingParts: [bandOf(w.child, B), bandOf(w.parent, B), bandOf(w.between, B)].join('/'),
    axes: [bandOf(ending.axes.親子, B), bandOf(ending.axes.人際, B), bandOf(ending.axes.學習, B)].join('/'),
    achievement: ending.achievement.scoreWord,
    combo: ending.combo,
    route: ending.route.kind,
    streams: topStreams(st.hist).map((s) => `${s.tag}×${s.run}（共 ${s.total} 次）`),
  };
}
/** 類別的簽名（streams 不算）：改變就需要在 tests/golden/CHANGES.md 交代 */
export const categoryOf = (snap) => ({ wellbeing: snap.wellbeing, wellbeingParts: snap.wellbeingParts, axes: snap.axes, achievement: snap.achievement, combo: snap.combo, route: snap.route });
export function signature(snap) {
  const s = JSON.stringify(categoryOf(snap));
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
