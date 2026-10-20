// data/model.json 的讀寫：邊一行一條，其餘縮排 1（和手寫的檔案一致，git diff 才看得出改了哪一條）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './data-node.mjs';

export const MODEL_PATH = join(ROOT, 'data', 'model.json');
export const readModel = () => JSON.parse(readFileSync(MODEL_PATH, 'utf8'));
export function writeModel(model) {
  const edgeLines = model.edges.map((e) => '  ' + JSON.stringify(e)).join(',\n');
  const base = JSON.stringify({ ...model, edges: '@@EDGES@@' }, null, 1).replace('"@@EDGES@@"', '[\n' + edgeLines + '\n ]');
  writeFileSync(MODEL_PATH, base + '\n');
}
