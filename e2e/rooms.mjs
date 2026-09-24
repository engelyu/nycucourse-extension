// 教室查詢頁 E2E：假課程資料＋攔截官方大樓 API，時鐘固定在 2026-09-24（週四）10:40。
// 用法：node rooms.mjs <擴充功能資料夾>
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

const RAW_BUILDINGS = {
  'Guang-Fu': {
    cname: '新竹光復校區', ename: 'Guang-Fu Campus', campus_code: '[GF]', build_num: 2, map: '',
    code: { EC: { cname: '工程三館', ename: 'Engineering Building 3' }, ED: { cname: '工程四館', ename: 'Engineering Building IV' } },
  },
  'Yang-Ming': { cname: '台北陽明校區', ename: 'Yang-Ming Campus', campus_code: '[YM]', build_num: 1, map: '', code: { YT: { cname: '教學大樓', ename: 'Teaching Building' } } },
}
let buildingsUp = false // 第一次開頁時大樓 API 壞掉，驗證頁面照常能用
let buildingHits = 0
await ctx.route('https://timetable.nycu.edu.tw/**', (route) => {
  buildingHits++
  if (!buildingsUp) return route.fulfill({ status: 500, body: 'down' })
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RAW_BUILDINGS) })
})
await ctx.route('https://cos.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host
const course = (id, name, time) => ({ id, name, ename: '', teacher: '王老師', time, credit: '3', type: '選修', dep: '資工系', deps: ['資工系'], limit: '50', brief: '', menus: [] })
await sw.evaluate((courseData) => chrome.storage.local.set({ courseData }), {
  semester: '1151',
  updatedAt: Date.now(),
  courses: [
    course('515500', '計算機概論與程式設計', 'M56R2-EC022[GF]'),
    course('535654', '電腦動畫與特效', 'R34-EC022[GF]'),
    course('515505', '演算法概論', 'T34R7-EC022[GF]'),
    course('700001', '週三的課', 'W34-ED219[GF]'),
    course('700002', '傍晚的課', 'R78-ED220[GF]'),
    course('700003', '第三節', 'R3-ED301[GF]'),
    course('700004', '沒有教室', 'R34-'),
    course('700005', '陽明的課', 'R34-YT206[YM]'),
  ],
})

const errors = []
const checks = {}
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
await page.clock.setFixedTime(new Date('2026-09-24T10:40:00+08:00'))
const rowsText = () => page.$$eval('.room-row', (rows) => rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()))
const rowOf = async (code) => (await rowsText()).find((t) => t.startsWith(code)) || ''
const codes = () => page.$$eval('.room-row .code', (cs) => cs.map((c) => c.textContent).join(','))

// ---- 大樓 API 壞掉：頁面照常能用，大樓只顯示代碼 ----
await page.goto(`chrome-extension://${extId}/src/rooms.html`)
await page.waitForSelector('#buildings button')
checks['大樓 API 壞掉時按鈕只顯示代碼'] = (await page.$$eval('#buildings button', (bs) => bs.map((b) => b.dataset.code + '|' + b.textContent))).some((t) => t.startsWith('ED|ED'))
checks['沒選大樓時提示先選'] = (await page.textContent('#room-list')).includes('先選一棟或幾棟大樓')
checks['固定說明文字'] = (await page.textContent('.notice')).includes('只根據課程資料：考試、演講、教室借用不在內，「沒有排課」不代表一定沒人。')
checks['全頁沒有「空教室」'] = !(await page.textContent('body')).includes('空教室')

// ---- 大樓 API 恢復後重新整理：顯示官方名稱 ----
buildingsUp = true
await page.reload()
await page.waitForSelector('#buildings button')
checks['大樓顯示官方名稱'] = (await page.textContent('#buildings')).includes('工程四館')
await page.click('#buildings button[data-code="EC"]')
await page.click('#buildings button[data-code="ED"]')
const groups = await page.$$eval('#room-list h2, #room-list h3', (hs) => hs.map((h) => h.textContent.trim()))
checks['依大樓、樓層分組'] = JSON.stringify(groups) === JSON.stringify(['工程三館 EC', '0 字頭', '工程四館 ED', '2 樓', '3 樓'])
checks['EC022 週四 10:40 上課中到 12:00'] = /上課中.*電腦動畫與特效.*到 12:00/.test(await rowOf('EC022'))
checks['ED219 今天之後沒有排課'] = /沒有排課.*今天之後沒有排課/.test(await rowOf('ED219'))
checks['ED220 到 15:30 前沒有排課'] = (await rowOf('ED220')).includes('到 15:30 前沒有排課')
checks['ED301 上課中到 11:00'] = /上課中.*到 11:00/.test(await rowOf('ED301'))
checks['顯示沒有填教室的課程數'] = (await page.textContent('#no-room')).includes('另有 1 門課沒有填教室')
await page.screenshot({ path: SHOTS + 'rooms-1-now.png' })

// ---- 樓層與顯示篩選 ----
await page.click('#floors button[data-floor="2"]')
checks['只看 2 樓'] = (await codes()) === 'ED219,ED220'
await page.click('#floors button[data-floor="2"]')
await page.check('input[name="show"][value="free"]')
checks['只看沒排課'] = (await rowsText()).every((t) => t.includes('沒有排課')) && (await rowsText()).length === 2
await page.check('input[name="show"][value="busy"]')
checks['只看上課中'] = (await rowsText()).every((t) => t.includes('上課中')) && (await rowsText()).length === 2
await page.check('input[name="show"][value="all"]')

// ---- 指定時間：週四 14:30 ----
await page.check('input[name="mode"][value="custom"]')
await page.selectOption('#day', '4')
await page.fill('#time', '14:30')
await page.dispatchEvent('#time', 'change')
checks['指定週四 14:30：EC022 到 15:30 前沒有排課'] = (await rowOf('EC022')).includes('到 15:30 前沒有排課')
checks['指定週四 14:30：ED301 今天之後沒有排課'] = (await rowOf('ED301')).includes('今天之後沒有排課')

// ---- 找教室 ----
await page.fill('#room-q', 'ed2')
await page.press('#room-q', 'Enter') // Enter 不能有作用
checks['找教室按 Enter 不會選'] = !(await page.textContent('#room-head')).includes('ED2')
const matches = await page.$$eval('#room-matches button', (bs) => bs.map((b) => b.textContent))
checks['找教室 ed2 列出 ED219、ED220'] = matches.length === 2 && matches[0].startsWith('ED219') && matches[1].startsWith('ED220')
await page.click('#room-matches button >> nth=1')
checks['右欄顯示 ED220'] = (await page.textContent('#room-head h2')).startsWith('ED220')
checks['週課表有這間的課'] = (await page.$$eval('#room-week .tt-course', (bs) => bs.map((b) => b.title))).some((t) => t.includes('傍晚的課'))
checks['選定時間（週四第 6 節）的格子標亮'] = await page.$eval('#room-week .tt-cell[data-key="4-6"]', (c) => c.classList.contains('preview'))
checks['選中的那一列有標示'] = (await page.getAttribute('.room-row[aria-current="true"]', 'data-key')) === 'GF:ED220'
await page.screenshot({ path: SHOTS + 'rooms-2-room.png' })

// ---- 網址帶教室 ----
// 時間模式會存進 storage，先切回「現在」（週四 10:40，EC022 上課中），新開的頁面才看得到上課中的課與大綱連結
await page.check('input[name="mode"][value="now"]')
const direct = await ctx.newPage()
direct.on('pageerror', (e) => errors.push(String(e)))
await direct.clock.setFixedTime(new Date('2026-09-24T10:40:00+08:00'))
await direct.goto(`chrome-extension://${extId}/src/rooms.html?room=ec022`)
await direct.waitForSelector('#room-head h2')
checks['rooms.html?room=ec022 直接開 EC022'] = (await direct.textContent('#room-head h2')).startsWith('EC022')
checks['右欄狀態列有課程大綱連結'] = (await direct.getAttribute('#room-head a', 'href') || '').includes('crsoutline')

// ---- 寬視窗整頁不捲動 ----
checks['寬視窗整頁不捲動'] = await page.evaluate(() => document.scrollingElement.scrollHeight <= window.innerHeight + 1)

// ---- popup 入口 ----
const popup = await ctx.newPage()
await popup.goto(`chrome-extension://${extId}/src/popup.html`)
checks['popup 有「教室 ↗」'] = (await popup.textContent('#btn-rooms')) === '教室 ↗'

checks['大樓 API 有被呼叫'] = buildingHits >= 2
checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
