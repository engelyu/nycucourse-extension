import { test } from 'node:test'
import assert from 'node:assert/strict'
import { courseToItem, manualItem, buildWeek, mergeBlocks, slotsFromTimeRange } from '../src/lib/schedule.js'
import { locateNow, describeNow } from '../src/lib/now.js'

// 2026-09-21 是週一
const at = (day, hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2026, 8, 20 + day, h, m)
}
const layoutOf = (...courses) => mergeBlocks(buildWeek(courses.map((c, i) => courseToItem({ cos_id: String(i + 1), ...c }, { source: 'registered' }))))
const week = layoutOf(
  { cos_cname: '微積分', cos_time: 'M12W12-SA101[GF]' },
  { cos_cname: '線性代數', cos_time: 'T34W34-SC201[GF]' },
  { cos_cname: '導師時間', cos_time: 'M5-SC101[GF]' },
)

test('上課中：current 是這堂，next 是今天稍後的課', () => {
  const r = locateNow(week, at(3, '08:30'))
  assert.equal(r.today, 3)
  assert.equal(r.current.item.title, '微積分')
  assert.equal(r.next.item.title, '線性代數')
  assert.equal(r.nextDayOffset, 0)
  assert.equal(r.minutesUntilNext, 100)
  assert.deepEqual(r.nowLine, { row: 0, fraction: 0.6 })
})

test('課間休息：沒有 current，時間線在兩節之間', () => {
  const r = locateNow(week, at(3, '10:05'))
  assert.equal(r.current, null)
  assert.equal(r.next.item.title, '線性代數')
  assert.equal(r.minutesUntilNext, 5)
  assert.deepEqual(r.nowLine, { row: 1, fraction: 1 })
})

test('午休（N 節）落在列出的範圍內', () => {
  const r = locateNow(week, at(1, '12:30'))
  assert.equal(r.next.item.title, '導師時間')
  assert.equal(week.rows[r.nowLine.row].code, 'n')
})

test('今天已經沒課：next 是之後最近一天的第一堂', () => {
  const r = locateNow(week, at(3, '15:00'))
  assert.equal(r.current, null)
  assert.equal(r.next.day, 1)
  assert.equal(r.nextDayOffset, 5)
  assert.equal(r.minutesUntilNext, null)
  assert.equal(r.nowLine, null)
})

test('週末與深夜：沒有時間線，next 是週一', () => {
  const r = locateNow(week, at(6, '23:00'))
  assert.equal(r.nowLine, null)
  assert.equal(r.next.day, 1)
  assert.equal(r.nextDayOffset, 2)
})

test('同一天稍晚的課：週一 14:30 之後的下一堂是週二', () => {
  const r = locateNow(week, at(1, '14:30'))
  assert.equal(r.next.day, 2)
  assert.equal(r.nextDayOffset, 1)
})

test('這週完全沒課', () => {
  const r = locateNow(mergeBlocks(buildWeek([])), at(3, '10:00'))
  assert.deepEqual([r.current, r.next, r.nowLine], [null, null, null])
  assert.deepEqual(describeNow(r), ['這週沒有課'])
})

test('自訂時間的行程也能計算', () => {
  const item = manualItem({ id: 'x', title: '社團', slots: slotsFromTimeRange(2, '18:40', '20:10', '活動中心') })
  const r = locateNow(mergeBlocks(buildWeek([item])), at(2, '18:45'))
  assert.equal(r.current.item.title, '社團')
})

test('describeNow 上課中與下一堂的文字', () => {
  assert.deepEqual(describeNow(locateNow(week, at(3, '08:30'))), [
    '上課中：微積分・SA101，09:50 下課',
    '下一堂 10:10（1 小時 40 分鐘後）・線性代數・SC201',
  ])
  assert.deepEqual(describeNow(locateNow(week, at(3, '10:05'))), ['下一堂 10:10（5 分鐘後）・線性代數・SC201'])
  assert.deepEqual(describeNow(locateNow(week, at(1, '14:30'))), ['下一堂 明天 10:10・線性代數・SC201'])
  assert.deepEqual(describeNow(locateNow(week, at(3, '15:00'))), ['下一堂 週一 08:00・微積分・SA101'])
})
