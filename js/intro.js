// 開場「狀態視窗」的欄位：直接讀 family 的值（不解析 openingText 的句子），分成孩子／你／另一半／家／學區五組。
// 只列開場本來就會告訴玩家的事（手足只列已經出生的哥哥姐姐，弟弟妹妹的到來不劇透）。
import { rngAt } from './engine/rng.js';

/** 爸爸或媽媽也是骰子：只由種子決定（自己的亂數流，不動引擎的任何抽籤），50/50 */
export const rollRole = (seed) => (rngAt(seed >>> 0, 0, 'role') < 0.5 ? '爸爸' : '媽媽');

const TEMP = (t) => {
  const bits = [];
  if (t.活動量 >= 4) bits.push('手腳一刻不停');
  if (t.活動量 <= 2) bits.push('很安靜');
  if (t.敏感度 >= 4) bits.push('一點聲音就會醒');
  if (t.敏感度 <= 2) bits.push('不太挑剔');
  if (t.堅持度 >= 4) bits.push('想要的東西就是不肯放');
  if (t.堅持度 <= 2) bits.push('很容易被轉移注意力');
  return bits.length ? bits.slice(0, 2).join('、') : '還在摸索，是個普通的新生兒';
};
const ATT = { 一起陪: '願意一起帶孩子', 只出錢: '主要負責賺錢，帶孩子多靠你', 幾乎不在家: '工作忙，很少在家', 會反對你的做法: '常有和你不一樣的想法' };
const EX_ATT = { 一起陪: '定期見孩子，帶孩子的事會商量', 只出錢: '有付費用，很少見面', 幾乎不在家: '幾乎不見孩子' };
const TAKE_WORK = { 基層: '下班就是下班，不太帶回家', 主管: '晚上假日手機不太能關', 自己當老闆: '時間自己排，出狀況沒人替你扛' };
const SUPPORT = { 自己就是資源: '熟悉升學制度，期待容易偏高', 花錢買資源: '不太熟升學制度，願意花錢在補習才藝', 自己找資源: '工時長，給信任和放手，靠學校老師去問' };
const ELDERS = (f) => ({ 同住: `${f.elders.who}同住`, 住附近會幫忙: `${f.elders.who}住附近，會來幫忙`, 住遠: `${f.elders.who}住得遠，一年見不了幾次`, 沒有: '身邊沒有長輩幫忙' })[f.elders.status];
const STRUCT = { 雙親: '雙親家庭', 離異: '離異（孩子跟你住）', 隔代: '隔代教養（孩子平常跟長輩住）', 重組: '重組家庭', 喪親: '單親（另一半已離世）' };

/** 嗜好（§4.41）：「打球（有固定的球友）、追劇」。沒有嗜好（舊存檔補不到表時）回 '—' */
export const hobbyText = (fam) => (fam.hobbies && fam.hobbies.length ? fam.hobbies.map((h) => (h.buddy ? `${h.name}（有固定的${h.buddy}）` : h.name)).join('、') : '—');

/** @returns {{title:string, rows:[string,string][]}[]} */
export function introSections(fam, role) {
  const c = fam.child, older = fam.siblings.filter((s) => s.older);
  const partner = [];
  if (fam.structure === '隔代') partner.push(['職業', fam.partner.job || '—'], ['現況', '也在外地工作，靠視訊和週末']);
  else if (fam.partner.present) partner.push(['職業', fam.partner.job || '—'], ['對教養的態度', ATT[fam.partner.attitude] || '—']);
  else if (fam.partner.attitude) partner.push(['現況', '已分開，不同住'], ['對教養的態度', EX_ATT[fam.partner.attitude] || '—']);
  else partner.push(['現況', '已離世，你一個人帶孩子']);
  // 住長輩家又有長輩「住附近」會互相打架：住屋寫成長輩提供的房子，不寫「長輩的房子」
  const housing = fam.housing === '住長輩家' ? (fam.elders.status === '同住' ? '長輩的房子（一起住）' : '長輩提供的房子') : fam.housing === '租屋' ? '租屋' : '自有';
  return [
    { title: '孩子', rows: [['名字', c.name], ['性別', c.sex === '男' ? '男孩' : '女孩'], ['出生月份', `${c.birthMonth} 月`], ['氣質', TEMP(c.temperament)],
      ['排行／手足', older.length ? `老么，上有${older.map((s) => s.rel).join('和')}` : '第一個孩子']] },
    { title: '你', rows: [['身分', role], ['職業', fam.job.name], ['職位', fam.rank], ['工時型態', fam.pattern], ['回家帶不帶工作', TAKE_WORK[fam.rank]], ['教養背景', SUPPORT[fam.support]], ['孩子出生前的嗜好', hobbyText(fam)]] },
    { title: '另一半', rows: partner },
    { title: '家', rows: [['地點', `${fam.county}${fam.district}`], ['城鄉', fam.urban], ['經濟', fam.econ], ['家庭型態', STRUCT[fam.structure]], ['住屋', housing],
      ['孩子寫功課的地方', fam.space === '自己的房間' ? '自己的房間' : fam.space === '和手足同房' ? '和手足同一間房' : '客廳或餐桌'],
      ['交通', `${fam.transport}，上班單程${{ 近: '十幾分鐘', 中: '約半小時', 遠: '約一小時' }[fam.commute]}`], ['長輩', ELDERS(fam)],
      ['寵物', fam.pet ? `${fam.pet.type}「${fam.pet.name}」` : '沒有'], ['族群與文化', fam.background === '無' ? '沒有特別' : fam.background]] },
    { title: '學區', rows: [['國小', fam.school.name]] },
  ];
}

/**
 * 開場轉盤：依序轉出的重點項目（只轉狀態視窗本來就顯示的列）。純表現：停下的值由 introSections 決定，
 * 這裡只提供「轉的時候經過的候選字」，來源是引擎抽籤用的同一批表（identities.json），沒有表的欄位用顯示用的短清單。
 * @returns {{sec:string, key:string, pool:string[]}[]}
 */
export function introReels(idn, seed) {
  let s = (seed >>> 0) || 1; // 候選字的順序只影響畫面，用自己的小亂數，不動引擎的任何亂數流
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
  const shuffle = (a) => { const r = a.slice(); for (let i = r.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [r[i], r[j]] = [r[j], r[i]]; } return r; };
  const T = idn.child.temperament, vals = [T.min, Math.round((T.min + T.max) / 2), T.max];
  const temps = new Set();
  for (const a of vals) for (const b of vals) for (const c of vals) temps.add(TEMP({ 活動量: a, 敏感度: b, 堅持度: c }));
  const places = shuffle(idn.counties.flatMap((c) => c.districts.map((d) => `${c.name}${d}`))).slice(0, 40);
  return [
    { sec: '你', key: '身分', pool: ['爸爸', '媽媽'] },
    { sec: '孩子', key: '氣質', pool: shuffle([...temps]) },
    { sec: '家', key: '地點', pool: places },
    { sec: '家', key: '家庭型態', pool: idn.familyStructures.map((f) => STRUCT[f.id]).filter(Boolean) },
    { sec: '家', key: '經濟', pool: idn.econLabels.slice() },
  ];
}
