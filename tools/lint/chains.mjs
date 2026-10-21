// 決定鏈與研究小卡的資料檢查（M3 B5；data/chains.json、data/research.json、卡片的 traceOf）。由 tools/lint-data.mjs 透過 tools/plugins.mjs 載入。
// 規則：
//  1. 每個主題都有 research，指向 data/research.json 的一張卡（researchAlso、researchLate 也要存在）——沒有研究的主題不能出現在終局；
//  2. 主題的標籤都存在於 tags.json，同一個標籤不能同時在 + 和 −；where 的池、卡、習慣家族都存在；habit 若有，是 habits.json 的家族；
//  3. 標籤清單全空的主題要寫 pending（說明為什麼還沒有選項帶它）；其餘每個主題至少有一個 + 和一個 − 的標籤；
//  4. 卡片的 traceOf 指向存在的主題；
//  5. data/research.json 和 docs/research/evidence.md 同步（tools/build-research.mjs 重新產生後完全一樣）——證據只有一個來源（ARC-01）；
//  6. 研究卡的數字（facts）都有出處，而且在 evidence.md 裡該條目標了【已核】或【已核，已更正】；其他欄位不含查證標記；
//  7. settings 合理：minRun ≥ 2、pick.min ≤ pick.max ≤ 5、windowMonths ≥ 12。
import { buildResearch, readEvidence, serialize, OUT } from '../build-research.mjs';
import { readFileSync, existsSync } from 'node:fs';

export default function lint({ raw, cards, T }) {
  const errors = [], warns = [];
  const C = raw.events && raw.events.chains, R = raw.events && raw.events.research;
  if (!C) return { errors: ['缺少 data/chains.json（manifest.extras）'], warns };
  if (!R) return { errors: ['缺少 data/research.json（manifest.extras；node tools/build-research.mjs 產生）'], warns };
  const cardIds = new Set(cards.map((c) => c.id)), pools = new Set(cards.map((c) => c.pool));
  const habits = (raw.habits && raw.habits.families) || {};
  const S = C.settings || {};
  if (!(S.minRun >= 2)) errors.push('決定鏈：settings.minRun 要 ≥ 2');
  if (!(S.windowMonths >= 12)) errors.push('決定鏈：settings.windowMonths 要 ≥ 12');
  if (!S.pick || !(S.pick.min <= S.pick.max && S.pick.max <= 5)) errors.push('決定鏈：settings.pick 要 min ≤ max ≤ 5');
  for (const [name, th] of Object.entries(C.themes || {})) {
    const w = `決定鏈主題「${name}」`;
    const ids = [th.research, ...(th.researchAlso || []), ...(th.researchLate ? [th.researchLate.id] : [])];
    if (!th.research && !th.setting) errors.push(`${w}：沒有 research（每個主題都要對到研究卡）`);
    for (const id of ids.filter(Boolean)) if (!R.cards[id]) errors.push(`${w}：研究卡「${id}」不在 data/research.json（被略過或不存在；見 research.json 的 skipped）`);
    const pos = (th.tags && th.tags['+']) || [], neg = (th.tags && th.tags['-']) || [];
    for (const t of [...pos, ...neg, ...(th.always || [])]) if (!T.tags[t]) errors.push(`${w}：標籤「${t}」不存在`);
    for (const t of pos) if (neg.includes(t)) errors.push(`${w}：標籤「${t}」同時在 + 和 −`);
    for (const t of th.always || []) if (!pos.includes(t) && !neg.includes(t)) errors.push(`${w}：always 的標籤「${t}」要列在 + 或 −（否則沒有方向）`);
    if (!pos.length && !neg.length) { if (!th.pending) errors.push(`${w}：標籤全空，要寫 pending 說明原因`); }
    else { if (!pos.length) errors.push(`${w}：沒有 + 的標籤`); if (!neg.length) errors.push(`${w}：沒有 − 的標籤`); }
    const wh = th.where;
    if (wh) {
      for (const p of wh.pools || []) if (!pools.has(p)) errors.push(`${w}：where.pools「${p}」不存在`);
      for (const c of wh.cards || []) if (!cardIds.has(c)) errors.push(`${w}：where.cards「${c}」不存在`);
      for (const h of wh.habits || []) if (!habits[h]) errors.push(`${w}：where.habits「${h}」不是 habits.json 的家族`);
    }
    for (const hb of [].concat(th.habit || []).filter(Boolean)) {
      if (!habits[hb]) errors.push(`${w}：habit「${hb}」不是 habits.json 的家族`);
      else if (!habits[hb].auto) warns.push(`${w}：habit「${hb}」不自動帶入（auto:false），習慣句不會出現在鏈裡`);
    }
  }
  for (const c of cards) for (const t of [].concat(c.traceOf || [])) if (!(C.themes || {})[t]) errors.push(`卡「${c.id}」：traceOf「${t}」不是決定鏈的主題`);
  // 研究卡和 evidence.md 同步
  const want = serialize(buildResearch(readEvidence()));
  if (serialize(R) !== want) errors.push('data/research.json 和 docs/research/evidence.md 不同步：執行 node tools/build-research.mjs（證據只有一個來源）');
  if (existsSync(OUT) && readFileSync(OUT, 'utf8') !== want) errors.push('data/research.json（檔案）和 docs/research/evidence.md 不同步：執行 node tools/build-research.mjs');
  for (const [id, c] of Object.entries(R.cards || {})) {
    for (const f of ['plain', 'level', 'tip']) if (!c[f]) errors.push(`研究卡 ${id}：缺少 ${f}`);
    for (const f of ['plain', 'tip', 'level', 'limits']) if (/【/.test(c[f] || '')) errors.push(`研究卡 ${id}：${f} 還有查證標記【】`);
    for (const x of c.facts || []) if (!x.cite || !/\d/.test(x.text)) errors.push(`研究卡 ${id}：數字沒有出處或沒有數字`);
  }
  return { errors, warns };
}
