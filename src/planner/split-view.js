// 左右分割：拖曳中間的分隔線（或用鍵盤 ←→）調整左欄寬度。寬度存成比例，視窗大小改變時照比例重算，
// 兩邊都不小於 SPLIT 的最小寬度；放不下時 CSS 改成上下排，分隔線藏起來。
import { SPLIT, splitLeft } from '../lib/split.js'

const STEP = 16
const BIG_STEP = 64

export function createSplitView({ layout, handle, initialRatio, onChange }) {
  let ratio = Number.isFinite(initialRatio) ? initialRatio : SPLIT.defaultRatio

  const room = () => layout.clientWidth - SPLIT.handle
  const apply = () => {
    const left = splitLeft(ratio, layout.clientWidth)
    if (left === null) {
      layout.style.removeProperty('--left')
      return
    }
    layout.style.setProperty('--left', `${left}px`)
    handle.setAttribute('aria-valuenow', String(Math.round((left / room()) * 100)))
  }
  const setLeft = (px) => {
    const left = splitLeft(px / room(), layout.clientWidth)
    if (left === null) return
    ratio = left / room()
    apply()
  }
  const commit = () => onChange(ratio)

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    handle.setPointerCapture(e.pointerId)
    const origin = layout.getBoundingClientRect().left
    document.body.classList.add('resizing')
    const move = (ev) => setLeft(ev.clientX - origin - SPLIT.handle / 2)
    const up = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
      document.body.classList.remove('resizing')
      commit()
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  })
  handle.addEventListener('keydown', (e) => {
    const current = splitLeft(ratio, layout.clientWidth)
    if (current === null) return
    const step = e.shiftKey ? BIG_STEP : STEP
    const next = { ArrowLeft: current - step, ArrowRight: current + step, Home: 0, End: Infinity }[e.key]
    if (next === undefined) return
    e.preventDefault()
    setLeft(Math.min(next, room()))
    commit()
  })
  // 雙擊回到預設寬度
  handle.addEventListener('dblclick', () => {
    ratio = SPLIT.defaultRatio
    apply()
    commit()
  })

  new ResizeObserver(apply).observe(layout)
  apply()
}
