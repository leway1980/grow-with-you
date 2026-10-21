// 「這一年」小卡的資料檢查（M3 B3；data/yearly.json）。由 tools/lint-data.mjs 透過 tools/plugins.mjs 載入。
// 規則：
//  1. 歲數 1–18 每一歲至少 1 則事實，而且至少 1 則沒有 if（任何孩子都有東西可顯示）；
//  2. evidence 在列舉裡（強／中／初步／現場經驗／里程碑）；
//  3. 每則有 source.url；里程碑類至少要有 source.who；
//  4. text ≤ 80 字；
//  5. text 不含比較或排名的字眼（比其他、排名……）；
//  6. verified 只能是 已核／已核，已更正；ref 若指向 docs/research/yearly.md#<id>，該段不得標【未證實】【憑記憶】【已核二手】；
//  7. if 要能被條件式編譯；id 不重複。
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../../js/engine/events.js';

export const EVIDENCE = ['強', '中', '初步', '現場經驗', '里程碑'];
export const FORBIDDEN = ['比其他', '比別人', '比別的', '比同學', '比同齡', '排名', '排行', '第一名', '最好', '最差', '落後', '贏在', '輸在', '較高', '較低', '高於', '低於'];
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default function lint({ raw } = {}) {
  const errors = [], warns = [];
  const path = join(ROOT, 'data', 'yearly.json');
  if (!existsSync(path)) return { errors: ['缺少 data/yearly.json'], warns };
  const Y = (raw && raw.yearly) || JSON.parse(readFileSync(path, 'utf8'));
  const ages = Y.ages || {};
  const mdPath = join(ROOT, 'docs', 'research', 'yearly.md');
  const md = existsSync(mdPath) ? readFileSync(mdPath, 'utf8') : '';
  const section = (id) => { const m = md.split(/^### /m).find((s) => s.startsWith(id + '\n')); return m || ''; };
  const ids = new Set();
  for (let a = 1; a <= 18; a++) {
    const facts = (ages[a] && ages[a].facts) || [];
    if (facts.length < 1) errors.push(`小卡：${a} 歲沒有任何事實`);
    else if (!facts.some((f) => !f.if)) errors.push(`小卡：${a} 歲每則事實都有 if，至少要有一則沒有條件的`);
  }
  for (const a of Object.keys(ages)) if (!(+a >= 1 && +a <= 18)) errors.push(`小卡：歲數「${a}」不在 1–18`);
  for (const [a, { facts }] of Object.entries(ages)) for (const f of facts || []) {
    const w = `小卡 ${a} 歲「${f.id}」`;
    if (!f.id) { errors.push(`${w}：沒有 id`); continue; }
    if (ids.has(f.id)) errors.push(`${w}：id 重複`);
    ids.add(f.id);
    if (!EVIDENCE.includes(f.evidence)) errors.push(`${w}：evidence「${f.evidence}」不在 ${EVIDENCE.join('／')}`);
    const s = f.source || {};
    if (!s.url && !(f.kind === '里程碑' && s.who)) errors.push(`${w}：沒有 source.url（只有里程碑類可以只寫 source.who）`);
    if (s.url && !/^https:\/\//.test(s.url)) errors.push(`${w}：source.url 要是 https 網址`);
    if (!s.who || !s.year) errors.push(`${w}：卡片會顯示 source.who 與 source.year，兩個都要有`);
    const n = [...String(f.text || '')].length;
    if (!n) errors.push(`${w}：沒有 text`);
    if (n > 80) errors.push(`${w}：text ${n} 字，超過 80`);
    for (const word of FORBIDDEN) if (String(f.text || '').includes(word)) errors.push(`${w}：text 含比較或排名的字眼「${word}」`);
    if (!['已核', '已核，已更正'].includes(f.verified)) errors.push(`${w}：verified 只收「已核」「已核，已更正」（現在是「${f.verified}」）`);
    if (f.if) { try { compile(f.if); } catch (e) { errors.push(`${w}：if 無法編譯（${e.message}）`); } }
    const m = /^docs\/research\/yearly\.md#(.+)$/.exec(f.ref || '');
    if (m && /\d/.test(f.text)) { const sec = section(m[1]); if (/【未證實】|【憑記憶】|【已核二手/.test(sec)) errors.push(`${w}：研究筆記該段標了未核（${m[1]}），含數字的事實不能上線`); }
  }
  return { errors, warns };
}
