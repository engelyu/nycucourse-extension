// 重現 2026-09-23 選課結束後的選課網：權杖改存 sessionStorage（每個分頁各自一份），
// localStorage 只剩改版前的過期權杖。開兩個選課網分頁：先開的沒登入、後開的已登入。
// 同時照 2026-09-23 選課結束後實測：checkreg 回「選課結束」、getregist 回空白、getsemregist 要帶學年學期才有資料。
// 在當期選課頁按「從選課網更新狀態」，應該用已登入分頁的權杖讀到正式選課與預排。
// 用法：node session-token.mjs [擴充功能資料夾，預設 ..]
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const EXT = resolve(process.argv[2] || '..')
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (p) => `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url(p)}.sig`
const now = Math.floor(Date.now() / 1000)
const FRESH = jwt({ user: 'x', exp: now + 8 * 3600 })
const STALE = jwt({ user: 'x', exp: now - 11 * 3600 })

const registered = [{ cos_id: '515044', cos_cname: '實變函數論(一)', cos_time: 'M34-SC101[GF]', sFlag: 'F', acy: '115', sem: '1', cos_credit: '3.00' }]
const preregist = [{ cos_id: '112304', cos_cname: '測試預排課', cos_time: 'W56-EC015[GF]', acy: '115', sem: '1', menu_data: '{&quot;type&quot;:1,&quot;dep_uid&quot;:&quot;D1&quot;}', wType: 'X' }]

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'e2e-')), {
  headless: true, channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const auths = []
await ctx.route('https://cos.nycu.edu.tw/**', async (route) => {
  const req = route.request()
  const path = new URL(req.url()).pathname.slice(1)
  const params = Object.fromEntries(new URLSearchParams(req.postData() || ''))
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cos</title><p>cos mock</p>' })
  const auth = (req.headers().authorization || '').replace('Bearer ', '')
  auths.push({ path, token: auth === FRESH ? 'fresh' : auth === STALE ? 'stale' : auth ? 'other' : 'none' })
  // 實測：沒帶權杖 → HTTP 200 空白；權杖不對 → HTTP 404 {"status":false,"msg":"Token verification failed"}
  if (!auth) return route.fulfill({ status: 200, contentType: 'text/html', body: '' })
  if (auth !== FRESH) return route.fulfill({ status: 404, contentType: 'application/json', body: '{"status":false,"msg":"Token verification failed"}' })
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  if (path === 'getregist') return route.fulfill({ status: 200, contentType: 'text/html', body: '' })
  if (path === 'getsemregist') return params.acy === '115' && params.sem === '1' ? json(registered) : json({ status: 'error', msg: 'Sorry, something went wrong.' })
  if (path === 'getpreregist') return json(preregist)
  if (path === 'checkreg') return json({ status: 'error', cmsg: '選課結束', emsg: 'End of course selection' })
  if (path === 'checkdistribute') return json({ status: 'success', cmsg: '', emsg: '' })
  if (path === 'sysstatuslvl') return json([{ status: '1', cmsg: '系統暢通無阻' }])
  if (path === 'userinfo') return json({ lastacysem: '1151', regist_acysem: [{ acy: 115, acysem: '1151', sem: '1' }, { acy: 114, acysem: '1143', sem: 'X' }] })
  return json([])
})

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host

// 先開的分頁：沒登入（sessionStorage 空），localStorage 有改版前的過期權杖
const loggedOut = await ctx.newPage()
await loggedOut.goto('https://cos.nycu.edu.tw/')
await loggedOut.evaluate((t) => localStorage.setItem('token', t), STALE)
// 後開的分頁：已登入，權杖只在這個分頁的 sessionStorage
const loggedIn = await ctx.newPage()
await loggedIn.goto('https://cos.nycu.edu.tw/')
await loggedIn.evaluate((t) => sessionStorage.setItem('token', t), FRESH)
await loggedIn.waitForTimeout(500)

const planner = await ctx.newPage()
const errors = []
planner.on('pageerror', (e) => errors.push(String(e)))
await planner.goto(`chrome-extension://${extId}/src/planner.html`)
await planner.waitForSelector('#refresh-status')
await planner.click('#refresh-status')
await planner.waitForFunction(() => !document.querySelector('#refresh-status').disabled && document.querySelector('#status-at').textContent !== '更新中…', null, { timeout: 15000 })
const statusText = await planner.textContent('#status-at')
const banner = await planner.evaluate(() => { const b = document.querySelector('#sys-banner'); return !b || b.hidden ? '' : b.textContent })
const stored = await planner.evaluate(async () => {
  const { schedule } = await chrome.storage.local.get('schedule')
  const ids = (n) => ((schedule && schedule.sources && schedule.sources[n] && schedule.sources[n].courses) || []).map((c) => c.cos_id)
  return { registered: ids('registered'), preregist: ids('preregist') }
})
const readCalls = auths.filter((a) => ['getregist', 'getpreregist', 'getsemregist'].includes(a.path))

const checks = {
  狀態列顯示更新時間而不是錯誤: /^狀態更新於/.test(statusText),
  讀到正式選課: stored.registered.includes('515044'),
  讀到預排: stored.preregist.includes('112304'),
  讀取用的是已登入分頁的權杖: readCalls.length > 0 && readCalls.every((a) => a.token === 'fresh'),
  停機橫幅照實說選課結束而不是等開放: banner.includes('選課結束') && !banner.includes('等開放'),
  沒有頁面錯誤: errors.length === 0,
}
console.log(JSON.stringify({ statusText, banner, stored, readCalls, errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
