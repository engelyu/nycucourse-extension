import { parseIds, findInvalidTokens } from './lib/parse.js'
import { searchCourses } from './lib/search.js'

const COS_ORIGIN = 'https://cos.nycu.edu.tw/'
const EMULATOR_URL = 'https://cos.nycu.edu.tw/#/emulator'
const STALE_MS = 5 * 60 * 1000

const $ = (sel) => document.querySelector(sel)

const state = {
  tab: null,
  onCos: false,
  cosReady: false,
  courses: [],
  // id -> 'pending' | {status: 'added'|'exists'|'error', msg}
  addStatus: new Map(),
}

// ---------- 共用 ----------

function code(text) {
  const el = document.createElement('code')
  el.textContent = text
  return el
}

function send(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message)
}

function showHint(el, text, isError = false) {
  el.textContent = text
  el.classList.toggle('error', isError)
  el.hidden = !text
}

function formatTime(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- 分頁狀態 ----------

async function detectTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  state.tab = tab || null
  state.onCos = Boolean(tab && tab.url && tab.url.startsWith(COS_ORIGIN))
  state.cosReady = false
  if (state.onCos) {
    try {
      await send(tab.id, { type: 'ping' })
      state.cosReady = true
    } catch {
      state.cosReady = false
    }
  }
  renderTabBar()
}

function renderTabBar(needsReload = false) {
  const status = $('#tab-status')
  const btnOpen = $('#btn-open')
  const btnReload = $('#btn-reload')
  btnOpen.hidden = true
  btnReload.hidden = true
  if (!state.onCos) {
    status.textContent = '切到選課網分頁才能加入預排'
    btnOpen.hidden = false
  } else if (!state.cosReady) {
    status.textContent = '請重新整理選課網分頁後再開啟'
  } else if (needsReload) {
    status.textContent = '已加入，重新整理選課網以查看'
    btnReload.hidden = false
  } else {
    status.textContent = ''
  }
  $('#tab-bar').hidden = !status.textContent
}

// ---------- 課程資料 ----------

function renderData(courseData, crawlState) {
  const statusEl = $('#data-status')
  const btn = $('#btn-crawl')
  const errEl = $('#crawl-error')
  const isRunning = Boolean(crawlState && crawlState.status === 'running')
  const running = isRunning && Date.now() - crawlState.startedAt < STALE_MS

  if (running) {
    btn.disabled = true
    statusEl.textContent = crawlState.phase === 'courses' && crawlState.total
      ? `抓取中 ${crawlState.done}/${crawlState.total}`
      : `讀取系所清單…${crawlState.done ? ` ${crawlState.done}` : ''}`
  } else {
    btn.disabled = false
    if (courseData && courseData.courses && courseData.courses.length) {
      statusEl.textContent = `${courseData.semester} 學期 · ${courseData.courses.length} 門 · ${formatTime(courseData.updatedAt)} 更新`
    } else {
      statusEl.textContent = '尚未下載課程資料，請按右側更新'
    }
  }

  if (crawlState && crawlState.status === 'error') {
    showHint(errEl, `更新失敗：${crawlState.error || '未知錯誤'}`, true)
  } else if (isRunning && !running) {
    showHint(errEl, '上次更新中斷，請重新按更新。', true)
  } else {
    showHint(errEl, '')
  }

  const courses = (courseData && courseData.courses) || []
  if (courses.length !== state.courses.length || (courseData && courseData.updatedAt) !== state.updatedAt) {
    state.courses = courses
    state.updatedAt = courseData && courseData.updatedAt
    $('#q').disabled = courses.length === 0
    renderSearch()
  }
}

async function loadData() {
  const { courseData, crawlState } = await chrome.storage.local.get(['courseData', 'crawlState'])
  renderData(courseData, crawlState)
}

// ---------- 搜尋 ----------

function stateLabel(s) {
  const el = document.createElement('span')
  el.className = 'state'
  if (s === 'pending') {
    el.textContent = '加入中…'
  } else if (s.status === 'added') {
    el.textContent = '已加入'
    el.classList.add('ok')
  } else if (s.status === 'exists') {
    el.textContent = '已在預排'
    el.classList.add('ok')
  } else {
    el.textContent = s.msg || '失敗'
    el.classList.add('error')
  }
  return el
}

function addButton(id, label) {
  const btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.disabled = !state.cosReady
  btn.addEventListener('click', () => addSingle(id))
  return btn
}

function courseRow(course) {
  const li = document.createElement('li')

  const info = document.createElement('div')
  info.className = 'info'
  const title = document.createElement('div')
  title.className = 'title'
  title.append(code(course.id), course.name)
  title.title = `${course.id} ${course.name}`
  const meta = document.createElement('div')
  meta.className = 'meta'
  const credit = course.credit ? `${Number(course.credit)} 學分` : ''
  meta.textContent = [course.teacher, course.time, credit, course.dep].filter(Boolean).join(' · ')
  meta.title = meta.textContent
  info.append(title, meta)

  const actions = document.createElement('div')
  actions.className = 'actions'
  const s = state.addStatus.get(course.id)
  if (!s) {
    actions.append(addButton(course.id, '加入'))
  } else if (s !== 'pending' && s.status === 'error') {
    actions.append(stateLabel(s), addButton(course.id, '重試'))
  } else {
    actions.append(stateLabel(s))
  }

  li.append(info, actions)
  return li
}

function renderSearch() {
  const q = $('#q').value
  const list = $('#search-results')
  const summary = $('#search-summary')
  list.replaceChildren()
  if (!q.trim()) {
    showHint(summary, '')
    return
  }
  const { total, items } = searchCourses(state.courses, q, 50)
  showHint(summary, total === 0
    ? '找不到符合的課程'
    : total > items.length ? `共 ${total} 筆，顯示前 ${items.length} 筆` : `共 ${total} 筆`)
  list.append(...items.map(courseRow))
}

async function addSingle(id) {
  if (!state.cosReady || !state.tab) return
  state.addStatus.set(id, 'pending')
  renderSearch()
  let reply
  try {
    reply = await send(state.tab.id, { type: 'import', ids: [id] })
  } catch {
    reply = { ok: false, reason: 'network', detail: '無法連到選課網頁面' }
  }
  if (reply && reply.ok && reply.results && reply.results[0]) {
    state.addStatus.set(id, reply.results[0])
    if (reply.results[0].status === 'added') renderTabBar(true)
  } else if (reply && reply.reason === 'not_logged_in') {
    state.addStatus.set(id, { status: 'error', msg: '請先登入選課網' })
  } else {
    state.addStatus.set(id, { status: 'error', msg: (reply && reply.detail) || '未知錯誤' })
  }
  renderSearch()
}

// ---------- 批次貼上 ----------

function fillGroup(key, items, render) {
  const group = $(`#group-${key}`)
  const ul = group.querySelector('ul')
  ul.replaceChildren()
  for (const item of items) {
    const li = document.createElement('li')
    li.append(...render(item))
    ul.append(li)
  }
  group.hidden = items.length === 0
}

function renderBulkResults(list, invalid) {
  const by = (status) => list.filter((r) => r.status === status)
  fillGroup('added', by('added'), (r) => [code(r.id)])
  fillGroup('exists', by('exists'), (r) => [code(r.id)])
  fillGroup('error', by('error'), (r) => [code(r.id), ` ${r.msg}`])
  fillGroup('invalid', invalid, (t) => [code(t)])
  $('#results').hidden = false
}

async function onBulkImport() {
  const hint = $('#hint')
  const btn = $('#btn-import')
  const text = $('#ids').value
  const ids = parseIds(text)
  const invalid = findInvalidTokens(text)
  $('#results').hidden = true
  if (!state.cosReady) {
    showHint(hint, '請先切到已登入的選課網分頁。', true)
    return
  }
  if (ids.length === 0) {
    showHint(hint, '沒有可用的課號。課號是六位數字，例如 516702。', true)
    return
  }
  btn.disabled = true
  showHint(hint, `正在加入 ${ids.length} 門課…`)
  let reply
  try {
    reply = await send(state.tab.id, { type: 'import', ids })
  } catch {
    showHint(hint, '無法連到選課網頁面，請重新整理該分頁後再試。', true)
    btn.disabled = false
    return
  }
  btn.disabled = false
  if (!reply || !reply.ok) {
    if (reply && reply.reason === 'not_logged_in') showHint(hint, '請先登入選課網。', true)
    else showHint(hint, `選課網回應失敗：${(reply && reply.detail) || '未知錯誤'}`, true)
    return
  }
  showHint(hint, '完成，選課網頁面已重新整理。')
  renderBulkResults(reply.results, invalid)
  for (const r of reply.results) state.addStatus.set(r.id, r)
  renderSearch()
  try { await send(state.tab.id, { type: 'reload' }) } catch {}
}

// ---------- 初始化 ----------

async function init() {
  $('#btn-open').addEventListener('click', () => chrome.tabs.create({ url: EMULATOR_URL }))
  $('#btn-reload').addEventListener('click', async () => {
    if (!state.tab) return
    try { await send(state.tab.id, { type: 'reload' }) } catch {}
    renderTabBar(false)
  })
  $('#btn-crawl').addEventListener('click', async () => {
    $('#btn-crawl').disabled = true
    try {
      await chrome.runtime.sendMessage({ type: 'crawl:start' })
    } catch (err) {
      showHint($('#crawl-error'), `無法啟動更新：${err && err.message ? err.message : err}`, true)
      $('#btn-crawl').disabled = false
    }
  })
  $('#q').addEventListener('input', renderSearch)
  $('#btn-import').addEventListener('click', onBulkImport)

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.courseData || changes.crawlState)) loadData()
  })

  await Promise.all([detectTab(), loadData()])
  renderSearch()
  $('#q').focus()
}

init()
