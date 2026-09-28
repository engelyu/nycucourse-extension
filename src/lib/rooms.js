// 教室查詢的計算（純函式）。教室代碼來自課程時間字串，例如 M34-ED219[GF] 的 ED219。
// 大樓名稱來自課程時間表的官方大樓表（lib/buildings.js）。規則見 docs/superpowers/specs/2026-09-24-room-lookup-design.md。
import { PERIODS, parseCosSegments } from './periods.js'
import { CAMPUSES } from './freeslots.js'

const str = (v) => (v == null ? '' : String(v))
const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}
const PERIOD_INDEX = new Map(PERIODS.map((p, i) => [p.code, i]))
const CAMPUS_ORDER = CAMPUSES.map((c) => c.code)
const FLOOR_BASEMENT = 'B'
const FLOOR_OTHER = '其他'

// 大樓：該校區官方代碼中最長、且是教室代碼開頭的那個；對不上就用開頭的英文字母。
// 樓層：大樓代碼後面的部分。-b09、-B1 是地下室（先判斷）；數字或「一個側翼字母＋數字」取那個數字；其他歸「其他」。
export function parseRoom(code, campus, buildings) {
  const room = str(code).trim()
  const table = (buildings && buildings[campus]) || {}
  let building = ''
  for (const b of Object.keys(table)) if (room.startsWith(b) && b.length > building.length) building = b
  const known = building !== ''
  if (!known) building = (/^[A-Za-z]+/.exec(room) || [room])[0]
  const rest = room.slice(building.length)
  let floor = FLOOR_OTHER
  if (/^-?b\d/i.test(rest)) floor = FLOOR_BASEMENT
  else {
    const m = /^[A-Za-z]?(\d)/.exec(rest)
    if (m) floor = m[1]
  }
  const buildingName = known ? str(table[building] && table[building].cname) || building : building
  return { code: room, campus: str(campus), building, buildingName, floor, known }
}

export function floorLabel(floor) {
  if (floor === FLOOR_BASEMENT) return '地下室'
  if (floor === '0') return '0 字頭'
  if (/^\d$/.test(floor)) return `${floor} 樓`
  return FLOOR_OTHER
}

const floorRank = (f) => (f === FLOOR_BASEMENT ? -1 : f === FLOOR_OTHER ? 99 : Number(f))

export function floorsOf(rooms) {
  return [...new Set((rooms || []).map((r) => r.floor))].sort((a, b) => floorRank(a) - floorRank(b))
}

// 時段沒有校區標記時（實測有 YEC109、YK533 這類沒寫 [YM] 的），用大樓代碼推回校區；
// 只有一個校區有這個大樓代碼才推，推不出來就留空白
function inferCampus(code, buildings) {
  const hits = Object.keys(buildings || {}).filter((campus) => Object.keys(buildings[campus]).some((b) => code.startsWith(b)))
  return hits.length === 1 ? hits[0] : ''
}

// 每間教室記下它的時段。逐段解析（parseCosSegments），兩個校區同時開教室的課每間教室才會歸到自己的校區；
// 同一段裡列了多間教室（「、」）也每間各記一筆。
export function buildRoomIndex(courses, buildings) {
  const rooms = new Map()
  const noRoom = []
  for (const course of courses || []) {
    for (const s of parseCosSegments(course && course.time)) {
      const codes = str(s.room).split('、').map((r) => r.trim()).filter(Boolean)
      if (!codes.length) {
        noRoom.push({ day: s.day, period: s.period, course })
        continue
      }
      for (const code of codes) {
        const campus = s.campus || inferCampus(code, buildings)
        const key = `${campus}:${code}`
        if (!rooms.has(key)) rooms.set(key, { key, ...parseRoom(code, campus, buildings), slots: [] })
        rooms.get(key).slots.push({ day: s.day, period: s.period, course })
      }
    }
  }
  return { rooms, noRoom }
}

// 同一門課在同一天、PERIODS 裡相鄰的節次合成一段；中間的下課也算在上課中
export function roomSessions(room) {
  const groups = new Map() // course -> Map(day -> Set(節次索引))
  for (const s of (room && room.slots) || []) {
    const i = PERIOD_INDEX.get(str(s.period).toLowerCase())
    if (i === undefined) continue
    if (!groups.has(s.course)) groups.set(s.course, new Map())
    const days = groups.get(s.course)
    if (!days.has(s.day)) days.set(s.day, new Set())
    days.get(s.day).add(i)
  }
  const out = []
  for (const [course, days] of groups) {
    for (const [day, set] of days) {
      const idx = [...set].sort((a, b) => a - b)
      let first = idx[0]
      for (let k = 1; k <= idx.length; k++) {
        if (k < idx.length && idx[k] === idx[k - 1] + 1) continue
        out.push({ day, start: minutesOf(PERIODS[first].start), end: minutesOf(PERIODS[idx[k - 1]].end), course })
        first = idx[k]
      }
    }
  }
  return out.sort((a, b) => a.day - b.day || a.start - b.start)
}

export function roomStatus(room, day, minute) {
  const today = roomSessions(room).filter((s) => s.day === day)
  const now = today.filter((s) => s.start <= minute && minute < s.end)
  if (now.length) return { state: 'busy', courses: [...new Set(now.map((s) => s.course))], until: Math.max(...now.map((s) => s.end)) }
  const later = today.filter((s) => s.start > minute).map((s) => s.start)
  return { state: 'free', courses: [], until: later.length ? Math.min(...later) : null }
}

// 列表上一間教室的狀態文字：上課中就把這個時間的每一門課都寫出來（合開、同時段兩門課都要列）
export function describeStatus(status) {
  if (status.state === 'busy') {
    const text = status.courses.map((c) => [c.name, c.teacher].filter(Boolean).join('・')).join('／')
    return { badge: '上課中', courses: status.courses, text: `${text}・到 ${formatMinute(status.until)}` }
  }
  return { badge: '沒有排課', courses: [], text: status.until == null ? '今天之後沒有排課' : `到 ${formatMinute(status.until)} 前沒有排課` }
}

// 教室列表（教室查詢頁與 popup 共用）：校區、大樓、樓層（空陣列＝全部）與顯示（all／free／busy）篩選，
// 照大樓（buildingsOf 的順序）、樓層、代碼排序
export function roomRows(index, { campus, buildings, floors = [], show = 'all' }, { day, minute }) {
  const buildingOrder = buildingsOf(index, campus).map((b) => b.code)
  const pool = [...index.rooms.values()].filter((r) => r.campus === campus && buildings.includes(r.building))
  const floorOrder = floorsOf(pool)
  return pool
    .filter((r) => !floors.length || floors.includes(r.floor))
    .map((room) => ({ room, status: roomStatus(room, day, minute) }))
    .filter(({ status }) => show === 'all' || status.state === show)
    .sort((a, b) =>
      buildingOrder.indexOf(a.room.building) - buildingOrder.indexOf(b.room.building) ||
      floorOrder.indexOf(a.room.floor) - floorOrder.indexOf(b.room.floor) ||
      a.room.code.localeCompare(b.room.code, 'en', { numeric: true }))
}

export function noRoomCount(index, day, minute) {
  const now = roomSessions({ slots: (index && index.noRoom) || [] }).filter((s) => s.day === day && s.start <= minute && minute < s.end)
  return new Set(now.map((s) => s.course)).size
}

export function matchRooms(rooms, query, limit = 20) {
  const q = str(query).trim().toUpperCase()
  if (!q) return []
  return (rooms || [])
    .filter((r) => r.code.toUpperCase().startsWith(q))
    .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }) || a.campus.localeCompare(b.campus))
    .slice(0, limit)
}

export function buildingsOf(index, campus) {
  const out = new Map()
  for (const r of index.rooms.values()) {
    if (r.campus !== campus) continue
    if (!out.has(r.building)) out.set(r.building, { code: r.building, name: r.buildingName, known: r.known, count: 0 })
    out.get(r.building).count++
  }
  return [...out.values()].sort((a, b) => Number(b.known) - Number(a.known) || a.code.localeCompare(b.code, 'en'))
}

export function campusesOf(index) {
  const present = new Set([...index.rooms.values()].map((r) => r.campus).filter(Boolean))
  const rank = (c) => (CAMPUS_ORDER.includes(c) ? CAMPUS_ORDER.indexOf(c) : CAMPUS_ORDER.length)
  return [...present].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

export function periodAt(minute) {
  const p = PERIODS.find((x) => minutesOf(x.start) <= minute && minute < minutesOf(x.end))
  return p ? p.code : ''
}

export function nowPoint(date) {
  return { day: ((date.getDay() + 6) % 7) + 1, minute: date.getHours() * 60 + date.getMinutes() }
}

export function formatMinute(minute) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`
}
