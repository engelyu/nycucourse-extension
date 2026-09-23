// popup 只放課表：開學後點開看一眼就關掉。其他功能（找課、加入預排、更新課程資料）在當期選課頁。
import { mount } from './popup/schedule.js'

function openPage(path) {
  chrome.tabs.create({ url: chrome.runtime.getURL(path) })
}

document.getElementById('btn-planner').addEventListener('click', () => openPage('src/planner.html'))
document.getElementById('btn-schedule').addEventListener('click', () => openPage('src/schedule.html'))
document.getElementById('btn-register').addEventListener('click', () => openPage('src/register.html'))
mount(document.getElementById('week'))
