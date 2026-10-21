// 黃金範例（DESIGN §3.7 第 4 點）：玩固定種子＋固定策略的家庭，取快照、比對、讀寫 tests/golden/*。tools/golden.mjs 與 tests/golden.test.mjs 共用。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './data-node.mjs';
import { newState } from '../js/engine/state.js';
import { playToEnd } from '../js/engine/turn.js';
import { buildEnding } from '../js/engine/ending.js';
import { botPolicy, SALT } from './bots.mjs';
import { goldenSnapshot, signature, categoryOf } from './mech.mjs';

export const GOLDEN_DIR = join(ROOT, 'tests', 'golden');
export const loadFamilies = () => JSON.parse(readFileSync(join(GOLDEN_DIR, 'families.json'), 'utf8')).families;
export const SNAP_PATH = join(GOLDEN_DIR, 'snapshots.json');
export const loadSnapshots = () => (existsSync(SNAP_PATH) ? JSON.parse(readFileSync(SNAP_PATH, 'utf8')) : {});
export const CHANGES_PATH = join(GOLDEN_DIR, 'CHANGES.md');
export const readChanges = () => (existsSync(CHANGES_PATH) ? readFileSync(CHANGES_PATH, 'utf8') : '');

/** 玩一個黃金範例，回傳快照（類別＋最長標籤連用＋簽名） */
export function playFamily(def, data) {
  const st = newState(def.seed, data, { role: def.role, startMode: def.startMode || 'birth' });
  playToEnd(st, data, botPolicy(def.bot, SALT));
  const snap = goldenSnapshot(st, data, buildEnding(st, data));
  return { ...snap, sig: signature(snap), turns: st.hist.length };
}

/** CHANGES.md：`## 家庭 id` 段落下，`- 日期 · sig:xxxxxxxx · 變化 · 原因：…`。回傳 { id: [{sig, reason, line}] } */
export function parseChanges(md) {
  const out = {};
  let cur = null;
  for (const line of md.split('\n')) {
    const h = line.match(/^##\s+(\S+)/);
    if (h) { cur = h[1]; out[cur] ||= []; continue; }
    const m = line.match(/^\s*-\s.*?sig:([0-9a-f]{8}).*?原因[：:]\s*(.*)$/);
    if (cur && m) out[cur].push({ sig: m[1], reason: m[2].trim(), line });
  }
  return out;
}
export const reasonOk = (r) => r.length >= 4 && !/^TODO/i.test(r);

/** 比對：回傳每個家庭的狀態 */
export function compareGolden(data, families = loadFamilies(), snaps = loadSnapshots(), changes = parseChanges(readChanges())) {
  return families.map((def) => {
    const live = playFamily(def, data), old = snaps[def.id];
    const entry = (changes[def.id] || []).find((e) => e.sig === live.sig);
    const status = !old ? 'new' : old.sig === live.sig ? 'same' : entry && reasonOk(entry.reason) ? 'explained' : entry ? 'todo' : 'changed';
    const diff = old ? Object.keys(categoryOf(live)).filter((k) => old[k] !== live[k]).map((k) => `${k}：${old[k]} → ${live[k]}`) : [];
    const streamsChanged = old ? JSON.stringify(old.streams) !== JSON.stringify(live.streams) : false;
    return { def, live, old, status, diff, streamsChanged, entry };
  });
}

export function writeSnapshots(results, families = loadFamilies()) {
  const snaps = {};
  for (const r of results) snaps[r.def.id] = { desc: r.def.desc, seed: r.def.seed, bot: r.def.bot, ...r.live };
  const lines = families.map((f) => `  ${JSON.stringify(f.id)}: ${JSON.stringify(snaps[f.id])}`);
  writeFileSync(SNAP_PATH, '{\n' + lines.join(',\n') + '\n}\n');
}
