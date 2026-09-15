import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchCourses } from '../src/lib/search.js'

const c = (id, name, teacher = '', ename = '') => ({ id, name, ename, teacher, time: '', credit: '', type: '', dep: '' })

const courses = [
  c('100001', '普通物理（一）', '李四', 'General Physics (I)'),
  c('100002', '線性代數（一）', '吳金典', 'Linear Algebra (I)'),
  c('100003', '物理化學', '張三', 'Physical Chemistry'),
  c('100004', '機率', '王線性', 'Probability'),
  c('100005', '線上代數導論', '陳五', 'Online Algebra'),
]

const ids = (r) => r.items.map((x) => x.id)

test('空查詢回傳空結果', () => {
  assert.deepEqual(searchCourses(courses, ''), { total: 0, items: [] })
  assert.deepEqual(searchCourses(courses, '   '), { total: 0, items: [] })
})

test('課名子字串', () => {
  assert.deepEqual(ids(searchCourses(courses, '物理')), ['100001', '100003'])
})

test('老師子字串', () => {
  assert.deepEqual(ids(searchCourses(courses, '金典')), ['100002'])
})

test('英文課名不分大小寫', () => {
  assert.deepEqual(ids(searchCourses(courses, 'probab')), ['100004'])
})

test('課號完全相符排最前面', () => {
  assert.deepEqual(ids(searchCourses(courses, '100003')), ['100003'])
})

test('三碼以上數字可搜尋課號片段', () => {
  assert.deepEqual(ids(searchCourses(courses, '10000')), ['100001', '100002', '100003', '100004', '100005'])
  const more = [c('516702', '甲'), c('516703', '乙'), c('100009', '516 導論')]
  assert.deepEqual(ids(searchCourses(more, '5167')), ['516702', '516703'])
})

test('課號完全相符排在課號片段前面', () => {
  const list = [c('151670', '含片段'), c('516702', '完全相符')]
  assert.deepEqual(ids(searchCourses(list, '516702')), ['516702'])
  assert.deepEqual(ids(searchCourses([c('516702', '甲'), c('151670', '乙')], '1670')), ['516702', '151670'])
})

test('一兩碼數字不做課號片段比對', () => {
  assert.deepEqual(ids(searchCourses(courses, '10')), [])
})

test('搜尋接受 1151_100003 這種帶學期前綴的課號', () => {
  assert.deepEqual(ids(searchCourses(courses, '1151_100003')), ['100003'])
})

test('課名模糊子序列', () => {
  assert.deepEqual(ids(searchCourses(courses, '線代')), ['100002', '100005'])
})

test('排序：課名子字串 > 老師 > 英文 > 模糊', () => {
  // 「線性」：100002 課名含、100004 老師含
  assert.deepEqual(ids(searchCourses(courses, '線性')), ['100002', '100004'])
})

test('同一門課只出現一次', () => {
  const r = searchCourses([c('200001', '物理', '物理')], '物理')
  assert.deepEqual(ids(r), ['200001'])
})

test('limit 限制筆數但 total 是全部', () => {
  const many = Array.from({ length: 80 }, (_, i) => c(String(300000 + i), `微積分${i}`))
  const r = searchCourses(many, '微積分', 50)
  assert.equal(r.total, 80)
  assert.equal(r.items.length, 50)
  assert.equal(r.items[0].id, '300000')
})

test('查詢含正規表示式特殊字元不會出錯', () => {
  assert.deepEqual(ids(searchCourses(courses, '（一')), ['100001', '100002'])
  assert.doesNotThrow(() => searchCourses(courses, '(.*'))
})
