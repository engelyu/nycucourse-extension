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

  // 選課網 2026-09-23 改版後，登入權杖存在 sessionStorage（每個分頁一份）；改版前存在 localStorage。
  // 先用 sessionStorage 的，不能用再看 localStorage（那裡可能只剩改版前留下的過期權杖）。
  function pickToken(sessionToken, localToken, nowMs) {
    for (const t of [sessionToken, localToken]) if (tokenUsable(t, nowMs)) return t
    return ''
  }

  // 選課結束後 getregist 回空白（2026-09-23 實測），選課網的「確認選課狀況」改用
  // userinfo.regist_acysem[0] 的學年學期讀 getsemregist；沒有就退回 lastacysem（例如 '1151'）。
  function registSemester(info) {
    const first = info && Array.isArray(info.regist_acysem) ? info.regist_acysem[0] : null
    if (first && first.acy != null && first.sem != null && String(first.sem) !== '') return { acy: String(first.acy), sem: String(first.sem) }
    const last = info && typeof info.lastacysem === 'string' ? info.lastacysem : ''
    return /^\d{3}[\dX]$/.test(last) ? { acy: last.slice(0, 3), sem: last.slice(3) } : null
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

  // 解析選課網的系統狀態（/sysstatuslvl）。選課網自己讀的是回應陣列的第一筆，
  // 這裡兩種形狀都接受。沒有訊息就回 null，不去解讀狀態碼的意思。
  function parseSysStatus(responseText) {
    const text = String(responseText ?? '').trim()
    if (!text) return null
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return null
    }
    const info = Array.isArray(parsed) ? parsed[0] : parsed
    if (!info || typeof info !== 'object') return null
    const pick = (v) => (typeof v === 'string' ? v.trim() : '')
    const message = pick(info.cmsg) || pick(info.emsg)
    if (!message) return null
    const code = info.status == null ? '' : String(info.status)
    return { code, message }
  }

  // 從預排移除前的檢查：正式選課清單讀不到、或課已在正式選課裡（已選上／已登記）就不移除
  function removalBlock(registeredList, cosId) {
    if (!Array.isArray(registeredList)) return '讀不到正式選課清單，先不移除'
    if (registeredList.some((c) => String(c && c.cos_id) === String(cosId))) return '這門課已在正式選課，不能從這裡移除'
    return ''
  }

  // 取消登記前的檢查。deleteregist 同時是退選 API，所以這道閘只放行「已登記」的課：
  // 讀不到清單、不在清單裡、已選上（sFlag F）、停修（PFW W）一律拒絕。
  function cancelBlock(registeredList, cosId) {
    if (!Array.isArray(registeredList)) return '讀不到正式選課清單，先不取消'
    const row = registeredList.find((c) => String(c && c.cos_id) === String(cosId))
    if (!row) return '這門課不在正式選課清單裡'
    if (String(row.sFlag) === 'F') return '這門課已經選上，取消等於退選，不能從這裡做'
    if (String(row.PFW) === 'W') return '這門課是停修狀態，不能從這裡取消'
    return ''
  }

  // 加入預排前的檢查。選課網會照收任何 menu_data（包括 {}），但之後它自己的加選視窗就查不到這門課，
  // 使用者看到「已加入」其實完全不能選（0.5.3 以前的嚴重 bug，報告 §1.2）。沒有有效選單路徑一律不寫入。
  function preregParamsProblem(params) {
    const noMenu = '找不到這門課在選課網的選單路徑，沒有加入（加進去選課網也查不到這門課）。請先更新課程資料再試。'
    if (!params || typeof params !== 'object') return noMenu
    let menu = null
    try {
      menu = JSON.parse(String(params.menu_data || '').replace(/&quot;/g, '"'))
    } catch {
      return noMenu
    }
    if (!menu || typeof menu !== 'object' || !menu.dep_uid) return noMenu
    if (!params.wType) return '缺少類別資料，沒有加入。請重新查詢採計方式再試。'
    return ''
  }

  root.NycuClassify = Object.freeze({ classifyResult, confirmWithList, tokenUsable, pickToken, registSemester, runBatch, parseSysStatus, removalBlock, cancelBlock, preregParamsProblem })
})(globalThis)
