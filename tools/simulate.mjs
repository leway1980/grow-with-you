// 用法：node tools/simulate.mjs [局數=300] [起始種子=1]
// 策略機器人各玩 N 局，印出三條結果軸（親子、人際、學習）與共同幸福的平均，以及參數曝光表（DESIGN §3.4、§3.6）。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) tools/simulate.mjs 的作法：同一批種子、決定性的策略、批次統計。
import { fileURLToPath } from 'node:url';
import { stateRng } from '../js/engine/rng.js';
import { newState } from '../js/engine/state.js';
import { playToEnd } from '../js/engine/turn.js';
import { outcomeAxes, wellbeing, routePosition } from '../js/engine/ending.js';
import { loadData } from './data-node.mjs';

const GOOD_CHILD = { 心情: 1, 成績: 1, 作業: 1, 睡眠: 1, 同學往來: 1, '3C時間': -1 };
const PARENT_W = 0.5;

/** 一個選項的標籤原始合計（不含情境調整），給策略機器人判斷用 */
export function tagVec(data, ch) {
  const v = Object.fromEntries(Object.keys(data.tags.hidden).map((k) => [k, 0]));
  for (const t of ch.tags || []) for (const [k, d] of Object.entries(data.tags.tags[t].d || {})) v[k] = (v[k] || 0) + d;
  return v;
}
const hasTag = (ch, set) => (ch.tags || []).filter((t) => set.includes(t)).length;
const sum = (o, w) => Object.entries(w).reduce((a, [k, x]) => a + x * (o[k] || 0), 0);

export const BOTS = {
  random: { desc: '隨機', score: () => 0 },
  permissive: { desc: '放任（嘴巴尊重、兩手一攤、出事才收拾）', score: (data, ch) => {
    const v = tagVec(data, ch);
    return -v.規範監督 - v.替他做主 + 0.2 * (v.溫暖陪伴 || 0) + 3 * hasTag(ch, ['嘴巴尊重無跟進', '兩手一攤', '沒有下文', '說沒關係就結束', '吵了才讓步', '說了不算', '出事替他擺平', '外包', '3C當保母', '全部替他做']);
  } },
  controlling: { desc: '控制（替他決定、只看成績、比較）', score: (data, ch) => {
    const v = tagVec(data, ch);
    return 2 * (v.替他做主 || 0) + (v.規範監督 || 0) - 0.3 * (v.溫暖陪伴 || 0) + 3 * hasTag(ch, ['替他決定', '罵一頓', '只看成績', '送去補習', '拿別人比較', '轉述消息_特地', '全部替他做', '提議別的', '沒聽孩子重複的要求']);
  } },
  warmFirm: { desc: '溫暖＋堅定', score: (data, ch) => sum(tagVec(data, ch), { 溫暖陪伴: 1, 規範監督: 1, 親子信任: 0.5, 了解度: 0.5, 主見: 0.5, 替他做主: -1, 期待壓力: -0.5, 試探度: -0.5, 規則一致性: 0.3 }) },
  doseGreedy: { desc: '只看劑量表（每次選看得到的變化最好的）', score: (data, ch) => {
    let s = 0;
    for (const [k, d] of Object.entries(ch.effects || {})) {
      if (k in GOOD_CHILD) s += GOOD_CHILD[k] * d;
      else s += PARENT_W * d;
    }
    return s;
  } },
};

export function botPolicy(botName, seedSalt) {
  const bot = BOTS[botName];
  let holder = null;
  return {
    choose(st, view, raw, data) {
      holder ??= { r: (st.seed ^ seedSalt) >>> 0 };
      const r = stateRng(holder, 'r');
      const opts = view.choices.filter((c) => !c.disabled);
      if (botName === 'random') return opts[Math.floor(r() * opts.length)].i;
      let best = null, bs = -1e9;
      for (const o of opts) {
        const s = bot.score(data, raw.choices[o.i]) + r() * 1e-6; // 平手時用亂數決定（決定性）
        if (s > bs) { bs = s; best = o.i; }
      }
      return best;
    },
  };
}

const avg = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);

export function runBots(data, N, s0 = 1) {
  const rows = {};
  const exposure = {}; // 動態曝光：每個隱藏數值被推動的總量（絕對值）與淨變化
  for (const name of Object.keys(BOTS)) {
    const acc = { 親子: [], 人際: [], 學習: [], child: [], parent: [], between: [], route: {} };
    for (let i = 0; i < N; i++) {
      const st = newState(s0 + i, data, { role: i % 2 ? '媽媽' : '爸爸', startMode: 'birth' });
      playToEnd(st, data, botPolicy(name, 0x9e3779b1));
      const ax = outcomeAxes(st), w = wellbeing(st);
      acc.親子.push(ax.親子); acc.人際.push(ax.人際); acc.學習.push(ax.學習);
      acc.child.push(w.child); acc.parent.push(w.parent); acc.between.push(w.between);
      const rp = routePosition(st).name.split('：')[0];
      acc.route[rp] = (acc.route[rp] || 0) + 1;
      if (name === 'random') {
        for (const h of st.hist) for (const [k, d] of Object.entries(h.h || {})) { const e = (exposure[k] ||= { abs: 0, net: 0 }); e.abs += Math.abs(d); e.net += d; }
      }
    }
    rows[name] = acc;
  }
  return { rows, exposure };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const N = parseInt(process.argv[2] || '300', 10);
  const s0 = parseInt(process.argv[3] || '1', 10);
  const data = loadData();
  const t0 = Date.now();
  const { rows, exposure } = runBots(data, N, s0);
  const f = (x) => x.toFixed(1).padStart(5);
  console.log(`模擬：每種策略 ${N} 局（種子 ${s0}–${s0 + N - 1}），耗時 ${Date.now() - t0} ms\n`);
  console.log('策略                 ｜ 親子 人際 學習 ｜ 孩子幸福 父母幸福 彼此之間');
  for (const [name, a] of Object.entries(rows)) {
    console.log(`${name.padEnd(12)}${BOTS[name].desc.slice(0, 8).padEnd(9, '　')}｜ ${f(avg(a.親子))}${f(avg(a.人際))}${f(avg(a.學習))} ｜ ${f(avg(a.child))}    ${f(avg(a.parent))}    ${f(avg(a.between))}`);
  }
  console.log('\n教養路線位置（由行為累積算出）：');
  for (const [name, a] of Object.entries(rows)) console.log(`  ${name.padEnd(12)}${Object.entries(a.route).sort((x, y) => y[1] - x[1]).map(([k, v]) => `${k} ${(v / N * 100).toFixed(0)}%`).join('　')}`);
  const tops = ['親子', '人際', '學習'].map((ax) => Object.entries(rows).sort((a, b) => avg(b[1][ax]) - avg(a[1][ax]))[0][0]);
  console.log(`\n三條軸的最高策略：親子 ${tops[0]}、人際 ${tops[1]}、學習 ${tops[2]}${new Set(tops).size === 1 ? '  ← 注意：同一個策略三軸全贏（§3.4 檢查標準）' : ''}`);
  const dg = rows.doseGreedy, wf = rows.warmFirm;
  console.log(`只看劑量表的機器人 vs 溫暖＋堅定：親子 ${f(avg(dg.親子))} / ${f(avg(wf.親子))}，孩子幸福 ${f(avg(dg.child))} / ${f(avg(wf.child))}`);
  // 靜態曝光：被多少比例的選項推動
  const cards = data.events.cards;
  const nChoices = cards.reduce((a, c) => a + c.choices.length, 0);
  const touch = {};
  for (const c of cards) for (const ch of c.choices) {
    const keys = new Set();
    for (const t of ch.tags) for (const k of Object.keys(data.tags.tags[t].d || {})) keys.add(k);
    for (const k of keys) touch[k] = (touch[k] || 0) + 1;
  }
  console.log('\n參數曝光表（§3.6 第 1 點）：隱藏數值　被多少比例的選項推動｜隨機策略每局平均被推動的總量（絕對值）／淨變化');
  for (const k of Object.keys(data.tags.hidden)) {
    const e = exposure[k] || { abs: 0, net: 0 };
    console.log(`  ${k.padEnd(8, '　')} ${((touch[k] || 0) / nChoices * 100).toFixed(0).padStart(3)}%｜ ${(e.abs / N).toFixed(1).padStart(6)} ／ ${(e.net / N).toFixed(1).padStart(6)}${data.tags.derived.includes(k) ? '（推算值）' : ''}`);
  }
}
