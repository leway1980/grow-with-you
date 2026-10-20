// 用法：node tools/golden.mjs            列出每個黃金範例目前的類別，和快照比對
//       node tools/golden.mjs --update   重寫 tests/golden/snapshots.json；類別有變的家庭，在 tests/golden/CHANGES.md 補一條 TODO（要把原因填上，測試才會過）
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { loadData } from './data-node.mjs';
import { loadFamilies, compareGolden, writeSnapshots, readChanges, CHANGES_PATH } from './golden-core.mjs';

const ICON = { same: '=', new: '+', explained: '~', todo: '!', changed: '✗' };
export function printGolden(results) {
  for (const r of results) {
    const { live } = r;
    console.log(`${ICON[r.status]} ${r.def.id.padEnd(40)} 幸福 ${live.wellbeing}（${live.wellbeingParts}）｜三軸 ${live.axes}｜成就 ${live.achievement}｜${live.combo}｜${live.route}｜${live.sig}`);
    if (r.diff.length) console.log(`    變了：${r.diff.join('；')}${r.status === 'explained' ? '（CHANGES.md 已交代）' : ''}`);
    if (r.streamsChanged) console.log(`    最長的標籤連用：${(r.old.streams || []).join('、')} → ${live.streams.join('、')}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const update = process.argv.includes('--update');
  const data = loadData();
  const results = compareGolden(data);
  printGolden(results);
  if (update) {
    const today = new Date().toISOString().slice(0, 10);
    let md = readChanges() || '# 黃金範例的改動記錄\n\n每個家庭的類別（幸福區間、成就區間、組合、路線）改變時，在該家庭的段落寫一條：`- 日期 · sig:新簽名 · 變化 · 原因：…`。原因要寫為什麼這樣改是對的（不是「測試過了」）。\n';
    for (const r of results.filter((x) => x.status === 'changed')) {
      const entry = `- ${today} · sig:${r.live.sig} · ${r.diff.join('；') || '標籤連用改變'} · 原因：TODO`;
      const head = `## ${r.def.id}`;
      md = md.includes(head + '\n') ? md.replace(head + '\n', head + '\n' + entry + '\n') : md.replace(/\n*$/, '\n') + `\n${head}\n${entry}\n`;
    }
    writeFileSync(CHANGES_PATH, md);
    writeSnapshots(results);
    const todo = results.filter((x) => x.status === 'changed').length;
    console.log(`\n已重寫 tests/golden/snapshots.json（${results.length} 個家庭）。${todo ? `${todo} 個家庭的類別有變：請到 tests/golden/CHANGES.md 把『原因：TODO』改成真正的原因。` : '沒有類別改變。'}`);
  } else {
    const bad = results.filter((r) => r.status === 'changed' || r.status === 'todo' || r.status === 'new');
    if (bad.length) { console.log(`\n${bad.length} 個家庭需要處理：改動請寫進 tests/golden/CHANGES.md，然後 node tools/golden.mjs --update。`); process.exitCode = 1; }
  }
}
