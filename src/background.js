// Service worker：抓取課程時間表，以及每日自動登記。
import { crawlSemester } from './lib/crawl.js'
import { isCrawlAlive, createStateWriter } from './lib/crawlState.js'
import { nextRunAt, buildPlan, summarizeResults } from './lib/autoreg.js'
import { parseRegInfo, describeAvailability, registerParams, parseRegResult, menuForCourse } from './lib/register.js'

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
      const { semester, courses, failedDeps } = await crawlSemester({
        fetchJson,
        concurrency: 3,
        onProgress: ({ phase, done, total }) => {
          // 失敗後其他 worker 可能還在回報進度，不要把狀態改回 running
          if (state.current().status === 'running') state.update({ phase, done, total })
        },
      })
      const failed = failedDeps.length
      await chrome.storage.local.set({ courseData: { semester, updatedAt: Date.now(), courses, failed } })
      await state.update({ status: 'done', failed })
    } catch (err) {
      await state.update({ status: 'error', error: err && err.message ? err.message : String(err) })
    } finally {
      running = null
    }
  })()
  return running
}

// ---------- 每日自動登記 ----------
// 加退選期間每天開放登記，系統再跑分發，所以想要的課每天都要重登一次。
// 規則：每天只跑一次、每門課只送一次、不重試、每門之間留間隔。

const ALARM = 'autoRegister'
const STEP_DELAY_MS = 2000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function getAuto() {
  const { autoRegister } = await chrome.storage.local.get('autoRegister')
  return { enabled: false, time: '13:00', items: [], lastRun: 0, log: [], ...(autoRegister || {}) }
}

async function setAuto(patch) {
  const current = await getAuto()
  const next = { ...current, ...patch }
  await chrome.storage.local.set({ autoRegister: next })
  return next
}

async function scheduleNext() {
  const cfg = await getAuto()
  await chrome.alarms.clear(ALARM)
  if (!cfg.enabled) return null
  const when = nextRunAt(cfg.time, Date.now(), cfg.lastRun)
  if (!when) return null
  await chrome.alarms.create(ALARM, { when })
  return when
}

function setBadge(results) {
  const failed = results.filter((r) => !r.ok).length
  const text = results.length === 0 ? '' : failed ? '!' : String(results.length - failed)
  chrome.action.setBadgeText({ text })
  chrome.action.setBadgeBackgroundColor({ color: failed ? '#c62828' : '#15803d' })
}

// 找一個選課網分頁；沒有就自己開一個背景分頁，並等 content script 就緒
async function ensureCosTab() {
  const [existing] = await chrome.tabs.query({ url: 'https://cos.nycu.edu.tw/*' })
  const tab = existing || (await chrome.tabs.create({ url: 'https://cos.nycu.edu.tw/#/emulator', active: false }))
  for (let i = 0; i < 40; i++) {
    try {
      const reply = await chrome.tabs.sendMessage(tab.id, { type: 'ping' })
      if (reply && reply.ok) return tab
    } catch {}
    await sleep(500)
  }
  return null
}

async function askTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch (err) {
    return { ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }
  }
}

async function runAutoRegister(trigger = 'alarm') {
  const cfg = await getAuto()
  const finish = async (results, note) => {
    const entry = {
      at: Date.now(),
      trigger,
      note: note || '',
      results,
      summary: results.length ? summarizeResults(results) : note || summarizeResults(results),
    }
    await setAuto({ lastRun: entry.at, log: [entry, ...(cfg.log || [])].slice(0, 20) })
    setBadge(results)
    await scheduleNext()
    return entry
  }

  if (!cfg.items.length) return finish([], '沒有設定要自動登記的課程')

  const tab = await ensureCosTab()
  if (!tab) return finish([], '找不到可用的選課網分頁，請先登入選課網')

  const lists = await askTab(tab.id, { type: 'courses' })
  if (!lists || !lists.ok) {
    return finish([], lists && lists.reason === 'not_logged_in' ? '選課網登入已過期，請重新登入' : '無法讀取選課網資料')
  }
  const registered = Object.fromEntries((lists.registered || []).map((c) => [String(c.cos_id), c]))
  const preregist = Object.fromEntries((lists.preregist || []).map((c) => [String(c.cos_id), c]))
  const plan = buildPlan(cfg.items, registered)

  const results = []
  for (const item of plan.todo) {
    const course = preregist[item.cosId]
    if (!course) {
      results.push({ ...item, ok: false, message: '不在預排課程裡' })
      continue
    }
    const info = await askTab(tab.id, { type: 'reginfo', cosId: item.cosId, menu: menuForCourse(course, null) })
    if (!info || !info.ok) {
      results.push({ ...item, ok: false, message: '查詢失敗' })
      continue
    }
    const record = parseRegInfo(info.json, item.cosId)
    const availability = describeAvailability(record)
    if (!availability.canRegister) {
      results.push({ ...item, ok: false, message: availability.message || '選課網不允許登記' })
      continue
    }
    const sent = await askTab(tab.id, { type: 'register', params: registerParams(record, item.wish) })
    const parsed = sent && sent.ok ? parseRegResult(sent.text) : { ok: false, message: '送出失敗' }
    results.push({ ...item, ok: parsed.ok, message: parsed.ok && item.wish ? `已登記第 ${item.wish} 志願` : parsed.message })
    await sleep(STEP_DELAY_MS)
  }
  return finish(results, plan.todo.length ? '' : '想登記的課都已經登記或選上了')
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) runAutoRegister('alarm')
})
chrome.runtime.onStartup.addListener(() => scheduleNext())
chrome.runtime.onInstalled.addListener(() => scheduleNext())

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false
  if (message.type === 'crawl:start') {
    startCrawl()
    sendResponse({ ok: true })
    return false
  }
  if (message.type === 'auto:get') {
    getAuto().then((cfg) => sendResponse({ ok: true, config: cfg, nextRun: cfg.enabled ? nextRunAt(cfg.time, Date.now(), cfg.lastRun) : null }))
    return true
  }
  if (message.type === 'auto:set') {
    setAuto(message.patch || {}).then(async (cfg) => {
      const when = await scheduleNext()
      if (!cfg.enabled) chrome.action.setBadgeText({ text: '' })
      sendResponse({ ok: true, config: cfg, nextRun: when })
    })
    return true
  }
  if (message.type === 'auto:run') {
    runAutoRegister('manual').then((entry) => sendResponse({ ok: true, entry }))
    return true
  }
  return false
})
