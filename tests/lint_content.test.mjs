// 內容規則（DESIGN §11 規則 8、13、14、15、16 …）的 lint：現有資料要通過，違反時要被擋下（或警告）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintData } from '../tools/lint-data.mjs';
import { loadRaw } from '../tools/data-node.mjs';
import { ageMentions, zhNum } from '../tools/lint-content.mjs';

const run = (fn) => { const raw = structuredClone(loadRaw()); fn(raw); const r = lintData(raw); return { e: r.errors.join('\n'), w: r.warns.join('\n') }; };
const card = (raw, id) => raw.events.cards.find((c) => c.id === id);

test('規則 8：中文數字與年齡字串', () => {
  assert.equal(zhNum('十二'), 12); assert.equal(zhNum('三'), 3); assert.equal(zhNum('兩'), 2); assert.equal(zhNum('8'), 8);
  assert.deepEqual(ageMentions('{孩子}八個月大').map((m) => [m.unit, m.lo, m.hi]), [['month', 8, 8]]);
  assert.deepEqual(ageMentions('{孩子}三個多月').map((m) => [m.lo, m.hi]), [[3, 5]]);
  assert.deepEqual(ageMentions('{孩子}快三歲了').map((m) => [m.lo, m.hi]), [[30, 36]]);
  assert.deepEqual(ageMentions('你已經三個月沒運動了，等到兩歲再看，十七歲的人').length, 0, '父母的時間長度、未來的年齡、別人的年齡都不算');
  assert.deepEqual(ageMentions('二年級了').map((m) => m.grades), [[2]]);
  assert.deepEqual(ageMentions('等三年級再說').length, 0);
  assert.deepEqual(ageMentions('一、二年級').map((m) => m.grades), [[1, 2]]);
});

test('規則 8：文字寫到月齡／年齡／年級，卡片就要有對應的年齡條件（±3 個月）', () => {
  assert.equal(run(() => {}).e, '');
  // 拿掉月齡條件 → 擋下
  assert.match(run((r) => { delete card(r, 'inf_read').requires; }).e, /inf_read：規則 8：文字寫「\{孩子\}八個月」/);
  assert.match(run((r) => { card(r, 'kid_toilet').requires = { expr: '月齡 >= 40' }; }).e, /kid_toilet：規則 8/);
  assert.match(run((r) => { card(r, 'lo_commute').requires = { expr: '年級 >= 1' }; }).e, /lo_commute：規則 8：文字寫「二年級」/);
  // ±3 個月之內可以
  assert.doesNotMatch(run((r) => { card(r, 'inf_read').requires = { expr: '月齡 >= 6 and 月齡 <= 9' }; }).e, /inf_read/);
  assert.match(run((r) => { card(r, 'inf_read').requires = { expr: '月齡 >= 12' }; }).e, /inf_read：規則 8/);
});

test('規則 8（醫療）：三個月內發燒的卡要有就醫的選項；六個月以上才有「在家觀察到天亮」', () => {
  const raw = loadRaw();
  const young = card(raw, 'inf_sick_young'), old = card(raw, 'inf_sick');
  assert.equal(young.requires.expr, '月齡 < 3');
  assert.ok(young.choices.some((c) => c.tags.includes('就醫')));
  assert.match(old.requires.expr, /月齡 >= 6/);
  assert.match(card(raw, 'inf_cant_go').text, /耳溫三十八度/);
});

test('規則 8（法規）：離開家去運動的選項要有另一個大人在家（六歲以下不能獨處）', () => {
  const raw = loadRaw();
  const o = card(raw, 'sf_exercise').choices[0];
  assert.match(o.showIf, /年級 >= 3/); assert.match(o.showIf, /有另一半/); assert.match(o.showIf, /長輩 == '同住'/);
});

/* ───── 規則 15：依角色切換的稱謂 ───── */
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { fill, roleWords } from '../js/engine/events.js';
import { FIXED_TOKENS, ROLE_TOKENS } from '../js/engine/slots.js';

test('規則 15：稱謂槽依玩家的角色與家庭切換（不抽籤）', () => {
  const data = loadData();
  const dad = newState(7, data, { role: '爸爸' }), mom = newState(7, data, { role: '媽媽' });
  const d = roleWords(dad), m = roleWords(mom);
  assert.equal(d.你爸媽, '爸爸'); assert.equal(m.你爸媽, '媽媽');
  assert.equal(d.另一半稱呼, '你媽'); assert.equal(m.另一半稱呼, '你爸');
  assert.equal(d.另一半稱呼_大人, '我太太'); assert.equal(m.另一半稱呼_大人, '我先生');
  assert.equal(d.另一半代名詞, '她'); assert.equal(m.另一半代名詞, '他');
  assert.equal(d.同學叫你, '叔叔'); assert.equal(m.同學叫你, '阿姨');
  assert.equal(d.假期結束, '假期結束'); assert.equal(m.假期結束, '產假結束');
  assert.equal(d.長輩稱呼, dad.family.elders.who || '長輩');
  for (const k of Object.keys(d)) assert.ok(ROLE_TOKENS.includes(k) && FIXED_TOKENS.includes(k), k);
  assert.equal(fill('「{你爸媽}，我問你喔」：去問{另一半稱呼}，{另一半代名詞}比較清楚', dad, null), '「爸爸，我問你喔」：去問你媽，她比較清楚');
  assert.equal(fill('{假期結束}之後', mom, null), '產假結束之後');
  // 另一半不在家（或沒有）時，「去問」的對象改成長輩
  const solo = newState(7, data, { role: '媽媽' });
  solo.family.partner = { present: false, status: '前配偶（共親職）', attitude: '幾乎不在家' }; solo.family.elders = { status: '同住', who: '外公外婆' };
  assert.equal(roleWords(solo).另一個大人, '外公外婆');
  solo.family.partner = { present: true, status: '同住', attitude: '一起陪' };
  assert.equal(roleWords(solo).另一個大人, '你爸');
});

test('規則 15：卡片文字不能寫死稱謂；{另一半} 不能出現在引號裡', () => {
  assert.match(run((r) => { card(r, 'hi_friend_worry').choices[0].result += '「謝謝阿姨。」'; }).e, /hi_friend_worry：規則 15：寫死了「阿姨」/);
  assert.match(run((r) => { card(r, 'fx_leave_end').text = '產假快結束了'; }).e, /fx_leave_end：規則 15：寫死了「產假」/);
  assert.match(run((r) => { card(r, 'fu_fight_after').choices[2].label = '說：「去問{另一半}」'; }).e, /fu_fight_after：規則 15：引號裡的 \{另一半\}/);
  assert.match(run((r) => { r.slots.slots.週末去處.push({ t: '阿公家' }); r.slots.slots.週末去處.push({ t: '媽媽做的便當' }); }).e, /槽 週末去處：規則 15：寫死了「媽媽做的便當」/);
  // 引號外的 {另一半} 是敘述，可以
  assert.doesNotMatch(run((r) => { card(r, 'fu_fight_after').choices[2].label = '請{另一半}去跟{他}說'; }).e, /fu_fight_after/);
});

test('規則 14：persist 的槽與 vars 要存在；存選定值的 setVars 要寫槽標記', () => {
  assert.match(run((r) => { r.slots.persist.不存在的槽 = '想要的球類'; }).e, /persist：槽「不存在的槽」不存在/);
  assert.match(run((r) => { r.slots.persist.球類 = '沒有這個變數'; }).e, /vars「沒有這個變數」不在 state/);
  assert.match(run((r) => { card(r, 'lo_club').choices[0].setVars = { 想要的球類: '籃球' }; }).e, /setVars「想要的球類」存的是槽「球類」選定的值/);
});
