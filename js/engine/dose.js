// 劑量表（DESIGN §3.5）的 view-model：只含「看得到的」數值，用 ▲▼ 與長條，不給精確數字。
// 隱藏數值不會出現在這裡的任何欄位；tests/dose.test.mjs 會檢查輸出不含任何隱藏數值的名稱。
import { PARENT_KEYS, CHILD_KEYS } from './state.js';

/** 這個數值往上是不是壞事 */
export const BAD_WHEN_UP = new Set(['3C時間']);
export const LABEL = { 體力: '體力', 耐心: '耐心', 錢: '錢', 工作表現: '工作表現', 夫妻關係: '夫妻關係', 心情: '心情', 成績: '成績', 作業: '作業', '3C時間': '3C 時間', 睡眠: '睡眠', 同學往來: '同學往來' };

/** 學前沒有成績與作業；沒有另一半（離異、喪親）時不顯示夫妻關係 */
export function visibleKeys(st, stage) {
  const school = stage !== '嬰幼兒' && stage !== '幼兒園';
  const parent = PARENT_KEYS.filter((k) => k !== '夫妻關係' || st.family.partner.present);
  const child = CHILD_KEYS.filter((k) => school || (k !== '成績' && k !== '作業'));
  return { parent, child: stage === '嬰幼兒' ? child.filter((k) => k !== '同學往來') : child };
}

export const emptyAcc = () => ({});

/** 變化量 → 1–3 格（不到 1 點的變化不顯示） */
export const levelOf = (d) => { const a = Math.abs(d); return a >= 9 ? 3 : a >= 4 ? 2 : a >= 1 ? 1 : 0; };

/**
 * 劑量表：acc 是這個回合「選項本身想要造成」的變化（intended delta），不是夾在 0–100 之後的實際差。
 * 例：錢已經是 0，選了錢 −6 的選項，劑量表照樣顯示「錢▼」——玩家看到的是這件事的代價，不是剩餘的空間。
 */
/** 這個回合涵蓋的月數 → 劑量表的時間標籤。3 個月＝這一季，5–7 個月＝這半年（其他長度 4 個月以上沿用月數）；1–2 個月不標，維持原本的樣子 */
export function periodLabel(span) {
  if (!span || span < 3) return null;
  if (span === 3) return '這一季';
  if (span >= 5 && span <= 7) return '這半年';
  return `這 ${span} 個月`;
}

export function doseView(acc, st, stage, span) {
  const vk = visibleKeys(st, stage);
  const row = (k) => {
    const d = acc[k] || 0;
    const level = levelOf(d);
    if (!level) return null;
    const dir = d > 0 ? 1 : -1;
    return { key: k, label: LABEL[k], dir, level, good: BAD_WHEN_UP.has(k) ? dir < 0 : dir > 0 };
  };
  return { parent: vk.parent.map(row).filter(Boolean), child: vk.child.map(row).filter(Boolean), period: periodLabel(span) };
}

const word = (k, v) => {
  if (k === '3C時間') return v < 20 ? '很少' : v < 45 ? '適中' : v < 70 ? '偏多' : '很多';
  return v >= 75 ? '很好' : v >= 55 ? '不錯' : v >= 38 ? '普通' : v >= 22 ? '有點低' : '很低';
};
/** 目前的數值條（長條 + 一個字，沒有精確數字） */
export function meterView(st, stage) {
  const vk = visibleKeys(st, stage);
  const mk = (k, src) => ({ key: k, label: LABEL[k], pct: Math.round(Math.max(0, Math.min(100, src[k])) / 5) * 5, word: word(k, src[k]), warn: BAD_WHEN_UP.has(k) ? src[k] >= 70 : src[k] < 22 });
  return { parent: vk.parent.map((k) => mk(k, st.parent)), child: vk.child.map((k) => mk(k, st.child)) };
}
