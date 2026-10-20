// 卡片選項的「可見分數」與「隱藏分數」（資料檢查與策略機器人共用）。
// 可見分數＝劑量表上看起來多好；隱藏分數＝標籤對照表（未含情境調整）累積起來多好。兩者拉開，就是 DESIGN §3.6 要的「陷阱」。
export const VISIBLE_KEYS = ['體力', '耐心', '錢', '工作表現', '夫妻關係', '心情', '成績', '作業', '3C時間', '睡眠', '同學往來'];
export const GOOD_CHILD = { 心情: 1, 成績: 1, 作業: 1, 睡眠: 1, 同學往來: 1, '3C時間': -1 };
export const PARENT_W = 0.5;
/** 隱藏數值裡「越高越糟」的 */
export const BAD_WHEN_UP = new Set(['期待壓力', '試探度', '替他做主']);

const cache = new WeakMap();
/** 遊戲目前做到的階段（M1）：沒寫 stages 的卡片出現在這些階段 */
export const PLAYED_STAGES = ['嬰幼兒', '幼兒園', '國小低', '國小中高'];
/**
 * 一個選項的標籤合計（不含情境調整）。stages 給了就乘上這些階段的平均倍率：
 * 嬰幼兒的「替他決定」倍率是 0，在只出現在嬰幼兒的卡片上就不該算進去。
 */
export function tagVec(T, ch, stages = null) {
  const key = T.tags;
  let m = cache.get(key);
  if (!m) cache.set(key, (m = new WeakMap()));
  const sk = stages ? stages.join('|') : '';
  let byStage = m.get(ch);
  if (!byStage) m.set(ch, (byStage = new Map()));
  let v = byStage.get(sk);
  if (v) return v;
  v = Object.fromEntries(Object.keys(T.hidden).map((k) => [k, 0]));
  for (const t of ch.tags || []) {
    const def = T.tags[t];
    const mult = stages ? stages.reduce((a, s) => a + (def.stage && s in def.stage ? def.stage[s] : 1), 0) / stages.length : 1;
    for (const [k, d] of Object.entries(def.d || {})) v[k] = (v[k] || 0) + d * mult;
  }
  byStage.set(sk, v);
  return v;
}
/** 隱藏分數：每個隱藏數值往「好」的方向加總（承受度是推算值，不算） */
export function hiddenScore(T, ch, stages = null) {
  const v = tagVec(T, ch, stages);
  let s = 0;
  for (const [k, d] of Object.entries(v)) if (!T.derived.includes(k)) s += BAD_WHEN_UP.has(k) ? -d : d;
  return s;
}
/** 可見分數（doseGreedy 的算法）：孩子的好轉 + 0.5 × 父母的數值變化 */
export function doseScore(ch) {
  let s = 0;
  for (const [k, d] of Object.entries(ch.effects || {})) s += k in GOOD_CHILD ? GOOD_CHILD[k] * d : PARENT_W * d;
  return s;
}
/** 體力＋耐心的花費（越大越累）。父母自己休息會是負的。 */
export const costOf = (ch) => -((ch.effects?.體力 || 0) + (ch.effects?.耐心 || 0));
