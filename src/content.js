// 只在 https://cos.nycu.edu.tw/* 執行。所有 API 呼叫都是同源，帶頁面的 Bearer token。
const BASE = 'https://cos.nycu.edu.tw/'

let classifyModule = null
async function lib() {
  if (!classifyModule) {
    classifyModule = await import(chrome.runtime.getURL('src/lib/classify.js'))
  }
  return classifyModule
}

function token() {
  return localStorage.getItem('token') || ''
}

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
  return res.text()
}

async function addOne(id) {
  return post('setpreregist', {
    cos_id: id,
    menu_data: '{}',
    wType: 'X',
    GroupName: 'null',
    GroupName_E: 'null',
    category_type: '',
    category_cname: 'null',
    category_ename: 'null',
  })
}

async function currentPreregistIds() {
  const text = await post('getpreregist', {})
  const list = JSON.parse(text)
  return Array.isArray(list) ? list.map((c) => String(c.cos_id)) : []
}

async function importIds(ids) {
  if (!token()) return { ok: false, reason: 'not_logged_in' }
  const { classifyResult, confirmWithList } = await lib()
  const results = []
  try {
    for (const id of ids) {
      const text = await addOne(id)
      results.push(classifyResult(id, text))
    }
    const present = await currentPreregistIds()
    return { ok: true, results: confirmWithList(results, present) }
  } catch (err) {
    return { ok: false, reason: 'network', detail: String(err && err.message ? err.message : err) }
  }
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
    importIds(Array.isArray(message.ids) ? message.ids : []).then(sendResponse)
    return true
  }
  return false
})
