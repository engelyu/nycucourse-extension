# 選課規劃頁：找空堂課程 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new full page 「選課規劃」. Its first feature: box-select time slots, then find courses from the local course data that fit those slots, with strong filters, a grid preview on hover, and add-to-預排.

**Architecture:** All matching, filtering and selection rules are pure functions in `src/lib/freeslots.js` and `src/lib/grid-select.js`, unit-tested with `node --test`. The page `src/planner.html` wires three small modules: grid (`src/planner/slot-grid.js`), results (`src/planner/results.js`), and page state and filters (`src/planner.js`). Talking to the cos tab is extracted from `src/register.js` into `src/cos-tab.js` so both pages share it. The timetable crawl additionally stores each course's category codes (`brief`).

**Tech Stack:** Chrome MV3 extension with plain ES modules and no build step. `node --test` for unit tests. Playwright-core 1.63 with Chrome for Testing (headless) for E2E; scripts live in the session scratchpad `e2e/`.

**Spec:** `docs/superpowers/specs/2026-09-19-planner-free-slots-design.md`

## Global Constraints

- The page is a full Chrome tab (`src/planner.html`) titled 「選課規劃」. The popup shell gets a button 「規劃 ↗」 that opens it.
- The grid always shows 7 days (一–日) × all 16 periods (Y, Z, 1–4, N, 5–9, A–D). A slot key is `"<day>-<period code>"`, day 1–7 (Mon = 1), with period codes from `PERIODS` (`y`,`z`,`1`…`4`,`n`,`5`…`9`,`a`…`d`).
- There are two 「帶入空堂」 buttons: 避開正式選課 (`['registered']`) and 避開正式選課＋預排 (`['registered','preregist']`). Both use `scheduleItems`, which already includes manual items and applies overrides. Filling selects every free slot and **replaces** the current selection.
- Match modes:
  - `inside` means every slot of the course is selected.
  - `overlap` means at least one slot is selected. In overlap mode, inside-matching courses are still listed, in the 完全落在內 group.
  - Courses without time are never listed.
- Filters are all ANDed: campus (any slot's campus), category, department (`course.dep`), credit min/max, keyword (`searchCourses` rules), and exclude 正式選課 / 預排 by id. An empty multi-select means no restriction.
- Campus order and names: GF 光復, YM 陽明, BA 博愛, LJ 六家, GR 歸仁, BM `BM`, KS `KS`. BM and KS names are unknown, so show the codes. Any other code is shown as its code.
- Categories:
  - 必修 and 選修 come from `course.type`.
  - `Z100`–`Z104` is 核心・基本素養; `Z105`–`Z108` is 核心・領域課程; codes starting with `Z2` are 語言與溝通. These codes come from `course.brief`.
  - If no course in the data has `brief`, show the hint 「重新更新課程資料後才能篩核心、語言與溝通」.
- Show at most 200 results, with the hint 「共 N 門，只顯示前 200 門，請再縮小條件」.
- Persist `{ selection: string[], filters }` in `chrome.storage.local` key `planner`. Invalid or missing values fall back to the defaults: empty selection, mode `inside`, no restrictions.
- Add-to-預排 reuses `lib/attribution.js` (`findAttributionOptions`, `needsChoice`, `preregParams`, `courseDepUids`). It goes through any open cos tab; if there is none, show 「請先開啟並登入選課網」.
- Never call `deleteregist`.
- Version `0.8.0` in both `manifest.json` and `package.json`.
- Commit messages are in Chinese and end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Work on branch `planner`; merge to master only after the user approves the screenshots.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/timetable.js` (modify) | `parseCosList` stores `brief: string[]` when the course has category codes |
| `src/lib/crawl.js` (modify) | union `brief` across departments for courses listed in several |
| `src/lib/freeslots.js` (create) | slots, free slots, match, categories, campus names, `findCourses`, `describeKeys` |
| `src/lib/grid-select.js` (create) | `dragMode`, `rectKeys`, `applyKeys`, `toggleGroup` |
| `src/cos-tab.js` (create) | `findCosTab`, `askCos`, `cosProblem`, extracted from `src/register.js` |
| `src/register.js` (modify) | import from `cos-tab.js` |
| `src/planner.html`, `src/planner.css`, `src/planner.js` (create) | page, layout, state, persistence, filters, fill buttons, add flow |
| `src/planner/slot-grid.js` (create) | grid DOM, pointer drag, header toggles, hover preview |
| `src/planner/results.js` (create) | result cards, groups, choice row |
| `src/popup.html`, `src/popup.js` (modify) | 「規劃 ↗」 button |
| `test/timetable.test.js`, `test/crawl.test.js`, `test/freeslots.test.js`, `test/grid-select.test.js` | unit tests |
| scratchpad `e2e/planner.mjs` | E2E |

---

### Task 1: Store category codes (`brief`) in the crawl

**Files:**
- Modify: `src/lib/timetable.js` (`parseCosList`)
- Modify: `src/lib/crawl.js` (merge block around the `menus` merge)
- Test: `test/timetable.test.js`, `test/crawl.test.js`

**Interfaces:**
- Produces: course objects may have `brief: string[]` (e.g. `['A505','Z204']`). The field is absent when a course has no codes, which keeps existing deepEqual tests valid.

- [ ] **Step 1: Failing tests** (append to `test/timetable.test.js`)

```js
test('parseCosList 帶出課程的類別代碼（brief），沒有代碼就不加欄位', () => {
  const json = {
    DEP: {
      1: {
        '1151_112304': { acy: '115', sem: '1', cos_id: '112304', cos_cname: '計算機概論' },
        '1151_514027': { acy: '115', sem: '1', cos_id: '514027', cos_cname: '創意文案' },
        '1151_516700': { acy: '115', sem: '1', cos_id: '516700', cos_cname: '線性代數' },
      },
      brief: {
        '1151_112304': { Z102: { brief_code: 'Z102', brief: '基本素養-量性推理(110)' } },
        '1151_514027': { 'A505,Z204': { brief_code: 'A505,Z204', brief: '校基本素養(106),語言與溝通-溝通表達(111)' } },
        '1151_516700': { '': { brief_code: '', brief: '' } },
      },
    },
  }
  const out = Object.fromEntries(parseCosList(json).map((c) => [c.id, c.brief]))
  assert.deepEqual(out, { 112304: ['Z102'], 514027: ['A505', 'Z204'], 516700: undefined })
})
```

Append to `test/crawl.test.js`, inside the existing fake server:
- Give `DEP-A`'s `get_cos_list` response a `brief` map: `brief: { '1142_000002': { Z102: {} } }`.
- Give `DEP-B` the map `brief: { '1142_000002': { Z204: {} } }`.

The fake server returns `{ [uid]: v }`, where `v` is the object with numeric keys. Put `brief` inside `v`. Then add:

```js
test('多系合開的課合併各系的類別代碼', async () => {
  const { fetchJson } = fakeServer()
  const r = await crawlSemester({ fetchJson, concurrency: 1 })
  assert.deepEqual(r.courses.find((x) => x.id === '000002').brief.sort(), ['Z102', 'Z204'])
})
```

(The fake courses have no `acy`/`sem`, so `parseCosList` must also accept the brief key built from the dict key itself: `brief[key]` where `key` is the course's key in the group, for example `'1142_000002'`. Implement that way; see Step 3.)

- [ ] **Step 2: Run to verify failure.** `node --test test/timetable.test.js test/crawl.test.js` should FAIL on the new tests.

- [ ] **Step 3: Implement.** In `parseCosList`, inside the loop over `objectKeys(group)` (where `key` is the course key such as `1151_112304`), after building `course`, add:

```js
        const codes = objectKeys((dep.brief || {})[key] || {})
          .flatMap((k) => k.split(','))
          .map((k) => k.trim())
          .filter(Boolean)
        if (codes.length) course.brief = [...new Set(codes)]
```

In `src/lib/crawl.js`, where an existing course gets another dep's menu (`} else if (course.menu && …`), restructure so `brief` is merged whether or not the menu is new:

```js
      const seen = courses.get(course.id)
      if (!seen) {
        courses.set(course.id, { ...course, menus: course.menu ? [course.menu] : [] })
        continue
      }
      if (course.menu && !seen.menus.some((m) => m.dep_uid === course.menu.dep_uid)) seen.menus.push(course.menu)
      if (course.brief) seen.brief = [...new Set([...(seen.brief || []), ...course.brief])]
```

- [ ] **Step 4:** Run `npm test` and expect `fail 0`.
- [ ] **Step 5: Commit** with message `課程資料多存類別代碼 brief（多系合開合併）`.

---

### Task 2: `lib/freeslots.js`

**Files:**
- Create: `src/lib/freeslots.js`
- Test: `test/freeslots.test.js`

**Interfaces:**
- Consumes: `PERIODS`, `parseCosTime`, `DAY_NAMES` (`lib/periods.js`); `searchCourses` (`lib/search.js`).
- Produces:
  - `slotKey(day, periodCode) -> string`, `ALL_SLOTS: string[]` (112 keys, day-major then `PERIODS` order).
  - `CAMPUSES: {code,name}[]` and `campusName(code) -> string`.
  - `courseSlots(course) -> { keys: string[], campuses: string[], rooms: string[] }`.
  - `occupiedSlots(items) -> Set<string>`, where items are schedule items with `slots:[{day,period}]`.
  - `freeSlots(occupied: Set) -> string[]` in `ALL_SLOTS` order.
  - `matchCourse(keys: string[], selection: Set) -> { inside: boolean, overlap: boolean, outside: string[] }`.
  - `CATEGORIES: string[]` = `['必修','選修','核心・基本素養','核心・領域課程','語言與溝通']`, and `courseCategories(course) -> string[]`.
  - `hasBriefData(courses) -> boolean`.
  - `describeKeys(keys) -> string`, for example `'一 56、三 34'`.
  - `RESULT_LIMIT = 200`.
  - `findCourses(courses, filters) -> { total, inside: Hit[], overlap: Hit[], truncated: boolean }`, with `Hit = { course, keys, outside }` and `filters = { selection: Set|string[], mode: 'inside'|'overlap', campuses: string[], categories: string[], deps: string[], creditMin: string|number, creditMax: string|number, keyword: string, excludeIds: string[] }`.

- [ ] **Step 1: Failing tests** (`test/freeslots.test.js`)

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotKey, ALL_SLOTS, courseSlots, occupiedSlots, freeSlots, matchCourse, courseCategories, hasBriefData, describeKeys, findCourses, campusName, CAMPUSES } from '../src/lib/freeslots.js'
import { manualItem, courseToItem } from '../src/lib/schedule.js'

const c = (id, time, extra = {}) => ({ id, name: `課${id}`, ename: '', teacher: '老師', time, credit: '3.00', type: '選修', dep: '資工系', ...extra })

test('ALL_SLOTS 共 112 個，依星期再依節次排序', () => {
  assert.equal(ALL_SLOTS.length, 112)
  assert.equal(ALL_SLOTS[0], '1-y')
  assert.equal(ALL_SLOTS[16], '2-y')
  assert.equal(slotKey(5, '3'), '5-3')
})

test('courseSlots 解析時段、校區、教室', () => {
  assert.deepEqual(courseSlots(c('1', 'F345-EC115[GF]')), { keys: ['5-3', '5-4', '5-5'], campuses: ['GF'], rooms: ['EC115'] })
  assert.deepEqual(courseSlots(c('2', 'M56-A1[GF],W34-B2[YM]')).campuses, ['GF', 'YM'])
  assert.deepEqual(courseSlots(c('3', '')).keys, [])
})

test('空堂 = 全部時段扣掉佔用（含自訂行程）', () => {
  const items = [
    courseToItem({ cos_id: '9', cos_cname: '線代', cos_time: 'M12-A1[GF]' }, { source: 'registered' }),
    manualItem({ id: 'x', title: '社團', slots: [{ day: 2, period: 'a' }] }),
  ]
  const occ = occupiedSlots(items)
  assert.deepEqual([...occ].sort(), ['1-1', '1-2', '2-a'])
  const free = freeSlots(occ)
  assert.equal(free.length, 109)
  assert.ok(!free.includes('1-1') && free.includes('1-3'))
})

test('matchCourse 完全落在內與部分重疊', () => {
  const sel = new Set(['5-3', '5-4'])
  assert.deepEqual(matchCourse(['5-3', '5-4'], sel), { inside: true, overlap: true, outside: [] })
  assert.deepEqual(matchCourse(['5-3', '5-4', '5-5'], sel), { inside: false, overlap: true, outside: ['5-5'] })
  assert.deepEqual(matchCourse(['1-1'], sel), { inside: false, overlap: false, outside: ['1-1'] })
  assert.deepEqual(matchCourse([], sel), { inside: false, overlap: false, outside: [] })
})

test('courseCategories 依必選修與類別代碼', () => {
  assert.deepEqual(courseCategories(c('1', 'M1', { type: '必修' })), ['必修'])
  assert.deepEqual(courseCategories(c('2', 'M1', { brief: ['Z102'] })), ['選修', '核心・基本素養'])
  assert.deepEqual(courseCategories(c('3', 'M1', { brief: ['Z107'] })), ['選修', '核心・領域課程'])
  assert.deepEqual(courseCategories(c('4', 'M1', { type: '', brief: ['A505', 'Z204'] })), ['語言與溝通'])
  assert.equal(hasBriefData([c('1', 'M1')]), false)
  assert.equal(hasBriefData([c('1', 'M1', { brief: ['Z102'] })]), true)
})

test('describeKeys 與 campusName', () => {
  assert.equal(describeKeys(['3-4', '1-5', '1-6', '3-3']), '一 56、三 34')
  assert.equal(describeKeys(['5-n', '5-a']), '五 NA')
  assert.equal(campusName('GF'), '光復')
  assert.equal(campusName('KS'), 'KS')
  assert.equal(campusName('ZZ'), 'ZZ')
  assert.deepEqual(CAMPUSES.slice(0, 2).map((x) => x.code), ['GF', 'YM'])
})

const courses = [
  c('100', 'F34-EC115[GF]', { type: '必修', dep: '資工系' }),
  c('101', 'F345-EC115[GF]'),
  c('102', 'F34-YL402[YM]', { brief: ['Z102'], dep: '通識中心', credit: '2.00' }),
  c('103', 'M12-A1[GF]'),
  c('104', ''),
  c('105', 'F3-A1[GF],M1-A1[GF]', { name: '線性代數' }),
]
const base = { selection: ['5-3', '5-4'], mode: 'inside', campuses: [], categories: [], deps: [], creditMin: '', creditMax: '', keyword: '', excludeIds: [] }
const ids = (hits) => hits.map((h) => h.course.id)

test('findCourses 完全落在內', () => {
  const r = findCourses(courses, base)
  assert.deepEqual(ids(r.inside), ['100', '102'])
  assert.deepEqual(r.overlap, [])
  assert.equal(r.total, 2)
})

test('findCourses 部分重疊：另列一組並標超出', () => {
  const r = findCourses(courses, { ...base, mode: 'overlap' })
  assert.deepEqual(ids(r.inside), ['100', '102'])
  assert.deepEqual(ids(r.overlap), ['105', '101'])
  assert.deepEqual(r.overlap.find((h) => h.course.id === '101').outside, ['5-5'])
})

test('findCourses 各種篩選', () => {
  assert.deepEqual(ids(findCourses(courses, { ...base, campuses: ['YM'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, categories: ['核心・基本素養'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, categories: ['必修'] }).inside), ['100'])
  assert.deepEqual(ids(findCourses(courses, { ...base, deps: ['通識中心'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, creditMin: '3' }).inside), ['100'])
  assert.deepEqual(ids(findCourses(courses, { ...base, creditMax: 2 }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, excludeIds: ['100'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, mode: 'overlap', keyword: '線代' }).overlap), ['105'])
  assert.equal(findCourses(courses, { ...base, selection: [] }).total, 0)
})

test('findCourses 超過 200 門時截斷', () => {
  const many = Array.from({ length: 250 }, (_, i) => c(String(1000 + i), 'F3-A1[GF]'))
  const r = findCourses(many, { ...base, selection: ['5-3'] })
  assert.equal(r.total, 250)
  assert.equal(r.inside.length, 200)
  assert.equal(r.truncated, true)
})
```

Ordering note: `105` (first slot `1-1`) sorts before `101` (first slot `5-3`) because groups are ordered by the earliest slot in `ALL_SLOTS` order, then by id.

- [ ] **Step 2: Run to verify failure** (module not found).

- [ ] **Step 3: Implement** `src/lib/freeslots.js`

```js
// 找空堂課程：時段、空堂、比對與篩選。全部是純函式。
// 時段 key 是 "<星期>-<節次代碼>"，星期 1–7（週一 = 1）。
import { PERIODS, parseCosTime, DAY_NAMES } from './periods.js'
import { searchCourses } from './search.js'

const str = (v) => (v == null ? '' : String(v))

export const slotKey = (day, period) => `${day}-${period}`
export const ALL_SLOTS = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => PERIODS.map((p) => slotKey(d, p.code)))
const ORDER = new Map(ALL_SLOTS.map((k, i) => [k, i]))

// GF、YM 是主要校區排前面；BM、KS 名稱未確認，先顯示代碼
export const CAMPUSES = [
  { code: 'GF', name: '光復' },
  { code: 'YM', name: '陽明' },
  { code: 'BA', name: '博愛' },
  { code: 'LJ', name: '六家' },
  { code: 'GR', name: '歸仁' },
  { code: 'BM', name: 'BM' },
  { code: 'KS', name: 'KS' },
]
const CAMPUS_NAMES = new Map(CAMPUSES.map((c) => [c.code, c.name]))
export const campusName = (code) => CAMPUS_NAMES.get(str(code)) || str(code)

const unique = (list) => [...new Set(list)]

export function courseSlots(course) {
  const slots = parseCosTime(course && course.time)
  const keys = unique(slots.map((s) => slotKey(s.day, s.period))).sort((a, b) => ORDER.get(a) - ORDER.get(b))
  return {
    keys,
    campuses: unique(slots.map((s) => s.campus).filter(Boolean)),
    rooms: unique(slots.flatMap((s) => str(s.room).split('、')).filter(Boolean)),
  }
}

export function occupiedSlots(items) {
  const out = new Set()
  for (const item of items || []) for (const s of item.slots || []) if (s.day && s.period) out.add(slotKey(s.day, s.period))
  return out
}

export const freeSlots = (occupied) => ALL_SLOTS.filter((k) => !occupied.has(k))

export function matchCourse(keys, selection) {
  const inCount = keys.filter((k) => selection.has(k)).length
  return {
    inside: keys.length > 0 && inCount === keys.length,
    overlap: inCount > 0,
    outside: keys.filter((k) => !selection.has(k)),
  }
}

export const CATEGORIES = ['必修', '選修', '核心・基本素養', '核心・領域課程', '語言與溝通']

export function courseCategories(course) {
  const out = []
  const type = str(course && course.type)
  if (type === '必修' || type === '選修') out.push(type)
  const codes = (course && course.brief) || []
  if (codes.some((c) => /^Z10[0-4]$/.test(c))) out.push('核心・基本素養')
  if (codes.some((c) => /^Z10[5-8]$/.test(c))) out.push('核心・領域課程')
  if (codes.some((c) => /^Z2/.test(c))) out.push('語言與溝通')
  return out
}

export const hasBriefData = (courses) => (courses || []).some((c) => Array.isArray(c.brief) && c.brief.length)

// ['1-5','1-6','3-3'] -> '一 56、三 3'
export function describeKeys(keys) {
  const byDay = new Map()
  for (const k of [...keys].sort((a, b) => ORDER.get(a) - ORDER.get(b))) {
    const [day, code] = k.split('-')
    const label = (PERIODS.find((p) => p.code === code) || {}).label || code
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(label)
  }
  return [...byDay].map(([day, labels]) => `${DAY_NAMES[Number(day)]} ${labels.join('')}`).join('、')
}

export const RESULT_LIMIT = 200

const numberOr = (v, fallback) => {
  const n = Number(str(v).trim())
  return str(v).trim() !== '' && Number.isFinite(n) ? n : fallback
}

export function findCourses(courses, filters) {
  const f = filters || {}
  const selection = f.selection instanceof Set ? f.selection : new Set(f.selection || [])
  const empty = { total: 0, inside: [], overlap: [], truncated: false }
  if (!selection.size) return empty
  const campuses = new Set(f.campuses || [])
  const categories = new Set(f.categories || [])
  const deps = new Set(f.deps || [])
  const excluded = new Set((f.excludeIds || []).map(str))
  const min = numberOr(f.creditMin, -Infinity)
  const max = numberOr(f.creditMax, Infinity)
  const keywordIds = str(f.keyword).trim() ? new Set(searchCourses(courses, f.keyword, Infinity).items.map((c) => c.id)) : null

  const inside = []
  const overlap = []
  for (const course of courses || []) {
    if (excluded.has(str(course.id))) continue
    if (keywordIds && !keywordIds.has(course.id)) continue
    if (deps.size && !deps.has(course.dep)) continue
    const credit = Number(course.credit)
    if (Number.isFinite(credit) && (credit < min || credit > max)) continue
    if (categories.size && !courseCategories(course).some((c) => categories.has(c))) continue
    const { keys, campuses: courseCampuses } = courseSlots(course)
    if (!keys.length) continue
    if (campuses.size && !courseCampuses.some((c) => campuses.has(c))) continue
    const m = matchCourse(keys, selection)
    if (m.inside) inside.push({ course, keys, outside: [] })
    else if (f.mode === 'overlap' && m.overlap) overlap.push({ course, keys, outside: m.outside })
  }
  const byTime = (a, b) => ORDER.get(a.keys[0]) - ORDER.get(b.keys[0]) || str(a.course.id).localeCompare(str(b.course.id))
  inside.sort(byTime)
  overlap.sort(byTime)
  const total = inside.length + overlap.length
  const keepInside = inside.slice(0, RESULT_LIMIT)
  const keepOverlap = overlap.slice(0, Math.max(0, RESULT_LIMIT - keepInside.length))
  return { total, inside: keepInside, overlap: keepOverlap, truncated: total > RESULT_LIMIT }
}
```

- [ ] **Step 4:** Run `npm test` and expect `fail 0`. If the `findCourses` ordering assertion fails, check that `ORDER` uses day-major order: `1-1` < `5-3`.
- [ ] **Step 5: Commit** with message `新增 freeslots：時段、空堂、比對與篩選`.

---

### Task 3: `lib/grid-select.js`

**Files:**
- Create: `src/lib/grid-select.js`
- Test: `test/grid-select.test.js`

**Interfaces:**
- Consumes: `ALL_SLOTS`, `slotKey` (Task 2), `PERIODS`.
- Produces:
  - `dragMode(selection: Set, startKey) -> 'add'|'remove'`.
  - `rectKeys(startKey, endKey) -> string[]`: the rectangle between any two corners, inclusive.
  - `applyKeys(selection: Set, keys, mode) -> Set` (a new set).
  - `toggleGroup(selection: Set, keys) -> Set`: remove all when all are selected, otherwise add all.
  - `dayKeys(day) -> string[]` and `periodKeys(code) -> string[]`.

- [ ] **Step 1: Failing tests**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragMode, rectKeys, applyKeys, toggleGroup, dayKeys, periodKeys } from '../src/lib/grid-select.js'

test('dragMode：起點未選就選取，已選就取消', () => {
  const sel = new Set(['1-1'])
  assert.equal(dragMode(sel, '1-1'), 'remove')
  assert.equal(dragMode(sel, '1-2'), 'add')
})

test('rectKeys：任意方向拖曳都得到同一個矩形', () => {
  const a = rectKeys('2-3', '3-4')
  assert.deepEqual(a, ['2-3', '2-4', '3-3', '3-4'])
  assert.deepEqual(rectKeys('3-4', '2-3'), a)
  assert.deepEqual(rectKeys('1-4', '1-5'), ['1-4', '1-n', '1-5'])
  assert.deepEqual(rectKeys('5-3', '5-3'), ['5-3'])
})

test('applyKeys 回傳新集合', () => {
  const sel = new Set(['1-1'])
  const added = applyKeys(sel, ['1-2', '1-3'], 'add')
  assert.deepEqual([...added].sort(), ['1-1', '1-2', '1-3'])
  assert.deepEqual([...sel], ['1-1'])
  assert.deepEqual([...applyKeys(added, ['1-1', '1-2'], 'remove')], ['1-3'])
})

test('點一格：單格矩形配合起點模式等於切換', () => {
  const sel = new Set(['1-1'])
  assert.deepEqual([...applyKeys(sel, rectKeys('1-1', '1-1'), dragMode(sel, '1-1'))], [])
})

test('toggleGroup：整天或整節，全選時取消，否則全選', () => {
  const mon = dayKeys(1)
  assert.equal(mon.length, 16)
  const all = toggleGroup(new Set(['1-1']), mon)
  assert.equal(all.size, 16)
  assert.equal(toggleGroup(all, mon).size, 0)
  assert.deepEqual(periodKeys('3'), ['1-3', '2-3', '3-3', '4-3', '5-3', '6-3', '7-3'])
})
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement**

```js
// 框選規則：拖曳的起點決定這次是選取還是取消；矩形可以往任何方向拉
import { PERIODS } from './periods.js'
import { slotKey } from './freeslots.js'

const PERIOD_INDEX = new Map(PERIODS.map((p, i) => [p.code, i]))
const parse = (key) => {
  const [day, code] = String(key).split('-')
  return { day: Number(day), idx: PERIOD_INDEX.get(code) }
}

export const dragMode = (selection, startKey) => (selection.has(startKey) ? 'remove' : 'add')

export function rectKeys(startKey, endKey) {
  const a = parse(startKey)
  const b = parse(endKey)
  const out = []
  for (let d = Math.min(a.day, b.day); d <= Math.max(a.day, b.day); d++) {
    for (let i = Math.min(a.idx, b.idx); i <= Math.max(a.idx, b.idx); i++) out.push(slotKey(d, PERIODS[i].code))
  }
  return out
}

export function applyKeys(selection, keys, mode) {
  const next = new Set(selection)
  for (const k of keys) mode === 'remove' ? next.delete(k) : next.add(k)
  return next
}

export const toggleGroup = (selection, keys) => applyKeys(selection, keys, keys.every((k) => selection.has(k)) ? 'remove' : 'add')
export const dayKeys = (day) => PERIODS.map((p) => slotKey(day, p.code))
export const periodKeys = (code) => [1, 2, 3, 4, 5, 6, 7].map((d) => slotKey(d, code))
```

- [ ] **Step 4:** Run `npm test` and expect `fail 0`.
- [ ] **Step 5: Commit** with message `新增 grid-select：框選規則`.

**Checkpoint A:** stop and show the user the logic results (test names plus a few example outputs).

---

### Task 4: Extract `src/cos-tab.js` from `register.js`

**Files:**
- Create: `src/cos-tab.js`
- Modify: `src/register.js` (delete the local `findCosTab`, `ask` and `replyProblem`; import them instead)

**Interfaces:**
- Produces:
  - `findCosTab() -> Promise<Tab|null>`.
  - `askCos(message) -> Promise<reply>`: on failure returns `{ok:false, reason:'no_tab'|'no_content_script'}`.
  - `cosProblem(reply) -> string`: the same texts as the current `replyProblem`.

- [ ] **Step 1:** Create `src/cos-tab.js` with the three functions copied verbatim from `src/register.js` lines 49–71, renamed: `ask` becomes `askCos` and `replyProblem` becomes `cosProblem`. All three are exported.
- [ ] **Step 2:** In `src/register.js`:
  - Add `import { findCosTab, askCos as ask, cosProblem as replyProblem } from './cos-tab.js'`.
  - Delete the three local definitions. The aliases keep every call site unchanged.
- [ ] **Step 3:** Run `node --check src/register.js src/cos-tab.js && npm test`, then the E2E suites `register`, `autoreg`, `closed`, `fallback` and `attribution`. All must pass.
- [ ] **Step 4: Commit** with message `選課網分頁溝通抽成 cos-tab.js，選課頁與規劃頁共用`.

---

### Task 5: Planner page, grid with drag selection, fill buttons, persistence, popup entry

**Files:**
- Create: `src/planner.html`, `src/planner.css`, `src/planner.js`, `src/planner/slot-grid.js`
- Modify: `src/popup.html` (a button `<button id="btn-planner" type="button" title="開啟選課規劃">規劃 ↗</button>` placed before `#btn-schedule`), `src/popup.js` (its click handler)

**Interfaces:**
- Consumes: Task 2 (`ALL_SLOTS`, `occupiedSlots`, `freeSlots`), Task 3 (all functions), `scheduleItems`, `PERIODS`, `DAY_NAMES`.
- Produces:
  - `createSlotGrid(container, { onChange(nextSelection: Set) }) -> { render(selection: Set, occupied: Map<key,string>), preview(inKeys: string[], outKeys: string[]) }`.
  - DOM: every cell is `<div class="cell" data-key="d-p">`. Day headers are `[data-day]` and period headers are `[data-period]`. Selected cells have class `selected`; occupied cells have class `busy` and a `title` holding the course names.

- [ ] **Step 1: `src/planner.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>選課規劃</title>
  <link rel="stylesheet" href="planner.css">
</head>
<body>
  <header class="page-head">
    <h1>選課規劃</h1>
    <p class="sub">找空堂課程：框選想上課的時段，找出落在這些時段的課。</p>
  </header>
  <main class="layout">
    <section class="left">
      <div class="toolbar">
        <button id="fill-registered" type="button">帶入空堂：避開正式選課</button>
        <button id="fill-all" type="button">帶入空堂：避開正式選課＋預排</button>
        <button id="clear" type="button">全部清除</button>
        <span id="count" class="muted"></span>
      </div>
      <p class="muted tip">拖曳可以框選；從已選的格子開始拖曳就是取消。點星期或節次可以整天、整節切換。</p>
      <div id="grid" class="slot-grid"></div>
      <form id="filters" class="filters" autocomplete="off"></form>
    </section>
    <section class="right">
      <p id="summary" class="summary"></p>
      <p id="cos-hint" class="muted" hidden></p>
      <div id="results"></div>
    </section>
  </main>
  <script type="module" src="planner.js"></script>
</body>
</html>
```

(The `#filters` form is filled in Task 6. In this task `planner.js` leaves it empty.)

- [ ] **Step 2: `src/planner/slot-grid.js`**

```js
// 框選格子：7 天 × 16 節。拖曳的起點決定選取或取消，放開才寫入；點標題整天／整節切換。
import { PERIODS, DAY_NAMES } from '../lib/periods.js'
import { slotKey } from '../lib/freeslots.js'
import { dragMode, rectKeys, applyKeys, toggleGroup, dayKeys, periodKeys } from '../lib/grid-select.js'

export function createSlotGrid(container, { onChange }) {
  let selection = new Set()
  let drag = null // { start, mode, current }

  container.replaceChildren()
  container.append(Object.assign(document.createElement('div'), { className: 'corner' }))
  for (let d = 1; d <= 7; d++) {
    const h = document.createElement('button')
    h.type = 'button'
    h.className = 'head day'
    h.dataset.day = String(d)
    h.textContent = DAY_NAMES[d]
    h.addEventListener('click', () => onChange(toggleGroup(selection, dayKeys(d))))
    container.append(h)
  }
  for (const p of PERIODS) {
    const h = document.createElement('button')
    h.type = 'button'
    h.className = 'head period'
    h.dataset.period = p.code
    h.innerHTML = ''
    h.append(Object.assign(document.createElement('b'), { textContent: p.label }), Object.assign(document.createElement('small'), { textContent: p.start }))
    h.addEventListener('click', () => onChange(toggleGroup(selection, periodKeys(p.code))))
    container.append(h)
    for (let d = 1; d <= 7; d++) {
      const cell = document.createElement('div')
      cell.className = 'cell'
      cell.dataset.key = slotKey(d, p.code)
      container.append(cell)
    }
  }

  const keyAt = (x, y) => {
    const el = document.elementFromPoint(x, y)
    const cell = el && el.closest && el.closest('.cell')
    return cell && container.contains(cell) ? cell.dataset.key : null
  }
  const paintDrag = () => {
    const keys = drag ? new Set(rectKeys(drag.start, drag.current)) : new Set()
    for (const cell of container.querySelectorAll('.cell')) {
      const inRect = keys.has(cell.dataset.key)
      cell.classList.toggle('drag-add', inRect && drag.mode === 'add')
      cell.classList.toggle('drag-remove', inRect && drag.mode === 'remove')
    }
  }

  container.addEventListener('pointerdown', (e) => {
    const key = keyAt(e.clientX, e.clientY)
    if (!key || e.button !== 0) return
    e.preventDefault()
    container.setPointerCapture(e.pointerId)
    drag = { start: key, current: key, mode: dragMode(selection, key) }
    paintDrag()
  })
  container.addEventListener('pointermove', (e) => {
    if (!drag) return
    const key = keyAt(e.clientX, e.clientY)
    if (key && key !== drag.current) {
      drag.current = key
      paintDrag()
    }
  })
  const finish = (commit) => {
    if (!drag) return
    const { start, current, mode } = drag
    drag = null
    paintDrag()
    if (commit) onChange(applyKeys(selection, rectKeys(start, current), mode))
  }
  container.addEventListener('pointerup', () => finish(true))
  container.addEventListener('pointercancel', () => finish(false))

  return {
    render(nextSelection, occupied = new Map()) {
      selection = new Set(nextSelection)
      for (const cell of container.querySelectorAll('.cell')) {
        const key = cell.dataset.key
        cell.classList.toggle('selected', selection.has(key))
        const busy = occupied.get(key)
        cell.classList.toggle('busy', Boolean(busy))
        cell.textContent = busy ? busy.slice(0, 4) : ''
        cell.title = busy || ''
      }
    },
    preview(inKeys = [], outKeys = []) {
      const inside = new Set(inKeys)
      const outside = new Set(outKeys)
      for (const cell of container.querySelectorAll('.cell')) {
        cell.classList.toggle('preview-in', inside.has(cell.dataset.key))
        cell.classList.toggle('preview-out', outside.has(cell.dataset.key))
      }
    },
  }
}
```

- [ ] **Step 3: `src/planner.js` (Task 5 portion)**

```js
// 選課規劃頁（目前只有「找空堂課程」）。狀態：選取的時段與篩選條件，存在 storage 的 planner。
import { scheduleItems } from './lib/schedule.js'
import { ALL_SLOTS, occupiedSlots, freeSlots } from './lib/freeslots.js'
import { createSlotGrid } from './planner/slot-grid.js'

const $ = (sel) => document.querySelector(sel)
const VALID = new Set(ALL_SLOTS)
const DEFAULT_FILTERS = { mode: 'inside', campuses: [], categories: [], deps: [], creditMin: '', creditMax: '', keyword: '', excludeRegistered: false, excludePreregist: false }

const state = {
  selection: new Set(),
  filters: { ...DEFAULT_FILTERS },
  schedule: { sources: {}, manual: [], overrides: {} },
  courseData: null,
}
let grid = null

function occupiedLabels() {
  const labels = new Map()
  for (const item of scheduleItems(state.schedule, ['registered', 'preregist'])) {
    for (const s of item.slots || []) {
      const key = `${s.day}-${s.period}`
      labels.set(key, labels.has(key) ? `${labels.get(key)}、${item.title}` : item.title)
    }
  }
  return labels
}

async function save() {
  try {
    await chrome.storage.local.set({ planner: { selection: [...state.selection], filters: state.filters } })
  } catch {}
}

function render() {
  grid.render(state.selection, occupiedLabels())
  $('#count').textContent = `已選 ${state.selection.size} 格`
  renderResults()
}

// Task 6 會換成真正的結果清單
function renderResults() {}

function setSelection(next) {
  state.selection = new Set([...next].filter((k) => VALID.has(k)))
  save()
  render()
}

function fill(sources) {
  setSelection(freeSlots(occupiedSlots(scheduleItems(state.schedule, sources))))
}

function restore(saved) {
  if (!saved || typeof saved !== 'object') return
  if (Array.isArray(saved.selection)) state.selection = new Set(saved.selection.filter((k) => VALID.has(k)))
  if (saved.filters && typeof saved.filters === 'object') state.filters = { ...DEFAULT_FILTERS, ...saved.filters }
}

async function init() {
  const stored = await chrome.storage.local.get(['planner', 'schedule', 'courseData'])
  restore(stored.planner)
  if (stored.schedule) state.schedule = stored.schedule
  state.courseData = stored.courseData || null
  grid = createSlotGrid($('#grid'), { onChange: setSelection })
  $('#fill-registered').addEventListener('click', () => fill(['registered']))
  $('#fill-all').addEventListener('click', () => fill(['registered', 'preregist']))
  $('#clear').addEventListener('click', () => setSelection(new Set()))
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.schedule) state.schedule = changes.schedule.newValue || state.schedule
    if (changes.courseData) state.courseData = changes.courseData.newValue || state.courseData
    if (changes.schedule || changes.courseData) render()
  })
  render()
}

init()
```

- [ ] **Step 4: `src/planner.css`**

```css
:root {
  color-scheme: light dark;
  --muted: #6b7280;
  --line: rgba(127, 127, 127, .3);
  --accent: #1f6feb;
  --error: #c62828;
  --ok: #15803d;
  --sel: rgba(31, 111, 235, .28);
}
body { margin: 0; padding: 20px 24px; font: 14px/1.5 -apple-system, "PingFang TC", "Noto Sans TC", system-ui, sans-serif; }
h1 { margin: 0; font-size: 22px; }
.sub, .muted { color: var(--muted); }
.sub { margin: 2px 0 14px; }
.layout { display: grid; grid-template-columns: minmax(420px, 560px) minmax(0, 1fr); gap: 24px; align-items: start; }
@media (max-width: 900px) { .layout { grid-template-columns: 1fr; } }
.toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.tip { font-size: 12px; margin: 6px 0; }
button { font: inherit; padding: 4px 10px; cursor: pointer; }

.slot-grid {
  display: grid;
  grid-template-columns: 52px repeat(7, minmax(0, 1fr));
  gap: 2px;
  user-select: none;
  touch-action: none;
  font-size: 11px;
}
.slot-grid .head { border: none; background: none; color: var(--muted); padding: 2px; cursor: pointer; }
.slot-grid .head:hover { color: CanvasText; }
.slot-grid .head.period { display: flex; gap: 4px; align-items: baseline; justify-content: flex-start; }
.slot-grid .head.period small { font-size: 10px; }
.slot-grid .cell {
  height: 24px;
  border: 1px solid var(--line);
  border-radius: 4px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 0 3px;
  line-height: 22px;
  color: var(--muted);
  cursor: crosshair;
}
.slot-grid .cell.busy { background: repeating-linear-gradient(135deg, rgba(127,127,127,.14) 0 4px, transparent 4px 8px); }
.slot-grid .cell.selected { background: var(--sel); border-color: var(--accent); color: CanvasText; }
.slot-grid .cell.drag-add { background: rgba(31, 111, 235, .45); }
.slot-grid .cell.drag-remove { background: rgba(127, 127, 127, .35); border-style: dashed; }
.slot-grid .cell.preview-in { box-shadow: inset 0 0 0 2px var(--accent); }
.slot-grid .cell.preview-out { box-shadow: inset 0 0 0 2px var(--error); }
```

- [ ] **Step 5: Popup entry.**
  - In `src/popup.html`, put `<button id="btn-planner" type="button" title="開啟選課規劃">規劃 ↗</button>` as the first child of `.shell-actions`.
  - In `src/popup.js` `init()`, add `document.getElementById('btn-planner').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/planner.html') }))`.

- [ ] **Step 6: Quick E2E (scratchpad `e2e/planner.mjs`, first version).**
  - Load the extension.
  - Seed `schedule` with registered `M12-A1[GF]`, preregist `T34-B2[GF]` and a manual item on Wednesday period `a`.
  - Open `chrome-extension://<id>/src/planner.html`.
  - Click `#fill-registered`: expect `#count` to read `已選 109 格`.
  - Click `#fill-all`: expect `已選 107 格`.
  - Drag with `page.mouse` from the centre of `[data-key="1-3"]` to `[data-key="2-4"]`. Those cells were selected, so the drag removes them: expect `已選 103 格`.
  - Drag from an unselected cell `1-1` to `1-2`: expect `105`.
  - Click `[data-day="7"]`: all Sunday cells are selected, so they get removed. Expect `89`.
  - Reload the page: expect `89` again.
  - In the popup, click `#btn-planner`: expect a new page whose url ends with `/src/planner.html`.
  - Take the screenshot `planner-grid.png`.

  Run it and expect `PASS`.

- [ ] **Step 7: Commit** with message `選課規劃頁：框選時段格子、帶入空堂、記住選取；popup 加入口`.

**Checkpoint B:** send `planner-grid.png` to the user.

---

### Task 6: Filters, results, hover preview, add to 預排

**Files:**
- Create: `src/planner/results.js`
- Modify: `src/planner.js` (filters UI, `renderResults`, add flow), `src/planner.css` (append)

**Interfaces:**
- Consumes:
  - `findCourses`, `CAMPUSES`, `CATEGORIES`, `campusName`, `courseSlots`, `courseCategories`, `describeKeys`, `hasBriefData` (Task 2).
  - `askCos`, `cosProblem` (Task 4).
  - `findAttributionOptions`, `needsChoice`, `preregParams`, `courseDepUids` (`lib/attribution.js`).
  - `courseOutlineUrl` (`lib/links.js`).
- Produces:
  - `renderResults(container, found, ctx)`, where `ctx = { semester, preregIds: Set, addState: Map<id, {status, msg?, options?}>, onHover(hit|null), onAdd(course), onChoose(course, option), onCancel(course) }`.

- [ ] **Step 1: Filters markup.** In `planner.js`, add `renderFilters()`, which builds `#filters` once:
  - `比對方式`: radios `name="mode"` with values `inside` (完全落在內) and `overlap` (部分重疊).
  - `校區`: checkboxes from `CAMPUSES`, value = code, label = `campusName`.
  - `類別`: checkboxes from `CATEGORIES`. When `!hasBriefData(courses)`, disable the three code-based ones and show `<p class="muted">重新更新課程資料後才能篩核心、語言與溝通</p>`.
  - `開課單位`: `<select id="deps" multiple size="6">` holding every distinct `course.dep`, sorted with `localeCompare(…, 'zh-Hant')`.
  - `學分`: `<input id="credit-min" type="number" min="0" step="1">`, then 「到」, then `<input id="credit-max" …>`.
  - `關鍵字`: `<input id="keyword" type="search" placeholder="課名、老師或課號">`.
  - `排除`: checkboxes `#exclude-registered`「已在正式選課的課」 and `#exclude-preregist`「已在預排的課」.

  Every input's `input`/`change` event reads the form into `state.filters` and calls `save()` then `renderResults()`. Initial values come from `state.filters`.

```js
function readFilters() {
  const form = $('#filters')
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value)
  state.filters = {
    mode: (form.querySelector('input[name="mode"]:checked') || {}).value || 'inside',
    campuses: checked('campus'),
    categories: checked('category'),
    deps: [...$('#deps').selectedOptions].map((o) => o.value),
    creditMin: $('#credit-min').value,
    creditMax: $('#credit-max').value,
    keyword: $('#keyword').value,
    excludeRegistered: $('#exclude-registered').checked,
    excludePreregist: $('#exclude-preregist').checked,
  }
  save()
  renderResults()
}
```

- [ ] **Step 2: `renderResults` in `planner.js`**

```js
const addState = new Map()

function idsOf(source) {
  const src = (state.schedule.sources || {})[source]
  return new Set(((src && src.courses) || []).map((c) => String(c.cos_id)))
}

function renderResults() {
  const courses = (state.courseData && state.courseData.courses) || []
  if (!courses.length) {
    $('#summary').textContent = '還沒有課程資料，請先在擴充功能的「加入預排」按「更新課程資料」。'
    $('#results').replaceChildren()
    return
  }
  if (!state.selection.size) {
    $('#summary').textContent = '先在左邊框選時段，或按「帶入空堂」。'
    $('#results').replaceChildren()
    return
  }
  const f = state.filters
  const excludeIds = [...(f.excludeRegistered ? idsOf('registered') : []), ...(f.excludePreregist ? idsOf('preregist') : [])]
  const found = findCourses(courses, { ...f, selection: state.selection, excludeIds })
  $('#summary').textContent = found.truncated
    ? `共 ${found.total} 門，只顯示前 ${RESULT_LIMIT} 門，請再縮小條件`
    : `共 ${found.total} 門`
  renderResultList($('#results'), found, {
    semester: state.courseData.semester,
    preregIds: idsOf('preregist'),
    addState,
    onHover: (hit) => grid.preview(hit ? hit.keys.filter((k) => state.selection.has(k)) : [], hit ? hit.outside : []),
    onAdd: addCourse,
    onChoose: (course, option) => submitAdd(course, option),
    onCancel: (course) => {
      addState.delete(course.id)
      renderResults()
    },
  })
}
```

Import `renderResults as renderResultList` from `./planner/results.js`, and `findCourses`, `RESULT_LIMIT` from `./lib/freeslots.js`.

- [ ] **Step 3: `src/planner/results.js`**

```js
// 找空堂的結果清單：分「完全落在內」「部分重疊」兩組；滑過卡片在格子上預覽時段
import { courseSlots, courseCategories, describeKeys, campusName } from '../lib/freeslots.js'
import { courseOutlineUrl } from '../lib/links.js'

function card(hit, ctx) {
  const { course } = hit
  const li = document.createElement('li')
  li.className = 'card'
  li.dataset.id = course.id
  li.addEventListener('mouseenter', () => ctx.onHover(hit))
  li.addEventListener('mouseleave', () => ctx.onHover(null))

  const info = document.createElement('div')
  info.className = 'info'
  const url = courseOutlineUrl(ctx.semester, course.id)
  const title = document.createElement(url ? 'a' : 'span')
  title.className = 'title'
  if (url) Object.assign(title, { href: url, target: '_blank', rel: 'noreferrer' })
  title.textContent = `${course.id} ${course.name}`
  const { campuses, rooms } = courseSlots(course)
  const meta = document.createElement('div')
  meta.className = 'meta'
  meta.textContent = [
    course.teacher,
    describeKeys(hit.keys),
    rooms.join('、'),
    campuses.map(campusName).join('、'),
    course.credit ? `${Number(course.credit)} 學分` : '',
    courseCategories(course).join('・'),
    course.dep,
  ].filter(Boolean).join('・')
  info.append(title, meta)
  if (hit.outside.length) {
    const out = document.createElement('div')
    out.className = 'outside'
    out.textContent = `超出：${describeKeys(hit.outside)}`
    info.append(out)
  }

  const actions = document.createElement('div')
  actions.className = 'actions'
  const s = ctx.addState.get(course.id)
  if (ctx.preregIds.has(course.id) || (s && (s.status === 'added' || s.status === 'exists'))) {
    actions.append(Object.assign(document.createElement('span'), { className: 'ok', textContent: s && s.status === 'added' ? `已加入${s.note ? `・${s.note}` : ''}` : '已在預排' }))
  } else if (s && s.status === 'pending') {
    actions.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: '加入中…' }))
  } else {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = s && s.status === 'error' ? '重試' : '加入'
    btn.addEventListener('click', () => ctx.onAdd(course))
    actions.append(btn)
    if (s && s.status === 'error') actions.prepend(Object.assign(document.createElement('span'), { className: 'error', textContent: s.msg }))
  }
  li.append(info, actions)

  if (s && s.status === 'choose') {
    const box = document.createElement('div')
    box.className = 'choices'
    box.append(s.options.length === 1 && s.options[0].source !== 'home' ? '在開課系所找不到，只找到：' : '這門課可以算：')
    for (const option of s.options) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = option.label
      b.addEventListener('click', () => ctx.onChoose(course, option))
      box.append(b)
    }
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'link'
    cancel.textContent = '取消'
    cancel.addEventListener('click', () => ctx.onCancel(course))
    box.append(cancel)
    li.append(box)
  }
  return li
}

export function renderResults(container, found, ctx) {
  container.replaceChildren()
  const groups = [
    ['完全落在內', found.inside],
    ['部分重疊', found.overlap],
  ].filter(([, hits]) => hits.length)
  for (const [label, hits] of groups) {
    const h = document.createElement('h2')
    h.textContent = `${label}（${hits.length}）`
    const ul = document.createElement('ul')
    ul.className = 'cards'
    ul.append(...hits.map((hit) => card(hit, ctx)))
    container.append(h, ul)
  }
}
```

- [ ] **Step 4: Add flow in `planner.js`**

```js
import { askCos, cosProblem } from './cos-tab.js'
import { findAttributionOptions, needsChoice, preregParams, courseDepUids } from './lib/attribution.js'

let depTree = null

async function addCourse(course) {
  addState.set(course.id, { status: 'pending' })
  renderResults()
  let options = []
  try {
    if (!depTree) {
      const reply = await askCos({ type: 'deptree' })
      if (!reply || !reply.ok) throw Object.assign(new Error(cosProblem(reply)), { reply })
      depTree = reply.tree
    }
    options = await findAttributionOptions({
      cosId: course.id,
      courseName: course.name,
      depUids: courseDepUids(course),
      getTree: async () => depTree,
      getList: async (menu) => {
        const reply = await askCos({ type: 'courselist', menu })
        if (reply && reply.ok) return reply.list
        throw Object.assign(new Error(cosProblem(reply)), { reply })
      },
    })
  } catch (err) {
    const reason = err && err.reply && err.reply.reason
    addState.set(course.id, { status: 'error', msg: reason === 'no_tab' || reason === 'not_logged_in' ? '請先開啟並登入選課網' : err.message })
    renderResults()
    return
  }
  if (needsChoice(options)) {
    addState.set(course.id, { status: 'choose', options })
    renderResults()
    return
  }
  submitAdd(course, options[0] || null)
}

async function submitAdd(course, option) {
  addState.set(course.id, { status: 'pending' })
  renderResults()
  const params = option ? { [course.id]: preregParams(course.id, option) } : {}
  const reply = await askCos({ type: 'import', ids: [course.id], params })
  const result = reply && reply.ok && reply.results && reply.results[0]
  if (result && (result.status === 'added' || result.status === 'exists')) {
    addState.set(course.id, { status: result.status, note: option ? option.label : '' })
  } else {
    addState.set(course.id, { status: 'error', msg: result ? result.msg || '加入失敗' : reply && (reply.reason === 'no_tab' || reply.reason === 'not_logged_in') ? '請先開啟並登入選課網' : cosProblem(reply) })
  }
  renderResults()
}
```

Also show `#cos-hint` 「加入預排需要開著已登入的選課網分頁」 when `findCosTab()` returns null at load time.

- [ ] **Step 5: Styles** (append to `planner.css`)

```css
.filters { display: grid; gap: 8px; margin-top: 14px; font-size: 13px; }
.filters fieldset { border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; margin: 0; }
.filters legend { color: var(--muted); font-size: 12px; }
.filters label { margin-right: 10px; white-space: nowrap; }
.filters input[type="number"] { width: 60px; }
.filters select { min-width: 200px; }
.summary { font-weight: 600; margin: 0 0 6px; }
.right h2 { font-size: 14px; margin: 14px 0 6px; }
.cards { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.card { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
.card:hover { border-color: var(--accent); }
.card .info { flex: 1; min-width: 0; }
.card .title { font-weight: 600; color: inherit; text-decoration: none; }
.card a.title:hover { text-decoration: underline; }
.card .meta { font-size: 12px; color: var(--muted); }
.card .outside { font-size: 12px; color: var(--error); }
.card .actions { display: flex; gap: 6px; align-items: center; }
.card .ok { color: var(--ok); font-size: 12px; }
.card .error { color: var(--error); font-size: 12px; }
.card .choices { flex-basis: 100%; display: flex; flex-wrap: wrap; gap: 4px 6px; align-items: center; font-size: 12px; color: var(--muted); }
button.link { background: none; border: none; padding: 0 2px; color: var(--muted); text-decoration: underline; }
```

- [ ] **Step 6:** Run `node --check` on every planner file, then `npm test`.
- [ ] **Step 7: Commit** with message `選課規劃頁：篩選、結果清單、滑過預覽、加入預排`.

---

### Task 7: E2E, version, README, screenshots, release

**Files:**
- Modify: scratchpad `e2e/planner.mjs` (extend), `manifest.json`/`package.json` (`0.8.0`), `README.md`, and the version strings in the other E2E scripts (`sed` as in earlier releases).

- [ ] **Step 1: Extend `e2e/planner.mjs`.** Seed `courseData`:
  - `100 F34-EC115[GF] 必修 資工系 3.00`
  - `101 F345-EC115[GF]`
  - `102 F34-YL402[YM] brief ['Z102'] 通識中心 2.00`
  - `105 F3-A1[GF],M1-A1[GF] 線性代數`
  - `106 F34-EC115[GF]`: the preregist already has this one.

  Each course has `menu: { type:'1', dep_category:'3*', college_no:'C', dep_uid:'CS' }`.

  Mock cos:
  - `getdep`: a tree with dept `CS` (`全部`) and 校共同 > 核心課程 (`Z10[0-4]`, `Z10[5-8]`).
  - `preregistcourse`: `CS` returns 100/101/105/106 as `選修` (type `2`, wType `X`); `Z10[0-4]` returns 101 as core (type `E`, category `CAT`).
  - `setpreregist`: records the params.

  Steps and checks:
  1. Click `#clear`, then drag from `5-3` to `5-4`: expect `已選 2 格`.
  2. With mode inside: the cards are `100`, `102` and `106`. `106` shows 「已在預排」.
  3. Check `#exclude-preregist`: `106` disappears.
  4. Switch to overlap: a second group heading 「部分重疊（2）」 with `105` and `101`. `101` shows 「超出：五 5」.
  5. Campus YM: only `102`. Clear the campus filter. Category 核心・基本素養: only `102`. Clear. Credit max 2: only `102`. Clear. Keyword 「線代」 in overlap mode: only `105`. Clear.
  6. Hover card `101`: `[data-key="5-3"].preview-in`, `[data-key="5-5"].preview-out`.
  7. Open a cos tab (with token). Click 加入 on `101`: a choice row appears with 「選修」 and 「核心・基本素養-量性推理」. Choose 核心: `setpreregist` params have `wType=E` and the card shows 「已加入・核心…」.
  8. Close the cos tab, then click 加入 on `100`: the card shows 「請先開啟並登入選課網」.
  9. Reload: the selection is still 2 cells, and the filters (overlap, exclude preregist) are kept.
  10. Screenshots `planner-light.png` and `planner-dark.png` at 1280×900, with some results shown.
  11. No page errors.

- [ ] **Step 2:** Bump the version to `0.8.0`. Update the other E2E version expectations with `sed -i '' -E "s/(r|results)\.version === '0\.[0-9]+\.[0-9]+'/\1.version === '0.8.0'/g" *.mjs`.
- [ ] **Step 3: README.** Add a `### 選課規劃：找空堂課程` section after `### 我的課表`:

```markdown
### 選課規劃：找空堂課程

點擴充功能右上的「規劃 ↗」，打開選課規劃頁。

1. 在時段格子上**框選**想上課的時段：按住拖曳就能一次選一大塊；從已選的格子開始拖曳就是取消。點星期或節次可以整天、整節切換。
2. 或按「帶入空堂」：一個只避開正式選課，一個連預排也避開（兩個都會避開你自己加的行程），之後再框選調整。
3. 設定條件：
   - **完全落在內**：課的所有上課時間都在你選的時段裡。
   - **部分重疊**：只要有一節在你選的時段裡就列出，並標出超出的節次。
   - 也可以篩校區、類別（必修、選修、核心、語言與溝通）、開課單位、學分、關鍵字，或排除已經選的課。
4. 滑過一門課，格子上會標出它的上課時間；按「加入」直接放進預排（要開著已登入的選課網）。

要篩核心與語言與溝通課程，需要先在「加入預排」按一次「更新課程資料」。
```

- [ ] **Step 4:** Run `npm test` and the full E2E list plus `planner`. Everything must `PASS`.
- [ ] **Step 5:** Send the screenshots to the user and wait for their OK. **Checkpoint C.**
- [ ] **Step 6:** After the OK:
  - Merge `planner` into master with `--ff-only`, pack, tag `v0.8.0`, push, and create the GitHub release with notes (Chinese, user-facing, same style as v0.7.0).
  - Delete the branch.

---

## Self-Review

- **Spec coverage:**
  - Grid, drag and header toggles → Tasks 3 and 5.
  - Two fill buttons and manual items → Tasks 2 and 5.
  - Match modes and the 「超出」 label → Tasks 2 and 6.
  - All filters → Tasks 2 and 6.
  - Category codes and the old-data hint → Tasks 1, 2 and 6.
  - Campus names (GF/YM first, BM/KS shown as codes) → Task 2.
  - 200 limit → Tasks 2 and 6.
  - Hover preview → Tasks 5 (`preview`) and 6.
  - Add with attribution, and the no-tab hint → Task 6.
  - Persistence → Task 5, plus filters in Task 6.
  - Popup entry → Task 5.
  - Tests and screenshots → every task plus Task 7.
- **Placeholder scan:** none left. A draft sentence in Task 7 step 1 was replaced with the final step.
- **Type consistency:**
  - `findCourses` filters use `selection`, `mode`, `campuses`, `categories`, `deps`, `creditMin`, `creditMax`, `keyword`, `excludeIds` in both Task 2 and Task 6. `state.filters` also holds `excludeRegistered`/`excludePreregist`, which Task 6 converts to `excludeIds`.
  - `grid.preview(inKeys, outKeys)` is the same in Tasks 5 and 6.
  - `askCos`/`cosProblem` are the same in Tasks 4 and 6.
