# nycucourse-extension

Chrome 擴充功能：貼上課號，一鍵加入陽明交通大學選課系統（cos.nycu.edu.tw）的預排課程。

## 開發

```bash
npm test                # 單元測試（Node 內建 test runner）
scripts/make-icons.sh   # 由 icons/icon.svg 產生 PNG（macOS）
scripts/pack.sh         # 打包成 dist/*.zip 供上架
```

本機載入：`chrome://extensions` → 開發人員模式 → 載入未封裝項目 → 選這個資料夾。改完程式後按「重新載入」，並重新整理選課網分頁。

## 使用

1. 登入選課系統，開啟「預排課程」頁面。
2. 點擴充功能圖示，貼上課號（逗號、空白或換行分隔），按「加入預排」。
3. 結果會分成「成功加入」「原本就在預排」「失敗」三類。

## 運作方式

選課系統的預排 API 只能在該網站的頁面內呼叫。擴充功能在 cos.nycu.edu.tw 注入 content script，用頁面既有的登入權杖依序呼叫 `setpreregist`，再用 `getpreregist` 確認結果。細節見 `docs/superpowers/specs/`。

## 路線圖

1. 貼課號匯入（本版）。
2. 課名、老師、課號子字串搜尋，課程資料由擴充功能自行更新。
3. 與交大課程助手的匯出格式整合。
