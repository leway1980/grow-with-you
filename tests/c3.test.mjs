// 手機與平板的依賴度（DESIGN §4.39）與假日邀約（§4.40）、「不太來找你」期間了解度下滑（§6）的機制測試。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { applyTags, driftHidden } from '../js/engine/tags.js';
import { edgeById } from '../js/engine/model.js';

const data = loadData();
const T = data.tags, S = T.screen, DEP = S.dep;
const fresh = (stage = '國小中高') => { const st = newState(7, data, { role: '媽媽' }); st.turn = 25; st.child['3C時間'] = 40; st._stage = stage; return st; };
const choose = (st, tags, o = {}) => applyTags(st, tags, T, { turn: st.turn, stage: st._stage, ctx: {}, screen: true, ...o });
const months = (st, n, span = 2) => { for (let i = 0; i < n / span; i++) { st.child['3C時間'] = 40; driftHidden(st, T, { span, months: 100 + i * span, stage: st._stage }); } };

test('依賴度從出生就有起點，只在 tags.json 的 hidden 登記，並且沒有自動回復到某個值', () => {
  const st = newState(3, data, {});
  assert.ok(DEP in st.hidden && st.hidden[DEP] > 0 && st.hidden[DEP] < 10);
  assert.ok(!(DEP in T.drift.to), '依賴度不會自己漂回去');
  const el = newState(3, data, { startMode: 'elementary' });
  assert.ok(el.hidden[DEP] > st.hidden[DEP], '從國小開始：學前已經有過螢幕');
});

test('同樣的 3C 時間，沒人在旁、沒有後續累積最多；約定且在旁較少；任務型借用幾乎不加但不是零', () => {
  const end = (tag) => { const st = fresh(); const a = st.hidden[DEP]; for (let i = 0; i < 4; i++) { choose(st, [tag]); months(st, 6); } return st.hidden[DEP] - a; }; // 每半年處理一次，持續兩年
  const none = end('3C當保母'), agreed = end('3C約定且在旁'), task = end('3C任務借用');
  assert.ok(none > agreed && agreed > task, `${none} ${agreed} ${task}`);
  assert.ok(task > 0, '休閒使用永遠不是零');
  assert.ok(task < none * 0.35, `${task} ${none}`);
});

test('只強制收回：3C 時間下降、親子信任下降、依賴度不下降；只加時間管控：依賴度上升變慢但仍上升', () => {
  const st = fresh(), before = { dep: st.hidden[DEP], trust: st.hidden.親子信任 };
  choose(st, ['沒收裝置']);
  assert.ok(st.hidden.親子信任 < before.trust);
  assert.ok(st.hidden[DEP] >= before.dep, '沒收不會讓依賴度下降');
  const lim = fresh(), def = fresh();
  choose(lim, ['事前訂規則', '說到做到']);
  const a = lim.hidden[DEP]; months(lim, 24); months(def, 24);
  assert.ok(lim.hidden[DEP] > a, '仍然上升');
  assert.ok(lim.hidden[DEP] - a < def.hidden[DEP] - newState(7, data, { role: '媽媽' }).hidden[DEP], '但比沒處理的慢');
  assert.ok(T.tags.沒收裝置.d[DEP] === undefined, '沒收裝置的標籤不直接動依賴度');
});

test('只有連續的陪伴才拉得回來：沒達階段門檻、或中間斷掉，依賴度不降', () => {
  const need = S.need.國小中高;
  const run = (breakAt) => {
    const st = fresh(); st.hidden[DEP] = 60;
    for (let i = 0; i < need + 1; i++) { if (i === breakAt) choose(st, ['沒收裝置']); const b = st.hidden[DEP]; choose(st, ['3C陪伴同行']); if (i < need - 1 || i === breakAt + 0 && breakAt >= 0 && false) assert.ok(st.hidden[DEP] >= b - 1e-9, `第 ${i + 1} 次還沒達門檻`); }
    return st;
  };
  const st = run(-1);
  assert.equal(st.vars['3C陪伴_連續'], need + 1);
  const a = fresh(); a.hidden[DEP] = 60; for (let i = 0; i < need - 1; i++) choose(a, ['3C陪伴同行']);
  assert.equal(a.hidden[DEP], 60, '未達門檻不降');
  choose(a, ['3C陪伴同行']); assert.ok(a.hidden[DEP] < 60, '達門檻的那一次降');
  // 中間斷一次（只加時間管控、強制收回都算斷）：歸零
  const b = fresh(); b.hidden[DEP] = 60; choose(b, ['3C陪伴同行']); choose(b, ['事前訂規則', '說到做到']);
  assert.equal(b.vars['3C陪伴_連續'], 0);
  const c = fresh(); choose(c, ['3C陪伴同行']); choose(c, ['3C任務借用']); assert.equal(c.vars['3C陪伴_連續'], 1, '中性的選項（任務借用、提議別的）不歸零也不加');
  // 不是 screen 卡上的陪伴標籤不算
  const d = fresh(); choose(d, ['放下手機陪'], { screen: false }); assert.equal(d.vars['3C陪伴_連續'], 0);
});

test('門檻依階段：國中比國小長', () => { assert.ok(S.need.國中 > S.need.國小低); assert.ok(S.need.國小中高 >= S.need.國小低); });

test('一次大活動：依賴度先降，沒有接上連續的陪伴就彈回去；連續的陪伴一建立，留得住', () => {
  const a = fresh(); a.hidden[DEP] = 50; a.child['3C時間'] = 0;
  const pre = a.hidden[DEP];
  choose(a, ['3C一次大活動']);
  const dip = pre - a.hidden[DEP]; assert.ok(dip > 0.5, '當下下降');
  assert.ok(a.vars[S.trip.reboundVar] > 0);
  months(a, 18); a.child['3C時間'] = 0;
  assert.ok(a.hidden[DEP] >= pre - 0.5 * dip, '12–18 個月後大半彈回去');
  const b = fresh(); b.hidden[DEP] = 50; choose(b, ['3C一次大活動']);
  for (let i = 0; i < S.need.國小中高; i++) choose(b, ['3C陪伴同行']);
  assert.equal(b.vars[S.trip.reboundVar], 0, '連續陪伴建立後不再彈回');
});

test('時間正規化：同樣的做法，每月的累積不隨回合長短改變（2 個月一回合 vs 6 個月一回合）', () => {
  const run = (span) => { const st = fresh(); const a = st.hidden[DEP]; choose(st, ['3C當保母'], { scale: 1 }); months(st, 36, span); return st.hidden[DEP] - a; };
  const x = run(2), y = run(6);
  assert.ok(Math.abs(x - y) <= 2.5, `${x} vs ${y}`);
});

test('假日缺席：算半次沒被接住；連續缺席會讓孩子「不太來找你」；approach 卡上停下來聽會歸零', () => {
  const st = fresh();
  const A = T.approach, k = Math.ceil(A.enterAt / A.absenceWeight);
  for (let i = 0; i < k - 1; i++) applyTags(st, ['假日缺席'], T, { turn: st.turn, stage: '國小低', ctx: {}, approach: false });
  assert.equal(st.vars.不太來找你, 0);
  applyTags(st, ['假日缺席'], T, { turn: st.turn, stage: '國小低', ctx: {}, approach: false });
  assert.equal(st.vars.不太來找你, 1);
  const b = fresh();
  for (let i = 0; i < 4; i++) applyTags(b, ['假日缺席'], T, { turn: b.turn, stage: '國小低', ctx: {}, approach: false });
  applyTags(b, ['聽他說完'], T, { turn: b.turn, stage: '國小低', ctx: {}, approach: true });
  assert.equal(b.vars.孩子來找_連續錯過, 0);
});

test('假日缺席：了解度與溫暖往下；接了的次數計入，邀約的池權重隨累計與名聲上升、婉拒多了下降', () => {
  const st = fresh(); const u = st.hidden.了解度, w = st.hidden.溫暖陪伴;
  applyTags(st, ['假日缺席'], T, { turn: st.turn, stage: '國小低', ctx: {}, approach: false });
  assert.ok(st.hidden.了解度 < u && st.hidden.溫暖陪伴 < w);
  assert.equal(st.vars.邀約接受, 1);
  applyTags(st, ['假日缺席_少'], T, { turn: st.turn, stage: '國小低', ctx: {}, approach: false });
  assert.equal(st.vars.邀約接受, 1.5);
  const mods = data.pools['假日邀約'].mods;
  const wOf = (ctx) => mods.reduce((x, m) => x * (evalIf(m.if, ctx) ? m.x : 1), data.pools['假日邀約'].base);
  const base = { 職位: '主管', 職業: '業務', 工作表現: 62, 邀約接受: 0, 邀約婉拒: 0 };
  assert.ok(wOf({ ...base, 邀約接受: 3 }) > wOf(base));
  assert.ok(wOf({ ...base, 工作表現: 75 }) > wOf(base));
  assert.ok(wOf({ ...base, 邀約婉拒: 4 }) < wOf(base));
  assert.equal(wOf({ ...base, 職位: '基層', 職業: '早餐店' }), 0, '不是主管、專業人員、名聲也不高的家長沒有邀約');
});
import { evalCond as evalIf } from '../js/engine/events.js';

test('「不太來找你」期間了解度每月小幅下滑（§6）：時間正規化、離開後停止', () => {
  const e = edgeById(data.model).get('k:不太來找你→了解度');
  assert.ok(e && e.w > 0 && e.sign === '-');
  const run = (inState, span) => { const st = fresh(); st.vars.不太來找你 = inState ? 1 : 0; st.hidden.了解度 = 40; for (let i = 0; i < 12 / span; i++) driftHidden(st, T, { span, months: 100, stage: '國小中高' }); return st.hidden.了解度; };
  const on2 = run(true, 2), off = run(false, 2);
  assert.ok(on2 < off - 0.5, `${on2} vs ${off}`);
  assert.ok(Math.abs(on2 - run(true, 6)) < 0.15, '回合長短不影響每月的量');
});

test('新卡：螢幕決定卡都標 screen、後續卡有前因；第一個選項都能被機器人挑到', () => {
  const ids = ['inf_song_calm', 'kid_song_calm', 'lo_tablet_home', 'jh_phone_weekend', 'hi_phone_confiscate', 'hi_task_borrow', 'big_trip_c3', 'fu_after_trip', 'fu_c3_sneak', 'fu_c3_together'];
  for (const id of ids) { const c = data.cardIndex[id]; assert.ok(c, id); assert.equal(c.screen, true, id); }
  for (const id of ['fu_after_trip', 'fu_c3_sneak', 'fu_c3_together']) assert.ok(data.cardIndex[id].requires, id + ' 要有前因');
  assert.match(data.cardIndex.fu_after_trip.text, /回來之後，.*又窩回房間/);
  // 播兒歌：三種做法 + 改用別的方法
  const song = data.cardIndex.inf_song_calm.choices.map((c) => c.tags[0]);
  assert.deepEqual(song.slice(0, 3), ['3C當保母', '3C約定且在旁', '提議別的']);
});

test('官方建議的數字只出現在已核的研究小卡（docs/research/screen-time.md 標【已核】）', async () => {
  const { readFileSync } = await import('node:fs');
  const md = readFileSync(new URL('../docs/research/screen-time.md', import.meta.url), 'utf8');
  assert.ok(md.includes('【已核】') && !md.includes('【待核】'));
  for (const id of ['inf_song_calm', 'kid_song_calm']) assert.ok(/1 小時|不看螢幕/.test(data.cardIndex[id].note), id);
});

/* ───── 審查後新增：回彈判定要有鑑別力（reboundMonth＝0 的對照必須失敗）───── */
import { reboundVerdict } from '../tools/checks/c3.mjs';
import { loadTargets } from '../tools/plugins.mjs';

/** 配對的微型模擬：同一個起點，一邊在旅行卡選了一次大活動，另一邊沒有；各自過 12 個月（3C 時間固定在 40） */
function tripPairs(n = 24) {
  const out = [];
  for (let seed = 1; seed <= n; seed++) {
    const mk = () => { const st = newState(seed, data, { role: '媽媽' }); st.turn = 25; st._stage = '國小中高'; st.hidden[DEP] = 40 + (seed % 7) * 3; st.child['3C時間'] = 40; return st; };
    const a = mk(), b = mk();
    choose(a, ['3C一次大活動']);
    const post = (st) => st.hidden[DEP];
    const pa = post(a), pb = post(b);
    months(a, 12); months(b, 12);
    out.push({ trip: { post: pa, d12: post(a) }, base: { post: pb, d12: post(b) } });
  }
  return out;
}
test('回彈判定：有回彈機制時通過；reboundMonth＝0（沒有回彈）的對照局必須失敗', () => {
  const R = { ...loadTargets().c3.tripRebound, minTrips: 10 };
  const ok = reboundVerdict(tripPairs(), R);
  assert.ok(ok.ok, JSON.stringify(ok));
  assert.ok(ok.retained <= R.retain, `留下 ${ok.retained}`);
  const keep = S.trip.reboundMonth;
  try {
    S.trip.reboundMonth = 0;
    const ctl = reboundVerdict(tripPairs(), R);
    assert.ok(!ctl.ok, '沒有回彈機制時，這個判定不能通過：' + JSON.stringify(ctl));
    assert.ok(ctl.retained > 0.5, `對照局留下 ${ctl.retained}`);
  } finally { S.trip.reboundMonth = keep; }
});

test('放任型 3C 的對照機器人：只有螢幕卡上的做法不同，其他完全用同一個基底；對照組不拿螢幕當保母', async () => {
  const { ALL_BOTS, C3_PERM_BASES } = await import('../tools/bots.mjs');
  for (const b of C3_PERM_BASES) {
    const c = ALL_BOTS[`c3Ctrl_${b}`], p = ALL_BOTS[`c3Perm_${b}`];
    assert.equal(c.fallback, b); assert.equal(p.fallback, b); assert.ok(c.screenOnly && p.screenOnly);
    assert.ok(c.avoid.includes('3C當保母') && !p.avoid);
  }
  for (const n of ['c3Agreed', 'c3Task', 'c3Limit', 'c3Confiscate', 'c3Companion', 'c3Trip', 'c3NoTrip']) { assert.equal(ALL_BOTS[n].fallback, 'commonReaction', n); assert.ok(ALL_BOTS[n].avoid.includes('3C當保母'), n); }
});

test('依賴度的直接後果（§4.39）：高依賴度讓親子信任、了解度、閱讀習慣每月往下；作業▲打折；天賦好的孩子學習面受的傷害較輕、互動照樣變少', () => {
  const H = S.harm;
  const run = (dep, talent) => { const st = fresh(); st.hidden[DEP] = dep; st.family.child.talents.國語 = talent; st.family.child.talents.數學 = talent; const t0 = { ...st.hidden }; for (let i = 0; i < 12; i++) { st.hidden[DEP] = dep; driftHidden(st, T, { span: 2, months: 100 + i * 2, stage: '國小中高' }); } return { trust: st.hidden.親子信任 - t0.親子信任, know: st.hidden.了解度 - t0.了解度, read: st.hidden.閱讀習慣 - t0.閱讀習慣 }; };
  const lo = run(10, 0), hi = run(80, 0), gifted = run(80, 2);
  assert.ok(hi.trust < lo.trust - 1 && hi.know < lo.know - 1 && hi.read < lo.read - 0.5, JSON.stringify({ lo, hi }));
  assert.ok(gifted.read > hi.read && Math.abs(gifted.trust - hi.trust) < 1e-9, '天賦好的孩子閱讀習慣掉得少，親子信任照樣掉');
  assert.equal(discountHomework(Object.assign(fresh(), {}), T, { 作業: 3 }).作業, 3, '低依賴度不打折');
  const st = fresh(); st.hidden[DEP] = 90; st.family.child.talents.國語 = 0; st.family.child.talents.數學 = 0;
  assert.ok(discountHomework(st, T, { 作業: 4, 耐心: -2 }).作業 <= 4 * (1 - H.homeworkDiscount + 1e-9) + 1e-9);
  assert.equal(discountHomework(st, T, { 作業: 4, 耐心: -2 }).耐心, -2, '花費不動');
  // 嘗試新活動、閱讀習慣的好處打折
  const a = fresh(), b = fresh(); a.hidden[DEP] = 5; b.hidden[DEP] = 90; b.family.child.talents.國語 = 0; b.family.child.talents.數學 = 0; a.family.child.talents.國語 = 0; a.family.child.talents.數學 = 0;
  const ra = a.hidden.主見, rb = b.hidden.主見; applyTags(a, ['嘗試新活動'], T, { turn: 25, stage: '國小中高', ctx: {} }); applyTags(b, ['嘗試新活動'], T, { turn: 25, stage: '國小中高', ctx: {} });
  assert.ok(b.hidden.主見 - rb < a.hidden.主見 - ra, '高依賴度的孩子，嘗試新活動的好處打折');
});
import { discountHomework } from '../js/engine/tags.js';

test('結局：依賴度仍高、學習軸好的局，寫出「成績很好。家裡很安靜…」（事實，不評論）；依賴度由 driftHidden 寫進紀錄', async () => {
  const { chainRecords, endingContext, pickLines } = await import('../js/engine/ending.js');
  const st = fresh(); st.hidden[DEP] = 70; driftHidden(st, T, { span: 2, months: 100, stage: '國中' });
  assert.equal(st.vars['3C依賴高'], 1);
  st.hidden[DEP] = 20; driftHidden(st, T, { span: 2, months: 102, stage: '國中' });
  assert.equal(st.vars['3C依賴高'], 0);
  const mk = (hi, band) => pickLines(endingContext({ axes: { 親子: 50, 人際: 50, 學習: band === 'hi' ? 70 : 40 }, wellbeing: { child: 55, parent: 55, between: 55 }, route: { kind: 'x' }, combo: '其他' }, { ...chainRecords(st), 三C依賴高: hi }, data.ending, data.model));
  const quiet = mk(1, 'hi').find((l) => l.id === 'learn-quiet');
  assert.ok(quiet && /成績很好/.test(quiet.text) && /家裡很安靜/.test(quiet.text));
  assert.ok(!mk(0, 'hi').some((l) => l.id === 'learn-quiet') && !mk(1, 'lo').some((l) => l.id === 'learn-quiet'));
  assert.ok(!/(應該|不好|可惜|問題)/.test(quiet.text), '陳述事實，不評論');
});
