import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cosProblem } from '../src/cos-tab.js'

test('cosProblem 說明各種連不上選課網的原因', () => {
  assert.equal(cosProblem({ reason: 'no_tab' }), '找不到選課網分頁，請先開啟並登入選課網。')
  assert.equal(cosProblem({ reason: 'not_logged_in' }), '請先登入選課網。')
  assert.equal(cosProblem({ reason: 'no_content_script' }), '選課網分頁沒有回應，請重新整理該分頁。')
  assert.equal(cosProblem({ reason: 'network', detail: '壞掉了' }), '壞掉了')
})

// 2026-09-20 實測：擴充功能更新後，先前開著的選課網分頁還跑舊的 content script，
// 它不認得新的訊息（例如 removepreregist）就不回應，chrome.tabs.sendMessage 拿到 undefined。
test('分頁載入的是舊版程式時，請使用者重新整理選課網分頁', () => {
  const text = '選課網分頁載入的是舊版擴充功能，請重新整理該分頁後再試一次。'
  assert.equal(cosProblem({ reason: 'stale_content_script' }), text)
  assert.equal(cosProblem({ reason: 'unknown_message' }), text)
})

// 2026-09-21 分發停機實測：正式選課相關 API 回空白內容，看起來跟沒登入一樣。
// content script 會先問 checkreg，停機時回 reason 'closed' 並附上選課網的原文。
test('停機時顯示選課網公告的原因，而不是請使用者登入', () => {
  const detail = '開學後加退選 分發時間 2026-09-21 10:00:00～2026-09-21 12:00:00 暫停使用選課系統，如造成不便，敬請見諒！'
  assert.equal(cosProblem({ ok: false, reason: 'closed', detail }), `選課系統暫停中：${detail}`)
  assert.equal(cosProblem({ ok: false, reason: 'closed', detail: '' }), '選課系統暫停中，請稍後再試。')
})
