// 本機記錄的課程狀態：來自 storage 的 schedule.sources（正式選課、預排），
// 用來在選課規劃頁標示每門課、替格子上色。
import { scheduleItems } from './schedule.js'
import { registrationState } from './register.js'
import { describeAttribution } from './attribution.js'

// Okabe-Ito 配色：常見色弱（紅綠、藍黃）也分得出來；另外搭配文字標記，不只靠顏色
export const KIND_COLORS = { registered: '#009E73', wish: '#E69F00', preregist: '#0072B2', manual: '#CC79A7' }
const CIRCLED = ['', '①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨']
function markOf(kind, item) {
  if (kind === 'registered') return '✓'
  if (kind === 'wish') return CIRCLED[item.wishNo] || '志'
  if (kind === 'preregist') return '預'
  return ''
}
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
      const mark = markOf(kind, item)
      if (!cur) {
        out.set(key, { kind, color, mark, titles: [item.title] })
        continue
      }
      if (PRIORITY.indexOf(kind) < PRIORITY.indexOf(cur.kind)) {
        Object.assign(cur, { kind, color, mark })
        cur.titles.unshift(item.title)
      } else cur.titles.push(item.title)
    }
  }
  return out
}
