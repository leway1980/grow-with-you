// 內容規則的靜態檢查（DESIGN §11 規則 8、13、14、15、16 ...）：被 tools/lint-data.mjs 呼叫。
// 每條規則都是資料驅動：要改禁用詞、時間詞，改 data/tags.json 的 cardRules，不改這裡。
// errors＝擋 CI；warns＝提醒（時間詞等規則先警告，內容改完再升級成錯誤）。

const ZH = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** 中文數字（到 99）或阿拉伯數字 → 整數；不認得回傳 NaN */
export function zhNum(s) {
  if (/^\d+$/.test(s)) return +s;
  if (s === '十') return 10;
  const m = /^([一二兩三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
  if (m) return (m[1] ? ZH[m[1]] : 1) * 10 + (m[2] ? ZH[m[2]] : 0);
  return s.length === 1 && s in ZH ? ZH[s] : NaN;
}
const NUM = '[0-9]+|[一二兩三四五六七八九]?十[一二三四五六七八九]?|[一二兩三四五六七八九]';

/** 一張卡裡所有會被玩家讀到的字串（槽標記先拿掉，避免把 {孩子}三個多月 的 {孩子} 當成別的東西） */
export function cardStrings(c) {
  const out = [c.title, c.text];
  for (const t of c.textIf || []) out.push(t.text);
  for (const ch of c.choices || []) {
    out.push(ch.label, ch.result);
    if (ch.chance) out.push(ch.chance.win.result, ch.chance.lose.result);
  }
  return out.filter(Boolean);
}

/**
 * 文字裡寫到的孩子年齡：回傳 [{ what, lo, hi, unit }]。
 * unit＝'month'（月齡區間，容許 ±3 個月）或 'grade'（年級集合）。
 */
export function ageMentions(text) {
  const t = String(text);
  const out = [];
  const add = (m) => out.push(m);
  // {孩子}八個月大、{孩子}三個多月：只算「孩子」後面接的月齡（「你已經三個月沒運動」「兩個月後」是時間長度，不是年齡）
  for (const m of t.matchAll(new RegExp(`\\{(?:孩子|他|她)\\}(?:才|已經|快|現在|滿)?(${NUM})個(多)?月`, 'g'))) {
    const n = zhNum(m[1]); if (!Number.isNaN(n)) add({ what: m[0], unit: 'month', lo: n, hi: n + (m[2] ? 2 : 0) });
  }
  // 歲：{孩子}快三歲了、{孩子}四歲了、{孩子}快一歲半（只算孩子自己的年齡；「等到兩歲再看」「十七歲的陌生人」不算）
  for (const m of t.matchAll(new RegExp(`\\{(?:孩子|他|她)\\}(快|將近|才|剛滿|滿|已經|現在)?(${NUM})歲(半)?`, 'g'))) {
    const n = zhNum(m[2]); if (Number.isNaN(n)) continue;
    if (m[3]) add({ what: m[0], unit: 'month', lo: n * 12 + 4, hi: n * 12 + 8 });
    else if (m[1] === '快' || m[1] === '將近') add({ what: m[0], unit: 'month', lo: n * 12 - 6, hi: n * 12 });
    else add({ what: m[0], unit: 'month', lo: n * 12, hi: n * 12 + 11 });
  }
  // 年級：三年級、一、二年級、低中高年級（「等三年級再說」「升上三年級」是未來，不算；「快六年級」＝五年級）
  for (const m of t.matchAll(new RegExp(`(?<![等到升上再])(快)?((?:[一二三四五六]、)*[一二三四五六])年級`, 'g'))) {
    const gs = m[2].split('、').map(zhNum); add({ what: m[0], unit: 'grade', grades: m[1] ? gs.map((g) => g - 1) : gs });
  }
  for (const m of t.matchAll(/(?<![等到升上再])([低中高])年級/g)) add({ what: m[0], unit: 'grade', grades: { 低: [1, 2], 中: [3, 4], 高: [5, 6] }[m[1]] });
  // 幼兒園班別
  for (const m of t.matchAll(/([小中大])班/g)) { const lo = { 小: 36, 中: 48, 大: 60 }[m[1]]; add({ what: m[0], unit: 'month', lo, hi: lo + 11 }); }
  return out;
}

/** 從 requires.expr 取出年齡相關的限制（只認 and 連起來的 月齡／年齡／年級 比較；其他條件不管） */
export function ageConstraints(expr) {
  if (!expr) return [];
  return [...expr.matchAll(/(月齡|年齡|年級)\s*(>=|<=|==|!=|<|>)\s*(\d+)/g)].map((m) => ({ k: m[1], op: m[2], v: +m[3] }));
}
const CMP = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '==': (a, b) => a === b, '!=': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b };
/** 這張卡可能出現在哪些日曆回合（只看階段、固定事件與年齡限制；其他條件不管） */
export function eligibleTurns(card, timeline, stageNames) {
  const cs = ageConstraints(card.requires?.expr);
  const fixed = card.pool.startsWith('_');
  return timeline.filter((tl) => {
    if (fixed) { if (!(tl.fixed || []).includes(card.id)) return false; } else if (!(card.stages || stageNames).includes(tl.stage)) return false;
    return cs.every((c) => CMP[c.op]({ 月齡: tl.ageMonths, 年齡: Math.floor(tl.ageMonths / 12), 年級: tl.grade }[c.k], c.v));
  });
}
const TOL = 3;

export function lintContent(raw, data, cards, ctxKeys, st0) {
  const errors = [], warns = [];
  const T = raw.tags, R = T.cardRules;
  const stageNames = ['嬰幼兒', '幼兒園', '國小低', '國小中高'];
  const playable = data.timeline.slice(0, raw.calendar.playableTurns);

  // ── 規則 14（跨卡沿用的值）：persist 的槽與 st.vars 的鍵要存在；setVars 寫入的鍵若是 persist 的鍵，值只能是該槽的槽標記 ──
  {
    const persist = raw.slots.persist || {}, slotsT = raw.slots.slots;
    for (const [slot, varName] of Object.entries(persist)) {
      if (!slotsT[slot]) errors.push(`persist：槽「${slot}」不存在`);
      if (st0 && !(varName in st0.vars)) errors.push(`persist：槽「${slot}」對應的 vars「${varName}」不在 state 的初始值裡`);
      if (raw.model && !(raw.model.nodes[varName] && raw.model.nodes[varName].writers.includes('card'))) errors.push(`persist：vars「${varName}」要在因果圖當第 2 層的節點（writers 有 card）`);
    }
    for (const c of cards) for (const ch of c.choices) for (const b of [ch, ...(ch.chance ? [ch.chance.win, ch.chance.lose] : [])]) for (const [k, v] of Object.entries(b.setVars || {})) {
      const slot = Object.keys(persist).find((n) => persist[n] === k);
      if (slot && v !== `{${slot}}` && !/^\{[^{}]+\}$/.test(v)) errors.push(`卡片 ${c.id}：setVars「${k}」存的是槽「${slot}」選定的值，要寫成槽標記（例如 {${slot}}），不是固定字串`);
    }
  }

  // ── 規則 8：年齡要對 ──
  for (const c of cards) {
    const ms = cardStrings(c).flatMap(ageMentions);
    if (!ms.length) continue;
    const E = eligibleTurns(c, playable, stageNames);
    if (!E.length) { errors.push(`卡片 ${c.id}：規則 8：文字寫到年齡，但年齡條件讓它沒有任何可能出現的回合`); continue; }
    const seen = new Set();
    for (const m of ms) {
      if (seen.has(m.what)) continue; seen.add(m.what);
      if (m.unit === 'month') {
        const bad = E.filter((tl) => tl.ageMonths < m.lo - TOL || tl.ageMonths > m.hi + TOL);
        if (bad.length) errors.push(`卡片 ${c.id}：規則 8：文字寫「${m.what}」（約 ${m.lo}${m.hi !== m.lo ? '–' + m.hi : ''} 個月，容許 ±${TOL}），但卡片可能出現在 ${[...new Set(bad.map((x) => x.ageMonths))].join('、')} 個月——請加上月齡／年級條件`);
      } else {
        const bad = E.filter((tl) => !m.grades.includes(tl.grade));
        if (bad.length) errors.push(`卡片 ${c.id}：規則 8：文字寫「${m.what}」，但卡片可能出現在${[...new Set(bad.map((x) => (x.grade ? x.grade + ' 年級' : x.ageMonths + ' 個月')))].join('、')}——請加上年級條件`);
      }
    }
  }

  // ── 規則 15：稱謂與代名詞用依角色切換的槽 ──
  {
    const words = R.hardcodedWords || [];
    const scan = (text, where) => {
      for (const w of words) if (String(text).includes(w)) errors.push(`${where}：規則 15：寫死了「${w}」——稱謂用依角色切換的槽（{你爸媽}、{另一半稱呼}、{長輩稱呼}、{同學叫你}、{假期結束}）`);
      for (const q of String(text).matchAll(/「[^」]*」/g)) if (q[0].includes('{另一半}')) errors.push(`${where}：規則 15：引號裡的 {另一半} 會變成字面的「另一半」——對孩子說話用 {另一半稱呼}、對大人說用 {另一半稱呼_大人}`);
    };
    for (const c of cards) for (const s of cardStrings(c)) scan(s, `卡片 ${c.id}`);
    for (const [name, vals] of Object.entries(raw.slots.slots)) for (const v of vals) scan(v.t, `槽 ${name}`);
    for (const l of raw.pools.loads || []) scan(l.text, `loads ${l.id}`);
    for (const lines of Object.values(raw.calendar.flavor || {})) for (const l of lines) scan(l, '日曆 flavor');
  }
  return { errors, warns };
}
