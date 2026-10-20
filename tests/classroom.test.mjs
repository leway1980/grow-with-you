// 班級共享狀態（DESIGN §4.38）：老師投入度。換老師重置、投訴的家長人數、標籤的玩家效果、延後後果、查證後正式反映、決定性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState, migrate, serialize, deserialize } from '../js/engine/state.js';
import { startTurn, chooseCard, nextCard, finishTurn, playToEnd } from '../js/engine/turn.js';
import { applyChoice, passes, buildCtx } from '../js/engine/events.js';
import { stateRng } from '../js/engine/rng.js';
import { rollParents, resetClassroom } from '../js/engine/classroom.js';
import { guardHidden } from './helpers.mjs';

const data = loadData();
const C = data.tags.classroom;
const fresh = (seed, mode = 'elementary') => newState(seed, data, { role: '媽媽', startMode: mode });
const firstTurnOf = (pred) => data.timeline.find(pred).turn;
const DELAYED = ['cl_noisy', 'cl_bully', 'cl_stamp', 'cl_hate_class'];

/** 在指定回合直接套用某張卡的某個選項（找選項的標籤或標籤開頭文字），回傳老師投入度的變化 */
function apply(st, cardId, pick, turn) {
  st.turn = turn;
  const tl = data.timeline[turn], card = data.cardIndex[cardId];
  const idx = typeof pick === 'number' ? pick : card.choices.findIndex((ch) => ch.label.startsWith(pick));
  assert.ok(idx >= 0, `${cardId} 找不到選項 ${pick}`);
  const before = st.classroom.v;
  applyChoice(st, data, card, idx, tl, stateRng(st, 'rngS'));
  return st.classroom.v - before;
}

/** 玩到結束的策略：優先選含某些標籤的選項，否則選第一個可選的 */
const prefer = (tags) => ({ choose: (st, view, raw) => {
  const ok = view.choices.filter((c) => !c.disabled);
  const hit = ok.find((c) => (raw.choices[c.i].tags || []).some((t) => tags.includes(t)));
  return (hit || ok[0]).i;
} });

test('抽「班上常投訴的家長」：0、1、2、3 的比例接近 0.45／0.3／0.17／0.08（設計估計），且標明是設計估計', () => {
  assert.match(C.parentWeights_src, /設計估計/);
  assert.equal(C.parentWeights.reduce((a, b) => a + b, 0).toFixed(2), '1.00');
  const n = [0, 0, 0, 0], N = 4000;
  for (let s = 1; s <= N; s++) n[rollParents(s, 7, 'teacher:1', C.parentWeights)]++;
  C.parentWeights.forEach((w, i) => assert.ok(Math.abs(n[i] / N - w) < 0.03, `${i} 位：${n[i] / N}`));
});

test('換老師就重置：小一、小三、小五（預覽再加國一、高一）各重置一次，起點由階段基準與家長人數決定', () => {
  const st = fresh(11, 'birth');
  const seen = [];
  let guard = 0;
  while (!st.ended && guard++ < 200) {
    const res = startTurn(st, data);
    if (res.ended) break;
    const tl = data.timeline[st.turn];
    if (tl.grade > 0 && (seen.length === 0 || seen[seen.length - 1].grade !== tl.grade) && st.classroom.grade === tl.grade) {
      if (!seen.some((x) => x.grade === tl.grade)) seen.push({ grade: tl.grade, v: st.classroom.v, parents: st.classroom.parents, resets: st.classroom.resets });
    }
    if (res.card) { let v = res.card, raw = res.raw; for (let g = 0; g < 3; g++) { const o = chooseCard(st, data, v.choices.find((c) => !c.disabled).i); if (!o.more) break; ({ card: v, raw } = nextCard(st, data)); } }
    finishTurn(st, data);
  }
  assert.deepEqual(seen.map((x) => x.grade), [1, 3, 5]);
  assert.deepEqual(seen.map((x) => x.resets), [1, 2, 3]);
  for (const x of seen) {
    const stage = data.timeline.find((t) => t.grade === x.grade).stage;
    // 回合開始當下剛重置：起點 = 基準 − 10 × 家長人數（還沒有玩家的選擇）
    assert.equal(x.v, Math.max(C.min, C.start.base[stage] - C.start.perParent * x.parents), `年級 ${x.grade}`);
  }
});

test('預覽：國一與高一也換老師；國中的起點比國小低（吵鬧是常態）', () => {
  const st = fresh(3, 'birth');
  for (const g of [7, 10]) {
    const tl = data.timeline.find((t) => t.grade === g);
    resetClassroom(st, data.tags, tl, 'teacher');
    assert.equal(st.classroom.grade, g);
  }
  assert.ok(C.start.base.國中 < C.start.base.國小中高 && C.start.base.國小中高 <= C.start.base.國小低);
  assert.ok(C.teacherGrades.includes(7) && C.teacherGrades.includes(10));
});

test('背景：常投訴的家長越多，老師投入度每月下滑越快；沒有家長就不滑', () => {
  const run = (parents) => {
    const st = fresh(5); const t0 = firstTurnOf((t) => t.grade === 3);
    startTurn(st, data); st.turn = t0; startTurn(st, data);
    st.classroom.parents = parents; st.classroom.v = 60;
    st.cur = null;
    finishTurn(st, data);
    return 60 - st.classroom.v;
  };
  const d = [0, 1, 3].map(run);
  assert.equal(d[0], 0);
  assert.ok(d[1] > 0 && d[2] > d[1] * 2.5);
});

test('玩家的做法（資料裡的標籤效果）：沒查證就投訴大降；出事替他擺平只有對著老師才降；與老師合作、先了解再處理是升', () => {
  const t = firstTurnOf((x) => x.stage === '國小中高');
  const mk = () => { const st = fresh(8); startTurn(st, data); st.classroom.v = 60; return st; };
  const complain = apply(mk(), 'cl_report_hi', '當天就打給教務處', t); // 出事替他擺平，toward 老師
  const group = apply(mk(), 'cl_report_hi', '在家長群組貼一段', t);      // 怪老師
  const check = apply(mk(), 'cl_report_hi', '請{他}拿出作業', t);        // 查證孩子的說法
  const coop = apply(mk(), 'cl_report_hi', '在聯絡簿寫一句', t);          // 與老師合作
  assert.ok(complain <= -5, `出事替他擺平（對老師）${complain}`);
  assert.ok(group <= -6, `怪老師 ${group}`);
  assert.ok(check >= 0 && coop > 0, `${check} ${coop}`);
  // 同一個標籤沒有對象（toward 沒寫）就不算
  const T = data.tags.tags.出事替他擺平.classroom;
  assert.match(T.when, /對象/);
  const st = mk(); const card = data.cardIndex.cl_own_child;
  assert.ok(card.choices.find((c) => c.tags.includes('出事替他擺平')).toward === '老師');
  assert.ok(data.tags.tags.怪老師.classroom.d < 0 && data.tags.tags.與老師合作.classroom.d > 0 && data.tags.tags.先了解再處理.classroom.d > 0);
  void st;
});

test('真的有體罰或羞辱：查證後依程序反映，老師投入度不降、也不會被當成沒查證；沒查證就貼群組施壓則大降', () => {
  const t = firstTurnOf((x) => x.stage === '國小中高');
  const mk = () => { const st = fresh(9); startTurn(st, data); st.classroom.v = 60; return st; };
  const card = data.cardIndex.cl_misconduct;
  assert.ok(card.requires.expr.includes('班級骰'), '體罰事件要用命運骰');
  const checked = card.choices.findIndex((c) => c.tags.includes('正式反映'));
  const group = card.choices.findIndex((c) => c.tags.includes('怪老師'));
  const dChecked = apply(mk(), 'cl_misconduct', checked, t), dGroup = apply(mk(), 'cl_misconduct', group, t);
  assert.ok(dChecked >= 0, `查證後反映 ${dChecked}`);
  assert.ok(dGroup <= -6, `沒查證就貼群組 ${dGroup}`);
  // 查證後反映也不會被記成「沒查證的投訴」
  const st = mk(); apply(st, 'cl_misconduct', checked, t);
  assert.equal(st.classroom.unverified, 0);
  const st2 = mk(); apply(st2, 'cl_misconduct', group, t);
  assert.equal(st2.classroom.unverified, 1);
});

test('沒查證就投訴，之後出現班級消極事件的機率變高（200 局，同一批種子）', () => {
  const run = (policy) => {
    let withEp = 0, vSum = 0, n = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const st = fresh(seed);
      playToEnd(st, data, policy);
      const ep = st.hist.some((h) => DELAYED.includes(h.card));
      withEp += ep ? 1 : 0; vSum += st.classroom.v; n++;
    }
    return { share: withEp / n, v: vSum / n };
  };
  const bad = run(prefer(['怪老師', '出事替他擺平'])), good = run(prefer(['查證孩子的說法', '先了解再處理', '與老師合作']));
  assert.ok(bad.share > good.share, `投訴 ${bad.share} vs 查證 ${good.share}`);
  assert.ok(bad.v < good.v, `老師投入度 投訴 ${bad.v.toFixed(1)} vs 查證 ${good.v.toFixed(1)}`);
});

test('延後後果的卡只在老師投入度低時出現，而且每張都明寫 scale 與老師的回覆', () => {
  for (const id of DELAYED) {
    const c = data.cardIndex[id];
    assert.equal(c.scale, false, id);
    assert.match(c.requires.expr, /老師投入度/, id);
    if (id !== 'cl_hate_class') assert.match(c.text, /依規定處理/);
  }
  assert.match(data.cardIndex.cl_noisy.text, /對方也有受教權，我們不能強制/);
  for (const c of data.events.cards.filter((x) => x.id.startsWith('cl_'))) assert.equal(c.scale, false, c.id);
  const st = fresh(2); const tl = data.timeline.find((t) => t.stage === '國小中高');
  for (const [v, want] of [[90, false], [30, true]]) {
    st.classroom.v = v;
    assert.equal(passes(data.cardIndex.cl_noisy, st, buildCtx(st, tl)), want, `老師投入度 ${v}`);
  }
});

test('轉班：不一定核准（機率 0.5，設計估計）；核准才換老師、重抽家長並付同學往來的代價，沒核准就留在原班、只付申請的體力與耐心', () => {
  assert.equal(C.transferApproveP, 0.5);
  assert.match(C.transferApproveP_src, /設計估計/);
  const t = firstTurnOf((x) => x.stage === '國小中高');
  const transfers = [];
  for (const id of ['cl_noisy', 'cl_bully', 'cl_stamp']) {
    const idx = data.cardIndex[id].choices.findIndex((c) => c.classroom && c.classroom.reset);
    const ch = data.cardIndex[id].choices[idx];
    assert.equal(ch.chance.p, C.transferApproveP, id); assert.ok(ch.chance.lose.result.includes('不能轉班'), id);
    assert.ok(!('同學往來' in ch.effects) && ch.chance.win.effects.同學往來 < 0, id);
    transfers.push([id, idx]);
  }
  let won = 0, lost = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const st = fresh(seed); startTurn(st, data); st.turn = t;
    const [id, idx] = transfers[seed % 3], card = data.cardIndex[id];
    const r0 = st.classroom.resets, peers0 = st.child.同學往來, cl0 = JSON.stringify(st.classroom);
    st.flags.科目冷掉 = true;
    const out = applyChoice(st, data, card, idx, data.timeline[t], stateRng(st, 'rngS'));
    if (st.flags[`transfer_${id}_中`]) {
      won++;
      assert.equal(st.classroom.resets, r0 + 1); assert.equal(st.flags.科目冷掉, undefined);
      assert.ok(st.child.同學往來 < peers0); assert.ok(out.result.includes('教務處交了轉班申請書'));
    } else {
      lost++;
      assert.equal(st.classroom.resets, r0, '沒核准就不換老師'); assert.equal(st.flags.科目冷掉, true);
      assert.equal(st.child.同學往來, peers0, '沒核准就沒有轉班的同學代價'); assert.equal(JSON.stringify(st.classroom), cl0);
      assert.ok(out.result.includes('不能轉班'));
    }
  }
  assert.ok(won >= 15 && lost >= 15, `${won}/${lost}`);
});

test('討厭那一科：旗標讓成績與心情每月慢慢往下，換老師才停', () => {
  const st = fresh(6); startTurn(st, data); st.cur = null;
  st.flags.科目冷掉 = true;
  const s0 = st.child.成績;
  st.turn = firstTurnOf((x) => x.grade === 3 && x.seg === 1); // 同一年級內，不觸發重置
  finishTurn(st, data);
  assert.ok(st.child.成績 < s0 + 1 && st.flags.科目冷掉);
  resetClassroom(st, data.tags, data.timeline[firstTurnOf((x) => x.grade === 5)], 'teacher');
  assert.equal(st.flags.科目冷掉, undefined);
});

test('決定性：同一個種子、同一個策略，班級狀態與整局紀錄完全相同；存檔重讀不變；舊存檔補上預設', () => {
  const a = fresh(21), b = fresh(21);
  playToEnd(a, data, prefer(['怪老師'])); playToEnd(b, data, prefer(['怪老師']));
  assert.equal(JSON.stringify(a.classroom), JSON.stringify(b.classroom));
  assert.equal(serialize(a), serialize(b));
  const re = migrate(deserialize(serialize(a)), data);
  assert.deepEqual(re.classroom, a.classroom);
  const old = JSON.parse(serialize(a)); delete old.classroom;
  assert.equal(migrate(old, data).classroom.v, C.start.default);
});

test('老師投入度不是孩子的隱藏數值：不在 st.hidden，只經由因果圖的邊推班級風氣，而且隱藏數值仍只有 tags.js 能寫', () => {
  const st = guardHidden(fresh(13));
  assert.equal('老師投入度' in st.hidden, false);
  const M = data.model, e = M.edges.find((x) => x.from === '老師投入度');
  assert.equal(e.to, '班級風氣');
  assert.equal(M.nodes.老師投入度.layer, 2);
  assert.ok(M.nodes[e.to].layer > M.nodes.老師投入度.layer);
  playToEnd(st, data, prefer(['怪老師'])); // 若有人在 tags.js 之外寫 st.hidden，guardHidden 會丟錯
  const hi = fresh(13), lo = fresh(13);
  hi.classroom.v = 100; lo.classroom.v = 5;
  for (const s of [hi, lo]) { s.classroom.parents = 0; s.turn = data.timeline.find((t) => t.grade === 1).turn; startTurn(s, data); s.cur = null; }
  hi.classroom.v = 100; lo.classroom.v = 5;
  finishTurn(hi, data); finishTurn(lo, data);
  assert.ok(hi.hidden.班級風氣 > lo.hidden.班級風氣);
});
