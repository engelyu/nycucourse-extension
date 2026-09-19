// 框選格子：7 天 × 16 節。拖曳的起點決定選取或取消，放開才寫入；點標題整天／整節切換。
import { PERIODS, DAY_NAMES } from '../lib/periods.js'
import { slotKey } from '../lib/freeslots.js'
import { dragMode, rectKeys, applyKeys, toggleGroup, dayKeys, periodKeys } from '../lib/grid-select.js'

export function createSlotGrid(container, { onChange }) {
  let selection = new Set()
  let drag = null // { start, current, mode }

  container.replaceChildren()
  container.append(Object.assign(document.createElement('div'), { className: 'corner' }))
  for (let d = 1; d <= 7; d++) {
    const h = document.createElement('button')
    h.type = 'button'
    h.className = 'head day'
    h.dataset.day = String(d)
    h.textContent = DAY_NAMES[d]
    h.title = `整天切換（週${DAY_NAMES[d]}）`
    h.addEventListener('click', () => onChange(toggleGroup(selection, dayKeys(d))))
    container.append(h)
  }
  for (const p of PERIODS) {
    const h = document.createElement('button')
    h.type = 'button'
    h.className = 'head period'
    h.dataset.period = p.code
    h.title = `整節切換（第 ${p.label} 節 ${p.start}–${p.end}）`
    h.append(Object.assign(document.createElement('b'), { textContent: p.label }), Object.assign(document.createElement('small'), { textContent: p.start }))
    h.addEventListener('click', () => onChange(toggleGroup(selection, periodKeys(p.code))))
    container.append(h)
    for (let d = 1; d <= 7; d++) {
      const cell = document.createElement('div')
      cell.className = 'cell'
      cell.dataset.key = slotKey(d, p.code)
      container.append(cell)
    }
  }

  const keyAt = (x, y) => {
    const el = document.elementFromPoint(x, y)
    const cell = el && el.closest ? el.closest('.cell') : null
    return cell && container.contains(cell) ? cell.dataset.key : null
  }
  const paintDrag = () => {
    const keys = drag ? new Set(rectKeys(drag.start, drag.current)) : new Set()
    for (const cell of container.querySelectorAll('.cell')) {
      const inRect = keys.has(cell.dataset.key)
      cell.classList.toggle('drag-add', inRect && drag.mode === 'add')
      cell.classList.toggle('drag-remove', inRect && drag.mode === 'remove')
    }
  }

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const key = keyAt(e.clientX, e.clientY)
    if (!key) return
    e.preventDefault()
    container.setPointerCapture(e.pointerId)
    drag = { start: key, current: key, mode: dragMode(selection, key) }
    paintDrag()
  })
  container.addEventListener('pointermove', (e) => {
    if (!drag) return
    const key = keyAt(e.clientX, e.clientY)
    if (key && key !== drag.current) {
      drag.current = key
      paintDrag()
    }
  })
  const finish = (commit) => {
    if (!drag) return
    const { start, current, mode } = drag
    drag = null
    paintDrag()
    if (commit) onChange(applyKeys(selection, rectKeys(start, current), mode))
  }
  container.addEventListener('pointerup', () => finish(true))
  container.addEventListener('pointercancel', () => finish(false))

  return {
    // occupied：時段 -> { kind, color, titles }（正式選上、登記中、在預排、私人行程）
    render(nextSelection, occupied = new Map()) {
      selection = new Set(nextSelection)
      for (const cell of container.querySelectorAll('.cell')) {
        const key = cell.dataset.key
        cell.classList.toggle('selected', selection.has(key))
        const info = occupied.get(key)
        cell.classList.toggle('busy', Boolean(info))
        cell.dataset.kind = info ? info.kind : ''
        cell.style.setProperty('--kind', info ? info.color : 'transparent')
        cell.textContent = info ? [info.mark, info.titles[0]].filter(Boolean).join(' ') : ''
        cell.title = info ? info.titles.join('、') : ''
      }
    },
    preview(inKeys = [], outKeys = []) {
      const inside = new Set(inKeys)
      const outside = new Set(outKeys)
      for (const cell of container.querySelectorAll('.cell')) {
        cell.classList.toggle('preview-in', inside.has(cell.dataset.key))
        cell.classList.toggle('preview-out', outside.has(cell.dataset.key))
      }
    },
  }
}
