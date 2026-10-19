// 終局（DESIGN §7、§3.1、§11）v0：先給「你們一起的幸福」，成就另外顯示，最後才「回頭看」把所有隱藏數值攤開。純函式、無 DOM。
// 『教養路線』由行為累積出來的位置計算，從不由玩家宣告。簡單的句子產生；組合式的信（47wan 的面向句庫）留到後面的里程碑。

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const last = (arr, n) => arr.slice(-n);

/** 隱藏數值的名稱分組（只在終局揭露用） */
export const REVEAL_GROUPS = [
  { title: '你和孩子之間', keys: ['溫暖陪伴', '規範監督', '親子信任', '了解度', '規則一致性', '替他做主'] },
  { title: '孩子心裡的樣子', keys: ['主見', '自我效能', '內在穩定', '安全感', '承受度', '期待壓力', '試探度'] },
  { title: '家裡的環境與習慣', keys: ['父母示範', '父母情緒穩定度', '自理與責任', '閱讀習慣', '家庭學習環境'] },
  { title: '學校那一邊', keys: ['師親信任', '班級風氣'] },
];
export const GOOD_WHEN_UP = (k) => k !== '期待壓力' && k !== '試探度' && k !== '替他做主';

function avgHidden(st, key, n = 99) { return mean(last(st.curves, n).map((c) => c[key]).filter((x) => x != null)); }
function avgVis(st, key, n = 8) { return mean(last(st.vcurves, n).map((c) => c[key]).filter((x) => x != null)); }

/** 三條結果軸（§3.1）：親子、人際、學習。0–100。 */
export function outcomeAxes(st) {
  const h = st.hidden;
  const parent = mean([h.親子信任, h.了解度, h.溫暖陪伴, h.規則一致性]) - 0.3 * Math.max(0, h.期待壓力 - 50) - 0.3 * Math.max(0, 50 - h.父母情緒穩定度);
  const peer = mean([avgVis(st, '同學往來', 12), h.師親信任, h.班級風氣, h.內在穩定, h.承受度]);
  const learn = mean([avgVis(st, '成績', 12), h.自我效能, h.閱讀習慣, h.家庭學習環境, 100 - Math.max(0, avgVis(st, '3C時間', 12) - 20), avgVis(st, '睡眠', 12)]);
  return { 親子: clamp(parent), 人際: clamp(peer), 學習: clamp(learn) };
}

/** 共同的幸福（§7.1 第一個畫面）：孩子、父母、彼此之間 */
export function wellbeing(st) {
  const h = st.hidden;
  const child = mean([avgVis(st, '心情', 8), h.內在穩定, h.自我效能, h.安全感, 100 - h.期待壓力]);
  const pv = ['體力', '耐心', '錢', '工作表現'].map((k) => avgVis(st, k, 8));
  if (st.family.partner.present) pv.push(avgVis(st, '夫妻關係', 8));
  pv.push(h.父母情緒穩定度);
  const parent = mean(pv);
  const between = mean([h.親子信任, h.了解度, h.溫暖陪伴, h.規則一致性]) - 0.25 * Math.max(0, h.期待壓力 - 50);
  return { child: clamp(child), parent: clamp(parent), between: clamp(between) };
}

export function wellbeingLine(w, st) {
  const { child, parent, between } = w;
  const nm = st.family.child.given;
  if (child >= 62 && parent >= 58 && between >= 62) return `週末${nm}還是想跟你一起吃飯，吃完會在客廳多坐一會兒。`;
  if (child >= 60 && parent < 50) return `${nm}長得不錯，你卻累得快認不得自己了。這幾年，你把自己放在最後面。`;
  if (child < 48 && between < 50) return `你們住在同一個屋簷下，但很少真正說話。${nm}的房門常常是關著的。`;
  if (parent >= 60 && child < 52) return `你把日子過得還算穩，${nm}卻有些心事沒說出口。`;
  if (between >= 60) return `事情再難，你們還是會找對方說。這幾年，${nm}知道你在。`;
  if (child < 48 && parent < 48) return `這幾年，你們兩個都撐得很辛苦，很多話還沒來得及說。`;
  return `有好的日子，也有各自撐著的日子。這個家還在繼續。`;
}

/** 教養路線位置（§3、§7.1 第 5 項）：由整段時間的平均計算，不是玩家宣告的 */
export function routePosition(st) {
  const warm = avgHidden(st, '溫暖陪伴'), firm = avgHidden(st, '規範監督'), control = avgHidden(st, '替他做主');
  let name;
  if (control >= 48) name = '高壓做主：替孩子決定很多事';
  else if (warm < 50 && firm < 50) name = '放任：說是尊重，其實沒怎麼在管';
  else if (warm < 50) name = '盯但不陪：規矩有，陪伴少';
  else if (firm < 50) name = '溺愛：關係很近，規矩比較少';
  else name = '陪又要求：陪著，也有規矩';
  return { warm: clamp(warm), firm: clamp(firm), control: clamp(control), name };
}

/** 關鍵時刻：對隱藏數值影響最大的幾次選擇 */
export function keyMoments(st, data, n = 5) {
  const scored = st.hist.map((h) => ({ h, s: Object.entries(h.h || {}).reduce((a, [, d]) => a + Math.abs(d), 0) })).filter((x) => x.s > 0);
  scored.sort((a, b) => b.s - a.s);
  const pick = scored.slice(0, n).sort((a, b) => a.h.turn - b.h.turn);
  return pick.map(({ h }) => {
    const tl = data.timeline[h.turn];
    const moved = Object.entries(h.h).filter(([, d]) => Math.abs(d) >= 0.8).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3)
      .map(([k, d]) => ({ key: k, dir: d > 0 ? 1 : -1 }));
    return {
      when: tl.label, title: h.title, label: h.label,
      did: (h.tags || []).map((t) => data.tags.tags[t]?.desc).filter(Boolean),
      moved,
    };
  });
}

const POINTS = 8;
/** 每個隱藏數值的曲線資料（給 SVG 小圖用） */
export function curveSeries(st) {
  const out = {};
  for (const g of REVEAL_GROUPS) for (const k of g.keys) {
    const pts = st.curves.map((c) => c[k]);
    out[k] = { pts, start: pts[0], end: pts[pts.length - 1], good: GOOD_WHEN_UP(k) };
  }
  return out;
}

export function buildEnding(st, data) {
  const w = wellbeing(st);
  const axes = outcomeAxes(st);
  const nm = st.family.child.given;
  const stageNow = data.timeline[Math.min(st.turn, data.timeline.length - 1)];
  const score = avgVis(st, '成績', 12);
  return {
    name: nm,
    wellbeing: w,
    line: wellbeingLine(w, st),
    achievement: {
      axes,
      scoreWord: score >= 70 ? '課業穩穩跟得上' : score >= 55 ? '課業大致跟得上' : score >= 40 ? '課業有些吃力' : '課業很辛苦',
      note: `${nm}國小畢業了。接下來是國中，這一版先寫到這裡，後面的路還沒有鋪好。`,
    },
    route: routePosition(st),
    moments: keyMoments(st, data),
    groups: REVEAL_GROUPS,
    series: curveSeries(st),
    to: stageNow.label,
    resources: [
      { name: '安心專線', tel: '1925', note: '24 小時，心理健康與情緒困擾，免費' },
      { name: '1957 福利諮詢專線', tel: '1957', note: '社會福利與經濟協助的諮詢' },
      { name: '各縣市家庭教育中心', tel: '', note: '親職與親子溝通的諮詢，可上教育部家庭教育網查詢所在縣市的專線' },
      { name: '特教通報與鑑定', tel: '', note: '孩子的學習、注意力或情緒讓你擔心時，可向學校輔導室詢問特教通報與鑑定流程' },
    ],
    reminder: '遊戲裡的孩子是抽出來的，不能用來判斷真實的孩子。再玩一次，會是不同的家庭、不同的孩子。',
    turns: st.hist.length,
  };
}
