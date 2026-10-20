// 策略機器人（tools/simulate.mjs、check-design、impact 共用）。
// BOTS：校準用的極端策略（DESIGN §3.4）。HUMAN_BOTS：比較像真人的混合（§3.7 第 5 點）：累了就選最省力的、多半照習慣反應、偶爾去查研究。
// 這個檔案只依賴引擎的舊介面（view／raw／st／data），impact.mjs 會把它複製到別的 git 版本去跑。
import { stateRng } from '../js/engine/rng.js';
import { tagVec, doseScore, hiddenScore, costOf } from './metrics.mjs';

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


/* ───── 比較像真人的機器人 ───── */
/** 家長最常見、最直覺的反應（標籤）：human 機器人「照習慣」時偏向它們 */
export const COMMON_TAGS = ['說沒關係就結束', '送去補習', '罵一頓', '敷衍帶過', '外包', '替他決定', '只看成績', '說教一段', '3C當保母', '提議別的', '一邊滑手機一邊回', '拿別人比較', '怪老師', '全部替他做', '沒有下文', '說了不算', '吵了才讓步', '硬撐'];
const argmax = (xs, f) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));
export const HUMAN_BOTS = {
  tiredLazy: { desc: '累了就偷懶：多半選最省力的，累的時候更是', human: true,
    pick: (o, { r, st, raw }) => {
      const tired = st.parent.耐心 < 45 || st.parent.體力 < 45;
      const x = r();
      if (x < (tired ? 0.8 : 0.5)) return o.reduce((a, b) => (costOf(raw.choices[b.i]) < costOf(raw.choices[a.i]) ? b : a)).i;
      return o[Math.floor(r() * o.length)].i;
    } },
  commonReaction: { desc: '多半照習慣反應：說沒關係、送補習、先忙手邊的事', human: true,
    pick: (o, { r, raw }) => {
      if (r() < 0.7) return argmax(o, (k) => raw.choices[k.i].tags.filter((t) => COMMON_TAGS.includes(t)).length + doseScore(raw.choices[k.i]) / 20 + r() * 1e-6).i;
      return o[Math.floor(r() * o.length)].i;
    } },
  occasionalResearch: { desc: '偶爾去查研究：多半隨機，有餘裕的時候選有研究支持的做法', human: true,
    pick: (o, { r, st, raw, data }) => {
      const tired = st.parent.耐心 < 40 || st.parent.體力 < 40;
      if (r() < (tired ? 0.08 : 0.3)) return argmax(o, (k) => hiddenScore(data.tags, raw.choices[k.i], raw.stages || null) + r() * 1e-6).i;
      return o[Math.floor(r() * o.length)].i;
    } },
};
/** 只看字面的機器人（§3.7 第 5 點；§11 規則：好選項不能靠字面認出來）：選最長的選項，或含「蹲下來、聽完、說完、再決定、不評論、一起、約好」的選項 */
export const SURFACE_WORDS = ['蹲下來', '聽完', '說完', '再決定', '不評論', '一起', '約好'];
export const SURFACE_BOTS = {
  surface: { desc: '只看字面：選含好聽用語（蹲下來、聽完、一起、約好…）的，否則選最長的', surface: true,
    pick: (o, { r, raw }) => argmax(o, (k) => { const l = raw.choices[k.i].label || ''; return SURFACE_WORDS.filter((w) => l.includes(w)).length * 1000 + l.length + r() * 1e-6; }).i },
};
/** 「真人混合」：每 9 局循環（累了偷懶 3、照習慣 3、偶爾查研究 2、隨機 1） */
export const HUMAN_MIX = ['tiredLazy', 'commonReaction', 'occasionalResearch', 'tiredLazy', 'commonReaction', 'random', 'occasionalResearch', 'commonReaction', 'tiredLazy'];
/** 機器人亂數的種子偏移（所有工具共用，同一個種子＋同一個策略＝同一局） */
export const SALT = 0x9e3779b1;
export const ALL_BOTS = { ...BOTS, ...HUMAN_BOTS, ...SURFACE_BOTS };

export function botPolicy(botName, seedSalt) {
  const bot = ALL_BOTS[botName];
  let holder = null;
  return {
    choose(st, view, raw, data) {
      holder ??= { r: (st.seed ^ seedSalt) >>> 0 };
      const r = stateRng(holder, 'r');
      const opts = view.choices.filter((c) => !c.disabled);
      if (botName === 'random') return opts[Math.floor(r() * opts.length)].i;
      if (bot.pick) return bot.pick(opts, { r, st, raw, data });
      const selfCare = (o) => (raw.choices[o.i].tags || []).some((t) => data.tags.tags[t]?.relief);
      if (botName === 'warmFirmRest') {
        // 「父母自己」池的卡出現時（權重已隨疲勞變大）：選讓情緒穩定度回升最多的自我照顧選項；
        // 孩子的事件卡裡，耐心見底時才用卡裡自然的『先到這裡』選項（沒有就照常選）。
        if (raw.pool === '父母自己') {
          const cand = opts.filter(selfCare);
          if (cand.length) return cand.reduce((a, b) => (tagVec(data.tags, raw.choices[b.i]).父母情緒穩定度 > tagVec(data.tags, raw.choices[a.i]).父母情緒穩定度 ? b : a)).i;
        } else if (st.parent.耐心 < 35) {
          const rest = opts.find((o) => (raw.choices[o.i].tags || []).includes(data.tags.cardRules.restTag));
          if (rest) return rest.i;
        }
      }
      // warmFirm（不休息的版本）：自己的事一律放著，不選任何自我照顧的選項（除非整張卡只剩這些）
      if (botName === 'warmFirm') { const keep = opts.filter((o) => !selfCare(o)); if (keep.length) { opts.length = 0; opts.push(...keep); } }
      let best = null, bs = -1e9;
      for (const o of opts) {
        const s = bot.score(data.tags, raw.choices[o.i]) + r() * 1e-6; // 平手時用亂數決定（決定性）
        if (s > bs) { bs = s; best = o.i; }
      }
      return best;
    },
  };
}
