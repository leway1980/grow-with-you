// 遊戲狀態：整個遊戲就是一個可 JSON 序列化的物件（種子 + 目前進度）。
// 沿用《高中，只有一次》(leway1980/Game 47wan @ ce1d972) state.js 的存檔作法（SAVE_VERSION、serialize/deserialize、種子衍生的亂數流）；
// 內容改為親子遊戲：可見的父母／孩子數值、隱藏數值（只能經由 tags.js 改變）、興趣向量、父母傳遞的方向計數、歷史紀錄與曲線。
import { generateFamily, familyCtx } from './family.js';
import { evalCond } from './events.js';
import { recomputeDerived } from './tags.js';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'gwy.save.v1';

export const PARENT_KEYS = ['體力', '耐心', '錢', '工作表現', '夫妻關係'];
export const CHILD_KEYS = ['心情', '成績', '作業', '3C時間', '睡眠', '同學往來'];
export const START_TURN = { birth: 0, elementary: 20 };

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export function newState(seed, data, opts = {}) {
  seed = seed >>> 0;
  const role = opts.role === '媽媽' ? '媽媽' : '爸爸';
  const startMode = opts.startMode === 'elementary' ? 'elementary' : 'birth';
  const fam = generateFamily(seed, data.identities);
  const T = data.tags;

  // 隱藏數值的起點：表內預設 + 家庭條件調整（開局條件，不是玩的過程中的改變）
  const hidden = { ...T.hidden };
  const fctx = familyCtx(fam, role);
  for (const rule of T.startAdjust) if (evalCond(rule.if, fctx)) for (const [k, d] of Object.entries(rule.d)) hidden[k] = clamp(hidden[k] + d, 0, 100);

  const money = data.identities.econStart[fam.econ].錢;
  const couple = fam.partner.present ? data.identities.partner.startCouple[fam.partner.attitude] : 50;
  const talk = fam.child.talents;
  const st = {
    v: SAVE_VERSION, seed, role, startMode, turn: START_TURN[startMode],
    rngS: (seed ^ 0xa5a5a5a5) >>> 0, slotS: (seed ^ 0x7f4a7c15) >>> 0, autoS: (seed ^ 0x51ed270b) >>> 0,
    family: fam,
    parent: { 體力: 78, 耐心: 70, 錢: money, 工作表現: 62, 夫妻關係: couple },
    child: { 心情: 62, 成績: clamp(50 + (talk.國語 + talk.數學) * 4, 20, 80), 作業: 60, '3C時間': 8, 睡眠: 66, 同學往來: clamp(50 + talk.人際 * 5, 20, 80) },
    hidden,
    interest: { ...fam.child.interests },      // 興趣向量（隱藏）：之後會依接觸經驗改變
    dirCount: {},                              // 父母傳遞的方向計數（§3.3）
    tagCounts: {},                             // 各行為標籤累計次數
    vars: { 托育方式: '', 幼兒園類型: '', 照顧者: '', 換照顧者次數: 0 },
    flags: {}, cooldowns: {}, used: {}, openPools: {}, delayed: [], slotLast: {}, cardScope: null,
    hist: [], curves: [], vcurves: [], done: {},
    cur: null, ended: false, endReason: null,
  };
  // 「從國小開始」：學前托育由抽籤決定（DATA §4），並給國小起點一點差異
  if (startMode === 'elementary') {
    const cc = fam.childcare;
    st.vars.托育方式 = cc.mode;
    st.vars.幼兒園類型 = cc.kindergarten;
    st.vars.照顧者 = cc.mode === '父母自己帶' ? '父母' : cc.mode === '長輩主要照顧' ? (fam.elders.who ? fam.elders.who.slice(-2) : '長輩') : cc.daycare && cc.daycare.includes('保母') ? '保母' : '托嬰中心老師';
    for (const [k, d] of Object.entries(data.identities.childcare.startEffects[cc.mode] || {})) st.hidden[k] = clamp(st.hidden[k] + d, 0, 100);
    st.hidden.閱讀習慣 = clamp(st.hidden.閱讀習慣 + 4, 0, 100);
    st.preschoolRolled = true;
  }
  recomputeDerived(st, T); // 承受度是推算值
  return st;
}

export const serialize = (st) => JSON.stringify(st);
export const deserialize = (s) => {
  const st = JSON.parse(s);
  if (!st || st.v !== SAVE_VERSION) throw new Error('存檔版本不符');
  return st;
};

/* ───── 存檔：所有存取都包 try/catch，壞掉就只存在記憶體（沒有 localStorage 也能玩） ───── */
const mem = {};
export const store = {
  get() { try { return localStorage.getItem(SAVE_KEY); } catch { return mem[SAVE_KEY] ?? null; } },
  set(v) { try { localStorage.setItem(SAVE_KEY, v); } catch { mem[SAVE_KEY] = v; } },
  del() { try { localStorage.removeItem(SAVE_KEY); } catch { delete mem[SAVE_KEY]; } },
};
export function writeSave(st) { try { store.set(serialize(st)); return true; } catch { return false; } }
export function readSave() {
  const raw = store.get();
  if (!raw) return null;
  try { return deserialize(raw); } catch { return null; }
}
