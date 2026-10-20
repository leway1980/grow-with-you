// 選項明顯度測試的匯出器（DESIGN §3.6「選項明顯度測試」）：把每張卡匯成「盲測」JSON，交給外部評分（人或另一個模型）。
// 盲測檔只有：卡片編號、標題、內文（變數槽用固定種子填好）、洗亂順序的選項文字。沒有標籤、沒有效果、沒有結果文字。
// 另外寫一個對照檔（key），只記每個位置是原來的第幾個選項，評分完才拿來還原；不含任何標籤或數值。
// 用法：node tools/obviousness.mjs [輸出資料夾=$SCRATCHPAD 或系統暫存] [種子=1]
// 選項：--cards <正規表示式>＝只匯出 id 符合的卡；--raters <N>＝切成 N 份評分檔（預設 4）。
// --context 模式（雙問題盲測，DESIGN §3.6 驗收＋§11 規則 21）：node tools/obviousness.mjs [輸出資料夾] [種子=1] --context
//   每張卡 2 題，放在兩個不同的孩子情境；變體卡一題在預設情境、一題在『最佳選項換人』的情境。見 exportContext()。
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadData } from './data-node.mjs';
import { newState, startTurnOf } from '../js/engine/state.js';
import { shuffleOrder } from '../js/engine/rng.js';
import { buildCtx, passes, fill, pickText, cardScope, choiceCtx, choiceState, resolveChoice, scaleCosts, evalCond, VARIANT_FIELDS } from '../js/engine/events.js';
import { mulberry32, hashStr } from '../js/engine/rng.js';
import { doseView, meterView } from '../js/engine/dose.js';
import { gradeName, ageLabel } from '../js/engine/turn.js';
import { outcomeWeights } from '../js/engine/model.js';
import { tagVec, compositeWeights } from './metrics.mjs';

/** 回傳 { blind, key }：blind 是給評分者的，key 是還原用的 */
export function exportBlind(data = loadData(), seed = 1) {
  const blind = [], key = {};
  for (const card of data.events.cards) {
    const stage = (card.stages || ['國小中高'])[0];
    const tl = data.timeline.find((t) => t.stage === stage) || data.timeline[data.timeline.length - 1];
    const st = newState(seed, data, { role: '媽媽', startMode: tl.turn >= startTurnOf(data, 'elementary') ? 'elementary' : 'birth' });
    st.turn = tl.turn;
    const ctx = buildCtx(st, tl, { topic: card.topic });
    const scope = cardScope(st, card.id);
    const order = shuffleOrder(seed, 0, 'blind:' + card.id, card.choices.length);
    blind.push({
      id: card.id,
      title: fill(card.title, st, ctx, scope),
      text: fill(pickText(card, ctx, st), st, ctx, scope),
      options: order.map((i) => fill(card.choices[i].label, st, ctx, scope)),
    });
    key[card.id] = order;
  }
  return { blind, key };
}

/* ───────────── --context 模式 ───────────── */

/**
 * 孩子的白話描述。用詞沿用遊戲裡已有的說法：family.js TEMP_LINE（手腳一刻不停、很安靜、一點聲音就會醒、不太挑剔、想要的東西就是不肯放、
 * 很容易被轉移注意力）與卡片文字（比較敏感、坐不住）。只寫 ≥4 或 ≤2 的特質；3 不寫。
 *   敏感度 4–5：比較敏感、容易掉眼淚（5＝很敏感、很容易掉眼淚；不到 2 歲＝一點聲音就會醒）　敏感度 1–2：不太挑剔
 *   活動量 4–5：坐不太住（5＝完全坐不住；不到 2 歲＝手腳一刻不停）　活動量 1–2：很安靜
 *   堅持度 4–5：想要的東西就是不肯放　堅持度 1–2：很容易被轉移注意力
 * 年齡：國小＝小一…小六；國中＝國一…國三；高中＝高一…高三；學前＝「N 歲」「N 個月大」。
 */
export function traitPhrases(t, ageMonths = 120) {
  const infant = ageMonths < 24, out = [];
  if (t.敏感度 >= 5) out.push(infant ? '一點聲音就會醒' : '很敏感、很容易掉眼淚');
  else if (t.敏感度 >= 4) out.push(infant ? '一點聲音就會醒' : '比較敏感、容易掉眼淚');
  else if (t.敏感度 <= 2) out.push('不太挑剔');
  if (t.活動量 >= 5) out.push(infant ? '手腳一刻不停' : '完全坐不住');
  else if (t.活動量 >= 4) out.push(infant ? '手腳一刻不停' : '坐不太住');
  else if (t.活動量 <= 2) out.push('很安靜');
  if (t.堅持度 >= 4) out.push('想要的東西就是不肯放');
  else if (t.堅持度 <= 2) out.push('很容易被轉移注意力');
  return out;
}
const ZH_N = ['零', '一', '二', '三', '四', '五', '六'];
export function ageWord(tl) {
  const g = tl.grade;
  if (g >= 1 && g <= 6) return '小' + ZH_N[g];
  if (g >= 7 && g <= 9) return '國' + ZH_N[g - 6];
  if (g >= 10) return '高' + ZH_N[g - 9];
  const m = tl.ageMonths;
  return m < 24 ? (m === 0 ? '剛出生' : `${m} 個月大`) : ageLabel(m - (m % 6)).replace(' 歲 6 個月', ' 歲半');
}
export function childLine(given, t, tl) {
  const tr = traitPhrases(t, tl.ageMonths);
  return `${given}，${ageWord(tl)}，${tr.length ? tr.join('，') : '個性不特別突出，各方面都普通'}`;
}
/** 今天的父母狀態：體力與耐心用畫面上數值條的字（很好／不錯／普通／有點低／很低） */
export function parentLine(P, tl) {
  const mv = meterView({ parent: P, child: {}, family: { partner: { present: false } } }, tl.stage).parent;
  const w = (k) => mv.find((m) => m.key === k).word;
  return `今天的你：體力${w('體力')}，耐心${w('耐心')}`;
}
const doseText = (r) => `${r.dir > 0 ? '▲' : '▼'} ${r.label} ${[1, 2, 3].map((n) => (n <= r.level ? '■' : '□')).join('')}`;
/** 一個選項的劑量表（和 ui.js 的 showResult 同一份 view-model：孩子在前、你在後；沒有變化時是同一句話）。只含選項本身的可見效果，不含機率分支與陪伴時段的額外代價。 */
export function doseLines(eff, st, stage) {
  const d = doseView(eff, st, stage);
  if (!d.child.length && !d.parent.length) return ['這次看不出什麼明顯的變化。'];
  return [d.child.length && `孩子：${d.child.map(doseText).join('、')}`, d.parent.length && `你：${d.parent.map(doseText).join('、')}`].filter(Boolean);
}

const hasVariant = (card) => card.choices.some((c) => Object.keys(VARIANT_FIELDS).some((k) => c[k]));
const ifsHolding = (card, st, tl) => {
  const s = new Set();
  for (const c of card.choices) for (const k of Object.keys(VARIANT_FIELDS)) for (const v of c[k] || []) if (v.if && evalCond(v.if, choiceCtx(st, tl, card, c))) s.add(v.if);
  return [...s].sort().join(' | ');
};

/** 隨機做出一個情境：家庭（由種子抽）＋ 階段內的某一回合 ＋ 今天的父母狀態（約三成偏累） */
function makeCandidate(data, card, r, seed) {
  const stages = card.stages || ['國小中高'];
  const turns = data.timeline.filter((t) => stages.includes(t.stage));
  const tl = turns[Math.floor(r() * turns.length)] || data.timeline[data.timeline.length - 1];
  const st = newState(seed, data, { role: r() < 0.5 ? '媽媽' : '爸爸', startMode: tl.turn >= startTurnOf(data, 'elementary') ? 'elementary' : 'birth' });
  st.turn = tl.turn;
  // 要前面某個選擇才會出現的卡：把它 requires 裡提到的旗標補上（內容照常出題；其他前置條件拿不到就略過，見 stats.relaxed）
  const rq = card.requires || {};
  for (const f of [...(rq.flags || []), ...[...(rq.expr || '').matchAll(/#([^\s()=!<>&|]+)/g)].map((m) => m[1])]) st.flags[f] = true;
  const u = (a, b) => Math.round(a + r() * (b - a));
  if (r() < 0.35) { st.parent.體力 = u(15, 42); st.parent.耐心 = u(12, 45); if (st.parent.體力 >= 38 && st.parent.耐心 >= 38) st.parent.耐心 = u(12, 37); }
  else { st.parent.體力 = u(50, 90); st.parent.耐心 = u(45, 90); }
  return { st, tl };
}

/** 把一個情境下的卡片畫成『玩家看到的』，同時算出隱藏的親子軸值（只進 key） */
function renderItem(data, card, cand, axisOf, axisParentOf) {
  const { st, tl } = cand, stages = card.stages || null;
  const ctx = buildCtx(st, tl, { topic: card.topic });
  const scope = cardScope(st, card.id);
  const title = fill(card.title, st, ctx, scope), text = fill(pickText(card, ctx, st), st, ctx, scope);
  const opts = [];
  card.choices.forEach((ch, i) => {
    const cctx = choiceCtx(st, tl, card, ch);
    const s = choiceState(ch, cctx);
    if (s.hidden || s.disabled) return;
    const rc = resolveChoice(ch, cctx);
    opts.push({ i, label: fill(rc.label, st, cctx, scope), dose: doseLines(scaleCosts(data.tags.costMods, rc, cctx), st, tl.stage), axis: axisOf(rc, stages), axisParent: axisParentOf ? axisParentOf(rc, stages) : 0 });
  });
  const f = st.family.child;
  return { title, text, child: childLine(f.given, f.temperament, tl), parent: parentLine(st.parent, tl), opts, ifs: ifsHolding(card, st, tl), temperament: { ...f.temperament }, grade: tl.grade, ageMonths: tl.ageMonths, parentState: { 體力: st.parent.體力, 耐心: st.parent.耐心 } };
}
const bestOf = (opts) => { const m = Math.max(...opts.map((o) => o.axis)); return opts.map((o, k) => (o.axis >= m - 1e-9 ? k : -1)).filter((k) => k >= 0); };
const disjoint = (a, b) => !a.some((x) => b.includes(x));
const sameOrig = (a, b) => a.opts.length === b.opts.length && a.opts.every((o, k) => o.i === b.opts[k].i);

/**
 * 回傳 { blind, key, files }：blind＝全部題目（給玩家看到的欄位，洗亂順序）、key＝還原與評分用、files＝切成 4 份給 4 位評分者。
 * 每張卡 2 題。變體卡：預設情境（沒有任何情境版本的 if 成立）＋ 最佳選項（綜合幸福，見 compositeWeights）換人的情境（條件和 rule21-gap 相同：套用情境版本後的選項，用和終局 wellbeing 同一個組合；舊的親子軸數字留在 key.axisParent）。
 * 非變體卡：兩個隨機情境（孩子描述不同）。題目 id 是不透明的流水號。
 */
export function exportContext(data = loadData(), seed = 1, { cards: cardRe = null, raters = 4 } = {}) {
  const dot = (W) => (ch, stages) => Object.entries(tagVec(data.tags, ch, stages)).reduce((a, [k, v]) => a + (W[k] || 0) * v, 0);
  const axisOf = dot(compositeWeights(data.model)), axisParentOf = dot(outcomeWeights(data.model)['親子']);
  const items = [], stats = { relaxed: [], skipped: [] };
  data.events.cards.forEach((card, ci) => {
    if (cardRe && !cardRe.test(card.id)) return;
    const r = mulberry32((hashStr(card.id) ^ (seed * 0x9e3779b1)) >>> 0);
    const variant = hasVariant(card);
    const cands = [];
    for (let j = 0, n = variant ? 160 : 24; j < n; j++) {
      const c = makeCandidate(data, card, r, (hashStr(card.id + ':' + j) ^ seed) >>> 0);
      const it = renderItem(data, card, c, axisOf, axisParentOf);
      if (it.opts.length < 2) continue;
      it.ok = passesCard(card, c, data);
      cands.push(it);
    }
    // 優先用『這張卡真的會出現』的情境；一個都沒有（前置條件是前面的歷史）就放寬，並記下
    const all = cands.slice(), okc = cands.filter((c) => c.ok);
    const relaxed = !okc.length;
    if (okc.length) cands.splice(0, cands.length, ...okc);
    if (!cands.length) return;
    if (relaxed) stats.relaxed.push(card.id);
    let a = cands[0], b = null, kind = ['random', 'random'], sw = false;
    if (variant) {
      const def = cands.find((c) => !c.ifs) || cands[0];
      const ba = bestOf(def.opts);
      const alt = cands.find((c) => c !== def && sameOrig(c, def) && disjoint(ba, bestOf(c.opts))) || cands.find((c) => c !== def && disjoint(ba, bestOf(c.opts)));
      a = def; b = alt || cands.find((c) => c !== def && c.ifs !== def.ifs && c.child !== def.child) || cands.find((c) => c !== def && c.child !== def.child) || cands.find((c) => c !== def);
      sw = !!alt; kind = ['default', alt ? 'switch' : 'other'];
      if (!b) b = all.find((c) => c !== def && c.child !== def.child) || all.find((c) => c !== def); // 只有一個會出現的情境（例如『下一胎』只在手足出生前 1–2 回合）：第二題退而用不一定會出現的情境
      if (!b) return;
    } else b = cands.find((c) => c !== a && c.child !== a.child) || cands.find((c) => c !== a) || a;
    [[a, kind[0]], [b, kind[1]]].forEach(([it, kd], k) => items.push({ ci, k, card, it, kind: kd, variant, sw }));
  });
  // 題目順序與選項順序都洗亂
  const rs = mulberry32((seed ^ 0xb10d) >>> 0);
  const order = items.map((_, i) => i).sort(() => rs() - 0.5);
  const blind = [], key = {};
  order.forEach((idx, n) => {
    const { ci, k, card, it, kind, variant, sw } = items[idx];
    const id = 'n' + String(n + 1).padStart(3, '0');
    const sh = shuffleOrder(seed, ci * 2 + k, 'ctx:' + card.id, it.opts.length);
    const o = sh.map((p) => it.opts[p]);
    blind.push({ id, title: it.title, text: it.text, child: it.child, parent: it.parent, options: o.map((x) => ({ label: x.label, dose: x.dose })) });
    key[id] = { card: card.id, k, kind, variant, switch: variant && sw, order: o.map((x) => x.i), axis: o.map((x) => Math.round(x.axis * 1000) / 1000), axisParent: o.map((x) => Math.round(x.axisParent * 1000) / 1000), best: bestOf(o), temperament: it.temperament, grade: it.grade, ageMonths: it.ageMonths, parentState: it.parentState };
  });
  // 切 4 份：同一張卡的兩題分給不同的評分者；每份平均
  const files = Array.from({ length: raters }, () => []);
  const cardNo = new Map();
  for (const b of blind) { const c = key[b.id].card; if (!cardNo.has(c)) cardNo.set(c, cardNo.size); }
  const half = new Map();
  for (const b of blind) { const kk = key[b.id], c = cardNo.get(kk.card); files[(c + (half.get(kk.card) ? Math.ceil(raters / 2) : 0)) % raters].push(b); half.set(kk.card, true); }
  return { blind, key, files, stats };
}
function passesCard(card, cand, data) {
  const { st, tl } = cand;
  return passes(card, st, buildCtx(st, tl, { topic: card.topic }));
}

export const RATER_PROMPT = `你會看到一份 JSON，裡面是一些親子相處的小情境。每一題有：卡片標題與內文、孩子的簡述、今天你（家長）的體力與耐心，以及幾個選項。每個選項下面列出「選了之後畫面上會顯示的變化」：▲ 是增加、▼ 是減少，方格 ■ 越多變化越大。

每一題請回答兩個問題：

Q1　專家會選哪一個？也就是對「這個孩子」來說，你認為最好的做法是哪一個。
Q2　如果你是這個家長，看到上面的變化和今天的體力、耐心，你實際會選哪一個？

請照題目順序，一題一題獨立回答，不要回頭修改。選項用 0 開始的位置表示（第一個選項是 0，第二個是 1，依此類推）。

只輸出一個 JSON 陣列，不要加說明：

[{"id": "n001", "q1": 0, "q2": 2}, {"id": "n002", "q1": 1, "q2": 1}]
`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), ctxMode = args.includes('--context');
  const optVal = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
  const cardsOpt = optVal('--cards'), ratersOpt = optVal('--raters');
  const pos = args.filter((a) => !a.startsWith('--'));
  const out = pos[0] || process.env.SCRATCHPAD || tmpdir();
  const seed = parseInt(pos[1] || '1', 10);
  mkdirSync(out, { recursive: true });
  if (ctxMode) {
    const { blind, key, files, stats } = exportContext(loadData(), seed, { cards: cardsOpt ? new RegExp(cardsOpt) : null, raters: ratersOpt ? parseInt(ratersOpt, 10) : 4 });
    const w = (f, o) => writeFileSync(join(out, f), JSON.stringify(o, null, 1) + '\n');
    w('blind.json', blind); w('key.json', key);
    files.forEach((f, i) => w(`blind-${i + 1}.json`, f));
    writeFileSync(join(out, 'rater-prompt.md'), RATER_PROMPT);
    console.log(`--context：匯出 ${blind.length} 題（${new Set(Object.values(key).map((k) => k.card)).size} 張卡，種子 ${seed}）→ ${join(out, 'blind.json')}、blind-1..N.json（各 ${files.map((f) => f.length).join('/')} 題）、key.json（評分前不要給評分者）、rater-prompt.md${stats.relaxed.length ? `；前置條件放寬的卡 ${stats.relaxed.length} 張` : ''}`);
    process.exit(0);
  }
  const { blind, key } = exportBlind(loadData(), seed);
  writeFileSync(join(out, 'obviousness-blind.json'), JSON.stringify(blind, null, 1) + '\n');
  writeFileSync(join(out, 'obviousness-key.json'), JSON.stringify(key, null, 1) + '\n');
  console.log(`匯出 ${blind.length} 張卡（種子 ${seed}）→ ${join(out, 'obviousness-blind.json')}（盲測）與 obviousness-key.json（還原用，評分前不要給評分者）`);
}
