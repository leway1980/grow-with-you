// 資料對齊檢查：事件、標籤、變數槽、日曆、池之間有沒有「寫了沒人讀、讀了沒人寫」，以及選項寫法的規則。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) tools/lint-data.mjs 的作法（條件檢查、槽檢查、旗標對讀寫），規則改為親子遊戲的：
// 每個選項要有 ≥1 個可見效果與 ≥1 個標籤、選項不能有 hidden、標籤必須在詞彙表、不能寫教養風格宣告。
// 用法：node tools/lint-data.mjs（有錯誤時 exit 1）；tests 也會呼叫 lintData()
import { fileURLToPath } from 'node:url';
import { tokenize, compile, buildCtx, evalCond, gateNames, choiceState, PING_BIG_ID, PING_BIG_P, VARIANT_FIELDS } from '../js/engine/events.js';
import { newState } from '../js/engine/state.js';
import { isGrowthChoice } from '../js/engine/tags.js';
import { FIXED_TOKENS } from '../js/engine/slots.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadRaw, loadData, ROOT } from './data-node.mjs';
import { lintModel } from './lint-model.mjs';
import { lintContent } from './lint-content.mjs';
import { rule11, cardFileMap } from './rule11.mjs';
import { expandVariantCards } from './variants.mjs';
import { fixedShareByStage, VISIBLE_KEYS, BAD_WHEN_UP, PLAYED_STAGES, CORRELATION_BOUND, tagVec, hiddenScore, doseScore, costOf, cardCorrelation, meanCorrelation } from './metrics.mjs';

const STYLE_PHRASES = [/開明/, /民主式/, /權威式/, /威權/, /放任式/, /我是.{0,6}的(父母|爸爸|媽媽)/, /尊重孩子的教養/, /當個.{0,4}的父母/, /採(用)?.{0,3}(式|型)(教養|溝通)/];
const VISIBLE = VISIBLE_KEYS;
const NEEDS = ['晚餐', '睡前', '早晨', '週末'];
/** V4b：一張卡所有選項的標籤合計，每個隱藏數值的平均推動量要落在 ±這個值之內 */
export const V4B_BOUND = 0.5;

const bigrams = (s) => { const a = [...s.replace(/[\s，。、：「」？！,.:]/g, '')]; return new Set(a.slice(0, -1).map((x, i) => x + a[i + 1])); };
/** 字元雙連詞的 Jaccard 相似度（標籤近似重複檢查） */
export function jaccard(a, b) {
  const x = bigrams(a), y = bigrams(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const g of x) if (y.has(g)) n++;
  return n / (x.size + y.size - n);
}
export function lintData(raw = loadRaw()) {
  const errors = [], warns = [], stats0 = {};
  for (const m of raw.mergeProblems || []) errors.push(`資料分檔：${m}`);
  const data = loadData(raw);
  const T = raw.tags;
  const R = T.cardRules;
  const st = newState(1, data, {});
  const ctx = buildCtx(st, data.timeline[0], { topic: '運動' });
  const ctxKeys = new Set(Object.keys(ctx));
  const baseCards = raw.events.cards;
  const cards = [...baseCards, ...expandVariantCards(baseCards)]; // 情境版本（labelIf 等）展開成虛擬卡，跟一般的卡跑同一套規則
  const ids = new Set(baseCards.map((c) => c.id));
  const pools = raw.pools.pools;
  const hiddenKeys = Object.keys(T.hidden);
  const stages = new Set(T.stages);
  const flagSet = new Map(), flagRead = new Map();
  const note = (m, k, w) => { if (!m.has(k)) m.set(k, []); m.get(k).push(w); };
  // 引擎程式裡讀取的旗標（例如 st.flags.育嬰留停）
  const engineSrc = readdirSync(join(ROOT, 'js', 'engine')).map((f) => readFileSync(join(ROOT, 'js', 'engine', f), 'utf8')).join('\n');
  for (const m of engineSrc.matchAll(/flags\.([㐀-鿿A-Za-z0-9_]+)/g)) if (!['every', 'some', 'includes'].includes(m[1])) note(flagRead, m[1], '引擎');

  const checkExpr = (expr, where) => {
    let toks;
    try { toks = tokenize(expr); compile(expr); } catch (e) { errors.push(`${where}：條件寫錯「${expr}」：${e.message}`); return; }
    for (const t of toks) {
      if (t.t === 'var' && !ctxKeys.has(t.v)) errors.push(`${where}：條件用到不存在的變數「${t.v}」`);
      if (t.t === 'flag') note(flagRead, t.v, where);
    }
  };

  // ── 父母的收穫（§7.2b）與標籤自帶的代價 ──
  {
    const G = T.growth || {};
    if (!hiddenKeys.includes('父母的收穫')) errors.push('隱藏數值「父母的收穫」不存在');
    for (const t of T.growthTags || []) {
      if (!T.tags[t]) errors.push(`growthTags：標籤「${t}」不在詞彙表`);
      else if (!(G.joinOnly || []).includes(t) && !(G.tagPhrases || {})[t]) errors.push(`growth.tagPhrases：缺少「${t}」的句子`);
    }
    for (const t of G.joinOnly || []) if (!(T.growthTags || []).includes(t)) errors.push(`growth.joinOnly：「${t}」不在 growthTags`);
    for (const n of G.slots || []) {
      if (!raw.slots.slots[n]) errors.push(`growth.slots：槽「${n}」不存在`);
      if (!(G.phrases || {})[n] || !G.phrases[n].includes('{v}')) errors.push(`growth.phrases：「${n}」的句子要有 {v}`);
    }
    for (const [t, c] of Object.entries(T.tagCosts || {})) {
      if (!T.tags[t]) errors.push(`tagCosts：標籤「${t}」不在詞彙表`);
      for (const [k, d] of Object.entries(c)) { if (!VISIBLE.includes(k)) errors.push(`tagCosts.${t}：可見數值「${k}」不存在`); if (typeof d !== 'number') errors.push(`tagCosts.${t}.${k} 要是數字`); }
    }
  }

  // ── 標籤詞彙表 ──
  for (const [name, def] of Object.entries(T.tags)) {
    for (const k of Object.keys(def.d || {})) {
      if (!hiddenKeys.includes(k)) errors.push(`標籤 ${name}：隱藏數值「${k}」不存在`);
      if (T.derived.includes(k)) errors.push(`標籤 ${name}：「${k}」是推算出來的，不能直接由標籤改變`);
    }
    for (const k of Object.keys(def.stage || {})) if (!stages.has(k)) errors.push(`標籤 ${name}：階段「${k}」不在 stages`);
    if (!def.now || typeof def.now !== 'object') errors.push(`標籤 ${name}：缺少 now（當下看得到的方向，DESIGN §3.6）`);
    for (const [k, v] of Object.entries(def.now || {})) {
      if (!VISIBLE.includes(k)) errors.push(`標籤 ${name}：now 的可見數值「${k}」不存在`);
      if (!/^[+\-0]{1,3}$/.test(v)) errors.push(`標籤 ${name}：now.${k} 要由 + - 0 組成，不是「${v}」`);
    }
    for (const k of def.dirAccel || []) if (!hiddenKeys.includes(k)) errors.push(`標籤 ${name}：dirAccel「${k}」不存在`);
    if (def.dirAccel && def.dir == null) errors.push(`標籤 ${name}：有 dirAccel 但沒有 dir`);
    if (def.accel !== undefined && typeof def.accel !== 'boolean') errors.push(`標籤 ${name}：accel 要是 true/false`);
  }
  for (const [k, m] of Object.entries(T.gates || {})) { if (!hiddenKeys.includes(k)) errors.push(`gates：隱藏數值「${k}」不存在`); for (const [n, v] of Object.entries(m)) if (typeof v !== 'number') errors.push(`gates.${k}.${n} 要是數字`); }
  for (const k of Object.keys(T.drift?.to || {})) if (!hiddenKeys.includes(k)) errors.push(`drift：隱藏數值「${k}」不存在`);
  for (const k of Object.keys(T.slotCost || {})) if (!NEEDS.includes(k) && k[0] !== '_') errors.push(`slotCost：時段「${k}」不認得`);
  T.modifiers.forEach((m, i) => { checkExpr(m.if, `標籤 modifier #${i}`); for (const t of m.tags) if (!T.tags[t]) errors.push(`標籤 modifier #${i}：標籤「${t}」不存在`); });
  T.startAdjust.forEach((r, i) => { checkExpr(r.if, `startAdjust #${i}`); for (const k of Object.keys(r.d)) if (!hiddenKeys.includes(k)) errors.push(`startAdjust #${i}：「${k}」不存在`); });

  (T.costMods || []).forEach((m, i) => { if (m.if) checkExpr(m.if, `costMods #${i}`); for (const t of m.tags || []) if (!T.tags[t]) errors.push(`costMods #${i}：標籤「${t}」不存在`); for (const k of m.keys || []) if (!VISIBLE.includes(k)) errors.push(`costMods #${i}：「${k}」不是可見數值`); if (!(m.x > 0)) errors.push(`costMods #${i}：x 要大於 0`); });
  // ── 變數槽 ──
  const slots = raw.slots.slots;
  const slotTokens = (t) => [...String(t || '').matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]);
  const checkTokens = (text, where) => { // 標題、內文、選項與結果共用同一組槽值（同一張卡同一個槽只抽一次）
    for (const n of slotTokens(text)) if (!FIXED_TOKENS.includes(n) && !slots[n]) errors.push(`${where}：用到不存在的槽 {${n}}`);
  };
  for (const [name, vals] of Object.entries(slots)) {
    if (!vals.some((v) => !v.if)) errors.push(`槽 ${name}：沒有無條件的值`);
    for (const v of vals) {
      if (v.if) checkExpr(v.if, `槽 ${name}／${v.t}`);
      checkTokens(v.t, `槽 ${name}／${v.t}`);
      for (const [k, x] of Object.entries(v.set || {})) {
        if (!slots[k]) errors.push(`槽 ${name}／${v.t}：set 指到不存在的槽「${k}」`);
        else if (!slots[k].some((y) => y.t === x)) errors.push(`槽 ${name}／${v.t}：set 的值「${x}」不在槽「${k}」裡`);
      }
    }
  }
  const visit = (n, path) => {
    if (path.includes(n)) { errors.push(`槽 ${[...path, n].join(' → ')}：巢狀成圈`); return; }
    for (const v of slots[n] || []) for (const m of slotTokens(v.t)) if (slots[m]) visit(m, [...path, n]);
  };
  for (const n of Object.keys(slots)) visit(n, []);

  // ── 日曆 ──
  if (data.timeline.length !== raw.calendar.totalTurns) errors.push('日曆回合數不等於 totalTurns');
  for (const f of raw.calendar.fixed) if (!ids.has(f.event)) errors.push(`日曆 fixed：事件「${f.event}」不存在`);
  for (const f of raw.calendar.schoolFixed) if (!ids.has(f.event)) errors.push(`日曆 schoolFixed：事件「${f.event}」不存在`);
  for (const s of raw.calendar.stages) if (!stages.has(s.id)) errors.push(`日曆階段「${s.id}」不在 tags.json 的 stages`);

  // ── 節奏：每個階段有固定事件的回合比例（design-targets.json 的 rhythm.fixedShareMax）──
  {
    const share = fixedShareByStage(data.timeline), R = JSON.parse(readFileSync(join(ROOT, 'tools', 'design-targets.json'), 'utf8')).rhythm;
    for (const [stage, max] of Object.entries((R && R.fixedShareMax) || {})) {
      const o = share[stage];
      if (o && o.share > max + 1e-9) errors.push(`日曆節奏：${stage} 有 ${o.fixed}/${o.turns}＝${(o.share * 100).toFixed(0)}% 的回合有固定事件，超過上限 ${max * 100}%`);
    }
  }

  // ── 情境負荷 ──
  for (const L of raw.pools.loads || []) {
    if (L.if) checkExpr(L.if, `loads ${L.id}`);
    for (const k of Object.keys(L.effects || {})) if (!VISIBLE.includes(k)) errors.push(`loads ${L.id}：可見數值「${k}」不存在`);
    if (!(L.p > 0 && L.p < 1)) errors.push(`loads ${L.id}：p 要在 0–1 之間`);
    for (const t of L.tags || []) if (!T.tags[t]) errors.push(`loads ${L.id}：標籤「${t}」不在詞彙表`);
  }
  if (new Set((raw.pools.loads || []).map((l) => l.id)).size !== (raw.pools.loads || []).length) errors.push('loads 的 id 重複');
  // ── 池 ──
  for (const [name, def] of Object.entries(pools)) {
    (def.mods || []).forEach((m) => checkExpr(m.if, `池 ${name}`));
    if (!name.startsWith('_') && !cards.some((c) => c.pool === name)) errors.push(`池「${name}」沒有任何卡`);
  }

  // ── 事件卡 ──
  const leakRe = new RegExp(hiddenKeys.join('|'));
  const allowedChoiceKeys = new Set(['label', 'effects', 'tags', 'result', 'showIf', 'grayIf', 'opens', 'followUp', 'chance', 'setFlags', 'clearFlags', 'setVars', 'incVars', 'direction', 'topic', 'needs', 'labelIf', 'resultIf', 'tagsIf', 'effectsIf', 'toward', 'classroom', 'flagMonths']);
  const allowedCardKeys = new Set(['id', 'pool', 'title', 'text', 'textIf', 'choices', 'weight', 'once', 'cooldownMonths', 'scale', 'requires', 'excludes', 'modifiers', 'stages', 'topic', 'direction', 'approach', 'initiate', 'toward', '_variantOf', '_variantIf']);
  const gateVars = new Set(gateNames());
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8].map((sd) => newState(sd, data, {}));
  const dirSlotOk = (d) => d[0] !== '@' || (slots[d.slice(1)] && slots[d.slice(1)].every((v) => v.dir));
  let restCards = 0;
  const choiceCtxFor = (base, ch, c) => buildCtx(base, data.timeline[0], { topic: ch.topic || c.topic }); // 每張卡＋每個選項自己的 topic
  const dirTags = new Set(Object.entries(T.tags).filter(([, d]) => d.dir != null).map(([k]) => k));
  const exposure = Object.fromEntries(hiddenKeys.map((k) => [k, 0]));
  let nChoices = 0;
  const seen = new Set();
  for (const c of cards) {
    const W = `卡片 ${c.id}`;
    if (seen.has(c.id)) errors.push(`${W}：id 重複`);
    seen.add(c.id);
    for (const k of Object.keys(c)) if (!allowedCardKeys.has(k)) errors.push(`${W}：不認得的欄位「${k}」`);
    if (!pools[c.pool]) errors.push(`${W}：池「${c.pool}」不存在`);
    // 時間單位（A2.5）：冷卻是『月』；scale:false＝一次性的固定事件，劑量不隨回合長度放大
    if ('cooldownMonths' in c && !(Number.isInteger(c.cooldownMonths) && c.cooldownMonths >= 0)) errors.push(`${W}：cooldownMonths 要是 ≥ 0 的整數（月）`);
    if ('scale' in c && typeof c.scale !== 'boolean') errors.push(`${W}：scale 要是 true 或 false（true＝隨回合長度放大的『一段時間的政策』，false＝一次性事件）`);
    // 規則 24（A2.5 審查 Issue 6）：一次性的卡與國中、高中、離家的卡要明寫 scale——單一事件寫 false，設定規矩／安排的卡寫 true；離家（逐月）一律 false，否則 k＝0.5 會把效果減半
    if ((c.once || (c.stages || []).some((x) => ['國中', '高中', '離家'].includes(x))) && !('scale' in c)) errors.push(`${W}：${c.once ? '一次性（once）' : '國中、高中、離家'}的卡要明寫 scale（單一事件 false；設定規矩或安排的政策卡 true）`);
    if ((c.stages || []).includes('離家') && c.scale !== false) errors.push(`${W}：離家的卡要寫 scale:false（逐月回合，不能依回合長度縮放）`);
    if (c.pool.startsWith('_') && c.scale !== false) errors.push(`${W}：固定事件（池 ${c.pool}）是一次性的，要寫 scale:false（劑量不隨回合長度放大）`);
    for (const s of c.stages || []) if (!stages.has(s)) errors.push(`${W}：階段「${s}」不存在`);
    if (c.topic && !(c.topic in st.interest)) errors.push(`${W}：topic「${c.topic}」不是興趣類別`);
    if (c.requires?.expr) checkExpr(c.requires.expr, W);
    if (c.excludes?.expr) checkExpr(c.excludes.expr, W);
    for (const f of c.requires?.flags || []) note(flagRead, f, W);
    for (const f of c.excludes?.flags || []) note(flagRead, f, W);
    for (const m of c.modifiers || []) checkExpr(m.if, W);
    for (const t of c.textIf || []) { checkExpr(t.if, W); checkTokens(t.text, W); if (leakRe.test(t.text)) errors.push(`${W}：文字出現隱藏數值的名稱`); }
    checkTokens(c.text, W); checkTokens(c.title, W + '標題');
    if (leakRe.test(c.text) || leakRe.test(c.title)) errors.push(`${W}：文字出現隱藏數值的名稱`);
    if (!c.choices || c.choices.length < R.minChoices || c.choices.length > R.maxChoices) errors.push(`${W}：要有 ${R.minChoices}–${R.maxChoices} 個選項（現在 ${c.choices ? c.choices.length : 0}）`);
    if (!c.choices) continue;
    // 寫卡規則（DESIGN §11）：標籤長度、近似重複、禁用詞
    {
      const labs = c.choices.map((ch) => String(ch.label || ''));
      const lens = labs.map((l) => [...l].length);
      if (Math.max(...lens) > R.maxLengthRatio * Math.min(...lens)) errors.push(`${W}：選項長度差太多（最長 ${Math.max(...lens)} 字、最短 ${Math.min(...lens)} 字，上限 ${R.maxLengthRatio} 倍）`);
      for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) {
        const sim = jaccard(labs[i], labs[j]);
        if (sim >= R.dupJaccard) errors.push(`${W}：選項「${labs[i].slice(0, 14)}」與「${labs[j].slice(0, 14)}」幾乎一樣（字元雙連詞相似度 ${sim.toFixed(2)} ≥ ${R.dupJaccard}）`);
      }
    }
    if (!(c.choices || []).some((ch) => !ch.showIf && !ch.grayIf)) errors.push(`${W}：沒有任何「一定可選」的選項（不含 showIf 與 grayIf）`);
    const avail = (c.choices || []).filter((ch) => !ch.grayIf).length;
    if (avail < 2) warns.push(`${W}：不會變灰的選項少於 2 個`);
    for (const [chIdx, ch] of (c.choices || []).entries()) {
      if (!c._variantOf) nChoices++;
      const WC = `${W}／${ch.label}`;
      for (const k of Object.keys(ch)) if (!allowedChoiceKeys.has(k)) errors.push(`${WC}：不認得的欄位「${k}」${k === 'hidden' ? '（選項不能寫 hidden，隱藏數值只能由 tags 換算，見 DESIGN §3.6）' : ''}`);
      if ('hidden' in ch) errors.push(`${WC}：選項不能有 hidden`);
      const eff = Object.entries(ch.effects || {});
      if (!eff.some(([, v]) => v !== 0)) errors.push(`${WC}：至少要有 1 個看得到的效果（effects）`);
      else if (!String(ch.result || '').trim()) errors.push(`${WC}：有看得到的效果就要有結果文字（result），劑量表的 ▲▼ 要能從結果文字解釋`);
      for (const w of R.bannedWords) if (String(ch.label || '').includes(w)) errors.push(`${WC}：選項只寫動作，不寫態度——不能用「${w}」（DESIGN §11 寫卡規則 1）`);
      for (const [k] of eff) if (!VISIBLE.includes(k)) errors.push(`${WC}：可見數值「${k}」不存在`);
      if (!ch.tags || !ch.tags.length) errors.push(`${WC}：至少要有 1 個行為標籤`);
      for (const t of ch.tags || []) {
        if (!T.tags[t]) errors.push(`${WC}：標籤「${t}」不在詞彙表`);
        else if (!c._variantOf) for (const k of Object.keys(T.tags[t].d || {})) exposure[k]++;
      }
      if (isGrowthChoice(T, ch.tags) && !c._variantOf) exposure.父母的收穫++;
      if ((ch.tags || []).some((t) => dirTags.has(t)) && !ch.direction) warns.push(`${WC}：用了「轉述消息」類標籤，但沒有 direction`);
      if (ch.direction && !(ch.tags || []).some((t) => dirTags.has(t))) warns.push(`${WC}：有 direction 但沒有轉述消息類標籤`);
      if (ch.topic && !(ch.topic in st.interest)) errors.push(`${WC}：topic「${ch.topic}」不是興趣類別`);
      for (const n of ch.needs || []) if (!NEEDS.includes(n)) errors.push(`${WC}：needs「${n}」不是陪伴時段（${NEEDS.join('、')}）`);
      if (ch.direction && !dirSlotOk(ch.direction)) errors.push(`${WC}：direction「${ch.direction}」指到的槽不存在，或這個槽的值沒有 dir`);
      // 看得到的方向由標籤決定（§3.6 修訂）：effects 的正負號不能和標籤的 now 聯集矛盾
      {
        const lists = {};
        for (const t of ch.tags || []) for (const [k, v] of Object.entries(T.tags[t]?.now || {})) { const set = (lists[k] ||= new Set()); for (const c of v) set.add(c); }
        for (const [k, allowed] of Object.entries(lists)) {
          const e = ch.effects?.[k] || 0;
          const sign = e > 0 ? '+' : e < 0 ? '-' : '0';
          if (!allowed.has(sign)) errors.push(`${WC}：${k} ${e > 0 ? '+' : ''}${e} 和標籤的 now 矛盾（標籤只允許 ${[...allowed].join('')}）`);
        }
      }
      for (const re of STYLE_PHRASES) if (re.test(ch.label || '')) errors.push(`${WC}：選項文字不能是教養風格宣告（${re}）（DESIGN §3、§11）`);
      checkTokens(ch.label, WC + '標籤'); checkTokens(ch.result, WC);
      if (leakRe.test(ch.label || '') || leakRe.test(ch.result || '')) errors.push(`${WC}：文字出現隱藏數值的名稱`);
      if (ch.showIf) checkExpr(ch.showIf, WC);
      // 情境版本：if 要能求值、值要合法；tagsIf 不能換掉有『自帶代價』的標籤（代價在載入時加到 effects，換標籤會對不上）
      if (!c._variantOf) for (const [key, field] of Object.entries(VARIANT_FIELDS)) {
        if (!(key in ch)) continue;
        if (!Array.isArray(ch[key]) || !ch[key].length) { errors.push(`${WC}：${key} 要是非空的 [{if, value}, …]`); continue; }
        ch[key].forEach((v, k) => {
          const WV = `${WC}／${key}[${k}]`;
          if (v.if) checkExpr(v.if, WV); else if (k < ch[key].length - 1) errors.push(`${WV}：沒有 if 的版本只能放最後一個（前面的會一律成立）`);
          if (!('value' in v)) { errors.push(`${WV}：缺少 value`); return; }
          for (const x of Object.keys(v)) if (!['if', 'value'].includes(x)) errors.push(`${WV}：不認得的欄位「${x}」`);
          if (field === 'label' || field === 'result') { checkTokens(v.value, WV); if (leakRe.test(v.value || '')) errors.push(`${WV}：文字出現隱藏數值的名稱`); }
          if (field === 'tags') {
            if (!Array.isArray(v.value) || !v.value.length) errors.push(`${WV}：tags 版本要有至少 1 個標籤`);
            else {
              const cost = (a) => [...new Set((a || []).filter((t) => (T.tagCosts || {})[t]))].sort().join('、');
              if (cost(v.value) !== cost(ch.tags)) errors.push(`${WV}：tagsIf 不能改變有自帶代價的標籤（原本「${cost(ch.tags)}」，版本「${cost(v.value)}」）`);
              // 規則 22：版本新增的標籤若不在原本的標籤裡，而且同一個 if 沒有 labelIf（看得到的做法沒變），提醒：標籤要描述玩家看得到的做法。確認做法沒變的，登記在 cardRules.variantBehaviorOk（"卡id#選項序號"）
              const added = v.value.filter((t) => !(ch.tags || []).includes(t));
              const labelShown = (ch.labelIf || []).some((x) => x.if === v.if);
              const okKey = `${c.id}#${chIdx}`;
              if (added.length && !labelShown && !(R.variantBehaviorOk || []).includes(okKey)) warns.push(`規則 22：${okKey}「${ch.label}」的 tagsIf[${k}]（${v.if || '一律'}）新增標籤「${added.join('、')}」，但同一個 if 沒有 labelIf；確認做法沒變後，把「${okKey}」加進 cardRules.variantBehaviorOk`);
            }
          }
          if (field === 'effects') for (const [kk, vv] of Object.entries(v.value || {})) if (!VISIBLE.includes(kk) || typeof vv !== 'number') errors.push(`${WV}：效果「${kk}」不合法`);
          for (const base of seeds.slice(0, 3)) { try { if (v.if) evalCond(v.if, choiceCtxFor(base, ch, c)); } catch (e) { errors.push(`${WV}：條件求值失敗：${e.message}`); } }
        });
      }
      for (const g of [].concat(ch.grayIf || [])) checkExpr(g.if, WC);
      // 用這張卡＋這個選項自己的 topic 建條件環境，實際算一次（引擎顯示與套用用的是同一個環境）
      for (const base of seeds.slice(0, 3)) {
        const cctx = choiceCtxFor(base, ch, c);
        try { if (ch.showIf) evalCond(ch.showIf, cctx); for (const g of [].concat(ch.grayIf || [])) evalCond(g.if, cctx); } catch (e) { errors.push(`${WC}：條件求值失敗：${e.message}`); }
      }
      const branches = [ch, ...(ch.chance ? [ch.chance.win, ch.chance.lose] : [])];
      if (ch.chance) { for (const b of [ch.chance.win, ch.chance.lose]) for (const t of b.tags || []) if (!T.tags[t]) errors.push(`${WC}：chance 分支的標籤「${t}」不在詞彙表`); }
      if (ch.chance && ch.chance.id === PING_BIG_ID && (ch.chance.p !== PING_BIG_P || (ch.chance.mods || []).length)) errors.push(`${WC}：id＝${PING_BIG_ID} 的 chance 必須是 p＝${PING_BIG_P} 且沒有 mods（和條件環境的「來問重要」同一顆骰子）`);
      if (ch.chance) { (ch.chance.mods || []).forEach((m) => checkExpr(m.if, WC)); if (!(ch.chance.p > 0 && ch.chance.p < 1)) errors.push(`${WC}：chance.p 要在 0–1 之間`); checkTokens(ch.chance.win.result, WC); checkTokens(ch.chance.lose.result, WC); }
      for (const b of branches) {
        for (const [k, v] of Object.entries(b.effects || {})) if (!VISIBLE.includes(k) || typeof v !== 'number') errors.push(`${WC}：分支效果「${k}」不合法`);
        for (const f of b.setFlags || []) note(flagSet, f, WC);
        for (const f of b.clearFlags || []) note(flagRead, f, WC);
        for (const [p, o] of Object.entries(b.opens || {})) {
          if (!pools[p]) errors.push(`${WC}：opens 的池「${p}」不存在`);
          if (!(Number.isInteger(o.months) && o.months > 0) || 'turns' in o) errors.push(`${WC}：opens「${p}」要寫 months（整數月），不能寫 turns`);
        }
        for (const f of b.followUp || []) {
          if (!ids.has(f.card)) errors.push(`${WC}：followUp 的卡「${f.card}」不存在`);
          if (f.if) checkExpr(f.if, WC);
          const am = f.afterMonths;
          if (!(Array.isArray(am) && am.length === 2 && am.every((x) => Number.isInteger(x) && x >= 0) && am[0] <= am[1]) || 'after' in f) errors.push(`${WC}：followUp 要有 afterMonths:[最少月, 最多月]（整數，最少 ≤ 最多），不能寫 after（回合）`);
        }
        for (const k of Object.keys(b.setVars || {})) if (!(k in st.vars)) errors.push(`${WC}：setVars 的「${k}」不存在`);
        for (const k of Object.keys(b.incVars || {})) if (!(k in st.vars)) errors.push(`${WC}：incVars 的「${k}」不存在`);
      }
    }
  }
  // ── 選項組合的校準規則（DESIGN §3.6 修訂版：V2 陷阱、V3 代價、V4 休息與平衡、一眼看穿、門檻的選項數）──
  const mentionsGate = (e) => !!e && tokenize(e).some((t) => t.t === 'var' && gateVars.has(t.v));
  for (const c of cards) {
    const W = `卡片 ${c.id}`;
    const all = c.choices || [];
    if (all.length < 2 || all.some((ch) => !(ch.tags || []).every((t) => T.tags[t]))) continue;
    const stg = c.stages || PLAYED_STAGES;
    // 玩家實際看到的選項組合：有具名門檻的卡，每一種門檻組合各算一個版本（高了解度版、低了解度版……）
    const names = [...new Set(all.flatMap((ch) => [ch.showIf, ...[].concat(ch.grayIf || []).map((g) => g.if)]).filter(Boolean).flatMap((e) => tokenize(e).filter((t) => t.t === 'var' && gateVars.has(t.v)).map((t) => t.v)))];
    const variants = [];
    for (let mask = 0; mask < (1 << names.length); mask++) {
      const vis = all.filter((ch) => {
        if (!ch.showIf || !mentionsGate(ch.showIf)) return true;
        const cctx = choiceCtxFor(seeds[0], ch, c);
        names.forEach((nm, i) => { cctx[nm] = !!(mask & (1 << i)); });
        return evalCond(ch.showIf, cctx);
      });
      variants.push({ tag: names.length ? `（${names.map((nm, i) => (mask & (1 << i) ? nm : '非' + nm)).join('、')}）` : '', chs: vis });
    }
    if (names.length) {
      const counts = new Set(variants.map((v) => v.chs.length));
      if (counts.size > 1) errors.push(`${W}：具名門檻的不同版本顯示的選項數不一樣（${variants.map((v) => v.chs.length).join('、')}）`);
    }
    const restCh = all.filter((ch) => (ch.tags || []).includes(R.restTag));
    if (c.pool !== R.restPool && restCh.length) {
      if (!c._variantOf) restCards++;
      if (restCh.length > 1) errors.push(`${W}：孩子的事件卡裡「${R.restTag}」的選項最多一個（現在 ${restCh.length}）`);
    }
    for (const ch of restCh) if (-costOf(ch) < R.restMinRecover) errors.push(`${W}／${ch.label}：${R.restTag}的選項，體力＋耐心要真的回 ${R.restMinRecover} 以上`);
    for (const { tag, chs } of variants) {
      if (chs.length < 2) continue;
      const W2 = W + tag;
      const hs = chs.map((ch) => hiddenScore(T, ch, stg)), ds = chs.map(doseScore), cs = chs.map(costOf);
      // 研究支持的選項 R＝隱藏分數最高的（平手時取花費較高的）
      let r = 0;
      for (let i = 1; i < chs.length; i++) if (hs[i] > hs[r] + 1e-9 || (Math.abs(hs[i] - hs[r]) <= 1e-9 && cs[i] > cs[r])) r = i;
      const trap = chs.findIndex((_, i) => i !== r && ds[i] >= ds[r] + 3 && hs[i] < hs[r]);
      const ex = (k) => c.pool === R.restPool && (R.restPoolExempt || []).includes(k);
      if (trap < 0 && !ex('V2')) errors.push(`${W2}：V2 沒有陷阱選項（需要劑量表分數比研究支持的選項「${chs[r].label.slice(0, 12)}」高 3 以上、隱藏分數卻較低；劑量 ${ds.map((x) => x.toFixed(1)).join('/')}、隱藏 ${hs.map((x) => x.toFixed(1)).join('/')}）`);
      const minCost = Math.min(...cs);
      if (cs[r] < minCost + 3 && !ex('V3')) errors.push(`${W2}：V3 研究支持的選項體力＋耐心的花費（${cs[r]}）要比最省力的選項（${minCost}）多 3 以上`);
      // V4b：整張卡所有選項平均推動每個隱藏數值的量要接近 0，才不會「這張卡一律往同一邊推」
      const mean = {};
      for (const ch of chs) for (const [k, d] of Object.entries(tagVec(T, ch, stg))) mean[k] = (mean[k] || 0) + d / chs.length;
      for (const [k, m] of Object.entries(mean)) if (Math.abs(m) > V4B_BOUND + 1e-9) errors.push(`${W2}：V4b 所有選項平均推動「${k}」${m > 0 ? '+' : ''}${m.toFixed(2)}，超過 ±${V4B_BOUND}`);
      // 一眼看穿：某個選項在所有隱藏數值上都不輸別人（至少一項較好），而且花費不比別人高
      const vecs = chs.map((ch) => Object.fromEntries(Object.entries(tagVec(T, ch, stg)).filter(([k]) => !T.derived.includes(k)).map(([k, d]) => [k, BAD_WHEN_UP.has(k) ? -d : d])));
      for (let a = 0; a < chs.length; a++) {
        let dominates = true;
        for (let b = 0; b < chs.length && dominates; b++) {
          if (a === b) continue;
          const keys = Object.keys(vecs[a]);
          const ge = keys.every((k) => vecs[a][k] >= vecs[b][k] - 1e-9), gt = keys.some((k) => vecs[a][k] > vecs[b][k] + 1e-9);
          if (!(ge && gt && cs[a] <= cs[b])) dominates = false;
        }
        if (dominates && !ex('一眼看穿')) errors.push(`${W2}／${chs[a].label.slice(0, 16)}：一眼看穿——在所有隱藏數值上都最好，而且花費不比別人高`);
      }
    }
  }
  // 看得到的方向不能預測長期好壞（正反都不行）：每張卡的 Spearman（劑量分數 vs 隱藏分數）平均要在 ±0.3 內
  {
    const rows = cards.filter((c) => c.choices.every((ch) => (ch.tags || []).every((t) => T.tags[t]))).map((c) => [c.id, cardCorrelation(T, c)]);
    const mc = meanCorrelation(T, cards.filter((c) => rows.some(([id]) => id === c.id)));
    if (Math.abs(mc) > CORRELATION_BOUND) errors.push(`劑量表分數與隱藏分數的平均 Spearman 相關是 ${mc.toFixed(2)}，要在 ±${CORRELATION_BOUND} 內（最偏的卡：${[...rows].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 5).map(([id, r]) => `${id} ${r.toFixed(2)}`).join('、')}）`);
    // 每張卡的相關：全域平均會讓 +1 和 −1 互相抵消，所以每張卡也要看。|ρ| 超過 maxAbs 的卡最多占全部的 maxShare
    const PC = R.perCard;
    if (PC) {
      const bad = rows.filter(([, r]) => Math.abs(r) > PC.maxAbs + 1e-9);
      const limit = Math.floor(PC.maxShare * rows.length + 1e-9);
      if (bad.length > limit) errors.push(`每張卡的相關：|ρ| > ${PC.maxAbs} 的卡有 ${bad.length}/${rows.length} 張（${(bad.length / rows.length * 100).toFixed(0)}%），上限 ${PC.maxShare * 100}%（${limit} 張）：${bad.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([id, r]) => `${id} ${r.toFixed(2)}`).join('、')}`);
      stats0.extremeCards = bad.length;
    }
    for (const [id, r] of rows) if (Math.abs(r) >= 0.8) warns.push(`卡片 ${id}：劑量表分數與隱藏分數的相關 ${r.toFixed(2)}，看得到的方向幾乎能預測好壞`);
    stats0.meanCorrelation = mc;
  }
  {
    const childCards = baseCards.filter((c) => c.pool !== R.restPool && !c.pool.startsWith('_')).length + baseCards.filter((c) => c.pool.startsWith('_')).length;
    if (restCards > R.restCardShareMax * childCards + 1e-9) errors.push(`孩子的事件卡裡有「${R.restTag}」選項的有 ${restCards}/${childCards} 張，超過 ${R.restCardShareMax * 100}%（DESIGN §11 寫卡規則 6）`);
    stats0.restCards = restCards; stats0.childCards = childCards;
  }
  for (const [f, w] of flagSet) if (!flagRead.has(f) && !/_(中|落)$/.test(f)) warns.push(`旗標「${f}」有設定（${w[0]}）但沒有任何地方讀取`);
  for (const [f, w] of flagRead) if (!flagSet.has(f)) warns.push(`旗標「${f}」被讀取（${w[0]}）但從來沒有被設定`);
  // 後續池的卡要真的有人打開
  const opened = new Set();
  for (const c of cards) for (const ch of c.choices) for (const b of [ch, ...(ch.chance ? [ch.chance.win, ch.chance.lose] : [])]) for (const p of Object.keys(b.opens || {})) opened.add(p);
  const byFollow = new Set();
  for (const c of cards) for (const ch of c.choices) for (const b of [ch, ...(ch.chance ? [ch.chance.win, ch.chance.lose] : [])]) for (const f of b.followUp || []) { const t = cards.find((x) => x.id === f.card); if (t) byFollow.add(t.pool); }
  for (const [name, def] of Object.entries(pools)) if (def.base === 0 && !name.startsWith('_') && !opened.has(name) && !byFollow.has(name)) warns.push(`池「${name}」base 為 0，但沒有任何選項會打開它`);
  // 參數曝光（靜態）：某隱藏數值被過多選項推動，或幾乎沒有選項推動
  for (const k of hiddenKeys) {
    if (T.derived.includes(k)) continue;
    const share = exposure[k] / nChoices;
    if (share > 0.5) warns.push(`隱藏數值「${k}」被 ${(share * 100).toFixed(0)}% 的選項推動（超過一半），會主導結局`);
    if (exposure[k] === 0) warns.push(`隱藏數值「${k}」沒有任何選項推動，在結局等於擺設`);
  }
  // 因果模型與防呆（DESIGN §3.7）：方向一致、層次、上限、結局句子
  const lm = lintModel(raw, data, cards);
  errors.push(...lm.errors); warns.push(...lm.warns);
  const lc = lintContent(raw, data, cards, ctxKeys, st);
  errors.push(...lc.errors); warns.push(...lc.warns);
  const r11 = rule11(cards, T, cardFileMap());
  if (R.rule11Enforce) errors.push(...r11.errors);
  warns.push(...r11.warns);
  return { errors, warns, rule11: r11, stats: { cards: baseCards.length, variantCards: cards.length - baseCards.length, choices: nChoices, exposure, ...stats0, model: lm.stats } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { errors, warns, stats, rule11: r11 } = lintData();
  for (const e of errors) console.log('✗ ' + e);
  for (const w of warns) console.log('△ ' + w);
  const enforce = loadRaw().tags.cardRules.rule11Enforce;
  console.log(`\n[rule 11 表面對等${enforce ? '（強制，計入錯誤）' : '（尚未強制，不擋 CI）'}] 有研究選項的卡 ${r11.total.cards} 張：研究選項嚴格最長 ${r11.total.strictly}、扣除『非研究只短 1 字內』後違規 ${r11.total.longFail}（${(r11.total.longShare * 100).toFixed(1)}%）、標記詞不對等 ${r11.total.markFail}\n  研究選項『嚴格最短』${r11.total.shortest} 張（${(r11.total.shortestShare * 100).toFixed(1)}%，警告線 ${((loadRaw().tags.cardRules.researchShortestWarn ?? 0.4) * 100).toFixed(0)}%）；陷阱（非研究）『嚴格最長』${r11.total.trapLongest} 張（${(r11.total.trapLongestShare * 100).toFixed(1)}%）`);
  for (const [f, p] of Object.entries(r11.perFile)) console.log(`  ${f}: 卡 ${p.cards}，最長違規 ${(p.longShare * 100).toFixed(0)}%（${p.longFail}），標記詞違規 ${p.markFail}`);
  if (!enforce) { const all = process.argv.includes('--rule11'); const shown = all ? r11.errors : r11.errors.slice(0, 4); for (const e of shown) console.log('⚑ rule 11：' + e); if (shown.length < r11.errors.length) console.log(`⚑ rule 11：…另 ${r11.errors.length - shown.length} 項（node tools/lint-data.mjs --rule11 列全部）`); }
  console.log(`\n${stats.cards} 張卡、${stats.choices} 個選項；錯誤 ${errors.length}、提醒 ${warns.length}`);
  process.exit(errors.length ? 1 : 0);
}
