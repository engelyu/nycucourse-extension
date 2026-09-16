import { parseRegInfo, describeAvailability, wishOptions, registerParams, parseRegResult, menuForCourse, registrationState, describeRegistration } from './lib/register.js'
import { parseCosTime, describeSlots } from './lib/periods.js'
import { formatSeats } from './lib/seats.js'

const $ = (sel) => document.querySelector(sel)

const state = {
  courses: [], // 預排課程（要加選的候選）
  menus: new Map(), // cosId -> 課程時間表的查詢條件
  registered: new Map(), // 課號 -> 選課網的紀錄（已選上或登記中）
  groups: {}, // 分發群組（志願序）
  checks: new Map(), // cosId -> { availability, record }
  pending: null, // 確認中的課程
}

function showMessage(text, kind = '') {
  const el = $('#message')
  el.textContent = text
  el.classList.toggle('error', kind === 'error')
  el.hidden = !text
}

async function findCosTab() {
  const tabs = await chrome.tabs.query({ url: 'https://cos.nycu.edu.tw/*' })
  return tabs[0] || null
}

async function ask(message) {
  const tab = await findCosTab()
  if (!tab) return { ok: false, reason: 'no_tab' }
  try {
    return await chrome.tabs.sendMessage(tab.id, message)
  } catch {
    return { ok: false, reason: 'no_content_script' }
  }
}

function replyProblem(reply) {
  if (!reply) return '選課網沒有回應'
  if (reply.reason === 'no_tab') return '找不到選課網分頁，請先開啟並登入選課網。'
  if (reply.reason === 'no_content_script') return '選課網分頁沒有回應，請重新整理該分頁。'
  if (reply.reason === 'not_logged_in') return '請先登入選課網。'
  return reply.detail || '選課網沒有回應'
}

async function load() {
  const { schedule, courseData } = await chrome.storage.local.get(['schedule', 'courseData'])
  const pre = schedule && schedule.sources && schedule.sources.preregist
  state.courses = (pre && pre.courses) || []
  const regCourses = (((schedule || {}).sources || {}).registered || { courses: [] }).courses || []
  state.registered = new Map(regCourses.map((c) => [String(c.cos_id), c]))
  state.menus = new Map(((courseData && courseData.courses) || []).filter((c) => c.menu).map((c) => [c.id, c.menu]))
  renderStatus()
  render()
}

function renderStatus() {
  const all = [...state.registered.values()]
  const wishCount = all.filter((c) => registrationState(c).state === 'wish').length
  const bits = [`預排 ${state.courses.length} 門`, `已選上 ${all.length - wishCount} 門`]
  if (wishCount) bits.push(`登記中 ${wishCount} 門`)
  const missing = state.courses.filter((c) => !menuForCourse(c, state.menus.get(String(c.cos_id)))).length
  if (missing) bits.push(`${missing} 門缺查詢資料，請重新同步或更新課程資料`)
  $('#status').textContent = bits.join('　|　')
}

function stateCell(cosId) {
  const span = document.createElement('span')
  const record = state.registered.get(cosId)
  if (record) {
    const { state: regState } = registrationState(record)
    span.className = regState === 'wish' ? 'state-wish' : 'state-done'
    span.textContent = describeRegistration(record)
    return span
  }
  const check = state.checks.get(cosId)
  if (!check) {
    span.className = 'state-checking'
    span.textContent = '尚未查詢'
    return span
  }
  const { availability } = check
  span.className = availability.canRegister ? (availability.needsWish ? 'state-wish' : 'state-ok') : 'state-blocked'
  span.textContent = availability.canRegister ? (availability.needsWish ? '可登記（需志願序）' : '可加選') : availability.message
  if (availability.reasons.length) {
    const reasons = document.createElement('span')
    reasons.className = 'reasons'
    reasons.textContent = availability.reasons.join('、')
    span.append(reasons)
  }
  return span
}

function render() {
  renderStatus()
  const rows = $('#rows')
  rows.replaceChildren()
  $('#table').hidden = state.courses.length === 0
  $('#empty').hidden = state.courses.length > 0

  for (const course of state.courses) {
    const cosId = String(course.cos_id)
    const tr = document.createElement('tr')

    const id = document.createElement('td')
    id.append(Object.assign(document.createElement('code'), { textContent: cosId }))

    const name = document.createElement('td')
    name.textContent = course.cos_cname || ''
    const teacher = document.createElement('span')
    teacher.className = 'sub'
    teacher.textContent = course.lecturers || ''
    name.append(teacher)

    const time = document.createElement('td')
    time.textContent = describeSlots(parseCosTime(course.cos_time)) || '未定'

    const seats = document.createElement('td')
    const check = state.checks.get(cosId)
    seats.textContent = check
      ? check.availability.seats
      : formatSeats({ limit: course.num_limit, enrolled: course.registered_num })

    const st = document.createElement('td')
    st.append(stateCell(cosId))

    const act = document.createElement('td')
    act.className = 'actions-cell'
    const regRecord = state.registered.get(cosId)
    const isWish = regRecord && registrationState(regRecord).state === 'wish'
    if (isWish) {
      // 登記中的課還可以改志願，和選課網一樣
      const again = document.createElement('button')
      again.type = 'button'
      again.textContent = '改志願'
      again.addEventListener('click', async () => {
        const fresh = await checkCourse(course, again)
        if (fresh && fresh.availability.canRegister) openConfirm(course, fresh)
      })
      act.append(again)
    }
    if (!regRecord) {
      const hasMenu = Boolean(menuForCourse(course, state.menus.get(cosId)))
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = check && check.availability.canRegister ? (check.availability.needsWish ? '登記' : '加選') : '查詢'
      btn.disabled = !hasMenu
      btn.title = hasMenu ? '' : '需要先在 popup 按「更新課程資料」，或到課表分頁重新同步'
      btn.addEventListener('click', () => (check && check.availability.canRegister ? openConfirm(course, check) : checkCourse(course, btn)))
      act.append(btn)
    }

    tr.append(id, name, time, seats, st, act)
    rows.append(tr)
  }
}

async function checkCourse(course, btn) {
  const cosId = String(course.cos_id)
  if (btn) {
    btn.disabled = true
    btn.textContent = '查詢中…'
  }
  showMessage('')
  const reply = await ask({ type: 'reginfo', cosId, menu: menuForCourse(course, state.menus.get(cosId)) })
  if (!reply || !reply.ok) {
    showMessage(replyProblem(reply), 'error')
    render()
    return null
  }
  const record = parseRegInfo(reply.json, cosId)
  const availability = describeAvailability(record)
  state.checks.set(cosId, { record, availability })
  if (availability.needsWish) await loadGroups()
  render()
  return state.checks.get(cosId)
}

async function loadGroups() {
  if (Object.keys(state.groups).length) return
  const reply = await ask({ type: 'wishgroups' })
  if (reply && reply.ok && reply.groups && typeof reply.groups === 'object') state.groups = reply.groups
}

function openConfirm(course, check) {
  state.pending = { course, check }
  const { availability, record } = check
  $('#confirm-title').textContent = availability.needsWish ? '確認登記' : '確認加選'
  const lines = [
    `${course.cos_id} ${course.cos_cname}`,
    [course.lecturers, describeSlots(parseCosTime(course.cos_time))].filter(Boolean).join(' · '),
    availability.seats,
    availability.reasons.length ? `注意：${availability.reasons.join('、')}` : '',
    '送出後會真的加選這門課。',
  ].filter(Boolean)
  $('#confirm-body').replaceChildren(...lines.flatMap((line, i) => (i ? [document.createElement('br'), document.createTextNode(line)] : [document.createTextNode(line)])))
  $('#confirm-error').hidden = true

  const wishBlock = $('#wish-block')
  const options = availability.needsWish ? wishOptions(state.groups[availability.groupUid], record) : []
  wishBlock.hidden = !availability.needsWish
  const box = $('#wish-options')
  box.replaceChildren()
  for (const option of options) {
    const label = document.createElement('label')
    if (option.takenBy && !option.isThisCourse) label.classList.add('taken')
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'wish'
    input.value = String(option.no)
    const text = document.createElement('span')
    text.textContent = `第 ${option.no} 志願`
    const extra = document.createElement('span')
    extra.className = 'reserved'
    const bits = []
    if (option.isThisCourse) bits.push('目前是這門課')
    else if (option.takenBy) bits.push(`已填 ${option.takenBy}`)
    if (option.reserved) bits.push(`登記 ${option.reserved} 人`)
    extra.textContent = bits.join('・')
    label.append(input, text, extra)
    box.append(label)
  }
  $('#confirm').showModal()
}

async function submit() {
  const pending = state.pending
  if (!pending) return
  const { course, check } = pending
  const { availability, record } = check
  let wish = ''
  if (availability.needsWish) {
    const picked = document.querySelector('input[name="wish"]:checked')
    if (!picked) {
      const err = $('#confirm-error')
      err.textContent = '請先選擇第幾志願。'
      err.hidden = false
      return
    }
    wish = picked.value
  }
  const btn = $('#btn-submit')
  btn.disabled = true
  btn.textContent = '送出中…'
  try {
    const reply = await ask({ type: 'register', params: registerParams(record, wish) })
    if (!reply || !reply.ok) {
      const err = $('#confirm-error')
      err.textContent = replyProblem(reply)
      err.hidden = false
      return
    }
    const result = parseRegResult(reply.text)
    $('#confirm').close()
    const done = result.ok && availability.needsWish ? `已登記第 ${wish} 志願` : result.message
    showMessage(`${course.cos_id} ${course.cos_cname}：${done}`, result.ok ? '' : 'error')
    state.checks.delete(String(course.cos_id))
    state.groups = {}
    if (result.ok) await refreshRegistered()
    render()
  } finally {
    btn.disabled = false
    btn.textContent = '確認送出'
  }
}

// 送出後重讀正式選課清單，讓「已選上」立刻正確
async function refreshRegistered() {
  const reply = await ask({ type: 'courses' })
  if (!reply || !reply.ok) return
  const { schedule } = await chrome.storage.local.get('schedule')
  const now = Date.now()
  const semesterOf = (list) => {
    const c = (list || [])[0]
    return c && c.acy ? `${c.acy}${c.sem}` : ''
  }
  const next = {
    sources: {},
    manual: [],
    overrides: {},
    ...(schedule || {}),
  }
  next.sources = {
    ...next.sources,
    registered: { semester: semesterOf(reply.registered), updatedAt: now, courses: reply.registered || [] },
    preregist: { semester: semesterOf(reply.preregist), updatedAt: now, courses: reply.preregist || [] },
  }
  await chrome.storage.local.set({ schedule: next })
  state.registered = new Map((reply.registered || []).map((c) => [String(c.cos_id), c]))
  state.courses = reply.preregist || []
}

function init() {
  $('#btn-refresh').addEventListener('click', async () => {
    showMessage('')
    const reply = await ask({ type: 'courses' })
    if (!reply || !reply.ok) {
      showMessage(replyProblem(reply), 'error')
      await load()
      return
    }
    await refreshRegistered()
    state.checks.clear()
    await load()
  })
  $('#btn-cancel').addEventListener('click', () => $('#confirm').close())
  $('#btn-submit').addEventListener('click', submit)
  load()
}

init()
