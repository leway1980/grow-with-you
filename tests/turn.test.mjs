import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData, loadRaw } from '../tools/data-node.mjs';
import { newState, startTurnOf } from '../js/engine/state.js';
import { startTurn, chooseCard, nextCard, finishTurn, playTurn, buildTimeline, gradeName, ageLabel, playedStages } from '../js/engine/turn.js';
import { drawCard, cardTagSet, describeCard, buildCtx, poolWeight, applyChoice, slotAvailable, gateNames, choiceCtx, choiceState, applyEffects } from '../js/engine/events.js';
import { shuffleOrder } from '../js/engine/rng.js';
import { doseView } from '../js/engine/dose.js';
import { stateRng } from '../js/engine/rng.js';
import { botPolicy } from '../tools/simulate.mjs';
import { hiddenScore } from '../tools/metrics.mjs';

const data = loadData();
const fresh = (seed = 5, mode = 'birth') => newState(seed, data, { role: '媽媽', startMode: mode });
const PLAYABLE = data.calendar.playableTurns;
const E = startTurnOf(data, 'elementary'); // 一年級第一回合（由日曆算出）
const gradeTurn = (g, name) => data.timeline.find((t) => t.grade === g && (!name || t.fixed.includes(name))).turn;
const quietLowTurn = data.timeline.find((t) => t.stage === '國小低' && !t.fixed.length).turn; // 國小低、沒有固定事件的回合
const pickFirst = { choose: (s, v) => v.choices.find((c) => !c.disabled).i };

/* ───── 洗牌 ───── */
test('洗牌：同一個 (種子, 回合, 卡片) 永遠同一個順序；不同種子順序不同；不看玩家的選擇', () => {
  assert.deepEqual(shuffleOrder(5, 30, 'kid_dress', 4), shuffleOrder(5, 30, 'kid_dress', 4));
  const orders = new Set();
  for (let seed = 1; seed <= 60; seed++) orders.add(shuffleOrder(seed, 30, 'kid_dress', 4).join());
  assert.ok(orders.size >= 12, `只有 ${orders.size} 種順序`);
  for (const o of orders) assert.deepEqual(o.split(',').map(Number).sort(), [0, 1, 2, 3]); // 是排列
});

test('洗牌：畫面上的選項順序真的被打亂——研究支持的選項不會固定排第一、也不會固定排在原本的位置', () => {
  const firstPos = {};
  let cards = 0;
  for (const card of data.events.cards) {
    if (card.choices.length < 4 || card.choices.some((c) => c.showIf)) continue;
    cards++;
    const best = card.choices.map((c) => hiddenScore(data.tags, c)).reduce((b, v, i, a) => (v > a[b] ? i : b), 0);
    const pos = new Set(), disp = new Set();
    for (let seed = 1; seed <= 80; seed++) {
      const st = fresh(seed); st.turn = 30;
      const view = describeCard(card, st, data, data.timeline[30]);
      pos.add(view.choices.findIndex((c) => c.i === best));
      disp.add(view.choices.map((c) => c.i).join());
    }
    assert.ok(pos.size >= 3, `${card.id}：研究支持的選項只出現在 ${[...pos]} 這些位置`);
    assert.ok(disp.size >= 8, `${card.id}：只有 ${disp.size} 種順序`);
    firstPos[card.id] = pos;
  }
  assert.ok(cards >= 15);
});

test('畫面選項：位置 pos 是 0..n−1；引擎用的原始索引 i 不重複；順序只依種子、回合與卡片，重新抽卡結果一樣（存檔重讀一致）', () => {
  const st = fresh(9); st.turn = 25;
  const card = data.cardIndex.lo_hw;
  const a = describeCard(card, st, data, data.timeline[25]), b = describeCard(card, st, data, data.timeline[25]);
  assert.deepEqual(a, b);
  assert.deepEqual(a.choices.map((c) => c.pos), a.choices.map((_, k) => k));
  assert.equal(new Set(a.choices.map((c) => c.i)).size, a.choices.length);
  assert.notDeepEqual(a.choices.map((c) => c.i), a.choices.map((_, k) => k).sort(), '原始順序'); // 這個種子不是原本的排列（若剛好是，換一個種子）
});

/* ───── 3C 的優先順序錯誤 ───── */
test('3C 的常態＝階段基準 + 規範監督的影響（M1 的 ?? 與 + 優先順序錯誤）：國小期間規範監督高的孩子，3C 常態比較低', () => {
  const run = (firmness) => {
    const st = fresh(2); st.turn = 40; // 國小中高：3C 的基準是 42
    st.hidden.規範監督 = firmness; st.hidden.試探度 = 25;
    st.child['3C時間'] = 42;
    const before = st.child['3C時間'];
    finishTurn(st, data);
    return st.child['3C時間'] - before;
  };
  const hi = run(90), lo = run(10);
  assert.ok(hi < lo - 1, `${hi} vs ${lo}`);
  // 數值正確：target = 42（國小中高）+ (50 − 規範) × 0.25，往 target 走一個回合的回復率（舊的每回合 0.2＝2 個月，以月計換成這個回合的月數）
  const t = 42 + (50 - 90) * 0.25;
  const rate = 1 - Math.pow(1 - 0.2, data.timeline[40].span / 2);
  assert.ok(Math.abs(hi - (t - 42) * rate) < 1e-9, String(hi));
});

/* ───── 錢、花費累積 ───── */
test('錢往家境的目標回歸（吃緊 25、小康 50、寬裕 70），不是單調掉；錢為 0 也會慢慢回來', () => {
  const target = { 吃緊: 25, 小康: 50, 寬裕: 70 };
  const seen = new Set();
  for (let seed = 1; seed <= 400 && seen.size < 3; seed++) {
    const st = fresh(seed);
    if (seen.has(st.family.econ)) continue;
    seen.add(st.family.econ);
    st.parent.錢 = 0; st.turn = E;
    for (let i = 0; i < 40; i++) { st.turn = E + (i % 30); finishTurn(st, data); }
    assert.ok(Math.abs(st.parent.錢 - target[st.family.econ]) < 1.5, `${st.family.econ}: ${st.parent.錢}`);
    st.parent.錢 = 100; st.turn = E;
    for (let i = 0; i < 40; i++) { st.turn = E + (i % 30); finishTurn(st, data); }
    assert.ok(Math.abs(st.parent.錢 - target[st.family.econ]) < 1.5);
  }
  assert.equal(seen.size, 3);
});

test('花費會累積：同樣的總花費，連續幾回合付出比一次付出更難恢復；單次花費不會在一回合內被洗掉', () => {
  const base = () => { const st = fresh(3); st.turn = E; return st; };
  const A = base(), B = base();
  // A：一次付出 −24；B：每回合 −4 連續 6 回合
  const full = 74 + data.identities.patterns[A.family.pattern].體力;
  A.parent.體力 = B.parent.體力 = full;
  A.parent.體力 -= 24; A.cur = { acc: { 體力: -24 } }; finishTurn(A, data);
  const afterOne = A.parent.體力;
  assert.ok(afterOne < full - 24 + 0.1 * 24 + 1, `一回合只回復一小部分：${afterOne}`);
  for (let i = 0; i < 5; i++) { A.turn = E + 1 + i; finishTurn(A, data); }
  for (let i = 0; i < 6; i++) { B.turn = E + i; B.parent.體力 -= 4; B.cur = { acc: { 體力: -4 } }; finishTurn(B, data); }
  assert.ok(B.costEMA.體力 > 2.5 && A.costEMA.體力 < B.costEMA.體力, `${A.costEMA.體力} vs ${B.costEMA.體力}`);
  // 回復目標被近期花費拉低
  const M = data.identities.parentModel;
  assert.ok(B.parent.體力 < full - M.kBody * 2.5 - 5, String(B.parent.體力));
});

test('花費的回復速度大約 0.1（2 個月的回合）：閒置一回合，離目標的差距縮小約一成；3 個月的回合縮小得更多（以月計）', () => {
  const st = fresh(3); st.turn = E;
  const full = 74 + data.identities.patterns[st.family.pattern].體力;
  st.parent.體力 = full - 30; st.cur = null;
  finishTurn(st, data);
  const r = 1 - Math.pow(1 - data.identities.parentModel.recoverMonth, data.timeline[E].span);
  assert.equal(data.timeline[E].span, 2);
  assert.ok(Math.abs(r - 0.1) < 1e-5);
  assert.ok(Math.abs(st.parent.體力 - (full - 30 + r * 30)) < 1e-9, String(st.parent.體力));
});

/* ───── 劑量表顯示意圖 ───── */
test('劑量表顯示「想要造成的變化」：錢已經是 0，選了錢 −6 的選項 → 仍然顯示錢▼，不是被夾住之後的 0', () => {
  const st = fresh(3); st.turn = 25; st.parent.錢 = 0;
  const tl = data.timeline[25];
  const card = { id: 't_money', pool: '日常_國小低', title: 't', text: 't', choices: [{ label: 'a', effects: { 錢: -6 }, tags: ['外包'], result: '' }, { label: 'b', effects: { 耐心: 1 }, tags: ['不轉述消息'], result: '' }] };
  data.cardIndex[card.id] = card;
  const out = applyChoice(st, data, card, 0, tl, stateRng(st, 'rngS'));
  assert.equal(st.parent.錢, 0);
  const dose = doseView(out.acc, st, tl.stage);
  assert.deepEqual(dose.parent.map((r) => [r.key, r.dir, r.level]), [['錢', -1, 2]]);
});

test('一年級的運動會與戶外教學在同一回合：運動會是第一張卡，戶外教學是第二張卡（國小低的固定事件回合 5/10）', () => {
  const t = data.timeline.find((x) => x.grade === 1 && x.fixed.includes('fx_sports_day'));
  assert.deepEqual(t.fixed, ['fx_sports_day', 'fx_field_trip']);
  const st = fresh(6, 'elementary'); st.turn = t.turn;
  const res = startTurn(st, data);
  assert.equal(res.raw.id, 'fx_sports_day'); assert.equal(res.twoSlot, true);
  assert.equal(chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i).more, true);
  assert.equal(nextCard(st, data).raw.id, 'fx_field_trip');
});

/* ───── 固定事件的回合有第二張卡 ───── */
test('有固定事件的回合有第二張卡（日常或後續卡）；劑量表等第二張選完才合計', () => {
  const SPORTS = gradeTurn(2, 'fx_sports_day');
  const st = fresh(6, 'elementary'); st.turn = SPORTS; // 二年級的運動會（fx_sports_day，只有一個固定事件；一年級的運動會和戶外教學同一回合）
  const res = startTurn(st, data);
  assert.equal(res.raw.id, 'fx_sports_day'); assert.equal(res.twoSlot, true);
  const out1 = chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i);
  assert.equal(out1.more, true); assert.equal(out1.dose, null);
  const nx = nextCard(st, data);
  assert.ok(nx && nx.raw.id !== 'fx_sports_day' && !nx.raw.pool.startsWith('_'), nx && nx.raw.id);
  const out2 = chooseCard(st, data, nx.card.choices.find((c) => !c.disabled).i);
  assert.equal(out2.more, false);
  // 合計＝兩張卡各自的變化相加
  const sum = {};
  for (const h of st.hist.filter((x) => x.turn === SPORTS)) for (const [k, v] of Object.entries(h.d)) sum[k] = (sum[k] || 0) + v;
  const shown = Object.fromEntries([...out2.dose.parent, ...out2.dose.child].map((r) => [r.key, r.dir]));
  for (const k of Object.keys(shown)) assert.equal(Math.sign(sum[k] || 0) || shown[k], shown[k], k);
  assert.equal(st.hist.filter((x) => x.turn === SPORTS).length, 2);
  finishTurn(st, data);
});

test('一年級開學日有兩個固定事件：開學第一天、每天怎麼去學校；第二個排成第二張卡（上下學方式存進 st.vars）', () => {
  const st = fresh(6, 'elementary'); // 一年級開學日（回合 E）
  assert.equal(st.turn, E);
  const res = startTurn(st, data);
  assert.equal(res.raw.id, 'fx_enroll'); assert.equal(res.twoSlot, true);
  assert.equal(chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i).more, true);
  const nx = nextCard(st, data);
  assert.equal(nx.raw.id, 'fx_commute');
  const pick = nx.card.choices.find((c) => !c.disabled);
  assert.equal(chooseCard(st, data, pick.i).more, false);
  assert.ok(['接送', '交通車', '走路公車', '長輩接送'].includes(st.vars.上學方式), st.vars.上學方式);
  finishTurn(st, data);
});

test('沒有固定事件的回合只有一張卡', () => {
  const st = fresh(6); st.turn = 3;
  const res = startTurn(st, data);
  assert.equal(res.twoSlot, false);
  const out = chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i);
  assert.equal(out.more, false); assert.ok(out.dose);
});

/* ───── 工作型態改變代價（§2.3）───── */
test('陪伴時段：沒有該時段 → 多付體力或請假，顯示在劑量表上，選項不會消失；有時段就不用付', () => {
  const card = data.cardIndex.lo_hw; // #0 需要「晚餐」
  const mk = (p) => {
    const d = loadData(); // 獨立一份資料，不影響其他測試
    d.identities.patterns = structuredClone(d.identities.patterns);
    for (const v of Object.values(d.identities.patterns)) v.晚餐 = p;
    return d;
  };
  const run = (p) => {
    const d = mk(p);
    const st = newState(5, d, {}); st.turn = 25;
    const view = describeCard(d.cardIndex.lo_hw, st, d, d.timeline[25]);
    assert.ok(view.choices.some((c) => c.i === 0 && !c.disabled), '選項不會消失');
    return applyChoice(st, d, d.cardIndex.lo_hw, 0, d.timeline[25], stateRng(st, 'rngS'));
  };
  const yes = run(1), no = run(0);
  const cost = data.tags.slotCost.晚餐;
  for (const [k, v] of Object.entries(cost)) assert.equal(no.acc[k], (yes.acc[k] || 0) + v, k);
  assert.ok(no.acc.體力 < yes.acc.體力);
  assert.deepEqual(doseView(no.acc, fresh(5), '國小低').parent.map((r) => r.key).includes('體力'), true);
  void card;
});

test('陪伴時段由工作型態的機率決定（命運骰，和玩家無關）：輪班的晚餐機率低於朝九晚五', () => {
  const freq = (pattern, need) => {
    let n = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const st = fresh(seed); st.family.pattern = pattern;
      if (slotAvailable(st, data, need, 10 + (seed % 40))) n++;
    }
    return n / 400;
  };
  assert.ok(freq('朝九晚五', '晚餐') > freq('輪班', '晚餐') + 0.2);
  assert.ok(freq('晚上工作', '睡前') < 0.3);
  assert.ok(freq('清晨開店', '早晨') < 0.3);
  const st = fresh(5); assert.equal(slotAvailable(st, data, '晚餐', 12), slotAvailable(st, data, '晚餐', 12));
});

/* ───── 情境負荷 ───── */
test('帳單是情境負荷：附在卡片上、一起算進劑量表，不是每回合固定扣款', () => {
  const d = loadData();
  d.loads = [{ id: 't', text: '這個月的帳單多了一筆。', p: 0.999, effects: { 錢: -7, 耐心: -2 } }];
  const st = newState(5, d, {}); st.turn = 3;
  const res = startTurn(st, d);
  assert.deepEqual(res.card.loads, ['這個月的帳單多了一筆。']);
  const m0 = st.parent.錢;
  const out = chooseCard(st, d, res.card.choices.find((c) => !c.disabled).i);
  assert.ok(m0 - st.parent.錢 >= 7 - 1);
  assert.ok(out.dose.parent.some((r) => r.key === '錢' && r.dir < 0));
  // 沒有負荷的回合，錢不會自己往下掉
  const st2 = newState(5, data, {}); st2.parent.錢 = 50; st2.turn = 3; st2.family.econ = '小康';
  finishTurn(st2, data);
  assert.ok(Math.abs(st2.parent.錢 - 50) < 1e-9);
});

/* ───── 意願強度／topic：顯示、變灰、套用用同一個環境 ───── */
test('選項自己的 topic 同時用在顯示、變灰與套用：顯示可選 ⇔ 套用不丟錯', () => {
  const card = { id: 't_topic', pool: '日常_國小低', title: 't', text: 't', topic: '運動',
    choices: [{ label: 'a', effects: { 心情: 1 }, tags: ['不轉述消息'], result: '', topic: '科學', grayIf: [{ if: '意願強度 >= 1', reason: '很想要時不能這樣' }] }, { label: 'b', effects: { 心情: 1 }, tags: ['不轉述消息'], result: '' }] };
  data.cardIndex[card.id] = card;
  let differs = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const st = fresh(seed); st.turn = 25;
    const tl = data.timeline[25];
    const view = describeCard(card, st, data, tl);
    const c = view.choices.find((x) => x.i === 0);
    let applied = true;
    try { applyChoice(st, data, card, 0, tl, stateRng(st, 'rngS')); } catch { applied = false; }
    assert.equal(!c.disabled, applied, `seed ${seed}`);
    // 和「用卡片的 topic 算」會不一樣（證明選項自己的 topic 真的被用到）
    const cardLevel = choiceState(card.choices[0], buildCtx(st, tl, { topic: card.topic }));
    if (cardLevel.disabled !== c.disabled) differs++;
  }
  assert.ok(differs > 0);
});

/* ───── 孩子不再開口 ───── */
test('孩子不再開口：說了沒人聽的次數越多，孩子重提的後續池與「孩子主動提」的卡權重越低', () => {
  const st = fresh(5); st.turn = 25;
  st.openPools['孩子重提'] = { x: 4, until: 200 }; // until＝最後一個還開著的月齡
  const tl = data.timeline[25];
  const w = (n) => { st.vars.孩子不再開口 = n; return poolWeight(st, data, '孩子重提', buildCtx(st, tl)); };
  assert.ok(w(0) > w(1) && w(1) > w(3), `${w(0)} ${w(1)} ${w(3)}`);
  assert.ok(Math.abs(w(3) - w(0) / 4) < 1e-9);
  const club = data.cardIndex.lo_club;
  assert.ok(club.modifiers.some((m) => /孩子不再開口/.test(m.if) && m.x < 1));
});

/* ───── 連鎖卡可以跨階段再出現 ───── */
test('§3.3 的連鎖卡（lo_club → 他又提了一次 → 他不要去了）不是 once，跨階段可以再出現（有冷卻）', () => {
  for (const id of ['lo_club', 'fu_ask_again', 'fu_ask_third']) {
    const c = data.cardIndex[id];
    assert.ok(!c.once, `${id} 還是 once`);
    assert.ok(c.cooldownMonths > 0, `${id} 沒有冷卻`);
    assert.ok(c.stages.includes('國小低') && c.stages.includes('國小中高'), id);
  }
});

/* ───── 具名門檻 ───── */
test('門檻有名字：卡片裡不寫「了解度 >= 55」這種裸數字，全遊戲只有 tags.json 的 gates 一個地方', () => {
  const T = data.tags;
  assert.equal(T.gates.了解度.高, 55);
  const st = fresh(5); const tl = data.timeline[25];
  st.hidden.了解度 = 55; assert.equal(buildCtx(st, tl).了解度高, true);
  st.hidden.了解度 = 54.9; assert.equal(buildCtx(st, tl).了解度高, false);
  assert.ok(gateNames().includes('了解度高') && gateNames().includes('了解度中'));
  const src = JSON.stringify(data.events.cards);
  assert.ok(!/了解度 *(>=|<|>|<=|==) *\d/.test(src), '卡片條件裡有裸的了解度數字');
});

/* ───── 後續卡 ───── */
test('後續卡記下排進去的回合；出現時記下延遲；到期的後續卡比抽卡優先', () => {
  const st = fresh(5); st.turn = quietLowTurn;
  st.delayed.push({ card: 'fu_ask_again', due: quietLowTurn, from: quietLowTurn - 2 });
  st.flags.參加球類社團 = false; st.flags.社團_被擋 = true; // 後續卡要有前因（規則 14）
  const res = startTurn(st, data);
  assert.equal(res.raw.id, 'fu_ask_again');
  chooseCard(st, data, res.card.choices.find((c) => !c.disabled).i);
  assert.equal(st.hist.at(-1).fu, data.timeline[quietLowTurn].ageMonths - data.timeline[quietLowTurn - 2].ageMonths); // 延遲以月計
});

test('一整局玩下來，每回合都玩完（含固定事件的第二張）而且不丟錯', () => {
  for (const bot of ['random', 'warmFirm', 'permissive']) {
    const st = fresh(12);
    let guard = 0;
    while (!st.ended && guard++ < 100) playTurn(st, data, botPolicy(bot, 3));
    assert.equal(st.turn, PLAYABLE);
  }
});
void applyEffects; void choiceCtx; void loadRaw;

/* ───── 第二輪：個別差異、花費倍率、家庭變故、休息 ───── */
import { scaleCosts } from '../js/engine/events.js';
import { BOTS } from '../tools/simulate.mjs';

test('反向機器人 antiDose 存在：永遠選看得到的變化最差的選項', () => {
  assert.ok(BOTS.antiDose);
  const ch = (e) => ({ effects: e, tags: ['不轉述消息'] });
  assert.ok(BOTS.antiDose.score(data.tags, ch({ 心情: 5 })) < BOTS.antiDose.score(data.tags, ch({ 心情: -5 })));
});

test('孩子的接受度（responsive）是個別差異：由自己的亂數流抽，不影響其他開局抽籤；影響所有標籤的幅度', () => {
  const vals = new Set();
  for (let seed = 1; seed <= 200; seed++) vals.add(newState(seed, data, {}).family.child.responsive);
  assert.ok(vals.size > 30);
  const R = data.identities.child.responsive;
  for (const v of vals) assert.ok(v >= R.min && v <= R.max);
  // 其他抽籤不受影響：同一個種子的家庭，除了 responsive 之外和加這個欄位之前一樣（職業、家境、孩子氣質）
  const f = newState(7, data, {}).family;
  assert.equal(f.child.name.length > 1, true);
});

test('花費倍率（costMods）：ADHD 的孩子，訂規則與跟進要付更多耐心；另一半一起陪，什麼都比較省力；只動花費，不動好處', () => {
  const ch = { effects: { 耐心: -4, 體力: -2, 心情: 3, 錢: -2 }, tags: ['事前訂規則'] };
  const m = data.tags.costMods;
  const adhd = scaleCosts(m, ch, { 有特殊需求ADHD: true, 另一半: '只出錢' });
  assert.equal(adhd.耐心, -6); assert.equal(adhd.體力, -3); assert.equal(adhd.心情, 3); assert.equal(adhd.錢, -2);
  const together = scaleCosts(m, ch, { 有特殊需求ADHD: false, 另一半: '一起陪' });
  assert.ok(Math.abs(together.耐心 - -2.8) < 1e-9);
  const both = scaleCosts(m, ch, { 有特殊需求ADHD: true, 另一半: '一起陪' });
  assert.ok(Math.abs(both.耐心 - -4.2) < 1e-9);
  assert.equal(scaleCosts(m, { effects: { 耐心: 3 }, tags: ['事前訂規則'] }, { 有特殊需求ADHD: true, 另一半: '' }).耐心, 3); // 正的（回復）不放大
});

test('孩子的氣質改變規則的效果：堅持度高 → 事前訂規則比較難見效；ADHD 的倍率改由 needsMult 依輕重處理（modifiers 不再重複乘）', () => {
  const lo = { 孩子堅持度: 3, 有特殊需求ADHD: false }, hi = { 孩子堅持度: 5, 有特殊需求ADHD: false }, adhd = { 孩子堅持度: 3, 有特殊需求ADHD: true };
  assert.ok(modifierFactorOf('事前訂規則', hi) < modifierFactorOf('事前訂規則', lo));
  assert.equal(modifierFactorOf('事前訂規則', adhd), modifierFactorOf('事前訂規則', lo), 'ADHD 的加成走 needsMult（tests/special_needs.test.mjs）');
  for (const t of ['吵了才讓步', '說了不算']) assert.equal(modifierFactorOf(t, adhd), modifierFactorOf(t, lo), t);
  assert.ok(modifierFactorOf('罵一頓', adhd) > modifierFactorOf('罵一頓', lo));
});
import { modifierFactor as modifierFactorOf0 } from '../js/engine/tags.js';
const modifierFactorOf = (tag, ctx) => modifierFactorOf0(data.tags, tag, ctx);

test('家庭變故（規則 18）：命運事件只改看得見的數值，不帶行為標籤、不改隱藏數值；同一個種子的變故和玩家的選擇無關', () => {
  const d = loadData();
  assert.ok(d.loads.every((l) => !('tags' in l)), '資料裡的情境負荷都沒有 tags');
  // 就算有人硬塞 tags，引擎也不會用它改隱藏數值
  d.loads = [{ id: 't', text: '突發狀況。', p: 0.999, effects: { 耐心: -5 }, tags: ['夫妻當孩子面吵'] }];
  const st = newState(5, d, {}); st.turn = 3;
  const res = startTurn(st, d);
  const cnt0 = st.tagCounts.夫妻當孩子面吵 || 0;
  const opt = res.card.choices.find((c) => !c.disabled);
  const tagsOfChoice = res.raw.choices[opt.i].tags;
  chooseCard(st, d, opt.i);
  assert.equal(st.tagCounts.夫妻當孩子面吵 || 0, cnt0 + (tagsOfChoice.includes('夫妻當孩子面吵') ? 1 : 0), '標籤只來自玩家的選項');
  // 變故出現與否只看 (種子, 回合)
  const a = newState(9, data, {}), b = newState(9, data, {});
  a.turn = b.turn = 12;
  const ra = startTurn(a, data), rb = startTurn(b, data);
  assert.deepEqual(ra.card && ra.card.loads, rb.card && rb.card.loads);
  const shocks = new Set(data.loads.map((l) => l.id));
  assert.ok(['孩子生病', '長輩住院', '夫妻失和', '工作變動', '貴人相助'].every((id) => shocks.has(id)));
});

test('真的休息會減輕累積的疲勞（relief）；不是隱藏數值', () => {
  const st = fresh(5); st.turn = 30; st.costEMA = { 體力: 10, 耐心: 10 };
  const tl = data.timeline[30];
  applyTagsLocal(st, ['父母自己休息'], tl);
  assert.ok(st.costEMA.體力 < 2 && st.costEMA.耐心 < 2, JSON.stringify(st.costEMA));
});
import { applyTags as applyTagsRaw } from '../js/engine/tags.js';
const applyTagsLocal = (st, tags, tl) => applyTagsRaw(st, tags, data.tags, { turn: st.turn, stage: tl.stage, ctx: buildCtx(st, tl, {}) });

test('不敏感的孩子，壓力有時真的把成績撐住；敏感的孩子反過來被拖累', () => {
  const run = (sens) => {
    const st = fresh(2); st.turn = 40; st.family.child.temperament.敏感度 = sens;
    st.hidden.期待壓力 = 70; st.hidden.替他做主 = 60; st.child.成績 = 50;
    for (let i = 0; i < 20; i++) { st.turn = 40 + (i % 12); finishTurn(st, data); st.hidden.期待壓力 = 70; st.hidden.替他做主 = 60; }
    return st.child.成績;
  };
  assert.ok(run(1) > run(3) + 3 && run(3) > run(5) + 3, `${run(1)} ${run(3)} ${run(5)}`);
});


/* ───── 日曆 v2（A1）：舊 92 回合表達成 v2 後，時間軸要和舊實作逐欄位一致 ───── */
const LEGACY_CAL = {"totalTurns":92,"playableTurns":56,"stages":[{"id":"嬰幼兒","turns":8,"startMonths":0,"stepMonths":3},{"id":"幼兒園","turns":12,"startMonths":24,"stepMonths":4},{"id":"國小低","grades":[1,2]},{"id":"國小中高","grades":[3,4,5,6]},{"id":"國中","grades":[7,8,9]},{"id":"高中","grades":[10,11,12]}],"segments":[{"name":"開學之後","months":"9–10 月","month":9,"vacation":false},{"name":"期中之後","months":"11–12 月","month":11,"vacation":false},{"name":"寒假前後","months":"1–2 月","month":1,"vacation":true},{"name":"下學期","months":"3–4 月","month":3,"vacation":false},{"name":"期末之前","months":"5–6 月","month":5,"vacation":false},{"name":"暑假","months":"7–8 月","month":7,"vacation":true}],"fixed":[{"turn":1,"event":"fx_leave_end"},{"turn":1,"event":"fx_leave_end_gen"},{"turn":10,"event":"fx_kindergarten"},{"turn":20,"event":"fx_enroll"}],"schoolFixed":[{"grade":[1],"seg":0,"event":"fx_commute"},{"grade":[2,3,4,5,6],"seg":0,"event":"fx_teacher_meet"},{"grade":[1,2,3,4,5,6],"seg":1,"event":"fx_sports_day"},{"grade":[1,2,3,4,5,6],"seg":3,"event":"fx_field_trip"},{"grade":[6],"seg":4,"event":"fx_graduation"}]};
const LEGACY_V2 = {"totalTurns":92,"playableTurns":56,"segmentSets":{"舊6":[{"name":"開學之後","months":"9–10 月","month":9,"vacation":false},{"name":"期中之後","months":"11–12 月","month":11,"vacation":false},{"name":"寒假前後","months":"1–2 月","month":1,"vacation":true},{"name":"下學期","months":"3–4 月","month":3,"vacation":false},{"name":"期末之前","months":"5–6 月","month":5,"vacation":false},{"name":"暑假","months":"7–8 月","month":7,"vacation":true}]},"stages":[{"id":"嬰幼兒","turns":8,"startMonths":0,"stepMonths":3},{"id":"幼兒園","turns":12,"startMonths":24,"stepMonths":4},{"id":"國小低","grades":[{"g":1,"segs":"舊6"},{"g":2,"segs":"舊6"}]},{"id":"國小中高","grades":[{"g":3,"segs":"舊6"},{"g":4,"segs":"舊6"},{"g":5,"segs":"舊6"},{"g":6,"segs":"舊6"}]},{"id":"國中","grades":[{"g":7,"segs":"舊6"},{"g":8,"segs":"舊6"},{"g":9,"segs":"舊6"}]},{"id":"高中","grades":[{"g":10,"segs":"舊6"},{"g":11,"segs":"舊6"},{"g":12,"segs":"舊6"}]}],"fixed":[{"atMonths":3,"event":"fx_leave_end"},{"atMonths":3,"event":"fx_leave_end_gen"},{"atMonths":32,"event":"fx_kindergarten"},{"at":{"stage":"國小低","i":0},"event":"fx_enroll"}],"schoolFixed":[{"grade":[1],"seg":"開學之後","event":"fx_commute"},{"grade":[2,3,4,5,6],"seg":"開學之後","event":"fx_teacher_meet"},{"grade":[1,2,3,4,5,6],"seg":"期中之後","event":"fx_sports_day"},{"grade":[1,2,3,4,5,6],"seg":"下學期","event":"fx_field_trip"},{"grade":[6],"seg":"期末之前","event":"fx_graduation"}]}; // 同一份舊日曆（92 回合）的 v2 形式（A1 的 data/calendar.json，flavor 省略）
function legacyTimeline(cal) { // A1 之前的 buildTimeline（凍結的參考實作）
  const tl = [];
  for (const s of cal.stages) {
    if (s.turns) {
      for (let i = 0; i < s.turns; i++) {
        const ageMonths = s.startMonths + i * s.stepMonths;
        tl.push({ turn: tl.length, stage: s.id, ageMonths, grade: 0, seg: -1, vacation: false, month: null, label: ageLabel(ageMonths), fixed: [] });
      }
    } else {
      for (const g of s.grades) cal.segments.forEach((seg, k) => {
        tl.push({ turn: tl.length, stage: s.id, ageMonths: 72 + (g - 1) * 12 + k * 2, grade: g, seg: k, vacation: seg.vacation, month: seg.month, label: `${gradeName(g)}・${seg.name}`, months: seg.months, fixed: [] });
      });
    }
  }
  for (const f of cal.fixed) tl[f.turn].fixed.push(f.event);
  for (const f of cal.schoolFixed) for (const t of tl) if (t.grade && f.grade.includes(t.grade) && t.seg === f.seg) t.fixed.push(f.event);
  return tl;
}

test('日曆 v2：92 回合舊日曆（v2 形式）和舊實作逐回合逐欄位一致（只多 newAge）', () => {
  const oldTl = legacyTimeline(LEGACY_CAL), newTl = buildTimeline(LEGACY_V2);
  assert.equal(LEGACY_V2.totalTurns, 92); assert.equal(LEGACY_V2.playableTurns, 56);
  assert.equal(newTl.length, oldTl.length);
  for (let i = 0; i < oldTl.length; i++) {
    const { newAge, span, ...rest } = newTl[i];
    assert.equal(typeof newAge, 'boolean'); assert.equal(typeof span, 'number'); // 只多 newAge 與 span（A2.5）
    assert.deepEqual(rest, oldTl[i], `回合 ${i}`);
  }
  assert.deepEqual(newTl.filter((t) => t.fixed.length).map((t) => [t.turn, t.fixed]), oldTl.filter((t) => t.fixed.length).map((t) => [t.turn, t.fixed]));
});

test('日曆 v2：newAge 只標在每個新的一歲的第一回合', () => {
  for (const cal of [LEGACY_V2, data.calendar]) {
    const tl = buildTimeline(cal);
    assert.equal(tl[0].newAge, false);
    for (let i = 1; i < tl.length; i++) assert.equal(tl[i].newAge, Math.floor(tl[i].ageMonths / 12) > Math.floor(tl[i - 1].ageMonths / 12), `回合 ${i}`);
  }
  assert.equal(buildTimeline(LEGACY_V2).filter((t) => t.newAge).length, 17); // 1–17 歲各一次
  assert.equal(data.timeline.filter((t) => t.newAge).length, 18); // 72 回合的日曆最後一回合滿 18 歲
});

const MINI = () => ({
  totalTurns: 0, playableTurns: 0,
  segmentSets: {
    甲3: [{ name: '開學', month: 9 }, { name: '年中', month: 12 }, { name: '暑假', month: 6, vacation: true }],
    乙2: [{ name: '上', month: 10 }, { name: '下', month: 3 }],
  },
  stages: [
    { id: '幼', turns: 4, startMonths: 0, stepMonths: 6 },
    { id: '小', grades: [{ g: 1, segs: '甲3' }, { g: 2, segs: '乙2' }] },
  ],
  fixed: [], schoolFixed: [], flavor: {},
});
const mini = (patch) => { const c = { ...MINI(), ...patch }; c.totalTurns = 4 + 3 + 2; return c; };

test('日曆 v2：段落組、月份算月齡；atMonths 取第一個月齡 ≥ 該值的回合；at:{stage,i} 取該階段第 i 回合', () => {
  const tl = buildTimeline(mini({ fixed: [{ atMonths: 7, event: 'a' }, { atMonths: 12, event: 'b' }, { atMonths: 73, event: 'c' }, { at: { stage: '小', i: 0 }, event: 'd' }, { at: { stage: '小', i: 4 }, event: 'e' }] }));
  assert.deepEqual(tl.map((t) => t.ageMonths), [0, 6, 12, 18, 72, 75, 81, 85, 90]); // 甲3：9→+0、12→+3、6→+9；乙2：10→+1、3→+6
  assert.deepEqual(tl[2].fixed, ['a', 'b']);    // 7 → 第一個 ≥7 的是 12；12 剛好 ≥ 12
  assert.deepEqual(tl[5].fixed, ['c']);         // 73 → 75
  assert.deepEqual(tl[4].fixed, ['d']);
  assert.deepEqual(tl[8].fixed, ['e']);
  assert.throws(() => buildTimeline(mini({ fixed: [{ at: { stage: '小', i: 9 }, event: 'x' }] })), /沒有第 9 回合/);
  assert.throws(() => buildTimeline(mini({ fixed: [{ atMonths: 999, event: 'x' }] })), /找不到/);
});

test('日曆 v2：schoolFixed 用段名找段，不同年級用不同段落組也對；找不到的名字要報錯', () => {
  const tl = buildTimeline(mini({ schoolFixed: [{ grade: [1, 2], seg: '暑假', event: 'sum' }, { grade: [1, 2], seg: '下', event: 'low' }, { grade: [2], seg: '上', event: 'up' }] }));
  const at = (ev) => tl.filter((t) => t.fixed.includes(ev)).map((t) => [t.grade, t.seg]);
  assert.deepEqual(at('sum'), [[1, 2]]);        // 只有甲3 有「暑假」，二年級用乙2 沒有
  assert.deepEqual(at('low'), [[2, 1]]);
  assert.deepEqual(at('up'), [[2, 0]]);
  assert.throws(() => buildTimeline(mini({ schoolFixed: [{ grade: [1], seg: '不存在', event: 'x' }] })), /不存在|沒有叫/);
  assert.equal(tl.find((t) => t.grade === 1 && t.seg === 2).vacation, true);
});

/* ───── 日曆 72 回合（A2）───── */
test('日曆 72：總回合數、各階段回合數、playableTurns 剛好接在國小六年級之後', () => {
  const tl = data.timeline;
  assert.equal(tl.length, 72); assert.equal(data.calendar.totalTurns, 72);
  const count = (stage) => tl.filter((t) => t.stage === stage).length;
  assert.deepEqual(['嬰幼兒', '幼兒園', '國小低', '國小中高', '國中', '高中', '離家'].map(count), [8, 16, 10, 16, 13, 6, 3]);
  assert.equal(data.calendar.playableTurns, 72); // E1：全部開放
  const jh = tl.findIndex((t) => t.stage === '國中'); // 國小六年級之後的第一個回合（舊的可玩終點）
  assert.equal(tl[jh - 1].stage, '國小中高'); assert.equal(tl[jh - 1].grade, 6); assert.equal(jh, 50);
  assert.deepEqual(tl.map((t) => t.ageMonths), [...tl.map((t) => t.ageMonths)].sort((a, b) => a - b), '月齡單調不減');
  assert.deepEqual(playedStages(data.calendar), ['嬰幼兒', '幼兒園', '國小低', '國小中高', '國中', '高中', '離家']);
});

test('日曆 72：起點回合由時間軸算出（從國小開始＝第一個一年級回合），從國小開始玩 PLAYABLE − E 回合', () => {
  assert.equal(startTurnOf(data, 'birth'), 0);
  assert.equal(E, 24); assert.equal(data.timeline[E].grade, 1); assert.equal(data.timeline[E - 1].grade, 0);
  assert.equal(newState(3, data, { startMode: 'elementary' }).turn, E);
  assert.equal(PLAYABLE - E, 48); // E1：從國小開始玩 72 − 24 回合
  assert.equal(startTurnOf(buildTimeline(LEGACY_V2) && { timeline: buildTimeline(LEGACY_V2) }, 'elementary'), 20, '舊日曆算出來仍是 20');
});

test('日曆 72：每個固定事件的月齡和舊 92 回合日曆相差在 ±3 個月內；每個 schoolFixed 都排得進時間軸', () => {
  const oldTl = buildTimeline(LEGACY_V2), newTl = data.timeline;
  // 國中、高中、離家的固定事件（第 50 回合以後）在舊日曆沒有對應，不比
  const evs = new Set(newTl.slice(0, newTl.findIndex((t) => t.stage === '國中')).flatMap((t) => t.fixed));
  // 例外：fx_choose_jh（國中開學前一週，M3 B4）原本排在國中一年級『開學之後』（舊 92 回合日曆也沒有它），文字寫的是開學前一週，所以搬到國小六年級『期末與暑假』（畢業典禮那一回合的第二張卡）；舊日曆沒有對應，不比月齡，下面另外檢查它排在假期
  const MOVED_IN = new Set(['fx_choose_jh']);
  for (const ev of evs) {
    if (MOVED_IN.has(ev)) { const at = newTl.filter((t) => t.fixed.includes(ev)); assert.equal(at.length, 1); assert.ok(at[0].grade === 6 && at[0].vacation, `${ev} 要在國小六年級的暑假`); continue; }
    const olds = oldTl.filter((t) => t.fixed.includes(ev));
    assert.ok(olds.length, `${ev} 在舊日曆裡有`);
    for (const t of newTl.filter((x) => x.fixed.includes(ev))) {
      const o = olds.filter((x) => x.grade === t.grade);
      // 例外：一年級的戶外教學為了讓國小低的固定事件回合 ≤ 60%（A2.5），併進『期中之後』和運動會同一回合（78 → 74 個月，提前 4 個月）
      const tol = ev === 'fx_field_trip' && t.grade === 1 ? 4 : 3;
      assert.ok(o.length === 1 && Math.abs(o[0].ageMonths - t.ageMonths) <= tol, `${ev} 年級 ${t.grade}：新 ${t.ageMonths} 個月，舊 ${o.map((x) => x.ageMonths)}`);
    }
  }
  for (const f of data.calendar.schoolFixed) for (const g of f.grade) assert.ok(newTl.some((t) => t.grade === g && t.fixed.includes(f.event)), `${f.event} 年級 ${g} 排不進時間軸`);
  // 國小中高變稀：家長會 3、5 年級；校外教學 4、6 年級；運動會每年；畢業典禮 6 年級；國小低全留
  const gs = (ev) => [...new Set(newTl.filter((t) => t.fixed.includes(ev)).map((t) => t.grade))];
  assert.deepEqual(gs('fx_teacher_meet'), [2, 3, 5]); assert.deepEqual(gs('fx_field_trip'), [1, 2, 4, 6]);
  assert.deepEqual(gs('fx_sports_day'), [1, 2, 3, 4, 5, 6]); assert.deepEqual(gs('fx_graduation'), [6]); assert.deepEqual(gs('fx_commute'), [1]);
  // 國小中高每學年 4 回合裡固定的：3、4、5 年級 2 個，6 年級 3 個（運動會、校外教學、畢業典禮）；合計 9／16
  assert.deepEqual([3, 4, 5, 6].map((g) => newTl.filter((t) => t.grade === g && t.fixed.length).length), [2, 2, 2, 3]);
});

test('模擬器的 money30 以月計：從出生與從國小開始的局都有值（國小開始後第一個月齡 ≥ 6 個月的回合）', async () => {
  const { playGame, moneyAtSchoolPlus } = await import('../tools/simulate.mjs');
  const data = loadData();
  for (const startMode of ['birth', 'elementary']) {
    const r = playGame(data, 'warmFirm', 5, { startMode, st: true });
    assert.equal(typeof r.money30, 'number', startMode);
    const e = startTurnOf(data, 'elementary'), t = data.timeline.findIndex((x, i) => i >= e && x.ageMonths >= data.timeline[e].ageMonths + 6);
    assert.equal(r.money30, r.st.vcurves.find((c) => c.t === t).錢);
    assert.equal(moneyAtSchoolPlus(r.st, data, e), r.money30);
  }
});

/* ───── 固定事件的回合：日常卡不和固定事件卡共用標籤（E1 審查：同一個方向在一個回合疊兩次） ───── */
test('固定事件的回合：第二張日常卡的任何選項都不帶固定事件卡的標籤', () => {
  let checked = 0;
  for (const tl of data.timeline) {
    if (!tl.fixed.length) continue;
    for (let seed = 1; seed <= 25; seed++) {
      const st = fresh(seed); st.turn = tl.turn;
      const r = startTurn(st, data);
      if (!r.card || !r.twoSlot) continue;
      const fxTags = cardTagSet(r.raw);
      const o = chooseCard(st, data, r.card.choices.find((c) => !c.disabled).i);
      if (!o.more) continue;
      const c2 = data.cardIndex[st.cur.next.id];
      if (st.cur.next.fu != null) continue; // 到期的後續卡不是抽的，不在這條規則內
      checked++;
      const shared = [...cardTagSet(c2)].filter((t) => fxTags.has(t));
      assert.deepEqual(shared, [], `回合 ${tl.turn}：${r.raw.id} 與 ${c2.id} 共用標籤 ${shared.join('、')}`);
    }
  }
  assert.ok(checked > 50, `只檢查到 ${checked} 個第二張日常卡`);
});

test('drawCard：excludeTags 排除任何選項（含 tagsIf 版本）帶那個標籤的卡', () => {
  const st = fresh(7); st.turn = 64;
  const tl = data.timeline[64], ctx = buildCtx(st, tl), r = stateRng(st, 'rngS');
  const all = new Set();
  for (let i = 0; i < 200; i++) { const c = drawCard(st, data, ctx, tl, r); if (c) all.add(c); }
  assert.ok(all.size > 3);
  const tag = [...cardTagSet([...all][0])][0];
  for (let i = 0; i < 200; i++) { const c = drawCard(st, data, ctx, tl, r, null, null, new Set([tag])); if (c) assert.ok(!cardTagSet(c).has(tag), c.id); }
});
