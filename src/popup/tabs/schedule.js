// 課表 tab：開學後點開看一眼課表就關掉。只顯示正式選課＋自訂行程，
// 今天那一欄加深、紅線是現在時間；點一堂課看詳情與連結。
// 不自動去選課網更新（過了選課期可能無法登入），只在使用者按「從選課網更新」時讀一次。
import { scheduleItems, withSyncedSources, buildWeek, mergeBlocks } from '../../lib/schedule.js'
import { locateNow } from '../../lib/now.js'
import { describeSlots } from '../../lib/periods.js'
import { courseOutlineUrl } from '../../lib/links.js'
import { state } from '../shared.js'
import { connectOnce, onCosChange, findCosTab } from '../cos.js'
import { createCourseSearch } from '../course-search.js'

const ROW_PX = 28
const HEAD_PX = 20
const SCHEDULE_URL = () => chrome.runtime.getURL('src/schedule.html')

let root = null
let schedule = { sources: {}, manual: [], overrides: {} }
let selectedKey = null
let search = null
let syncMessage = '' // 上次按「從選課網更新」失敗的原因

const el = (sel) => root.querySelector(sel)

function layout() {
  return mergeBlocks(buildWeek(scheduleItems(schedule, ['registered'])))
}

function renderWeek(week, located) {
  const grid = el('.mini-week')
  grid.replaceChildren()
  grid.style.gridTemplateColumns = `18px repeat(${week.days.length}, minmax(0, 1fr))`
  grid.style.gridTemplateRows = `${HEAD_PX}px repeat(${week.rows.length}, ${ROW_PX}px)`

  grid.append(Object.assign(document.createElement('div'), { className: 'corner' }))
  week.days.forEach((day, i) => {
    const head = document.createElement('div')
    head.className = `day-head${day === located.today ? ' today' : ''}`
    head.style.gridColumn = String(i + 2)
    head.style.gridRow = '1'
    head.textContent = week.dayNames[day]
    grid.append(head)
  })
  week.rows.forEach((row, r) => {
    const label = document.createElement('div')
    label.className = 'period'
    label.style.gridColumn = '1'
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
    shade.style.gridRow = `1 / span ${week.rows.length + 1}`
    grid.append(shade)
  }
  for (const block of week.blocks) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'block'
    if (block.lanes > 1) cell.classList.add('conflict')
    if (block.item.regState === 'wish') cell.classList.add('wish')
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
    cell.setAttribute('aria-pressed', String(block.key === selectedKey))
    cell.addEventListener('click', () => {
      selectedKey = selectedKey === block.key ? null : block.key
      render()
    })
    grid.append(cell)
  }
  if (located.nowLine) {
    const line = document.createElement('div')
    line.className = 'now'
    line.setAttribute('aria-hidden', 'true')
    // 每列高 ROW_PX，列與列之間有 2px 間隔
    line.style.top = `${HEAD_PX + 2 + (located.nowLine.row + located.nowLine.fraction) * (ROW_PX + 2)}px`
    grid.append(line)
  }
}

function link(text, url) {
  const a = document.createElement('a')
  a.textContent = text
  a.href = url
  a.target = '_blank'
  a.rel = 'noreferrer'
  return a
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
  if (item.url) actions.append(link('開啟連結', item.url))
  const outline = courseOutlineUrl(item.semester, item.cosId)
  if (outline) actions.append(link('課程大綱', outline))
  const set = document.createElement('button')
  set.type = 'button'
  set.textContent = item.url ? '修改連結' : '設定連結'
  set.addEventListener('click', () => chrome.tabs.create({ url: SCHEDULE_URL() }))
  actions.append(set)
  box.append(title, info, actions)
}

function render() {
  const week = layout()
  const empty = week.blocks.length === 0
  el('.empty').hidden = !empty
  el('.mini-week').hidden = empty
  el('.updated').hidden = empty // 空狀態自己有同步按鈕
  if (selectedKey && !week.blocks.some((b) => b.key === selectedKey)) selectedKey = null
  if (!empty) renderWeek(week, locateNow(week, new Date()))
  renderDetail(week)
  if (!syncMessage) el('.updated-at').textContent = updatedText()
}

function updatedText() {
  const reg = schedule.sources && schedule.sources.registered
  if (!reg || !reg.updatedAt) return ''
  const at = new Date(reg.updatedAt)
  const pad = (n) => String(n).padStart(2, '0')
  return `更新於 ${at.getMonth() + 1}/${at.getDate()} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}

// 使用者按「從選課網更新」時讀一次正式選課；讀不到就沿用原本的課表，只提示原因
async function syncFromCos() {
  try {
    const tab = await findCosTab()
    if (!tab) return '找不到選課網分頁，請先開啟並登入選課網。'
    const reply = await chrome.tabs.sendMessage(tab.id, { type: 'courses' })
    if (!reply || !reply.ok) return reply && reply.reason === 'not_logged_in' ? '選課網沒有登入，課表維持原樣。' : '選課網沒有回應，課表維持原樣。'
    await chrome.storage.local.set({ schedule: withSyncedSources(schedule, reply, Date.now()) })
    return ''
  } catch {
    return '選課網分頁沒有回應，請重新整理該分頁後再試。'
  }
}

// 搜尋要用的課程資料；先開課表 tab 時，加入預排 tab 還沒載入過
async function ensureCourseData() {
  if (state.courses.length) return
  const { courseData } = await chrome.storage.local.get('courseData')
  if (state.courses.length) return
  state.courseData = courseData
  state.courses = (courseData && courseData.courses) || []
}

export async function mount(container) {
  root = container
  const stored = await chrome.storage.local.get('schedule')
  if (stored.schedule) schedule = stored.schedule
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return
    if (changes.schedule) {
      schedule = changes.schedule.newValue || schedule
      render()
    }
    if (changes.courseData && changes.courseData.newValue) {
      state.courseData = changes.courseData.newValue
      state.courses = changes.courseData.newValue.courses || []
      search.render()
    }
  })
  el('[data-action="open-schedule"]').addEventListener('click', () => chrome.tabs.create({ url: SCHEDULE_URL() }))
  for (const btn of root.querySelectorAll('[data-action="sync"]')) {
    btn.addEventListener('click', async () => {
      btn.disabled = true
      syncMessage = ''
      el('.updated-at').textContent = '更新中…'
      syncMessage = await syncFromCos()
      btn.disabled = false
      el('.updated-at').textContent = syncMessage || updatedText()
    })
  }
  search = createCourseSearch({ q: el('.q'), list: el('.search-results'), summary: el('.search-summary'), cosHint: true })
  onCosChange(() => search.render())
  await ensureCourseData()
  el('.q').disabled = state.courses.length === 0
  el('.q').placeholder = state.courses.length ? '找課：課名、老師或課號' : '要先在「加入預排」更新課程資料才能找課'
  connectOnce()
  setInterval(render, 30_000)
}

export function show() {
  render()
  search.render()
}
