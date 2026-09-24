# 教室查詢 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增「教室查詢」頁：選校區、大樓、樓層與時間，列出每間教室「上課中」或「沒有排課（到幾點）」，點一間看它的一週課表。

**Architecture:** 課程資料（storage 的 `courseData.courses`，時間字串像 `M34-ED219[GF]`）經 `lib/rooms.js` 建成教室索引；官方大樓代碼表由 `lib/buildings.js` 從課程時間表 API 抓、快取 30 天。頁面 `src/rooms.*` 只做畫面，週課表重用當期選課的 `createTimetable`。

**Tech Stack:** Chrome MV3 擴充功能、原生 ES modules（沒有打包工具）、`node --test` 單元測試、Playwright（`playwright-core`）E2E。

**Spec:** `docs/superpowers/specs/2026-09-24-room-lookup-design.md`

## Global Constraints

- 介面文字一律繁體中文；全頁不出現「空教室」，只說「沒有排課」。
- 固定說明文字（逐字）：`只根據課程資料：考試、演講、教室借用不在內，「沒有排課」不代表一定沒人。`
- 不新增權限（已有 `https://timetable.nycu.edu.tw/*` host 權限）。
- 純邏輯放 `src/lib/`，是純函式、有單元測試；頁面檔案不放計算規則。
- 找教室的輸入框不處理 Enter（注音選字確定的 Enter 會誤觸）。
- 寬視窗（≥ 880px）左右兩欄各自捲動、整頁不捲；窄視窗上下排（沿用 `planner.css`）。
- 顏色沿用 Okabe-Ito：上課中 `#D55E00`、沒有排課 `#009E73`、週課表課程 `#0072B2`。
- 測試指令：`npm test`（在 repo 根目錄）。在 engel-server 用 SSH 跑時要先 `export PATH=/opt/homebrew/bin:$PATH`。
- Commit 訊息用中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。只 commit，不 push。

## File Structure

| 檔案 | 責任 |
|---|---|
| `src/lib/rooms.js`（新） | 教室代碼解析、教室索引、上課區間、某時間點狀態、樓層排序、搜尋、時間小工具 |
| `src/lib/buildings.js`（新） | 官方大樓表整理與快取載入 |
| `test/rooms.test.js`、`test/buildings.test.js`（新） | 上面兩個的單元測試 |
| `src/rooms.html`、`src/rooms.css`、`src/rooms.js`（新） | 教室查詢頁 |
| `src/popup.html`、`src/popup.js`（改） | popup 頁首加「教室 ↗」 |
| `e2e/package.json`、`e2e/README.md`、`e2e/rooms.mjs`（新） | E2E 放進 repo |
| `README.md`、`manifest.json`、`package.json`（改） | 說明與版本 0.12.0 |

---

### Task 1: 教室索引與狀態計算（`src/lib/rooms.js`）

**Files:**
- Create: `src/lib/rooms.js`
- Test: `test/rooms.test.js`

**Interfaces:**
- Consumes: `PERIODS`、`parseCosTime` from `src/lib/periods.js`（`parseCosTime('M34-ED219[GF]')` → `[{ day: 1, period: '3', room: 'ED219', campus: 'GF' }, …]`，節次代碼是小寫，同一時段多間教室用「、」串）；`CAMPUSES` from `src/lib/freeslots.js`（`[{ code: 'GF', name: '光復' }, …]`，GF、YM 在前）。
- Produces（Task 3 會用到，名稱與型別要一致）：
  - `parseRoom(code: string, campus: string, buildings: {[campus]: {[bcode]: {cname, ename}}}) → { code, campus, building, buildingName, floor, known }`
  - `floorLabel(floor: string) → string`（`'2'`→`'2 樓'`、`'0'`→`'0 字頭'`、`'B'`→`'地下室'`、其他→`'其他'`）
  - `buildRoomIndex(courses: [{ id, name, teacher, time }], buildings) → { rooms: Map<key, Room>, noRoom: [{ day, period, course }] }`，`Room = { key: 'GF:ED219', code, campus, building, buildingName, floor, known, slots: [{ day, period, course }] }`
  - `roomSessions(room: { slots }) → [{ day, start, end, course }]`（start/end 是一天中的分鐘數）
  - `roomStatus(room, day: 1..7, minute: number) → { state: 'busy'|'free', courses: course[], until: number|null }`
  - `noRoomCount(index, day, minute) → number`
  - `floorsOf(rooms: Room[]) → string[]`（順序：`B`、`0`、`1`…`9`、`其他`）
  - `matchRooms(rooms: Room[], query: string, limit = 20) → Room[]`
  - `buildingsOf(index, campus) → [{ code, name, known, count }]`（有對上官方表的在前，再依代碼排序）
  - `campusesOf(index) → string[]`（依 `CAMPUSES` 的順序）
  - `periodAt(minute) → string`（該分鐘所在節次代碼，下課或範圍外回 `''`）
  - `nowPoint(date: Date) → { day, minute }`（週一 = 1）
  - `formatMinute(minute) → 'HH:MM'`

- [ ] **Step 1: 寫失敗的測試**

建立 `test/rooms.test.js`：

```js
// 教室查詢的計算。教室代碼與大樓代碼取自 2026-09-24 的實測資料（選課網全掃描＋課程時間表官方大樓表）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseRoom, floorLabel, buildRoomIndex, roomSessions, roomStatus, noRoomCount,
  floorsOf, matchRooms, buildingsOf, campusesOf, periodAt, nowPoint, formatMinute,
} from '../src/lib/rooms.js'

// 官方大樓表（節錄）
const BUILDINGS = {
  GF: {
    A: { cname: '綜合一館' }, AB: { cname: '綜合一館地下室' }, ED: { cname: '工程四館' }, EC: { cname: '工程三館' },
    M: { cname: '管理館' }, Lib: { cname: '浩然圖書資訊中心' }, HB: { cname: '人社二館' }, CS: { cname: '資訊技術服務中心' },
  },
  YM: { YE: { cname: '實驗大樓' }, YT: { cname: '教學大樓' } },
}

test('parseRoom：大樓取最長的官方代碼前綴，樓層取號碼第一位', () => {
  assert.deepEqual(parseRoom('ED219', 'GF', BUILDINGS), { code: 'ED219', campus: 'GF', building: 'ED', buildingName: '工程四館', floor: '2', known: true })
  assert.equal(parseRoom('AB101', 'GF', BUILDINGS).building, 'AB', 'AB 比 A 長，綜合一館地下室不是綜合一館')
  assert.deepEqual([parseRoom('A701', 'GF', BUILDINGS).building, parseRoom('A701', 'GF', BUILDINGS).floor], ['A', '7'])
  assert.equal(parseRoom('HB212-3R', 'GF', BUILDINGS).floor, '2')
})

test('parseRoom：側翼字母、0 字頭、地下室、其他', () => {
  const yed = parseRoom('YED109', 'YM', BUILDINGS)
  assert.deepEqual([yed.building, yed.buildingName, yed.floor], ['YE', '實驗大樓', '1'])
  assert.equal(parseRoom('YT002', 'YM', BUILDINGS).floor, '0')
  assert.equal(parseRoom('M-b09', 'GF', BUILDINGS).floor, 'B')
  assert.deepEqual([parseRoom('Lib-B1', 'GF', BUILDINGS).building, parseRoom('Lib-B1', 'GF', BUILDINGS).floor], ['Lib', 'B'])
  assert.deepEqual([parseRoom('CS-PC2', 'GF', BUILDINGS).building, parseRoom('CS-PC2', 'GF', BUILDINGS).floor], ['CS', '其他'])
})

test('parseRoom：對不上官方表時，大樓用開頭的英文字母、名稱就是代碼', () => {
  assert.deepEqual(parseRoom('PE', 'GF', BUILDINGS), { code: 'PE', campus: 'GF', building: 'PE', buildingName: 'PE', floor: '其他', known: false })
  const tb = parseRoom('TB307', 'BM', BUILDINGS)
  assert.deepEqual([tb.building, tb.buildingName, tb.floor, tb.known], ['TB', 'TB', '3', false])
  assert.equal(parseRoom('ED219', 'GF', null).known, false, '大樓表抓不到時也要能用')
})

test('floorLabel 與 floorsOf 的順序', () => {
  assert.deepEqual(['2', '0', 'B', '其他'].map(floorLabel), ['2 樓', '0 字頭', '地下室', '其他'])
  const rooms = ['ED301', 'M-b09', 'ED219', 'CS-PC2', 'YT002', 'A701', 'ED220'].map((c) => parseRoom(c, c.startsWith('Y') ? 'YM' : 'GF', BUILDINGS))
  assert.deepEqual(floorsOf(rooms), ['B', '0', '2', '3', '7', '其他'])
})

const course = (id, name, time) => ({ id, name, teacher: '王老師', time })
// EC022 的三門課照實測（週四：2、34、7 節）
const COURSES = [
  course('515500', '計算機概論與程式設計', 'M56R2-EC022[GF],Mabc-EC315[GF]'),
  course('535654', '電腦動畫與特效', 'R34-EC022[GF]'),
  course('515505', '演算法概論', 'T34R7-EC022[GF]'),
  course('600001', '午間課', 'R4N-ED219[GF]'),
  course('600002', '沒有教室的課', 'R34-'),
  course('600003', '合開', 'R34-ED219[GF],R34-ED220[GF]'),
  course('600004', '陽明的課', 'R34-YT206[YM]'),
]
const index = buildRoomIndex(COURSES, BUILDINGS)
const room = (key) => index.rooms.get(key)

test('buildRoomIndex：每間教室記下它的時段；多教室時段拆開；沒有教室的另外記', () => {
  assert.deepEqual([...index.rooms.keys()].sort(), ['GF:EC022', 'GF:EC315', 'GF:ED219', 'GF:ED220', 'YM:YT206'])
  assert.equal(room('GF:EC022').slots.length, 8)
  assert.equal(room('GF:EC022').buildingName, '工程三館')
  assert.deepEqual(room('GF:ED220').slots.map((s) => `${s.day}-${s.period}`), ['4-3', '4-4'])
  assert.deepEqual(index.noRoom.map((s) => `${s.day}-${s.period}`), ['4-3', '4-4'])
})

test('roomSessions：同一門課同一天相鄰的節次合成一段（含 4 與 N 之間的午休）', () => {
  const thursday = roomSessions(room('GF:EC022')).filter((s) => s.day === 4)
  assert.deepEqual(thursday.map((s) => [s.course.id, s.start, s.end]), [
    ['515500', 540, 590], // 2：09:00–09:50
    ['535654', 610, 720], // 34：10:10–12:00
    ['515505', 930, 980], // 7：15:30–16:20
  ])
  const lunch = roomSessions(room('GF:ED219')).find((s) => s.course.id === '600001')
  assert.deepEqual([lunch.start, lunch.end], [670, 790]) // 4N：11:10–13:10
})

test('roomStatus：上課中到幾點、沒有排課到幾點', () => {
  const ec = room('GF:EC022')
  const at = (minute) => roomStatus(ec, 4, minute)
  assert.deepEqual([at(640).state, at(640).courses.map((c) => c.id), at(640).until], ['busy', ['535654'], 720])
  assert.deepEqual([at(725).state, at(725).until], ['free', 930])
  assert.deepEqual([at(600).state, at(600).until], ['free', 610], '兩堂課之間的下課')
  assert.deepEqual([at(1000).state, at(1000).until], ['free', null], '今天之後沒有排課')
  assert.deepEqual([roomStatus(ec, 6, 640).state, roomStatus(ec, 6, 640).until], ['free', null], '週六沒有課')
})

test('roomStatus：同一間教室同時有兩門課，全部列出，到最晚的那一門結束', () => {
  const s = roomStatus(room('GF:ED219'), 4, 700)
  assert.equal(s.state, 'busy')
  assert.deepEqual(s.courses.map((c) => c.id).sort(), ['600001', '600003'])
  assert.equal(s.until, 790)
})

test('noRoomCount：這個時間在上課但沒有填教室的課程數', () => {
  assert.equal(noRoomCount(index, 4, 640), 1)
  assert.equal(noRoomCount(index, 4, 800), 0)
})

test('matchRooms：不分大小寫比對開頭，照代碼排序', () => {
  assert.deepEqual(matchRooms([...index.rooms.values()], 'ed2').map((r) => r.code), ['ED219', 'ED220'])
  assert.deepEqual(matchRooms([...index.rooms.values()], ' EC0 ').map((r) => r.code), ['EC022'])
  assert.deepEqual(matchRooms([...index.rooms.values()], ''), [])
})

test('buildingsOf 與 campusesOf', () => {
  assert.deepEqual(buildingsOf(index, 'GF'), [
    { code: 'EC', name: '工程三館', known: true, count: 2 },
    { code: 'ED', name: '工程四館', known: true, count: 2 },
  ])
  assert.deepEqual(campusesOf(index), ['GF', 'YM'])
})

test('periodAt、nowPoint、formatMinute', () => {
  assert.equal(periodAt(640), '3')
  assert.equal(periodAt(600), '', '下課時間不在任何一節')
  assert.equal(periodAt(1335), 'd')
  assert.equal(periodAt(1340), '')
  assert.deepEqual(nowPoint(new Date(2026, 8, 24, 10, 40)), { day: 4, minute: 640 }) // 2026-09-24 是週四
  assert.deepEqual(nowPoint(new Date(2026, 8, 27, 9, 5)), { day: 7, minute: 545 }) // 週日
  assert.deepEqual([formatMinute(640), formatMinute(0), formatMinute(930)], ['10:40', '00:00', '15:30'])
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/rooms.test.js`
Expected: FAIL，錯誤是 `Cannot find module '…/src/lib/rooms.js'`。

- [ ] **Step 3: 實作**

建立 `src/lib/rooms.js`：

```js
// 教室查詢的計算（純函式）。教室代碼來自課程時間字串，例如 M34-ED219[GF] 的 ED219。
// 大樓名稱來自課程時間表的官方大樓表（lib/buildings.js）。規則見 docs/superpowers/specs/2026-09-24-room-lookup-design.md。
import { PERIODS, parseCosTime } from './periods.js'
import { CAMPUSES } from './freeslots.js'

const str = (v) => (v == null ? '' : String(v))
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const PERIOD_INDEX = new Map(PERIODS.map((p, i) => [p.code, i]))
const CAMPUS_ORDER = CAMPUSES.map((c) => c.code)
const FLOOR_BASEMENT = 'B'
const FLOOR_OTHER = '其他'

// 大樓：該校區官方代碼中最長、且是教室代碼開頭的那個；對不上就用開頭的英文字母。
// 樓層：大樓代碼後面的部分。-b09、-B1 是地下室（先判斷）；數字或「一個側翼字母＋數字」取那個數字；其他歸「其他」。
export function parseRoom(code, campus, buildings) {
  const room = str(code).trim()
  const table = (buildings && buildings[campus]) || {}
  let building = ''
  for (const b of Object.keys(table)) if (room.startsWith(b) && b.length > building.length) building = b
  const known = building !== ''
  if (!known) building = (/^[A-Za-z]+/.exec(room) || [room])[0]
  const rest = room.slice(building.length)
  let floor = FLOOR_OTHER
  if (/^-?b\d/i.test(rest)) floor = FLOOR_BASEMENT
  else {
    const m = /^[A-Za-z]?(\d)/.exec(rest)
    if (m) floor = m[1]
  }
  const buildingName = known ? str(table[building] && table[building].cname) || building : building
  return { code: room, campus: str(campus), building, buildingName, floor, known }
}

export function floorLabel(floor) {
  if (floor === FLOOR_BASEMENT) return '地下室'
  if (floor === '0') return '0 字頭'
  if (/^\d$/.test(floor)) return `${floor} 樓`
  return FLOOR_OTHER
}

const floorRank = (f) => (f === FLOOR_BASEMENT ? -1 : f === FLOOR_OTHER ? 99 : Number(f))

export function floorsOf(rooms) {
  return [...new Set((rooms || []).map((r) => r.floor))].sort((a, b) => floorRank(a) - floorRank(b))
}

// 每間教室記下它的時段；同一時段列了多間教室（parseCosTime 用「、」串起來）就每間各記一筆
export function buildRoomIndex(courses, buildings) {
  const rooms = new Map()
  const noRoom = []
  for (const course of courses || []) {
    for (const s of parseCosTime(course && course.time)) {
      const codes = str(s.room).split('、').map((r) => r.trim()).filter(Boolean)
      if (!codes.length) {
        noRoom.push({ day: s.day, period: s.period, course })
        continue
      }
      for (const code of codes) {
        const key = `${s.campus}:${code}`
        if (!rooms.has(key)) rooms.set(key, { key, ...parseRoom(code, s.campus, buildings), slots: [] })
        rooms.get(key).slots.push({ day: s.day, period: s.period, course })
      }
    }
  }
  return { rooms, noRoom }
}

// 同一門課在同一天、PERIODS 裡相鄰的節次合成一段；中間的下課也算在上課中
export function roomSessions(room) {
  const groups = new Map() // course -> Map(day -> Set(節次索引))
  for (const s of (room && room.slots) || []) {
    const i = PERIOD_INDEX.get(str(s.period).toLowerCase())
    if (i === undefined) continue
    if (!groups.has(s.course)) groups.set(s.course, new Map())
    const days = groups.get(s.course)
    if (!days.has(s.day)) days.set(s.day, new Set())
    days.get(s.day).add(i)
  }
  const out = []
  for (const [course, days] of groups) {
    for (const [day, set] of days) {
      const idx = [...set].sort((a, b) => a - b)
      let first = idx[0]
      for (let k = 1; k <= idx.length; k++) {
        if (k < idx.length && idx[k] === idx[k - 1] + 1) continue
        out.push({ day, start: minutesOf(PERIODS[first].start), end: minutesOf(PERIODS[idx[k - 1]].end), course })
        first = idx[k]
      }
    }
  }
  return out.sort((a, b) => a.day - b.day || a.start - b.start)
}

export function roomStatus(room, day, minute) {
  const today = roomSessions(room).filter((s) => s.day === day)
  const now = today.filter((s) => s.start <= minute && minute < s.end)
  if (now.length) return { state: 'busy', courses: [...new Set(now.map((s) => s.course))], until: Math.max(...now.map((s) => s.end)) }
  const later = today.filter((s) => s.start > minute).map((s) => s.start)
  return { state: 'free', courses: [], until: later.length ? Math.min(...later) : null }
}

export function noRoomCount(index, day, minute) {
  const now = roomSessions({ slots: (index && index.noRoom) || [] }).filter((s) => s.day === day && s.start <= minute && minute < s.end)
  return new Set(now.map((s) => s.course)).size
}

export function matchRooms(rooms, query, limit = 20) {
  const q = str(query).trim().toUpperCase()
  if (!q) return []
  return (rooms || [])
    .filter((r) => r.code.toUpperCase().startsWith(q))
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || a.campus.localeCompare(b.campus))
    .slice(0, limit)
}

export function buildingsOf(index, campus) {
  const out = new Map()
  for (const r of index.rooms.values()) {
    if (r.campus !== campus) continue
    if (!out.has(r.building)) out.set(r.building, { code: r.building, name: r.buildingName, known: r.known, count: 0 })
    out.get(r.building).count++
  }
  return [...out.values()].sort((a, b) => Number(b.known) - Number(a.known) || a.code.localeCompare(b.code, 'en'))
}

export function campusesOf(index) {
  const present = new Set([...index.rooms.values()].map((r) => r.campus).filter(Boolean))
  const rank = (c) => (CAMPUS_ORDER.includes(c) ? CAMPUS_ORDER.indexOf(c) : CAMPUS_ORDER.length)
  return [...present].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export function periodAt(minute) {
  const p = PERIODS.find((x) => minutesOf(x.start) <= minute && minute < minutesOf(x.end))
  return p ? p.code : ''
}

export function nowPoint(date) {
  return { day: ((date.getDay() + 6) % 7) + 1, minute: date.getHours() * 60 + date.getMinutes() }
}

export function formatMinute(minute) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/rooms.test.js`
Expected: PASS（12 個測試）。再跑 `npm test`，全部通過（原本 260 個＋新的）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/rooms.js test/rooms.test.js
git commit -m "教室查詢：教室索引與狀態計算（lib/rooms.js）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 官方大樓表與快取（`src/lib/buildings.js`）

**Files:**
- Create: `src/lib/buildings.js`
- Test: `test/buildings.test.js`

**Interfaces:**
- Consumes: 無（不依賴 Task 1）。
- Produces（Task 3 用）：
  - `BUILDINGS_URL = 'https://timetable.nycu.edu.tw/?r=main/get_classroom_code'`
  - `BUILDINGS_MAX_AGE = 30 * 24 * 60 * 60 * 1000`
  - `normalizeBuildings(json) → { campuses: [{ code, cname, ename, map }], buildings: { [campus]: { [bcode]: { cname, ename } } } } | null`
  - `loadBuildings({ fetchImpl = fetch, storage = chrome.storage.local, now = Date.now() } = {}) → Promise<normalizeBuildings 的結果 | null>`；快取存在 storage 的 `roomBuildings = { fetchedAt, data }`。

- [ ] **Step 1: 寫失敗的測試**

建立 `test/buildings.test.js`：

```js
// 課程時間表的官方大樓表（POST ?r=main/get_classroom_code，不用登入）。2026-09-24 實測格式，節錄兩個校區。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeBuildings, loadBuildings, BUILDINGS_URL, BUILDINGS_MAX_AGE } from '../src/lib/buildings.js'

const RAW = {
  'Yang-Ming': {
    cname: '台北陽明校區', ename: 'Yang-Ming Campus', campus_code: '[YM]', build_num: 2, map: 'https://www.nycu.edu.tw/about/campus-maps/',
    code: { YT: { cname: '教學大樓', ename: 'Teaching Building' }, YR: { cname: '守仁樓', ename: 'Shouren Building ' } },
  },
  'Guang-Fu': {
    cname: '新竹光復校區', ename: 'Guang-Fu Campus', campus_code: '[GF]', build_num: 2, map: 'https://www.nycu.edu.tw/about/campus-maps/',
    code: { ED: { cname: '工程四館', ename: 'Engineering Building IV' }, EC: { cname: '工程三館', ename: 'Engineering Building 3' } },
  },
}
const DATA = normalizeBuildings(RAW)

test('normalizeBuildings：校區代碼去掉括號，名稱去掉頭尾空白', () => {
  assert.deepEqual(DATA.campuses.map((c) => c.code), ['YM', 'GF'])
  assert.equal(DATA.campuses[1].cname, '新竹光復校區')
  assert.deepEqual(DATA.buildings.GF.ED, { cname: '工程四館', ename: 'Engineering Building IV' })
  assert.equal(DATA.buildings.YM.YR.ename, 'Shouren Building')
})

test('normalizeBuildings：格式不對時回傳 null', () => {
  assert.equal(normalizeBuildings(null), null)
  assert.equal(normalizeBuildings({}), null)
  assert.equal(normalizeBuildings('error'), null)
})

function fakeStorage(initial = {}) {
  const data = { ...initial }
  return { data, get: async (key) => (key in data ? { [key]: data[key] } : {}), set: async (obj) => Object.assign(data, obj) }
}
const NOW = Date.UTC(2026, 8, 24, 2, 40)
const DAY = 24 * 60 * 60 * 1000
function okFetch(calls) {
  return async (url, opts) => {
    calls.push({ url, method: opts && opts.method })
    return { ok: true, status: 200, json: async () => RAW }
  }
}
const failFetch = async () => {
  throw new Error('offline')
}

test('loadBuildings：沒有快取就去抓（POST），並寫回快取', async () => {
  const calls = []
  const storage = fakeStorage()
  const data = await loadBuildings({ fetchImpl: okFetch(calls), storage, now: NOW })
  assert.deepEqual(data, DATA)
  assert.deepEqual(calls, [{ url: BUILDINGS_URL, method: 'POST' }])
  assert.deepEqual(storage.data.roomBuildings, { fetchedAt: NOW, data: DATA })
})

test('loadBuildings：快取未滿 30 天就不抓', async () => {
  const calls = []
  const storage = fakeStorage({ roomBuildings: { fetchedAt: NOW - DAY, data: DATA } })
  assert.deepEqual(await loadBuildings({ fetchImpl: okFetch(calls), storage, now: NOW }), DATA)
  assert.equal(calls.length, 0)
})

test('loadBuildings：快取過期就重抓；抓不到時沿用舊快取', async () => {
  const old = { campuses: [{ code: 'GF', cname: '舊', ename: '', map: '' }], buildings: { GF: {} } }
  const stale = { roomBuildings: { fetchedAt: NOW - BUILDINGS_MAX_AGE - 1, data: old } }
  const calls = []
  const refreshed = fakeStorage(stale)
  assert.deepEqual(await loadBuildings({ fetchImpl: okFetch(calls), storage: refreshed, now: NOW }), DATA)
  assert.equal(calls.length, 1)
  assert.equal(refreshed.data.roomBuildings.fetchedAt, NOW)
  assert.deepEqual(await loadBuildings({ fetchImpl: failFetch, storage: fakeStorage(stale), now: NOW }), old)
})

test('loadBuildings：抓不到又沒有快取就回傳 null；HTTP 錯誤當作抓不到', async () => {
  assert.equal(await loadBuildings({ fetchImpl: failFetch, storage: fakeStorage(), now: NOW }), null)
  const http500 = async () => ({ ok: false, status: 500, json: async () => ({}) })
  assert.equal(await loadBuildings({ fetchImpl: http500, storage: fakeStorage(), now: NOW }), null)
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `node --test test/buildings.test.js`
Expected: FAIL，`Cannot find module '…/src/lib/buildings.js'`。

- [ ] **Step 3: 實作**

建立 `src/lib/buildings.js`：

```js
// 課程時間表的官方大樓代碼表（不用登入）。課程時間表自己的「星期／時間／教室代碼對照表」也是用這支 API。
// 開教室查詢頁時載入，存在 storage 的 roomBuildings，30 天內不重抓；抓不到就用舊的，都沒有就回傳 null。
export const BUILDINGS_URL = 'https://timetable.nycu.edu.tw/?r=main/get_classroom_code'
export const BUILDINGS_MAX_AGE = 30 * 24 * 60 * 60 * 1000

const str = (v) => (v == null ? '' : String(v))

export function normalizeBuildings(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const campuses = []
  const buildings = {}
  for (const c of Object.values(json)) {
    const code = str(c && c.campus_code).replace(/[[\]]/g, '').trim()
    if (!code) continue
    campuses.push({ code, cname: str(c.cname).trim(), ename: str(c.ename).trim(), map: str(c.map).trim() })
    buildings[code] = {}
    for (const [b, v] of Object.entries((c && c.code) || {})) {
      buildings[code][b] = { cname: str(v && v.cname).trim(), ename: str(v && v.ename).trim() }
    }
  }
  return campuses.length ? { campuses, buildings } : null
}

export async function loadBuildings({ fetchImpl = fetch, storage = chrome.storage.local, now = Date.now() } = {}) {
  let cached = null
  try {
    cached = (await storage.get('roomBuildings')).roomBuildings || null
  } catch {}
  if (cached && cached.data && now - cached.fetchedAt < BUILDINGS_MAX_AGE) return cached.data
  try {
    const res = await fetchImpl(BUILDINGS_URL, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = normalizeBuildings(await res.json())
    if (!data) throw new Error('大樓表格式不對')
    try {
      await storage.set({ roomBuildings: { fetchedAt: now, data } })
    } catch {}
    return data
  } catch {
    return cached && cached.data ? cached.data : null
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `node --test test/buildings.test.js`
Expected: PASS（6 個測試）。再跑 `npm test`，全部通過。

- [ ] **Step 5: Commit**

```bash
git add src/lib/buildings.js test/buildings.test.js
git commit -m "教室查詢：官方大樓代碼表與 30 天快取（lib/buildings.js）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 教室查詢頁、popup 入口、E2E、README、版本 0.12.0

**Files:**
- Create: `src/rooms.html`、`src/rooms.css`、`src/rooms.js`
- Create: `e2e/package.json`、`e2e/README.md`、`e2e/rooms.mjs`
- Modify: `src/popup.html`（`.shell-actions` 裡加按鈕）、`src/popup.js`（加一行 listener）
- Modify: `README.md`（「### 當期選課」那一節之後加「### 教室查詢」）、`manifest.json` 與 `package.json`（`0.11.0` → `0.12.0`）

**Interfaces:**
- Consumes: Task 1 的 `buildRoomIndex`、`roomStatus`、`noRoomCount`、`floorsOf`、`floorLabel`、`matchRooms`、`buildingsOf`、`campusesOf`、`periodAt`、`nowPoint`、`formatMinute`；Task 2 的 `loadBuildings`。既有：`campusName(code)` from `src/lib/freeslots.js`（`'GF'` → `'光復'`）、`DAY_NAMES` from `src/lib/periods.js`（`['', '一', …, '日']`）、`courseOutlineUrl(semester, id)` from `src/lib/links.js`（semester 如 `'1151'`，不合法回 `null`）、`createTimetable(container, { note, onOpen })` from `src/planner/timetable.js`（回傳 `{ render(items), preview(keys) }`；item 需要 `key`、`source`、`title`、`slots: [{ day, period, room }]`，`source: 'manual'` 時用 `item.color`）。
- Produces: 頁面 `src/rooms.html`，支援網址參數 `?room=ED219`；storage key `rooms = { campus, buildings, floors, show, mode, day, time }`。

- [ ] **Step 1: 建立 E2E 環境與失敗的 E2E**

建立 `e2e/package.json`：

```json
{
  "name": "nycucourse-extension-e2e",
  "private": true,
  "type": "module",
  "dependencies": {
    "playwright-core": "^1.63.0"
  }
}
```

建立 `e2e/README.md`：

```markdown
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
```

在 repo 根目錄的 `.gitignore` 加一行 `e2e/shots/`（`node_modules/` 已經涵蓋 `e2e/node_modules`）。

建立 `e2e/rooms.mjs`：

```js
// 教室查詢頁 E2E：假課程資料＋攔截官方大樓 API，時鐘固定在 2026-09-24（週四）10:40。
// 用法：node rooms.mjs <擴充功能資料夾>
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const EXT = resolve(process.argv[2] || '..')
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'e2e-')), {
  headless: true,
  channel: 'chromium',
  timezoneId: 'Asia/Taipei',
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})

const RAW_BUILDINGS = {
  'Guang-Fu': {
    cname: '新竹光復校區', ename: 'Guang-Fu Campus', campus_code: '[GF]', build_num: 2, map: '',
    code: { EC: { cname: '工程三館', ename: 'Engineering Building 3' }, ED: { cname: '工程四館', ename: 'Engineering Building IV' } },
  },
  'Yang-Ming': { cname: '台北陽明校區', ename: 'Yang-Ming Campus', campus_code: '[YM]', build_num: 1, map: '', code: { YT: { cname: '教學大樓', ename: 'Teaching Building' } } },
}
let buildingsUp = false // 第一次開頁時大樓 API 壞掉，驗證頁面照常能用
let buildingHits = 0
await ctx.route('https://timetable.nycu.edu.tw/**', (route) => {
  buildingHits++
  if (!buildingsUp) return route.fulfill({ status: 500, body: 'down' })
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RAW_BUILDINGS) })
})
await ctx.route('https://cos.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host
const course = (id, name, time) => ({ id, name, ename: '', teacher: '王老師', time, credit: '3', type: '選修', dep: '資工系', deps: ['資工系'], limit: '50', brief: '', menus: [] })
await sw.evaluate((courseData) => chrome.storage.local.set({ courseData }), {
  semester: '1151',
  updatedAt: Date.now(),
  courses: [
    course('515500', '計算機概論與程式設計', 'M56R2-EC022[GF]'),
    course('535654', '電腦動畫與特效', 'R34-EC022[GF]'),
    course('515505', '演算法概論', 'T34R7-EC022[GF]'),
    course('700001', '週三的課', 'W34-ED219[GF]'),
    course('700002', '傍晚的課', 'R78-ED220[GF]'),
    course('700003', '第三節', 'R3-ED301[GF]'),
    course('700004', '沒有教室', 'R34-'),
    course('700005', '陽明的課', 'R34-YT206[YM]'),
  ],
})

const errors = []
const checks = {}
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
await page.clock.setFixedTime(new Date('2026-09-24T10:40:00+08:00'))
const rowsText = () => page.$$eval('.room-row', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()))
const rowOf = async (code) => (await rowsText()).find((t) => t.startsWith(code)) || ''
const codes = () => page.$$eval('.room-row .code', (cs) => cs.map((c) => c.textContent).join(','))

// ---- 大樓 API 壞掉：頁面照常能用，大樓只顯示代碼 ----
await page.goto(`chrome-extension://${extId}/src/rooms.html`)
await page.waitForSelector('#buildings button')
checks['大樓 API 壞掉時按鈕只顯示代碼'] = (await page.$$eval('#buildings button', (bs) => bs.map((b) => b.dataset.code + '|' + b.textContent))).some((t) => t.startsWith('ED|ED'))
checks['沒選大樓時提示先選'] = (await page.textContent('#room-list')).includes('先選一棟或幾棟大樓')
checks['固定說明文字'] = (await page.textContent('.notice')).includes('只根據課程資料：考試、演講、教室借用不在內，「沒有排課」不代表一定沒人。')
checks['全頁沒有「空教室」'] = !(await page.textContent('body')).includes('空教室')

// ---- 大樓 API 恢復後重新整理：顯示官方名稱 ----
buildingsUp = true
await page.reload()
await page.waitForSelector('#buildings button')
checks['大樓顯示官方名稱'] = (await page.textContent('#buildings')).includes('工程四館')
await page.click('#buildings button[data-code="EC"]')
await page.click('#buildings button[data-code="ED"]')
const groups = await page.$$eval('#room-list h2, #room-list h3', (hs) => hs.map((h) => h.textContent.trim()))
checks['依大樓、樓層分組'] = JSON.stringify(groups) === JSON.stringify(['工程三館 EC', '0 字頭', '工程四館 ED', '2 樓', '3 樓'])
checks['EC022 週四 10:40 上課中到 12:00'] = /上課中.*電腦動畫與特效.*到 12:00/.test(await rowOf('EC022'))
checks['ED219 今天之後沒有排課'] = /沒有排課.*今天之後沒有排課/.test(await rowOf('ED219'))
checks['ED220 到 15:30 前沒有排課'] = (await rowOf('ED220')).includes('到 15:30 前沒有排課')
checks['ED301 上課中到 11:00'] = /上課中.*到 11:00/.test(await rowOf('ED301'))
checks['顯示沒有填教室的課程數'] = (await page.textContent('#no-room')).includes('另有 1 門課沒有填教室')
await page.screenshot({ path: SHOTS + 'rooms-1-now.png' })

// ---- 樓層與顯示篩選 ----
await page.click('#floors button[data-floor="2"]')
checks['只看 2 樓'] = (await codes()) === 'ED219,ED220'
await page.click('#floors button[data-floor="2"]')
await page.check('input[name="show"][value="free"]')
checks['只看沒排課'] = (await rowsText()).every((t) => t.includes('沒有排課')) && (await rowsText()).length === 2
await page.check('input[name="show"][value="busy"]')
checks['只看上課中'] = (await rowsText()).every((t) => t.includes('上課中')) && (await rowsText()).length === 2
await page.check('input[name="show"][value="all"]')

// ---- 指定時間：週四 14:30 ----
await page.check('input[name="mode"][value="custom"]')
await page.selectOption('#day', '4')
await page.fill('#time', '14:30')
await page.dispatchEvent('#time', 'change')
checks['指定週四 14:30：EC022 到 15:30 前沒有排課'] = (await rowOf('EC022')).includes('到 15:30 前沒有排課')
checks['指定週四 14:30：ED301 今天之後沒有排課'] = (await rowOf('ED301')).includes('今天之後沒有排課')

// ---- 找教室 ----
await page.fill('#room-q', 'ed2')
await page.press('#room-q', 'Enter') // Enter 不能有作用
checks['找教室按 Enter 不會選'] = !(await page.textContent('#room-head')).includes('ED2')
const matches = await page.$$eval('#room-matches button', (bs) => bs.map((b) => b.textContent))
checks['找教室 ed2 列出 ED219、ED220'] = matches.length === 2 && matches[0].startsWith('ED219') && matches[1].startsWith('ED220')
await page.click('#room-matches button >> nth=1')
checks['右欄顯示 ED220'] = (await page.textContent('#room-head h2')).startsWith('ED220')
checks['週課表有這間的課'] = (await page.$$eval('#room-week .tt-course', (bs) => bs.map((b) => b.title))).some((t) => t.includes('傍晚的課'))
checks['選定時間（週四第 6 節）的格子標亮'] = await page.$eval('#room-week .tt-cell[data-key="4-6"]', (c) => c.classList.contains('preview'))
checks['選中的那一列有標示'] = (await page.getAttribute('.room-row[aria-current="true"]', 'data-key')) === 'GF:ED220'
await page.screenshot({ path: SHOTS + 'rooms-2-room.png' })

// ---- 網址帶教室 ----
// 時間模式會存進 storage，先切回「現在」（週四 10:40，EC022 上課中），新開的頁面才看得到上課中的課與大綱連結
await page.check('input[name="mode"][value="now"]')
const direct = await ctx.newPage()
direct.on('pageerror', (e) => errors.push(String(e)))
await direct.clock.setFixedTime(new Date('2026-09-24T10:40:00+08:00'))
await direct.goto(`chrome-extension://${extId}/src/rooms.html?room=ec022`)
await direct.waitForSelector('#room-head h2')
checks['rooms.html?room=ec022 直接開 EC022'] = (await direct.textContent('#room-head h2')).startsWith('EC022')
checks['右欄狀態列有課程大綱連結'] = (await direct.getAttribute('#room-head a', 'href') || '').includes('crsoutline')

// ---- 寬視窗整頁不捲動 ----
checks['寬視窗整頁不捲動'] = await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1)

// ---- popup 入口 ----
const popup = await ctx.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup.html`)
checks['popup 有「教室 ↗」'] = (await popup.textContent('#btn-rooms')) === '教室 ↗'

checks['大樓 API 有被呼叫'] = buildingHits >= 2
checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
```

- [ ] **Step 2: 跑 E2E 確認失敗**

Run: `cd e2e && npm install && npx playwright-core install chromium && node rooms.mjs .. ; cd ..`
Expected: FAIL（`rooms.html` 還不存在，`page.waitForSelector('#buildings button')` 逾時）。

- [ ] **Step 3: 建立頁面 HTML**

建立 `src/rooms.html`：

```html
<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <title>教室查詢</title>
  <link rel="stylesheet" href="planner.css">
  <link rel="stylesheet" href="rooms.css">
</head>
<body>
  <header class="page-head rooms-head">
    <h1>教室查詢</h1>
    <div class="controls">
      <label class="field">校區 <select id="campus" aria-label="校區"></select></label>
      <div class="field" role="group" aria-label="時間">
        <span class="row-label">時間</span>
        <label><input type="radio" name="mode" value="now"> 現在 <span id="now-text" class="muted"></span></label>
        <label><input type="radio" name="mode" value="custom"> 指定</label>
        <select id="day" aria-label="星期"></select>
        <input id="time" type="time" aria-label="時間" step="60">
      </div>
      <div class="room-search">
        <input id="room-q" type="search" placeholder="找教室：例如 ED219" aria-label="找教室" autocomplete="off">
        <ul id="room-matches" class="room-matches" hidden></ul>
      </div>
    </div>
    <div class="chip-row"><span class="row-label">大樓</span><div id="buildings" class="toggles"></div></div>
    <div class="chip-row">
      <span class="row-label">樓層</span><div id="floors" class="toggles"></div>
      <span class="row-label">顯示</span>
      <label><input type="radio" name="show" value="all"> 全部</label>
      <label><input type="radio" name="show" value="free"> 只看沒排課</label>
      <label><input type="radio" name="show" value="busy"> 只看上課中</label>
    </div>
    <p class="notice">只根據課程資料：考試、演講、教室借用不在內，「沒有排課」不代表一定沒人。<span id="no-room"></span></p>
  </header>
  <main class="layout rooms-layout">
    <section class="results-pane" aria-label="教室列表"><div id="room-list"></div></section>
    <section class="plan-pane" aria-label="教室週課表">
      <div id="room-head" class="room-head"><p class="muted">點左邊的教室，或在上方「找教室」輸入代碼，看它的一週課表。</p></div>
      <p id="room-note" class="muted hidden-note" hidden></p>
      <div id="room-week" class="timetable"></div>
    </section>
  </main>
  <script type="module" src="rooms.js"></script>
</body>
</html>
```

- [ ] **Step 4: 建立頁面 CSS**

建立 `src/rooms.css`（基本樣式、`.layout` 兩欄捲動、`.timetable` 週課表樣式都沿用 `planner.css`）：

```css
/* 教室查詢頁。共用樣式在 planner.css（頁首、兩欄各自捲動、週課表 .tt-*）。 */
.rooms-head { flex-direction: column; align-items: stretch; flex-wrap: nowrap; gap: 6px; }
.rooms-head .controls { display: flex; flex-wrap: wrap; gap: 8px 20px; align-items: center; font-size: 13px; }
.rooms-head .field { display: inline-flex; gap: 6px; align-items: center; }
.row-label { color: var(--muted); font-size: 12px; }
.chip-row { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 13px; }
.toggles { display: flex; flex-wrap: wrap; gap: 4px; }
.toggles button { font-size: 12px; padding: 2px 10px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: inherit; }
.toggles button[aria-pressed="true"] { background: var(--sel); border-color: var(--accent); font-weight: 600; }
.toggles button small { color: var(--muted); margin-left: 4px; }
.notice { margin: 0; font-size: 12px; color: var(--muted); }
.notice #no-room { margin-left: 6px; }

/* 兩欄：左右固定比例，不做拖曳分隔線（planner.css 的 .layout 預設有分隔線那一欄） */
.rooms-layout { grid-template-columns: minmax(0, 1fr) minmax(480px, 1fr); gap: 16px; }

/* 找教室 */
.room-search { position: relative; }
#room-q { width: 200px; padding: 4px 8px; font: inherit; }
.room-matches { position: absolute; z-index: 5; list-style: none; margin: 2px 0 0; padding: 4px; min-width: 260px; max-height: 260px; overflow-y: auto; background: Canvas; border: 1px solid var(--line); border-radius: 6px; box-shadow: 0 6px 18px rgba(0, 0, 0, .15); }
.room-matches[hidden] { display: none; }
.room-matches button { display: block; width: 100%; text-align: left; border: none; background: none; padding: 3px 6px; color: inherit; }
.room-matches button:hover, .room-matches button:focus-visible { background: var(--sel); }

/* 教室列表 */
#room-list h2 { font-size: 15px; margin: 12px 0 4px; }
#room-list h3 { font-size: 12px; color: var(--muted); margin: 8px 0 4px; font-weight: 600; }
.room-row { display: flex; gap: 10px; align-items: baseline; width: 100%; margin: 0 0 4px; padding: 6px 10px; text-align: left; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; }
.room-row:hover { border-color: var(--accent); }
.room-row[aria-current="true"] { border-color: var(--accent); background: var(--sel); }
.room-row .code { min-width: 72px; font-weight: 600; font-variant-numeric: tabular-nums; }
.room-row .badge { --c: var(--muted); flex: none; font-size: 11px; line-height: 18px; padding: 0 7px; border-radius: 999px; border: 1px solid var(--c); background: color-mix(in srgb, var(--c) 18%, Canvas); }
.room-row.busy .badge { --c: #D55E00; }
.room-row.free .badge { --c: #009E73; }
.room-row .what { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-size: 13px; }
.room-head h2 { margin: 4px 0 2px; font-size: 16px; }
.room-head p { margin: 0 0 8px; font-size: 13px; }
```

- [ ] **Step 5: 建立頁面程式**

建立 `src/rooms.js`：

```js
// 教室查詢頁：選校區、大樓、樓層與時間，看每間教室「上課中」或「沒有排課（到幾點）」；點一間看它的一週課表。
// 計算都在 lib/rooms.js；大樓名稱來自 lib/buildings.js（官方表，快取 30 天，抓不到就只顯示代碼）。
import { buildRoomIndex, roomStatus, noRoomCount, floorsOf, floorLabel, matchRooms, buildingsOf, campusesOf, periodAt, nowPoint, formatMinute } from './lib/rooms.js'
import { loadBuildings } from './lib/buildings.js'
import { campusName } from './lib/freeslots.js'
import { DAY_NAMES } from './lib/periods.js'
import { courseOutlineUrl } from './lib/links.js'
import { createTimetable } from './planner/timetable.js'

const $ = (sel) => document.querySelector(sel)
const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) })
const WEEK_COLOR = '#0072B2'
const DEFAULTS = { campus: 'GF', buildings: [], floors: [], show: 'all', mode: 'now', day: 1, time: '10:00' }

const state = { ...DEFAULTS, selected: '' }
let index = { rooms: new Map(), noRoom: [] }
let semester = ''
let hasCourses = false
let timetable = null

const allRooms = () => [...index.rooms.values()]

// ---------- 儲存 ----------

async function save() {
  const { campus, buildings, floors, show, mode, day, time } = state
  try {
    await chrome.storage.local.set({ rooms: { campus, buildings, floors, show, mode, day, time } })
  } catch {}
}

function restore(saved) {
  if (!saved || typeof saved !== 'object') return
  for (const k of Object.keys(DEFAULTS)) {
    if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k] && Array.isArray(saved[k]) === Array.isArray(DEFAULTS[k])) state[k] = saved[k]
  }
}

// ---------- 時間 ----------

function point() {
  if (state.mode === 'now') return nowPoint(new Date())
  const [h, m] = state.time.split(':').map(Number)
  return { day: state.day, minute: Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0 }
}

function describeStatus(status) {
  if (status.state === 'busy') {
    const what = status.courses.map((c) => [c.name, c.teacher].filter(Boolean).join('・')).join('／')
    return { badge: '上課中', text: `${what}・到 ${formatMinute(status.until)}` }
  }
  return { badge: '沒有排課', text: status.until == null ? '今天之後沒有排課' : `到 ${formatMinute(status.until)} 前沒有排課` }
}

// ---------- 控制項 ----------

function toggle(code, text, count, pressed, onClick, dataName) {
  const b = el('button')
  b.type = 'button'
  b.dataset[dataName] = code
  b.setAttribute('aria-pressed', String(pressed))
  b.append(text)
  if (count !== undefined) b.append(el('small', '', String(count)))
  b.addEventListener('click', onClick)
  return b
}

function renderControls(p) {
  const campuses = campusesOf(index)
  const campusSelect = $('#campus')
  campusSelect.replaceChildren(...campuses.map((c) => Object.assign(document.createElement('option'), { value: c, textContent: campusName(c) })))
  campusSelect.value = state.campus

  $('#buildings').replaceChildren(
    ...buildingsOf(index, state.campus).map((b) =>
      toggle(b.code, b.known ? `${b.name} ${b.code}` : b.code, b.count, state.buildings.includes(b.code), () => {
        state.buildings = state.buildings.includes(b.code) ? state.buildings.filter((x) => x !== b.code) : [...state.buildings, b.code]
        state.floors = []
        save()
        render()
      }, 'code'),
    ),
  )

  const floors = floorsOf(allRooms().filter((r) => r.campus === state.campus && state.buildings.includes(r.building)))
  $('#floors').replaceChildren(
    ...floors.map((f) =>
      toggle(f, floorLabel(f), undefined, state.floors.includes(f), () => {
        state.floors = state.floors.includes(f) ? state.floors.filter((x) => x !== f) : [...state.floors, f]
        save()
        render()
      }, 'floor'),
    ),
  )

  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === state.mode
  for (const r of document.querySelectorAll('input[name="show"]')) r.checked = r.value === state.show
  $('#day').value = String(state.day)
  $('#time').value = state.time
  $('#day').disabled = state.mode === 'now'
  $('#time').disabled = state.mode === 'now'
  const now = nowPoint(new Date())
  $('#now-text').textContent = `週${DAY_NAMES[now.day]} ${formatMinute(now.minute)}`
  const n = noRoomCount(index, p.day, p.minute)
  $('#no-room').textContent = n ? `這個時段全校另有 ${n} 門課沒有填教室。` : ''
}

// ---------- 列表 ----------

function renderList(p) {
  const list = $('#room-list')
  if (!hasCourses) {
    list.replaceChildren(el('p', 'muted', '還沒有課程資料，請先到「當期選課」按「更新課程資料」。'))
    return
  }
  if (!state.buildings.length) {
    list.replaceChildren(el('p', 'muted', '先選一棟或幾棟大樓。'))
    return
  }
  const buildingOrder = buildingsOf(index, state.campus).map((b) => b.code)
  const pool = allRooms().filter((r) => r.campus === state.campus && state.buildings.includes(r.building))
  const floorOrder = floorsOf(pool)
  const rows = pool
    .filter((r) => !state.floors.length || state.floors.includes(r.floor))
    .map((room) => ({ room, status: roomStatus(room, p.day, p.minute) }))
    .filter(({ status }) => state.show === 'all' || status.state === state.show)
    .sort((a, b) =>
      buildingOrder.indexOf(a.room.building) - buildingOrder.indexOf(b.room.building) ||
      floorOrder.indexOf(a.room.floor) - floorOrder.indexOf(b.room.floor) ||
      a.room.code.localeCompare(b.room.code, 'en', { numeric: true }))
  if (!rows.length) {
    list.replaceChildren(el('p', 'muted', '沒有符合的教室。'))
    return
  }
  const out = []
  let building = null
  let floor = null
  for (const { room, status } of rows) {
    if (room.building !== building) {
      building = room.building
      floor = null
      out.push(el('h2', '', room.known ? `${room.buildingName} ${room.building}` : room.building))
    }
    if (room.floor !== floor) {
      floor = room.floor
      out.push(el('h3', '', floorLabel(room.floor)))
    }
    const d = describeStatus(status)
    const row = el('button', `room-row ${status.state}`)
    row.type = 'button'
    row.dataset.key = room.key
    row.setAttribute('aria-current', String(room.key === state.selected))
    row.append(el('span', 'code', room.code), el('span', 'badge', d.badge), el('span', 'what', d.text))
    row.addEventListener('click', () => {
      state.selected = room.key
      render()
    })
    out.push(row)
  }
  list.replaceChildren(...out)
}

// ---------- 單一教室週課表 ----------

function weekItems(room) {
  const byCourse = new Map()
  for (const s of room.slots) {
    if (!byCourse.has(s.course)) byCourse.set(s.course, [])
    byCourse.get(s.course).push({ day: s.day, period: s.period, room: room.code })
  }
  return [...byCourse].map(([course, slots]) => ({
    key: `room:${course.id}`, source: 'manual', cosId: course.id, title: course.name, teacher: course.teacher, color: WEEK_COLOR, slots,
  }))
}

function courseLink(course) {
  const url = courseOutlineUrl(semester, course.id)
  if (!url) return document.createTextNode(course.name)
  return Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noreferrer', textContent: course.name })
}

function renderRoom(p) {
  const room = index.rooms.get(state.selected)
  const head = $('#room-head')
  if (!room) {
    $('#room-week').replaceChildren()
    return
  }
  const status = roomStatus(room, p.day, p.minute)
  const line = el('p')
  if (status.state === 'busy') {
    line.append('上課中：')
    status.courses.forEach((c, i) => {
      if (i) line.append('／')
      line.append(courseLink(c), c.teacher ? `・${c.teacher}` : '')
    })
    line.append(`・到 ${formatMinute(status.until)}`)
  } else line.append(describeStatus(status).text)
  const title = [room.code, room.known ? room.buildingName : '', floorLabel(room.floor)].filter(Boolean).join('・')
  head.replaceChildren(el('h2', '', title), line)
  timetable.render(weekItems(room))
  const period = periodAt(p.minute)
  timetable.preview(period ? [`${p.day}-${period}`] : [])
}

// ---------- 找教室 ----------

function openRoom(room) {
  if (room.campus !== state.campus) {
    state.campus = room.campus
    state.buildings = []
    state.floors = []
  }
  if (!state.buildings.includes(room.building)) state.buildings = [...state.buildings, room.building]
  state.selected = room.key
  $('#room-q').value = ''
  $('#room-matches').hidden = true
  save()
  render()
}

// 只用點的選；不處理 Enter（注音選字確定的 Enter 會誤觸）
function renderMatches() {
  const matches = matchRooms(allRooms(), $('#room-q').value)
  $('#room-matches').replaceChildren(
    ...matches.map((r) => {
      const li = el('li')
      const b = el('button', '', `${r.code}　${r.known ? r.buildingName : r.building}・${campusName(r.campus)}`)
      b.type = 'button'
      b.addEventListener('click', () => openRoom(r))
      li.append(b)
      return li
    }),
  )
  $('#room-matches').hidden = !matches.length
}

// ---------- 初始化 ----------

function render() {
  const p = point()
  renderControls(p)
  renderList(p)
  renderRoom(p)
}

function rebuild(courseData, buildings) {
  const courses = (courseData && courseData.courses) || []
  hasCourses = courses.length > 0
  semester = (courseData && courseData.semester) || ''
  index = buildRoomIndex(courses, buildings ? buildings.buildings : null)
  const campuses = campusesOf(index)
  if (campuses.length && !campuses.includes(state.campus)) state.campus = campuses[0]
}

async function init() {
  const stored = await chrome.storage.local.get(['rooms', 'courseData'])
  restore(stored.rooms)
  const buildings = await loadBuildings()
  rebuild(stored.courseData, buildings)
  timetable = createTimetable($('#room-week'), {
    note: $('#room-note'),
    onOpen: (item) => {
      const url = courseOutlineUrl(semester, item.cosId)
      if (url) window.open(url, '_blank', 'noreferrer')
    },
  })

  $('#day').replaceChildren(...[1, 2, 3, 4, 5, 6, 7].map((d) => Object.assign(document.createElement('option'), { value: String(d), textContent: `週${DAY_NAMES[d]}` })))
  $('#campus').addEventListener('change', () => {
    state.campus = $('#campus').value
    state.buildings = []
    state.floors = []
    state.selected = ''
    save()
    render()
  })
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.addEventListener('change', () => {
      state.mode = r.value
      if (state.mode === 'custom') {
        const now = nowPoint(new Date())
        state.day = now.day
        state.time = formatMinute(now.minute)
      }
      save()
      render()
    })
  }
  for (const r of document.querySelectorAll('input[name="show"]')) {
    r.addEventListener('change', () => {
      state.show = r.value
      save()
      render()
    })
  }
  $('#day').addEventListener('change', () => {
    state.day = Number($('#day').value)
    save()
    render()
  })
  $('#time').addEventListener('change', () => {
    if (!$('#time').value) return
    state.time = $('#time').value
    save()
    render()
  })
  $('#room-q').addEventListener('input', renderMatches)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.courseData) return
    rebuild(changes.courseData.newValue, buildings)
    render()
  })
  // 「現在」模式每分鐘重算
  setInterval(() => {
    if (state.mode === 'now') render()
  }, 60_000)

  const wanted = new URLSearchParams(location.search).get('room')
  const target = wanted ? allRooms().find((r) => r.code.toUpperCase() === wanted.trim().toUpperCase()) : null
  if (target) openRoom(target)
  else render()
}

init()
```

- [ ] **Step 6: popup 入口**

在 `src/popup.html` 的 `.shell-actions` 裡，`btn-planner` 那一行後面加：

```html
      <button id="btn-rooms" type="button" title="開啟教室查詢">教室 ↗</button>
```

在 `src/popup.js` 的 `btn-planner` listener 下一行加：

```js
document.getElementById('btn-rooms').addEventListener('click', () => openPage('src/rooms.html'))
```

- [ ] **Step 7: 跑 E2E 與單元測試確認通過**

Run: `npm test && (cd e2e && node rooms.mjs ..)`
Expected: 單元測試全過；E2E 最後印 `PASS`。失敗時看印出的 `checks` 哪一項是 `false`，以及 `e2e/shots/` 的截圖。

- [ ] **Step 8: README 與版本**

在 `README.md` 的「### 當期選課」那一節結束後（「## 看到這些訊息時」之前）加：

```markdown
### 教室查詢

點擴充功能圖示上方的「教室 ↗」。

1. 選校區，再點一棟或幾棟大樓（按鈕上的數字是有排課的教室數），需要的話再選樓層。
2. 時間預設是「現在」，每分鐘自動更新；也可以改成「指定」某天某個時間，例如先查明天下午。
3. 每間教室會顯示「上課中」（課名、老師、上到幾點）或「沒有排課」（到幾點前沒有排課）。可以只看沒排課或只看上課中。
4. 點一間教室，右邊會顯示它的一週課表；上課中的課名可以開課程大綱，方便找課旁聽。
5. 知道教室代碼時，在上方「找教室」輸入，例如 `ED219` 或只打 `ed2`，再點選。

這裡只根據課程資料：考試、演講、教室借用都不在內，大約兩成的上課時數也沒有填教室，所以「沒有排課」不代表一定沒人。頁面上會顯示這個時段全校另有幾門課沒有填教室。大樓名稱來自學校課程時間表的教室代碼對照表。
```

把 `manifest.json` 與 `package.json` 的 `"version": "0.11.0"` 改成 `"version": "0.12.0"`（`test/version.test.js` 會檢查兩邊一致）。

- [ ] **Step 9: 全部再跑一次**

Run: `npm test && (cd e2e && node rooms.mjs ..)`
Expected: 全過、`PASS`。

- [ ] **Step 10: Commit**

```bash
git add src/rooms.html src/rooms.css src/rooms.js src/popup.html src/popup.js e2e/package.json e2e/README.md e2e/rooms.mjs .gitignore README.md manifest.json package.json
git commit -m "0.12.0：教室查詢頁

- 選校區、大樓、樓層與時間（預設現在、每分鐘更新，或指定星期與時間），列出每間教室上課中或沒有排課到幾點
- 點教室看一週課表，上課中的課連到課程大綱；可用教室代碼搜尋、網址 ?room=ED219 直接開
- 固定說明只根據課程資料，並顯示這個時段全校另有幾門課沒有填教室
- popup 頁首加「教室 ↗」
- E2E 放進 repo 的 e2e/（含 README）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
