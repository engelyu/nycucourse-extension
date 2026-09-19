// 加入預排 tab：課程資料、搜尋加入、查人數、批次貼課號
import { parseIds, findInvalidTokens, semesterOfIds } from '../../lib/parse.js'
import { describeCrawl } from '../../lib/crawlState.js'
import { sysStatusNotice } from '../../lib/regstatus.js'
import { preregParams, defaultOption } from '../../lib/attribution.js'
import { state, $, code, showHint, formatTime } from '../shared.js'
import { send, detectTab, reloadCos, refreshSysStatus, unavailableMessage, onCosChange } from '../cos.js'
import { createCourseSearch, renderAllSearches, loadCounts, optionsFor } from '../course-search.js'

const EMULATOR_URL = 'https://cos.nycu.edu.tw/#/emulator'

let search = null

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
    renderAllSearches()
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
  renderAllSearches()
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

export async function mount(root) {
  $('#btn-open').addEventListener('click', () => chrome.tabs.create({ url: EMULATOR_URL }))
  $('#btn-reload').addEventListener('click', () => reloadCos())
  $('#btn-crawl').addEventListener('click', startCrawl)
  search = createCourseSearch({ q: $('#q'), list: $('#search-results'), summary: $('#search-summary'), countsBtn: $('#btn-counts') })
  onCosChange(() => {
    renderTabBar()
    renderSysStatus()
    renderSemesterWarning()
    renderAllSearches()
  })
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
  renderAllSearches()
}

export function show() {
  if (search) search.render()
  $('#q').focus()
}
