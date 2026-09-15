// 只在 https://cos.nycu.edu.tw/* 執行。所有 API 呼叫都是同源，帶頁面的 Bearer token。
// src/lib/classify.js 由 manifest 先載入，提供 globalThis.NycuClassify。
const { classifyResult, confirmWithList, tokenUsable } = globalThis.NycuClassify
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
  const results = []
  try {
    for (const id of ids) {
      results.push(await addOne(id))
    }
    const present = await currentPreregistIds()
    if (present === null) return { ok: false, reason: 'not_logged_in' }
    return { ok: true, results: confirmWithList(results, present) }
  } catch (err) {
    return { ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }
  }
}

// 同一分頁的匯入請求排隊依序處理：連續按好幾個「加入」時，對選課網的請求仍然一次一個。
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
  return false
})
