# 課程搜尋 — 第二階段設計

日期：2026-09-14

## 目標

使用者在 popup 輸入課名、老師或課號的片段，立即看到符合的課程，按「加入」就加入預排。課程資料由擴充功能自己從課程時間表網站抓取並存在本機，手動按「更新課程資料」才重抓。

第一階段的貼課號匯入保留。

## 課程時間表 API（2026-09-14 實測）

Base：`https://timetable.nycu.edu.tw/?r=main/`。不需要登入、cookie 或特殊 header；帶 `Origin: chrome-extension://…` 也正常回應。

- `get_acysem`（GET）→ `[{"T":"1151"},{"T":"114X"},...]`，新到舊。`X` 是暑修。
- `get_type`（GET）→ `[{uid, type, cname, ename}]`，共 8 類。
- `get_category`（POST `ftype, flang=zh-tw, acysem, acysemend`）→ `{"3*":"一般學士班",...}`。
- `get_college`（POST 加 `fcategory`）→ `{"S":"理學院",...}`；沒有學院層時回空物件或空陣列，此時學院代碼用 `*`。
- `get_dep`（POST 加 `fcollege`）→ `{"<dep uid>":"DAM(應用數學系)",...}`；可能回空陣列。
- `get_cos_list`（POST）必填：`m_acy, m_sem, m_acyend, m_semend, m_dep_uid, m_group=**, m_grade=**, m_class=**, m_option=**, m_crsname=**, m_teaname=**, m_cos_id=**, m_cos_code=**, m_crstime=**, m_crsoutline=**, m_costype=**, m_selcampus=**`。
  - **少了 `m_selcampus` 會回 `[]`**（助手爬蟲目前就少這個欄位）。
  - `m_dep_uid=**` 會回 `""`，不能一次抓全校，必須逐系所。
  - 回應：`{ <dep uid>: { dep_id, dep_cname, "1": {"1151_516700": course, ...}, "2": {...}, brief, costype, language } }`。數字 key 底下是課程。
  - course 欄位：`cos_id`（六位數字）、`cos_cname`、`cos_ename`、`teacher`、`cos_time`（如 `M56W34-SA321[GF]`）、`cos_credit`、`cos_type`、`dep_cname`、`memo`、`num_limit`、`reg_num`。

1151 學期實測：8 類、115 次樹狀查詢、343 個不重複系所、串行 111 秒、0 錯誤、3749 門不重複課程；精簡後 JSON 約 0.71 MB。

## 範圍決定

- **學期**：取 `get_acysem` 第一個不以 `X` 結尾的學期（與助手爬蟲一致）。popup 顯示資料學期。
- **更新**：只有手動按鈕。第一次打開、尚無資料時提示使用者按更新。
- **併發**：`get_cos_list` 同時 3 個請求，預估 40 秒內完成，對學校伺服器負擔小。
- **搜尋規則**（沿用助手 `Pages/simulation/query`）：課名子字串、英文課名不分大小寫子字串、老師子字串、課號完全相符、課名模糊子序列（輸入字元依序出現在課名中）。
- **排序**：課號完全相符 > 課名子字串 > 老師子字串 > 英文課名子字串 > 課名模糊。同級保持資料原始順序。最多顯示 50 筆並提示總數。
- **不做**：校區篩選、時間篩選、自動更新、多選批次加入。

## 架構

```
popup
 ├─ 搜尋框 → lib/search.js 在記憶體中過濾 chrome.storage.local 的課程
 ├─ 結果列「加入」→ content script import（第一階段協定，ids 長度 1）
 ├─ 「更新課程資料」→ chrome.runtime.sendMessage({type:'crawl:start'})
 └─ 監聽 chrome.storage.onChanged 顯示爬取進度
background service worker (src/background.js)
 └─ lib/crawl.js：走樹 → 逐系所抓 → lib/timetable.js 解析 → 寫入 storage
content script（第一階段，不變）
```

### storage schema（`chrome.storage.local`）

- `courseData`：`{ semester: "1151", updatedAt: <epoch ms>, courses: Course[] }`
- `crawlState`：`{ status: 'idle'|'running'|'done'|'error', phase: 'tree'|'courses', done: number, total: number, error?: string, startedAt: number }`
- `Course`：`{ id, name, ename, teacher, time, credit, type, dep }`，全部字串。

爬取完成才一次寫入 `courseData`；失敗時保留舊資料。

### Service worker 存活

MV3 service worker 閒置 30 秒會被終止；呼叫擴充功能 API 會重設計時器。爬取期間每完成一個系所就寫一次 `crawlState`，確保不會閒置。若 worker 仍被終止，`crawlState` 會停在 `running`；popup 開啟時若看到 `running` 且 `startedAt` 超過 5 分鐘，視為中斷並顯示可重新更新。

### 純函式模組

`src/lib/timetable.js`

- `pickSemester(acysemList) → string`
- `formBody(obj) → string`（URLSearchParams）
- `cosListParams(semester, depUid) → object`
- `parseCosList(json) → Course[]`（去重由 crawl 處理）
- `objectKeys(value) → string[]`：物件回 key，陣列或空值回 `[]`

`src/lib/crawl.js`

- `crawlSemester({ fetchJson, onProgress, concurrency }) → { semester, courses }`
  - `fetchJson(fn, { method, body }) → Promise<any>`，由 background 以 `fetch` 實作；測試注入假資料。
  - 走 `get_acysem → get_type → get_category → get_college → get_dep`，收集不重複 dep uid。
  - 以 `concurrency` 併發抓 `get_cos_list`，依 `id` 去重。
  - 每完成一步呼叫 `onProgress({ phase, done, total })`。
  - 任一 `get_cos_list` 失敗重試 2 次，仍失敗則整體 reject。

`src/lib/search.js`

- `searchCourses(courses, query, limit=50) → { total, items }`

## popup 版面

寬 380px。上到下：

1. 標題列：`NYCU 預排課程匯入`。
2. 資料列：`1151 學期 · 3749 門 · 9/14 13:05 更新`，右側「更新課程資料」按鈕；更新中顯示 `抓取中 120/343` 與停用按鈕。
3. 搜尋框（有資料才可用），placeholder `課名、老師或課號`。
4. 結果清單：每列顯示 `課號 課名`、第二行 `老師 · 時間 · 學分`，右側「加入」。不在選課網分頁時，「加入」停用並在清單上方提示「切到選課網分頁才能加入」，旁邊有「開啟選課網」按鈕。
5. 加入後該列按鈕改成 `已加入`、`已在預排` 或紅字錯誤訊息；不自動重新整理頁面（避免 popup 被重整打斷連續加入），清單上方出現「重新整理選課網以查看」按鈕。
6. `<details>` 收合區「貼上課號批次加入」：第一階段的 textarea 與結果區，行為不變，完成後仍自動重新整理。

## 權限變更

- `permissions`：`activeTab`、`storage`
- `host_permissions`：`https://cos.nycu.edu.tw/*`、`https://timetable.nycu.edu.tw/*`
- 新增 `background.service_worker: "src/background.js"`，`type: "module"`。

版本升到 `0.2.0`。商店說明與隱私聲明同步更新：說明會向 timetable.nycu.edu.tw 取得公開課程資料並存在本機。

## 測試

- 單元測試：`timetable.js`、`crawl.js`（假 `fetchJson`，涵蓋空學院、空陣列回應、重複課程、重試、失敗 reject、進度回報）、`search.js`（五種規則、排序、上限、空查詢）。
- 端對端：若本機可用 Chrome for Testing + Puppeteer，載入未封裝擴充功能，開 popup 頁面實跑更新與搜尋；選課網加入流程需登入，交給使用者手動測。
