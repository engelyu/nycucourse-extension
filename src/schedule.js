import { courseToItem, applyOverrides, itemUrl, buildWeek } from './lib/schedule.js'
import { DAY_NAMES } from './lib/periods.js'

const COS_URL = 'https://cos.nycu.edu.tw/#/emulator'
const $ = (sel) => document.querySelector(sel)

const state = {
  source: 'registered',
  schedule: { sources: {}, manual: [], overrides: {} },
}

function formatTime(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function showMessage(text, kind = '') {
  const el = $('#message')
  el.textContent = text
  el.classList.toggle('error', kind === 'error')
  el.hidden = !text
}

async function load() {
  const { schedule } = await chrome.storage.local.get('schedule')
  state.schedule = { sources: {}, manual: [], overrides: {}, ...(schedule || {}) }
  render()
}

function currentItems() {
  const sources = state.schedule.sources || {}
  const wanted = state.source === 'all' ? ['registered', 'preregist'] : [state.source]
  const seen = new Set()
  const items = []
  for (const name of wanted) {
    const src = sources[name]
    for (const course of (src && src.courses) || []) {
      const item = courseToItem(course, { source: name, semester: src.semester })
      // 「全部」時同一門課只留一筆，正式選課優先
      if (seen.has(item.cosId)) continue
      seen.add(item.cosId)
      items.push(item)
    }
  }
  const manual = (state.schedule.manual || []).map((m) => ({ ...m }))
  return applyOverrides([...items, ...manual], state.schedule.overrides || {})
}

function itemElement(item) {
  const url = itemUrl(item)
  const el = document.createElement(url ? 'a' : 'div')
  el.className = `item${item.source === 'manual' ? ' manual' : ''}`
  if (url) {
    el.href = url
    el.target = '_blank'
    el.rel = 'noreferrer'
  }
  if (item.color) el.style.background = item.color
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = item.title
  const sub = document.createElement('span')
  sub.className = 'sub'
  sub.textContent = [item.room, item.teacher].filter(Boolean).join(' · ')
  el.append(title, sub)
  el.title = [item.title, item.teacher, item.room, url ? '點擊開啟連結' : ''].filter(Boolean).join('\n')
  return el
}

function render() {
  const sources = state.schedule.sources || {}
  for (const btn of document.querySelectorAll('#source-tabs button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.source === state.source))
  }

  const parts = []
  for (const [name, label] of [['registered', '正式選課'], ['preregist', '預排課程']]) {
    const src = sources[name]
    if (src) parts.push(`${label} ${src.courses.length} 門 · ${formatTime(src.updatedAt)} 同步`)
  }
  $('#status').textContent = parts.join('　|　') || '尚未同步課表'

  const items = currentItems()
  const week = buildWeek(items)
  const wrap = $('#grid-wrap')
  wrap.replaceChildren()
  $('#empty').hidden = week.rows.length > 0

  if (!week.rows.length) return

  const table = document.createElement('table')
  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  headRow.append(document.createElement('th'))
  for (const day of week.days) {
    const th = document.createElement('th')
    th.textContent = DAY_NAMES[day]
    headRow.append(th)
  }
  thead.append(headRow)

  const tbody = document.createElement('tbody')
  for (const row of week.rows) {
    const tr = document.createElement('tr')
    const th = document.createElement('th')
    th.className = 'period'
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = row.label
    const time = document.createElement('span')
    time.className = 'time'
    time.textContent = `${row.start}-${row.end}`
    th.append(label, time)
    tr.append(th)
    for (const day of week.days) {
      const td = document.createElement('td')
      for (const item of row.cells[day] || []) td.append(itemElement(item))
      tr.append(td)
    }
    tbody.append(tr)
  }
  table.append(thead, tbody)
  wrap.append(table)
}

async function findCosTab() {
  const tabs = await chrome.tabs.query({ url: 'https://cos.nycu.edu.tw/*' })
  return tabs[0] || null
}

async function sync() {
  const btn = $('#btn-sync')
  btn.disabled = true
  showMessage('')
  try {
    const tab = await findCosTab()
    if (!tab) {
      showMessage('找不到選課網分頁。請先開啟並登入選課網，再按一次同步。', 'error')
      return
    }
    let reply
    try {
      reply = await chrome.tabs.sendMessage(tab.id, { type: 'courses' })
    } catch {
      showMessage('選課網分頁沒有回應，請重新整理該分頁後再試。', 'error')
      return
    }
    if (!reply || !reply.ok) {
      showMessage(reply && reply.reason === 'not_logged_in' ? '請先登入選課網。' : `同步失敗：${(reply && reply.detail) || '未知錯誤'}`, 'error')
      return
    }
    const now = Date.now()
    const semesterOf = (list) => {
      const c = (list || [])[0]
      return c && c.acy ? `${c.acy}${c.sem}` : ''
    }
    const sources = { ...(state.schedule.sources || {}) }
    sources.registered = { semester: semesterOf(reply.registered), updatedAt: now, courses: reply.registered || [] }
    sources.preregist = { semester: semesterOf(reply.preregist), updatedAt: now, courses: reply.preregist || [] }
    state.schedule = { ...state.schedule, sources }
    await chrome.storage.local.set({ schedule: state.schedule })
    render()
    const counts = `正式 ${sources.registered.courses.length} 門、預排 ${sources.preregist.courses.length} 門`
    showMessage(`同步完成：${counts}`)
  } finally {
    btn.disabled = false
  }
}

function init() {
  for (const btn of document.querySelectorAll('#source-tabs button')) {
    btn.addEventListener('click', () => {
      state.source = btn.dataset.source
      localStorage.setItem('scheduleSource', state.source)
      render()
    })
  }
  state.source = localStorage.getItem('scheduleSource') || 'registered'
  $('#btn-sync').addEventListener('click', sync)
  $('#empty').addEventListener('click', (e) => {
    if (e.target.tagName === 'A') return
    chrome.tabs.create({ url: COS_URL })
  })
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.schedule) {
      state.schedule = changes.schedule.newValue || state.schedule
      render()
    }
  })
  load()
}

init()
