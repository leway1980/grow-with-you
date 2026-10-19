// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) auto.js 的「讓他自己過」作法：決定性、不看玩家，用存檔內的亂數流；
// 改動：選項改成可見的 view 選項，從一回合一張卡的流程玩到『待續』。純函式、無 DOM。
import { stateRng } from './rng.js';
import { startTurn, chooseCard, finishTurn } from './turn.js';

/** 角色自己選：可選項裡平均抽一個。回傳選項的原始索引 i。 */
export function selfChoice(st, cardView) {
  st.autoS ??= (st.seed ^ 0x51ed270b) >>> 0;
  const r = stateRng(st, 'autoS');
  const opts = cardView.choices.filter((c) => !c.disabled);
  return opts[Math.floor(r() * opts.length)].i;
}

/** 從任何狀態（含回合進行到一半）一路替他過完，直到『待續』。 */
export function playRestAuto(st, data) {
  let guard = 0;
  while (!st.ended && guard++ < 200) {
    const res = startTurn(st, data);
    if (res.ended) break;
    if (res.card) chooseCard(st, data, selfChoice(st, res.card));
    finishTurn(st, data);
  }
  return st;
}
