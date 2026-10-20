// 「這一年」生日小卡（M3 B3，js/engine/yearly.js、data/yearly.json、tools/lint/yearly.mjs）：
// 純函式（呼叫前後 JSON.stringify(st) 完全相同）、最多 3 筆事件且只有標題與選項、空白的一年、事實由 rngAt 決定且尊重 if、lint 抓得到壞資料。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadData, ROOT } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { playTurn } from '../js/engine/turn.js';
import { selfChoice } from '../js/engine/auto.js';
import { rngAt } from '../js/engine/rng.js';
import { yearSummary } from '../js/engine/yearly.js';
import lintYearly, { EVIDENCE } from '../tools/lint/yearly.mjs';

const Y = JSON.parse(readFileSync(`${ROOT}/data/yearly.json`, 'utf8'));
const data = loadData(); data.yearly = Y;
const newAgeTurns = data.timeline.filter((t) => t.newAge).map((t) => t.turn);
const fresh = (seed = 1, role = '媽媽') => newState(seed, data, { role, startMode: 'birth', preview: true });

test('日曆：1–18 歲各有一個 newAge 回合', () => {
  assert.equal(newAgeTurns.length, 18);
  assert.deepEqual(newAgeTurns.map((t) => Math.floor(data.timeline[t].ageMonths / 12)), Array.from({ length: 18 }, (_, i) => i + 1));
});

test('不是新的一歲的回合回傳 null', () => {
  const st = fresh();
  assert.equal(yearSummary(st, data, 0), null);
  assert.equal(yearSummary(st, data, newAgeTurns[0] + 1), null);
  assert.equal(yearSummary(st, data, 9999), null);
});

test('純函式：一整局裡每個新的一歲，呼叫前後狀態逐字相同；事件最多 3 筆、只有標題與選項文字', () => {
  for (const seed of [1, 2, 3]) {
    const st = fresh(seed, seed % 2 ? '媽媽' : '爸爸');
    const policy = { choose: (s, view) => selfChoice(s, view) };
    let seen = 0, guard = 0;
    while (!st.ended && guard++ < 200) {
      if (data.timeline[st.turn] && data.timeline[st.turn].newAge) {
        const before = JSON.stringify(st);
        const y = yearSummary(st, data, st.turn);
        assert.equal(JSON.stringify(st), before, `seed ${seed} 回合 ${st.turn}：小卡改了狀態`);
        assert.equal(y.age, Math.floor(data.timeline[st.turn].ageMonths / 12));
        assert.ok(y.events.length <= 3);
        for (const e of y.events) assert.deepEqual(Object.keys(e).sort(), ['label', 'title'], '事件只能有標題與選項文字，不能有分數');
        assert.equal(y.together, null);
        assert.ok(y.fact && y.fact.text && y.fact.source.who && y.fact.source.year);
        seen++;
      }
      playTurn(st, data, policy);
    }
    assert.ok(seen >= 17, `seed ${seed} 至少遇到 17 個新的一歲（${seen}）`);
  }
});

test('空白的一年：沒有任何 hist 也能回傳（events 是空陣列）；沒有 yearly 資料時 fact 是 null', () => {
  const st = fresh();
  const t = newAgeTurns[3];
  const y = yearSummary(st, data, t);
  assert.deepEqual(y.events, []);
  assert.ok(y.fact);
  const noData = { ...data, yearly: null };
  const z = yearSummary(st, noData, t);
  assert.equal(z.fact, null); assert.deepEqual(z.events, []);
});

test('事件：只取過去 12 個月、依 hist.d 的變化量大小取前 3、同分取較晚的；沒有 d 的紀錄排最後', () => {
  const st = fresh();
  const t = newAgeTurns[7]; // 8 歲
  const M = data.timeline[t].ageMonths;
  const mk = (m, title, d) => ({ turn: 0, m, k: 1, card: 'x', title, ch: 0, label: `選${title}`, tags: [], ...(d ? { d } : {}) });
  st.hist = [mk(M - 20, '太久以前', { 心情: 9 }), mk(M - 10, '小', { 心情: 1 }), mk(M - 8, '大', { 心情: -5, 睡眠: 3 }), mk(M - 6, '中', { 作業: 4 }), mk(M - 4, '無d'), mk(M - 2, '中二', { 作業: -4 }), mk(M, '同月之後', { 心情: 50 })];
  const before = JSON.stringify(st);
  const y = yearSummary(st, data, t);
  assert.equal(JSON.stringify(st), before);
  assert.deepEqual(y.events.map((e) => e.title), ['大', '中', '中二']);
  assert.deepEqual(y.events[0], { title: '大', label: '選大' });
});

test('事實：同一局同一歲永遠同一則（rngAt(seed, 歲數, "yearly")）；if 不通過的不會被挑到', () => {
  const st = fresh(7);
  const t = newAgeTurns[5]; // 6 歲：有 3 則
  const live = Y.ages[6].facts;
  const want = live[Math.floor(rngAt(7, 6, 'yearly') * live.length)].id;
  assert.equal(yearSummary(st, data, t).fact.id, want);
  assert.equal(yearSummary(st, data, t).fact.id, want);
  // 10 歲有 ADHD 才有的那一則：沒有 ADHD 的孩子永遠看不到
  const t10 = newAgeTurns[9];
  const seen = new Set();
  for (let seed = 1; seed <= 80; seed++) {
    const s = fresh(seed);
    const has = s.family.child.needs.some((n) => n.kind === 'ADHD' || n.kind === '情緒行為障礙');
    const f = yearSummary(s, data, t10).fact;
    seen.add(f.id);
    if (!has) assert.notEqual(f.id, 'y_sn_adhd', `seed ${seed} 沒有 ADHD／情緒行為障礙卻看到了`);
  }
  assert.ok(seen.has('y10_asthma'));
  const fake = { ...data, yearly: { ages: { 6: { facts: [{ id: 'a', text: 'a', source: { who: 'w', year: 1 }, if: '年齡 == 99' }] } } } };
  assert.equal(yearSummary(fresh(), fake, newAgeTurns[5]).fact, null);
  const bad = { ...data, yearly: { ages: { 6: { facts: [{ id: 'a', text: 'a', source: { who: 'w', year: 1 }, if: '不存在的變數 > 1 &&&' }, { id: 'b', text: 'b', source: { who: 'w', year: 1 } }] } } } };
  assert.equal(yearSummary(fresh(), bad, newAgeTurns[5]).fact.id, 'b');
});

test('together：有線上統計的快照才有，沒有就是 null', () => {
  const st = fresh();
  assert.equal(yearSummary(st, data, newAgeTurns[2]).together, null);
  assert.equal(yearSummary(st, data, newAgeTurns[2], { byAge: { 3: '今年有 12 位' } }).together, '今年有 12 位');
});

test('yearly.json 資料：lint 0 個錯誤；1–18 歲都有事實', () => {
  const r = lintYearly({});
  assert.deepEqual(r.errors, []);
  for (let a = 1; a <= 18; a++) assert.ok(Y.ages[a].facts.length >= 1, `${a} 歲`);
  assert.ok(Object.values(Y.ages).every((x) => x.facts.every((f) => EVIDENCE.includes(f.evidence))));
});

test('lint 抓得到壞資料：缺歲數、evidence 不在列舉、沒有網址、超過 80 字、比較字眼、只有條件事實、二手來源', () => {
  const good = JSON.parse(JSON.stringify(Y));
  const run = (mut) => { const y = JSON.parse(JSON.stringify(good)); mut(y); return lintYearly({ raw: { yearly: y } }).errors; };
  assert.ok(run((y) => { delete y.ages[5]; }).some((e) => /5 歲沒有/.test(e)));
  assert.ok(run((y) => { y.ages[1].facts[0].evidence = '很強'; }).some((e) => /evidence/.test(e)));
  assert.ok(run((y) => { delete y.ages[6].facts[1].source.url; }).some((e) => /source\.url/.test(e)));
  assert.ok(run((y) => { y.ages[6].facts[0].text = '字'.repeat(81); }).some((e) => /超過 80/.test(e)));
  assert.ok(run((y) => { y.ages[7].facts[0].text = '你的孩子比其他孩子近視得早。'; }).some((e) => /比其他/.test(e)));
  assert.ok(run((y) => { y.ages[3].facts[0].text = '全國排名第一。'; }).some((e) => /排名/.test(e)));
  assert.ok(run((y) => { y.ages[3].facts[0].if = '城鄉 == "偏鄉"'; }).some((e) => /3 歲每則事實都有 if/.test(e)));
  assert.ok(run((y) => { y.ages[3].facts[0].verified = '已核二手'; }).some((e) => /verified/.test(e)));
  assert.ok(run((y) => { y.ages[3].facts[0].if = '(('; y.ages[3].facts.push({ ...y.ages[3].facts[0], id: 'z', if: undefined }); }).some((e) => /if 無法編譯/.test(e)));
  // 里程碑類可以沒有網址，只要有 source.who
  assert.deepEqual(run((y) => { delete y.ages[1].facts[0].source.url; }).filter((e) => /source\.url/.test(e)), []);
});

test('卡片與資料裡沒有模型名稱、沒有比較字眼', () => {
  const all = JSON.stringify(Y);
  assert.ok(!/Claude|GPT|Sonnet|Opus|Haiku/i.test(all));
  assert.ok(!/比其他|排名/.test(Y.ages ? Object.values(Y.ages).flatMap((a) => a.facts.map((f) => f.text)).join('') : ''));
});
