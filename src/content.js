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
async function addOne(id) {
  const { status, text } = await post('setpreregist', {
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

// 回傳預排課號；登入失效時選課網回空字串，這時回傳 null。
async function currentPreregistIds() {
  const { status, text } = await post('getpreregist', {})
  if (!isOk(status)) throw new Error(`選課網錯誤（HTTP ${status}）`)
  if (!text.trim()) return null
  const list = JSON.parse(text)
  return Array.isArray(list) ? list.map((c) => String(c.cos_id)) : []
}

async function importIds(ids) {
  if (!tokenUsable(token(), Date.now())) return { ok: false, reason: 'not_logged_in' }
  return runBatch(ids, addOne, currentPreregistIds)
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

// 選課網目前的系統狀態與公告（例如非選課時段）。由伺服器決定，這裡不判斷時間。
async function sysStatus() {
  if (!tokenUsable(token(), Date.now())) return null
  const { status, text } = await post('sysstatuslvl', {})
  if (!isOk(status)) return null
  return parseSysStatus(text)
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
  const slim = (list) => (list || []).map((c) => ({
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
  }))
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
    serial(() => importIds(ids)).then(sendResponse)
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
