// DESIGN §11 規則 11「表面對等」的靜態檢查（資料驅動：標記詞、門檻都在 data/tags.json 的 cardRules）。
// 研究支持的選項＝帶有任何 research:true 標籤的選項。
// (a) 一張卡裡研究選項不能是『嚴格最長』，除非有非研究選項只短 1 字以內；全體卡片中這種卡的比例 ≤ researchLongestMax。
// (b) 研究選項含標記詞（蹲下來、聽完…）時，同一張卡至少一個非研究選項也要含標記詞。
// (c) 逐檔回報指標（tools/surface.mjs 也用）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './data-node.mjs';

const len = (s) => [...String(s || '')].length;

/** 卡片 id → 事件檔名（讀 data/manifest.json 與各檔；讀不到的卡回傳 undefined） */
export function cardFileMap() {
  const rd = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
  const map = {};
  for (const f of rd('manifest.json').events) for (const c of rd(f).cards || []) map[c.id] = f.replace(/^events\//, '').replace(/\.json$/, '');
  return map;
}

export function analyzeCard(c, T) {
  const R = T.cardRules, research = (ch) => (ch.tags || []).some((t) => T.tags[t] && T.tags[t].research === true);
  const marks = R.markerWords || [];
  const has = (ch) => marks.filter((w) => String(ch.label || '').includes(w));
  const chs = c.choices || [];
  const rs = chs.filter(research), nr = chs.filter((ch) => !research(ch));
  if (!rs.length || !nr.length) return null;
  const L = chs.map((ch) => len(ch.label)), max = Math.max(...L);
  const rLong = rs.filter((ch) => len(ch.label) === max && L.filter((x) => x === max).length === 1);
  const strictlyLongest = rLong.length > 0;
  const nrMax = Math.max(...nr.map((ch) => len(ch.label)));
  const longFail = strictlyLongest && nrMax < max - 1;
  const rMarks = [...new Set(rs.flatMap(has))];
  const markFail = rMarks.length > 0 && !nr.some((ch) => has(ch).length);
  return { id: c.id, strictlyLongest, longFail, markFail, rMarks };
}

/** { perFile: {file: {cards, strictly, longFail, longShare, markFail}}, total, errors:[], longShare } */
export function rule11(cards, T, fileOf = {}) {
  const R = T.cardRules, max = R.researchLongestMax ?? 0.3;
  const perFile = {}, errors = [], total = { cards: 0, strictly: 0, longFail: 0, markFail: 0 };
  const failCards = [];
  for (const c of cards) {
    const a = analyzeCard(c, T);
    if (!a) continue;
    const f = fileOf[c.id] || '(?)', p = (perFile[f] ||= { cards: 0, strictly: 0, longFail: 0, markFail: 0 });
    for (const o of [p, total]) { o.cards++; o.strictly += a.strictlyLongest; o.longFail += a.longFail; o.markFail += a.markFail; }
    if (a.markFail) { errors.push(`卡片 ${c.id}：規則 11(b)：研究選項用了「${a.rMarks.join('、')}」，同一張卡的非研究選項都沒有標記詞`); failCards.push(c.id); }
    if (a.longFail) failCards.push(c.id);
  }
  for (const p of [...Object.values(perFile), total]) p.longShare = p.cards ? p.longFail / p.cards : 0;
  if (total.longShare > max) errors.unshift(`規則 11(a)：研究選項是『嚴格最長』（且沒有非研究選項只短 1 字內）的卡占 ${(total.longShare * 100).toFixed(1)}%（${total.longFail}/${total.cards}），上限 ${(max * 100).toFixed(0)}%`);
  return { perFile, total, errors, failCards };
}
