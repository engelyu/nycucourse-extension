// popup：課表與教室現況兩個分頁，點開看一眼就關掉。其他功能（找課、加入預排、正式選課、自動登記、更新課程資料）在當期選課頁，
// 教室現況是教室查詢頁的簡化版（只看現在）。記住上次開的分頁。
import { mount } from './popup/schedule.js'
import { mountRooms } from './popup/rooms.js'

function openPage(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) })
}

document.getElementById('btn-planner').addEventListener('click', () => openPage('src/planner.html'))
document.getElementById('btn-rooms').addEventListener('click', () => openPage('src/rooms.html'))
document.getElementById('btn-schedule').addEventListener('click', () => openPage('src/schedule.html'))
mount(document.getElementById('week'))

const TABS = { week: document.getElementById('tab-week'), rooms: document.getElementById('tab-rooms') }
let roomsMounted = false

function showTab(name) {
  for (const [key, tab] of Object.entries(TABS)) {
    tab.setAttribute('aria-selected', String(key === name))
    document.getElementById(key).hidden = key !== name
  }
  if (name === 'rooms' && !roomsMounted) {
    roomsMounted = true
    mountRooms(document.getElementById('rooms'))
  }
}

for (const [key, tab] of Object.entries(TABS)) {
  tab.addEventListener('click', () => {
    showTab(key)
    chrome.storage.local.set({ popupTab: key }).catch(() => {})
  })
}
chrome.storage.local.get('popupTab').then(({ popupTab }) => {
  if (popupTab === 'rooms') showTab('rooms')
}).catch(() => {})
