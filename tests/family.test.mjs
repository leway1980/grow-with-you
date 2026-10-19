import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateFamily, openingText } from '../js/engine/family.js';
import { loadRaw } from '../tools/data-node.mjs';

const BASE = loadRaw().identities;
const idn = () => BASE;
const clone = () => structuredClone(BASE);
const without = (f, ...keys) => { const o = { ...f }; for (const k of keys) delete o[k]; return o; };

test('同一個種子永遠抽出同一個家庭', () => {
  const a = generateFamily(12345, idn()), b = generateFamily(12345, idn());
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(openingText(a, '媽媽'), openingText(b, '媽媽'));
});

test('不同種子會抽出不同的家庭，而且鏈條合理', () => {
  const counties = new Set(), jobs = new Set(), needs = new Set();
  let rural = 0, ruralFarm = 0, coreFarm = 0, core = 0;
  for (let s = 1; s <= 600; s++) {
    const f = generateFamily(s, idn());
    counties.add(f.county); jobs.add(f.job.name); f.child.needs.forEach((n) => needs.add(n.kind));
    if (f.urban === '偏鄉') { rural++; if (f.job.name === '農漁業') ruralFarm++; }
    if (f.urban === '都會核心') { core++; if (f.job.name === '農漁業') coreFarm++; }
    assert.ok(['爸爸', '媽媽'].length === 2 && f.child.name && f.school.name.endsWith('某國小'));
  }
  assert.ok(counties.size >= 15 && jobs.size >= 20);
  assert.ok(needs.has('ADHD'));
  assert.ok(ruralFarm / rural > coreFarm / core, '農漁業在偏鄉應比都會核心常見（相依鏈）');
});

test('ADHD 的「有」和「被診斷」分開：有的人只有一部分會被診斷', () => {
  let has = 0, dx = 0;
  for (let s = 1; s <= 3000; s++) {
    const n = generateFamily(s, idn()).child.needs.find((x) => x.kind === 'ADHD');
    if (n) { has++; if (n.dxTurn != null) dx++; assert.equal(n.diagnosed, false); }
  }
  assert.ok(has / 3000 > 0.05 && has / 3000 < 0.11, `ADHD 比例 ${has / 3000}`);
  assert.ok(dx / has > 0.15 && dx / has < 0.45, `被診斷的比例 ${dx / has}`);
});

test('每一步是獨立的亂數流：改某張表只改變那一步', () => {
  const seeds = [1, 2, 3, 77, 4096, 99999];
  const mutate = (fn, check) => {
    for (const s of seeds) {
      const base = generateFamily(s, idn());
      const m = clone(); fn(m);
      const alt = generateFamily(s, m);
      check(base, alt, s);
    }
  };
  // 自己被怎麼帶大：沒有任何東西依賴它
  mutate((m) => { m.upbringing.w = [0, 0, 0, 1]; }, (a, b) => {
    assert.equal(b.upbringing, '很少在家');
    assert.deepEqual(without(a, 'upbringing'), without(b, 'upbringing'));
  });
  // 姓氏權重：只有孩子的名字改變
  mutate((m) => { m.surnameW = m.surnameW.map((_, i) => (i === 39 ? 1 : 0)); }, (a, b) => {
    assert.ok(b.child.name.startsWith('沈'));
    assert.deepEqual(without(a, 'child'), without(b, 'child'));
    assert.deepEqual(without(a.child, 'name'), without(b.child, 'name'));
  });
  // 寵物權重
  mutate((m) => { m.pets.base = [0, 0, 1, 0]; }, (a, b) => {
    assert.equal(b.pet.kind, '貓');
    assert.deepEqual(without(a, 'pet'), without(b, 'pet'));
  });
  // 學區國小班級人數
  mutate((m) => { for (const k of Object.keys(m.school.classSize)) m.school.classSize[k] = [40, 40]; }, (a, b) => {
    assert.equal(b.school.classSize, 40);
    assert.deepEqual(without(a, 'school'), without(b, 'school'));
  });
  // 氣質：只有孩子的氣質（以及依天分算的興趣不變）改變
  mutate((m) => { m.child.temperament.mean = 5; m.child.temperament.sd = 0.01; }, (a, b) => {
    assert.deepEqual(b.child.temperament, { 活動量: 5, 敏感度: 5, 堅持度: 5 });
    assert.deepEqual(without(a, 'child'), without(b, 'child'));
    assert.deepEqual(a.child.talents, b.child.talents);
    assert.deepEqual(a.child.needs, b.child.needs);
    assert.deepEqual(a.child.interests, b.child.interests);
  });
  // 職業權重：職業（以及依賴職業的家境、住屋等）會變，但縣市、孩子、自己被帶大都不變
  mutate((m) => { m.jobs.forEach((j, i) => { j.w = i === 12 ? 1000 : 0.0001; }); }, (a, b) => {
    assert.equal(b.job.name, '大學教授');
    for (const k of ['county', 'district', 'urban', 'upbringing', 'structure']) assert.deepEqual(a[k], b[k], k);
    assert.deepEqual(a.child.talents, b.child.talents);
    assert.deepEqual(a.child.needs, b.child.needs);
    assert.deepEqual(a.child.name, b.child.name);
  });
  // 縣市權重：縣市變，孩子的所有抽籤與自己被帶大不變
  mutate((m) => { m.counties.forEach((c, i) => { c.w = i === 6 ? 1000 : 0.0001; }); }, (a, b) => {
    assert.equal(b.county, '基隆市');
    assert.deepEqual(a.child.temperament, b.child.temperament);
    assert.deepEqual(a.child.talents, b.child.talents);
    assert.deepEqual(a.child.needs, b.child.needs);
    assert.equal(a.child.name, b.child.name);
    assert.equal(a.upbringing, b.upbringing);
  });
});

test('從國小開始：學前托育依 DATA §4 的比例抽出', () => {
  const c = { 父母自己帶: 0, 長輩主要照顧: 0, 送托: 0 };
  for (let s = 1; s <= 2000; s++) c[generateFamily(s, idn()).childcare.mode]++;
  assert.ok(c.父母自己帶 / 2000 > 0.42 && c.父母自己帶 / 2000 < 0.58, JSON.stringify(c));
  assert.ok(c.送托 / 2000 > 0.2 && c.送托 / 2000 < 0.36, JSON.stringify(c));
  assert.ok(c.長輩主要照顧 / 2000 > 0.1 && c.長輩主要照顧 / 2000 < 0.3, JSON.stringify(c));
});
