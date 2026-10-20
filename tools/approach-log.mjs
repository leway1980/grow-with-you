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
