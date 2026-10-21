// 測試共用的小工具。
import { hiddenWriteAllowed } from '../js/engine/tags.js';

/** 把 st.hidden 換成 Proxy：任何不是 applyTags / driftHidden / recomputeDerived 裡發生的寫入或刪除，都會丟錯 */
export function guardHidden(st) {
  const bad = (what, k) => { throw new Error(`隱藏數值只能由 tags.js 寫入：${what} ${String(k)}`); };
  st.hidden = new Proxy(st.hidden, {
    set(t, k, v) { if (!hiddenWriteAllowed()) bad('set', k); t[k] = v; return true; },
    deleteProperty(t, k) { bad('delete', k); },
    defineProperty(t, k, d) { if (!hiddenWriteAllowed()) bad('define', k); return Reflect.defineProperty(t, k, d); },
  });
  return st;
}

