// popup 共用的狀態與小工具

export const $ = (sel) => document.querySelector(sel)

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const state = {
  tab: null,
  onCos: false,
  cosReady: false,
  connecting: false, // 正在等選課網頁面的 content script 回應
  reloading: false, // 正在重新整理選課網
  needsReload: false, // 有新加入的課，提示重新整理
  cosSemester: null, // 選課網目前學期
  sysStatus: null, // 選課網負載狀態（sysstatuslvl）
  regStatus: null, // 選課系統是否開放（checkreg）
  counts: {}, // dep_uid -> { at, counts }：即時選課人數的快取
  courseData: undefined,
  crawlState: undefined,
  courses: [],
  updatedAt: undefined,
  startError: '', // 「無法啟動更新」的錯誤，保留到下次按更新
  // id -> 'pending' | {status: 'added'|'exists'|'error', msg}
  addStatus: new Map(),
}

export function code(text) {
  const el = document.createElement('code')
  el.textContent = text
  return el
}

// kind：'error'、'warn'，或 true（等同 'error'）

export function showHint(el, text, kind = '') {
  const k = kind === true ? 'error' : kind || ''
  el.textContent = text
  el.classList.toggle('error', k === 'error')
  el.classList.toggle('warn', k === 'warn')
  el.hidden = !text
}

export function formatTime(ms) {
  const d = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
