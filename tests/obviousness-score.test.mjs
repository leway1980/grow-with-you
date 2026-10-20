import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRatings, summarize } from '../tools/obviousness-score.mjs';

// 3 題：a、b 是『換人題』（4 個選項），c 是其他題（3 個選項）
const blind = [
  { id: 'a', options: [{ label: '短', dose: ['孩子：▲ 心情 ■□□'] }, { label: '最長最長最長最長', dose: ['孩子：▲ 心情 ■□□、▲ 睡眠 ■□□'] }, { label: '先問再等他說完', dose: ['你：▼ 體力 ■□□'] }, { label: '算了', dose: ['這次看不出什麼明顯的變化。'] }] },
  { id: 'b', options: [{ label: '甲', dose: ['你：▲ 耐心 ■□□'] }, { label: '乙乙乙乙乙', dose: ['你：▼ 錢 ■□□'] }, { label: '丙', dose: ['你：▼ 錢 ■□□'] }, { label: '丁', dose: ['你：▼ 錢 ■□□'] }] },
  { id: 'c', options: [{ label: '一', dose: ['你：▲ 錢 ■□□'] }, { label: '二二', dose: ['你：▲ 錢 ■□□、▲ 耐心 ■□□'] }, { label: '三', dose: ['你：▲ 耐心 ■□□'] }] },
];
const key = { a: { switch: true, best: [2] }, b: { switch: true, best: [3] }, c: { switch: false, best: [0] } };

test('評分器：Q1／Q2 命中、換人題與其他題分開、追劑量、最長、最暖', () => {
  const r = scoreRatings(blind, key, [
    { id: 'a', q1: 2, q2: 1 }, // Q1 中；Q2 沒中但選到 ▲ 最多（2 個）的最長選項
    { id: 'b', q1: 0, q2: 0 }, // Q1 沒中；Q2 選 ▲ 最多（唯一一個 ▲）
    { id: 'c', q1: 0, q2: 1 }, // Q1 中；Q2 選 ▲ 最多
    { id: 'zz', q1: 0, q2: 0 }, // 不認得
    { id: 'c', q1: 9, q2: 0 }, // 位置超出範圍
  ]);
  assert.equal(r.rated, 3); assert.equal(r.ignored, 2);
  assert.deepEqual([r.q1.all.k, r.q1.all.n, r.q1.switch.k, r.q1.switch.n, r.q1.other.k, r.q1.other.n], [2, 3, 1, 2, 1, 1]);
  assert.deepEqual([r.q2.all.k, r.q2.switch.k, r.q2.other.k], [0, 0, 0]);
  assert.equal(r.dose.all.k, 3);
  assert.deepEqual([r.longest.all.k, r.longest.all.n], [0, 3]); // Q1 選的 2、0、0 都不是最長
  assert.deepEqual([r.warmest.all.k, r.warmest.all.n], [1, 1]); // b、c 沒有暖語線索（全部平手）不計； a 的最暖是「先問再等他說完」＝位置 2，Q1 選了它
  assert.ok(Math.abs(r.q1.all.chance - (1 / 4 + 1 / 4 + 1 / 3) / 3) < 1e-9);
  const [lo, hi] = r.q1.all.ci;
  assert.ok(lo < r.q1.all.rate && r.q1.all.rate < hi && lo >= 0 && hi <= 1);
});

test('summarize：空集合不會爆', () => {
  const s = summarize([]);
  assert.equal(s.n, 0); assert.ok(Number.isNaN(s.rate));
});
