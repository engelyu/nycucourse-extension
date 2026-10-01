# Chrome Web Store 更新送審步驟

版本：**0.13.0**，上傳檔案 `dist/nycucourse-extension-0.13.0.zip`（`scripts/pack.sh` 產生）。

這次是**更新既有項目**，不是新增項目。上一次送審的是 0.9.1。

## 0. 這次跟 0.9.1 的差別（審查要看的重點）

- **權限沒變**：一樣是 `storage`、`alarms`，主機權限一樣只有 `cos.nycu.edu.tw` 與 `timetable.nycu.edu.tw`。
- **新增頁面**：教室查詢（`src/rooms.html`）。只讀本機的公開課程資料，並向 `timetable.nycu.edu.tw` 取得公開的教室代碼表。
- **拿掉的頁面**：選課頁（功能搬進當期選課）；popup 只留課表，「加入預排」分頁拿掉；週課表改名「編輯課表」。
- **選課系統改版相容**：選課系統 2026-09-23 改版後，登入權杖改存在分頁的 sessionStorage，擴充功能改成從那裡讀，並優先使用已登入的選課網分頁。權杖一樣不會被複製、儲存或傳出該網站。
- 全部程式碼都在套件內，沒有遠端程式碼。

## 1. 套件

- 後台點進該項目 →「套件」→「上傳新套件」→ 選 `nycucourse-extension-0.13.0.zip`。
- 確認後台讀出的版本是 `0.13.0`。

## 2. 商品詳細資料（Store listing）

| 欄位 | 內容 |
|---|---|
| 說明 | 複製 `store/description.md` 的「詳細說明」整段 |
| 類別 | 生產力（Productivity）；有「教育」可選教育 |
| 語言 | 中文（繁體） |
| 商店圖示 | `store/images/store-icon-128.png`（沿用） |
| 螢幕截圖 | **先刪掉舊的五張**，再依序上傳 `store/images/screenshot-1.png` 到 `screenshot-5.png`（都是 1280×800；`e2e/store-shots.mjs` 產生） |
| 小型宣傳圖塊 | `store/images/promo-small-440x280.png`（沿用） |
| 官方網址 | `https://github.com/engelyu/nycucourse-extension` |
| 支援網址 | `https://github.com/engelyu/nycucourse-extension/issues` |

截圖內容：

1. popup 課表（頁首三個按鈕：當期選課、教室、編輯課表）
2. 當期選課：一鍵帶入空堂找課，左右分割與分頁
3. 查詢與登記確認視窗（志願序）
4. 教室查詢：大樓、樓層、現在誰在上課、教室一週課表
5. 當期選課裡的每日自動登記

截圖用課程時間表上真實的 115 上課程資料和假的選課網拍攝（示範課表是挑出來的課），裡面沒有任何人的個資。重拍：`cd e2e && node store-shots.mjs`。

## 3. 隱私權實務（Privacy practices）

**單一用途說明**（取代舊的）

```
協助陽明交大學生選課：搜尋與規劃課程、加入預排與正式選課，並以課表檢視已選課程。
```

**權限理由**

| 權限 | 理由（直接貼上） |
|---|---|
| storage | `將使用者手動下載的公開課程資料與教室代碼表、使用者自己的課表、當期選課的時段與篩選條件、自動登記設定存在本機。不傳送到任何地方。` |
| alarms | 見下方，中英對照 |
| 主機權限 | `cos.nycu.edu.tw：在選課系統頁面注入內容腳本，以使用者目前的登入狀態呼叫該網站自身的預排與選課 API。timetable.nycu.edu.tw：下載學校公開的課程時間表與教室代碼表，建立搜尋用的課程清單與教室查詢。` |

alarms 理由（中英對照）：

```
用於選用的「每日自動登記」功能：使用者自行開啟，並設定每天的時間（例如 13:00）與要登記的課程。擴充功能用 alarms 在該時間觸發一次，於陽明交大選課系統（cos.nycu.edu.tw）登記使用者事先指定的課程。預設關閉；未開啟時不建立任何排程，關閉後會立即清除排程。

Used only for the optional "daily auto-registration" feature. The user turns it on and chooses a daily time (e.g. 13:00) and the courses to register. The extension uses a single alarm to run once at that time and register the user's chosen courses on the NYCU course registration site (cos.nycu.edu.tw). It is off by default; no alarm is created unless the user enables it, and the alarm is cleared as soon as the user turns it off.
```

**是否使用遠端程式碼**：否。所有 JavaScript 都包含在套件內。

**資料使用揭露**：和上次一樣，全部**不勾選**：

- 個人識別資訊、健康、財務、驗證資訊、個人通訊、位置、網頁瀏覽記錄、使用者活動、網站內容

說明：擴充功能在選課系統頁面內使用既有的登入權杖發出同網站請求，權杖不會被讀出、儲存或傳送到開發者或第三方，所以不屬於「收集」。若審查人員認為屬於「驗證資訊」或「網站內容」，就改勾選，並聲明「不出售、不用於與單一用途無關的目的、不用於信用評估」。

**三項聲明全部勾選**：不出售或轉移使用者資料；不用於與單一用途無關的目的；不用於判斷信用或放款。

**隱私權政策網址**（沿用，內容已更新）：

```
https://github.com/engelyu/nycucourse-extension/blob/master/store/privacy.md
```

## 4. 給審查人員的測試說明（Test instructions，選填但建議填）

審查人員沒有陽明交大帳號，不能登入選課系統，所以寫清楚哪些功能不用登入就能驗證：

```
This extension helps students of National Yang Ming Chiao Tung University (NYCU) plan and register courses on the university's own course system (cos.nycu.edu.tw). Features that talk to cos.nycu.edu.tw require an NYCU student login, which reviewers will not have.

Features that can be tested without a login:
1. Click the toolbar icon. The popup shows the user's weekly timetable (empty without a login) and three buttons: 「當期選課 ↗」, 「教室 ↗」, 「編輯課表 ↗」.
2. On first use every page (popup and extension pages) shows 「先下載課程資料」. Click 「下載課程資料」; the extension downloads the public course timetable from timetable.nycu.edu.tw (about 1–3 minutes) and the page opens by itself when done. Later, every page has an 「更新課程資料」 button. Then click 「當期選課 ↗」 to open the planner page.
3. Type a keyword such as 線性代數 into the search box on the left. On the right, open the 「篩選設定」 tab and click 「全選」, or drag on the weekly grid to select time slots; courses that fit those slots are listed, and can be filtered by campus, category and department.
4. Click 「教室 ↗」 in the popup to open the classroom page. Pick a building and floor to see which rooms have a class right now, and click a room to see its weekly timetable. It uses the same public course data plus the public classroom code list from timetable.nycu.edu.tw.
5. Click 「編輯課表 ↗」 to add a personal event; it appears in the popup timetable.

No data is sent to the developer or any third party. Course registration is only performed after the user confirms in a dialog, and the optional daily auto-registration is off by default.
```

## 5. 發布設定（Distribution）

- 顯示設定：維持**不公開（Unlisted）**；想讓大家搜得到再改公開，不用重新上傳。
- 地區：全部地區。價格：免費。

## 6. 審查注意

- 這次多了 `alarms` 權限和正式選課功能，審查可能比上次久，也可能被要求補說明。
- 常見退件原因：權限理由太籠統、隱私權政策打不開、截圖與功能不符。以上都已準備好。
- 審查期間不要取消或重新上傳，會重新排隊。
- 若被退件，把退件信內容貼給 Claude 修改。

## 之後更新版本

1. 改 `manifest.json` 與 `package.json` 的 `version`。
2. `npm test`，`scripts/pack.sh`。
3. 後台該項目 →「套件」→ 上傳新版 zip → 提交審查。
