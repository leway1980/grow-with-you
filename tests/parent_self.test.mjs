// 「父母自己」池（DESIGN §11 規則 6）：權重隨疲勞與可分擔的人變化；卡片橫跨各階段；孩子的卡不再固定附帶休息選項。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { buildCtx, poolWeight } from '../js/engine/events.js';
import { timelineOf } from '../js/engine/turn.js';

const data = loadData();
const POOL = '父母自己';
const cards = data.events.cards.filter((c) => c.pool === POOL);

test('「父母自己」池：8–20 張卡（rest-parent 校準需要夠多的自我照顧機會；E1 審查後補國中、高中，上限 14 → 20），橫跨嬰幼兒到高中，每張 3–5 個選項', () => {
  assert.ok(cards.length >= 8 && cards.length <= 20, String(cards.length));
  for (const st of ['嬰幼兒', '幼兒園', '國小低', '國小中高']) assert.ok(cards.filter((c) => (c.stages || [st]).includes(st)).length >= 6, st);
  // E1 審查：國中、高中不能是空池（休息的機會在青春期不能消失）
  for (const st of ['國中', '高中']) assert.ok(cards.filter((c) => (c.stages || []).includes(st)).length >= 4, st);
  for (const c of cards) assert.ok(c.choices.length >= 3 && c.choices.length <= 5, c.id);
});

test('「父母自己」池：疲勞越高、體力或耐心越低，權重越大', () => {
  const st = newState(7, data, {});
  const tl = timelineOf(st, data);
  const w = (patch) => {
    const s = structuredClone(st);
    Object.assign(s.costEMA, patch.ema || {}); Object.assign(s.parent, patch.parent || {});
    return poolWeight(s, data, POOL, buildCtx(s, tl));
  };
  const calm = w({}), tired = w({ ema: { 體力: 3, 耐心: 2 } }), veryTired = w({ ema: { 體力: 5, 耐心: 4 } }), low = w({ ema: { 體力: 5, 耐心: 4 }, parent: { 耐心: 30, 體力: 30 } });
  assert.ok(calm > 0 && tired > calm * 1.5 && veryTired > tired * 1.3 && low > veryTired * 1.3, [calm, tired, veryTired, low].join(' < '));
  assert.ok(veryTired < poolWeight(st, data, '日常_嬰幼兒', buildCtx(st, tl)) * 2, '再累，這個池也不會蓋過孩子的事');
});

test('「父母自己」池：有另一半或長輩可以分擔時權重較大；卡片的選項也只在有人可以分擔時才出現', () => {
  const mk = (patch) => {
    const st = newState(3, data, {});
    st.costEMA = { 體力: 4, 耐心: 3 };
    st.family.partner = { present: !!patch.partner, attitude: patch.partner || '' };
    st.family.elders = { status: patch.elder || '沒有', who: patch.elder ? '阿嬤' : '' };
    return poolWeight(st, data, POOL, buildCtx(st, timelineOf(st, data)));
  };
  assert.ok(mk({ partner: '一起陪' }) > mk({}));
  assert.ok(mk({ elder: '同住' }) > mk({}));
  assert.equal(mk({ partner: '幾乎不在家' }), mk({}));
  const night = data.cardIndex.sf_elder_night;
  assert.ok(night.requires.expr.includes('長輩'));
});

test('疲勞進了條件環境：等於體力與耐心花費的累積', () => {
  const st = newState(5, data, {});
  st.costEMA = { 體力: 2.4, 耐心: 1.7 };
  assert.equal(buildCtx(st, timelineOf(st, data)).疲勞, 4);
});

test('孩子的事件卡不再固定附帶休息選項：帶休息標籤的選項只在少數卡上', () => {
  const child = data.events.cards.filter((c) => c.pool !== POOL);
  const rest = child.filter((c) => c.choices.some((ch) => ch.tags.includes('父母自己休息')));
  assert.ok(rest.length >= 1 && rest.length <= child.length * 0.2, `${rest.length}/${child.length}`);
  for (const c of rest) assert.equal(c.choices.filter((ch) => ch.tags.includes('父母自己休息')).length, 1);
});
