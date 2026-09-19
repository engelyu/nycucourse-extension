# 當期選課頁新版面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 當期選課頁改成「左：搜尋結果（篩選收進按鈕）、右：正式課表（同一節多堂課往下撐高）」，課表上的課可以看詳情、查詢／加選／登記、從預排移除並復原。

**Architecture:**
- 排版邏輯是純函式 `lib/stack.js`（`stackWeek`、`hiddenSlots`），可單元測試。
- 畫面拆成 `planner/timetable.js`（右欄課表）、`planner/filter-panel.js`（篩選面板開關）、`planner/course-detail.js`（詳情小卡）。
- `planner.js` 只負責狀態與串接。
- 移除預排走新的 content script 訊息 `removepreregist`，先讀 `getregist` 確認不是正式選課的課才刪。

**Tech Stack:** Chrome MV3、純 ES modules、`node --test`、Playwright-core E2E（scratchpad `e2e/`，headless，`ctx.route` 模擬選課網）。

**Spec:** `docs/superpowers/specs/2026-09-20-planner-layout-design.md`

## Global Constraints

- 所有畫面文字用繁體中文；程式註解用中文，密度照現有檔案。
- 永遠不呼叫 `deleteregist`；已選上、已登記的課永遠不提供移除。
- 同一格排序與顏色：已選上 → 已登記 → 在預排 → 私人行程；顏色用 `KIND_COLORS`（Okabe-Ito）。
- 顯示範圍：星期一到五、節次 1–9 一定顯示；週六日與 Y、Z、N、A–D 有課才顯示。
- 篩選面板開關存在 storage `planner.filterOpen`；沒存過時預設打開。
- 窄視窗斷點：寬度 < 900px。
- zh-Hant 排序是筆畫序，測試要照這個寫。
- 分支：接在 `fix-reg-wish` 上做；版本號改 0.10.0。

## 檔案結構

| 檔案 | 責任 |
|---|---|
| `src/lib/stack.js`（新） | `stackWeek(items)`、`hiddenSlots(keys, week)`：課表每一格放哪些課、位置號、顯示範圍、衝堂 |
| `src/lib/status.js` | 匯出 `itemKind(item)`、`itemMark(kind, item)`（原本的 `kindOf`、`markOf`） |
| `src/lib/freeslots.js` | `appliedCount(filters, selection)` |
| `src/lib/attribution.js` | `restoreParams(record)`：用預排紀錄組回 setpreregist 參數（從 `register.js` 的 `currentPreregParams` 搬來） |
| `src/lib/classify.js` | `removalBlock(registeredList, cosId)`：給 content script 用的移除前檢查 |
| `src/content.js` | 新訊息 `removepreregist` |
| `src/planner/filter-panel.js`（新） | 面板開關、Esc、焦點、按鈕上的數字、窄視窗時搬到工具列下方 |
| `src/planner/timetable.js`（新） | 右欄課表、滑過預覽、同一堂課一起標亮、點卡片 |
| `src/planner/course-detail.js`（新） | 詳情小卡與動作 |
| `src/planner/results.js` | 抽出 `renderQueryRows` 給詳情小卡共用 |
| `src/planner.html` / `planner.css` / `planner.js` | 新版面與串接 |

---

### Task 1: 課表排版純函式 `stackWeek`、`hiddenSlots`

**Files:**
- Create: `src/lib/stack.js`
- Modify: `src/lib/status.js`（匯出 `itemKind`、`itemMark`）
- Test: `test/stack.test.js`

**Interfaces:**
- Consumes: `scheduleItems` 產生的 item：`{ key, source, cosId, title, color, regState, wishNo, slots: [{ day, period, room, campus }] }`；`PERIODS`（`code` 是小寫：`y z 1 2 3 4 n 5 … 9 a b c d`）。
- Produces:
  - `itemKind(item) → 'registered'|'wish'|'preregist'|'manual'`
  - `itemMark(kind, item) → string`
  - `stackWeek(items) → { days: number[], periods: string[], cells: Map<'day-period', Entry[]>, conflicts: Map<'day-period', string[]> }`，其中 `Entry = { key, item, kind, lane, first, room, color, mark }`，每格依 `lane` 由小到大排序
  - `hiddenSlots(keys, week) → string[]`：不在 `week.days × week.periods` 範圍內的時段

- [ ] **Step 1: status.js 匯出 kind 與 mark**

把 `src/lib/status.js` 的 `function kindOf(item)` 改名匯出為 `export function itemKind(item)`，`function markOf(kind, item)` 改名匯出為 `export function itemMark(kind, item)`，檔內呼叫處一併改名：

```js
export function itemMark(kind, item) {
  if (kind === 'registered') return '✓'
  if (kind === 'wish') return CIRCLED[item.wishNo] || '登'
  if (kind === 'preregist') return '預'
  return ''
}
```

```js
export function itemKind(item) {
  if (item.source === 'manual') return 'manual'
  if (item.source === 'registered') return item.regState === 'wish' ? 'wish' : 'registered'
  return 'preregist'
}
```

`occupiedKinds` 裡的 `kindOf(item)` → `itemKind(item)`、`markOf(kind, item)` → `itemMark(kind, item)`。

Run: `npm test`，Expected: 全部通過（純改名）。

- [ ] **Step 2: 寫失敗的測試**

`test/stack.test.js`：

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stackWeek, hiddenSlots } from '../src/lib/stack.js'

const course = (key, source, slots, extra = {}) => ({
  key, source, cosId: key, title: key, color: '', regState: '', wishNo: null,
  slots: slots.map(([day, period, room = 'R']) => ({ day, period, room, campus: 'GF' })),
  ...extra,
})

test('一定顯示一到五、1 到 9 節；有課才加週六與其他節次', () => {
  const w = stackWeek([])
  assert.deepEqual(w.days, [1, 2, 3, 4, 5])
  assert.deepEqual(w.periods, ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  const w2 = stackWeek([course('a', 'preregist', [[6, 'a'], [1, 'n']])])
  assert.deepEqual(w2.days, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(w2.periods, ['1', '2', '3', '4', 'n', '5', '6', '7', '8', '9', 'a'])
})

test('同一格多堂課全部列出，已選上排最前面', () => {
  const items = [
    course('p1', 'preregist', [[1, '3']]),
    course('p2', 'preregist', [[1, '3']]),
    course('r', 'registered', [[1, '3']]),
    course('m', 'manual', [[1, '3']]),
    course('w', 'registered', [[1, '3']], { regState: 'wish', wishNo: 2 }),
  ]
  const cell = stackWeek(items).cells.get('1-3')
  assert.deepEqual(cell.map((e) => e.key), ['r', 'w', 'p1', 'p2', 'm'])
  assert.deepEqual(cell.map((e) => e.lane), [0, 1, 2, 3, 4])
  assert.deepEqual(cell.map((e) => e.mark), ['✓', '②', '預', '預', ''])
})

test('同一天中，一堂課在每一節的位置相同', () => {
  // A 在 3、4 節；B 只在 4 節；C 在 3 節與 5 節
  const items = [
    course('A', 'preregist', [[1, '3'], [1, '4']]),
    course('B', 'preregist', [[1, '4']]),
    course('C', 'preregist', [[1, '3'], [1, '5']]),
  ]
  const w = stackWeek(items)
  const lane = (key, k) => w.cells.get(k).find((e) => e.key === key).lane
  assert.equal(lane('A', '1-3'), lane('A', '1-4'))
  assert.equal(lane('C', '1-3'), lane('C', '1-5'))
  assert.notEqual(lane('B', '1-4'), lane('A', '1-4'))
})

test('連續節次只有第一節是 first', () => {
  const w = stackWeek([course('A', 'preregist', [[2, '3'], [2, '4'], [2, '6']])])
  assert.equal(w.cells.get('2-3')[0].first, true)
  assert.equal(w.cells.get('2-4')[0].first, false)
  assert.equal(w.cells.get('2-6')[0].first, true)
})

test('有已選上或已登記又疊了別的課才算衝堂', () => {
  const items = [
    course('r', 'registered', [[1, '3']]),
    course('p', 'preregist', [[1, '3'], [2, '3']]),
    course('q', 'preregist', [[2, '3']]),
  ]
  const w = stackWeek(items)
  assert.deepEqual(w.conflicts.get('1-3'), ['r', 'p'])
  assert.equal(w.conflicts.has('2-3'), false)
})

test('顏色：私人行程用自己的顏色，其他用狀態顏色', () => {
  const w = stackWeek([course('m', 'manual', [[1, '1']], { color: '#123456' }), course('p', 'preregist', [[1, '2']])])
  assert.equal(w.cells.get('1-1')[0].color, '#123456')
  assert.equal(w.cells.get('1-2')[0].color, '#0072B2')
})

test('hiddenSlots 列出不在顯示範圍內的時段', () => {
  const w = stackWeek([])
  assert.deepEqual(hiddenSlots(['1-3', '6-3', '6-4', '2-a'], w), ['6-3', '6-4', '2-a'])
})
```

Run: `node --test test/stack.test.js`，Expected: FAIL（找不到 `../src/lib/stack.js`）。

- [ ] **Step 3: 實作 `src/lib/stack.js`**

```js
// 當期選課頁右欄課表的排版：每一節列出所有課（同一節多堂課就往下撐高）。
// 同一天中，一堂課在它每一節的位置（lane）相同，方便上下對照。
import { PERIODS } from './periods.js'
import { itemKind, itemMark, KIND_COLORS } from './status.js'

const ORDER = PERIODS.map((p) => p.code)
const ALWAYS_DAYS = [1, 2, 3, 4, 5]
const ALWAYS_PERIODS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
const PRIORITY = { registered: 0, wish: 1, preregist: 2, manual: 3 }
const SERIOUS = new Set(['registered', 'wish'])

export function stackWeek(items) {
  const byDay = new Map() // 星期 -> [{ item, kind, periods: Map<節次, 教室> }]
  const usedPeriods = new Set()
  for (const item of items || []) {
    const kind = itemKind(item)
    const perDay = new Map()
    for (const s of item.slots || []) {
      const period = String(s.period).toLowerCase()
      if (!ORDER.includes(period)) continue
      if (!perDay.has(s.day)) perDay.set(s.day, new Map())
      if (!perDay.get(s.day).has(period)) perDay.get(s.day).set(period, s.room || '')
      usedPeriods.add(period)
    }
    for (const [day, periods] of perDay) {
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push({ item, kind, periods })
    }
  }

  const cells = new Map()
  for (const [day, entries] of byDay) {
    const start = (e) => Math.min(...[...e.periods.keys()].map((p) => ORDER.indexOf(p)))
    entries.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || start(a) - start(b) || String(a.item.key).localeCompare(String(b.item.key)))
    const lanes = [] // 每個位置已被哪些節次佔用
    for (const e of entries) {
      let lane = 0
      while (lanes[lane] && [...e.periods.keys()].some((p) => lanes[lane].has(p))) lane++
      if (!lanes[lane]) lanes[lane] = new Set()
      for (const p of e.periods.keys()) lanes[lane].add(p)
      const color = e.kind === 'manual' ? e.item.color || KIND_COLORS.manual : KIND_COLORS[e.kind]
      for (const [period, room] of e.periods) {
        const prev = ORDER[ORDER.indexOf(period) - 1]
        const key = `${day}-${period}`
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key).push({ key: e.item.key, item: e.item, kind: e.kind, lane, first: !e.periods.has(prev), room, color, mark: itemMark(e.kind, e.item) })
      }
    }
  }

  const conflicts = new Map()
  for (const [key, list] of cells) {
    list.sort((a, b) => a.lane - b.lane)
    if (list.length >= 2 && list.some((e) => SERIOUS.has(e.kind))) conflicts.set(key, list.map((e) => e.item.title))
  }

  const days = [...new Set([...ALWAYS_DAYS, ...byDay.keys()])].sort((a, b) => a - b)
  const periods = ORDER.filter((p) => ALWAYS_PERIODS.has(p) || usedPeriods.has(p))
  return { days, periods, cells, conflicts }
}

export function hiddenSlots(keys, week) {
  const days = new Set(week.days.map(String))
  const periods = new Set(week.periods)
  return [...(keys || [])].filter((k) => {
    const [day, period] = k.split('-')
    return !days.has(day) || !periods.has(period)
  })
}
```

注意：`conflicts` 的值是課名陣列（衝堂提示的 `title` 用），測試裡 item 的 `title` 等於 key，所以 `['r', 'p']` 成立。

- [ ] **Step 4: 跑測試**

Run: `node --test test/stack.test.js && npm test`，Expected: 全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/lib/stack.js src/lib/status.js test/stack.test.js
git commit -m "當期選課：課表排版純函式 stackWeek（同一節多堂、位置固定、衝堂）"
```

---

### Task 2: 篩選條件數、移除預排（含復原參數與安全檢查）

**Files:**
- Modify: `src/lib/freeslots.js`（加 `appliedCount`）
- Modify: `src/lib/attribution.js`（加 `restoreParams`）
- Modify: `src/register.js:281-294`（改用 `restoreParams`）
- Modify: `src/lib/classify.js`（加 `removalBlock`）
- Modify: `src/content.js`（`removepreregist` 訊息）
- Test: `test/freeslots.test.js`、`test/attribution.test.js`、`test/classify.test.js`

**Interfaces:**
- Produces:
  - `appliedCount(filters, selection) → number`
  - `restoreParams(record) → setpreregist 參數物件`
  - `NycuClassify.removalBlock(list, cosId) → ''|string`
  - content 訊息 `{ type: 'removepreregist', cosId }` → `{ ok: true, removed: true }` 或 `{ ok: true, removed: false, msg }` 或 `{ ok: false, reason }`

- [ ] **Step 1: 寫失敗的測試**

`test/freeslots.test.js` 末尾加（檔案開頭的 import 加上 `appliedCount`）：

```js
test('appliedCount：時段算一個，校區、類別、系所各算一個，關鍵字不算', () => {
  assert.equal(appliedCount({ campuses: [], categories: [], deps: [], keyword: 'x' }, new Set()), 0)
  assert.equal(appliedCount({ campuses: ['GF'], categories: ['必修', '選修'], deps: ['資工'], keyword: '' }, new Set(['1-3', '1-4'])), 5)
})
```

`test/attribution.test.js` 末尾加（import 加上 `restoreParams`）：

```js
test('restoreParams 用預排紀錄組回加入預排的參數', () => {
  const record = { cos_id: 112304, menu_data: '{&quot;type&quot;:3}', wType: 'E', GroupName: null, GroupName_E: 'G', category_type: null, category_cname: '量性推理', category_ename: undefined }
  assert.deepEqual(restoreParams(record), {
    cos_id: '112304', menu_data: '{"type":3}', wType: 'E', GroupName: 'null', GroupName_E: 'G',
    category_type: '', category_cname: '量性推理', category_ename: 'null',
  })
  assert.equal(restoreParams({ cos_id: '1' }).menu_data, '{}')
  assert.equal(restoreParams({ cos_id: '1' }).wType, 'X')
})
```

`test/classify.test.js` 末尾加（解構加上 `removalBlock`）：

```js
test('removalBlock：讀不到正式選課或課已在正式選課時不移除', () => {
  assert.equal(removalBlock(null, '516701'), '讀不到正式選課清單，先不移除')
  assert.equal(removalBlock([{ cos_id: '516701' }], '516701'), '這門課已在正式選課，不能從這裡移除')
  assert.equal(removalBlock([{ cos_id: 516701 }], '516701'), '這門課已在正式選課，不能從這裡移除')
  assert.equal(removalBlock([], '516701'), '')
})
```

Run: `npm test`，Expected: 三個新測試 FAIL。

- [ ] **Step 2: 實作**

`src/lib/freeslots.js`，放在 `appliedFilters` 後面：

```js
// 「篩選」按鈕上的數字：選了時段算一個，校區、類別、系所每個選項各算一個（關鍵字在按鈕旁邊，不算）
export function appliedCount(filters, selection) {
  const f = filters || {}
  return (selection && selection.size ? 1 : 0) + (f.campuses || []).length + (f.categories || []).length + (f.deps || []).length
}
```

`src/lib/attribution.js`，放在 `preregParams` 後面：

```js
// 用選課網的預排紀錄組回 setpreregist 參數：改採計方式失敗、移除後按復原時用來加回原本的樣子
export function restoreParams(record) {
  const text = (v) => (v == null ? 'null' : String(v))
  return {
    cos_id: String(record.cos_id),
    menu_data: String(record.menu_data || '{}').replace(/&quot;/g, '"'),
    wType: String(record.wType || 'X'),
    GroupName: text(record.GroupName),
    GroupName_E: text(record.GroupName_E),
    category_type: record.category_type == null ? '' : String(record.category_type),
    category_cname: text(record.category_cname),
    category_ename: text(record.category_ename),
  }
}
```

`src/register.js`：刪掉 `currentPreregParams` 函式（281–294 行），`changeAttribution` 裡的 `previous: currentPreregParams(course)` 改成 `previous: restoreParams(course)`，並在檔案開頭從 `./lib/attribution.js` 的 import 加上 `restoreParams`。

`src/lib/classify.js`，在 `root.NycuClassify = …` 前面加，並把它加進 freeze 的物件：

```js
  // 從預排移除前的檢查：正式選課清單讀不到、或課已在正式選課裡（已選上／已登記）就不移除
  function removalBlock(registeredList, cosId) {
    if (!Array.isArray(registeredList)) return '讀不到正式選課清單，先不移除'
    if (registeredList.some((c) => String(c && c.cos_id) === String(cosId))) return '這門課已在正式選課，不能從這裡移除'
    return ''
  }
```

```js
  root.NycuClassify = Object.freeze({ classifyResult, confirmWithList, tokenUsable, runBatch, parseSysStatus, removalBlock })
```

`src/content.js`：
- 第 3 行解構加上 `removalBlock`。
- 在 `changePreregist` 後面加：

```js
// 從預排移除一門課。先讀正式選課清單，確定不是已選上、已登記的課才刪（永遠不動正式選課）
async function removePreregist(id) {
  if (!tokenUsable(token(), Date.now())) return { ok: false, reason: 'not_logged_in' }
  const reg = await post('getregist', {})
  let list = null
  if (isOk(reg.status) && reg.text.trim()) {
    try {
      const parsed = JSON.parse(reg.text)
      list = Array.isArray(parsed) ? parsed : null
    } catch {}
  }
  const blocked = removalBlock(list, id)
  if (blocked) return { ok: true, removed: false, msg: blocked }
  const removed = await post('deletepreregist', { cos_id: id })
  if (!isOk(removed.status)) return { ok: true, removed: false, msg: `移除失敗（HTTP ${removed.status}）` }
  let first = null
  try {
    const parsed = JSON.parse(removed.text || '[]')
    first = Array.isArray(parsed) ? parsed[0] : parsed
  } catch {}
  if (first && first.status && first.status !== 'success') return { ok: true, removed: false, msg: first.cmsg || first.emsg || '移除失敗' }
  return { ok: true, removed: true }
}
```

- 在訊息處理（`changepreregist` 那段後面）加：

```js
  if (message.type === 'removepreregist') {
    serial(() => removePreregist(String(message.cosId))).then(
      sendResponse,
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
```

- [ ] **Step 3: 跑測試**

Run: `npm test`，Expected: 全部 PASS。另外跑 `node e2e/register.mjs`（scratchpad，確認 `restoreParams` 搬家後改採計方式仍正常），Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/lib/freeslots.js src/lib/attribution.js src/register.js src/lib/classify.js src/content.js test/
git commit -m "當期選課：篩選條件數、移除預排訊息（先確認不在正式選課）、復原參數共用"
```

---

### Task 3: 新版面與可收起的篩選面板

**Files:**
- Create: `src/planner/filter-panel.js`
- Modify: `src/planner.html`（整頁結構）
- Modify: `src/planner.css`（版面、面板、工具列）
- Modify: `src/planner.js`（`buildFilters`／`readFilters` 拿掉關鍵字與排序；串接面板）
- Test: scratchpad `e2e/planner.mjs`（既有檢查仍要過）、新 `e2e/layout.mjs`

**Interfaces:**
- Consumes: `appliedCount`（Task 2）
- Produces:
  - `createFilterPanel({ panel, toggle, close, home, narrowSlot, initialOpen, onToggle }) → { isOpen(): boolean, setOpen(open: boolean): void, setCount(n: number): void }`
  - DOM id：`#keyword`、`#sort`、`#filter-toggle`、`#filter-panel`、`#filter-close`、`#grid`、`#grid-legend`、`#legend`、`#timetable`、`#hidden-note`、`#detail`、`#toast`

- [ ] **Step 1: 改 `src/planner.html` 的 `<body>`**

```html
<body>
  <header class="page-head">
    <h1>當期選課</h1>
    <div class="status-bar"><button id="refresh-status" type="button">從選課網更新狀態</button><span id="status-at" class="muted"></span></div>
  </header>
  <main class="layout">
    <section class="results-pane" aria-label="搜尋結果">
      <div class="results-bar">
        <input id="keyword" type="search" placeholder="關鍵字：課名、老師或課號" aria-label="關鍵字" autocomplete="off">
        <button id="filter-toggle" type="button" aria-expanded="false" aria-controls="filter-panel">篩選</button>
        <label class="sort-label">排序 <select id="sort"></select></label>
      </div>
      <div id="narrow-slot"></div>
      <div id="applied" class="applied" hidden></div>
      <p id="summary" class="summary"></p>
      <p id="cos-hint" class="muted" hidden></p>
      <div id="results"></div>
    </section>
    <section class="plan-pane" aria-label="正式課表">
      <div id="legend" class="legend"></div>
      <p id="hidden-note" class="muted hidden-note" hidden></p>
      <div id="timetable" class="timetable"></div>
      <aside id="filter-panel" class="filter-panel" aria-label="篩選" hidden>
        <div class="panel-head">
          <h2>篩選</h2>
          <button id="filter-close" type="button" aria-label="關閉篩選">✕</button>
        </div>
        <section class="panel-block">
          <h3>時段</h3>
          <div class="toolbar">
            <button id="fill-registered" type="button">帶入空堂：避開正式選課</button>
            <button id="fill-all" type="button">帶入空堂：避開正式選課＋預排</button>
            <button id="clear" type="button">全部清除</button>
            <button id="undo" type="button" title="復原上一步（⌘Z／Ctrl+Z）" disabled>復原</button>
            <span id="count" class="muted"></span>
          </div>
          <p class="muted tip">框選想上課的時段，找出落在這些時段的課。按住拖曳可以框選；從已選的格子開始拖曳就是取消。點星期或節次可以整天、整節切換。</p>
          <div id="grid-legend" class="legend"></div>
          <div id="grid" class="slot-grid"></div>
        </section>
        <form id="filters" class="filters" autocomplete="off"></form>
      </aside>
    </section>
  </main>
  <dialog id="detail" class="detail"></dialog>
  <div id="toast" class="toast" role="status" hidden></div>
  <script type="module" src="planner.js"></script>
</body>
```

- [ ] **Step 2: 寫 `src/planner/filter-panel.js`**

```js
// 篩選面板：蓋在右欄課表上；按「篩選」、✕、Esc 開關，關閉後焦點回到「篩選」按鈕。
// 窄視窗（< 900px）時搬到左欄工具列下方，不蓋住課表。
const NARROW = '(max-width: 899px)'

export function createFilterPanel({ panel, toggle, close, home, narrowSlot, initialOpen, onToggle }) {
  let open = false
  let count = 0

  const label = () => {
    toggle.textContent = count ? `篩選 (${count})` : '篩選'
    toggle.setAttribute('aria-expanded', String(open))
    toggle.classList.toggle('active', open)
  }
  const setOpen = (next, { focus = false } = {}) => {
    open = Boolean(next)
    panel.hidden = !open
    label()
    if (!open && focus) toggle.focus()
    onToggle(open)
  }

  const place = (mq) => {
    const target = mq.matches ? narrowSlot : home
    if (panel.parentElement !== target) target.append(panel)
  }
  const mq = window.matchMedia(NARROW)
  place(mq)
  mq.addEventListener('change', place)

  toggle.addEventListener('click', () => setOpen(!open, { focus: open }))
  close.addEventListener('click', () => setOpen(false, { focus: true }))
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return
    if (document.querySelector('dialog[open]')) return // 詳情小卡、確認視窗自己處理 Esc
    e.preventDefault()
    setOpen(false, { focus: true })
  })

  open = Boolean(initialOpen)
  panel.hidden = !open
  label()

  return {
    isOpen: () => open,
    setOpen: (next) => setOpen(next),
    setCount(n) {
      count = n
      label()
    },
  }
}
```

- [ ] **Step 3: 改 `src/planner.js`**

1. import 加上 `appliedCount`（`./lib/freeslots.js`）與 `import { createFilterPanel } from './planner/filter-panel.js'`。
2. `state` 加 `filterOpen: true`；`restore` 加：

```js
  if (typeof saved.filterOpen === 'boolean') state.filterOpen = saved.filterOpen
```

3. `save` 改成：

```js
async function save() {
  try {
    await chrome.storage.local.set({ planner: { selection: [...state.selection], filters: state.filters, filterOpen: state.filterOpen } })
  } catch {}
}
```

4. `buildFilters`：
   - 刪掉建立 `sort` 的程式碼。
   - 「比對方式」fieldset 只留兩個 radio（刪掉 spacer、排序 label、`sort`）。
   - 刪掉最後的「關鍵字」fieldset。
   - 在函式最後加：

```js
  const sort = $('#sort')
  sort.replaceChildren(...SORT_OPTIONS.map((o) => new Option(o.label, o.id, false, o.id === f.sort)))
  $('#keyword').value = f.keyword
```

5. `readFilters` 保持讀 `#sort` 與 `#keyword`（id 沒變，現在在工具列上）。`init` 裡加上工具列的監聽：

```js
  $('#keyword').addEventListener('input', readFilters)
  $('#sort').addEventListener('change', readFilters)
```

6. `renderResults` 在開頭（`const list = courses()` 之後）加：

```js
  if (panel) panel.setCount(appliedCount(state.filters, state.selection))
```

7. 沒有時段時的提示改成：`summary.textContent = '先按「篩選」框選時段，或在篩選裡按「帶入空堂」。'`
8. 模組層級加 `let panel = null`；`init` 在 `buildFilters()` 前加：

```js
  panel = createFilterPanel({
    panel: $('#filter-panel'),
    toggle: $('#filter-toggle'),
    close: $('#filter-close'),
    home: document.querySelector('.plan-pane'),
    narrowSlot: $('#narrow-slot'),
    initialOpen: state.filterOpen,
    onToggle: (open) => {
      state.filterOpen = open
      save()
    },
  })
```

9. `renderLegend` 改成接受容器，並在 `init` 呼叫兩次：`renderLegend($('#legend'))`、`renderLegend($('#grid-legend'))`：

```js
function renderLegend(legend) {
  legend.replaceChildren(
    ...Object.entries(KIND_LABELS).map(([kind, label]) => {
      const item = document.createElement('span')
      const dot = document.createElement('i')
      dot.style.background = KIND_COLORS[kind]
      const mark = { registered: '✓ ', wish: '①登 ', preregist: '預 ', manual: '' }[kind]
      item.append(dot, `${mark}${label}`, kind === 'manual' ? '（顏色可在課表頁設定）' : '')
      return item
    }),
  )
}
```

- [ ] **Step 4: 改 `src/planner.css`**

刪掉 `.layout`、`@media (max-width: 960px)`、「寬螢幕時左欄…sticky」整段，以及 `.filters input[type="search"]` 規則，改加：

```css
.page-head { display: flex; flex-wrap: wrap; gap: 4px 20px; align-items: baseline; margin-bottom: 12px; }
.page-head .status-bar { margin: 0; }
.layout { display: grid; grid-template-columns: minmax(0, 45fr) minmax(0, 55fr); gap: 24px; align-items: start; }

/* 左欄：工具列固定在頂端 */
.results-bar { position: sticky; top: 0; z-index: 2; display: flex; gap: 8px; align-items: center; padding: 8px 0; background: Canvas; }
.results-bar #keyword { flex: 1; min-width: 0; padding: 4px 8px; font: inherit; }
.results-bar #filter-toggle.active { background: var(--sel); border-color: var(--accent); }
.sort-label { white-space: nowrap; font-size: 13px; color: var(--muted); }

/* 右欄：固定在畫面上自己捲動；篩選面板蓋在課表上 */
.plan-pane { position: sticky; top: 12px; max-height: calc(100vh - 24px); overflow-y: auto; overscroll-behavior: contain; }
.filter-panel { position: absolute; inset: 0; z-index: 3; overflow-y: auto; padding: 0 4px 12px; background: Canvas; }
.filter-panel[hidden] { display: none; }
.plan-pane:has(.filter-panel:not([hidden])) { overflow: hidden; }
.panel-head { position: sticky; top: 0; z-index: 1; display: flex; justify-content: space-between; align-items: center; padding: 6px 0; background: Canvas; border-bottom: 1px solid var(--line); }
.panel-head h2 { margin: 0; font-size: 16px; }
.panel-block h3 { margin: 10px 0 4px; font-size: 13px; color: var(--muted); }

@media (max-width: 899px) {
  .layout { grid-template-columns: 1fr; }
  .plan-pane { position: static; max-height: none; overflow: visible; }
  .filter-panel { position: static; margin: 4px 0 12px; border: 1px solid var(--line); border-radius: 8px; padding: 0 10px 10px; }
}
```

- [ ] **Step 5: E2E**

1. 在 scratchpad `e2e/planner.mjs` 開頭 storage 預設值裡，`planner` 不設 `filterOpen`（沒存過就預設打開，所以既有的格子、篩選測試照常可以操作）。
2. 跑 `node e2e/planner.mjs`，Expected: PASS。如果有檢查因為元素位置改變而失敗，只修選擇器，不改檢查的意思。
3. 新增 `e2e/layout.mjs`：
   - 開頭的啟動、`ctx.route` 模擬選課網、storage 預設資料，整段複製 `planner.mjs` 的 setup（到開啟 planner 頁為止）。
   - 加上以下檢查（Task 4、5 會在同一個檔案繼續加）：

```js
  // 1. 第一次打開面板是開的；按 ✕ 關閉、焦點回到按鈕；重開頁面仍是關的；Esc 關閉
  r.firstOpen = await page.$eval('#filter-panel', (e) => !e.hidden)
  await page.click('#filter-close')
  r.closedFocus = await page.evaluate(() => document.activeElement.id)
  await page.reload()
  await page.waitForSelector('#timetable')
  r.staysClosed = await page.$eval('#filter-panel', (e) => e.hidden)
  await page.click('#filter-toggle')
  r.expanded = await page.$eval('#filter-toggle', (b) => b.getAttribute('aria-expanded'))
  await page.keyboard.press('Escape')
  r.escCloses = await page.$eval('#filter-panel', (e) => e.hidden)
  // 2. 面板開著時框選兩格，結果即時更新；按鈕顯示條件數
  await page.click('#filter-toggle')
  await page.click('.cell[data-key="1-3"]')
  await page.click('.cell[data-key="1-4"]')
  r.summaryLive = await page.textContent('#summary')
  r.toggleLabel = await page.textContent('#filter-toggle')
```

   - checks：

```js
    firstOpen: r.firstOpen === true,
    closeReturnsFocus: r.closedFocus === 'filter-toggle',
    rememberedClosed: r.staysClosed === true,
    ariaExpanded: r.expanded === 'true',
    escCloses: r.escCloses === true,
    liveResults: /^共 \d+ 門/.test(r.summaryLive),
    countOnButton: r.toggleLabel === '篩選 (1)',
```

   Run: `node e2e/layout.mjs`，Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/planner.html src/planner.css src/planner.js src/planner/filter-panel.js
git commit -m "當期選課：左搜尋結果、右課表的版面；篩選收進可開關的面板"
```

---

### Task 4: 右欄正式課表

**Files:**
- Create: `src/planner/timetable.js`
- Modify: `src/planner.css`（課表樣式）
- Modify: `src/planner.js`（render 課表、結果滑過預覽）
- Test: `e2e/layout.mjs`

**Interfaces:**
- Consumes: `stackWeek`、`hiddenSlots`（Task 1）、`describeKeys`、`courseSlots`（`lib/freeslots.js`）、`scheduleItems`、`PERIODS`、`DAY_NAMES`
- Produces: `createTimetable(container, { note, onOpen }) → { render(items): void, preview(keys: string[]): void }`；`onOpen(item, anchorEl)` 在點卡片時呼叫

- [ ] **Step 1: 寫 `src/planner/timetable.js`**

```js
// 右欄正式課表：每一節列出所有課，同一節很多堂就往下撐高（排版見 lib/stack.js）。
// 滑過左邊結果時標亮該課的時段；滑過課表上的課時，同一堂課的所有節次一起標亮。
import { PERIODS, DAY_NAMES } from '../lib/periods.js'
import { stackWeek, hiddenSlots } from '../lib/stack.js'
import { describeKeys } from '../lib/freeslots.js'

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) })

export function createTimetable(container, { note, onOpen }) {
  let week = stackWeek([])

  container.addEventListener('mouseover', (e) => {
    const card = e.target.closest('.tt-course')
    const key = card ? card.dataset.item : ''
    for (const c of container.querySelectorAll('.tt-course')) c.classList.toggle('same', Boolean(key) && c.dataset.item === key)
  })
  container.addEventListener('mouseleave', () => {
    for (const c of container.querySelectorAll('.tt-course.same')) c.classList.remove('same')
  })

  function courseButton(entry) {
    const b = el('button', `tt-course${entry.first ? '' : ' cont'}`)
    b.type = 'button'
    b.dataset.item = entry.key
    b.dataset.kind = entry.kind
    b.style.setProperty('--kind', entry.color)
    b.title = [entry.item.title, entry.room].filter(Boolean).join('・')
    if (entry.first) {
      b.append(el('span', 'mark', entry.mark), el('span', 'name', entry.item.title), el('span', 'room', entry.room))
    } else {
      b.setAttribute('aria-label', `${entry.item.title}（續）`)
    }
    b.addEventListener('click', () => onOpen(entry.item, b))
    return b
  }

  return {
    render(items) {
      week = stackWeek(items)
      container.replaceChildren()
      container.style.gridTemplateColumns = `44px repeat(${week.days.length}, minmax(0, 1fr))`
      container.append(el('div', 'tt-corner'))
      for (const d of week.days) container.append(el('div', 'tt-day', DAY_NAMES[d]))
      for (const code of week.periods) {
        const p = PERIODS.find((x) => x.code === code)
        const head = el('div', 'tt-period')
        head.append(el('b', '', p.label), el('small', '', p.start))
        container.append(head)
        for (const d of week.days) {
          const key = `${d}-${code}`
          const cell = el('div', 'tt-cell')
          cell.dataset.key = key
          const list = week.cells.get(key) || []
          const lanes = list.length ? list[list.length - 1].lane + 1 : 0
          for (let lane = 0; lane < lanes; lane++) {
            const entry = list.find((e) => e.lane === lane)
            cell.append(entry ? courseButton(entry) : el('div', 'tt-gap'))
          }
          const conflict = week.conflicts.get(key)
          if (conflict) {
            cell.classList.add('conflict')
            cell.title = `衝堂：${conflict.join('、')}`
          }
          container.append(cell)
        }
      }
      if (!items.length) {
        note.textContent = '還沒有課。在左邊找到課後按「加入預排」，或按上方「從選課網更新狀態」。'
        note.dataset.empty = '1'
        note.hidden = false
      } else {
        delete note.dataset.empty
        note.hidden = true
      }
    },
    preview(keys = []) {
      const set = new Set(keys)
      for (const cell of container.querySelectorAll('.tt-cell')) cell.classList.toggle('preview', set.has(cell.dataset.key))
      if (!note.dataset.empty) {
        const hidden = hiddenSlots(keys, week)
        if (hidden.length) {
          note.textContent = `另有：${describeKeys(hidden)}`
          note.hidden = false
        } else note.hidden = true
      }
    },
  }
}
```

`note.dataset.empty` 讓 `preview` 不會蓋掉空課表的說明。

- [ ] **Step 2: 課表樣式（加在 `src/planner.css`）**

```css
/* 右欄正式課表：列高依那一節最多幾堂課自動撐高 */
.timetable { display: grid; gap: 2px; font-size: 12px; }
.tt-day { text-align: center; color: var(--muted); padding: 2px 0; position: sticky; top: 0; background: Canvas; z-index: 1; }
.tt-period { color: var(--muted); display: flex; flex-direction: column; align-items: flex-start; padding: 2px 4px; }
.tt-period small { font-size: 10px; }
.tt-cell { min-height: 30px; border: 1px solid var(--line); border-radius: 4px; padding: 2px; display: flex; flex-direction: column; gap: 2px; }
.tt-cell.preview { background: var(--sel); border-color: var(--accent); }
.tt-cell.conflict { border: 2px solid var(--error); }
.tt-gap { height: 6px; }
.tt-course {
  display: flex; gap: 3px; align-items: baseline; width: 100%; min-width: 0; text-align: left;
  padding: 1px 4px; border: none; border-left: 4px solid var(--kind); border-radius: 3px;
  background: color-mix(in srgb, var(--kind) 16%, Canvas); color: CanvasText; font-size: 12px; line-height: 1.35;
}
.tt-course .name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.tt-course .room { color: var(--muted); font-size: 11px; white-space: nowrap; }
.tt-course.cont { height: 6px; padding: 0; }
.tt-course.same, .tt-course:hover { outline: 2px solid var(--kind); outline-offset: 0; }
.tt-course:focus-visible { outline: 2px solid var(--accent); }
.hidden-note { margin: 0 0 4px; font-size: 12px; }
```

- [ ] **Step 3: 串進 `src/planner.js`**

1. import：`import { createTimetable } from './planner/timetable.js'`。
2. 模組層級加 `let timetable = null`；`init` 在 `grid = createSlotGrid(...)` 後面加：

```js
  timetable = createTimetable($('#timetable'), { note: $('#hidden-note'), onOpen: openDetail })
```

   並先放一個暫時的 `function openDetail() {}`（Task 5 會換成真的）。
3. `render()` 在 `grid.render(...)` 後面加：

```js
  timetable.render(scheduleItems(state.schedule, ['registered', 'preregist']))
```

4. `renderResults` 裡的 `onHover` 改成同時預覽格子與課表：

```js
    onHover: (hit) => {
      grid.preview(hit ? hit.keys.filter((k) => state.selection.has(k)) : [], hit ? hit.outside : [])
      timetable.preview(hit ? courseSlots(hit.course).keys : [])
    },
```

- [ ] **Step 4: E2E（`e2e/layout.mjs` 繼續加）**

在 storage 預設的 `schedule.sources.preregist.courses` 加 5 堂同在週一 3–4 節的預排（課號 `P1`–`P5`，`cos_time: 'M34-SA101[GF]'`），`registered.courses` 加一堂 `M3-SA102[GF]` 的已選上課（`sFlag: 'F'`）和一堂週二 3 節的課（`T3-A1[GF]`，`sFlag: 'F'`），預排再加一堂週六的課 `S34-A2[GF]`。檢查：

```js
  r.cell13 = await page.$$eval('.tt-cell[data-key="1-3"] .tt-course', (bs) => bs.map((b) => b.dataset.item))
  r.lanes = await page.evaluate(() => {
    const idx = (key, item) => [...document.querySelectorAll(`.tt-cell[data-key="${key}"] > *`)].findIndex((c) => c.dataset.item === item)
    return ['P1', 'P2', 'P3', 'P4', 'P5'].map((id) => [idx('1-3', `preregist:${id}`), idx('1-4', `preregist:${id}`)])
  })
  r.conflict13 = await page.$eval('.tt-cell[data-key="1-3"]', (c) => c.classList.contains('conflict'))
  r.conflict23 = await page.$eval('.tt-cell[data-key="2-3"]', (c) => c.classList.contains('conflict'))
  r.hasSat = await page.$$eval('.tt-day', (ds) => ds.map((d) => d.textContent).includes('六'))
  const h1 = await page.$eval('.tt-cell[data-key="1-5"]', (c) => c.getBoundingClientRect().height)
  await page.hover('.card >> nth=0')
  r.previewed = await page.$$eval('.tt-cell.preview', (cs) => cs.length)
  r.heightSame = h1 === (await page.$eval('.tt-cell[data-key="1-5"]', (c) => c.getBoundingClientRect().height))
```

checks：

```js
    fiveInOneCell: r.cell13.length === 6 && r.cell13[0].startsWith('registered:'),
    sameLaneAcrossPeriods: r.lanes.every(([a, b]) => a === b),
    conflictWithRegistered: r.conflict13 === true && r.conflict23 === false,
    saturdayShown: r.hasSat === true,
    hoverPreview: r.previewed > 0 && r.heightSame,
```

   （`1-4` 的第 0 個位置是空的 `.tt-gap`，因為已選上的課只在第 3 節，所以同一堂課的位置號在兩節相同。）

   另外加一個情境：把週六那堂預排從 storage 移掉後，滑過一門有週六時段的結果卡片，`#hidden-note` 要顯示 `另有：六`。模擬資料要有一門 `S34` 的課，才會出現在結果裡。

   Run: `node e2e/layout.mjs && node e2e/planner.mjs`，Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/planner/timetable.js src/planner.css src/planner.js
git commit -m "當期選課：右欄正式課表（同一節多堂撐高、位置固定、衝堂紅框、滑過預覽）"
```

---

### Task 5: 詳情小卡、查詢登記、從預排移除與復原

**Files:**
- Create: `src/planner/course-detail.js`
- Modify: `src/planner/results.js`（抽出 `renderQueryRows`）
- Modify: `src/planner.js`（`openDetail`、`removeFromPrereg`、toast）
- Modify: `src/planner.css`（小卡、toast）
- Test: `e2e/layout.mjs`

**Interfaces:**
- Consumes: `courseStatuses`、`restoreParams`（Task 2）、`removepreregist` 訊息（Task 2）、`queryCourse`、`registerCourse`（`planner.js` 既有）、`describeSlots`（`lib/periods.js`）、`courseOutlineUrl`
- Produces:
  - `renderQueryRows(course, s, status, onRegister) → HTMLElement|null`（`results.js` 匯出）
  - `createCourseDetail(dialog, ctx) → { open(item, anchor): void, refresh(): void, close(): void }`
  - `ctx = { semester(): string, status(cosId): Status|undefined, findCourse(cosId): Course|null, queryState(cosId): object|undefined, onQuery(course), onRegister(course, row), onRemove(item) }`

- [ ] **Step 1: `results.js` 抽出 `renderQueryRows`**

把 `card()` 裡 `if (s && s.status === 'queried' && …) { … li.append(box) }` 整段換成：

```js
  const rows = renderQueryRows(course, s, status, (c, row) => ctx.onRegister(c, row))
  if (rows) li.append(rows)
```

並新增匯出函式（內容就是原本那段，只是改成回傳 `box`）：

```js
// 查詢結果：每種採計方式一列，能選的附「加選／登記／改志願」按鈕（結果卡片與詳情小卡共用）
export function renderQueryRows(course, s, status, onRegister) {
  if (!(s && s.status === 'queried' && !(status && status.state === 'registered'))) return null
  const box = document.createElement('div')
  box.className = 'query-rows'
  for (const row of s.rows) {
    const r = document.createElement('div')
    r.className = 'query-row'
    const a = row.availability
    const ok = a.canRegister
    const text = ok ? [AVAILABLE_TEXT[a.action], a.seats, ...a.reasons].filter(Boolean).join('・') : [(a.message || '不能選').replace(/[。.]\s*$/, ''), a.seats].filter(Boolean).join('・')
    r.append(span('how', row.label), span(ok ? 'avail ok' : 'avail error', text))
    if (ok) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = status && status.state === 'wish' && a.needsWish ? '改志願' : ACTION_LABELS[a.action]
      b.title = row.inPrereg ? '開啟確認視窗' : '先加入預排，再開啟確認視窗'
      b.disabled = Boolean(s.busy)
      b.addEventListener('click', () => onRegister(course, row))
      r.append(b)
    }
    box.append(r)
  }
  return box
}
```

`.query-rows` 的樣式原本掛在 `.card .query-rows` 底下；把 `planner.css` 裡 `.card .query-rows`、`.card .query-row`、`.card .query-row .how`、`.card .query-row .avail*` 的選擇器前面的 `.card ` 拿掉，讓詳情小卡也吃得到。

Run: `node e2e/planner.mjs`，Expected: PASS（行為不變）。

- [ ] **Step 2: 寫 `src/planner/course-detail.js`**

```js
// 課表上點一堂課的詳情小卡：老師、時段、狀態、採計方式、大綱，以及依狀態的動作。
// 已選上、已登記（等分發）只看詳情；永遠不提供退選或移除正式選課的課。
import { describeSlots } from '../lib/periods.js'
import { courseOutlineUrl } from '../lib/links.js'
import { renderQueryRows } from './results.js'

const NARROW = '(max-width: 899px)'
const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) })

export function createCourseDetail(dialog, ctx) {
  let current = null // { item, anchor }

  const close = () => {
    current = null
    if (dialog.open) dialog.close()
  }
  dialog.addEventListener('close', () => {
    current = null
  })
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  document.addEventListener('pointerdown', (e) => {
    if (!dialog.open || dialog.contains(e.target)) return
    if (e.target.closest && e.target.closest('dialog[open]')) return // 確認視窗開著時不關
    close()
  })

  function place(anchor) {
    if (window.matchMedia(NARROW).matches || !anchor) {
      dialog.style.left = dialog.style.top = ''
      dialog.classList.add('centered')
      return
    }
    dialog.classList.remove('centered')
    const a = anchor.getBoundingClientRect()
    const w = dialog.offsetWidth
    const h = dialog.offsetHeight
    const left = Math.min(Math.max(8, a.left - w - 8 > 8 ? a.left - w - 8 : a.right + 8), window.innerWidth - w - 8)
    const top = Math.min(Math.max(8, a.top), window.innerHeight - h - 8)
    dialog.style.left = `${left}px`
    dialog.style.top = `${top}px`
  }

  function draw() {
    const { item } = current
    const manual = item.source === 'manual'
    const status = manual ? null : ctx.status(item.cosId)
    const course = manual ? null : ctx.findCourse(item.cosId)
    dialog.replaceChildren()

    const head = el('div', 'detail-head')
    const url = manual ? '' : courseOutlineUrl(item.semester || ctx.semester(), item.cosId)
    const title = el(url ? 'a' : 'span', 'detail-title', manual ? item.title : `${item.cosId} ${item.title}`)
    if (url) Object.assign(title, { href: url, target: '_blank', rel: 'noreferrer', title: '開啟課程大綱' })
    const x = el('button', 'detail-close', '✕')
    x.type = 'button'
    x.setAttribute('aria-label', '關閉')
    x.addEventListener('click', close)
    head.append(title, x)

    const rooms = [...new Set((item.slots || []).map((s) => s.room).filter(Boolean))]
    const lines = [
      [item.teacher, describeSlots(item.slots), rooms.join('、')].filter(Boolean).join('・'),
      manual ? '私人行程' : status ? status.label : '',
    ].filter(Boolean)
    dialog.append(head, ...lines.map((t) => el('p', 'detail-line', t)))

    const actions = el('div', 'detail-actions')
    if (manual) {
      const a = el('a', '', '到課表頁編輯')
      a.href = chrome.runtime.getURL('src/schedule.html')
      a.target = '_blank'
      actions.append(a)
    } else if (status && (status.state === 'preregist' || (status.state === 'wish' && status.wishNo))) {
      const s = ctx.queryState(item.cosId)
      if (!course) {
        actions.append(el('span', 'muted', '課程資料裡找不到這門課，請先更新課程資料再查詢'))
      } else if (s && s.status === 'querying') {
        actions.append(el('span', 'muted', '查詢中…'))
      } else {
        const q = el('button', '', s && s.status === 'queried' ? '重新查詢' : '查詢')
        q.type = 'button'
        q.addEventListener('click', () => ctx.onQuery(course))
        actions.append(q)
        if (s && s.status === 'error') actions.append(el('span', 'error', s.msg))
        if (s && s.status === 'registered') actions.append(el('span', 'ok', s.msg))
      }
      if (status.state === 'preregist') {
        const rm = el('button', 'danger', '從預排移除')
        rm.type = 'button'
        rm.addEventListener('click', () => {
          close()
          ctx.onRemove(item)
        })
        actions.append(rm)
      }
    }
    dialog.append(actions)
    if (course) {
      const rows = renderQueryRows(course, ctx.queryState(item.cosId), status, (c, row) => ctx.onRegister(c, row))
      if (rows) dialog.append(rows)
    }
  }

  return {
    open(item, anchor) {
      current = { item, anchor }
      draw()
      if (!dialog.open) dialog.show()
      place(anchor)
    },
    refresh() {
      if (!current) return
      draw()
      place(current.anchor.isConnected ? current.anchor : null)
    },
    close,
  }
}
```

- [ ] **Step 3: 串進 `src/planner.js`**

1. import：
   - `import { createCourseDetail } from './planner/course-detail.js'`
   - `./lib/attribution.js` 的 import 加上 `restoreParams`
2. 刪掉 Task 4 放的暫時 `openDetail`，加：

```js
// ---------- 課表上的課：詳情、移除預排 ----------

let detail = null
let toastTimer = null

function openDetail(item, anchor) {
  detail.open(item, anchor)
}

function showToast(text, action) {
  const toast = $('#toast')
  toast.replaceChildren(document.createTextNode(text))
  if (action) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'link'
    b.textContent = action.label
    b.addEventListener('click', () => {
      toast.hidden = true
      action.run()
    })
    toast.append('・', b)
  }
  toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.hidden = true), 10_000)
}

// 從預排移除：content script 會先確認不是正式選課的課；成功後可以復原（用原本的採計方式加回去）
async function removeFromPrereg(item) {
  const record = preregItem(item.cosId)
  const reply = await askCos({ type: 'removepreregist', cosId: item.cosId })
  if (!reply || !reply.ok) return showToast(needsCos(reply) ? '請先開啟並登入選課網' : cosProblem(reply))
  if (!reply.removed) return showToast(reply.msg)
  const { schedule } = await chrome.storage.local.get('schedule')
  const src = schedule && schedule.sources && schedule.sources.preregist
  if (src) {
    src.courses = (src.courses || []).filter((c) => String(c.cos_id) !== String(item.cosId))
    await chrome.storage.local.set({ schedule })
  }
  showToast(`已從預排移除 ${item.title}`, record ? { label: '復原', run: () => restorePrereg(item, record) } : null)
  syncStatus()
}

async function restorePrereg(item, record) {
  const id = String(item.cosId)
  const reply = await askCos({ type: 'import', ids: [id], params: { [id]: restoreParams(record) } })
  const result = reply && reply.ok && reply.results && reply.results[0]
  if (result && (result.status === 'added' || result.status === 'exists')) showToast(`已復原 ${item.title}`)
  else showToast(`復原失敗：${result ? result.msg || '加入失敗' : cosProblem(reply)}。請到選課網重新加入。`)
  syncStatus()
}
```

3. `init` 在建立 `timetable` 後加：

```js
  detail = createCourseDetail($('#detail'), {
    semester: () => (state.courseData && state.courseData.semester) || '',
    status: (id) => courseStatuses(state.schedule).get(String(id)),
    findCourse: (id) => courses().find((c) => String(c.id) === String(id)) || null,
    queryState: (id) => addState.get(String(id)),
    onQuery: queryCourse,
    onRegister: registerCourse,
    onRemove: removeFromPrereg,
  })
```

4. `renderResults()` 最後（`renderResultList(...)` 之後）以及函式裡每個提早 `return` 前，都讓小卡跟著更新。最簡單的做法是把原本的 `renderResults` 改名 `drawResults`，再包一層：

```js
function renderResults() {
  drawResults()
  if (detail) detail.refresh()
}
```

- [ ] **Step 4: 小卡與 toast 樣式（`src/planner.css`）**

```css
/* 課表上的課的詳情小卡（非 modal，開在卡片旁；窄視窗置中） */
.detail { position: fixed; margin: 0; z-index: 10; width: min(360px, calc(100vw - 32px)); padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: Canvas; color: CanvasText; box-shadow: 0 8px 24px rgba(0, 0, 0, .18); }
.detail.centered { left: 50%; top: 50%; transform: translate(-50%, -50%); }
.detail-head { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; }
.detail-title { font-weight: 600; color: inherit; }
.detail-close { border: none; background: none; padding: 0 4px; }
.detail-line { margin: 4px 0 0; font-size: 13px; color: var(--muted); }
.detail-actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-top: 10px; }
.detail .danger { color: var(--error); border-color: var(--error); }
.detail .ok { color: var(--ok); font-size: 12px; }
.detail .error { color: var(--error); font-size: 12px; }
.detail .query-rows { margin-top: 8px; }

.toast { position: fixed; left: 50%; bottom: 20px; transform: translateX(-50%); z-index: 20; padding: 8px 14px; border-radius: 8px; background: CanvasText; color: Canvas; font-size: 13px; box-shadow: 0 4px 16px rgba(0, 0, 0, .2); }
.toast[hidden] { display: none; }
.toast button.link { color: Canvas; font-size: 13px; }
```

- [ ] **Step 5: E2E（`e2e/layout.mjs` 繼續加）**

1. 模擬選課網加上 `deletepreregist`：記錄呼叫，並從模擬的預排清單移除；回傳 `[{ status: 'success' }]`。
2. 模擬選課網加上 `getregist`，回傳 `cosState.registered`。
3. 再加一個測試用的已選上課號 `R9`：它同時在 getregist 和預排裡。

```js
  // 6. 點預排的課 → 查詢 → 送出登記；點已選上的課沒有移除鈕
  await page.click('.tt-course[data-item="preregist:P1"]')
  r.detailOpen = await page.$eval('#detail', (d) => d.open)
  r.hasRemove = (await page.$$('#detail button.danger')).length === 1
  await page.click('#detail button:has-text("查詢")')
  await page.waitForSelector('#detail .query-row button', { timeout: 10000 })
  await page.click('#detail .query-row button')
  await page.waitForSelector('#confirm[open]')
  await page.click('#btn-submit')
  await page.waitForTimeout(800)
  r.registered = regSets.some((p) => p.cos_id === 'P1')
  await page.keyboard.press('Escape')
  await page.click('.tt-course[data-item^="registered:"] >> nth=0')
  r.registeredNoRemove = (await page.$$('#detail button.danger')).length === 0
  await page.keyboard.press('Escape')
  // 7. 移除 → 課表少一堂 → 復原 → 用原參數 setpreregist
  await page.click('.tt-course[data-item="preregist:P2"]')
  await page.click('#detail button.danger')
  await page.waitForSelector('#toast:not([hidden])')
  r.toast = await page.textContent('#toast')
  r.p2Gone = (await page.$$('.tt-course[data-item="preregist:P2"]')).length === 0
  const setsBefore = sets.length
  await page.click('#toast button')
  await page.waitForTimeout(800)
  r.restoreSent = sets.length === setsBefore + 1 && sets.at(-1).cos_id === 'P2'
  // 已在正式選課的課：拒絕移除，沒有呼叫 deletepreregist
  const delBefore = deletes.length
  r.blocked = await page.evaluate(async () => {
    const { askCos } = await import(chrome.runtime.getURL('src/cos-tab.js'))
    return askCos({ type: 'removepreregist', cosId: 'R9' })
  })
  r.noDeleteForRegistered = deletes.length === delBefore && r.blocked.removed === false && /已在正式選課/.test(r.blocked.msg)
```

checks：

```js
    detailOpens: r.detailOpen === true && r.hasRemove,
    registerFromDetail: r.registered,
    registeredHasNoRemove: r.registeredNoRemove,
    removeShowsUndo: /已從預排移除/.test(r.toast) && /復原/.test(r.toast) && r.p2Gone,
    undoRestores: r.restoreSent,
    refusesRegisteredRemoval: r.noDeleteForRegistered,
```

   Run: `node e2e/layout.mjs && node e2e/planner.mjs && node e2e/register.mjs`，Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/planner/course-detail.js src/planner/results.js src/planner.js src/planner.css
git commit -m "當期選課：課表上的課可看詳情、查詢登記、從預排移除並復原"
```

---

### Task 6: 窄視窗、深色模式、版本、README、截圖

**Files:**
- Modify: `manifest.json`、`package.json`（0.10.0）
- Modify: `README.md`（「當期選課」一節）
- Test: `e2e/layout.mjs`

- [ ] **Step 1: 窄視窗與深色模式 E2E**

```js
  // 8. 窄視窗上下排，篩選面板在工具列下方
  await page.setViewportSize({ width: 800, height: 900 })
  await page.click('#filter-toggle')
  r.narrow = await page.evaluate(() => {
    const res = document.querySelector('.results-pane').getBoundingClientRect()
    const plan = document.querySelector('.plan-pane').getBoundingClientRect()
    return { stacked: plan.top >= res.bottom - 1, panelInLeft: document.querySelector('#narrow-slot').contains(document.querySelector('#filter-panel')) }
  })
  await page.screenshot({ path: path.join(OUT, 'layout-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: path.join(OUT, 'layout-dark.png') })
  await page.emulateMedia({ colorScheme: 'light' })
```

checks：`narrowStacked: r.narrow.stacked && r.narrow.panelInLeft`

另外在前面各情境拍下截圖（`layout-default.png` 面板關閉、`layout-panel.png` 面板打開、`layout-five.png` 同格五堂、`layout-detail.png` 詳情小卡）。

Run: `node e2e/layout.mjs`，Expected: PASS。

- [ ] **Step 2: 版本與 README**

- `manifest.json`、`package.json`：`"version": "0.10.0"`；scratchpad e2e 裡的 `0.9.2` 全部換成 `0.10.0`。
- `README.md` 的「### 當期選課：找空堂課程」一節改成「### 當期選課」，步驟改成：

```markdown
點擴充功能右上的「當期選課 ↗」，打開當期選課頁。左邊是搜尋結果，右邊是你目前的課表。

1. 按左上的「篩選」打開篩選面板（蓋在課表上）：
   - **時段**：在格子上按住拖曳框選想上課的時段，或按「帶入空堂」。
   - **比對方式**：完全落在內，或部分重疊（標出超出的節次）。
   - **校區、類別、系所**（可複選、可搜尋）。
   設定時左邊結果會即時更新，設定好按 ✕ 或 Esc 關掉。
2. 關鍵字和排序在搜尋結果上方，隨時可以改。
3. 右邊課表放已選上、已登記、在預排的課和私人行程，依狀態上色。同一節有很多堂時格子會撐高，全部列出；已選上或已登記的課又疊了別的課會加紅框。
4. 滑過左邊的課，右邊會標出它的時段。
5. 點課表上的課可以看詳情、查詢並加選或登記；預排的課可以「從預排移除」，10 秒內可以按「復原」。已選上、已登記的課不提供移除。
```

  判斷已選上、已登記與送出方式的說明（0.9.2 加的）保留在這一節最後。

- [ ] **Step 3: 全部測試**

Run: `npm test`，以及 scratchpad：`for t in planner layout register autoreg popup-tabs schedule attribution closed sysstatus tolerance fallback; do node e2e/$t.mjs | tail -1; done`，Expected: 全部 PASS。

- [ ] **Step 4: Commit，截圖給使用者看**

```bash
git add manifest.json package.json README.md
git commit -m "版本 0.10.0：當期選課新版面"
```

用 SendUserFile 送 `layout-default.png`、`layout-panel.png`、`layout-five.png`、`layout-detail.png`、`layout-narrow.png`、`layout-dark.png`，等使用者確認後才合併、推送與發布。商店截圖與說明這次不動。
