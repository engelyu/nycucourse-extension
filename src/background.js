// Service worker：負責抓取課程時間表並寫入 chrome.storage.local。
import { crawlSemester } from './lib/crawl.js'
import { isCrawlAlive, createStateWriter } from './lib/crawlState.js'

const BASE = 'https://timetable.nycu.edu.tw/?r=main/'
const REQUEST_TIMEOUT_MS = 30_000

async function fetchJson(fn, { method = 'GET', body } = {}) {
  const res = await fetch(BASE + fn, {
    method,
    body,
    headers: body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {},
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text.trim()) return ''
  return JSON.parse(text)
}

const state = createStateWriter((crawlState) => chrome.storage.local.set({ crawlState }))
let running = null

async function startCrawl() {
  if (running) return running
  const { crawlState } = await chrome.storage.local.get('crawlState')
  if (running) return running
  if (isCrawlAlive(crawlState, Date.now())) return
  running = (async () => {
    state.reset({ status: 'running', phase: 'tree', done: 0, total: 0, startedAt: Date.now() })
    try {
      const { semester, courses } = await crawlSemester({
        fetchJson,
        concurrency: 3,
        onProgress: ({ phase, done, total }) => {
          // 失敗後其他 worker 可能還在回報進度，不要把狀態改回 running
          if (state.current().status === 'running') state.update({ phase, done, total })
        },
      })
      await chrome.storage.local.set({ courseData: { semester, updatedAt: Date.now(), courses } })
      await state.update({ status: 'done' })
    } catch (err) {
      await state.update({ status: 'error', error: err && err.message ? err.message : String(err) })
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
