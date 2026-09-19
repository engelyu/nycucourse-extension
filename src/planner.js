// 選課規劃頁（目前只有「找空堂課程」）。狀態：選取的時段與篩選條件，存在 storage 的 planner。
import { scheduleItems, withSyncedSources } from './lib/schedule.js'
import { courseStatuses, occupiedKinds, KIND_COLORS, KIND_LABELS } from './lib/status.js'
import { ALL_SLOTS, occupiedSlots, freeSlots, findCourses, RESULT_LIMIT, CAMPUSES, CATEGORIES, SORT_OPTIONS, hasBriefData, depCounts } from './lib/freeslots.js'
import { findAttributionOptions, needsChoice, preregParams, courseDepUids } from './lib/attribution.js'
import { findCosTab, askCos, cosProblem } from './cos-tab.js'
import { createSlotGrid } from './planner/slot-grid.js'
import { createDeptPicker } from './planner/dept-picker.js'
import { renderResults as renderResultList } from './planner/results.js'

const $ = (sel) => document.querySelector(sel)
const VALID = new Set(ALL_SLOTS)
const CODE_CATEGORIES = new Set(['核心・基本素養', '核心・領域課程', '語言與溝通'])
const DEFAULT_FILTERS = { mode: 'inside', sort: 'fit', campuses: [], categories: [], deps: [], keyword: '' }

const state = {
  selection: new Set(),
  filters: { ...DEFAULT_FILTERS },
  schedule: { sources: {}, manual: [], overrides: {} },
  courseData: null,
}
const addState = new Map() // 課號 -> { status: 'pending'|'choose'|'added'|'exists'|'error', ... }
let grid = null
let deptPicker = null
let depTree = null

const courses = () => (state.courseData && state.courseData.courses) || []

// ---------- 儲存 ----------

async function save() {
  try {
    await chrome.storage.local.set({ planner: { selection: [...state.selection], filters: state.filters } })
  } catch {}
}

function restore(saved) {
  if (!saved || typeof saved !== 'object') return
  if (Array.isArray(saved.selection)) state.selection = new Set(saved.selection.filter((k) => VALID.has(k)))
  if (saved.filters && typeof saved.filters === 'object') state.filters = { ...DEFAULT_FILTERS, ...saved.filters }
}

// ---------- 時段 ----------

function setSelection(next) {
  state.selection = new Set([...next].filter((k) => VALID.has(k)))
  save()
  render()
}

function fill(sources) {
  setSelection(freeSlots(occupiedSlots(scheduleItems(state.schedule, sources))))
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
  label.append(input, ` ${text}`)
  return label
}

function input(id, attrs) {
  return Object.assign(document.createElement('input'), { id, ...attrs })
}

function buildFilters() {
  const f = state.filters
  const form = $('#filters')
  form.replaceChildren()

  const sort = document.createElement('select')
  sort.id = 'sort'
  for (const o of SORT_OPTIONS) sort.append(new Option(o.label, o.id, false, o.id === f.sort))
  form.append(
    fieldset(
      '比對方式',
      choice('radio', 'mode', 'inside', '完全落在內', f.mode !== 'overlap'),
      choice('radio', 'mode', 'overlap', '部分重疊', f.mode === 'overlap'),
      Object.assign(document.createElement('span'), { className: 'spacer' }),
      Object.assign(document.createElement('label'), { textContent: '排序 ', htmlFor: 'sort' }),
      sort,
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

  form.append(fieldset('關鍵字', input('keyword', { type: 'search', value: f.keyword, placeholder: '課名、老師或課號' })))

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
  const list = courses()
  const summary = $('#summary')
  if (!list.length) {
    summary.textContent = '還沒有課程資料，請先在擴充功能的「加入預排」按「更新課程資料」。'
    $('#results').replaceChildren()
    return
  }
  if (!state.selection.size) {
    summary.textContent = '先在左邊框選時段，或按「帶入空堂」。'
    $('#results').replaceChildren()
    return
  }
  const found = findCourses(list, { ...state.filters, selection: state.selection, excludeIds: [] })
  summary.textContent = found.truncated ? `共 ${found.total} 門，只顯示前 ${RESULT_LIMIT} 門，請再縮小條件` : `共 ${found.total} 門`
  renderResultList($('#results'), found, {
    semester: state.courseData.semester,
    statuses: courseStatuses(state.schedule),
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

// ---------- 加入預排 ----------

const needsCos = (reply) => reply && (reply.reason === 'no_tab' || reply.reason === 'not_logged_in' || reply.reason === 'no_content_script')

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
    addState.set(course.id, { status: 'error', msg: needsCos(err && err.reply) ? '請先開啟並登入選課網' : (err && err.message) || '查詢失敗' })
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
  if (!reply || !reply.ok) return needsCos(reply) ? '請先開啟並登入選課網，狀態維持原樣。' : `${cosProblem(reply)}，狀態維持原樣。`
  const { schedule } = await chrome.storage.local.get('schedule')
  await chrome.storage.local.set({ schedule: withSyncedSources(schedule, reply, Date.now()) })
  return ''
}

function statusAtText() {
  const sources = state.schedule.sources || {}
  const at = Math.max(...['registered', 'preregist'].map((n) => (sources[n] && sources[n].updatedAt) || 0))
  if (!at) return '狀態還沒從選課網讀過'
  const d = new Date(at)
  const pad = (n) => String(n).padStart(2, '0')
  return `狀態更新於 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function renderLegend() {
  const legend = $('#legend')
  legend.replaceChildren(
    ...Object.entries(KIND_LABELS).map(([kind, label]) => {
      const item = document.createElement('span')
      const dot = document.createElement('i')
      dot.style.background = KIND_COLORS[kind]
      item.append(dot, kind === 'manual' ? `${label}（顏色可在課表頁設定）` : label)
      return item
    }),
  )
}

// ---------- 初始化 ----------

function render() {
  grid.render(state.selection, occupiedKinds(state.schedule))
  $('#status-at').textContent = statusMessage || statusAtText()
  $('#count').textContent = `已選 ${state.selection.size} 格`
  renderResults()
}

async function init() {
  const stored = await chrome.storage.local.get(['planner', 'schedule', 'courseData'])
  restore(stored.planner)
  if (stored.schedule) state.schedule = stored.schedule
  state.courseData = stored.courseData || null
  grid = createSlotGrid($('#grid'), { onChange: setSelection })
  buildFilters()
  $('#filters').addEventListener('input', (e) => {
    if (!e.target.closest('.dept-picker')) readFilters()
  })
  $('#filters').addEventListener('change', (e) => {
    if (!e.target.closest('.dept-picker')) readFilters()
  })
  renderLegend()
  $('#refresh-status').addEventListener('click', async () => {
    const btn = $('#refresh-status')
    btn.disabled = true
    $('#status-at').textContent = '更新中…'
    statusMessage = await syncStatus()
    btn.disabled = false
    $('#status-at').textContent = statusMessage || statusAtText()
  })
  $('#fill-registered').addEventListener('click', () => fill(['registered']))
  $('#fill-all').addEventListener('click', () => fill(['registered', 'preregist']))
  $('#clear').addEventListener('click', () => setSelection(new Set()))
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
  if (!(await findCosTab())) {
    const hint = $('#cos-hint')
    hint.textContent = '要加入預排的話，請先開啟並登入選課網。'
    hint.hidden = false
  }
}

init()
