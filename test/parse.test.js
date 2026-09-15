import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseIds, findInvalidTokens } from '../src/lib/parse.js'

test('逗號、空白、換行、分號都能分隔', () => {
  assert.deepEqual(parseIds('516702, 516703\n515005;515117 563018'), ['516702', '516703', '515005', '515117', '563018'])
})

test('去掉助手格式的學期前綴', () => {
  assert.deepEqual(parseIds('1151_516702 1143_516703'), ['516702', '516703'])
})

test('去重並保留順序', () => {
  assert.deepEqual(parseIds('516703 516702 516703'), ['516703', '516702'])
})

test('非六位數字被忽略', () => {
  assert.deepEqual(parseIds('51670 5167022 abc 516702'), ['516702'])
})

test('空字串回空陣列', () => {
  assert.deepEqual(parseIds(''), [])
  assert.deepEqual(parseIds('  \n '), [])
})

test('findInvalidTokens 回傳不合格式的原始字串', () => {
  assert.deepEqual(findInvalidTokens('516702 abc 51670 1151_516703 5167022'), ['abc', '51670', '5167022'])
})

test('findInvalidTokens 去重', () => {
  assert.deepEqual(findInvalidTokens('abc abc'), ['abc'])
})

import { semesterOfIds } from '../src/lib/parse.js'

test('semesterOfIds 取出一致的學期前綴', () => {
  assert.deepEqual(semesterOfIds('1151_516702 1151_516703'), { semester: '1151', mixed: false })
  assert.deepEqual(semesterOfIds('516702 1151_516703'), { semester: '1151', mixed: false })
  assert.deepEqual(semesterOfIds('516702 abc'), { semester: null, mixed: false })
})

test('semesterOfIds 前綴學期不一致時標示 mixed', () => {
  assert.deepEqual(semesterOfIds('1151_516702 1152_516703'), { semester: null, mixed: true })
})

test('semesterOfIds 忽略不是課號的字串', () => {
  assert.deepEqual(semesterOfIds('1152_abc 1151_516702'), { semester: '1151', mixed: false })
})
