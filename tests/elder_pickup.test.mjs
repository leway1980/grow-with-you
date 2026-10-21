// 項目 12：長輩接送看長輩的謹慎、不是孩子的交通安全認知；事故卡不再靠導護志工打電話通知
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { buildCtx } from '../js/engine/events.js';
import { evalCond } from '../js/engine/events.js';

const data = loadData();
const mult = (card, ctx) => card.modifiers.filter((m) => evalCond(m.if, ctx)).reduce((a, m) => a * m.x, 1);

test('長輩接送：事故卡的權重看長輩謹慎；孩子的認知只管自己走或騎車', () => {
  for (const id of ['cm_scrape', 'cm_near', 'cm_hospital']) {
    const c = data.cardIndex[id];
    const base = { 上學方式: '長輩接送', 城鄉: '都會核心', 交通安全認知: 20 };
    assert.equal(mult(c, { ...base, 長輩謹慎: '普通' }), 1, id + '：長輩接送時孩子的認知不該影響');
    assert.equal(mult(c, { ...base, 長輩謹慎: '大意' }), 1.5, id);
    assert.equal(mult(c, { ...base, 長輩謹慎: '小心' }), 0.6, id);
    assert.equal(mult(c, { ...base, 上學方式: '走路公車', 長輩謹慎: '大意', 交通安全認知: 20 }), 1.5, id + '：走路時看孩子的認知');
  }
});

test('家庭有長輩才有謹慎值，ctx 暴露「長輩謹慎」；沒有導護志工打電話', () => {
  let seen = new Set();
  for (let seed = 1; seed < 60; seed++) { const st = newState(seed, data, { role: '媽媽' }); const e = st.family.elders; if (e.status === '沒有') assert.equal(e.caution, null); else seen.add(e.caution); assert.ok(['小心', '普通', '大意'].includes(buildCtx(st, data.timeline[10]).長輩謹慎)); }
  assert.deepEqual([...seen].sort(), ['大意', '小心', '普通']);
  assert.ok(!JSON.stringify(data.cardIndex.cm_near).includes('導護志工今天打電話'));
});
