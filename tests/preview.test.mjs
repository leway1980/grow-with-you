// 完整 72 回合（E1 起是預設）：回合迴圈用 playableEnd 玩到 playableTurns（72，含國中、高中、離家）；?preview=1 與舊的預覽旗標都沒有作用。
// （檔名沿用 P1 預覽的 preview.test.mjs；內容是國中、高中、離家的內容覆蓋、擺幅與結局。）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState, serialize, deserialize } from '../js/engine/state.js';
import { cardDoseK } from '../js/engine/timescale.js';
import { startTurn, chooseCard, nextCard, finishTurn, playableEnd } from '../js/engine/turn.js';
import { botPolicy } from '../tools/bots.mjs';

const data = loadData();

test('playableEnd：就是日曆的 playableTurns（72）；舊的預覽旗標沒有作用', () => {
  assert.equal(data.calendar.playableTurns, 72);
  assert.equal(playableEnd(data), 72);
  assert.equal(playableEnd(data, { preview: false }), 72);
  assert.equal(playableEnd(data, { preview: true }), 72);
  assert.equal(data.calendar.previewTurns, 72); // 只為相容保留
});

test('預設就玩到第 72 回合（離家那天），結局待續；舊的預覽選項與存檔欄位都沒有作用', () => {
  const st = newState(3, data, { preview: true });
  assert.equal(st.preview, undefined);
  assert.equal(JSON.parse(serialize(st)).preview, undefined);
  const pol = botPolicy('random', 3);
  while (!st.ended) {
    const r = startTurn(st, data);
    if (r.ended) break;
    if (r.card) { let v = r.card, raw = r.raw; for (let g = 0; g < 3; g++) { const o = chooseCard(st, data, pol.choose(st, v, raw, data)); if (!o.more) break; ({ card: v, raw } = nextCard(st, data)); } }
    finishTurn(st, data);
  }
  assert.equal(st.turn, 72);
  assert.equal(st.endReason, '待續');
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

/* ───── 預覽 200 局：每局玩到 72、安靜回合；同時量『單一決定的擺幅』（A2.5 審查 Q7）─────
   擺幅＝一次選擇之後，隱藏的『親子信任』變了多少（絕對值）。驗收：國中／高中的 P95 ≤ 國小中高的 1.5 倍（E1 拿掉預覽的 k 上限 previewKMax 之後，α＝1 的完整劑量），
   而且沒有任何一張卡把『還健康的』父母（耐心 ≥ 25）一次壓到 10 以下。耐心本來就低（照顧很吃力的 warmFirm 在國中平均約 30）時再被一張卡壓過 10 是照顧的代價，不是單張卡的問題，只計數印出來。這張擺幅表會印在測試輸出裡。 */
const q = (a, p) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.min(b.length - 1, Math.floor(p * b.length))] : NaN; };

test('200 局：每局玩到第 72 回合、沒有例外、安靜回合 ≤ 20%、沒有空池的階段；單一決定的擺幅在範圍內', (t) => {
  const pd = loadData();
  let quiet = 0, turns = 0;
  const quietBy = {}, drawnBy = {};
  let crossings = 0; const swing = {}, hits = [], lows = {}; // swing[stage] = |Δ親子信任| 的清單；lows[card] = 這張卡之後的最低耐心
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
      else {
        let v = r.card, raw = r.raw;
        for (let g = 0; g < 3; g++) {
          const trust0 = st.hidden.親子信任, pat0 = st.parent.耐心, id = raw.id;
          const o = chooseCard(st, pd, pol.choose(st, v, raw, pd));
          (swing[tl.stage] ||= []).push(Math.abs(st.hidden.親子信任 - trust0));
          if (pat0 >= 10 && st.parent.耐心 < 10) { crossings++; if (pat0 >= 25) hits.push(`${id}（種子 ${seed}：${pat0.toFixed(1)} → ${st.parent.耐心.toFixed(1)}）`); }
          lows[id] = Math.min(lows[id] ?? 100, st.parent.耐心);
          if (!o.more) break;
          ({ card: v, raw } = nextCard(st, pd));
        }
      }
      finishTurn(st, pd);
    }
    assert.equal(st.turn, 72, `種子 ${seed} 沒有玩到 72`);
    assert.equal(st.endReason, '待續');
  }
  assert.ok(quiet / turns <= 0.2, `安靜回合 ${quiet}/${turns}`);
  for (const s of ['國中', '高中', '離家']) assert.ok((quietBy[s] || 0) / drawnBy[s] <= 0.2, `${s} 安靜回合 ${(quietBy[s] || 0)}/${drawnBy[s]}`);
  const rows = ['國小低', '國小中高', '國中', '高中', '離家'].map((s) => ({ 階段: s, 決定數: swing[s].length, P50: q(swing[s], 0.5).toFixed(2), P95: q(swing[s], 0.95).toFixed(2), 最大: Math.max(...swing[s]).toFixed(2) }));
  t.diagnostic('單一決定的擺幅 |Δ親子信任|（隱藏，預覽 200 局）\n' + rows.map((r) => `${r.階段.padEnd(6, '　')} n=${String(r.決定數).padStart(5)}  P50 ${r.P50}  P95 ${r.P95}  最大 ${r.最大}`).join('\n'));
  const ref = q(swing['國小中高'], 0.95);
  for (const s of ['國中', '高中']) assert.ok(q(swing[s], 0.95) <= ref * 1.5, `${s} 的 P95 ${q(swing[s], 0.95).toFixed(2)} 超過國小中高 P95 ${ref.toFixed(2)} 的 1.5 倍`);
  t.diagnostic('耐心最低的 5 張卡（選完之後）：' + Object.entries(lows).sort((a, b) => a[1] - b[1]).slice(0, 5).map(([k, v]) => `${k} ${v.toFixed(1)}`).join('、'));
  t.diagnostic(`耐心跨過 10 的次數：${crossings}（共 ${Object.values(swing).reduce((a, x) => a + x.length, 0)} 個決定）；其中從 ≥ 25 一次壓過的：${hits.length}`);
  assert.deepEqual(hits, [], `有卡把健康的父母（耐心 ≥ 25）一次壓到 10 以下：${hits.slice(0, 5).join('；')}`);
});

test('劑量倍率沒有上限：高中 6 個月一回合的倍率就是 span / refMonths（E1 拿掉 previewKMax）；scale:false 的卡永遠是 1', () => {
  const hs = data.timeline.find((t) => t.stage === '高中' && t.span >= 5);
  const card = data.cardIndex.sh_scooter; // scale:true
  assert.equal(data.model.timeScale.previewKMax, undefined);
  assert.equal(cardDoseK(data.model, hs.span, card), hs.span / 2);
  assert.equal(cardDoseK(data.model, 6, card), 3);
  assert.equal(cardDoseK(data.model, 2, card), 1);
  assert.equal(cardDoseK(data.model, 6, { scale: false }), 1);
});

/* ───── 結局：標題寫最後玩的回合；成就欄的句子依玩到哪裡 ───── */
import { buildEnding } from '../js/engine/ending.js';
import { playToEnd } from '../js/engine/turn.js';
import { buildCtx } from '../js/engine/events.js';
import { albumSpecs } from '../js/engine/scene.js';
import { periodLabel, doseView } from '../js/engine/dose.js';

test('結局標題與成就句：玩到離家（72 回合）寫「離家」與離家的句子，不再是「國小畢業了」；成長相簿有國中、高中、離家', () => {
  const pv = newState(7, data, {});
  playToEnd(pv, data, botPolicy('warmFirm', 7));
  assert.equal(pv.turn, 72);
  const e2 = buildEnding(pv, data);
  assert.equal(e2.to, '離家');
  assert.ok(!/國小畢業了/.test(e2.achievement.note));
  assert.match(e2.achievement.note, /離開家了/);
  assert.equal(albumSpecs(pv, data).map((a) => a.stage).join(), '嬰兒,幼兒,國小,國中,高中,離家');
});

test('buildCtx：學制與去向是變數（由 P1 的旗標導出），沒有旗標是空字串', () => {
  const st = newState(3, data, {});
  const tl = data.timeline[0];
  assert.equal(buildCtx(st, tl).學制, ''); assert.equal(buildCtx(st, tl).去向, '');
  st.flags['學制_技高'] = true; st.flags['去向_外地'] = true;
  assert.equal(buildCtx(st, tl).學制, '技高'); assert.equal(buildCtx(st, tl).去向, '外地');
  assert.ok(buildCtx(st, tl).__flags['學制_技高']); // 旗標照舊可用
});

test('劑量表的時間標籤：3 個月＝這一季、5–7 個月＝這半年、1–2 個月不標；doseView 帶出 period', () => {
  assert.equal(periodLabel(1), null); assert.equal(periodLabel(2), null);
  assert.equal(periodLabel(3), '這一季'); assert.equal(periodLabel(4), '這 4 個月');
  for (const m of [5, 6, 7]) assert.equal(periodLabel(m), '這半年');
  const st = newState(2, data, {});
  assert.equal(doseView({ 體力: -5 }, st, '高中', 6).period, '這半年');
  assert.equal(doseView({ 體力: -5 }, st, '國小低', 2).period, null);
});

import { installFakeDom, uninstallFakeDom } from './fake-dom.mjs';
test('標題頁：沒有「試玩到 18 歲」的連結，也沒有試玩模式的標記；開始與繼續照舊', async () => {
  const { root } = installFakeDom();
  try {
    const ui = await import('../js/ui.js');
    ui.renderTitle(root, { hasSave: false, onNew() {}, onContinue() {}, preview: false, previewHref: '/?preview=1' });
    assert.equal(root.querySelector('[data-act="preview-on"]'), null);
    assert.ok(!/試玩|開發中/.test(root.textContent));
    assert.ok(root.querySelector('[data-act="new"]'));
    ui.renderTitle(root, { hasSave: true, onNew() {}, onContinue() {} });
    assert.equal(root.querySelector('[data-act="preview-off"]'), null);
    assert.ok(root.querySelector('[data-act="continue"]'));
  } finally { uninstallFakeDom(); }
});
