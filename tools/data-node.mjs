// 給 Node 用的資料載入（tests 與 tools 共用）；網頁版在 js/main.js 用 fetch 讀同一批檔案。
// 事件與槽依 data/manifest.json 分檔，合併邏輯在 js/engine/dataload.js（兩邊共用）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData } from '../js/engine/turn.js';
import { mergeData, manifestFiles } from '../js/engine/dataload.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
export const loadRaw = () => {
  const manifest = rd('manifest.json');
  const files = Object.fromEntries(manifestFiles(manifest).map((f) => [f, rd(f)]));
  const m = mergeData(manifest, files);
  return { identities: rd('identities.json'), tags: rd('tags.json'), model: rd('model.json'), ending: rd('ending.json'), events: m.events, pools: rd('pools.json'), slots: m.slots, calendar: rd('calendar.json'), manifest, mergeProblems: m.problems };
};
export const loadData = (raw = loadRaw()) => prepareData(raw);
