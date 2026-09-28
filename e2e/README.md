# E2E

用 Playwright 載入真的擴充功能（headless），選課網與課程時間表都用 `ctx.route` 攔截成假資料，不會碰到學校的伺服器。

第一次：

    cd e2e
    npm install
    npx playwright-core install chromium

全部跑一次（在 `e2e/` 裡）：

    npm test

只跑一支（參數是擴充功能資料夾，預設是上一層的 repo 根目錄）：

    node rooms.mjs

| 腳本 | 測什麼 |
|---|---|
| `rooms.mjs` | 教室查詢：大樓與樓層分組、上課中／沒有排課到幾點、指定時間、找教室、`?room=`、大樓 API 壞掉時照常能用 |
| `planner-layout.mjs` | 當期選課：全選／空堂／清除、左右分割（最小寬度、鍵盤、記住寬度）、分頁、窄視窗上下排、更新課程資料；popup 只留課表、紅線只在今天 |
| `planner-scroll.mjs` | 當期選課：寬視窗左右兩欄各自捲動、系所搜尋按 Enter（含注音選字）沒有作用 |
| `planner-auto.mjs` | 當期選課的自動登記分頁：加入清單、開關與時間、立刻執行一次（選課結束時不送出）、移除、記住分頁 |
| `planner-attribution.mjs` | 查詢裡的變更採計：選修改核心、加不回去時還原、已登記的課不提供 |
| `pages.mjs` | popup 頁首三個按鈕、編輯課表頁、選課頁已拿掉、當期選課三個分頁 |
| `store-shots.mjs` | 不是測試：拍商店截圖（真實課程資料＋假選課網），輸出 `store/images/screenshot-1..5.png`。需要 `~/nycucourse-data/timetable-history/1151.json` 與 `classroom-code-*.json`，可用環境變數 `COURSES`、`BUILDINGS` 指定 |
| `session-token.mjs` | 選課網權杖在 sessionStorage、開好幾個選課網分頁時挑已登入的；選課結束後改讀本學期選課結果 |

每支腳本最後印 `PASS` 或 `FAIL`，失敗時結束碼是 1。截圖存在 `e2e/shots/`（不進 git）。
注意：新版 Playwright 的 headless shell 不能載入擴充功能，腳本都用 `channel: 'chromium'`。
