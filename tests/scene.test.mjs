// 像素家庭場景（DESIGN §8.5）：同一個狀態畫出同一張圖、隱藏值與『不太來找你』的狀態改了畫面一模一樣、手足出生後才出現、只畫看得到的狀態。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { sceneSpec, sceneSVG, sceneAlt, albumSpecs, BODY_FLAGS, childStageOf } from '../js/engine/scene.js';

const data = loadData();
const tlAt = (t) => data.timeline[t];
const svgOf = (st, t = st.turn, opts) => { st.turn = t; return sceneSVG(sceneSpec(st, data, tlAt(t), opts)); };
const seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

test('同一個狀態畫出同一張圖（含 JSON 存讀之後）', () => {
  for (const seed of seeds) {
    const st = newState(seed, data, { role: seed % 2 ? '爸爸' : '媽媽' });
    for (const t of [0, 8, 20, 40]) {
      const a = svgOf(st, t), b = svgOf(JSON.parse(JSON.stringify(st)), t);
      assert.equal(a, b);
      assert.ok(a.startsWith('<svg') && a.includes('role="img"') && a.includes('aria-label="'));
    }
  }
});

test('隱藏數值與『不太來找你』的狀態全部改掉，畫面一模一樣', () => {
  for (const seed of seeds) {
    const st = newState(seed, data);
    for (const t of [0, 6, 14, 30, 45]) {
      st.turn = t;
      const before = svgOf(st, t);
      const alt0 = sceneAlt(sceneSpec(st, data, tlAt(t)));
      for (const k of Object.keys(st.hidden)) st.hidden[k] = 100 - st.hidden[k] + 1;
      for (const k of Object.keys(st.startHidden)) st.startHidden[k] = 3;
      for (const k of Object.keys(st.interest)) st.interest[k] = 1;
      st.dirCount = { 溫暖: 99, 規範: 99 }; st.tagCounts = { 溫暖陪伴: 50 }; st.costEMA = { 體力: 40, 耐心: 40 };
      Object.assign(st.vars, { 不太來找你: 1, 不太來找你_曾: 1, 孩子來找_連續錯過: 5, 孩子來找_回來連續: 4, 孩子主動開口: 9, 孩子不再開口: 9, 換照顧者次數: 4 });
      st.flags = { ...st.flags, 吵架_孩子看見: true, 霸凌_發生過: true, 霸凌_已告知導師: true, 送評估: true, 鑑定_有結果: true };
      st.hist = [{ turn: 0, m: 0, tags: ['替他做主'] }];
      assert.equal(svgOf(st, t), before, `seed ${seed} turn ${t}`);
      assert.equal(sceneAlt(sceneSpec(st, data, tlAt(t))), alt0);
    }
  }
});

test('畫面讀的只有看得見的數值：心情、睡眠、體力、耐心會改畫面', () => {
  const st = newState(3, data);
  st.turn = 10;
  const base = svgOf(st, 10);
  st.child.心情 = 10; assert.notEqual(svgOf(st, 10), base); st.child.心情 = 62;
  st.child.睡眠 = 10; assert.notEqual(svgOf(st, 10), base); st.child.睡眠 = 66;
  st.parent.體力 = 10; assert.notEqual(svgOf(st, 10), base); st.parent.體力 = 78;
  st.parent.耐心 = 10; assert.notEqual(svgOf(st, 10), base); st.parent.耐心 = 70;
  assert.equal(svgOf(st, 10), base);
});

test('弟弟妹妹出生之後才出現；哥哥姊姊一直都在', () => {
  let checked = 0;
  for (let seed = 1; seed < 300 && checked < 6; seed++) {
    const st = newState(seed, data);
    const younger = st.family.siblings.find((s) => !s.older);
    if (!younger) continue;
    checked++;
    const n = (t) => { st.turn = t; return sceneSpec(st, data, tlAt(t)).members.filter((m) => m.who === 'sibling' && m.rel === younger.rel).length; };
    for (let t = 0; t < data.calendar.playableTurns; t++) {
      assert.equal(n(t) > 0 || tlAt(t).ageMonths < younger.arriveMonths, true, `seed ${seed} t${t} 出生後應該出現`);
      if (tlAt(t).ageMonths < younger.arriveMonths) assert.equal(n(t), 0, `seed ${seed} t${t} 出生前不該出現`);
    }
  }
  assert.ok(checked >= 3);
  for (let seed = 1; seed < 100; seed++) {
    const st = newState(seed, data);
    const older = st.family.siblings.filter((s) => s.older).length;
    st.turn = 0;
    assert.equal(sceneSpec(st, data, tlAt(0)).members.filter((m) => m.who === 'sibling').length, older);
  }
});

test('家庭組成照著 family 物件：另一半同住、長輩同住、寵物、住屋', () => {
  for (let seed = 1; seed < 150; seed++) {
    const st = newState(seed, data), f = st.family;
    st.cur = null;
    const sp = sceneSpec(st, data, tlAt(0));
    const has = (w) => sp.members.filter((m) => m.who === w).length;
    assert.equal(has('partner'), f.partner.present && f.partner.status === '同住' ? 1 : 0);
    const elders = f.elders.status === '同住' ? (['阿公阿嬤', '外公外婆'].includes(f.elders.who) ? 2 : 1) : 0;
    assert.equal(has('elder'), elders);
    assert.equal(has('player'), 1); assert.equal(has('child'), 1);
    assert.equal(sp.pet ? sp.pet.type : null, f.pet ? f.pet.type : null);
    assert.equal(sp.home, f.housing === '租屋' ? 'rental' : f.housing === '住長輩家' ? (['偏鄉', '離島'].includes(f.urban) ? 'sanhe' : 'elder') : ['都會核心', '都會外圍'].includes(f.urban) ? 'flat' : 'house');
  }
  const kinds = new Set();
  for (let seed = 1; seed < 400; seed++) kinds.add(sceneSpec(newState(seed, data), data, tlAt(0)).home);
  assert.deepEqual([...kinds].sort(), ['elder', 'flat', 'house', 'rental', 'sanhe']);
});

test('孩子的階段、寒暑假戶外、身體照顧旗標、生病與工作插播', () => {
  const st = newState(2, data);
  const stages = new Set();
  data.timeline.slice(0, data.calendar.playableTurns).forEach((tl) => stages.add(childStageOf(tl)));
  assert.deepEqual([...stages], ['嬰兒', '幼兒', '國小', '國中', '高中', '離家']);
  const vac = data.timeline.findIndex((t) => t.vacation);
  st.turn = vac; assert.equal(sceneSpec(st, data, tlAt(vac)).vacation, true);
  st.turn = 0; assert.equal(sceneSpec(st, data, tlAt(0)).vacation, false);
  // 旗標（data/events/health.json 的卡會設這些旗標，見 tests/health.test.mjs）
  const t = data.timeline.findIndex((x) => x.grade === 3 && !x.vacation); st.turn = t;
  const plain = svgOf(st, t);
  for (const flag of Object.values(BODY_FLAGS)) { st.flags[flag] = true; assert.notEqual(svgOf(st, t), plain, flag); delete st.flags[flag]; }
  st.flags[BODY_FLAGS.glasses] = true; assert.ok(sceneAlt(sceneSpec(st, data, tlAt(t))).includes('眼鏡')); delete st.flags[BODY_FLAGS.glasses];
  st.cur = { cardId: 'inf_sick' };
  assert.ok(sceneSpec(st, data, tlAt(t)).members.find((m) => m.who === 'child').sick);
  st.cur = { cardId: 'hi_work_ping' };
  assert.equal(sceneSpec(st, data, tlAt(t)).workPing, true);
  st.cur = { cardId: 'lo_exam' };
  assert.equal(sceneSpec(st, data, tlAt(t)).prop, 'paper');
  assert.equal(sceneSpec(st, data, tlAt(t), { portrait: true }).prop, null);
});

test('文字描述：一句繁體中文，不含隱藏數值名稱', () => {
  const bad = Object.keys(data.tags.hidden);
  for (const seed of seeds) {
    const st = newState(seed, data); st.turn = 10;
    const alt = sceneAlt(sceneSpec(st, data, tlAt(10)));
    assert.ok(alt.endsWith('。') && alt.length > 15);
    for (const w of bad) assert.ok(!alt.includes(w), w);
    assert.ok(!/[+-]\d/.test(alt));
  }
});

test('成長相簿：到過的每個階段一張，只畫孩子', () => {
  const st = newState(4, data);
  st.turn = 0; assert.deepEqual(albumSpecs(st, data).map((a) => a.stage), ['嬰兒']);
  st.turn = data.calendar.playableTurns; st.ended = true;
  const al = albumSpecs(st, data);
  assert.deepEqual(al.map((a) => a.stage), ['嬰兒', '幼兒', '國小', '國中', '高中', '離家']);
  for (const a of al) { const s = sceneSVG(a); assert.ok(s.includes('viewBox="0 0 24 24"') && s.includes('aria-label')); }
  const full = sceneSVG(sceneSpec(st, data, tlAt(data.calendar.playableTurns - 1), { portrait: true }));
  assert.ok(full.includes('viewBox="0 0 96 44"'));
});

test('只用 --sc-* 變數與固定膚色／髮色，淺色深色都有定義', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../css/style.css', import.meta.url), 'utf8');
  const st = newState(5, data);
  const used = new Set();
  for (const t of [0, 10, 30, 45]) { st.turn = t; for (const m of svgOf(st, t).matchAll(/var\(--sc-([a-z0-9]+)\)/g)) used.add(m[1]); }
  const sprite = sceneSVG(albumSpecs(st, data)[0]); for (const m of sprite.matchAll(/var\(--sc-([a-z0-9]+)\)/g)) used.add(m[1]);
  const defs = (block) => new Set([...block.matchAll(/--sc-([a-z0-9]+):/g)].map((m) => m[1]));
  const light = defs(css.slice(0, css.indexOf('@media (prefers-color-scheme: dark)')));
  const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
  const dark = defs(css.slice(darkStart, css.indexOf(':root[data-theme="dark"]')));
  const dark2 = defs(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('* { box-sizing')));
  for (const u of used) { assert.ok(light.has(u), `淺色缺 --sc-${u}`); assert.ok(dark.has(u), `深色缺 --sc-${u}`); assert.ok(dark2.has(u), `深色（手動）缺 --sc-${u}`); }
});
