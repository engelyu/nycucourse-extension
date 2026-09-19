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

const slotCache = new WeakMap()

// 課程的時段、校區、教室；同一個課程物件只解析一次（篩選時每門課會算很多次）
export function courseSlots(course) {
  if (course && typeof course === 'object' && slotCache.has(course)) return slotCache.get(course)
  const result = parseCourseSlots(course)
  if (course && typeof course === 'object') slotCache.set(course, result)
  return result
}

function parseCourseSlots(course) {
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

// 系所名稱整理：課程時間表的名稱常是「(醫學系)」「IBI(生物資訊及系統生物研究所)[碩]」，
// 去掉外層括號、英文縮寫與碩博標記，同一個研究所的碩士班、博士班合成一項
export function depLabel(name) {
  let s = str(name).trim().replace(/\[[^\]]*\]$/, '').trim()
  const wrapped = /^[A-Za-z0-9 .&'-]*\((.+)\)$/.exec(s)
  if (wrapped) s = wrapped[1].trim()
  return s
}

// 這門課出現的所有系所（主開系所＋課程時間表上列出它的系所），整理過名稱並去重
export function courseDeps(course) {
  const names = [...((course && course.deps) || []), str(course && course.dep)]
  return unique(names.map(depLabel).filter(Boolean))
}

// 系所清單與各有幾門課，門數多的在前
export function depCounts(courses) {
  const counts = new Map()
  for (const course of courses || []) for (const d of courseDeps(course)) counts.set(d, (counts.get(d) || 0) + 1)
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'))
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

const byTime = (a, b) => ORDER.get(a.keys[0]) - ORDER.get(b.keys[0])
const byId = (a, b) => str(a.course.id).localeCompare(str(b.course.id))
const creditOf = (hit) => {
  const n = Number(hit.course.credit)
  return Number.isFinite(n) ? n : -1
}

// 結果排序，使用者可以選。fit：超出的節數越少越前面（差一點就剛好的課先出現）
export const SORT_OPTIONS = [
  { id: 'fit', label: '最貼合' },
  { id: 'time', label: '上課時間' },
  { id: 'id', label: '課號' },
  { id: 'credit', label: '學分（多到少）' },
  { id: 'dep', label: '開課單位' },
]
const SORTS = {
  fit: (a, b) => a.outside.length - b.outside.length || byTime(a, b) || byId(a, b),
  time: (a, b) => byTime(a, b) || byId(a, b),
  id: byId,
  credit: (a, b) => creditOf(b) - creditOf(a) || byTime(a, b) || byId(a, b),
  dep: (a, b) => str(a.course.dep).localeCompare(str(b.course.dep), 'zh-Hant') || byTime(a, b) || byId(a, b),
}

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
    if (deps.size && !courseDeps(course).some((d) => deps.has(d))) continue
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
  const compare = SORTS[f.sort] || SORTS.fit
  inside.sort(compare)
  overlap.sort(compare)
  const total = inside.length + overlap.length
  const keepInside = inside.slice(0, RESULT_LIMIT)
  const keepOverlap = overlap.slice(0, Math.max(0, RESULT_LIMIT - keepInside.length))
  return { total, inside: keepInside, overlap: keepOverlap, truncated: total > RESULT_LIMIT }
}

// ---------- 篩選的回饋：已套用的篩選、各選項的門數、零結果時的建議 ----------

const MULTI_FIELDS = ['campuses', 'categories', 'deps']

export function appliedFilters(filters) {
  const f = filters || {}
  const out = []
  for (const code of f.campuses || []) out.push({ field: 'campuses', value: code, label: campusName(code) })
  for (const c of f.categories || []) out.push({ field: 'categories', value: c, label: c })
  for (const d of f.deps || []) out.push({ field: 'deps', value: d, label: d })
  if (str(f.keyword).trim()) out.push({ field: 'keyword', value: '', label: `關鍵字：${str(f.keyword).trim()}` })
  return out
}

export function withoutFilter(filters, field, value) {
  if (field === 'keyword') return { ...filters, keyword: '' }
  if (!MULTI_FIELDS.includes(field)) return { ...filters }
  return { ...filters, [field]: (filters[field] || []).filter((v) => v !== value) }
}

// 每個選項如果改成只選它（其他條件不變）會有幾門，用來顯示在選項旁
export function facetCounts(courses, filters, field, values) {
  return new Map(values.map((v) => [v, findCourses(courses, { ...filters, [field]: [v] }).total]))
}

// 零結果時的建議：改成部分重疊，或逐一拿掉已套用的篩選
export function relaxations(courses, filters) {
  const tips = []
  if (filters.mode !== 'overlap') {
    const next = { ...filters, mode: 'overlap' }
    tips.push({ label: '改成部分重疊', filters: next, total: findCourses(courses, next).total })
  }
  for (const a of appliedFilters(filters)) {
    const next = withoutFilter(filters, a.field, a.value)
    tips.push({ label: `拿掉「${a.label}」`, filters: next, total: findCourses(courses, next).total })
  }
  return tips
}
