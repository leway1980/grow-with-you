// 習慣的資料檢查（M3 B2；data/habits.json）。由 tools/lint-data.mjs 透過 tools/plugins.mjs 載入。
// 規則：
//  1. 每個模式的標籤都存在於 tags.json；
//  2. 每個家族在國小低與國小中高至少各有一張帶 habit:<家族> 的卡（偵測要有東西可讀）；
//  3. 每個模式的每個標籤，都出現在某張『帶該家族 habit、階段在 lookback 裡』的卡的某個選項上（含 tagsIf）——
//     規則 18 的例外：自動套用的標籤只能是玩家在這些卡上真的選得到的標籤，資料裡不能列一個選不到的標籤；
//  4. 卡片的 habitPattern 指向存在的家族與模式，而且卡片的 habit 就是那個家族；
//  5. auto:true 的家族：每個模式與 mixed 都有 line；lineIf 只用 親子信任低／親子信任高，高低兩版字數相近（規則 12，比值 ≤ 1.3），
//     而且 line 裡不出現隱藏數值的字眼；
//  6. 國中一年級有一張保證出現的『改變習慣』卡（日曆 fixed 排進去，habitPattern 的家族存在）。
export default function lint({ raw, cards, T }) {
  const errors = [], warns = [];
  const H = raw.habits;
  if (!H) return { errors: ['缺少 data/habits.json'], warns };
  const fams = H.families, LB = H.lookback;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const choiceTags = (ch) => new Set([...(ch.tags || []), ...(ch.tagsIf || []).flatMap((v) => v.value)]);
  const hiddenWords = Object.keys(T.hidden || {});
  for (const [f, fam] of Object.entries(fams)) {
    if (!(fam.minWeight > 0)) errors.push(`習慣「${f}」：minWeight 要大於 0`);
    const fcards = raw.events.cards.filter((c) => c.habit === f);
    for (const st of ['國小低', '國小中高']) if (!fcards.some((c) => (c.stages || []).includes(st))) errors.push(`習慣「${f}」：${st} 沒有任何帶 habit:${f} 的卡`);
    const reach = new Set();
    for (const c of fcards) if ((c.stages || []).some((s) => LB[s])) for (const ch of c.choices) for (const t of choiceTags(ch)) reach.add(t);
    for (const [p, def] of Object.entries(fam.patterns)) {
      if (!def.tags || !def.tags.length) errors.push(`習慣「${f}／${p}」：沒有標籤`);
      for (const t of def.tags || []) {
        if (!T.tags[t]) errors.push(`習慣「${f}／${p}」：標籤「${t}」不存在`);
      }
      if (!(def.tags || []).some((t) => reach.has(t))) errors.push(`習慣「${f}／${p}」：沒有任何標籤能在國小的 habit 卡上選到，這個模式永遠偵測不到（規則 18 的例外只限玩家選過的標籤）`);
      if (fam.auto) {
        if (!def.line) errors.push(`習慣「${f}／${p}」：auto 家族要有 line`);
        checkLines(def, `${f}／${p}`);
      }
    }
    if (fam.auto) {
      if (!(fam.mixed && fam.mixed.line)) errors.push(`習慣「${f}」：auto 家族要有 mixed.line（中性的一句話）`);
      else checkLines(fam.mixed, `${f}／mixed`);
    }
  }
  function checkLines(def, where) {
    for (const v of def.lineIf || []) {
      if (!/^親子信任(高|低)$/.test(v.if)) errors.push(`習慣「${where}」：lineIf 只能用 親子信任高／親子信任低（${v.if}）`);
    }
    const lo = (def.lineIf || []).find((v) => v.if === '親子信任低'), hi = (def.lineIf || []).find((v) => v.if === '親子信任高');
    if ((lo && !hi) || (hi && !lo)) errors.push(`習慣「${where}」：lineIf 要高低成對（規則 12）`);
    if (lo && hi) {
      const a = [...lo.value].length, b = [...hi.value].length;
      if (Math.max(a, b) / Math.min(a, b) > 1.3) errors.push(`習慣「${where}」：高低兩版字數差太多（${a}／${b}，規則 12）`);
      // 規則 22：只換孩子的回應，家長做的事要一樣——兩版都要以 line 的『家長做的事』開頭（逗號前面那一段）
      const act = (def.line.split('，')[0]);
      if (!lo.value.startsWith(act) || !hi.value.startsWith(act)) warns.push(`習慣「${where}」：lineIf 的開頭和 line 的家長做的事不一致（規則 22：版本只能換孩子的回應）`);
    }
    for (const t of [def.line, ...(def.lineIf || []).map((v) => v.value)]) for (const w of hiddenWords) if (w.length >= 3 && String(t || '').includes(w)) errors.push(`習慣「${where}」：一句話裡不能出現隱藏數值的名字「${w}」`);
  }
  for (const c of raw.events.cards) for (const ch of c.choices) {
    if (!ch.habitPattern) continue;
    const { family, pattern } = ch.habitPattern;
    if (!fams[family] || !fams[family].patterns[pattern]) errors.push(`卡片 ${c.id}：habitPattern ${family}／${pattern} 不存在`);
    if (c.habit !== family) errors.push(`卡片 ${c.id}：選項有 habitPattern（${family}），卡片自己要帶 habit:${family}`);
  }
  const fixedIds = (raw.calendar.fixed || []).map((f) => f.event);
  const guaranteed = fixedIds.map((id) => byId.get(id)).find((c) => c && c.choices.some((ch) => ch.habitPattern));
  if (!guaranteed) errors.push('日曆沒有保證出現的『改變習慣』卡（fixed 裡要有一張帶 habitPattern 的卡）');
  else if (!(raw.calendar.fixed.find((f) => f.event === guaranteed.id).at || {}).stage) errors.push(`『改變習慣』卡 ${guaranteed.id} 要用 at:{stage:國中,i} 排在國中`);
  return { errors, warns };
}
