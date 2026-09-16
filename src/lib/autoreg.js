// 每日自動登記的排程與計畫。
// 加退選期間每天中午開放登記到隔天早上，系統再跑分發，所以想要的課每天都要重登一次。
import { registrationState } from './register.js'

const str = (v) => (v == null ? '' : String(v))
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/

// 選課系統每天關閉的時段（跑分發），預設 10:00 到 12:00
export const DEFAULT_CLOSED = { from: '10:00', to: '12:00' }

const minutesOf = (hhmm) => {
  const m = TIME.exec(str(hhmm).trim())
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

const sameDay = (a, b) => {
  const x = new Date(a)
  const y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

// 下一次要跑的時間；今天已經跑過或已經過了時間就排明天
export function nextRunAt(timeHHMM, nowMs = Date.now(), lastRunMs = 0) {
  const minutes = minutesOf(timeHHMM)
  if (minutes === null) return null
  const now = new Date(nowMs)
  const target = new Date(nowMs)
  target.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0)
  const ranToday = lastRunMs && sameDay(lastRunMs, nowMs)
  if (target.getTime() <= now.getTime() || ranToday) target.setDate(target.getDate() + 1)
  return target.getTime()
}

export function inClosedWindow(timeHHMM, closed = DEFAULT_CLOSED) {
  const t = minutesOf(timeHHMM)
  const from = minutesOf(closed.from)
  const to = minutesOf(closed.to)
  if (t === null || from === null || to === null) return false
  return t >= from && t < to
}

export function timeWarning(timeHHMM, closed = DEFAULT_CLOSED) {
  return inClosedWindow(timeHHMM, closed)
    ? `選課系統每天 ${closed.from} 到 ${closed.to} 通常關閉，這個時間可能登記不到。`
    : ''
}

// 這次要登記哪些課：已選上的不用再登記，已登記且志願相同的也跳過
export function buildPlan(items, registeredByCosId) {
  const todo = []
  const skipped = []
  const registered = registeredByCosId || {}
  for (const item of items || []) {
    const cosId = str(item.cosId)
    const record = registered[cosId]
    if (record) {
      const { state, wishNo } = registrationState(record)
      if (state === 'registered') {
        skipped.push({ cosId, title: str(item.title), reason: '已選上' })
        continue
      }
      if (str(wishNo) === str(item.wish)) {
        skipped.push({ cosId, title: str(item.title), reason: `已登記第 ${wishNo} 志願` })
        continue
      }
    }
    todo.push({ cosId, wish: str(item.wish), title: str(item.title) })
  }
  return { todo, skipped }
}

export function summarizeResults(results) {
  const list = results || []
  if (!list.length) return '沒有需要登記的課程'
  const ok = list.filter((r) => r.ok).length
  const detail = list.map((r) => `${r.title} ${r.message}`).join('；')
  return `成功 ${ok} 門、失敗 ${list.length - ok} 門：${detail}`
}
