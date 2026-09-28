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
    // 同一間教室同一時段兩門課（合開），課名很長：列表與週課表都要完整寫出來
    course('700006', '跨領域合開：資料科學與人工智慧應用專題（大學部）', 'R34-EC022[GF]'),
    course('700007', '週三合開的另一門很長的課程名稱：計算思維', 'W34-ED219[GF]'),
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

// ---- 重疊的課全部寫出來 ----
await page.check('input[name="mode"][value="now"]')
const fits = (sel) => page.$$eval(sel, (els) => els.length > 0 && els.every((e) => e.scrollWidth <= e.clientWidth + 1 && getComputedStyle(e).textOverflow !== 'ellipsis'))
const ec022 = await rowOf('EC022')
checks['列表：EC022 同時兩門課都完整寫出'] = ec022.includes('電腦動畫與特效・王老師') && ec022.includes('跨領域合開：資料科學與人工智慧應用專題（大學部）・王老師')
checks['列表：狀態文字沒有被截掉'] = await fits('.room-row .what')
await page.fill('#room-q', 'ED219')
await page.click('#room-matches button >> nth=0')
const wed = await page.$$eval('#room-week .tt-cell[data-key="3-3"] .tt-course .name, #room-week .tt-cell[data-key="3-4"] .tt-course .name', (ns) => ns.map((n) => n.textContent))
checks['週課表：同一節兩門課，接續的節次也寫課名'] = JSON.stringify(wed.slice().sort()) === JSON.stringify(['週三合開的另一門很長的課程名稱：計算思維', '週三合開的另一門很長的課程名稱：計算思維', '週三的課', '週三的課'].sort())
checks['週課表：課名沒有被截掉'] = await fits('#room-week .tt-course .name')
checks['週課表：沒有只剩色條的接續格'] = (await page.$$('#room-week .tt-course.cont')).length === 0
await page.screenshot({ path: SHOTS + 'rooms-3-overlap.png' })

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

// ---- popup：入口與教室現況分頁（簡化版，不出現「空教室」） ----
const popup = await ctx.newPage()
popup.on('pageerror', (e) => errors.push(`popup: ${e}`))
await popup.setViewportSize({ width: 420, height: 600 })
await popup.clock.setFixedTime(new Date('2026-09-24T10:40:00+08:00'))
await popup.goto(`chrome-extension://${extId}/src/popup.html`)
checks['popup 有「教室 ↗」'] = (await popup.textContent('#btn-rooms')) === '教室 ↗'
checks['popup 預設是課表分頁'] = !(await popup.isHidden('#week')) && (await popup.isHidden('#rooms'))
await popup.click('#tab-rooms')
await popup.waitForSelector('.qr-buildings button')
const qrCodes = () => popup.$$eval('.qr-row .code', (cs) => cs.map((c) => c.textContent).join(','))
checks['popup 教室現況：跟教室查詢共用選的大樓'] = JSON.stringify(await popup.$$eval('.qr-buildings button[aria-pressed="true"]', (bs) => bs.map((b) => b.dataset.code))) === '["EC","ED"]'
checks['popup 教室現況：顯示現在時間'] = (await popup.textContent('.qr-now')).includes('週四 10:40')
checks['popup 教室現況：預設只列沒排課的'] = (await qrCodes()) === 'ED219,ED220'
checks['popup 教室現況：分組標題有大樓與樓層'] = (await popup.$$eval('.qr-list h3', (hs) => hs.map((h) => h.textContent))).includes('工程四館・2 樓')
await popup.check('input[name="qr-show"][value="busy"]')
checks['popup 上課中：列出上課中的教室'] = (await qrCodes()) === 'EC022,ED301'
const qrEc = await popup.textContent('.qr-row[data-key="GF:EC022"] .what')
checks['popup 上課中：同時兩門課都寫出來'] = qrEc.includes('電腦動畫與特效') && qrEc.includes('跨領域合開：資料科學與人工智慧應用專題（大學部）')
checks['popup 教室現況：不出現「空教室」'] = !(await popup.textContent('body')).includes('空教室')
checks['popup 沒有橫向捲動'] = await popup.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth)
await popup.screenshot({ path: SHOTS + 'rooms-4-popup.png' })
const [opened] = await Promise.all([ctx.waitForEvent('page'), popup.click('.qr-row[data-key="GF:EC022"]')])
await opened.waitForLoadState()
checks['popup 點教室開教室查詢看週課表'] = opened.url().endsWith('/src/rooms.html?room=EC022')
await popup.click('.qr-buildings button[data-code="EC"]')
const stored = await sw.evaluate(() => chrome.storage.local.get('rooms'))
checks['popup 改大樓會存回教室查詢的設定'] = JSON.stringify(stored.rooms.buildings) === '["ED"]' && stored.rooms.mode === 'now'
await popup.reload()
await popup.waitForSelector('.qr-buildings button')
checks['popup 記住上次開的分頁與顯示'] = (await popup.isHidden('#week')) && (await popup.isChecked('input[name="qr-show"][value="busy"]'))

checks['大樓 API 有被呼叫'] = buildingHits >= 2
checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
