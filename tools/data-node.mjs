// 給 Node 用的資料載入（tests 與 tools 共用）；網頁版在 js/main.js 用 fetch 讀同一批檔案。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prepareData } from '../js/engine/turn.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rd = (f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'));
export const loadRaw = () => ({
  identities: rd('identities.json'), tags: rd('tags.json'), events: rd('events.json'), pools: rd('pools.json'), slots: rd('slots.json'), calendar: rd('calendar.json'),
});
export const loadData = (raw = loadRaw()) => prepareData(raw);
