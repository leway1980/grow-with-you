// 孩子來找你（DESIGN §4.28 連續才是關鍵）：看連續、不看總數；回來的路也要連續。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { applyTags } from '../js/engine/tags.js';
import { buildCtx, describeCard } from '../js/engine/events.js';
import { censorByStage, censorStats, playableEndMonths, stageStartMonths } from '../tools/approach-log.mjs';

const data = loadData();
const T = data.tags;
const fresh = (sens = 3) => { const st = newState(7, data, { role: '媽媽' }); st.family.child.temperament.敏感度 = sens; st.turn = 25; return st; };
const stage = '國小低';
const miss = (st) => applyTags(st, ['敷衍帶過'], T, { turn: st.turn, stage, ctx: {}, approach: true });
const attend = (st) => applyTags(st, ['放下手機陪', '聽他說完'], T, { turn: st.turn, stage, ctx: {}, approach: true });
const other = (st, tags, initiate = false) => applyTags(st, tags, T, { turn: st.turn, stage, ctx: {}, approach: false, initiate });

const A = T.approach;
const need = (stage) => Math.ceil(A.exitStreak[stage] / (A.approachCredit ?? 1)); // 接住孩子來找幾次才離開

test('連續錯過：錯過、錯過、停下來聽、錯過、錯過 ⇒ 不會進入「不太來找你」；連續 enterAt 次才會', () => {
  const a = fresh();
  miss(a); miss(a); attend(a); miss(a); miss(a);
  assert.equal(a.vars.不太來找你, 0); assert.equal(a.vars.孩子來找_連續錯過, 2);
  const b = fresh();
  for (let i = 0; i < A.enterAt - 1; i++) miss(b);
  assert.equal(b.vars.不太來找你, 0);
  miss(b);
  assert.equal(b.vars.不太來找你, 1);
});

test('敏感度高的孩子，少一次就進入；不是 approach 的卡上的錯過標籤不算', () => {
  const st = fresh(5);
  for (let i = 0; i < A.enterAtSensitive - 1; i++) miss(st);
  assert.equal(st.vars.不太來找你, 0);
  miss(st); assert.equal(st.vars.不太來找你, 1);
  assert.ok(A.enterAtSensitive < A.enterAt);
  const o = fresh();
  for (let i = 0; i < 8; i++) other(o, ['敷衍帶過']);
  assert.equal(o.vars.不太來找你, 0); assert.equal(o.vars.孩子來找_連續錯過, 0);
});

test('回來的路：一次補償（禮物、出遊）不算也不離開；中間又錯過就歸零；接住孩子來找 approachCredit 份、主動去找他（initiate 的卡）1 份，累積到 exitStreak 才離開', () => {
  const st = fresh();
  for (let i = 0; i < A.enterAt; i++) miss(st);
  assert.equal(st.vars.不太來找你, 1);
  other(st, ['出遊_一起準備與討論']); other(st, ['外包']); other(st, ['3C當保母']); // 禮物、出遊、花錢：不算
  assert.equal(st.vars.不太來找你, 1); assert.equal(st.vars.孩子來找_回來連續, 0);
  // 接住孩子來找一次 = approachCredit 份（國中要的份數比較多，所以還沒離開）
  applyTags(st, ['放下手機陪', '聽他說完'], T, { turn: 40, stage: '國中', ctx: {}, approach: true });
  assert.equal(st.vars.孩子來找_回來連續, A.approachCredit ?? 1); assert.equal(st.vars.不太來找你, 1);
  miss(st); assert.equal(st.vars.孩子來找_回來連續, 0, '中間又錯過就歸零');
  // 主動去找他：1 份（要連續 exitStreak 份）
  const stage2 = '國小低', k = A.exitStreak[stage2];
  for (let i = 0; i < k - 1; i++) other(st, ['問具體的事'], true);
  assert.equal(st.vars.不太來找你, 1); assert.equal(st.vars.孩子來找_回來連續, k - 1);
  other(st, ['問具體的事'], true);
  assert.equal(st.vars.不太來找你, 0); assert.equal(st.vars.孩子來找_連續錯過, 0); assert.equal(st.vars.不太來找你_離開_主動, 1);
});

test('年紀越大，回來得越慢（到國中為止）：國中要的份數比國小多', () => {
  assert.ok(A.exitStreak.國中 > A.exitStreak.國小中高 && A.exitStreak.國小中高 > A.exitStreak.國小低); // 高中 3（每年只有 2 回合，6 回合等於三年；計畫 §8 第 6 項）不再比國中大
  const st = fresh();
  for (let i = 0; i < A.enterAt; i++) applyTags(st, ['敷衍帶過'], T, { turn: 40, stage: '國中', ctx: {}, approach: true });
  const n = need('國中');
  assert.ok(n >= 2, '國中要接住孩子至少兩次');
  for (let i = 0; i < n - 1; i++) applyTags(st, ['聽他說完'], T, { turn: 40, stage: '國中', ctx: {}, approach: true });
  assert.equal(st.vars.不太來找你, 1);
  applyTags(st, ['聽他說完'], T, { turn: 40, stage: '國中', ctx: {}, approach: true });
  assert.equal(st.vars.不太來找你, 0);
});

test('「不太來找你」時：孩子來問只說「沒事」（文字變短），approach 卡與工作插播／孩子重提的池權重變小', () => {
  const st = fresh();
  const tl = data.timeline[25];
  const card = data.cardIndex.lo_interrupt;
  assert.ok(!describeCard(card, st, data, tl).text.includes('沒事。」'));
  for (let i = 0; i < A.enterAt; i++) miss(st);
  assert.equal(buildCtx(st, tl).不太來找你, true);
  for (let k = 0; k < 5; k++) { st.cardScope = null; st.slotLast = {}; assert.ok(describeCard(card, st, data, tl).text.includes('只說：「沒事。」'), describeCard(card, st, data, tl).text); st.turn++; }
  for (const pool of ['工作插播', '工作插播後續', '孩子重提']) assert.ok(data.pools[pool].mods.some((m) => m.if === '不太來找你' && m.x === T.approach.weightX), pool);
  assert.ok(data.cardIndex.lo_nofriend.approach && data.cardIndex.hi_work_ping.approach);
});

test('離開只算 approach 卡與 initiate:true 的卡（父母主動去找孩子）；固定事件、出遊、沒有 initiate 的卡上的陪伴不算', () => {
  const st = fresh();
  for (let i = 0; i < A.enterAt; i++) miss(st);
  assert.equal(st.vars.不太來找你, 1);
  // 沒有 initiate 的卡（日常、固定事件、出遊）：放下手機陪、聽他說完、問具體的事、先接住情緒都不算
  for (let i = 0; i < 6; i++) other(st, ['放下手機陪', '聽他說完', '問具體的事', '先接住情緒', '出遊_一起準備與討論']);
  assert.equal(st.vars.不太來找你, 1); assert.equal(st.vars.孩子來找_回來連續, 0);
  // initiate:true 的卡上同樣的標籤才算：每次 1 份，累積到 exitStreak（國小低）
  const k = A.exitStreak.國小低;
  for (let i = 0; i < k - 1; i++) other(st, ['放下手機陪'], true);
  assert.equal(st.vars.不太來找你, 1);
  other(st, ['聽他說完'], true);
  assert.equal(st.vars.不太來找你, 0); assert.equal(st.vars.不太來找你_離開_主動, 1);
});

test('資料：initiate 的卡都是父母主動去找孩子；固定事件、出遊的卡沒有 initiate；工作插播的「你先自己玩」是敷衍帶過', () => {
  const cards = data.events.cards;
  const init = cards.filter((c) => c.initiate);
  assert.ok(init.length >= 8, `initiate 的卡 ${init.length} 張`);
  for (const c of cards) if (c.pool === '_fixed' || /trip|trial|news/.test(c.id)) assert.ok(!c.initiate, c.id);
  for (const id of ['inf_bedtime', 'lo_sleep', 'hi_paper_drawer', 'hi_friend_worry', 'fu_phone_test']) assert.ok(data.cardIndex[id].initiate, id);
  // 工作插播：「你先自己想想看／你先自己玩一下」＝敷衍帶過（錯過）；新增「說好十分鐘後去找你」，排後續卡，當下不算錯過也不算接住
  const A = T.approach;
  for (const id of ['wp_kg_call', 'wp_kg_bath', 'lo_interrupt', 'wp_lo_weekend', 'hi_work_ping', 'wp_hi_table', 'wp_hi_car']) {
    const c = data.cardIndex[id];
    // 看機制與標籤，不看措辭：『先自己玩／想想看』＝帶 敷衍帶過；『說好稍後去找你』＝排了 lo_interrupt_back 的後續卡；『看起來在聽』＝帶 假裝聽（也是錯過）
    const self = c.choices.find((o) => (o.tags || []).includes('敷衍帶過')), ten = c.choices.find((o) => (o.followUp || []).some((f) => f.card === 'lo_interrupt_back'));
    const fake = c.choices.find((o) => (o.tags || []).includes('假裝聽'));
    assert.ok(self && A.missTags.includes('敷衍帶過'), id);
    assert.ok(fake && A.missTags.includes('假裝聽'), id + ' 沒有「假裝聽」的選項');
    assert.ok(ten, id + ' 沒有「說好稍後去找你」');
    assert.ok(ten.tags.every((t) => !A.missTags.includes(t) && !A.attendTags.includes(t)), id + '：說好稍後當下不算錯過也不算接住');
    assert.equal(ten.followUp[0].card, 'lo_interrupt_back');
  }
  const back = data.cardIndex.lo_interrupt_back;
  assert.ok(back.choices[0].tags.some((t) => A.attendTags.includes(t)), '回去找他＝接住');
  assert.ok(back.choices[3].tags.some((t) => A.attendTags.includes(t)));
  assert.ok(back.choices[1].tags.some((t) => A.missTags.includes(t)) && back.choices[2].tags.some((t) => A.missTags.includes(t)), '沒回去＝錯過');
});

test('主動找他池：進入「不太來找你」時權重 ×repairBoost（2.5），國小 6 張＋國中 5 張＋高中 3 張，都只在這個狀態出現', () => {
  const A = data.tags.approach, pool = data.pools['主動找他'];
  assert.ok(pool && pool.mods.some((m) => m.if === '不太來找你' && m.x === A.repairBoost));
  assert.ok(A.repairBoost >= 2 && A.repairBoost <= 3);
  const cards = Object.values(data.cardIndex).filter((c) => c.pool === '主動找他');
  assert.equal(cards.filter((c) => c.stages.some((x) => ['幼兒園', '國小低', '國小中高'].includes(x))).length, 6);
  assert.equal(cards.filter((c) => c.stages.includes('國中')).length, 5); // M3 B2：青少年的修復不是不可能，只是慢（DESIGN §6『木已成舟』）
  assert.equal(cards.filter((c) => c.stages.includes('高中')).length, 3);
  assert.equal(Object.values(data.cardIndex).filter((c) => c.approach && c.stages && c.stages.includes('國中')).length, 3);
  assert.equal(Object.values(data.cardIndex).filter((c) => c.approach && c.stages && c.stages.includes('高中')).length, 2);
  for (const c of cards) { assert.equal(c.initiate, true); assert.equal(c.requires.expr, '不太來找你'); }
  assert.equal(A.approachCredit, 1);
});

test('假裝聽：和敷衍帶過一樣算錯過（連續錯過進入不太來找你），但標籤的影響不同', () => {
  const A = T.approach;
  assert.ok(A.missTags.includes('假裝聽') && !A.attendTags.includes('假裝聽'));
  const st = fresh();
  for (let i = 0; i < A.enterAt; i++) applyTags(st, ['假裝聽'], T, { turn: st.turn, stage, ctx: {}, approach: true });
  assert.equal(st.vars.不太來找你, 1);
  assert.notDeepEqual(T.tags['假裝聽'].d, T.tags['敷衍帶過'].d);
});

test('離開比例依進入的階段分開算（E1 審查）：國小畢業以前的進入用「國中開始的月齡」當終點（和 A0 同一個定義），國中以後的進入用可玩終點；各自右設限', () => {
  const jh = stageStartMonths(data, '國中'), sh = stageStartMonths(data, '高中'), end = playableEndMonths(data);
  assert.equal(jh, 144); assert.ok(sh > jh && end > sh);
  const ep = [
    { enter: 30, exit: 40 },           // 幼兒園：進入時離國小畢業 ≥ 24 個月，10 個月內離開 → 算
    { enter: 100, exit: null },        // 國小：沒離開 → 符合條件但沒離開
    { enter: 110, exit: 150 },         // 國小：離開在 40 個月後（> 24）→ 符合條件，沒在 24 個月內離開
    { enter: 130, exit: 135 },         // 進入時離國小畢業不到 24 個月 → 不符合條件（右設限）
    { enter: 150, exit: 160 },         // 國中：離可玩終點 ≥ 24 個月，10 個月內離開
    { enter: 170, exit: null },        // 國中：沒離開
    { enter: end - 30, exit: end - 20 }, // 高中：離可玩終點 ≥ 24 個月，離開
    { enter: end - 10, exit: null },   // 離可玩終點不到 24 個月 → 不符合條件
  ];
  const c = censorByStage(ep, data);
  assert.deepEqual(c.elem, { entries: 4, eligible: 3, exited: 1 });
  assert.deepEqual(c.teen, { entries: 4, eligible: 3, exited: 2 });
  assert.deepEqual(c.jh, { entries: 2, eligible: 2, exited: 1 });
  assert.deepEqual(c.sh, { entries: 2, eligible: 1, exited: 1 });
  // 混在一起算（E1 的做法，終點一律是可玩終點）：國小最後兩年才進入的人也算進來（右設限被延後），整體符合條件 7、離開 4——和分開算的結果不同
  const all = censorStats(ep, end);
  assert.deepEqual(all, { entries: 8, eligible: 7, exited: 4 });
});
