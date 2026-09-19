# Popup 迷你課表與 tab 架構 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the popup into a tab shell whose tabs are 「加入預排」 (the current popup) and 「課表」 (a compact weekly timetable that answers "where is my next class").

**Architecture:** Pure logic lives in `src/lib/`: which items to show, how to merge consecutive periods into blocks, where "now" and "next" are, and which tab to open. All of it is unit-tested with `node --test`. The popup becomes a thin shell driven by a tab list; each tab is an ES module with `mount(container, ctx)` and `show()`. Search and add is one component used by both tabs. Connection to the cos tab stays shared.

**Tech Stack:** Chrome MV3 extension with plain ES modules and no build step. `node --test` for unit tests. Playwright-core 1.63 with Chrome for Testing (headless) for E2E; the scripts live in the session scratchpad `e2e/` directory, not in the repo.

**Spec:** `docs/superpowers/specs/2026-09-19-popup-mini-timetable-design.md`

## Global Constraints

- Update 2026-09-19 (user decision after checkpoint 1): no 「上課中／下一堂」 text line and no next/current block highlight. The 課表 tab shows only the timetable (today column + now line kept). `describeNow` was removed. Task 7 drops `.now-line-text`, the `next`/`current` classes and their CSS. Task 8 drops the `nextLine`/`nextBlockHighlighted` checks.

- The popup holds only small tools. Large features open a new Chrome tab, not a popup tab.
- Tab order is 1. `add`（加入預排） 2. `schedule`（課表）. The last used tab is remembered in `chrome.storage.local` key `popupTab`. Unknown or unreadable values fall back to the first tab.
- The 課表 tab shows 正式選課 (`schedule.sources.registered`), 自訂行程 and overrides. It does not show 預排.
- Only the period range that has classes is listed. Weekend columns appear only when there are items that day. Consecutive periods of the same item merge into one block.
- "Now / next" is computed from clock minutes, not period codes.
- Clicking a cell always opens the detail card first. Links live inside the card. The popup never edits links; 「設定連結」 opens `src/schedule.html`.
- The popup is about 420px wide, at most 600px tall, and follows the system light/dark mode.
- Keep every existing popup element id inside the 加入預排 tab so existing E2E scripts keep working. That includes `#q`, `#search-results`, `#search-summary`, `#btn-counts`, `#bulk`, `#ids`, `#btn-import`, `#hint`, `#results`, `#group-*`, `#btn-crawl`, `#data-status`, `#crawl-*`, `#tab-bar`, `#tab-status`, `#btn-open`, `#btn-reload`, `#sys-status` and `#semester-warning`. `#btn-register` and `#btn-schedule` move to the shell.
- UI text is Traditional Chinese, matching the existing tone.
- Never call `deleteregist`, and never remove registered courses.
- Version bump to `0.7.0` in both `manifest.json` and `package.json` (a test enforces that they match).
- Commit messages are in Chinese and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

Spec deviation (approved simplification): the spec mentions a 「⋯」 menu for rarely used actions. This plan puts two plain buttons 「週課表 ↗」 and 「選課 ↗」 on the right of the tab strip instead, and 「更新課程資料」 stays in the 加入預排 tab where it already is. That avoids a menu component (YAGNI).

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/schedule.js` (modify) | add `scheduleItems`, `withSyncedSources`, `mergeBlocks` |
| `src/lib/now.js` (create) | `locateNow`, `describeNow` |
| `src/lib/tabs.js` (create) | `pickTab` |
| `src/schedule.js`, `src/register.js` (modify) | use `scheduleItems` / `withSyncedSources` instead of local copies |
| `src/popup.html` (rewrite) | shell (tab strip, panels) plus one `<template>` per tab |
| `src/popup.css` (modify) | shell, tab strip, mini timetable styles |
| `src/popup.js` (rewrite) | shell: tab list, switching, remembering, `ctx` |
| `src/popup/shared.js` (create) | shared popup state and helpers (`state`, `$`, `code`, `showHint`, `formatTime`) |
| `src/popup/cos.js` (create) | cos tab connection: `send`, `detectTab`, `reloadCos`, status refresh, `unavailableMessage`, `getDepTree`, `getCourseList`, change listeners |
| `src/popup/course-search.js` (create) | search + add + attribution choice + seat counts; `createCourseSearch(elements)` |
| `src/popup/tabs/add.js` (create) | 加入預排 tab: data bar, crawl progress, semester warning, bulk import, one search instance |
| `src/popup/tabs/schedule.js` (create) | 課表 tab: mini timetable, next line, detail card, search instance, background refresh |
| `test/schedule.test.js`, `test/now.test.js`, `test/tabs.test.js` | unit tests |
| scratchpad `e2e/popup-tabs.mjs` (create) | E2E for the new tabs |

---

### Task 1: `scheduleItems` and `withSyncedSources` in `lib/schedule.js`

These two are already written inline in `src/schedule.js` (`syncedItems`/`currentItems`/`sync`) and `src/register.js` (`refreshRegistered`). Move them into the library so the popup can share them.

**Files:**
- Modify: `src/lib/schedule.js` (append)
- Modify: `src/schedule.js` (replace `syncedItems`, `currentItems`, the source-writing part of `sync`)
- Modify: `src/register.js` (replace the source-writing part of `refreshRegistered`)
- Test: `test/schedule.test.js` (append)

**Interfaces:**
- Produces: `scheduleItems(schedule, sources: string[]) -> Item[]`. Synced items come first (the earlier source wins on duplicate `cosId`), then manual items, then overrides are applied.
- Produces: `withSyncedSources(schedule, reply: {preregist?: object[], registered?: object[]}, nowMs: number) -> schedule`. Returns a new object whose `sources.registered` and `sources.preregist` are `{ semester, updatedAt: nowMs, courses }`.

- [ ] **Step 1: Write the failing tests** (append to `test/schedule.test.js`; add `scheduleItems, withSyncedSources` to its import line)

```js
test('scheduleItems 合併來源、前面的來源優先、加上自訂行程並套用覆寫', () => {
  const schedule = {
    sources: {
      registered: { semester: '1151', courses: [{ cos_id: '1', cos_cname: '線性代數', cos_time: 'W34-SC201[GF]', sFlag: 'F' }] },
      preregist: { semester: '1151', courses: [{ cos_id: '1', cos_cname: '線性代數', cos_time: 'W34-SC201[GF]' }, { cos_id: '2', cos_cname: '計概', cos_time: 'R56-EC115[GF]' }] },
    },
    manual: [manualItem({ id: 'm1', title: '社團', slots: [{ day: 2, period: 'a' }] })],
    overrides: { 1: { url: 'https://e3.example/1' } },
  }
  const reg = scheduleItems(schedule, ['registered'])
  assert.deepEqual(reg.map((i) => i.key), ['registered:1', 'manual:m1'])
  assert.equal(reg[0].url, 'https://e3.example/1')
  const all = scheduleItems(schedule, ['registered', 'preregist'])
  assert.deepEqual(all.map((i) => i.key), ['registered:1', 'preregist:2', 'manual:m1'])
  assert.deepEqual(scheduleItems(undefined, ['registered']), [])
})

test('withSyncedSources 寫入正式選課與預排並記下時間與學期', () => {
  const before = { sources: { other: { courses: [] } }, manual: [{ key: 'manual:x' }], overrides: { 1: { color: '#fff' } } }
  const next = withSyncedSources(before, { registered: [{ cos_id: '1', acy: '115', sem: '1' }], preregist: [] }, 1000)
  assert.deepEqual(next.sources.registered, { semester: '1151', updatedAt: 1000, courses: [{ cos_id: '1', acy: '115', sem: '1' }] })
  assert.deepEqual(next.sources.preregist, { semester: '', updatedAt: 1000, courses: [] })
  assert.deepEqual(next.sources.other, { courses: [] })
  assert.deepEqual(next.manual, before.manual)
  assert.notEqual(next, before)
  assert.deepEqual(withSyncedSources(undefined, {}, 5).sources.registered, { semester: '', updatedAt: 5, courses: [] })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/nycucourse-extension && node --test test/schedule.test.js`
Expected: FAIL with `scheduleItems is not a function` (or a SyntaxError for the missing export).

- [ ] **Step 3: Implement** (append to `src/lib/schedule.js`)

```js
// 課表要顯示的項目：同步進來的課（依 sources 的順序，同一課號前面的來源優先）＋自訂行程，
// 再套用使用者的覆寫。所有來源都從這裡匯入；之後加外部行事曆也是在這裡多一種來源。
export function scheduleItems(schedule, sources) {
  const s = schedule || {}
  const seen = new Set()
  const items = []
  for (const name of sources || []) {
    const src = (s.sources || {})[name]
    for (const course of (src && src.courses) || []) {
      const item = courseToItem(course, { source: name, semester: src.semester })
      if (seen.has(item.cosId)) continue
      seen.add(item.cosId)
      items.push(item)
    }
  }
  const manual = (s.manual || []).map((m) => ({ ...m }))
  return applyOverrides([...items, ...manual], s.overrides || {})
}

// 把選課網同步回來的正式選課與預排寫進 schedule（回傳新物件）
export function withSyncedSources(schedule, reply, nowMs) {
  const semesterOf = (list) => {
    const c = (list || [])[0]
    return c && c.acy ? `${c.acy}${c.sem}` : ''
  }
  const base = { sources: {}, manual: [], overrides: {}, ...(schedule || {}) }
  const r = reply || {}
  return {
    ...base,
    sources: {
      ...(base.sources || {}),
      registered: { semester: semesterOf(r.registered), updatedAt: nowMs, courses: r.registered || [] },
      preregist: { semester: semesterOf(r.preregist), updatedAt: nowMs, courses: r.preregist || [] },
    },
  }
}
```

- [ ] **Step 4: Use them in the pages**

In `src/schedule.js`:
- Import `scheduleItems, withSyncedSources` from `./lib/schedule.js`.
- Delete `syncedItems()`.
- Replace the body of `currentItems()` with:

```js
function currentItems() {
  const wanted = state.source === 'all' ? ['registered', 'preregist'] : [state.source]
  return scheduleItems(state.schedule, wanted)
}
```

- In `sync()`, replace everything from `const now = Date.now()` through `state.schedule = { ...state.schedule, sources }` with the following. The following `save()`, `render()` and `showMessage(...)` lines stay; change the message to use `state.schedule.sources`.

```js
    state.schedule = withSyncedSources(state.schedule, reply, Date.now())
    const sources = state.schedule.sources
```

In `src/register.js` `refreshRegistered()`:
- Import `withSyncedSources` from `./lib/schedule.js`.
- Replace from `const now = Date.now()` through `await chrome.storage.local.set({ schedule: next })` with:

```js
  const { schedule } = await chrome.storage.local.get('schedule')
  await chrome.storage.local.set({ schedule: withSyncedSources(schedule, reply, Date.now()) })
```

(Keep the two `state.registered` / `state.courses` lines after it.)

- [ ] **Step 5: Run all unit tests**

Run: `cd ~/nycucourse-extension && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 6: Commit**

```bash
cd ~/nycucourse-extension && git add src/lib/schedule.js src/schedule.js src/register.js test/schedule.test.js && git commit -m "課表項目與同步寫入改為共用函式 scheduleItems、withSyncedSources

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `mergeBlocks`: merge consecutive periods and handle conflicts

**Files:**
- Modify: `src/lib/schedule.js` (append)
- Test: `test/schedule.test.js` (append; add `mergeBlocks` to the import)

**Interfaces:**
- Consumes: `buildWeek(items) -> { days: number[], rows: [{code,label,start,end,cells:{[day]: Item&{room,campus}[]}}], dayNames }` (existing).
- Produces: `mergeBlocks(week) -> { days, dayNames, rows: [{code,label,start,end,startMin,endMin}], blocks: Block[] }`.
  - `Block = { key, item, day, row, span, startMin, endMin, start, end, room, lane, lanes }`.
  - `row` is the 0-based index into `rows`, and `span` is the number of rows covered.
  - `start` and `end` are `HH:MM` strings; `startMin` and `endMin` are minutes since midnight.
  - `room` is the unique rooms joined with `/`.
  - `lane` and `lanes` handle conflicts: `lanes > 1` means a conflict, and `lane` is the 0-based position.

- [ ] **Step 1: Write the failing tests**

```js
test('mergeBlocks 把同一天同一門課的連續節次合併成一個區塊', () => {
  const items = [
    courseToItem({ cos_id: '1', cos_cname: '線性代數', cos_time: 'W34T34-SC201[GF]' }, { source: 'registered' }),
    courseToItem({ cos_id: '2', cos_cname: '導師時間', cos_time: 'M5-SC101[GF]' }, { source: 'registered' }),
  ]
  const layout = mergeBlocks(buildWeek(items))
  assert.deepEqual(layout.rows.map((r) => r.code), ['3', '4', 'n', '5'])
  assert.equal(layout.rows[0].startMin, 610)
  const wed = layout.blocks.find((b) => b.day === 3)
  assert.deepEqual(
    { row: wed.row, span: wed.span, start: wed.start, end: wed.end, startMin: wed.startMin, endMin: wed.endMin, room: wed.room, lanes: wed.lanes },
    { row: 0, span: 2, start: '10:10', end: '12:00', startMin: 610, endMin: 720, room: 'SC201', lanes: 1 },
  )
  assert.equal(layout.blocks.length, 3)
})

test('mergeBlocks 衝堂時兩門課都保留並標示 lane', () => {
  const items = [
    courseToItem({ cos_id: '1', cos_cname: '甲', cos_time: 'M12-A101[GF]' }, { source: 'registered' }),
    courseToItem({ cos_id: '2', cos_cname: '乙', cos_time: 'M2-B202[GF]' }, { source: 'registered' }),
  ]
  const { blocks } = mergeBlocks(buildWeek(items))
  const a = blocks.find((b) => b.item.cosId === '1')
  const b = blocks.find((x) => x.item.cosId === '2')
  assert.equal(a.lanes, 2)
  assert.equal(b.lanes, 2)
  assert.notEqual(a.lane, b.lane)
})

test('mergeBlocks 同一門課不同節在不同教室時合併教室', () => {
  const items = [courseToItem({ cos_id: '1', cos_cname: '實驗', cos_time: 'F3-A101[GF],F4-B202[GF]' }, { source: 'registered' })]
  const [block] = mergeBlocks(buildWeek(items)).blocks
  assert.equal(block.span, 2)
  assert.equal(block.room, 'A101/B202')
})

test('mergeBlocks 沒有行程時回空區塊', () => {
  assert.deepEqual(mergeBlocks(buildWeek([])).blocks, [])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/schedule.test.js`
Expected: FAIL with `mergeBlocks is not a function`.

- [ ] **Step 3: Implement** (append to `src/lib/schedule.js`)

```js
const minutesOf = (hhmm) => {
  const [h, m] = str(hhmm).split(':').map(Number)
  return h * 60 + m
}

// 把 buildWeek 的格子合併成區塊：同一天、同一個項目的連續節次合成一塊。
// 同一格有多個項目（衝堂）時，用 lane / lanes 並排。時間一律換算成分鐘，給 locateNow 用。
export function mergeBlocks(week) {
  const rows = (week.rows || []).map(({ code, label, start, end }) => ({ code, label, start, end, startMin: minutesOf(start), endMin: minutesOf(end) }))
  const blocks = []
  for (const day of week.days || []) {
    const open = new Map() // item.key -> block（還在延伸中的區塊）
    week.rows.forEach((row, r) => {
      const here = row.cells[day] || []
      for (const key of [...open.keys()]) if (!here.some((x) => x.key === key)) open.delete(key)
      for (const entry of here) {
        const block = open.get(entry.key)
        if (block) {
          block.span += 1
          block.end = row.end
          block.endMin = rows[r].endMin
          if (entry.room && !block.rooms.includes(entry.room)) block.rooms.push(entry.room)
          block.lanes = Math.max(block.lanes, here.length)
        } else {
          const { room, campus, ...item } = entry
          const created = { key: `${entry.key}|${day}|${r}`, item, day, row: r, span: 1, start: row.start, end: row.end, startMin: rows[r].startMin, endMin: rows[r].endMin, rooms: room ? [room] : [], lane: here.indexOf(entry), lanes: here.length }
          open.set(entry.key, created)
          blocks.push(created)
        }
      }
    })
  }
  return {
    days: week.days || [],
    dayNames: week.dayNames || DAY_NAMES,
    rows,
    blocks: blocks.map(({ rooms, ...b }) => ({ ...b, room: rooms.join('/') })),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/schedule.js test/schedule.test.js && git commit -m "新增 mergeBlocks：連續節次合併成區塊、衝堂並排

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: `locateNow` and `describeNow` (`lib/now.js`)

**Files:**
- Create: `src/lib/now.js`
- Test: `test/now.test.js`

**Interfaces:**
- Consumes: the layout from `mergeBlocks` (Task 2).
- Produces: `locateNow(layout, now: Date) -> { today, current, next, nextDayOffset, minutesUntilNext, nowLine }`.
  - `today` is 1–7, Monday = 1.
  - `current` and `next` are Blocks or null.
  - `nextDayOffset` is 0 when `next` is today, up to 7.
  - `minutesUntilNext` is a number only when `nextDayOffset === 0`, otherwise null.
  - `nowLine` is `{ row, fraction }` or null. `fraction` is in [0, 1]; a line between two rows is `{ row: r, fraction: 1 }`.
- Produces: `describeNow(located) -> string[]`, one or two display lines.

- [ ] **Step 1: Write the failing tests** (`test/now.test.js`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { courseToItem, manualItem, buildWeek, mergeBlocks, slotsFromTimeRange } from '../src/lib/schedule.js'
import { locateNow, describeNow } from '../src/lib/now.js'

// 2026-09-21 是週一
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2026, 8, 20 + day, h, m)
}
const layoutOf = (...courses) => mergeBlocks(buildWeek(courses.map((c, i) => courseToItem({ cos_id: String(i + 1), ...c }, { source: 'registered' }))))
const week = layoutOf(
  { cos_cname: '微積分', cos_time: 'M12W12-SA101[GF]' },
  { cos_cname: '線性代數', cos_time: 'T34W34-SC201[GF]' },
  { cos_cname: '導師時間', cos_time: 'M5-SC101[GF]' },
)

test('上課中：current 是這堂，next 是今天稍後的課', () => {
  const r = locateNow(week, at(3, '08:30'))
  assert.equal(r.today, 3)
  assert.equal(r.current.item.title, '微積分')
  assert.equal(r.next.item.title, '線性代數')
  assert.equal(r.nextDayOffset, 0)
  assert.equal(r.minutesUntilNext, 100)
  assert.deepEqual(r.nowLine, { row: 0, fraction: 0.6 })
})

test('課間休息：沒有 current，時間線在兩節之間', () => {
  const r = locateNow(week, at(3, '10:05'))
  assert.equal(r.current, null)
  assert.equal(r.next.item.title, '線性代數')
  assert.equal(r.minutesUntilNext, 5)
  assert.deepEqual(r.nowLine, { row: 1, fraction: 1 })
})

test('午休（N 節）落在列出的範圍內', () => {
  const r = locateNow(week, at(1, '12:30'))
  assert.equal(r.next.item.title, '導師時間')
  assert.equal(week.rows[r.nowLine.row].code, 'n')
})

test('今天已經沒課：next 是之後最近一天的第一堂', () => {
  const r = locateNow(week, at(3, '15:00'))
  assert.equal(r.current, null)
  assert.equal(r.next.day, 1)
  assert.equal(r.nextDayOffset, 5)
  assert.equal(r.minutesUntilNext, null)
  assert.equal(r.nowLine, null)
})

test('週末與深夜：沒有時間線，next 是週一', () => {
  const r = locateNow(week, at(6, '23:00'))
  assert.equal(r.nowLine, null)
  assert.equal(r.next.day, 1)
  assert.equal(r.nextDayOffset, 2)
})

test('同一天稍晚的課：週一 14:00 之後的下一堂是週二', () => {
  const r = locateNow(week, at(1, '14:30'))
  assert.equal(r.next.day, 2)
  assert.equal(r.nextDayOffset, 1)
})

test('這週完全沒課', () => {
  const r = locateNow(mergeBlocks(buildWeek([])), at(3, '10:00'))
  assert.deepEqual([r.current, r.next, r.nowLine], [null, null, null])
  assert.deepEqual(describeNow(r), ['這週沒有課'])
})

test('自訂時間的行程也能計算', () => {
  const item = manualItem({ id: 'x', title: '社團', slots: slotsFromTimeRange(2, '18:40', '20:10', '活動中心') })
  const r = locateNow(mergeBlocks(buildWeek([item])), at(2, '18:45'))
  assert.equal(r.current.item.title, '社團')
})

test('describeNow 上課中與下一堂的文字', () => {
  assert.deepEqual(describeNow(locateNow(week, at(3, '08:30'))), [
    '上課中：微積分・SA101，09:50 下課',
    '下一堂 10:10（1 小時 40 分鐘後）・線性代數・SC201',
  ])
  assert.deepEqual(describeNow(locateNow(week, at(3, '10:05'))), ['下一堂 10:10（5 分鐘後）・線性代數・SC201'])
  assert.deepEqual(describeNow(locateNow(week, at(1, '14:30'))), ['下一堂 明天 10:10・線性代數・SC201'])
  assert.deepEqual(describeNow(locateNow(week, at(3, '15:00'))), ['下一堂 週一 08:00・微積分・SA101'])
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/now.test.js`
Expected: FAIL with `Cannot find module '../src/lib/now.js'`.

- [ ] **Step 3: Implement** (`src/lib/now.js`)

```js
// 現在與下一堂。只用鐘點（分鐘）計算，不看節次代碼，
// 之後任意時間的活動（例如外部行事曆）也能直接放進來。
import { DAY_NAMES } from './periods.js'

const weekday = (date) => ((date.getDay() + 6) % 7) + 1 // 週一 = 1 … 週日 = 7

export function locateNow(layout, now) {
  const today = weekday(now)
  const minute = now.getHours() * 60 + now.getMinutes()
  const blocks = [...(layout.blocks || [])].sort((a, b) => a.day - b.day || a.startMin - b.startMin || a.lane - b.lane)
  const todays = blocks.filter((b) => b.day === today)
  const current = todays.find((b) => b.startMin <= minute && minute < b.endMin) || null

  let next = todays.find((b) => b.startMin > minute) || null
  let nextDayOffset = next ? 0 : null
  for (let offset = 1; !next && offset <= 7; offset++) {
    const day = ((today - 1 + offset) % 7) + 1
    const first = blocks.find((b) => b.day === day)
    if (first) {
      next = first
      nextDayOffset = offset
    }
  }

  return {
    today,
    current,
    next,
    nextDayOffset,
    minutesUntilNext: next && nextDayOffset === 0 ? next.startMin - minute : null,
    nowLine: nowLineOf(layout, today, minute),
  }
}

function nowLineOf(layout, today, minute) {
  const rows = layout.rows || []
  if (!rows.length || !(layout.days || []).includes(today)) return null
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.startMin <= minute && minute < row.endMin) {
      return { row: r, fraction: Math.round(((minute - row.startMin) / (row.endMin - row.startMin)) * 100) / 100 }
    }
    const following = rows[r + 1]
    if (following && row.endMin <= minute && minute < following.startMin) return { row: r, fraction: 1 }
  }
  return null
}

function duration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} 分鐘後`
  return m ? `${h} 小時 ${m} 分鐘後` : `${h} 小時後`
}

const place = (block) => [block.item.title, block.room].filter(Boolean).join('・')

export function describeNow(located) {
  const lines = []
  if (located.current) lines.push(`上課中：${place(located.current)}，${located.current.end} 下課`)
  const next = located.next
  if (next) {
    const when =
      located.nextDayOffset === 0
        ? `${next.start}（${duration(located.minutesUntilNext)}）`
        : `${located.nextDayOffset === 1 ? '明天' : `週${DAY_NAMES[next.day]}`} ${next.start}`
    lines.push(`下一堂 ${when}・${place(next)}`)
  }
  if (!lines.length) lines.push('這週沒有課')
  return lines
}
```

- [ ] **Step 4: Run tests**

Run: `npm test 2>&1 | grep -E "^ℹ (pass|fail)"`
Expected: `fail 0`. If `'今天已經沒課'` fails on `nextDayOffset`: Wednesday + 5 = Monday, so the expected value 5 is correct; fix the code, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/now.js test/now.test.js && git commit -m "新增 locateNow、describeNow：用鐘點算出上課中、下一堂與時間線

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `pickTab` (`lib/tabs.js`)

**Files:**
- Create: `src/lib/tabs.js`
- Test: `test/tabs.test.js`

**Interfaces:**
- Produces: `pickTab(tabs: {id:string}[], saved: unknown) -> string`. Returns `saved` if it is one of the tab ids, otherwise the first tab's id, or `''` if there are no tabs.

- [ ] **Step 1: Write the failing tests**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickTab } from '../src/lib/tabs.js'

const tabs = [{ id: 'add' }, { id: 'schedule' }]

test('pickTab 用記住的 tab', () => {
  assert.equal(pickTab(tabs, 'schedule'), 'schedule')
})

test('pickTab 記住的 tab 不存在或讀不到時用第一個', () => {
  assert.equal(pickTab(tabs, 'planner'), 'add')
  assert.equal(pickTab(tabs, undefined), 'add')
  assert.equal(pickTab(tabs, 42), 'add')
  assert.equal(pickTab([], 'add'), '')
})
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test test/tabs.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```js
// popup 要開哪個 tab：記住的 tab 還在清單裡就用它，否則用第一個
export function pickTab(tabs, saved) {
  const list = tabs || []
  if (typeof saved === 'string' && list.some((t) => t.id === saved)) return saved
  return list.length ? list[0].id : ''
}
```

- [ ] **Step 4: Run tests.** Expect `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tabs.js test/tabs.test.js && git commit -m "新增 pickTab：popup 記住上次的 tab

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Split `popup.js` into shared modules without changing behavior

This is a pure refactor: the popup looks and behaves exactly as today. It prepares for the tab shell by moving code out of `src/popup.js` into modules. At the end of this task, `popup.js` still renders the current single page.

**Files:**
- Create: `src/popup/shared.js`, `src/popup/cos.js`, `src/popup/course-search.js`, `src/popup/tabs/add.js`
- Modify: `src/popup.js` (becomes a small entry that calls `mountAdd(document.body)`)

**Interfaces:**
- `shared.js` exports:
  - `state`: the existing `state` object, unchanged fields.
  - `$`, `code(text)`, `showHint(el, text, kind)`, `formatTime(ms)`: moved verbatim.
- `cos.js` exports:
  - `send(tabId, message)`, `detectTab()`, `reloadCos()`, `refreshCosSemester()`, `refreshSysStatus()`, `unavailableMessage()`, `getDepTree()`, `getCourseList(menu)`, `findCosTab()`.
  - `onCosChange(fn)`: registers a callback that runs whenever `state.onCos`, `cosReady`, `connecting`, `reloading`, `needsReload`, `cosSemester`, `regStatus` or `sysStatus` change.
  - Every place that used to call `renderTabBar()`, `renderSearch()`, `renderSysStatus()` or `renderSemesterWarning()` now calls the internal `notify()` instead.
  - `findCosTab()` is new: `(await chrome.tabs.query({ url: 'https://cos.nycu.edu.tw/*' }))[0] || null`.
- `course-search.js` exports:
  - `createCourseSearch({ q, list, summary, countsBtn })`: `countsBtn` may be null. It returns `{ render() }`, registers the instance, and wires `q`'s input event and `countsBtn`'s click.
  - `renderAllSearches()`: re-renders every instance.
  - `addStatus` lives in `state.addStatus` (shared), so both tabs show the same 已加入 state.
- `tabs/add.js` exports `mount(root)` and `show()`.
  - `mount(root)` wires everything the old `init()` wired except `#btn-schedule` and `#btn-register`: data bar, crawl, bulk import, tab bar buttons (`#btn-open`, `#btn-reload`), storage listener, 1-second progress interval, and `createCourseSearch({ q: root.querySelector('#q'), list: root.querySelector('#search-results'), summary: root.querySelector('#search-summary'), countsBtn: root.querySelector('#btn-counts') })`.
  - It subscribes to `onCosChange` to call its own `renderTabBar()`, `renderSysStatus()`, `renderSemesterWarning()` and `renderAllSearches()`.

Move map (functions moved verbatim unless noted):

| From `src/popup.js` | To |
|---|---|
| `state`, `$`, `code`, `showHint`, `formatTime`, `sleep` | `popup/shared.js` |
| `ping`, `waitForContentScript`, `send`, `waitForTabReload`, `reloadCos`, `detectTab`, `refreshCosSemester`, `refreshSysStatus`, `unavailableMessage`, `getDepTree`, `getCourseList` | `popup/cos.js` (replace render calls with `notify()`) |
| `stateLabel`, `addButton`, `courseRow`, `renderSearch`, `flatCounts`, `loadCounts`, `fetchCounts`, `optionsFor`, `choiceRow`, `addSingle`, `submitSingle` | `popup/course-search.js`. `renderSearch` becomes the instance `render()`; it reads the instance's `q`, `list`, `summary` and `countsBtn` instead of `$('#q')` etc. `addSingle`/`submitSingle` end with `renderAllSearches()`. `fetchCounts(instance)` uses that instance's `q`/`summary`/`countsBtn`. |
| `renderTabBar`, `renderSysStatus`, `renderSemesterWarning`, `renderProgress`, `renderData`, `loadData`, `startCrawl`, `fillGroup`, `renderBulkResults`, `onBulkImport`, `init` (minus the two page buttons) | `popup/tabs/add.js`. `renderData` calls `renderAllSearches()` where it called `renderSearch()`. |

Export `loadCounts` from `course-search.js` and call it from `add.js` `mount` before the first render, the same order as the old `init`: `await Promise.all([detectTab(), loadData(), loadCounts()])`.

- [ ] **Step 1: Do the moves.** After moving, `src/popup.js` is exactly:

```js
import { mount } from './popup/tabs/add.js'

const EMULATOR_URL = 'https://cos.nycu.edu.tw/#/emulator'
document.querySelector('#btn-schedule').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/schedule.html') }))
document.querySelector('#btn-register').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/register.html') }))
mount(document.body)
```

(`EMULATOR_URL` is used by `#btn-open` inside `add.js`; declare it there instead and delete it here if unused.)

- [ ] **Step 2: Syntax-check every module**

Run: `cd ~/nycucourse-extension && for f in src/popup.js src/popup/*.js src/popup/tabs/*.js; do node --check "$f" || echo "FAIL $f"; done`
Expected: no `FAIL` lines.

- [ ] **Step 3: Unit tests.** Run `npm test`, expect `fail 0`.

- [ ] **Step 4: Run every existing popup E2E**

Run: `cd <scratchpad>/e2e && for f in attribution bugs fixes fixes2 progress counts seats sysstatus closed links tolerance; do echo "$f: $(node $f.mjs 2>&1 | tail -1)"; done`
Expected: every line ends in `PASS`. A failure means behavior changed; fix the refactor, not the test.

- [ ] **Step 5: Commit**

```bash
git add src/popup.js src/popup && git commit -m "popup 程式依責任拆成模組（行為不變）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Tab shell (`popup.html`, `popup.js`, CSS)

**Files:**
- Rewrite: `src/popup.html`
- Rewrite: `src/popup.js`
- Modify: `src/popup.css`
- Create: `src/popup/tabs/schedule.js` (a stub: `mount(root)` renders `<p class="hint">課表</p>`; filled in by Task 7)

**Interfaces:**
- Consumes: `pickTab` (Task 4), `add.js` `mount/show` (Task 5).
- Produces: `TABS` array in `popup.js`: `[{ id: 'add', label: '加入預排', module }, { id: 'schedule', label: '課表', module }]`. Each module exports `mount(root)` and `show()`. The shell creates `<section class="panel" data-tab="<id>">`, clones `<template id="tpl-<id>">` into it, and calls `mount(section)` the first time the tab is shown.

- [ ] **Step 1: Rewrite `src/popup.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>NYCU 預排課程匯入</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header class="shell">
    <nav id="tabs" class="tabs" role="tablist"></nav>
    <span class="shell-actions">
      <button id="btn-schedule" type="button" title="開啟完整週課表">週課表 ↗</button>
      <button id="btn-register" type="button" title="開啟選課頁">選課 ↗</button>
    </span>
  </header>
  <main id="panels"></main>

  <template id="tpl-add">
    <!-- 原本 popup.html 從 <section class="data-bar"> 到 </details> 的內容，原封不動貼在這裡 -->
  </template>

  <template id="tpl-schedule">
    <div class="mini-week" role="grid" aria-label="本週課表"></div>
    <p class="now-line-text" aria-live="polite"></p>
    <div class="detail" hidden></div>
    <p class="empty" hidden>
      還沒有正式選課。
      <button type="button" data-action="open-schedule">看預排課表 ↗</button>
      <button type="button" data-action="sync">從選課網同步</button>
    </p>
    <p class="updated"></p>
    <section class="search compact">
      <input class="q" type="search" placeholder="找課：課名、老師或課號" autocomplete="off">
      <p class="search-summary hint" hidden></p>
      <ul class="search-results results"></ul>
    </section>
  </template>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

The `tpl-add` comment is an instruction, not literal content. Paste the old markup there, starting at `<section class="data-bar">` and ending at `</details>`, byte-for-byte, including every id.

- [ ] **Step 2: Rewrite `src/popup.js`**

```js
// popup 外殼：依 TABS 產生 tab 列，記住上次的 tab。
// popup 只放小工具；大功能（例如課程規劃）請開新的 Chrome 分頁。
import { pickTab } from './lib/tabs.js'
import * as addTab from './popup/tabs/add.js'
import * as scheduleTab from './popup/tabs/schedule.js'

// 調整順序或新增小工具 tab：改這個清單，並在 popup.html 加一個 <template id="tpl-<id>">
const TABS = [
  { id: 'add', label: '加入預排', module: addTab },
  { id: 'schedule', label: '課表', module: scheduleTab },
]

const mounted = new Set()

async function savedTab() {
  try {
    const { popupTab } = await chrome.storage.local.get('popupTab')
    return popupTab
  } catch {
    return undefined
  }
}

function panelFor(tab) {
  let panel = document.querySelector(`.panel[data-tab="${tab.id}"]`)
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'panel'
    panel.dataset.tab = tab.id
    panel.setAttribute('role', 'tabpanel')
    const tpl = document.getElementById(`tpl-${tab.id}`)
    if (tpl) panel.append(tpl.content.cloneNode(true))
    document.getElementById('panels').append(panel)
  }
  return panel
}

async function select(id, { remember = true } = {}) {
  for (const tab of TABS) {
    const active = tab.id === id
    const button = document.querySelector(`#tabs [data-tab="${tab.id}"]`)
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
    if (!active) {
      const panel = document.querySelector(`.panel[data-tab="${tab.id}"]`)
      if (panel) panel.hidden = true
      continue
    }
    const panel = panelFor(tab)
    panel.hidden = false
    if (!mounted.has(tab.id)) {
      mounted.add(tab.id)
      await tab.module.mount(panel)
    }
    tab.module.show()
  }
  if (remember) {
    try {
      await chrome.storage.local.set({ popupTab: id })
    } catch {}
  }
}

function renderTabs() {
  const nav = document.getElementById('tabs')
  nav.replaceChildren(
    ...TABS.map((tab) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.dataset.tab = tab.id
      b.textContent = tab.label
      b.addEventListener('click', () => select(tab.id))
      return b
    }),
  )
}

async function init() {
  document.getElementById('btn-schedule').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/schedule.html') }))
  document.getElementById('btn-register').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/register.html') }))
  renderTabs()
  await select(pickTab(TABS, await savedTab()), { remember: false })
}

init()
```

`add.js` `mount(root)` must query inside `root`: `root.querySelector('#q')` etc. The ids are still unique because the template is cloned once. The existing `$` helper uses `document`, which also works once the panel is attached; `panelFor` attaches it before calling `mount`.

- [ ] **Step 3: Styles.** In `src/popup.css`, change `body { width: 380px; … }` to `width: 420px`. Delete the old `.app-bar` rules and append:

```css
.shell {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 8px;
  margin: -12px -14px 10px;
  padding: 8px 10px 0;
  border-bottom: 1px solid var(--line);
  background: var(--chrome-bg, rgba(127, 127, 127, .08));
}
.tabs { display: flex; gap: 2px; }
.tabs [role="tab"] {
  border: 1px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  background: transparent;
  padding: 5px 14px;
  font-size: 13px;
  color: var(--muted);
}
.tabs [role="tab"][aria-selected="true"] {
  background: Canvas;
  color: CanvasText;
  border-color: var(--line);
  margin-bottom: -1px;
  font-weight: 600;
}
.shell-actions { display: inline-flex; gap: 4px; padding-bottom: 6px; }
.shell-actions button { font-size: 12px; padding: 2px 8px; }
.panel[hidden] { display: none; }
```

- [ ] **Step 4: Check**

Run: `node --check src/popup.js && npm test 2>&1 | grep -E "^ℹ (pass|fail)"`, then the same E2E loop as Task 5 Step 4.
Expected: all `PASS`. On first open (no saved tab) the popup starts on 加入預排, so the old scripts still find `#q`.

- [ ] **Step 5: Commit**

```bash
git add src/popup.html src/popup.js src/popup.css src/popup/tabs/schedule.js && git commit -m "popup 改為 tab 外殼：加入預排、課表，記住上次的 tab

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 課表 tab: mini timetable, next line, detail card, search, background refresh

**Files:**
- Rewrite: `src/popup/tabs/schedule.js`
- Modify: `src/popup.css` (append mini timetable styles)

**Interfaces:**
- Consumes:
  - `scheduleItems`, `withSyncedSources`, `buildWeek`, `mergeBlocks`, `itemUrl` from `lib/schedule.js`.
  - `locateNow`, `describeNow` from `lib/now.js`.
  - `describeSlots` from `lib/periods.js`.
  - `courseOutlineUrl` from `lib/links.js`.
  - `createCourseSearch` from `popup/course-search.js`.
  - `findCosTab` from `popup/cos.js`.
  - `formatTime` from `popup/shared.js`.
- Produces: `mount(root)` and `show()`.

- [ ] **Step 1: Implement `src/popup/tabs/schedule.js`**

```js
// 課表 tab：開學後「下一堂在哪」。只顯示正式選課＋自訂行程。
import { scheduleItems, withSyncedSources, buildWeek, mergeBlocks, itemUrl } from '../../lib/schedule.js'
import { locateNow, describeNow } from '../../lib/now.js'
import { describeSlots } from '../../lib/periods.js'
import { courseOutlineUrl } from '../../lib/links.js'
import { createCourseSearch } from '../course-search.js'
import { findCosTab } from '../cos.js'

const ROW_PX = 34
const HEAD_PX = 20

let root = null
let schedule = null
let selectedKey = null
let search = null

const el = (sel) => root.querySelector(sel)

function layout() {
  return mergeBlocks(buildWeek(scheduleItems(schedule, ['registered'])))
}

function renderWeek(week, located) {
  const grid = el('.mini-week')
  grid.replaceChildren()
  grid.style.gridTemplateColumns = `18px repeat(${week.days.length}, 1fr)`
  grid.style.gridTemplateRows = `${HEAD_PX}px repeat(${week.rows.length}, ${ROW_PX}px)`

  const corner = document.createElement('div')
  corner.className = 'corner'
  grid.append(corner)
  week.days.forEach((day, i) => {
    const h = document.createElement('div')
    h.className = `day-head${day === located.today ? ' today' : ''}`
    h.style.gridColumn = String(i + 2)
    h.textContent = week.dayNames[day]
    grid.append(h)
  })
  week.rows.forEach((row, r) => {
    const label = document.createElement('div')
    label.className = 'period'
    label.style.gridRow = String(r + 2)
    label.textContent = row.label
    label.title = `${row.start}–${row.end}`
    grid.append(label)
  })
  const todayCol = week.days.indexOf(located.today)
  if (todayCol >= 0) {
    const shade = document.createElement('div')
    shade.className = 'today-col'
    shade.style.gridColumn = String(todayCol + 2)
    shade.style.gridRow = `2 / span ${week.rows.length}`
    grid.append(shade)
  }
  for (const block of week.blocks) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'block'
    if (block.lanes > 1) cell.classList.add('conflict')
    if (block.item.regState === 'wish') cell.classList.add('wish')
    if (located.next && block.key === located.next.key) cell.classList.add('next')
    if (located.current && block.key === located.current.key) cell.classList.add('current')
    if (block.key === selectedKey) cell.classList.add('selected')
    if (block.item.color) cell.style.background = block.item.color
    cell.style.gridColumn = String(week.days.indexOf(block.day) + 2)
    cell.style.gridRow = `${block.row + 2} / span ${block.span}`
    if (block.lanes > 1) {
      cell.style.width = `${100 / block.lanes}%`
      cell.style.marginLeft = `${(100 / block.lanes) * block.lane}%`
    }
    const name = document.createElement('span')
    name.className = 'name'
    name.textContent = block.item.title
    const room = document.createElement('span')
    room.className = 'room'
    room.textContent = block.room
    cell.append(name, room)
    cell.title = [block.item.title, block.room, `${block.start}–${block.end}`].filter(Boolean).join('・')
    cell.addEventListener('click', () => {
      selectedKey = selectedKey === block.key ? null : block.key
      render()
    })
    grid.append(cell)
  }
  if (located.nowLine) {
    const line = document.createElement('div')
    line.className = 'now'
    line.style.top = `${HEAD_PX + (located.nowLine.row + located.nowLine.fraction) * ROW_PX}px`
    grid.append(line)
  }
}

function renderDetail(week) {
  const box = el('.detail')
  const block = week.blocks.find((b) => b.key === selectedKey)
  box.hidden = !block
  box.replaceChildren()
  if (!block) return
  const item = block.item
  const title = document.createElement('h2')
  title.textContent = item.title
  const lines = [
    describeSlots(item.slots),
    [block.room, item.teacher].filter(Boolean).join('・'),
    item.regState === 'wish' ? `登記中・第 ${item.wishNo} 志願` : '',
  ].filter(Boolean)
  const info = document.createElement('p')
  info.textContent = lines.join('\n')
  const actions = document.createElement('div')
  actions.className = 'detail-actions'
  const link = (text, url) => {
    const a = document.createElement('a')
    a.textContent = text
    a.href = url
    a.target = '_blank'
    a.rel = 'noreferrer'
    return a
  }
  if (item.url) actions.append(link('開啟連結', item.url))
  const outline = courseOutlineUrl(item.semester, item.cosId)
  if (outline) actions.append(link('課程大綱', outline))
  const set = document.createElement('button')
  set.type = 'button'
  set.textContent = item.url ? '修改連結' : '設定連結'
  set.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/schedule.html') }))
  actions.append(set)
  box.append(title, info, actions)
}

function render() {
  const week = layout()
  const empty = week.blocks.length === 0
  el('.empty').hidden = !empty
  el('.mini-week').hidden = empty
  const located = locateNow(week, new Date())
  el('.now-line-text').textContent = empty ? '' : describeNow(located).join('\n')
  if (!empty) renderWeek(week, located)
  if (selectedKey && !week.blocks.some((b) => b.key === selectedKey)) selectedKey = null
  renderDetail(week)
  const reg = schedule && schedule.sources && schedule.sources.registered
  const updated = reg && reg.updatedAt ? new Date(reg.updatedAt) : null
  el('.updated').textContent = updated ? `更新於 ${String(updated.getHours()).padStart(2, '0')}:${String(updated.getMinutes()).padStart(2, '0')}` : ''
}

// 有已登入的選課網分頁時，背景讀一次正式選課；失敗就沿用上次的資料，不提示
async function refreshFromCos() {
  try {
    const tab = await findCosTab()
    if (!tab) return false
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'courses' })
    if (!reply || !reply.ok) return false
    const next = withSyncedSources(schedule, reply, Date.now())
    await chrome.storage.local.set({ schedule: next })
    return true
  } catch {
    return false
  }
}

export async function mount(container) {
  root = container
  const stored = await chrome.storage.local.get('schedule')
  schedule = stored.schedule || { sources: {}, manual: [], overrides: {} }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.schedule) {
      schedule = changes.schedule.newValue || schedule
      render()
    }
  })
  el('[data-action="open-schedule"]').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/schedule.html') }))
  el('[data-action="sync"]').addEventListener('click', async (e) => {
    e.target.disabled = true
    const ok = await refreshFromCos()
    e.target.disabled = false
    if (!ok) el('.now-line-text').textContent = '找不到已登入的選課網分頁，請先開啟並登入選課網。'
  })
  search = createCourseSearch({ q: el('.q'), list: el('.search-results'), summary: el('.search-summary'), countsBtn: null })
  setInterval(render, 30_000)
  refreshFromCos()
}

export function show() {
  render()
  search.render()
}
```

- [ ] **Step 2: Append styles to `src/popup.css`**

```css
/* 迷你課表 */
.mini-week {
  position: relative;
  display: grid;
  gap: 2px;
  font-size: 11px;
  line-height: 1.2;
}
.mini-week .day-head, .mini-week .period {
  display: flex; align-items: center; justify-content: center;
  color: var(--muted);
}
.mini-week .day-head.today { color: CanvasText; font-weight: 700; }
.mini-week .period { justify-content: flex-start; }
.mini-week .today-col { background: rgba(31, 111, 235, .08); border-radius: 4px; }
.mini-week .block {
  display: flex; flex-direction: column; justify-content: center;
  min-width: 0; padding: 2px 4px; margin: 0;
  border: 1px solid var(--line); border-radius: 5px;
  background: rgba(127, 127, 127, .12); color: inherit;
  font: inherit; text-align: left; cursor: pointer; overflow: hidden;
}
.mini-week .block .name, .mini-week .block .room {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mini-week .block .room { color: var(--muted); font-size: 10px; }
.mini-week .block.next { outline: 2px solid #1f6feb; outline-offset: -1px; }
.mini-week .block.current { outline: 2px solid var(--ok); outline-offset: -1px; }
.mini-week .block.selected { box-shadow: 0 0 0 2px CanvasText inset; }
.mini-week .block.wish { border-style: dashed; }
.mini-week .block.conflict { border-color: var(--error); }
.mini-week .now {
  position: absolute; left: 18px; right: 0; height: 0;
  border-top: 2px solid var(--error); pointer-events: none;
}
.now-line-text { margin: 8px 0 0; font-size: 13px; font-weight: 600; white-space: pre-line; }
.detail { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; font-size: 12px; }
.detail h2 { margin: 0 0 4px; font-size: 14px; }
.detail p { margin: 0 0 6px; white-space: pre-line; color: var(--muted); }
.detail-actions { display: flex; gap: 10px; align-items: center; }
.empty { font-size: 13px; color: var(--muted); }
.updated { margin: 4px 0 0; text-align: right; font-size: 11px; color: var(--muted); }
.search.compact input { margin-top: 8px; }
```

- [ ] **Step 3: Check.** Run `node --check src/popup/tabs/schedule.js`, then `npm test`. Expected: `fail 0`.

- [ ] **Step 4: Commit**

```bash
git add src/popup/tabs/schedule.js src/popup.css && git commit -m "課表 tab：迷你週課表、下一堂、詳情、找課與背景更新

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: E2E for the new tabs, regression run, screenshots, release 0.7.0

**Files:**
- Create: scratchpad `e2e/popup-tabs.mjs`
- Modify: `manifest.json`, `package.json` (version `0.7.0`), `README.md` (new "課表" section at the top of 使用方式)
- Existing E2E scripts: change `r.version === '0.6.0'` to `'0.7.0'` with `sed -i '' -E "s/(r|results)\.version === '0\.[0-9]+\.[0-9]+'/\1.version === '0.7.0'/g" *.mjs`

- [ ] **Step 1: Write `e2e/popup-tabs.mjs`**

```js
// 0.7.0 popup tab 架構與課表 tab
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const EXT = '/Users/engel/nycucourse-extension'
const OUT = path.dirname(new URL(import.meta.url).pathname)
const CHROME = path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-tabs-'))
const ctx = await chromium.launchPersistentContext(dir, {
  executablePath: CHROME, headless: true, viewport: { width: 460, height: 700 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-first-run'],
})
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const jwt = (exp) => `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url({ user: 'demo', exp })}.sig`

const registered = [
  { cos_id: '564000', cos_cname: '微積分甲(一)', cos_time: 'M12W12-SA101[GF]', lecturers: '甲', acy: '115', sem: '1', sFlag: 'F' },
  { cos_id: '516700', cos_cname: '線性代數（一）', cos_time: 'T34W34-SC201[GF]', lecturers: '乙', acy: '115', sem: '1', sFlag: 'F' },
  { cos_id: '516716', cos_cname: '導師時間', cos_time: 'M5-SC101[GF]', lecturers: '丙', acy: '115', sem: '1', sFlag: 'F' },
]
let cosRegistered = registered
await ctx.route('https://cos.nycu.edu.tw/**', async (route) => {
  const req = route.request()
  if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'text/html', body: '<title>cos</title>' })
  const fn = new URL(req.url()).pathname.slice(1)
  const json = (v) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) })
  if (fn === 'getregist') return json(cosRegistered)
  if (fn === 'getpreregist') return json([])
  if (fn === 'checkreg') return json({ status: 'success', cmsg: '', emsg: '' })
  if (fn === 'sysstatuslvl') return json([{ status: '1', cmsg: '系統暢通無阻' }])
  if (fn === 'userinfo') return json({ lastacysem: '1151' })
  return route.fulfill({ status: 404, body: '' })
})

const r = { errors: [] }
try {
  let [sw] = ctx.serviceWorkers()
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 15000 })
  const extId = new URL(sw.url()).host
  r.version = await sw.evaluate(() => chrome.runtime.getManifest().version)
  await sw.evaluate(async (registered) => {
    await chrome.storage.local.clear()
    await chrome.storage.local.set({
      courseData: { semester: '1151', updatedAt: Date.now(), courses: [{ id: '516701', name: '計算機概論（一）', teacher: '丁', time: 'R56-EC115[GF]', credit: '3.00', type: '必修', dep: '應數系', menu: { type: '1', dep_category: '3*', college_no: 'S', dep_uid: 'DAM' } }] },
      schedule: { sources: { registered: { semester: '1151', updatedAt: Date.UTC(2026, 8, 22, 1, 0), courses: registered } }, manual: [], overrides: { 516700: { url: 'https://e3.example/516700' } } },
    })
  }, registered)

  const openPopup = async () => {
    const p = await ctx.newPage()
    p.on('pageerror', (e) => r.errors.push(String(e)))
    await p.clock.setFixedTime(new Date(2026, 8, 23, 10, 5)) // 週三 10:05，課間休息
    await p.goto(`chrome-extension://${extId}/src/popup.html`)
    await p.waitForTimeout(600)
    return p
  }

  // 第一次開：第一個 tab（加入預排）
  let popup = await openPopup()
  r.firstTab = await popup.$eval('#tabs [aria-selected="true"]', (b) => b.dataset.tab)
  r.addHasSearch = await popup.$eval('#q', (e) => Boolean(e))
  await popup.click('#tabs [data-tab="schedule"]')
  await popup.waitForSelector('.mini-week .block')
  r.nextText = await popup.textContent('.now-line-text')
  r.rows = await popup.$$eval('.mini-week .period', (els) => els.map((e) => e.textContent))
  r.todayHead = await popup.$eval('.mini-week .day-head.today', (e) => e.textContent)
  r.nextBlock = await popup.$eval('.mini-week .block.next .name', (e) => e.textContent)
  r.hasNowLine = Boolean(await popup.$('.mini-week .now'))
  await popup.click('.mini-week .block.next')
  r.detail = await popup.$eval('.detail', (e) => (e.hidden ? '' : e.textContent))
  r.detailLink = await popup.$eval('.detail a', (a) => a.href)
  await popup.click('.mini-week .block.next')
  r.detailClosed = await popup.$eval('.detail', (e) => e.hidden)
  await popup.fill('.q', '計算機')
  await popup.waitForTimeout(200)
  r.searchInSchedule = await popup.$$eval('.search-results li .title', (els) => els.map((e) => e.textContent))
  await popup.screenshot({ path: path.join(OUT, 'popup-schedule-light.png') })
  await popup.close()

  // 記住 tab
  popup = await openPopup()
  r.rememberedTab = await popup.$eval('#tabs [aria-selected="true"]', (b) => b.dataset.tab)
  await popup.emulateMedia({ colorScheme: 'dark' })
  await popup.screenshot({ path: path.join(OUT, 'popup-schedule-dark.png') })
  await popup.close()

  // 背景更新：選課網的正式選課變了，課表會重畫
  const cos = await ctx.newPage()
  await cos.goto('https://cos.nycu.edu.tw/#/emulator')
  await cos.evaluate((t) => localStorage.setItem('token', t), jwt(Math.floor(Date.now() / 1000) + 3600))
  await cos.waitForTimeout(400)
  cosRegistered = [...registered, { cos_id: '516701', cos_cname: '計算機概論（一）', cos_time: 'R56-EC115[GF]', lecturers: '丁', acy: '115', sem: '1', sFlag: 'F' }]
  popup = await openPopup()
  await popup.waitForFunction(() => [...document.querySelectorAll('.mini-week .block .name')].some((e) => e.textContent.includes('計算機')), null, { timeout: 10000 })
  r.refreshed = true
  await popup.close()

  // 沒有正式選課
  await sw.evaluate(async () => chrome.storage.local.set({ schedule: { sources: {}, manual: [], overrides: {} } }))
  await cos.close()
  popup = await openPopup()
  r.emptyShown = await popup.$eval('.empty', (e) => !e.hidden)
  await popup.close()

  const checks = {
    version: r.version === '0.7.0',
    firstOpenUsesFirstTab: r.firstTab === 'add' && r.addHasSearch,
    rowsOnlyClassRange: JSON.stringify(r.rows) === JSON.stringify(['1', '2', '3', '4', 'N', '5']),
    todayMarked: r.todayHead === '三',
    nextLine: /下一堂 10:10（5 分鐘後）・線性代數（一）・SC201/.test(r.nextText),
    nextBlockHighlighted: r.nextBlock.startsWith('線性代數'),
    nowLineDrawn: r.hasNowLine,
    detailOpensAndCloses: /線性代數/.test(r.detail) && r.detailLink === 'https://e3.example/516700' && r.detailClosed,
    searchInScheduleTab: r.searchInSchedule.some((t) => t.includes('計算機概論')),
    remembersTab: r.rememberedTab === 'schedule',
    backgroundRefresh: r.refreshed,
    emptyState: r.emptyShown,
    noPageErrors: r.errors.length === 0,
  }
  console.log(JSON.stringify({ ...r, checks }, null, 1))
  console.log(Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL')
} finally {
  await ctx.close()
  fs.rmSync(dir, { recursive: true, force: true })
}
```

- [ ] **Step 2: Bump the version.** Set `"version": "0.7.0"` in `manifest.json` and `package.json`, and update the version expectation in the existing E2E scripts with the sed command above.

- [ ] **Step 3: Run the new E2E**

Run: `cd <scratchpad>/e2e && node popup-tabs.mjs 2>&1 | tail -30`
Expected: `PASS`. If `page.clock` does not affect the extension page's `new Date()`, add `await p.clock.install({ time: … })` instead of `setFixedTime`, before `goto`.

- [ ] **Step 4: Full regression**

Run: `npm test` (expect `fail 0`), then `for f in popup-tabs attribution fallback register autoreg closed sysstatus counts seats tolerance links schedule manual bugs fixes fixes2 progress; do echo "$f: $(node $f.mjs 2>&1 | tail -1)"; done`
Expected: every line `PASS`.

- [ ] **Step 5: README.** In `README.md`, insert a section before `### 第一次使用：下載課程資料`:

```markdown
### 點開就看到課表

點工具列上的擴充功能圖示，上方有兩個分頁：「加入預排」和「課表」，會記住你上次看的是哪一個。

「課表」分頁顯示你的正式選課和自己加的行程：

- 只列有課的節次，今天那一欄會加深，紅線是現在時間。
- 課表下方一行會寫「下一堂 10:10（5 分鐘後）・線性代數・SC201」，上課中則會寫幾點下課。
- 點一堂課可以看完整資訊、開啟你設定的連結（例如 E3）或課程大綱。
- 下面的搜尋框可以直接找課、加入預排。

開著已登入的選課網分頁時，課表會在背景自動更新；沒開也沒關係，會顯示上次的資料。
```

- [ ] **Step 6: Send the screenshots to the user** (`popup-schedule-light.png`, `popup-schedule-dark.png`) for visual review before releasing. Wait for the user's OK.

- [ ] **Step 7: Commit, pack, release** (after the user OKs the screenshots)

```bash
cd ~/nycucourse-extension && git add -A && git commit -m "popup 改版：課表分頁與 tab 架構，版本 0.7.0

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" && scripts/pack.sh && git tag v0.7.0 && git push && git push origin v0.7.0 && gh release create v0.7.0 dist/nycucourse-extension-0.7.0.zip --title "v0.7.0：點開就看到課表" --notes "popup 改成兩個分頁：加入預排、課表。課表分頁顯示正式選課與自訂行程、現在時間與下一堂的教室，點一堂課可以看詳情與連結。"
```

---

## Self-Review

- **Spec coverage:**
  - §1 sources → Task 1; blocks and conflicts → Task 2; now/next, time line and every listed edge → Task 3; wish styling → Task 7 CSS `.wish` plus the detail text.
  - §2 shell and tabs → Task 6; 課表 tab (grid, next line, detail, search, empty state) → Task 7; 加入預排 tab → Tasks 5–6; remembered tab → Tasks 4 and 6; dark mode via `color-scheme` and `Canvas`/`CanvasText` → Tasks 6–7.
  - §3 background refresh and 「更新於」 → Task 7; file layout → Tasks 5–7; tests → every task plus Task 8.
  - The 「⋯」 menu is replaced by two buttons; this deviation is documented under Global Constraints.
- **Placeholders:** the only instruction-style content is the `tpl-add` paste instruction (verbatim move of existing markup) and the Task 5 move map (verbatim moves with the listed substitutions). Both are mechanical and fully specified.
- **Type consistency:**
  - `mergeBlocks` output fields (`row`, `span`, `startMin`, `endMin`, `start`, `end`, `room`, `lane`, `lanes`, `key`, `item`, `day`) are used with the same names in Task 3 (`locateNow`) and Task 7 (render).
  - `createCourseSearch({ q, list, summary, countsBtn })` matches in Tasks 5 and 7.
  - `findCosTab` is defined in Task 5 and used in Task 7.
  - `pickTab(tabs, saved)` matches Tasks 4 and 6.
