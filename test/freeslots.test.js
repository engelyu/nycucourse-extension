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

// 開課單位依中文排序規則（筆畫），一系 < 二系 < 三系
test('findCourses 排序：預設最貼合（超出少的在前），也可以依時間、課號、學分、開課單位', () => {
  const list = [
    c('201', 'M1234F34-A1[GF]', { credit: '2.00', dep: '二系' }),
    c('202', 'F345-A1[GF]', { credit: '4.00', dep: '一系' }),
    c('203', 'F3-A1[GF],T12-A1[GF]', { credit: '3.00', dep: '三系' }),
  ]
  const o = { ...base, mode: 'overlap' }
  assert.deepEqual(ids(findCourses(list, o).overlap), ['202', '203', '201'])
  assert.deepEqual(ids(findCourses(list, { ...o, sort: 'time' }).overlap), ['201', '203', '202'])
  assert.deepEqual(ids(findCourses(list, { ...o, sort: 'id' }).overlap), ['201', '202', '203'])
  assert.deepEqual(ids(findCourses(list, { ...o, sort: 'credit' }).overlap), ['202', '203', '201'])
  assert.deepEqual(ids(findCourses(list, { ...o, sort: 'dep' }).overlap), ['202', '201', '203'])
})

test('depLabel 整理系所名稱：去掉括號、英文縮寫與碩博標記', async () => {
  const { depLabel } = await import('../src/lib/freeslots.js')
  assert.equal(depLabel('(醫學系)'), '醫學系')
  assert.equal(depLabel('IBI(生物資訊及系統生物研究所)[碩]'), '生物資訊及系統生物研究所')
  assert.equal(depLabel('IOM(管理學院專班(共同課程))[碩]'), '管理學院專班(共同課程)')
  assert.equal(depLabel('BME(生物醫學工程學系)'), '生物醫學工程學系')
  assert.equal(depLabel('通識'), '通識')
  assert.equal(depLabel('外文系:電影研究學分學程'), '外文系:電影研究學分學程')
})

test('courseDeps 合併主開系所與所有出現的系所；系所篩選比對任一個', async () => {
  const { courseDeps, depCounts } = await import('../src/lib/freeslots.js')
  const shared = c('300', 'F34-A1[GF]', { dep: '醫學系', deps: ['(醫學系)', '通識', '核心課程'] })
  assert.deepEqual(courseDeps(shared), ['醫學系', '通識', '核心課程'])
  assert.deepEqual(courseDeps(c('301', 'F34-A1[GF]')), ['資工系'])
  const list = [shared, c('301', 'F34-A1[GF]'), c('302', 'F34-A1[GF]', { dep: '', deps: ['IBI(生資所)[碩]', 'IBI(生資所)[博]'] })]
  assert.deepEqual(ids(findCourses(list, { ...base, deps: ['通識'] }).inside), ['300'])
  assert.deepEqual(ids(findCourses(list, { ...base, deps: ['生資所', '資工系'] }).inside), ['301', '302'])
  // 門數一樣時依中文排序規則（筆畫）
  assert.deepEqual(depCounts(list), [
    { name: '生資所', count: 1 },
    { name: '核心課程', count: 1 },
    { name: '通識', count: 1 },
    { name: '資工系', count: 1 },
    { name: '醫學系', count: 1 },
  ])
})

test('appliedFilters 列出已套用的篩選，withoutFilter 逐一拿掉', async () => {
  const { appliedFilters, withoutFilter } = await import('../src/lib/freeslots.js')
  const f = { ...base, campuses: ['YM'], categories: ['必修'], deps: ['資工系'], keyword: ' 線代 ' }
  assert.deepEqual(appliedFilters(f).map((a) => a.label), ['陽明', '必修', '資工系', '關鍵字：線代'])
  assert.deepEqual(withoutFilter(f, 'campuses', 'YM').campuses, [])
  assert.equal(withoutFilter(f, 'keyword', '').keyword, '')
  assert.deepEqual(appliedFilters(base), [])
})

test('facetCounts：每個選項套用後會有幾門（其他條件不變）', async () => {
  const { facetCounts } = await import('../src/lib/freeslots.js')
  const counts = facetCounts(courses, base, 'campuses', ['GF', 'YM', 'BA'])
  assert.deepEqual(Object.fromEntries(counts), { GF: 1, YM: 1, BA: 0 })
  const cat = facetCounts(courses, { ...base, campuses: ['GF'] }, 'categories', ['必修', '核心・基本素養'])
  assert.deepEqual(Object.fromEntries(cat), { 必修: 1, 核心・基本素養: 0 })
})

test('relaxations：零結果時建議放寬哪個條件，並附放寬後的門數', async () => {
  const { relaxations } = await import('../src/lib/freeslots.js')
  const f = { ...base, campuses: ['YM'], categories: ['必修'] }
  assert.equal(findCourses(courses, f).total, 0)
  const tips = relaxations(courses, f)
  assert.deepEqual(tips.map((t) => [t.label, t.total]), [
    ['改成部分重疊', 0],
    ['拿掉「陽明」', 1],
    ['拿掉「必修」', 1],
  ])
})
