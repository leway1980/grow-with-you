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
