// 當期選課「查詢」裡的「變更採計」（從選課頁搬過來）：
// 1. 選修改成核心：先移除再用核心選單加入，預排跟著更新
// 2. 加不回去時還原原本的預排，並說明失敗原因
// 3. 已登記的課不提供變更（採計在登記時就定了）
// 用法：node planner-attribution.mjs [擴充功能資料夾，預設 ..]
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

// 選課網的系所樹（getdep）：開課系所「應用數學系」與「核心課程」選單，結構和真的一樣是七層
const leaf = { label: '全部', value: '*', children: [{ label: '全部年級', value: '*', children: [{ label: '全部', value: '*' }] }] }
const TREE = [{
  label: '學士班課程', value: 1, children: [{
    label: '一般學士班', value: '3*', children: [
      { label: '理學院', value: 'S', children: [{ label: '應用數學系', value: 'DEP-MATH', children: [leaf] }] },
      { label: '學士班共同課程', value: '0C', children: [{ label: '核心課程', value: 'DEP-CORE', children: [leaf] }] },
    ],
  }],
}]
const menu = (dep, cat, college) => ({ type: 1, dep_category: cat, college_no: college, dep_uid: dep, group: '*', grade: '*', class: '*' })
const HOME = menu('DEP-MATH', '3*', 'S')
const HOME_ROW = { cos_id: '112304', cos_cname: '計算機概論', cos_type_code: '2', wType: 'X', wType_cname: '一般課程', GroupName: null, GroupName_E: null, category_type: null, category_cname: null, category_ename: null }
const CORE_ROW = { cos_id: '112304', cos_cname: '計算機概論', cos_type_code: 'E', wType: 'E', wType_cname: '核心課程', GroupName: '核心課程', GroupName_E: 'Core', category_type: 'CAT-Z102', category_cname: '基本素養-量性推理', category_ename: 'Quantitative' }
const entities = (json) => json.replace(/"/g, '&quot;')

// 選課網上的預排（會隨 deletepreregist／setpreregist 改變）
const prereg = new Map([
  ['112304', { cos_id: '112304', cos_cname: '計算機概論', cos_time: 'W56-EC015[GF]', acy: '115', sem: '1', menu_data: entities(JSON.stringify(HOME)), cos_type_code: '2', wType: 'X', category_type: '', category_cname: null, GroupName: null }],
  ['515044', { cos_id: '515044', cos_cname: '已登記的課', cos_time: 'F34-SC105[GF]', acy: '115', sem: '1', menu_data: entities(JSON.stringify(HOME)), cos_type_code: '2', wType: 'X', category_type: '' }],
])
const REGISTERED = [{ cos_id: '515044', cos_cname: '已登記的課', cos_time: 'F34-SC105[GF]', sFlag: '1', acy: '115', sem: '1', cos_credit: '3.00' }]
let failDep = '' // 要讓 setpreregist 失敗的選單
const writes = []
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 8 * 3600 })}.sig`

await ctx.route('https://cos.nycu.edu.tw/**', async (route) => {
  const req = route.request()
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cos</title>' })
  const path = new URL(req.url()).pathname.slice(1)
  const p = Object.fromEntries(new URLSearchParams(req.postData() || ''))
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  if (path === 'checkreg' || path === 'checkdistribute') return json({ status: 'success', cmsg: '', emsg: '' })
  if (path === 'getdep') return json(TREE)
  if (path === 'preregistcourse') return json(p.dep_uid === 'DEP-MATH' ? [HOME_ROW] : p.dep_uid === 'DEP-CORE' ? [CORE_ROW] : [])
  if (path === 'getregistrationcourselist') {
    return json({ [p.cos_id]: { cos_id: p.cos_id, status: 'success', cmsg: '', cos_type_code: '2', wType: 'X', num_limit: '50', registered_num: '10', GroupUID: null, conflict_num: '0' } })
  }
  if (path === 'getpreregist') return json([...prereg.values()])
  if (path === 'getregist') return json(REGISTERED)
  if (path === 'deletepreregist') {
    writes.push({ path, cos_id: p.cos_id })
    prereg.delete(p.cos_id)
    return json([{ status: 'success', msg: '' }])
  }
  if (path === 'setpreregist') {
    const m = JSON.parse(p.menu_data)
    writes.push({ path, cos_id: p.cos_id, dep: m.dep_uid, wType: p.wType, category_type: p.category_type })
    if (m.dep_uid === failDep) return json([{ status: 'error', msg: '模擬選課網拒絕' }])
    const row = m.dep_uid === 'DEP-CORE' ? CORE_ROW : HOME_ROW
    prereg.set(p.cos_id, { cos_id: p.cos_id, cos_cname: row.cos_cname, cos_time: 'W56-EC015[GF]', acy: '115', sem: '1', menu_data: entities(p.menu_data), cos_type_code: row.cos_type_code, wType: p.wType, category_type: p.category_type, category_cname: row.category_cname, GroupName: row.GroupName })
    return json([{ status: 'success', msg: '' }])
  }
  return json([])
})

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host
const course = (id, name, time) => ({ id, name, ename: '', teacher: '王老師', time, credit: '3', type: '選修', dep: '應用數學系', deps: ['應用數學系'], limit: '50', brief: '', menus: [HOME], menu: HOME })
const allSlots = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => ['y', 'z', '1', '2', '3', '4', 'n', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd'].map((p) => `${d}-${p}`))
await sw.evaluate((data) => chrome.storage.local.set(data), {
  courseData: { semester: '1151', updatedAt: Date.now(), courses: [course('112304', '計算機概論', 'W56-EC015[GF]'), course('515044', '已登記的課', 'F34-SC105[GF]')] },
  schedule: {
    sources: {
      registered: { semester: '1151', updatedAt: Date.now(), courses: REGISTERED },
      preregist: { semester: '1151', updatedAt: Date.now(), courses: [...prereg.values()] },
    },
    manual: [],
    overrides: {},
  },
  planner: { selection: allSlots, filters: {}, paneTab: 'preview' },
})
const cos = await ctx.newPage()
await cos.goto('https://cos.nycu.edu.tw/')
await cos.evaluate((t) => sessionStorage.setItem('token', t), TOKEN)

const errors = []
const checks = {}
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(String(e)))
await page.goto(`chrome-extension://${extId}/src/planner.html`)
const card = (id) => page.locator('.card', { hasText: id })
await card('112304').waitFor()
const query = async (id) => {
  await card(id).getByRole('button', { name: /查詢/ }).click()
  await card(id).locator('.query-rows').waitFor()
}

// ---- 1. 選修改成核心 ----
await query('112304')
checks['查詢結果顯示目前的採計'] = (await card('112304').locator('.query-row .how').textContent()) === '選修'
await card('112304').locator('.change-attribution').click()
await card('112304').locator('.attribution-choices').waitFor()
const choices = await card('112304').locator('.attribution-choices button:not(.link)').evaluateAll((bs) => bs.map((b) => [b.textContent, b.disabled]))
checks['列出兩種採計、目前那種不能選'] = JSON.stringify(choices) === JSON.stringify([['選修', true], ['核心・基本素養-量性推理', false]])
await page.screenshot({ path: SHOTS + 'attribution-1-choices.png' })
writes.length = 0
await card('112304').getByRole('button', { name: '核心・基本素養-量性推理' }).click()
await card('112304').getByText('採計已改為「核心・基本素養-量性推理」').waitFor()
checks['先移除再用核心選單加入'] = JSON.stringify(writes) === JSON.stringify([
  { path: 'deletepreregist', cos_id: '112304' },
  { path: 'setpreregist', cos_id: '112304', dep: 'DEP-CORE', wType: 'E', category_type: 'CAT-Z102' },
])
await page.waitForFunction(async () => {
  const { schedule } = await chrome.storage.local.get('schedule')
  const c = schedule.sources.preregist.courses.find((x) => x.cos_id === '112304')
  return c && c.menu_data.includes('DEP-CORE')
})
checks['預排跟著更新成核心'] = true

// ---- 2. 加不回去時還原 ----
await query('112304')
checks['改完後查詢顯示核心'] = (await card('112304').locator('.query-row .how').textContent()) === '核心・基本素養-量性推理'
await card('112304').locator('.change-attribution').click()
await card('112304').locator('.attribution-choices').waitFor()
failDep = 'DEP-MATH'
writes.length = 0
await card('112304').getByRole('button', { name: '選修' }).click()
await card('112304').locator('.query-rows .error').waitFor()
const err = await card('112304').locator('.query-rows .error').textContent()
checks['失敗時說明原因並已還原'] = err.includes('模擬選課網拒絕') && err.includes('已還原原本的預排')
checks['還原用的是原本的核心選單'] = JSON.stringify(writes.map((w) => w.dep || w.path)) === JSON.stringify(['deletepreregist', 'DEP-MATH', 'DEP-CORE'])
checks['預排裡還是核心'] = prereg.get('112304').menu_data.includes('DEP-CORE')
await page.screenshot({ path: SHOTS + 'attribution-2-restored.png' })

// ---- 3. 已登記的課不提供變更 ----
await query('515044')
checks['已登記的課沒有變更採計'] = (await card('515044').locator('.change-attribution').count()) === 0

checks['沒有頁面錯誤'] = errors.length === 0
console.log(JSON.stringify({ writes, errors, checks }, null, 2))
const pass = Object.values(checks).every(Boolean)
console.log(pass ? 'PASS' : 'FAIL')
await ctx.close()
process.exit(pass ? 0 : 1)
