// 路線的資料檢查（M3 B4；data/paths.json、卡片的 route、離家三張卡的去向文字、中途離校的鏈）。由 tools/lint-data.mjs 透過 tools/plugins.mjs 載入。
// 規則：
//  1. 學制的 base 加起來是 1；每個學制有 flags，係數用的特徵與組別都存在；
//  2. 去向的機率表：每個學制至少有一個『男女都能去』的去向；入伍 maleOnly；afterDropout 的鍵是中途離校的值；
//  3. 卡片的 route：decide 是 學制 或 去向；prefer 在 prefer 表裡（去向另可寫 auto）；lean 是學制；
//  4. 離家三個回合（日曆 fixed）：每個去向 × 性別 × 經濟 × 住宿 × 成績高低，各回合的卡文字『恰好一個』寫著去向的版本成立，而且是第一個成立的版本（只有入伍限男生）；
//     fx_leave_day 的文字含該去向的標記詞（leaveMarkers）；每個組合至少 3 個看得見的選項、標籤都有字；
//  5. 中途離校的鏈（sh_drop_*）：卡片都在、followUp 的目標在鏈裡、setVars 的中途離校值都在清單裡、全部有 scale；
//  6. 學制的選項（route.decide＝學制）不能有 setFlags 去直接設學制（路線只由 resolveRoute 決定）。
import { newState } from '../../js/engine/state.js';
import { buildCtx, pickText, resolveChoice, choiceState, choiceCtx } from '../../js/engine/events.js';
import { compile } from '../../js/engine/events.js';

export const DROP_VALUES = ['強迫回校', '在家', '找下一步', '輔導中', '回校', '轉學', '職訓', '工作', '實驗教育'];
export const CHAIN = ['sh_drop_signal', 'sh_drop_ask', 'sh_drop_next', 'sh_drop_counsel', 'sh_drop_stay'];
const FEATURES = ['手', '學', '績', '緊', '寬', '離群', '霸凌', '堅', '敏', '主', '承', '低心情'];
const GROUPS = ['興趣', '成績', '經濟', '性情'];

export default function lint({ raw, data, cards }) {
  const errors = [], warns = [];
  const P = raw.events && raw.events.paths;
  if (!P) return { errors: ['缺少 data/paths.json（manifest.extras）'], warns };
  const types = Object.keys(P.schoolTypes), D = P.destinations, dests = D.order;
  // 1
  const sum = types.reduce((a, k) => a + P.schoolTypes[k].base, 0);
  if (Math.abs(sum - 1) > 0.0011) errors.push(`paths：學制的 base 加起來是 ${sum.toFixed(3)}，要是 1`);
  for (const [k, def] of Object.entries(P.schoolTypes)) {
    if (!def.flags || !def.flags.includes(`學制_${k}`)) errors.push(`paths：學制「${k}」的 flags 要包含 學制_${k}`);
    for (const [f, [, g]] of Object.entries(def.coef || {})) { if (!FEATURES.includes(f)) errors.push(`paths：學制「${k}」的係數用了不認得的特徵「${f}」`); if (!GROUPS.includes(g)) errors.push(`paths：學制「${k}」的係數組別「${g}」不存在`); }
  }
  for (const pf of Object.keys(P.prefer).filter((k) => !k.startsWith('_'))) for (const g of Object.keys(P.prefer[pf].mult)) if (!GROUPS.includes(g)) errors.push(`paths：prefer「${pf}」的倍率組別「${g}」不存在`);
  // 2
  for (const d of dests) {
    const def = D[d];
    if (!def) { errors.push(`paths：去向「${d}」沒有定義`); continue; }
    for (const t of Object.keys(def.base || {})) if (!types.includes(t)) errors.push(`paths：去向「${d}」的 base 用了不存在的學制「${t}」`);
    for (const [f, [, g]] of Object.entries(def.coef || {})) { if (!FEATURES.includes(f)) errors.push(`paths：去向「${d}」的係數用了不認得的特徵「${f}」`); if (!GROUPS.includes(g)) errors.push(`paths：去向「${d}」的係數組別「${g}」不存在`); }
  }
  if (!D.入伍 || !D.入伍.maleOnly) errors.push('paths：入伍要有 maleOnly:true（女生不會有這個去向）');
  for (const t of types) if (!dests.some((d) => !D[d].maleOnly && (D[d].base || {})[t] > 0)) errors.push(`paths：學制「${t}」沒有任何男女都能去的去向`);
  for (const k of Object.keys(P.afterDropout).filter((x) => !x.startsWith('_'))) if (!DROP_VALUES.includes(k)) errors.push(`paths：afterDropout 的鍵「${k}」不是中途離校的值`);
  // 3
  const routeCards = [];
  for (const c of cards) for (const ch of c.choices || []) if (ch.route) {
    routeCards.push(c.id);
    const r = ch.route, W = `卡片 ${c.id}／${ch.label}`;
    if (!['學制', '去向'].includes(r.decide)) errors.push(`${W}：route.decide 要是 學制 或 去向`);
    const prefs = Object.keys(P.prefer).filter((k) => !k.startsWith('_'));
    if (!(prefs.includes(r.prefer) || (r.decide === '去向' && r.prefer === 'auto'))) errors.push(`${W}：route.prefer「${r.prefer}」不在 ${prefs.join('、')}${r.decide === '去向' ? '、auto' : ''}`);
    if (r.lean && !types.includes(r.lean)) errors.push(`${W}：route.lean「${r.lean}」不是學制`);
    if (r.decide === '學制' && (ch.setFlags || []).some((f) => /^學制_/.test(f))) errors.push(`${W}：route 的選項不能再用 setFlags 直接設學制（只由 resolveRoute 決定）`);
  }
  if (!routeCards.includes('fx_choose_hs')) errors.push('paths：fx_choose_hs 的選項沒有 route');
  for (const id of ['fx_sh_grad', 'fx_sh_grad_out']) { const c = cards.find((x) => x.id === id); if (!c) errors.push(`paths：缺少卡片 ${id}`); else if (!c.choices.every((ch) => ch.route && ch.route.decide === '去向')) errors.push(`paths：${id} 的每個選項都要有 route:{decide:'去向'}（每一局都要在離家前決定去向）`); }
  // 4 離家三個回合
  const legs = data.timeline.filter((t) => t.stage === '離家');
  if (legs.length !== 3) errors.push(`paths：離家應有 3 個回合（現在 ${legs.length}）`);
  const mention = (e) => /去向/.test(e || '');
  for (const tl of legs) {
    const card = data.cardIndex[tl.fixed[0]];
    if (!card) { errors.push(`paths：離家第 ${tl.turn} 回合沒有固定卡`); continue; }
    if (tl.fixed.length !== 1) errors.push(`paths：離家第 ${tl.turn} 回合要恰好一張固定卡（現在 ${tl.fixed.length}）`);
    const bad = new Set();
    for (const sex of ['男', '女']) for (const d of dests) for (const econ of ['寬裕', '小康', '吃緊']) for (const where of ['外地', '本地']) for (const grade of [70, 40]) {
      if (sex === '女' && D[d].maleOnly) continue;
      const st = newState(1, data, {});
      st.family.child.sex = sex; st.family.child.pronoun = sex === '男' ? '他' : '她'; st.family.econ = econ;
      st.vars.去向 = d; st.flags[`去向_${d}`] = true; st.flags[`住宿_${where}`] = true; st.child.成績 = grade; st.vars.學制 = d === '五專續讀' ? '五專' : '普高';
      const ctx = buildCtx(st, tl);
      const hits = (card.textIf || []).filter((t) => compile(t.if)(ctx));
      const withDest = hits.filter((t) => mention(t.if));
      const first = hits[0];
      const key = `${card.id}｜${d}`;
      if (withDest.length !== 1 || first !== withDest[0]) bad.add(`${key}（${sex}、${econ}、住宿${where}、成績${grade}）：寫著去向的版本成立 ${withDest.length} 個${first && !mention(first.if) ? '，而且第一個成立的版本沒有寫去向' : ''}`);
      if (card.id === 'fx_leave_day' && withDest.length === 1) { const ms = P.leaveMarkers[d] || []; if (!ms.some((w) => withDest[0].text.includes(w))) bad.add(`${key}：離家那一天的文字沒有任何標記詞（${ms.join('、')}）`); }
      const text = pickText(card, ctx, st);
      if (!text) bad.add(`${key}：文字是空的`);
      const vis = card.choices.map((ch) => { const cc = choiceCtx(st, tl, card, ch); const r = resolveChoice(ch, cc); return { r, s: choiceState(ch, cc) }; }).filter((x) => !x.s.hidden);
      if (vis.length < 3) bad.add(`${key}（${sex}、${econ}）：看得見的選項只有 ${vis.length} 個，至少要 3 個`);
      if (vis.some((x) => !String(x.r.label || '').trim() || !String(x.r.result || '').trim())) bad.add(`${key}：有選項的標籤或結果文字是空的`);
    }
    for (const b of bad) errors.push(`路線：${b}`);
  }
  // 5 鏈
  for (const id of CHAIN) { const c = cards.find((x) => x.id === id); if (!c) { errors.push(`路線：缺少中途離校的卡 ${id}`); continue; } if (c.scale !== false) errors.push(`路線：${id} 要明寫 scale:false`); if (!(c.stages || []).includes('高中')) errors.push(`路線：${id} 要在高中`); }
  for (const c of cards.filter((x) => CHAIN.includes(x.id))) for (const ch of c.choices) for (const b of [ch, ...(ch.chance ? [ch.chance.win, ch.chance.lose] : [])]) {
    for (const f of b.followUp || []) if (!CHAIN.includes(f.card)) errors.push(`路線：${c.id} 的 followUp「${f.card}」不在鏈裡`);
    const v = (b.setVars || {}).中途離校; if (v !== undefined && !DROP_VALUES.includes(v)) errors.push(`路線：${c.id} 設了不認得的中途離校值「${v}」`);
    const sv = (b.setVars || {}).學制; if (sv !== undefined && !types.includes(sv)) errors.push(`路線：${c.id} 設了不認得的學制「${sv}」`);
  }
  const sig = cards.find((x) => x.id === 'sh_drop_signal');
  if (sig && !/離校骰/.test(sig.requires?.expr || '')) errors.push('路線：sh_drop_signal 要用 離校骰 < 離校機率 才會出現（機率在 paths.json dropout）');
  return { errors, warns };
}
