import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PERIODS, periodIndex, periodTime, parseCosTime, describeSlots } from '../src/lib/periods.js'

test('節次表與選課網一致', () => {
  assert.equal(PERIODS.length, 16)
  assert.deepEqual(PERIODS[0], { code: 'y', label: 'Y', start: '06:00', end: '06:50' })
  assert.deepEqual(PERIODS[2], { code: '1', label: '1', start: '08:00', end: '08:50' })
  assert.deepEqual(PERIODS[6], { code: 'n', label: 'N', start: '12:20', end: '13:10' })
  assert.deepEqual(PERIODS.at(-1), { code: 'd', label: 'D', start: '21:30', end: '22:20' })
})

test('periodIndex 依課表順序排列', () => {
  assert.equal(periodIndex('y'), 0)
  assert.equal(periodIndex('1'), 2)
  assert.equal(periodIndex('n'), 6)
  assert.equal(periodIndex('N'), 6)
  assert.equal(periodIndex('d'), 15)
  assert.equal(periodIndex('x'), -1)
})

test('periodTime 取得節次時間', () => {
  assert.deepEqual(periodTime('3'), { start: '10:10', end: '11:00' })
  assert.deepEqual(periodTime('n'), { start: '12:20', end: '13:10' })
  assert.equal(periodTime('x'), null)
})

test('解析單一時段', () => {
  assert.deepEqual(parseCosTime('M12-PE[GF]'), [
    { day: 1, period: '1', room: 'PE', campus: 'GF' },
    { day: 1, period: '2', room: 'PE', campus: 'GF' },
  ])
})

test('解析一天多節與多天', () => {
  assert.deepEqual(parseCosTime('M56W34-SA321[GF]'), [
    { day: 1, period: '5', room: 'SA321', campus: 'GF' },
    { day: 1, period: '6', room: 'SA321', campus: 'GF' },
    { day: 3, period: '3', room: 'SA321', campus: 'GF' },
    { day: 3, period: '4', room: 'SA321', campus: 'GF' },
  ])
})

test('解析多個逗號分隔的時段與中午節次', () => {
  assert.deepEqual(parseCosTime('F2-ED220[GF],Tn56-EDB26[GF]'), [
    { day: 5, period: '2', room: 'ED220', campus: 'GF' },
    { day: 2, period: 'n', room: 'EDB26', campus: 'GF' },
    { day: 2, period: '5', room: 'EDB26', campus: 'GF' },
    { day: 2, period: '6', room: 'EDB26', campus: 'GF' },
  ])
})

test('沒有教室時 room 為空字串', () => {
  assert.deepEqual(parseCosTime('M34W2-'), [
    { day: 1, period: '3', room: '', campus: '' },
    { day: 1, period: '4', room: '', campus: '' },
    { day: 3, period: '2', room: '', campus: '' },
  ])
})

test('同一節多間教室合併成一筆', () => {
  assert.deepEqual(parseCosTime('Fn-SA213[GF],Fn-SA214[GF],Fn-SA215[GF]'), [
    { day: 5, period: 'n', room: 'SA213、SA214、SA215', campus: 'GF' },
  ])
})

test('空值與無法解析的字串', () => {
  assert.deepEqual(parseCosTime(''), [])
  assert.deepEqual(parseCosTime(null), [])
  assert.deepEqual(parseCosTime('???'), [])
  assert.deepEqual(parseCosTime('M-SA321[GF]'), [])
})

test('describeSlots 把連續節次併成一段文字', () => {
  assert.equal(describeSlots(parseCosTime('M56W34-SA321[GF]')), '一 5-6、三 3-4')
  assert.equal(describeSlots(parseCosTime('M12-PE[GF]')), '一 1-2')
  assert.equal(describeSlots(parseCosTime('F2-ED220[GF],Tn56-EDB26[GF]')), '二 N-6、五 2')
  assert.equal(describeSlots([]), '')
})
