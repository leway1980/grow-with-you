// 用法：node tools/build-research.mjs [--check]
// 從 docs/research/evidence.md（證據登錄表，單一來源，DESIGN §7.4、ARC-01）產生 data/research.json：終局「回頭看」的研究小卡。
//   · 每一節（## N. 標題）→ 一張卡 ev<N>；欄位：白話、證據強度標籤、限制、試試：、已核的研究數字。
//   · 數字只取自標了【已核】或【已核，已更正】的研究條目（其他標記——【憑記憶】【未證實】【已核二手…】——一律不取）：
//     研究那一行以「。」分條，條目以標記結尾、且有「出處：描述」的全形冒號、描述裡有數字，才算一筆 facts。
//   · 研究那一行是『未逐篇查證』、或強度寫了『勿引用』的節整節略過（記在 skipped）。
//   · --check：只比對 data/research.json 與重新產生的結果，不一致就結束碼 1（lint 也用同一個函式比對）。
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const EVIDENCE = join(ROOT, 'docs/research/evidence.md');
export const OUT = join(ROOT, 'data/research.json');

const VERIFIED = ['已核', '已核，已更正'];
const bullet = (lines, key) => {
  const l = lines.find((x) => x.startsWith(`- ${key}：`));
  return l ? l.slice(key.length + 3).trim() : null;
};
/** 強度那一行的短標籤：拿掉括號裡的說明，只留『強／中／初步／爭議』的判斷（例：「體罰＝強；吼叫／言語＝中」） */
export function strengthLabel(s) {
  if (!s) return '';
  let out = s.replace(/（[^（）]*）/g, '').replace(/[，,]?\s*但本次【未證實】.*$/, '').replace(/。.*$/, '').replace(/\s*限制：.*$/, '').trim();
  out = out.replace(/[；，、]\s*$/, '');
  return out;
}
/** 研究那一行 → 已核的研究數字：[{cite, text, url}] */
export function verifiedFacts(research) {
  const out = [];
  if (!research) return out;
  for (const seg of research.split('。')) {
    const m = seg.trim().match(/^(.*)【([^【】]*)】$/);
    if (!m || !VERIFIED.includes(m[2])) continue;
    const i = m[1].indexOf('：');
    if (i < 0) continue;
    const cite = m[1].slice(0, i).trim(), text = m[1].slice(i + 1).trim();
    if (!/\d/.test(text)) continue;
    const doi = cite.match(/doi:\s*(\S+)/i);
    out.push({ cite, text, url: doi ? 'https://doi.org/' + doi[1].replace(/[，。]$/, '') : null });
  }
  return out;
}

/** 給家長看的文字：【未證實…】改成（尚未證實）、【憑記憶…】改成（請自行再確認），其他查證標記拿掉 */
export const cleanText = (s) => (s || '').replace(/【未證實[^】]*】/g, '（尚未證實）').replace(/【憑記憶[^】]*】/g, '（請自行再確認）').replace(/【[^】]*】/g, '').replace(/\s+/g, ' ').trim();

export function buildResearch(md) {
  const cards = {}, skipped = {};
  const parts = md.split(/\n(?=## \d+\. )/).filter((p) => /^## \d+\. /.test(p));
  for (const p of parts) {
    const lines = p.split('\n');
    const head = lines[0].match(/^## (\d+)\. (.+)$/);
    const id = 'ev' + head[1], title = head[2].trim();
    const research = bullet(lines, '研究'), plain = bullet(lines, '白話'), strength = bullet(lines, '強度'), limits = bullet(lines, '限制'), tip = bullet(lines, '試試');
    if (!research || research.startsWith('未逐篇查證') || (strength && strength.includes('勿引用')) || !plain || !tip) { skipped[id] = { title, reason: !research ? '沒有研究條目' : research.startsWith('未逐篇查證') ? '研究未查證' : (strength || '').includes('勿引用') ? '強度標了勿引用' : '缺白話或試試' }; continue; }
    cards[id] = { id, title, plain: cleanText(plain), level: strengthLabel(strength), strength, limits: cleanText(limits), tip: cleanText(tip), facts: verifiedFacts(research) };
  }
  return { _generated: '由 tools/build-research.mjs 從 docs/research/evidence.md 產生，不要手改（改 evidence.md 再重新執行）。數字只取自【已核】或【已核，已更正】的條目；「試試：」是給家長的小行動，不是研究結論。', source: 'docs/research/evidence.md', cards, skipped };
}
export const readEvidence = () => readFileSync(EVIDENCE, 'utf8');
export const serialize = (r) => JSON.stringify(r, null, 1) + '\n';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = serialize(buildResearch(readEvidence()));
  if (process.argv.includes('--check')) {
    let cur = ''; try { cur = readFileSync(OUT, 'utf8'); } catch { /* 沒有檔 */ }
    if (cur !== text) { console.error('data/research.json 和 docs/research/evidence.md 不同步：執行 node tools/build-research.mjs'); process.exit(1); }
    console.log('data/research.json 與 evidence.md 同步');
  } else { writeFileSync(OUT, text); console.log(`寫入 ${OUT}`); }
}
