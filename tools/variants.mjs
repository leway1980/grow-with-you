// 選項的情境版本（labelIf／resultIf／tagsIf／effectsIf，規則 17／21）展開器：資料檢查用。
// 對每個選項，依『不同的 if 字串』各做一個虛擬版本（同一個 if 的各欄位一起換上，其他欄位用原值），
// 放進一張虛擬卡（id＝原id~v編號，_variantOf＝原卡）。lint 把這些卡當一般的卡跑全部規則
// （now 方向、V2／V3／V4b、一眼看穿、Spearman、規則 11、年齡、時間詞、規則 20……）。
import { VARIANT_FIELDS } from '../js/engine/events.js';

export function expandVariantCards(cards) {
  const out = [];
  for (const c of cards) {
    const ifs = [];
    for (const ch of c.choices || []) for (const key of Object.keys(VARIANT_FIELDS)) for (const v of ch[key] || []) if (!ifs.includes(v.if ?? '')) ifs.push(v.if ?? '');
    ifs.forEach((cond, n) => {
      const choices = c.choices.map((ch) => {
        const o = { ...ch };
        for (const [key, field] of Object.entries(VARIANT_FIELDS)) {
          const v = (ch[key] || []).find((x) => (x.if ?? '') === cond);
          if (v) o[field] = v.value;
        }
        for (const key of Object.keys(VARIANT_FIELDS)) delete o[key];
        return o;
      });
      out.push({ ...c, id: `${c.id}~v${n + 1}`, _variantOf: c.id, _variantIf: cond, choices });
    });
  }
  return out;
}
