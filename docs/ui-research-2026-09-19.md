# UI 研究筆記與改善清單（2026-09-19）

使用者不在時自行研究，目的是依公認準則與既有同類工具，改善選課規劃頁與 popup。每一項都標出依據。

## 查到的準則與做法

### 篩選（Nielsen Norman Group 等）

- **已套用的篩選要一直看得到**：在結果上方列出已套用的篩選，每個都能單獨取消，另外提供「清除全部」。逐一取消比只能全部清除好。
  （[NN/g：Filter Categories and Values](https://www.nngroup.com/articles/filter-categories-values/)、[UI Coach：Filter UX Best Practices](https://www.uicoach.io/learn/guides/filter-ux-best-practices)、[UXPin：Filter UI and UX](https://www.uxpin.com/studio/blog/filter-ui-and-ux/)）
- **在選項旁顯示結果數**，例如「陽明 (12)」。使用者點下去之前就知道會剩幾筆，不會撞到「零結果」。
  （[Pencil & Paper：Filter UX patterns](https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-filtering)、[UXPin](https://www.uxpin.com/studio/blog/filter-ui-and-ux/)）
- **零結果時給出路**：建議放寬最後一個條件，或提供清除篩選的按鈕。
  （[UXPin](https://www.uxpin.com/studio/blog/filter-ui-and-ux/)、[Insaim：Filter UI Design](https://www.insaim.design/blog/filter-ui-design-best-ux-practices-and-examples)）
- **篩選分類排序**：一般、常用的放前面，專門的放後面；用使用者熟悉的詞，不用內部代碼。
  （[NN/g](https://www.nngroup.com/articles/filter-categories-values/)）
- **即時篩選**：資料量小時即時更新結果最好，使用者能馬上看到每個選擇的影響。
  （[UI Coach](https://www.uicoach.io/learn/guides/filter-ux-best-practices)）

### 確認與復原（NN/g）

- **確認視窗只用在後果嚴重、無法復原的動作**。按鈕要寫出具體動作（例如「送出登記」「先不要」），不要用「確定／取消」，也不要預設選項。
  （[NN/g：Confirmation Dialogs](https://www.nngroup.com/articles/confirmation-dialog/)）
- **能復原的動作，用「復原」取代確認**：不打斷使用者，也能讓他改變主意。
  （[NN/g：Preventing User Errors](https://www.nngroup.com/articles/user-mistakes/)、[GNOME HIG：Dialogs](https://developer.gnome.org/hig/patterns/feedback/dialogs.html)）
- **系統狀態要看得到**：正在做什麼、做完了沒，都要有回饋（Nielsen 十大原則第一條）。
  （[NN/g：Visibility of System Status](https://www.nngroup.com/articles/visibility-system-status/)、[NN/g：10 Usability Heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/)）

### 可框選的時段格子

- **拖曳框選**是 When2meet 以來的通用做法，但也要能**點一下切換單格**，格子要夠大好點。觸控裝置上拖曳容易被當成捲動。
  （[Carly：How to use When2meet](https://www.usecarly.com/blog/how-to-use-when2meet/)、[WhenItWorks](https://www.whenitworks.app/blog/when2meet-alternative)）
- **鍵盤操作（W3C ARIA Grid pattern）**：
  - 方向鍵移動焦點，Space 選取。
  - Shift＋方向鍵延伸選取，Ctrl＋Space 選整欄，Shift＋Space 選整列。
  - 選到的格子標 `aria-selected="true"`。
  - 整個格子只佔一個 Tab 停留點，裡面用方向鍵移動。
  （[W3C WAI-ARIA APG：Grid](https://www.w3.org/WAI/ARIA/apg/patterns/grid/)）
- **週課表**：學生偏好週課表格子，每門課一個顏色，一眼看出衝堂。
  （[Texas Law：Schedule Planner case study](https://law.utexas.edu/ux-case-studies/schedule-planner/)、[Coursicle](https://www.coursicle.com/course-planner/)）

### 顏色

- **用色弱也分得出的配色**，例如 Okabe-Ito 配色，並**不要只靠顏色**傳達狀態，要搭配文字或符號。文字對比仍要符合 WCAG 4.5:1。
  （[Okabe-Ito 參考](https://sci-draw.com/blog/colorblind-safe-palettes-okabe-ito-reference)、[AudioEye：Colorblind-friendly palettes](https://www.audioeye.com/post/colorblind-friendly-palettes/)）

### Chrome 擴充功能 popup

- **popup 要精簡**：寬度固定、高度隨內容，最高 600px。常見的舒適尺寸約 400×500。字型與樣式要打包在擴充功能裡。
  （[Chrome：Design the user interface](https://developer.chrome.com/docs/extensions/develop/ui)、[Extension.js：Popup sizing](https://extension.js.org/docs/implementation-guide/popup-sizing)、[ExtensionBooster](https://extensionbooster.net/blog/chrome-extension-popup-ui-design-best-practices-guide/)）
- **大功能放完整分頁或側邊欄**，這跟使用者定下的「popup 只放小工具」原則一致。
  （[Chrome：Design the user interface](https://developer.chrome.com/docs/extensions/develop/ui)）

### 同類工具

- NTU 的課表規劃工具（[plan\*](https://plan.kenrick95.org/)、[CORS Planner](https://cors.bicrement.com/)、[STARS Planner](https://github.com/ruiofshens/ntu-stars-planner)）都以週課表格子為主。plan\* 可以指定想空出的時段，CORS Planner 會自動避開衝堂。
- [Semester.ly](https://semester.ly/) 用進階搜尋加篩選找課。

## 對照現況的改善清單（依優先順序）

| # | 改善 | 依據 | 範圍 |
|---|---|---|---|
| 1 | 結果上方列出**已套用的篩選**，每個可以單獨 × 取消，加上「清除全部篩選」 | 已套用的篩選要看得到、可逐一取消 | 規劃頁 |
| 2 | 校區、類別選項旁顯示**結果數**；**零結果時給建議**（改部分重疊、清除篩選） | 顯示結果數、零結果給出路 | 規劃頁 |
| 3 | 「帶入空堂」「全部清除」會取代選取，加上**復原** | 能復原就不用確認 | 規劃頁 |
| 4 | 狀態顏色改成**色弱也分得出**的配色，並加上**非顏色提示**（✓、志願序數字、預） | 色弱友善、不只靠顏色 | 規劃頁 |
| 5 | 確認視窗的按鈕寫出具體動作：「送出加選」「送出登記」「先不要」 | 確認視窗按鈕要具體 | 共用確認視窗 |
| 6 | 格子**固定在畫面上**：結果很長時捲動右邊，左邊格子還看得到，滑過預覽才有意義 | 系統狀態看得到 | 規劃頁 |
| 7 | 格子支援**鍵盤操作**：方向鍵移動、Space 切換、Shift＋方向鍵延伸，並標上 ARIA 狀態 | W3C ARIA Grid | 規劃頁 |

每一項都在 `planner-reg` 分支上各自 commit，並附測試與截圖，等使用者回來決定要留哪些。
