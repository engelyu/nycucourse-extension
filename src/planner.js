// 選課規劃頁（目前只有「找空堂課程」）。狀態：選取的時段與篩選條件，存在 storage 的 planner。
import { scheduleItems } from './lib/schedule.js'
import { ALL_SLOTS, occupiedSlots, freeSlots } from './lib/freeslots.js'
import { createSlotGrid } from './planner/slot-grid.js'

const $ = (sel) => document.querySelector(sel)
const VALID = new Set(ALL_SLOTS)
const DEFAULT_FILTERS = { mode: 'inside', sort: 'fit', campuses: [], categories: [], deps: [], creditMin: '', creditMax: '', keyword: '', excludeRegistered: false, excludePreregist: false }

const state = {
  selection: new Set(),
  filters: { ...DEFAULT_FILTERS },
  schedule: { sources: {}, manual: [], overrides: {} },
  courseData: null,
}
let grid = null

// 格子上顯示「這格已經有什麼課」：正式選課、預排、自訂行程
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

// 下一個任務換成真正的結果清單
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
