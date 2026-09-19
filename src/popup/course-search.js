// 找課＋加入預排（含採計方式選擇、查人數）。兩個 tab 共用，加入狀態存在 state.addStatus。
import { searchCourses } from '../lib/search.js'
import { formatSeats } from '../lib/seats.js'
import { courseOutlineUrl } from '../lib/links.js'
import { parseDeptCounts, menusToFetch, mergeCounts, countsFresh } from '../lib/counts.js'
import { findAttributionOptions, preregParams, needsChoice, courseDepUids } from '../lib/attribution.js'
import { state, code, showHint } from './shared.js'
import { send, notify, refreshSysStatus, unavailableMessage, getDepTree, getCourseList } from './cos.js'

const instances = new Set()

// elements：{ q, list, summary, countsBtn }，countsBtn 可以是 null
// cosHint：不在選課網分頁時，在搜尋摘要提醒要切過去才能加入（課表 tab 用，加入預排 tab 另有狀態列）
export function createCourseSearch({ q, list, summary, countsBtn = null, cosHint = false }) {
  const inst = { q, list, summary, countsBtn, cosHint, render: () => renderSearch(inst) }
  instances.add(inst)
  q.addEventListener('input', () => renderSearch(inst))
  if (countsBtn) countsBtn.addEventListener('click', () => fetchCounts(inst))
  return inst
}

export function renderAllSearches() {
  for (const inst of instances) renderSearch(inst)
}

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

function renderSearch(inst) {
  const q = inst.q.value
  const list = inst.list
  const summary = inst.summary
  list.replaceChildren()
  if (!q.trim()) {
    showHint(summary, '')
    return
  }
  const { total, items: found } = searchCourses(state.courses, q, 50)
  const items = mergeCounts(found, flatCounts())
  if (inst.countsBtn) {
    inst.countsBtn.hidden = items.length === 0
    inst.countsBtn.disabled = !state.cosReady
    inst.countsBtn.title = state.cosReady ? '向選課網查目前的選課人數' : '要在選課網分頁才能查人數'
  }
  const counted = total === 0
    ? '找不到符合的課程'
    : total > items.length ? `共 ${total} 筆，顯示前 ${items.length} 筆` : `共 ${total} 筆`
  showHint(summary, inst.cosHint && total > 0 && !state.cosReady ? `${counted}・切到選課網分頁才能加入預排` : counted)
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

export async function loadCounts() {
  const { deptCounts } = await chrome.storage.session.get('deptCounts')
  state.counts = deptCounts || {}
}

// 查目前選課人數：以系所為單位查，同一個系所五分鐘內只查一次

async function fetchCounts(inst) {
  const btn = inst.countsBtn
  if (!state.cosReady || !state.tab) return
  const q = inst.q.value
  const { items } = searchCourses(state.courses, q, 50)
  const menus = menusToFetch(items, state.counts, 8)
  if (!menus.length) {
    showHint(inst.summary, '人數已是最新的（五分鐘內查過）', 'warn')
    return
  }
  btn.disabled = true
  btn.textContent = '查詢中…'
  try {
    const reply = await send(state.tab.id, { type: 'deptcounts', menus })
    if (!reply || !reply.ok) {
      showHint(inst.summary, reply && reply.reason === 'not_logged_in' ? `${await unavailableMessage()}。` : '查人數失敗，請稍後再試。', 'error')
      return
    }
    const now = Date.now()
    const next = { ...state.counts }
    for (const [uid, list] of Object.entries(reply.lists || {})) {
      next[uid] = { at: now, counts: parseDeptCounts(list) }
    }
    state.counts = next
    await chrome.storage.session.set({ deptCounts: next })
    renderAllSearches()
  } catch {
    showHint(inst.summary, '無法連到選課網頁面，請重新整理該分頁。', 'error')
  } finally {
    btn.disabled = !state.cosReady
    btn.textContent = '查人數'
  }
}

// 選課網回空內容時，可能是登入過期，也可能是分發時段暫停；先查清楚再說

export async function optionsFor(id) {
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
    renderAllSearches()
  })
  box.append(cancel)
  return box
}

async function addSingle(id) {
  if (!state.cosReady || !state.tab) return
  state.addStatus.set(id, 'pending')
  renderAllSearches()
  let options
  try {
    options = await optionsFor(id)
  } catch (err) {
    if (err && err.reason === 'not_logged_in') {
      state.addStatus.set(id, { status: 'error', msg: await unavailableMessage() })
      renderAllSearches()
      return
    }
    options = []
  }
  if (needsChoice(options)) {
    state.addStatus.set(id, { status: 'choose', options })
    renderAllSearches()
    return
  }
  return submitSingle(id, options[0] || null)
}

async function submitSingle(id, option) {
  if (!state.cosReady || !state.tab) return
  state.addStatus.set(id, 'pending')
  renderAllSearches()
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
      notify()
    }
  } else if (reply && reply.reason === 'not_logged_in') {
    state.addStatus.set(id, { status: 'error', msg: await unavailableMessage() })
  } else {
    state.addStatus.set(id, { status: 'error', msg: (reply && reply.detail) || '未知錯誤' })
  }
  renderAllSearches()
  // 加不進去時可能是選課網公告的停機時段，重新讀一次狀態讓使用者知道原因
  const result = state.addStatus.get(id)
  if (!result || result === 'pending' || result.status === 'error' || result.msg) refreshSysStatus()
}
