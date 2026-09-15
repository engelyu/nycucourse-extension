// 課程資料更新狀態（chrome.storage.local 的 crawlState）的共用邏輯。

// 超過這麼久沒有任何進度更新，就視為更新已中斷（service worker 被終止或請求卡住）。
export const STALE_MS = 90_000

export function isCrawlAlive(crawlState, nowMs) {
  if (!crawlState || crawlState.status !== 'running') return false
  const last = crawlState.lastProgressAt ?? crawlState.startedAt ?? 0
  return nowMs - last <= STALE_MS
}

// 在記憶體保存完整狀態，依呼叫順序整份寫入，避免多個 worker 同時讀寫互相覆蓋。
export function createStateWriter(write, now = () => Date.now()) {
  let state = {}
  let chain = Promise.resolve()
  const enqueue = () => {
    const snapshot = { ...state }
    chain = chain.then(() => write(snapshot)).catch(() => {})
    return chain
  }
  return {
    reset(initial) {
      state = { ...initial, lastProgressAt: now() }
      return enqueue()
    },
    update(patch) {
      state = { ...state, ...patch, lastProgressAt: now() }
      return enqueue()
    },
    current() {
      return { ...state }
    },
  }
}
