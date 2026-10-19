// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) events.js：條件求值器（逐字複製）與兩段式抽卡、grayIf、textIf、後續卡的做法；
// 改動：移除高中專屬的態度／交往／詐騙邏輯，條件環境改為親子遊戲，新增『池開啟／加重』、選項層級條件（showIf）與機率分支。純函式，無 DOM。
import { pickWeighted, clamp, rngAt } from './rng.js';
import { fillSlots } from './slots.js';
import { familyCtx } from './family.js';
import { applyTags } from './tags.js';
import { snapshot, doseView } from './dose.js';

/* ───────────── 小型條件求值器 ─────────────
   語法：數字、'字串'、變數名(中文可)、#旗標、== != < <= > >=、and or not（也可用 && || !）、括號、true/false */

const cache = new Map();

export function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j++;
      if (j >= src.length) throw new Error('字串沒有結尾: ' + src);
      toks.push({ t: 'str', v: src.slice(i + 1, j) });
      i = j + 1; continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(src[i + 1] || '') && !isValueTok(toks[toks.length - 1]))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      toks.push({ t: 'num', v: parseFloat(src.slice(i, j)) });
      i = j; continue;
    }
    if (c === '#') {
      let j = i + 1;
      while (j < src.length && /[^\s()=!<>&|]/.test(src[j])) j++;
      toks.push({ t: 'flag', v: src.slice(i + 1, j) });
      i = j; continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||'].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('<>!()'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if (/[A-Za-z_㐀-鿿]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_㐀-鿿]/.test(src[j])) j++;
      const w = src.slice(i, j);
      if (w === 'and') toks.push({ t: 'op', v: '&&' });
      else if (w === 'or') toks.push({ t: 'op', v: '||' });
      else if (w === 'not') toks.push({ t: 'op', v: '!' });
      else if (w === 'true') toks.push({ t: 'lit', v: true });
      else if (w === 'false') toks.push({ t: 'lit', v: false });
      else toks.push({ t: 'var', v: w });
      i = j; continue;
    }
    throw new Error(`無法解析條件 "${src}" 在位置 ${i}`);
  }
  return toks;
}
const isValueTok = (t) => t && (t.t === 'num' || t.t === 'str' || t.t === 'var' || t.t === 'flag' || t.t === 'lit' || (t.t === 'op' && t.v === ')'));

function parse(toks) {
  let p = 0;
  const peek = () => toks[p];
  const eat = (v) => { if (peek() && peek().t === 'op' && peek().v === v) { p++; return true; } return false; };
  function orE() {
    let l = andE();
    while (eat('||')) { const a = l, b = andE(); l = (c) => a(c) || b(c); }
    return l;
  }
  function andE() {
    let l = notE();
    while (eat('&&')) { const a = l, b = notE(); l = (c) => a(c) && b(c); }
    return l;
  }
  function notE() {
    if (eat('!')) { const a = notE(); return (c) => !a(c); }
    return cmpE();
  }
  function cmpE() {
    const l = prim();
    const t = peek();
    if (t && t.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      p++;
      const r = prim();
      switch (t.v) {
        case '==': return (c) => l(c) === r(c);
        case '!=': return (c) => l(c) !== r(c);
        case '<': return (c) => num(l(c)) < num(r(c));
        case '<=': return (c) => num(l(c)) <= num(r(c));
        case '>': return (c) => num(l(c)) > num(r(c));
        default: return (c) => num(l(c)) >= num(r(c));
      }
    }
    return l;
  }
  function prim() {
    const t = toks[p++];
    if (!t) throw new Error('條件不完整');
    if (t.t === 'op' && t.v === '(') { const e = orE(); if (!eat(')')) throw new Error('缺少右括號'); return e; }
    if (t.t === 'num' || t.t === 'str' || t.t === 'lit') return () => t.v;
    if (t.t === 'flag') return (c) => !!(c.__flags && c.__flags[t.v]);
    if (t.t === 'var') return (c) => c[t.v];
    throw new Error('意外的符號 ' + t.v);
  }
  const f = orE();
  if (p < toks.length) throw new Error('條件後面有多餘的內容');
  return f;
}
const num = (x) => (typeof x === 'number' ? x : x === undefined || x === null ? NaN : Number(x));

export function compile(expr) {
  let f = cache.get(expr);
  if (!f) { f = parse(tokenize(expr)); cache.set(expr, f); }
  return f;
}
export const evalCond = (expr, ctx) => !!compile(expr)(ctx);

/* ───────────── 條件環境 ───────────── */

/** 孩子對這件事有多想要（隱藏）：0 還沒決定／1 還好／2 很想要。由興趣、堅持度、主見決定（§3.3） */
export function willOf(st, topic) {
  if (!topic || !(topic in st.interest)) return 0;
  const v = st.interest[topic];
  let w = v >= 0.6 ? 2 : v >= 0.42 ? 1 : 0;
  if (st.family.child.temperament.堅持度 >= 4 && w > 0) w = 2;
  if (st.hidden.主見 < 35 && w > 0) w -= 1;
  return w;
}

export function buildCtx(st, tl, extra = {}) {
  const f = st.family, P = st.parent, C = st.child;
  const month = tl.month ?? ((f.child.birthMonth - 1 + Math.floor(tl.ageMonths / 12) * 12 + (tl.ageMonths % 12)) % 12) + 1;
  return {
    __flags: st.flags,
    ...familyCtx(f, st.role),
    ...st.hidden, // 隱藏數值只在引擎內部給條件用（例如選項的門檻）；不會出現在任何畫面
    體力: P.體力, 耐心: P.耐心, 錢: P.錢, 工作表現: P.工作表現, 夫妻關係: P.夫妻關係,
    心情: C.心情, 成績: C.成績, 作業: C.作業, 三C: C['3C時間'], 睡眠: C.睡眠, 同學往來: C.同學往來,
    回合: st.turn, 階段: tl.stage, 年齡: Math.floor(tl.ageMonths / 12), 年級: tl.grade, 假期: !!tl.vacation, 月: month,
    托育方式: st.vars.托育方式, 幼兒園類型: st.vars.幼兒園類型, 照顧者: st.vars.照顧者, 換照顧者次數: st.vars.換照顧者次數,
    意願強度: willOf(st, extra.topic),
  };
}

/* ───────────── 效果（看得見的數值） ───────────── */
const clampV = (x) => clamp(x, 0, 100);
export function applyEffects(st, eff) {
  if (!eff) return;
  for (const [k, d] of Object.entries(eff)) {
    if (k in st.parent) { if (k === '夫妻關係' && !st.family.partner.present) continue; st.parent[k] = clampV(st.parent[k] + d); }
    else if (k in st.child) st.child[k] = clampV(st.child[k] + d);
    else throw new Error('未知的可見數值: ' + k + '（隱藏數值只能經由 tags 改變）');
  }
}

/* ───────────── 抽卡 ───────────── */
export function cardById(data, id) {
  const c = data.cardIndex[id];
  if (!c) throw new Error('找不到事件卡: ' + id);
  return c;
}
export function passes(card, st, ctx) {
  const rq = card.requires, ex = card.excludes;
  if (rq) {
    if (rq.flags && !rq.flags.every((f) => st.flags[f])) return false;
    if (rq.expr && !evalCond(rq.expr, ctx)) return false;
  }
  if (ex) {
    if (ex.flags && ex.flags.some((f) => st.flags[f])) return false;
    if (ex.expr && evalCond(ex.expr, ctx)) return false;
  }
  return true;
}
function eligible(card, st, ctx, tl) {
  if (card.pool.startsWith('_')) return false;
  if (card.stages && !card.stages.includes(tl.stage)) return false;
  if (card.once && st.used[card.id]) return false;
  if ((st.cooldowns[card.id] ?? -1) > st.turn) return false;
  return passes(card, st, ctx);
}
function mulMods(mods, ctx) {
  let x = 1;
  if (mods) for (const m of mods) if (evalCond(m.if, ctx)) x *= m.x;
  return x;
}
export function poolWeight(st, data, name, ctx) {
  const def = data.pools[name] || { base: 3, mods: [] };
  const op = st.openPools[name];
  const open = op && op.until > st.turn;
  return ((def.base ?? 0) + (open ? def.follow ?? 0 : 0)) * mulMods(def.mods, ctx) * (open ? op.x : 1);
}
/** 兩段式抽卡（沿用 47wan）：先抽池（被選項打開或加重的池權重較高），再抽卡。找不到就回傳 null。 */
export function drawCard(st, data, ctx, tl, r) {
  const byPool = {};
  for (const c of data.events.cards) if (eligible(c, st, ctx, tl)) (byPool[c.pool] ||= []).push(c);
  const pools = Object.keys(byPool).map((name) => ({ name, w: poolWeight(st, data, name, ctx) })).filter((p) => p.w > 0);
  const pool = pickWeighted(r, pools);
  if (!pool) return null;
  return pickWeighted(r, byPool[pool.name], (c) => (c.weight ?? 1) * mulMods(c.modifiers, ctx));
}
export function pickFixed(st, data, tl, ctx) {
  for (const id of tl.fixed || []) { const c = data.cardIndex[id]; if (c && passes(c, st, ctx)) return c; }
  return null;
}
export function pickDelayed(st, data, tl, ctx) {
  st.delayed.sort((a, b) => a.due - b.due);
  for (let i = 0; i < st.delayed.length; i++) {
    const d = st.delayed[i];
    if (d.due > st.turn) break;
    const c = data.cardIndex[d.card];
    st.delayed.splice(i, 1);
    if (c && passes(c, st, ctx)) return c;
    i--;
  }
  return null;
}

/* ───────────── 顯示用資料 ───────────── */
export function fill(text, st, ctx, scope) {
  if (text == null) return '';
  if (ctx && text.includes('{')) text = fillSlots(text, st, ctx, null, scope || {});
  const f = st.family;
  return text.replace(/\{孩子\}/g, f.child.given).replace(/\{他\}/g, f.child.pronoun).replace(/\{另一半\}/g, f.partner.present ? '另一半' : '對方')
    .replace(/\{寵物名\}/g, f.pet ? f.pet.name : '').replace(/\{學校\}/g, f.school.name).replace(/\{長輩\}/g, f.elders.who || '長輩');
}
export function pickText(card, ctx, st) {
  for (const t of card.textIf || []) if (ctx && evalCond(t.if, ctx)) return t.text;
  return card.text;
}
// 同一張卡的內文與選擇後的結果共用同一組槽值
export function cardScope(st, cardId) {
  const k = cardId + '@' + st.turn;
  if (!st.cardScope || st.cardScope.k !== k) st.cardScope = { k, v: {} };
  return st.cardScope.v;
}
export function choiceState(ch, ctx) {
  if (ch.showIf && !evalCond(ch.showIf, ctx)) return { hidden: true, disabled: true, reason: '' };
  for (const g of [].concat(ch.grayIf || [])) if (evalCond(g.if, ctx)) return { hidden: false, disabled: true, reason: g.reason };
  return { hidden: false, disabled: false, reason: '' };
}
/** 卡片的顯示資料：只有文字與選項，沒有任何數值、標籤或提示（劑量表在選擇之後才出現）。 */
export function describeCard(card, st, ctx) {
  const scope = cardScope(st, card.id);
  return {
    id: card.id, title: fill(card.title, st, ctx, scope), text: fill(pickText(card, ctx, st), st, ctx, scope),
    choices: card.choices.map((ch, i) => ({ ch, i, s: choiceState(ch, ctx) })).filter((x) => !x.s.hidden)
      .map(({ ch, i, s }) => ({ i, label: fill(ch.label, st, ctx, scope), disabled: s.disabled, reason: fill(s.reason, st) })),
  };
}

/* ───────────── 套用選擇 ───────────── */
function applyBranch(st, b, turnNo, r, ctx) {
  applyEffects(st, b.effects);
  for (const f of b.setFlags || []) st.flags[f] = true;
  for (const f of b.clearFlags || []) delete st.flags[f];
  for (const [k, v] of Object.entries(b.setVars || {})) st.vars[k] = fill(v, st);
  for (const [k, d] of Object.entries(b.incVars || {})) st.vars[k] = (st.vars[k] || 0) + d;
  for (const [pool, o] of Object.entries(b.opens || {})) {
    const cur = st.openPools[pool];
    st.openPools[pool] = { x: Math.max(o.x, cur && cur.until > turnNo ? cur.x : 0), until: Math.max(turnNo + 1 + o.turns, cur ? cur.until : 0) };
  }
  for (const f of b.followUp || []) {
    if (f.if && !evalCond(f.if, ctx)) continue;
    if (f.chance != null && r() >= f.chance) continue;
    const due = turnNo + f.after[0] + Math.floor(r() * (f.after[1] - f.after[0] + 1));
    st.delayed.push({ card: f.card, due });
  }
}

/** 套用玩家的選擇。回傳 { result, dose }。隱藏數值只經由 tags.js 改變。 */
export function applyChoice(st, data, card, idx, tl, r) {
  const ch = card.choices[idx];
  if (!ch) throw new Error(`選項不存在: ${card.id}#${idx}`);
  const topic = ch.topic || card.topic;
  const ctx = buildCtx(st, tl, { topic });
  const gs = choiceState(ch, ctx);
  if (gs.hidden || gs.disabled) throw new Error(`選項不可選: ${card.id}#${idx}`);
  const before = snapshot(st);
  const scope = cardScope(st, card.id);
  const parts = [fill(ch.result, st, ctx, scope)];
  applyBranch(st, ch, st.turn, r, ctx);
  if (ch.chance) {
    const c = ch.chance;
    const p = clamp(c.p * mulMods(c.mods, ctx), 0, 0.97);
    const win = rngAt(st.seed, st.turn, c.id) < p; // 命運骰：和玩家的選擇無關，同一個人生結果相同
    const b = win ? c.win : c.lose;
    applyBranch(st, b, st.turn, r, ctx);
    parts.push(fill(b.result, st, ctx, scope));
    st.flags[`${c.id}_${win ? '中' : '落'}`] = true;
  }
  const { deltas } = applyTags(st, ch.tags, data.tags, { turn: st.turn, stage: tl.stage, ctx, topic, direction: ch.direction });
  const after = snapshot(st);
  const dose = doseView(before, after, st, tl.stage);
  if (card.once) st.used[card.id] = true;
  if (card.cooldown) st.cooldowns[card.id] = st.turn + card.cooldown + 1;
  const vd = {};
  for (const k of Object.keys(after)) { const d = after[k] - before[k]; if (Math.abs(d) >= 0.05) vd[k] = Math.round(d * 10) / 10; }
  const hd = {};
  for (const [k, d] of Object.entries(deltas)) if (Math.abs(d) >= 0.005) hd[k] = Math.round(d * 100) / 100;
  st.hist.push({ turn: st.turn, card: card.id, title: fill(card.title, st, ctx, scope), ch: idx, label: fill(ch.label, st, ctx, scope), tags: ch.tags || [], d: vd, h: hd });
  return { result: parts.filter(Boolean).join(' '), dose };
}
