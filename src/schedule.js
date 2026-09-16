import { courseToItem, manualItem, slotsFromTimeRange, slotsFromPeriodRange, applyOverrides, itemUrl, buildWeek } from './lib/schedule.js'
import { PERIODS, DAY_NAMES, describeSlots } from './lib/periods.js'

const COS_URL = 'https://cos.nycu.edu.tw/#/emulator'
const $ = (sel) => document.querySelector(sel)

const state = {
  source: 'registered',
  schedule: { sources: {}, manual: [], overrides: {} },
  editing: null, // { mode: 'manual'|'override', item }
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

async function save() {
  await chrome.storage.local.set({ schedule: state.schedule })
}

async function load() {
  const { schedule } = await chrome.storage.local.get('schedule')
  state.schedule = { sources: {}, manual: [], overrides: {}, ...(schedule || {}) }
  render()
}

// ---------- 課表 ----------

function syncedItems() {
  const sources = state.schedule.sources || {}
  const wanted = state.source === 'all' ? ['registered', 'preregist'] : [state.source]
  const seen = new Set()
  const items = []
  for (const name of wanted) {
    const src = sources[name]
    for (const course of (src && src.courses) || []) {
      const item = courseToItem(course, { source: name, semester: src.semester })
      if (seen.has(item.cosId)) continue // 「全部」時同一門課只留一筆，正式選課優先
      seen.add(item.cosId)
      items.push(item)
    }
  }
  return items
}

function currentItems() {
  const manual = (state.schedule.manual || []).map((m) => ({ ...m }))
  return applyOverrides([...syncedItems(), ...manual], state.schedule.overrides || {})
}

function itemElement(item) {
  const wrap = document.createElement('div')
  wrap.className = `item${item.source === 'manual' ? ' manual' : ''}`
  if (item.color) wrap.style.background = item.color

  const url = itemUrl(item)
  const main = document.createElement(url ? 'a' : 'div')
  main.className = 'item-main'
  if (url) {
    main.href = url
    main.target = '_blank'
    main.rel = 'noreferrer'
  }
  const title = document.createElement('span')
  title.className = 'title'
  title.textContent = item.title
  const sub = document.createElement('span')
  sub.className = 'sub'
  sub.textContent = [item.room, item.teacher].filter(Boolean).join(' · ')
  main.append(title, sub)
  main.title = [item.title, item.teacher, item.room, url ? '點擊開啟連結' : '尚未設定連結'].filter(Boolean).join('\n')

  const edit = document.createElement('button')
  edit.type = 'button'
  edit.className = 'item-edit'
  edit.textContent = '✎'
  edit.title = item.source === 'manual' ? '編輯這個行程' : '設定連結、顏色或隱藏'
  edit.addEventListener('click', (e) => {
    e.preventDefault()
    openEditor(item)
  })

  wrap.append(main, edit)
  return wrap
}

function renderGrid() {
  const week = buildWeek(currentItems())
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

function renderLists() {
  const manual = state.schedule.manual || []
  $('#manual-section').hidden = manual.length === 0
  const list = $('#manual-list')
  list.replaceChildren()
  for (const item of manual) {
    const li = document.createElement('li')
    const text = document.createElement('span')
    text.textContent = `${item.title}　${describeSlots(item.slots) || '未設定時段'}`
    const edit = document.createElement('button')
    edit.type = 'button'
    edit.textContent = '編輯'
    edit.addEventListener('click', () => openEditor(item))
    li.append(text, edit)
    list.append(li)
  }

  const overrides = Object.entries(state.schedule.overrides || {})
  $('#override-section').hidden = overrides.length === 0
  const olist = $('#override-list')
  olist.replaceChildren()
  const titleOf = (cosId) => (syncedItems().find((i) => i.cosId === cosId) || {}).title || cosId
  for (const [cosId, o] of overrides) {
    const li = document.createElement('li')
    const bits = [o.hidden ? '已隱藏' : '', o.url ? '自訂連結' : '', o.color ? '自訂顏色' : ''].filter(Boolean)
    const text = document.createElement('span')
    text.textContent = `${cosId} ${titleOf(cosId)}　${bits.join('、')}`
    const reset = document.createElement('button')
    reset.type = 'button'
    reset.textContent = '還原'
    reset.addEventListener('click', async () => {
      const next = { ...state.schedule.overrides }
      delete next[cosId]
      state.schedule = { ...state.schedule, overrides: next }
      await save()
      render()
    })
    li.append(text, reset)
    olist.append(li)
  }
}

function render() {
  for (const btn of document.querySelectorAll('#source-tabs button')) {
    btn.setAttribute('aria-selected', String(btn.dataset.source === state.source))
  }
  const sources = state.schedule.sources || {}
  const parts = []
  for (const [name, label] of [['registered', '正式選課'], ['preregist', '預排課程']]) {
    const src = sources[name]
    if (src) parts.push(`${label} ${src.courses.length} 門 · ${formatTime(src.updatedAt)} 同步`)
  }
  $('#status').textContent = parts.join('　|　') || '尚未同步課表'
  renderGrid()
  renderLists()
}

// ---------- 編輯 ----------

function periodOptions(select, selected) {
  select.replaceChildren()
  for (const p of PERIODS) {
    const option = document.createElement('option')
    option.value = p.code
    option.textContent = `${p.label}　${p.start}`
    if (p.code === selected) option.selected = true
    select.append(option)
  }
}

function addSlotRow(slot) {
  const node = $('#slot-row-template').content.firstElementChild.cloneNode(true)
  const from = node.querySelector('.f-from')
  const to = node.querySelector('.f-to')
  periodOptions(from, slot ? slot.period : '3')
  periodOptions(to, slot ? slot.period : '4')
  if (slot) {
    node.querySelector('.f-day').value = String(slot.day)
    node.querySelector('.f-room').value = slot.room || ''
  }
  const mode = node.querySelector('.f-mode')
  const sync = () => {
    node.querySelector('.period-inputs').hidden = mode.value !== 'period'
    node.querySelector('.time-inputs').hidden = mode.value !== 'time'
  }
  mode.addEventListener('change', sync)
  sync()
  node.querySelector('.f-remove').addEventListener('click', () => {
    node.remove()
    if (!$('#slot-rows').children.length) addSlotRow()
  })
  $('#slot-rows').append(node)
  return node
}

function slotsFromForm() {
  const slots = []
  for (const row of document.querySelectorAll('.slot-row')) {
    const day = Number(row.querySelector('.f-day').value)
    const room = row.querySelector('.f-room').value.trim()
    if (row.querySelector('.f-mode').value === 'period') {
      slots.push(...slotsFromPeriodRange(day, row.querySelector('.f-from').value, row.querySelector('.f-to').value, room))
    } else {
      slots.push(...slotsFromTimeRange(day, row.querySelector('.f-start').value, row.querySelector('.f-end').value, room))
    }
  }
  return slots
}

function openEditor(item) {
  const isManual = !item || item.source === 'manual'
  state.editing = { mode: isManual ? 'manual' : 'override', item: item || null }
  $('#editor-title').textContent = !item ? '新增行程' : isManual ? '編輯行程' : `設定「${item.title}」`
  $('#manual-fields').hidden = !isManual
  $('#hidden-label').hidden = isManual
  $('#btn-delete').hidden = !(item && isManual)
  $('#editor-error').hidden = true

  const override = item && !isManual ? (state.schedule.overrides || {})[item.cosId] || {} : {}
  $('#f-title').value = isManual && item ? item.title : ''
  $('#f-url').value = isManual ? (item ? item.url : '') : override.url || ''
  const color = isManual ? (item ? item.color : '') : override.color || ''
  $('#f-color').value = color || (isManual ? '#16a34a' : '#1f6feb')
  $('#f-color').dataset.set = color ? 'yes' : ''
  $('#f-hidden').checked = Boolean(override.hidden)

  $('#slot-rows').replaceChildren()
  if (isManual) {
    const slots = (item && item.slots) || []
    const byDay = new Map()
    for (const s of slots) {
      if (!byDay.has(s.day)) byDay.set(s.day, [])
      byDay.get(s.day).push(s)
    }
    if (!byDay.size) addSlotRow()
    for (const [day, list] of byDay) {
      const node = addSlotRow({ day, period: list[0].period, room: list[0].room })
      node.querySelector('.f-to').value = list[list.length - 1].period
    }
  }
  $('#editor').showModal()
}

async function saveEditor() {
  const { mode, item } = state.editing || {}
  const url = $('#f-url').value.trim()
  const color = $('#f-color').dataset.set ? $('#f-color').value : ''

  if (mode === 'manual') {
    const title = $('#f-title').value.trim()
    const slots = slotsFromForm()
    if (!title) return showEditorError('請填名稱。')
    if (!slots.length) return showEditorError('時段不正確，請確認星期與時間。')
    const id = item ? item.key.replace(/^manual:/, '') : `m${Date.now().toString(36)}`
    const next = manualItem({ id, title, slots, url, color })
    const manual = [...(state.schedule.manual || [])]
    const at = manual.findIndex((m) => m.key === next.key)
    if (at >= 0) manual[at] = next
    else manual.push(next)
    state.schedule = { ...state.schedule, manual }
  } else {
    const overrides = { ...(state.schedule.overrides || {}) }
    const entry = {}
    if (url) entry.url = url
    if (color) entry.color = color
    if ($('#f-hidden').checked) entry.hidden = true
    if (Object.keys(entry).length) overrides[item.cosId] = entry
    else delete overrides[item.cosId]
    state.schedule = { ...state.schedule, overrides }
  }
  await save()
  $('#editor').close()
  render()
}

function showEditorError(text) {
  const el = $('#editor-error')
  el.textContent = text
  el.hidden = false
}

async function deleteManual() {
  const { item } = state.editing || {}
  if (!item) return
  state.schedule = { ...state.schedule, manual: (state.schedule.manual || []).filter((m) => m.key !== item.key) }
  await save()
  $('#editor').close()
  render()
}

// ---------- 同步 ----------

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
    if (!tab) return showMessage('找不到選課網分頁。請先開啟並登入選課網，再按一次同步。', 'error')
    let reply
    try {
      reply = await chrome.tabs.sendMessage(tab.id, { type: 'courses' })
    } catch {
      return showMessage('選課網分頁沒有回應，請重新整理該分頁後再試。', 'error')
    }
    if (!reply || !reply.ok) {
      return showMessage(
        reply && reply.reason === 'not_logged_in' ? '請先登入選課網。' : `同步失敗：${(reply && reply.detail) || '未知錯誤'}`,
        'error',
      )
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
    await save()
    render()
    showMessage(`同步完成：正式 ${sources.registered.courses.length} 門、預排 ${sources.preregist.courses.length} 門`)
  } finally {
    btn.disabled = false
  }
}

// ---------- 初始化 ----------

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
  $('#btn-add').addEventListener('click', () => openEditor(null))
  $('#btn-add-slot').addEventListener('click', () => addSlotRow())
  $('#btn-save').addEventListener('click', saveEditor)
  $('#btn-cancel').addEventListener('click', () => $('#editor').close())
  $('#btn-delete').addEventListener('click', deleteManual)
  $('#f-color').addEventListener('input', () => { $('#f-color').dataset.set = 'yes' })
  $('#btn-clear-color').addEventListener('click', () => { $('#f-color').dataset.set = '' })
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
