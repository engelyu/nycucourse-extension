import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickSemester, formBody, cosListParams, parseCosList, objectKeys } from '../src/lib/timetable.js'

test('pickSemester 跳過暑修學期', () => {
  assert.equal(pickSemester([{ T: '114X' }, { T: '1142' }, { T: '1141' }]), '1142')
  assert.equal(pickSemester([{ T: '1151' }, { T: '114X' }]), '1151')
})

test('pickSemester 沒有可用學期時丟錯', () => {
  assert.throws(() => pickSemester([{ T: '114X' }]), /找不到學期/)
  assert.throws(() => pickSemester([]), /找不到學期/)
})

test('formBody 編碼成 x-www-form-urlencoded', () => {
  assert.equal(formBody({ a: '1', b: '3*', c: '**' }), 'a=1&b=3*&c=**')
})

test('cosListParams 帶上 m_selcampus 與學年學期', () => {
  const p = cosListParams('1151', 'UID-1')
  assert.equal(p.m_acy, '115')
  assert.equal(p.m_sem, '1')
  assert.equal(p.m_acyend, '115')
  assert.equal(p.m_semend, '1')
  assert.equal(p.m_dep_uid, 'UID-1')
  assert.equal(p.m_selcampus, '**')
  for (const k of ['m_group', 'm_grade', 'm_class', 'm_option', 'm_crsname', 'm_teaname', 'm_cos_id', 'm_cos_code', 'm_crstime', 'm_crsoutline', 'm_costype']) {
    assert.equal(p[k], '**', k)
  }
})

test('objectKeys 處理物件、空陣列與空值', () => {
  assert.deepEqual(objectKeys({ S: '理學院', I: '電機學院' }), ['S', 'I'])
  assert.deepEqual(objectKeys([]), [])
  assert.deepEqual(objectKeys(''), [])
  assert.deepEqual(objectKeys(null), [])
})

const sample = {
  'UID-1': {
    dep_id: 'UID-1',
    dep_cname: '應用數學系',
    1: {
      '1151_516700': {
        cos_id: '516700', cos_cname: '線性代數（一）', cos_ename: 'Linear Algebra (I)', teacher: '吳金典',
        cos_time: 'M56W34-SA321[GF]', cos_credit: '3.00', cos_type: '必修', dep_cname: '應用數學系',
      },
    },
    2: {
      '1151_516750': {
        cos_id: '516750', cos_cname: '機率', cos_ename: 'Probability', teacher: '王大明',
        cos_time: 'T34-SA101[GF]', cos_credit: '3.00', cos_type: '選修', dep_cname: '應用數學系',
      },
    },
    brief: { '1151_516700': {} },
    costype: {},
    language: {},
  },
}

test('parseCosList 只讀數字 key 底下的課程並轉成精簡格式', () => {
  const strip = (list) => list.map(({ limit, enrolled, ...rest }) => rest)
  assert.deepEqual(strip(parseCosList(sample)), [
    { id: '516700', name: '線性代數（一）', ename: 'Linear Algebra (I)', teacher: '吳金典', time: 'M56W34-SA321[GF]', credit: '3.00', type: '必修', dep: '應用數學系' },
    { id: '516750', name: '機率', ename: 'Probability', teacher: '王大明', time: 'T34-SA101[GF]', credit: '3.00', type: '選修', dep: '應用數學系' },
  ])
})

test('parseCosList 處理空回應', () => {
  assert.deepEqual(parseCosList([]), [])
  assert.deepEqual(parseCosList(''), [])
  assert.deepEqual(parseCosList(null), [])
})

test('parseCosList 缺欄位時補空字串', () => {
  const out = parseCosList({ U: { 1: { x: { cos_id: '123456', cos_cname: '課' } } } })
  assert.deepEqual(out, [{ id: '123456', name: '課', ename: '', teacher: '', time: '', credit: '', type: '', dep: '', limit: '', enrolled: '' }])
})

test('parseCosList 帶出人數上限與已選人數原始值', () => {
  const json = {
    U: {
      1: {
        a: { cos_id: '516700', cos_cname: '線性代數', num_limit: '85', reg_num: '-999' },
        b: { cos_id: '516702', cos_cname: '服務學習', num_limit: '9999', reg_num: '12' },
      },
    },
  }
  const out = parseCosList(json)
  assert.equal(out[0].limit, '85')
  assert.equal(out[0].enrolled, '-999')
  assert.equal(out[1].limit, '9999')
  assert.equal(out[1].enrolled, '12')
})

test('parseCosList 可附加系所查詢資訊', () => {
  const json = { U: { 1: { a: { cos_id: '516700', cos_cname: '線性代數' } } } }
  const menu = { type: 1, dep_category: '3*', college_no: 'S', dep_uid: 'UID-1' }
  assert.deepEqual(parseCosList(json, menu)[0].menu, menu)
  assert.equal(parseCosList(json)[0].menu, undefined)
})
