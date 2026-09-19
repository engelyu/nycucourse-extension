import { parseIds, findInvalidTokens, semesterOfIds } from './lib/parse.js'
import { searchCourses } from './lib/search.js'
import { describeCrawl } from './lib/crawlState.js'
import { formatSeats } from './lib/seats.js'
import { courseOutlineUrl } from './lib/links.js'
import { parseDeptCounts, menusToFetch, mergeCounts, countsFresh } from './lib/counts.js'
import { parseRegStatus, sysStatusNotice } from './lib/regstatus.js'
import { findAttributionOptions, preregParams, defaultOption, needsChoice, courseDepUids } from './lib/attribution.js'

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
  sysStatus: null, // 選課網負載狀態（sysstatuslvl）
  regStatus: null, // 選課系統是否開放（checkreg）
  counts: {}, // dep_uid -> { at, counts }：即時選課人數的快取
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

// 讀選課系統是否暫停（checkreg）與負載狀態（sysstatuslvl）。
// 暫停訊息由伺服器提供，例如「分發時間 10:00～12:00 暫停使用選課系統」。
async function refreshSysStatus() {
  if (!state.tab || !state.cosReady) return
  try {
    const [reg, sys] = await Promise.all([
      chrome.tabs.sendMessage(state.tab.id, { type: 'regstatus' }),
      chrome.tabs.sendMessage(state.tab.id, { type: 'sysstatus' }),
    ])
    state.regStatus = parseRegStatus(reg && reg.json)
    state.sysStatus = sys && sys.status ? sys.status : null
  } catch {
    state.regStatus = null
    state.sysStatus = null
  }
  renderSysStatus()
}

function renderSysStatus() {
  const closed = state.regStatus && !state.regStatus.open
  if (closed) {
    showHint($('#sys-status'), `選課系統暫停中：${state.regStatus.message}`, 'error')
    return
  }
  const notice = sysStatusNotice(state.sysStatus)
  showHint($('#sys-status'), notice ? `選課網狀態：${notice}` : '', 'warn')
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
  } else if (s.status === 'choose') {
    el.textContent = '選擇採計方式'
    el.classList.add('warn')
  } else if (s.status === 'added') {
    // 有訊息代表已送出但無法確認
    el.textContent = s.msg || (s.note ? `已加入・${s.note}` : '已加入')
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
  const before = [course.teacher, time, credit].filter(Boolean).join(' · ')
  const after = course.dep ? ` · ${course.dep}` : ''
  meta.replaceChildren(document.createTextNode(before))
  if (seats) {
    meta.append(document.createTextNode(' · '))
    const span = document.createElement('span')
    if (course.live) span.className = 'live'
    span.textContent = seats
    meta.append(span)
  }
  meta.append(document.createTextNode(after))
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
  if (s && s.status === 'choose') li.append(choiceRow(course.id, s.options))

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
  const { total, items: found } = searchCourses(state.courses, q, 50)
  const items = mergeCounts(found, flatCounts())
  $('#btn-counts').hidden = items.length === 0
  $('#btn-counts').disabled = !state.cosReady
  $('#btn-counts').title = state.cosReady ? '向選課網查目前的選課人數' : '要在選課網分頁才能查人數'
  showHint(summary, total === 0
    ? '找不到符合的課程'
    : total > items.length ? `共 ${total} 筆，顯示前 ${items.length} 筆` : `共 ${total} 筆`)
  list.append(...items.map(courseRow))
}

// 把各系所的人數快取攤平成「課號 -> 人數」
function flatCounts() {
  const out = {}
  for (const entry of Object.values(state.counts || {})) {
    if (!countsFresh(entry)) continue
    Object.assign(out, entry.counts)
  }
  return out
}

async function loadCounts() {
  const { deptCounts } = await chrome.storage.session.get('deptCounts')
  state.counts = deptCounts || {}
}

// 查目前選課人數：以系所為單位查，同一個系所五分鐘內只查一次
async function fetchCounts() {
  const btn = $('#btn-counts')
  if (!state.cosReady || !state.tab) return
  const q = $('#q').value
  const { items } = searchCourses(state.courses, q, 50)
  const menus = menusToFetch(items, state.counts, 8)
  if (!menus.length) {
    showHint($('#search-summary'), '人數已是最新的（五分鐘內查過）', 'warn')
    return
  }
  btn.disabled = true
  btn.textContent = '查詢中…'
  try {
    const reply = await send(state.tab.id, { type: 'deptcounts', menus })
    if (!reply || !reply.ok) {
      showHint($('#search-summary'), reply && reply.reason === 'not_logged_in' ? `${await unavailableMessage()}。` : '查人數失敗，請稍後再試。', 'error')
      return
    }
    const now = Date.now()
    const next = { ...state.counts }
    for (const [uid, list] of Object.entries(reply.lists || {})) {
      next[uid] = { at: now, counts: parseDeptCounts(list) }
    }
    state.counts = next
    await chrome.storage.session.set({ deptCounts: next })
    renderSearch()
  } catch {
    showHint($('#search-summary'), '無法連到選課網頁面，請重新整理該分頁。', 'error')
  } finally {
    btn.disabled = !state.cosReady
    btn.textContent = '查人數'
  }
}

// 選課網回空內容時，可能是登入過期，也可能是分發時段暫停；先查清楚再說
async function unavailableMessage() {
  await refreshSysStatus()
  if (state.regStatus && !state.regStatus.open) return `選課系統暫停中：${state.regStatus.message}`
  return '請先登入選課網'
}

// 同一門課在選課網可能有多種採計方式（例如選修或核心），加入預排時就決定了
let depTreePromise = null
function getDepTree() {
  if (!depTreePromise) {
    depTreePromise = send(state.tab.id, { type: 'deptree' }).then((reply) => {
      if (reply && reply.ok) return reply.tree
      depTreePromise = null
      if (reply && reply.reason === 'not_logged_in') throw Object.assign(new Error('not_logged_in'), { reason: 'not_logged_in' })
      return null
    })
  }
  return depTreePromise
}

async function getCourseList(menu) {
  const reply = await send(state.tab.id, { type: 'courselist', menu })
  if (reply && reply.ok) return reply.list
  if (reply && reply.reason === 'not_logged_in') throw Object.assign(new Error('not_logged_in'), { reason: 'not_logged_in' })
  throw new Error((reply && reply.detail) || '選課網沒有回應')
}

// 查不到（例如課程資料太舊）時回傳空陣列，照舊方式加入
async function optionsFor(id) {
  const course = state.courses.find((c) => c.id === id)
  return findAttributionOptions({
    cosId: id,
    courseName: course ? course.name : '',
    depUids: courseDepUids(course),
    getTree: getDepTree,
    getList: getCourseList,
  })
}

function choiceRow(id, options) {
  const box = document.createElement('div')
  box.className = 'choices'
  const lead = document.createElement('span')
  // 只找到核心等其他選單時，提醒使用者開課系所那一種沒找到，不要默默當成核心加入
  lead.textContent = options.length === 1 ? '在開課系所找不到這門課，只找到：' : '這門課可以算：'
  box.append(lead)
  for (const option of options) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.textContent = option.label
    btn.title = `以「${option.label}」加入預排，正式登記時會照這個類別`
    btn.addEventListener('click', () => submitSingle(id, option))
    box.append(btn)
  }
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.className = 'link'
  cancel.textContent = '取消'
  cancel.addEventListener('click', () => {
    state.addStatus.delete(id)
    renderSearch()
  })
  box.append(cancel)
  return box
}

async function addSingle(id) {
  if (!state.cosReady || !state.tab) return
  state.addStatus.set(id, 'pending')
  renderSearch()
  let options
  try {
    options = await optionsFor(id)
  } catch (err) {
    if (err && err.reason === 'not_logged_in') {
      state.addStatus.set(id, { status: 'error', msg: await unavailableMessage() })
      renderSearch()
      return
    }
    options = []
  }
  if (needsChoice(options)) {
    state.addStatus.set(id, { status: 'choose', options })
    renderSearch()
    return
  }
  return submitSingle(id, options[0] || null)
}

async function submitSingle(id, option) {
  if (!state.cosReady || !state.tab) return
  state.addStatus.set(id, 'pending')
  renderSearch()
  const params = option ? { [id]: preregParams(id, option) } : {}
  let reply
  try {
    reply = await send(state.tab.id, { type: 'import', ids: [id], params })
  } catch {
    reply = { ok: false, reason: 'network', detail: '無法連到選課網頁面，請重新整理選課網分頁' }
  }
  if (reply && reply.ok && reply.results && reply.results[0]) {
    state.addStatus.set(id, { ...reply.results[0], note: option ? option.label : '' })
    if (reply.results[0].status === 'added') {
      state.needsReload = true
      renderTabBar()
    }
  } else if (reply && reply.reason === 'not_logged_in') {
    state.addStatus.set(id, { status: 'error', msg: await unavailableMessage() })
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
  fillGroup('added', by('added'), (r) => [code(r.id), r.msg ? ` ${r.msg}` : r.note ? ` ${r.note}` : ''])
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
  // 先查每門課的採計方式；有多種時用一般採計，並在結果列出其他可能
  const params = {}
  const optionNotes = {}
  try {
    for (let i = 0; i < ids.length; i++) {
      showHint(hint, `正在確認採計方式（${i + 1}/${ids.length}）…`)
      const options = await optionsFor(ids[i])
      const chosen = defaultOption(options)
      if (!chosen) continue
      params[ids[i]] = preregParams(ids[i], chosen)
      const others = options.filter((o) => o !== chosen).map((o) => o.label)
      optionNotes[ids[i]] = others.length
        ? `以「${chosen.label}」加入；也可算${others.map((l) => `「${l}」`).join('、')}，要改請在搜尋結果單筆加入或到選課頁變更`
        : chosen.source === 'home'
          ? chosen.label
          : `在開課系所找不到，以「${chosen.label}」加入，請到選課頁確認`
    }
  } catch (err) {
    if (err && err.reason === 'not_logged_in') {
      showHint(hint, `${await unavailableMessage()}。`, 'error')
      btn.disabled = false
      return
    }
  }
  showHint(hint, `正在加入 ${ids.length} 門課…`)
  let reply
  try {
    reply = await send(state.tab.id, { type: 'import', ids, params })
  } catch {
    showHint(hint, '無法連到選課網頁面，請重新整理該分頁後再試。', 'error')
    btn.disabled = false
    return
  }
  if (!reply || !reply.ok) {
    if (reply && reply.reason === 'not_logged_in') showHint(hint, `${await unavailableMessage()}。`, 'error')
    else showHint(hint, `選課網回應失敗：${(reply && reply.detail) || '未知錯誤'}`, 'error')
    btn.disabled = false
    return
  }

  const results = reply.results.map((r) => (r.status === 'added' && optionNotes[r.id] ? { ...r, note: optionNotes[r.id] } : r))
  renderBulkResults(results, invalid)
  for (const r of results) state.addStatus.set(r.id, r)
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
  $('#btn-schedule').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/schedule.html') }))
  $('#btn-register').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/register.html') }))
  $('#btn-reload').addEventListener('click', () => reloadCos())
  $('#btn-crawl').addEventListener('click', startCrawl)
  $('#q').addEventListener('input', renderSearch)
  $('#btn-counts').addEventListener('click', fetchCounts)
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

  await Promise.all([detectTab(), loadData(), loadCounts()])
  renderSearch()
  $('#q').focus()
}

init()
