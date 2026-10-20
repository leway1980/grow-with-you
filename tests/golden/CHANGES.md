# 黃金範例的改動記錄

每個家庭的類別（幸福區間、三條軸的區間、成就區間、組合、路線）改變時，在該家庭的段落寫一條：

    - 日期 · sig:新簽名 · 變化 · 原因：…

原因要寫為什麼這樣改是對的（例如「§4.34 新增『只問成績』標籤，這個家庭的策略會選到它」），不是「測試過了」。
`node tools/golden.mjs --update` 會重寫快照，並替類別有變的家庭補一條「原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）」草稿；TODO 沒填，`tests/golden.test.mjs` 會失敗。
快照的簽名只算類別，不算最長的標籤連用（連用的變化會在 `node tools/golden.mjs` 與 `tools/impact.mjs` 的報告裡看到，不需要交代）。

**記錄**（每個家庭一個 `## 家庭 id` 段落，新的在上面）

（目前沒有改動。2026-10-20 建立 15 個黃金範例的初始快照。）

## rich-dual-income-controlling
- 2026-10-20 · sig:16eafde0 · wellbeing：lo → mid；wellbeingParts：lo/mid/lo → lo/mid/mid；axes：lo/lo/mid → lo/mid/mid · 原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）

## manager-overtime-dosegreedy
- 2026-10-20 · sig:d1de2c3d · route：高壓做主 → 放任 · 原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）

## opposing-partner-commonreaction
- 2026-10-20 · sig:a82ea249 · route：放任 → 高壓做主 · 原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）

## elders-live-in-research
- 2026-10-20 · sig:61d8b84a · wellbeingParts：mid/mid/mid → mid/mid/hi · 原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）

## traveling-single-commonreaction
- 2026-10-20 · sig:4db350a4 · axes：lo/mid/mid → lo/lo/mid；achievement：課業大致跟得上 → 課業有些吃力 · 原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）

## absent-partner-rich-permissive
- 2026-10-20 · sig:37a3ca1c · wellbeingParts：mid/mid/mid → mid/mid/lo · 原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）

## special-needs-warmfirmrest
- 2026-10-20 · sig:506e5c5c · axes：hi/hi/hi → hi/hi/mid；combo：三邊都顧到 → 關係好、人際好，成績普通 · 原因：第 1 項（孩子月齡進條件環境）：好幾張嬰幼兒卡加了月齡限制、inf_sick 依月齡拆成兩張，抽卡的順序與亂數流跟著位移，同一個家庭走上不同的人生；類別改變來自抽卡序列，不是機制方向改變（check-design 的方向檢查與影響報告的整體分布未變）
