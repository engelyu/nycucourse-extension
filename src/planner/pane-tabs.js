// 右欄的 tab：課表預覽／篩選設定（W3C ARIA tabs：←→ 切換、Home／End 到頭尾，焦點跟著走）。
export function createPaneTabs({ tabs, initial, onChange }) {
  const ids = Object.keys(tabs)
  let current = ids.includes(initial) ? initial : ids[0]

  const select = (id, { focus = false } = {}) => {
    current = id
    for (const [key, { tab, panel }] of Object.entries(tabs)) {
      const active = key === id
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
      panel.hidden = !active
    }
    if (focus) tabs[id].tab.focus()
  }

  for (const [id, { tab }] of Object.entries(tabs)) {
    tab.addEventListener('click', () => {
      if (id === current) return
      select(id)
      onChange(id)
    })
    tab.addEventListener('keydown', (e) => {
      const i = ids.indexOf(current)
      const next = { ArrowLeft: ids[(i - 1 + ids.length) % ids.length], ArrowRight: ids[(i + 1) % ids.length], Home: ids[0], End: ids[ids.length - 1] }[e.key]
      if (!next) return
      e.preventDefault()
      select(next, { focus: true })
      onChange(next)
    })
  }
  select(current)

  return {
    current: () => current,
    // 篩選設定的 tab 標籤顯示目前套用了幾個篩選
    setLabel(id, text) {
      tabs[id].tab.textContent = text
    },
  }
}
