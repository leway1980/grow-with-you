// 身體的照顧（DESIGN §4.37）：近視、脊椎側彎、牙齒矯正、扁平足、過敏、骨折；場景讀的旗標、有期限的旗標。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState, serialize, deserialize } from '../js/engine/state.js';
import { applyChoice, buildCtx, passes } from '../js/engine/events.js';
import { startTurn, expireFlags, finishTurn, chooseCard, nextCard } from '../js/engine/turn.js';
import { sceneSpec, sceneSVG, sceneAlt, BODY_FLAGS } from '../js/engine/scene.js';
import { stateRng } from '../js/engine/rng.js';

const data = loadData();
const fresh = (seed = 4) => newState(seed, data, { role: '媽媽', startMode: 'elementary' });
const turnWhere = (pred) => data.timeline.findIndex(pred);
const choose = (st, cardId, pred, turn) => {
  st.turn = turn;
  const card = data.cardIndex[cardId], i = card.choices.findIndex(pred);
  assert.ok(i >= 0, `${cardId} 找不到選項`);
  return applyChoice(st, data, card, i, data.timeline[turn], stateRng(st, 'rngS'));
};
const svgOf = (st, t) => { st.turn = t; return sceneSVG(sceneSpec(st, data, data.timeline[t])); };

test('近視這條路：就醫 → 選眼鏡的方案 → 戴眼鏡旗標 → 場景看得到眼鏡', () => {
  const st = fresh();
  const t = turnWhere((x) => x.grade === 3 && !x.vacation);
  const plain = svgOf(st, t);
  choose(st, 'hl_vision_notice', (c) => c.tags.includes('就醫'), t);
  assert.ok(st.flags.近視 && st.flags.近視_待決定 && !st.flags.戴眼鏡, '複檢之後還沒決定方案');
  assert.ok(st.delayed.some((d) => d.card === 'hl_myopia_plan'), '排了方案卡');
  choose(st, 'hl_myopia_plan', (c) => c.tags.includes('放下手機陪'), t);
  assert.ok(st.flags[BODY_FLAGS.glasses], '戴眼鏡');
  assert.ok(!st.flags.近視_待決定);
  assert.notEqual(svgOf(st, t), plain, '場景不同');
  assert.ok(sceneSpec(st, data, data.timeline[t]).members.find((m) => m.who === 'child').glasses);
  assert.ok(sceneAlt(sceneSpec(st, data, data.timeline[t])).includes('眼鏡'));
});

test('近視：角膜塑形片 9 歲以上才有，選了就設角膜塑形旗標，場景也不同', () => {
  const st = fresh();
  const plan = data.cardIndex.hl_myopia_plan;
  const orthIdx = plan.choices.findIndex((c) => (c.setFlags || []).includes('角膜塑形'));
  const young = turnWhere((x) => x.grade === 2 && !x.vacation), old = turnWhere((x) => x.grade === 5 && !x.vacation);
  st.turn = young; assert.equal(data.cardIndex.hl_myopia_plan.choices[orthIdx].showIf, '年齡 >= 9');
  assert.ok(data.timeline[young].ageMonths < 108 && data.timeline[old].ageMonths >= 108);
  const plain = svgOf(st, old);
  st.flags.近視_待決定 = true;
  applyChoice(st, data, plan, orthIdx, data.timeline[old], stateRng(st, 'rngS'));
  assert.ok(st.flags[BODY_FLAGS.orthok]);
  assert.notEqual(svgOf(st, old), plain);
});

test('近視：只在眼鏡行配眼鏡的捷徑也設戴眼鏡；回條簽名交回去則什麼旗標都沒有', () => {
  const a = fresh(), b = fresh();
  const t = turnWhere((x) => x.grade === 3 && !x.vacation);
  choose(a, 'hl_vision_notice', (c) => c.tags.includes('外包'), t);
  assert.ok(a.flags.戴眼鏡 && a.flags.近視);
  choose(b, 'hl_vision_notice', (c) => c.tags.includes('說沒關係就結束'), t);
  assert.ok(!b.flags.戴眼鏡 && !b.flags.近視);
});

test('有期限的旗標：骨折打石膏約兩個月，到期由 expireFlags 清掉；存檔讀檔不變', () => {
  const st = fresh();
  const t = turnWhere((x) => x.grade === 2 && !x.vacation);
  choose(st, 'hl_fracture', (c) => c.tags.includes('就醫'), t);
  const m0 = data.timeline[t].ageMonths;
  assert.ok(st.flags.打石膏);
  assert.equal(st.flagExpiry.打石膏, m0 + 2);
  const back = deserialize(serialize(st));
  assert.equal(back.flagExpiry.打石膏, m0 + 2);
  expireFlags(st, m0 + 1); assert.ok(st.flags.打石膏, '還沒到期');
  expireFlags(st, m0 + 2); assert.ok(!st.flags.打石膏 && !('打石膏' in st.flagExpiry));
  // 走 startTurn：之後的回合開始時自動清掉
  const s2 = fresh(); s2.flags.打石膏 = true; s2.flagExpiry = { 打石膏: 0 };
  startTurn(s2, data);
  assert.ok(!s2.flags.打石膏);
});

test('有期限的旗標：戴牙套 10–30 個月，期限用 flagMonths 的範圍抽；拆牙套的卡在旗標清掉之後還能出現', () => {
  const t = turnWhere((x) => x.grade === 5 && !x.vacation);
  const seen = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const st = fresh(seed);
    choose(st, 'hl_braces_start', (c) => (c.tags || []).includes('就醫'), t);
    const n = st.flagExpiry.戴牙套 - data.timeline[t].ageMonths;
    assert.ok(n >= 24 && n <= 30, String(n)); seen.add(n);
    assert.ok(st.flags.戴牙套 && st.flags.牙齒矯正過);
  }
  assert.ok(seen.size > 1, '期限是抽的');
  const off = data.cardIndex.hl_braces_off, st = fresh();
  st.flags.牙齒矯正過 = true; // 戴牙套旗標已經清掉
  assert.ok(passes(off, st, buildCtx(st, data.timeline[t])));
  const upkeep = data.cardIndex.hl_braces_upkeep;
  assert.ok(!passes(upkeep, st, buildCtx(st, data.timeline[t])), '沒在戴牙套就沒有回診的橡皮筋卡');
});

test('骨折：先冰敷等看看是命運骰（0.6），結果有石膏或只是瘀青；推拿館耽誤、石膏更久', () => {
  const card = data.cardIndex.hl_fracture;
  const wait = card.choices.find((c) => c.chance && c.chance.id === 'frac_wait');
  assert.equal(wait.chance.p, 0.6);
  const t = turnWhere((x) => x.grade === 2 && !x.vacation);
  let cast = 0, none = 0;
  for (let seed = 1; seed <= 200; seed++) { const st = fresh(seed); choose(st, 'hl_fracture', (c) => c.chance, t); st.flags.打石膏 ? cast++ : none++; }
  assert.ok(cast > 80 && none > 40, `${cast}/${none}`);
  const st = fresh(); choose(st, 'hl_fracture', (c) => c.tags.includes('外包'), t);
  assert.equal(st.flagExpiry.打石膏 - data.timeline[t].ageMonths, 3);
});

test('命運骰：卡片只在骰子夠小時才出現（決定性、不因為池裡只剩它）', () => {
  const st = fresh(), tl = data.timeline[turnWhere((x) => x.grade === 3 && !x.vacation)];
  st.turn = tl.turn;
  const ctx = buildCtx(st, tl);
  for (const k of ['視力骰', '脊椎骰', '牙齒骰', '腳骰', '過敏骰', '摔傷骰']) assert.ok(ctx[k] >= 0 && ctx[k] < 1, k);
  assert.equal(passes(data.cardIndex.hl_vision_notice, st, { ...ctx, 家庭: '雙親', 視力骰: 0.9 }), false);
  assert.equal(passes(data.cardIndex.hl_vision_notice, st, { ...ctx, 家庭: '雙親', 視力骰: 0.01 }), true);
  assert.equal(buildCtx(st, tl).視力骰, ctx.視力骰);
});

test('每張身體照顧的卡：實際玩的時候看得到（150 局裡出現過）；真實玩一局不會丟錯', () => {
  const need = ['hl_vision_notice', 'hl_allergy', 'hl_flatfoot', 'hl_fracture', 'hl_spine_notice', 'hl_braces_start', 'hl_myopia_plan'];
  const seen = new Set();
  for (let seed = 1; seed <= 150 && need.some((id) => !seen.has(id)); seed++) {
    const st = fresh(seed);
    let guard = 0;
    while (!st.ended && guard++ < 200) {
      const res = startTurn(st, data);
      if (res.ended) break;
      if (res.card) {
        let view = res.card, raw = res.raw;
        for (let g = 0; g < 3; g++) {
          seen.add(raw.id);
          const idx = view.choices.filter((c) => !c.disabled).find((c) => (raw.choices[c.i].tags || []).some((t) => ['就醫', '放下手機陪'].includes(t))) || view.choices.find((c) => !c.disabled);
          if (!chooseCard(st, data, idx.i).more) break;
          ({ card: view, raw } = nextCard(st, data));
        }
      }
      finishTurn(st, data);
    }
  }
  for (const id of need) assert.ok(seen.has(id), id);
});
