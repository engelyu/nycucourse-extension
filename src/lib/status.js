// 本機記錄的課程狀態：來自 storage 的 schedule.sources（正式選課、預排），
// 用來在選課規劃頁標示每門課、替格子上色。
import { scheduleItems } from './schedule.js'
import { registrationState } from './register.js'
import { describeAttribution } from './attribution.js'

export const KIND_COLORS = { registered: '#16a34a', wish: '#ea580c', preregist: '#64748b', manual: '#8b5cf6' }
export const KIND_LABELS = { registered: '正式選上', wish: '登記中', preregist: '在預排', manual: '私人行程' }
const PRIORITY = ['registered', 'wish', 'preregist', 'manual']

export function courseStatuses(schedule) {
  const out = new Map()
  const sources = (schedule && schedule.sources) || {}
  for (const c of (sources.registered && sources.registered.courses) || []) {
    const { state, wishNo } = registrationState(c)
    out.set(String(c.cos_id), state === 'wish' ? { state: 'wish', wishNo, label: `登記中・第 ${wishNo} 志願` } : { state: 'registered', wishNo: null, label: '已選上' })
  }
  for (const c of (sources.preregist && sources.preregist.courses) || []) {
    const id = String(c.cos_id)
    if (out.has(id)) continue
    const how = describeAttribution(c)
    out.set(id, { state: 'preregist', wishNo: null, label: `在預排・${how === '未指定' ? '未指定採計' : how}` })
  }
  return out
}

function kindOf(item) {
  if (item.source === 'manual') return 'manual'
  if (item.source === 'registered') return item.regState === 'wish' ? 'wish' : 'registered'
  return 'preregist'
}

// 格子上每個時段被什麼佔用；同一格有多種時依「正式選上 > 登記中 > 在預排 > 私人行程」
export function occupiedKinds(schedule) {
  const out = new Map()
  for (const item of scheduleItems(schedule, ['registered', 'preregist'])) {
    const kind = kindOf(item)
    const color = kind === 'manual' ? item.color || KIND_COLORS.manual : KIND_COLORS[kind]
    for (const s of item.slots || []) {
      const key = `${s.day}-${s.period}`
      const cur = out.get(key)
      if (!cur) {
        out.set(key, { kind, color, titles: [item.title] })
        continue
      }
      cur.titles.push(item.title)
      if (PRIORITY.indexOf(kind) < PRIORITY.indexOf(cur.kind)) Object.assign(cur, { kind, color })
    }
  }
  return out
}
