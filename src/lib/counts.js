// 即時選課人數。課程時間表不提供已選人數，選課網的系所課程清單才有，
// 所以以「系所」為單位查一次，整個系所的課都拿得到，並在短時間內沿用。
const FRESH_MS = 5 * 60_000

const str = (v) => (v == null ? '' : String(v))

export function parseDeptCounts(list) {
  const out = {}
  for (const course of Array.isArray(list) ? list : []) {
    const id = str(course.cos_id)
    if (!id) continue
    out[id] = { limit: str(course.num_limit), enrolled: str(course.registered_num) }
  }
  return out
}

export function countsFresh(entry, nowMs = Date.now()) {
  return Boolean(entry && nowMs - entry.at < FRESH_MS)
}

// 這批課程需要查哪些系所：去重、跳過還新鮮的，並限制一次查幾個
export function menusToFetch(courses, cache = {}, limit = 8, nowMs = Date.now()) {
  const seen = new Set()
  const out = []
  for (const course of courses || []) {
    const menu = course && course.menu
    const uid = menu && str(menu.dep_uid)
    if (!uid || seen.has(uid)) continue
    seen.add(uid)
    if (countsFresh(cache[uid], nowMs)) continue
    out.push(menu)
    if (out.length >= limit) break
  }
  return out
}

export function mergeCounts(courses, counts) {
  return (courses || []).map((course) => {
    const hit = counts && counts[course.id]
    if (!hit) return course
    return { ...course, limit: hit.limit || course.limit, enrolled: hit.enrolled, live: true }
  })
}
