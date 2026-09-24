# E2E

用 Playwright 載入真的擴充功能（headless），選課網與課程時間表都用 `ctx.route` 攔截成假資料，不會碰到學校的伺服器。

第一次：

    cd e2e
    npm install
    npx playwright-core install chromium

執行（參數是擴充功能資料夾，通常是 repo 根目錄）：

    node rooms.mjs ..

每支腳本最後印 `PASS` 或 `FAIL`，失敗時結束碼是 1。截圖存在 `e2e/shots/`（不進 git）。
注意：新版 Playwright 的 headless shell 不能載入擴充功能，腳本都用 `channel: 'chromium'`。
