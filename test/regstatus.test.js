import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseRegStatus, sysStatusNotice, cleanMessage } from '../src/lib/regstatus.js'

// 2026-09-17 11:45 選課系統分發時段實際抓到的 checkreg 回應
const closed = {
  status: 'error',
  cmsg: '開學後加退選 分發時間 2026-09-17 10:00:00～2026-09-17 12:00:00 暫停使用選課系統，如造成不便，敬請見諒！ ',
  emsg: '【Add and drop after school starts】Distribution time<br/>2026-09-17 10:00:00～2026-09-17 12:00:00 The system will shut down.',
}

test('checkreg 回 error 代表暫停，訊息用伺服器的原文', () => {
  assert.deepEqual(parseRegStatus(closed), {
    open: false,
    message: '開學後加退選 分發時間 2026-09-17 10:00:00～2026-09-17 12:00:00 暫停使用選課系統，如造成不便，敬請見諒！',
  })
})

test('陣列包起來的回應也能解析', () => {
  assert.equal(parseRegStatus([closed]).open, false)
})

test('非 error 視為開放', () => {
  assert.deepEqual(parseRegStatus({ status: 'success', cmsg: '' }), { open: true, message: '' })
  assert.deepEqual(parseRegStatus([{ status: 'success' }]), { open: true, message: '' })
})

test('沒有內容或看不懂時不擋操作', () => {
  assert.deepEqual(parseRegStatus(''), { open: true, message: '' })
  assert.deepEqual(parseRegStatus(null), { open: true, message: '' })
  assert.deepEqual(parseRegStatus([]), { open: true, message: '' })
})

test('error 但沒有訊息時給預設說明', () => {
  assert.deepEqual(parseRegStatus({ status: 'error', cmsg: '', emsg: '' }), { open: false, message: '選課系統目前暫停使用' })
})

test('只有中文訊息時才退回英文，並清掉 <br/>', () => {
  assert.equal(cleanMessage('a<br/>b<BR>c  d'), 'a b c d')
  assert.equal(parseRegStatus({ status: 'error', cmsg: '', emsg: 'Closed<br/>now' }).message, 'Closed now')
})

test('sysstatuslvl 狀態 1 是暢通，不需要提示', () => {
  assert.equal(sysStatusNotice({ code: '1', message: '系統暢通無阻' }), '')
  assert.equal(sysStatusNotice({ code: '3', message: '系統忙碌中' }), '系統忙碌中')
  assert.equal(sysStatusNotice(null), '')
  assert.equal(sysStatusNotice({ code: '', message: '公告' }), '公告')
})

// 分發停機（2026-09-21 實測）時預排照常可以改；選課結束（2026-09-23 實測 checkreg 回「選課結束」）則是整段結束。
// 兩種情況的說明不能一樣，不能對「選課結束」說「等開放後再做」。
import { closedNotice } from '../src/lib/regstatus.js'

test('分發停機：說明預排仍可改，查詢加選登記要等開放', () => {
  const msg = '開學後加退選 分發時間 2026-09-21 10:00:00～2026-09-21 12:00:00 暫停使用選課系統，如造成不便，敬請見諒！'
  assert.equal(closedNotice(msg), `選課系統暫停中：${msg} 這段時間仍然可以加入、移除預排；查詢、加選、登記要等開放後再做。`)
})

test('選課結束：照選課網原文說明，不說「等開放」', () => {
  const text = closedNotice('選課結束')
  assert.equal(text, '選課網目前不開放選課：選課結束。查詢、加選、登記都不能使用；課表仍可從選課網更新。')
  assert.ok(!text.includes('等開放'))
})
