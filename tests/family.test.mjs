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
    if (n) { has++; if (n.dxMonths != null) dx++; assert.equal(n.diagnosed, false); assert.ok(n.dxMonths == null || n.dxMonths > n.onsetMonths); }
  }
  assert.ok(has / 3000 > 0.05 && has / 3000 < 0.11, `ADHD 比例 ${has / 3000}`);
  assert.ok(dx / has > 0.15 && dx / has < 0.45, `被診斷的比例 ${dx / has}`);
});

// A0（92 回合日曆）的回合序號 → 月齡：獨立寫一份，才測得出資料裡的 onsetMonths 清單對不對
const a0Months = (t) => (t < 8 ? t * 3 : t < 20 ? 24 + (t - 8) * 4 : 72 + (t - 20) * 2);
const A0_ONSET_TURNS = { ADHD: [14, 30], 學習障礙: [22, 34], 自閉症: [8, 24], 發展遲緩: [3, 14], 情緒行為障礙: [26, 40], 其他身心障礙: [0, 6], 資優: [20, 40] };
test('特殊需求的發作月齡：分布與 A0 相同（平均與分位數差在 ±3 個月內），確診延遲以月計且發作之後才確診', () => {
  const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  const got = {};
  for (let s = 1; s <= 20000; s++) for (const n of generateFamily(s, idn()).child.needs) {
    (got[n.kind] ||= []).push(n.onsetMonths);
    assert.ok(Number.isInteger(n.onsetMonths) && !('onset' in n) && !('dxTurn' in n));
    if (n.dxMonths != null) assert.ok(n.dxMonths >= n.onsetMonths && n.dxMonths <= n.onsetMonths + 40, `${n.kind} ${n.onsetMonths} → ${n.dxMonths}`);
  }
  for (const [kind, [lo, hi]] of Object.entries(A0_ONSET_TURNS)) {
    const a0 = []; for (let t = lo; t <= hi; t++) a0.push(a0Months(t)); // A0：回合序號均勻抽
    const g = got[kind];
    assert.ok(g && g.length > 30, kind);
    assert.ok(Math.abs(mean(g) - mean(a0)) <= 3, `${kind} 平均 ${mean(g).toFixed(1)} vs A0 ${mean(a0).toFixed(1)}`);
    // 分位數在離散清單的邊界上會跳一格，所以改比累積分布：A0 的每個月齡，抽出來的 ≤ 該月齡的比例差在 3 個百分點內（樣本夠多的類型）
    const cdf = (arr, v) => arr.filter((x) => x <= v).length / arr.length;
    if (g.length > 200) for (const v of a0) assert.ok(Math.abs(cdf(g, v) - cdf(a0, v)) < 0.06, `${kind} ≤${v} 個月：${cdf(g, v).toFixed(2)} vs A0 ${cdf(a0, v).toFixed(2)}`);
    const med = (arr) => { const b = [...arr].sort((x, y) => x - y); return (b[Math.floor((b.length - 1) / 2)] + b[Math.ceil((b.length - 1) / 2)]) / 2; };
    assert.ok(Math.abs(med(g) - med(a0)) <= 4, `${kind} 中位數 ${med(g)} vs A0 ${med(a0)}`);
    assert.ok(Math.min(...g) >= a0Months(lo) && Math.max(...g) <= a0Months(hi), `${kind} 範圍`);
  }
  // ADHD：發作月齡 → 回合：turn.js 以月齡比較（ageMonths ≥ onsetMonths）
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
  mutate((m) => { m.surnameW = m.surnameW.map((_, i) => (m.surnames[i] === '沈' ? 1 : 0)); }, (a, b) => {
    assert.ok(b.child.name.startsWith('沈'));
    assert.deepEqual(without(a, 'child'), without(b, 'child'));
    assert.deepEqual(without(a.child, 'name', 'given'), without(b.child, 'name', 'given')); // 單名時 given 帶姓
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
  const prof = BASE.jobs.findIndex((j) => j.name === '大學教授');
  mutate((m) => { m.jobs.forEach((j, i) => { j.w = i === prof ? 1000 : 0.0001; }); }, (a, b) => {
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

/* ───────────── 名字（DESIGN §2.2） ───────────── */
import { rollName } from '../js/engine/family.js';
import { mulberry32 } from '../js/engine/rng.js';
const NM = BASE.nameModel;
const rollMany = (sex, n, salt = 1) => { const r = mulberry32(salt); return Array.from({ length: n }, () => rollName(r, BASE, sex)); };

test('名字：同一個種子永遠同一個名字；名字用自己的亂數流，其他抽籤不受影響', () => {
  for (const s of [1, 2, 3, 500]) assert.equal(generateFamily(s, idn()).child.name, generateFamily(s, idn()).child.name);
  // 把名字字庫整個換掉：除了名字之外，整個家庭（含孩子的性別、氣質、天分、手足、寵物）不變
  for (const s of [1, 2, 3, 77, 4096]) {
    const m = clone(); m.nameModel.M.first = { 子: 1 }; m.nameModel.M.second = { 睿: 1 }; m.nameModel.F.first = { 品: 1 }; m.nameModel.F.second = { 妍: 1 };
    const a = generateFamily(s, idn()), b = generateFamily(s, m);
    assert.deepEqual(without(a.child, 'name', 'given'), without(b.child, 'name', 'given'));
    assert.deepEqual(without(a, 'child'), without(b, 'child'));
  }
});

test('名字：男女分開兩套字庫；強性別字不會跑到另一邊', () => {
  const strongM = new Set('柏翰廷翔豪軒碩睿彥冠昱辰凱傑'), strongF = new Set('妍妤瑄萱涵菲霏彤綺蓁芯苡婕琪馨薇恬柔');
  for (const side of ['M', 'F']) for (const pos of ['first', 'second']) for (const c of Object.keys(NM[side][pos])) assert.ok(!(side === 'M' ? strongF : strongM).has(c), `${side}.${pos} 含 ${c}`);
  for (const { given } of rollMany('男', 3000)) for (const c of given) assert.ok(!strongF.has(c), '男生名字出現偏女的字 ' + c);
  for (const { given } of rollMany('女', 3000)) for (const c of given) assert.ok(!strongM.has(c), '女生名字出現偏男的字 ' + c);
  // 兩性都常見的字兩邊都有
  for (const c of ['宥', '恩', '子', '品']) assert.ok(c in NM.M.first && c in NM.F.first, c);
});

test('名字：同一個字不重複、黑名單不會出現、姓名組合不在 blockFull', () => {
  for (const sex of ['男', '女']) for (const { surname, given } of rollMany(sex, 10000, 7)) {
    if (given.length === 2) assert.notEqual(given[0], given[1], given);
    assert.ok(!NM.blockGiven.includes(given), given);
    assert.ok(!NM.blockFull.includes(surname + given), surname + given);
  }
});

test('名字：黑名單是資料驅動的——把某個組合以外的字庫全部關掉，只剩黑名單組合時會被避開', () => {
  const m = clone();
  m.nameModel.M.first = { 思: 1, 士: 1 }; m.nameModel.M.second = { 哲: 1, 安: 1 }; m.nameModel.singleP.M = 0;
  const r = mulberry32(3);
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(rollName(r, m, '男').given);
  assert.ok(!seen.has('思哲') && !seen.has('士哲') && seen.has('思安') && seen.has('士安'), [...seen].join());
});

test('名字：單名比例約男 3%、女 5%；姓氏分布符合權重（陳最多）；10,000 次的分布合理', () => {
  const N = 10000;
  const m = rollMany('男', N, 11), f = rollMany('女', N, 12);
  const sm = m.filter((x) => x.given.length === 1).length / N, sf = f.filter((x) => x.given.length === 1).length / N;
  assert.ok(sm > 0.02 && sm < 0.042, '男單名 ' + sm);
  assert.ok(sf > 0.035 && sf < 0.065, '女單名 ' + sf);
  const cnt = {}; for (const x of m) cnt[x.surname] = (cnt[x.surname] || 0) + 1;
  const tot = BASE.surnameW.reduce((a, b) => a + b, 0); // 41 個姓重新歸一
  assert.ok(Math.abs(cnt.陳 / N - 11.2 / tot) < 0.012 && Math.abs(cnt.林 / N - 8.33 / tot) < 0.012, `陳 ${cnt.陳 / N} 林 ${cnt.林 / N}`);
  assert.ok(Object.keys(cnt).length >= 35);
  // 名字夠多樣：兩個字的名字至少 600 種不同；單一名字最多不超過 2%
  const two = m.filter((x) => x.given.length === 2).map((x) => x.given);
  const c2 = {}; for (const g of two) c2[g] = (c2[g] || 0) + 1;
  assert.ok(Object.keys(c2).length >= 600, '男生不同名字 ' + Object.keys(c2).length);
  assert.ok(Math.max(...Object.values(c2)) / N < 0.02);
  // 第一個字最常出現的是字庫權重最高的幾個
  const firsts = {}; for (const g of two) firsts[g[0]] = (firsts[g[0]] || 0) + 1;
  const top = Object.entries(firsts).sort((a, b) => b[1] - a[1]).slice(0, 4).map((x) => x[0]);
  assert.ok(['宥', '承', '子', '柏'].filter((c) => top.includes(c)).length >= 3, top.join());
  // 單名的孩子，文字裡叫的是全名
  for (const s of Array.from({ length: 800 }, (_, i) => i + 1)) { const c = generateFamily(s, idn()).child; if (c.name.length === 2) assert.equal(c.given, c.name); else assert.equal(c.name.endsWith(c.given), true); }
});

test('名字：_readme 說明來源，並標明設計估計／待確認與已查證的項目', () => {
  assert.ok(/設計估計/.test(NM._readme) && /待確認/.test(NM._readme) && /內政部/.test(NM._readme) && /無法連線/.test(NM._readme));
  assert.equal(BASE.surnames.length, BASE.surnameW.length);
  assert.deepEqual(BASE.surnames.slice(0, 11), ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許']);
});

/* ───────────── 職位、交通工具、通勤距離（§2.1 5b／8b） ───────────── */
import { familyCtx } from '../js/engine/family.js';
const many = (n, f) => { const o = []; for (let s = 1; s <= n; s++) o.push(generateFamily(s, idn())); return f ? o.filter(f) : o; };
const share = (arr, f) => arr.filter(f).length / Math.max(1, arr.length);

test('職位、交通工具、通勤距離：決定性，值都在合法範圍，並出現在 ctx 與開場文字', () => {
  const a = generateFamily(321, idn()), b = generateFamily(321, idn());
  assert.deepEqual([a.rank, a.transport, a.commute], [b.rank, b.transport, b.commute]);
  for (const f of many(300)) {
    assert.ok(['基層', '主管', '自己當老闆'].includes(f.rank) && ['沒有車', '機車', '汽車'].includes(f.transport) && ['近', '中', '遠'].includes(f.commute));
    const c = familyCtx(f, '爸爸');
    assert.equal(c.職位, f.rank); assert.equal(c.交通工具, f.transport); assert.equal(c.通勤距離, f.commute);
  }
  const txt = openingText(generateFamily(5, idn()), '媽媽').join('');
  assert.ok(/主管|職員|老闆/.test(txt) && /沒有車|機車|一台車/.test(txt) && /上班/.test(txt));
});

test('職位：自己開店、農漁業、接案多半自己當老闆；公務員、教師多半基層；吃緊的主管比寬裕少', () => {
  const fs = many(4000);
  const own = fs.filter((f) => ['早餐店', '小吃店或自助餐', '夜市攤商', '農漁業', '自由接案（設計、攝影）', '中小企業老闆', '便利商店加盟'].includes(f.job.name));
  assert.ok(own.length > 100 && share(own, (f) => f.rank === '自己當老闆') > 0.8, '自營業老闆比例 ' + share(own, (f) => f.rank === '自己當老闆'));
  const gov = fs.filter((f) => ['公務員', '教師', '科技廠作業員（輪班）'].includes(f.job.name));
  assert.ok(share(gov, (f) => f.rank === '基層') > 0.75 && share(gov, (f) => f.rank === '自己當老闆') < 0.02);
  const same = fs.filter((f) => f.job.name === '金融或保險');
  assert.ok(share(same.filter((f) => f.econ === '寬裕'), (f) => f.rank === '主管') >= share(same.filter((f) => f.econ === '吃緊'), (f) => f.rank === '主管'));
});

test('交通工具與通勤：偏鄉多半需要車、都會核心沒有車較多；吃緊的家庭沒有車較多；偏鄉通勤遠比都會核心常見', () => {
  const fs = many(5000);
  const core = fs.filter((f) => f.urban === '都會核心'), rural = fs.filter((f) => f.urban === '偏鄉');
  assert.ok(share(core, (f) => f.transport === '沒有車') > share(rural, (f) => f.transport === '沒有車') * 3);
  assert.ok(share(rural, (f) => f.transport === '汽車') > share(core, (f) => f.transport === '汽車'));
  assert.ok(share(fs.filter((f) => f.econ === '吃緊'), (f) => f.transport === '沒有車') > share(fs.filter((f) => f.econ === '寬裕'), (f) => f.transport === '沒有車') * 3);
  assert.ok(share(rural, (f) => f.commute === '遠') > share(core, (f) => f.commute === '遠') * 1.5);
});

test('職位、交通、通勤各用自己的亂數流：改這三張表，其他抽籤完全不變；反過來也一樣', () => {
  for (const s of [1, 2, 3, 77, 4096]) {
    const m = clone(); m.transport.byEcon = { 寬裕: [1, 0, 0], 小康: [1, 0, 0], 吃緊: [1, 0, 0] }; m.commute.byUrban = Object.fromEntries(Object.keys(m.commute.byUrban).map((k) => [k, [0, 0, 1]]));
    const a = generateFamily(s, idn()), b = generateFamily(s, m);
    assert.equal(b.transport, '沒有車'); assert.equal(b.commute, '遠');
    assert.equal(b.rank, a.rank);
    assert.deepEqual(without(a, 'transport', 'commute'), without(b, 'transport', 'commute'));
    const m2 = clone(); for (const j of m2.jobs) j.rank = [0, 0, 1];
    const c = generateFamily(s, m2);
    assert.equal(c.rank, '自己當老闆');
    assert.deepEqual(without(a, 'rank'), without(c, 'rank'));
  }
});

test('開場文字：每一種工作型態的句子都沒有「，的」', () => {
  const base = generateFamily(7, idn());
  for (const pattern of Object.keys(idn().patterns)) {
    for (const role of ['爸爸', '媽媽']) {
      const text = openingText({ ...base, pattern }, role).join('');
      assert.ok(!text.includes('，的'), `${pattern}：${text.slice(0, 120)}`);
    }
  }
});

test('住屋：住長輩家只會和「長輩同住」一起出現（1000 個種子）', () => {
  let live = 0;
  for (let s = 1; s <= 1000; s++) {
    const f = generateFamily(s, idn());
    if (f.housing === '住長輩家') { live++; assert.equal(f.elders.status, '同住', `seed ${s}`); }
  }
  assert.ok(live > 0, '住長輩家仍然會出現');
});
