// 選項明顯度測試的匯出器（DESIGN §3.6「選項明顯度測試」）：把每張卡匯成「盲測」JSON，交給外部評分（人或另一個模型）。
// 盲測檔只有：卡片編號、標題、內文（變數槽用固定種子填好）、洗亂順序的選項文字。沒有標籤、沒有效果、沒有結果文字。
// 另外寫一個對照檔（key），只記每個位置是原來的第幾個選項，評分完才拿來還原；不含任何標籤或數值。
// 用法：node tools/obviousness.mjs [輸出資料夾=$SCRATCHPAD 或系統暫存] [種子=1]
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadData } from './data-node.mjs';
import { newState } from '../js/engine/state.js';
import { shuffleOrder } from '../js/engine/rng.js';
import { buildCtx, fill, pickText, cardScope } from '../js/engine/events.js';

/** 回傳 { blind, key }：blind 是給評分者的，key 是還原用的 */
export function exportBlind(data = loadData(), seed = 1) {
  const blind = [], key = {};
  for (const card of data.events.cards) {
    const stage = (card.stages || ['國小中高'])[0];
    const tl = data.timeline.find((t) => t.stage === stage) || data.timeline[data.timeline.length - 1];
    const st = newState(seed, data, { role: '媽媽', startMode: stage === '國小低' || stage === '國小中高' ? 'elementary' : 'birth' });
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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = process.argv[2] || process.env.SCRATCHPAD || tmpdir();
  const seed = parseInt(process.argv[3] || '1', 10);
  mkdirSync(out, { recursive: true });
  const { blind, key } = exportBlind(loadData(), seed);
  writeFileSync(join(out, 'obviousness-blind.json'), JSON.stringify(blind, null, 1) + '\n');
  writeFileSync(join(out, 'obviousness-key.json'), JSON.stringify(key, null, 1) + '\n');
  console.log(`匯出 ${blind.length} 張卡（種子 ${seed}）→ ${join(out, 'obviousness-blind.json')}（盲測）與 obviousness-key.json（還原用，評分前不要給評分者）`);
}
