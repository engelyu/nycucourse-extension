// Service worker：負責抓取課程時間表並寫入 chrome.storage.local。
import { crawlSemester } from './lib/crawl.js'

const BASE = 'https://timetable.nycu.edu.tw/?r=main/'
const STALE_MS = 5 * 60 * 1000

async function fetchJson(fn, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + fn, {
    method,
    body,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.trim()) return ''
  return JSON.parse(text)
}

let running = null

async function setState(patch) {
  const { crawlState = {} } = await chrome.storage.local.get('crawlState')
  await chrome.storage.local.set({ crawlState: { ...crawlState, ...patch } })
}

async function startCrawl() {
  if (running) return running
  const { crawlState } = await chrome.storage.local.get('crawlState')
  if (crawlState && crawlState.status === 'running' && Date.now() - crawlState.startedAt < STALE_MS) {
    // 另一個 worker 實例仍在跑（理論上不會發生，保險起見）
    return
  }
  running = (async () => {
    const startedAt = Date.now()
    await chrome.storage.local.set({
      crawlState: { status: 'running', phase: 'tree', done: 0, total: 0, startedAt },
    })
    try {
      const { semester, courses } = await crawlSemester({
        fetchJson,
        concurrency: 3,
        onProgress: ({ phase, done, total }) => setState({ phase, done, total }),
      })
      await chrome.storage.local.set({ courseData: { semester, updatedAt: Date.now(), courses } })
      await setState({ status: 'done' })
    } catch (err) {
      await setState({ status: 'error', error: err && err.message ? err.message : String(err) })
    } finally {
      running = null
    }
  })()
  return running
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'crawl:start') {
    startCrawl()
    sendResponse({ ok: true })
  }
  return false
})
