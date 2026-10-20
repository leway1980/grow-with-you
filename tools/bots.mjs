// 策略機器人（tools/simulate.mjs、check-design、impact 共用）。
// BOTS：校準用的極端策略（DESIGN §3.4）。HUMAN_BOTS：比較像真人的混合（§3.7 第 5 點）：累了就選最省力的、多半照習慣反應、偶爾去查研究。
// 這個檔案只依賴引擎的舊介面（view／raw／st／data），impact.mjs 會把它複製到別的 git 版本去跑。
import { stateRng } from '../js/engine/rng.js';
import * as EV from '../js/engine/events.js';
import { tagVec, doseScore, hiddenScore, costOf } from './metrics.mjs';

/** 機器人看到的『這個選項』＝情境版本套用後的樣子（labelIf／tagsIf／effectsIf，規則 21），和玩家實際看到、引擎實際套用的相同。
 *  舊版引擎（impact.mjs 複製到舊版本時）沒有 resolveChoice，就用原選項。blind＝true 時故意不套用（情境盲機器人，用來量規則 21 的差距）。 */
export function resolvedChoice(st, data, raw, i, blind = false) {
  const base = raw.choices[i];
  if (blind || !EV.resolveChoice || !EV.choiceCtx) return base;
  return EV.resolveChoice(base, EV.choiceCtx(st, data.timeline[st.turn], raw, base));
}

const hasTag = (ch, set) => (ch.tags || []).filter((t) => set.includes(t)).length;
const sum = (o, w) => Object.entries(w).reduce((a, [k, x]) => a + x * (o[k] || 0), 0);

export const BOTS = {
  random: { desc: '隨機', score: () => 0 },
  permissive: { desc: '放任（嘴巴尊重、兩手一攤、出事才收拾）', score: (T, ch) => {
    const v = tagVec(T, ch);
    return -v.規範監督 - v.替他做主 + 0.2 * (v.溫暖陪伴 || 0) + 3 * hasTag(ch, ['嘴巴尊重無跟進', '兩手一攤', '沒有下文', '說沒關係就結束', '吵了才讓步', '說了不算', '出事替他擺平', '外包', '3C當保母', '全部替他做']);
  } },
  controlling: { desc: '控制（替他決定、只看成績、比較）', score: (T, ch) => {
    const v = tagVec(T, ch);
    return 2 * (v.替他做主 || 0) + (v.規範監督 || 0) - 0.3 * (v.溫暖陪伴 || 0) + 3 * hasTag(ch, ['替他決定', '罵一頓', '只看成績', '送去補習', '拿別人比較', '轉述消息_特地', '全部替他做', '提議別的', '沒聽孩子重複的要求']);
  } },
  warmFirm: { desc: '溫暖＋堅定（自己的事一律放著，不休息）', score: (T, ch) => sum(tagVec(T, ch), { 溫暖陪伴: 1, 規範監督: 1, 親子信任: 0.5, 了解度: 0.5, 主見: 0.5, 替他做主: -1, 期待壓力: -0.5, 試探度: -0.5, 規則一致性: 0.3 }) },
  doseGreedy: { desc: '只看劑量表（每次選看得到的變化最好的）', score: (T, ch) => doseScore(ch) },
  antiDose: { desc: '反過來只看劑量表（每次選看得到的變化最差的）', score: (T, ch) => -doseScore(ch) },
  warmFirmRest: { desc: '溫暖＋堅定，疲勞時用「父母自己」池的卡與卡裡自然的休息選項', score: (T, ch) => BOTS.warmFirm.score(T, ch) },
};


/** 情境盲機器人（只給 check-design 量『規則 21 有沒有差』用；不在 BOTS 裡，所以不會進校準與影響上限的局數）：和 warmFirm 同一套打分，但永遠看卡片原本的選項。 */
export const BLIND_BOTS = {
  warmFirmBlind: { desc: '溫暖＋堅定，但情境盲：永遠照卡片原本（沒套用情境版本）的選項打分，量規則 21 的差距', blind: true, score: (T, ch) => BOTS.warmFirm.score(T, ch) },
};

/* ───── 比較像真人的機器人 ───── */
/** 家長最常見、最直覺的反應（標籤）：human 機器人「照習慣」時偏向它們 */
export const COMMON_TAGS = ['說沒關係就結束', '送去補習', '罵一頓', '敷衍帶過', '假裝聽', '外包', '替他決定', '只看成績', '說教一段', '3C當保母', '提議別的', '一邊滑手機一邊回', '拿別人比較', '怪老師', '全部替他做', '沒有下文', '說了不算', '吵了才讓步', '硬撐'];
const argmax = (xs, f) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));
export const HUMAN_BOTS = {
  tiredLazy: { desc: '累了就偷懶：多半選最省力的，累的時候更是', human: true,
    pick: (o, { r, st, raw, data }) => {
      const tired = st.parent.耐心 < 45 || st.parent.體力 < 45;
      const x = r();
      const R = (k) => resolvedChoice(st, data, raw, k.i);
      if (x < (tired ? 0.8 : 0.5)) return o.reduce((a, b) => (costOf(R(b)) < costOf(R(a)) ? b : a)).i;
      return o[Math.floor(r() * o.length)].i;
    } },
  commonReaction: { desc: '多半照習慣反應：說沒關係、送補習、先忙手邊的事', human: true,
    pick: (o, { r, st, raw, data }) => {
      if (r() < 0.7) return argmax(o, (k) => { const c = resolvedChoice(st, data, raw, k.i); return (c.tags || []).filter((t) => COMMON_TAGS.includes(t)).length + doseScore(c) / 20 + r() * 1e-6; }).i;
      return o[Math.floor(r() * o.length)].i;
    } },
  occasionalResearch: { desc: '偶爾去查研究：多半隨機，有餘裕的時候選有研究支持的做法', human: true,
    pick: (o, { r, st, raw, data }) => {
      const tired = st.parent.耐心 < 40 || st.parent.體力 < 40;
      if (r() < (tired ? 0.08 : 0.3)) return argmax(o, (k) => hiddenScore(data.tags, resolvedChoice(st, data, raw, k.i), raw.stages || null) + r() * 1e-6).i;
      return o[Math.floor(r() * o.length)].i;
    } },
};
/** 只看字面的機器人（§3.7 第 5 點；§11 規則：好選項不能靠字面認出來）。標記詞與暖語線索的唯一來源是 data/tags.json 的 cardRules（markerWords／warmCues）；
 *  下面的預設值只給 tools/impact.mjs 在舊版資料（沒有這些欄位）上跑時用。 */
const DEFAULT_MARKERS = ['蹲下來', '聽完', '說完', '再決定', '不評論', '一起', '約好', '說好', '問他'];
const DEFAULT_WARM = { pos: ['問', '聽', '等{他}', '等他', '蹲下來', '陪', '一起', '說完'], neg: ['！', '一定', '直接', '算了', '不准', '不行', '你怎麼', '不要再', '絕對', '永遠'], pair: [['先', '再']] };
export const markerWords = (data) => data?.tags?.cardRules?.markerWords || DEFAULT_MARKERS;
/** 溫暖／先聽的語氣分數：暖語線索每個 +1（先…再… 成對也 +1），否定線索（驚嘆號、斥責與絕對語）每個 −1 */
export function warmScore(label, data) {
  const W = data?.tags?.cardRules?.warmCues || DEFAULT_WARM, l = String(label || '');
  let sc = 0;
  for (const w of W.pos || []) if (l.includes(w)) sc++;
  for (const [x, y] of W.pair || []) { const i = l.indexOf(x); if (i >= 0 && l.indexOf(y, i + 1) > i) sc++; }
  for (const w of W.neg || []) if (l.includes(w)) sc--;
  return sc;
}
const lenOf = (l) => [...String(l || '')].length;
export const SURFACE_BOTS = {
  surface: { desc: '只看字面：選含好聽用語（蹲下來、聽完、一起、約好…）的，否則選最長的', surface: true,
    pick: (o, { r, st, raw, data }) => { const M = markerWords(data); return argmax(o, (k) => { const l = resolvedChoice(st, data, raw, k.i).label || ''; return M.filter((w) => l.includes(w)).length * 1000 + lenOf(l) + r() * 1e-6; }).i; } },
  shortest: { desc: '永遠選最短的選項（長度不能是線索，兩個方向都一樣）', surface: true,
    pick: (o, { r, st, raw, data }) => argmax(o, (k) => -lenOf(resolvedChoice(st, data, raw, k.i).label) + r() * 1e-6).i },
  warmest: { desc: '只看語氣：選暖語線索（問、聽、等他、蹲下來、陪、先…再…）最多、斥責與絕對語最少的', surface: true,
    pick: (o, { r, st, raw, data }) => argmax(o, (k) => warmScore(resolvedChoice(st, data, raw, k.i).label, data) + r() * 1e-6).i },
};
/** 「真人混合」：每 9 局循環（累了偷懶 3、照習慣 3、偶爾查研究 2、隨機 1） */
export const HUMAN_MIX = ['tiredLazy', 'commonReaction', 'occasionalResearch', 'tiredLazy', 'commonReaction', 'random', 'occasionalResearch', 'commonReaction', 'tiredLazy'];
/** 機器人亂數的種子偏移（所有工具共用，同一個種子＋同一個策略＝同一局） */
export const SALT = 0x9e3779b1;
/* ───── 階段可塑性用的分段機器人（M3 B1；tools/checks/plasticity.mjs）─────
   phases：[[從第幾回合起, 機器人名稱], …]（依回合序號；50＝國中、63＝高中）。每一段用該機器人自己的選法，亂數流各自獨立、決定性。
   不放進 BOTS／HUMAN_BOTS：校準與影響上限的局數不應該多出這些策略。 */
export const HARSH_TAGS = ['罵一頓', '說教一段', '拿別人比較'];
const PHASE_BASE = {
  harsh: { desc: '嚴厲（罵一頓這類：責罵、說教、拿別人比較；沒有這類選項時挑最不溫暖的）', score: (T, ch) => 10 * hasTag(ch, HARSH_TAGS) - 0.5 * BOTS.warmFirm.score(T, ch) },
};
export const PLASTICITY_BOTS = {
  earlyGood: { desc: '一路溫暖＋堅定', phases: [[0, 'warmFirm']] },
  lateStarter: { desc: '國中前照習慣反應，第 50 回合（國中）起溫暖＋堅定', phases: [[0, 'commonReaction'], [50, 'warmFirm']] },
  veryLateStarter: { desc: '國中、高中前照習慣反應，第 63 回合（高中）起溫暖＋堅定', phases: [[0, 'commonReaction'], [63, 'warmFirm']] },
  neverChange: { desc: '一路照習慣反應', phases: [[0, 'commonReaction']] },
  earlyLapse: { desc: '國中前溫暖＋堅定，第 50 回合起照習慣反應', phases: [[0, 'warmFirm'], [50, 'commonReaction']] },
  earlyHarshLate: { desc: '國小溫暖＋堅定，國中起嚴厲', phases: [[0, 'warmFirm'], [50, 'harsh']] },
  elemHarsh: { desc: '鏡像：同樣的嚴厲決定數（22 個回合）放在國小（第 28–49 回合），其餘溫暖＋堅定', phases: [[0, 'warmFirm'], [28, 'harsh'], [50, 'warmFirm']] },
};
export const ALL_BOTS = { ...BOTS, ...HUMAN_BOTS, ...SURFACE_BOTS, ...BLIND_BOTS, ...PLASTICITY_BOTS, ...PHASE_BASE };

/** only：選填，卡片 id 的集合——只在這些卡上照 bot 的做法選，其他卡隨機（tools/surface.mjs 逐檔量字面機器人用） */
export function botPolicy(botName, seedSalt, only = null) {
  const bot = ALL_BOTS[botName];
  if (bot.phases) { // 分段機器人：依回合序號換成該段的機器人
    const subs = bot.phases.map(([, b]) => botPolicy(b, seedSalt, only));
    return { choose(st, view, raw, data) { let k = 0; bot.phases.forEach(([from], i) => { if (st.turn >= from) k = i; }); return subs[k].choose(st, view, raw, data); } };
  }
  let holder = null;
  return {
    choose(st, view, raw, data) {
      holder ??= { r: (st.seed ^ seedSalt) >>> 0 };
      const r = stateRng(holder, 'r');
      const opts = view.choices.filter((c) => !c.disabled);
      if (botName === 'random' || (only && !only.has(raw.id))) return opts[Math.floor(r() * opts.length)].i;
      if (bot.pick) return bot.pick(opts, { r, st, raw, data });
      const blind = !!bot.blind;
      const RC = (o) => resolvedChoice(st, data, raw, o.i, blind);
      const selfCare = (o) => (RC(o).tags || []).some((t) => data.tags.tags[t]?.relief);
      if (botName === 'warmFirmRest') {
        // 「父母自己」池的卡出現時（權重已隨疲勞變大）：選讓情緒穩定度回升最多的自我照顧選項；
        // 孩子的事件卡裡，耐心見底時才用卡裡自然的『先到這裡』選項（沒有就照常選）。
        if (raw.pool === '父母自己') {
          const cand = opts.filter(selfCare);
          if (cand.length) return cand.reduce((a, b) => (tagVec(data.tags, RC(b)).父母情緒穩定度 > tagVec(data.tags, RC(a)).父母情緒穩定度 ? b : a)).i;
        } else if (st.parent.耐心 < 35) {
          const rest = opts.find((o) => (RC(o).tags || []).includes(data.tags.cardRules.restTag));
          if (rest) return rest.i;
        }
      }
      // warmFirm（不休息的版本）：自己的事一律放著，不選任何自我照顧的選項（除非整張卡只剩這些）
      if (botName === 'warmFirm' || botName === 'warmFirmBlind') { const keep = opts.filter((o) => !selfCare(o)); if (keep.length) { opts.length = 0; opts.push(...keep); } }
      let best = null, bs = -1e9;
      for (const o of opts) {
        const s = bot.score(data.tags, RC(o)) + r() * 1e-6; // 平手時用亂數決定（決定性）
        if (s > bs) { bs = s; best = o.i; }
      }
      return best;
    },
  };
}
