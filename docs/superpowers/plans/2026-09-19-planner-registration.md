# 選課規劃頁：查詢與正式選課、本機課程狀態 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From 選課規劃 result cards, users can query eligibility per attribution and add/register (with wish order). Each course's local status (已選上、登記中、在預排) replaces the exclude filters and colours the grid.

**Architecture:**
- Local status is derived from the existing `schedule.sources` through a new pure module `src/lib/status.js`, which provides `courseStatuses` and `occupiedKinds`.
- The confirm dialog moves out of `src/register.js` into `src/reg-dialog.js` (plus `src/reg-dialog.css`) and is shared by both pages.
- The planner gains a query and register flow in `src/planner/results.js` and `src/planner.js`. After each write it re-reads 預排 and 正式選課 (lazy refresh), and it has a manual 「從選課網更新狀態」 button.

**Tech Stack:** Chrome MV3, plain ES modules, `node --test`, Playwright-core E2E in the scratchpad.

**Spec:** `docs/superpowers/specs/2026-09-19-planner-registration-design.md`

## Global Constraints

- A registration is sent only after the user clicks 「確認送出」 in the dialog. There is no drop feature, and nothing is ever sent to `deleteregist`. Courses whose status is `registered` show no add, query or register buttons.
- For a course not yet in 預排, adding or registering first sends `setpreregist` with the chosen attribution (`preregParams`). It stops if that fails.
- Status comes only from `schedule.sources.registered` and `schedule.sources.preregist` (written via `withSyncedSources`). If a refresh fails, existing data is kept.
- Grid colours:
  - registered: green `#16a34a`
  - wish: orange `#ea580c`
  - preregist: slate `#64748b`
  - manual: its own `color`, falling back to purple `#8b5cf6`
  - Priority order is registered > wish > preregist > manual.
- Remove the 學分 and 排除 filters from the UI (`findCourses` keeps supporting them).
- Dialog element ids stay `confirm`, `confirm-title`, `confirm-body`, `wish-block`, `wish-options`, `confirm-error`, `btn-cancel` and `btn-submit`. The radio group name is `wish`.
- Version `0.9.0`. Work on branch `planner-reg`. Chinese commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Merge only after the user approves the screenshots.

---

### Task 1: `lib/status.js`: course statuses and grid kinds

**Files:** Create `src/lib/status.js`, `test/status.test.js`

**Interfaces:**
- `courseStatuses(schedule) -> Map<string, { state: 'registered'|'wish'|'preregist', wishNo: number|null, label: string }>`
- `occupiedKinds(schedule) -> Map<slotKey, { kind: 'registered'|'wish'|'preregist'|'manual', color: string, titles: string[] }>`
- `KIND_COLORS = { registered: '#16a34a', wish: '#ea580c', preregist: '#64748b', manual: '#8b5cf6' }`
- `KIND_LABELS = { registered: '正式選上', wish: '登記中', preregist: '在預排', manual: '私人行程' }`

- [ ] **Step 1: Tests**

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { courseStatuses, occupiedKinds, KIND_COLORS } from '../src/lib/status.js'

const schedule = {
  sources: {
    registered: { courses: [
      { cos_id: '1', cos_cname: '微積分', cos_time: 'M12-A1[GF]', sFlag: 'F' },
      { cos_id: '2', cos_cname: '生死學', cos_time: 'R56-A2[GF]', sFlag: '2', GroupUID: 'G' },
    ] },
    preregist: { courses: [
      { cos_id: '2', cos_cname: '生死學', cos_time: 'R56-A2[GF]', menu_data: '{"type":3}', cos_type_code: 'E', category_cname: '基本素養' },
      { cos_id: '3', cos_cname: '線代', cos_time: 'T34-A3[GF]', menu_data: '{"type":1}', cos_type_code: '2' },
      { cos_id: '4', cos_cname: '舊版加入', cos_time: 'W5-A4[GF]', menu_data: '{}', cos_type_code: '1' },
    ] },
  },
  manual: [{ key: 'manual:x', source: 'manual', title: '社團', color: '#123456', slots: [{ day: 1, period: '1' }, { day: 3, period: 'a' }] }],
  overrides: {},
}

test('courseStatuses 正式選課優先，登記中、在預排附標籤', () => {
  const s = courseStatuses(schedule)
  assert.deepEqual(s.get('1'), { state: 'registered', wishNo: null, label: '已選上' })
  assert.deepEqual(s.get('2'), { state: 'wish', wishNo: 2, label: '登記中・第 2 志願' })
  assert.deepEqual(s.get('3'), { state: 'preregist', wishNo: null, label: '在預排・選修' })
  assert.deepEqual(s.get('4'), { state: 'preregist', wishNo: null, label: '在預排・未指定採計' })
  assert.equal(s.get('9'), undefined)
  assert.equal(courseStatuses(undefined).size, 0)
})

test('occupiedKinds 依優先順序分類格子並帶顏色', () => {
  const k = occupiedKinds(schedule)
  assert.equal(k.get('1-1').kind, 'registered')
  assert.deepEqual(k.get('1-1').titles, ['微積分', '社團'])
  assert.equal(k.get('4-5').kind, 'wish')
  assert.equal(k.get('4-5').color, KIND_COLORS.wish)
  assert.equal(k.get('2-3').kind, 'preregist')
  assert.equal(k.get('3-a').kind, 'manual')
  assert.equal(k.get('3-a').color, '#123456')
  const noColor = occupiedKinds({ sources: {}, manual: [{ key: 'manual:y', source: 'manual', title: 'x', slots: [{ day: 2, period: '1' }] }] })
  assert.equal(noColor.get('2-1').color, KIND_COLORS.manual)
})
```

- [ ] **Step 2:** Run `node --test test/status.test.js`. Expect FAIL (module not found).

- [ ] **Step 3: Implement `src/lib/status.js`**

```js
// 本機記錄的課程狀態：來自 storage 的 schedule.sources（正式選課、預排），
// 用來在選課規劃頁標示每門課、替格子上色。
import { scheduleItems } from './schedule.js'
import { registrationState } from './register.js'
import { describeAttribution } from './attribution.js'

export const KIND_COLORS = { registered: '#16a34a', wish: '#ea580c', preregist: '#64748b', manual: '#8b5cf6' }
export const KIND_LABELS = { registered: '正式選上', wish: '登記中', preregist: '在預排', manual: '私人行程' }
const PRIORITY = ['registered', 'wish', 'preregist', 'manual']

export function courseStatuses(schedule) {
  const out = new Map()
  const sources = (schedule && schedule.sources) || {}
  for (const c of (sources.registered && sources.registered.courses) || []) {
    const { state, wishNo } = registrationState(c)
    out.set(String(c.cos_id), state === 'wish' ? { state: 'wish', wishNo, label: `登記中・第 ${wishNo} 志願` } : { state: 'registered', wishNo: null, label: '已選上' })
  }
  for (const c of (sources.preregist && sources.preregist.courses) || []) {
    const id = String(c.cos_id)
    if (out.has(id)) continue
    const how = describeAttribution(c)
    out.set(id, { state: 'preregist', wishNo: null, label: `在預排・${how === '未指定' ? '未指定採計' : how}` })
  }
  return out
}

function kindOf(item) {
  if (item.source === 'manual') return 'manual'
  if (item.source === 'registered') return item.regState === 'wish' ? 'wish' : 'registered'
  return 'preregist'
}

export function occupiedKinds(schedule) {
  const out = new Map()
  for (const item of scheduleItems(schedule, ['registered', 'preregist'])) {
    const kind = kindOf(item)
    const color = kind === 'manual' ? item.color || KIND_COLORS.manual : KIND_COLORS[kind]
    for (const s of item.slots || []) {
      const key = `${s.day}-${s.period}`
      const cur = out.get(key)
      if (!cur) {
        out.set(key, { kind, color, titles: [item.title] })
        continue
      }
      cur.titles.push(item.title)
      if (PRIORITY.indexOf(kind) < PRIORITY.indexOf(cur.kind)) Object.assign(cur, { kind, color })
    }
  }
  return out
}
```

If `describeAttribution` (lib/attribution.js) does not exist under that name, check `grep -n "export function describeAttribution" src/lib/attribution.js`. It does exist; it returns `'未指定'` for empty `menu_data`.

- [ ] **Step 4:** Run `npm test`. Expect `fail 0`.
- [ ] **Step 5:** Commit with message `新增 status.js：本機課程狀態與格子分類`.

---

### Task 2: Shared confirm dialog `src/reg-dialog.js`

**Files:**
- Create: `src/reg-dialog.js`, `src/reg-dialog.css`
- Modify: `src/register.js` (`openConfirm`, `submit` and the dialog event wiring in `init`), `src/register.html` (remove `<dialog id="confirm">…</dialog>`; add `<link rel="stylesheet" href="reg-dialog.css">`), `src/register.css` (move the dialog rules into `reg-dialog.css`)

**Interfaces:**
- `createRegisterDialog() -> { open({ heading, detail, check, groups }) -> Promise<{ ok: boolean, message: string, wish: string } | null> }`
  - `heading` is `'課號 課名'` and `detail` is `'老師 · 時段'`.
  - `check` is `{ record, availability }`, the same shape as the 選課 page's `state.checks` values.
  - `groups` is the `getCosCategoryWish` result.
  - It resolves `null` when the user cancels.

- [ ] **Step 1: Implement `src/reg-dialog.js`**

```js
// 加選／登記的確認視窗，選課頁與選課規劃頁共用。只有使用者按「確認送出」才會送出。
import { wishOptions, registerParams, parseRegResult } from './lib/register.js'
import { askCos, cosProblem } from './cos-tab.js'

const html = `
  <h2 id="confirm-title"></h2>
  <p id="confirm-body"></p>
  <div id="wish-block" hidden>
    <p class="wish-label">這門課要用志願序登記，請選第幾志願：</p>
    <div id="wish-options" class="wish-options"></div>
  </div>
  <p id="confirm-error" class="status message error" hidden></p>
  <div class="actions">
    <span class="spacer"></span>
    <button id="btn-cancel" type="button">取消</button>
    <button id="btn-submit" type="button">確認送出</button>
  </div>`

export function createRegisterDialog() {
  const dialog = document.createElement('dialog')
  dialog.id = 'confirm'
  dialog.className = 'reg-dialog'
  dialog.innerHTML = html
  document.body.append(dialog)
  const q = (sel) => dialog.querySelector(sel)
  let pending = null // { check, resolve }

  const finish = (value) => {
    const p = pending
    pending = null
    if (dialog.open) dialog.close()
    if (p) p.resolve(value)
  }
  q('#btn-cancel').addEventListener('click', () => finish(null))
  dialog.addEventListener('cancel', () => finish(null))
  q('#btn-submit').addEventListener('click', async () => {
    if (!pending) return
    const { availability, record } = pending.check
    let wish = ''
    if (availability.needsWish) {
      const picked = dialog.querySelector('input[name="wish"]:checked')
      if (!picked) {
        q('#confirm-error').textContent = '請先選擇第幾志願。'
        q('#confirm-error').hidden = false
        return
      }
      wish = picked.value
    }
    const btn = q('#btn-submit')
    btn.disabled = true
    btn.textContent = '送出中…'
    try {
      const reply = await askCos({ type: 'register', params: registerParams(record, wish) })
      if (!reply || !reply.ok) {
        q('#confirm-error').textContent = cosProblem(reply)
        q('#confirm-error').hidden = false
        return
      }
      const result = parseRegResult(reply.text)
      finish({ ok: result.ok, message: result.ok && availability.needsWish ? `已登記第 ${wish} 志願` : result.message, wish })
    } finally {
      btn.disabled = false
      btn.textContent = '確認送出'
    }
  })

  return {
    open({ heading, detail, check, groups }) {
      const { availability, record } = check
      q('#confirm-title').textContent = availability.needsWish ? '確認登記' : '確認加選'
      const lines = [heading, detail, availability.seats, availability.reasons.length ? `注意：${availability.reasons.join('、')}` : '', '送出後會真的加選這門課。'].filter(Boolean)
      q('#confirm-body').replaceChildren(...lines.flatMap((line, i) => (i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)])))
      q('#confirm-error').hidden = true
      const block = q('#wish-block')
      block.hidden = !availability.needsWish
      const box = q('#wish-options')
      box.replaceChildren()
      const options = availability.needsWish ? wishOptions((groups || {})[availability.groupUid], record) : []
      for (const option of options) {
        const label = document.createElement('label')
        if (option.takenBy && !option.isThisCourse) label.classList.add('taken')
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'wish', value: String(option.no) })
        const text = Object.assign(document.createElement('span'), { textContent: `第 ${option.no} 志願` })
        const bits = []
        if (option.isThisCourse) bits.push('目前是這門課')
        else if (option.takenBy) bits.push(`已填 ${option.takenBy}`)
        if (option.reserved) bits.push(`登記 ${option.reserved} 人`)
        const extra = Object.assign(document.createElement('span'), { className: 'reserved', textContent: bits.join('・') })
        label.append(input, text, extra)
        box.append(label)
      }
      return new Promise((resolve) => {
        pending = { check, resolve }
        dialog.showModal()
      })
    },
  }
}
```

- [ ] **Step 2: CSS.** Move every rule in `src/register.css` that targets `dialog`, `#confirm`, `.wish-options`, `.wish-label`, `.reserved`, `.taken` or `#confirm-error` into `src/reg-dialog.css`, prefixing each with `.reg-dialog`. Find them with `grep -n "dialog\|wish\|reserved\|taken\|confirm" src/register.css`. Add `<link rel="stylesheet" href="reg-dialog.css">` to `register.html`.

- [ ] **Step 3: Use it in `src/register.js`**
  - `import { createRegisterDialog } from './reg-dialog.js'` and add `let dialog = null`. In `init()`, set `dialog = createRegisterDialog()`, then remove the old `#btn-submit`, `#btn-cancel` and `#confirm` listeners.
  - Replace `openConfirm(course, check)` and `submit()` with:

```js
async function openConfirm(course, check) {
  const result = await dialog.open({
    heading: `${course.cos_id} ${course.cos_cname}`,
    detail: [course.lecturers, describeSlots(parseCosTime(course.cos_time))].filter(Boolean).join(' · '),
    check,
    groups: state.groups,
  })
  if (!result) return
  showMessage(`${course.cos_id} ${course.cos_cname}：${result.message}`, result.ok ? '' : 'error')
  state.checks.delete(String(course.cos_id))
  state.groups = {}
  if (result.ok) await refreshRegistered()
  render()
}
```

  - Delete `state.pending` and any now-unused imports (`wishOptions`, `registerParams`, `parseRegResult`) if nothing else uses them. Check with `grep -n` first.

- [ ] **Step 4: Verify.** Run `node --check`, then `npm test`, then the E2E suites `register`, `autoreg`, `closed`, `fallback` and `attribution`. All must PASS. Both the 加選 and the 志願 flows are covered by `register.mjs`.
- [ ] **Step 5:** Commit with message `加選／登記確認視窗抽成共用元件 reg-dialog.js`.

**Checkpoint 1:** report to the user.

---

### Task 3: Planner status badges, refresh, grid colours, filter cleanup

**Files:** Modify `src/planner.html`, `src/planner.js`, `src/planner/slot-grid.js`, `src/planner/results.js`, `src/planner.css`

- [ ] **Step 1: Header status bar.** In `planner.html` under `.sub`, add:

```html
<div class="status-bar"><button id="refresh-status" type="button">從選課網更新狀態</button><span id="status-at" class="muted"></span></div>
```

- [ ] **Step 2: Refresh (`planner.js`)**

```js
async function syncStatus() {
  const reply = await askCos({ type: 'courses' })
  if (!reply || !reply.ok) return needsCos(reply) ? '請先開啟並登入選課網，狀態維持原樣。' : `${cosProblem(reply)}，狀態維持原樣。`
  const { schedule } = await chrome.storage.local.get('schedule')
  await chrome.storage.local.set({ schedule: withSyncedSources(schedule, reply, Date.now()) })
  return ''
}
function statusAtText() {
  const reg = (state.schedule.sources || {}).registered
  if (!reg || !reg.updatedAt) return '狀態還沒從選課網讀過'
  const d = new Date(reg.updatedAt)
  const pad = (n) => String(n).padStart(2, '0')
  return `狀態更新於 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
```

  - Wire `#refresh-status`: disable it, show 「更新中…」, `const msg = await syncStatus()`, then show `msg || statusAtText()`.
  - `render()` sets `#status-at` to `statusAtText()` unless a failure message is showing.
  - Import `withSyncedSources` from `./lib/schedule.js`.
  - The **lazy refresh** is `syncStatus()`, called after a successful add (inside `submitAdd`) and after a successful register (Task 4). Its message is ignored.

- [ ] **Step 3: Grid colours.** In `slot-grid.js`, change `render(selection, occupied)`: `occupied` is now `Map<key,{kind,color,titles}>` (from `occupiedKinds`). Per cell:

```js
const info = occupied.get(key)
cell.classList.toggle('busy', Boolean(info))
cell.dataset.kind = info ? info.kind : ''
cell.style.setProperty('--kind', info ? info.color : 'transparent')
cell.textContent = info ? info.titles[0] : ''
cell.title = info ? info.titles.join('、') : ''
```

  CSS: replace the `.busy` rule with a left colour bar and tint:

```css
.slot-grid .cell.busy { border-left: 4px solid var(--kind); background: color-mix(in srgb, var(--kind) 14%, transparent); }
.slot-grid .cell.selected.busy { background: color-mix(in srgb, var(--kind) 14%, var(--sel)); }
.legend { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12px; color: var(--muted); margin: 4px 0 6px; }
.legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; vertical-align: -1px; }
```

  In `planner.js`, replace `occupiedLabels()` with `occupiedKinds(state.schedule)` (from `./lib/status.js`). Render a legend `<div id="legend" class="legend">` (add it to the html above `#grid`) built from `KIND_LABELS`/`KIND_COLORS`, using the manual colour label 「私人行程（顏色可在課表頁設定）」.

- [ ] **Step 4: Remove filters.** In `buildFilters()`, delete the 學分 and 排除 fieldsets. In `readFilters()`, delete `creditMin`, `creditMax`, `excludeRegistered` and `excludePreregist`. In `renderResults()`, pass `excludeIds: []`. Remove them from `DEFAULT_FILTERS`; old saved values are harmless because they are ignored.

- [ ] **Step 5: Status badge on cards.**
  - `renderResults` computes `const statuses = courseStatuses(state.schedule)` and passes `statuses` in ctx, replacing `preregIds`.
  - In `results.js`, add a badge `<span class="badge" data-state="…">label</span>` next to the title when `ctx.statuses.get(course.id)` exists.
  - Hide 「加入預排」 when the state is `preregist`, `wish` or `registered`, or when addState says it was added.
  - CSS badge colours use `KIND_COLORS` via `data-state` selectors (`[data-state="registered"]` green, and so on).

- [ ] **Step 6: E2E quick check.**
  - In `planner.mjs`, drop the credit and exclude steps and checks.
  - Add: seed `registered` with a wish course (`sFlag:'2', GroupUID:'G'`) and assert `.cell[data-key=…][data-kind="wish"]`.
  - Card badges: the preregist course shows 「在預排」.
  - Click `#refresh-status` without a cos tab: the message contains 「維持原樣」.
  - Take `planner-status.png`.

- [ ] **Step 7:** Commit with message `選課規劃頁：本機課程狀態、主動與順便更新、格子依狀態上色、移除學分與排除篩選`.

**Checkpoint 2:** send `planner-status.png`.

---

### Task 4: Query and register from result cards

**Files:** Modify `src/planner.js`, `src/planner/results.js`, `src/planner.css`, `src/planner.html` (`<link rel="stylesheet" href="reg-dialog.css">`)

**Interfaces:**
- `addState` entries gain `{ status: 'querying' }` and `{ status: 'queried', rows: [{ label, option|null, record, availability, inPrereg }] }`. `rows` persist until the next add or register on that card.
- ctx gains `onQuery(course)` and `onRegister(course, row)`.

- [ ] **Step 1: Query (`planner.js`)**

```js
import { resolveRegInfo, describeAvailability } from './lib/register.js'
import { describeAttribution } from './lib/attribution.js'

function preregItem(id) {
  const src = (state.schedule.sources || {}).preregist
  return ((src && src.courses) || []).find((c) => String(c.cos_id) === String(id)) || null
}

async function queryCourse(course) {
  addState.set(course.id, { status: 'querying' })
  renderResults()
  try {
    const item = preregItem(course.id)
    let rows
    if (item) {
      const reply = await resolveRegInfo({
        course: item,
        timetableMenu: course.menu || null,
        askRegInfo: (menu) => askCos({ type: 'reginfo', cosId: course.id, menu }),
        getDepTree: async () => depTree || (depTree = (await askCos({ type: 'deptree' })).tree),
      })
      if (!reply || !reply.ok) throw Object.assign(new Error(cosProblem(reply)), { reply })
      rows = [{ label: describeAttribution(item), option: null, record: reply.record, availability: describeAvailability(reply.record), inPrereg: true }]
    } else {
      const options = await attributionOptionsFor(course) // extract the try-block body of addCourse into this helper
      rows = []
      for (const option of options) {
        const reply = await askCos({ type: 'reginfo', cosId: course.id, menu: { ...option.menu, category_type: option.row.category_type || '' } })
        if (!reply || !reply.ok) throw Object.assign(new Error(cosProblem(reply)), { reply })
        const record = reply.json && reply.json[course.id] ? reply.json[course.id] : null
        rows.push({ label: option.label, option, record, availability: describeAvailability(record), inPrereg: false })
      }
    }
    addState.set(course.id, { status: 'queried', rows })
  } catch (err) {
    addState.set(course.id, { status: 'error', msg: needsCos(err && err.reply) ? '請先開啟並登入選課網' : (err && err.message) || '查詢失敗' })
  }
  renderResults()
}
```

  Refactor `addCourse` to use the same `attributionOptionsFor(course)` helper, which loads `depTree` and calls `findAttributionOptions`. That keeps a single code path.

- [ ] **Step 2: Register (`planner.js`)**

```js
import { createRegisterDialog } from './reg-dialog.js'
let dialog = null // created in init(): dialog = createRegisterDialog()
let groups = null

async function registerCourse(course, row) {
  if (!row.inPrereg && row.option) {
    const added = await askCos({ type: 'import', ids: [course.id], params: { [course.id]: preregParams(course.id, row.option) } })
    const result = added && added.ok && added.results && added.results[0]
    if (!result || (result.status !== 'added' && result.status !== 'exists')) {
      addState.set(course.id, { status: 'error', msg: result ? result.msg || '加入預排失敗' : needsCos(added) ? '請先開啟並登入選課網' : cosProblem(added) })
      renderResults()
      return
    }
  }
  if (row.availability.needsWish && !groups) {
    const g = await askCos({ type: 'wishgroups' })
    groups = g && g.ok ? g.groups : {}
  }
  const outcome = await dialog.open({
    heading: `${course.id} ${course.name}`,
    detail: [course.teacher, describeKeys(courseSlots(course).keys)].filter(Boolean).join(' · '),
    check: { record: row.record, availability: row.availability },
    groups,
  })
  groups = null
  await syncStatus() // the course may have been added to 預排 even if the dialog was cancelled
  if (!outcome) {
    renderResults()
    return
  }
  addState.set(course.id, outcome.ok ? { status: 'registered', msg: outcome.message } : { status: 'error', msg: outcome.message })
  renderResults()
}
```

- [ ] **Step 3: Results UI (`results.js`).** Actions area, with the per-state rules:
  - `statuses` state is `registered`: show only the badge, no buttons.
  - `addState.status === 'querying'`: show 「查詢中…」.
  - `queried`: render `.query-rows` below the info, one row per entry:

```js
const r = document.createElement('div')
r.className = 'query-row'
const ok = row.availability.canRegister
r.append(span('how', row.label), span(ok ? 'avail ok' : 'avail error', ok ? [row.availability.needsWish ? '可登記（志願序）' : '可加選', row.availability.seats, ...row.availability.reasons].filter(Boolean).join('・') : row.availability.message || '不能選'))
if (ok) {
  const b = document.createElement('button')
  b.type = 'button'
  b.textContent = row.availability.needsWish ? '登記' : '加選'
  b.addEventListener('click', () => ctx.onRegister(hit.course, row))
  r.append(b)
}
```

  - `registered` in addState: show `span('ok', s.msg)`.
  - Otherwise, show a 「查詢」 button (`ctx.onQuery`), plus 「加入預排」 when not in 預排.

  CSS:

```css
.card .query-rows { flex-basis: 100%; display: grid; gap: 4px; margin-top: 4px; }
.card .query-row { display: flex; gap: 8px; align-items: center; font-size: 12px; }
.card .query-row .how { min-width: 120px; font-weight: 600; }
.card .query-row .avail { flex: 1; }
.card .badge { font-size: 11px; padding: 0 6px; border-radius: 999px; margin-left: 6px; color: #fff; }
.card .badge[data-state="registered"] { background: #16a34a; }
.card .badge[data-state="wish"] { background: #ea580c; }
.card .badge[data-state="preregist"] { background: #64748b; }
```

- [ ] **Step 4:** Run `node --check` on every file, then `npm test`.
- [ ] **Step 5:** Commit with message `選課規劃頁：查詢各採計方式能否加選，加選／登記（不在預排先自動加入）`.

---

### Task 5: E2E, version, README, release

- [ ] **Step 1: Extend `e2e/planner.mjs`.** The mock cos also answers:
  - `getregistrationcourselist`: 101 with the CS menu returns `{status:'success', cos_type_code:'2', wType:'X'}`. 101 with `Z10[0-4]` + `category_type=CAT` returns `{status:'success', cos_type_code:'E', wType:'E', GroupUID:'G', category_type:'CAT'}`. 100 returns `{status:'error', cmsg:'衝堂'}`.
  - `getCosCategoryWish`: `{ G: { wish_limit:'5', wish:{1:'0',2:'0',3:'0',4:'0',5:'0'} } }`.
  - `setregist`: record the params and return `[{status:'success'}]`.
  - `getregist`: returns `registered`, which becomes 101 with `sFlag:'2', GroupUID:'G'` after a registration.

  Checks:
  1. Query 100: one row showing 「衝堂」, and no 加選 button.
  2. Query 101 (not in 預排): two rows, 「選修 … 可加選」 and 「核心・… 可登記（志願序）」.
  3. Click 登記 on the core row: `setpreregist` is sent (wType E), then `#confirm` opens. Pick `input[name=wish][value="2"]` and click `#btn-submit`: `setregist` params `wish=2, cos_type_code=E`.
  4. After the lazy refresh, card 101's badge reads 「登記中・第 2 志願」 and its cells have `data-kind="wish"`.
  5. Cancel path: query 105, click 加選, then `#btn-cancel`. No additional `setregist` is sent.
  6. Registered course: no buttons.
  7. `#refresh-status` works with the cos tab open and updates `#status-at`.
  8. Screenshots `planner-reg-light.png` and `planner-reg-dark.png`.

- [ ] **Step 2:** Bump the version to `0.9.0`; update the E2E version strings with the usual `sed`.
- [ ] **Step 3: README.** In the 選課規劃 section, replace step 4 with:

```markdown
4. 滑過一門課，格子上會標出它的上課時間。每門課可以：
   - **加入預排**（有兩種採計方式時先讓你選）。
   - **查詢**：列出每種採計方式能不能選、人數、衝堂或原因；可以選的會有「加選」或「登記」按鈕，還不在預排的課會先自動加入預排，再跳出確認視窗（志願序課程要選第幾志願），按「確認送出」才會真的送出。
5. 每門課會標出目前狀態（已選上、登記中、在預排），格子也依狀態上色。狀態會在你加入、加選、登記後自動更新，也可以按上方「從選課網更新狀態」。
```

  Also remove 學分 and 排除 from the step-3 sentence.
- [ ] **Step 4:** Run the full unit test suite and every E2E suite. Everything must PASS.
- [ ] **Step 5:** Send the screenshots to the user (**Checkpoint 3**). After their OK: merge `--ff-only`, pack, tag `v0.9.0`, push, create the GitHub release with user-facing Chinese notes, and delete the branch.

---

## Self-Review

- **Spec coverage:**
  - §1 status and refresh → Tasks 1 and 3.
  - §2 query, register and auto-add → Task 4.
  - §3 shared dialog → Task 2.
  - §4 colours and filter removal → Task 3.
  - §5 tests → Tasks 1, 2, 3 and 5.
- **Placeholders:** `attributionOptionsFor` is defined in Task 4 Step 1 as an extraction of the existing `addCourse` body (load `depTree` + `findAttributionOptions`), not left undefined.
- **Type consistency:**
  - `courseStatuses` / `occupiedKinds` shapes are the same in Tasks 1 and 3.
  - `dialog.open({heading, detail, check, groups})` is the same in Tasks 2 and 4.
  - `row` fields (`label`, `option`, `record`, `availability`, `inPrereg`) are the same in Task 4 Steps 1–3.
