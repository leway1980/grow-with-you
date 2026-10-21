// 機制健康度與黃金範例的紀錄（check-design、golden、impact 共用）。
// 重要：這個檔案只依賴「一局玩完之後的 st」與引擎的舊介面（vars／hist／curves／parentGrowth／buildEnding），
// 因為 tools/impact.mjs 會把它複製到別的 git 版本去跑，那個版本的引擎可能還沒有新的 API。
import { avg, share } from './stats.mjs';
import { censorStats, playableEndMonths, censorByStage } from './approach-log.mjs';

const WINDOW = 12; // 個月（A2.5：舊的 6 個國小回合＝12 個月，窗口以月計）
/** 在連續 WINDOW 個月內，帶有某標籤的選擇最多出現幾次（§4.33 3C 當保母的連用）。hist 的每筆要有月齡 m（舊版本的紀錄沒有，由 mechRecord 依時間軸補上） */
export function maxInWindow(hist, tag, win = WINDOW) {
  const turns = hist.filter((h) => (h.tags || []).includes(tag)).map((h) => h.m);
  let best = 0;
  for (let i = 0; i < turns.length; i++) { let j = i; while (j + 1 < turns.length && turns[j + 1] - turns[i] < win) j++; best = Math.max(best, j - i + 1); }
  return best;
}

/** 訊號卡 → 對應的特殊需求（§11 規則 16：訊號卡要多半出現在真的有該狀況的孩子身上） */
export const SIGNAL_COND = { lo_signal_adhd: ['ADHD'], hi_signal_attention: ['ADHD'], hi_signal_reading: ['學習障礙'], lo_signal_read: ['學習障礙'], kid_unclear: ['自閉症', '發展遲緩'], kid_route: ['自閉症'], inf_late_talk: ['自閉症', '發展遲緩'] };
const GEN = /_gen$/;
/** 『消極班級』的後果卡（data/events/classroom.json）：老師投入度低時才會出現 */
export const CLASS_EPISODE = ['cl_noisy', 'cl_bully', 'cl_stamp', 'cl_hate_class'];
/** 一局的機制紀錄：每個機制「有沒有發生」與「發生幾次」 */
export function mechRecord(st, data, extra = {}) {
  const hist = st.hist.map((h) => (h.m != null ? h : { ...h, m: data.timeline[Math.min(h.turn, data.timeline.length - 1)].ageMonths })), idx = data.cardIndex;
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
  const needs = ((st.family && st.family.child && st.family.child.needs) || []).map((n) => n.kind);
  const zero = { entries: 0, eligible: 0, exited: 0 };
  const byStage = extra.approachEpisodes ? censorByStage(extra.approachEpisodes, data) : { elem: zero, teen: zero, jh: zero, sh: zero }; // 右設限的離開比例，依進入的階段分開（tools/approach-log.mjs）
  const cens = byStage.elem; // entries24／elig24／exit24＝國小畢業以前的進入（和 A0 同一個定義）；國中以後的進入另算（teen／jh／sh）
  const base = (id) => SIGNAL_COND[String(id).replace(GEN, '')];
  const sig = hist.filter((h) => base(h.card)).length, sigGen = hist.filter((h) => GEN.test(h.card) && base(h.card)).length;
  const sigOn = hist.filter((h) => base(h.card) && base(h.card).some((k) => needs.includes(k))).length;
  return {
    signal: { by: Object.fromEntries(Object.keys(SIGNAL_COND).flatMap((k) => [k, k + '_gen']).map((k) => [k, ids(k)]).filter(([, n]) => n)), shown: sig, onCond: sigOn, gen: sigGen, hasNeed: needs.some((k) => k !== '資優') ? 1 : 0, share: sig ? sigOn / sig : null },
    avoid: { ever: (st.vars.不太來找你_曾 ?? (st.vars.不太來找你 ? 1 : 0)) > 0 ? 1 : 0, end: st.vars.不太來找你 ? 1 : 0, approachSeen, exitApproach: st.vars.不太來找你_離開_接住 || 0, exitInitiate: st.vars.不太來找你_離開_主動 || 0, exitAny: (st.vars.不太來找你_離開_接住 || 0) + (st.vars.不太來找你_離開_主動 || 0) > 0 ? 1 : 0, entries24: cens.entries, elig24: cens.eligible, exit24: cens.exited, teenEntries: byStage.teen.entries, teenElig: byStage.teen.eligible, teenExit: byStage.teen.exited, jhEntries: byStage.jh.entries, jhElig: byStage.jh.eligible, jhExit: byStage.jh.exited, shEntries: byStage.sh.entries, shElig: byStage.sh.eligible, shExit: byStage.sh.exited },
    c3: { count: st.tagCounts['3C當保母'] || 0, window: maxInWindow(hist, '3C當保母') },
    acc: { mode, scrape: ids('cm_scrape'), near: ids('cm_near'), hospital: ids('cm_hospital'), any: ids('cm_scrape') + ids('cm_near') + ids('cm_hospital'), any01: accTurns.length ? 1 : 0, awareBefore: aw.length ? aw.reduce((a, b) => a + b, 0) / aw.length : 0 },
    self: { cards: pool('父母自己'), rest: hist.filter((h) => (h.tags || []).includes('父母自己休息')).length, relief },
    // 班級共享狀態（§4.38）：episode＝出現過『消極班級』的後果卡（班上很吵、同學欺負沒人處理、聯絡簿只剩蓋章、討厭那一科）；unverified＝沒查證就投訴／施壓的次數
    class: { episode: hist.some((h) => CLASS_EPISODE.includes(h.card)) ? 1 : 0, episodes: hist.filter((h) => CLASS_EPISODE.includes(h.card)).length, unverified: (st.classroom && st.classroom.unverified) || 0, v: st.classroom ? st.classroom.v : 0, resets: st.classroom ? st.classroom.resets : 0 },
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

/** Wilson 95% 信賴區間 */
export function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), w = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - w) / d, (c + w) / d];
}
/**
 * 配對月齡的方向檢查（direction.kind === 'matchedAge'）：處理組＝進入過『不太來找你』的局，量進入後 lag 個月（第一個月齡 ≥ 進入月齡 + lag 的回合）的 hid 值；
 * 對照＝同一個機器人、在同一個回合『還沒進入過』這個狀態的局的平均。每個處理局的差＝它的值 − 同機器人同回合的對照平均（對照不到 minGroup 局的處理局不算）。
 * 判定：平均差的單邊 95% 上界（平均 + 1.645 × 標準誤）< 0（expect '+' 則下界 > 0），而且平均差的幅度 ≥ minDiff。
 */
export function matchedAge(recs, d) {
  const lag = d.lag ?? 12, z = d.z ?? 1.645, minGroup = d.minGroup ?? 10;
  const ctl = {}; // bot → 回合序號 → { s, n }
  const firstEnter = (r) => (r.episodes && r.episodes.length ? Math.min(...r.episodes.map((e) => e.enter)) : null);
  for (const r of recs) {
    if (!r.und) continue;
    const fe = firstEnter(r), c = (ctl[r.bot] ||= []);
    r.und.forEach(([m, v], i) => { if (v == null || (fe != null && fe <= m)) return; const o = (c[i] ||= { s: 0, n: 0 }); o.s += v; o.n++; });
  }
  const diffs = []; let nCtl = 0;
  for (const r of recs) {
    const fe = firstEnter(r);
    if (fe == null || !r.und) continue;
    const i = r.und.findIndex(([m]) => m >= fe + lag);
    if (i < 0 || r.und[i][1] == null) continue;
    const o = ctl[r.bot] && ctl[r.bot][i];
    if (!o || o.n < minGroup) continue;
    diffs.push(r.und[i][1] - o.s / o.n); nCtl += o.n;
  }
  const n = diffs.length, mean = n ? diffs.reduce((a, b) => a + b, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  const se = sd / Math.sqrt(n);
  return { n, nCtl, mean, se, upper: mean + z * se, lower: mean - z * se };
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
    const sum = (path) => pool.reduce((a, r) => a + (getPath(r, path) || 0), 0);
    const v = m.kind === 'ratio' ? sum(m.num) / Math.max(1, sum(m.den)) : m.kind === 'mean' ? avg(pool.map((r) => getPath(r, m.path))) : share(pool, (r) => fired(r, m.fired));
    const fmt = m.kind === 'mean' ? f2 : pc; // ratio 與 share 都用百分比
    const inR = (x) => (m.min == null || x >= m.min) && (m.max == null || x <= m.max);
    let ok = inR(v), pending = false, ci = '';
    if (m.kind !== 'mean' && m.kind !== 'ratio') {
      // 比例用 Wilson 95% 信賴區間判斷：整段區間都在範圍外才算 ✗；子群體不到 200 局而點估計在範圍外（區間有重疊）時只標 △、不擋 CI
      const [lo, hi] = wilson(Math.round(v * pool.length), pool.length);
      ci = `，95% 區間 ${pc(lo)}～${pc(hi)}`;
      const overlap = (m.min == null || hi >= m.min) && (m.max == null || lo <= m.max);
      if (!ok) { if (!overlap) ok = false; else if (pool.length < 200) { pending = true; ok = false; ci += `，只有 ${pool.length} 局（<200）`; } else ok = true; }
    }
    if (m.pending && !ok) pending = true; // 暫時：只報告、不擋 CI（顯示 △）
    if (m.reportOnly) { ok = true; pending = false; }
    rows.push({ ok, pending, group: m.reportOnly ? '機制（僅報告）' : '機制', name: m.name + (m.mode || m.where ? `（${pool.length} 局）` : ''), value: fmt(v) + ci, range: `${m.min == null ? '' : fmt(m.min)}～${m.max == null ? '' : fmt(m.max)}`, note: pending ? (m.pending ? '暫時（pending，只報告不擋 CI）：' : '樣本不足：') + (m.note || '') : m.note || '' });
  }
  for (const d of targets.mechanisms.directions || []) {
    if (d.kind === 'matchedAge') {
      const r = matchedAge(recs, d), okSample = r.n >= (d.minN ?? 30);
      const sign = d.expect === '-' ? -1 : 1, bound = sign < 0 ? r.upper : -r.lower; // 單邊 95% 界限要在正確的一側
      add(okSample && bound < 0 && sign * r.mean >= d.minDiff, '方向', d.name, okSample ? `${r.mean >= 0 ? '+' : ''}${f2(r.mean)}（95% 單邊上界 ${r.upper >= 0 ? '+' : ''}${f2(r.upper)}；處理 ${r.n} 局、對照平均來自 ${r.nCtl} 局次）` : `樣本不足（${r.n} 局）`, `${d.expect === '-' ? '≤ −' : '≥ +'}${d.minDiff} 且單邊 95% 界限 ${d.expect === '-' ? '< 0' : '> 0'}`, d.note || '');
      continue;
    }
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
const bandOf = (v, B, axis = null) => { const T = (axis && B.axes && B.axes[axis]) || B; return v >= T.good ? 'hi' : v < T.bad ? 'lo' : 'mid'; }; // 與 js/engine/ending.js 的 bandOf 同一個規則（三條軸各有自己的門檻）
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
    axes: [bandOf(ending.axes.親子, B, '親子'), bandOf(ending.axes.人際, B, '人際'), bandOf(ending.axes.學習, B, '學習')].join('/'),
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
