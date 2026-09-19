import { test } from 'node:test'
import assert from 'node:assert/strict'
import { courseToItem, manualItem, slotsFromTimeRange, applyOverrides, itemUrl, buildWeek, scheduleItems, withSyncedSources, mergeBlocks } from '../src/lib/schedule.js'

const course = {
  cos_id: '516700',
  cos_cname: '線性代數（一）',
  cos_time: 'M56W34-SA321[GF]',
  lecturers: '吳金典',
  cos_credit: '3.00',
  num_limit: '85',
  registered_num: '63',
}

test('把選課網的課轉成課表項目', () => {
  const item = courseToItem(course, { source: 'registered', semester: '1151' })
  assert.equal(item.key, 'registered:516700')
  assert.equal(item.source, 'registered')
  assert.equal(item.cosId, '516700')
  assert.equal(item.semester, '1151')
  assert.equal(item.title, '線性代數（一）')
  assert.equal(item.teacher, '吳金典')
  assert.equal(item.credit, '3.00')
  assert.equal(item.limit, '85')
  assert.equal(item.enrolled, '63')
  assert.equal(item.slots.length, 4)
  assert.deepEqual(item.slots[0], { day: 1, period: '5', room: 'SA321', campus: 'GF' })
})

test('沒有上課時間的課也能轉換，slots 為空', () => {
  const item = courseToItem({ cos_id: '010016', cos_cname: '作業系統', cos_time: '' }, { source: 'preregist', semester: '1151' })
  assert.deepEqual(item.slots, [])
  assert.equal(item.teacher, '')
})

test('手動行程：用節次', () => {
  const item = manualItem({ id: 'abc', title: '社團開會', slots: [{ day: 3, period: '7', room: '學生活動中心' }] })
  assert.equal(item.key, 'manual:abc')
  assert.equal(item.source, 'manual')
  assert.equal(item.title, '社團開會')
  assert.deepEqual(item.slots, [{ day: 3, period: '7', room: '學生活動中心', campus: '' }])
})

test('手動行程：自訂時間換算成涵蓋的節次', () => {
  // 19:00-20:30 涵蓋 B(19:30-20:20)，以及 A(18:30-19:20) 的尾段
  assert.deepEqual(slotsFromTimeRange(3, '19:00', '20:30').map((s) => s.period), ['a', 'b'])
  assert.deepEqual(slotsFromTimeRange(1, '08:00', '09:50').map((s) => s.period), ['1', '2'])
  assert.deepEqual(slotsFromTimeRange(5, '12:30', '12:40').map((s) => s.period), ['n'])
  assert.deepEqual(slotsFromTimeRange(2, '23:00', '23:30'), [])
  assert.deepEqual(slotsFromTimeRange(2, '10:00', '09:00'), [])
})

test('外校或自訂行程可以帶自己的連結', () => {
  const item = manualItem({ id: 'x', title: '外校課程', url: 'https://e3.nycu.edu.tw/course/view.php?id=1', slots: [] })
  assert.equal(itemUrl(item), 'https://e3.nycu.edu.tw/course/view.php?id=1')
})

test('學校課程沒設定連結時用課程大綱', () => {
  const item = courseToItem(course, { source: 'registered', semester: '1151' })
  assert.equal(itemUrl(item), 'https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=115&Sem=1&CrsNo=516700&lang=zh-tw')
})

test('自訂連結蓋過課程大綱，且同步後仍保留', () => {
  const item = courseToItem(course, { source: 'registered', semester: '1151' })
  const [withOverride] = applyOverrides([item], { '516700': { url: 'https://e3.nycu.edu.tw/x', color: '#f00' } })
  assert.equal(itemUrl(withOverride), 'https://e3.nycu.edu.tw/x')
  assert.equal(withOverride.color, '#f00')
  // 原本的項目不被改動
  assert.equal(item.url, '')
})

test('隱藏的課不會出現在課表', () => {
  const item = courseToItem(course, { source: 'registered', semester: '1151' })
  const out = applyOverrides([item], { '516700': { hidden: true } })
  assert.deepEqual(out, [])
})

test('buildWeek 依星期與節次排版，並保留有課的節次範圍', () => {
  const a = courseToItem(course, { source: 'registered', semester: '1151' })
  const b = manualItem({ id: 'swim', title: '游泳', slots: slotsFromTimeRange(3, '19:00', '20:30') })
  const week = buildWeek([a, b])
  assert.deepEqual(week.days, [1, 2, 3, 4, 5])
  assert.equal(week.rows[0].label, '3')
  assert.equal(week.rows.at(-1).label, 'B')
  const mon5 = week.rows.find((r) => r.label === '5').cells[1]
  assert.equal(mon5.length, 1)
  assert.equal(mon5[0].title, '線性代數（一）')
  const wed = week.rows.find((r) => r.label === 'B').cells[3]
  assert.equal(wed[0].title, '游泳')
})

test('buildWeek 沒有任何行程時回空結構', () => {
  const week = buildWeek([])
  assert.deepEqual(week.days, [1, 2, 3, 4, 5])
  assert.deepEqual(week.rows, [])
})

test('buildWeek 週末有課時才顯示週末', () => {
  const sat = manualItem({ id: 's', title: '週六活動', slots: [{ day: 6, period: '3' }] })
  assert.deepEqual(buildWeek([sat]).days, [1, 2, 3, 4, 5, 6])
})

test('slotsFromPeriodRange 產生節次範圍的時段', async () => {
  const { slotsFromPeriodRange } = await import('../src/lib/schedule.js')
  assert.deepEqual(slotsFromPeriodRange(3, '3', '4', 'SA321').map((s) => s.period), ['3', '4'])
  assert.deepEqual(slotsFromPeriodRange(1, 'n', 'n').map((s) => s.period), ['n'])
  assert.deepEqual(slotsFromPeriodRange(1, '4', '2').map((s) => s.period), ['2', '3', '4'])
  assert.deepEqual(slotsFromPeriodRange(1, 'x', '2'), [])
  assert.deepEqual(slotsFromPeriodRange(0, '1', '2'), [])
  assert.equal(slotsFromPeriodRange(2, '1', '2', '體育館')[0].room, '體育館')
})

test('自訂行程存檔用的純資料格式', async () => {
  const { manualItem, slotsFromTimeRange } = await import('../src/lib/schedule.js')
  const item = manualItem({ id: 'swim', title: '游泳', url: 'https://pool.example', color: '#0a0', slots: slotsFromTimeRange(3, '19:00', '20:30', '體育館') })
  assert.equal(item.source, 'manual')
  assert.equal(item.color, '#0a0')
  assert.equal(item.slots[0].room, '體育館')
  assert.deepEqual(JSON.parse(JSON.stringify(item)), item)
})

test('scheduleItems 合併來源、前面的來源優先、加上自訂行程並套用覆寫', () => {
  const schedule = {
    sources: {
      registered: { semester: '1151', courses: [{ cos_id: '1', cos_cname: '線性代數', cos_time: 'W34-SC201[GF]', sFlag: 'F' }] },
      preregist: { semester: '1151', courses: [{ cos_id: '1', cos_cname: '線性代數', cos_time: 'W34-SC201[GF]' }, { cos_id: '2', cos_cname: '計概', cos_time: 'R56-EC115[GF]' }] },
    },
    manual: [manualItem({ id: 'm1', title: '社團', slots: [{ day: 2, period: 'a' }] })],
    overrides: { 1: { url: 'https://e3.example/1' } },
  }
  const reg = scheduleItems(schedule, ['registered'])
  assert.deepEqual(reg.map((i) => i.key), ['registered:1', 'manual:m1'])
  assert.equal(reg[0].url, 'https://e3.example/1')
  const all = scheduleItems(schedule, ['registered', 'preregist'])
  assert.deepEqual(all.map((i) => i.key), ['registered:1', 'preregist:2', 'manual:m1'])
  assert.deepEqual(scheduleItems(undefined, ['registered']), [])
})

test('withSyncedSources 寫入正式選課與預排並記下時間與學期', () => {
  const before = { sources: { other: { courses: [] } }, manual: [{ key: 'manual:x' }], overrides: { 1: { color: '#fff' } } }
  const next = withSyncedSources(before, { registered: [{ cos_id: '1', acy: '115', sem: '1' }], preregist: [] }, 1000)
  assert.deepEqual(next.sources.registered, { semester: '1151', updatedAt: 1000, courses: [{ cos_id: '1', acy: '115', sem: '1' }] })
  assert.deepEqual(next.sources.preregist, { semester: '', updatedAt: 1000, courses: [] })
  assert.deepEqual(next.sources.other, { courses: [] })
  assert.deepEqual(next.manual, before.manual)
  assert.notEqual(next, before)
  assert.deepEqual(withSyncedSources(undefined, {}, 5).sources.registered, { semester: '', updatedAt: 5, courses: [] })
})

test('mergeBlocks 把同一天同一門課的連續節次合併成一個區塊', () => {
  const items = [
    courseToItem({ cos_id: '1', cos_cname: '線性代數', cos_time: 'W34T34-SC201[GF]' }, { source: 'registered' }),
    courseToItem({ cos_id: '2', cos_cname: '導師時間', cos_time: 'M5-SC101[GF]' }, { source: 'registered' }),
  ]
  const layout = mergeBlocks(buildWeek(items))
  assert.deepEqual(layout.rows.map((r) => r.code), ['3', '4', 'n', '5'])
  assert.equal(layout.rows[0].startMin, 610)
  const wed = layout.blocks.find((b) => b.day === 3)
  assert.deepEqual(
    { row: wed.row, span: wed.span, start: wed.start, end: wed.end, startMin: wed.startMin, endMin: wed.endMin, room: wed.room, lanes: wed.lanes },
    { row: 0, span: 2, start: '10:10', end: '12:00', startMin: 610, endMin: 720, room: 'SC201', lanes: 1 },
  )
  assert.equal(layout.blocks.length, 3)
})

test('mergeBlocks 衝堂時兩門課都保留並標示 lane', () => {
  const items = [
    courseToItem({ cos_id: '1', cos_cname: '甲', cos_time: 'M12-A101[GF]' }, { source: 'registered' }),
    courseToItem({ cos_id: '2', cos_cname: '乙', cos_time: 'M2-B202[GF]' }, { source: 'registered' }),
  ]
  const { blocks } = mergeBlocks(buildWeek(items))
  const a = blocks.find((b) => b.item.cosId === '1')
  const b = blocks.find((x) => x.item.cosId === '2')
  assert.equal(a.lanes, 2)
  assert.equal(b.lanes, 2)
  assert.notEqual(a.lane, b.lane)
})

test('mergeBlocks 同一門課不同節在不同教室時合併教室', () => {
  const items = [courseToItem({ cos_id: '1', cos_cname: '實驗', cos_time: 'F3-A101[GF],F4-B202[GF]' }, { source: 'registered' })]
  const [block] = mergeBlocks(buildWeek(items)).blocks
  assert.equal(block.span, 2)
  assert.equal(block.room, 'A101/B202')
})

test('mergeBlocks 沒有行程時回空區塊', () => {
  assert.deepEqual(mergeBlocks(buildWeek([])).blocks, [])
})

test('withSyncedSources 某份清單讀取失敗（null）時保留原本的資料', () => {
  const before = { sources: { registered: { semester: '1151', updatedAt: 1, courses: [{ cos_id: '1' }] }, preregist: { semester: '1151', updatedAt: 1, courses: [] } } }
  const next = withSyncedSources(before, { registered: null, preregist: [{ cos_id: '2', acy: '115', sem: '1' }] }, 9)
  assert.deepEqual(next.sources.registered, before.sources.registered)
  assert.deepEqual(next.sources.preregist.courses, [{ cos_id: '2', acy: '115', sem: '1' }])
  assert.equal(next.sources.preregist.updatedAt, 9)
})
