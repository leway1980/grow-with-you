// 像素家庭場景（DESIGN §8.5）。純函式、無 DOM：沿用《高中，只有一次》(leway1980/Game 47wan) avatar.js 的作法
// （回傳 SVG 字串、像素格、放大不糊、同一個種子畫出同一個人），擴充成「一家人站在家裡」的場景。
//
// 只畫『看得到的狀態』（§3：隱藏值在遊戲中不留痕跡）。sceneSpec 讀的欄位只有：
//   st.family（開局抽籤的家庭組成）、st.role、st.seed、st.turn、
//   st.child.心情／睡眠、st.parent.體力／耐心（畫面上的數值條本來就有）、
//   st.flags 裡的身體照顧旗標（見 BODY_FLAGS，卡片文字已經寫出來的事）、st.vars.養的寵物（選項寫出來的）、
//   目前這張卡的 id／池（卡片標題就在畫面上）、tl（日曆回合）。
// 不讀 st.hidden、st.startHidden、st.dirCount、st.tagCounts、st.costEMA、st.interest、親子「不太來找你」等 st.vars 計數。
import { mulberry32 } from './rng.js';

export const SCENE_W = 96, SCENE_H = 44, FLOOR = 38;

/* ───────────── 看得見的狀態 → 規格（純資料） ───────────── */
/** 身體照顧的旗標名稱（data/events/health.json 的卡設這幾個旗標；打石膏、戴牙套有期限，到期由 turn.js 的 expireFlags 清掉） */
export const BODY_FLAGS = { glasses: '戴眼鏡', orthok: '角膜塑形', braces: '戴牙套', cast: '打石膏' };
/** 這些卡的內容就是孩子生病或受傷（卡片標題就寫在畫面上） */
const SICK_CARDS = new Set(['inf_sick', 'inf_sick_young', 'kid_quarantine', 'cm_hospital']);
const PLASTER_CARDS = new Set(['cm_scrape']);
/** 這一回合的事件道具：只在卡片當回合出現，而且只用「卡片文字已經寫出來」的事 */
const CARD_PROP = {
  lo_exam: 'paper', hi_paper_drawer: 'paper', fu_cram_after: 'paper', hi_prep_night: 'book',
  lo_want_art: 'drawing', lo_club: 'ball', fu_team: 'ball', fu_team2: 'ball', fu_team_bench: 'ball', lo_team_bench: 'ball', fx_sports_day: 'ball',
  kid_trip: 'trip', lo_trip: 'trip', hi_trip: 'trip', fx_field_trip: 'trip', hi_camp_choice: 'trip',
  fu_pet_care: 'bowl', lo_pet_forget: 'bowl', inf_pet_follow: 'bowl',
  fx_enroll: 'bag', fx_graduation: 'award',
};
const PHONE_CARDS = new Set(['fu_screen_ask', 'hi_game_pay', 'inf_phone_grab', 'lo_3c_stash', 'fu_phone_test', 'fu_phone_reclaim', 'fu_elder_screen', 'kid_tv_off']);
const WORK_POOLS = new Set(['工作插播', '工作插播後續']);
const NIGHT_POOLS = new Set(['夫妻', '3C', '手機後續', '工作插播', '工作插播後續', '父母自己']);
const MORNING_POOLS = new Set(['上下學']);

const SKINS = ['#f7d9bf', '#efc7a0', '#e2ad84', '#cd9468', '#a86f49'];
const HAIRS = ['#4a3226', '#5a3b28', '#6b4a2f', '#3a2a24'];
const ROLE_OF = { 哥哥: 'sibling', 姐姐: 'sibling', 弟弟: 'sibling', 妹妹: 'sibling' };
const MALE_REL = new Set(['哥哥', '弟弟']);
const CLOTHES = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
const BOTTOMS = ['p1', 'p2', 'p3'];
const PET_FUR = ['pet1', 'pet3', 'pet4'];

/** 月齡 → 外觀階段 */
export function stageOfMonths(m) {
  return m < 12 ? '嬰兒' : m < 72 ? '幼兒' : m < 144 ? '國小' : m < 180 ? '國中' : m < 216 ? '高中' : '離家';
}
/** 回合 → 孩子的外觀階段（日曆有年級就用年級，沒有就用月齡；『離家』階段名稱一律是離家） */
export function childStageOf(tl) {
  if (tl.stage === '離家') return '離家';
  if (tl.grade >= 1) return tl.grade <= 6 ? '國小' : tl.grade <= 9 ? '國中' : '高中';
  return stageOfMonths(tl.ageMonths);
}

const moodOf = (v) => (v >= 60 ? 'happy' : v < 38 ? 'sad' : 'neutral');
const lowOf = (v) => v < 38; // 數值條的字是『有點低』以下

function housingKind(fam) {
  const rural = fam.urban === '偏鄉' || fam.urban === '離島';
  if (fam.housing === '租屋') return 'rental';
  if (fam.housing === '住長輩家') return rural ? 'sanhe' : 'elder';
  return fam.urban === '都會核心' || fam.urban === '都會外圍' ? 'flat' : 'house';
}

function todOf(tl, pool) {
  if (MORNING_POOLS.has(pool)) return 'morning';
  if (NIGHT_POOLS.has(pool)) return 'night';
  return ['evening', 'morning', 'evening', 'night'][tl.turn % 4];
}

/**
 * 場景規格。st：遊戲狀態；data：已整備的資料（要 data.timeline、data.cardIndex）；tl：回合（預設目前的回合）。
 * opts.portrait：全家福（不畫這一回合的事件道具、生病、手機與電腦包）。
 */
export function sceneSpec(st, data, tl, opts = {}) {
  tl ||= data.timeline[Math.min(st.turn, data.timeline.length - 1)];
  const fam = st.family, portrait = !!opts.portrait;
  const R = mulberry32(((st.seed >>> 0) ^ 0x5ce4e11e) >>> 0);
  const rr = Array.from({ length: 48 }, () => R()); // 固定消耗：外觀只由種子決定，和任何狀態無關
  const skin = SKINS[Math.min(SKINS.length - 1, Math.floor(rr[0] * rr[1] * 3.2 + rr[2] * 1.9))];
  const hairC = (i) => HAIRS[Math.floor(rr[3 + (i % 8)] * HAIRS.length)];
  const cur = !portrait && st.cur && st.cur.cardId ? st.cur.cardId : null;
  const pool = cur && data.cardIndex && data.cardIndex[cur] ? data.cardIndex[cur].pool : '';
  const flags = st.flags || {};
  const vacation = !portrait && !!tl.vacation;
  const childMonths = tl.ageMonths;
  const cs = childStageOf(tl);
  const cMood = moodOf(st.child.心情), cTired = lowOf(st.child.睡眠);
  const pTired = lowOf(st.parent.體力) || lowOf(st.parent.耐心);
  const pStoop = st.parent.體力 < 22;
  const sick = !portrait && (SICK_CARDS.has(cur));
  const workPing = !portrait && WORK_POOLS.has(pool);
  const phoneCard = !portrait && PHONE_CARDS.has(cur);
  const prop = portrait ? null : CARD_PROP[cur] || null;
  const female = fam.child.sex === '女';

  const members = [];
  const dad = st.role === '爸爸';
  // 長輩：同住才畫；住附近的只在『長輩帶孩子』那一回合出現
  const eldersHere = fam.elders && (fam.elders.status === '同住' || (fam.elders.status === '住附近會幫忙' && pool === '長輩帶孩子'));
  if (eldersHere) {
    const who = fam.elders.who || '阿公阿嬤';
    const pair = who === '阿公阿嬤' || who === '外公外婆';
    if (pair) members.push({ who: 'elder', sex: '男', stage: 'elder', skin, hair: 'bald', hairC: 'grey', stoop: true, top: CLOTHES[Math.floor(rr[20] * 6)], bottom: 'p2' });
    members.push({ who: 'elder', sex: '女', stage: 'elder', skin, hair: 'bun', hairC: 'grey', stoop: true, top: CLOTHES[Math.floor(rr[21] * 6)], bottom: 'p3' });
  }
  const partnerHere = !!(fam.partner && fam.partner.present && fam.partner.status === '同住');
  if (partnerHere) {
    members.push({ who: 'partner', sex: dad ? '女' : '男', stage: 'adult', skin, hair: dad ? (rr[22] < 0.5 ? 'long' : 'bun') : 'short', hairC: hairC(1), top: CLOTHES[Math.floor(rr[23] * 6)], bottom: BOTTOMS[Math.floor(rr[24] * 3)], phone: false });
  }
  // 玩家：隔代家庭你在外地，平常是用視訊（畫面上你拿著手機）
  members.push({
    who: 'player', sex: dad ? '男' : '女', stage: 'adult', skin, hair: dad ? 'short' : (rr[25] < 0.5 ? 'long' : 'pony'), hairC: hairC(2),
    top: CLOTHES[Math.floor(rr[26] * 6)], bottom: BOTTOMS[Math.floor(rr[27] * 3)],
    tired: pTired, stoop: pStoop, bag: workPing, phone: fam.structure === '隔代' && !portrait ? true : false, mood: portrait ? 'happy' : 'neutral',
  });
  // 孩子
  const childStyle = cs === '嬰兒' || cs === '幼兒' ? (female ? 'pony' : 'fringe') : female ? (rr[28] < 0.5 ? 'long' : 'pony') : (rr[28] < 0.5 ? 'short' : 'fringe');
  const child = {
    who: 'child', sex: fam.child.sex, stage: cs, skin, hair: childStyle, hairC: hairC(4),
    top: CLOTHES[Math.floor(rr[29] * 6)], bottom: BOTTOMS[Math.floor(rr[30] * 3)], skirt: female && rr[31] < 0.5,
    uniform: !vacation && (cs === '國中' || cs === '高中'), school: !vacation && cs === '國小',
    mood: cMood, tired: cTired, held: cs === '嬰兒' && childMonths >= 6 && fam.structure !== '隔代',
    glasses: !!flags[BODY_FLAGS.glasses], braces: !!flags[BODY_FLAGS.braces], cast: !!flags[BODY_FLAGS.cast], orthok: !!flags[BODY_FLAGS.orthok],
    sick, plaster: !portrait && PLASTER_CARDS.has(cur), phone: (phoneCard && cs !== '嬰兒') || (cs === '高中' && !portrait),
    suitcase: cs === '離家',
  };
  members.push(child);
  // 手足：弟弟妹妹出生之後才出現，各自照自己的年紀長大
  (fam.siblings || []).forEach((s, i) => {
    const m = s.older ? childMonths + s.ageGap * 12 : childMonths - s.arriveMonths;
    if (!s.older && (s.arriveMonths == null || s.arriveMonths > childMonths)) return;
    const stg = stageOfMonths(m);
    if (stg === '離家') return; // 已經不住家裡
    const sex = MALE_REL.has(s.rel) ? '男' : '女';
    members.push({
      who: 'sibling', rel: s.rel, sex, stage: stg, ageMonths: m, skin, hair: stg === '嬰兒' || stg === '幼兒' ? (sex === '女' ? 'pony' : 'fringe') : sex === '女' ? 'long' : 'short', hairC: hairC(5 + i),
      top: CLOTHES[Math.floor(rr[32 + i] * 6)], bottom: BOTTOMS[Math.floor(rr[36 + i] * 3)], skirt: sex === '女' && rr[40 + i] < 0.5,
      uniform: !vacation && (stg === '國中' || stg === '高中'), school: !vacation && stg === '國小', mood: 'neutral', tired: false,
    });
  });
  // 寵物：開局抽到的，或遊戲中答應養的（選項文字有寫）
  let pet = fam.pet ? fam.pet.type : null;
  if (!pet && flags['養了寵物'] && st.vars && st.vars.養的寵物) pet = st.vars.養的寵物;
  const home = housingKind(fam);
  return {
    v: 1, kind: 'scene', home, vacation, tod: portrait ? 'morning' : todOf(tl, pool), portrait,
    stage: cs, role: st.role, members, pet: pet ? { type: pet, fur: PET_FUR[Math.floor(rr[44] * 3)] } : null, prop, petBowl: prop === 'bowl',
    parentFatigue: { circles: pTired, stoop: pStoop }, workPing, childName: fam.child.given,
    ageLabel: tl.label,
  };
}

/** 結局的成長相簿：孩子到過的每個階段各一張（只畫孩子） */
export function albumSpecs(st, data) {
  const last = Math.min(st.turn, data.calendar.playableTurns) - 1; // 玩到離家，相簿也有國中、高中、離家
  const seen = new Map();
  for (let i = 0; i <= Math.max(0, last); i++) {
    const tl = data.timeline[i];
    if (!tl) break;
    const stg = childStageOf(tl);
    seen.set(stg, tl); // 同一階段留最後一回合（長最大的樣子）
  }
  const out = [];
  for (const [stg, tl] of seen) {
    const sp = sceneSpec(st, data, tl, { portrait: true });
    const child = { ...sp.members.find((m) => m.who === 'child'), mood: 'happy', tired: false, sick: false, plaster: false, phone: false, held: false };
    out.push({ v: 1, kind: 'sprite', stage: stg, label: ALBUM_LABEL[stg] || stg, ageLabel: tl.label, member: child, childName: sp.childName });
  }
  return out;
}
const ALBUM_LABEL = { 嬰兒: '嬰兒時期', 幼兒: '幼兒時期', 國小: '國小', 國中: '國中', 高中: '高中', 離家: '離家那天' };

/* ───────────── 文字描述（無障礙） ───────────── */
const HOME_WORD = { rental: '租來的公寓', flat: '自己家的大樓住宅', house: '自己家的透天厝', elder: '長輩的老房子', sanhe: '鄉下的三合院' };
const TOD_WORD = { morning: '早上', evening: '傍晚', night: '晚上' };
const PET_WORD = { 狗: '一隻狗', 貓: '一隻貓', 倉鼠: '一隻倉鼠', 兔子: '一隻兔子', 烏龜: '一隻烏龜', 魚: '一缸魚' };
const PROP_WORD = { paper: '手邊有一張考卷', book: '桌上攤著書本', drawing: '旁邊有一張畫', ball: '旁邊有一顆球', trip: '旁邊放著出門的行李', bowl: '寵物的碗放在一旁', bag: '背著新書包', award: '手裡拿著獎狀' };
const STAGE_WORD = { 嬰兒: '嬰兒', 幼兒: '幼兒', 國小: '國小的孩子', 國中: '國中生', 高中: '高中生', 離家: '準備離家的孩子' };

export function sceneAlt(spec) {
  if (spec.kind === 'sprite') return `${spec.childName}${spec.label}的樣子`;
  const m = spec.members;
  const who = [];
  const dad = spec.role === '爸爸';
  who.push(dad ? '爸爸' : '媽媽');
  if (m.some((x) => x.who === 'partner')) who.push(dad ? '媽媽' : '爸爸');
  const el = m.filter((x) => x.who === 'elder').length;
  if (el) who.push(el === 2 ? '阿公阿嬤' : '一位長輩');
  const sibs = m.filter((x) => x.who === 'sibling');
  if (sibs.length) who.push(sibs.map((s) => s.rel).join('、'));
  const c = m.find((x) => x.who === 'child');
  const place = spec.vacation ? '戶外' : HOME_WORD[spec.home];
  const parts = [spec.portrait ? `全家福，在${HOME_WORD[spec.home]}` : `${TOD_WORD[spec.tod]}，在${place}`];
  parts.push(`${who.join('、')}和${STAGE_WORD[c.stage]}${spec.childName}一家人在一起`);
  const feel = c.mood === 'happy' ? '看起來心情不錯' : c.mood === 'sad' ? '看起來心情低落' : '表情平平的';
  const kid = [feel];
  if (c.tired) kid.push('沒睡飽的樣子');
  if (c.sick) kid.push(c.stage === '嬰兒' ? '臉紅紅的' : '戴著口罩');
  if (c.glasses) kid.push('戴著眼鏡');
  if (c.braces) kid.push('戴著牙套');
  if (c.cast) kid.push('手臂打著石膏');
  if (c.plaster) kid.push('膝蓋貼著 OK 繃');
  if (c.orthok) kid.push('旁邊有一個角膜塑形片的盒子');
  if (c.suitcase) kid.push('旁邊有一只行李箱');
  parts.push(`${spec.childName}${kid.join('，')}`);
  if (spec.parentFatigue.circles) parts.push(`${dad ? '爸爸' : '媽媽'}有黑眼圈，看起來很累`);
  if (spec.workPing) parts.push(`${dad ? '爸爸' : '媽媽'}背著電腦包，手上還在處理工作`);
  if (spec.prop && PROP_WORD[spec.prop] && !spec.portrait) parts.push(PROP_WORD[spec.prop]);
  if (spec.pet) parts.push(`家裡有${PET_WORD[spec.pet.type] || '一隻寵物'}`);
  return parts.join('；') + '。';
}

/* ───────────── 像素畫布 ───────────── */
const mkGrid = (w = SCENE_W, h = SCENE_H) => Array.from({ length: h }, () => Array(w).fill(null));
/** 人物、寵物與道具放大 FS 倍（畫在 1/FS 解析度的格子上，再用 scale 放大）：360px 寬的手機上，臉才看得清楚 */
const FS = 2, FGW = SCENE_W / FS, FGH = SCENE_H / FS, FGFLOOR = FLOOR / FS;
const inb = (g, x, y) => y >= 0 && y < g.length && x >= 0 && x < g[0].length;
function put(g, x, y, c) { if (c && inb(g, x, y)) g[y][x] = c; }
function rect(g, x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) put(g, x + i, y + j, c); }
const OUTLINE = '#3b2a24'; // 輪廓：暖褐色、半透明（不是純黑）
const fillOf = (c) => (c[0] === '#' ? c : `var(--sc-${c})`);
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** 把十六進位色調暗（輪廓用）；不是十六進位色就原樣回傳 */
const darker = (h, f) => (h && h[0] === '#' && h.length === 7 ? '#' + hexRgb(h).map((v) => Math.round(v * f).toString(16).padStart(2, '0')).join('') : h);
/** 頭部另畫在 2 倍解析度的格子上（眼睛、嘴才能是 1px 的小點）；HG 是目前這一張圖的頭部層 */
const HS = 2;
let HG = null;

/** 把一層像素格壓成 <rect>：同一列相同顏色連成一條，上下相同的條合併成較高的矩形 */
function emit(g) {
  const rects = [], GW = g[0].length, GH = g.length;
  let open = new Map();
  for (let y = 0; y < GH; y++) {
    const next = new Map();
    let x = 0;
    while (x < GW) {
      const c = g[y][x];
      if (!c) { x++; continue; }
      let w = 1;
      while (x + w < GW && g[y][x + w] === c) w++;
      const key = `${x},${w},${c}`;
      const prev = open.get(key);
      if (prev) { prev.h++; next.set(key, prev); } else { const r = { x, y, w, h: 1, c }; rects.push(r); next.set(key, r); }
      x += w;
    }
    open = next;
  }
  return rects.map((r) => `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="${r.c === 'ol' ? OUTLINE : fillOf(r.c)}"${r.c === 'ol' ? ' fill-opacity=".34"' : ''}/>`).join('');
}
/** 身體、道具、寵物的 1px 暗色輪廓：畫在頭部層（2 倍解析度）空著的格子上，貼著前景外緣 */
function outlinePass(fg, hg) {
  const occ = (X, Y) => { const x = X >> 1, y = Y >> 1; return y >= 0 && y < fg.length && x >= 0 && x < fg[0].length && !!fg[y][x]; };
  for (let Y = 0; Y < hg.length; Y++) for (let X = 0; X < hg[0].length; X++) {
    if (hg[Y][X] || occ(X, Y)) continue;
    if (occ(X - 1, Y) || occ(X + 1, Y) || occ(X, Y - 1) || occ(X, Y + 1)) hg[Y][X] = 'ol';
  }
}

/* ───────────── 人物 ───────────── */
const SIZE = {
  幼兒: { tw: 4, tr: 3, lg: 2 }, 國小: { tw: 5, tr: 4, lg: 3 }, 國中: { tw: 6, tr: 5, lg: 4 }, 高中: { tw: 6, tr: 5, lg: 5 },
  離家: { tw: 6, tr: 6, lg: 5 }, adult: { tw: 6, tr: 6, lg: 5 }, elder: { tw: 6, tr: 5, lg: 4 },
};
/** 頭（10×12 的 2 倍解析度格子，圓角）：小圓眼、小彎嘴、淡腮紅、旁分瀏海；lx、ly 是半解析度座標 */
const HEAD_SPAN = [[2, 7], [1, 8], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [1, 8], [2, 7]];
const MOUTHS = {
  happy: [[3, 9], [4, 10], [5, 10], [6, 9]], neutral: [[4, 10], [5, 10]], sad: [[3, 10], [4, 9], [5, 9], [6, 10]],
  droop: [[3, 11], [4, 10], [5, 10], [6, 11]],
};
function drawHead(lx, ly, o) {
  const g = HG, ox = lx * HS, oy = ly * HS;
  const P = (x, y, c) => put(g, ox + x, oy + y, c);
  const inSp = (x, y) => y >= 0 && y < 12 && x >= HEAD_SPAN[y][0] && x <= HEAD_SPAN[y][1];
  const skin = o.skin, edge = darker(skin, 0.8);
  const hc = o.hairC === 'grey' ? '#d6d1c8' : o.hairC, hline = darker(hc, 0.8), st = o.hair;
  for (let y = 0; y < 12; y++) for (let x = HEAD_SPAN[y][0]; x <= HEAD_SPAN[y][1]; x++) P(x, y, inSp(x - 1, y) && inSp(x + 1, y) && inSp(x, y - 1) && inSp(x, y + 1) ? skin : edge);
  // 頭髮：頂部整片，瀏海旁分（中間留一條縫），長髮／馬尾／包頭另外加
  const H = (x0, x1, y) => { for (let x = x0; x <= x1; x++) P(x, y, hc); };
  if (st === 'bald') { P(0, 3, hc); P(9, 3, hc); H(0, 0, 4); H(9, 9, 4); H(0, 0, 5); H(9, 9, 5); } else {
    for (let y = 0; y <= 3; y++) H(HEAD_SPAN[y][0], HEAD_SPAN[y][1], y);
    if (st === 'fringe' || st === 'pony') { H(0, 4, 4); H(6, 9, 4); P(5, 4, hc); H(0, 0, 5); H(9, 9, 5); } else { H(0, 3, 4); H(6, 9, 4); H(0, 0, 5); H(9, 9, 5); }
    if (st === 'long') for (let y = 5; y <= 11; y++) { P(0, y, hc); P(9, y, hc); if (y >= 6) { P(-1, y, hc); P(10, y, hc); } }
    if (st === 'pony') { for (let y = 3; y <= 9; y++) P(10, y, hc); for (let y = 5; y <= 10; y++) P(11, y, hc); P(10, 4, 'c6'); P(10, 5, 'c6'); }
    if (st === 'bun') { H(3, 6, -3); H(2, 7, -2); H(2, 7, -1); H(3, 6, 0); }
    P(0, 2, hline); P(9, 2, hline);
  }
  if (o.cap) { for (let y = 0; y <= 2; y++) H2(g, ox + HEAD_SPAN[y][0], ox + HEAD_SPAN[y][1], oy + y, 'cap'); H2(g, ox - 1, ox + 10, oy + 3, 'cap2'); P(-1, 4, 'cap2'); P(10, 4, 'cap2'); }
  const eye = 'eye';
  const brow = darker(hc, 0.85);
  // 眼睛：1×2 的小點、放在臉的中下方；沒睡飽的眼睛下面有一條淡紫灰的眼袋
  P(2, 7, eye); P(2, 8, eye); P(7, 7, eye); P(7, 8, eye);
  if (o.mood === 'sad') { P(1, 6, brow); P(2, 6, brow); P(3, 5, brow); P(6, 5, brow); P(7, 6, brow); P(8, 6, brow); }
  if (o.glasses) {
    for (const x0 of [1, 6]) { H3(P, x0, x0 + 2, 6, 'rim'); H3(P, x0, x0 + 2, 9, 'rim'); P(x0, 7, 'rim'); P(x0, 8, 'rim'); P(x0 + 2, 7, 'rim'); P(x0 + 2, 8, 'rim'); }
    P(4, 7, 'rim'); P(5, 7, 'rim');
  }
  const happy = o.mood === 'happy' && !o.tired && !o.sick;
  if (o.tired) { if (o.glasses) { P(2, 10, 'bags'); P(7, 10, 'bags'); } else { P(1, 9, 'bags'); P(2, 9, 'bags'); P(7, 9, 'bags'); P(8, 9, 'bags'); } }
  // 嘴：淡玫瑰褐的小彎線；開心才有腮紅
  const mood = o.mood === 'sad' ? 'sad' : o.tired ? 'droop' : o.mood === 'happy' ? 'happy' : 'neutral';
  for (const [mx, my] of MOUTHS[mood]) P(mx, my, 'mouth');
  if (happy && !o.glasses) { H3(P, 1, 2, 9, 'blush'); H3(P, 7, 8, 9, 'blush'); }
  if (o.braces && mood === 'happy') { P(4, 10, 'metal'); P(5, 10, 'metal'); }
  if (o.sick) { for (let y = 9; y <= 11; y++) for (let x = HEAD_SPAN[y][0]; x <= HEAD_SPAN[y][1]; x++) P(x, y, 'mask'); P(0, 9, 'mask'); P(9, 9, 'mask'); P(0, 8, 'mask'); P(9, 8, 'mask'); }
}
function H2(g, x0, x1, y, c) { for (let x = x0; x <= x1; x++) put(g, x, y, c); }
function H3(P, x0, x1, y, c) { for (let x = x0; x <= x1; x++) P(x, y, c); }

function drawPerson(g, cx, fy, o) {
  const S = SIZE[o.stage === 'elder' ? 'elder' : o.stage === 'adult' ? 'adult' : o.stage];
  const { tw, tr, lg } = S;
  const x0 = cx - 2, tx = x0 - (tw > 5 ? 1 : 0);
  const ty = fy - lg - tr;
  const skirt = !!o.skirt;
  const top = o.uniform ? (o.stage === '國中' ? 'uni1' : 'uni3') : o.top;
  const bottom = o.uniform ? (o.stage === '國中' ? 'uni2' : 'uni4') : o.bottom;
  // 腿
  const lx = tx + 1, lw = tw - 2;
  for (let r = 0; r < lg; r++) {
    const y = fy - lg + r;
    if (skirt && r === 0) { rect(g, tx, y, tw, 1, bottom); continue; }
    const col = skirt ? o.skin : bottom;
    rect(g, lx, y, lw, 1, col);
    if (r >= 2 && lw >= 3) g[y][lx + (lw === 3 ? 1 : 2)] = null;
  }
  if (!o.noShoes) { rect(g, lx, fy - 1, lw, 1, 'shoe'); if (lw >= 3 && lg >= 3) g[fy - 1][lx + (lw === 3 ? 1 : 2)] = null; }
  if (o.plaster && lg >= 3) put(g, lx, fy - lg + 1, 'plaster');
  // 書包（藏在身體後面：兩側鼓出來的包身 + 肩帶）
  if (o.school) { rect(g, tx - 2, ty + 1, 1, tr - 1, 'pack'); rect(g, tx + tw + 1, ty + 1, 1, tr - 1, 'pack'); }
  // 身體與手臂
  rect(g, tx, ty, tw, tr, top);
  if (o.uniform) put(g, tx + Math.floor(tw / 2) - 1, ty, 'uni5'), put(g, tx + Math.floor(tw / 2), ty, 'uni5');
  if (o.school) { rect(g, tx + 1, ty, 1, tr, 'strap'); rect(g, tx + tw - 2, ty, 1, tr, 'strap'); }
  for (const ax of [tx - 1, tx + tw]) {
    const isCast = o.cast && ax === tx + tw;
    for (let r = 0; r < tr; r++) put(g, ax, ty + r, isCast ? 'cast' : r === tr - 1 ? o.skin : top);
  }
  // 電腦包：肩帶斜過身體、包在腰側
  if (o.bag) {
    for (let r = 0; r < tr; r++) put(g, tx + tw - 1 - Math.min(tw - 1, r), ty + r, 'strapb');
    rect(g, tx + tw + 1, ty + tr - 1, 4, 4, 'bagc'); rect(g, tx + tw + 1, ty + tr - 1, 4, 1, 'strapb');
  }
  if (o.phone) { rect(g, tx + tw + 1, ty + tr - 3, 1, 2, 'phone'); put(g, tx + tw + 1, ty + tr - 3, 'screen'); }
  // 頭（駝背：頭下沉並往前）
  const hx = o.stoop ? x0 + 1 : x0, hy = ty - 6 + (o.stoop ? 1 : 0);
  drawHead(hx, hy, { ...o, cap: o.school });
  // 離家的行李箱
  if (o.suitcase) {
    const sx = tx + tw + 2, sy = fy - 7;
    rect(g, sx, sy, 5, 7, 'suit'); rect(g, sx, sy + 3, 5, 1, 'suit2'); rect(g, sx + 1, sy - 2, 3, 1, 'suit2'); put(g, sx + 1, sy - 1, 'suit2'); put(g, sx + 3, sy - 1, 'suit2');
    put(g, sx, fy - 1, 'ink'); put(g, sx + 4, fy - 1, 'ink');
  }
  return { top: hy, tx, ty, tw, tr };
}

/** 睡著的圓臉寶寶（10×9 的 2 倍解析度）：閉眼的「︶ ︶」、小嘴、淡腮紅；lx、ly 是左上角（頭部層座標） */
const BABY_SPAN = [[2, 7], [1, 8], [0, 9], [0, 9], [0, 9], [0, 9], [0, 9], [1, 8], [2, 7]];
function drawBabyFace(hx, hy, o) {
  const g = HG, P = (x, y, c) => put(g, hx + x, hy + y, c);
  const inSp = (x, y) => y >= 0 && y < 9 && x >= BABY_SPAN[y][0] && x <= BABY_SPAN[y][1];
  const edge = darker(o.skin, 0.8);
  for (let y = 0; y < 9; y++) for (let x = BABY_SPAN[y][0]; x <= BABY_SPAN[y][1]; x++) P(x, y, inSp(x - 1, y) && inSp(x + 1, y) && inSp(x, y - 1) && inSp(x, y + 1) ? o.skin : edge);
  const hc = o.hairC === 'grey' ? '#d6d1c8' : o.hairC;
  for (let x = 3; x <= 6; x++) P(x, 0, hc); for (let x = 2; x <= 7; x++) P(x, 1, hc); P(4, -1, hc); P(5, -1, hc);
  for (const x0 of [1, 6]) { P(x0, 3, 'eye'); P(x0 + 1, 4, 'eye'); P(x0 + 2, 3, 'eye'); } // ︶
  const sick = !!o.sick;
  P(1, 5, sick ? '#ec9a92' : 'blush'); P(2, 5, sick ? '#ec9a92' : 'blush'); P(7, 5, sick ? '#ec9a92' : 'blush'); P(8, 5, sick ? '#ec9a92' : 'blush');
  if (o.mood === 'sad') { P(4, 6, 'mouth'); P(5, 6, 'mouth'); P(3, 7, 'mouth'); P(6, 7, 'mouth'); } else if (o.mood === 'happy') { P(3, 6, 'mouth'); P(4, 7, 'mouth'); P(5, 7, 'mouth'); P(6, 6, 'mouth'); } else { P(4, 6, 'mouth'); P(5, 6, 'mouth'); }
}

/** 嬰兒床（寬 12）：孩子或剛出生的弟妹睡在裡面——圓圓的睡臉靠在小枕頭上，毯子蓋住身體 */
function drawCrib(g, cx, fy, o) {
  const x = cx - 6;
  rect(g, x, fy - 11, 12, 1, 'wood'); rect(g, x, fy - 2, 12, 1, 'wood'); rect(g, x, fy - 1, 1, 1, 'wood2'); rect(g, x + 11, fy - 1, 1, 1, 'wood2');
  for (let i = 0; i < 12; i += 2) rect(g, x + i, fy - 10, 1, 8, i === 0 || i === 10 ? 'wood' : 'wood2');
  rect(g, x + 3, fy - 8, 6, 3, 'white'); // 枕頭
  rect(g, x + 1, fy - 5, 10, 3, 'blanket'); rect(g, x + 1, fy - 5, 10, 1, 'blanket2');
  put(g, x + 3, fy - 3, 'blanket2'); put(g, x + 6, fy - 3, 'blanket2'); put(g, x + 9, fy - 3, 'blanket2'); put(g, x + 4, fy - 4, 'blanket2'); put(g, x + 8, fy - 4, 'blanket2');
  drawBabyFace((x + 3) * HS + 1, (fy - 5) * HS - 9, o);
}

/** 抱著的嬰兒：畫在抱的人身上 */
function drawHeld(g, px, o) {
  const { tx, ty, tw, tr } = px;
  const bx = tx + Math.max(1, tw - 5);
  rect(g, bx, ty + tr - 3, 5, 3, 'blanket'); rect(g, bx, ty + tr - 3, 5, 1, 'blanket2');
  drawBabyFace(bx * HS, (ty + tr - 3) * HS - 9, o);
}

/* ───────────── 寵物 ───────────── */
function drawPet(g, cx, fy, pet) {
  const f = pet.fur, x = cx - 4;
  switch (pet.type) {
    case '狗':
      rect(g, x, fy - 4, 6, 2, f); put(g, x, fy - 1, f); put(g, x + 1, fy - 1, f); put(g, x + 4, fy - 1, f); put(g, x + 5, fy - 1, f); put(g, x + 1, fy - 2, f);
      rect(g, x + 6, fy - 6, 3, 3, f); put(g, x + 6, fy - 7, 'pet2'); put(g, x + 8, fy - 7, 'pet2'); put(g, x + 7, fy - 5, 'ink'); put(g, x + 9, fy - 4, 'ink'); put(g, x - 1, fy - 5, f); put(g, x - 2, fy - 6, f);
      break;
    case '貓':
      rect(g, x + 1, fy - 3, 5, 2, f); put(g, x + 1, fy - 1, f); put(g, x + 5, fy - 1, f);
      rect(g, x + 6, fy - 5, 3, 3, f); put(g, x + 6, fy - 6, f); put(g, x + 8, fy - 6, f); put(g, x + 7, fy - 4, 'ink'); put(g, x + 8, fy - 4, f);
      for (let r = 0; r < 3; r++) put(g, x, fy - 3 - r, f); put(g, x - 1, fy - 5, f);
      break;
    case '魚':
      rect(g, x - 1, fy - 4, 11, 1, 'wood'); rect(g, x, fy - 3, 1, 3, 'wood2'); rect(g, x + 8, fy - 3, 1, 3, 'wood2');
      rect(g, x, fy - 10, 9, 6, 'glass'); rect(g, x + 1, fy - 9, 7, 5, 'water'); put(g, x + 3, fy - 7, 'fish'); put(g, x + 4, fy - 7, 'fish'); put(g, x + 6, fy - 6, 'fish'); put(g, x + 2, fy - 5, 'leaf'); put(g, x + 2, fy - 6, 'leaf'); put(g, x + 7, fy - 5, 'leaf');
      break;
    case '倉鼠':
      rect(g, x + 1, fy - 3, 4, 3, f); put(g, x + 1, fy - 4, 'pet2'); put(g, x + 4, fy - 4, 'pet2'); put(g, x + 2, fy - 2, 'ink'); put(g, x + 4, fy - 2, 'ink');
      rect(g, x + 6, fy - 5, 3, 5, 'glass'); rect(g, x + 6, fy - 1, 3, 1, 'wood');
      break;
    case '兔子':
      rect(g, x, fy - 3, 5, 3, 'white'); rect(g, x + 4, fy - 5, 3, 3, 'white'); put(g, x + 4, fy - 8, 'white'); put(g, x + 4, fy - 7, 'white'); put(g, x + 6, fy - 8, 'white'); put(g, x + 6, fy - 7, 'white'); put(g, x + 5, fy - 4, 'ink'); put(g, x + 6, fy - 3, 'blush');
      put(g, x - 1, fy - 2, 'white');
      break;
    case '烏龜':
      rect(g, x + 1, fy - 3, 6, 2, 'leaf'); rect(g, x + 2, fy - 4, 4, 1, 'leaf2'); put(g, x + 1, fy - 1, 'pet2'); put(g, x + 6, fy - 1, 'pet2');
      rect(g, x + 7, fy - 3, 2, 2, 'pet2'); put(g, x + 8, fy - 3, 'ink');
      break;
    default:
      rect(g, x + 1, fy - 3, 4, 3, f); put(g, x + 2, fy - 2, 'ink');
  }
}
const PET_W = { 狗: 12, 貓: 10, 魚: 11, 倉鼠: 9, 兔子: 9, 烏龜: 9 };

/* ───────────── 事件道具 ───────────── */
function drawProp(g, cx, fy, kind) {
  const x = cx - 2;
  switch (kind) {
    case 'paper': rect(g, x, fy - 12, 5, 6, 'paperw'); put(g, x + 1, fy - 11, 'red'); put(g, x + 2, fy - 11, 'red'); rect(g, x + 1, fy - 9, 3, 1, 'ink'); rect(g, x + 1, fy - 7, 3, 1, 'ink'); break;
    case 'book': rect(g, x, fy - 3, 5, 3, 'c3'); rect(g, x, fy - 4, 5, 1, 'paperw'); rect(g, x, fy - 3, 1, 3, 'c5'); break;
    case 'drawing': rect(g, x - 1, fy - 12, 7, 6, 'frame'); rect(g, x, fy - 11, 5, 4, 'paperw'); put(g, x + 1, fy - 10, 'red'); put(g, x + 2, fy - 9, 'sun'); put(g, x + 3, fy - 10, 'leaf'); put(g, x + 3, fy - 8, 'water'); break;
    case 'ball': rect(g, x, fy - 4, 4, 4, 'ball'); rect(g, x + 1, fy - 5, 2, 1, 'ball'); put(g, x + 1, fy - 3, 'ballb'); put(g, x + 2, fy - 2, 'ballb'); break;
    case 'trip': rect(g, x - 1, fy - 6, 6, 6, 'suit'); rect(g, x - 1, fy - 4, 6, 1, 'suit2'); rect(g, x + 1, fy - 8, 2, 1, 'suit2'); put(g, x, fy - 7, 'suit2'); put(g, x + 3, fy - 7, 'suit2'); break;
    case 'bowl': rect(g, x, fy - 2, 4, 1, 'metal'); rect(g, x + 1, fy - 1, 2, 1, 'metal'); break;
    case 'bag': rect(g, x, fy - 6, 5, 6, 'pack'); rect(g, x + 1, fy - 3, 3, 2, 'strap'); put(g, x + 2, fy - 7, 'strap'); break;
    case 'award': rect(g, x - 1, fy - 12, 7, 5, 'paperw'); rect(g, x, fy - 11, 5, 1, 'red'); put(g, x + 2, fy - 9, 'sun'); put(g, x + 2, fy - 8, 'red'); break;
    default:
  }
}
const PROP_W = { paper: 6, book: 6, drawing: 8, ball: 5, trip: 7, bowl: 5, bag: 6, award: 8 };
const FLOATING = new Set(['paper', 'drawing', 'award']);

/* ───────────── 背景 ───────────── */
const SKY = { morning: 'skyd', evening: 'skye', night: 'skyn' };

function drawSky(g, x, y, w, h, tod) {
  rect(g, x, y, w, h, SKY[tod]);
  if (tod === 'night') { put(g, x + 2, y + 2, 'moon'); put(g, x + 3, y + 2, 'moon'); put(g, x + 2, y + 3, 'moon'); put(g, x + w - 4, y + 1, 'moon'); put(g, x + w - 7, y + 4, 'moon'); } else if (tod === 'evening') rect(g, x + Math.floor(w / 2) - 1, y + h - 3, 3, 3, 'sun'); else { rect(g, x + w - 6, y + 1, 3, 3, 'sun'); rect(g, x + 1, y + 3, 4, 1, 'cloud'); }
}
function drawWindow(g, x, y, w, h, tod) {
  rect(g, x - 1, y - 1, w + 2, h + 2, 'frame'); drawSky(g, x, y, w, h, tod);
  rect(g, x + Math.floor(w / 2), y, 1, h, 'frame'); rect(g, x, y + Math.floor(h / 2), w, 1, 'frame');
}
function floorRows(g, kind) {
  const f = kind === 'sanhe' ? 'stone' : 'floor', f2 = kind === 'sanhe' ? 'stone2' : 'floor2';
  rect(g, 0, FLOOR, SCENE_W, SCENE_H - FLOOR, f); rect(g, 0, FLOOR, SCENE_W, 1, f2);
  for (let x = 0; x < SCENE_W; x += 12) rect(g, x, FLOOR + 3, 1, SCENE_H - FLOOR - 3, f2);
  rect(g, 0, FLOOR + 3, SCENE_W, 1, f2);
}

/** 家（牆面與家具）：回傳 {bg, win}，win 是窗戶層（夜晚時窗外不要被壓暗） */
function drawHome(kind, tod) {
  const bg = mkGrid(), win = mkGrid();
  rect(bg, 0, 0, SCENE_W, FLOOR, 'wall');
  floorRows(bg, kind);
  switch (kind) {
    case 'rental':
      drawWindow(win, 8, 5, 16, 14, tod); rect(bg, 7, 4, 2, 16, 'curtain'); rect(bg, 23, 4, 2, 16, 'curtain');
      rect(bg, 58, 4, 22, 6, 'ac'); rect(bg, 58, 8, 22, 1, 'ac2'); rect(bg, 60, 6, 10, 1, 'ac2');
      rect(bg, 34, 14, 18, 1, 'furn'); rect(bg, 36, 11, 4, 3, 'c4'); rect(bg, 41, 10, 3, 4, 'c2'); rect(bg, 45, 12, 5, 2, 'c5');
      rect(bg, 47, 0, 1, 3, 'ink'); rect(bg, 44, 3, 7, 2, 'lamp'); break;
    case 'flat':
      rect(bg, 5, 3, 36, 18, 'frame'); drawSky(win, 6, 4, 34, 16, tod);
      for (const [bx, bw, bh] of [[8, 5, 9], [14, 4, 12], [19, 6, 7], [26, 4, 11], [31, 5, 8], [36, 3, 10]]) rect(win, bx, 20 - bh, bw, bh, 'skyline');
      rect(win, 23, 4, 1, 16, 'frame');
      rect(bg, 60, 5, 12, 9, 'frame'); rect(bg, 61, 6, 10, 7, 'paperw'); rect(bg, 63, 8, 3, 3, 'water'); rect(bg, 67, 8, 3, 3, 'leaf');
      rect(bg, 78, 5, 7, 7, 'frame'); rect(bg, 79, 6, 5, 5, 'paperw'); put(bg, 81, 8, 'ink'); rect(bg, 81, 7, 1, 2, 'ink'); rect(bg, 47, 0, 1, 3, 'ink'); rect(bg, 44, 3, 7, 2, 'lamp'); break;
    case 'house':
      rect(bg, 3, 9, 11, FLOOR - 9, 'door'); rect(bg, 11, 22, 1, 2, 'sun'); drawWindow(win, 30, 5, 16, 14, tod);
      for (let i = 0; i < 6; i++) { rect(bg, 66 + i * 4, FLOOR - 4 - i * 3, 4, 4 + i * 3, 'furn2'); rect(bg, 66 + i * 4, FLOOR - 4 - i * 3, 4, 1, 'furn'); }
      for (let i = 0; i < 6; i++) rect(bg, 66 + i * 4, FLOOR - 10 - i * 3, 1, 5, 'furn'); rect(bg, 54, 12, 9, 7, 'frame'); rect(bg, 55, 13, 7, 5, 'paperw'); put(bg, 58, 15, 'red'); break;
    case 'elder':
      rect(bg, 62, 14, 30, 3, 'redwood'); rect(bg, 63, 17, 28, 21, 'redwood2'); rect(bg, 72, 3, 10, 8, 'frame'); rect(bg, 73, 4, 8, 6, 'paperw'); rect(bg, 76, 5, 2, 2, 'ink'); rect(bg, 75, 7, 4, 3, 'ink');
      rect(bg, 65, 6, 3, 5, 'red'); rect(bg, 86, 6, 3, 5, 'red'); rect(bg, 66, 4, 1, 2, 'ink'); rect(bg, 87, 4, 1, 2, 'ink'); put(bg, 77, 12, 'red'); put(bg, 74, 12, 'red'); put(bg, 80, 12, 'red');
      rect(bg, 8, 4, 10, 12, 'paperw'); rect(bg, 8, 4, 10, 3, 'red'); put(bg, 12, 10, 'ink'); put(bg, 14, 10, 'ink'); put(bg, 12, 12, 'ink'); put(bg, 14, 12, 'ink');
      drawWindow(win, 28, 6, 16, 12, tod); for (let i = 29; i < 44; i += 3) rect(bg, i, 6, 1, 12, 'frame'); break;
    case 'sanhe':
      rect(bg, 0, 0, SCENE_W, 10, 'roof'); for (let x = 0; x < SCENE_W; x += 3) rect(bg, x, 1, 1, 8, 'roof2'); rect(bg, 0, 9, SCENE_W, 1, 'roof2'); rect(bg, 0, 0, 3, 3, 'roof2'); rect(bg, 93, 0, 3, 3, 'roof2');
      rect(bg, 0, 10, SCENE_W, FLOOR - 10, 'brick'); for (let y = 12; y < FLOOR; y += 3) rect(bg, 0, y, SCENE_W, 1, 'brick2');
      rect(bg, 6, 13, 14, FLOOR - 13, 'red'); rect(bg, 12, 13, 1, FLOOR - 13, 'door'); rect(bg, 4, 13, 2, 14, 'red'); rect(bg, 20, 13, 2, 14, 'red');
      rect(bg, 60, 12, 4, 6, 'red'); rect(bg, 61, 10, 2, 2, 'ink'); rect(bg, 80, 12, 4, 6, 'red'); rect(bg, 81, 10, 2, 2, 'ink'); drawWindow(win, 36, 15, 12, 6, tod); break;
    default:
  }
  return { bg, win };
}

function drawOutdoors(tod) {
  const bg = mkGrid();
  rect(bg, 0, 0, SCENE_W, FLOOR, SKY[tod]);
  if (tod === 'night') { for (const [x, y] of [[10, 4], [30, 9], [52, 3], [70, 8], [86, 4]]) put(bg, x, y, 'moon'); rect(bg, 76, 3, 3, 3, 'moon'); } else if (tod === 'evening') rect(bg, 40, FLOOR - 12, 6, 6, 'sun'); else { rect(bg, 78, 3, 5, 5, 'sun'); rect(bg, 14, 6, 10, 2, 'cloud'); rect(bg, 16, 4, 6, 2, 'cloud'); rect(bg, 48, 10, 12, 2, 'cloud'); rect(bg, 51, 8, 6, 2, 'cloud'); }
  for (let x = 0; x < SCENE_W; x++) { const h = 7 + Math.round(3 * Math.sin(x / 9)) + Math.round(2 * Math.sin(x / 4)); rect(bg, x, FLOOR - h - 3, 1, h + 3, 'hill'); }
  for (const tx of [6, 34, 74]) { rect(bg, tx + 2, FLOOR - 13, 2, 8, 'wood'); rect(bg, tx - 1, FLOOR - 21, 8, 8, 'leaf'); rect(bg, tx + 1, FLOOR - 23, 4, 2, 'leaf'); rect(bg, tx - 1, FLOOR - 15, 8, 2, 'leaf2'); }
  rect(bg, 0, FLOOR, SCENE_W, SCENE_H - FLOOR, 'grass'); rect(bg, 0, FLOOR, SCENE_W, 1, 'grass2');
  for (let x = 3; x < SCENE_W; x += 7) { put(bg, x, FLOOR + 2 + (x % 3), 'grass2'); put(bg, x + 1, FLOOR + 1 + (x % 3), 'grass2'); }
  return { bg, win: mkGrid() };
}

/* ───────────── 組合場景 ───────────── */
const memberW = (m) => {
  if (m.who === 'child' && m.stage === '嬰兒') return m.held ? 0 : 12;
  if (m.who === 'sibling' && m.stage === '嬰兒') return 12;
  return 8 + (m.suitcase ? 7 : 0) + (m.bag ? 5 : 0);
};

function drawMember(g, m, cx, fy, spec) {
  if (m.stage === '嬰兒') { drawCrib(g, cx, fy, m); return null; }
  const o = { ...m };
  if (m.who === 'player' || m.who === 'partner') { o.stage = 'adult'; o.mood = spec.portrait ? 'happy' : 'neutral'; }
  return drawPerson(g, cx, fy, o);
}

/**
 * 規格 → SVG 字串。opts: { alt（覆蓋文字描述）, cls }
 */
export function sceneSVG(spec, opts = {}) {
  const alt = (opts.alt || sceneAlt(spec)).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  if (spec.kind === 'sprite') return spriteSVG(spec, alt, opts);
  const { bg, win } = spec.vacation ? drawOutdoors(spec.tod) : drawHome(spec.home, spec.tod);
  const bgS = emit(bg), winS = emit(win); // 背景用完整解析度；人物另外畫在半解析度的格子上再放大
  const fg = mkGrid(FGW, FGH);
  HG = mkGrid(SCENE_W, SCENE_H);
  const items = [];
  const byWho = (w) => spec.members.filter((m) => m.who === w);
  const heldBaby = spec.members.find((m) => m.who === 'child' && m.held);
  for (const m of [...byWho('elder'), ...byWho('partner'), ...byWho('player'), ...byWho('child'), ...byWho('sibling')]) {
    if (m.who === 'child' && m.held) continue; // 抱在玩家手上
    items.push({ m, w: memberW(m) });
  }
  if (spec.prop && spec.prop !== 'bowl') items.splice(items.findIndex((i) => i.m.who === 'child') + 1, 0, { prop: spec.prop, w: PROP_W[spec.prop] });
  if (spec.pet) { items.push({ pet: spec.pet, w: PET_W[spec.pet.type] || 10 }); if (spec.petBowl) items.push({ prop: 'bowl', w: 5 }); }
  const gap = 1, avail = FGW - 4;
  const total = items.reduce((a, i) => a + i.w, 0) + gap * (items.length - 1);
  const f = total > avail ? avail / total : 1; // 人太多就擠在一起（像拍團體照），不縮小
  let cum = (FGW - total * f) / 2;
  for (const it of items) {
    const left = cum, cx = it.m && !(it.m.stage === '嬰兒') ? Math.round(left + 4) : Math.round(left + (it.w * f) / 2);
    cum += (it.w + gap) * f;
    if (it.m) {
      const px = drawMember(fg, it.m, cx, FGFLOOR, spec);
      if (it.m.who === 'player' && heldBaby && px) drawHeld(fg, px, heldBaby);
      if (it.m.orthok) rect(fg, cx + 5, FGFLOOR - 3, 3, 3, 'paperw');
    } else if (it.pet) drawPet(fg, cx, FGFLOOR, it.pet);
    else if (it.prop) drawProp(fg, cx, FGFLOOR, it.prop);
  }
  outlinePass(fg, HG);
  const fgS = emit(fg), headS = emit(HG);
  HG = null;
  const dim = !spec.vacation && spec.tod === 'night' ? '<rect width="96" height="38" fill="var(--sc-night)" fill-opacity=".34"/>' : !spec.vacation && spec.tod === 'evening' ? '<rect width="96" height="38" fill="var(--sc-dusk)" fill-opacity=".16"/>' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="${opts.cls || 'scene'}" viewBox="0 0 ${SCENE_W} ${SCENE_H}" role="img" aria-label="${alt}" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">${bgS}${dim}${winS}<g transform="scale(${FS})">${fgS}</g>${headS}</svg>`;
}

/** 成長相簿的一張：孩子一個人，站在素色背景前 */
function spriteSVG(spec, alt, opts) {
  const bgG = mkGrid(24, 24), g = mkGrid(24, 24);
  HG = mkGrid(24 * HS, 24 * HS);
  const m = spec.member;
  rect(bgG, 0, 0, 24, 22, 'wall'); rect(bgG, 0, 22, 24, 2, 'floor');
  if (m.stage === '嬰兒') drawCrib(g, 12, 22, { ...m });
  else {
    const o = { ...m, who: 'child', suitcase: m.stage === '離家' };
    drawPerson(g, m.stage === '離家' ? 8 : 12, 22, o);
  }
  outlinePass(g, HG);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="${opts.cls || 'sprite'}" viewBox="0 0 24 24" role="img" aria-label="${alt}" shape-rendering="crispEdges">${emit(bgG)}${emit(g)}<g transform="scale(${1 / HS})">${emit(HG)}</g></svg>`;
  HG = null;
  return svg;
}
