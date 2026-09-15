// 課程資料更新狀態（chrome.storage.local 的 crawlState）的共用邏輯。

// 超過這麼久沒有任何進度更新，就視為更新已中斷（service worker 被終止或請求卡住）。
// 一個系所最壞要 3 次 30 秒逾時加上 1.5 秒重試等待（91.5 秒）才會回報，所以要留足餘裕。
export const STALE_MS = 150_000

// 超過這麼久沒有進度但還沒中斷，提示使用者是學校網站慢，不是當掉。
export const SLOW_MS = 15_000

export function isCrawlAlive(crawlState, nowMs) {
  if (!crawlState || crawlState.status !== 'running') return false
  const last = crawlState.lastProgressAt ?? crawlState.startedAt ?? 0
  return nowMs - last <= STALE_MS
}

export function formatElapsed(seconds) {
  const s = Math.max(0, Math.floor(seconds))
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`
}

// 把更新狀態轉成 popup 要顯示的文字與進度；不在進行中時回傳 null。
export function describeCrawl(crawlState, nowMs) {
  if (!isCrawlAlive(crawlState, nowMs)) return null
  const done = Number(crawlState.done) || 0
  const total = Number(crawlState.total) || 0
  const startedAt = crawlState.startedAt ?? nowMs
  const last = crawlState.lastProgressAt ?? startedAt
  const elapsed = `已經過 ${formatElapsed((nowMs - startedAt) / 1000)}`
  const slow = nowMs - last > SLOW_MS
  const hint = slow
    ? '學校網站回應較慢，仍在等待中，請稍候…'
    : '約需 1 到 3 分鐘。可以先關閉這個視窗，完成後會自動更新。'

  if (crawlState.phase === 'courses') {
    return {
      title: '步驟 2/2：下載課程資料',
      detail: `${done}/${total} 個系所`,
      percent: total ? Math.floor((done / total) * 100) : 0,
      elapsed,
      slow,
      hint,
    }
  }
  return {
    title: '步驟 1/2：讀取系所清單',
    detail: done ? `已找到 ${done} 個系所` : '連線到課程時間表…',
    percent: null,
    elapsed,
    slow,
    hint,
  }
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
