// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972)，改動：固定代稱換成親子遊戲的 {孩子}{另一半}{寵物名} 等。
// 變數槽：文字裡的 {槽名} 由「池」（data/slots.json）依這個人的狀況抽值。純函式，無 DOM。
// 同一段文字裡同一個槽只抽一次；槽值可以再含 {槽名}（最多巢狀 3 層）；
// 值的 set 會「釘住」另一個槽（例如補習班群 → 時段＝晚上），讓排列組合合理而不是亂抽。
import { pickWeighted, stateRng } from './rng.js';
import { evalCond } from './events.js';

// 舊的固定代稱，由 events.fill 處理，不屬於槽
export const FIXED_TOKENS = ['孩子', '他', '另一半', '寵物名', '學校', '長輩'];
const RE = /\{([^{}]+)\}/g;
let TABLE = {};
const warned = new Set();

export function setSlotData(slots) { TABLE = (slots && slots.slots) || {}; }
export const slotNames = () => Object.keys(TABLE);

/** 回傳這段文字用到的槽名（不含固定代稱） */
export function slotsIn(text) {
  const out = [];
  for (const m of String(text).matchAll(RE)) if (!FIXED_TOKENS.includes(m[1])) out.push(m[1]);
  return out;
}
export const hasSlots = (text) => slotsIn(text).length > 0;

export function slotRng(st) {
  st.slotS ??= ((st.seed ^ 0x7f4a7c15) >>> 0); // 舊存檔沒有這個亂數流
  return stateRng(st, 'slotS');
}

// 抽一個槽的值；pinned 已有就沿用。避免連續用到同一個值（權重 < 1 的後備值不算替代選項）
function resolve(name, st, ctx, r, pinned) {
  if (name in pinned) return pinned[name];
  const vals = TABLE[name];
  if (!vals) {
    if (!warned.has(name)) { warned.add(name); console.warn(`slots: 未知的槽 {${name}}`); }
    return (pinned[name] = '');
  }
  let el = vals.filter((v) => (!v.if || evalCond(v.if, ctx)) && !Object.entries(v.set || {}).some(([k, x]) => k in pinned && pinned[k] !== x));
  if (!el.length) el = vals.filter((v) => !v.if); // 條件都不符：退回無條件的值
  const last = (st.slotLast ||= {})[name];
  const alt = el.filter((v) => v.t !== last);
  if (alt.length && alt.some((v) => (v.w ?? 1) >= 1)) el = alt;
  const v = pickWeighted(r, el, (x) => x.w ?? 1) || el[0];
  st.slotLast[name] = v.t;
  pinned[name] = v.t;
  if (v.dir) pinned['#dir:' + name] = v.dir; // 這個槽值代表的「方向」（營隊、才藝……），供方向計數用（§3.3）
  for (const [k, x] of Object.entries(v.set || {})) if (!(k in pinned)) { pinned[k] = x; st.slotLast[k] = x; }
  return v.t;
}

/** 把 text 裡的 {槽} 全部換成值。pinned 同時是輸入也是輸出（可跨多段文字共用，例如同一張卡的內文與結果）。 */
export function fillSlots(text, st, ctx, r, pinned = {}) {
  if (!text || !text.includes('{')) return text;
  r ||= slotRng(st);
  for (let depth = 0; depth < 4; depth++) {
    const names = slotsIn(text);
    if (!names.length) break;
    if (depth === 3) { text = text.replace(RE, (m, n) => (FIXED_TOKENS.includes(n) ? m : '')); break; } // 巢狀太深：去掉剩下的，不露出原始標記
    for (const n of names) resolve(n, st, ctx, r, pinned);
    text = text.replace(RE, (m, n) => (FIXED_TOKENS.includes(n) ? m : pinned[n]));
  }
  return text;
}
