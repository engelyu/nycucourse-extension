// popup 外殼：依 TABS 產生 tab 列，記住上次的 tab。
// popup 只放小工具；大功能（例如課程規劃）請開新的 Chrome 分頁。
import { pickTab } from './lib/tabs.js'
import * as addTab from './popup/tabs/add.js'
import * as scheduleTab from './popup/tabs/schedule.js'

// 調整順序或新增小工具 tab：改這個清單，並在 popup.html 加一個 <template id="tpl-<id>">
const TABS = [
  { id: 'add', label: '加入預排', module: addTab },
  { id: 'schedule', label: '課表', module: scheduleTab },
]

const mounted = new Set()

async function savedTab() {
  try {
    const { popupTab } = await chrome.storage.local.get('popupTab')
    return popupTab
  } catch {
    return undefined
  }
}

function panelFor(tab) {
  let panel = document.querySelector(`.panel[data-tab="${tab.id}"]`)
  if (!panel) {
    panel = document.createElement('section')
    panel.className = 'panel'
    panel.dataset.tab = tab.id
    panel.setAttribute('role', 'tabpanel')
    const tpl = document.getElementById(`tpl-${tab.id}`)
    if (tpl) panel.append(tpl.content.cloneNode(true))
    document.getElementById('panels').append(panel)
  }
  return panel
}

async function select(id, { remember = true } = {}) {
  for (const tab of TABS) {
    const active = tab.id === id
    const button = document.querySelector(`#tabs [data-tab="${tab.id}"]`)
    button.setAttribute('aria-selected', String(active))
    button.tabIndex = active ? 0 : -1
    if (!active) {
      const panel = document.querySelector(`.panel[data-tab="${tab.id}"]`)
      if (panel) panel.hidden = true
      continue
    }
    const panel = panelFor(tab)
    panel.hidden = false
    if (!mounted.has(tab.id)) {
      mounted.add(tab.id)
      await tab.module.mount(panel)
    }
    tab.module.show()
  }
  if (remember) {
    try {
      await chrome.storage.local.set({ popupTab: id })
    } catch {}
  }
}

function renderTabs() {
  const nav = document.getElementById('tabs')
  nav.replaceChildren(
    ...TABS.map((tab) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.setAttribute('role', 'tab')
      b.dataset.tab = tab.id
      b.textContent = tab.label
      b.addEventListener('click', () => select(tab.id))
      return b
    }),
  )
}

async function init() {
  document.getElementById('btn-planner').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/planner.html') }))
  document.getElementById('btn-schedule').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/schedule.html') }))
  document.getElementById('btn-register').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/register.html') }))
  renderTabs()
  await select(pickTab(TABS, await savedTab()), { remember: false })
}

init()
