import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatSeats } from '../src/lib/seats.js'

test('有上限也有已選人數', () => {
  assert.equal(formatSeats({ limit: '85', enrolled: '40' }), '40/85 人')
})

test('額滿時標示', () => {
  assert.equal(formatSeats({ limit: '36', enrolled: '45' }), '45/36 人（已額滿）')
  assert.equal(formatSeats({ limit: '36', enrolled: '36' }), '36/36 人（已額滿）')
})

test('9999 與 0 視為不限人數', () => {
  assert.equal(formatSeats({ limit: '9999', enrolled: '' }), '不限人數')
  assert.equal(formatSeats({ limit: '0', enrolled: '' }), '不限人數')
  assert.equal(formatSeats({ limit: '不限', enrolled: '' }), '不限人數')
  assert.equal(formatSeats({ limit: '9999', enrolled: '12' }), '已選 12 人 · 不限人數')
})

test('課程時間表不提供已選人數時只顯示上限', () => {
  assert.equal(formatSeats({ limit: '85', enrolled: '-999' }), '上限 85 人')
  assert.equal(formatSeats({ limit: '85', enrolled: '' }), '上限 85 人')
  assert.equal(formatSeats({ limit: '85' }), '上限 85 人')
})

test('沒有任何人數資料時回空字串', () => {
  assert.equal(formatSeats({}), '')
  assert.equal(formatSeats({ limit: '', enrolled: '-999' }), '')
  assert.equal(formatSeats(undefined), '')
  assert.equal(formatSeats({ limit: 'abc', enrolled: 'xyz' }), '')
})
