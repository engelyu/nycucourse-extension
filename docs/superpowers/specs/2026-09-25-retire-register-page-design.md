# 拿掉選課頁、週課表改名「編輯課表」；自動登記與變更採計搬進當期選課

日期：2026-09-25。接在 0.12.0（分支 `fix-reg-rules`，commit `de96be6`）之後。

## 目的

當期選課已經涵蓋找課、加入預排、查詢、加選、登記，popup 的「週課表」「選課」兩頁大部分功能重複。使用者要求：
- 拿掉「選課」頁；
- 「週課表」保留但改名「編輯課表」，用途是新增私人行程、設定課程連結與顏色。

只存在這兩頁、不能直接丟掉的功能，要搬到當期選課。

## 使用者已決定

| 項目 | 決定 |
|---|---|
| 週課表 | 保留，改名「編輯課表」。私人行程、課程連結（E3）、顏色、隱藏都在這頁 |
| 選課頁 | 拿掉 |
| 每日自動登記 | 保留，搬到當期選課。使用者在學四年，每學期都要選課，這個服務要一直用下去 |
| 變更採計方式 | 放進當期選課的「查詢」 |

## 現況查證（2026-09-25）

當期選課**不能**變更已在預排的課的採計方式：
- 課一進預排，結果卡片就不顯示「加入預排」（`src/planner/results.js:75`，`if (!inPrereg)`）。
- 「查詢」已在預排的課時，只查一列：預排記的採計方式（`src/planner.js` 的 `queryCourse`，`if (item)` 那一支），沒有其他選項。

所以變更採計目前只有選課頁的「變更」按鈕做得到（`src/register.js` 的 `chooseAttribution`／`changeAttribution`），搬走前要先補到當期選課。

## 設計

### 1. 週課表 → 編輯課表
- `src/schedule.html` 的 `<title>` 與 `<h1>` 改成「編輯課表」；頁面功能不變。
- popup 頁首按鈕「週課表 ↗」改成「編輯課表 ↗」（title：新增私人行程、設定課程連結與顏色）；popup 空狀態的「看預排課表 ↗」也改成「編輯課表 ↗」。
- 當期選課圖例的「私人行程（顏色可在課表頁設定）」改成「（在「編輯課表」新增、設定顏色）」。

### 2. 拿掉選課頁
- 刪 `src/register.html`、`src/register.css`、`src/register.js`；popup 拿掉「選課 ↗」。
- `src/reg-dialog.*`（加選／登記確認視窗）當期選課也在用，保留。
- content script 的訊息（`changepreregist` 等）與背景程式都不動。

### 3. 自動登記搬進當期選課
- 右欄分頁變成「課表預覽｜篩選設定｜**自動登記**」，`planner.paneTab` 多一個值 `auto`，會記住。
- 分頁內容和原本選課頁的「每日自動登記」一樣：說明、每天自動登記開關、時間、「立刻執行一次」、下次執行時間、分發時段提醒；清單（預排課程＋志願，可移除）；最近 5 筆結果（有失敗的標紅）。
- 課程選單來源：`state.schedule.sources.preregist.courses`（當期選課已有的預排資料）；預排變了，選單跟著更新。
- 背景程式（`auto:get`／`auto:set`／`auto:run`、`alarms` 權限、storage 的 `autoRegister`）完全不動。
- 「立刻執行一次」之後重讀選課網狀態（`syncStatus`）。
- 沒有志願序的課原本寫「直接加選」，但有人數上限的課送出後是登記不是加選（0.10 查證的規則），改成「不需志願序」。
- 新模組 `src/planner/auto-register.js`（畫面），顯示用的文字放 `src/lib/autoreg.js`：`formatRunTime`、`describeAutoItem`、`describeLogEntry`（純函式、有測試）。

### 4. 變更採計放進「查詢」
- 已在預排、**還沒登記或選上**的課，查詢結果那一列多一個「變更採計」連結。已登記、已選上的不提供：採計在登記時就定了，改預排不會改到正式選課（報告 §1）。
- 按下去 → 查這門課在選課網的所有採計方式（沿用 `attributionOptionsFor`）→ 列出「改成：選修｜核心・基本素養-量性推理｜取消」，目前那一種不能選。只有一種時說明「這門課在選課網只有目前這一種採計方式」。
- 選了 → content script `changepreregist`（先移除、再用新的選單加入；加不回去時用原本的參數還原）→ 成功顯示「採計已改為『…』」並重讀狀態；失敗顯示選課網給的原因（含「已還原原本的預排」）。
- 結果卡片與課表詳情小卡共用 `renderQueryRows`，兩邊都有；它的最後一個參數從單一 `onRegister` 改成 handlers 物件 `{ onRegister, onChangeAttribution, onPickAttribution, onCancelAttribution }`。
- 選項標示目前那一種的規則放 `src/lib/attribution.js` 的 `attributionChoices(options, item)`：未指定（舊版用空選單加入）的課沒有「目前」，每一種都能選。

## 測試

- 單元測試：`attributionChoices`（目前那一種、未指定、空清單）、`formatRunTime`、`describeAutoItem`、`describeLogEntry`。
- E2E（`e2e/`）：
  - `planner-auto.mjs`：自動登記分頁的加入、開關、時間提醒、立刻執行一次（假選課網回「選課結束」→ 照實說明、沒有送出 `setregist`）、重新整理後記住分頁與設定、移除。
  - `planner-attribution.mjs`：假選課網有開課系所與核心課程兩個選單；選修改成核心（先 `deletepreregist` 再用核心選單 `setpreregist`、預排跟著更新）；加不回去時還原；已登記的課沒有變更採計。
  - `pages.mjs`：popup 頁首只剩「當期選課 ↗」「教室 ↗」「編輯課表 ↗」，編輯課表頁標題與新增行程還在，`register.html` 已不存在，當期選課有三個分頁。
- 原本的 E2E（`planner-layout`、`planner-scroll`、`rooms`、`session-token`）全部要照樣通過。

## 版本

0.13.0。

## 不做（另外規劃）

- 每學期的交接：新學期怎麼抓新課表、上學期的預排／正式選課／自動登記清單怎麼清。使用者預計在學四年都會用，這一學期可以慢慢規劃。
- 商店的截圖與說明（已知是舊的，送審前再一起更新）。
