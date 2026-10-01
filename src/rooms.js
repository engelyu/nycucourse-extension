// 教室查詢頁：選校區、大樓、樓層與時間，看每間教室「上課中」或「沒有排課（到幾點）」；點一間看它的一週課表。
// 計算都在 lib/rooms.js；大樓名稱來自 lib/buildings.js（官方表，快取 30 天，抓不到就只顯示代碼）。
import { buildRoomIndex, roomStatus, describeStatus, roomRows, noRoomCount, floorsOf, floorLabel, matchRooms, buildingsOf, campusesOf, periodAt, nowPoint, formatMinute } from './lib/rooms.js'
import { loadBuildings } from './lib/buildings.js'
import { campusName } from './lib/freeslots.js'
import { DAY_NAMES } from './lib/periods.js'
import { courseOutlineUrl } from './lib/links.js'
import { createTimetable } from './planner/timetable.js'
import { createCrawlBar } from './course-data/crawl-bar.js'
import { mountDataGate } from './course-data/gate.js'

const $ = (sel) => document.querySelector(sel)
const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) })
const WEEK_COLOR = '#0072B2'
const DEFAULTS = { campus: 'GF', buildings: [], floors: [], show: 'all', mode: 'now', day: 1, time: '10:00' }

const state = { ...DEFAULTS, selected: '' }
let index = { rooms: new Map(), noRoom: [] }
let semester = ''
let hasCourses = false
let timetable = null

const allRooms = () => [...index.rooms.values()]

// ---------- 儲存 ----------

async function save() {
  const { campus, buildings, floors, show, mode, day, time } = state
  try {
    await chrome.storage.local.set({ rooms: { campus, buildings, floors, show, mode, day, time } })
  } catch {}
}

function restore(saved) {
  if (!saved || typeof saved !== 'object') return
  for (const k of Object.keys(DEFAULTS)) {
    if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULTS[k] && Array.isArray(saved[k]) === Array.isArray(DEFAULTS[k])) state[k] = saved[k]
  }
}

// ---------- 時間 ----------

function point() {
  if (state.mode === 'now') return nowPoint(new Date())
  const [h, m] = state.time.split(':').map(Number)
  return { day: state.day, minute: Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0 }
}

// ---------- 控制項 ----------

function toggle(code, text, count, pressed, onClick, dataName) {
  const b = el('button')
  b.type = 'button'
  b.dataset[dataName] = code
  b.setAttribute('aria-pressed', String(pressed))
  b.append(text)
  if (count !== undefined) b.append(el('small', '', String(count)))
  b.addEventListener('click', onClick)
  return b
}

function renderControls(p) {
  const campuses = campusesOf(index)
  const campusSelect = $('#campus')
  campusSelect.replaceChildren(...campuses.map((c) => Object.assign(document.createElement('option'), { value: c, textContent: campusName(c) })))
  campusSelect.value = state.campus

  $('#buildings').replaceChildren(
    ...buildingsOf(index, state.campus).map((b) =>
      toggle(b.code, b.known ? `${b.name} ${b.code}` : b.code, b.count, state.buildings.includes(b.code), () => {
        state.buildings = state.buildings.includes(b.code) ? state.buildings.filter((x) => x !== b.code) : [...state.buildings, b.code]
        state.floors = []
        save()
        render()
      }, 'code'),
    ),
  )

  const floors = floorsOf(allRooms().filter((r) => r.campus === state.campus && state.buildings.includes(r.building)))
  $('#floors').replaceChildren(
    ...floors.map((f) =>
      toggle(f, floorLabel(f), undefined, state.floors.includes(f), () => {
        state.floors = state.floors.includes(f) ? state.floors.filter((x) => x !== f) : [...state.floors, f]
        save()
        render()
      }, 'floor'),
    ),
  )

  for (const r of document.querySelectorAll('input[name="mode"]')) r.checked = r.value === state.mode
  for (const r of document.querySelectorAll('input[name="show"]')) r.checked = r.value === state.show
  $('#day').value = String(state.day)
  $('#time').value = state.time
  $('#day').disabled = state.mode === 'now'
  $('#time').disabled = state.mode === 'now'
  const now = nowPoint(new Date())
  $('#now-text').textContent = `週${DAY_NAMES[now.day]} ${formatMinute(now.minute)}`
  const n = noRoomCount(index, p.day, p.minute)
  $('#no-room').textContent = n ? `這個時段全校另有 ${n} 門課沒有填教室。` : ''
}

// ---------- 列表 ----------

function renderList(p) {
  const list = $('#room-list')
  if (!hasCourses) {
    list.replaceChildren(el('p', 'muted', '還沒有課程資料，請按上方「更新課程資料」。'))
    return
  }
  if (!state.buildings.length) {
    list.replaceChildren(el('p', 'muted', '先選一棟或幾棟大樓。'))
    return
  }
  const rows = roomRows(index, state, p)
  if (!rows.length) {
    list.replaceChildren(el('p', 'muted', '沒有符合的教室。'))
    return
  }
  const out = []
  let building = null
  let floor = null
  for (const { room, status } of rows) {
    if (room.building !== building) {
      building = room.building
      floor = null
      out.push(el('h2', '', room.known ? `${room.buildingName} ${room.building}` : room.building))
    }
    if (room.floor !== floor) {
      floor = room.floor
      out.push(el('h3', '', floorLabel(room.floor)))
    }
    const d = describeStatus(status)
    const row = el('button', `room-row ${status.state}`)
    row.type = 'button'
    row.dataset.key = room.key
    row.setAttribute('aria-current', String(room.key === state.selected))
    row.append(el('span', 'code', room.code), el('span', 'badge', d.badge), el('span', 'what', d.text))
    row.addEventListener('click', () => {
      state.selected = room.key
      render()
    })
    out.push(row)
  }
  list.replaceChildren(...out)
}

// ---------- 單一教室週課表 ----------

function weekItems(room) {
  const byCourse = new Map()
  for (const s of room.slots) {
    if (!byCourse.has(s.course)) byCourse.set(s.course, [])
    byCourse.get(s.course).push({ day: s.day, period: s.period })
  }
  return [...byCourse].map(([course, slots]) => ({
    key: `room:${course.id}`, source: 'manual', cosId: course.id, title: course.name, teacher: course.teacher, color: WEEK_COLOR, slots,
  }))
}

function courseLink(course) {
  const url = courseOutlineUrl(semester, course.id)
  if (!url) return document.createTextNode(course.name)
  return Object.assign(document.createElement('a'), { href: url, target: '_blank', rel: 'noreferrer', textContent: course.name })
}

function renderRoom(p) {
  const room = index.rooms.get(state.selected)
  const head = $('#room-head')
  if (!room) {
    $('#room-week').replaceChildren()
    return
  }
  const status = roomStatus(room, p.day, p.minute)
  const line = el('p')
  if (status.state === 'busy') {
    line.append('上課中：')
    status.courses.forEach((c, i) => {
      if (i) line.append('／')
      line.append(courseLink(c), c.teacher ? `・${c.teacher}` : '')
    })
    line.append(`・到 ${formatMinute(status.until)}`)
  } else line.append(describeStatus(status).text)
  const title = [room.code, room.known ? room.buildingName : '', floorLabel(room.floor)].filter(Boolean).join('・')
  head.replaceChildren(el('h2', '', title), line)
  timetable.render(weekItems(room))
  const period = periodAt(p.minute)
  timetable.preview(period ? [`${p.day}-${period}`] : [])
}

// ---------- 找教室 ----------

function openRoom(room) {
  if (room.campus !== state.campus) {
    state.campus = room.campus
    state.buildings = []
    state.floors = []
  }
  if (!state.buildings.includes(room.building)) state.buildings = [...state.buildings, room.building]
  state.selected = room.key
  $('#room-q').value = ''
  $('#room-matches').hidden = true
  save()
  render()
}

// 只用點的選；不處理 Enter（注音選字確定的 Enter 會誤觸）
function renderMatches() {
  const matches = matchRooms(allRooms(), $('#room-q').value)
  $('#room-matches').replaceChildren(
    ...matches.map((r) => {
      const li = el('li')
      const b = el('button', '', `${r.code}　${r.known ? r.buildingName : r.building}・${campusName(r.campus)}`)
      b.type = 'button'
      b.addEventListener('click', () => openRoom(r))
      li.append(b)
      return li
    }),
  )
  $('#room-matches').hidden = !matches.length
}

// ---------- 初始化 ----------

function render() {
  const p = point()
  renderControls(p)
  renderList(p)
  renderRoom(p)
}

function rebuild(courseData, buildings) {
  const courses = (courseData && courseData.courses) || []
  hasCourses = courses.length > 0
  semester = (courseData && courseData.semester) || ''
  index = buildRoomIndex(courses, buildings ? buildings.buildings : null)
  const campuses = campusesOf(index)
  if (campuses.length && !campuses.includes(state.campus)) state.campus = campuses[0]
}

async function init() {
  mountDataGate()
  createCrawlBar($('#crawl')).load()
  const stored = await chrome.storage.local.get(['rooms', 'courseData'])
  restore(stored.rooms)
  const buildings = await loadBuildings()
  rebuild(stored.courseData, buildings)
  // 同一節好幾門課時全部寫出來：每一節都寫課名、課名可以換行（樣式在 rooms.css）
  timetable = createTimetable($('#room-week'), {
    note: $('#room-note'),
    repeatNames: true,
    onOpen: (item) => {
      const url = courseOutlineUrl(semester, item.cosId)
      if (url) window.open(url, '_blank', 'noreferrer')
    },
  })

  $('#day').replaceChildren(...[1, 2, 3, 4, 5, 6, 7].map((d) => Object.assign(document.createElement('option'), { value: String(d), textContent: `週${DAY_NAMES[d]}` })))
  $('#campus').addEventListener('change', () => {
    state.campus = $('#campus').value
    state.buildings = []
    state.floors = []
    state.selected = ''
    save()
    render()
  })
  for (const r of document.querySelectorAll('input[name="mode"]')) {
    r.addEventListener('change', () => {
      state.mode = r.value
      if (state.mode === 'custom') {
        const now = nowPoint(new Date())
        state.day = now.day
        state.time = formatMinute(now.minute)
      }
      save()
      render()
    })
  }
  for (const r of document.querySelectorAll('input[name="show"]')) {
    r.addEventListener('change', () => {
      state.show = r.value
      save()
      render()
    })
  }
  $('#day').addEventListener('change', () => {
    state.day = Number($('#day').value)
    save()
    render()
  })
  $('#time').addEventListener('change', () => {
    if (!$('#time').value) return
    state.time = $('#time').value
    save()
    render()
  })
  $('#room-q').addEventListener('input', renderMatches)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.courseData) return
    rebuild(changes.courseData.newValue, buildings)
    render()
  })
  // 「現在」模式每分鐘重算
  setInterval(() => {
    if (state.mode === 'now') render()
  }, 60_000)

  const wanted = new URLSearchParams(location.search).get('room')
  const target = wanted ? allRooms().find((r) => r.code.toUpperCase() === wanted.trim().toUpperCase()) : null
  if (target) openRoom(target)
  else render()
}

init()
