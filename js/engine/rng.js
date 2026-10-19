// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972)，原樣複製（純函式、無 DOM）。
// 可存檔的種子亂數。全部是純函式，沒有 DOM、沒有 Math.random。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** 由 (種子, 回合, 標籤) 決定的「命運骰」：和玩家的選擇無關，所以同一個人生的運氣相同。 */
export function rngAt(seed, turn, salt) {
  const s = (seed ^ Math.imul(turn + 1, 0x9e3779b1) ^ hashStr(String(salt))) >>> 0;
  return mulberry32(s)();
}

/** 以 st[key]（一個整數）為狀態的亂數函式；狀態可直接 JSON 存檔。 */
export function stateRng(st, key = 'rngS') {
  return function () {
    st[key] = (st[key] + 0x6d2b79f5) >>> 0;
    let t = st[key];
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const randInt = (r, a, b) => a + Math.floor(r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const gauss = (r) => (r() + r() + r() - 1.5) * 2; // 約 N(0, 1) 的便宜版本，範圍 ±3

export function pickWeighted(r, items, wf = (x) => x.w) {
  let total = 0;
  const ws = items.map((it) => {
    const w = Math.max(0, wf(it));
    total += w;
    return w;
  });
  if (total <= 0) return null;
  let x = r() * total;
  for (let i = 0; i < items.length; i++) {
    x -= ws[i];
    if (x < 0) return items[i];
  }
  return items[items.length - 1];
}

/** 以 {key: weight} 物件抽 key */
export function pickKey(r, obj) {
  const keys = Object.keys(obj);
  return pickWeighted(r, keys, (k) => obj[k]);
}

export const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
