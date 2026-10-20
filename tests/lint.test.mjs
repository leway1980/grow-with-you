import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lintData } from '../tools/lint-data.mjs';
import { loadRaw } from '../tools/data-node.mjs';

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

test('V4a：每 5 張卡至少 1 張有「父母自己休息」的選項，而且真的要回體力或耐心', () => {
  assert.match(mut((r) => { for (const c of r.events.cards) c.choices = c.choices.filter((ch) => !ch.tags.includes('父母自己休息')); }), /V4a 有「父母自己休息」選項的卡只有 0\//);
  assert.match(mut((r) => { const c = card(r, 'inf_night'); c.choices.find((ch) => ch.tags.includes('父母自己休息')).effects = { 體力: 1, 耐心: 1 }; }), /父母自己休息的選項，體力＋耐心要真的回 3 以上/);
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
  assert.match(mut((r) => { for (const c of r.events.cards) for (const ch of c.choices) { ch.effects = { 耐心: -((ch.tags.length) * 3) }; } }), /平均 Spearman 相關/);
  const { stats } = lintData();
  assert.ok(Math.abs(stats.meanCorrelation) <= 0.3, String(stats.meanCorrelation));
});
