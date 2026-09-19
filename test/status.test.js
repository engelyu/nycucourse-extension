import { test } from 'node:test'
import assert from 'node:assert/strict'
import { courseStatuses, occupiedKinds, KIND_COLORS } from '../src/lib/status.js'

const schedule = {
  sources: {
    registered: { courses: [
      { cos_id: '1', cos_cname: '微積分', cos_time: 'M12-A1[GF]', sFlag: 'F' },
      { cos_id: '2', cos_cname: '生死學', cos_time: 'R56-A2[GF]', sFlag: '2', GroupUID: 'G' },
    ] },
    preregist: { courses: [
      { cos_id: '2', cos_cname: '生死學', cos_time: 'R56-A2[GF]', menu_data: '{"type":3}', cos_type_code: 'E', category_cname: '基本素養' },
      { cos_id: '3', cos_cname: '線代', cos_time: 'T34-A3[GF]', menu_data: '{"type":1}', cos_type_code: '2' },
      { cos_id: '4', cos_cname: '舊版加入', cos_time: 'W5-A4[GF]', menu_data: '{}', cos_type_code: '1' },
    ] },
  },
  manual: [{ key: 'manual:x', source: 'manual', title: '社團', color: '#123456', slots: [{ day: 1, period: '1' }, { day: 3, period: 'a' }] }],
  overrides: {},
}

test('courseStatuses 正式選課優先，已登記、在預排附標籤', () => {
  const s = courseStatuses(schedule)
  assert.deepEqual(s.get('1'), { state: 'registered', wishNo: null, label: '已選上' })
  assert.deepEqual(s.get('2'), { state: 'wish', wishNo: 2, label: '已登記・第 2 志願' })
  assert.deepEqual(s.get('3'), { state: 'preregist', wishNo: null, label: '在預排・選修' })
  assert.deepEqual(s.get('4'), { state: 'preregist', wishNo: null, label: '在預排・未指定採計' })
  assert.equal(s.get('9'), undefined)
  assert.equal(courseStatuses(undefined).size, 0)
})

test('occupiedKinds 依優先順序分類格子並帶顏色', () => {
  const k = occupiedKinds(schedule)
  assert.equal(k.get('1-1').kind, 'registered')
  assert.deepEqual(k.get('1-1').titles, ['微積分', '社團'])
  assert.equal(k.get('4-5').kind, 'wish')
  assert.equal(k.get('4-5').color, KIND_COLORS.wish)
  assert.equal(k.get('2-3').kind, 'preregist')
  assert.equal(k.get('3-a').kind, 'manual')
  assert.equal(k.get('3-a').color, '#123456')
  const noColor = occupiedKinds({ sources: {}, manual: [{ key: 'manual:y', source: 'manual', title: 'x', slots: [{ day: 2, period: '1' }] }] })
  assert.equal(noColor.get('2-1').color, KIND_COLORS.manual)
})

test('occupiedKinds 附上非顏色的標記：已選上 ✓、登記中志願序、在預排「預」', () => {
  const k = occupiedKinds(schedule)
  assert.equal(k.get('1-1').mark, '✓')
  assert.equal(k.get('4-5').mark, '②')
  assert.equal(k.get('2-3').mark, '預')
  assert.equal(k.get('3-a').mark, '')
})

test('courseStatuses 照選課網規則：sFlag 不是 F 就是已登記，停修不列', () => {
  const s = courseStatuses({ sources: { registered: { courses: [
    { cos_id: 'a', sFlag: '', GroupUID: null },
    { cos_id: 'b', sFlag: 'F', Lock: '1' },
    { cos_id: 'c', sFlag: 'F', PFW: 'W' },
  ] } } })
  assert.deepEqual(s.get('a'), { state: 'wish', wishNo: null, label: '已登記・等分發' })
  assert.deepEqual(s.get('b'), { state: 'registered', wishNo: null, label: '已選上（鎖定）' })
  assert.equal(s.get('c'), undefined)
})
