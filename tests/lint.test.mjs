import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintData, jaccard } from '../tools/lint-data.mjs';
import { loadRaw } from '../tools/data-node.mjs';
import { hiddenScore, PLAYED_STAGES } from '../tools/metrics.mjs';

test('資料檢查通過：沒有錯誤', () => {
  const { errors } = lintData();
  assert.deepEqual(errors, []);
});

test('lint 會擋下：沒有標籤、沒有可見效果、未知標籤、教養風格宣告、槽沒有後備值', () => {
  const clone = () => structuredClone(loadRaw());
  const run = (mut) => { const raw = clone(); mut(raw); return lintData(raw).errors.join('\n'); };
  assert.match(run((r) => { r.events.cards[2].choices[0].tags = []; }), /至少要有 1 個行為標籤/);
  assert.match(run((r) => { r.events.cards[2].choices[0].effects = {}; }), /至少要有 1 個看得到的效果/);
  assert.match(run((r) => { r.events.cards[2].choices[0].tags = ['不存在的標籤']; }), /不在詞彙表/);
  assert.match(run((r) => { r.events.cards[2].choices[0].label = '我是開明的父母，尊重孩子'; }), /教養風格宣告/);
  assert.match(run((r) => { r.events.cards[2].choices[0].label = '採用民主式溝通'; }), /教養風格宣告/);
  assert.match(run((r) => { r.slots.slots.球類 = r.slots.slots.球類.map((v) => ({ ...v, if: '年級 >= 1' })); }), /沒有無條件的值/);
  assert.match(run((r) => { r.events.cards[2].text += '主見'; }), /隱藏數值的名稱/);
});

/* ───── DESIGN §3.6 修訂版的新規則 ───── */
const mut = (fn) => { const raw = structuredClone(loadRaw()); fn(raw); return lintData(raw).errors.join('\n'); };
const card = (raw, id) => raw.events.cards.find((c) => c.id === id);

test('可見效果的方向由標籤的 now 決定：與標籤矛盾的 effects 會被擋下', () => {
  // 替他決定 → 作業／成績只能 ≥ 0
  assert.match(mut((r) => { const c = card(r, 'kid_dress'); c.choices[3].effects = { 作業: -3, 心情: -3 }; }), /作業 -3 和標籤的 now 矛盾/);
  // 研究支持的行為（先接住情緒）→ 花體力，不能反而回體力
  assert.match(mut((r) => { const c = card(r, 'kid_share'); c.choices[0].effects = { 體力: 4, 耐心: -2 }; }), /體力 \+4 和標籤的 now 矛盾/);
  // 吵了才讓步（給平板）→ 睡眠只能 ≤ 0（看得到的代價），耐心只能 ≥ 0（看起來划算）
  assert.match(mut((r) => { const c = card(r, 'fu_screen_ask'); c.choices[0].effects = { 睡眠: 3, 耐心: 4 }; }), /睡眠 \+3 和標籤的 now 矛盾/);
  assert.match(mut((r) => { const c = card(r, 'fu_screen_ask'); c.choices[0].effects = { 耐心: -3, 心情: 4 }; }), /耐心 -3 和標籤的 now 矛盾/);
  // 第二輪修訂：研究支持的行為孩子的心情可以小小 ▲、捷徑也可以 ▼（不再限制符號）
  assert.doesNotMatch(mut((r) => { const c = card(r, 'kid_share'); c.choices[0].effects = { 心情: 2, 耐心: -2 }; }), /kid_share.*矛盾/);
  // 嚴格的 now（出遊_一起準備與討論 的體力必須 < 0）：沒寫體力也算矛盾
  assert.match(mut((r) => { const c = card(r, 'hi_trip'); c.choices[0].effects = { 心情: 3 }; c.choices[0].tags = ['出遊_一起準備與討論']; }), /體力 0 和標籤的 now 矛盾/);
  // 多個標籤取聯集：一個說 ≤0、一個說 ≥0 → 都可以
  assert.doesNotMatch(mut((r) => { const c = card(r, 'hi_trip'); c.choices[0].tags = ['出遊_一起準備與討論', '3C當保母']; c.choices[0].effects = { 體力: -3, 耐心: 3 }; }), /hi_trip.*矛盾/);
});

test('每個標籤都要有 now', () => {
  assert.match(mut((r) => { delete r.tags.tags['替他決定'].now; }), /標籤 替他決定：缺少 now/);
  assert.match(mut((r) => { r.tags.tags['替他決定'].now.作業 = '+x'; }), /要由 \+ - 0 組成/);
  assert.match(mut((r) => { r.tags.tags['替他決定'].now.不存在 = '+'; }), /可見數值「不存在」不存在/);
});

test('V2：每張卡要有陷阱選項（劑量表分數比研究支持的選項高 3 以上、隱藏分數卻較低）', () => {
  assert.match(mut((r) => { const c = card(r, 'kid_dress'); for (const ch of c.choices) ch.effects = { 心情: 0, 耐心: -1 }; }), /kid_dress：V2 沒有陷阱選項/);
});

test('V3：研究支持的選項體力＋耐心的花費，要比最省力的選項多 3 以上', () => {
  assert.match(mut((r) => { const c = card(r, 'kid_dress'); for (const ch of c.choices) { ch.effects.耐心 = -1; ch.effects.體力 = 0; } c.choices[1].effects.心情 = 9; }), /kid_dress：V3/);
});

test('休息選項的規則（§11 規則 6）：孩子的事件卡每張最多一個、全部不超過兩成，而且真的要回體力或耐心', () => {
  const rest = '父母自己休息';
  // 每張卡最多一個
  assert.match(mut((r) => { const c = card(r, 'lo_hw'); c.choices[1].tags.push(rest); }), /lo_hw：孩子的事件卡裡「父母自己休息」的選項最多一個/);
  // 全部不超過兩成：把每張卡的第一個選項都加上休息標籤
  assert.match(mut((r) => { for (const c of r.events.cards) if (c.pool !== '父母自己' && !c.choices[0].tags.includes(rest)) { c.choices[0].tags.push(rest); c.choices[0].effects.體力 = 5; c.choices[0].effects.耐心 = 5; } }), /超過 20%/);
  // 要真的回 3 以上
  assert.match(mut((r) => { const c = card(r, 'lo_hw'); c.choices.find((ch) => ch.tags.includes(rest)).effects = { 體力: 1, 耐心: 1 }; }), /父母自己休息的選項，體力＋耐心要真的回 3 以上/);
  // 目前的資料：休息選項的卡佔孩子的事件卡不到兩成
  const { stats } = lintData();
  assert.ok(stats.restCards <= 0.2 * stats.childCards, `${stats.restCards}/${stats.childCards}`);
});

test('寫卡規則 1：選項標籤不能出現透露好壞的副詞（清單在 tags.json 的 cardRules.bannedWords）', () => {
  for (const w of ['好好', '慢慢', '耐心地', '溫柔地', '認真', '然後做到', '冷靜地', '用心', '貼心']) {
    assert.match(mut((r) => { card(r, 'kid_dress').choices[0].label += w; }), new RegExp(`不能用「${w}」`));
  }
  assert.match(mut((r) => { r.tags.cardRules.bannedWords.push('趕時間'); }), /不能用「趕時間」/); // 清單是資料，不是寫死在程式裡
});

test('寫卡規則 2：同一張卡選項長度相近、不能幾乎一樣', () => {
  assert.match(mut((r) => { card(r, 'kid_dress').choices[1].label = '好'.repeat(80); }), /kid_dress：選項長度差太多/);
  assert.match(mut((r) => { const c = card(r, 'kid_dress'); c.choices[1].label = c.choices[0].label + '喔'; }), /kid_dress：選項「.*」與「.*」幾乎一樣/);
  assert.ok(jaccard('蹲下來問他想不想去', '蹲下來問他想不想去喔') >= 0.6);
  assert.ok(jaccard('買手機，先寫好三條規則', '先不買，跟導師談改用聯絡簿') < 0.3);
});

test('寫卡規則 3、4：每張卡 3–5 個選項；有看得到的效果就要有結果文字', () => {
  assert.match(mut((r) => { card(r, 'kid_dress').choices.pop(); card(r, 'kid_dress').choices.pop(); }), /kid_dress：要有 3–5 個選項（現在 2）/);
  assert.match(mut((r) => { const c = card(r, 'kid_dress'); c.choices.push({ ...structuredClone(c.choices[0]), label: '另外再多一個完全不同的做法來試試看吧' }, { ...structuredClone(c.choices[1]), label: '還有一個也不一樣的辦法可以先擱著' }); }), /kid_dress：要有 3–5 個選項（現在 6）/);
  assert.match(mut((r) => { card(r, 'kid_dress').choices[0].result = ''; }), /有看得到的效果就要有結果文字/);
});

test('「父母自己」池：V2／V3／一眼看穿只對這個池豁免，V4b 與 Spearman 仍然適用', () => {
  assert.match(mut((r) => { const c = card(r, 'sf_sleep'); for (const ch of c.choices) ch.tags = ['父母自己休息', '放下手機陪', '先接住情緒']; }), /sf_sleep：V4b/);
  assert.doesNotMatch(mut(() => {}), /sf_.*(V2|V3|一眼看穿)/);
  // 同樣的資料放進孩子的池，V2 就會擋下來
  assert.match(mut((r) => { card(r, 'sf_sleep').pool = '日常_國小低'; }), /sf_sleep：V2/);
});

test('V4b：一張卡所有選項平均推動任何隱藏數值，不能超過 ±0.5', () => {
  assert.match(mut((r) => { const c = card(r, 'kid_dress'); c.choices.forEach((ch) => ch.tags.push('先接住情緒')); }), /kid_dress：V4b 所有選項平均推動「溫暖陪伴」/);
});

test('一眼看穿：某個選項在所有隱藏數值上都最好、花費又不高 → 錯誤', () => {
  assert.match(mut((r) => {
    const c = card(r, 'kid_dress');
    c.choices = [
      { label: 'A', effects: { 錢: -1 }, tags: ['放下手機陪', '穩定的日常'], result: '' },
      { label: 'B', effects: { 錢: -1 }, tags: ['沒有下文'], result: '' },
      { label: 'C', effects: { 錢: -1 }, tags: ['說了不算'], result: '' },
      { label: 'D', effects: { 錢: -1 }, tags: ['穩定的日常'], result: '' },
    ];
  }), /A：一眼看穿/);
});

test('具名門檻：不同門檻版本顯示的選項數要一樣；卡片只能用 gates 裡的名字', () => {
  assert.match(mut((r) => { const c = card(r, 'kid_bite'); delete c.choices[1].showIf; }), /kid_bite：具名門檻的不同版本顯示的選項數不一樣/);
  assert.match(mut((r) => { const c = card(r, 'kid_bite'); c.choices[0].showIf = '了解度很高'; }), /不存在的變數「了解度很高」/);
  assert.match(mut((r) => { r.tags.gates.了解度.高 = 'x'; }), /gates\.了解度\.高 要是數字/);
});

test('direction 可以寫 @槽名；槽的每個值都要有 dir；needs 只能是四種陪伴時段', () => {
  assert.match(mut((r) => { card(r, 'lo_news').choices[1].direction = '@不存在的槽'; }), /direction「@不存在的槽」/);
  assert.match(mut((r) => { delete r.slots.slots.營隊[0].dir; }), /direction「@營隊」/);
  assert.match(mut((r) => { card(r, 'lo_hw').choices[0].needs = ['午休']; }), /needs「午休」不是陪伴時段/);
  assert.doesNotMatch(mut(() => {}), /direction|needs/);
});

test('情境負荷與漂移的資料也會被檢查', () => {
  assert.match(mut((r) => { r.pools.loads[0].effects = { 隱藏: 3 }; }), /loads 帳單吃緊：可見數值「隱藏」不存在/);
  assert.match(mut((r) => { r.tags.drift.to.不存在 = { to: 1, rate: 0.1 }; }), /drift：隱藏數值「不存在」不存在/);
});

test('看得到的方向不能預測隱藏好壞（正反都不行）：每張卡的劑量分數 vs 隱藏分數的 Spearman 相關平均要在 ±0.3 內', () => {
  // 把每個選項的看得到的效果設成和隱藏分數完全同向：相關接近 +1
  assert.match(mut((r) => { for (const c of r.events.cards) for (const ch of c.choices) { ch.effects = { 心情: Math.round(hiddenScore(r.tags, ch, c.stages || PLAYED_STAGES) * 4) || 1 }; ch.tags = ch.tags.filter((t) => !r.tags.tags[t].now || !r.tags.tags[t].now.心情); } }), /平均 Spearman 相關/);
  const { stats } = lintData();
  assert.ok(Math.abs(stats.meanCorrelation) <= 0.3, String(stats.meanCorrelation));
});

/* ───── 多檔資料（data/manifest.json） ───── */
import { mergeData } from '../js/engine/dataload.js';
test('分檔：卡片 id 與槽名跨檔重複會被擋下；擴充槽要寫 extends', () => {
  const card = (id) => ({ id, pool: 'x', title: 't', text: 't', choices: [] });
  const m = { events: ['a', 'b'], slots: ['s1', 's2'] };
  const ok = mergeData(m, { a: { cards: [card('1')] }, b: { cards: [card('2')] }, s1: { slots: { 球: [{ t: 'x' }] } }, s2: { slots: { 球: { extends: true, values: [{ t: 'y' }] } } } });
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.events.cards.length, 2);
  assert.equal(ok.slots.slots.球.length, 2);
  const dup = mergeData(m, { a: { cards: [card('1')] }, b: { cards: [card('1')] }, s1: { slots: { 球: [{ t: 'x' }] } }, s2: { slots: { 球: [{ t: 'y' }] } } });
  assert.equal(dup.problems.length, 2);
  assert.match(dup.problems.join(), /卡片 id「1」重複/);
  assert.match(dup.problems.join(), /槽名「球」重複/);
  assert.match(mergeData({ slots: ['s2'] }, { s2: { slots: { 球: { extends: true, values: [] } } } }).problems.join(), /extends 但之前沒有/);
});
test('分檔：lint 會回報合併時的問題', () => {
  const raw = structuredClone(loadRaw());
  raw.mergeProblems = ['卡片 id「x」重複：a 與 b'];
  assert.match(lintData(raw).errors.join('\n'), /資料分檔：卡片 id「x」重複/);
});

test('每張卡的相關：|ρ| 超過 0.8 的卡不能超過 10%（cardRules.perCard）；超過時 lint 報錯並列出最偏的卡', () => {
  const clone2 = () => JSON.parse(JSON.stringify(loadRaw()));
  const { stats } = lintData();
  assert.ok(stats.extremeCards <= Math.floor(0.1 * stats.cards));
  const raw = clone2();
  raw.tags.cardRules.perCard.maxShare = 0; // 收緊門檻：現有資料至少有一張卡不合格時要報錯
  raw.tags.cardRules.perCard.maxAbs = 0.05;
  assert.ok(lintData(raw).errors.some((e) => e.includes('每張卡的相關')));
});

test('工作插播：選項的 chance 若用 ping_big，必須是 p＝0.3 且沒有 mods（和條件環境的「來問重要」同一顆骰子）', () => {
  const raw = JSON.parse(JSON.stringify(loadRaw()));
  const c = raw.events.cards.find((x) => x.id === 'lo_interrupt');
  c.choices[0].chance.p = 0.5;
  assert.ok(lintData(raw).errors.some((e) => e.includes('ping_big')));
});

test('規則 22：tagsIf 新增原本沒有的標籤、同一個 if 又沒有 labelIf 時提醒；有 labelIf 或登記在 variantBehaviorOk 就不提醒；不是錯誤', () => {
  const run = (mutate) => { const raw = JSON.parse(JSON.stringify(loadRaw())); mutate(raw); return lintData(raw); };
  const pick = (raw) => raw.events.cards.find((x) => x.id === 'fx_field_trip').choices[0];
  const hit = (r) => r.warns.some((w) => w.includes('規則 22：fx_field_trip#0'));
  // 隱藏的行為：新增標籤、label 沒變
  const hidden = run((raw) => { const ch = pick(raw); delete ch.labelIf; ch.tagsIf = [{ if: '年級 >= 5', value: ['全部替他做'] }]; });
  assert.ok(hit(hidden));
  assert.deepEqual(hidden.errors, []); // 只是提醒，不擋
  // 同一個 if 有 labelIf：做法看得到，不提醒
  assert.ok(!hit(run((raw) => { const ch = pick(raw); ch.labelIf = [{ if: '年級 >= 5', value: '一早做便當，行程單和零用錢也替{他}收進書包' }]; ch.tagsIf = [{ if: '年級 >= 5', value: ['全部替他做'] }]; })));
  // 登記在 variantBehaviorOk：不提醒
  assert.ok(!hit(run((raw) => { const ch = pick(raw); delete ch.labelIf; ch.tagsIf = [{ if: '年級 >= 5', value: ['全部替他做'] }]; raw.tags.cardRules.variantBehaviorOk.push('fx_field_trip#0'); })));
  // 標籤沒有新增（只是拿掉）：不提醒
  assert.ok(!hit(run((raw) => { const ch = pick(raw); delete ch.labelIf; ch.tagsIf = [{ if: '年級 >= 5', value: [ch.tags[0]] }]; })));
  // 現有資料的登記項目都指向真的存在的卡與選項
  const raw = loadRaw();
  for (const key of raw.tags.cardRules.variantBehaviorOk) {
    const [id, i] = key.split('#');
    assert.ok(raw.events.cards.find((x) => x.id === id)?.choices[Number(i)], `variantBehaviorOk「${key}」找不到`);
  }
});

/* ───── A2.5 審查 Issue 5、6：scale 宣告與靜態上限的單位 ───── */
test('規則 24：once 的卡與國中、高中、離家的卡要明寫 scale；離家一定是 false；scale 只能是布林', () => {
  const dropScale = (id) => mut((r) => { delete card(r, id).scale; });
  assert.match(dropScale('hi_phone'), /hi_phone：一次性（once）的卡要明寫 scale/);
  assert.match(dropScale('sh_scooter'), /sh_scooter：國中、高中、離家的卡要明寫 scale/);
  assert.match(dropScale('jh_sleep'), /jh_sleep：國中、高中、離家的卡要明寫 scale/);
  assert.match(mut((r) => { card(r, 'fx_leave_day').scale = true; }), /fx_leave_day：離家的卡要寫 scale:false/);
  assert.match(mut((r) => { card(r, 'hi_phone').scale = 'yes'; }), /scale 要是 true 或 false/);
  assert.doesNotMatch(mut((r) => { card(r, 'hi_phone').scale = true; card(r, 'cm_hospital').scale = false; }), /scale/); // true 與 false 都合法
});

test('規則 25：followUp 會排回自己的卡不可以 scale:true（除非寫 kMax 或 paceMonths）；paceMonths 只給循環卡用', () => {
  const loops = ['hl_braces_upkeep', 'hl_myopia_daily', 'sn_med_daily'];
  for (const id of loops) {
    assert.match(mut((r) => { card(r, id).scale = true; delete card(r, id).paceMonths; }), new RegExp(`${id}：規則 25`));
    assert.match(mut((r) => { delete card(r, id).scale; delete card(r, id).paceMonths; }), new RegExp(`${id}：規則 25`));
    assert.doesNotMatch(mut((r) => { card(r, id).scale = true; delete card(r, id).paceMonths; card(r, id).kMax = 1.5; }), /規則 25/); // 明寫倍率上限也行
    assert.doesNotMatch(mut((r) => { card(r, id).scale = false; delete card(r, id).paceMonths; }), /規則 25/);
  }
  assert.match(mut((r) => { card(r, 'hi_phone').paceMonths = 4; }), /hi_phone：paceMonths 要是正數，而且只給自己排後續卡給自己的卡用/);
  assert.match(mut((r) => { card(r, 'hl_braces_upkeep').kMax = 0; }), /kMax 要是正數/);
  // 兩張卡互相排對方（A→B→A）也算繞回自己
  assert.match(mut((r) => { const a = card(r, 'hi_phone'); a.scale = true; a.choices[0].followUp = [{ card: 'cm_hospital', afterMonths: [2, 3] }]; card(r, 'cm_hospital').choices[0].followUp = [{ card: 'hi_phone', afterMonths: [2, 3] }]; }), /hi_phone：規則 25/);
});

test('靜態上限用『參考劑量』的名義值比較（不乘劑量倍率）：把一張 scale:true 的高中卡放大 3 倍不會讓它超過上限，而名義值超過就會', () => {
  const raw = loadRaw();
  const r1 = lintData(raw); assert.deepEqual(r1.errors, []);
  assert.ok(r1.stats.model.stageK['高中'] >= 3); // 高中 5–7 個月一回合，倍率 2.5–3.5（整條時間軸，含預覽階段）
  assert.equal(r1.stats.model.stageK['離家'], 0.5);
  assert.ok(r1.stats.model.stageK['國小中高'] === 1.5);
  const bad = structuredClone(raw);
  bad.model.influenceCaps.perChoiceStatic.親子 = 1; // 把上限壓到 1：每張有親子影響的卡都該被擋下
  assert.match(lintData(bad).errors.join('\n'), /對「親子」軸的名義影響/);
});
