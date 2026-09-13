// 課程搜尋，規則沿用交大課程助手：
// 課號完全相符 > 課名子字串 > 老師子字串 > 英文課名（不分大小寫）> 課名模糊子序列。

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
  if (course.name.includes(q)) return 1
  if (course.teacher.includes(q)) return 2
  if (course.ename && course.ename.toLowerCase().includes(qLower)) return 3
  if (isSubsequence([...qLower], course.name.toLowerCase())) return 4
  return -1
}

export function searchCourses(courses, query, limit = 50) {
  const q = String(query ?? '').trim()
  if (!q) return { total: 0, items: [] }
  const qLower = q.toLowerCase()
  const buckets = [[], [], [], [], []]
  for (const course of courses || []) {
    const r = rank(course, q, qLower)
    if (r >= 0) buckets[r].push(course)
  }
  const all = buckets.flat()
  return { total: all.length, items: all.slice(0, limit) }
}
