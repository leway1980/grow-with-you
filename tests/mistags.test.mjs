// 標籤對不對（DESIGN §11 規則 9、10）：規範不是替他做主；對長輩的話不是夫妻吵架；低了解度的後備是『事後才去問』。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../tools/data-node.mjs';

const data = loadData();
const T = data.tags;
const tagsOf = (id, i) => data.cardIndex[id].choices[i].tags;

test('規範（時間、地點、安全）標 事前訂規則／說到做到，不是 替他決定', () => {
  const rule = [['lo_tablet', 4], ['hi_tablet', 4], ['hi_watch', 4], ['hi_allowance', 3], ['lo_commute', 4], ['cm_bike', 2], ['hi_grad_trip', 2]];
  for (const [id, i] of rule) {
    const t = tagsOf(id, i);
    assert.ok(!t.includes('替他決定'), `${id}#${i}：規範不是替他做主`);
    assert.ok(t.includes('事前訂規則') || t.includes('說到做到'), `${id}#${i} 要是事前訂規則或說到做到：${t}`);
  }
  // 替他決定只留給孩子自己的喜好與選擇
  assert.ok(tagsOf('lo_club', 3).includes('替他決定') && tagsOf('kid_trial', 1).includes('替他決定'));
});

test('對長輩的話（孩子在場）＝當孩子面否定長輩（約夫妻當孩子面吵的 1/3）；夫妻吵架才用夫妻當孩子面吵', () => {
  for (const [id, i] of [['kid_elder_snack', 1], ['kid_elder_rule', 2], ['inf_elder_feed', 2]]) {
    assert.deepEqual(tagsOf(id, i), ['當孩子面否定長輩'], `${id}#${i}`);
  }
  const wife = T.tags.夫妻當孩子面吵.d, elder = T.tags.當孩子面否定長輩.d;
  for (const k of Object.keys(elder)) assert.ok(Math.abs(elder[k] / wife[k] - 1 / 3) < 0.1, `${k}：${(elder[k] / wife[k]).toFixed(2)}`);
  // 沒有任何和長輩有關的選項還用夫妻當孩子面吵
  for (const c of data.events.cards) for (const o of c.choices) if (o.tags.includes('夫妻當孩子面吵')) assert.ok(!/長輩/.test(o.label), `${c.id}／${o.label}`);
});

test('了解度低時「打給老師問到底怎麼回事」＝事後才去問（了解度 +0.3、師親信任 −0.3），不再算與老師合作', () => {
  assert.deepEqual(T.tags.事後才去問.d, { 了解度: 0.3, 師親信任: -0.3 });
  for (const [id, i] of [['kid_bite', 1], ['lo_teacher', 1]]) {
    const t = tagsOf(id, i);
    assert.ok(t.includes('事後才去問') && !t.includes('與老師合作'), `${id}#${i}：${t}`);
    assert.match(data.cardIndex[id].choices[i].showIf, /not 了解度高/);
  }
});

test('注音：「上小學老師會教」是不比較（符合幼兒園不得先教注音）；報注音班才是陷阱', () => {
  const c = data.cardIndex.kid_zhuyin;
  assert.deepEqual(c.choices[2].tags, ['不比較']); assert.match(c.choices[2].label, /上小學老師會教/);
  assert.deepEqual(c.choices[1].tags, ['送去補習']); assert.match(c.choices[1].label, /報名注音班/);
  const dose = (o) => (o.effects.成績 || 0) + 0.5 * ((o.effects.耐心 || 0) + (o.effects.錢 || 0));
  assert.ok(dose(c.choices[1]) > dose(c.choices[0]), '報注音班在劑量表上最好看（陷阱）');
});

test('睡覺、其他', () => {
  assert.deepEqual(tagsOf('kid_sleep_bed', 1), ['穩定的日常']);
  assert.ok(tagsOf('fu_phone_test', 4).every((t) => t !== '事後跟進'));
  assert.ok(tagsOf('sf_leave', 2).includes('一起參與'));
  assert.ok(tagsOf('kid_toilet', 3).includes('規則不一致')); // 家裡照舊包尿布、學校帶去上廁所：兩邊做法真的不一樣
  for (const [id, i] of [['kid_toilet', 3], ['inf_hold_spoil', 1], ['inf_shift', 2], ['sf_leave', 2]]) assert.ok(data.cardIndex[id].choices[i]);
});

test('審查後改標：學校與家裡做法不同＝規則不一致；讓孩子哭＝沒有下文；輪班說好誰起來＝找人分擔', () => {
  assert.deepEqual(tagsOf('kid_toilet', 3), ['規則不一致']);
  const hold = data.cardIndex.inf_hold_spoil;
  assert.ok(hold.choices[1].tags.includes('沒有下文') && !hold.choices[1].tags.includes('說沒關係就結束'));
  assert.ok(hold.choices.some((c) => c.tags.includes('先接住情緒') && /繼續抱著/.test(c.label)), '要有回應式抱著的選項');
  const shift = data.cardIndex.inf_shift.choices[2];
  assert.deepEqual(shift.tags, ['找人分擔']);
  assert.ok(/叫醒/.test(shift.label) && /下一輪換你/.test(shift.label));
  // sf_leave#2 是『陪{孩子}看電影』（Item 9 已從陪著觀察改成一起參與），不是自己去看電影，所以不用喘口氣
  assert.ok(/陪\{孩子\}看電影/.test(data.cardIndex.sf_leave.choices[2].label));
});
