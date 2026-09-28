// popup 的教室現況：教室查詢頁的簡化版。時間固定是現在；校區與大樓跟教室查詢頁共用（storage 的 rooms），
// 樓層不篩選、只當分組標題；顯示「沒排課」或「上課中」（popup 自己記在 popupRoomsShow）。點教室開教室查詢頁看週課表。
import { buildRoomIndex, roomRows, describeStatus, floorLabel, buildingsOf, campusesOf, nowPoint, formatMinute } from '../lib/rooms.js'
import { loadBuildings } from '../lib/buildings.js'
import { campusName } from '../lib/freeslots.js'
import { DAY_NAMES } from '../lib/periods.js'

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, ...(text === undefined ? {} : { textContent: text }) })

let root = null
let saved = {} // storage 的 rooms，整包讀寫，不動教室查詢頁自己的欄位（樓層、時間模式等）
let index = { rooms: new Map(), noRoom: [] }
let hasCourses = false
let courseData = null
let buildings = null
let shown = 'free'

const q = (sel) => root.querySelector(sel)
const campus = () => saved.campus || 'GF'
const chosen = () => (Array.isArray(saved.buildings) ? saved.buildings : [])
const show = () => shown

async function save(patch) {
  saved = { ...saved, ...patch }
  try {
    await chrome.storage.local.set({ rooms: saved })
  } catch {}
}

function rebuild() {
  const courses = (courseData && courseData.courses) || []
  hasCourses = courses.length > 0
  index = buildRoomIndex(courses, buildings ? buildings.buildings : null)
  const campuses = campusesOf(index)
  if (campuses.length && !campuses.includes(campus())) saved = { ...saved, campus: campuses[0], buildings: [], floors: [] }
}

function renderControls(p) {
  const select = q('.qr-campus')
  select.replaceChildren(...campusesOf(index).map((c) => Object.assign(document.createElement('option'), { value: c, textContent: campusName(c) })))
  select.value = campus()
  q('.qr-now').textContent = `現在 週${DAY_NAMES[p.day]} ${formatMinute(p.minute)}`
  for (const r of root.querySelectorAll('input[name="qr-show"]')) r.checked = r.value === show()
  q('.qr-buildings').replaceChildren(
    ...buildingsOf(index, campus()).map((b) => {
      const btn = el('button', '', b.known ? `${b.name} ${b.code}` : b.code)
      btn.type = 'button'
      btn.dataset.code = b.code
      btn.setAttribute('aria-pressed', String(chosen().includes(b.code)))
      btn.addEventListener('click', () => {
        const next = chosen().includes(b.code) ? chosen().filter((x) => x !== b.code) : [...chosen(), b.code]
        save({ buildings: next, floors: [] }) // 跟教室查詢頁一樣：換大樓就清掉樓層
        render()
      })
      return btn
    }),
  )
}

function openRoom(room) {
  chrome.tabs.create({ url: chrome.runtime.getURL(`src/rooms.html?room=${encodeURIComponent(room.code)}`) })
}

function renderList(p) {
  const list = q('.qr-list')
  if (!hasCourses) {
    list.replaceChildren(el('p', 'muted', '還沒有課程資料，請先到「當期選課」按「更新課程資料」。'))
    return
  }
  if (!chosen().length) {
    list.replaceChildren(el('p', 'muted', '先選一棟或幾棟大樓。'))
    return
  }
  const rows = roomRows(index, { campus: campus(), buildings: chosen(), floors: [], show: show() }, p)
  if (!rows.length) {
    list.replaceChildren(el('p', 'muted', show() === 'free' ? '這些大樓現在都在上課。' : '這些大樓現在都沒有排課。'))
    return
  }
  const out = []
  let building = null
  let floor = null
  for (const { room, status } of rows) {
    if (room.building !== building || room.floor !== floor) {
      building = room.building
      floor = room.floor
      out.push(el('h3', '', `${room.known ? room.buildingName : room.building}・${floorLabel(room.floor)}`))
    }
    const d = describeStatus(status)
    const row = el('button', `qr-row ${status.state}`)
    row.type = 'button'
    row.dataset.key = room.key
    row.title = '開教室查詢看這間的週課表'
    row.append(el('span', 'code', room.code), el('span', 'what', d.text))
    row.addEventListener('click', () => openRoom(room))
    out.push(row)
  }
  list.replaceChildren(...out)
}

function render() {
  const p = nowPoint(new Date())
  renderControls(p)
  renderList(p)
}

export async function mountRooms(container) {
  root = container
  const stored = await chrome.storage.local.get(['rooms', 'courseData', 'roomBuildings', 'popupRoomsShow'])
  if (stored.popupRoomsShow === 'busy') shown = 'busy'
  if (stored.rooms && typeof stored.rooms === 'object') saved = stored.rooms
  courseData = stored.courseData || null
  // 先用快取的大樓表畫出來；沒有快取或過期時再抓一次，抓到後重畫
  buildings = (stored.roomBuildings && stored.roomBuildings.data) || null
  rebuild()
  render()
  loadBuildings().then((fresh) => {
    if (!fresh || fresh === buildings) return
    buildings = fresh
    rebuild()
    render()
  })

  q('.qr-campus').addEventListener('change', () => {
    save({ campus: q('.qr-campus').value, buildings: [], floors: [] })
    render()
  })
  for (const r of root.querySelectorAll('input[name="qr-show"]')) {
    r.addEventListener('change', () => {
      shown = r.value
      chrome.storage.local.set({ popupRoomsShow: shown }).catch(() => {})
      render()
    })
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.courseData) return
    courseData = changes.courseData.newValue || null
    rebuild()
    render()
  })
  setInterval(render, 30_000)
}
