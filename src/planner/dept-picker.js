// 系所多選：上方是已選的小標籤（可逐一取消或全部清除），下方是可搜尋的清單；
// 已選的固定在清單最上面，其他依門數排序。不預設任何系所。
export function createDeptPicker(container, { onChange }) {
  let options = [] // [{ name, count }]
  let selected = []
  let query = ''

  container.replaceChildren()
  container.classList.add('dept-picker')
  const chips = document.createElement('div')
  chips.className = 'chips'
  const search = document.createElement('input')
  search.type = 'search'
  search.className = 'dept-search'
  search.placeholder = '輸入系所名稱，Enter 選第一個'
  search.setAttribute('aria-label', '搜尋系所')
  const list = document.createElement('ul')
  list.className = 'dept-list'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-multiselectable', 'true')
  container.append(chips, search, list)

  const set = (next) => {
    selected = next
    onChange([...selected])
    render()
  }
  const toggle = (name) => set(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name])
  const matches = (name) => !query || name.includes(query)

  search.addEventListener('input', () => {
    query = search.value.trim()
    renderList()
  })
  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const first = options.find((o) => !selected.includes(o.name) && matches(o.name))
    if (first) {
      toggle(first.name)
      search.value = ''
      query = ''
      renderList()
    }
  })

  function renderChips() {
    chips.replaceChildren()
    if (!selected.length) {
      chips.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: '不限系所' }))
      return
    }
    for (const name of selected) {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'chip'
      chip.textContent = `${name} ×`
      chip.title = `取消「${name}」`
      chip.addEventListener('click', () => toggle(name))
      chips.append(chip)
    }
    const clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'link'
    clear.textContent = '清除'
    clear.addEventListener('click', () => set([]))
    chips.append(clear)
  }

  function row(option, checked) {
    const li = document.createElement('li')
    li.setAttribute('role', 'option')
    li.setAttribute('aria-selected', String(checked))
    const label = document.createElement('label')
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = checked
    box.addEventListener('change', () => toggle(option.name))
    const name = Object.assign(document.createElement('span'), { className: 'name', textContent: option.name })
    const count = Object.assign(document.createElement('span'), { className: 'count', textContent: `${option.count} 門` })
    label.append(box, name, count)
    li.append(label)
    return li
  }

  function renderList() {
    list.replaceChildren()
    const byName = new Map(options.map((o) => [o.name, o]))
    const picked = selected.map((n) => byName.get(n) || { name: n, count: 0 }).filter((o) => matches(o.name))
    const rest = options.filter((o) => !selected.includes(o.name) && matches(o.name))
    list.append(...picked.map((o) => row(o, true)))
    if (picked.length && rest.length) list.append(Object.assign(document.createElement('li'), { className: 'divider' }))
    list.append(...rest.map((o) => row(o, false)))
    if (!picked.length && !rest.length) list.append(Object.assign(document.createElement('li'), { className: 'muted empty', textContent: '找不到符合的系所' }))
  }

  function render() {
    renderChips()
    renderList()
  }

  return {
    // nextOptions：[{ name, count }]（門數多的在前）；nextSelected：記住的已選系所
    update(nextOptions, nextSelected) {
      options = nextOptions || []
      selected = [...(nextSelected || [])]
      render()
    },
  }
}
