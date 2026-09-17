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
