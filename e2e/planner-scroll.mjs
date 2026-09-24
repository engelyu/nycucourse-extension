// 當期選課：寬視窗整頁不捲動、左右兩欄各自捲動；系所搜尋按 Enter（含注音選字的 Enter）不做任何事。
// 用法：node planner-scroll.mjs [擴充功能資料夾，預設 ..]
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
  viewport: { width: 1400, height: 800 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
await ctx.route('https://cos.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host

// 80 門課，讓左欄一定要捲動
const days = 'MTWRF'
const courses = Array.from({ length: 80 }, (_, i) => ({
  id: String(200000 + i), name: `測試課程 ${i}`, ename: '', teacher: '王老師', time: `${days[i % 5]}${(i % 8) + 1}-SC${100 + i}[GF]`,
  credit: '3', type: '選修', dep: i % 2 ? '數學系' : '物理系', deps: [i % 2 ? '數學系' : '物理系'], limit: '50', brief: '', menus: [],
}))
const reg = (id, name, time) => ({ cos_id: id, cos_cname: name, cos_time: time, sFlag: 'F', acy: '115', sem: '1', cos_credit: '3.00' })
await sw.evaluate((data) => chrome.storage.local.set(data), {
  courseData: { semester: '1151', updatedAt: Date.now(), courses },
  schedule: { sources: { registered: { semester: '1151', updatedAt: Date.now(), courses: [reg('1', 'A', 'M1234-X[GF]'), reg('2', 'B', 'T56789-X[GF]'), reg('3', 'C', 'W1234-X[GF]')] } }, manual: [], overrides: {} },
  planner: { selection: [], filters: {}, paneTab: 'filters' },
})

const errors = []
const checks = {}
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`chrome-extension://${extId}/src/planner.html`)
await page.waitForSelector('#select-all')
await page.click('#select-all')
await page.waitForFunction(() => document.querySelectorAll('#results .card').length > 20)

const metrics = () => page.evaluate(() => {
  const r = document.querySelector('.results-pane')
  const p = document.querySelector('.plan-pane')
  const head = document.querySelector('.page-head').getBoundingClientRect()
  return {
    pageScrolls: document.scrollingElement.scrollHeight > window.innerHeight + 1,
    hOverflow: document.scrollingElement.scrollWidth > window.innerWidth + 1,
    scrollY: window.scrollY,
    results: { scrollTop: r.scrollTop, scrollable: r.scrollHeight > r.clientHeight },
    plan: { scrollTop: p.scrollTop, scrollable: p.scrollHeight > p.clientHeight },
    headTop: head.top,
    toolbarTop: document.querySelector('.results-bar').getBoundingClientRect().top,
    tabsTop: document.querySelector('.pane-tabs').getBoundingClientRect().top,
  }
})
const before = await metrics()
checks['寬視窗整頁沒有捲軸'] = !before.pageScrolls && !before.hOverflow
checks['左右兩欄都能自己捲動'] = before.results.scrollable && before.plan.scrollable

// 捲左欄：右欄與頁面不動，頁首與左欄工具列留在原位
const r = await page.locator('.results-pane').boundingBox()
await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2)
await page.mouse.wheel(0, 1500)
await page.waitForTimeout(300)
const afterLeft = await metrics()
checks['捲左欄只動左欄'] = afterLeft.results.scrollTop > 0 && afterLeft.plan.scrollTop === 0 && afterLeft.scrollY === 0
checks['捲左欄時頁首和搜尋列不動'] = afterLeft.headTop === before.headTop && Math.abs(afterLeft.toolbarTop - before.toolbarTop) <= 1

const p = await page.locator('.plan-pane').boundingBox()
await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2)
await page.mouse.wheel(0, 1500)
await page.waitForTimeout(300)
const afterRight = await metrics()
checks['捲右欄只動右欄'] = afterRight.plan.scrollTop > 0 && afterRight.results.scrollTop === afterLeft.results.scrollTop && afterRight.scrollY === 0
checks['捲右欄時分頁列不動'] = Math.abs(afterRight.tabsTop - before.tabsTop) <= 1
await page.screenshot({ path: SHOTS + '6-scrolled.png' })

// 系所：Enter 不選第一個，也不會送出表單重新載入
await page.evaluate(() => { window.__alive = true; document.querySelector('.plan-pane').scrollTop = 0 })
const dept = page.locator('.dept-search')
await dept.scrollIntoViewIfNeeded()
await dept.fill('數學')
await dept.press('Enter')
await page.waitForTimeout(300)
const deptState = async () => page.evaluate(async () => ({
  alive: window.__alive === true,
  chips: document.querySelector('.dept-picker .chips').textContent,
  deps: ((await chrome.storage.local.get('planner')).planner.filters.deps) || [],
}))
const afterEnter = await deptState()
checks['系所按 Enter 不會選第一個'] = afterEnter.deps.length === 0 && afterEnter.chips.includes('不限系所')
checks['系所按 Enter 不會重新載入頁面'] = afterEnter.alive
// 注音選字確定：keydown 帶 isComposing，送出的 Enter 也不能有作用
await dept.evaluate((el) => {
  el.dispatchEvent(new CompositionEvent('compositionstart'))
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true, bubbles: true, cancelable: true }))
  el.dispatchEvent(new CompositionEvent('compositionend', { data: '數學' }))
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }))
})
await page.waitForTimeout(300)
const afterIme = await deptState()
checks['注音選字的 Enter 也不會選系所或重新載入'] = afterIme.alive && afterIme.deps.length === 0
checks['placeholder 不再說 Enter 選第一個'] = !(await dept.getAttribute('placeholder')).includes('Enter')

// 窄視窗：上下排時整頁捲動，沒有水平捲動
await page.setViewportSize({ width: 800, height: 800 })
await page.waitForTimeout(200)
const narrow = await metrics()
checks['窄視窗改回整頁捲動'] = narrow.pageScrolls && !narrow.hOverflow

checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ before, afterLeft, afterRight, afterEnter, afterIme, errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
