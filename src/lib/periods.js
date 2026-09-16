// 節次與上課時間。節次時間取自選課網自己的對照表（Y 到 D 共 16 節）。
export const PERIODS = [
  { code: 'y', label: 'Y', start: '06:00', end: '06:50' },
  { code: 'z', label: 'Z', start: '07:00', end: '07:50' },
  { code: '1', label: '1', start: '08:00', end: '08:50' },
  { code: '2', label: '2', start: '09:00', end: '09:50' },
  { code: '3', label: '3', start: '10:10', end: '11:00' },
  { code: '4', label: '4', start: '11:10', end: '12:00' },
  { code: 'n', label: 'N', start: '12:20', end: '13:10' },
  { code: '5', label: '5', start: '13:20', end: '14:10' },
  { code: '6', label: '6', start: '14:20', end: '15:10' },
  { code: '7', label: '7', start: '15:30', end: '16:20' },
  { code: '8', label: '8', start: '16:30', end: '17:20' },
  { code: '9', label: '9', start: '17:30', end: '18:20' },
  { code: 'a', label: 'A', start: '18:30', end: '19:20' },
  { code: 'b', label: 'B', start: '19:30', end: '20:20' },
  { code: 'c', label: 'C', start: '20:30', end: '21:20' },
  { code: 'd', label: 'D', start: '21:30', end: '22:20' },
]

// 星期代碼：M 一、T 二、W 三、R 四、F 五、S 六、U 日
const DAYS = { M: 1, T: 2, W: 3, R: 4, F: 5, S: 6, U: 7 }
export const DAY_NAMES = ['', '一', '二', '三', '四', '五', '六', '日']

const INDEX = new Map(PERIODS.map((p, i) => [p.code, i]))

export function periodIndex(code) {
  const c = String(code ?? '').toLowerCase()
  return INDEX.has(c) ? INDEX.get(c) : -1
}

export function periodTime(code) {
  const i = periodIndex(code)
  if (i < 0) return null
  return { start: PERIODS[i].start, end: PERIODS[i].end }
}

// 解析 "M56W34-SA321[GF],F2-ED220[GF]" 這種上課時間字串。
// 回傳 [{ day, period, room, campus }]；同一天同一節有多間教室時合併成一筆。
export function parseCosTime(text) {
  const src = String(text ?? '').trim()
  if (!src) return []
  const out = []
  const seen = new Map()
  for (const segment of src.split(',')) {
    const [timePart = '', ...roomParts] = segment.split('-')
    const time = timePart.trim()
    if (!time) continue
    const roomRaw = roomParts.join('-').trim()
    const campusMatch = /\[([A-Za-z]+)\]$/.exec(roomRaw)
    const campus = campusMatch ? campusMatch[1] : ''
    const room = roomRaw.replace(/\[[A-Za-z]+\]$/, '').trim()

    let day = 0
    for (const ch of time) {
      const asDay = DAYS[ch]
      if (asDay && ch === ch.toUpperCase() && periodIndex(ch) < 0) {
        day = asDay
        continue
      }
      const idx = periodIndex(ch)
      if (idx < 0 || !day) continue
      const key = `${day}|${PERIODS[idx].code}`
      const existing = seen.get(key)
      if (existing) {
        if (room && !existing.room.split('、').includes(room)) {
          existing.room = existing.room ? `${existing.room}、${room}` : room
        }
        if (!existing.campus && campus) existing.campus = campus
        continue
      }
      const slot = { day, period: PERIODS[idx].code, room, campus }
      seen.set(key, slot)
      out.push(slot)
    }
  }
  return out
}

// 把時段整理成「一 5-6、三 3-4」這種文字
export function describeSlots(slots) {
  const byDay = new Map()
  for (const slot of slots || []) {
    if (!byDay.has(slot.day)) byDay.set(slot.day, [])
    byDay.get(slot.day).push(slot.period)
  }
  const parts = []
  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const indexes = [...new Set(byDay.get(day).map(periodIndex))].filter((i) => i >= 0).sort((a, b) => a - b)
    const ranges = []
    let from = null
    let prev = null
    const flush = () => {
      if (from === null) return
      ranges.push(from === prev ? PERIODS[from].label : `${PERIODS[from].label}-${PERIODS[prev].label}`)
    }
    for (const i of indexes) {
      if (prev !== null && i === prev + 1) {
        prev = i
        continue
      }
      flush()
      from = i
      prev = i
    }
    flush()
    parts.push(`${DAY_NAMES[day]} ${ranges.join(',')}`)
  }
  return parts.join('、')
}
