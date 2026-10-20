import { outcomeWeights } from '../js/engine/model.js';
import { readFileSync } from 'node:fs';
import { playedStages } from '../js/engine/turn.js';
// 卡片選項的「可見分數」與「隱藏分數」（資料檢查與策略機器人共用）。
// 可見分數＝劑量表上看起來多好；隱藏分數＝標籤對照表（未含情境調整）累積起來多好。兩者拉開，就是 DESIGN §3.6 要的「陷阱」。
export const VISIBLE_KEYS = ['體力', '耐心', '錢', '工作表現', '夫妻關係', '心情', '成績', '作業', '3C時間', '睡眠', '同學往來'];
export const GOOD_CHILD = { 心情: 1, 成績: 1, 作業: 1, 睡眠: 1, 同學往來: 1, '3C時間': -1 };
export const PARENT_W = 0.5;
/** 隱藏數值裡「越高越糟」的 */
export const BAD_WHEN_UP = new Set(['期待壓力', '試探度', '替他做主']);

const cache = new WeakMap();
/** 遊戲目前開放的階段（由日曆的 playableTurns 算出）：沒寫 stages 的卡片出現在這些階段 */
export const PLAYED_STAGES = playedStages(JSON.parse(readFileSync(new URL('../data/calendar.json', import.meta.url), 'utf8')));
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

/** 名次（平手取平均名次） */
const ranks = (a) => {
  const o = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const r = Array(a.length);
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2; i = j + 1; }
  return r;
};
/** Spearman 等級相關（名次的 Pearson）。沒有變化量時回傳 0 */
export function spearman(x, y) {
  const a = ranks(x), b = ranks(y), n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; }
  return sa && sb ? sab / Math.sqrt(sa * sb) : 0;
}
/** 一張卡裡「劑量表分數」和「隱藏分數」的 Spearman 相關：越接近 0，看得到的方向越不能預測長期的好壞（DESIGN §3.6 第二輪修訂） */
export function cardCorrelation(T, card) {
  const stg = card.stages || PLAYED_STAGES;
  return spearman(card.choices.map(doseScore), card.choices.map((ch) => hiddenScore(T, ch, stg)));
}
/** 全部卡片的平均相關（lint 的全域檢查） */
export const CORRELATION_BOUND = JSON.parse(readFileSync(new URL('./design-targets.json', import.meta.url), 'utf8')).calibration['dose-hidden-corr'].absMax; // 範圍寫在 tools/design-targets.json（§3.7 第 5 點）
export function meanCorrelation(T, cards) {
  return cards.reduce((s, c) => s + cardCorrelation(T, c), 0) / cards.length;
}

/**
 * 『綜合幸福』的線性權重（隱藏數值 → 點數）：和終局 wellbeing()（js/engine/ending.js）同一個組合——孩子幸福、父母幸福、彼此之間三項的平均（tools/mech.mjs 也這樣平均），
 * 各項的公式來自 data/model.json 的 outcomes（outcomeWeights）。父母幸福的公式在程式碼裡、輸入是體力與耐心（可見數值，不是標籤換算的隱藏數值），所以標籤換算時它貢獻 0；
 * 其餘兩項各除以 3，單位和終局的幸福分數一致。回傳 { 隱藏數值: 權重 }。
 */
export function compositeWeights(model) {
  const W = outcomeWeights(model), out = {};
  for (const name of ['孩子幸福', '彼此之間']) for (const [k, v] of Object.entries(W[name] || {})) out[k] = (out[k] || 0) + v / 3;
  return out;
}
