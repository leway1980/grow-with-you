// 外掛載入器（M3 A3）：後面的工作包把自己的檢查與目標放進各自的檔案，不必再改共用的 lint-data.mjs、check-design.mjs、design-targets.json。
//   tools/lint/*.mjs     ：lint-data 逐一執行。default export 或具名 `lint`：(ctx) => ({ errors?: string[], warns?: string[] })。
//                          ctx = { raw, data, cards, T（tags.json）, hiddenKeys }；同步函式。
//   tools/checks/*.mjs   ：check-design 逐一執行。default export 或具名 `check`：async (ctx) => rows[]（或在 ctx.add 登記）。
//                          ctx = { N, s0, raw, data, TARGETS, mix, ext, everyone, inf, runBots, add(ok, group, name, value, range, note) }。
//   tools/targets/*.json ：與 tools/design-targets.json 合併（物件逐層合併，陣列與純量以後面的檔案為準；檔名依字母序）。
// 檔名開頭是底線（_）的檔案不載入。沒有任何外掛檔時，行為與沒有載入器之前完全相同。
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOLS = dirname(fileURLToPath(import.meta.url));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const listFiles = (sub, ext) => (existsSync(join(TOOLS, sub)) ? readdirSync(join(TOOLS, sub)).filter((f) => f.endsWith(ext) && !f.startsWith('_')).sort() : []);

export function deepMerge(a, b) {
  if (!isObj(a) || !isObj(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = k in a ? deepMerge(a[k], v) : v;
  return out;
}

/** tools/design-targets.json ＋ tools/targets/*.json（字母序） */
export function loadTargets() {
  let T = JSON.parse(readFileSync(join(TOOLS, 'design-targets.json'), 'utf8'));
  for (const f of listFiles('targets', '.json')) T = deepMerge(T, JSON.parse(readFileSync(join(TOOLS, 'targets', f), 'utf8')));
  return T;
}

/** 載入 tools/<dir>/*.mjs，回傳 [{ name, fn }]；fn 取 default 或 exportName */
export async function loadPlugins(dir, exportName) {
  const out = [];
  for (const f of listFiles(dir, '.mjs')) {
    const mod = await import(pathToFileURL(join(TOOLS, dir, f)).href);
    const fn = mod.default ?? mod[exportName];
    if (typeof fn !== 'function') throw new Error(`tools/${dir}/${f}：要 default export 或具名 ${exportName} 函式`);
    out.push({ name: f, fn });
  }
  return out;
}
