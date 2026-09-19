// 只在 https://cos.nycu.edu.tw/* 執行。所有 API 呼叫都是同源，帶頁面的 Bearer token。
// src/lib/classify.js 由 manifest 先載入，提供 globalThis.NycuClassify。
const { classifyResult, runBatch, tokenUsable, parseSysStatus } = globalThis.NycuClassify
const BASE = 'https://cos.nycu.edu.tw/'

function token() {
  return localStorage.getItem('token') || ''
}

const isOk = (status) => status >= 200 && status < 300

async function post(path, params) {
  const body = new URLSearchParams(params).toString()
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Bearer ' + token(),
    },
    body,
  })
  return { status: res.status, text: await res.text() }
}

// 網路錯誤會丟出例外，由 runBatch 處理；HTTP 錯誤回傳失敗結果。
// params 是選好採計方式後的加入參數（和選課網送出的一樣）；沒有就用舊的空選單加入。
async function addOne(id, params) {
  const { status, text } = await post('setpreregist', params || {
    cos_id: id,
    menu_data: '{}',
    wType: 'X',
    GroupName: 'null',
    GroupName_E: 'null',
    category_type: '',
    category_cname: 'null',
    category_ename: 'null',
  })
  return classifyResult(id, text, status)
}

// 改採計方式：選課網的預排一個課號只能一筆，要先移除再用新的選單加入。
// 加不回去時用原本的參數還原，避免課從預排消失。
async function changePreregist(id, params, previous) {
  if (!tokenUsable(token(), Date.now())) return { ok: false, reason: 'not_logged_in' }
  const removed = await post('deletepreregist', { cos_id: id })
  if (!isOk(removed.status)) return { ok: true, result: { id, status: 'error', msg: `移除失敗（HTTP ${removed.status}）` } }
  const result = await addOne(id, params)
  if (result.status === 'added') return { ok: true, result }
  const restored = previous ? await addOne(id, previous) : null
  const note = restored && restored.status === 'added' ? '，已還原原本的預排' : '，而且無法還原原本的預排，請到選課網重新加入'
  return { ok: true, result: { ...result, status: 'error', msg: `${result.msg || '加入失敗'}${note}` } }
}

// 選課網某個選單底下的課程清單，同一頁面短時間內重複使用
const listCache = new Map()
const LIST_FRESH_MS = 3 * 60_000
async function courseList(menu) {
  if (!tokenUsable(token(), Date.now())) return null
  const m = menu || {}
  const key = JSON.stringify(m)
  const hit = listCache.get(key)
  if (hit && Date.now() - hit.at < LIST_FRESH_MS) return hit.list
  const { status, text } = await post('preregistcourse', {
    type: m.type ?? '',
    dep_category: m.dep_category ?? '',
    college_no: m.college_no ?? '',
    dep_uid: m.dep_uid ?? '',
    group: m.group ?? '',
    grade: m.grade ?? '',
    class: m.class ?? '',
    codition: '',
  })
  if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
  if (!text.trim()) return null
  const list = JSON.parse(text)
  listCache.set(key, { at: Date.now(), list })
  return list
}

// 回傳預排課號；登入失效時選課網回空字串，這時回傳 null。
async function currentPreregistIds() {
  const { status, text } = await post('getpreregist', {})
  if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
  if (!text.trim()) return null
  const list = JSON.parse(text)
  return Array.isArray(list) ? list.map((c) => String(c.cos_id)) : []
}

async function importIds(ids, params = {}) {
  if (!tokenUsable(token(), Date.now())) return { ok: false, reason: 'not_logged_in' }
  return runBatch(ids, (id) => addOne(id, params[id]), currentPreregistIds)
}

// 選課網目前的學期，取自 userinfo 的 lastacysem（例如 1151）；讀不到就回傳 null。
async function currentSemester() {
  if (!tokenUsable(token(), Date.now())) return null
  const { status, text } = await post('userinfo', {})
  if (!isOk(status) || !text.trim()) return null
  try {
    const info = JSON.parse(text)
    const s = info && info.lastacysem
    return typeof s === 'string' && /^\d{3}[\dX]$/.test(s) ? s : null
  } catch {
    return null
  }
}

// 選課網的負載狀態（sysstatuslvl）。注意：分發暫停時它仍回「系統暢通無阻」，不能拿來判斷開不開放。
async function sysStatus() {
  if (!tokenUsable(token(), Date.now())) return null
  const { status, text } = await post('sysstatuslvl', {})
  if (!isOk(status)) return null
  return parseSysStatus(text)
}

// 選課系統目前是否開放（checkreg）。暫停時回 { status: 'error', cmsg: '…暫停使用選課系統…' }。
async function regStatus() {
  if (!tokenUsable(token(), Date.now())) return null
  const { status, text } = await post('checkreg', {})
  if (!isOk(status) || !text.trim()) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// 課表用：抓預排與正式選課的課程清單
async function courseLists() {
  if (!tokenUsable(token(), Date.now())) return null
  const read = async (path) => {
    const { status, text } = await post(path, {})
    if (!isOk(status) || !text.trim()) return null
    const list = JSON.parse(text)
    return Array.isArray(list) ? list : []
  }
  const [preregist, registered] = await Promise.all([read('getpreregist'), read('getregist')])
  if (preregist === null && registered === null) return null
  // 讀取失敗的清單回傳 null（不是空陣列），呼叫端才知道要保留原本的資料
  const slim = (list) => (list === null ? null : list.map((c) => ({
    cos_id: c.cos_id,
    cos_cname: c.cos_cname,
    cos_time: c.cos_time,
    lecturers: c.lecturers,
    cos_credit: c.cos_credit,
    num_limit: c.num_limit,
    registered_num: c.registered_num,
    memo: c.memo,
    acy: c.acy,
    sem: c.sem,
    // 選課網自己記下的查詢路徑與通識類別，加選時要用（通識課用課程時間表的路徑查不到）
    menu_data: c.menu_data,
    category_type: c.category_type,
    category_cname: c.category_cname,
    // 採計方式：顯示用，變更失敗時也要用它們還原
    cos_type_code: c.cos_type_code,
    wType: c.wType,
    GroupName: c.GroupName,
    GroupName_E: c.GroupName_E,
    category_ename: c.category_ename,
    // 分發課程登記志願後 sFlag 是志願序，分發完成才是 F
    sFlag: c.sFlag,
    GroupUID: c.GroupUID,
  })))
  return { preregist: slim(preregist), registered: slim(registered) }
}

// 正式選課：查一門課能不能加選（等同選課網按下加選時做的檢查）
async function regInfo({ cosId, menu }) {
  if (!tokenUsable(token(), Date.now())) return null
  const m = menu || {}
  const { status, text } = await post('getregistrationcourselist', {
    cos_id: cosId,
    type: m.type ?? '',
    dep_category: m.dep_category ?? '',
    college_no: m.college_no ?? '',
    dep_uid: m.dep_uid ?? '',
    group: m.group ?? '*',
    grade: m.grade ?? '*',
    class: m.class ?? '*',
    category_type: m.category_type ?? '',
  })
  if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
  if (!text.trim()) return null
  return JSON.parse(text)
}

// 分發群組（體育、通識等）的志願狀態
async function wishGroups() {
  if (!tokenUsable(token(), Date.now())) return null
  const { status, text } = await post('getCosCategoryWish', {})
  if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
  if (!text.trim()) return null
  return JSON.parse(text)
}

// 選課網的系所樹（含院共同、校共同課程的課程群組），同一頁面只抓一次
let depTreeCache = null
async function depTree() {
  if (depTreeCache) return depTreeCache
  if (!tokenUsable(token(), Date.now())) return null
  const { status, text } = await post('getdep', { lang: 'tw' })
  if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
  if (!text.trim()) return null
  depTreeCache = JSON.parse(text)
  return depTreeCache
}

// 正式選課：送出加選。呼叫端要先確認過，這裡只負責送出並回傳原始回應。
async function register(params) {
  if (!tokenUsable(token(), Date.now())) return null
  const { status, text } = await post('setregist', {
    cos_id: params.cos_id,
    cos_type_code: params.cos_type_code,
    wType: params.wType,
    wish: params.wish,
    category_type: params.category_type,
  })
  if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
  return text
}

// 即時選課人數：以系所為單位查詢，一次拿回整個系所的課
async function deptCounts(menus) {
  if (!tokenUsable(token(), Date.now())) return null
  const out = {}
  for (const menu of Array.isArray(menus) ? menus : []) {
    const { status, text } = await post('preregistcourse', {
      type: menu.type ?? '',
      dep_category: menu.dep_category ?? '',
      college_no: menu.college_no ?? '',
      dep_uid: menu.dep_uid ?? '',
      group: menu.group ?? '*',
      grade: menu.grade ?? '*',
      class: menu.class ?? '*',
      codition: '',
    })
    if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
    if (!text.trim()) return null
    out[menu.dep_uid] = JSON.parse(text)
  }
  return out
}

// 同一分頁的請求排隊依序處理：連續按好幾個「加入」時，對選課網的請求仍然一次一個。
let queue = Promise.resolve()
function serial(task) {
  const run = queue.then(task, task)
  queue = run.catch(() => {})
  return run
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false
  if (message.type === 'ping') {
    sendResponse({ ok: true })
    return false
  }
  if (message.type === 'reload') {
    sendResponse({ ok: true })
    setTimeout(() => location.reload(), 100)
    return false
  }
  if (message.type === 'import') {
    const ids = Array.isArray(message.ids) ? message.ids : []
    const params = message.params && typeof message.params === 'object' ? message.params : {}
    serial(() => importIds(ids, params)).then(sendResponse)
    return true
  }
  if (message.type === 'courselist') {
    serial(() => courseList(message.menu)).then(
      (list) => sendResponse(list === null ? { ok: false, reason: 'not_logged_in' } : { ok: true, list }),
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'changepreregist') {
    serial(() => changePreregist(String(message.cosId), message.params, message.previous)).then(
      sendResponse,
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'deptcounts') {
    serial(() => deptCounts(message.menus)).then(
      (lists) => sendResponse(lists === null ? { ok: false, reason: 'not_logged_in' } : { ok: true, lists }),
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'reginfo') {
    serial(() => regInfo({ cosId: message.cosId, menu: message.menu })).then(
      (json) => sendResponse(json === null ? { ok: false, reason: 'not_logged_in' } : { ok: true, json }),
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'deptree') {
    serial(depTree).then(
      (tree) => sendResponse(tree === null ? { ok: false, reason: 'not_logged_in' } : { ok: true, tree }),
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'wishgroups') {
    serial(wishGroups).then(
      (groups) => sendResponse(groups === null ? { ok: false, reason: 'not_logged_in' } : { ok: true, groups }),
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'register') {
    serial(() => register(message.params || {})).then(
      (text) => sendResponse(text === null ? { ok: false, reason: 'not_logged_in' } : { ok: true, text }),
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'courses') {
    serial(courseLists).then(
      (lists) => sendResponse(lists ? { ok: true, ...lists } : { ok: false, reason: 'not_logged_in' }),
      (err) => sendResponse({ ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }),
    )
    return true
  }
  if (message.type === 'regstatus') {
    serial(regStatus).then(
      (json) => sendResponse({ ok: true, json }),
      () => sendResponse({ ok: true, json: null }),
    )
    return true
  }
  if (message.type === 'sysstatus') {
    serial(sysStatus).then(
      (status) => sendResponse({ ok: true, status }),
      () => sendResponse({ ok: true, status: null }),
    )
    return true
  }
  if (message.type === 'semester') {
    serial(currentSemester).then(
      (semester) => sendResponse({ ok: true, semester }),
      () => sendResponse({ ok: true, semester: null }),
    )
    return true
  }
  return false
})
