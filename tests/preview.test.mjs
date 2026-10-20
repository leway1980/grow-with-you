// 預覽（?preview=1）：回合迴圈用 playableEnd 玩到 previewTurns（72，含國中、高中、離家）；CI 與 check-design 仍是 playableTurns（50）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { startTurn, chooseCard, nextCard, finishTurn, playableEnd } from '../js/engine/turn.js';
import { botPolicy } from '../tools/bots.mjs';

const data = loadData();

test('playableEnd：預覽是 previewTurns，平常是 playableTurns', () => {
  assert.equal(playableEnd(data), data.calendar.playableTurns);
  assert.equal(playableEnd(data, { preview: false }), 50);
  assert.equal(playableEnd(data, { preview: true }), 72);
  assert.equal(data.calendar.previewTurns, 72);
});

test('沒開預覽：照舊在 playableTurns 結束', () => {
  const st = newState(3, data, {});
  const pol = botPolicy('random', 3);
  while (!st.ended) {
    const r = startTurn(st, data);
    if (r.ended) break;
    if (r.card) { let v = r.card, raw = r.raw; for (let g = 0; g < 3; g++) { const o = chooseCard(st, data, pol.choose(st, v, raw, data)); if (!o.more) break; ({ card: v, raw } = nextCard(st, data)); } }
    finishTurn(st, data);
  }
  assert.equal(st.turn, data.calendar.playableTurns);
});

test('每個階段（含國中、高中、離家）都有池和卡', () => {
  for (const s of ['國中', '高中', '離家']) {
    const pools = Object.entries(data.index[s] || {}).filter(([, cs]) => cs.length);
    assert.ok(pools.length || s === '離家', `${s} 沒有池`);
  }
  assert.ok(data.index['國中']['日常_國中'].length >= 12);
  assert.ok(data.index['高中']['日常_高中'].length >= 8);
  for (const tl of data.timeline.filter((t) => t.stage === '離家')) assert.ok(tl.fixed.length === 1, `離家第 ${tl.turn} 回合要有一張固定卡`);
});

test('預覽 200 局：每局玩到第 72 回合、沒有例外、安靜回合 ≤ 20%、沒有空池的階段', () => {
  const pd = loadData(); pd.preview = true;
  let quiet = 0, turns = 0;
  const quietBy = {}, drawnBy = {};
  for (let seed = 1; seed <= 200; seed++) {
    const st = newState(seed, pd, { role: seed % 2 ? '爸爸' : '媽媽', startMode: seed % 3 ? 'birth' : 'elementary' });
    const pol = botPolicy(['random', 'warmFirm', 'permissive', 'controlling'][seed % 4], seed);
    while (!st.ended) {
      const tl = pd.timeline[st.turn];
      const r = startTurn(st, pd);
      if (r.ended) break;
      turns++;
      (drawnBy[tl.stage] ||= 0); drawnBy[tl.stage]++;
      if (!r.card) { quiet++; quietBy[tl.stage] = (quietBy[tl.stage] || 0) + 1; }
      else { let v = r.card, raw = r.raw; for (let g = 0; g < 3; g++) { const o = chooseCard(st, pd, pol.choose(st, v, raw, pd)); if (!o.more) break; ({ card: v, raw } = nextCard(st, pd)); } }
      finishTurn(st, pd);
    }
    assert.equal(st.turn, 72, `種子 ${seed} 沒有玩到 72`);
    assert.equal(st.endReason, '待續');
  }
  assert.ok(quiet / turns <= 0.2, `安靜回合 ${quiet}/${turns}`);
  for (const s of ['國中', '高中', '離家']) assert.ok((quietBy[s] || 0) / drawnBy[s] <= 0.2, `${s} 安靜回合 ${(quietBy[s] || 0)}/${drawnBy[s]}`);
});
