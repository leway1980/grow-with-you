// 用法：node tools/alpha-sweep.mjs [α 清單，逗號分隔=0,0.25,0.5,0.75,1] [校準局數=200] [設計檢驗局數=3000]
// A2.5 的 α 掃描：對每個 α（data/model.json timeScale.alpha；用環境變數 GWY_ALPHA 覆蓋，不改檔案），
// 兩組種子（1–200、201–400）各跑校準，並跑設計檢驗（真人混合），印出一張表：校準目標的現況、護欄、不太來找你的右設限比例、設計檢驗有幾項 ✗。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const alphas = (process.argv[2] || '0,0.25,0.5,0.75,1').split(',').map(Number);
const N = process.argv[3] || '200', ND = process.argv[4] || '3000';
const self = fileURLToPath(import.meta.url);
if (process.argv[5] === '--one') {
  const { runBots, runMix } = await import('./simulate.mjs');
  const { evaluateCalibration } = await import('./calibration.mjs');
  const { evaluateMechanisms } = await import('./mech.mjs');
  const { TARGETS } = await import('./calibration.mjs');
  const out = { alpha: Number(process.env.GWY_ALPHA), cal: {}, mech: [] };
  for (const s0 of [1, 201]) {
    const g = await runBots(Number(N), s0);
    out.cal[s0] = evaluateCalibration(g).map((r) => ({ id: r.id, value: r.value, target: r.target, ok: r.ok }));
  }
  const mix = await runMix(Number(ND), 1);
  out.mech = evaluateMechanisms(mix, TARGETS).map((r) => ({ ok: r.ok, pending: !!r.pending, name: r.name, value: r.value, range: r.range }));
  console.log('@@' + JSON.stringify(out));
} else {
  for (const a of alphas) {
    const r = spawnSync(process.execPath, [self, String(a), N, ND, '--one'], { env: { ...process.env, GWY_ALPHA: String(a) }, encoding: 'utf8', maxBuffer: 1 << 28 });
    const line = (r.stdout || '').split('\n').find((l) => l.startsWith('@@'));
    if (!line) { console.log(`α=${a}：失敗`, r.stderr.slice(0, 500)); continue; }
    const o = JSON.parse(line.slice(2));
    console.log(`\n══ α = ${a} ══`);
    for (const s0 of [1, 201]) {
      console.log(`校準（種子 ${s0}–${s0 + Number(N) - 1}）`);
      for (const c of o.cal[s0]) if (['permissive-collapse', 'rest-parent', 'dose-high-route', 'wf-all-good', 'followup-delay', 'nonfixed-share', 'wf-parent', 'wf-vs-dose', 'wf-range', 'wf-saturation', 'random-route', 'econ-parent-gap', 'broke-share', 'opening-gap', 'wf-outside-good', 'rest-loss', 'anti-vs-wf', 'anti-vs-random', 'dose-vs-random', 'partner-gap', 'wf-width', 'controlling-learn', 'dose-worse-hidden'].includes(c.id) || !c.ok) console.log(`  ${c.ok ? '✓' : '✗'} ${c.id}：${c.value}（${c.target}）`);
    }
    console.log('設計檢驗（機制）');
    for (const m of o.mech) if (!m.ok || /右設限|曾經離開|3C|收穫|壓力/.test(m.name)) console.log(`  ${m.ok ? '✓' : '✗'} ${m.name}：${m.value}（${m.range}）`);
  }
}
