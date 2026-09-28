// 0.11.0：當期選課（全選／空堂／清除、更新課程資料、左右分割＋tab）與 popup（只剩課表、紅線只在今天）。
// 用法：node planner-layout.mjs [擴充功能資料夾，預設 ..]
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const EXT = resolve(process.argv[2] || '..')
const SHOTS = new URL('./shots/', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'e2e-')), {
  headless: true,
  channel: 'chromium',
  timezoneId: 'Asia/Taipei',
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
// 課程時間表網站一律失敗：驗證「更新課程資料」按鈕確實叫背景程式去抓，失敗時顯示原因並保留舊資料
let timetableHits = 0
await ctx.route('https://timetable.nycu.edu.tw/**', (route) => {
  timetableHits++
  return route.fulfill({ status: 500, body: 'down' })
})
await ctx.route('https://cos.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host

const course = (id, name, time, extra = {}) => ({ id, name, ename: '', teacher: '王老師', time, credit: '3', type: '選修', dep: '數學系', deps: ['數學系'], limit: '50', brief: '', menus: [], ...extra })
const courseData = {
  semester: '1151',
  updatedAt: Date.UTC(2026, 8, 20, 4, 0),
  courses: [
    course('100001', '線性代數', 'M34-SC101[GF]'),
    course('100002', '微積分', 'T12-SC102[GF]'),
    course('100003', '機率', 'W56-SC103[GF]'),
    course('100004', '統計', 'R78-SC104[GF]'),
    course('100005', '實變函數論(一)', 'F34-SC105[GF]'),
  ],
}
const reg = (id, name, time, sFlag) => ({ cos_id: id, cos_cname: name, cos_time: time, sFlag, acy: '115', sem: '1', cos_credit: '3.00' })
const schedule = {
  sources: {
    registered: { semester: '1151', updatedAt: Date.now(), courses: [reg('515044', '實變函數論(一)', 'M34-SC101[GF]', 'F'), reg('515045', '等分發的課', 'T12-SC102[GF]', '1'), reg('515046', '今天的課', 'W3456-SC103[GF]', 'F')] },
    preregist: { semester: '1151', updatedAt: Date.now(), courses: [{ cos_id: '112304', cos_cname: '預排課', cos_time: 'R78-EC015[GF]', acy: '115', sem: '1' }] },
  },
  manual: [{ key: 'manual:job', source: 'manual', id: 'job', title: '打工', slots: [{ day: 5, period: '3' }] }],
  overrides: {},
}
await sw.evaluate((data) => chrome.storage.local.set(data), { courseData, schedule })

const errors = []
const checks = {}
const planner = await ctx.newPage()
planner.on('pageerror', (e) => errors.push(`planner: ${e}`))
await planner.goto(`chrome-extension://${extId}/src/planner.html`)
await planner.waitForSelector('#tab-preview')

// ---- tab ----
checks['預設是課表預覽 tab'] = await planner.evaluate(() => !document.querySelector('#panel-preview').hidden && document.querySelector('#panel-filters').hidden)
checks['沒有舊的篩選按鈕與浮動面板'] = await planner.evaluate(() => !document.querySelector('#filter-toggle') && !document.querySelector('#filter-panel'))
await planner.screenshot({ path: SHOTS + '1-preview.png' })
await planner.click('#tab-filters')
checks['點篩選設定切到篩選 tab'] = await planner.evaluate(() => document.querySelector('#panel-preview').hidden && !document.querySelector('#panel-filters').hidden)

// ---- 時段：全選／空堂／清除 ----
const count = () => planner.textContent('#count')
await planner.click('#select-all')
checks['全選 = 112 格'] = (await count()) === '已選 112 格'
await planner.click('#select-free')
const free = await planner.evaluate(async () => (await chrome.storage.local.get('planner')).planner.selection)
checks['空堂 = 扣掉已選上的 6 格（M34、W3456）'] = free.length === 106 && !free.includes('1-3') && !free.includes('3-5')
checks['空堂不避開已登記、預排、私人行程'] = ['2-1', '2-2', '4-7', '4-8', '5-3'].every((k) => free.includes(k))
checks['按鈕只剩全選、空堂、清除'] = await planner.evaluate(() => !document.querySelector('#fill-registered') && !document.querySelector('#fill-all') && ['全選', '空堂', '清除'].every((t) => [...document.querySelectorAll('.panel-block .toolbar button')].some((b) => b.textContent === t)))
checks['篩選 tab 標籤顯示套用數'] = /^篩選設定 \(\d+\)$/.test(await planner.textContent('#tab-filters'))
await planner.screenshot({ path: SHOTS + '2-filters.png' })
await planner.click('#clear')
checks['清除 = 0 格'] = (await count()) === '已選 0 格'
await planner.click('#undo')
checks['復原回到空堂'] = (await count()) === '已選 106 格'

// ---- 分割 ----
const widths = () => planner.evaluate(() => ({
  left: document.querySelector('.results-pane').getBoundingClientRect().width,
  right: document.querySelector('.plan-pane').getBoundingClientRect().width,
}))
const handle = await planner.locator('#splitter').boundingBox()
const y = handle.y + 200
const drag = async (toX) => {
  const h = await planner.locator('#splitter').boundingBox()
  await planner.mouse.move(h.x + h.width / 2, y)
  await planner.mouse.down()
  await planner.mouse.move(toX, y, { steps: 8 })
  await planner.mouse.up()
}
await drag(20)
const minL = await widths()
checks['左欄拖不到 340px 以下'] = Math.round(minL.left) === 340
await drag(1390)
const minR = await widths()
checks['右欄拖不到 480px 以下'] = Math.round(minR.right) === 480
await drag(700)
const mid = await widths()
checks['拖到中間時寬度跟著改'] = mid.left > 500 && mid.left < 700
await planner.focus('#splitter')
await planner.keyboard.press('ArrowRight')
const afterKey = await widths()
checks['鍵盤 → 加寬 16px'] = Math.round(afterKey.left - mid.left) === 16
await planner.reload()
await planner.waitForSelector('#tab-preview')
await planner.waitForTimeout(300)
const reloaded = await widths()
checks['重新整理後保留寬度'] = Math.abs(reloaded.left - afterKey.left) <= 1
checks['重新整理後保留 tab'] = await planner.evaluate(() => !document.querySelector('#panel-filters').hidden)

// ---- 窄視窗改上下排 ----
await planner.setViewportSize({ width: 800, height: 900 })
await planner.waitForTimeout(200)
const stacked = await planner.evaluate(() => {
  const l = document.querySelector('.results-pane').getBoundingClientRect()
  const r = document.querySelector('.plan-pane').getBoundingClientRect()
  return { handleHidden: getComputedStyle(document.querySelector('#splitter')).display === 'none', below: r.top >= l.bottom - 1, overflow: document.documentElement.scrollWidth > window.innerWidth }
})
checks['窄視窗：分隔線藏起來、右欄在下面、沒有水平捲動'] = stacked.handleHidden && stacked.below && !stacked.overflow
await planner.screenshot({ path: SHOTS + '3-narrow.png', fullPage: true })
await planner.setViewportSize({ width: 1400, height: 900 })

// ---- 更新課程資料 ----
checks['有更新課程資料按鈕與資料狀態'] = (await planner.textContent('#crawl .btn-crawl')) === '更新課程資料' && /1151 學期 · 5 門/.test(await planner.textContent('#crawl .data-status'))
// 模擬的失敗回得很快，進度可能一閃而過：點之前先掛 MutationObserver 記錄有沒有出現過
await planner.evaluate(() => {
  window.__sawProgress = false
  const box = document.querySelector('#crawl .crawl-progress')
  new MutationObserver(() => { if (!box.hidden) window.__sawProgress = true }).observe(box, { attributes: true, attributeFilter: ['hidden'] })
})
await planner.click('#crawl .btn-crawl')
await planner.waitForTimeout(300)
checks['按下後出現進度'] = await planner.evaluate(() => window.__sawProgress)
await planner.waitForFunction(() => /更新失敗/.test(document.querySelector('#crawl .crawl-error').textContent), null, { timeout: 60000 })
checks['抓不到時顯示更新失敗並保留舊資料'] = /已保留原本的課程資料/.test(await planner.textContent('#crawl .crawl-error')) && /5 門/.test(await planner.textContent('#crawl .data-status'))
checks['背景程式真的去抓課程時間表'] = timetableHits > 0
await planner.screenshot({ path: SHOTS + '4-crawl-error.png' })

// ---- popup ----
const popup = await ctx.newPage()
popup.on('pageerror', (e) => errors.push(`popup: ${e}`))
await popup.setViewportSize({ width: 420, height: 640 })
await popup.clock.setFixedTime(new Date('2026-09-23T10:40:00+08:00')) // 週三 第 4 節
await popup.goto(`chrome-extension://${extId}/src/popup.html`)
await popup.waitForSelector('.mini-week .block')
const pop = await popup.evaluate(() => {
  const line = document.querySelector('.mini-week .now')
  const today = document.querySelector('.mini-week .day-head.today')
  const a = line && line.getBoundingClientRect()
  const b = today && today.getBoundingClientRect()
  return {
    text: document.body.innerText,
    hasSearch: Boolean(document.querySelector('input[type="search"]')),
    line: a && { left: a.left, width: a.width, top: a.top },
    today: b && { left: b.left, width: b.width, text: today.textContent },
  }
})
checks['popup 沒有加入預排、沒有搜尋'] = !pop.text.includes('加入預排') && !pop.hasSearch
checks['紅線只在今天那一欄'] = Boolean(pop.line && pop.today) && Math.abs(pop.line.left - pop.today.left) <= 1 && Math.abs(pop.line.width - pop.today.width) <= 1
await popup.screenshot({ path: SHOTS + '5-popup.png' })

checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ pop: { line: pop.line, today: pop.today }, widths: { minL, minR, mid, afterKey, reloaded }, errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
