// 開局抽籤：家庭與孩子（DESIGN §2.1 第 1–13 步，含 12b 寵物）。純函式、無 DOM。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) identity.js 的作法：每一步用「種子 XOR 常數」derive 出自己的亂數流，
// 改某一張權重表只會改變那一步（以及依賴它的後續步驟），不會讓其他獨立的抽籤整批重洗。
import { mulberry32, pickWeighted, gauss } from './rng.js';

export const STREAMS = {
  county: 0x1a2b3c4d, job: 0x2b3c4d5e, econ: 0x3c4d5e6f, struct: 0x4d5e6f70, partner: 0x5e6f7081, elders: 0x6f708192,
  housing: 0x708192a3, support: 0x8192a3b4, upbringing: 0x92a3b4c5, child: 0xa3b4c5d6, childNeeds: 0xb4c5d6e7, childInterest: 0xc5d6e7f8,
  childName: 0xd6e7f809, childResp: 0xc3d4e5f6, siblings: 0xe7f8091a, space: 0xf8091a2b, pet: 0x091a2b3c, school: 0x1a2b3c5d, childcare: 0x2b3c4d6e,
};
const rs = (seed, name) => mulberry32(((seed >>> 0) ^ STREAMS[name]) >>> 0);
const wpick = (r, opts, ws) => pickWeighted(r, opts.map((o, i) => ({ o, w: ws[i] })), (x) => x.w)?.o ?? opts[0];
const mulArr = (a, b) => a.map((x, i) => x * (b?.[i] ?? 1));
const clampI = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x))) || 0; // || 0：避免 -0
const rangeInt = (r, [a, b]) => a + Math.floor(r() * (b - a + 1));

export function urbanTypeOf(idn, county, district) {
  const m = idn.urbanMap[county] || {};
  return m[district] || m._default || '中小城鎮';
}

/**
 * 孩子的名字（DESIGN §2.2）：姓氏依人口比例加權，名字由男／女各自的『第一個字』『第二個字』字庫組合；
 * 單名機率另計；同一個字不重複；命中黑名單就重抽（有上限，之後退回確定的組合）。r 是名字專用的亂數流。
 */
export function rollName(r, idn, sex) {
  const M = idn.nameModel, side = sex === '男' ? 'M' : 'F';
  const surname = pickWeighted(r, idn.surnames.map((n, k) => ({ n, w: idn.surnameW[k] })), (x) => x.w).n;
  const pool = (o) => Object.entries(o).map(([c, w]) => ({ c, w }));
  const first = pool(M[side].first), second = pool(M[side].second);
  const bad = (g) => (M.blockGiven || []).includes(g) || (M.blockFull || []).includes(surname + g);
  const single = r() < M.singleP[side];
  for (let i = 0; i < 40; i++) {
    const a = pickWeighted(r, first, (x) => x.w).c, b = pickWeighted(r, second, (x) => x.w).c;
    if (single) { if (!bad(b)) return { surname, given: b }; continue; }
    if (a !== b && !bad(a + b)) return { surname, given: a + b };
  }
  const a = first[0].c;
  return { surname, given: a + second.find((x) => x.c !== a && !bad(a + x.c)).c };
}

export function generateFamily(seed, idn) {
  seed >>>= 0;
  // 1–2 縣市、行政區、城鄉類型
  const rc = rs(seed, 'county');
  const county = pickWeighted(rc, idn.counties, (c) => c.w);
  const district = county.districts[Math.floor(rc() * county.districts.length)];
  const urban = urbanTypeOf(idn, county.name, district);
  const tight = urban === '偏鄉' || urban === '離島';

  // 3 主要照顧者（也就是玩家）的職業；5 工時型態由職業決定
  const jobW = (j) => j.w * (j.urban?.[urban] ?? 1) * (j.countyMult?.[county.name] ?? 1);
  const job = pickWeighted(rs(seed, 'job'), idn.jobs, jobW);
  const pattern = job.pattern;

  // 4 家境（先抽原始家境；家庭型態可能再往下一級）
  const econW = job.econ.slice();
  if (tight) econW[2] *= idn.econRuralTightX;
  const econRaw = wpick(rs(seed, 'econ'), idn.econLabels, econW);

  // 6 家庭型態（獨立亂數流）；單薪時家境往下一級
  const r6 = rs(seed, 'struct');
  const struct = pickWeighted(r6, idn.familyStructures, (x) => x.w);
  const downRoll = r6();
  let econ = econRaw;
  if (struct.econDown && downRoll < struct.econDown) econ = idn.econLabels[Math.min(2, idn.econLabels.indexOf(econRaw) + 1)];

  // 7 另一半：職業與工時 → 態度。喪親沒有另一半；離異是共親職的前配偶
  const r7 = rs(seed, 'partner');
  const pjob = pickWeighted(r7, idn.jobs, jobW);
  const pa = idn.partner;
  let aw = mulArr(pa.base, pa.patternMult[pjob.pattern]);
  if (pa.structMult[struct.id]) aw = mulArr(aw, pa.structMult[struct.id]);
  const attRoll = wpick(r7, pa.attitudes, aw);
  const exAtt = wpick(r7, pa.attitudes, pa.exWeights);
  const partner = struct.id === '喪親' ? { present: false, status: '已離世', job: null, pattern: null, attitude: null }
    : struct.id === '離異' ? { present: false, status: '前配偶（共親職）', job: pjob.name, pattern: pjob.pattern, attitude: exAtt }
      : { present: true, status: '同住', job: pjob.name, pattern: pjob.pattern, attitude: attRoll };

  // 8 長輩
  const r8 = rs(seed, 'elders');
  let ew = idn.elders.byUrban[urban].slice();
  if (idn.elders.byStruct[struct.id]) ew = mulArr(ew, idn.elders.byStruct[struct.id]);
  const eldersStatus = wpick(r8, idn.elders.options, ew);
  const eldersWho = wpick(r8, idn.elders.who, idn.elders.whoW);
  const elders = { status: eldersStatus, who: eldersStatus === '沒有' ? null : eldersWho };

  // 9 住屋（家境 × 城鄉 × 長輩）
  const H = idn.housing;
  let hw = mulArr(mulArr(H.byEcon[econ], H.byUrban[urban]), H.eldersLive[eldersStatus]);
  const housing = wpick(rs(seed, 'housing'), H.options, hw);

  // 10 升學資源
  const support = wpick(rs(seed, 'support'), ['自己就是資源', '花錢買資源', '自己找資源'], job.support);

  // 11 自己被怎麼帶大
  const upbringing = wpick(rs(seed, 'upbringing'), idn.upbringing.options, idn.upbringing.w);

  // 12 孩子：基本、特殊需求、興趣、名字各一條流
  const C = idn.child;
  const rc2 = rs(seed, 'child');
  const sex = rc2() < C.sexMaleW ? '男' : '女';
  const birthMonth = 1 + wpick(rc2, [...Array(12).keys()], C.monthW);
  const temperament = {};
  for (const k of C.temperament.keys) temperament[k] = clampI(C.temperament.mean + gauss(rc2) * C.temperament.sd, C.temperament.min, C.temperament.max);
  const talents = {};
  for (const k of C.talents.keys) talents[k] = clampI(gauss(rc2) * C.talents.sd, C.talents.min, C.talents.max);
  const rn = rs(seed, 'childNeeds');
  const needs = [];
  for (const [kind, def] of Object.entries(C.specialNeeds)) {
    const u1 = rn(), u2 = rn(), u3 = rn(), u4 = rn(); // 固定消耗，別張表改了也不影響其他類別
    const p = def.rate * (sex === '男' ? def.male : def.female);
    if (u1 < p) {
      const onset = def.onset[0] + Math.floor(u3 * (def.onset[1] - def.onset[0] + 1));
      const dx = u2 < def.dxRate; // 「有」和「被看見」分開：只有一部分會在遊戲中被診斷
      needs.push({ kind, diagnosed: false, onset, dxTurn: dx ? onset + def.dxDelay[0] + Math.floor(u4 * (def.dxDelay[1] - def.dxDelay[0] + 1)) : null });
    }
  }
  const ri = rs(seed, 'childInterest');
  const interests = {};
  for (const k of C.interests.keys) {
    const t = C.interests.fromTalent[k];
    const v = C.interests.base + (t ? talents[t] * C.interests.talentGain : 0) + (ri() - 0.5) * 2 * C.interests.noise;
    interests[k] = Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
  }
  const rnm = rs(seed, 'childName');
  const { surname, given: gn } = rollName(rnm, idn, sex);
  const given = gn.length === 1 ? surname + gn : gn; // 單名：文字裡叫全名，只叫一個字很怪
  // 孩子對教養的「接受度」：同樣的做法，有的孩子反應大、有的小（個別差異；用自己的亂數流，不影響其他抽籤）
  const RS = C.responsive, rr = rs(seed, 'childResp');
  const responsive = Math.round(Math.max(RS.min, Math.min(RS.max, 1 + gauss(rr) * RS.sd)) * 100) / 100;
  const child = { name: surname + given, given, sex, pronoun: sex === '男' ? '他' : '她', birthMonth, temperament, talents, interests, needs, responsive };

  // 12 手足（受城鄉略微影響）；孩子出生時只有哥哥姐姐，弟弟妹妹排在之後的某個回合
  const S = idn.siblings;
  const rsb = rs(seed, 'siblings');
  let cw = S.countW.slice();
  if (tight) cw = mulArr(cw, S.ruralMult);
  if (urban === '都會核心') cw = mulArr(cw, S.coreMult);
  const nSib = wpick(rsb, [0, 1, 2, 3], cw);
  const siblings = [];
  for (let i = 0; i < 3; i++) {
    const u1 = rsb(), u2 = rsb(), u3 = rsb(), u4 = rsb();
    if (i >= nSib) continue;
    const older = u1 < S.olderP, male = u3 < 0.5;
    const gap = S.olderGap[0] + Math.floor(u2 * (S.olderGap[1] - S.olderGap[0] + 1));
    siblings.push(older ? { rel: male ? '哥哥' : '姐姐', older: true, ageGap: gap, arriveTurn: null }
      : { rel: male ? '弟弟' : '妹妹', older: false, ageGap: 0, arriveTurn: S.youngerTurn[0] + Math.floor(u4 * (S.youngerTurn[1] - S.youngerTurn[0] + 1)) });
  }
  // 9b 孩子的空間：要等手足確定之後才算（獨立亂數流）
  const nOlderNow = siblings.filter((s) => s.older).length;
  let sw = mulArr(mulArr(H.spaceBase.slice(), H.spaceByEcon[econ]), H.spaceByUrban[urban]);
  if (H.spaceByHousing[housing]) sw = mulArr(sw, H.spaceByHousing[housing]);
  if (nOlderNow > 0) { sw[1] = 0.5 * H.spaceSiblings[1]; sw[0] *= H.spaceSiblings[0]; }
  const space = wpick(rs(seed, 'space'), H.space, sw);

  // 12b 寵物
  const P = idn.pets;
  const rp = rs(seed, 'pet');
  let pw = mulArr(P.base, P.byHousing[housing]);
  pw = mulArr(pw, P.byUrban[urban]);
  if (P.byEcon[econ]) pw = mulArr(pw, P.byEcon[econ]);
  const petKind = wpick(rp, P.options, pw);
  const smallKind = wpick(rp, P.small, P.smallW);
  const nameRoll = rp();
  const names = petKind === '狗' ? P.dogNames : petKind === '貓' ? P.catNames : P.smallNames;
  const pet = petKind === '沒有' ? null : { kind: petKind, type: petKind === '小動物' ? smallKind : petKind, name: names[Math.floor(nameRoll * names.length)] };

  // 13 學區國小（目前只有占位名；真實名冊之後再補）
  const rsc = rs(seed, 'school');
  const [lo, hi] = idn.school.classSize[urban];
  const school = { name: idn.school.pattern.replace('{district}', district), classSize: lo + Math.floor(rsc() * (hi - lo + 1)) };

  // 學前托育（「從國小開始」時用；DATA §4）
  const rcc = rs(seed, 'childcare');
  const cc = idn.childcare;
  const eldersOk = eldersStatus === '同住' || eldersStatus === '住附近會幫忙';
  const mode = wpick(rcc, cc.modes, [cc.w[0], eldersOk ? cc.w[1] : 0, cc.w[2]]);
  const daycare = wpick(rcc, cc.daycare, cc.daycareW);
  const kindergarten = wpick(rcc, cc.kindergarten, cc.kindergartenW.map((w, i) => (i === 4 && !eldersOk ? 0 : w)));
  const childcare = { mode, daycare: mode === '送托' ? daycare : null, kindergarten };

  return {
    seed, county: county.name, district, urban,
    job: { name: job.name, line: job.line }, pattern, econ, econRaw,
    structure: struct.id, partner, elders, housing, space, support, upbringing,
    child, siblings, pet, school, childcare,
  };
}

/** 條件環境裡跟家庭有關的部分（用在 startAdjust 與卡片條件） */
export function familyCtx(fam, role) {
  const adhd = fam.child.needs.find((n) => n.kind === 'ADHD');
  return {
    角色: role, 經濟: fam.econ, 城鄉: fam.urban, 職業: fam.job.name, 工時: fam.pattern, 家庭: fam.structure,
    另一半: fam.partner.attitude || '', 有另一半: !!fam.partner.present, 長輩: fam.elders.status, 住屋: fam.housing, 孩子空間: fam.space,
    升學資源: fam.support, 被帶大: fam.upbringing, 手足數: fam.siblings.filter((s) => s.older).length,
    有寵物: !!fam.pet, 寵物種類: fam.pet ? fam.pet.type : '',
    孩子性別: fam.child.sex, 孩子活動量: fam.child.temperament.活動量, 孩子敏感度: fam.child.temperament.敏感度, 孩子堅持度: fam.child.temperament.堅持度,
    有特殊需求ADHD: !!adhd, 有特殊需求: fam.child.needs.some((n) => n.kind !== '資優'),
    偏鄉: fam.urban === '偏鄉' || fam.urban === '離島', 都會: fam.urban === '都會核心' || fam.urban === '都會外圍',
  };
}


/* ───────────── 開場文字（給家長看的白話） ───────────── */
export const partnerWord = (role, fam) => (fam.partner.present ? (role === '爸爸' ? '孩子的媽媽' : '孩子的爸爸') : role === '爸爸' ? '孩子的媽媽' : '孩子的爸爸');

const ATT_LINE = {
  一起陪: '對方願意一起帶孩子，家務和半夜起床大致會輪流。',
  只出錢: '對方主要負責賺錢，孩子的大小事多半落在你身上。',
  幾乎不在家: '對方工作忙，很少在家，家裡的事幾乎是你一個人在顧。',
  會反對你的做法: '對方對怎麼帶孩子有很多自己的想法，常常和你的做法不一樣。',
};
const EX_LINE = {
  一起陪: '孩子還是會定期見到對方，你們盡量在帶孩子的事上有商量。',
  只出錢: '對方有付孩子的費用，但很少見面。',
  幾乎不在家: '對方現在幾乎不見孩子。',
};
const TEMP_LINE = (t) => {
  const bits = [];
  if (t.活動量 >= 4) bits.push('手腳一刻不停');
  if (t.活動量 <= 2) bits.push('很安靜');
  if (t.敏感度 >= 4) bits.push('一點聲音就會醒');
  if (t.敏感度 <= 2) bits.push('不太挑剔');
  if (t.堅持度 >= 4) bits.push('想要的東西就是不肯放');
  if (t.堅持度 <= 2) bits.push('很容易被轉移注意力');
  return bits.length ? `月子裡你就發現，${bits.slice(0, 2).join('，')}。` : '月子裡你還在摸索，只知道他是個普通的新生兒。';
};

export function openingText(fam, role) {
  const c = fam.child;
  const P = c.pronoun;
  const pw = partnerWord(role, fam);
  const sibN = fam.siblings.filter((s) => s.older);
  const order = sibN.length ? `家裡已經有${sibN.map((s) => s.rel).join('和')}，${c.given}排行比較小。` : '這是你的第一個孩子。';
  const paras = [];
  paras.push(`你是${c.given}的${role}。${c.name}在${c.birthMonth}月出生，家住${fam.county}${fam.district}。${order}`);
  paras.push(`${fam.job.line}，${patternLine(fam).replace(/^你/, '')}。${({ 寬裕: '家裡經濟寬裕', 小康: '家裡經濟小康', 吃緊: '家裡經濟有點吃緊' })[fam.econ]}。`);
  const struct = { 雙親: '', 離異: `你和${pw}已經分開，孩子平常跟你住。`, 隔代: `你在外地工作，${c.given}平常主要由${fam.elders.who || '長輩'}帶。`, 重組: `你再婚了，家裡多了一位新的家人，孩子還在適應。`, 喪親: `${pw}已經不在了，現在是你一個人帶孩子。` }[fam.structure];
  if (struct) paras.push(struct);
  if (fam.partner.present) paras.push(`${pw}${fam.partner.job ? `的工作是${fam.partner.job}。` : '。'}${ATT_LINE[fam.partner.attitude]}`);
  else if (fam.partner.attitude) paras.push(EX_LINE[fam.partner.attitude]);
  const elderTxt = { 同住: `${fam.elders.who}和你們同住，可以搭把手，也會有不同的意見。`, 住附近會幫忙: `${fam.elders.who}住在附近，需要的時候會來幫忙。`, 住遠: `${fam.elders.who}住得比較遠，一年見不了幾次。`, 沒有: '身邊沒有長輩可以幫忙，什麼都要靠自己和另一半。' }[fam.elders.status];
  paras.push(`${elderTxt}你們住的是${fam.housing === '住長輩家' ? '長輩的房子' : fam.housing === '租屋' ? '租來的房子' : '自己的房子'}${fam.space === '自己的房間' ? '，之後孩子可以有自己的房間' : fam.space === '和手足同房' ? '，之後孩子會和手足同一間房' : '，空間不大，之後孩子多半在客廳或餐桌寫功課'}。`);
  paras.push(idnSupport(fam));
  paras.push(`${TEMP_LINE(c.temperament)}`);
  if (fam.pet) paras.push(`家裡本來就有一隻${fam.pet.type === fam.pet.kind ? fam.pet.kind : fam.pet.type}，叫${fam.pet.name}。`);
  paras.push(`學區的國小是${fam.school.name}，離現在還很遠。接下來要陪${P}長大了。`);
  return paras;
}
function patternLine(fam) {
  return { 朝九晚五: '你大多朝九晚五，晚餐和睡前通常都在家', 常加班: '你常常加班，晚餐桌上不一定看得到你', 輪班: '你輪班，有些週整週都不在晚餐桌上', 清晨開店: '你清晨就得出門，早上家裡沒有人，下午比較能顧到孩子', 晚上工作: '你的工作多在晚上，晚餐和睡前常常不在家，早上才有力氣陪', 常出差: '你常出差，一出門就是好幾天' }[fam.pattern];
}
function idnSupport(fam) {
  return { 自己就是資源: '你熟悉升學制度，知道去哪裡問；代價是對孩子的期待也容易偏高。', 花錢買資源: '你不太熟升學制度，但願意把錢花在補習、才藝和營隊上。', 自己找資源: '你工時長，能給孩子的主要是信任和放手；要靠學校、老師和自己去問、去找。' }[fam.support];
}

/* 學前托育的文字（「從國小開始」時在開場交代） */
export function childcareText(fam) {
  const c = fam.childcare, P = fam.child.pronoun;
  const first = { 父母自己帶: `${fam.child.given}小時候主要是你們自己帶。`, 長輩主要照顧: `${fam.child.given}小時候主要由${fam.elders.who || '長輩'}照顧。`, 送托: `${fam.child.given}小時候送去${c.daycare}。` }[c.mode];
  const kg = { 公立或非營利幼兒園: '上的是公立（或非營利）幼兒園', 準公共幼兒園: '上的是準公共幼兒園', 私立幼兒園: '上的是私立幼兒園', 雙語或美語幼兒園: '上的是雙語幼兒園', 在家給長輩帶: '沒上幼兒園，在家給長輩帶到上小學' }[c.kindergarten];
  return `${first}幼兒園${c.kindergarten === '在家給長輩帶' ? '：' + kg : kg}。現在${P}要上國小了。`;
}
