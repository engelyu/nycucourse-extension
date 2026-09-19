import { test } from 'node:test'
import assert from 'node:assert/strict'
import { slotKey, ALL_SLOTS, courseSlots, occupiedSlots, freeSlots, matchCourse, courseCategories, hasBriefData, describeKeys, findCourses, campusName, CAMPUSES } from '../src/lib/freeslots.js'
import { manualItem, courseToItem } from '../src/lib/schedule.js'

const c = (id, time, extra = {}) => ({ id, name: `課${id}`, ename: '', teacher: '老師', time, credit: '3.00', type: '選修', dep: '資工系', ...extra })

test('ALL_SLOTS 共 112 個，依星期再依節次排序', () => {
  assert.equal(ALL_SLOTS.length, 112)
  assert.equal(ALL_SLOTS[0], '1-y')
  assert.equal(ALL_SLOTS[16], '2-y')
  assert.equal(slotKey(5, '3'), '5-3')
})

test('courseSlots 解析時段、校區、教室', () => {
  assert.deepEqual(courseSlots(c('1', 'F345-EC115[GF]')), { keys: ['5-3', '5-4', '5-5'], campuses: ['GF'], rooms: ['EC115'] })
  assert.deepEqual(courseSlots(c('2', 'M56-A1[GF],W34-B2[YM]')).campuses, ['GF', 'YM'])
  assert.deepEqual(courseSlots(c('3', '')).keys, [])
})

test('空堂 = 全部時段扣掉佔用（含自訂行程）', () => {
  const items = [
    courseToItem({ cos_id: '9', cos_cname: '線代', cos_time: 'M12-A1[GF]' }, { source: 'registered' }),
    manualItem({ id: 'x', title: '社團', slots: [{ day: 2, period: 'a' }] }),
  ]
  const occ = occupiedSlots(items)
  assert.deepEqual([...occ].sort(), ['1-1', '1-2', '2-a'])
  const free = freeSlots(occ)
  assert.equal(free.length, 109)
  assert.ok(!free.includes('1-1') && free.includes('1-3'))
})

test('matchCourse 完全落在內與部分重疊', () => {
  const sel = new Set(['5-3', '5-4'])
  assert.deepEqual(matchCourse(['5-3', '5-4'], sel), { inside: true, overlap: true, outside: [] })
  assert.deepEqual(matchCourse(['5-3', '5-4', '5-5'], sel), { inside: false, overlap: true, outside: ['5-5'] })
  assert.deepEqual(matchCourse(['1-1'], sel), { inside: false, overlap: false, outside: ['1-1'] })
  assert.deepEqual(matchCourse([], sel), { inside: false, overlap: false, outside: [] })
})

test('courseCategories 依必選修與類別代碼', () => {
  assert.deepEqual(courseCategories(c('1', 'M1', { type: '必修' })), ['必修'])
  assert.deepEqual(courseCategories(c('2', 'M1', { brief: ['Z102'] })), ['選修', '核心・基本素養'])
  assert.deepEqual(courseCategories(c('3', 'M1', { brief: ['Z107'] })), ['選修', '核心・領域課程'])
  assert.deepEqual(courseCategories(c('4', 'M1', { type: '', brief: ['A505', 'Z204'] })), ['語言與溝通'])
  assert.equal(hasBriefData([c('1', 'M1')]), false)
  assert.equal(hasBriefData([c('1', 'M1', { brief: ['Z102'] })]), true)
})

test('describeKeys 與 campusName', () => {
  assert.equal(describeKeys(['3-4', '1-5', '1-6', '3-3']), '一 56、三 34')
  assert.equal(describeKeys(['5-n', '5-a']), '五 NA')
  assert.equal(campusName('GF'), '光復')
  assert.equal(campusName('KS'), 'KS')
  assert.equal(campusName('ZZ'), 'ZZ')
  assert.deepEqual(CAMPUSES.slice(0, 2).map((x) => x.code), ['GF', 'YM'])
})

const courses = [
  c('100', 'F34-EC115[GF]', { type: '必修', dep: '資工系' }),
  c('101', 'F345-EC115[GF]'),
  c('102', 'F34-YL402[YM]', { brief: ['Z102'], dep: '通識中心', credit: '2.00' }),
  c('103', 'M12-A1[GF]'),
  c('104', ''),
  c('105', 'F3-A1[GF],M1-A1[GF]', { name: '線性代數' }),
]
const base = { selection: ['5-3', '5-4'], mode: 'inside', campuses: [], categories: [], deps: [], creditMin: '', creditMax: '', keyword: '', excludeIds: [] }
const ids = (hits) => hits.map((h) => h.course.id)

test('findCourses 完全落在內', () => {
  const r = findCourses(courses, base)
  assert.deepEqual(ids(r.inside), ['100', '102'])
  assert.deepEqual(r.overlap, [])
  assert.equal(r.total, 2)
})

test('findCourses 部分重疊：另列一組並標超出', () => {
  const r = findCourses(courses, { ...base, mode: 'overlap' })
  assert.deepEqual(ids(r.inside), ['100', '102'])
  assert.deepEqual(ids(r.overlap), ['105', '101'])
  assert.deepEqual(r.overlap.find((h) => h.course.id === '101').outside, ['5-5'])
})

test('findCourses 各種篩選', () => {
  assert.deepEqual(ids(findCourses(courses, { ...base, campuses: ['YM'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, categories: ['核心・基本素養'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, categories: ['必修'] }).inside), ['100'])
  assert.deepEqual(ids(findCourses(courses, { ...base, deps: ['通識中心'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, creditMin: '3' }).inside), ['100'])
  assert.deepEqual(ids(findCourses(courses, { ...base, creditMax: 2 }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, excludeIds: ['100'] }).inside), ['102'])
  assert.deepEqual(ids(findCourses(courses, { ...base, mode: 'overlap', keyword: '線代' }).overlap), ['105'])
  assert.equal(findCourses(courses, { ...base, selection: [] }).total, 0)
})

test('findCourses 超過 200 門時截斷', () => {
  const many = Array.from({ length: 250 }, (_, i) => c(String(1000 + i), 'F3-A1[GF]'))
  const r = findCourses(many, { ...base, selection: ['5-3'] })
  assert.equal(r.total, 250)
  assert.equal(r.inside.length, 200)
  assert.equal(r.truncated, true)
})
