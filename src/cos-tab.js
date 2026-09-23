// 完整頁面（選課頁、當期選課頁）與選課網分頁溝通：找一個已開啟的選課網分頁，經由 content script 送訊息

// 選課網改版後每個分頁各自登入（權杖在 sessionStorage），所以要問過每個分頁：
// 優先挑已登入的；都沒登入就挑 content script 有回應的（之後才講得出「請先登入」）；再不然第一個。
export async function findCosTab() {
  const tabs = await chrome.tabs.query({ url: 'https://cos.nycu.edu.tw/*' })
  if (tabs.length === 0) return null
  const replies = await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'ping' }).catch(() => null)))
  const at = (test) => tabs.find((_, i) => test(replies[i]))
  return at((r) => r && r.ok && r.loggedIn) || at((r) => r && r.ok) || tabs[0]
}

export async function askCos(message) {
  const tab = await findCosTab()
  if (!tab) return { ok: false, reason: 'no_tab' }
  try {
    // 擴充功能更新後，先前開著的分頁還跑舊的 content script。它不認得新訊息時不會回應，
    // chrome.tabs.sendMessage 會拿到 undefined，要請使用者重新整理那個分頁。
    const reply = await chrome.tabs.sendMessage(tab.id, message)
    return reply || { ok: false, reason: 'stale_content_script' }
  } catch {
    return { ok: false, reason: 'no_content_script' }
  }
}

export function cosProblem(reply) {
  if (!reply) return '選課網沒有回應'
  if (reply.reason === 'no_tab') return '找不到選課網分頁，請先開啟並登入選課網。'
  if (reply.reason === 'no_content_script') return '選課網分頁沒有回應，請重新整理該分頁。'
  if (reply.reason === 'closed') return reply.detail ? `選課系統暫停中：${reply.detail}` : '選課系統暫停中，請稍後再試。'
  if (reply.reason === 'not_logged_in') return '請先登入選課網。'
  if (reply.reason === 'stale_content_script' || reply.reason === 'unknown_message') return '選課網分頁載入的是舊版擴充功能，請重新整理該分頁後再試一次。'
  if (reply.reason === 'no_menu') return '缺少這門課的查詢資料，請在 popup 按「更新課程資料」後再試。'
  return reply.detail || '選課網沒有回應'
}
