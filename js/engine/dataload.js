// 多檔資料的合併（網頁 js/main.js 與 Node tools/data-node.mjs 共用）。純函式、無 DOM。
// data/manifest.json 列出事件檔與槽檔；卡片 id 與槽名跨檔必須唯一。
// 槽檔若要擴充別處定義過的槽，必須寫成 { "extends": true, "values": [...] }，否則視為重複定義。
// 之後新增的池（例如依職位的「工作插播」）只要加事件檔、在 pools.json 加池名；新的槽（{工作插播}、{孩子來問}）只要加槽檔。
export function mergeData(manifest, files) {
  const problems = [];
  const cards = [], seen = new Map();
  for (const f of manifest.events || []) {
    const j = files[f];
    if (!j || !Array.isArray(j.cards)) { problems.push(`事件檔 ${f}：缺少 cards 陣列`); continue; }
    for (const c of j.cards) {
      if (seen.has(c.id)) { problems.push(`卡片 id「${c.id}」重複：${seen.get(c.id)} 與 ${f}`); continue; }
      seen.set(c.id, f);
      cards.push(c);
    }
  }
  const slots = {}, defined = new Map();
  for (const f of manifest.slots || []) {
    const j = files[f];
    if (!j || !j.slots || typeof j.slots !== 'object') { problems.push(`槽檔 ${f}：缺少 slots`); continue; }
    for (const [name, v] of Object.entries(j.slots)) {
      const ext = v && !Array.isArray(v) && v.extends === true;
      const vals = ext ? v.values : v;
      if (!Array.isArray(vals)) { problems.push(`槽 ${name}（${f}）：值要是陣列（或 { extends: true, values: [...] }）`); continue; }
      if (ext) {
        if (!slots[name]) problems.push(`槽 ${name}（${f}）：extends 但之前沒有任何檔定義它`);
        else slots[name].push(...vals);
        if (!slots[name]) slots[name] = [...vals];
      } else if (slots[name]) {
        problems.push(`槽名「${name}」重複：${defined.get(name)} 與 ${f}（要擴充請寫 extends: true）`);
      } else { slots[name] = [...vals]; defined.set(name, f); }
    }
  }
  return { events: { cards }, slots: { slots }, problems };
}
export const manifestFiles = (m) => [...(m.events || []), ...(m.slots || [])];
