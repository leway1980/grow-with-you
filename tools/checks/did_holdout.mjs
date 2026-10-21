// 差中差目標的保留區塊（holdout）：目標的參數（w＝0.1 點／月，因果圖邊 k:不太來找你→了解度）是用種子 1、3001、6001、9001 起的區塊校準的；
// 這裡另外跑一個沒用來校準的區塊（預設種子 12001–15000），用同一個判定、不重新調整任何參數，確認不是只對校準用的種子成立。
// 目標在 tools/targets/did.json；方向的定義（名稱、lag、minDiff）讀 tools/design-targets.json 的同一條，所以 minDiff 只有一個來源。
import { runMix } from '../simulate.mjs';
import { matchedDiD } from '../mech.mjs';

export default async function check(ctx) {
  const H = ctx.TARGETS.didHoldout;
  if (!H) return [];
  const d = (ctx.TARGETS.mechanisms.directions || []).find((x) => x.name === H.direction);
  if (!d) return [{ ok: false, group: '方向', name: '差中差保留區塊', value: `找不到方向「${H.direction}」`, range: '', note: '' }];
  const recs = await runMix(H.games, H.s0, { mech: true });
  const r = matchedDiD(recs, d), f = (x) => (x >= 0 ? '+' : '') + x.toFixed(2);
  const ok = r.n >= (d.minN ?? 30) && r.upper < 0 && -r.mean >= d.minDiff;
  return [{ ok, group: '方向', name: `保留區塊（種子 ${H.s0}–${H.s0 + H.games - 1}，不重新調整）：${d.name}`, value: `${f(r.mean)}（95% 單邊上界 ${f(r.upper)}；處理 ${r.n} 局）`, range: `≤ −${d.minDiff} 且單邊 95% 上界 < 0`, note: H.note }];
}
