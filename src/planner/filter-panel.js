// 篩選面板：蓋在右欄課表上；按「篩選」、✕、Esc 開關，關閉後焦點回到「篩選」按鈕。
// 窄視窗（< 900px）時搬到左欄工具列下方，不蓋住課表。
const NARROW = '(max-width: 899px)'

export function createFilterPanel({ panel, toggle, close, home, narrowSlot, initialOpen, onToggle, detail }) {
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
    // 面板蓋在 .plan-pane 上是 position:absolute; inset:0，如果課表已經被捲動過，面板會開在捲動過的位置
    // 上方、看不到；.plan-pane 又因為 :has(.filter-panel:not([hidden])) 被鎖成 overflow:hidden 動不了，
    // 所以開面板時把 home（.plan-pane，僅限面板還在 home 底下，不是窄視窗搬去 narrowSlot 的情況）捲回頂端
    if (open && panel.parentElement === home) home.scrollTop = 0
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
    if (e.key !== 'Escape') return
    if (document.querySelector('#confirm[open]')) return // 確認視窗是 modal，自己處理 Esc
    // 詳情小卡不是 modal（focus 不一定在卡片裡），這裡先關它；沒有開才輪到關面板。
    // 卡片自己也監聽 Esc（focus 在卡片裡時），那邊會 stopPropagation 擋掉，不會兩邊都關
    if (detail && detail.isOpen()) {
      e.preventDefault()
      detail.close()
      return
    }
    if (!open) return
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
