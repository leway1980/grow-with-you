// 用法：node tools/derive-caps.mjs [--init] [--write]
// 影響上限（data/model.json influenceCaps、每條 h: 邊的 maxTurn／maxGame）的推導（E1 審查問題 7、10）：
//   上限 ＝ 50 回合（E1 之前，玩到小六）的量測最大值 × 月數比（216／144 ＝ 1.5）× 餘裕 1.3，向上取到 0.1。
// 不用 --write-caps 把 72 回合的實測最大值直接回寫：那樣上限永遠等於現況 × 1.3，使用率全是 77%，E1 帶進來的變化（例如循環卡的劑量重算）會被自己認證。
// 實測值比推導出來的上限大，代表還有問題要修（check-design 會報 ✗），不是上限要調。
//   - perTag／perCard／perPool：basis50 記的是 50 回合量測的最大值（measured）；
//   - 邊的 maxGame：basis50.edgeMaxGame 記的是 50 回合時的上限（＝當時量測值 × 1.3），再乘月數比；
//   - 邊的 maxTurn 與 perChoiceStatic：單位是『參考劑量（一個 2 個月的回合）』與靜態名義值，不隨遊戲長度變，沿用 50 回合的值（basis50.edgeMaxTurn）。
// --init：從 git 的 E1 之前的 model.json 讀出 basis50 寫進 model.json（只做一次，之後 basis50 就是紀錄）；--write：依 basis50 重新推導並寫回。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readModel, writeModel } from './model-io.mjs';
import { AXES } from '../js/engine/model.js';

export const BASIS_REF = '7dafcc7~1'; // E1 之前的 commit（50 回合、A2.5 審查修補後）
const ceil1 = (x) => Math.ceil(x * 10 - 1e-9) / 10;

/** 依 basis50 推導出所有上限（純函式；lint 也用它核對 model.json） */
export function deriveCaps(M) {
  const D = M.influenceCaps.derivation, B = D.basis50, r = D.monthRatio, h = D.headroom;
  const caps = { perTag: {}, perCard: {}, perPool: {} };
  for (const [k, src] of [['perTag', 'perTagMax'], ['perCard', 'perCardMax'], ['perPool', 'perPoolMax']]) for (const a of AXES) caps[k][a] = ceil1(B[src][a] * r * h);
  const edges = {};
  for (const id of Object.keys(B.edgeMaxGame)) edges[id] = { maxTurn: B.edgeMaxTurn[id], maxGame: ceil1(B.edgeMaxGame[id] * r) };
  return { caps, edges };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2), M = readModel();
  if (args.includes('--init')) {
    const old = JSON.parse(execFileSync('git', ['show', `${BASIS_REF}:data/model.json`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    const m = old.influenceCaps.measured;
    M.influenceCaps.derivation = {
      formula: 'cap = ceil1(50 回合的量測最大值 × monthRatio × headroom)；邊的 maxGame ＝ ceil1(50 回合的 maxGame（量測 × 1.3）× monthRatio)；maxTurn 與 perChoiceStatic 沿用 50 回合的值（單位是參考劑量，不隨遊戲長度變）',
      monthRatio: 1.5,
      monthRatio_why: '可玩範圍 216 個月（72 回合，到 18 歲離家）÷ 144 個月（50 回合，到小六）',
      headroom: 1.3,
      basis50: {
        ref: `${BASIS_REF}（E1 之前、玩到小六的 50 回合；A2.5 審查修補後）`, games: m.games,
        perTagMax: m.perTagMax, perCardMax: m.perCardMax, perPoolMax: m.perPoolMax,
        edgeMaxTurn: Object.fromEntries(old.edges.filter((e) => e.id.startsWith('h:')).map((e) => [e.id, e.maxTurn])),
        edgeMaxGame: Object.fromEntries(old.edges.filter((e) => e.id.startsWith('h:')).map((e) => [e.id, e.maxGame])),
      },
    };
    console.log('已把 50 回合的基準寫進 influenceCaps.derivation.basis50（', Object.keys(M.influenceCaps.derivation.basis50.edgeMaxGame).length, '條邊）');
  }
  if (!M.influenceCaps.derivation) { console.error('沒有 influenceCaps.derivation：先執行 --init'); process.exit(1); }
  const { caps, edges } = deriveCaps(M);
  console.log('perTag', JSON.stringify(caps.perTag), 'perCard', JSON.stringify(caps.perCard), 'perPool', JSON.stringify(caps.perPool));
  if (args.includes('--write') || args.includes('--init')) {
    Object.assign(M.influenceCaps, caps);
    delete M.influenceCaps.measured; // 72 回合的實測值不再寫回（基準是 50 回合）；實測在 check-design 的報告裡
    for (const e of M.edges) if (edges[e.id]) { e.maxTurn = edges[e.id].maxTurn; e.maxGame = edges[e.id].maxGame; }
    writeModel(M);
    console.log('已寫進 data/model.json');
  }
}
