// 當期選課頁（目前只有「找空堂課程」）。狀態：選取的時段與篩選條件，存在 storage 的 planner。
import { scheduleItems, withSyncedSources } from './lib/schedule.js'
import { courseStatuses, occupiedKinds, KIND_COLORS, KIND_LABELS } from './lib/status.js'
import { ALL_SLOTS, freeOfSelected, findCourses, RESULT_LIMIT, CAMPUSES, CATEGORIES, SORT_OPTIONS, hasBriefData, depCounts, courseSlots, describeKeys, appliedFilters, withoutFilter, facetCounts, relaxations, appliedCount } from './lib/freeslots.js'
import { findAttributionOptions, needsChoice, preregParams, courseDepUids, describeAttribution, restoreParams } from './lib/attribution.js'
import { resolveRegInfo, describeAvailability } from './lib/register.js'
import { createRegisterDialog } from './reg-dialog.js'
import { findCosTab, askCos, cosProblem } from './cos-tab.js'
import { parseRegStatus, closedNotice } from './lib/regstatus.js'
import { createSlotGrid } from './planner/slot-grid.js'
import { createDeptPicker } from './planner/dept-picker.js'
import { renderResults as renderResultList } from './planner/results.js'
import { createPaneTabs } from './planner/pane-tabs.js'
import { createSplitView } from './planner/split-view.js'
import { createCrawlBar } from './planner/crawl-bar.js'
import { createTimetable } from './planner/timetable.js'
import { createCourseDetail } from './planner/course-detail.js'

const $ = (sel) => document.querySelector(sel)
const VALID = new Set(ALL_SLOTS)
const CODE_CATEGORIES = new Set(['核心・基本素養', '核心・領域課程', '語言與溝通'])
const DEFAULT_FILTERS = { mode: 'inside', sort: 'fit', campuses: [], categories: [], deps: [], keyword: '' }

const state = {
  selection: new Set(),
  filters: { ...DEFAULT_FILTERS },
  schedule: { sources: {}, manual: [], overrides: {} },
  courseData: null,
  paneTab: 'preview', // 右欄目前的 tab：preview（課表預覽）或 filters（篩選設定）
  split: undefined, // 左欄佔的寬度比例，沒調過就用預設
}
const addState = new Map() // 課號 -> { status: 'pending'|'choose'|'added'|'exists'|'error', ... }
let grid = null
let timetable = null
let deptPicker = null
let depTree = null
let tabs = null

const courses = () => (state.courseData && state.courseData.courses) || []

// ---------- 儲存 ----------

async function save() {
  try {
    await chrome.storage.local.set({ planner: { selection: [...state.selection], filters: state.filters, paneTab: state.paneTab, split: state.split } })
  } catch {}
}

function restore(saved) {
  if (!saved || typeof saved !== 'object') return
  if (Array.isArray(saved.selection)) state.selection = new Set(saved.selection.filter((k) => VALID.has(k)))
  if (saved.filters && typeof saved.filters === 'object') state.filters = { ...DEFAULT_FILTERS, ...saved.filters }
  if (saved.paneTab === 'preview' || saved.paneTab === 'filters') state.paneTab = saved.paneTab
  if (Number.isFinite(saved.split)) state.split = saved.split
}

// ---------- 時段 ----------

// 復原：選取的每次變更都記下前一個狀態（全選、空堂、清除會整個取代，最需要能退回）
const history = []
const HISTORY_LIMIT = 30

function setSelection(next, { remember = true } = {}) {
  const cleaned = new Set([...next].filter((k) => VALID.has(k)))
  const same = cleaned.size === state.selection.size && [...cleaned].every((k) => state.selection.has(k))
  if (same) return
  if (remember) {
    history.push(state.selection)
    if (history.length > HISTORY_LIMIT) history.shift()
  }
  state.selection = cleaned
  save()
  render()
}

function undo() {
  if (!history.length) return
  setSelection(history.pop(), { remember: false })
}

// 空堂：全部時段扣掉已選上的課（已登記、預排、私人行程都算空堂）
function selectFree() {
  setSelection(freeOfSelected(state.schedule))
}

// ---------- 篩選 ----------

function fieldset(legend, ...children) {
  const fs = document.createElement('fieldset')
  fs.append(Object.assign(document.createElement('legend'), { textContent: legend }), ...children)
  return fs
}

function choice(type, name, value, text, checked, disabled = false) {
  const label = document.createElement('label')
  const input = Object.assign(document.createElement('input'), { type, name, value, checked, disabled })
  // 選項旁的門數（只有校區、類別會填）
  const count = Object.assign(document.createElement('span'), { className: 'facet-count' })
  label.append(input, ` ${text}`, count)
  return label
}

// 換一組篩選條件（已套用篩選的 ×、零結果的建議、清除全部篩選都走這裡）
function applyFilters(next) {
  state.filters = { ...DEFAULT_FILTERS, ...next }
  save()
  buildFilters()
  renderResults()
}

function renderApplied() {
  const box = $('#applied')
  const applied = appliedFilters(state.filters)
  box.replaceChildren()
  box.hidden = !applied.length
  for (const a of applied) {
    const chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'chip'
    chip.textContent = `${a.label} ×`
    chip.title = `拿掉「${a.label}」`
    chip.addEventListener('click', () => applyFilters(withoutFilter(state.filters, a.field, a.value)))
    box.append(chip)
  }
  if (applied.length) {
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'link'
    clear.textContent = '清除全部篩選'
    clear.addEventListener('click', () => applyFilters({ mode: state.filters.mode, sort: state.filters.sort }))
    box.append(clear)
  }
}

// 校區、類別選項旁顯示「選這個會有幾門」，沒有結果的選項變淡
function renderFacetCounts(list) {
  const form = $('#filters')
  const f = { ...state.filters, selection: state.selection, excludeIds: [] }
  for (const [name, field] of [['campus', 'campuses'], ['category', 'categories']]) {
    const inputs = [...form.querySelectorAll(`input[name="${name}"]`)]
    const counts = state.selection.size ? facetCounts(list, f, field, inputs.map((i) => i.value)) : new Map()
    for (const input of inputs) {
      const label = input.closest('label')
      const n = counts.get(input.value)
      label.querySelector('.facet-count').textContent = n === undefined ? '' : ` ${n}`
      label.classList.toggle('empty', n === 0 && !input.checked)
    }
  }
}

function renderZero(list) {
  const box = document.createElement('div')
  box.className = 'zero'
  box.append(Object.assign(document.createElement('p'), { textContent: '沒有符合的課。可以試試：' }))
  const tips = relaxations(list, { ...state.filters, selection: state.selection, excludeIds: [] }).filter((t) => t.total > 0)
  for (const t of tips) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = `${t.label}（${t.total} 門）`
    b.addEventListener('click', () => {
      const { selection, excludeIds, ...next } = t.filters
      applyFilters(next)
    })
    box.append(b)
  }
  if (!tips.length) box.append(Object.assign(document.createElement('p'), { className: 'muted', textContent: '放寬篩選也沒有結果，試試多框一些時段。' }))
  $('#results').replaceChildren(box)
}

function buildFilters() {
  const f = state.filters
  const form = $('#filters')
  form.replaceChildren()

  form.append(
    fieldset(
      '比對方式',
      choice('radio', 'mode', 'inside', '完全落在內', f.mode !== 'overlap'),
      choice('radio', 'mode', 'overlap', '部分重疊', f.mode === 'overlap'),
    ),
  )

  form.append(fieldset('校區', ...CAMPUSES.map((c) => choice('checkbox', 'campus', c.code, c.name, f.campuses.includes(c.code)))))

  const hasCodes = hasBriefData(courses())
  const cats = fieldset('類別', ...CATEGORIES.map((c) => choice('checkbox', 'category', c, c, f.categories.includes(c), !hasCodes && CODE_CATEGORIES.has(c))))
  if (!hasCodes) cats.append(Object.assign(document.createElement('p'), { className: 'muted hint', textContent: '重新更新課程資料後才能篩核心、語言與溝通' }))
  form.append(cats)

  const depBox = document.createElement('div')
  form.append(fieldset('系所（可複選）', depBox))
  deptPicker = createDeptPicker(depBox, {
    onChange: (deps) => {
      state.filters = { ...state.filters, deps }
      save()
      renderResults()
    },
  })
  deptPicker.update(depCounts(courses()), f.deps)

  const sort = $('#sort')
  sort.replaceChildren(...SORT_OPTIONS.map((o) => new Option(o.label, o.id, false, o.id === f.sort)))
  $('#keyword').value = f.keyword
}

function readFilters() {
  const form = $('#filters')
  const checked = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value)
  state.filters = {
    ...state.filters,
    mode: (form.querySelector('input[name="mode"]:checked') || {}).value || 'inside',
    sort: $('#sort').value,
    campuses: checked('campus'),
    categories: checked('category'),
    keyword: $('#keyword').value,
  }
  save()
  renderResults()
}

// ---------- 結果 ----------

function renderResults() {
  drawResults()
  if (detail) detail.refresh()
}

function drawResults() {
  const list = courses()
  if (tabs) {
    const n = appliedCount(state.filters, state.selection)
    tabs.setLabel('filters', n ? `篩選設定 (${n})` : '篩選設定')
  }
  const summary = $('#summary')
  if (!list.length) {
    summary.textContent = '還沒有課程資料，請先按上方「更新課程資料」。'
    $('#results').replaceChildren()
    return
  }
  if (!state.selection.size) {
    summary.textContent = '先到右邊「篩選設定」框選時段，或按「全選」「空堂」。'
    $('#results').replaceChildren()
    return
  }
  const found = findCourses(list, { ...state.filters, selection: state.selection, excludeIds: [] })
  summary.textContent = found.truncated ? `共 ${found.total} 門，只顯示前 ${RESULT_LIMIT} 門，請再縮小條件` : `共 ${found.total} 門`
  renderApplied()
  renderFacetCounts(list)
  if (!found.total) return renderZero(list)
  renderResultList($('#results'), found, {
    semester: state.courseData.semester,
    statuses: courseStatuses(state.schedule),
    addState,
    onHover: (hit) => {
      grid.preview(hit ? hit.keys.filter((k) => state.selection.has(k)) : [], hit ? hit.outside : [])
      timetable.preview(hit ? courseSlots(hit.course).keys : [])
    },
    onAdd: addCourse,
    onQuery: queryCourse,
    onRegister: registerCourse,
    onChoose: (course, option) => submitAdd(course, option),
    onCancel: (course) => {
      addState.delete(course.id)
      renderResults()
    },
  })
}

// ---------- 加入預排 ----------

const needsCos = (reply) => reply && (reply.reason === 'no_tab' || reply.reason === 'not_logged_in' || reply.reason === 'no_content_script')

const cosError = (reply) => Object.assign(new Error(cosProblem(reply)), { reply })
const errorText = (err, fallback) => (needsCos(err && err.reply) ? '請先開啟並登入選課網' : (err && err.message) || fallback)

async function loadDepTree() {
  if (depTree) return depTree
  const reply = await askCos({ type: 'deptree' })
  if (!reply || !reply.ok) throw cosError(reply)
  depTree = reply.tree
  return depTree
}

// 這門課在選課網有哪些採計方式（加入預排與查詢共用）
function attributionOptionsFor(course) {
  return findAttributionOptions({
    cosId: course.id,
    courseName: course.name,
    depUids: courseDepUids(course),
    getTree: loadDepTree,
    getList: async (menu) => {
      const reply = await askCos({ type: 'courselist', menu })
      if (reply && reply.ok) return reply.list
      throw cosError(reply)
    },
  })
}

async function addCourse(course) {
  addState.set(course.id, { status: 'pending' })
  renderResults()
  let options = []
  try {
    options = await attributionOptionsFor(course)
  } catch (err) {
    addState.set(course.id, { status: 'error', msg: errorText(err, '查詢失敗') })
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

// ---------- 查詢與加選／登記 ----------

function preregItem(id) {
  const src = (state.schedule.sources || {}).preregist
  return ((src && src.courses) || []).find((c) => String(c.cos_id) === String(id)) || null
}

// 查詢能不能加選：已在預排用預排記的採計方式；不在預排就每種採計方式各查一次
async function queryCourse(course) {
  addState.set(course.id, { status: 'querying' })
  renderResults()
  try {
    const item = preregItem(course.id)
    const rows = []
    if (item) {
      const reply = await resolveRegInfo({
        course: item,
        timetableMenu: course.menu || null,
        askRegInfo: (menu) => askCos({ type: 'reginfo', cosId: course.id, menu }),
        getDepTree: loadDepTree,
      })
      if (!reply || !reply.ok) throw cosError(reply)
      rows.push({ label: describeAttribution(item), option: null, record: reply.record, availability: describeAvailability(reply.record), inPrereg: true })
    } else {
      for (const option of await attributionOptionsFor(course)) {
        const reply = await askCos({ type: 'reginfo', cosId: course.id, menu: { ...option.menu, category_type: option.row.category_type || '' } })
        if (!reply || !reply.ok) throw cosError(reply)
        const record = reply.json && typeof reply.json === 'object' && reply.json[course.id] ? reply.json[course.id] : null
        rows.push({ label: option.label, option, record, availability: describeAvailability(record), inPrereg: false })
      }
    }
    addState.set(course.id, rows.length ? { status: 'queried', rows } : { status: 'error', msg: '在選課網找不到這門課' })
  } catch (err) {
    if (err.reply && err.reply.reason === 'closed') showClosed(err.reply.detail)
    addState.set(course.id, { status: 'error', msg: errorText(err, '查詢失敗') })
  }
  renderResults()
}

let dialog = null
let groups = null

// 加選／登記：不在預排就先用這種採計方式加入預排，再開確認視窗；按「送出加選／送出登記」才會送出
async function registerCourse(course, row) {
  const before = addState.get(course.id)
  addState.set(course.id, { ...before, busy: true })
  renderResults()
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
  // 已經登記志願的課要改志願：選課網不接受直接重送，確認視窗會先取消再登記
  const status = courseStatuses(state.schedule).get(String(course.id))
  const currentWish = status && status.state === 'wish' && status.wishNo ? status.wishNo : null
  const outcome = await dialog.open({
    heading: `${course.id} ${course.name}`,
    detail: [course.teacher, describeKeys(courseSlots(course).keys)].filter(Boolean).join(' · '),
    check: { record: row.record, availability: row.availability },
    groups,
    currentWish,
  })
  groups = null
  if (!outcome) addState.set(course.id, { ...before, busy: false })
  else addState.set(course.id, outcome.ok ? { status: 'registered', msg: outcome.message } : { status: 'error', msg: outcome.message })
  renderResults()
  // 取消時課也可能已經加進預排，所以一律重讀狀態
  await syncStatus()
}

async function submitAdd(course, option) {
  addState.set(course.id, { status: 'pending' })
  renderResults()
  const params = option ? { [course.id]: preregParams(course.id, option) } : {}
  const reply = await askCos({ type: 'import', ids: [course.id], params })
  const result = reply && reply.ok && reply.results && reply.results[0]
  if (result && (result.status === 'added' || result.status === 'exists')) {
    addState.set(course.id, { status: result.status, note: option ? option.label : '' })
    $('#cos-hint').hidden = true
    syncStatus()
  } else if (result) {
    addState.set(course.id, { status: 'error', msg: result.msg || '加入失敗' })
  } else {
    addState.set(course.id, { status: 'error', msg: needsCos(reply) ? '請先開啟並登入選課網' : cosProblem(reply) })
  }
  renderResults()
}

// ---------- 課程狀態 ----------
// 主動更新：按「從選課網更新狀態」；順便更新：加入、加選、登記成功後自動呼叫 syncStatus

let statusMessage = ''

async function syncStatus() {
  const reply = await askCos({ type: 'courses' })
  if (!reply || !reply.ok) {
    if (reply && reply.reason === 'closed') showClosed(reply.detail)
    return needsCos(reply) ? '請先開啟並登入選課網，狀態維持原樣。' : `${cosProblem(reply)}，狀態維持原樣。`
  }
  const { schedule } = await chrome.storage.local.get('schedule')
  await chrome.storage.local.set({ schedule: withSyncedSources(schedule, reply, Date.now()) })
  // 分發停機時預排讀得到、正式選課讀不到：講清楚哪一邊沒有更新
  if (reply.registeredClosed !== undefined) {
    showClosed(reply.registeredClosed)
    return '預排已更新；選課網目前讀不到正式選課，正式選課維持原樣。'
  }
  return ''
}

// ---------- 選課系統暫停（分發時段） ----------
// 停機時預排照常可以加入、移除（2026-09-21 實測），查詢、加選、登記要等開放。

function showClosed(message) {
  const banner = $('#sys-banner')
  banner.textContent = closedNotice(message)
  banner.hidden = false
}

async function checkRegStatus() {
  const reply = await askCos({ type: 'regstatus' })
  if (!reply || !reply.ok) return
  const st = parseRegStatus(reply.json)
  if (!st.open) showClosed(st.message)
  else $('#sys-banner').hidden = true
}

function statusAtText() {
  const sources = state.schedule.sources || {}
  const at = Math.max(...['registered', 'preregist'].map((n) => (sources[n] && sources[n].updatedAt) || 0))
  if (!at) return '狀態還沒從選課網讀過'
  const d = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  return `狀態更新於 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

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
  showToast('移除中…')
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
  // 這門課的查詢結果（inPrereg: true 的列）跟著舊的採計方式，移除後不再適用，
  // 不清掉的話左邊結果卡片還是看得到登記／加選按鈕，送出時也不會先加回預排
  addState.delete(String(item.cosId))
  renderResults()
  showToast(`已從預排移除 ${item.title}`, record ? { label: '復原', run: () => restorePrereg(item, record) } : null)
  syncStatus()
}

async function restorePrereg(item, record) {
  const id = String(item.cosId)
  const reply = await askCos({ type: 'import', ids: [id], params: { [id]: restoreParams(record) } })
  const result = reply && reply.ok && reply.results && reply.results[0]
  // 復原後查詢狀態一樣是舊資料，一併清掉，讓結果卡片重新反映現在的預排狀態
  addState.delete(id)
  renderResults()
  if (result && (result.status === 'added' || result.status === 'exists')) showToast(`已復原 ${item.title}`)
  else showToast(`復原失敗：${result ? result.msg || '加入失敗' : cosProblem(reply)}。請到選課網重新加入。`)
  syncStatus()
}

// ---------- 初始化 ----------

function render() {
  grid.render(state.selection, occupiedKinds(state.schedule))
  timetable.render(scheduleItems(state.schedule, ['registered', 'preregist']))
  $('#status-at').textContent = statusMessage || statusAtText()
  $('#count').textContent = `已選 ${state.selection.size} 格`
  $('#undo').disabled = !history.length
  renderResults()
}

async function init() {
  const stored = await chrome.storage.local.get(['planner', 'schedule', 'courseData'])
  restore(stored.planner)
  if (stored.schedule) state.schedule = stored.schedule
  state.courseData = stored.courseData || null
  grid = createSlotGrid($('#grid'), { onChange: setSelection })
  timetable = createTimetable($('#timetable'), { note: $('#hidden-note'), onOpen: openDetail })
  detail = createCourseDetail($('#detail'), {
    semester: () => (state.courseData && state.courseData.semester) || '',
    status: (id) => courseStatuses(state.schedule).get(String(id)),
    findCourse: (id) => courses().find((c) => String(c.id) === String(id)) || null,
    queryState: (id) => addState.get(String(id)),
    onQuery: queryCourse,
    onRegister: registerCourse,
    onRemove: removeFromPrereg,
  })
  dialog = createRegisterDialog()
  tabs = createPaneTabs({
    tabs: {
      preview: { tab: $('#tab-preview'), panel: $('#panel-preview') },
      filters: { tab: $('#tab-filters'), panel: $('#panel-filters') },
    },
    initial: state.paneTab,
    onChange: (id) => {
      state.paneTab = id
      save()
    },
  })
  createSplitView({
    layout: $('.layout'),
    handle: $('#splitter'),
    initialRatio: state.split,
    onChange: (ratio) => {
      state.split = ratio
      save()
    },
  })
  // 詳情小卡不是 modal（焦點不一定在卡片裡）：焦點在卡片外按 Esc 也要能關。
  // 卡片自己也監聽 Esc（焦點在卡片裡時），那邊會 stopPropagation，不會兩邊都關
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || document.querySelector('#confirm[open]') || !detail.isOpen()) return
    e.preventDefault()
    detail.close()
  })
  const crawl = createCrawlBar($('#crawl'))
  crawl.load()
  askCos({ type: 'semester' }).then((reply) => crawl.setCosSemester(reply && reply.ok ? reply.semester : null))
  buildFilters()
  $('#filters').addEventListener('input', (e) => {
    if (!e.target.closest('.dept-picker')) readFilters()
  })
  $('#filters').addEventListener('change', (e) => {
    if (!e.target.closest('.dept-picker')) readFilters()
  })
  $('#keyword').addEventListener('input', readFilters)
  $('#sort').addEventListener('change', readFilters)
  renderLegend($('#legend'))
  renderLegend($('#grid-legend'))
  $('#refresh-status').addEventListener('click', async () => {
    const btn = $('#refresh-status')
    btn.disabled = true
    $('#status-at').textContent = '更新中…'
    statusMessage = await syncStatus()
    btn.disabled = false
    $('#status-at').textContent = statusMessage || statusAtText()
  })
  $('#select-all').addEventListener('click', () => setSelection(new Set(ALL_SLOTS)))
  $('#select-free').addEventListener('click', selectFree)
  $('#clear').addEventListener('click', () => setSelection(new Set()))
  $('#undo').addEventListener('click', undo)
  document.addEventListener('keydown', (e) => {
    const typing = e.target.closest && e.target.closest('input, textarea, select')
    if (!typing && (e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      undo()
    }
  })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.schedule) state.schedule = changes.schedule.newValue || state.schedule
    if (changes.courseData) {
      state.courseData = changes.courseData.newValue || state.courseData
      buildFilters()
    }
    if (changes.schedule || changes.courseData) render()
  })
  render()
  checkRegStatus()
  if (!(await findCosTab())) {
    const hint = $('#cos-hint')
    hint.textContent = '要加入預排的話，請先開啟並登入選課網。'
    hint.hidden = false
  }
}

init()
