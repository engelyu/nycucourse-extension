// 課程時間表的官方大樓代碼表（不用登入）。課程時間表自己的「星期／時間／教室代碼對照表」也是用這支 API。
// 開教室查詢頁時載入，存在 storage 的 roomBuildings，30 天內不重抓；抓不到就用舊的，都沒有就回傳 null。
export const BUILDINGS_URL = 'https://timetable.nycu.edu.tw/?r=main/get_classroom_code'
export const BUILDINGS_MAX_AGE = 30 * 24 * 60 * 60 * 1000

const str = (v) => (v == null ? '' : String(v))

export function normalizeBuildings(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null
  const campuses = []
  const buildings = {}
  for (const c of Object.values(json)) {
    const code = str(c && c.campus_code).replace(/[[\]]/g, '').trim()
    if (!code) continue
    campuses.push({ code, cname: str(c.cname).trim(), ename: str(c.ename).trim(), map: str(c.map).trim() })
    buildings[code] = {}
    for (const [b, v] of Object.entries((c && c.code) || {})) {
      buildings[code][b] = { cname: str(v && v.cname).trim(), ename: str(v && v.ename).trim() }
    }
  }
  return campuses.length ? { campuses, buildings } : null
}

export async function loadBuildings({ fetchImpl = fetch, storage = chrome.storage.local, now = Date.now() } = {}) {
  let cached = null
  try {
    cached = (await storage.get('roomBuildings')).roomBuildings || null
  } catch {}
  if (cached && cached.data && now - cached.fetchedAt < BUILDINGS_MAX_AGE) return cached.data
  try {
    const res = await fetchImpl(BUILDINGS_URL, { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = normalizeBuildings(await res.json())
    if (!data) throw new Error('大樓表格式不對')
    try {
      await storage.set({ roomBuildings: { fetchedAt: now, data } })
    } catch {}
    return data
  } catch {
    return cached && cached.data ? cached.data : null
  }
}
