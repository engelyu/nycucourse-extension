// 框選規則：拖曳的起點決定這次是選取還是取消；矩形可以往任何方向拉
import { PERIODS } from './periods.js'
import { slotKey } from './freeslots.js'

const PERIOD_INDEX = new Map(PERIODS.map((p, i) => [p.code, i]))
const parse = (key) => {
  const [day, code] = String(key).split('-')
  return { day: Number(day), idx: PERIOD_INDEX.get(code) }
}

export const dragMode = (selection, startKey) => (selection.has(startKey) ? 'remove' : 'add')

export function rectKeys(startKey, endKey) {
  const a = parse(startKey)
  const b = parse(endKey)
  const out = []
  for (let d = Math.min(a.day, b.day); d <= Math.max(a.day, b.day); d++) {
    for (let i = Math.min(a.idx, b.idx); i <= Math.max(a.idx, b.idx); i++) out.push(slotKey(d, PERIODS[i].code))
  }
  return out
}

export function applyKeys(selection, keys, mode) {
  const next = new Set(selection)
  for (const k of keys) {
    if (mode === 'remove') next.delete(k)
    else next.add(k)
  }
  return next
}

// 整天或整節：已經全選就全部取消，否則全部選取
export const toggleGroup = (selection, keys) => applyKeys(selection, keys, keys.every((k) => selection.has(k)) ? 'remove' : 'add')
export const dayKeys = (day) => PERIODS.map((p) => slotKey(day, p.code))
export const periodKeys = (code) => [1, 2, 3, 4, 5, 6, 7].map((d) => slotKey(d, code))
