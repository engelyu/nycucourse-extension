// 一般腳本（不是 ES module）：manifest 讓它在 content.js 之前載入，函式掛在 globalThis.NycuClassify。
// 這樣不必把檔案設為 web_accessible_resources，選課網頁面就無法藉由讀取它偵測擴充功能。
// 測試以 import 執行本檔，同樣從 globalThis 取用。
;(function (root) {
  function classifyResult(id, responseText, httpStatus = 200) {
    if (!(httpStatus >= 200 && httpStatus < 300)) {
      return { id, status: 'error', msg: `選課網錯誤（HTTP ${httpStatus}）` }
    }
    const text = String(responseText ?? '').trim()
    if (text === '') return { id, status: 'added', msg: '' }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return { id, status: 'error', msg: '無法解析選課網回應' }
    }
    const first = Array.isArray(parsed) ? parsed[0] : parsed
    const msg = first && typeof first.msg === 'string' ? first.msg : ''
    if (first && first.status === 'success') return { id, status: 'added', msg }
    if (msg === '重複預選') return { id, status: 'exists', msg }
    return { id, status: 'error', msg: msg || '未知錯誤' }
  }

  function confirmWithList(results, preregistIds) {
    const present = new Set(preregistIds)
    return results.map((r) => {
      if (r.status === 'added' && !present.has(r.id)) {
        return { ...r, status: 'error', msg: '加入後未出現在預排清單' }
      }
      return { ...r }
    })
  }

  // 選課網登入權杖是 JWT，有效 8 小時。已過期或一分鐘內過期視為不可用；
  // 解析不了就交給伺服器判斷。
  function tokenUsable(token, nowMs, skewMs = 60_000) {
    if (!token) return false
    const part = String(token).split('.')[1]
    if (!part) return true
    let payload
    try {
      const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
      const bin = atob(b64 + '==='.slice((b64.length + 3) % 4))
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
      payload = JSON.parse(new TextDecoder().decode(bytes))
    } catch {
      return true
    }
    if (!payload || typeof payload.exp !== 'number') return true
    return payload.exp * 1000 > nowMs + skewMs
  }

  root.NycuClassify = Object.freeze({ classifyResult, confirmWithList, tokenUsable })
})(globalThis)
