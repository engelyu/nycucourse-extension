// 找空堂課程：時段、空堂、比對與篩選。全部是純函式。
// 時段 key 是 "<星期>-<節次代碼>"，星期 1–7（週一 = 1）。
import { PERIODS, parseCosTime, DAY_NAMES } from './periods.js'
import { searchCourses } from './search.js'

const str = (v) => (v == null ? '' : String(v))

export const slotKey = (day, period) => `${day}-${period}`
export const ALL_SLOTS = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => PERIODS.map((p) => slotKey(d, p.code)))
const ORDER = new Map(ALL_SLOTS.map((k, i) => [k, i]))

// GF、YM 是主要校區排前面；BM、KS 名稱未確認，先顯示代碼
export const CAMPUSES = [
  { code: 'GF', name: '光復' },
  { code: 'YM', name: '陽明' },
  { code: 'BA', name: '博愛' },
  { code: 'LJ', name: '六家' },
  { code: 'GR', name: '歸仁' },
  { code: 'BM', name: 'BM' },
  { code: 'KS', name: 'KS' },
]
const CAMPUS_NAMES = new Map(CAMPUSES.map((c) => [c.code, c.name]))
export const campusName = (code) => CAMPUS_NAMES.get(str(code)) || str(code)

const unique = (list) => [...new Set(list)]

export function courseSlots(course) {
  const slots = parseCosTime(course && course.time)
  const keys = unique(slots.map((s) => slotKey(s.day, s.period))).sort((a, b) => ORDER.get(a) - ORDER.get(b))
  return {
    keys,
    campuses: unique(slots.map((s) => s.campus).filter(Boolean)),
    rooms: unique(slots.flatMap((s) => str(s.room).split('、')).filter(Boolean)),
  }
}

export function occupiedSlots(items) {
  const out = new Set()
  for (const item of items || []) {
    for (const s of item.slots || []) if (s.day && s.period) out.add(slotKey(s.day, s.period))
  }
  return out
}

export const freeSlots = (occupied) => ALL_SLOTS.filter((k) => !occupied.has(k))

export function matchCourse(keys, selection) {
  const inCount = keys.filter((k) => selection.has(k)).length
  return {
    inside: keys.length > 0 && inCount === keys.length,
    overlap: inCount > 0,
    outside: keys.filter((k) => !selection.has(k)),
  }
}

export const CATEGORIES = ['必修', '選修', '核心・基本素養', '核心・領域課程', '語言與溝通']

// 必修、選修取自課程時間表；核心與語言與溝通看類別代碼（和選課網核心課程選單的群組一致）
export function courseCategories(course) {
  const out = []
  const type = str(course && course.type)
  if (type === '必修' || type === '選修') out.push(type)
  const codes = (course && course.brief) || []
  if (codes.some((c) => /^Z10[0-4]$/.test(c))) out.push('核心・基本素養')
  if (codes.some((c) => /^Z10[5-8]$/.test(c))) out.push('核心・領域課程')
  if (codes.some((c) => /^Z2/.test(c))) out.push('語言與溝通')
  return out
}

export const hasBriefData = (courses) => (courses || []).some((c) => Array.isArray(c.brief) && c.brief.length)

// ['1-5','1-6','3-3'] -> '一 56、三 3'
export function describeKeys(keys) {
  const byDay = new Map()
  for (const k of [...keys].sort((a, b) => ORDER.get(a) - ORDER.get(b))) {
    const [day, code] = k.split('-')
    const label = (PERIODS.find((p) => p.code === code) || {}).label || code
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push(label)
  }
  return [...byDay].map(([day, labels]) => `${DAY_NAMES[Number(day)]} ${labels.join('')}`).join('、')
}

export const RESULT_LIMIT = 200

const numberOr = (v, fallback) => {
  const text = str(v).trim()
  const n = Number(text)
  return text !== '' && Number.isFinite(n) ? n : fallback
}

// 依選取的時段與篩選條件找課。回傳「完全落在內」與「部分重疊」兩組，合計最多 RESULT_LIMIT 門。
export function findCourses(courses, filters) {
  const f = filters || {}
  const selection = f.selection instanceof Set ? f.selection : new Set(f.selection || [])
  if (!selection.size) return { total: 0, inside: [], overlap: [], truncated: false }
  const campuses = new Set(f.campuses || [])
  const categories = new Set(f.categories || [])
  const deps = new Set(f.deps || [])
  const excluded = new Set((f.excludeIds || []).map(str))
  const min = numberOr(f.creditMin, -Infinity)
  const max = numberOr(f.creditMax, Infinity)
  const keywordIds = str(f.keyword).trim() ? new Set(searchCourses(courses, f.keyword, Infinity).items.map((c) => c.id)) : null

  const inside = []
  const overlap = []
  for (const course of courses || []) {
    if (excluded.has(str(course.id))) continue
    if (keywordIds && !keywordIds.has(course.id)) continue
    if (deps.size && !deps.has(course.dep)) continue
    const credit = Number(course.credit)
    if (Number.isFinite(credit) && (credit < min || credit > max)) continue
    if (categories.size && !courseCategories(course).some((c) => categories.has(c))) continue
    const { keys, campuses: courseCampuses } = courseSlots(course)
    if (!keys.length) continue
    if (campuses.size && !courseCampuses.some((c) => campuses.has(c))) continue
    const m = matchCourse(keys, selection)
    if (m.inside) inside.push({ course, keys, outside: [] })
    else if (f.mode === 'overlap' && m.overlap) overlap.push({ course, keys, outside: m.outside })
  }
  const byTime = (a, b) => ORDER.get(a.keys[0]) - ORDER.get(b.keys[0]) || str(a.course.id).localeCompare(str(b.course.id))
  inside.sort(byTime)
  overlap.sort(byTime)
  const total = inside.length + overlap.length
  const keepInside = inside.slice(0, RESULT_LIMIT)
  const keepOverlap = overlap.slice(0, Math.max(0, RESULT_LIMIT - keepInside.length))
  return { total, inside: keepInside, overlap: keepOverlap, truncated: total > RESULT_LIMIT }
}
