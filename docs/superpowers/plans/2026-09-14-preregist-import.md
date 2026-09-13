# 預排匯入擴充功能（第一階段）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使用者在 popup 貼上課號後，擴充功能把這些課加入 cos.nycu.edu.tw 的預排課程並回報結果。

**Architecture:** popup 解析課號，透過 `chrome.tabs.sendMessage` 交給只注入 `cos.nycu.edu.tw` 的 content script；content script 用頁面 `localStorage.token` 依序呼叫 `setpreregist`，再用 `getpreregist` 確認，回傳分類後的結果，最後重新整理頁面。解析與分類是純函式，放在 `src/lib/`，用 Node 內建 test runner 測。

**Tech Stack:** Chrome Manifest V3、純 ES module JavaScript、Node 26 `node --test`、無打包工具。

**Spec:** `docs/superpowers/specs/2026-09-14-preregist-import-design.md`

## Global Constraints

- Manifest V3；`permissions` 只有 `activeTab`；`host_permissions` 只有 `https://cos.nycu.edu.tw/*`。不申請 `storage`。
- 沒有 background service worker。
- 介面文字只做中文。
- 課號固定六位數字 `^\d{6}$`；接受並去除 `\d{4}_` 前綴。
- API 呼叫串行，不並發。
- commit 訊息用中文，結尾附 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`。

---

## File Structure

```
manifest.json          擴充功能宣告
package.json           只有 "test": "node --test" 與 "type": "module"
src/lib/parse.js       parseIds、findInvalidTokens（純函式）
src/lib/classify.js    classifyResult、confirmWithList（純函式）
src/content.js         在選課網頁面內呼叫 API，回覆 popup 訊息
src/popup.html         popup 版面
src/popup.css          popup 樣式
src/popup.js           popup 邏輯：分頁檢查、送訊息、顯示結果
icons/icon16.png, icon48.png, icon128.png
scripts/make-icons.sh  由 icons/icon.svg 產生 PNG
scripts/pack.sh        打包 dist/extension.zip
store/description.md   商店說明
store/privacy.md       隱私聲明
test/parse.test.js
test/classify.test.js
README.md
```

content script 不能用 ES module import（MV3 content_scripts 不支援 `type: module`），所以 `classify.js` 的兩個函式在 `content.js` 內以 `importScripts` 不可行；改用「`content.js` 用 `import()` 動態載入 `chrome.runtime.getURL('src/lib/classify.js')`」，並在 manifest 的 `web_accessible_resources` 開放 `src/lib/*.js` 給 `https://cos.nycu.edu.tw/*`。popup 是普通頁面，直接 `<script type="module">`。

---

### Task 1: 專案骨架與 parse.js

**Files:**
- Create: `package.json`, `.gitignore`, `src/lib/parse.js`, `test/parse.test.js`

**Interfaces:**
- Produces: `parseIds(text: string): string[]`（去重、保序、只含六位數字課號）；`findInvalidTokens(text: string): string[]`（切開後不符合格式的原始字串，去重）。

- [ ] **Step 1: 建立 package.json 與 .gitignore**

`package.json`：
```json
{
  "name": "nycucourse-extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test"
  }
}
```

`.gitignore`：
```
dist/
node_modules/
.DS_Store
```

- [ ] **Step 2: 寫失敗的測試 `test/parse.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIds, findInvalidTokens } from '../src/lib/parse.js'

test('逗號、空白、換行、分號都能分隔', () => {
  assert.deepEqual(parseIds('516702, 516703\n515005;515117 563018'), ['516702', '516703', '515005', '515117', '563018'])
})

test('去掉助手格式的學期前綴', () => {
  assert.deepEqual(parseIds('1151_516702 1143_516703'), ['516702', '516703'])
})

test('去重並保留順序', () => {
  assert.deepEqual(parseIds('516703 516702 516703'), ['516703', '516702'])
})

test('非六位數字被忽略', () => {
  assert.deepEqual(parseIds('51670 5167022 abc 516702'), ['516702'])
})

test('空字串回空陣列', () => {
  assert.deepEqual(parseIds(''), [])
  assert.deepEqual(parseIds('  \n '), [])
})

test('findInvalidTokens 回傳不合格式的原始字串', () => {
  assert.deepEqual(findInvalidTokens('516702 abc 51670 1151_516703 5167022'), ['abc', '51670', '5167022'])
})

test('findInvalidTokens 去重', () => {
  assert.deepEqual(findInvalidTokens('abc abc'), ['abc'])
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd /Users/engel/nycucourse-extension && npm test`
Expected: FAIL，錯誤為找不到 `../src/lib/parse.js`。

- [ ] **Step 4: 實作 `src/lib/parse.js`**

```js
const SEPARATOR = /[\s,;，；]+/
const SEMESTER_PREFIX = /^\d{4}_/
const COURSE_ID = /^\d{6}$/

function tokens(text) {
  return String(text ?? '').split(SEPARATOR).filter(Boolean)
}

function normalize(token) {
  return token.replace(SEMESTER_PREFIX, '')
}

export function parseIds(text) {
  const seen = new Set()
  const out = []
  for (const token of tokens(text)) {
    const id = normalize(token)
    if (!COURSE_ID.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

export function findInvalidTokens(text) {
  const seen = new Set()
  const out = []
  for (const token of tokens(text)) {
    if (COURSE_ID.test(normalize(token)) || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm test`
Expected: 7 個測試 pass。

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore src/lib/parse.js test/parse.test.js
git commit -m "新增課號解析函式與測試

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: classify.js

**Files:**
- Create: `src/lib/classify.js`, `test/classify.test.js`

**Interfaces:**
- Produces: `classifyResult(id: string, responseText: string): {id, status: 'added'|'exists'|'error', msg: string}`；`confirmWithList(results: Result[], preregistIds: string[]): Result[]`（回新陣列，不改原物件）。
- Consumed by: Task 3 `content.js`。

- [ ] **Step 1: 寫失敗的測試 `test/classify.test.js`**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyResult, confirmWithList } from '../src/lib/classify.js'

test('空回應代表成功加入', () => {
  assert.deepEqual(classifyResult('516702', ''), { id: '516702', status: 'added', msg: '' })
})

test('重複預選歸類為 exists', () => {
  const body = JSON.stringify([{ status: 'error', msg: '重複預選' }])
  assert.deepEqual(classifyResult('563018', body), { id: '563018', status: 'exists', msg: '重複預選' })
})

test('其他錯誤歸類為 error 並附訊息', () => {
  const body = JSON.stringify([{ status: 'error', msg: '選課預選失敗' }])
  assert.deepEqual(classifyResult('999999', body), { id: '999999', status: 'error', msg: '選課預選失敗' })
})

test('無法解析的回應歸類為 error', () => {
  const r = classifyResult('516702', '<html>Service Unavailable</html>')
  assert.equal(r.status, 'error')
  assert.equal(r.msg, '無法解析選課網回應')
})

test('confirmWithList 把未出現在清單的 added 改成 error', () => {
  const results = [
    { id: '516702', status: 'added', msg: '' },
    { id: '516703', status: 'added', msg: '' },
    { id: '999999', status: 'error', msg: '選課預選失敗' },
  ]
  const out = confirmWithList(results, ['516702', '563018'])
  assert.deepEqual(out, [
    { id: '516702', status: 'added', msg: '' },
    { id: '516703', status: 'error', msg: '加入後未出現在預排清單' },
    { id: '999999', status: 'error', msg: '選課預選失敗' },
  ])
  assert.equal(results[1].status, 'added')
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm test`
Expected: classify 相關測試 FAIL，找不到模組。

- [ ] **Step 3: 實作 `src/lib/classify.js`**

```js
export function classifyResult(id, responseText) {
  const text = String(responseText ?? '').trim()
  if (text === '') return { id, status: 'added', msg: '' }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { id, status: 'error', msg: '無法解析選課網回應' }
  }
  const first = Array.isArray(parsed) ? parsed[0] : parsed
  const msg = first && typeof first.msg === 'string' ? first.msg : ''
  if (first && first.status === 'success') return { id, status: 'added', msg }
  if (msg === '重複預選') return { id, status: 'exists', msg }
  return { id, status: 'error', msg: msg || '未知錯誤' }
}

export function confirmWithList(results, preregistIds) {
  const present = new Set(preregistIds)
  return results.map((r) => {
    if (r.status === 'added' && !present.has(r.id)) {
      return { ...r, status: 'error', msg: '加入後未出現在預排清單' }
    }
    return { ...r }
  })
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm test`
Expected: 12 個測試 pass。

- [ ] **Step 5: Commit**

```bash
git add src/lib/classify.js test/classify.test.js
git commit -m "新增預排回應分類函式與測試

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: manifest.json、圖示與 content.js

**Files:**
- Create: `manifest.json`, `icons/icon.svg`, `scripts/make-icons.sh`, `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`, `src/content.js`

**Interfaces:**
- Consumes: `classifyResult`、`confirmWithList`（Task 2）。
- Produces: content script 訊息協定：
  - 收 `{type:'import', ids:string[]}` → 回 `{ok:true, results:Result[]}` 或 `{ok:false, reason:'not_logged_in'|'network', detail?:string}`。
  - 收 `{type:'ping'}` → 回 `{ok:true}`。
  - 收 `{type:'reload'}` → 執行 `location.reload()`，回 `{ok:true}`。

- [ ] **Step 1: 建立 `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "NYCU 預排課程匯入",
  "version": "0.1.0",
  "description": "貼上課號，一鍵加入陽明交大選課系統的預排課程。",
  "default_locale": null,
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_popup": "src/popup.html",
    "default_title": "NYCU 預排課程匯入"
  },
  "permissions": ["activeTab"],
  "host_permissions": ["https://cos.nycu.edu.tw/*"],
  "content_scripts": [
    {
      "matches": ["https://cos.nycu.edu.tw/*"],
      "js": ["src/content.js"],
      "run_at": "document_idle"
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["src/lib/classify.js"],
      "matches": ["https://cos.nycu.edu.tw/*"]
    }
  ]
}
```

注意：把 `"default_locale": null` 那行刪掉，Chrome 不接受 null；上面只是提醒不要加 locale。最終檔案不含該行。

- [ ] **Step 2: 建立圖示**

`icons/icon.svg`：
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="24" fill="#1f6feb"/>
  <rect x="28" y="30" width="72" height="68" rx="8" fill="#ffffff"/>
  <rect x="28" y="30" width="72" height="16" rx="8" fill="#dbe7ff"/>
  <rect x="40" y="56" width="14" height="10" fill="#1f6feb"/>
  <rect x="57" y="56" width="14" height="10" fill="#9ec0ff"/>
  <rect x="74" y="56" width="14" height="10" fill="#9ec0ff"/>
  <rect x="40" y="72" width="14" height="10" fill="#9ec0ff"/>
  <rect x="57" y="72" width="14" height="10" fill="#1f6feb"/>
  <path d="M88 68 l8 8 l14 -16" stroke="#16a34a" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

`scripts/make-icons.sh`：
```bash
#!/usr/bin/env bash
# 需要 macOS 內建的 qlmanage 與 sips；其他平台可改用 rsvg-convert。
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
qlmanage -t -s 128 -o "$tmp" icons/icon.svg >/dev/null 2>&1
mv "$tmp/icon.svg.png" icons/icon128.png
for s in 48 16; do
  sips -z "$s" "$s" icons/icon128.png --out "icons/icon$s.png" >/dev/null
done
rm -rf "$tmp"
echo "icons generated"
```

Run: `chmod +x scripts/make-icons.sh && scripts/make-icons.sh && file icons/icon*.png`
Expected: 三個 PNG，尺寸 16、48、128。若 `qlmanage` 產出的檔名不同，用 `ls "$tmp"` 查看後調整。

- [ ] **Step 3: 實作 `src/content.js`**

```js
// 只在 https://cos.nycu.edu.tw/* 執行。所有 API 呼叫都是同源，帶頁面的 Bearer token。
const BASE = 'https://cos.nycu.edu.tw/'

let classifyModule = null
async function lib() {
  if (!classifyModule) {
    classifyModule = await import(chrome.runtime.getURL('src/lib/classify.js'))
  }
  return classifyModule
}

function token() {
  return localStorage.getItem('token') || ''
}

async function post(path, params) {
  const body = new URLSearchParams(params).toString()
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Bearer ' + token(),
    },
    body,
  })
  return res.text()
}

async function addOne(id) {
  return post('setpreregist', {
    cos_id: id,
    menu_data: '{}',
    wType: 'X',
    GroupName: 'null',
    GroupName_E: 'null',
    category_type: '',
    category_cname: 'null',
    category_ename: 'null',
  })
}

async function currentPreregistIds() {
  const text = await post('getpreregist', {})
  const list = JSON.parse(text)
  return Array.isArray(list) ? list.map((c) => String(c.cos_id)) : []
}

async function importIds(ids) {
  if (!token()) return { ok: false, reason: 'not_logged_in' }
  const { classifyResult, confirmWithList } = await lib()
  const results = []
  try {
    for (const id of ids) {
      const text = await addOne(id)
      results.push(classifyResult(id, text))
    }
    const present = await currentPreregistIds()
    return { ok: true, results: confirmWithList(results, present) }
  } catch (err) {
    return { ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false
  if (message.type === 'ping') {
    sendResponse({ ok: true })
    return false
  }
  if (message.type === 'reload') {
    sendResponse({ ok: true })
    setTimeout(() => location.reload(), 100)
    return false
  }
  if (message.type === 'import') {
    importIds(Array.isArray(message.ids) ? message.ids : []).then(sendResponse)
    return true
  }
  return false
})
```

- [ ] **Step 4: 手動確認 content script 會載入**

1. Chrome 開 `chrome://extensions`，開右上角「開發人員模式」，「載入未封裝項目」選 `/Users/engel/nycucourse-extension`。
2. 若 manifest 有錯，這裡會直接顯示錯誤，修到能載入為止。
3. 開 `https://cos.nycu.edu.tw/#/emulator`，重新整理，DevTools Console 執行 `chrome.runtime` 應為 `undefined`（頁面看不到擴充功能是正常的）；改在 `chrome://extensions` 該項目的「檢查檢視畫面」看不到 content script，改用下一個 Task 的 popup 驗證即可。

- [ ] **Step 5: Commit**

```bash
git add manifest.json icons scripts/make-icons.sh src/content.js
git commit -m "新增 manifest、圖示與選課網 content script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: popup

**Files:**
- Create: `src/popup.html`, `src/popup.css`, `src/popup.js`

**Interfaces:**
- Consumes: `parseIds`、`findInvalidTokens`（Task 1）；content script 訊息協定（Task 3）。

- [ ] **Step 1: 建立 `src/popup.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>NYCU 預排課程匯入</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h1>NYCU 預排課程匯入</h1>

  <section id="view-open" hidden>
    <p>請先開啟陽明交大選課系統的預排課程頁面。</p>
    <button id="btn-open" type="button">開啟選課網</button>
  </section>

  <section id="view-import" hidden>
    <label for="ids">課號（用逗號、空白或換行分隔）</label>
    <textarea id="ids" rows="5" placeholder="例如：516702, 516703&#10;也接受 1151_516702"></textarea>
    <button id="btn-import" type="button">加入預排</button>
    <p id="hint" class="hint" hidden></p>
    <div id="results" hidden>
      <div class="group" id="group-added" hidden><h2>成功加入</h2><ul></ul></div>
      <div class="group" id="group-exists" hidden><h2>原本就在預排</h2><ul></ul></div>
      <div class="group" id="group-error" hidden><h2>失敗</h2><ul></ul></div>
      <div class="group" id="group-invalid" hidden><h2>看不懂的輸入</h2><ul></ul></div>
    </div>
  </section>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: 建立 `src/popup.css`**

```css
:root { color-scheme: light dark; }
body {
  width: 320px;
  margin: 0;
  padding: 12px 14px 14px;
  font: 14px/1.5 -apple-system, "PingFang TC", "Noto Sans TC", system-ui, sans-serif;
}
h1 { font-size: 16px; margin: 0 0 10px; }
h2 { font-size: 13px; margin: 10px 0 4px; }
label { display: block; margin-bottom: 4px; }
textarea {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  padding: 6px;
  resize: vertical;
}
button {
  margin-top: 8px;
  padding: 6px 12px;
  font: inherit;
  cursor: pointer;
}
button:disabled { cursor: default; opacity: .6; }
.hint { margin: 8px 0 0; }
.hint.error { color: #c62828; }
ul { margin: 0; padding-left: 18px; }
li code { font-family: ui-monospace, Menlo, monospace; }
.group-error li { color: #c62828; }
```

- [ ] **Step 3: 建立 `src/popup.js`**

```js
import { parseIds, findInvalidTokens } from './lib/parse.js'

const COS_ORIGIN = 'https://cos.nycu.edu.tw/'
const EMULATOR_URL = 'https://cos.nycu.edu.tw/#/emulator'

const $ = (sel) => document.querySelector(sel)
const viewOpen = $('#view-open')
const viewImport = $('#view-import')
const textarea = $('#ids')
const btnImport = $('#btn-import')
const hint = $('#hint')
const results = $('#results')

function showHint(text, isError = false) {
  hint.textContent = text
  hint.classList.toggle('error', isError)
  hint.hidden = !text
}

function fillGroup(key, items, render) {
  const group = $(`#group-${key}`)
  const ul = group.querySelector('ul')
  ul.replaceChildren()
  for (const item of items) {
    const li = document.createElement('li')
    li.append(...render(item))
    ul.append(li)
  }
  group.hidden = items.length === 0
}

function code(text) {
  const el = document.createElement('code')
  el.textContent = text
  return el
}

function renderResults(list, invalid) {
  const by = (status) => list.filter((r) => r.status === status)
  fillGroup('added', by('added'), (r) => [code(r.id)])
  fillGroup('exists', by('exists'), (r) => [code(r.id)])
  fillGroup('error', by('error'), (r) => [code(r.id), ` ${r.msg}`])
  fillGroup('invalid', invalid, (t) => [code(t)])
  results.hidden = false
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

function send(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message)
}

async function onImport(tab) {
  const text = textarea.value
  const ids = parseIds(text)
  const invalid = findInvalidTokens(text)
  results.hidden = true
  if (ids.length === 0) {
    showHint('沒有可用的課號。課號是六位數字，例如 516702。', true)
    return
  }
  btnImport.disabled = true
  showHint(`正在加入 ${ids.length} 門課…`)
  let reply
  try {
    reply = await send(tab.id, { type: 'import', ids })
  } catch {
    showHint('無法連到選課網頁面，請重新整理該分頁後再試。', true)
    btnImport.disabled = false
    return
  }
  btnImport.disabled = false
  if (!reply || !reply.ok) {
    if (reply && reply.reason === 'not_logged_in') showHint('請先登入選課網。', true)
    else showHint(`選課網回應失敗：${(reply && reply.detail) || '未知錯誤'}`, true)
    return
  }
  showHint('完成，選課網頁面已重新整理。')
  renderResults(reply.results, invalid)
  try { await send(tab.id, { type: 'reload' }) } catch {}
}

async function init() {
  const tab = await activeTab()
  const onCos = Boolean(tab && tab.url && tab.url.startsWith(COS_ORIGIN))
  viewOpen.hidden = onCos
  viewImport.hidden = !onCos
  $('#btn-open').addEventListener('click', () => chrome.tabs.create({ url: EMULATOR_URL }))
  if (!onCos) return
  try {
    await send(tab.id, { type: 'ping' })
  } catch {
    showHint('擴充功能尚未在此頁面載入，請重新整理選課網分頁。', true)
    btnImport.disabled = true
    return
  }
  btnImport.addEventListener('click', () => onImport(tab))
}

init()
```

- [ ] **Step 4: 手動端對端測試**

1. `chrome://extensions` 對本擴充功能按「重新載入」，然後重新整理 `https://cos.nycu.edu.tw/#/emulator` 分頁。
2. 在非選課網分頁點擴充功能圖示：只看到「開啟選課網」按鈕，點了會開新分頁到預排頁。
3. 在選課網分頁點圖示，貼上 `515600, 110034 999999 1151_563018 abc`，按「加入預排」。
   預期：成功加入 `515600`、`110034`；原本就在預排 `563018`；失敗 `999999 選課預選失敗`；看不懂的輸入 `abc`。頁面自動重新整理，預排清單出現 無人機自動飛航 與 計算機概論。
4. 在選課網介面把 `515600`、`110034` 移出預排，還原狀態。
5. 登出選課網後再試一次：預期提示「請先登入選課網」。（token 在登出時會被清掉；若沒清，略過此項並記錄。）

- [ ] **Step 5: Commit**

```bash
git add src/popup.html src/popup.css src/popup.js
git commit -m "新增 popup：貼上課號並加入預排

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 打包腳本、商店材料與 README

**Files:**
- Create: `scripts/pack.sh`, `store/description.md`, `store/privacy.md`, `README.md`

- [ ] **Step 1: 建立 `scripts/pack.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
mkdir -p dist
out="dist/nycucourse-extension-$version.zip"
rm -f "$out"
zip -r "$out" manifest.json src icons -x '*.DS_Store' >/dev/null
echo "$out"
unzip -l "$out"
```

Run: `chmod +x scripts/pack.sh && scripts/pack.sh`
Expected: 列出 manifest.json、src/…、icons/… ，不含 test、docs、scripts、store。

- [ ] **Step 2: 建立 `store/description.md`**

```markdown
# 商店說明

## 名稱
NYCU 預排課程匯入

## 簡短說明（132 字以內）
貼上課號，一鍵加入陽明交大選課系統的預排課程。

## 詳細說明
在陽明交通大學選課系統（cos.nycu.edu.tw）的預排課程頁面，打開這個擴充功能，貼上課號，就會依序把課程加入預排課程區，並列出成功、已存在與失敗的課號。

功能：
- 課號可用逗號、空白或換行分隔，也接受「1151_516702」這種帶學期前綴的格式。
- 加入後自動重新整理頁面，預排清單立即更新。
- 只在 cos.nycu.edu.tw 上運作，不需要額外登入。

注意：預排課程不是正式選課。正式選課請依學校公告在選課系統操作。

本擴充功能非學校官方工具。

## 類別
生產力工具

## 單一用途說明（審核用）
讓使用者以課號批次加入陽明交大選課系統的預排課程。

## 權限說明（審核用）
- activeTab：判斷目前分頁是否為選課系統，並與該分頁溝通。
- host_permissions cos.nycu.edu.tw：在選課系統頁面內注入腳本，呼叫該站自身的預排 API。
```

- [ ] **Step 3: 建立 `store/privacy.md`**

```markdown
# 隱私權政策

「NYCU 預排課程匯入」不蒐集、不儲存、不傳送任何個人資料。

- 擴充功能只在 https://cos.nycu.edu.tw 的頁面上執行。
- 使用者輸入的課號只用來呼叫選課系統本身的預排 API，請求由使用者的瀏覽器直接送往選課系統，不經過任何第三方伺服器。
- 擴充功能會讀取選課系統頁面已存在的登入權杖，以便代替使用者在同一個網站發出請求；權杖不會被複製、儲存或傳出該網站。
- 沒有遙測、沒有分析工具、沒有廣告。

最後更新：2026-09-14
```

- [ ] **Step 4: 建立 `README.md`**

```markdown
# nycucourse-extension

Chrome 擴充功能：貼上課號，一鍵加入陽明交通大學選課系統（cos.nycu.edu.tw）的預排課程。

## 開發

```bash
npm test          # 單元測試（Node 內建 test runner）
scripts/make-icons.sh   # 由 icons/icon.svg 產生 PNG（macOS）
scripts/pack.sh   # 打包成 dist/*.zip 供上架
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
```

- [ ] **Step 5: Commit 並打 tag**

```bash
git add scripts/pack.sh store README.md
git commit -m "新增打包腳本、商店說明、隱私聲明與 README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git tag v0.1.0
```

---

## Self-Review

- **Spec coverage**：格式解析（Task 1）、結果分類與清單確認（Task 2）、manifest 權限與 content script 流程（Task 3）、popup 三種畫面與錯誤提示（Task 4）、上架材料與打包（Task 5）、手動端對端測試（Task 4 Step 4）。spec 的「reload 分兩步」在 Task 3/4 都有實作。
- **Placeholder scan**：無 TBD；Task 3 Step 1 的 `default_locale` 提醒已明確說最終檔案不含該行。
- **Type consistency**：`Result = {id, status, msg}` 在 Task 2、3、4 一致；訊息型別 `ping`/`import`/`reload` 在 Task 3、4 一致；`reply.reason` 值 `not_logged_in`/`network` 一致。
