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

// 這次要登記哪些課：已選上、停修的不送；已登記且志願相同（或沒有志願序）的也跳過
export function buildPlan(items, registeredByCosId) {
  const todo = []
  const skipped = []
  const registered = registeredByCosId || {}
  for (const item of items || []) {
    const cosId = str(item.cosId)
    const record = registered[cosId]
    if (record) {
      const { state, wishNo } = registrationState(record)
      if (state === 'registered' || state === 'withdrawn') {
        skipped.push({ cosId, title: str(item.title), reason: state === 'registered' ? '已選上' : '已停修' })
        continue
      }
      if (wishNo === null) {
        skipped.push({ cosId, title: str(item.title), reason: '已登記，等分發' })
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

const pad2 = (n) => String(n).padStart(2, '0')

// 自動登記的時間顯示：「9/25 13:05」
export function formatRunTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

// 清單裡的一門課：「515044 實變函數論(一)　第 2 志願」。沒有志願序的課送出後是登記或加選，
// 看選課網對那門課的規則（lib/register.js regAction），這裡只寫「不需志願序」
export function describeAutoItem(item, fallbackTitle = '') {
  const title = (item && item.title) || fallbackTitle
  return `${item.cosId} ${title}　${item.wish ? `第 ${item.wish} 志願` : '不需志願序'}`
}

// 執行紀錄一筆：「9/25 13:00　自動　成功 1 門、失敗 0 門：…」
export function describeLogEntry(entry) {
  return `${formatRunTime(entry.at)}　${entry.trigger === 'manual' ? '手動' : '自動'}　${entry.summary || entry.note}`
}
