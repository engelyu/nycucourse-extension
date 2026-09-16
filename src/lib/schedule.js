// 課表的資料模型。課表放的是「行程」，來源可以是選課網的預排、正式選課，
// 或使用者自己新增的項目（外校課程、固定活動）。三種都用同一種格式。
import { PERIODS, periodIndex, parseCosTime, DAY_NAMES } from './periods.js'
import { courseOutlineUrl } from './links.js'

const str = (v) => (v == null ? '' : String(v))

function baseItem(fields) {
  return {
    key: '',
    source: 'manual',
    cosId: '',
    semester: '',
    title: '',
    teacher: '',
    credit: '',
    limit: '',
    enrolled: '',
    note: '',
    url: '',
    color: '',
    slots: [],
    ...fields,
  }
}

// 選課網的課（getpreregist / getregist 的項目）轉成課表項目
export function courseToItem(course, { source, semester }) {
  const cosId = str(course.cos_id)
  return baseItem({
    key: `${source}:${cosId}`,
    source,
    cosId,
    semester: str(semester) || (course.acy ? `${str(course.acy)}${str(course.sem)}` : ''),
    title: str(course.cos_cname),
    teacher: str(course.lecturers || course.teacher),
    credit: str(course.cos_credit),
    limit: str(course.num_limit),
    enrolled: str(course.registered_num),
    note: str(course.memo),
    slots: parseCosTime(course.cos_time),
  })
}

// 使用者自己新增的行程；外校課程也走這裡
export function manualItem({ id, title, slots = [], url = '', color = '', teacher = '', note = '' }) {
  return baseItem({
    key: `manual:${str(id)}`,
    source: 'manual',
    title: str(title),
    teacher: str(teacher),
    note: str(note),
    url: str(url),
    color: str(color),
    slots: slots.map((s) => ({ day: Number(s.day), period: str(s.period), room: str(s.room), campus: str(s.campus) })),
  })
}

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(hhmm).trim())
  if (!m) return null
  const value = Number(m[1]) * 60 + Number(m[2])
  return value >= 0 && value < 24 * 60 ? value : null
}

// 自訂時間（例如週三 19:00-20:30）換算成涵蓋到的節次
export function slotsFromTimeRange(day, start, end, room = '') {
  const from = toMinutes(start)
  const to = toMinutes(end)
  if (from === null || to === null || to <= from) return []
  return PERIODS.filter((p) => {
    const ps = toMinutes(p.start)
    const pe = toMinutes(p.end)
    return ps < to && pe > from
  }).map((p) => ({ day: Number(day), period: p.code, room: str(room), campus: '' }))
}

// 使用者對同步進來的課做的調整（連結、顏色、隱藏），以課號為key，重新同步後仍保留
export function applyOverrides(items, overrides = {}) {
  const out = []
  for (const item of items || []) {
    const o = overrides[item.cosId] || overrides[item.key]
    if (o && o.hidden) continue
    out.push(o ? { ...item, url: str(o.url) || item.url, color: str(o.color) || item.color } : { ...item })
  }
  return out
}

// 點擊要開啟的網址：自訂優先，學校課程預設開課程大綱
export function itemUrl(item) {
  if (!item) return null
  if (item.url) return item.url
  return courseOutlineUrl(item.semester, item.cosId)
}

// 排出週課表：只列出有行程的節次範圍，週末沒行程就不顯示
export function buildWeek(items) {
  const list = (items || []).filter((i) => i.slots && i.slots.length)
  const cells = new Map()
  let minIdx = Infinity
  let maxIdx = -Infinity
  let maxDay = 5
  for (const item of list) {
    for (const slot of item.slots) {
      const idx = periodIndex(slot.period)
      if (idx < 0 || !slot.day) continue
      minIdx = Math.min(minIdx, idx)
      maxIdx = Math.max(maxIdx, idx)
      maxDay = Math.max(maxDay, slot.day)
      const key = `${idx}|${slot.day}`
      if (!cells.has(key)) cells.set(key, [])
      cells.get(key).push({ ...item, room: slot.room, campus: slot.campus })
    }
  }
  const days = Array.from({ length: maxDay }, (_, i) => i + 1)
  if (maxIdx < 0) return { days, rows: [] }
  const rows = []
  for (let idx = minIdx; idx <= maxIdx; idx++) {
    const period = PERIODS[idx]
    rows.push({
      code: period.code,
      label: period.label,
      start: period.start,
      end: period.end,
      cells: Object.fromEntries(days.map((d) => [d, cells.get(`${idx}|${d}`) || []])),
    })
  }
  return { days, rows, dayNames: DAY_NAMES }
}
