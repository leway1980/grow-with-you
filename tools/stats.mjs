// 統計小工具（模擬與校準共用）。
export const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return NaN; const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo); };
export const median = (a) => pct(a, 0.5);
export const se = (a) => { const m = avg(a); return Math.sqrt(avg(a.map((x) => (x - m) ** 2)) / Math.max(1, a.length - 1)); };
/** 成對比較：同一批種子下 a 策略減 b 策略的平均與標準誤 */
export function paired(ga, gb, f) { const d = ga.map((g, i) => f(g) - f(gb[i])); return { mean: avg(d), se: se(d) }; }
export const share = (arr, pred) => arr.filter(pred).length / (arr.length || 1);

