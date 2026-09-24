// 頁面與入口：選課頁已經拿掉（功能搬進當期選課），週課表改名「編輯課表」；popup 頁首只剩三個按鈕。
// 用法：node pages.mjs [擴充功能資料夾，預設 ..]
import { chromium } from 'playwright-core'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const EXT = resolve(process.argv[2] || '..')
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'e2e-')), {
  headless: true,
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
await ctx.route('https://cos.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))
await ctx.route('https://timetable.nycu.edu.tw/**', (route) => route.fulfill({ status: 500, body: 'down' }))
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host
const url = (path) => `chrome-extension://${extId}/src/${path}`

const errors = []
const checks = {}
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(url('popup.html'))
const buttons = await page.$$eval('.shell-actions button', (bs) => bs.map((b) => b.textContent))
checks['popup 頁首只有當期選課、教室、編輯課表'] = JSON.stringify(buttons) === JSON.stringify(['當期選課 ↗', '教室 ↗', '編輯課表 ↗'])
const [opened] = await Promise.all([ctx.waitForEvent('page'), page.click('#btn-schedule')])
await opened.waitForLoadState()
checks['編輯課表按鈕開的是課表頁'] = opened.url() === url('schedule.html')
checks['課表頁改名編輯課表'] = (await opened.title()) === '編輯課表' && (await opened.textContent('h1')) === '編輯課表'
checks['編輯課表仍能新增行程'] = (await opened.textContent('#btn-add')) === '新增行程'

// 用另一個分頁開：開不存在的頁面後那個分頁會停在錯誤頁，不影響後面的檢查
const probe = await ctx.newPage()
const gone = await probe.goto(url('register.html')).then(() => false, (e) => String(e).includes('ERR_FILE_NOT_FOUND'))
await probe.close()
checks['選課頁已經拿掉'] = gone

await page.goto(url('planner.html'))
await page.waitForSelector('#legend span')
checks['當期選課圖例指向編輯課表'] = (await page.textContent('#legend')).includes('在「編輯課表」新增、設定顏色')
checks['當期選課有三個分頁'] = JSON.stringify(await page.$$eval('.pane-tabs [role="tab"]', (ts) => ts.map((t) => t.textContent.replace(/ \(\d+\)$/, '')))) === JSON.stringify(['課表預覽', '篩選設定', '自動登記'])

checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ buttons, errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
