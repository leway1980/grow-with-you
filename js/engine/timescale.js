// 時間尺度（A2.5）：回合不再是固定長度（嬰幼兒 3 個月、幼兒園 3 個月、國小 2–3 個月、離家 1 個月），所以所有『每回合』的量都改成『每月』再換算。
// 不變量：同一個策略，每個月的教養效果一樣（一張卡代表那段時間裡反覆出現的同類時刻），不是同樣的被動軌跡。
// 參考單位：舊的國小回合 = 2 個月。所有寫死的『每回合』數字（A0 的國小值）換成月利率後，2 個月的回合與舊的每回合值完全相同。

/** 舊的國小回合的月數：參考單位 */
export const REF_MONTHS = 2;

/** 以『一個參考回合（2 個月）』為單位的比率 r，換成每月的比率 */
export const monthlyFromRef = (r) => 1 - Math.pow(1 - r, 1 / REF_MONTHS);

/** 每月的回復率 rMonth，在 span 個月的回合裡的回復率：1 − (1 − r)^span */
export const perSpan = (rMonth, span) => 1 - Math.pow(1 - rMonth, span);

/** 以參考回合為單位的比率 r，直接換成 span 個月的回合的比率（寫死在程式裡的舊值用） */
export const refRate = (r, span) => perSpan(monthlyFromRef(r), span);

/** 每月的衰減因子 dMonth（例如 0.985），在 span 個月之後剩下的比例 */
export const decaySpan = (dMonth, span) => Math.pow(dMonth, span);

/**
 * 卡片選擇的劑量倍率：(span / 2)^α。一張卡代表這段時間裡反覆出現的同類時刻，所以回合越長，一張卡的劑量越大；
 * 國小舊的 2 個月回合不變。card.scale === false（一次性的固定事件：運動會、入學、畢業……）不隨回合長度放大。
 */
export function doseScale(alpha, span, card) {
  if (card && card.scale === false) return 1;
  return Math.pow(span / REF_MONTHS, alpha || 0);
}

/** 乘上倍率後的效果表（不改原物件） */
export function scaleEffects(eff, k) {
  if (!eff || k === 1) return eff;
  const out = {};
  for (const [key, d] of Object.entries(eff)) out[key] = d * k;
  return out;
}

/** 第一個 ageMonths ≥ months 的回合序號；ages 是時間軸的月齡陣列；找不到是 ages.length */
export function turnAtOrAfter(ages, months) {
  let lo = 0, hi = ages.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ages[mid] >= months) hi = mid; else lo = mid + 1; }
  return lo;
}
