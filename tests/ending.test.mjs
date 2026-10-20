import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { playToEnd } from '../js/engine/turn.js';
import { buildEnding, wellbeing, routePosition, outcomeAxes, opennessOf, comboOf, COMBOS, ROUTE_DELTA, keyMoments } from '../js/engine/ending.js';
import { botPolicy } from '../tools/simulate.mjs';
import { installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

const data = loadData();
const played = (seed = 4, bot = 'random') => { const st = newState(seed, data, {}); playToEnd(st, data, botPolicy(bot, 3)); return st; };

test('終局先給幸福，成就另外；achievement 只放成績與學校去向；三條軸是獨立的一組，不在 achievement 裡', () => {
  const e = buildEnding(played(), data);
  assert.deepEqual(Object.keys(e).slice(0, 6), ['name', 'wellbeing', 'line', 'axes', 'achievement', 'route']);
  assert.deepEqual(Object.keys(e.achievement).sort(), ['note', 'scoreWord']);
  assert.deepEqual(Object.keys(e.axes).sort(), ['人際', '學習', '親子']);
  assert.deepEqual(Object.keys(e.wellbeing).sort(), ['between', 'child', 'parent']);
});

test('成就不會被加進幸福：把成績與學習軸的材料全部改掉，三個幸福數值完全不變', () => {
  const st = played(9);
  const w0 = wellbeing(st);
  const a0 = outcomeAxes(st);
  for (const c of st.vcurves) c.成績 = 5;
  st.child.成績 = 5;
  st.hidden.閱讀習慣 = 5; st.hidden.家庭學習環境 = 5;
  assert.deepEqual(wellbeing(st), w0);
  assert.ok(outcomeAxes(st).學習 < a0.學習 - 5); // 學習軸有跟著掉，所以上面不是沒改到
});

test('終局畫面的順序：先是你們一起的幸福，然後成就，然後回頭看，最後是資源', () => {
  const { root } = installFakeDom();
  return import('../js/ui.js').then((ui) => {
    try {
      ui.renderEnding(root, buildEnding(played(), data), { seed: 4, onSame() {}, onNew() {} });
      const ids = root.querySelectorAll('section').map((s) => s.attrs.id);
      assert.deepEqual(ids, ['ending-wellbeing', 'ending-achievement', 'ending-review', 'ending-resources']);
      const txt = root.textContent;
      assert.ok(txt.indexOf('你們一起的幸福') < txt.indexOf('孩子的學習與去向') && txt.indexOf('孩子的學習與去向') < txt.indexOf('回頭看') && txt.indexOf('回頭看') < txt.indexOf('如果你或孩子需要幫忙'));
      // 幸福那一區沒有成績或去向
      const wb = root.querySelector('#ending-wellbeing').textContent;
      assert.ok(!/課業|成績|國中/.test(wb));
    } finally { uninstallFakeDom(); }
  });
});

test('資源：安心專線、教育部家庭教育諮詢專線 412-8185（手機加 02）、1957、家庭教育中心、特教通報', () => {
  const e = buildEnding(played(), data);
  const hot = e.resources.find((r) => r.name === '教育部家庭教育諮詢專線');
  assert.equal(hot.tel, '412-8185（手機加 02）');
  assert.ok(e.resources.some((r) => r.tel === '1925') && e.resources.some((r) => r.tel === '1957'));
  assert.ok(e.reminder.includes('不能用來判斷真實的孩子'));
});

test('彼此之間＝親子信任、了解度、孩子主動開口的次數；不是親子軸的那四個（溫暖陪伴、規則一致性改了不影響）', () => {
  const st = played(9);
  const b0 = wellbeing(st).between;
  st.hidden.溫暖陪伴 = 5; st.hidden.規則一致性 = 5;
  assert.equal(wellbeing(st).between, b0);
  st.hidden.了解度 += 10; assert.ok(wellbeing(st).between > b0);
  const b1 = wellbeing(st).between;
  st.vars.孩子主動開口 += 4; assert.ok(wellbeing(st).between > b1);
  const b2 = wellbeing(st).between;
  st.vars.孩子不再開口 += 3; assert.ok(wellbeing(st).between < b2);
  assert.ok(opennessOf(st) >= 0 && opennessOf(st) <= 100);
  // 反過來，親子軸看溫暖陪伴與規則一致性
  const a0 = outcomeAxes(st).親子; st.hidden.溫暖陪伴 += 10; assert.ok(outcomeAxes(st).親子 > a0);
});

test('父母的幸福是整段時間的樣子，不是最後 8 回合：早期一直體力見底 → 即使最後恢復也比較低', () => {
  const st = played(9);
  const w0 = wellbeing(st).parent;
  for (const c of st.vcurves.slice(0, 30)) c.體力 = 10;
  const w1 = wellbeing(st).parent;
  assert.ok(w1 < w0 - 8, `${w0} → ${w1}`);
  // 只改最後 8 回合的影響，小於改前面整段
  const st2 = played(9);
  for (const c of st2.vcurves.slice(-8)) c.體力 = 10;
  assert.ok(wellbeing(st2).parent > w1);
  // 體力 < 35 的回合比例有懲罰
  const st3 = played(9);
  for (const c of st3.vcurves) c.體力 = 36;
  const hi = wellbeing(st3).parent;
  for (const c of st3.vcurves.slice(0, 20)) c.體力 = 34;
  assert.ok(wellbeing(st3).parent < hi - 3);
  // 錢不算進父母的幸福
  const st4 = played(9); const p4 = wellbeing(st4).parent;
  for (const c of st4.vcurves) c.錢 = 0;
  assert.equal(wellbeing(st4).parent, p4);
});

test('教養路線看「和開局相比」的變化（|Δ| > 8）；都沒有明顯變化 → 未成形／混合', () => {
  const mk = (dw, df, dc) => {
    const st = played(9);
    const s0 = st.startHidden;
    st.curves = st.curves.map((c) => ({ ...c, 溫暖陪伴: s0.溫暖陪伴 + dw, 規範監督: s0.規範監督 + df, 替他做主: s0.替他做主 + dc }));
    return routePosition(st);
  };
  assert.equal(mk(0, 0, 0).kind, '未成形');
  assert.equal(mk(ROUTE_DELTA, -ROUTE_DELTA, ROUTE_DELTA).kind, '未成形'); // 剛好 8 不算
  assert.equal(mk(10, 10, 0).kind, '陪又要求');
  assert.equal(mk(-10, -10, 0).kind, '放任');
  assert.equal(mk(-10, 10, 0).kind, '盯但不陪');
  assert.equal(mk(10, -10, 0).kind, '溺愛');
  assert.equal(mk(10, 10, 9).kind, '高壓做主');
  assert.match(mk(0, 0, 0).name, /未成形／混合/);
  // 開局就高溫暖的家庭，維持原樣不算「陪又要求」
  const st = played(9); st.startHidden.溫暖陪伴 = 80; st.curves = st.curves.map((c) => ({ ...c, 溫暖陪伴: 80, 規範監督: st.startHidden.規範監督, 替他做主: st.startHidden.替他做主 }));
  assert.equal(routePosition(st).kind, '未成形');
});

test('七種組合都分得出來，不在其中的歸「其他」', () => {
  const cases = {
    三邊都顧到: [70, 70, 70], '關係好、人際好，成績普通': [70, 70, 50], '成績好、關係冷': [30, 50, 70], '成績好、人際孤立': [50, 30, 70],
    '關係好、自律弱': [70, 50, 30], '人際好、在家說不上話': [30, 70, 50], 三邊都垮: [30, 30, 30], 其他: [50, 50, 50],
  };
  for (const [name, [a, p, l]] of Object.entries(cases)) assert.equal(comboOf({ 親子: a, 人際: p, 學習: l }), name);
  assert.deepEqual(Object.keys(cases).sort(), [...COMBOS].sort());
});

test('關鍵時刻從標籤重新推算，不需要存檔裡的每次選擇隱藏變化', () => {
  const st = played(5);
  const m = keyMoments(st, data, 5);
  assert.ok(m.length >= 3 && m.every((x) => x.when && x.title && x.label));
  assert.ok(st.hist.every((h) => h.h === undefined));
});
