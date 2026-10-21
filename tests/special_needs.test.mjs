// 特殊需求的一致性（DESIGN §5 第 7 點、§5.0）：輕重抽籤、倍率、接住＋規則 vs 接住＋退讓、包容、崩潰 vs 鬧脾氣、用藥要盯著吃。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, loadRaw } from '../tools/data-node.mjs';
import { generateFamily } from '../js/engine/family.js';
import { newState } from '../js/engine/state.js';
import { applyTags, needsFactor, updateAdherence } from '../js/engine/tags.js';
import { applyChoice } from '../js/engine/events.js';
import { finishTurn } from '../js/engine/turn.js';
import { stateRng } from '../js/engine/rng.js';

const data = loadData();
const T = data.tags;
const fresh = (seed = 5) => newState(seed, data, { role: '媽媽', startMode: 'elementary' });
const withNeed = (st, kind, severity) => { st.family.child.needs = [{ kind, severity, diagnosed: false, onsetMonths: 0, dxMonths: null }]; return st; };
const M = 100; // 月齡（已過發作）
const F = (st, tag, tags = [tag]) => needsFactor(st, T, tag, tags, M);

test('輕重抽籤：0.55／0.3／0.15（設計估計），決定性，而且不影響其他抽籤', () => {
  const idn = loadRaw().identities, S = idn.child.needSeverity;
  assert.match(S.src, /設計估計/);
  assert.deepEqual(S.w, [0.55, 0.3, 0.15]);
  const n = { 輕: 0, 中: 0, 重: 0 }; let total = 0;
  for (let s = 1; s <= 6000; s++) for (const need of generateFamily(s, idn).child.needs) { n[need.severity]++; total++; }
  S.options.forEach((o, i) => assert.ok(Math.abs(n[o] / total - S.w[i]) < 0.04, `${o}：${n[o] / total}`));
  const a = generateFamily(77, idn), b = generateFamily(77, idn);
  assert.deepEqual(a.child.needs, b.child.needs);
  // 改掉輕重的權重，除了 severity 之外整個家庭一模一樣（獨立的亂數流）
  const idn2 = structuredClone(idn); idn2.child.needSeverity.w = [0, 0, 1];
  const strip = (f) => JSON.stringify({ ...f, child: { ...f.child, needs: f.child.needs.map(({ severity, ...r }) => r) } });
  for (let s = 1; s <= 200; s++) assert.equal(strip(generateFamily(s, idn)), strip(generateFamily(s, idn2)), `seed ${s}`);
});

test('倍率：ADHD／情緒行為，輕度全額、中度四分之三、重度一半', () => {
  const adhd = (sev) => withNeed(fresh(), 'ADHD', sev);
  assert.equal(F(adhd('輕'), '說到做到'), 1.4);
  assert.equal(F(adhd('輕'), '事前訂規則'), 1.4);
  assert.equal(F(adhd('輕'), '吵了才讓步'), 1.5);
  assert.equal(F(adhd('輕'), '說了不算'), 1.5);
  assert.ok(Math.abs(F(adhd('中'), '說到做到') - 1.3) < 1e-9);
  assert.ok(Math.abs(F(adhd('重'), '說到做到') - 1.2) < 1e-9);
  assert.ok(Math.abs(F(adhd('重'), '吵了才讓步') - 1.25) < 1e-9);
  assert.equal(F(adhd('輕'), '先接住情緒'), 0.6);
  assert.ok(Math.abs(F(adhd('重'), '先接住情緒') - 0.8) < 1e-9);
  // 接住＋規則照舊（同一個選項裡有說到做到／事前訂規則）：接住不打折
  assert.equal(F(adhd('輕'), '先接住情緒', ['先接住情緒', '說到做到']), 1);
  assert.equal(F(withNeed(fresh(), '情緒行為障礙', '輕'), '說到做到'), 1.4);
});

test('倍率：沒有這類需求、其他類別、還沒到發作月齡，都是 1', () => {
  for (const kind of ['自閉症', '學習障礙', '資優']) assert.equal(F(withNeed(fresh(), kind, '輕'), '說到做到'), 1, kind);
  assert.equal(F(withNeed(fresh(), 'ADHD', '輕'), '罵一頓'), 1);
  const st = withNeed(fresh(), 'ADHD', '輕'); st.family.child.needs[0].onsetMonths = 200;
  assert.equal(F(st, '說到做到'), 1);
  const none = fresh(); none.family.child.needs = [];
  assert.equal(F(none, '吵了才讓步'), 1);
});

test('同樣的標籤，輕度的 ADHD 孩子比重度的反應大；一般孩子最小', () => {
  const drop = (sev) => {
    const st = fresh(); if (sev) withNeed(st, 'ADHD', sev); else st.family.child.needs = [];
    const h0 = st.hidden.試探度;
    applyTags(st, ['吵了才讓步'], T, { turn: 0, months: M, span: 2, stage: '國小低', ctx: { __flags: {} } });
    return st.hidden.試探度 - h0;
  };
  const [none, mild, mid, severe] = [drop(null), drop('輕'), drop('中'), drop('重')];
  assert.ok(mild > mid && mid > severe && severe > none, JSON.stringify({ none, mild, mid, severe }));
});

const idxOf = (card, pred) => card.choices.findIndex(pred);

test('sn_push：接住＋規則照舊是好做法，接住＋退讓標「說了不算」', () => {
  const c = data.cardIndex.sn_push;
  const good = c.choices.find((ch) => ch.tags.includes('先接住情緒') && ch.tags.includes('說到做到'));
  const flawed = c.choices.find((ch) => ch.tags.includes('先接住情緒') && ch.tags.includes('說了不算'));
  assert.ok(good && flawed);
  assert.ok(good.label.includes('暫停') && good.label.includes('五分鐘'), '好做法的標籤看得到守規則的動作');
  assert.match(flawed.label, /先不用了/);
  assert.match(c.requires.expr, /有ADHD/);
});

test('包容：沒有鑑定、請大家包容，老師投入度下降、同學往來下降；好的做法是評估＋支持計畫＋家裡規則', () => {
  const st = fresh(3); st.family.child.needs = [{ kind: 'ADHD', severity: '輕', diagnosed: false, onsetMonths: 0, dxMonths: null }];
  const card = data.cardIndex.sn_teacher_note;
  const t = data.timeline.find((x) => x.stage === '國小中高').turn; st.turn = t;
  const bad = idxOf(card, (ch) => ch.tags.includes('要大家包容'));
  const v0 = st.classroom.v, peers0 = st.child.同學往來;
  applyChoice(st, data, card, bad, data.timeline[t], stateRng(st, 'rngS'));
  assert.ok(st.classroom.v < v0, '老師投入度下降');
  assert.ok(st.child.同學往來 < peers0, '同學往來下降');
  const good = card.choices[idxOf(card, (ch) => ch.tags.includes('申請評估或鑑定'))];
  assert.ok(good.tags.includes('與老師合作') && good.tags.includes('事前訂規則'));
  assert.ok(good.setFlags.includes('送評估'));
  assert.ok(T.tags.要大家包容.d.規則一致性 < 0);
});

test('自閉症：崩潰（摀著耳朵尖叫）最好降低刺激，硬要守規則是壞的；鬧脾氣（看著你討價還價）最好守住規則', () => {
  const m = data.cardIndex.sn_meltdown, tt = data.cardIndex.sn_tantrum;
  assert.match(m.text, /摀著耳朵尖叫/); assert.match(m.text, /角落/);
  assert.match(tt.text, /偷看你/); assert.match(tt.text, /哭/);
  for (const c of [m, tt]) assert.equal(c.requires.expr, '有自閉症類群');
  assert.ok(m.choices.some((ch) => ch.tags.includes('降低刺激') && ch.tags.includes('事後跟進')));
  assert.ok(m.choices.some((ch) => ch.tags.includes('崩潰中硬要守規則')));
  assert.ok(!m.choices.some((ch) => ch.tags.includes('說到做到')), '崩潰當下不靠守規則');
  assert.ok(tt.choices.some((ch) => ch.tags.includes('說到做到') && ch.tags.includes('先接住情緒')));
  assert.ok(tt.choices.some((ch) => ch.tags.includes('吵了才讓步')));
  assert.ok(T.tags.降低刺激.d.安全感 > 0 && T.tags.崩潰中硬要守規則.d.安全感 < 0);
});

test('用藥追蹤：連續兩次沒盯就打折，連續兩次盯著才恢復（連續機制）', () => {
  const st = fresh(); const v = st.vars;
  updateAdherence(st, ['忙到忘了盯藥'], T);
  assert.ok(!v.用藥打折, '一次不算');
  updateAdherence(st, ['盯著吃藥'], T);
  updateAdherence(st, ['藥交給孩子自己記'], T);
  assert.ok(!v.用藥打折, '中間盯過一次，連續歸零');
  updateAdherence(st, ['假日停藥沒問醫師'], T);
  assert.equal(v.用藥打折, 1);
  updateAdherence(st, ['盯著吃藥'], T);
  assert.equal(v.用藥打折, 1, '盯一次還不夠');
  updateAdherence(st, ['盯著吃藥'], T);
  assert.equal(v.用藥打折, 0);
  updateAdherence(st, ['罵一頓'], T);
  assert.equal(v.用藥_連續盯著, 2, '無關的標籤不動計數');
});

test('用藥追蹤：盯著吃時，用藥的 ADHD 孩子成績與作業被拖累得少；打折時幾乎沒差；選了用藥才開始追蹤', () => {
  const run = (setup) => {
    const st = fresh(9); withNeed(st, 'ADHD', '輕'); st.family.child.needs[0].onsetMonths = 0;
    setup(st);
    const tl = data.timeline.find((x) => x.stage === '國小中高'); st.turn = tl.turn; st.cur = { acc: {} };
    for (let i = 0; i < 6; i++) { st.cur = { acc: {} }; finishTurn(st, data); st.turn = tl.turn; }
    return st.child.作業 + st.child.成績;
  };
  const none = run(() => {}), on = run((st) => { st.flags.用藥中 = true; }), slip = run((st) => { st.flags.用藥中 = true; st.vars.用藥打折 = 1; });
  assert.ok(on > slip && slip >= none, JSON.stringify({ none, on, slip }));
  assert.ok(on - none > 3 * (slip - none), '打折時藥的幫助只剩一點點');
  const med = data.cardIndex.as_med;
  assert.ok(med.choices.filter((c) => (c.setFlags || []).includes('用藥中')).length >= 2, '決定用藥的選項都會開始追蹤');
  const daily = data.cardIndex.sn_med_daily;
  assert.equal(daily.scale, false); assert.ok(daily.paceMonths > 0); // E1 審查：自己排後續卡給自己的循環卡，頻率已用月份排程，不再乘回合長度（劑量依實際間隔，paceMonths）
  assert.deepEqual(daily.requires.flags, ['用藥中']);
  assert.ok(daily.choices.every((c) => c.followUp && c.followUp.some((f) => f.card === 'sn_med_daily')), '每個選項都排下一次追蹤');
});
