// 與選課網分頁的連線：找分頁、送訊息、重新整理、讀系統狀態。
// 狀態改變時通知各 tab 自己決定要重畫什麼。
import { state, sleep } from './shared.js'
import { parseRegStatus } from '../lib/regstatus.js'

const COS_ORIGIN = 'https://cos.nycu.edu.tw/'

const listeners = new Set()
export function onCosChange(fn) {
  listeners.add(fn)
}
export function notify() {
  for (const fn of listeners) fn()
}

// 連線只做一次：哪個 tab 先開就由它觸發，其他 tab 共用結果
let connection = null
export function connectOnce() {
  if (!connection) connection = detectTab()
  return connection
}

// 任何一個選課網分頁（不一定是目前的分頁）
export async function findCosTab() {
  const tabs = await chrome.tabs.query({ url: 'https://cos.nycu.edu.tw/*' })
  return tabs[0] || null
}

async function ping(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'ping' })
    return Boolean(reply && reply.ok)
  } catch {
    return false
  }
}

async function waitForContentScript(tabId, timeoutMs) {
  const until = Date.now() + timeoutMs
  do {
    if (await ping(tabId)) return true
    await sleep(300)
  } while (Date.now() < until)
  return false
}

// 送訊息到選課網分頁；頁面剛重新整理、content script 還沒載入時，等它就緒再送一次。

export async function send(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    if (!(await waitForContentScript(tabId, 5000))) throw err
    return chrome.tabs.sendMessage(tabId, message)
  }
}

// 等分頁重新載入完成（先看到 loading 再看到 complete）。

function waitForTabReload(tabId, timeoutMs) {
  return new Promise((resolve) => {
    let sawLoading = false
    const finish = (value) => {
      clearTimeout(timer)
      chrome.tabs.onUpdated.removeListener(listener)
      resolve(value)
    }
    const listener = (id, info) => {
      if (id !== tabId) return
      if (info.status === 'loading') sawLoading = true
      if (info.status === 'complete' && sawLoading) finish(true)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    chrome.tabs.onUpdated.addListener(listener)
  })
}

// 重新整理選課網，等頁面載入且 content script 就緒才回傳。

export async function reloadCos() {
  if (!state.tab) return false
  const tabId = state.tab.id
  state.reloading = true
  state.cosReady = false
  state.needsReload = false
  notify()
  const reloaded = waitForTabReload(tabId, 15000)
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'reload' })
  } catch {}
  await reloaded
  state.cosReady = await waitForContentScript(tabId, 5000)
  state.reloading = false
  notify()
  if (state.cosReady) {
    refreshCosSemester()
    refreshSysStatus()
  }
  return state.cosReady
}

export async function detectTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  state.tab = tab || null
  state.onCos = Boolean(tab && tab.url && tab.url.startsWith(COS_ORIGIN))
  state.cosReady = false
  if (!state.onCos) {
    notify()
    return
  }
  state.connecting = true
  notify()
  // 頁面可能剛重新整理，content script 還在載入，稍等一下
  state.cosReady = await waitForContentScript(tab.id, 3000)
  state.connecting = false
  notify()
  if (state.cosReady) {
    refreshCosSemester()
    refreshSysStatus()
  }
}

export async function refreshCosSemester() {
  if (!state.tab || !state.cosReady) return
  try {
    const reply = await chrome.tabs.sendMessage(state.tab.id, { type: 'semester' })
    state.cosSemester = reply && reply.semester ? reply.semester : null
  } catch {
    state.cosSemester = null
  }
  notify()
}

// 讀選課系統是否暫停（checkreg）與負載狀態（sysstatuslvl）。
// 暫停訊息由伺服器提供，例如「分發時間 10:00～12:00 暫停使用選課系統」。

export async function refreshSysStatus() {
  if (!state.tab || !state.cosReady) return
  try {
    const [reg, sys] = await Promise.all([
      chrome.tabs.sendMessage(state.tab.id, { type: 'regstatus' }),
      chrome.tabs.sendMessage(state.tab.id, { type: 'sysstatus' }),
    ])
    state.regStatus = parseRegStatus(reg && reg.json)
    state.sysStatus = sys && sys.status ? sys.status : null
  } catch {
    state.regStatus = null
    state.sysStatus = null
  }
  notify()
}

export async function unavailableMessage() {
  await refreshSysStatus()
  if (state.regStatus && !state.regStatus.open) return `選課系統暫停中：${state.regStatus.message}`
  return '請先登入選課網'
}

// 同一門課在選課網可能有多種採計方式（例如選修或核心），加入預排時就決定了

let depTreePromise = null

export function getDepTree() {
  if (!depTreePromise) {
    depTreePromise = send(state.tab.id, { type: 'deptree' }).then((reply) => {
      if (reply && reply.ok) return reply.tree
      depTreePromise = null
      if (reply && reply.reason === 'not_logged_in') throw Object.assign(new Error('not_logged_in'), { reason: 'not_logged_in' })
      return null
    })
  }
  return depTreePromise
}

export async function getCourseList(menu) {
  const reply = await send(state.tab.id, { type: 'courselist', menu })
  if (reply && reply.ok) return reply.list
  if (reply && reply.reason === 'not_logged_in') throw Object.assign(new Error('not_logged_in'), { reason: 'not_logged_in' })
  throw new Error((reply && reply.detail) || '選課網沒有回應')
}

// 查不到（例如課程資料太舊）時回傳空陣列，照舊方式加入
