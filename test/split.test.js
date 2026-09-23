import { test } from 'node:test'
import assert from 'node:assert/strict'
import { splitLeft, SPLIT } from '../src/lib/split.js'

// 當期選課左右分割：左邊搜尋結果、右邊課表預覽／篩選設定。拖曳時兩邊都不能小於最小寬度。
const total = 1200
const room = total - SPLIT.handle

test('依比例算出左欄寬度', () => {
  assert.equal(splitLeft(0.5, total), Math.round(room * 0.5))
})

test('左欄不能小於最小寬度', () => {
  assert.equal(splitLeft(0.05, total), SPLIT.minLeft)
})

test('右欄不能小於最小寬度', () => {
  assert.equal(splitLeft(0.98, total), room - SPLIT.minRight)
})

test('比例不是數字時用預設比例', () => {
  assert.equal(splitLeft(undefined, total), Math.round(room * SPLIT.defaultRatio))
  assert.equal(splitLeft(NaN, total), Math.round(room * SPLIT.defaultRatio))
})

test('寬度放不下兩邊的最小寬度時回傳 null（改成上下排）', () => {
  assert.equal(splitLeft(0.5, SPLIT.minLeft + SPLIT.minRight + SPLIT.handle - 1), null)
  assert.notEqual(splitLeft(0.5, SPLIT.minLeft + SPLIT.minRight + SPLIT.handle), null)
})
