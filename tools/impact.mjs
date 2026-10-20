// 用法：node tools/impact.mjs [基準版本=HEAD] [比較版本=工作目錄] [局數=3000] [起始種子=1]
//   版本可以是任何 git ref（HEAD、HEAD~3、分支、commit）或 `work`（目前的工作目錄，含未提交的修改）。
// 在兩個版本各玩同一批種子、同樣的機器人，印出一份短的 markdown：每種機器人的結果分布變化、黃金範例的類別變化、
// 機制健康度的變化（超出設計範圍會標記），以及「用了某個標籤 ≥ 3 次的局 vs 沒有」的結果差距變化最大的幾個標籤。
// 玩的部分用 worker_threads 平行（執行端是 tools/impact-run.mjs，會被複製進舊版本的資料夾去跑）；3000 局約 1～2 分鐘。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './data-node.mjs';
import { evaluateMechanisms, stratifiedDiff } from './mech.mjs';
import { avg } from './stats.mjs';

const OVERLAY = ['impact-run.mjs', 'bots.mjs', 'mech.mjs', 'stats.mjs'];
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28, ...opts });

/** 把某個版本放進一個資料夾（work＝直接用目前的工作目錄） */
function checkout(ref, scratch, label) {
  if (ref === 'work') return { dir: ROOT, tmp: false };
  const dir = join(scratch, label);
  mkdirSync(dir, { recursive: true });
  const tar = sh('git', ['archive', ref]);
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  mkdirSync(join(dir, 'tools'), { recursive: true });
  for (const f of OVERLAY) copyFileSync(join(ROOT, 'tools', f), join(dir, 'tools', f));
  if (!existsSync(join(dir, 'tools', 'design-targets.json'))) copyFileSync(join(ROOT, 'tools', 'design-targets.json'), join(dir, 'tools', 'design-targets.json')); // 舊版的 metrics.mjs 可能還沒有這個檔
  return { dir, tmp: true };
}
function run(dir, N, s0, famPath, out) {
  execFileSync(process.execPath, [join(dir, 'tools', 'impact-run.mjs'), String(N), String(s0), famPath, out], { cwd: dir, stdio: ['ignore', 'inherit', 'inherit'] });
  return JSON.parse(readFileSync(out, 'utf8'));
}

const f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const sg = (x) => (Number.isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(1) : '—');
const se = (xs) => { const m = avg(xs); return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1) / xs.length); };

export function report(A, B, targets, labels) {
  const out = [`# 影響報告：${labels[0]} → ${labels[1]}`, '', `真人混合 ${B.N} 局＋各極端策略 ${B.NX} 局（同一批種子；兩版共用）。`, ''];
  // 1. 每種機器人
  const by = (R) => { const m = {}; for (const r of R.recs) (m[r.bot] ||= new Map()).set(r.seed, r); return m; };
  const a = by(A), b = by(B);
  out.push('## 每種機器人的結果（平均，Δ 為比較版 − 基準版，括號是成對標準誤）', '', '| 機器人 | 局數 | 親子 | 人際 | 學習 | 父母幸福 |', '|---|---:|---|---|---|---|');
  for (const bot of Object.keys(b)) {
    if (!a[bot]) { out.push(`| ${bot} | ${b[bot].size} | （基準版沒有這個機器人） | | | |`); continue; }
    const seeds = [...b[bot].keys()].filter((s) => a[bot].has(s));
    const cell = (get) => { const d = seeds.map((s) => get(b[bot].get(s)) - get(a[bot].get(s))); return `${f1(avg(seeds.map((s) => get(a[bot].get(s)))))} → ${f1(avg(seeds.map((s) => get(b[bot].get(s)))))}（${sg(avg(d))}±${se(d).toFixed(1)}）`; };
    out.push(`| ${bot} | ${seeds.length} | ${cell((r) => r.ax[0])} | ${cell((r) => r.ax[1])} | ${cell((r) => r.ax[2])} | ${cell((r) => r.w[1])} |`);
  }
  // 2. 黃金範例
  out.push('', '## 黃金範例的類別變化', '');
  const ids = Object.keys(B.golden).filter((k) => !k.startsWith('_'));
  const gd = ids.filter((id) => A.golden[id] && B.golden[id] && A.golden[id].sig !== B.golden[id].sig);
  const ge = ids.filter((id) => B.golden[id].error || (A.golden[id] && A.golden[id].error));
  if (!gd.length && !ge.length) out.push(`${ids.length} 個家庭的類別都沒變。`);
  for (const id of gd) { const x = A.golden[id], y = B.golden[id]; const ks = ['wellbeing', 'wellbeingParts', 'axes', 'achievement', 'combo', 'route'].filter((k) => x[k] !== y[k]); out.push(`- ${id}：${ks.map((k) => `${k} ${x[k]} → ${y[k]}`).join('；')}（要在 tests/golden/CHANGES.md 交代）`); }
  for (const id of ge) out.push(`- ${id}：無法比對（${(B.golden[id].error || A.golden[id].error)}）`);
  const sc = ids.filter((id) => A.golden[id] && B.golden[id] && A.golden[id].sig === B.golden[id].sig && JSON.stringify(A.golden[id].streams) !== JSON.stringify(B.golden[id].streams));
  if (sc.length) out.push(`- 類別沒變、但最長的標籤連用變了：${sc.join('、')}`);
  // 3. 機制健康度
  out.push('', '## 機制健康度（真人混合）', '');
  const mixOf = (R) => R.recs.filter((r) => ['tiredLazy', 'commonReaction', 'occasionalResearch'].includes(r.bot) || (r.seed < 100000 && r.bot === 'random'));
  let rowsA = [], rowsB = [];
  try { rowsA = evaluateMechanisms(mixOf(A), targets); } catch { /* 基準版沒有 mech 紀錄 */ }
  rowsB = evaluateMechanisms(mixOf(B), targets);
  const ma = new Map(rowsA.map((r) => [r.name, r]));
  const changed = [];
  for (const r of rowsB) { const o = ma.get(r.name); if (!o || o.value !== r.value || o.ok !== r.ok) changed.push({ r, o }); }
  const badNow = rowsB.filter((r) => !r.ok);
  out.push(`共 ${rowsB.length} 項檢查；比較版超出範圍：${badNow.length} 項${badNow.length ? '（' + badNow.map((r) => r.name).join('、') + '）' : ''}。`, '');
  if (changed.length) { out.push('| 檢查 | 基準版 | 比較版 | 範圍 |', '|---|---|---|---|'); for (const { r, o } of changed.slice(0, 20)) out.push(`| ${r.ok ? '' : '✗ '}${r.name} | ${o ? o.value : '—'} | ${r.value} | ${r.range} |`); }
  else out.push('沒有任何一項的數字改變。');
  // 4. 標籤敏感度
  out.push('', '## 標籤敏感度變化最大的（用過該標籤 ≥ 3 次 vs 沒有的局，親子軸差距；依機器人分層）', '');
  const sens = (R) => { const tags = new Set(R.recs.flatMap((r) => r.tags || [])), m = {}; for (const t of tags) { const d = stratifiedDiff(R.recs.map((r) => ({ ...r, ax0: r.ax[0] })), (r) => (r.tags || []).includes(t), 'ax0', 15); if (Number.isFinite(d.diff)) m[t] = d.diff; } return m; };
  const sa = sens(A), sb = sens(B);
  const ch = Object.keys(sb).filter((t) => t in sa).map((t) => ({ t, a: sa[t], b: sb[t], d: sb[t] - sa[t] })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 8);
  const gone = Object.keys(sb).filter((t) => !(t in sa)).length;
  if (ch.length) { out.push('| 標籤 | 基準版 | 比較版 | 變化 |', '|---|---:|---:|---:|'); for (const x of ch) out.push(`| ${x.t} | ${sg(x.a)} | ${sg(x.b)} | ${sg(x.d)} |`); } else out.push('（沒有足夠樣本）');
  if (gone) out.push('', `另有 ${gone} 個標籤只在比較版出現（新標籤）。`);
  out.push('', `耗時：基準版 ${(A.ms / 1000).toFixed(0)} 秒、比較版 ${(B.ms / 1000).toFixed(0)} 秒。`);
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const [refA = 'HEAD', refB = 'work'] = args, N = parseInt(args[2] || '3000', 10), s0 = parseInt(args[3] || '1', 10);
  const scratch = mkdtempSync(join(tmpdir(), 'impact-'));
  try {
    const famPath = join(ROOT, 'tests', 'golden', 'families.json');
    const targets = JSON.parse(readFileSync(join(ROOT, 'tools', 'design-targets.json'), 'utf8'));
    const ca = checkout(refA, scratch, 'a'), cb = checkout(refB, scratch, 'b');
    const A = run(ca.dir, N, s0, famPath, join(scratch, 'a.json')), B = run(cb.dir, N, s0, famPath, join(scratch, 'b.json'));
    console.log(report(A, B, targets, [refA, refB === 'work' ? '工作目錄' : refB]));
  } finally { if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true }); }
}
