// 當期選課的「自動登記」分頁（從選課頁搬過來）：加入清單、開關與時間、立刻執行一次、移除、記住分頁。
// 假選課網回「選課結束」，所以「立刻執行一次」會真的跑背景程式，但不會送出任何登記。
// 用法：node planner-auto.mjs [擴充功能資料夾，預設 ..]
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

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 8 * 3600 })}.sig`
const prereg = (id, name, time) => ({ cos_id: id, cos_cname: name, cos_time: time, acy: '115', sem: '1', menu_data: '{&quot;type&quot;:1,&quot;dep_uid&quot;:&quot;D1&quot;}', wType: 'X', cos_type_code: '2' })
const PREREG = [prereg('515044', '實變函數論(一)', 'M34-SC101[GF]'), prereg('112304', '計算機概論', 'W56-EC015[GF]')]
const cosCalls = []
await ctx.route('https://cos.nycu.edu.tw/**', async (route) => {
  const req = route.request()
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cos</title>' })
  const path = new URL(req.url()).pathname.slice(1)
  cosCalls.push(path)
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  if (path === 'checkreg') return json({ status: 'error', cmsg: '選課結束', emsg: 'End of course selection' })
  if (path === 'getpreregist') return json(PREREG)
  if (path === 'getregist') return json([])
  return json([])
})

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host
await sw.evaluate((schedule) => chrome.storage.local.set({ schedule, courseData: { semester: '1151', updatedAt: Date.now(), courses: [{ id: '100001', name: '線性代數', ename: '', teacher: '王老師', time: 'M34-SC101[GF]', credit: '3', type: '必修', dep: '數學系', deps: ['數學系'], limit: '50', brief: '', menus: [] }] } }), {
  sources: { registered: { semester: '1151', updatedAt: Date.now(), courses: [] }, preregist: { semester: '1151', updatedAt: Date.now(), courses: PREREG } },
  manual: [],
  overrides: {},
})
// 已登入的選課網分頁：背景程式執行自動登記時要用它
const cos = await ctx.newPage()
await cos.goto('https://cos.nycu.edu.tw/')
await cos.evaluate((t) => sessionStorage.setItem('token', t), TOKEN)

const errors = []
const checks = {}
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`chrome-extension://${extId}/src/planner.html`)
await page.waitForSelector('#tab-auto')
await page.click('#tab-auto')
const text = (sel) => page.textContent(sel)
const options = () => page.$$eval('#auto-course option', (os) => os.map((o) => o.value))
await page.waitForFunction(() => document.querySelector('#auto-next').textContent !== '')

checks['有自動登記分頁'] = await page.evaluate(() => !document.querySelector('#panel-auto').hidden && document.querySelector('#panel-preview').hidden)
checks['一開始是關閉'] = (await text('#auto-next')) === '目前關閉'
checks['清單是空的'] = (await text('#auto-list')).includes('清單是空的')
checks['課程選單列出預排的課'] = JSON.stringify(await options()) === JSON.stringify(['515044', '112304'])

await page.selectOption('#auto-course', '515044')
await page.selectOption('#auto-wish', '2')
await page.click('#auto-add')
await page.waitForFunction(() => document.querySelector('#auto-list').textContent.includes('515044'))
checks['加入清單後顯示課名與志願'] = (await text('#auto-list')).includes('515044 實變函數論(一)　第 2 志願')
checks['加入的課不再出現在選單'] = JSON.stringify(await options()) === JSON.stringify(['112304'])

await page.check('#auto-enabled')
await page.waitForFunction(() => document.querySelector('#auto-next').textContent.startsWith('下次執行：'))
checks['打開後顯示下次執行時間'] = /^下次執行：\d+\/\d+ 13:00$/.test(await text('#auto-next'))
await page.fill('#auto-time', '11:00')
await page.dispatchEvent('#auto-time', 'change')
await page.waitForFunction(() => !document.querySelector('#auto-warning').hidden)
checks['分發時段的時間會提醒'] = (await text('#auto-warning')).includes('10:00 到 12:00')
await page.fill('#auto-time', '13:00')
await page.dispatchEvent('#auto-time', 'change')
await page.waitForFunction(() => document.querySelector('#auto-warning').hidden)

cosCalls.length = 0
await page.click('#auto-run')
await page.waitForFunction(() => /自動登記：/.test(document.querySelector('#auto-message').textContent), null, { timeout: 30000 })
checks['立刻執行一次：選課結束時照實說明'] = (await text('#auto-message')) === '自動登記：選課系統暫停中：選課結束'
checks['執行紀錄記下手動執行'] = /手動　選課系統暫停中：選課結束/.test(await text('#auto-log'))
checks['選課結束時沒有送出任何登記'] = !cosCalls.includes('setregist')
await page.screenshot({ path: SHOTS + 'planner-auto.png' })

await page.reload()
await page.waitForSelector('#tab-auto')
await page.waitForFunction(() => document.querySelector('#auto-next').textContent !== '')
checks['重新整理後停在自動登記分頁'] = await page.evaluate(() => !document.querySelector('#panel-auto').hidden)
checks['設定有存起來'] = await page.isChecked('#auto-enabled')
await page.click('#auto-list button')
await page.waitForFunction(() => document.querySelector('#auto-list').textContent.includes('清單是空的'))
checks['移除後清單是空的'] = true

checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
