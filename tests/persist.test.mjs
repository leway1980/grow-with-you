// 跨卡沿用的值（DESIGN §11 規則 14）與手足（年長／年幼／下一胎）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { stateRng } from '../js/engine/rng.js';
import { buildCtx, applyChoice, fill, cardById, describeCard, cardScope, pickDelayed } from '../js/engine/events.js';
import { generateFamily, siblingRelations } from '../js/engine/family.js';

const data = loadData();
const at = (turn) => data.timeline[turn];
const G3 = data.timeline.find((t) => t.grade === 3).turn; // 三年級開學（hi_pet 之類中高年級的卡用）
const choose = (st, id, idx) => {
  const card = cardById(data, id), tl = at(st.turn);
  const r = stateRng(st, 'rngS');
  return applyChoice(st, data, card, idx, tl, r, {});
};
const cleanState = (seed, turn, mut) => {
  const st = newState(seed, data, { role: '媽媽', startMode: 'elementary' });
  st.turn = turn; mut?.(st); return st;
};

test('hi_pet：養了什麼、叫什麼名字，存進 vars；之後的 {寵物}、{寵物名}、有寵物、寵物種類 都讀同一個值', () => {
  let st = cleanState(11, G3, (s) => { s.family.pet = null; });
  assert.equal(buildCtx(st, at(G3)).有寵物, false);
  const card = cardById(data, 'hi_pet');
  const scope = cardScope(st, 'hi_pet');
  const shown = describeCard(card, st, data, at(G3)); // 抽出這張卡的 {寵物}、{領養寵物名}
  const wanted = scope.寵物;
  assert.ok(wanted, '卡片文字抽到一個寵物');
  choose(st, 'hi_pet', 0);
  assert.equal(st.vars.養的寵物, wanted);
  assert.ok(st.vars.養的寵物名);
  const ctx = buildCtx(st, at(40));
  assert.equal(ctx.有寵物, true); assert.equal(ctx.寵物種類, wanted);
  // 後續卡：槽值是同一個寵物，名字也是
  const fuText = fill('{寵物}／{寵物名}', st, ctx, {});
  assert.equal(fuText, `${wanted}／${st.vars.養的寵物名}`);
  for (let k = 0; k < 20; k++) { st.slotLast = {}; assert.equal(fill('{寵物}', st, ctx, {}), wanted, '每次都一樣，不重抽'); }
  const fu = describeCard(cardById(data, 'fu_pet_care'), st, data, at(40));
  assert.match(fu.title, new RegExp(st.vars.養的寵物名));
});

test('hi_pet 選「先從小動物開始」：養的是小動物，父母的收穫也記同一個', () => {
  const st = cleanState(12, G3, (s) => { s.family.pet = null; });
  const card = cardById(data, 'hi_pet');
  describeCard(card, st, data, at(G3));
  choose(st, 'hi_pet', 2);
  assert.ok(['倉鼠', '魚', '烏龜'].includes(st.vars.養的寵物), st.vars.養的寵物);
  const g = st.parentGrowth.find((x) => x.slot === '寵物');
  assert.ok(!g || g.value === st.vars.養的寵物, '父母的收穫記的是養的那隻');
});

test('家裡本來就有寵物：{寵物} 一律是那一種（不再隨機）', () => {
  const st = cleanState(13, G3, (s) => { s.family.pet = { kind: '小動物', type: '兔子', name: '麻糬' }; });
  const ctx = buildCtx(st, at(G3));
  assert.equal(ctx.寵物種類, '兔子');
  for (let k = 0; k < 30; k++) { st.slotLast = {}; assert.equal(fill('{寵物}', st, ctx, {}), '兔子'); }
  assert.equal(fill('{寵物名}', st, ctx, {}), '麻糬');
});

test('lo_club：不管選哪個選項，孩子想要的球類都存下來；重提、比賽、板凳的卡讀同一個球類', () => {
  for (const idx of [0, 1, 2, 3]) {
    const st = cleanState(20 + idx, 24);
    const scope = cardScope(st, 'lo_club');
    describeCard(cardById(data, 'lo_club'), st, data, at(24));
    const ball = scope.球類;
    assert.ok(ball);
    choose(st, 'lo_club', idx);
    assert.equal(st.vars.想要的球類, ball);
    const ctx = buildCtx(st, at(30));
    for (const id of ['fu_ask_again', 'fu_team', 'fu_team2', 'lo_team_bench']) {
      st.slotLast = {};
      const card = describeCard(cardById(data, id), st, data, at(30));
      assert.match(card.text, new RegExp(ball), `${id} 的 {球類} 應該是 ${ball}`);
    }
    assert.equal(fill('{球類}', st, ctx, {}), ball);
  }
});

test('校隊與才藝：選定之後後續卡沿用；別人家的才藝／別班的校隊用另外的槽，不會和自己孩子的混在一起', () => {
  const st = cleanState(31, 40);
  describeCard(cardById(data, 'hi_team_try'), st, data, at(40));
  const sc = cardScope(st, 'hi_team_try');
  choose(st, 'hi_team_try', 0);
  assert.equal(st.vars.校隊項目, sc.校隊); assert.equal(st.vars.校隊比賽層級, sc.比賽層級);
  st.turn = 44;
  const fu = describeCard(cardById(data, 'fu_team_bench'), st, data, at(44));
  assert.match(fu.text, new RegExp(sc.比賽層級));
  const picks = new Set();
  for (let k = 0; k < 40; k++) { st.slotLast = {}; picks.add(fill('{別班校隊}', st, buildCtx(st, at(44)), {})); }
  assert.ok(picks.size > 1, '別班的校隊仍然會隨機');
  // 才藝
  const st2 = cleanState(32, 26);
  describeCard(cardById(data, 'lo_trial'), st2, data, at(26));
  const t = cardScope(st2, 'lo_trial').才藝;
  choose(st2, 'lo_trial', 1);
  assert.equal(st2.vars.選的才藝, t); assert.ok(st2.flags.學才藝);
  assert.equal(fill('{才藝}', st2, buildCtx(st2, at(30)), {}), t);
  // 學才藝的孩子不再出現「想學才藝」
  assert.equal(data.cardIndex.lo_trial.excludes.flags[0], '學才藝'); assert.equal(data.cardIndex.kid_trial.excludes.flags[0], '學才藝');
});

test('cm_car：停才藝課的選項只給有在學才藝的孩子，沒有寫死鋼琴', () => {
  const card = cardById(data, 'cm_car');
  const none = cleanState(33, 30), has = cleanState(33, 30, (s) => { s.vars.選的才藝 = '游泳'; });
  assert.equal(describeCard(card, none, data, at(30)).choices.length, 3);
  const shown = describeCard(card, has, data, at(30));
  assert.equal(shown.choices.length, 4);
  assert.ok(shown.choices.some((c) => c.label.includes('游泳課')));
  assert.ok(!JSON.stringify(card).includes('鋼琴'));
});

/* ───── 手足 ───── */
test('手足：手足數是目前已經在的全部（含弟弟妹妹出生之後）、年長手足／年幼手足／下一胎回合差', () => {
  const idn = data.identities;
  let seen = { younger: 0, older: 0 };
  const STEP = 3, due = (m, ys) => { const d = ys.filter((q) => q.arriveMonths > m).map((q) => Math.ceil((q.arriveMonths - m) / STEP)); return d.length ? Math.min(...d) : 99; };
  for (let seed = 1; seed <= 400; seed++) {
    const fam = generateFamily(seed, idn);
    const ys = fam.siblings.filter((s) => !s.older);
    if ((fam.structure === '離異' || fam.structure === '喪親')) assert.equal(ys.length, 0, `單親（${fam.structure}）不排弟弟妹妹：seed ${seed}`);
    for (const s of fam.siblings) assert.ok(!('arriveTurn' in s) && (s.older ? s.arriveMonths === null : s.arriveMonths >= idn.siblings.youngerMonths[0] && s.arriveMonths <= idn.siblings.youngerMonths[1]), JSON.stringify(s));
    if (!ys.length) continue;
    seen.younger++;
    const y = ys[0], m = y.arriveMonths;
    const before = siblingRelations(fam, m - 1), after = siblingRelations(fam, m);
    assert.equal(before.下一胎回合差, due(m - 1, ys)); assert.equal(siblingRelations(fam, m - 6).下一胎回合差, due(m - 6, ys));
    assert.ok(before.下一胎回合差 >= 1);
    const later = ys.filter((s) => s.arriveMonths > m).map((s) => Math.ceil((s.arriveMonths - m) / STEP));
    assert.equal(after.下一胎回合差, later.length ? Math.min(...later) : 99); // 這一胎出生了；還有更小的弟弟妹妹就算下一個
    assert.ok(after.手足數 >= before.手足數 + 1 - 0, '出生之後手足數多一個');
    assert.ok(after.年幼手足數 >= 1 && after.年幼手足 !== '');
    assert.equal(before.年幼手足數, ys.filter((s) => s.arriveMonths <= m - 1).length);
    assert.equal(after.手足數, after.年長手足數 + after.年幼手足數);
    assert.equal(siblingRelations(fam).年幼手足數, ys.length, '沒給月齡（開局抽籤）時全部都算');
  }
  assert.ok(seen.younger > 20, `有弟弟妹妹的家庭夠多（${seen.younger}）`);
});

test('kid_newborn：只在弟弟妹妹出生前一、兩個回合出現；單親與沒有弟弟妹妹的家庭不會有', () => {
  const card = cardById(data, 'kid_newborn');
  assert.match(card.requires.expr, /下一胎回合差 >= 1 and 下一胎回合差 <= 2/);
  let eligible = 0;
  const preschool = data.timeline.filter((t) => t.stage === '幼兒園');
  for (let seed = 1; seed <= 300; seed++) {
    const st = newState(seed, data, { role: '爸爸' });
    for (const tl of preschool) {
      st.turn = tl.turn;
      const ctx = buildCtx(st, tl);
      const ok = require_ok(card, ctx);
      const dueIn = st.family.siblings.filter((s) => !s.older && s.arriveMonths > tl.ageMonths).map((s) => Math.ceil((s.arriveMonths - tl.ageMonths) / 3));
      const gen = st.family.structure === '隔代'; // 隔代：孩子跟長輩住，家裡『多一個人』不是這個故事
      assert.equal(passes(card, st, ctx) && !gen, dueIn.some((d) => d >= 1 && d <= 2) && !gen, `seed ${seed} turn ${tl.turn}`);
      if (ok && !gen) { eligible++; assert.ok(st.family.structure !== '離異' && st.family.structure !== '喪親'); }
    }
  }
  assert.ok(eligible > 5);
});
import { passes } from '../js/engine/events.js';
function require_ok(card, ctx) { return passes(card, { flags: {} }, ctx); }
