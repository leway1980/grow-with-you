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
/* ───── 手機與平板、假日邀約的對照機器人（DESIGN §4.39、§4.40；tools/checks/c3.mjs）─────
   設計原則（2026-10-21 審查後）：各組『只在螢幕這件事上不同』，其他選擇完全一樣——全部用同一個 fallback（commonReaction），
   而且除了『給了就不管』（c3Base）以外，沒有任何一組選 3C當保母（avoid）；這樣組間的差才是螢幕做法造成的，不是其他卡的選法不同。
   prefer：依序（越前面越優先）挑帶這些標籤的選項；screenOnly：只在 screen 卡上這樣挑；poolOnly：只在這個池的卡上這樣挑；onlyCard：只在這張卡上這樣挑；
   once：只用一次（一次大活動）；其餘（沒有帶偏好標籤的選項、不是範圍內的卡）交給 fallback。
   配對：用了 prefer 的那一次不會呼叫 fallback，所以同一個種子下 c3Trip 與 c3NoTrip 的亂數流一致（只差在旅行卡的那一個選擇）。
   不放進 BOTS／HUMAN_BOTS：校準與影響上限的局數不應該多出這些策略。 */
const AVOID_NANNY = ['3C當保母'];
export const C3_BOTS = {
  c3Base: { desc: '給了就不管（任何卡有螢幕當保母就選；螢幕卡上選沒人在旁、沒有後續的做法；其他卡照習慣反應）', everywhere: ['3C當保母'], prefer: ['3C當保母', '沒有下文', '吵了才讓步', '兩手一攤'], screenOnly: true, fallback: 'commonReaction' },
  c3Agreed: { desc: '約定且大人在旁（螢幕卡）；不拿螢幕當保母', prefer: ['3C約定且在旁'], avoid: AVOID_NANNY, screenOnly: true, fallback: 'commonReaction' },
  c3Task: { desc: '任務型借用、用完收回（沒有這個選項時退到約定且在旁）；不拿螢幕當保母', prefer: ['3C任務借用', '3C約定且在旁'], avoid: AVOID_NANNY, screenOnly: true, fallback: 'commonReaction' },
  c3Limit: { desc: '只加時間管控（螢幕卡），沒有陪伴；不拿螢幕當保母', prefer: ['事前訂規則', '說到做到', '規定不談判', '3C限定場所'], avoid: AVOID_NANNY, screenOnly: true, fallback: 'commonReaction' },
  c3Confiscate: { desc: '只強制收回（螢幕卡）；不拿螢幕當保母', prefer: ['沒收裝置'], avoid: AVOID_NANNY, screenOnly: true, fallback: 'commonReaction' },
  c3Companion: { desc: '持續的陪伴互動（螢幕卡）；不拿螢幕當保母', prefer: ['3C陪伴同行', '一起參與', '觀察與參與', '放下手機陪'], avoid: AVOID_NANNY, screenOnly: true, fallback: 'commonReaction' },
  c3Trip: { desc: '只有一次大活動：第一次遇到旅行卡就去，其餘和 c3NoTrip 一樣（不拿螢幕當保母）', prefer: ['3C一次大活動'], onlyCard: 'big_trip_c3', once: true, avoid: AVOID_NANNY, screenOnly: true, fallback: 'commonReaction' },
  c3NoTrip: { desc: '和 c3Trip 配對的對照：第一次遇到旅行卡選『週末照舊、沒有下文』，其餘和 c3Trip 一模一樣', prefer: ['沒有下文'], onlyCard: 'big_trip_c3', once: true, avoid: AVOID_NANNY, screenOnly: true, fallback: 'commonReaction' },
  c3LateCompanion: { desc: '前半（到第 40 回合，國小中年級）給了就不管，之後改成持續的陪伴：量『已經升高的依賴度』能不能被拉下來', phases: [[0, 'c3Base'], [40, 'c3Companion']] },
  wkAccept: { desc: '假日的邀約一律接（只在假日邀約的卡上，其他卡照習慣反應）', prefer: ['假日缺席', '沒有下文'], poolOnly: '假日邀約', fallback: 'commonReaction' },
  wkMonthly: { desc: '假日的邀約接，但每個月只接一次；孩子來找時留下來（只在假日邀約的卡上，其他卡照習慣反應）', prefer: ['假日缺席_少', '問具體的事'], poolOnly: '假日邀約', fallback: 'commonReaction' },
  wkDecline: { desc: '假日的邀約一律婉拒（只在假日邀約的卡上，其他卡照習慣反應）', prefer: ['婉拒邀約'], poolOnly: '假日邀約', fallback: 'commonReaction' },
};
/* 放任型 3C 的對照（DESIGN §4.39 依賴度的後果；tools/checks/c3.mjs 的 permissive 項）：
   同一個基底機器人（真人混合裡的四種），對照組在螢幕卡上選『只加時間管控』、不拿螢幕當保母；放任組只在螢幕卡上選沒人在旁、沒有後續的做法；
   其他卡兩組完全一樣（同一個 fallback）。 */
export const C3_PERM_BASES = ['tiredLazy', 'commonReaction', 'occasionalResearch', 'random', 'warmFirm'];
for (const b of C3_PERM_BASES) {
  C3_BOTS[`c3Ctrl_${b}`] = { desc: `對照：${b}，螢幕卡上只加時間管控、不拿螢幕當保母`, prefer: ['事前訂規則', '說到做到', '規定不談判', '3C限定場所'], avoid: AVOID_NANNY, screenOnly: true, fallback: b };
  C3_BOTS[`c3Perm_${b}`] = { desc: `放任型 3C：${b}，只在螢幕卡上選沒人在旁、沒有後續的做法，其他卡和對照組完全一樣`, prefer: ['3C當保母', '沒有下文', '吵了才讓步', '兩手一攤'], screenOnly: true, fallback: b };
}
export const ALL_BOTS = { ...BOTS, ...HUMAN_BOTS, ...SURFACE_BOTS, ...BLIND_BOTS, ...PLASTICITY_BOTS, ...PHASE_BASE, ...C3_BOTS };

/** only：選填，卡片 id 的集合——只在這些卡上照 bot 的做法選，其他卡隨機（tools/surface.mjs 逐檔量字面機器人用） */
export function botPolicy(botName, seedSalt, only = null) {
  const bot = ALL_BOTS[botName];
  if (bot.phases) { // 分段機器人：依回合序號換成該段的機器人
    const subs = bot.phases.map(([, b]) => botPolicy(b, seedSalt, only));
    return { choose(st, view, raw, data) { let k = 0; bot.phases.forEach(([from], i) => { if (st.turn >= from) k = i; }); return subs[k].choose(st, view, raw, data); } };
  }
  if (bot.prefer) { // 偏好標籤的機器人（C3_BOTS）
    const fb = botPolicy(bot.fallback || 'commonReaction', seedSalt, only);
    let spent = false;
    const tagsOf = (st, data, raw, o) => resolvedChoice(st, data, raw, o.i).tags || [];
    return {
      choose(st, view, raw, data) {
        const opts = view.choices.filter((c) => !c.disabled);
        const pick = (list) => { // 依 list 的順序（越前面越優先）挑；沒有就是 null
          let best = null, br = 0;
          for (const o of opts) { const tg = tagsOf(st, data, raw, o); for (let k = 0; k < list.length; k++) if (tg.includes(list[k]) && list.length - k > br) { br = list.length - k; best = o; } }
          return best;
        };
        if (bot.everywhere) { const e = pick(bot.everywhere); if (e && !raw.screen) return e.i; }
        if ((!bot.screenOnly || raw.screen) && (!bot.poolOnly || raw.pool === bot.poolOnly) && (!bot.onlyCard || raw.id === bot.onlyCard) && !(bot.once && spent)) { const b = pick(bot.prefer); if (b) { spent = true; return b.i; } }
        if (bot.avoid) { const keep = opts.filter((o) => !tagsOf(st, data, raw, o).some((t) => bot.avoid.includes(t))); if (keep.length && keep.length < opts.length) return fb.choose(st, { ...view, choices: keep }, raw, data); }
        return fb.choose(st, view, raw, data);
      },
    };
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
