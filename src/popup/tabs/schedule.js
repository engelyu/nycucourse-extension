// 課表 tab（下一個任務實作）
let root = null

export function mount(container) {
  root = container
}

export function show() {
  if (root && !root.querySelector('.stub')) {
    const p = document.createElement('p')
    p.className = 'stub hint'
    p.textContent = '課表'
    root.prepend(p)
  }
}
