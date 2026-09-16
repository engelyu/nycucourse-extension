import { test } from 'node:test'
import assert from 'node:assert/strict'
import { courseOutlineUrl } from '../src/lib/links.js'

test('組出課程時間表的課程大綱網址', () => {
  assert.equal(
    courseOutlineUrl('1151', '516700'),
    'https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=115&Sem=1&CrsNo=516700&lang=zh-tw',
  )
})

test('暑修學期也能組出網址', () => {
  assert.equal(
    courseOutlineUrl('114X', '516700'),
    'https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=114&Sem=X&CrsNo=516700&lang=zh-tw',
  )
})

test('課號或學期不合格式時回 null', () => {
  assert.equal(courseOutlineUrl('1151', ''), null)
  assert.equal(courseOutlineUrl('', '516700'), null)
  assert.equal(courseOutlineUrl(undefined, undefined), null)
  assert.equal(courseOutlineUrl('115', '516700'), null)
  assert.equal(courseOutlineUrl('1151', 'abc'), null)
})

test('課號含學期前綴時自動去掉', () => {
  assert.equal(
    courseOutlineUrl('1151', '1151_516700'),
    'https://timetable.nycu.edu.tw/?r=main/crsoutline&Acy=115&Sem=1&CrsNo=516700&lang=zh-tw',
  )
})
