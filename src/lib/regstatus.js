// 選課系統是否開放。
// 實測（2026-09-17 分發時段）：
// - checkreg / checkdistribute 在暫停時回 { status: 'error', cmsg: '…分發時間 10:00～12:00 暫停使用選課系統…' }，
//   訊息自帶這次暫停的時間，所以直接顯示原文，不在程式裡寫死時間。
// - sysstatuslvl 在暫停時仍回狀態 1「系統暢通無阻」，它是負載狀態，不是開放與否。

const str = (v) => (v == null ? '' : String(v))

export function cleanMessage(text) {
  return str(text).replace(/<br\s*\/?>/gi, ' ').replace(/\s+/g, ' ').trim()
}

export function parseRegStatus(body) {
  const first = Array.isArray(body) ? body[0] : body
  if (!first || typeof first !== 'object') return { open: true, message: '' }
  if (str(first.status) !== 'error') return { open: true, message: '' }
  const message = cleanMessage(first.cmsg) || cleanMessage(first.emsg) || '選課系統目前暫停使用'
  return { open: false, message }
}

// 暫停的說明。分發停機（訊息含「分發」）時預排照常可以改（2026-09-21 實測）；
// 其他情況（例如 2026-09-23 的「選課結束」）不會再開放，不能叫使用者等開放。
export function closedNotice(message) {
  const msg = cleanMessage(message)
  if (msg.includes('分發')) return `選課系統暫停中：${msg} 這段時間仍然可以加入、移除預排；查詢、加選、登記要等開放後再做。`
  return `選課網目前不開放選課${msg ? `：${msg}` : ''}。查詢、加選、登記都不能使用；課表仍可從選課網更新。`
}

// sysstatuslvl 的狀態 1 代表暢通，只有其他狀態才值得提示使用者
export function sysStatusNotice(status) {
  if (!status || !status.message) return ''
  return str(status.code) === '1' ? '' : status.message
}
