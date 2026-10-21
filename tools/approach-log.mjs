// 『不太來找你』的進出紀錄與右設限（censor-aware）的離開比例。
// 為什麼要有這個：舊的指標是『整局結束時，進入過的局裡曾經離開的比例』。遊戲在國小畢業就結束，晚進入的孩子沒有機會離開（右設限），
// 可玩回合縮短或進入時間後移，這個比例就會往下掉，但這不是機制壞了。這裡改看：進入時『距離可玩終點還有 ≥ 24 個月』的進入，
// 其中在進入後 24 個月內離開的比例。
// 這個檔案只依賴 data.timeline 與 st.vars，impact.mjs 會把它複製到別的 git 版本去跑。
export const CENSOR_WINDOW_MONTHS = 24;

/** 每個回合玩完後呼叫 observe(st, 剛玩完的回合序號)；episodes＝[{ enter, exit }]（月齡；exit 沒離開是 null） */
export function approachTracker(data) {
  let inState = false, cur = null;
  const episodes = [];
  return {
    episodes,
    observe(st, turn) {
      const now = !!(st.vars && st.vars.不太來找你);
      const m = data.timeline[Math.min(turn, data.timeline.length - 1)].ageMonths;
      if (!inState && now) { cur = { enter: m, exit: null }; episodes.push(cur); }
      if (inState && !now && cur) cur.exit = m;
      inState = now;
    },
  };
}

/** 可玩範圍結束的月齡（第一個玩不到的回合的月齡） */
export const playableEndMonths = (data) => data.timeline[Math.min(data.calendar.playableTurns, data.timeline.length - 1)].ageMonths;

/** 一局的右設限統計：eligible＝進入時離可玩終點 ≥ window 個月的進入；exited＝其中在 window 個月內離開的 */
export function censorStats(episodes, endMonths, window = CENSOR_WINDOW_MONTHS) {
  const el = episodes.filter((e) => e.enter <= endMonths - window);
  return { entries: episodes.length, eligible: el.length, exited: el.filter((e) => e.exit != null && e.exit - e.enter <= window).length };
}

/** 某個階段的起點月齡（時間軸裡第一個該階段的回合）；沒有這個階段就是 null */
export const stageStartMonths = (data, stage) => { const t = data.timeline.find((x) => x.stage === stage); return t ? t.ageMonths : null; };

/**
 * 依進入的階段分開算右設限的離開比例（E1 審查：不同進入階段的離開機會本來就不同，不能混在一起比）：
 *  - elem：國小畢業以前（含幼兒園）的進入，用『國中開始的月齡』當終點，定義和 A0（遊戲在小六結束）完全相同；
 *  - teen／jh／sh：國中以後（國中、高中、離家前）的進入，終點是可玩範圍的結束。
 * 每一組回傳 { entries, eligible, exited }（censorStats 的格式）。
 */
export function censorByStage(episodes, data, window = CENSOR_WINDOW_MONTHS) {
  const jh = stageStartMonths(data, '國中'), sh = stageStartMonths(data, '高中'), end = playableEndMonths(data);
  const pick = (f) => episodes.filter((e) => f(e.enter));
  return {
    elem: censorStats(pick((m) => jh == null || m < jh), jh == null ? end : jh, window),
    teen: censorStats(pick((m) => jh != null && m >= jh), end, window),
    jh: censorStats(pick((m) => jh != null && m >= jh && (sh == null || m < sh)), end, window),
    sh: censorStats(pick((m) => sh != null && m >= sh), end, window),
  };
}
