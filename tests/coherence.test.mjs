// 家庭一致性（DESIGN §2.1、§4.15、§2.5）：隔代的另一半在外地、夫妻池沒有同住的另一半就是 0、新住民不是職業而是背景。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { generateFamily, familyCtx, openingText, rollBackground } from '../js/engine/family.js';
import { newState, migrate } from '../js/engine/state.js';
import { buildCtx, poolWeight, passes, drawCard } from '../js/engine/events.js';
import { stateRng } from '../js/engine/rng.js';

const data = loadData();
const idn = data.identities;
const at = (turn) => data.timeline[turn];
const familiesWhere = (pred, n = 4000) => { const out = []; for (let s = 1; s <= n && out.length < 40; s++) { const f = generateFamily(s, idn); if (pred(f)) out.push(s); } return out; };

test('隔代：另一半在外地工作（幾乎不在家、不同住），開場文字也這樣寫', () => {
  const seeds = familiesWhere((f) => f.structure === '隔代');
  assert.ok(seeds.length >= 10);
  for (const s of seeds) {
    const f = generateFamily(s, idn);
    assert.equal(f.partner.present, true); assert.equal(f.partner.status, '在外地工作'); assert.equal(f.partner.attitude, '幾乎不在家');
    assert.ok(['同住', '住附近會幫忙'].includes(f.elders.status), '隔代的長輩一定在孩子身邊');
    const ctx = familyCtx(f, '爸爸', 15);
    assert.equal(ctx.有同住的另一半, false);
    const text = openingText(f, '媽媽').join('');
    assert.match(text, /也在外地工作/); assert.doesNotMatch(text, /對方願意一起帶|很少在家，家裡的事幾乎是你一個人在顧/);
  }
});

test('夫妻池：沒有同住的另一半（離異、喪親、隔代）權重是 0；雙親與重組不是', () => {
  const w = (st, turn = 12) => poolWeight(st, data, '夫妻', buildCtx(st, at(turn)));
  const kinds = {};
  for (let s = 1; s <= 3000; s++) {
    const f = generateFamily(s, idn);
    if (kinds[f.structure] >= 3) continue;
    const st = newState(s, data, { role: '媽媽' });
    kinds[f.structure] = (kinds[f.structure] || 0) + 1;
    if (['離異', '喪親', '隔代'].includes(f.structure)) assert.equal(w(st), 0, `${f.structure} seed ${s}`);
    else assert.ok(w(st) > 0, `${f.structure} seed ${s}`);
  }
  assert.ok(Object.keys(kinds).length === 5);
});

test('隔代：日常池的卡改成長輩＋週末＋視訊的版本；平日在家的卡（半夜哭鬧、睡前、聯絡簿）不會抽到', () => {
  const gen = [], seeds = familiesWhere((f) => f.structure === '隔代', 800);
  const ban = new Set(['inf_night', 'inf_bedtime', 'lo_hw', 'lo_sign', 'hi_prep_night', 'hi_late_hw', 'wp_kg_call', 'lo_interrupt', 'sf_halfday']);
  const seen = new Set();
  for (const s of seeds.slice(0, 30)) {
    const st = newState(s, data, { role: '爸爸' });
    const r = stateRng(st, 'rngS');
    for (let t = 0; t < data.calendar.playableTurns; t++) {
      st.turn = t;
      const tl = at(t), ctx = buildCtx(st, tl);
      for (let k = 0; k < 8; k++) { const c = drawCard(st, data, ctx, tl, r); if (c) { seen.add(c.id); assert.ok(!ban.has(c.id), `隔代 seed ${s} turn ${t} 抽到 ${c.id}`); } }
    }
  }
  for (const id of ['gen_video_infant', 'gen_weekend_return', 'gen_when_back', 'gen_elder_call']) assert.ok(seen.has(id), `隔代應該抽得到 ${id}`);
  assert.ok(!gen.length);
  // 非隔代的家庭抽不到隔代專用的卡
  const st = newState(3, data, { role: '媽媽' }); assert.notEqual(st.family.structure, '隔代');
  const ctx = buildCtx(st, at(14));
  for (const id of ['gen_video_infant', 'gen_weekend_return', 'gen_when_back', 'gen_elder_call', 'fx_leave_end_gen']) assert.equal(passes(data.cardIndex[id], st, ctx), false, id);
});

test('隔代的固定事件：產假結束之後 用長輩的版本，其他家庭用原來的', () => {
  const g = newState(familiesWhere((f) => f.structure === '隔代', 800)[0], data, { role: '媽媽' });
  const n = newState(familiesWhere((f) => f.structure === '雙親', 800)[0], data, { role: '媽媽' });
  const ids = (st) => data.timeline[1].fixed.filter((id) => passes(data.cardIndex[id], st, buildCtx(st, at(1))));
  assert.deepEqual(ids(g), ['fx_leave_end_gen']); assert.deepEqual(ids(n), ['fx_leave_end']);
  for (const o of data.cardIndex.fx_leave_end_gen.choices) { assert.equal(o.setVars.托育方式, '長輩主要照顧'); assert.ok(o.setFlags.includes('長輩帶')); }
});

test('新住民不是職業；族群與文化背景是另一條軸（無／新住民家庭／原住民族／客家），暴露在條件環境', () => {
  assert.ok(!idn.jobs.some((j) => /新住民/.test(j.name)));
  assert.deepEqual(idn.background.labels, ['無', '新住民家庭', '原住民族', '客家']);
  const count = { 無: 0, 新住民家庭: 0, 原住民族: 0, 客家: 0 };
  const byUrban = { 原住民族: { 偏鄉: 0, 都會核心: 0 } };
  let rural = 0, core = 0;
  for (let s = 1; s <= 6000; s++) {
    const f = generateFamily(s, idn);
    count[f.background]++;
    assert.equal(familyCtx(f, '爸爸', 0).背景, f.background);
    if (f.urban === '偏鄉') { rural++; if (f.background === '原住民族') byUrban.原住民族.偏鄉++; }
    if (f.urban === '都會核心') { core++; if (f.background === '原住民族') byUrban.原住民族.都會核心++; }
  }
  const p = (k) => count[k] / 6000;
  assert.ok(p('無') > 0.7 && p('無') < 0.88, JSON.stringify(count));
  assert.ok(p('新住民家庭') > 0.04 && p('新住民家庭') < 0.11); assert.ok(p('客家') > 0.07 && p('客家') < 0.14); assert.ok(p('原住民族') > 0.012 && p('原住民族') < 0.05);
  assert.ok(byUrban.原住民族.偏鄉 / rural > 3 * (byUrban.原住民族.都會核心 / core), '原住民族集中在偏鄉');
  // 自己的亂數流：改背景表只改背景
  const alt = structuredClone(idn); alt.background.w = [0, 1, 0, 0];
  for (const s of [1, 2, 3, 99]) { const a = generateFamily(s, idn), b = generateFamily(s, alt); assert.equal(b.background, '新住民家庭'); const { background: _a, ...ra } = a, { background: _b, ...rb } = b; assert.deepEqual(ra, rb); }
  // 開場文字提到背景
  const f = generateFamily(1, alt);
  assert.match(openingText(f, '媽媽').join(''), /新住民家庭/);
});

test('舊存檔：沒有背景的補上；舊的隔代存檔另一半改成在外地工作', () => {
  const s = familiesWhere((f) => f.structure === '隔代', 800)[0];
  const st = newState(s, data, { role: '爸爸' });
  const bg = st.family.background;
  delete st.family.background; st.family.partner.status = '同住'; st.family.partner.attitude = '一起陪';
  migrate(JSON.parse(JSON.stringify(st)), data);
  const m = migrate(JSON.parse(JSON.stringify(st)), data);
  assert.equal(m.family.background, bg); assert.equal(m.family.partner.status, '在外地工作'); assert.equal(m.family.partner.attitude, '幾乎不在家');
  assert.equal(rollBackground(m.seed, idn, m.family.county, m.family.urban), bg);
});
