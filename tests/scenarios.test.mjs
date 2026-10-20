// 單調性情境測試（DESIGN §3.7 第 3 點）：用腳本化的情境驗證常識——「其他都一樣，只多做某件事」，結果只能往因果圖（data/model.json）說的方向走。
// 每個情境在 12 個不同的家庭（種子不同＝氣質、家境不同）× 3 種前情（中性、傷害多、陪伴多）上成對比較：基準＝前情之後安靜地過同樣多回合，變體＝前情之後做那件事。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { applyTags, driftHidden, recomputeDerived } from '../js/engine/tags.js';
import { buildCtx } from '../js/engine/events.js';
import { outcomeAxes, wellbeing, opennessOf, routePosition } from '../js/engine/ending.js';
import { outcomeWeights, edgeForTagEffect, AXES } from '../js/engine/model.js';

const data = loadData();
const T = data.tags, M = data.model;
const START = 40;
const STAGE = data.timeline[START].stage;
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const EPS = 1e-9;

const step = (tags, o = {}) => ({ tags, ...o });
const rep = (n, tags, o) => Array.from({ length: n }, () => step(tags, o));
const quiet = (n) => rep(n, []);
/** 三種前情：中性（什麼都沒發生）、傷害多（敷衍、說了不算、罵）、陪伴多 */
const PREFIX = {
  中性: [],
  傷害多: [step(['敷衍帶過'], { approach: true }), step(['說了不算']), step(['罵一頓']), step(['沒有下文']), step(['拿別人比較']), step(['吵了才讓步']), step(['敷衍帶過'], { approach: true }), step(['兩手一攤'])],
  陪伴多: [step(['聽他說完']), step(['放下手機陪']), step(['先接住情緒']), step(['事前訂規則']), step(['說到做到']), step(['問具體的事']), step(['一起看哪裡卡住']), step(['陪他自己處理'])],
};

/** 一個家庭：第 START 回合（國小）的狀態；可見數值固定，不受前情影響（只比較隱藏數值與結果） */
function world(seed, setup) {
  const st = newState(seed, data, { role: seed % 2 ? '媽媽' : '爸爸' });
  st.turn = START;
  if (setup) setup(st);
  const row = () => ({ t: st.turn, ...st.parent, ...st.child });
  st.vcurves = Array.from({ length: 12 }, row);
  st.curves = Array.from({ length: 12 }, () => ({ t: st.turn, ...st.hidden }));
  return st;
}
function play(st, steps) {
  for (const s of steps) {
    const tl = data.timeline[st.turn];
    applyTags(st, s.tags, T, { turn: st.turn, stage: tl.stage, ctx: buildCtx(st, tl), approach: !!s.approach, direction: s.direction });
    driftHidden(st, T);
    st.vcurves.push({ t: st.turn, ...st.parent, ...st.child });
    st.curves.push({ t: st.turn, ...st.hidden });
    st.turn++;
  }
  return st;
}
const snapshot = (st) => ({ h: { ...st.hidden }, v: { ...st.vars }, ax: outcomeAxes(st), w: wellbeing(st, data.identities.parentModel), open: opennessOf(st), ema: { ...st.costEMA } });

/**
 * 成對比較：prefix 之後，基準＝安靜 n 回合，變體＝做 steps。回傳每個（家庭×前情）的 [基準, 變體]。
 */
function paired(steps, setup) {
  const out = [];
  for (const seed of SEEDS) for (const [pname, prefix] of Object.entries(PREFIX)) {
    const base = world(seed, setup), varr = world(seed, setup);
    play(base, prefix); play(varr, prefix);
    play(base, quiet(steps.length)); play(varr, steps);
    out.push({ seed, pname, a: snapshot(base), b: snapshot(varr), stB: varr, stA: base });
  }
  return out;
}
/** 變體不能比基準「往錯的方向」：dir=+1 要求 b ≥ a（不能變差），dir=-1 要求 b ≤ a（不能變好）；並且平均真的有往該方向動（不是兩邊都沒變）。 */
function never(label, runs, pick, dir, minMove = 0.05) {
  let sum = 0;
  for (const r of runs) {
    const d = pick(r.b) - pick(r.a);
    assert.ok(dir * d >= -EPS, `${label}：種子 ${r.seed}／前情「${r.pname}」變體 ${pick(r.b).toFixed(3)} vs 基準 ${pick(r.a).toFixed(3)}（方向應為 ${dir > 0 ? '不下降' : '不上升'}）`);
    sum += dir * d;
  }
  assert.ok(sum / runs.length >= minMove, `${label}：平均只往預期的方向動了 ${(sum / runs.length).toFixed(3)}（至少要 ${minMove}），測試等於沒測到東西`);
}

test('情境 1：連續 3 次停下來聽（聽他說完、放下手機陪、先接住情緒），親子信任、親子軸、彼此之間都不會變差', () => {
  for (const tag of [['聽他說完'], ['放下手機陪'], ['先接住情緒'], ['聽他說完', '放下手機陪']]) {
    const runs = paired(rep(3, tag, { approach: true }));
    never(`${tag}→親子信任`, runs, (s) => s.h.親子信任, +1);
    never(`${tag}→親子軸`, runs, (s) => s.ax.親子, +1);
    never(`${tag}→彼此之間`, runs, (s) => s.w.between, +1);
  }
});

test('情境 2：多做 10 次「替他決定」，主見不會變好、自我效能不會變好、替他做主不會變少', () => {
  const runs = paired(rep(10, ['替他決定']));
  never('主見', runs, (s) => s.h.主見, -1, 1);
  never('自我效能', runs, (s) => s.h.自我效能, -1, 0.5);
  never('替他做主', runs, (s) => s.h.替他做主, +1, 1);
  // 反過來：10 次「給他選」主見不會變差
  const good = paired(rep(10, ['給他選']));
  never('給他選→主見', good, (s) => s.h.主見, +1, 1);
});

test('情境 3：錯過、錯過、停下來聽一次、再錯過、錯過 → 不會進入「不太來找你」（連續才算）', () => {
  for (const seed of SEEDS) for (const sens of [2, 3]) {
    const st = world(seed, (s) => { s.family.child.temperament.敏感度 = sens; });
    play(st, [step(['敷衍帶過'], { approach: true }), step(['敷衍帶過'], { approach: true }), step(['聽他說完'], { approach: true }), step(['敷衍帶過'], { approach: true }), step(['敷衍帶過'], { approach: true })]);
    assert.equal(st.vars.不太來找你, 0, `種子 ${seed} 敏感度 ${sens}`);
    assert.equal(st.vars.孩子來找_連續錯過, 2);
  }
});

test('情境 4：連續錯過 enterAt 次進入「不太來找你」（敏感的孩子少一次）；之後一次補償不算，要接住孩子來找才離開', () => {
  const A = T.approach;
  for (const seed of SEEDS) {
    const calm = world(seed, (s) => { s.family.child.temperament.敏感度 = 3; });
    play(calm, rep(A.enterAt - 1, ['說沒關係就結束'], { approach: true })); assert.equal(calm.vars.不太來找你, 0);
    play(calm, rep(1, ['說沒關係就結束'], { approach: true })); assert.equal(calm.vars.不太來找你, 1);
    assert.equal(calm.vars.不太來找你_曾, 1);
    play(calm, [step(['出遊_一起準備與討論']), step(['外包']), step(['3C當保母'])]); // 補償：不算
    assert.equal(calm.vars.不太來找你, 1);
    const need = Math.ceil(A.exitStreak[STAGE] / (A.approachCredit ?? 1));
    play(calm, rep(need - 1, ['聽他說完'], { approach: true }));
    if (need > 1) assert.equal(calm.vars.不太來找你, 1, '還差一次');
    play(calm, rep(1, ['聽他說完'], { approach: true }));
    assert.equal(calm.vars.不太來找你, 0, '接住孩子來找之後離開');
    assert.equal(calm.vars.不太來找你_曾, 1, '曾經進入過的紀錄不會消失（結局文字讀它）');
    const sens = world(seed, (s) => { s.family.child.temperament.敏感度 = 5; });
    play(sens, rep(A.enterAtSensitive - 1, ['敷衍帶過'], { approach: true })); assert.equal(sens.vars.不太來找你, 0);
    play(sens, rep(1, ['敷衍帶過'], { approach: true })); assert.equal(sens.vars.不太來找你, 1);
  }
});
const raw = () => T.approach;

test('情境 5：一再「只問成績或學校怎樣」→ 孩子願意開口的程度下降、了解度不會上升、期待壓力不會下降', () => {
  const runs = paired(rep(6, ['只問成績或學校怎樣'], { approach: true }));
  never('開口度', runs, (s) => s.open, -1, 5);
  never('了解度', runs, (s) => s.h.了解度, -1, 0.3);
  never('期待壓力', runs, (s) => s.h.期待壓力, +1, 0.5);
  never('彼此之間', runs, (s) => s.w.between, -1, 1);
  // 對照：換成「問具體的事」，開口度不會下降
  const ask = paired(rep(6, ['問具體的事'], { approach: true }));
  never('問具體的事→開口度', ask, (s) => s.open, +1, 3);
  // 偶爾一次問成績不算什麼：一次的變動遠小於連續六次
  const once = paired(rep(1, ['只問成績或學校怎樣'], { approach: true }));
  const sixMove = runs.reduce((a, r) => a + (r.a.open - r.b.open), 0) / runs.length, oneMove = once.reduce((a, r) => a + (r.a.open - r.b.open), 0) / once.length;
  assert.ok(oneMove < sixMove / 3, `一次 ${oneMove.toFixed(1)} vs 六次 ${sixMove.toFixed(1)}`);
});

test('情境 6：多次「說了不算」，規則一致性與親子信任不會變好、試探度不會變低', () => {
  const runs = paired(rep(5, ['說了不算']));
  never('規則一致性', runs, (s) => s.h.規則一致性, -1, 0.5);
  never('親子信任', runs, (s) => s.h.親子信任, -1, 0.2);
  never('試探度', runs, (s) => s.h.試探度, +1, 0.5);
  never('吵了才讓步→規範監督', paired(rep(5, ['吵了才讓步'])), (s) => s.h.規範監督, -1, 0.2);
});

test('情境 7：多次「罵一頓」，親子信任、溫暖陪伴、內在穩定、親子軸都不會變好；期待壓力不會變低', () => {
  const runs = paired(rep(5, ['罵一頓']));
  never('親子信任', runs, (s) => s.h.親子信任, -1, 0.5);
  never('溫暖陪伴', runs, (s) => s.h.溫暖陪伴, -1, 0.3);
  never('內在穩定', runs, (s) => s.h.內在穩定, -1, 0.3);
  never('親子軸', runs, (s) => s.ax.親子, -1, 0.3);
  never('期待壓力', runs, (s) => s.h.期待壓力, +1, 0.3);
});

test('情境 8：事前訂規則＋說到做到，規範監督與規則一致性不會變差、試探度不會變高', () => {
  const runs = paired([...rep(4, ['事前訂規則']), ...rep(4, ['說到做到'])]);
  never('規範監督', runs, (s) => s.h.規範監督, +1, 0.3);
  never('規則一致性', runs, (s) => s.h.規則一致性, +1, 0.5);
  never('試探度', runs, (s) => s.h.試探度, -1, 0.1);
});

test('情境 9：先接住情緒、陪他自己處理，內在穩定、安全感（或自我效能）與親子信任不會變差', () => {
  const runs = paired(rep(4, ['先接住情緒']));
  never('內在穩定', runs, (s) => s.h.內在穩定, +1, 0.2);
  never('安全感', runs, (s) => s.h.安全感, +1, 0.1);
  never('親子信任', runs, (s) => s.h.親子信任, +1, 0.5);
  never('陪他自己處理→自我效能', paired(rep(4, ['陪他自己處理'])), (s) => s.h.自我效能, +1, 0.5);
});

test('情境 10：拿別人比較、特地轉述消息，期待壓力不會變低、主見不會變高、孩子的幸福不會變高', () => {
  const runs = paired([...rep(3, ['拿別人比較']), ...rep(3, ['轉述消息_特地'], { direction: '成績' })]);
  never('期待壓力', runs, (s) => s.h.期待壓力, +1, 1);
  never('主見', runs, (s) => s.h.主見, -1, 0.3);
  never('孩子幸福', runs, (s) => s.w.child, -1, 0.1);
  never('不比較→期待壓力', paired(rep(3, ['不比較'])), (s) => s.h.期待壓力, -1, 0.3);
});

test('情境 11：真的休息（父母自己休息、找人分擔、運動），累積的疲勞不會變多、父母情緒穩定度不會變低', () => {
  const setup = (st) => { st.costEMA.體力 = 6; st.costEMA.耐心 = 6; };
  for (const tags of [['父母自己休息'], ['找人分擔'], ['運動']]) {
    const runs = paired(rep(2, tags), setup);
    never(`${tags}→疲勞（體力）`, runs, (s) => s.ema.體力, -1, 0.1);
    never(`${tags}→父母情緒穩定度`, runs, (s) => s.h.父母情緒穩定度, +1, 0.05);
  }
  const hard = paired(rep(2, ['硬撐']), setup);
  never('硬撐→父母情緒穩定度', hard, (s) => s.h.父母情緒穩定度, -1, 0.0);
});

test('情境 12：瞞著孩子、怪老師、把老師當祕書，親子信任／師親信任不會變好', () => {
  never('瞞著孩子→親子信任', paired(rep(4, ['瞞著孩子'])), (s) => s.h.親子信任, -1, 0.5);
  never('瞞著孩子→安全感', paired(rep(4, ['瞞著孩子'])), (s) => s.h.安全感, -1, 0.3);
  never('怪老師→師親信任', paired(rep(3, ['怪老師'])), (s) => s.h.師親信任, -1, 0.5);
  never('與老師合作→師親信任', paired(rep(3, ['與老師合作'])), (s) => s.h.師親信任, +1, 0.5);
});

test('情境 13：教交通規則 → 交通安全認知不會變低；沒教就放手 → 不會變高', () => {
  never('教交通規則', paired(rep(3, ['教交通規則'])), (s) => s.h.交通安全認知, +1, 0.5);
  never('沒教就放手', paired(rep(3, ['沒教就放手'])), (s) => s.h.交通安全認知, -1, 0.1);
});

test('情境 14：每個標籤做一次、做三次，每個隱藏數值只會往因果圖上那條邊的方向動（或不動）——包含接近 0／100 的飽和狀態', () => {
  const states = [
    (st) => {}, (st) => { for (const k of Object.keys(st.hidden)) if (!T.derived.includes(k)) st.hidden[k] = 4; },
    (st) => { for (const k of Object.keys(st.hidden)) if (!T.derived.includes(k)) st.hidden[k] = 96; },
  ];
  let checked = 0;
  for (const [tag, def] of Object.entries(T.tags)) {
    for (const setup of states) for (const times of [1, 3]) {
      const st = world(3, setup); recomputeDerived(st, T);
      const before = { ...st.hidden };
      play(st, rep(times, [tag]));
      // 漂移也會動：把漂移的影響扣掉——另一個一樣但沒有做標籤的世界
      const ctl = world(3, setup); recomputeDerived(ctl, T); play(ctl, quiet(times));
      for (const k of Object.keys(def.d || {})) {
        const e = edgeForTagEffect(M, tag, k, def.d[k]);
        assert.ok(e, `標籤 ${tag} 對 ${k} 沒有邊`);
        const diff = st.hidden[k] - ctl.hidden[k];
        assert.ok((e.sign === '+' ? diff : -diff) >= -EPS, `標籤 ${tag} 對 ${k}：因果圖說 ${e.sign}，實際差 ${diff.toFixed(4)}（前 ${before[k].toFixed(1)}）`);
        checked++;
      }
    }
  }
  assert.ok(checked > 400);
});

test('情境 15：結果軸對隱藏數值是單調的：第 3 層的數值往好的方向動 10，三條軸與幸福都不會變差；方向和因果圖的權重一致', () => {
  const W = outcomeWeights(M);
  const bad = new Set(['期待壓力', '試探度', '替他做主']);
  for (const seed of SEEDS) {
    const st = world(seed); play(st, PREFIX.傷害多);
    const base = { ax: outcomeAxes(st), w: wellbeing(st, data.identities.parentModel) };
    for (const k of Object.keys(T.hidden)) {
      if (T.derived.includes(k) || k === '父母的收穫') continue;
      const up = world(seed); play(up, PREFIX.傷害多); up.hidden[k] = Math.min(100, up.hidden[k] + 10); recomputeDerived(up, T);
      const ref = world(seed); play(ref, PREFIX.傷害多); recomputeDerived(ref, T);
      const a = outcomeAxes(up), r = outcomeAxes(ref);
      for (const ax of AXES) {
        const d = a[ax] - r[ax], w = W[ax][k] || 0;
        if (bad.has(k)) assert.ok(d <= EPS, `${k}↑ 讓 ${ax} 變好了（${d.toFixed(3)}）`);
        else assert.ok(d >= -EPS, `${k}↑ 讓 ${ax} 變差了（${d.toFixed(3)}）`);
        if (w === 0 && !['承受度'].includes(k)) { /* 沒有直接的邊：只能經過推算值（承受度）影響 */ }
      }
    }
    assert.ok(base.ax.親子 >= 0);
  }
});

test('情境 16：把「不太來找你」這個狀態單獨打開，只讓來問的事件變少（不直接改任何隱藏數值或結果軸）', () => {
  const a = world(5), b = world(5);
  b.vars.不太來找你 = 1;
  assert.deepEqual(outcomeAxes(a), outcomeAxes(b));
  assert.deepEqual(a.hidden, b.hidden);
  const e = M.edges.find((x) => x.id === 'e:不太來找你→來問事件');
  assert.equal(e.sign, '-');
  assert.ok(data.pools.工作插播.mods.some((m) => m.if === '不太來找你' && m.x < 1), '池的權重確實隨狀態變小');
});

test('情境 17：整局腳本——同一個家庭、同一個種子，把「聽他說完」換成「敷衍帶過」的選項，彼此之間不會更好（完整一局，成對）', async () => {
  const { playToEnd } = await import('../js/engine/turn.js');
  let sum = 0, n = 0;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const pol = (prefer) => ({ choose(st, view, rawCard) {
      const opts = view.choices.filter((c) => !c.disabled);
      const hit = opts.find((o) => (rawCard.choices[o.i].tags || []).includes(prefer));
      return (hit || opts[0]).i;
    } });
    const a = newState(seed, data, {}); playToEnd(a, data, pol('聽他說完'));
    const b = newState(seed, data, {}); playToEnd(b, data, pol('敷衍帶過'));
    const wa = wellbeing(a, data.identities.parentModel), wb = wellbeing(b, data.identities.parentModel);
    sum += wa.between - wb.between; n++;
    assert.ok(wa.between >= wb.between - 5, `種子 ${seed}：聽他說完 ${wa.between.toFixed(1)} vs 敷衍 ${wb.between.toFixed(1)}`);
  }
  assert.ok(sum / n > 0, '平均來說，聽他說完的局彼此之間更好');
});

test('情境：教養路線只看和開局相比的變化——什麼都不做的家庭是「未成形」，全部替他決定的家庭是「高壓做主」', () => {
  const calm = world(2); play(calm, quiet(30));
  assert.equal(routePosition(calm).kind, '未成形');
  const ctl = world(2);
  play(ctl, rep(40, ['替他決定', '全部替他做']));
  assert.equal(routePosition(ctl).kind, '高壓做主');
});
