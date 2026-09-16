import { parseIds, findInvalidTokens, semesterOfIds } from './lib/parse.js'
import { searchCourses } from './lib/search.js'
import { describeCrawl } from './lib/crawlState.js'
import { formatSeats } from './lib/seats.js'
import { courseOutlineUrl } from './lib/links.js'

const COS_ORIGIN = 'https://cos.nycu.edu.tw/'
const EMULATOR_URL = 'https://cos.nycu.edu.tw/#/emulator'

const $ = (sel) => document.querySelector(sel)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const state = {
  tab: null,
  onCos: false,
  cosReady: false,
  connecting: false, // 正在等選課網頁面的 content script 回應
  reloading: false, // 正在重新整理選課網
  needsReload: false, // 有新加入的課，提示重新整理
  cosSemester: null, // 選課網目前學期
  sysStatus: null, // 選課網系統公告（例如非選課時段）
  courseData: undefined,
  crawlState: undefined,
  courses: [],
  updatedAt: undefined,
  startError: '', // 「無法啟動更新」的錯誤，保留到下次按更新
  // id -> 'pending' | {status: 'added'|'exists'|'error', msg}
  addStatus: new Map(),
}

// ---------- 共用 ----------

function code(text) {
  const el = document.createElement('code')
  el.textContent = text
  return el
}

// kind：'error'、'warn'，或 true（等同 'error'）
function showHint(el, text, kind = '') {
  const k = kind === true ? 'error' : kind || ''
  el.textContent = text
  el.classList.toggle('error', k === 'error')
  el.classList.toggle('warn', k === 'warn')
  el.hidden = !text
}

function formatTime(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- 與選課網分頁溝通 ----------

async function ping(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'ping' })
    return Boolean(reply && reply.ok)
  } catch {
    return false
  }
}

async function waitForContentScript(tabId, timeoutMs) {
  const until = Date.now() + timeoutMs
  do {
    if (await ping(tabId)) return true
    await sleep(300)
  } while (Date.now() < until)
  return false
}

// 送訊息到選課網分頁；頁面剛重新整理、content script 還沒載入時，等它就緒再送一次。
async function send(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    if (!(await waitForContentScript(tabId, 5000))) throw err
    return chrome.tabs.sendMessage(tabId, message)
  }
}

// 等分頁重新載入完成（先看到 loading 再看到 complete）。
function waitForTabReload(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let sawLoading = false
    const finish = (value) => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve(value)
    }
    const listener = (id, info) => {
      if (id !== tabId) return
      if (info.status === 'loading') sawLoading = true
      if (info.status === 'complete' && sawLoading) finish(true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    chrome.tabs.onUpdated.addListener(listener)
  })
}

// 重新整理選課網，等頁面載入且 content script 就緒才回傳。
async function reloadCos() {
  if (!state.tab) return false
  const tabId = state.tab.id
  state.reloading = true
  state.cosReady = false
  state.needsReload = false
  renderTabBar()
  renderSearch()
  const reloaded = waitForTabReload(tabId, 15000)
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'reload' })
  } catch {}
  await reloaded
  state.cosReady = await waitForContentScript(tabId, 5000)
  state.reloading = false
  renderTabBar()
  renderSearch()
  if (state.cosReady) {
    refreshCosSemester()
    refreshSysStatus()
  }
  return state.cosReady
}

// ---------- 分頁狀態 ----------

async function detectTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  state.tab = tab || null
  state.onCos = Boolean(tab && tab.url && tab.url.startsWith(COS_ORIGIN))
  state.cosReady = false
  if (!state.onCos) {
    renderTabBar()
    return
  }
  state.connecting = true
  renderTabBar()
  // 頁面可能剛重新整理，content script 還在載入，稍等一下
  state.cosReady = await waitForContentScript(tab.id, 3000)
  state.connecting = false
  renderTabBar()
  renderSearch()
  if (state.cosReady) {
    refreshCosSemester()
    refreshSysStatus()
  }
}

function renderTabBar() {
  const status = $('#tab-status')
  const btnOpen = $('#btn-open')
  const btnReload = $('#btn-reload')
  btnOpen.hidden = true
  btnReload.hidden = true
  if (!state.onCos) {
    status.textContent = '切到選課網分頁才能加入預排'
    btnOpen.hidden = false
  } else if (state.connecting) {
    status.textContent = '正在連線選課網頁面…'
  } else if (state.reloading) {
    status.textContent = '選課網重新整理中，完成後就能繼續加入…'
  } else if (!state.cosReady) {
    status.textContent = '請重新整理選課網分頁後再開啟'
  } else if (state.needsReload) {
    status.textContent = '已加入，重新整理選課網以查看'
    btnReload.hidden = false
  } else {
    status.textContent = ''
  }
  $('#tab-bar').hidden = !status.textContent
}

async function refreshCosSemester() {
  if (!state.tab || !state.cosReady) return
  try {
    const reply = await chrome.tabs.sendMessage(state.tab.id, { type: 'semester' })
    state.cosSemester = reply && reply.semester ? reply.semester : null
  } catch {
    state.cosSemester = null
  }
  renderSemesterWarning()
}

// 讀選課網的系統狀態；有公告就顯示，例如非選課時段或系統維護。
async function refreshSysStatus() {
  if (!state.tab || !state.cosReady) return
  try {
    const reply = await chrome.tabs.sendMessage(state.tab.id, { type: 'sysstatus' })
    state.sysStatus = reply && reply.status ? reply.status : null
  } catch {
    state.sysStatus = null
  }
  renderSysStatus()
}

function renderSysStatus() {
  const s = state.sysStatus
  showHint($('#sys-status'), s && s.message ? `選課網公告：${s.message}` : '', 'warn')
}

// 課程資料學期與選課網學期不同時提醒：課號在不同學期可能對應不同課程。
function renderSemesterWarning() {
  const dataSemester = state.courseData && state.courseData.semester
  const show = Boolean(state.cosSemester && dataSemester && state.cosSemester !== dataSemester)
  showHint(
    $('#semester-warning'),
    show
      ? `注意：課程資料是 ${dataSemester} 學期，選課網目前是 ${state.cosSemester} 學期。課號在不同學期可能對應不同課程，請先更新課程資料。`
      : '',
    'warn',
  )
}

// ---------- 課程資料 ----------

// 顯示更新進度區塊；回傳是否正在更新。
function renderProgress(crawlState) {
  const d = describeCrawl(crawlState, Date.now())
  $('#crawl-progress').hidden = !d
  if (!d) return false
  $('#crawl-title').textContent = d.title
  $('#crawl-elapsed').textContent = d.elapsed
  $('#crawl-detail').textContent = d.detail
  $('#crawl-percent').textContent = d.percent == null ? '' : `${d.percent}%`
  $('#crawl-track').classList.toggle('indeterminate', d.percent == null)
  $('#crawl-bar').style.width = d.percent == null ? '' : `${d.percent}%`
  const hint = $('#crawl-hint')
  hint.textContent = d.hint
  hint.classList.toggle('slow', d.slow)
  return true
}

function renderData(courseData, crawlState) {
  const statusEl = $('#data-status')
  const btn = $('#btn-crawl')
  const errEl = $('#crawl-error')
  const q = $('#q')
  const isRunning = Boolean(crawlState && crawlState.status === 'running')
  const running = renderProgress(crawlState)
  const hasData = Boolean(courseData && courseData.courses && courseData.courses.length)

  btn.disabled = running
  btn.textContent = running ? '更新中…' : '更新課程資料'
  if (hasData) {
    statusEl.textContent = `${courseData.semester} 學期 · ${courseData.courses.length} 門 · ${formatTime(courseData.updatedAt)} 更新`
  } else {
    statusEl.textContent = running ? '尚未有課程資料' : '尚未下載課程資料，請按右側更新'
  }

  if (crawlState && crawlState.status === 'error') {
    showHint(errEl, `更新失敗：${crawlState.error || '未知錯誤'}${hasData ? '（已保留原本的課程資料）' : ''}`, 'error')
  } else if (isRunning && !running) {
    showHint(errEl, '上次更新中斷，請重新按更新。', 'error')
  } else if (crawlState && crawlState.status === 'done' && crawlState.failed > 0 && !running) {
    showHint(errEl, `有 ${crawlState.failed} 個系所沒抓到，課程可能不完整，稍後可以再更新一次。`, 'warn')
  } else if (state.startError && !running) {
    showHint(errEl, state.startError, 'error')
  } else {
    showHint(errEl, '')
  }

  q.placeholder = hasData
    ? '課名、老師或課號'
    : running ? '課程資料下載中，完成後就能搜尋' : '請先按上方「更新課程資料」'

  renderSemesterWarning()

  const courses = hasData ? courseData.courses : []
  if (courses.length !== state.courses.length || (courseData && courseData.updatedAt) !== state.updatedAt) {
    state.courses = courses
    state.updatedAt = courseData && courseData.updatedAt
    q.disabled = courses.length === 0
    renderSearch()
  }
}

async function loadData() {
  const { courseData, crawlState } = await chrome.storage.local.get(['courseData', 'crawlState'])
  state.courseData = courseData
  state.crawlState = crawlState
  renderData(courseData, crawlState)
}

async function startCrawl() {
  // 先在畫面上顯示進度，不必等背景程式醒來寫入第一筆狀態
  const previous = state.crawlState
  const now = Date.now()
  state.startError = ''
  state.crawlState = { status: 'running', phase: 'tree', done: 0, total: 0, startedAt: now, lastProgressAt: now }
  renderData(state.courseData, state.crawlState)
  try {
    await chrome.runtime.sendMessage({ type: 'crawl:start' })
  } catch (err) {
    state.crawlState = previous
    state.startError = `無法啟動更新：${err && err.message ? err.message : err}`
    renderData(state.courseData, state.crawlState)
  }
}

// ---------- 搜尋 ----------

function stateLabel(s) {
  const el = document.createElement('span')
  el.className = 'state'
  if (s === 'pending') {
    el.textContent = '加入中…'
  } else if (s.status === 'added') {
    // 有訊息代表已送出但無法確認
    el.textContent = s.msg || '已加入'
    el.classList.add(s.msg ? 'warn' : 'ok')
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
  // 課名可以點開課程時間表的課程大綱
  const url = courseOutlineUrl(state.courseData && state.courseData.semester, course.id)
  const title = document.createElement(url ? 'a' : 'div')
  title.className = 'title'
  if (url) {
    title.href = url
    title.target = '_blank'
    title.rel = 'noreferrer'
  }
  title.append(code(course.id), course.name)
  title.title = url ? `${course.id} ${course.name}（開啟課程大綱）` : `${course.id} ${course.name}`
  const meta = document.createElement('div')
  meta.className = 'meta'
  const credit = course.credit ? `${Number(course.credit)} 學分` : ''
  const time = course.time.replace(/-(?=,|$)/g, '')
  const seats = formatSeats(course)
  meta.textContent = [course.teacher, time, credit, seats, course.dep].filter(Boolean).join(' · ')
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
    reply = { ok: false, reason: 'network', detail: '無法連到選課網頁面，請重新整理選課網分頁' }
  }
  if (reply && reply.ok && reply.results && reply.results[0]) {
    state.addStatus.set(id, reply.results[0])
    if (reply.results[0].status === 'added') {
      state.needsReload = true
      renderTabBar()
    }
  } else if (reply && reply.reason === 'not_logged_in') {
    state.addStatus.set(id, { status: 'error', msg: '請先登入選課網' })
  } else {
    state.addStatus.set(id, { status: 'error', msg: (reply && reply.detail) || '未知錯誤' })
  }
  renderSearch()
  // 加不進去時可能是選課網公告的停機時段，重新讀一次狀態讓使用者知道原因
  const result = state.addStatus.get(id)
  if (!result || result === 'pending' || result.status === 'error' || result.msg) refreshSysStatus()
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
  fillGroup('added', by('added'), (r) => [code(r.id), r.msg ? ` ${r.msg}` : ''])
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
  const prefix = semesterOfIds(text)
  $('#results').hidden = true
  if (!state.cosReady) {
    showHint(hint, '請先切到已登入的選課網分頁。', 'error')
    return
  }
  if (ids.length === 0) {
    showHint(hint, '沒有可用的課號。課號是六位數字，例如 516702。', 'error')
    return
  }
  btn.disabled = true
  showHint(hint, `正在加入 ${ids.length} 門課…`)
  let reply
  try {
    reply = await send(state.tab.id, { type: 'import', ids })
  } catch {
    showHint(hint, '無法連到選課網頁面，請重新整理該分頁後再試。', 'error')
    btn.disabled = false
    return
  }
  if (!reply || !reply.ok) {
    if (reply && reply.reason === 'not_logged_in') showHint(hint, '請先登入選課網。', 'error')
    else showHint(hint, `選課網回應失敗：${(reply && reply.detail) || '未知錯誤'}`, 'error')
    btn.disabled = false
    return
  }

  renderBulkResults(reply.results, invalid)
  for (const r of reply.results) state.addStatus.set(r.id, r)
  renderSearch()
  if (reply.warning || reply.results.some((r) => r.status === 'error')) refreshSysStatus()

  const notes = []
  if (prefix.mixed) {
    notes.push('注意：貼上的課號前綴包含不同學期，請確認是否加錯課。')
  } else if (prefix.semester && state.cosSemester && prefix.semester !== state.cosSemester) {
    notes.push(`注意：課號前綴是 ${prefix.semester} 學期，選課網目前是 ${state.cosSemester} 學期，請確認是否加錯課。`)
  }
  if (reply.warning) notes.push(`${reply.warning}。`)
  const lead = notes.join(' ')
  const kind = notes.length ? 'warn' : ''

  if (!reply.results.some((r) => r.status === 'added')) {
    showHint(hint, [lead, '完成。'].filter(Boolean).join(' '), kind)
    btn.disabled = false
    return
  }
  // 提示要等頁面真的重新整理完成才顯示「已重新整理」
  showHint(hint, [lead, '完成，正在重新整理選課網…'].filter(Boolean).join(' '), kind)
  const ok = await reloadCos()
  showHint(
    hint,
    [lead, ok ? '完成，選課網已重新整理。' : '完成。選課網重新整理後沒有回應，請手動重新整理。'].filter(Boolean).join(' '),
    ok ? kind : 'warn',
  )
  btn.disabled = false
}

// ---------- 初始化 ----------

async function init() {
  $('#btn-open').addEventListener('click', () => chrome.tabs.create({ url: EMULATOR_URL }))
  $('#btn-reload').addEventListener('click', () => reloadCos())
  $('#btn-crawl').addEventListener('click', startCrawl)
  $('#q').addEventListener('input', renderSearch)
  $('#btn-import').addEventListener('click', onBulkImport)

  // 直接用事件帶來的新值，更新進度時不必重新讀取整份課程資料
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.courseData || changes.crawlState)) return
    if (changes.courseData) state.courseData = changes.courseData.newValue
    if (changes.crawlState) state.crawlState = changes.crawlState.newValue
    renderData(state.courseData, state.crawlState)
  })
  // 每秒重畫：更新經過時間、在沒有新事件時切換「網站較慢」與「中斷」提示
  setInterval(() => renderData(state.courseData, state.crawlState), 1000)

  await Promise.all([detectTab(), loadData()])
  renderSearch()
  $('#q').focus()
}

init()
