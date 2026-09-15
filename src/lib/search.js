// 課程搜尋，規則沿用交大課程助手並補上課號片段：
// 課號完全相符 > 課號片段（三碼以上數字）> 課名子字串 > 老師子字串 > 英文課名（不分大小寫）> 課名模糊子序列。
// 也接受 1151_516702 這種帶學期前綴的課號，和批次貼上的格式一致。

const SEMESTER_PREFIXED_ID = /^\d{4}_(\d{6})$/
const ID_FRAGMENT = /^\d{3,6}$/

function isSubsequence(needle, haystack) {
  let i = 0
  for (const ch of haystack) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return needle.length === 0
}

function rank(course, q, qLower) {
  if (course.id === q) return 0
  if (ID_FRAGMENT.test(q) && course.id.includes(q)) return 1
  if (course.name.includes(q)) return 2
  if (course.teacher.includes(q)) return 3
  if (course.ename && course.ename.toLowerCase().includes(qLower)) return 4
  if (isSubsequence([...qLower], course.name.toLowerCase())) return 5
  return -1
}

export function searchCourses(courses, query, limit = 50) {
  let q = String(query ?? '').trim()
  if (!q) return { total: 0, items: [] }
  const prefixed = SEMESTER_PREFIXED_ID.exec(q)
  if (prefixed) q = prefixed[1]
  const qLower = q.toLowerCase()
  const buckets = [[], [], [], [], [], []]
  for (const course of courses || []) {
    const r = rank(course, q, qLower)
    if (r >= 0) buckets[r].push(course)
  }
  const all = buckets.flat()
  return { total: all.length, items: all.slice(0, limit) }
}
