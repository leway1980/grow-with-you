// 孩子來找你（DESIGN §4.28 連續才是關鍵）：看連續、不看總數；回來的路也要連續。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { applyTags } from '../js/engine/tags.js';
import { buildCtx, describeCard } from '../js/engine/events.js';

const data = loadData();
const T = data.tags;
const fresh = (sens = 3) => { const st = newState(7, data, { role: '媽媽' }); st.family.child.temperament.敏感度 = sens; st.turn = 25; return st; };
const stage = '國小低';
const miss = (st) => applyTags(st, ['敷衍帶過'], T, { turn: st.turn, stage, ctx: {}, approach: true });
const attend = (st) => applyTags(st, ['放下手機陪', '聽他說完'], T, { turn: st.turn, stage, ctx: {}, approach: true });
const other = (st, tags) => applyTags(st, tags, T, { turn: st.turn, stage, ctx: {}, approach: false });

test('連續錯過：錯過、錯過、停下來聽、錯過、錯過 ⇒ 不會進入「不太來找你」；連續 4 次才會', () => {
  const a = fresh();
  miss(a); miss(a); attend(a); miss(a); miss(a);
  assert.equal(a.vars.不太來找你, 0); assert.equal(a.vars.孩子來找_連續錯過, 2);
  const b = fresh();
  for (let i = 0; i < 3; i++) miss(b);
  assert.equal(b.vars.不太來找你, 0);
  miss(b);
  assert.equal(b.vars.不太來找你, 1);
});

test('敏感度高的孩子，連續 3 次就進入；不是 approach 的卡上的錯過標籤不算', () => {
  const st = fresh(5);
  miss(st); miss(st); assert.equal(st.vars.不太來找你, 0);
  miss(st); assert.equal(st.vars.不太來找你, 1);
  const o = fresh();
  for (let i = 0; i < 6; i++) other(o, ['敷衍帶過']);
  assert.equal(o.vars.不太來找你, 0); assert.equal(o.vars.孩子來找_連續錯過, 0);
});

test('回來的路也要連續：一次補償（禮物、出遊）不算也不離開；中間又錯過就歸零；連續 3 次（國小低）才離開', () => {
  const st = fresh();
  for (let i = 0; i < 4; i++) miss(st);
  assert.equal(st.vars.不太來找你, 1);
  other(st, ['出遊_一起準備與討論']); other(st, ['外包']); other(st, ['3C當保母']); // 禮物、出遊、花錢：不算
  assert.equal(st.vars.不太來找你, 1); assert.equal(st.vars.孩子來找_回來連續, 0);
  attend(st); attend(st); assert.equal(st.vars.不太來找你, 1);
  miss(st); assert.equal(st.vars.孩子來找_回來連續, 0);
  other(st, ['問具體的事']); attend(st); assert.equal(st.vars.不太來找你, 1); // 主動去找他也算，但還差一次
  attend(st);
  assert.equal(st.vars.不太來找你, 0); assert.equal(st.vars.孩子來找_連續錯過, 0);
});

test('年紀越大，回來得越慢：國小中高要連續 4 次', () => {
  const st = fresh();
  for (let i = 0; i < 4; i++) applyTags(st, ['敷衍帶過'], T, { turn: 40, stage: '國小中高', ctx: {}, approach: true });
  for (let i = 0; i < 3; i++) applyTags(st, ['聽他說完'], T, { turn: 40, stage: '國小中高', ctx: {}, approach: true });
  assert.equal(st.vars.不太來找你, 1);
  applyTags(st, ['聽他說完'], T, { turn: 40, stage: '國小中高', ctx: {}, approach: true });
  assert.equal(st.vars.不太來找你, 0);
});

test('「不太來找你」時：孩子來問只說「沒事」（文字變短），approach 卡與工作插播／孩子重提的池權重變小', () => {
  const st = fresh();
  const tl = data.timeline[25];
  const card = data.cardIndex.lo_interrupt;
  assert.ok(!describeCard(card, st, data, tl).text.includes('沒事。」'));
  for (let i = 0; i < 4; i++) miss(st);
  assert.equal(buildCtx(st, tl).不太來找你, true);
  for (let k = 0; k < 5; k++) { st.cardScope = null; st.slotLast = {}; assert.ok(describeCard(card, st, data, tl).text.includes('只說：「沒事。」'), describeCard(card, st, data, tl).text); st.turn++; }
  for (const pool of ['工作插播', '工作插播後續', '孩子重提']) assert.ok(data.pools[pool].mods.some((m) => m.if === '不太來找你' && m.x === T.approach.weightX), pool);
  assert.ok(data.cardIndex.lo_nofriend.approach && data.cardIndex.hi_work_ping.approach);
});
