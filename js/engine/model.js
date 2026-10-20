// 因果圖（data/model.json，DESIGN §3.7）的讀取工具。純函式、無 DOM。
// 方向、權重、上限都只寫在 model.json；tags.js（承受度、規則式漂移）、ending.js（結果軸、幸福、組合門檻）與 lint／測試從這裡取用。

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/** 目前載入的因果圖：prepareData 會設定；結局公式（ending.js）在沒有傳入 data 的呼叫（例如 wellbeing(st)）時用它 */
let current = null;
export const setModel = (M) => { if (M) current = M; };
export const getModel = () => {
  if (!current) throw new Error('因果圖還沒載入（先呼叫 prepareData）');
  return current;
};

/** 邊 id → 邊 */
export const edgeById = (M) => {
  if (!M._byId) Object.defineProperty(M, '_byId', { value: new Map(M.edges.map((e) => [e.id, e])), enumerable: false });
  return M._byId;
};

/** 「標籤｜節點」→ 涵蓋它的邊（標籤到隱藏數值、計數的邊）；同一對只會有一條 */
export function tagEdgeIndex(M) {
  if (!M._tagIdx) {
    const idx = new Map();
    for (const e of M.edges) for (const t of e.fromTags || []) {
      const key = `${t}|${e.to}`;
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(e);
    }
    Object.defineProperty(M, '_tagIdx', { value: idx, enumerable: false });
  }
  return M._tagIdx;
}
/** 某標籤對某隱藏數值的邊（依 d 的正負號挑 + 或 − 那條）；找不到回傳 null */
export function edgeForTagEffect(M, tag, node, d) {
  const list = tagEdgeIndex(M).get(`${tag}|${node}`) || [];
  return list.find((e) => e.sign === (d > 0 ? '+' : '-')) || null;
}

/** 推算值（承受度）：50 + Σ sign×w×(來源−center)，全部從邊讀 */
export function derivedValue(M, name, getter) {
  const D = M.derived[name];
  const byId = edgeById(M);
  let v = D.base;
  for (const id of D.terms) {
    const e = byId.get(id);
    v += (e.sign === '+' ? 1 : -1) * e.w * (getter(e.from) - e.center);
  }
  return clamp(v, D.clamp[0], D.clamp[1]);
}

/** 孩子願不願意開口（0–100）：由兩個計數算出 */
export function opennessFrom(M, spoke, silent) {
  const O = M.openness, byId = edgeById(M);
  return clamp(O.base + byId.get(O.spoke).w * spoke - byId.get(O.silent).w * silent, O.clamp[0], O.clamp[1]);
}

/**
 * 一個結果節點的值。read(item) 回傳該輸入的數值：item 是 outcomes 裡的一項（{from, as, n, ...}）。
 * 平均（mean，權重 m 預設 1，invert 表示 100−x）減掉各個懲罰（over：超過 center 的部分；under：低於 center 的部分）。clamp 0–100。
 */
export function evalOutcome(M, name, read) {
  const O = M.outcomes[name];
  let num = 0, den = 0;
  for (const it of O.mean) { const m = it.m ?? 1; const x = read(it); num += m * (it.invert ? 100 - x : x); den += m; }
  let v = num / den;
  for (const p of O.pen || []) {
    const x = read(p);
    v -= p.w * (p.over != null ? Math.max(0, x - p.over) : Math.max(0, p.under - x));
  }
  return clamp(v, 0, 100);
}

/** 每條結果軸對每個輸入節點的線性權重（點數／點數）：平均的 ±m/Σm；懲罰的 over 為 −w、under 為 +w。給影響上限與單調性檢查用 */
export function outcomeWeights(M) {
  const out = {};
  for (const [name, O] of Object.entries(M.outcomes)) {
    if (!O.mean) continue;
    const w = (out[name] = {});
    const den = O.mean.reduce((a, it) => a + (it.m ?? 1), 0);
    for (const it of O.mean) w[it.from] = (w[it.from] || 0) + (it.invert ? -1 : 1) * (it.m ?? 1) / den;
    for (const p of O.pen || []) w[p.from] = (w[p.from] || 0) + (p.over != null ? -p.w : p.w);
  }
  return out;
}
/** 結果軸（三條）的名稱 */
export const AXES = ['親子', '人際', '學習'];
