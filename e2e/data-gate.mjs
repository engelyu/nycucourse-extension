// 沒有課程資料時，每個介面都先擋住，只給「下載課程資料」按鈕；下載完成後自動解除，之後每個頁面都有「更新課程資料」。
// 課程時間表用假資料（第一次故意失敗，驗證失敗訊息與重按）。
// 用法：node data-gate.mjs [擴充功能資料夾，預設 ..]
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
  viewport: { width: 1400, height: 900 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})

// 假的課程時間表：一個學院、兩個系所、三門課
let timetableUp = false
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const course = (id, name, time, dep) => ({ cos_id: id, cos_cname: name, cos_ename: '', teacher: '王老師', cos_time: time, cos_credit: '3.00', cos_type: '必修', dep_cname: dep, num_limit: '50', reg_num: '10' })
const LISTS = {
  'DEP-A': { 'DEP-A': { 1: { a1: course('516700', '線性代數（一）', 'M56W34-SA321[GF]', '應用數學系'), a2: course('516713', '數學寫作', 'R34-SA320[GF]', '應用數學系') }, brief: {} } },
  'DEP-B': { 'DEP-B': { 1: { b1: course('515500', '計算機概論與程式設計', 'M56R2-EC022[GF]', '資訊工程學系') }, brief: {} } },
}
await ctx.route('https://timetable.nycu.edu.tw/**', async (route) => {
  const req = route.request()
  const fn = new URL(req.url()).searchParams.get('r') || ''
  const p = Object.fromEntries(new URLSearchParams(req.postData() || ''))
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  if (!timetableUp) return route.fulfill({ status: 500, body: 'down' })
  if (fn === 'main/get_acysem') return json([{ T: '1151' }])
  if (fn === 'main/get_type') return json([{ uid: 'TYPE-1', type: '1' }])
  if (fn === 'main/get_category') return json({ '3*': '一般學士班' })
  if (fn === 'main/get_college') return json({ S: '理學院' })
  if (fn === 'main/get_dep') return json({ 'DEP-A': '應用數學系', 'DEP-B': '資訊工程學系' })
  if (fn === 'main/get_cos_list') {
    await sleep(800) // 慢一點才看得到進度
    return json(LISTS[p.m_dep_uid] || {})
  }
  if (fn === 'main/get_classroom_code') return route.fulfill({ status: 500, body: 'down' })
  return json({})
})
await ctx.route('https://cos.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host

const errors = []
const checks = {}
const open = async (path, viewport) => {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${path}: ${e}`))
  if (viewport) await page.setViewportSize(viewport)
  await page.goto(`chrome-extension://${extId}/src/${path}`)
  await page.waitForSelector('.data-gate', { state: 'attached' })
  return page
}
const gateShown = (page) => page.locator('.data-gate').isVisible()
const PAGES = { popup: 'popup.html', planner: 'planner.html', rooms: 'rooms.html', schedule: 'schedule.html' }
const pages = {}
for (const [name, path] of Object.entries(PAGES)) {
  pages[name] = await open(path, name === 'popup' ? { width: 420, height: 600 } : null)
  await pages[name].locator('.data-gate:not([hidden])').waitFor()
  checks[`${name}：沒有資料時擋住`] = await gateShown(pages[name])
  checks[`${name}：卡片上是「下載課程資料」`] = (await pages[name].locator('.data-gate .btn-crawl').textContent()) === '下載課程資料'
}
await pages.popup.screenshot({ path: SHOTS + 'data-gate-popup.png' })
await pages.rooms.screenshot({ path: SHOTS + 'data-gate-rooms.png' })

// 第一次下載失敗：說明原因，還是擋住，可以再按
const rooms = pages.rooms
await rooms.click('.data-gate .btn-crawl')
await rooms.locator('.data-gate .crawl-error:not([hidden])').waitFor({ timeout: 30000 })
checks['失敗時說明原因'] = (await rooms.locator('.data-gate .crawl-error').textContent()).startsWith('下載失敗')
checks['失敗後還是擋住'] = await gateShown(rooms)
checks['失敗後按鈕可以再按'] = await rooms.locator('.data-gate .btn-crawl').isEnabled()

// 第二次成功：顯示進度，完成後自動解除
timetableUp = true
await rooms.click('.data-gate .btn-crawl')
await rooms.locator('.data-gate .crawl-progress:not([hidden])').waitFor()
checks['下載時顯示進度'] = true
await rooms.screenshot({ path: SHOTS + 'data-gate-progress.png' })
await rooms.locator('.data-gate').waitFor({ state: 'hidden', timeout: 60000 })
checks['教室查詢：下載完自動解除'] = !(await gateShown(rooms))
await rooms.locator('#buildings button').first().waitFor()
checks['教室查詢：有資料後列出大樓'] = (await rooms.locator('#buildings button').count()) > 0
checks['教室查詢：標題旁顯示資料狀態'] = /^1151 學期 · 3 門 · /.test(await rooms.locator('#crawl .data-status').textContent())
checks['教室查詢：標題旁可以更新'] = (await rooms.locator('#crawl .btn-crawl').textContent()) === '更新課程資料'
await rooms.screenshot({ path: SHOTS + 'data-gate-rooms-ready.png' })

// 其他已經開著的頁面不用重新整理也解除，而且都有更新的地方
for (const name of ['popup', 'planner', 'schedule']) {
  const page = pages[name]
  await page.locator('.data-gate').waitFor({ state: 'hidden', timeout: 10000 })
  checks[`${name}：自動解除`] = !(await gateShown(page))
  checks[`${name}：頁面上有「更新課程資料」`] = await page.locator('#crawl .btn-crawl', { hasText: '更新課程資料' }).isVisible()
  checks[`${name}：顯示資料狀態`] = /^1151 學期 · 3 門 · /.test(await page.locator('#crawl .data-status').textContent())
}
checks['當期選課：列出課程'] = await pages.planner.locator('#results .card').first().isVisible().catch(() => false) || (await pages.planner.locator('#summary').textContent()).length > 0
await pages.popup.screenshot({ path: SHOTS + 'data-gate-popup-ready.png' })

// 有資料之後重新開的頁面不會再擋
const fresh = await open('schedule.html')
await fresh.waitForTimeout(500)
checks['有資料後新開的頁面不擋'] = !(await gateShown(fresh))

// 有資料時在當期選課按更新：頁面照常可用，更新完資料時間會變
const before = await pages.planner.locator('#crawl .data-status').textContent()
await pages.planner.waitForTimeout(1100) // 讓更新時間的分鐘數有機會不同不重要；這裡只看流程走完
await pages.planner.click('#crawl .btn-crawl')
await pages.planner.locator('#crawl .crawl-progress:not([hidden])').waitFor()
checks['更新時不擋住頁面'] = !(await gateShown(pages.planner))
await pages.planner.locator('#crawl .crawl-progress').waitFor({ state: 'hidden', timeout: 60000 })
checks['更新完顯示資料狀態'] = /^1151 學期 · 3 門 · /.test(await pages.planner.locator('#crawl .data-status').textContent()) && before.length > 0

checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
