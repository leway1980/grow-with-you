// 黃金範例（DESIGN §3.7 第 4 點）：固定種子＋固定策略的家庭，結局的類別不能悄悄改變。
// 類別（幸福區間、成就區間、組合、路線）改了：tests/golden/CHANGES.md 該家庭的段落要有一條帶新簽名與原因的記錄，否則失敗。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { loadFamilies, loadSnapshots, compareGolden, parseChanges, readChanges, reasonOk } from '../tools/golden-core.mjs';
import { ALL_BOTS } from '../tools/bots.mjs';

const data = loadData();
const families = loadFamilies();
const results = compareGolden(data, families);

test('黃金範例：12–15 個家庭，開局與策略各不相同', () => {
  assert.ok(families.length >= 12 && families.length <= 15, `現在 ${families.length} 個`);
  assert.equal(new Set(families.map((f) => f.id)).size, families.length);
  assert.equal(new Set(families.map((f) => f.seed)).size, families.length, '種子不重複');
  for (const f of families) assert.ok(ALL_BOTS[f.bot], `${f.id}：未知的策略 ${f.bot}`);
  assert.ok(new Set(families.map((f) => f.bot)).size >= 7, '至少 7 種策略');
  const fams = results.map((r) => r.live);
  assert.ok(new Set(fams.map((x) => x.combo)).size >= 3, '結局組合要有變化，不是全部落在同一類');
  assert.ok(new Set(fams.map((x) => x.route)).size >= 3);
});

test('黃金範例：每個家庭都有快照，快照沒有多的', () => {
  const snaps = loadSnapshots();
  for (const f of families) assert.ok(snaps[f.id], `${f.id} 沒有快照：執行 node tools/golden.mjs --update`);
  for (const id of Object.keys(snaps)) assert.ok(families.some((f) => f.id === id), `快照 ${id} 沒有對應的家庭`);
});

for (const r of results) {
  test(`黃金範例 ${r.def.id}（${r.def.desc}）：類別不變，或 CHANGES.md 有交代原因`, () => {
    if (r.status === 'same' || r.status === 'explained') return;
    if (r.status === 'todo') assert.fail(`${r.def.id}：CHANGES.md 的原因還是 TODO，請寫下為什麼這樣改是對的`);
    if (r.status === 'new') assert.fail(`${r.def.id} 沒有快照：執行 node tools/golden.mjs --update`);
    assert.fail(`${r.def.id} 的結局類別變了：${r.diff.join('；')}。請在 tests/golden/CHANGES.md 的「## ${r.def.id}」段落加一條 \`- 日期 · sig:${r.live.sig} · 變化 · 原因：…\`（或執行 node tools/golden.mjs --update 產生草稿）`);
  });
}

test('黃金範例：CHANGES.md 沒有留下 TODO 的原因，也沒有指到不存在的家庭', () => {
  const ch = parseChanges(readChanges());
  for (const [id, list] of Object.entries(ch)) {
    assert.ok(families.some((f) => f.id === id), `CHANGES.md 的家庭 ${id} 不存在`);
    for (const e of list) assert.ok(reasonOk(e.reason), `${id}：${e.line.trim()} 沒有寫原因`);
  }
});

test('黃金範例：結局類別的簽名是決定性的（同一個家庭玩兩次一樣）', () => {
  const again = compareGolden(data, families.slice(0, 3));
  again.forEach((r, i) => assert.equal(r.live.sig, results[i].live.sig));
});
