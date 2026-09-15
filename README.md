# nycucourse-extension

Chrome 擴充功能：搜尋課名、老師或課號，一鍵加入陽明交通大學選課系統（cos.nycu.edu.tw）的預排課程。

- 隱私權政策：[store/privacy.md](store/privacy.md)
- 問題回報與建議：[Issues](https://github.com/engelyu/nycucourse-extension/issues)

本工具非學校官方工具。

## 開發

```bash
npm test                # 單元測試（Node 內建 test runner）
scripts/make-icons.sh   # 由 icons/icon.svg 產生 PNG（macOS）
scripts/pack.sh         # 打包成 dist/*.zip 供上架
```

本機載入：`chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選這個資料夾。改完程式後按「重新載入」，並重新整理選課網分頁。

## 使用

1. 點擴充功能圖示，第一次先按「更新課程資料」，約一分鐘會下載整學期課程。
2. 登入選課系統，停在選課網分頁時再打開擴充功能。
3. 在搜尋框輸入課名、老師或課號片段，按「加入」。加入後可按「重新整理選課網」查看。
4. 也可以展開「貼上課號批次加入」，一次貼多個課號。

## 運作方式

- **課程資料**：background service worker 走訪 timetable.nycu.edu.tw 的類別、學院、系所清單，逐系所呼叫 `get_cos_list`（必須帶 `m_selcampus=**`），同時 3 個請求，結果存在 `chrome.storage.local`。
- **搜尋**：規則沿用交大課程助手，課號完全相符、課名子字串、老師子字串、英文課名、課名模糊比對，依序排序。
- **加入預排**：選課系統的預排 API 只能在該網站頁面內呼叫。content script 用頁面既有的登入權杖呼叫 `setpreregist`，再用 `getpreregist` 確認。

細節見 `docs/superpowers/specs/`。

## 路線圖

1. 貼課號匯入（v0.1.0）。
2. 課名、老師、課號搜尋，課程資料由擴充功能自行更新（v0.2.0）。
3. 與交大課程助手的匯出格式整合。
