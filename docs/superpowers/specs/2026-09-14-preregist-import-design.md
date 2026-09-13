# NYCU 選課網預排匯入擴充功能 — 第一階段設計

日期：2026-09-14

## 目標

一個 Chrome 擴充功能。使用者在 popup 貼上課號，按一下，擴充功能就把這些課加入 cos.nycu.edu.tw 的「預排課程」。第一階段只做這件事，目標是流程跑通並上架 Chrome Web Store。

不在第一階段範圍：課名搜尋、課程資料爬取與儲存、與交大課程助手的整合、正式選課。

## 選課網 API（2026-09-13 實測）

- Base：`https://cos.nycu.edu.tw/`，全部是 `POST`，body 為 `application/x-www-form-urlencoded`。
- 認證：`Authorization: Bearer <JWT>`，JWT 存在選課網 origin 的 `localStorage.token`，有效 8 小時。Cookie 不算數。
- `getpreregist`，空 body → JSON 陣列，每項含 `cos_id`、`cos_cname`、`cos_time`、`lecturers` 等。
- `setpreregist`，body：`cos_id`、`menu_data`（JSON 字串，`{}` 可用）、`wType=X`、`GroupName=null`、`GroupName_E=null`、`category_type=`、`category_cname=null`、`category_ename=null`。成功回空字串；失敗回 `[{"status":"error","msg":"..."}]`，已知訊息：`選課預選失敗`（課號不存在）、`重複預選`（已在預排）。
- `userinfo`，空 body → 物件，含 `lastacysem`（如 `1151`）。
- 預排沒有系所、年級、校區、額滿或衝堂限制。
- 沒有 CORS，preflight 會被擋，所以 API 只能在選課網頁面內呼叫。

## 架構

```
popup (popup.html / popup.js)
   │ chrome.tabs.sendMessage({type:'import', ids})
   ▼
content script (content.js，只注入 https://cos.nycu.edu.tw/*)
   │ fetch 同源 API，帶 localStorage.token
   ▼
回傳結果 → popup 顯示 → content script 重新整理頁面
```

沒有 background service worker。不用 `storage`。

### manifest.json

- `manifest_version: 3`
- `permissions: ["activeTab"]`
- `host_permissions: ["https://cos.nycu.edu.tw/*"]`
- `content_scripts`：`matches: ["https://cos.nycu.edu.tw/*"]`，`js: ["src/content.js"]`
- `action.default_popup: "src/popup.html"`
- 圖示 16/48/128。

### 純函式模組（可單元測試）

`src/lib/parse.js`

- `parseIds(text) → string[]`：以逗號、空白、換行、分號切開；去掉 `1151_` 這類 `\d{4}_` 前綴；只保留 `^\d{6}$`（選課網課號固定六位數字，不足補零不做，直接視為無效）；去重、保序。
- `findInvalidTokens(text) → string[]`：切開後不符合格式的字串，讓 popup 提示。

`src/lib/classify.js`

- `classifyResult(id, responseText) → {id, status: 'added'|'exists'|'error', msg}`：空字串 → `added`；JSON 且 `msg === '重複預選'` → `exists`；其他 → `error` 並附 `msg`。
- `confirmWithList(results, preregistIds) → results`：`added` 但不在清單裡的改成 `error`，訊息「加入後未出現在預排清單」。

### content.js

- `chrome.runtime.onMessage` 收 `{type:'import', ids}`。
- token 不存在 → 回 `{ok:false, reason:'not_logged_in'}`。
- 依序對每個 id 呼叫 `setpreregist`，收集 `classifyResult`。串行呼叫，避免給學校伺服器壓力。
- 呼叫 `getpreregist`，用 `confirmWithList` 修正。
- 回 `{ok:true, results}`。popup 收到後再送 `{type:'reload'}`，content script 執行 `location.reload()`。分兩步是為了確保 popup 先拿到結果。

### popup

- 開啟時 `chrome.tabs.query({active:true, currentWindow:true})`。網址不是 `https://cos.nycu.edu.tw/` 開頭 → 只顯示「開啟選課網」按鈕，點了 `chrome.tabs.create({url:'https://cos.nycu.edu.tw/#/emulator'})`。
- 是選課網 → textarea、「加入預排」按鈕、結果區。
- 按下：`parseIds` 為空 → 提示。否則停用按鈕，送訊息，等待結果。
- 結果分三段列出：成功加入、原本就在預排、失敗（附訊息）。無效字串另列一行提醒。
- 錯誤處理：`sendMessage` 失敗（content script 未載入，例如安裝後沒重新整理）→ 提示「請重新整理選課網頁面」；`not_logged_in` → 提示「請先登入選課網」。
- 介面只做中文。

## 測試

- `node --test`：`parse.js` 與 `classify.js` 的單元測試，涵蓋分隔符、前綴、無效字串、去重、三種結果分類、清單確認。
- 手動端對端：以「載入未封裝項目」裝進已登入的 Chrome，匯入 `515600,110034,999999,563018`，預期：兩門成功、999999 失敗、563018 原本就在預排。之後用選課網介面移除測試課程。

## 上架材料

- `store/`：商店說明（中文）、隱私聲明（不蒐集、不傳送任何資料；只在選課網頁面內呼叫學校 API）、截圖說明。
- `scripts/pack.sh`：把 `manifest.json`、`src/`、`icons/` 打成 `dist/extension.zip`。
- 圖示以簡單 SVG 產生 PNG。

## 第二階段預留

課名搜尋需要課程資料。候選來源：擴充功能自行向課程時間表網站查整學期資料並存在 `chrome.storage.local`（推薦）、選課網課程查詢 API、助手的課程 JSON。第一階段的 manifest 不預先申請這些權限。
