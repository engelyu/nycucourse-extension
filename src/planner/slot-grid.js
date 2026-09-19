// 框選格子：7 天 × 16 節。拖曳的起點決定選取或取消，放開才寫入；點標題整天／整節切換。
// 鍵盤（W3C ARIA Grid pattern）：方向鍵移動、Space 切換、Shift＋方向鍵延伸選取、
// Ctrl／⌘＋Space 切換整天、Shift＋Space 切換整節、Home／End 到該列頭尾。
import { PERIODS, DAY_NAMES } from '../lib/periods.js'
import { slotKey } from '../lib/freeslots.js'
import { dragMode, rectKeys, applyKeys, toggleGroup, dayKeys, periodKeys } from '../lib/grid-select.js'

const el = (tag, props = {}, attrs = {}) => {
  const node = Object.assign(document.createElement(tag), props)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  return node
}

export function createSlotGrid(container, { onChange }) {
  let selection = new Set()
  let drag = null // { start, current, mode }
  let focusKey = slotKey(1, PERIODS[0].code)
  let anchor = null // Shift＋方向鍵延伸選取的起點

  container.replaceChildren()
  container.setAttribute('role', 'grid')
  container.setAttribute('aria-label', '上課時段（可框選）')
  container.setAttribute('aria-multiselectable', 'true')

  // 每一列用 display: contents 的 row，格子仍是同一個 CSS grid
  const head = el('div', { className: 'row' }, { role: 'row' })
  head.append(el('div', { className: 'corner' }, { role: 'columnheader', 'aria-label': '節次' }))
  for (let d = 1; d <= 7; d++) {
    const wrap = el('div', { className: 'hwrap' }, { role: 'columnheader' })
    const h = el('button', { type: 'button', className: 'head day', textContent: DAY_NAMES[d], title: `整天切換（週${DAY_NAMES[d]}）` }, { tabindex: '-1' })
    h.dataset.day = String(d)
    h.addEventListener('click', () => onChange(toggleGroup(selection, dayKeys(d))))
    wrap.append(h)
    head.append(wrap)
  }
  container.append(head)

  for (const p of PERIODS) {
    const row = el('div', { className: 'row' }, { role: 'row' })
    const wrap = el('div', { className: 'hwrap' }, { role: 'rowheader' })
    const h = el('button', { type: 'button', className: 'head period', title: `整節切換（第 ${p.label} 節 ${p.start}–${p.end}）` }, { tabindex: '-1' })
    h.dataset.period = p.code
    h.append(el('b', { textContent: p.label }), el('small', { textContent: p.start }))
    h.addEventListener('click', () => onChange(toggleGroup(selection, periodKeys(p.code))))
    wrap.append(h)
    row.append(wrap)
    for (let d = 1; d <= 7; d++) {
      const key = slotKey(d, p.code)
      const cell = el('div', { className: 'cell' }, { role: 'gridcell', tabindex: key === focusKey ? '0' : '-1', 'aria-selected': 'false', 'aria-label': `週${DAY_NAMES[d]}第 ${p.label} 節 ${p.start}` })
      cell.dataset.key = key
      row.append(cell)
    }
    container.append(row)
  }

  const cellOf = (key) => container.querySelector(`.cell[data-key="${key}"]`)
  const keyAt = (x, y) => {
    const hit = document.elementFromPoint(x, y)
    const cell = hit && hit.closest ? hit.closest('.cell') : null
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
  const moveFocus = (key) => {
    const prev = cellOf(focusKey)
    if (prev) prev.tabIndex = -1
    focusKey = key
    const next = cellOf(key)
    next.tabIndex = 0
    next.focus()
  }

  // ---------- 滑鼠、觸控板 ----------
  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    const key = keyAt(e.clientX, e.clientY)
    if (!key) return
    e.preventDefault()
    container.setPointerCapture(e.pointerId)
    moveFocus(key)
    anchor = null
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

  // ---------- 鍵盤 ----------
  const codes = PERIODS.map((p) => p.code)
  container.addEventListener('keydown', (e) => {
    const cell = e.target.closest && e.target.closest('.cell')
    if (!cell) return
    const [day, code] = cell.dataset.key.split('-')
    let d = Number(day)
    let i = codes.indexOf(code)
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
    if (steps[e.key]) {
      e.preventDefault()
      d = Math.min(7, Math.max(1, d + steps[e.key][0]))
      i = Math.min(codes.length - 1, Math.max(0, i + steps[e.key][1]))
      const next = slotKey(d, codes[i])
      if (e.shiftKey) {
        // Shift＋方向鍵：從起點到新位置的矩形全部選取
        if (!anchor) anchor = cell.dataset.key
        onChange(applyKeys(selection, rectKeys(anchor, next), 'add'))
      } else anchor = null
      moveFocus(next)
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      moveFocus(slotKey(e.key === 'Home' ? 1 : 7, code))
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      anchor = null
      if (e.key === ' ' && (e.ctrlKey || e.metaKey)) onChange(toggleGroup(selection, dayKeys(d)))
      else if (e.key === ' ' && e.shiftKey) onChange(toggleGroup(selection, periodKeys(code)))
      else onChange(applyKeys(selection, [cell.dataset.key], dragMode(selection, cell.dataset.key)))
    }
  })
  container.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') anchor = null
  })

  return {
    // occupied：時段 -> { kind, color, mark, titles }（正式選上、登記中、在預排、私人行程）
    render(nextSelection, occupied = new Map()) {
      selection = new Set(nextSelection)
      for (const cell of container.querySelectorAll('.cell')) {
        const key = cell.dataset.key
        const on = selection.has(key)
        cell.classList.toggle('selected', on)
        cell.setAttribute('aria-selected', String(on))
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
