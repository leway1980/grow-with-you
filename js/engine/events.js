// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) events.js：條件求值器（逐字複製）與兩段式抽卡、grayIf、textIf、後續卡的做法；
// 改動：移除高中專屬的態度／交往／詐騙邏輯，條件環境改為親子遊戲，新增『池開啟／加重』、選項層級條件（showIf）與機率分支。純函式，無 DOM。
import { pickWeighted, clamp, rngAt, shuffleOrder } from './rng.js';
import { fillSlots, persistedSlots } from './slots.js';
import { familyCtx } from './family.js';
import { applyTags, isGrowthChoice } from './tags.js';

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

/** 工作插播（§4.28）：孩子來問的事「其實重要」的機率與骰子的名字。選項的 chance 要寫 id＝PING_BIG_ID、p＝PING_BIG_P（lint 檢查）。 */
export const PING_BIG_ID = 'ping_big';
export const PING_BIG_P = 0.3;

/** 具名門檻（tags.json 的 gates）：卡片寫「了解度高」，不寫 55，全遊戲只有一個地方改門檻 */
let GATES = {};
export function setGates(g) { GATES = g || {}; }
export const gateNames = () => Object.entries(GATES).flatMap(([k, m]) => Object.keys(m).map((n) => k + n));

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
  const ctx = {
    __flags: st.flags,
    ...familyCtx(f, st.role, tl.ageMonths),
    ...st.hidden, // 隱藏數值只在引擎內部給條件用（例如選項的門檻）；不會出現在任何畫面
    體力: P.體力, 耐心: P.耐心, 錢: P.錢, 工作表現: P.工作表現, 夫妻關係: P.夫妻關係,
    心情: C.心情, 成績: C.成績, 作業: C.作業, 三C: C['3C時間'], 睡眠: C.睡眠, 同學往來: C.同學往來,
    回合: st.turn, 階段: tl.stage, 月齡: tl.ageMonths, 年齡: Math.floor(tl.ageMonths / 12), 年級: tl.grade, 假期: !!tl.vacation, 月: month,
    托育方式: st.vars.托育方式, 幼兒園類型: st.vars.幼兒園類型, 照顧者: st.vars.照顧者, 換照顧者次數: st.vars.換照顧者次數,
    孩子不再開口: st.vars.孩子不再開口 || 0, 孩子主動開口: st.vars.孩子主動開口 || 0, 起點: st.startMode,
    上學方式: st.vars.上學方式 || '', 孩子來找_連續錯過: st.vars.孩子來找_連續錯過 || 0, 不太來找你: !!st.vars.不太來找你,
    事故骰: rngAt(st.seed, st.turn, 'acc_dice'), // 命運骰（0–1）：重大意外（cm_hospital）只在這個回合的骰子夠小時才可能出現，不因為『池裡剩下它』就被抽到
    訊號骰: rngAt(st.seed, st.turn, 'sig_dice'), // 一般孩子版的訊號卡（_gen）只在骰子夠小時才出現，不因為『池裡剩下它』就被抽到（規則 16）
    來問重要: rngAt(st.seed, st.turn, PING_BIG_ID) < PING_BIG_P, // 命運骰：孩子這次來問的事其實重不重要（§4.28）；和選項的 chance（id＝ping_big、p＝0.3）用同一顆骰子，文字與結果才會一致
    // 已經選定的事（hi_pet 養的寵物、lo_club 想要的球類……）：之後的卡讀同一個值；養了寵物之後 有寵物／寵物種類 也跟著變
    有寵物: !!f.pet || !!st.vars.養的寵物, 寵物種類: f.pet ? f.pet.type : st.vars.養的寵物 || '',
    養的寵物: st.vars.養的寵物 || '', 想要的球類: st.vars.想要的球類 || '', 選的才藝: st.vars.選的才藝 || '', 校隊項目: st.vars.校隊項目 || '',
    意願強度: willOf(st, extra.topic),
    疲勞: Math.round(((st.costEMA && st.costEMA.體力) || 0) + ((st.costEMA && st.costEMA.耐心) || 0)), // 最近幾回合體力與耐心花費的累積（「父母自己」池的權重用）
  };
  for (const [k, m] of Object.entries(GATES)) for (const [n, thr] of Object.entries(m)) ctx[k + n] = st.hidden[k] >= thr;
  return ctx;
}

/* ───────────── 效果（看得見的數值） ───────────── */
const clampV = (x) => clamp(x, 0, 100);
/** 套用可見數值的變化。acc 會記下「想要造成的變化」（不是夾在 0–100 之後的實際差），給劑量表用。 */
export function applyEffects(st, eff, acc) {
  if (!eff) return;
  for (const [k, d] of Object.entries(eff)) {
    if (k in st.parent) {
      if (k === '夫妻關係' && !st.family.partner.present) continue;
      st.parent[k] = clampV(st.parent[k] + d);
    } else if (k in st.child) st.child[k] = clampV(st.child[k] + d);
    else throw new Error('未知的可見數值: ' + k + '（隱藏數值只能經由 tags 改變）');
    if (acc) acc[k] = (acc[k] || 0) + d;
  }
}

/* ───────────── 陪伴時段（§2.3）：工作型態決定這個回合的晚餐、睡前、早晨、週末在不在 ───────────── */
export function slotAvailable(st, data, need, turn = st.turn) {
  const pat = data.identities.patterns[st.family.pattern];
  const p = pat && need in pat ? pat[need] : 1;
  return rngAt(st.seed, turn, 'slot:' + need) < p; // 命運骰：和玩家的選擇無關
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
function eligible(card, st, ctx) {
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
/** 兩段式抽卡（沿用 47wan）：先抽池（被選項打開或加重的池權重較高），再抽卡。卡片依「階段 × 池」建好索引，不必每回合掃全部。 */
export function drawCard(st, data, ctx, tl, r, excludeId = null) {
  const idx = data.index[tl.stage] || {};
  const pools = [];
  const live = {};
  for (const name of Object.keys(idx)) {
    const cs = idx[name].filter((c) => c.id !== excludeId && eligible(c, st, ctx));
    if (!cs.length) continue;
    const w = poolWeight(st, data, name, ctx);
    if (w > 0) { pools.push({ name, w }); live[name] = cs; }
  }
  const pool = pickWeighted(r, pools);
  if (!pool) return null;
  return pickWeighted(r, live[pool.name], (c) => (c.weight ?? 1) * mulMods(c.modifiers, ctx) * (c.approach && ctx.不太來找你 ? data.tags.approach?.weightX ?? 1 : 1));
}
export function pickFixed(st, data, tl, ctx) {
  for (const id of tl.fixed || []) { const c = data.cardIndex[id]; if (c && passes(c, st, ctx)) return c; }
  return null;
}
/** 到期的後續卡。回傳 { card, delay }（delay＝從排進去到出現隔了幾回合），沒有就是 null。 */
export function pickDelayed(st, data, tl, ctx, excludeId = null) {
  st.delayed.sort((a, b) => a.due - b.due);
  for (let i = 0; i < st.delayed.length; i++) {
    const d = st.delayed[i];
    if (d.due > st.turn) break;
    const c = data.cardIndex[d.card];
    if (c && c.id === excludeId) continue;
    st.delayed.splice(i, 1);
    if (c && passes(c, st, ctx)) return { card: c, delay: st.turn - (d.from ?? d.due) };
    i--;
  }
  return null;
}

/** 情境負荷（§4.14）：這個回合附在卡片上的事（帳單……）。命運骰決定，和玩家的選擇無關。 */
export function rollLoads(st, data, ctx) {
  const out = [];
  for (const L of data.loads || []) {
    if (L.if && !evalCond(L.if, ctx)) continue;
    if (rngAt(st.seed, st.turn, 'load:' + L.id) < L.p) out.push({ id: L.id, text: L.text, effects: L.effects }); // 命運事件只改看得見的數值，不帶任何家長行為標籤（規則 18）
  }
  return out;
}

/* ───────────── 顯示用資料 ───────────── */
/**
 * 依角色切換的稱謂（規則 15）：玩家是爸爸或媽媽、孩子怎麼叫長輩，都不寫死在卡片裡。
 * 你爸媽＝孩子叫你什麼；另一半稱呼＝對孩子說話時叫另一半（你媽／你爸）；另一半稱呼_大人＝對大人說（我太太／我先生）；
 * 另一半代名詞＝他／她；長輩稱呼＝孩子叫長輩的說法；同學叫你＝孩子的朋友叫你叔叔或阿姨；假期結束＝媽媽是產假、爸爸是假期；
 * 另一個大人＝可以「去問」的人：另一半在家就是另一半，不然是長輩。
 */
export function roleWords(st) {
  const f = st.family, dad = st.role === '爸爸';
  const partner = dad ? '你媽' : '你爸';
  const near = f.partner.present && f.partner.attitude !== '幾乎不在家';
  return {
    你爸媽: dad ? '爸爸' : '媽媽', 另一半稱呼: partner, 另一半稱呼_大人: dad ? '我太太' : '我先生', 另一半代名詞: dad ? '她' : '他',
    長輩稱呼: f.elders.who || '長輩', 同學叫你: dad ? '叔叔' : '阿姨', 假期結束: dad ? '假期結束' : '產假結束',
    另一個大人: near ? partner : (f.elders.who || '長輩'),
  };
}
export function fill(text, st, ctx, scope) {
  if (text == null) return '';
  if (ctx && text.includes('{')) text = fillSlots(text, st, ctx, null, scope || {});
  const f = st.family;
  text = text.replace(/\{孩子\}/g, f.child.given).replace(/\{他\}/g, f.child.pronoun).replace(/\{另一半\}/g, f.partner.present ? '另一半' : '對方')
    .replace(/\{寵物名\}/g, f.pet ? f.pet.name : (st.vars && st.vars.養的寵物名) || '').replace(/\{學校\}/g, f.school.name).replace(/\{長輩\}/g, f.elders.who || '長輩');
  if (text.includes('{')) { const rw = roleWords(st); text = text.replace(/\{([^{}]+)\}/g, (m, n) => (n in rw ? rw[n] : m)); }
  return text;
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
/** 選項的情境版本（規則 17／21）：labelIf／resultIf／tagsIf／effectsIf＝[{if, value}, …]，每個欄位各自由上往下第一個成立的版本取代原值（沒寫 if＝一律成立）；都不成立就用原本的欄位。和 textIf 同一個求值器。 */
export const VARIANT_FIELDS = { labelIf: 'label', resultIf: 'result', tagsIf: 'tags', effectsIf: 'effects' };
export function resolveChoice(ch, ctx) {
  let out = ch;
  for (const [key, field] of Object.entries(VARIANT_FIELDS)) {
    const list = ch[key];
    if (!list || !ctx) continue;
    const v = list.find((x) => !x.if || evalCond(x.if, ctx));
    if (v) { if (out === ch) out = { ...ch }; out[field] = v.value; }
  }
  return out;
}
export function choiceState(ch, ctx) {
  if (ch.showIf && !evalCond(ch.showIf, ctx)) return { hidden: true, disabled: true, reason: '' };
  for (const g of [].concat(ch.grayIf || [])) if (evalCond(g.if, ctx)) return { hidden: false, disabled: true, reason: g.reason };
  return { hidden: false, disabled: false, reason: '' };
}
/** 選項所在的條件環境：和「套用選擇」用同一個（含這個選項自己的 topic），所以顯示、變灰與結果一致。 */
export const choiceCtx = (st, tl, card, ch) => buildCtx(st, tl, { topic: ch.topic || card.topic });

/**
 * 卡片的顯示資料：只有文字與選項，沒有任何數值、標籤或提示（劑量表在選擇之後才出現）。
 * 選項依 (種子, 回合, 卡片) 決定性洗牌；choices[k].i 是原始索引（只給引擎與機器人用），k 是顯示位置。
 */
export function describeCard(card, st, data, tl) {
  const ctx = buildCtx(st, tl, { topic: card.topic });
  const scope = cardScope(st, card.id);
  const order = shuffleOrder(st.seed, st.turn, card.id, card.choices.length);
  const choices = [];
  for (const i of order) {
    const ch = card.choices[i];
    const cctx = choiceCtx(st, tl, card, ch);
    const s = choiceState(ch, cctx);
    if (s.hidden) continue;
    choices.push({ i, pos: choices.length, label: fill(resolveChoice(ch, cctx).label, st, cctx, scope), disabled: s.disabled, reason: fill(s.reason, st) });
  }
  return { id: card.id, title: fill(card.title, st, ctx, scope), text: fill(pickText(card, ctx, st), st, ctx, scope), choices };
}

/* ───────────── 套用選擇 ───────────── */
function applyBranch(st, b, turnNo, r, ctx, acc, scope) {
  applyEffects(st, b.effects, acc);
  for (const f of b.setFlags || []) st.flags[f] = true;
  for (const f of b.clearFlags || []) delete st.flags[f];
  // setVars 的值可以含槽（例如 '{寵物}'），用這張卡抽到的槽值：之後的卡讀同一個值，不重抽（規則 14）
  const persisted = persistedSlots();
  for (const [k, v] of Object.entries(b.setVars || {})) {
    st.vars[k] = fill(v, st, ctx, scope);
    if (scope) for (const [slot, varName] of Object.entries(persisted)) if (varName === k && st.vars[k]) scope[slot] = st.vars[k]; // 這張卡之後的「父母的收穫」也記同一個值
  }
  for (const [k, d] of Object.entries(b.incVars || {})) st.vars[k] = (st.vars[k] || 0) + d;
  for (const [pool, o] of Object.entries(b.opens || {})) {
    const cur = st.openPools[pool];
    st.openPools[pool] = { x: Math.max(o.x, cur && cur.until > turnNo ? cur.x : 0), until: Math.max(turnNo + 1 + o.turns, cur ? cur.until : 0) };
  }
  for (const f of b.followUp || []) {
    if (f.if && !evalCond(f.if, ctx)) continue;
    if (f.chance != null && r() >= f.chance) continue;
    const due = turnNo + f.after[0] + Math.floor(r() * (f.after[1] - f.after[0] + 1));
    st.delayed.push({ card: f.card, due, from: turnNo });
  }
}

/**
 * 花費的情境倍率（tags.json 的 costMods）：同一個選項，不同的孩子與家庭要付的體力、耐心不一樣
 * （有 ADHD 傾向的孩子，訂規則與跟進更累；另一半一起陪，什麼都比較省力）。只放大或縮小「花費」（負的效果），不改好處。
 */
export function scaleCosts(costMods, ch, ctx) {
  const eff = { ...(ch.effects || {}) };
  for (const m of costMods || []) {
    if (m.tags && !(ch.tags || []).some((t) => m.tags.includes(t))) continue;
    if (m.if && !evalCond(m.if, ctx)) continue;
    for (const k of m.keys || ['體力', '耐心']) if (eff[k] < 0) eff[k] *= m.x;
  }
  return eff;
}

/** direction 可以是文字（'升學競爭'）或 '@槽名'（取這張卡抽到的槽值的方向，例如 營隊→科學）；沒寫就用卡片的 direction。 */
export function resolveDirection(card, ch, scope) {
  const d = ch.direction ?? card.direction;
  if (!d) return undefined;
  if (d[0] === '@') return scope['#dir:' + d.slice(1)] || '_';
  return d;
}

/**
 * 父母的收穫（§7.2b）：記下這次一起參與的是什麼。這張卡抽到的槽值（球類、才藝、出遊、營隊……）才有名字；
 * 沒有槽的卡就記下標籤本身。st.parentGrowth 不是隱藏數值，隱藏的『父母的收穫』由 tags.js 改。
 */
export function recordGrowth(st, T, ch, scope) {
  const G = T.growth, list = (ch.tags || []).filter((t) => T.growthTags.includes(t) && !G.joinOnly.includes(t));
  const named = G.slots.filter((n) => scope[n]);
  (st.parentGrowth ||= []);
  if (named.length) for (const n of named) st.parentGrowth.push({ turn: st.turn, slot: n, value: scope[n] });
  else st.parentGrowth.push({ turn: st.turn, tag: list[0] });
}

/**
 * 套用玩家的選擇（idx 是 card.choices 的原始索引）。回傳 { result, acc }：acc＝這次想要造成的可見變化（給劑量表）。
 * 隱藏數值只經由 tags.js 改變。
 */
export function applyChoice(st, data, card, idx, tl, r, extra = {}) {
  const base = card.choices[idx];
  if (!base) throw new Error(`選項不存在: ${card.id}#${idx}`);
  const topic = base.topic || card.topic;
  const ctx = choiceCtx(st, tl, card, base);
  const ch = resolveChoice(base, ctx); // 情境版本：同一個選項在不同年級、孩子特質下的文字、標籤與效果
  const gs = choiceState(ch, ctx);
  if (gs.hidden || gs.disabled) throw new Error(`選項不可選: ${card.id}#${idx}`);
  const acc = {}; // 這個選項自己造成的可見變化；回合的合計由呼叫端累加
  const scope = cardScope(st, card.id);
  const parts = [fill(ch.result, st, ctx, scope)];
  let branchTags = [];
  // 陪伴時段不在：用體力硬換或請假，代價照實顯示在劑量表上，選項不會消失
  for (const need of ch.needs || []) if (!slotAvailable(st, data, need)) applyEffects(st, data.tags.slotCost[need], acc);
  applyBranch(st, { ...ch, effects: scaleCosts(data.tags.costMods, ch, ctx) }, st.turn, r, ctx, acc, scope);
  if (ch.chance) {
    const c = ch.chance;
    const p = clamp(c.p * mulMods(c.mods, ctx), 0, 0.97);
    const win = rngAt(st.seed, st.turn, c.id) < p; // 命運骰：和玩家的選擇無關，同一個人生結果相同
    const b = win ? c.win : c.lose;
    applyBranch(st, b, st.turn, r, ctx, acc, scope);
    parts.push(fill(b.result, st, ctx, scope));
    st.flags[`${c.id}_${win ? '中' : '落'}`] = true;
    branchTags = b.tags || []; // 分支也可以帶行為標籤（隱藏數值仍然只經由標籤換算）
  }
  const allTags = [...(ch.tags || []), ...branchTags];
  applyTags(st, allTags, data.tags, { turn: st.turn, stage: tl.stage, ctx, topic, direction: resolveDirection(card, ch, scope), approach: !!card.approach, initiate: !!card.initiate });
  if (isGrowthChoice(data.tags, ch.tags)) recordGrowth(st, data.tags, ch, scope);
  if (card.once) st.used[card.id] = true;
  if (card.cooldown) st.cooldowns[card.id] = st.turn + card.cooldown + 1;
  const d = {};
  for (const [k, v] of Object.entries(acc)) if (Math.abs(v) >= 0.05) d[k] = Math.round(v * 10) / 10;
  const entry = { turn: st.turn, card: card.id, title: fill(card.title, st, ctx, scope), ch: idx, label: fill(ch.label, st, ctx, scope), tags: allTags, d };
  if (extra.fu != null) entry.fu = extra.fu;
  st.hist.push(entry);
  return { result: parts.filter(Boolean).join(' '), acc, entry };
}
