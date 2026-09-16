import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDeptCounts, menusToFetch, mergeCounts, countsFresh } from '../src/lib/counts.js'

const deptList = [
  { cos_id: '515600', cos_cname: '無人機', num_limit: '36', registered_num: '45' },
  { cos_id: '515601', cos_cname: '競技程式設計', num_limit: '65', registered_num: '9' },
  { cos_id: '131106', cos_cname: '機器學習', num_limit: '不限', registered_num: '69' },
]

test('parseDeptCounts 取出課號對應的人數', () => {
  const counts = parseDeptCounts(deptList)
  assert.deepEqual(counts['515600'], { limit: '36', enrolled: '45' })
  assert.deepEqual(counts['131106'], { limit: '不限', enrolled: '69' })
  assert.deepEqual(parseDeptCounts(null), {})
  assert.deepEqual(parseDeptCounts({}), {})
})

test('menusToFetch 收集要查的系所，去重且限制數量', () => {
  const mk = (uid) => ({ menu: { type: '1', dep_category: '3*', college_no: 'S', dep_uid: uid } })
  const courses = [mk('A'), mk('A'), mk('B'), mk('C'), { }]
  const out = menusToFetch(courses, {}, 2)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map((m) => m.dep_uid), ['A', 'B'])
})

test('menusToFetch 跳過已經查過且還新鮮的系所', () => {
  const now = 1_000_000
  const mk = (uid) => ({ menu: { dep_uid: uid } })
  const cache = { A: { at: now - 1000, counts: {} }, B: { at: now - 10 * 60_000, counts: {} } }
  const out = menusToFetch([mk('A'), mk('B')], cache, 5, now)
  assert.deepEqual(out.map((m) => m.dep_uid), ['B'])
})

test('mergeCounts 用即時人數蓋過課程時間表的資料', () => {
  const courses = [
    { id: '515600', limit: '36', enrolled: '-999' },
    { id: '999999', limit: '10', enrolled: '-999' },
  ]
  const merged = mergeCounts(courses, { 515600: { limit: '36', enrolled: '45' } })
  assert.deepEqual(merged[0], { id: '515600', limit: '36', enrolled: '45', live: true })
  assert.deepEqual(merged[1], { id: '999999', limit: '10', enrolled: '-999' })
})

test('countsFresh 判斷快取是否還新鮮', () => {
  const now = 1_000_000
  assert.equal(countsFresh({ at: now - 60_000 }, now), true)
  assert.equal(countsFresh({ at: now - 10 * 60_000 }, now), false)
  assert.equal(countsFresh(undefined, now), false)
})
