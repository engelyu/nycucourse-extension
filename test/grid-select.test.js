import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dragMode, rectKeys, applyKeys, toggleGroup, dayKeys, periodKeys } from '../src/lib/grid-select.js'

test('dragMode：起點未選就選取，已選就取消', () => {
  const sel = new Set(['1-1'])
  assert.equal(dragMode(sel, '1-1'), 'remove')
  assert.equal(dragMode(sel, '1-2'), 'add')
})

test('rectKeys：任意方向拖曳都得到同一個矩形', () => {
  const a = rectKeys('2-3', '3-4')
  assert.deepEqual(a, ['2-3', '2-4', '3-3', '3-4'])
  assert.deepEqual(rectKeys('3-4', '2-3'), a)
  assert.deepEqual(rectKeys('1-4', '1-5'), ['1-4', '1-n', '1-5'])
  assert.deepEqual(rectKeys('5-3', '5-3'), ['5-3'])
})

test('applyKeys 回傳新集合', () => {
  const sel = new Set(['1-1'])
  const added = applyKeys(sel, ['1-2', '1-3'], 'add')
  assert.deepEqual([...added].sort(), ['1-1', '1-2', '1-3'])
  assert.deepEqual([...sel], ['1-1'])
  assert.deepEqual([...applyKeys(added, ['1-1', '1-2'], 'remove')], ['1-3'])
})

test('點一格：單格矩形配合起點模式等於切換', () => {
  const sel = new Set(['1-1'])
  assert.deepEqual([...applyKeys(sel, rectKeys('1-1', '1-1'), dragMode(sel, '1-1'))], [])
})

test('toggleGroup：整天或整節，全選時取消，否則全選', () => {
  const mon = dayKeys(1)
  assert.equal(mon.length, 16)
  const all = toggleGroup(new Set(['1-1']), mon)
  assert.equal(all.size, 16)
  assert.equal(toggleGroup(all, mon).size, 0)
  assert.deepEqual(periodKeys('3'), ['1-3', '2-3', '3-3', '4-3', '5-3', '6-3', '7-3'])
})
