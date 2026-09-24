# 拿掉選課頁、編輯課表、自動登記與變更採計搬進當期選課 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 拿掉選課頁、週課表改名「編輯課表」，把只在選課頁的「每日自動登記」與「變更採計」搬進當期選課。

**Architecture:** 自動登記是當期選課右欄的第三個分頁（`src/planner/auto-register.js`），背景程式不動；變更採計接在查詢結果列（`renderQueryRows`），沿用 content script 既有的 `changepreregist`（先移除再加入、失敗還原）。顯示用文字與選項標示放 `src/lib/` 的純函式。

**Tech Stack:** Chrome MV3 擴充功能、原生 ES modules、`node --test`、Playwright（`playwright-core`，`e2e/`）。

**Spec:** `docs/superpowers/specs/2026-09-25-retire-register-page-design.md`

## Global Constraints

- 在 `engel-server` 的 `~/nycucourse-extension`，分支 `fix-reg-rules`，起點 commit `de96be6`（0.12.0）。只 commit，不 push。
- 用 SSH 跑指令時先 `export PATH=/opt/homebrew/bin:$PATH`。
- 介面文字繁體中文。背景程式（`background.js`）、content script（`content.js`）、`alarms` 權限都不改。
- 已登記、已選上的課不提供變更採計。
- Commit 訊息中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 單元測試：repo 根目錄 `npm test`；E2E：`cd e2e && npm test`（全部）或 `node <腳本>.mjs`（單支）。

## 這份計畫的程式碼怎麼套用

每個程式碼區塊都是 `git apply` 用的 patch，前面寫著「建立 `../plan-patches/<名稱>.patch`：」。在 repo 根目錄用這支小工具把指定的區塊存成檔案（它只認「建立 `路徑`：」後面緊接的區塊）：

```bash
mkdir -p ~/.cache/plan-tools && cat > ~/.cache/plan-tools/from-plan.py <<'EOF'
# 把計畫裡「建立 `路徑`：」後面的程式碼區塊寫成檔案。用法：python3 from-plan.py <plan> <路徑>
import re, sys, os
plan, want = open(sys.argv[1]).read(), sys.argv[2]
for m in re.finditer(r"建立 `([^`]+)`(?:[^\n]*)\n\n```[a-z]*\n(.*?)\n```", plan, re.S):
    if m.group(1) == want:
        os.makedirs(os.path.dirname(want) or ".", exist_ok=True)
        open(want, "w").write(m.group(2) + "\n")
        print("wrote", want)
        break
else:
    sys.exit("not found in plan: " + want)
EOF
```

之後每一步寫成：

```bash
PLAN=docs/superpowers/plans/2026-09-25-retire-register-page.md
python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t1-test.patch && git apply ../plan-patches/t1-test.patch
```

這些 patch 已在一份丟棄用的副本依序套用驗證過：四個任務依序套完，結果和一次做完的版本逐位元相同；單元測試 287 個、E2E 7 支全過。

## File Structure

| 檔案 | 任務 | 責任 |
|---|---|---|
| `src/lib/attribution.js`、`test/attribution.test.js` | 1 | `attributionChoices`：變更採計的選項，標出目前那一種 |
| `src/lib/autoreg.js`、`test/autoreg.test.js` | 1 | `formatRunTime`、`describeAutoItem`、`describeLogEntry` |
| `src/planner/auto-register.js`（新） | 2 | 自動登記分頁的畫面與事件 |
| `src/planner.html`、`src/planner.css`、`src/planner.js` | 2、3、4 | 第三個分頁、接上自動登記與變更採計、圖例文字 |
| `src/planner/results.js`、`src/planner/course-detail.js` | 3 | 查詢結果列的「變更採計」與選項 |
| `src/register.*`（刪）、`src/popup.*`、`src/schedule.html`、`src/reg-dialog.*`、`src/cos-tab.js` | 4 | 拿掉選課頁、改名編輯課表、註解 |
| `README.md`、`manifest.json`、`package.json` | 4 | 說明、版本 0.13.0 |
| `e2e/planner-auto.mjs`、`e2e/planner-attribution.mjs`、`e2e/pages.mjs`（新）、`e2e/README.md` | 2、3、4 | E2E |

---

### Task 1: 顯示文字與選項標示的純函式

**Files:**
- Modify: `src/lib/attribution.js`（檔尾加 `attributionChoices`）、`src/lib/autoreg.js`（檔尾加三個函式）
- Test: `test/attribution.test.js`、`test/autoreg.test.js`（檔尾加測試）

**Interfaces:**
- Consumes: `describeAttribution(item)`、`attributionKey(row)`（`src/lib/attribution.js` 既有）。
- Produces:
  - `attributionChoices(options: { key, label, ... }[], item) → (option & { current: boolean })[]`
  - `formatRunTime(ms) → '9/25 13:05' | ''`
  - `describeAutoItem(item: { cosId, title, wish }, fallbackTitle = '') → string`（有志願：`第 N 志願`；沒有：`不需志願序`）
  - `describeLogEntry(entry: { at, trigger, summary, note }) → string`

- [ ] **Step 1: 寫失敗的測試**

建立 `../plan-patches/t1-test.patch`：

```diff
diff --git a/test/attribution.test.js b/test/attribution.test.js
index ce44f99..5c21828 100644
--- a/test/attribution.test.js
+++ b/test/attribution.test.js
@@ -282,3 +282,20 @@ test('restoreParams 用預排紀錄組回加入預排的參數', () => {
   assert.equal(restoreParams({ cos_id: '1' }).menu_data, '{}')
   assert.equal(restoreParams({ cos_id: '1' }).wType, 'X')
 })
+
+// 當期選課「查詢」裡的「變更採計」：列出這門課的採計方式，目前那一種不能再選
+import { attributionChoices, attributionKey } from '../src/lib/attribution.js'
+
+test('attributionChoices：目前的採計方式標 current，其他可以選', () => {
+  const home = { key: '2|X|', label: '選修', source: 'home' }
+  const core = { key: 'E|E|CAT-Z102', label: '核心・基本素養-量性推理', source: 'alt' }
+  const item = { cos_id: '112304', menu_data: '{&quot;type&quot;:1,&quot;dep_uid&quot;:&quot;DEP-MATH&quot;}', cos_type_code: '2', wType: 'X', category_type: '' }
+  assert.equal(attributionKey(item), '2|X|')
+  assert.deepEqual(attributionChoices([home, core], item).map((o) => [o.label, o.current]), [['選修', true], ['核心・基本素養-量性推理', false]])
+})
+
+test('attributionChoices：未指定（用空選單加入）的課每一種都能選', () => {
+  const item = { cos_id: '112304', menu_data: '{}', cos_type_code: '2', wType: 'X' }
+  assert.deepEqual(attributionChoices([{ key: '2|X|', label: '選修' }], item).map((o) => o.current), [false])
+  assert.deepEqual(attributionChoices(null, item), [])
+})
diff --git a/test/autoreg.test.js b/test/autoreg.test.js
index 509a305..1928ceb 100644
--- a/test/autoreg.test.js
+++ b/test/autoreg.test.js
@@ -125,3 +125,23 @@ test('registerParams 丟例外時只有那一門失敗', async () => {
   assert.equal(results[1].ok, false)
   assert.match(results[1].message, /志願/)
 })
+
+// 自動登記分頁（從選課頁搬到當期選課）顯示用的文字
+import { formatRunTime, describeAutoItem, describeLogEntry } from '../src/lib/autoreg.js'
+
+test('formatRunTime：月/日 時:分，沒有時間回空字串', () => {
+  assert.equal(formatRunTime(new Date(2026, 8, 25, 13, 5).getTime()), '9/25 13:05')
+  assert.equal(formatRunTime(0), '')
+  assert.equal(formatRunTime(null), '')
+})
+
+test('describeAutoItem：課號、課名、志願；沒有志願序的寫「不需志願序」', () => {
+  assert.equal(describeAutoItem({ cosId: '515044', title: '實變函數論(一)', wish: '2' }), '515044 實變函數論(一)　第 2 志願')
+  assert.equal(describeAutoItem({ cosId: '515044', title: '', wish: '' }, '預排裡的課名'), '515044 預排裡的課名　不需志願序')
+})
+
+test('describeLogEntry：時間、手動或自動、結果', () => {
+  const at = new Date(2026, 8, 25, 13, 0).getTime()
+  assert.equal(describeLogEntry({ at, trigger: 'manual', summary: '', note: '選課系統暫停中：選課結束' }), '9/25 13:00　手動　選課系統暫停中：選課結束')
+  assert.equal(describeLogEntry({ at, trigger: 'alarm', summary: '成功 1 門、失敗 0 門：實變 已登記第 2 志願', note: '' }), '9/25 13:00　自動　成功 1 門、失敗 0 門：實變 已登記第 2 志願')
+})
```

- [ ] **Step 2: 套用並確認失敗**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t1-test.patch && git apply ../plan-patches/t1-test.patch && node --test test/attribution.test.js test/autoreg.test.js`
Expected: FAIL，`does not provide an export named 'attributionChoices'`、`… 'describeAutoItem'`。

- [ ] **Step 3: 實作**

建立 `../plan-patches/t1-impl.patch`：

```diff
diff --git a/src/lib/attribution.js b/src/lib/attribution.js
index b7b7b12..ff1edf6 100644
--- a/src/lib/attribution.js
+++ b/src/lib/attribution.js
@@ -233,3 +233,10 @@ export function describeAttribution(item) {
   if (!menu || typeof menu !== 'object' || !Object.keys(menu).length) return '未指定'
   return optionLabel(item)
 }
+
+// 變更採計方式時列出的選項：目前的那一種標 current（不能再選）；
+// 未指定（舊版擴充功能用空選單加入）的課沒有「目前」，每一種都能選
+export function attributionChoices(options, item) {
+  const current = describeAttribution(item) === '未指定' ? '' : attributionKey(item)
+  return (options || []).map((option) => ({ ...option, current: option.key === current }))
+}
diff --git a/src/lib/autoreg.js b/src/lib/autoreg.js
index 83efdd8..3cccdce 100644
--- a/src/lib/autoreg.js
+++ b/src/lib/autoreg.js
@@ -80,3 +80,24 @@ export function summarizeResults(results) {
   const detail = list.map((r) => `${r.title} ${r.message}`).join('；')
   return `成功 ${ok} 門、失敗 ${list.length - ok} 門：${detail}`
 }
+
+const pad2 = (n) => String(n).padStart(2, '0')
+
+// 自動登記的時間顯示：「9/25 13:05」
+export function formatRunTime(ms) {
+  if (!ms) return ''
+  const d = new Date(ms)
+  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
+}
+
+// 清單裡的一門課：「515044 實變函數論(一)　第 2 志願」。沒有志願序的課送出後是登記或加選，
+// 看選課網對那門課的規則（lib/register.js regAction），這裡只寫「不需志願序」
+export function describeAutoItem(item, fallbackTitle = '') {
+  const title = (item && item.title) || fallbackTitle
+  return `${item.cosId} ${title}　${item.wish ? `第 ${item.wish} 志願` : '不需志願序'}`
+}
+
+// 執行紀錄一筆：「9/25 13:00　自動　成功 1 門、失敗 0 門：…」
+export function describeLogEntry(entry) {
+  return `${formatRunTime(entry.at)}　${entry.trigger === 'manual' ? '手動' : '自動'}　${entry.summary || entry.note}`
+}
```

- [ ] **Step 4: 套用並確認通過**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t1-impl.patch && git apply ../plan-patches/t1-impl.patch && node --test test/attribution.test.js test/autoreg.test.js && npm test`
Expected: 兩個檔案全過；`npm test` 287 個全過。

- [ ] **Step 5: Commit**

```bash
git add src/lib/attribution.js src/lib/autoreg.js test/attribution.test.js test/autoreg.test.js
git commit -m "變更採計的選項標示、自動登記顯示文字（純函式）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 當期選課的「自動登記」分頁

**Files:**
- Create: `src/planner/auto-register.js`、`e2e/planner-auto.mjs`
- Modify: `src/planner.html`（第三個分頁按鈕與內容）、`src/planner.css`（檔尾加樣式）、`src/planner.js`（import、`paneTab` 接受 `auto`、建立分頁、預排變動時重畫）、`e2e/README.md`（表格加一列）

**Interfaces:**
- Consumes: Task 1 的 `formatRunTime`、`describeAutoItem`、`describeLogEntry`；既有 `timeWarning(time)`（`src/lib/autoreg.js`）；背景程式訊息 `{ type: 'auto:get' }` → `{ ok, config, nextRun }`、`{ type: 'auto:set', patch }` → 同上、`{ type: 'auto:run' }` → `{ ok, entry }`；`createPaneTabs` 的 `tabs` 物件；`planner.js` 的 `syncStatus()`、`render()`、`statusMessage`。
- Produces: `createAutoRegister(root: Element, { courses: () => course[], onRan: () => Promise }) → { load(), render() }`；DOM id：`tab-auto`、`panel-auto`、`auto-enabled`、`auto-time`、`auto-run`、`auto-next`、`auto-warning`、`auto-message`、`auto-list`、`auto-course`、`auto-wish`、`auto-add`、`auto-log`。

- [ ] **Step 1: 寫失敗的 E2E**

建立 `../plan-patches/t2-test.patch`：

```diff
diff --git a/e2e/README.md b/e2e/README.md
index e2134ad..392c5f7 100644
--- a/e2e/README.md
+++ b/e2e/README.md
@@ -21,6 +21,7 @@
 | `rooms.mjs` | 教室查詢：大樓與樓層分組、上課中／沒有排課到幾點、指定時間、找教室、`?room=`、大樓 API 壞掉時照常能用 |
 | `planner-layout.mjs` | 當期選課：全選／空堂／清除、左右分割（最小寬度、鍵盤、記住寬度）、分頁、窄視窗上下排、更新課程資料；popup 只留課表、紅線只在今天 |
 | `planner-scroll.mjs` | 當期選課：寬視窗左右兩欄各自捲動、系所搜尋按 Enter（含注音選字）沒有作用 |
+| `planner-auto.mjs` | 當期選課的自動登記分頁：加入清單、開關與時間、立刻執行一次（選課結束時不送出）、移除、記住分頁 |
 | `session-token.mjs` | 選課網權杖在 sessionStorage、開好幾個選課網分頁時挑已登入的；選課結束後改讀本學期選課結果 |
 
 每支腳本最後印 `PASS` 或 `FAIL`，失敗時結束碼是 1。截圖存在 `e2e/shots/`（不進 git）。
diff --git a/e2e/planner-auto.mjs b/e2e/planner-auto.mjs
new file mode 100644
index 0000000..54dbbbe
--- /dev/null
+++ b/e2e/planner-auto.mjs
@@ -0,0 +1,105 @@
+// 當期選課的「自動登記」分頁（從選課頁搬過來）：加入清單、開關與時間、立刻執行一次、移除、記住分頁。
+// 假選課網回「選課結束」，所以「立刻執行一次」會真的跑背景程式，但不會送出任何登記。
+// 用法：node planner-auto.mjs [擴充功能資料夾，預設 ..]
+import { chromium } from 'playwright-core'
+import { mkdtempSync, mkdirSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join, resolve } from 'node:path'
+
+const EXT = resolve(process.argv[2] || '..')
+const SHOTS = new URL('./shots/', import.meta.url).pathname
+mkdirSync(SHOTS, { recursive: true })
+const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'e2e-')), {
+  headless: true,
+  channel: 'chromium',
+  viewport: { width: 1400, height: 900 },
+  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
+})
+
+const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
+const TOKEN = `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 8 * 3600 })}.sig`
+const prereg = (id, name, time) => ({ cos_id: id, cos_cname: name, cos_time: time, acy: '115', sem: '1', menu_data: '{&quot;type&quot;:1,&quot;dep_uid&quot;:&quot;D1&quot;}', wType: 'X', cos_type_code: '2' })
+const PREREG = [prereg('515044', '實變函數論(一)', 'M34-SC101[GF]'), prereg('112304', '計算機概論', 'W56-EC015[GF]')]
+const cosCalls = []
+await ctx.route('https://cos.nycu.edu.tw/**', async (route) => {
+  const req = route.request()
+  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cos</title>' })
+  const path = new URL(req.url()).pathname.slice(1)
+  cosCalls.push(path)
+  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
+  if (path === 'checkreg') return json({ status: 'error', cmsg: '選課結束', emsg: 'End of course selection' })
+  if (path === 'getpreregist') return json(PREREG)
+  if (path === 'getregist') return json([])
+  return json([])
+})
+
+let [sw] = ctx.serviceWorkers()
+if (!sw) sw = await ctx.waitForEvent('serviceworker')
+const extId = new URL(sw.url()).host
+await sw.evaluate((schedule) => chrome.storage.local.set({ schedule, courseData: { semester: '1151', updatedAt: Date.now(), courses: [] } }), {
+  sources: { registered: { semester: '1151', updatedAt: Date.now(), courses: [] }, preregist: { semester: '1151', updatedAt: Date.now(), courses: PREREG } },
+  manual: [],
+  overrides: {},
+})
+// 已登入的選課網分頁：背景程式執行自動登記時要用它
+const cos = await ctx.newPage()
+await cos.goto('https://cos.nycu.edu.tw/')
+await cos.evaluate((t) => sessionStorage.setItem('token', t), TOKEN)
+
+const errors = []
+const checks = {}
+const page = await ctx.newPage()
+page.on('pageerror', (e) => errors.push(String(e)))
+await page.goto(`chrome-extension://${extId}/src/planner.html`)
+await page.waitForSelector('#tab-auto')
+await page.click('#tab-auto')
+const text = (sel) => page.textContent(sel)
+const options = () => page.$$eval('#auto-course option', (os) => os.map((o) => o.value))
+await page.waitForFunction(() => document.querySelector('#auto-next').textContent !== '')
+
+checks['有自動登記分頁'] = await page.evaluate(() => !document.querySelector('#panel-auto').hidden && document.querySelector('#panel-preview').hidden)
+checks['一開始是關閉'] = (await text('#auto-next')) === '目前關閉'
+checks['清單是空的'] = (await text('#auto-list')).includes('清單是空的')
+checks['課程選單列出預排的課'] = JSON.stringify(await options()) === JSON.stringify(['515044', '112304'])
+
+await page.selectOption('#auto-course', '515044')
+await page.selectOption('#auto-wish', '2')
+await page.click('#auto-add')
+await page.waitForFunction(() => document.querySelector('#auto-list').textContent.includes('515044'))
+checks['加入清單後顯示課名與志願'] = (await text('#auto-list')).includes('515044 實變函數論(一)　第 2 志願')
+checks['加入的課不再出現在選單'] = JSON.stringify(await options()) === JSON.stringify(['112304'])
+
+await page.check('#auto-enabled')
+await page.waitForFunction(() => document.querySelector('#auto-next').textContent.startsWith('下次執行：'))
+checks['打開後顯示下次執行時間'] = /^下次執行：\d+\/\d+ 13:00$/.test(await text('#auto-next'))
+await page.fill('#auto-time', '11:00')
+await page.dispatchEvent('#auto-time', 'change')
+await page.waitForFunction(() => !document.querySelector('#auto-warning').hidden)
+checks['分發時段的時間會提醒'] = (await text('#auto-warning')).includes('10:00 到 12:00')
+await page.fill('#auto-time', '13:00')
+await page.dispatchEvent('#auto-time', 'change')
+await page.waitForFunction(() => document.querySelector('#auto-warning').hidden)
+
+cosCalls.length = 0
+await page.click('#auto-run')
+await page.waitForFunction(() => /自動登記：/.test(document.querySelector('#auto-message').textContent), null, { timeout: 30000 })
+checks['立刻執行一次：選課結束時照實說明'] = (await text('#auto-message')) === '自動登記：選課系統暫停中：選課結束'
+checks['執行紀錄記下手動執行'] = /手動　選課系統暫停中：選課結束/.test(await text('#auto-log'))
+checks['選課結束時沒有送出任何登記'] = !cosCalls.includes('setregist')
+await page.screenshot({ path: SHOTS + 'planner-auto.png' })
+
+await page.reload()
+await page.waitForSelector('#tab-auto')
+await page.waitForFunction(() => document.querySelector('#auto-next').textContent !== '')
+checks['重新整理後停在自動登記分頁'] = await page.evaluate(() => !document.querySelector('#panel-auto').hidden)
+checks['設定有存起來'] = await page.isChecked('#auto-enabled')
+await page.click('#auto-list button')
+await page.waitForFunction(() => document.querySelector('#auto-list').textContent.includes('清單是空的'))
+checks['移除後清單是空的'] = true
+
+checks['沒有頁面錯誤'] = errors.length === 0
+console.log(JSON.stringify({ errors, checks }, null, 2))
+const pass = Object.values(checks).every(Boolean)
+console.log(pass ? 'PASS' : 'FAIL')
+await ctx.close()
+process.exit(pass ? 0 : 1)
```

- [ ] **Step 2: 套用並確認失敗**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t2-test.patch && git apply ../plan-patches/t2-test.patch && (cd e2e && node planner-auto.mjs)`
Expected: FAIL（逾時，頁面上還沒有 `#tab-auto`）。

- [ ] **Step 3: 實作**

建立 `../plan-patches/t2-impl.patch`：

```diff
diff --git a/src/planner.css b/src/planner.css
index ebaccde..91e8818 100644
--- a/src/planner.css
+++ b/src/planner.css
@@ -238,3 +238,11 @@ body.resizing { cursor: col-resize; user-select: none; -webkit-user-select: none
 /* 選課系統暫停（分發時段）的橫幅：訊息是選課網原文，自帶暫停時間 */
 .sys-banner { flex-basis: 100%; margin: 6px 0 0; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--error); background: color-mix(in srgb, var(--error) 10%, Canvas); font-size: 13px; }
 .sys-banner[hidden] { display: none; }
+
+/* 自動登記分頁 */
+.auto-panel h3 { margin: 14px 0 4px; font-size: 13px; color: var(--muted); }
+.auto-row { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin: 6px 0; font-size: 13px; }
+.auto-row select { max-width: 100%; }
+.auto-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; font-size: 13px; }
+.auto-list li { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; padding: 4px 8px; border: 1px solid var(--line); border-radius: 6px; }
+.auto-list li.failed { border-color: var(--error); color: var(--error); }
diff --git a/src/planner.html b/src/planner.html
index eaf6a41..4be3190 100644
--- a/src/planner.html
+++ b/src/planner.html
@@ -39,6 +39,7 @@
       <div class="pane-tabs" role="tablist" aria-label="右欄">
         <button id="tab-preview" type="button" role="tab" aria-controls="panel-preview">課表預覽</button>
         <button id="tab-filters" type="button" role="tab" aria-controls="panel-filters">篩選設定</button>
+        <button id="tab-auto" type="button" role="tab" aria-controls="panel-auto">自動登記</button>
       </div>
       <div id="panel-preview" class="pane-panel" role="tabpanel" aria-labelledby="tab-preview">
         <div id="legend" class="legend"></div>
@@ -61,6 +62,26 @@
         </section>
         <form id="filters" class="filters" autocomplete="off"></form>
       </div>
+      <div id="panel-auto" class="pane-panel auto-panel" role="tabpanel" aria-labelledby="tab-auto" hidden>
+        <p class="muted tip">加退選期間每天都要重新登記。開啟後會在指定時間自動登記清單裡的預排課程，每門課每天只送一次，失敗不重試。需要選課網保持登入，瀏覽器也要開著。</p>
+        <div class="auto-row">
+          <label><input type="checkbox" id="auto-enabled"> 每天自動登記</label>
+          <label>時間 <input type="time" id="auto-time" value="13:00"></label>
+          <button id="auto-run" type="button">立刻執行一次</button>
+          <span id="auto-next" class="muted"></span>
+        </div>
+        <p id="auto-warning" class="hint warn" hidden></p>
+        <p id="auto-message" class="hint" role="status" hidden></p>
+        <h3>清單</h3>
+        <ul id="auto-list" class="auto-list"></ul>
+        <div class="auto-row">
+          <select id="auto-course" aria-label="要加入的預排課程"></select>
+          <select id="auto-wish" aria-label="志願"></select>
+          <button id="auto-add" type="button">加入清單</button>
+        </div>
+        <h3>最近結果</h3>
+        <ul id="auto-log" class="auto-list"></ul>
+      </div>
     </section>
   </main>
   <dialog id="detail" class="detail"></dialog>
diff --git a/src/planner.js b/src/planner.js
index 0a72553..de126fe 100644
--- a/src/planner.js
+++ b/src/planner.js
@@ -15,6 +15,7 @@ import { createSplitView } from './planner/split-view.js'
 import { createCrawlBar } from './planner/crawl-bar.js'
 import { createTimetable } from './planner/timetable.js'
 import { createCourseDetail } from './planner/course-detail.js'
+import { createAutoRegister } from './planner/auto-register.js'
 
 const $ = (sel) => document.querySelector(sel)
 const VALID = new Set(ALL_SLOTS)
@@ -26,7 +27,7 @@ const state = {
   filters: { ...DEFAULT_FILTERS },
   schedule: { sources: {}, manual: [], overrides: {} },
   courseData: null,
-  paneTab: 'preview', // 右欄目前的 tab：preview（課表預覽）或 filters（篩選設定）
+  paneTab: 'preview', // 右欄目前的 tab：preview（課表預覽）、filters（篩選設定）或 auto（自動登記）
   split: undefined, // 左欄佔的寬度比例，沒調過就用預設
 }
 const addState = new Map() // 課號 -> { status: 'pending'|'choose'|'added'|'exists'|'error', ... }
@@ -35,6 +36,7 @@ let timetable = null
 let deptPicker = null
 let depTree = null
 let tabs = null
+let auto = null
 
 const courses = () => (state.courseData && state.courseData.courses) || []
 
@@ -50,7 +52,7 @@ function restore(saved) {
   if (!saved || typeof saved !== 'object') return
   if (Array.isArray(saved.selection)) state.selection = new Set(saved.selection.filter((k) => VALID.has(k)))
   if (saved.filters && typeof saved.filters === 'object') state.filters = { ...DEFAULT_FILTERS, ...saved.filters }
-  if (saved.paneTab === 'preview' || saved.paneTab === 'filters') state.paneTab = saved.paneTab
+  if (['preview', 'filters', 'auto'].includes(saved.paneTab)) state.paneTab = saved.paneTab
   if (Number.isFinite(saved.split)) state.split = saved.split
 }
 
@@ -564,6 +566,7 @@ async function init() {
     tabs: {
       preview: { tab: $('#tab-preview'), panel: $('#panel-preview') },
       filters: { tab: $('#tab-filters'), panel: $('#panel-filters') },
+      auto: { tab: $('#tab-auto'), panel: $('#panel-auto') },
     },
     initial: state.paneTab,
     onChange: (id) => {
@@ -587,6 +590,14 @@ async function init() {
     e.preventDefault()
     detail.close()
   })
+  auto = createAutoRegister($('#panel-auto'), {
+    courses: () => ((state.schedule.sources || {}).preregist || {}).courses || [],
+    onRan: async () => {
+      statusMessage = await syncStatus()
+      render()
+    },
+  })
+  auto.load()
   const crawl = createCrawlBar($('#crawl'))
   crawl.load()
   askCos({ type: 'semester' }).then((reply) => crawl.setCosSemester(reply && reply.ok ? reply.semester : null))
@@ -630,6 +641,7 @@ async function init() {
       buildFilters()
     }
     if (changes.schedule || changes.courseData) render()
+    if (changes.schedule && auto) auto.render()
   })
   render()
   checkRegStatus()
diff --git a/src/planner/auto-register.js b/src/planner/auto-register.js
new file mode 100644
index 0000000..2dd754e
--- /dev/null
+++ b/src/planner/auto-register.js
@@ -0,0 +1,127 @@
+// 當期選課的「自動登記」分頁（從原本的選課頁搬過來）。每天在指定時間自動登記清單裡的預排課程，
+// 由背景程式執行（background.js 的 auto:get／auto:set／auto:run，設定存在 storage 的 autoRegister）。
+import { timeWarning, formatRunTime, describeAutoItem, describeLogEntry } from '../lib/autoreg.js'
+
+const WISHES = [['', '不需志願序'], ['1', '第 1 志願'], ['2', '第 2 志願'], ['3', '第 3 志願'], ['4', '第 4 志願'], ['5', '第 5 志願']]
+
+async function askBackground(message) {
+  try {
+    return await chrome.runtime.sendMessage(message)
+  } catch (err) {
+    return { ok: false, detail: String(err && err.message ? err.message : err) }
+  }
+}
+
+function showHint(el, text, kind = '') {
+  el.textContent = text
+  el.classList.toggle('error', kind === 'error')
+  el.classList.toggle('warn', kind === 'warn')
+  el.hidden = !text
+}
+
+// courses()：目前的預排課程（選課網的預排紀錄，有 cos_id、cos_cname）
+// onRan()：「立刻執行一次」之後呼叫（當期選課用它重讀選課網狀態）
+export function createAutoRegister(root, { courses, onRan }) {
+  const $ = (sel) => root.querySelector(sel)
+  let cfg = { enabled: false, time: '13:00', items: [], log: [] }
+  let nextRun = null
+
+  const apply = (reply) => {
+    cfg = reply.config
+    nextRun = reply.nextRun
+    render()
+  }
+
+  async function load() {
+    const reply = await askBackground({ type: 'auto:get' })
+    if (reply && reply.ok) apply(reply)
+  }
+
+  async function save(patch) {
+    const reply = await askBackground({ type: 'auto:set', patch })
+    if (!reply || !reply.ok) return showHint($('#auto-message'), '無法儲存自動登記設定', 'error')
+    apply(reply)
+  }
+
+  function renderPickers() {
+    const select = $('#auto-course')
+    const chosen = new Set((cfg.items || []).map((i) => i.cosId))
+    const previous = select.value
+    select.replaceChildren(
+      ...courses()
+        .filter((c) => !chosen.has(String(c.cos_id)))
+        .map((c) => Object.assign(document.createElement('option'), { value: String(c.cos_id), textContent: `${c.cos_id} ${c.cos_cname}` })),
+    )
+    if (previous) select.value = previous
+    select.disabled = select.options.length === 0
+    $('#auto-add').disabled = select.options.length === 0
+  }
+
+  function listItem(text, button) {
+    const li = document.createElement('li')
+    li.append(Object.assign(document.createElement('span'), { textContent: text }))
+    if (button) li.append(button)
+    return li
+  }
+
+  function render() {
+    $('#auto-enabled').checked = Boolean(cfg.enabled)
+    $('#auto-time').value = cfg.time || '13:00'
+    $('#auto-next').textContent = cfg.enabled && nextRun ? `下次執行：${formatRunTime(nextRun)}` : '目前關閉'
+    showHint($('#auto-warning'), timeWarning(cfg.time || ''), 'warn')
+
+    const items = cfg.items || []
+    $('#auto-list').replaceChildren(
+      ...(items.length
+        ? items.map((item) => {
+            const course = courses().find((c) => String(c.cos_id) === item.cosId)
+            const remove = Object.assign(document.createElement('button'), { type: 'button', className: 'link', textContent: '移除' })
+            remove.addEventListener('click', () => save({ items: (cfg.items || []).filter((i) => i.cosId !== item.cosId) }))
+            return listItem(describeAutoItem(item, course ? course.cos_cname : ''), remove)
+          })
+        : [listItem('清單是空的，從下面選一門預排課程加入。')]),
+    )
+
+    const log = (cfg.log || []).slice(0, 5)
+    $('#auto-log').replaceChildren(
+      ...(log.length
+        ? log.map((entry) => {
+            const li = listItem(describeLogEntry(entry))
+            if ((entry.results || []).some((r) => !r.ok)) li.classList.add('failed')
+            return li
+          })
+        : [listItem('還沒有執行紀錄。')]),
+    )
+    renderPickers()
+  }
+
+  const wish = $('#auto-wish')
+  wish.replaceChildren(...WISHES.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })))
+  $('#auto-enabled').addEventListener('change', (e) => save({ enabled: e.target.checked }))
+  $('#auto-time').addEventListener('change', (e) => {
+    if (e.target.value) save({ time: e.target.value })
+  })
+  $('#auto-add').addEventListener('click', () => {
+    const cosId = $('#auto-course').value
+    if (!cosId) return
+    const course = courses().find((c) => String(c.cos_id) === cosId)
+    save({ items: [...(cfg.items || []), { cosId, wish: wish.value, title: course ? course.cos_cname : '' }] })
+  })
+  $('#auto-run').addEventListener('click', async () => {
+    const btn = $('#auto-run')
+    btn.disabled = true
+    btn.textContent = '執行中…'
+    try {
+      const reply = await askBackground({ type: 'auto:run' })
+      if (reply && reply.ok) showHint($('#auto-message'), `自動登記：${reply.entry.summary || reply.entry.note}`)
+      else showHint($('#auto-message'), '自動登記執行失敗', 'error')
+      await load()
+      await onRan()
+    } finally {
+      btn.disabled = false
+      btn.textContent = '立刻執行一次'
+    }
+  })
+
+  return { load, render }
+}
```

- [ ] **Step 4: 套用並確認通過**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t2-impl.patch && git apply ../plan-patches/t2-impl.patch && npm test && (cd e2e && node planner-auto.mjs && node planner-layout.mjs)`
Expected: 單元測試全過；兩支 E2E 都印 `PASS`。

- [ ] **Step 5: Commit**

```bash
git add src/planner/auto-register.js src/planner.html src/planner.css src/planner.js e2e/planner-auto.mjs e2e/README.md
git commit -m "當期選課：自動登記分頁（從選課頁搬過來）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 查詢結果裡的「變更採計」

**Files:**
- Create: `e2e/planner-attribution.mjs`
- Modify: `src/planner/results.js`（`renderQueryRows` 改收 handlers、變更採計按鈕與選項、`changed` 狀態）、`src/planner/course-detail.js`（傳 handlers）、`src/planner.js`（`chooseAttribution`、`pickAttribution`、`cancelAttribution`，結果卡片與詳情小卡的 ctx 各加三個 handler）、`e2e/README.md`

**Interfaces:**
- Consumes: Task 1 的 `attributionChoices`；既有 `attributionOptionsFor(course)`、`preregItem(id)`、`preregParams(cosId, option)`、`restoreParams(record)`、`askCos({ type: 'changepreregist', cosId, params, previous })` → `{ ok, result: { status: 'added'|'error', msg } }`、`needsCos`、`cosProblem`、`errorText`、`syncStatus`。
- Produces: `renderQueryRows(course, s, status, handlers)`，handlers = `{ onRegister(course, row), onChangeAttribution(course), onPickAttribution(course, option), onCancelAttribution(course) }`；`addState` 的查詢狀態多了 `choosing: 'loading'|'saving'|option[]|null`、`attrError: string`，以及新狀態 `{ status: 'changed', msg }`；CSS class `change-attribution`、`attribution-choices`。

- [ ] **Step 1: 寫失敗的 E2E**

建立 `../plan-patches/t3-test.patch`：

```diff
diff --git a/e2e/README.md b/e2e/README.md
index 392c5f7..1c2b454 100644
--- a/e2e/README.md
+++ b/e2e/README.md
@@ -22,6 +22,7 @@
 | `planner-layout.mjs` | 當期選課：全選／空堂／清除、左右分割（最小寬度、鍵盤、記住寬度）、分頁、窄視窗上下排、更新課程資料；popup 只留課表、紅線只在今天 |
 | `planner-scroll.mjs` | 當期選課：寬視窗左右兩欄各自捲動、系所搜尋按 Enter（含注音選字）沒有作用 |
 | `planner-auto.mjs` | 當期選課的自動登記分頁：加入清單、開關與時間、立刻執行一次（選課結束時不送出）、移除、記住分頁 |
+| `planner-attribution.mjs` | 查詢裡的變更採計：選修改核心、加不回去時還原、已登記的課不提供 |
 | `session-token.mjs` | 選課網權杖在 sessionStorage、開好幾個選課網分頁時挑已登入的；選課結束後改讀本學期選課結果 |
 
 每支腳本最後印 `PASS` 或 `FAIL`，失敗時結束碼是 1。截圖存在 `e2e/shots/`（不進 git）。
diff --git a/e2e/planner-attribution.mjs b/e2e/planner-attribution.mjs
new file mode 100644
index 0000000..8d3e0db
--- /dev/null
+++ b/e2e/planner-attribution.mjs
@@ -0,0 +1,157 @@
+// 當期選課「查詢」裡的「變更採計」（從選課頁搬過來）：
+// 1. 選修改成核心：先移除再用核心選單加入，預排跟著更新
+// 2. 加不回去時還原原本的預排，並說明失敗原因
+// 3. 已登記的課不提供變更（採計在登記時就定了）
+// 用法：node planner-attribution.mjs [擴充功能資料夾，預設 ..]
+import { chromium } from 'playwright-core'
+import { mkdtempSync, mkdirSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join, resolve } from 'node:path'
+
+const EXT = resolve(process.argv[2] || '..')
+const SHOTS = new URL('./shots/', import.meta.url).pathname
+mkdirSync(SHOTS, { recursive: true })
+const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'e2e-')), {
+  headless: true,
+  channel: 'chromium',
+  viewport: { width: 1400, height: 900 },
+  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
+})
+
+// 選課網的系所樹（getdep）：開課系所「應用數學系」與「核心課程」選單，結構和真的一樣是七層
+const leaf = { label: '全部', value: '*', children: [{ label: '全部年級', value: '*', children: [{ label: '全部', value: '*' }] }] }
+const TREE = [{
+  label: '學士班課程', value: 1, children: [{
+    label: '一般學士班', value: '3*', children: [
+      { label: '理學院', value: 'S', children: [{ label: '應用數學系', value: 'DEP-MATH', children: [leaf] }] },
+      { label: '學士班共同課程', value: '0C', children: [{ label: '核心課程', value: 'DEP-CORE', children: [leaf] }] },
+    ],
+  }],
+}]
+const menu = (dep, cat, college) => ({ type: 1, dep_category: cat, college_no: college, dep_uid: dep, group: '*', grade: '*', class: '*' })
+const HOME = menu('DEP-MATH', '3*', 'S')
+const HOME_ROW = { cos_id: '112304', cos_cname: '計算機概論', cos_type_code: '2', wType: 'X', wType_cname: '一般課程', GroupName: null, GroupName_E: null, category_type: null, category_cname: null, category_ename: null }
+const CORE_ROW = { cos_id: '112304', cos_cname: '計算機概論', cos_type_code: 'E', wType: 'E', wType_cname: '核心課程', GroupName: '核心課程', GroupName_E: 'Core', category_type: 'CAT-Z102', category_cname: '基本素養-量性推理', category_ename: 'Quantitative' }
+const entities = (json) => json.replace(/"/g, '&quot;')
+
+// 選課網上的預排（會隨 deletepreregist／setpreregist 改變）
+const prereg = new Map([
+  ['112304', { cos_id: '112304', cos_cname: '計算機概論', cos_time: 'W56-EC015[GF]', acy: '115', sem: '1', menu_data: entities(JSON.stringify(HOME)), cos_type_code: '2', wType: 'X', category_type: '', category_cname: null, GroupName: null }],
+  ['515044', { cos_id: '515044', cos_cname: '已登記的課', cos_time: 'F34-SC105[GF]', acy: '115', sem: '1', menu_data: entities(JSON.stringify(HOME)), cos_type_code: '2', wType: 'X', category_type: '' }],
+])
+const REGISTERED = [{ cos_id: '515044', cos_cname: '已登記的課', cos_time: 'F34-SC105[GF]', sFlag: '1', acy: '115', sem: '1', cos_credit: '3.00' }]
+let failDep = '' // 要讓 setpreregist 失敗的選單
+const writes = []
+const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
+const TOKEN = `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 8 * 3600 })}.sig`
+
+await ctx.route('https://cos.nycu.edu.tw/**', async (route) => {
+  const req = route.request()
+  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cos</title>' })
+  const path = new URL(req.url()).pathname.slice(1)
+  const p = Object.fromEntries(new URLSearchParams(req.postData() || ''))
+  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
+  if (path === 'checkreg' || path === 'checkdistribute') return json({ status: 'success', cmsg: '', emsg: '' })
+  if (path === 'getdep') return json(TREE)
+  if (path === 'preregistcourse') return json(p.dep_uid === 'DEP-MATH' ? [HOME_ROW] : p.dep_uid === 'DEP-CORE' ? [CORE_ROW] : [])
+  if (path === 'getregistrationcourselist') {
+    return json({ [p.cos_id]: { cos_id: p.cos_id, status: 'success', cmsg: '', cos_type_code: '2', wType: 'X', num_limit: '50', registered_num: '10', GroupUID: null, conflict_num: '0' } })
+  }
+  if (path === 'getpreregist') return json([...prereg.values()])
+  if (path === 'getregist') return json(REGISTERED)
+  if (path === 'deletepreregist') {
+    writes.push({ path, cos_id: p.cos_id })
+    prereg.delete(p.cos_id)
+    return json([{ status: 'success', msg: '' }])
+  }
+  if (path === 'setpreregist') {
+    const m = JSON.parse(p.menu_data)
+    writes.push({ path, cos_id: p.cos_id, dep: m.dep_uid, wType: p.wType, category_type: p.category_type })
+    if (m.dep_uid === failDep) return json([{ status: 'error', msg: '模擬選課網拒絕' }])
+    const row = m.dep_uid === 'DEP-CORE' ? CORE_ROW : HOME_ROW
+    prereg.set(p.cos_id, { cos_id: p.cos_id, cos_cname: row.cos_cname, cos_time: 'W56-EC015[GF]', acy: '115', sem: '1', menu_data: entities(p.menu_data), cos_type_code: row.cos_type_code, wType: p.wType, category_type: p.category_type, category_cname: row.category_cname, GroupName: row.GroupName })
+    return json([{ status: 'success', msg: '' }])
+  }
+  return json([])
+})
+
+let [sw] = ctx.serviceWorkers()
+if (!sw) sw = await ctx.waitForEvent('serviceworker')
+const extId = new URL(sw.url()).host
+const course = (id, name, time) => ({ id, name, ename: '', teacher: '王老師', time, credit: '3', type: '選修', dep: '應用數學系', deps: ['應用數學系'], limit: '50', brief: '', menus: [HOME], menu: HOME })
+const allSlots = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => ['y', 'z', '1', '2', '3', '4', 'n', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd'].map((p) => `${d}-${p}`))
+await sw.evaluate((data) => chrome.storage.local.set(data), {
+  courseData: { semester: '1151', updatedAt: Date.now(), courses: [course('112304', '計算機概論', 'W56-EC015[GF]'), course('515044', '已登記的課', 'F34-SC105[GF]')] },
+  schedule: {
+    sources: {
+      registered: { semester: '1151', updatedAt: Date.now(), courses: REGISTERED },
+      preregist: { semester: '1151', updatedAt: Date.now(), courses: [...prereg.values()] },
+    },
+    manual: [],
+    overrides: {},
+  },
+  planner: { selection: allSlots, filters: {}, paneTab: 'preview' },
+})
+const cos = await ctx.newPage()
+await cos.goto('https://cos.nycu.edu.tw/')
+await cos.evaluate((t) => sessionStorage.setItem('token', t), TOKEN)
+
+const errors = []
+const checks = {}
+const page = await ctx.newPage()
+page.on('pageerror', (e) => errors.push(String(e)))
+await page.goto(`chrome-extension://${extId}/src/planner.html`)
+const card = (id) => page.locator('.card', { hasText: id })
+await card('112304').waitFor()
+const query = async (id) => {
+  await card(id).getByRole('button', { name: /查詢/ }).click()
+  await card(id).locator('.query-rows').waitFor()
+}
+
+// ---- 1. 選修改成核心 ----
+await query('112304')
+checks['查詢結果顯示目前的採計'] = (await card('112304').locator('.query-row .how').textContent()) === '選修'
+await card('112304').locator('.change-attribution').click()
+await card('112304').locator('.attribution-choices').waitFor()
+const choices = await card('112304').locator('.attribution-choices button:not(.link)').evaluateAll((bs) => bs.map((b) => [b.textContent, b.disabled]))
+checks['列出兩種採計、目前那種不能選'] = JSON.stringify(choices) === JSON.stringify([['選修', true], ['核心・基本素養-量性推理', false]])
+await page.screenshot({ path: SHOTS + 'attribution-1-choices.png' })
+writes.length = 0
+await card('112304').getByRole('button', { name: '核心・基本素養-量性推理' }).click()
+await card('112304').getByText('採計已改為「核心・基本素養-量性推理」').waitFor()
+checks['先移除再用核心選單加入'] = JSON.stringify(writes) === JSON.stringify([
+  { path: 'deletepreregist', cos_id: '112304' },
+  { path: 'setpreregist', cos_id: '112304', dep: 'DEP-CORE', wType: 'E', category_type: 'CAT-Z102' },
+])
+await page.waitForFunction(async () => {
+  const { schedule } = await chrome.storage.local.get('schedule')
+  const c = schedule.sources.preregist.courses.find((x) => x.cos_id === '112304')
+  return c && c.menu_data.includes('DEP-CORE')
+})
+checks['預排跟著更新成核心'] = true
+
+// ---- 2. 加不回去時還原 ----
+await query('112304')
+checks['改完後查詢顯示核心'] = (await card('112304').locator('.query-row .how').textContent()) === '核心・基本素養-量性推理'
+await card('112304').locator('.change-attribution').click()
+await card('112304').locator('.attribution-choices').waitFor()
+failDep = 'DEP-MATH'
+writes.length = 0
+await card('112304').getByRole('button', { name: '選修' }).click()
+await card('112304').locator('.query-rows .error').waitFor()
+const err = await card('112304').locator('.query-rows .error').textContent()
+checks['失敗時說明原因並已還原'] = err.includes('模擬選課網拒絕') && err.includes('已還原原本的預排')
+checks['還原用的是原本的核心選單'] = JSON.stringify(writes.map((w) => w.dep || w.path)) === JSON.stringify(['deletepreregist', 'DEP-MATH', 'DEP-CORE'])
+checks['預排裡還是核心'] = prereg.get('112304').menu_data.includes('DEP-CORE')
+await page.screenshot({ path: SHOTS + 'attribution-2-restored.png' })
+
+// ---- 3. 已登記的課不提供變更 ----
+await query('515044')
+checks['已登記的課沒有變更採計'] = (await card('515044').locator('.change-attribution').count()) === 0
+
+checks['沒有頁面錯誤'] = errors.length === 0
+console.log(JSON.stringify({ writes, errors, checks }, null, 2))
+const pass = Object.values(checks).every(Boolean)
+console.log(pass ? 'PASS' : 'FAIL')
+await ctx.close()
+process.exit(pass ? 0 : 1)
```

- [ ] **Step 2: 套用並確認失敗**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t3-test.patch && git apply ../plan-patches/t3-test.patch && (cd e2e && node planner-attribution.mjs)`
Expected: FAIL（逾時，查詢結果裡還沒有 `.change-attribution`）。

- [ ] **Step 3: 實作**

建立 `../plan-patches/t3-impl.patch`：

```diff
diff --git a/src/planner.js b/src/planner.js
index de126fe..73cfea5 100644
--- a/src/planner.js
+++ b/src/planner.js
@@ -2,7 +2,7 @@
 import { scheduleItems, withSyncedSources } from './lib/schedule.js'
 import { courseStatuses, occupiedKinds, KIND_COLORS, KIND_LABELS } from './lib/status.js'
 import { ALL_SLOTS, freeOfSelected, findCourses, RESULT_LIMIT, CAMPUSES, CATEGORIES, SORT_OPTIONS, hasBriefData, depCounts, courseSlots, describeKeys, appliedFilters, withoutFilter, facetCounts, relaxations, appliedCount } from './lib/freeslots.js'
-import { findAttributionOptions, needsChoice, preregParams, courseDepUids, describeAttribution, restoreParams } from './lib/attribution.js'
+import { findAttributionOptions, needsChoice, preregParams, courseDepUids, describeAttribution, restoreParams, attributionChoices } from './lib/attribution.js'
 import { resolveRegInfo, describeAvailability } from './lib/register.js'
 import { createRegisterDialog } from './reg-dialog.js'
 import { findCosTab, askCos, cosProblem } from './cos-tab.js'
@@ -260,6 +260,9 @@ function drawResults() {
     onAdd: addCourse,
     onQuery: queryCourse,
     onRegister: registerCourse,
+    onChangeAttribution: chooseAttribution,
+    onPickAttribution: pickAttribution,
+    onCancelAttribution: cancelAttribution,
     onChoose: (course, option) => submitAdd(course, option),
     onCancel: (course) => {
       addState.delete(course.id)
@@ -356,6 +359,48 @@ async function queryCourse(course) {
   renderResults()
 }
 
+// ---------- 變更採計方式 ----------
+// 選課網依「從哪個選單加入預排」決定類別（例如選修或核心），要改只能移除後用新的選單加入。
+// content script 的 changepreregist 會先移除再加入，加不回去時用原本的參數還原。
+
+async function chooseAttribution(course) {
+  const s = addState.get(course.id)
+  if (!s) return
+  addState.set(course.id, { ...s, choosing: 'loading', attrError: '' })
+  renderResults()
+  try {
+    const options = attributionChoices(await attributionOptionsFor(course), preregItem(course.id))
+    const others = options.filter((o) => !o.current)
+    addState.set(course.id, { ...addState.get(course.id), choosing: others.length ? options : null, attrError: others.length ? '' : '這門課在選課網只有目前這一種採計方式' })
+  } catch (err) {
+    addState.set(course.id, { ...addState.get(course.id), choosing: null, attrError: errorText(err, '查詢採計方式失敗') })
+  }
+  renderResults()
+}
+
+async function pickAttribution(course, option) {
+  const item = preregItem(course.id)
+  if (!item) return
+  addState.set(course.id, { ...addState.get(course.id), choosing: 'saving', attrError: '' })
+  renderResults()
+  const reply = await askCos({ type: 'changepreregist', cosId: course.id, params: preregParams(course.id, option), previous: restoreParams(item) })
+  const result = reply && reply.ok ? reply.result : null
+  if (result && result.status === 'added') {
+    addState.set(course.id, { status: 'changed', msg: `採計已改為「${option.label}」` })
+  } else {
+    const msg = result ? `變更失敗：${result.msg || '未知錯誤'}` : needsCos(reply) ? '請先開啟並登入選課網' : cosProblem(reply)
+    addState.set(course.id, { ...addState.get(course.id), choosing: null, attrError: msg })
+  }
+  renderResults()
+  await syncStatus()
+}
+
+function cancelAttribution(course) {
+  const s = addState.get(course.id)
+  if (s) addState.set(course.id, { ...s, choosing: null, attrError: '' })
+  renderResults()
+}
+
 let dialog = null
 let groups = null
 
@@ -559,6 +604,9 @@ async function init() {
     queryState: (id) => addState.get(String(id)),
     onQuery: queryCourse,
     onRegister: registerCourse,
+    onChangeAttribution: chooseAttribution,
+    onPickAttribution: pickAttribution,
+    onCancelAttribution: cancelAttribution,
     onRemove: removeFromPrereg,
   })
   dialog = createRegisterDialog()
diff --git a/src/planner/course-detail.js b/src/planner/course-detail.js
index 04ac84f..225f2a6 100644
--- a/src/planner/course-detail.js
+++ b/src/planner/course-detail.js
@@ -110,7 +110,7 @@ export function createCourseDetail(dialog, ctx) {
     }
     dialog.append(actions)
     if (course) {
-      const rows = renderQueryRows(course, ctx.queryState(item.cosId), status, (c, row) => ctx.onRegister(c, row))
+      const rows = renderQueryRows(course, ctx.queryState(item.cosId), status, ctx)
       if (rows) dialog.append(rows)
     }
   }
diff --git a/src/planner/results.js b/src/planner/results.js
index 89bd7ed..b0b85d9 100644
--- a/src/planner/results.js
+++ b/src/planner/results.js
@@ -71,13 +71,14 @@ function card(hit, ctx) {
     actions.append(span('ok', s.msg))
   } else if (!s || s.status !== 'choose') {
     if (s && s.status === 'added') actions.append(span('ok', `已加入${s.note ? `・${s.note}` : ''}`))
+    if (s && s.status === 'changed') actions.append(span('ok', s.msg))
     if (s && s.status === 'error') actions.append(span('error', s.msg))
     if (!inPrereg) actions.append(button('加入預排', '加入預排（有多種採計方式時會先讓你選）', () => ctx.onAdd(course)))
     actions.append(button(s && s.status === 'queried' ? '重新查詢' : '查詢', '查詢能不能加選、人數與衝堂', () => ctx.onQuery(course)))
   }
   li.append(info, actions)
 
-  const rows = renderQueryRows(course, s, status, (c, row) => ctx.onRegister(c, row))
+  const rows = renderQueryRows(course, s, status, ctx)
   if (rows) li.append(rows)
 
   if (s && s.status === 'choose') {
@@ -103,11 +104,15 @@ function card(hit, ctx) {
   return li
 }
 
-// 查詢結果：每種採計方式一列，能選的附「加選／登記／改志願」按鈕（結果卡片與詳情小卡共用）
-export function renderQueryRows(course, s, status, onRegister) {
+// 查詢結果：每種採計方式一列，能選的附「加選／登記／改志願」按鈕（結果卡片與詳情小卡共用）。
+// 已在預排、還沒登記的課可以「變更採計」：列出其他採計方式，選了就移除再用新的選單加入（失敗會還原）。
+// handlers：{ onRegister(course, row), onChangeAttribution(course), onPickAttribution(course, option), onCancelAttribution(course) }
+export function renderQueryRows(course, s, status, handlers) {
   if (!(s && s.status === 'queried' && !(status && status.state === 'registered'))) return null
   const box = document.createElement('div')
   box.className = 'query-rows'
+  // 已登記或已選上的課，採計在登記時就定了，改預排不會改到正式選課，所以不提供
+  const canChange = !(status && (status.state === 'registered' || status.state === 'wish'))
   for (const row of s.rows) {
     const r = document.createElement('div')
     r.className = 'query-row'
@@ -121,11 +126,47 @@ export function renderQueryRows(course, s, status, onRegister) {
       b.textContent = status && status.state === 'wish' && a.needsWish ? '改志願' : ACTION_LABELS[a.action]
       b.title = row.inPrereg ? '開啟確認視窗' : '先加入預排，再開啟確認視窗'
       b.disabled = Boolean(s.busy)
-      b.addEventListener('click', () => onRegister(course, row))
+      b.addEventListener('click', () => handlers.onRegister(course, row))
       r.append(b)
     }
+    if (row.inPrereg && canChange) r.append(changeButton(course, s, handlers))
     box.append(r)
   }
+  if (Array.isArray(s.choosing)) box.append(attributionPicker(course, s.choosing, handlers))
+  if (s.attrError) box.append(span('error', s.attrError))
+  return box
+}
+
+function changeButton(course, s, handlers) {
+  const b = document.createElement('button')
+  b.type = 'button'
+  b.className = 'link change-attribution'
+  b.textContent = s.choosing === 'loading' ? '查詢採計方式…' : s.choosing === 'saving' ? '變更中…' : '變更採計'
+  b.title = '選課網依加入預排時的選單決定類別（例如選修或核心），要改只能移除後重新加入；失敗會還原'
+  b.disabled = Boolean(s.busy) || Boolean(s.choosing)
+  b.addEventListener('click', () => handlers.onChangeAttribution(course))
+  return b
+}
+
+function attributionPicker(course, options, handlers) {
+  const box = document.createElement('div')
+  box.className = 'choices attribution-choices'
+  box.append('改成：')
+  for (const option of options) {
+    const b = document.createElement('button')
+    b.type = 'button'
+    b.textContent = option.label
+    b.disabled = option.current
+    b.title = option.current ? '目前的採計方式' : `改成「${option.label}」`
+    b.addEventListener('click', () => handlers.onPickAttribution(course, option))
+    box.append(b)
+  }
+  const cancel = document.createElement('button')
+  cancel.type = 'button'
+  cancel.className = 'link'
+  cancel.textContent = '取消'
+  cancel.addEventListener('click', () => handlers.onCancelAttribution(course))
+  box.append(cancel)
   return box
 }
 
```

- [ ] **Step 4: 套用並確認通過**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t3-impl.patch && git apply ../plan-patches/t3-impl.patch && npm test && (cd e2e && node planner-attribution.mjs && node planner-layout.mjs)`
Expected: 單元測試全過；兩支 E2E 都印 `PASS`。

- [ ] **Step 5: Commit**

```bash
git add src/planner/results.js src/planner/course-detail.js src/planner.js e2e/planner-attribution.mjs e2e/README.md
git commit -m "當期選課：查詢結果可以變更採計（從選課頁搬過來）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 拿掉選課頁、改名編輯課表、README、版本 0.13.0

**Files:**
- Create: `e2e/pages.mjs`
- Delete: `src/register.html`、`src/register.css`、`src/register.js`
- Modify: `src/popup.html`、`src/popup.js`、`src/schedule.html`、`src/planner.js`（檔頭註解、圖例文字）、`src/reg-dialog.css`、`src/reg-dialog.js`、`src/cos-tab.js`、`src/lib/attribution.js`（註解）、`README.md`、`manifest.json`、`package.json`、`e2e/README.md`

**Interfaces:**
- Consumes: Task 2、3 完成的當期選課（`pages.mjs` 檢查它有三個分頁）。
- Produces: popup 頁首按鈕依序 `#btn-planner`「當期選課 ↗」、`#btn-rooms`「教室 ↗」、`#btn-schedule`「編輯課表 ↗」；版本 0.13.0。

- [ ] **Step 1: 寫失敗的 E2E**

建立 `../plan-patches/t4-test.patch`：

```diff
diff --git a/e2e/README.md b/e2e/README.md
index 1c2b454..b7e4fb3 100644
--- a/e2e/README.md
+++ b/e2e/README.md
@@ -23,6 +23,7 @@
 | `planner-scroll.mjs` | 當期選課：寬視窗左右兩欄各自捲動、系所搜尋按 Enter（含注音選字）沒有作用 |
 | `planner-auto.mjs` | 當期選課的自動登記分頁：加入清單、開關與時間、立刻執行一次（選課結束時不送出）、移除、記住分頁 |
 | `planner-attribution.mjs` | 查詢裡的變更採計：選修改核心、加不回去時還原、已登記的課不提供 |
+| `pages.mjs` | popup 頁首三個按鈕、編輯課表頁、選課頁已拿掉、當期選課三個分頁 |
 | `session-token.mjs` | 選課網權杖在 sessionStorage、開好幾個選課網分頁時挑已登入的；選課結束後改讀本學期選課結果 |
 
 每支腳本最後印 `PASS` 或 `FAIL`，失敗時結束碼是 1。截圖存在 `e2e/shots/`（不進 git）。
diff --git a/e2e/pages.mjs b/e2e/pages.mjs
new file mode 100644
index 0000000..54e70a2
--- /dev/null
+++ b/e2e/pages.mjs
@@ -0,0 +1,51 @@
+// 頁面與入口：選課頁已經拿掉（功能搬進當期選課），週課表改名「編輯課表」；popup 頁首只剩三個按鈕。
+// 用法：node pages.mjs [擴充功能資料夾，預設 ..]
+import { chromium } from 'playwright-core'
+import { mkdtempSync } from 'node:fs'
+import { tmpdir } from 'node:os'
+import { join, resolve } from 'node:path'
+
+const EXT = resolve(process.argv[2] || '..')
+const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'e2e-')), {
+  headless: true,
+  channel: 'chromium',
+  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
+})
+await ctx.route('https://cos.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))
+await ctx.route('https://timetable.nycu.edu.tw/**', (route) => route.fulfill({ status: 500, body: 'down' }))
+let [sw] = ctx.serviceWorkers()
+if (!sw) sw = await ctx.waitForEvent('serviceworker')
+const extId = new URL(sw.url()).host
+const url = (path) => `chrome-extension://${extId}/src/${path}`
+
+const errors = []
+const checks = {}
+const page = await ctx.newPage()
+page.on('pageerror', (e) => errors.push(String(e)))
+
+await page.goto(url('popup.html'))
+const buttons = await page.$$eval('.shell-actions button', (bs) => bs.map((b) => b.textContent))
+checks['popup 頁首只有當期選課、教室、編輯課表'] = JSON.stringify(buttons) === JSON.stringify(['當期選課 ↗', '教室 ↗', '編輯課表 ↗'])
+const [opened] = await Promise.all([ctx.waitForEvent('page'), page.click('#btn-schedule')])
+await opened.waitForLoadState()
+checks['編輯課表按鈕開的是課表頁'] = opened.url() === url('schedule.html')
+checks['課表頁改名編輯課表'] = (await opened.title()) === '編輯課表' && (await opened.textContent('h1')) === '編輯課表'
+checks['編輯課表仍能新增行程'] = (await opened.textContent('#btn-add')) === '新增行程'
+
+// 用另一個分頁開：開不存在的頁面後那個分頁會停在錯誤頁，不影響後面的檢查
+const probe = await ctx.newPage()
+const gone = await probe.goto(url('register.html')).then(() => false, (e) => String(e).includes('ERR_FILE_NOT_FOUND'))
+await probe.close()
+checks['選課頁已經拿掉'] = gone
+
+await page.goto(url('planner.html'))
+await page.waitForSelector('#legend span')
+checks['當期選課圖例指向編輯課表'] = (await page.textContent('#legend')).includes('在「編輯課表」新增、設定顏色')
+checks['當期選課有三個分頁'] = JSON.stringify(await page.$$eval('.pane-tabs [role="tab"]', (ts) => ts.map((t) => t.textContent.replace(/ \(\d+\)$/, '')))) === JSON.stringify(['課表預覽', '篩選設定', '自動登記'])
+
+checks['沒有頁面錯誤'] = errors.length === 0
+console.log(JSON.stringify({ buttons, errors, checks }, null, 2))
+const pass = Object.values(checks).every(Boolean)
+console.log(pass ? 'PASS' : 'FAIL')
+await ctx.close()
+process.exit(pass ? 0 : 1)
```

- [ ] **Step 2: 套用並確認失敗**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t4-test.patch && git apply ../plan-patches/t4-test.patch && (cd e2e && node pages.mjs)`
Expected: FAIL（popup 還有「選課 ↗」、按鈕還叫「週課表 ↗」、`register.html` 還在）。

- [ ] **Step 3: 刪掉選課頁**

Run: `git rm -q src/register.html src/register.css src/register.js`

- [ ] **Step 4: 其他修改**

建立 `../plan-patches/t4-impl.patch`：

```diff
diff --git a/README.md b/README.md
index e758c84..3247765 100644
--- a/README.md
+++ b/README.md
@@ -48,7 +48,7 @@ GitHub 版不會自動更新。有新版時：
 - 只列有課的節次，今天那一欄會加深，紅線是現在時間（只畫在今天那一欄）。
 - 點一堂課可以看完整資訊，開啟你設定的連結（例如 E3）或課程大綱。
 - 課表不會自動更新。選課結果有變時，開著已登入的選課網，按課表下方的「從選課網更新」。過了選課期選課網不能登入也沒關係，課表會一直保留上次的內容。
-- 上方的按鈕可以開「當期選課」「週課表」「選課」頁。找課、加入預排、更新課程資料都在「當期選課」。
+- 上方的按鈕可以開「當期選課」「教室」「編輯課表」頁。找課、加入預排、正式選課、自動登記、更新課程資料都在「當期選課」。
 
 ### 第一次使用：下載課程資料
 
@@ -78,11 +78,11 @@ GitHub 版不會自動更新。有新版時：
 
 2026 年 9 月整理全校課程時，大約每 30 門有 1 門有兩種採計方式，沒有超過兩種的；另一種幾乎都是核心課程，少數是語言與溝通。
 
-加錯了可以到「選課」頁，在課名下方的「採計」旁按「變更」。
+加錯了可以在「當期選課」對那門課按「查詢」，查詢結果裡有「變更採計」，選另一種就會改過來（選課網要先移除再重新加入，失敗會還原原本的）。已登記或已選上的課，採計在登記時就定了，不提供變更。
 
-### 我的課表
+### 編輯課表
 
-點擴充功能圖示上方的「週課表 ↗」，會開啟完整的週課表頁。
+點擴充功能圖示上方的「編輯課表 ↗」，可以新增私人行程、幫課程設定連結與顏色，也能看完整的週課表。
 
 1. 先在選課網分頁登入，回到課表分頁按「從選課網同步」。
 2. 上方可以切換「正式選課」「預排課程」「全部」。
@@ -97,7 +97,7 @@ GitHub 版不會自動更新。有新版時：
 
 ### 當期選課
 
-點擴充功能圖示上方的「當期選課 ↗」，打開當期選課頁。左邊是搜尋結果，右邊有兩個分頁：「課表預覽」和「篩選設定」。中間的分隔線可以左右拖曳調整寬度（兩邊都有最小寬度，雙擊回到預設）；視窗太窄時會改成上下排。
+點擴充功能圖示上方的「當期選課 ↗」，打開當期選課頁。左邊是搜尋結果，右邊有三個分頁：「課表預覽」「篩選設定」和「自動登記」。中間的分隔線可以左右拖曳調整寬度（兩邊都有最小寬度，雙擊回到預設）；視窗太窄時會改成上下排。
 
 1. 「篩選設定」分頁：
    - **時段**：在格子上按住拖曳框選想上課的時段，或按「全選」「空堂」「清除」。「空堂」是扣掉已選上的課以外的所有時段（已登記、預排、私人行程都算空堂）。
@@ -119,6 +119,14 @@ GitHub 版不會自動更新。有新版時：
    - **有人數上限**的課是「登記」，送出後是已登記，要等分發。
    - **志願序**課程是「登記」，要選第幾志願。狀態會在你加入、加選、登記後自動更新，也可以按上方「從選課網更新狀態」。
 
+#### 每日自動登記
+
+加退選期間每天都要重新登記。在當期選課右邊的「自動登記」分頁：
+
+1. 從下拉選單選一門預排課程，有志願序的選第幾志願，按「加入清單」。
+2. 勾「每天自動登記」並設定時間。每門課每天只送一次，失敗不重試；選課網要保持登入，瀏覽器也要開著。
+3. 想馬上試，按「立刻執行一次」。下面「最近結果」會列出每次執行的結果；選課系統暫停或選課結束時不會送出任何東西，只會記下學校的說明。
+
 ### 教室查詢
 
 點擴充功能圖示上方的「教室 ↗」。
diff --git a/manifest.json b/manifest.json
index 39716d4..0c6666d 100644
--- a/manifest.json
+++ b/manifest.json
@@ -1,7 +1,7 @@
 {
   "manifest_version": 3,
   "name": "NYCU 預排課程匯入",
-  "version": "0.12.0",
+  "version": "0.13.0",
   "description": "搜尋與規劃陽明交大課程：找空堂、加入預排與正式選課，並提供課表與每日自動登記。",
   "icons": {
     "16": "icons/icon16.png",
diff --git a/package.json b/package.json
index d51d904..94905ce 100644
--- a/package.json
+++ b/package.json
@@ -1,6 +1,6 @@
 {
   "name": "nycucourse-extension",
-  "version": "0.12.0",
+  "version": "0.13.0",
   "private": true,
   "type": "module",
   "scripts": {
diff --git a/src/cos-tab.js b/src/cos-tab.js
index b3e26f8..2e804e9 100644
--- a/src/cos-tab.js
+++ b/src/cos-tab.js
@@ -1,4 +1,4 @@
-// 完整頁面（選課頁、當期選課頁）與選課網分頁溝通：找一個已開啟的選課網分頁，經由 content script 送訊息
+// 完整頁面（當期選課、編輯課表）與選課網分頁溝通：找一個已開啟的選課網分頁，經由 content script 送訊息
 
 // 選課網改版後每個分頁各自登入（權杖在 sessionStorage），所以要問過每個分頁：
 // 優先挑已登入的；都沒登入就挑 content script 有回應的（之後才講得出「請先登入」）；再不然第一個。
diff --git a/src/lib/attribution.js b/src/lib/attribution.js
index ff1edf6..8e988ce 100644
--- a/src/lib/attribution.js
+++ b/src/lib/attribution.js
@@ -221,7 +221,7 @@ export function defaultOption(options) {
   return (options && options[0]) || null
 }
 
-// 預排資料目前的採計方式，給選課頁顯示
+// 預排資料目前的採計方式，給當期選課的查詢結果顯示
 export function describeAttribution(item) {
   const raw = str(item && item.menu_data).replace(/&quot;/g, '"').trim()
   let menu = null
diff --git a/src/planner.js b/src/planner.js
index 73cfea5..9285fce 100644
--- a/src/planner.js
+++ b/src/planner.js
@@ -1,4 +1,4 @@
-// 當期選課頁（目前只有「找空堂課程」）。狀態：選取的時段與篩選條件，存在 storage 的 planner。
+// 當期選課頁：找課、加入預排、查詢／加選／登記、變更採計、自動登記。狀態（時段、篩選、分頁、寬度）存在 storage 的 planner。
 import { scheduleItems, withSyncedSources } from './lib/schedule.js'
 import { courseStatuses, occupiedKinds, KIND_COLORS, KIND_LABELS } from './lib/status.js'
 import { ALL_SLOTS, freeOfSelected, findCourses, RESULT_LIMIT, CAMPUSES, CATEGORIES, SORT_OPTIONS, hasBriefData, depCounts, courseSlots, describeKeys, appliedFilters, withoutFilter, facetCounts, relaxations, appliedCount } from './lib/freeslots.js'
@@ -512,7 +512,7 @@ function renderLegend(legend) {
       const dot = document.createElement('i')
       dot.style.background = KIND_COLORS[kind]
       const mark = { registered: '✓ ', wish: '①登 ', preregist: '預 ', manual: '' }[kind]
-      item.append(dot, `${mark}${label}`, kind === 'manual' ? '（顏色可在課表頁設定）' : '')
+      item.append(dot, `${mark}${label}`, kind === 'manual' ? '（在「編輯課表」新增、設定顏色）' : '')
       return item
     }),
   )
diff --git a/src/popup.html b/src/popup.html
index 013d007..0170a78 100644
--- a/src/popup.html
+++ b/src/popup.html
@@ -11,8 +11,7 @@
     <span class="shell-actions">
       <button id="btn-planner" type="button" title="開啟當期選課">當期選課 ↗</button>
       <button id="btn-rooms" type="button" title="開啟教室查詢">教室 ↗</button>
-      <button id="btn-schedule" type="button" title="開啟完整週課表">週課表 ↗</button>
-      <button id="btn-register" type="button" title="開啟選課頁">選課 ↗</button>
+      <button id="btn-schedule" type="button" title="新增私人行程、設定課程連結與顏色">編輯課表 ↗</button>
     </span>
   </header>
   <main id="week">
@@ -20,7 +19,7 @@
     <div class="detail" hidden></div>
     <p class="empty" hidden>
       還沒有正式選課。
-      <button type="button" data-action="open-schedule">看預排課表 ↗</button>
+      <button type="button" data-action="open-schedule">編輯課表 ↗</button>
       <button type="button" data-action="sync">從選課網同步</button>
     </p>
     <p class="updated"><span class="updated-at"></span><button type="button" class="link" data-action="sync">從選課網更新</button></p>
diff --git a/src/popup.js b/src/popup.js
index 155988f..3b74ec1 100644
--- a/src/popup.js
+++ b/src/popup.js
@@ -1,4 +1,4 @@
-// popup 只放課表：開學後點開看一眼就關掉。其他功能（找課、加入預排、更新課程資料）在當期選課頁。
+// popup 只放課表：開學後點開看一眼就關掉。其他功能（找課、加入預排、正式選課、自動登記、更新課程資料）在當期選課頁。
 import { mount } from './popup/schedule.js'
 
 function openPage(path) {
@@ -8,5 +8,4 @@ function openPage(path) {
 document.getElementById('btn-planner').addEventListener('click', () => openPage('src/planner.html'))
 document.getElementById('btn-rooms').addEventListener('click', () => openPage('src/rooms.html'))
 document.getElementById('btn-schedule').addEventListener('click', () => openPage('src/schedule.html'))
-document.getElementById('btn-register').addEventListener('click', () => openPage('src/register.html'))
 mount(document.getElementById('week'))
diff --git a/src/reg-dialog.css b/src/reg-dialog.css
index 2fe0709..435990c 100644
--- a/src/reg-dialog.css
+++ b/src/reg-dialog.css
@@ -1,4 +1,4 @@
-/* 加選／登記確認視窗（reg-dialog.js），選課頁與當期選課頁共用 */
+/* 加選／登記確認視窗（reg-dialog.js），當期選課頁用 */
 .reg-dialog { min-width: 460px; max-width: 560px; border: 1px solid rgba(127, 127, 127, .35); border-radius: 12px; padding: 18px 20px; }
 .reg-dialog::backdrop { background: rgba(0, 0, 0, .35); }
 .reg-dialog h2 { margin: 0 0 10px; font-size: 16px; }
diff --git a/src/reg-dialog.js b/src/reg-dialog.js
index 2c35ac6..9a000bc 100644
--- a/src/reg-dialog.js
+++ b/src/reg-dialog.js
@@ -1,4 +1,4 @@
-// 加選／登記的確認視窗，選課頁與當期選課頁共用。只有使用者按「送出加選／送出登記」才會送出。
+// 加選／登記的確認視窗（當期選課頁用）。只有使用者按「送出加選／送出登記」才會送出。
 // 按鈕寫出具體動作、不預設焦點在送出（NN/g 確認視窗準則）。
 import { wishOptions, wishLimitReached, registerParams, parseRegResult, ACTION_LABELS } from './lib/register.js'
 
diff --git a/src/schedule.html b/src/schedule.html
index 43da5dc..0b1e9d5 100644
--- a/src/schedule.html
+++ b/src/schedule.html
@@ -2,12 +2,12 @@
 <html lang="zh-Hant">
 <head>
   <meta charset="utf-8">
-  <title>我的課表</title>
+  <title>編輯課表</title>
   <link rel="stylesheet" href="schedule.css">
 </head>
 <body>
   <header class="bar">
-    <h1>我的課表</h1>
+    <h1>編輯課表</h1>
     <div class="bar-right">
       <div class="tabs" id="source-tabs" role="tablist">
         <button type="button" data-source="registered" role="tab">正式選課</button>
```

- [ ] **Step 5: 套用並確認全部通過**

Run: `python3 ~/.cache/plan-tools/from-plan.py $PLAN ../plan-patches/t4-impl.patch && git apply ../plan-patches/t4-impl.patch && grep -rn "register.html" src ; npm test && (cd e2e && npm test)`
Expected: `grep` 沒有輸出；單元測試 287 個全過；E2E 七支（`pages`、`planner-attribution`、`planner-auto`、`planner-layout`、`planner-scroll`、`rooms`、`session-token`）全部 `PASS`。

- [ ] **Step 6: Commit**

```bash
git add -A src README.md manifest.json package.json e2e/pages.mjs e2e/README.md
git commit -m "0.13.0：拿掉選課頁，週課表改名編輯課表

- 選課頁的功能都在當期選課：自動登記分頁、查詢裡的變更採計
- popup 頁首只剩當期選課、教室、編輯課表
- README 更新

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 清掉 patch 暫存檔**

Run: `rm -rf ../plan-patches`
