// 升學與教育路徑的卡（DESIGN §6.0，data/events/pathways.json）：自學設旗標且會考／學測的文字跟著換、提早入學只有資優的孩子遇得到、
// 規則卡的研究小卡（card.note）附出處與「以當年度簡章為準」、data/yearly.json 的特教事實。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, ROOT } from '../tools/data-node.mjs';
import { newState } from '../js/engine/state.js';
import { applyChoice, buildCtx, passes, describeCard, drawCard } from '../js/engine/events.js';
import { startTurn, chooseCard, nextCard, finishTurn } from '../js/engine/turn.js';
import { stateRng } from '../js/engine/rng.js';
import { botPolicy } from '../tools/bots.mjs';
import { installFakeDom, uninstallFakeDom } from './fake-dom.mjs';

const data = loadData();
const PW = data.events.cards.filter((c) => c.id.startsWith('pw_'));
const has資優 = (st) => st.family.child.needs.some((n) => n.kind === '資優');
const fresh = (seed = 4) => newState(seed, data, { role: '媽媽', startMode: 'elementary' });
const turnAt = (grade, month) => data.timeline.findIndex((t) => t.grade === grade && t.month === month);
const pick = (st, cardId, pred, turn) => {
  st.turn = turn;
  const card = data.cardIndex[cardId], i = card.choices.findIndex(pred);
  assert.ok(i >= 0, `${cardId} 找不到選項`);
  return applyChoice(st, data, card, i, data.timeline[turn], stateRng(st, 'rngS'));
};
const textOf = (st, cardId, turn) => { st.turn = turn; return describeCard(data.cardIndex[cardId], st, data, data.timeline[turn]).text; };

test('升學路徑的卡：都明寫 scale、有 3–5 個選項、研究小卡附出處年份與「以當年度簡章為準」', () => {
  assert.ok(PW.length >= 8, `只有 ${PW.length} 張`);
  for (const c of PW) {
    assert.equal(typeof c.scale, 'boolean', `${c.id} 沒有明寫 scale`);
    assert.ok(c.choices.length >= 3 && c.choices.length <= 5, c.id);
    assert.ok(c.note, `${c.id} 缺研究小卡`);
    assert.ok(c.note.includes('以當年度簡章為準'), `${c.id} 的研究小卡沒有「以當年度簡章為準」`);
    assert.ok(/20(2[0-9])/.test(c.note) || /1[01][0-9] 學年/.test(c.note), `${c.id} 的研究小卡沒有年份`);
    assert.ok(/查核 2026-10-20/.test(c.note), `${c.id} 的研究小卡沒有查核日`);
  }
});

test('自學：計畫書與團體自學設旗標「學制_自學」，留在學校調整與轉學不會', () => {
  for (const id of ['pw_selfstudy_jh', 'pw_selfstudy_hi']) {
    const card = data.cardIndex[id];
    const setters = card.choices.filter((c) => (c.setFlags || []).includes('學制_自學'));
    assert.equal(setters.length, 2, `${id}：個人計畫與團體／機構兩條路設旗標`);
    assert.ok(card.choices.some((c) => !(c.setFlags || []).includes('學制_自學') && c.tags.includes('與老師合作')), `${id}：有留在學校調整的選項`);
    assert.ok(card.choices.some((c) => !(c.setFlags || []).includes('學制_自學') && c.tags.includes('提議別的')), `${id}：有轉學的選項`);
  }
  const t = turnAt(8, 12);
  const a = fresh(), b = fresh(), c = fresh();
  pick(a, 'pw_selfstudy_jh', (x) => x.tags.includes('讓孩子參與決定'), t);
  assert.ok(a.flags.學制_自學);
  assert.equal(buildCtx(a, data.timeline[t]).學制, '自學', '條件式可以直接寫 學制 == 自學');
  assert.ok(a.delayed.some((d) => d.card === 'pw_selfstudy_back'), '排了每年的報告書與訪視');
  pick(b, 'pw_selfstudy_jh', (x) => x.tags.includes('陪著觀察'), t);
  assert.ok(b.flags.學制_自學, '團體自學也算');
  pick(c, 'pw_selfstudy_jh', (x) => x.tags.includes('與老師合作'), t);
  assert.ok(!c.flags.學制_自學 && !c.delayed.length);
});

test('自學：會考、會考規則、學測與升大學的卡，文字跟著自學生換', () => {
  const st = fresh();
  const tExam = turnAt(9, 5), tCap = turnAt(8, 3), tSh = turnAt(12, 10);
  assert.ok(tExam > 0 && tCap > 0 && tSh > 0);
  const before = { exam: textOf(st, 'fx_exam_basic', tExam), cap: textOf(st, 'pw_cap_rules', tCap), sh: textOf(st, 'fx_sh_exam', tSh), uni: textOf(st, 'pw_university', tSh) };
  for (const v of Object.values(before)) assert.ok(!v.includes('自學'));
  st.flags.學制_自學 = true;
  const after = { exam: textOf(st, 'fx_exam_basic', tExam), cap: textOf(st, 'pw_cap_rules', tCap), sh: textOf(st, 'fx_sh_exam', tSh), uni: textOf(st, 'pw_university', tSh) };
  assert.ok(after.exam.includes('自學生') && after.exam.includes('會考'));
  assert.ok(after.cap.includes('自學生'));
  assert.ok(after.sh.includes('自學生') && after.sh.includes('特殊選才') && after.sh.includes('學測'));
  assert.ok(after.uni.includes('自學生') && after.uni.includes('特殊選才'));
  // 自學的技高生：統測與科大特殊選才
  st.flags.走技職 = true;
  const tech = textOf(st, 'fx_sh_exam', tSh);
  assert.ok(tech.includes('自學生') && tech.includes('統測') && tech.includes('特殊選才'));
  // 不是自學生的技高生，文字照舊
  const plain = fresh(); plain.flags.走技職 = true;
  assert.ok(textOf(plain, 'fx_sh_exam', tSh).includes('統測') && !textOf(plain, 'fx_sh_exam', tSh).includes('自學'));
});

test('自學之後：每年的報告書與訪視；想回學校隨時可以，旗標清掉、文字回到一般版', () => {
  const st = fresh();
  const t0 = turnAt(8, 12);
  pick(st, 'pw_selfstudy_jh', (x) => x.tags.includes('讓孩子參與決定'), t0);
  const m0 = data.timeline[t0].ageMonths;
  const back = data.cardIndex.pw_selfstudy_back;
  const due = st.delayed.find((d) => d.card === 'pw_selfstudy_back');
  assert.ok(data.timeline[due.due].ageMonths - m0 >= 10 && data.timeline[due.due].ageMonths - m0 <= 14, '約一年之後');
  const tBack = due.due;
  assert.ok(passes(back, st, buildCtx(st, data.timeline[tBack])));
  // 繼續自學：再排下一年
  const s2 = JSON.parse(JSON.stringify(st));
  pick(s2, 'pw_selfstudy_back', (x) => x.tags.includes('事後跟進'), tBack);
  assert.ok(s2.flags.學制_自學 && s2.delayed.some((d) => d.card === 'pw_selfstudy_back' && d.due > tBack), '明年還會有報告書');
  // 回學校
  pick(st, 'pw_selfstudy_back', (x) => (x.clearFlags || []).includes('學制_自學'), tBack);
  assert.ok(!st.flags.學制_自學, '旗標清掉');
  assert.ok(!passes(back, st, buildCtx(st, data.timeline[tBack])), '回學校之後不再出現報告書');
  assert.ok(!textOf(st, 'fx_exam_basic', turnAt(9, 5)).includes('自學'));
});

test('提早入學：只有資優的孩子遇得到（條件、抽卡與整局都一樣）', () => {
  const card = data.cardIndex.pw_early_enroll;
  assert.match(card.requires.expr, /有資優/);
  const mid = data.timeline.filter((t) => t.stage === '幼兒園' && t.ageMonths >= 51 && t.ageMonths <= 59);
  assert.ok(mid.length >= 3);
  let gifted = 0, plainSeeds = 0;
  for (let seed = 1; seed <= 400; seed++) {
    const st = fresh(seed);
    const yes = has資優(st);
    for (const tl of data.timeline.filter((t) => t.stage === '幼兒園')) {
      const ok = passes(card, st, buildCtx(st, tl));
      assert.equal(ok, yes && tl.ageMonths >= 51 && tl.ageMonths <= 59, `種子 ${seed} 月齡 ${tl.ageMonths}`);
    }
    if (yes) gifted++; else plainSeeds++;
  }
  assert.ok(gifted >= 3 && plainSeeds > 300, `資優 ${gifted} 局`);
  // 整局玩下來：資優的孩子在這一年的某個回合會遇到；其他孩子一次也不會
  let seen = 0, seenGifted = 0, leaked = 0;
  for (let seed = 1; seed <= 400 && seenGifted < 3; seed++) {
    const st = newState(seed, data, { role: seed % 2 ? '爸爸' : '媽媽', startMode: 'birth' });
    if (!has資優(st) && seed > 150) continue;
    const pol = botPolicy('random', seed);
    while (!st.ended && data.timeline[st.turn].stage !== '國小低') {
      const r = startTurn(st, data);
      if (r.ended) break;
      if (r.card) {
        let v = r.card, raw = r.raw;
        for (let g = 0; g < 3; g++) {
          if (raw.id === 'pw_early_enroll') { seen++; if (has資優(st)) seenGifted++; else leaked++; }
          const o = chooseCard(st, data, pol.choose(st, v, raw, data));
          if (!o.more) break;
          ({ card: v, raw } = nextCard(st, data));
        }
      }
      finishTurn(st, data);
    }
  }
  assert.equal(leaked, 0, '沒有資優的孩子遇到了提早入學');
  assert.ok(seenGifted >= 1, `資優的孩子有 ${seenGifted} 局遇到`);
});

test('提早入學：三條路（申請鑑定、先觀察、才藝）加一條放著不談；敏感的孩子，申請的選項多一個「陪著去看」', () => {
  const card = data.cardIndex.pw_early_enroll;
  assert.ok(card.choices.some((c) => c.tags.includes('申請評估或鑑定')));
  assert.ok(card.choices.some((c) => c.tags.includes('事後跟進')));
  assert.ok(card.choices.some((c) => c.tags.includes('嘗試新活動')));
  const apply = card.choices.find((c) => c.tags.includes('申請評估或鑑定'));
  assert.ok(apply.labelIf && apply.tagsIf[0].value.includes('陪著觀察'));
  assert.match(card.note, /正兩個標準差/); assert.match(card.note, /百分等級 97/);
});

test('跳級：四種方式（免修、加速、部分跳級、全部跳級）都在卡上，只給資優的孩子', () => {
  const card = data.cardIndex.pw_skip_grade;
  const labels = card.choices.map((c) => c.label).join('|');
  for (const w of ['免修', '加速', '部分跳級', '全部跳級']) assert.ok(labels.includes(w), w);
  assert.match(card.requires.expr, /有資優/);
  const st = fresh();
  for (const tl of data.timeline.filter((t) => t.stage === '國小中高')) assert.equal(passes(card, st, buildCtx(st, tl)), has資優(st) && tl.grade >= 4 && tl.grade <= 5);
  for (const w of ['鑑輔會', '學校特殊教育推行委員會']) assert.ok(card.note.includes(w), w);
});

test('規則卡在對的年級出現：會考怎麼算在國二下、免試比序在國三下志願選填之前、升大學在高三上', () => {
  const st = fresh();
  const ok = (id, pred) => data.timeline.filter((tl) => passes(data.cardIndex[id], st, buildCtx(st, tl))).every(pred) && data.timeline.some((tl) => passes(data.cardIndex[id], st, buildCtx(st, tl)));
  assert.ok(ok('pw_cap_rules', (tl) => tl.grade === 8 && [3, 6].includes(tl.month)));
  assert.ok(ok('pw_admission', (tl) => tl.grade === 9 && [3, 5].includes(tl.month)));
  assert.ok(ok('pw_university', (tl) => tl.grade === 12 && tl.month === 10));
  // 都比放榜與選校（6 月）早或同一學年：志願選填那一回合已有兩張固定卡，不再加第三張
  assert.ok(data.timeline.filter((t) => t.grade === 9 && t.month === 6).every((t) => t.fixed.length === 2));
  assert.match(data.cardIndex.pw_cap_rules.note, /85%/); assert.match(data.cardIndex.pw_cap_rules.note, /15%/);
  assert.match(data.cardIndex.pw_cap_rules.note, /一到六級分/);
  assert.match(data.cardIndex.pw_university.note, /8 科/);
  assert.match(data.cardIndex.pw_admission.note, /各就學區規則不同/);
});

test('研究小卡：選完之後 chooseCard 回傳 note，畫面顯示在結果下面；沒有 note 的卡不多顯示任何東西', async () => {
  const st = fresh();
  const t = turnAt(8, 3);
  st.turn = t;
  st.cur = { cardId: 'pw_cap_rules', slot: 0, twoSlot: false, fu: null, acc: {}, loads: [] };
  const out = chooseCard(st, data, 0);
  assert.equal(out.note, data.cardIndex.pw_cap_rules.note);
  const st2 = fresh(); st2.turn = t;
  st2.cur = { cardId: 'jh_cram', slot: 0, twoSlot: false, fu: null, acc: {}, loads: [] };
  assert.equal(chooseCard(st2, data, 0).note, '');
  const ui = await import('../js/ui.js');
  try {
    const { root } = installFakeDom();
    const refs = { panel: root };
    ui.showResult(refs, { title: '會考怎麼算', label: 'x', result: '結果。', dose: null, note: out.note }, () => {});
    const aside = root.querySelector('.note');
    assert.ok(aside && aside.textContent.includes('研究小卡') && aside.textContent.includes('以當年度簡章為準'));
    ui.showResult(refs, { title: '會考怎麼算', label: 'x', result: '結果。', dose: null, note: '' }, () => {});
    assert.equal(root.querySelector('.note'), null);
  } finally { uninstallFakeDom(); }
});

test('特教事實：special.json 與班級卡的 note 是一句中性的事實加出處；yearly.json 的每一則都有出處與查證標記、不超過 80 字', () => {
  for (const id of ['sn_push', 'sn_teacher_note', 'sn_meltdown', 'sn_tantrum', 'sn_med_daily', 'cl_tic', 'cl_mirror']) {
    const n = data.cardIndex[id].note;
    assert.ok(n && n.length <= 160, `${id} 的 note 太長或沒有`);
    assert.ok(/（[^）]{6,}）/.test(n) || /單一縣市資料/.test(n), `${id} 的 note 沒有出處`);
    assert.ok(!/[！!]|應該|必須|一定|最/.test(n), `${id} 的 note 不中性`);
  }
  const y = JSON.parse(readFileSync(join(ROOT, 'data', 'yearly.json'), 'utf8'));
  assert.ok(y.facts.length >= 6);
  const ids = new Set();
  for (const f of y.facts) {
    assert.ok(!ids.has(f.id)); ids.add(f.id);
    assert.ok(f.age >= 6 && f.age <= 18, f.id);
    assert.ok([...f.text].length <= 80, `${f.id} 超過 80 字`);
    assert.ok(f.source && /2026-10-20/.test(f.source + (f.note || '')) || /law\.moj|stats\.moe|dbas/.test(f.source), `${f.id} 沒有出處`);
    assert.ok(['已核', '已核二手'].includes(f.verified), f.id);
    assert.ok(!/未證實|憑記憶/.test(JSON.stringify(f)), f.id);
    assert.ok(!/比別人|排名|較高|較低/.test(f.text), `${f.id} 用了比較的字眼`);
  }
  const text = y.facts.map((f) => f.text).join('\n');
  for (const w of ['每 21 位', '每 20 位', '78.4%', '情緒行為障礙']) assert.ok(text.includes(w), w);
});

test('升學路徑的池：規則卡池權重大、資優與自學各有自己的池；後續池的卡由選項打開', () => {
  const P = data.pools;
  assert.ok(P.升學規則.base >= 50);
  assert.ok(P.資優路徑.base > 0 && P.自學路徑.base > 0 && P.自學後續.base === 0);
  for (const c of PW) assert.ok(P[c.pool], `${c.id}：池 ${c.pool} 不存在`);
});

test('規則卡在條件符合的回合幾乎一定抽到（池權重大）：會考怎麼算、免試比序、升大學', () => {
  for (const [id, grade, month] of [['pw_cap_rules', 8, 3], ['pw_admission', 9, 3], ['pw_university', 12, 10]]) {
    const t = turnAt(grade, month);
    let hit = 0;
    const N = 80;
    for (let seed = 1; seed <= N; seed++) {
      const st = fresh(seed); st.turn = t;
      const tl = data.timeline[t], c = drawCard(st, data, buildCtx(st, tl), tl, stateRng(st, 'rngS'));
      if (c && c.id === id) hit++;
    }
    assert.ok(hit / N >= 0.7, `${id}：${hit}/${N}`);
  }
});

test('自學的訊號：被霸凌過而且同學往來低，或孩子堅持度很高；一般的孩子遇不到自學卡', () => {
  const jh = data.cardIndex.pw_selfstudy_jh, hi = data.cardIndex.pw_selfstudy_hi;
  const tJh = turnAt(8, 12), tHi = turnAt(4, 12);
  const st = fresh(); st.family.child.temperament.堅持度 = 3;
  const ok = (c, t) => passes(c, st, buildCtx(st, data.timeline[t]));
  st.child.同學往來 = 60;
  assert.ok(!ok(jh, tJh) && !ok(hi, tHi), '一般的孩子沒有訊號');
  st.flags.霸凌_發生過 = true;
  assert.ok(!ok(jh, tJh), '被霸凌過但同學往來還好：不出現');
  st.child.同學往來 = 38;
  assert.ok(ok(jh, tJh) && ok(hi, tHi), '被霸凌過而且同學往來低：出現');
  assert.ok(textOf(st, 'pw_selfstudy_jh', tJh).includes('肚子痛'));
  delete st.flags.霸凌_發生過; st.child.同學往來 = 60; st.family.child.temperament.堅持度 = 5;
  assert.ok(ok(jh, tJh) && ok(hi, tHi), '很堅持的孩子：出現');
  assert.ok(textOf(st, 'pw_selfstudy_jh', tJh).includes('自己安排學習'), '堅持版的文字');
  st.flags.學制_自學 = true;
  assert.ok(!ok(jh, tJh), '已經在自學就不再出現');
});
