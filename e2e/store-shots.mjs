// 商店截圖：真實課程資料（課程時間表 115 上）＋假選課網，拍原始畫面後排成 1280×800 的商店圖。
// 不連真正的選課網；課表裡的課是挑出來的示範課程，沒有任何人的個資。
// 用法：node store-shots.mjs [擴充功能資料夾，預設 ..]
//   課程資料：環境變數 COURSES（預設 ~/nycucourse-data/timetable-history/1151.json，get_cos_list 原始列）
//   大樓對照：環境變數 BUILDINGS（預設同資料夾最新的 classroom-code-*.json）
// 輸出：e2e/shots/store/raw-*.png（原始畫面）與 ../store/images/screenshot-1..5.png
import { chromium } from 'playwright-core'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const EXT = resolve(process.argv[2] || '..')
const DATA = join(homedir(), 'nycucourse-data', 'timetable-history')
const COURSES = process.env.COURSES || join(DATA, '1151.json')
const BUILDINGS = process.env.BUILDINGS || join(DATA, readdirSync(DATA).filter((f) => f.startsWith('classroom-code-')).sort().at(-1))
const RAW = new URL('./shots/store/', import.meta.url).pathname
const OUT = join(EXT, 'store', 'images')
mkdirSync(RAW, { recursive: true })

// 週四 10:40：popup 紅線落在第 3 節，教室頁「現在」有課
const NOW = new Date('2026-09-24T10:40:00+08:00')
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'store-')), {
  headless: true,
  channel: 'chromium',
  timezoneId: 'Asia/Taipei',
  locale: 'zh-TW',
  viewport: { width: 1400, height: 900 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=zh-TW'],
})

// ---------- 課程資料：原始列轉成擴充功能的格式 ----------
const menu = (dep, cat, college) => ({ type: 1, dep_category: cat, college_no: college, dep_uid: dep, group: '*', grade: '*', class: '*' })
const HOME = menu('DEP-HOME', '3*', 'S')
const CORE = menu('DEP-CORE', '0C', '0C')
const raw = JSON.parse(readFileSync(COURSES, 'utf8')).courses
const courses = raw.map((c) => {
  const brief = [...new Set((c._brief || []).flatMap((k) => k.split(',')).map((k) => k.trim()).filter(Boolean))]
  const core = c.cos_type === '核心'
  return {
    id: c.cos_id, name: c.cos_cname, ename: c.cos_ename, teacher: c.teacher, time: c.cos_time, credit: c.cos_credit,
    type: c.cos_type, dep: c.dep_cname, limit: c.num_limit, enrolled: c.reg_num, deps: c._deps || [],
    ...(brief.length ? { brief } : {}), menu: HOME, menus: core ? [HOME, CORE] : [HOME],
  }
})
const byId = new Map(raw.map((c) => [c.cos_id, c]))
const cosRow = (id, extra = {}) => {
  const c = byId.get(id)
  return { cos_id: id, cos_cname: c.cos_cname, cos_time: c.cos_time, lecturers: c.teacher, cos_credit: c.cos_credit, num_limit: c.num_limit, registered_num: c.reg_num, acy: '115', sem: '1', ...extra }
}
const entities = (json) => json.replace(/"/g, '&quot;')

// 示範課表：應數系大一上
const REGISTERED = [
  cosRow('516700', { sFlag: 'F' }), // 線性代數（一）
  cosRow('516713', { sFlag: 'F' }), // 數學寫作
  cosRow('516701', { sFlag: 'F' }), // 計算機概論（一）
  cosRow('561068', { sFlag: '2', GroupUID: 'G-CORE' }), // 生死學：第 2 志願
]
const PREREG = [
  cosRow('536700', { menu_data: entities(JSON.stringify(HOME)), cos_type_code: '2', wType: 'X' }), // 實變函數論（一）
  cosRow('561068', { menu_data: entities(JSON.stringify(CORE)), cos_type_code: 'E', wType: 'E', category_type: 'CAT-A505', category_cname: '領域課程', GroupName: '核心課程' }),
]
const QUERY_ID = '161002' // 易經與玄學：查詢示範，選修與核心兩種採計
const row = (id, core) => ({
  cos_id: id, cos_cname: byId.get(id).cos_cname, cos_type_code: core ? 'E' : '2', wType: core ? 'E' : 'X',
  wType_cname: core ? '核心課程' : '一般課程', GroupName: core ? '核心課程' : null, GroupName_E: core ? 'Core' : null,
  category_type: core ? 'CAT-A505' : null, category_cname: core ? '領域課程' : null, category_ename: core ? 'Domain' : null,
})
const leaf = { label: '全部', value: '*', children: [{ label: '全部年級', value: '*', children: [{ label: '全部', value: '*' }] }] }
const TREE = [{
  label: '學士班課程', value: 1, children: [{
    label: '一般學士班', value: '3*', children: [
      { label: '理學院', value: 'S', children: [{ label: '開課系所', value: 'DEP-HOME', children: [leaf] }] },
      { label: '學士班共同課程', value: '0C', children: [{ label: '核心課程', value: 'DEP-CORE', children: [leaf] }] },
    ],
  }],
}]
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const TOKEN = `${b64url({ typ: 'JWT', alg: 'HS256' })}.${b64url({ exp: Math.floor(Date.now() / 1000) + 8 * 3600 })}.sig`

await ctx.route('https://cos.nycu.edu.tw/**', async (route) => {
  const req = route.request()
  if (req.method() === 'GET') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>cos</title>' })
  const path = new URL(req.url()).pathname.slice(1)
  const p = Object.fromEntries(new URLSearchParams(req.postData() || ''))
  if (process.env.DEBUG) console.log('cos', path, JSON.stringify(p).slice(0, 200))
  const json = (b) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) })
  if (path === 'checkreg' || path === 'checkdistribute') return json({ status: 'success', cmsg: '', emsg: '' })
  if (path === 'getdep') return json(TREE)
  if (path === 'preregistcourse') return json(p.dep_uid === 'DEP-CORE' ? [row(QUERY_ID, true)] : [row(QUERY_ID, false)])
  if (path === 'getregistrationcourselist') {
    const core = p.wType === 'E' || /CAT-/.test(p.category_type || '')
    return json({ [p.cos_id]: { cos_id: p.cos_id, status: 'success', cmsg: '', cos_type_code: core ? 'E' : '2', wType: core ? 'E' : 'X', num_limit: '40', registered_num: '28', GroupUID: core ? 'G-CORE' : null, conflict_num: '0', first_wish_reserved_num: '31', second_wish_reserved_num: '12', third_wish_reserved_num: '5' } })
  }
  // 志願群組：第 2 志願已經給了生死學
  if (path === 'getCosCategoryWish') return json({ 'G-CORE': { GroupName: '核心課程', wish_limit: '6', cos_limit: '1', wish: { 1: '0', 2: '1', 3: '0', 4: '0', 5: '0', 6: '0', F: '0' } } })
  // 登記前會先加入預排；確認視窗只拍畫面，不按送出，所以 setregist 不會被呼叫
  if (path === 'setpreregist') {
    if (!PREREG.some((c) => c.cos_id === p.cos_id)) {
      PREREG.push(cosRow(p.cos_id, { menu_data: entities(p.menu_data), cos_type_code: p.wType === 'E' ? 'E' : '2', wType: p.wType, category_type: p.category_type, category_cname: p.category_type ? '領域課程' : null, GroupName: p.wType === 'E' ? '核心課程' : null }))
    }
    return json([{ status: 'success', msg: '', cmsg: '' }])
  }
  if (path === 'getpreregist') return json(PREREG)
  if (path === 'getregist') return json(REGISTERED)
  return json([])
})
const BUILDING_JSON = readFileSync(BUILDINGS, 'utf8')
await ctx.route('https://timetable.nycu.edu.tw/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: BUILDING_JSON }))

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const extId = new URL(sw.url()).host
const at = +NOW
await sw.evaluate((data) => chrome.storage.local.set(data), {
  courseData: { semester: '1151', updatedAt: at - 3 * 3600e3, courses },
  schedule: {
    sources: {
      registered: { semester: '1151', updatedAt: at - 3600e3, courses: REGISTERED },
      preregist: { semester: '1151', updatedAt: at - 3600e3, courses: PREREG },
    },
    manual: [{ key: 'manual:guitar', source: 'manual', cosId: '', semester: '', title: '吉他社', teacher: '', credit: '', limit: '', enrolled: '', note: '', url: '', color: '#CC79A7', slots: [{ day: 2, period: 'a', room: '活動中心', campus: '' }, { day: 2, period: 'b', room: '活動中心', campus: '' }] }],
    overrides: { 'registered:516700': { url: 'https://e3p.nycu.edu.tw/' } },
  },
  autoRegister: {
    enabled: true, time: '13:00', lastRun: at - 21.5 * 3600e3,
    items: [{ cosId: '561068', wish: '2', title: '生死學' }, { cosId: '536700', wish: '', title: '實變函數論（一）' }],
    log: [{
      at: at - 21.5 * 3600e3, trigger: 'alarm', note: '',
      results: [{ cosId: '561068', title: '生死學', ok: true, message: '已登記第 2 志願' }, { cosId: '536700', title: '實變函數論（一）', ok: true, message: '登記成功' }],
      summary: '成功 2 門、失敗 0 門：生死學 已登記第 2 志願；實變函數論（一） 登記成功',
    }],
  },
})
const cos = await ctx.newPage()
await cos.goto('https://cos.nycu.edu.tw/')
await cos.evaluate((t) => sessionStorage.setItem('token', t), TOKEN)

const errors = []
const open = async (path, viewport) => {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${path}: ${e}`))
  await page.clock.setFixedTime(NOW)
  if (viewport) await page.setViewportSize(viewport)
  await page.goto(`chrome-extension://${extId}/src/${path}`)
  return page
}
const settle = (page) => page.waitForTimeout(600)

// 1. popup 課表：點開線性代數看詳細
{
  const page = await open('popup.html', { width: 480, height: 720 })
  await page.getByText('線性代數', { exact: false }).first().click()
  await settle(page)
  // 裁到最後一個看得到的元素下緣，popup 本身下面沒有內容
  const box = await page.evaluate(() => {
    const bottom = Math.max(...[...document.querySelectorAll('body *')].filter((e) => e.offsetParent && e.getBoundingClientRect().height).map((e) => e.getBoundingClientRect().bottom))
    return { width: Math.ceil(document.body.getBoundingClientRect().width), height: Math.ceil(bottom + 12) }
  })
  await page.screenshot({ path: RAW + 'raw-1-popup.png', clip: { x: 0, y: 0, width: box.width, height: box.height } })
}

// 2. 當期選課：一鍵帶入空堂，看能上的課
{
  const page = await open('planner.html')
  await page.click('#tab-filters')
  await page.click('#select-free')
  await page.locator('#filters label', { hasText: '光復' }).first().click()
  await page.locator('#filters label', { hasText: '核心・領域課程' }).first().click()
  await page.locator('#results .card').first().waitFor()
  await settle(page)
  await page.screenshot({ path: RAW + 'raw-2-planner.png' })
}

// 3. 查詢：易經與玄學兩種採計方式，按登記出現確認視窗
{
  const page = await open('planner.html')
  await page.click('#tab-preview')
  await page.fill('#keyword', '易經與玄學')
  const card = page.locator('.card', { hasText: QUERY_ID })
  await card.waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: RAW + 'debug-3.png' }); throw e })
  await card.getByRole('button', { name: /查詢/ }).click()
  await card.locator('.query-rows').waitFor({ timeout: 8000 }).catch(async (e) => { await page.screenshot({ path: RAW + 'debug-3.png' }); throw e })
  await settle(page)
  await page.screenshot({ path: RAW + 'raw-3a-query.png' })
  await card.locator('.query-row', { hasText: '核心' }).getByRole('button', { name: /登記/ }).click()
  await page.waitForSelector('dialog[open]', { timeout: 10000 }).catch(() => {})
  await settle(page)
  await page.screenshot({ path: RAW + 'raw-3b-confirm.png' })
}

// 4. 教室查詢：工程三館，看現在誰在上課、點一間看一週課表
{
  const page = await open('rooms.html')
  await page.locator('#buildings button, #buildings label', { hasText: '工程三館' }).first().click()
  await page.locator('.room-row').first().waitFor()
  await page.locator('.room-row', { hasText: 'EC022' }).first().click().catch(() => page.locator('.room-row').first().click())
  await settle(page)
  await page.screenshot({ path: RAW + 'raw-4-rooms.png' })
}

// 5. 自動登記分頁
{
  const page = await open('planner.html')
  await page.fill('#keyword', '')
  await page.click('#tab-auto')
  await page.waitForFunction(() => document.querySelector('#auto-next').textContent !== '')
  await settle(page)
  await page.screenshot({ path: RAW + 'raw-5-auto.png' })
}


// ---------- 排成 1280×800 的商店圖 ----------
const img = (name) => `data:image/png;base64,${readFileSync(RAW + name).toString('base64')}`
const icon = `data:image/png;base64,${readFileSync(join(EXT, 'store', 'images', 'store-icon-128.png')).toString('base64')}`
const CSS = `
  * { box-sizing: border-box; margin: 0; }
  body { width: 1280px; height: 800px; overflow: hidden; font-family: 'PingFang TC', 'Noto Sans TC', sans-serif; color: #111827;
    background: linear-gradient(135deg, #eef4ff 0%, #f6f9ff 55%, #eef7f1 100%); }
  .brand { display: flex; align-items: center; gap: 12px; color: #1d4ed8; font-weight: 700; font-size: 22px; }
  .brand img { width: 44px; height: 44px; }
  h1 { font-size: 40px; line-height: 1.3; font-weight: 800; letter-spacing: 1px; }
  ul { list-style: none; padding: 0; display: grid; gap: 14px; font-size: 20px; color: #374151; }
  li { display: flex; gap: 14px; align-items: baseline; }
  li::before { content: ''; flex: none; width: 10px; height: 10px; border-radius: 2px; background: #2563eb; transform: translateY(-2px); }
  .card { background: #fff; border-radius: 18px; box-shadow: 0 18px 50px rgba(30, 64, 175, .16); overflow: hidden; }
  .card img { display: block; }
  .side { display: flex; align-items: center; height: 100%; padding: 0 96px; gap: 72px; }
  .side .text { flex: 1; display: grid; gap: 28px; }
  .side .card img { width: 480px; }
  .top { padding: 36px 56px 0; display: grid; gap: 22px; }
  .top header { display: flex; justify-content: space-between; align-items: flex-end; gap: 32px; }
  .top header .text { display: grid; gap: 12px; }
  .top ul { font-size: 18px; gap: 10px; padding-bottom: 4px; }
  .top .card { height: 610px; }
  .top .card img { width: 1168px; }
`
const brand = `<div class="brand"><img src="${icon}">NYCU 預排課程匯入</div>`
const bullets = (items) => `<ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul>`
const side = (title, items, shot) => `<div class="side"><div class="text">${brand}<h1>${title}</h1>${bullets(items)}</div><div class="card"><img src="${img(shot)}"></div></div>`
const top = (title, items, shot, offsetY = 0) => `<div class="top"><header><div class="text">${brand}<h1>${title}</h1></div>${bullets(items)}</header><div class="card"><img src="${img(shot)}" style="margin-top:-${offsetY}px"></div></div>`
const SLIDES = [
  side('點開就看到<br>這週的課表', ['今天那一欄加深，紅線只畫在今天', '點一堂課看教室、老師、E3 連結', '一鍵開啟當期選課、教室查詢、編輯課表'], 'raw-1-popup.png'),
  top('框選空堂，找出能上的課', ['全選、空堂、清除，或按住拖曳框選時段', '左邊結果、右邊課表與篩選，寬度可拖曳調整'], 'raw-2-planner.png'),
  top('查詢、登記，一次看懂', ['每種採計方式能不能選、人數、志願序', '送出前一定再確認一次，不提供退選'], 'raw-3b-confirm.png'),
  top('這間教室現在有人上課嗎？', ['選大樓、樓層，看每間上課中或空到幾點', '點教室看一週課表：找旁聽、找自習空間'], 'raw-4-rooms.png'),
  top('每日自動登記', ['指定課程、志願和時間，每天自動登記', '已選上不重送；暫停或沒登入時不送出並留紀錄'], 'raw-5-auto.png'),
]
const slide = await ctx.newPage()
await slide.setViewportSize({ width: 1280, height: 800 })
for (const [i, html] of SLIDES.entries()) {
  await slide.setContent(`<!doctype html><meta charset="utf-8"><style>${CSS}</style>${html}`)
  await slide.evaluate(() => Promise.all([...document.images].map((im) => im.decode())))
  await slide.screenshot({ path: join(OUT, `screenshot-${i + 1}.png`), scale: 'css' })
}
console.log(`store images → ${OUT}`)

console.log(errors.length ? `page errors:\n${errors.join('\n')}` : 'raw shots ok')
await ctx.close()
