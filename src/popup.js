import { mount, show } from './popup/tabs/add.js'

document.querySelector('#btn-schedule').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/schedule.html') }))
document.querySelector('#btn-register').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('src/register.html') }))
mount().then(show)
