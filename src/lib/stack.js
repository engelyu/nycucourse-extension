// 當期選課頁右欄課表的排版：每一節列出所有課（同一節多堂課就往下撐高）。
// 同一天中，一堂課在它每一節的位置（lane）相同，方便上下對照。
import { PERIODS } from './periods.js'
import { itemKind, itemMark, KIND_COLORS } from './status.js'

const ORDER = PERIODS.map((p) => p.code)
const ALWAYS_DAYS = [1, 2, 3, 4, 5]
const ALWAYS_PERIODS = new Set(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
const PRIORITY = { registered: 0, wish: 1, preregist: 2, manual: 3 }
const SERIOUS = new Set(['registered', 'wish'])

export function stackWeek(items) {
  const byDay = new Map() // 星期 -> [{ item, kind, periods: Map<節次, 教室> }]
  const usedPeriods = new Set()
  for (const item of items || []) {
    const kind = itemKind(item)
    const perDay = new Map()
    for (const s of item.slots || []) {
      const period = String(s.period).toLowerCase()
      if (!ORDER.includes(period)) continue
      if (!perDay.has(s.day)) perDay.set(s.day, new Map())
      if (!perDay.get(s.day).has(period)) perDay.get(s.day).set(period, s.room || '')
      usedPeriods.add(period)
    }
    for (const [day, periods] of perDay) {
      if (!byDay.has(day)) byDay.set(day, [])
      byDay.get(day).push({ item, kind, periods })
    }
  }

  const cells = new Map()
  for (const [day, entries] of byDay) {
    const start = (e) => Math.min(...[...e.periods.keys()].map((p) => ORDER.indexOf(p)))
    entries.sort((a, b) => PRIORITY[a.kind] - PRIORITY[b.kind] || start(a) - start(b) || String(a.item.key).localeCompare(String(b.item.key)))
    const lanes = [] // 每個位置已被哪些節次佔用
    for (const e of entries) {
      let lane = 0
      while (lanes[lane] && [...e.periods.keys()].some((p) => lanes[lane].has(p))) lane++
      if (!lanes[lane]) lanes[lane] = new Set()
      for (const p of e.periods.keys()) lanes[lane].add(p)
      const color = e.kind === 'manual' ? e.item.color || KIND_COLORS.manual : KIND_COLORS[e.kind]
      for (const [period, room] of e.periods) {
        const prev = ORDER[ORDER.indexOf(period) - 1]
        const key = `${day}-${period}`
        if (!cells.has(key)) cells.set(key, [])
        cells.get(key).push({ key: e.item.key, item: e.item, kind: e.kind, lane, first: !e.periods.has(prev), room, color, mark: itemMark(e.kind, e.item) })
      }
    }
  }

  const conflicts = new Map()
  for (const [key, list] of cells) {
    list.sort((a, b) => a.lane - b.lane)
    if (list.length >= 2 && list.some((e) => SERIOUS.has(e.kind))) conflicts.set(key, list.map((e) => e.item.title))
  }

  const days = [...new Set([...ALWAYS_DAYS, ...byDay.keys()])].sort((a, b) => a - b)
  const periods = ORDER.filter((p) => ALWAYS_PERIODS.has(p) || usedPeriods.has(p))
  return { days, periods, cells, conflicts }
}

export function hiddenSlots(keys, week) {
  const days = new Set(week.days.map(String))
  const periods = new Set(week.periods)
  return [...(keys || [])].filter((k) => {
    const [day, period] = k.split('-')
    return !days.has(day) || !periods.has(period)
  })
}
