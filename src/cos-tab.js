// 完整頁面（選課頁、選課規劃頁）與選課網分頁溝通：找一個已開啟的選課網分頁，經由 content script 送訊息

export async function findCosTab() {
  const tabs = await chrome.tabs.query({ url: 'https://cos.nycu.edu.tw/*' })
  return tabs[0] || null
}

export async function askCos(message) {
  const tab = await findCosTab()
  if (!tab) return { ok: false, reason: 'no_tab' }
  try {
    return await chrome.tabs.sendMessage(tab.id, message)
  } catch {
    return { ok: false, reason: 'no_content_script' }
  }
}

export function cosProblem(reply) {
  if (!reply) return '選課網沒有回應'
  if (reply.reason === 'no_tab') return '找不到選課網分頁，請先開啟並登入選課網。'
  if (reply.reason === 'no_content_script') return '選課網分頁沒有回應，請重新整理該分頁。'
  if (reply.reason === 'not_logged_in') return '請先登入選課網。'
  if (reply.reason === 'no_menu') return '缺少這門課的查詢資料，請在 popup 按「更新課程資料」後再試。'
  return reply.detail || '選課網沒有回應'
}
