// 現在與下一堂。只用鐘點（分鐘）計算，不看節次代碼，
// 之後任意時間的活動（例如外部行事曆）也能直接放進來。
import { DAY_NAMES } from './periods.js'

const weekday = (date) => ((date.getDay() + 6) % 7) + 1 // 週一 = 1 … 週日 = 7

export function locateNow(layout, now) {
  const today = weekday(now)
  const minute = now.getHours() * 60 + now.getMinutes()
  const blocks = [...(layout.blocks || [])].sort((a, b) => a.day - b.day || a.startMin - b.startMin || a.lane - b.lane)
  const todays = blocks.filter((b) => b.day === today)
  const current = todays.find((b) => b.startMin <= minute && minute < b.endMin) || null

  let next = todays.find((b) => b.startMin > minute) || null
  let nextDayOffset = next ? 0 : null
  for (let offset = 1; !next && offset <= 7; offset++) {
    const day = ((today - 1 + offset) % 7) + 1
    const first = blocks.find((b) => b.day === day)
    if (first) {
      next = first
      nextDayOffset = offset
    }
  }

  return {
    today,
    current,
    next,
    nextDayOffset,
    minutesUntilNext: next && nextDayOffset === 0 ? next.startMin - minute : null,
    nowLine: nowLineOf(layout, today, minute),
  }
}

// 現在時間線畫在第幾列的哪個位置；課間休息畫在兩列之間，範圍外不畫
function nowLineOf(layout, today, minute) {
  const rows = layout.rows || []
  if (!rows.length || !(layout.days || []).includes(today)) return null
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    if (row.startMin <= minute && minute < row.endMin) {
      return { row: r, fraction: Math.round(((minute - row.startMin) / (row.endMin - row.startMin)) * 100) / 100 }
    }
    const following = rows[r + 1]
    if (following && row.endMin <= minute && minute < following.startMin) return { row: r, fraction: 1 }
  }
  return null
}

function duration(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (!h) return `${m} 分鐘後`
  return m ? `${h} 小時 ${m} 分鐘後` : `${h} 小時後`
}

const place = (block) => [block.item.title, block.room].filter(Boolean).join('・')

// popup 上「上課中／下一堂」的文字，一到兩行
export function describeNow(located) {
  const lines = []
  if (located.current) lines.push(`上課中：${place(located.current)}，${located.current.end} 下課`)
  const next = located.next
  if (next) {
    const when =
      located.nextDayOffset === 0
        ? `${next.start}（${duration(located.minutesUntilNext)}）`
        : `${located.nextDayOffset === 1 ? '明天' : `週${DAY_NAMES[next.day]}`} ${next.start}`
    lines.push(`下一堂 ${when}・${place(next)}`)
  }
  if (!lines.length) lines.push('這週沒有課')
  return lines
}
