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

  const errorMessage = (err) => String(err && err.message ? err.message : err)

  // 依序加入每門課，最後讀一次預排清單確認。
  // 中途網路錯誤：保留前面已送出的結果，其餘標示未送出；清單讀不到時標示無法確認並附警告。
  async function runBatch(ids, addOne, listIds) {
    const results = []
    for (let i = 0; i < ids.length; i++) {
      try {
        results.push(await addOne(ids[i]))
      } catch (err) {
        results.push({ id: ids[i], status: 'error', msg: `網路錯誤：${errorMessage(err)}` })
        for (const id of ids.slice(i + 1)) {
          results.push({ id, status: 'error', msg: '未送出：前一門發生網路錯誤' })
        }
        break
      }
    }
    let present
    try {
      present = await listIds()
    } catch (err) {
      return {
        ok: true,
        results: results.map((r) => (r.status === 'added' ? { ...r, msg: '已送出，但無法確認是否加入' } : r)),
        warning: `無法確認加入結果：${errorMessage(err)}`,
      }
    }
    if (present === null) return { ok: false, reason: 'not_logged_in' }
    return { ok: true, results: confirmWithList(results, present) }
  }

  root.NycuClassify = Object.freeze({ classifyResult, confirmWithList, tokenUsable, runBatch })
})(globalThis)
