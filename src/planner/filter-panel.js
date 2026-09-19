// 篩選面板：蓋在右欄課表上；按「篩選」、✕、Esc 開關，關閉後焦點回到「篩選」按鈕。
// 窄視窗（< 900px）時搬到左欄工具列下方，不蓋住課表。
const NARROW = '(max-width: 899px)'

export function createFilterPanel({ panel, toggle, close, home, narrowSlot, initialOpen, onToggle }) {
  let open = false
  let count = 0

  const label = () => {
    toggle.textContent = count ? `篩選 (${count})` : '篩選'
    toggle.setAttribute('aria-expanded', String(open))
    toggle.classList.toggle('active', open)
  }
  const setOpen = (next, { focus = false } = {}) => {
    open = Boolean(next)
    panel.hidden = !open
    label()
    if (!open && focus) toggle.focus()
    onToggle(open)
  }

  const place = (mq) => {
    const target = mq.matches ? narrowSlot : home
    if (panel.parentElement !== target) target.append(panel)
  }
  const mq = window.matchMedia(NARROW)
  place(mq)
  mq.addEventListener('change', place)

  toggle.addEventListener('click', () => setOpen(!open, { focus: open }))
  close.addEventListener('click', () => setOpen(false, { focus: true }))
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return
    if (document.querySelector('dialog[open]')) return // 詳情小卡、確認視窗自己處理 Esc
    e.preventDefault()
    setOpen(false, { focus: true })
  })

  open = Boolean(initialOpen)
  panel.hidden = !open
  label()

  return {
    isOpen: () => open,
    setOpen: (next) => setOpen(next),
    setCount(n) {
      count = n
      label()
    },
  }
}
