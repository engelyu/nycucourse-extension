import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stackWeek, hiddenSlots } from '../src/lib/stack.js'

const course = (key, source, slots, extra = {}) => ({
  key, source, cosId: key, title: key, color: '', regState: '', wishNo: null,
  slots: slots.map(([day, period, room = 'R']) => ({ day, period, room, campus: 'GF' })),
  ...extra,
})

test('一定顯示一到五、1 到 9 節；有課才加週六與其他節次', () => {
  const w = stackWeek([])
  assert.deepEqual(w.days, [1, 2, 3, 4, 5])
  assert.deepEqual(w.periods, ['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  const w2 = stackWeek([course('a', 'preregist', [[6, 'a'], [1, 'n']])])
  assert.deepEqual(w2.days, [1, 2, 3, 4, 5, 6])
  assert.deepEqual(w2.periods, ['1', '2', '3', '4', 'n', '5', '6', '7', '8', '9', 'a'])
})

test('同一格多堂課全部列出，已選上排最前面', () => {
  const items = [
    course('p1', 'preregist', [[1, '3']]),
    course('p2', 'preregist', [[1, '3']]),
    course('r', 'registered', [[1, '3']]),
    course('m', 'manual', [[1, '3']]),
    course('w', 'registered', [[1, '3']], { regState: 'wish', wishNo: 2 }),
  ]
  const cell = stackWeek(items).cells.get('1-3')
  assert.deepEqual(cell.map((e) => e.key), ['r', 'w', 'p1', 'p2', 'm'])
  assert.deepEqual(cell.map((e) => e.lane), [0, 1, 2, 3, 4])
  assert.deepEqual(cell.map((e) => e.mark), ['✓', '②', '預', '預', ''])
})

test('同一天中，一堂課在每一節的位置相同', () => {
  // A 在 3、4 節；B 只在 4 節；C 在 3 節與 5 節
  const items = [
    course('A', 'preregist', [[1, '3'], [1, '4']]),
    course('B', 'preregist', [[1, '4']]),
    course('C', 'preregist', [[1, '3'], [1, '5']]),
  ]
  const w = stackWeek(items)
  const lane = (key, k) => w.cells.get(k).find((e) => e.key === key).lane
  assert.equal(lane('A', '1-3'), lane('A', '1-4'))
  assert.equal(lane('C', '1-3'), lane('C', '1-5'))
  assert.notEqual(lane('B', '1-4'), lane('A', '1-4'))
})

test('連續節次只有第一節是 first', () => {
  const w = stackWeek([course('A', 'preregist', [[2, '3'], [2, '4'], [2, '6']])])
  assert.equal(w.cells.get('2-3')[0].first, true)
  assert.equal(w.cells.get('2-4')[0].first, false)
  assert.equal(w.cells.get('2-6')[0].first, true)
})

test('有已選上或已登記又疊了別的課才算衝堂', () => {
  const items = [
    course('r', 'registered', [[1, '3']]),
    course('p', 'preregist', [[1, '3'], [2, '3']]),
    course('q', 'preregist', [[2, '3']]),
  ]
  const w = stackWeek(items)
  assert.deepEqual(w.conflicts.get('1-3'), ['r', 'p'])
  assert.equal(w.conflicts.has('2-3'), false)
})

test('顏色：私人行程用自己的顏色，其他用狀態顏色', () => {
  const w = stackWeek([course('m', 'manual', [[1, '1']], { color: '#123456' }), course('p', 'preregist', [[1, '2']])])
  assert.equal(w.cells.get('1-1')[0].color, '#123456')
  assert.equal(w.cells.get('1-2')[0].color, '#0072B2')
})

test('hiddenSlots 列出不在顯示範圍內的時段', () => {
  const w = stackWeek([])
  assert.deepEqual(hiddenSlots(['1-3', '6-3', '6-4', '2-a'], w), ['6-3', '6-4', '2-a'])
})
