// 決定鏈（M3 B5；DESIGN §11『終局揭露的主軸』、M3 計畫 §2.5、§8 第 7 項；資料在 data/chains.json、data/research.json）。純函式、無 DOM。
// 把 hist 和 autoLog（習慣自動帶入，權重 0.5，標『（習慣）』並列出形成這個習慣的國小選擇）裡同一主題、同一個方向的選擇串成一段，
// 窗口以月齡計（回合長短不影響），挑出影響最大的 3–5 條，至少一條往好的方向轉（如果有的話）。
// 每條鏈：年齡區間、當時的處境、三到五個選擇、被推得最多的隱藏數值（前後曲線）、後來留下的痕跡、研究小卡。
// 另外 classroomSummary：『這些年，孩子的班上』——只陳述發生過的事，不下結論。
import { estimateDeltas } from './ending.js';
import { outcomeWeights } from './model.js';

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const OUTCOMES = ['親子', '人際', '學習', '孩子幸福', '彼此之間'];

/* ───── 小工具 ───── */
const fillName = (text, st) => (text || '').replace(/\{孩子\}/g, st.family.child.given).replace(/\{他\}/g, st.family.child.pronoun || '他').replace(/\{你爸媽\}/g, st.role || '你');
/** 『4–6 歲』：月齡區間 → 歲數區間（同一歲就只寫一個；不到一歲寫『剛出生的第一年』） */
export function agesLabel(m0, m1) {
  const a = Math.floor(m0 / 12), b = Math.floor(m1 / 12);
  if (b === 0) return '剛出生的第一年';
  return a === b ? `${a} 歲` : `${a}–${b} 歲`;
}
const ageAt = (m) => (m < 12 ? '還不到一歲' : `${Math.floor(m / 12)} 歲`);
const GRADES = ['小一', '小二', '小三', '小四', '小五', '小六', '國一', '國二', '國三', '高一', '高二', '高三'];
export const gradeName = (g) => GRADES[g - 1] || '';
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const firstSentence = (s) => { const m = (s || '').match(/^[^。！？]*[。！？」]?/); return (m ? m[0] : s || '').trim(); };

/** 主題的 habit 可以是一個家族名稱或一串家族名稱（3C 規則：手機規則＋餐桌）；空字串＝沒有 */
const habitsOf = (theme) => [].concat(theme.habit || []).filter(Boolean);

/* ───── 一個選擇屬於哪個主題、往哪個方向 ───── */
function inWhere(theme, card, h) {
  const w = theme.where;
  if (!w) return true;
  if (w.pools && card && w.pools.includes(card.pool)) return true;
  if (w.cards && w.cards.includes(h.card)) return true;
  if (w.habits && card && card.habit && w.habits.includes(card.habit)) return true;
  return false;
}
/** +1／−1／0（不屬於這個主題，或好壞抵消）。tags＝這個選擇的標籤 */
export function signOf(theme, card, h, tags) {
  const pos = theme.tags['+'] || [], neg = theme.tags['-'] || [];
  const always = theme.always || [];
  const hit = tags.some((t) => always.includes(t));
  if (!hit && !inWhere(theme, card, h)) return 0;
  const p = tags.filter((t) => pos.includes(t)).length, n = tags.filter((t) => neg.includes(t)).length;
  return p > n ? 1 : n > p ? -1 : 0;
}

/** 每個隱藏數值對『結果』的總權重（五個結果軸的線性權重相加）：給鏈的影響大小用 */
function nodeWeights(M) {
  const W = outcomeWeights(M), out = {};
  for (const ax of OUTCOMES) for (const [k, w] of Object.entries(W[ax] || {})) out[k] = (out[k] || 0) + w;
  return out;
}

/** hist ∪ autoLog 裡屬於某主題的選擇，依月齡排序 */
function themeEvents(st, data, name, theme, C) {
  const out = [];
  for (const h of st.hist) {
    const card = data.cardIndex[h.card];
    const tags = h.tags || [];
    const sign = signOf(theme, card, h, tags);
    if (!sign) continue;
    out.push({ key: `h:${h.turn}:${h.card}`, turn: h.turn, m: h.m ?? data.timeline[h.turn].ageMonths, sign, w: 1, auto: false, text: h.label, title: h.title, tags, card: h.card, ch: h.ch, stage: data.timeline[h.turn].stage });
  }
  const fams = habitsOf(theme);
  if (fams.length) {
    for (const a of st.autoLog || []) {
      if (!fams.includes(a.family) || !a.tags || !a.tags.length) continue;
      const sign = signOf({ ...theme, where: null }, null, {}, a.tags);
      if (!sign) continue;
      const tl = data.timeline[a.turn];
      out.push({ key: `a:${a.turn}:${a.family}`, turn: a.turn, m: tl.ageMonths, sign, w: C.settings.autoWeight, auto: true, text: '（習慣）' + a.line, title: a.family, tags: a.tags, family: a.family, pattern: a.pattern, stage: tl.stage });
    }
  }
  return out.sort((x, y) => x.m - y.m || x.turn - y.turn);
}

/**
 * 同方向的選擇串成一段（窗口以月齡計）：從某一次起，把 windowMonths 之內同方向的選擇收進來；
 * 這段時間裡同主題、相反方向的選擇不能比它多（多了就是兩邊拉扯，不算一條鏈）。收到 minRun 次以上才成立；成立後從這一段的下一次重新算。
 * 『連續』指的是這個主題的選擇裡沒有被相反的做法蓋過，不是每一次都要一樣——現實的家長不會每次都做一樣的事。
 */
export function runsOf(events, C) {
  const { minRun, windowMonths } = C.settings;
  const runs = [];
  for (const sign of [1, -1]) {
    const own = events.filter((e) => e.sign === sign), opp = events.filter((e) => e.sign === -sign);
    let i = 0;
    while (i < own.length) {
      const items = own.filter((e, k) => k >= i && e.m - own[i].m < windowMonths);
      const span = [items[0].m, items[items.length - 1].m];
      const against = opp.filter((e) => e.m >= span[0] && e.m <= span[1]).reduce((a, e) => a + e.w, 0);
      const mine = items.reduce((a, e) => a + e.w, 0);
      if (items.length >= minRun && against < mine) { runs.push({ sign, items }); i += items.length; } else i++;
    }
  }
  return runs;
}

/* ───── 一段的內容 ───── */
const tired = (rows) => 100 - mean(rows.map((c) => (c.體力 + c.耐心) / 2));
function situationOf(st, data, m0, m1) {
  const rows = st.vcurves.filter((c) => c.m >= m0 - 3 && c.m <= m1 + 3);
  const f = st.family, work = [], state = [];
  const sib = (f.siblings || []).find((s) => s.arriveMonths != null && s.arriveMonths >= m0 - 6 && s.arriveMonths <= m1);
  if (f.rank === '主管' && m1 >= 12 * 3) work.push('你是主管');
  else if (f.rank === '自己當老闆' && m1 >= 12 * 3) work.push('你自己當老闆');
  const pat = data.identities.patterns && data.identities.patterns[f.pattern];
  if (pat && ['輪班', '常加班', '晚上工作', '常出差'].includes(f.pattern)) work.push(pat.line);
  if (rows.length) {
    const t = tired(rows);
    state.push(t >= 60 ? '常常很累' : t >= 45 ? '有點累' : '還有餘力');
    if (mean(rows.map((c) => c.錢)) < 35) state.push('家裡的錢很吃緊');
    if (f.partner.present && mean(rows.map((c) => c.夫妻關係)) < 35) state.push('和另一半之間很緊繃');
    if (mean(rows.map((c) => c.工作表現)) < 35) state.push('工作上壓力很大');
  }
  if (!f.partner.present) state.push('多半是你一個人撐著');
  if (sib) state.push(`${sib.rel}剛來到家裡`);
  const out = [];
  if (work.length) out.push(work.join('，') + '。');
  if (state.length) out.push('那段時間你' + state[0] + (state.length > 1 ? '，' + state.slice(1).join('，') : '') + '。');
  return out.join('');
}

/** 被這段選擇推得最多的隱藏數值：前後的曲線（整個童年的點，加上這一段的起訖） */
function curveOf(st, data, items, m0, m1, T, W, C, forced = null) {
  const stage = (e) => e.stage;
  const acc = {};
  for (const e of items) for (const [k, d] of Object.entries(estimateDeltas(e.tags, stage(e), T))) acc[k] = (acc[k] || 0) + d * e.w;
  const cands = (forced ? [[forced, acc[forced] || 0]] : Object.entries(acc)).filter(([k]) => st.curves.length && st.curves[0][k] != null).sort((a, b) => Math.abs(b[1] * (W[b[0]] || 0.2)) - Math.abs(a[1] * (W[a[0]] || 0.2))).slice(0, 4);
  if (!cands.length || !st.curves.length) return null;
  const rows = st.curves;
  const before = (m) => { let r = rows[0]; for (const c of rows) { if (c.m <= m) r = c; else break; } return r; };
  const after = (m) => rows.find((c) => c.m >= m) || rows[rows.length - 1];
  let best = null;
  for (const [k, d] of cands) {
    const r0 = before(m0), r1 = after(m1 + 6), move = r1[k] - r0[k];
    const aligned = Math.sign(move) === Math.sign(d) && Math.abs(move) >= 1;
    const score = Math.abs(move) + (aligned ? 100 : 0);
    if (!best || score > best.score) best = { k, r0, r1, move, score };
  }
  const k = best.k, step = Math.max(1, Math.ceil(rows.length / C.settings.sparkPoints));
  const pts = rows.filter((c, i) => i % step === 0 || i === rows.length - 1).map((c) => ({ m: c.m, v: c[k] }));
  return { node: k, m0: best.r0.m, m1: best.r1.m, v0: Math.round(best.r0[k]), v1: Math.round(best.r1[k]), up: best.move > 0, pts };
}

/** 隱藏數值整個童年的走勢（只寫事實：最高的時候與最後的值；DESIGN §4.39 終局『3C 規則』讀依賴度的走勢）。沒有曲線就是空字串 */
export function trajectoryOf(st, node) {
  const rows = (st.curves || []).filter((c) => c[node] != null);
  if (rows.length < 2) return '';
  const peak = rows.reduce((a, c) => (c[node] > a[node] ? c : a), rows[0]), last = rows[rows.length - 1];
  const nm = st.family.child.given;
  return peak.m === last.m || last[node] >= peak[node] - 2
    ? `${nm}${ageAt(last.m)}時是 ${Math.round(last[node])}，這一路是往上走的。`
    : `${nm}${ageAt(peak.m)}時最高，是 ${Math.round(peak[node])}；${ageAt(last.m)}時是 ${Math.round(last[node])}。`;
}

/** 後來留下的痕跡：第一張之後出現、標了 traceOf: 主題 的卡；沒有就用習慣句（鏈結束超過 traceAfterMonths 之後的第一句） */
function traceOf(st, data, name, theme, endM, C) {
  for (const h of st.hist) {
    const card = data.cardIndex[h.card];
    const m = h.m ?? data.timeline[h.turn].ageMonths;
    if (!card || ![].concat(card.traceOf || []).includes(name) || m <= endM) continue;
    const ch = card.choices[h.ch];
    const reply = ch && ch.result ? firstSentence(fillName(ch.result, st)) : '';
    return { kind: 'card', age: ageAt(m), m, title: h.title, text: `${ageAt(m)}，「${fillName(h.title, st)}」${reply && !/[{}]/.test(reply) ? '：' + reply : ''}` };
  }
  if (habitsOf(theme).length) {
    const a = (st.autoLog || []).find((x) => habitsOf(theme).includes(x.family) && x.tags && x.tags.length && data.timeline[x.turn].ageMonths >= endM + C.settings.traceAfterMonths);
    if (a) { const m = data.timeline[a.turn].ageMonths; return { kind: 'habit', age: ageAt(m), m, text: `${ageAt(m)}，${a.line}（習慣）` }; }
  }
  return null;
}

/** 習慣是之前的哪幾個選擇形成的（§8 第 7 項）：這個家族的卡上、含自動帶入的標籤的選擇（國小以前；換過習慣的人加上國中以後換習慣的那幾次），在這次自動帶入之前，最多 3 個 */
function formedBy(st, data, theme, e) {
  const out = [];
  const lb = (data.habits && data.habits.lookback) || {};
  const fam = e.family;
  const flipped = !!(st.habits && st.habits[fam] && st.habits[fam].flipped);
  for (const h of st.hist) {
    const card = data.cardIndex[h.card];
    if (!card || card.habit !== fam || h.turn >= e.turn) continue;
    const stage = data.timeline[h.turn].stage;
    if (!lb[stage] && !(flipped && (stage === '國中' || stage === '高中'))) continue;
    if (!(h.tags || []).some((t) => e.tags.includes(t))) continue;
    out.push({ age: ageAt(h.m ?? data.timeline[h.turn].ageMonths), text: clip(fillName(h.label, st), 40) });
  }
  return out.slice(-3);
}

function researchOf(data, theme, endM) {
  const R = data.research && data.research.cards;
  if (!R) return null;
  const late = theme.researchLate && endM >= theme.researchLate.fromMonths ? theme.researchLate.id : null;
  return R[late || theme.research] || R[theme.research] || null;
}

/** 一個主題的所有候選鏈 */
function candidatesOf(st, data, name, theme, C, W) {
  const T = data.tags, out = [];
  for (const run of runsOf(themeEvents(st, data, name, theme, C), C)) {
    const items = run.items, m0 = items[0].m, m1 = items[items.length - 1].m;
    const score = items.reduce((a, e) => a + e.w * Object.entries(estimateDeltas(e.tags, e.stage, T)).reduce((s, [k, d]) => s + d * (W[k] || 0), 0), 0);
    out.push({ theme: name, label: theme.label, sign: run.sign, positive: run.sign > 0, items, m0, m1, score, mag: Math.abs(score) });
  }
  return out;
}

/** 內容：把一條候選鏈寫成可顯示的樣子 */
function describe(st, data, c, theme, C, W) {
  const pick = (items) => {
    if (items.length <= 5) return items;
    const idx = [0, 1, 2, 3, 4].map((i) => Math.round((i * (items.length - 1)) / 4));
    return [...new Set(idx)].map((i) => items[i]);
  };
  // 習慣每次帶入的句子都一樣：第一次寫完整，之後寫『一樣照平常那樣』；形成這個習慣的國小選擇只列在第一次
  const seen = new Set();
  const choices = pick(c.items).map((e) => {
    const age = ageAt(e.m);
    if (!e.auto) return { age, text: clip(fillName(e.text, st), 48), auto: false };
    const again = seen.has(e.text);
    seen.add(e.text);
    return again ? { age, text: '（習慣）一樣照平常那樣。', auto: true } : { age, text: clip(fillName(e.text, st), 70), auto: true, formedBy: formedBy(st, data, theme, e) };
  });
  return {
    theme: c.theme, label: c.label, positive: c.positive, n: c.items.length, autoN: c.items.filter((e) => e.auto).length,
    ages: agesLabel(c.m0, c.m1), m0: c.m0, m1: c.m1,
    situation: situationOf(st, data, c.m0, c.m1),
    choices,
    curve: curveOf(st, data, c.items, c.m0, c.m1, data.tags, W, C, theme.curveNode || null),
    trajectory: theme.curveNode ? trajectoryOf(st, theme.curveNode) : '',
    trace: traceOf(st, data, c.theme, theme, c.m1, C),
    research: researchOf(data, theme, c.m1),
    note: theme.note || '',
    score: Math.round(c.score * 10) / 10,
  };
}

/** 選 3–5 條：依影響大小；同一個主題、同一個方向只留一條；和已選的共用兩個以上的選擇就跳過；至少一條往好的方向轉（如果有的話） */
export function pickChains(cands, C) {
  const { max, atLeastOnePositive } = C.settings.pick;
  const sorted = [...cands].sort((a, b) => b.mag - a.mag);
  const chosen = [];
  const ok = (c) => !chosen.some((x) => (x.theme === c.theme && x.sign === c.sign) || x.items.filter((e) => c.items.some((f) => f.key === e.key)).length >= 2);
  for (const c of sorted) { if (chosen.length >= max) break; if (ok(c)) chosen.push(c); }
  if (atLeastOnePositive && !chosen.some((c) => c.positive)) {
    const p = sorted.find((c) => c.positive && ok({ ...c, theme: '' }));
    if (p) { if (chosen.length >= max) chosen.pop(); chosen.push(p); }
  }
  return chosen.sort((a, b) => a.m0 - b.m0);
}

/** 決定鏈：{ chains（最多 5 條，依年齡排序）, all（所有候選，統計用） }。沒有 data/chains.json 就是空的 */
export function buildChains(st, data) {
  const C = data.chains;
  if (!C) return { chains: [], all: 0 };
  const W = nodeWeights(data.model);
  const cands = [];
  for (const [name, theme] of Object.entries(C.themes)) cands.push(...candidatesOf(st, data, name, theme, C, W));
  const picked = pickChains(cands, C);
  return { chains: picked.map((c) => describe(st, data, c, C.themes[c.theme], C, W)), all: cands.length, cands };
}

/* ───── 這些年，孩子的班上（DESIGN §1 第二主軸）：只陳述，不下結論 ───── */
export function classroomSummary(st, data) {
  const C = (data.chains && data.chains.classroom) || { reportTags: [], reportPools: [], eventPools: [], maxReplies: 4 };
  const low = ((data.tags.classroom || {}).lowBelow) ?? 45;
  const log = st.classLog || [];
  // 老師投入度偏低的年級：同一個年級（小三、國一……）內的平均低於門檻
  const byGrade = new Map();
  for (const r of log) { const a = byGrade.get(r.grade) || []; a.push(r); byGrade.set(r.grade, a); }
  const lowGrades = [...byGrade.entries()].filter(([, rows]) => mean(rows.map((r) => r.v)) < low).map(([g]) => g).sort((a, b) => a - b);
  const coldGrades = [...byGrade.entries()].filter(([, rows]) => rows.some((r) => r.cold)).map(([g]) => g).sort((a, b) => a - b);
  // 投訴或反映：班級類的卡上，選了 reportTags 的選擇
  const reports = [], events = [];
  for (const h of st.hist) {
    const card = data.cardIndex[h.card];
    if (!card) continue;
    const m = h.m ?? data.timeline[h.turn].ageMonths;
    if (C.reportPools.includes(card.pool) && (h.tags || []).some((t) => C.reportTags.includes(t))) {
      const ch = card.choices[h.ch];
      const reply = ch && ch.result ? firstSentence(fillName(ch.result, st)) : '';
      reports.push({ age: ageAt(m), text: clip(fillName(h.label, st), 40), reply: /[{}]/.test(reply) ? '' : reply });
    }
    if (C.eventPools.includes(card.pool)) events.push({ age: ageAt(m), title: fillName(card.title, st).replace(/[「」]/g, '') });
  }
  const names = (gs) => gs.map(gradeName).join('、');
  const reached = log.length > 0;
  const lines = [];
  lines.push(!reached ? '這一版還沒有玩到入學，班上的事沒有記錄。' : lowGrades.length ? `老師比較消極、投入度偏低的年級：${names(lowGrades)}。` : '沒有哪一個年級的老師投入度偏低。');
  lines.push(reports.length ? `你向學校投訴或反映了 ${reports.length} 次。` : '你沒有向學校投訴或反映過。');
  const replies = reports.filter((r) => r.reply).slice(0, C.maxReplies);
  if (replies.length) lines.push('得到的回覆：' + replies.map((r) => `${r.age}，${r.reply}`).join(' '));
  if (events.length) lines.push('班上被記下來的事：' + events.map((e) => `${e.age}「${e.title}」`).join('、') + '。');
  lines.push(!reached ? '' : coldGrades.length ? `${st.family.child.given}後來不想上某一科的年級：${names(coldGrades)}。` : `${st.family.child.given}沒有變得討厭某一科。`);
  return { lowGrades: lowGrades.map(gradeName), reports, replies, events, coldGrades: coldGrades.map(gradeName), lines: lines.filter(Boolean) };
}
