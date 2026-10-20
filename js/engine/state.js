// 遊戲狀態：整個遊戲就是一個可 JSON 序列化的物件（種子 + 目前進度）。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) state.js 的存檔作法（SAVE_VERSION、serialize/deserialize、種子衍生的亂數流）；
// 內容改為親子遊戲：可見的父母／孩子數值、隱藏數值（只能經由 tags.js 改變）、興趣向量、父母傳遞的方向計數、歷史紀錄與曲線。
import { generateFamily, familyCtx, rollWork, rollBackground } from './family.js';
import { evalCond } from './events.js';
import { recomputeDerived } from './tags.js';

export const SAVE_VERSION = 2;
export const SAVE_KEY = 'gwy.save.v1';

export const PARENT_KEYS = ['體力', '耐心', '錢', '工作表現', '夫妻關係'];
export const CHILD_KEYS = ['心情', '成績', '作業', '3C時間', '睡眠', '同學往來'];
/** 起點的回合序號：從出生是 0；從國小是時間軸上第一個一年級的回合（由日曆算出來，日曆改了不用跟著改常數） */
export function startTurnOf(data, mode) {
  if (mode !== 'elementary') return 0;
  const i = data.timeline.findIndex((t) => t.grade === 1);
  if (i < 0) throw new Error('日曆裡沒有一年級的回合');
  return i;
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function newState(seed, data, opts = {}) {
  seed = seed >>> 0;
  const role = opts.role === '媽媽' ? '媽媽' : '爸爸';
  const startMode = opts.startMode === 'elementary' ? 'elementary' : 'birth';
  const fam = generateFamily(seed, data.identities);
  const T = data.tags;

  // 隱藏數值的起點：表內預設 + 家庭條件調整（開局條件，不是玩的過程中的改變）
  const hidden = { ...T.hidden };
  const fctx = { ...familyCtx(fam, role), 起點: startMode, 托育方式: startMode === 'elementary' ? fam.childcare.mode : '' };
  for (const rule of T.startAdjust) if (evalCond(rule.if, fctx)) for (const [k, d] of Object.entries(rule.d)) hidden[k] = clamp(hidden[k] + d, 0, 100);

  const money = data.identities.econStart[fam.econ].錢;
  const couple = fam.partner.present ? data.identities.partner.startCouple[fam.partner.attitude] : 50;
  const talk = fam.child.talents;
  const st = {
    v: SAVE_VERSION, seed, role, startMode, turn: startTurnOf(data, startMode),
    rngS: (seed ^ 0xa5a5a5a5) >>> 0, slotS: (seed ^ 0x7f4a7c15) >>> 0, autoS: (seed ^ 0x51ed270b) >>> 0,
    family: fam,
    parent: { 體力: 78, 耐心: 70, 錢: money, 工作表現: 62, 夫妻關係: couple },
    child: { 心情: 62, 成績: clamp(50 + (talk.國語 + talk.數學) * 4, 20, 80), 作業: 60, '3C時間': 8, 睡眠: 66, 同學往來: clamp(50 + talk.人際 * 5, 20, 80) },
    hidden,
    interest: { ...fam.child.interests },      // 興趣向量（隱藏）：之後會依接觸經驗改變
    dirCount: {},                              // 父母傳遞的方向計數（§3.3）
    tagCounts: {},                             // 各行為標籤累計次數
    vars: { 托育方式: '', 幼兒園類型: '', 照顧者: '', 換照顧者次數: 0, 孩子主動開口: 0, 孩子不再開口: 0, 上學方式: '', 孩子來找_連續錯過: 0, 孩子來找_回來連續: 0, 不太來找你: 0, 不太來找你_曾: 0, 養的寵物: '', 養的寵物名: '', 想要的球類: '', 選的才藝: '', 校隊項目: '', 校隊比賽層級: '' },
    costEMA: { 體力: 0, 耐心: 0 },             // 最近幾回合體力、耐心的花費（指數移動平均），父母的回復目標會被它拉低
    startHidden: null,                         // 開局時的隱藏數值（自然漂移與結局的『相對於開局』用）
    flags: {}, cooldowns: {}, used: {}, openPools: {}, delayed: [], slotLast: {}, cardScope: null,
    hist: [], curves: [], vcurves: [], done: {},
    parentGrowth: [],                          // 父母一起參與過的活動（§7.2b）：{turn, slot, value} 或 {turn, tag}
    cur: null, ended: false, endReason: null,
  };
  // 「從國小開始」：學前托育由抽籤決定（DATA §4），並給國小起點一點差異
  if (startMode === 'elementary') {
    const cc = fam.childcare;
    st.vars.托育方式 = cc.mode;
    st.vars.幼兒園類型 = cc.kindergarten;
    st.vars.照顧者 = cc.mode === '父母自己帶' ? '父母' : cc.mode === '長輩主要照顧' ? (fam.elders.who ? fam.elders.who.slice(-2) : '長輩') : cc.daycare && cc.daycare.includes('保母') ? '保母' : '托嬰中心老師';
    st.preschoolRolled = true;
  }
  recomputeDerived(st, T); // 承受度是推算值
  st.startHidden = { ...st.hidden };
  return st;
}

export const serialize = (st) => JSON.stringify(st);
export const deserialize = (s) => {
  const st = JSON.parse(s);
  if (!st || (st.v !== SAVE_VERSION && st.v !== 1)) throw new Error('存檔版本不符'); // v1 由 migrate 升級
  return st;
};

/* ───── v1 → v2：日曆從 92 回合改成 72 回合，所有回合序號要重新對應 ───── */
/** v1（92 回合日曆）的回合序號 → 孩子的月齡 */
const v1MonthsAtTurn = (t) => (t < 8 ? t * 3 : t < 20 ? 24 + (t - 8) * 4 : 72 + (t - 20) * 2);
const V1_PLAYABLE = 56;
/**
 * 舊回合 → 月齡 → 新回合（第一個 ageMonths ≥ 該月齡的回合；找不到就是時間軸長度）。
 * played＝這個序號是『已經玩過的回合』（st.turn、hist、曲線、父母的收穫）：舊的最後一個可玩回合（國小六年級暑假，月齡 142）
 * 在新日曆沒有對應的回合，會對到國中開頭，所以已玩過的序號夾在可玩範圍最後一回合以內，結局才不會把國小畢業算成國中。
 */
function remapper(data) {
  const tl = data.timeline, last = data.calendar.playableTurns - 1;
  const first = (m) => { const i = tl.findIndex((t) => t.ageMonths >= m); return i < 0 ? tl.length : i; };
  return (t, played = false) => {
    if (typeof t !== 'number') return t;
    const n = first(v1MonthsAtTurn(t));
    return played && t < V1_PLAYABLE ? Math.min(n, last) : n;
  };
}
function migrateV1(st, data) {
  const map = remapper(data);
  st.turn = map(st.turn, true);
  for (const e of st.hist || []) e.turn = map(e.turn, true);
  for (const c of st.curves || []) c.t = map(c.t, true);
  for (const c of st.vcurves || []) c.t = map(c.t, true);
  for (const g of st.parentGrowth || []) if (g.turn !== undefined) g.turn = map(g.turn, true);
  for (const d of st.delayed || []) { d.due = map(d.due); if (d.from !== undefined) d.from = map(d.from); }
  for (const k of Object.keys(st.cooldowns || {})) st.cooldowns[k] = map(st.cooldowns[k]);
  for (const o of Object.values(st.openPools || {})) o.until = map(o.until);
  for (const s of (st.family && st.family.siblings) || []) {
    s.arriveMonths = s.older || s.arriveTurn == null ? null : v1MonthsAtTurn(s.arriveTurn);
    delete s.arriveTurn;
  }
  st.cur = null; st.cardScope = null; // 目前這一回合重新開始（序號對不上了，卡片的槽值也是依回合存的）
  st.v = 2;
  return st;
}

/**
 * 舊存檔升級：補上新欄位的預設值、丟掉已經不存在的後續卡與當前卡、不保存每次選擇的隱藏變化。
 * 只有『欄位的意思變了、補預設也救不回來』時才提高 SAVE_VERSION；單純新增欄位只要在這裡補預設。
 */
export function migrate(st, data) {
  if (st && st.v === 1) migrateV1(st, data);
  if (!st || st.v !== SAVE_VERSION) throw new Error('存檔版本不符');
  const T = data.tags;
  st.hidden ||= {};
  for (const k of Object.keys(T.hidden)) if (typeof st.hidden[k] !== 'number' || Number.isNaN(st.hidden[k])) st.hidden[k] = T.hidden[k];
  st.vars = { 托育方式: '', 幼兒園類型: '', 照顧者: '', 換照顧者次數: 0, 孩子主動開口: 0, 孩子不再開口: 0, 上學方式: '', 孩子來找_連續錯過: 0, 孩子來找_回來連續: 0, 不太來找你: 0, 不太來找你_曾: 0, 養的寵物: '', 養的寵物名: '', 想要的球類: '', 選的才藝: '', 校隊項目: '', 校隊比賽層級: '', ...(st.vars || {}) };
  st.costEMA = { 體力: 0, 耐心: 0, ...(st.costEMA || {}) };
  for (const k of ['dirCount', 'tagCounts', 'flags', 'cooldowns', 'used', 'openPools', 'slotLast', 'done']) st[k] ||= {};
  for (const k of ['delayed', 'hist', 'curves', 'vcurves', 'parentGrowth']) st[k] ||= [];
  // 舊存檔沒有職位、交通工具、通勤距離：用同一個種子補上（各自獨立的亂數流，不影響已經抽好的其他東西）
  const f = st.family, jd = data.identities.jobs.find((j) => j.name === f.job.name);
  if (jd && !(f.rank && f.transport && f.commute)) Object.assign(f, rollWork(st.seed, data.identities, jd, f.econ, f.urban));
  // 舊存檔沒有族群背景：用同一個種子補上；舊的隔代存檔另一半是『同住』，改成在外地工作（隔代＝你和另一半都不在孩子身邊）
  if (f.background == null) f.background = rollBackground(st.seed, data.identities, f.county, f.urban);
  if (f.structure === '隔代' && f.partner && f.partner.present && f.partner.status === '同住') { f.partner.status = '在外地工作'; f.partner.attitude = '幾乎不在家'; }
  st.slotS ??= (st.seed ^ 0x7f4a7c15) >>> 0;
  st.autoS ??= (st.seed ^ 0x51ed270b) >>> 0;
  if (!st.startHidden) st.startHidden = newState(st.seed, data, { role: st.role, startMode: st.startMode }).startHidden;
  for (const k of Object.keys(T.hidden)) if (typeof st.startHidden[k] !== 'number') st.startHidden[k] = T.hidden[k];
  st.delayed = st.delayed.filter((d) => d && data.cardIndex[d.card]).map((d) => ({ ...d, from: d.from ?? d.due - 1 }));
  for (const id of Object.keys(st.cooldowns)) if (!data.cardIndex[id]) delete st.cooldowns[id];
  for (const e of st.hist) { delete e.h; e.tags ||= []; }
  if (st.cur && (!st.cur.cardId || !data.cardIndex[st.cur.cardId])) st.cur = null;
  if (st.cur && st.cur.cardId) { st.cur.acc ||= {}; st.cur.loads ||= []; st.cur.slot ??= 0; }
  return st;
}

/* ───── 存檔：所有存取都包 try/catch，壞掉就只存在記憶體（沒有 localStorage 也能玩） ───── */
const mem = {};
export const store = {
  get() { try { return localStorage.getItem(SAVE_KEY); } catch { return mem[SAVE_KEY] ?? null; } },
  set(v) { try { localStorage.setItem(SAVE_KEY, v); } catch { mem[SAVE_KEY] = v; } },
  del() { try { localStorage.removeItem(SAVE_KEY); } catch { delete mem[SAVE_KEY]; } },
};
export function writeSave(st) { try { store.set(serialize(st)); return true; } catch { return false; } }
export function readSave(data) {
  const raw = store.get();
  if (!raw) return null;
  try { return migrate(deserialize(raw), data); } catch { return null; }
}
