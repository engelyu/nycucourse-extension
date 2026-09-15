import { test } from 'node:test'
import assert from 'node:assert/strict'
import '../src/lib/classify.js'

const { classifyResult, confirmWithList } = globalThis.NycuClassify

test('空回應代表成功加入', () => {
  assert.deepEqual(classifyResult('516702', ''), { id: '516702', status: 'added', msg: '' })
})

test('重複預選歸類為 exists', () => {
  const body = JSON.stringify([{ status: 'error', msg: '重複預選' }])
  assert.deepEqual(classifyResult('563018', body), { id: '563018', status: 'exists', msg: '重複預選' })
})

test('其他錯誤歸類為 error 並附訊息', () => {
  const body = JSON.stringify([{ status: 'error', msg: '選課預選失敗' }])
  assert.deepEqual(classifyResult('999999', body), { id: '999999', status: 'error', msg: '選課預選失敗' })
})

test('無法解析的回應歸類為 error', () => {
  const r = classifyResult('516702', '<html>Service Unavailable</html>')
  assert.equal(r.status, 'error')
  assert.equal(r.msg, '無法解析選課網回應')
})

test('confirmWithList 把未出現在清單的 added 改成 error', () => {
  const results = [
    { id: '516702', status: 'added', msg: '' },
    { id: '516703', status: 'added', msg: '' },
    { id: '999999', status: 'error', msg: '選課預選失敗' },
  ]
  const out = confirmWithList(results, ['516702', '563018'])
  assert.deepEqual(out, [
    { id: '516702', status: 'added', msg: '' },
    { id: '516703', status: 'error', msg: '加入後未出現在預排清單' },
    { id: '999999', status: 'error', msg: '選課預選失敗' },
  ])
  assert.equal(results[1].status, 'added')
})

test('HTTP 非 2xx 一律視為失敗並附狀態碼，即使回應是空字串', () => {
  assert.deepEqual(classifyResult('516702', '', 503), { id: '516702', status: 'error', msg: '選課網錯誤（HTTP 503）' })
  assert.deepEqual(classifyResult('516702', '<html>blocked</html>', 403), { id: '516702', status: 'error', msg: '選課網錯誤（HTTP 403）' })
})

test('沒給狀態碼或 2xx 時照原本規則分類', () => {
  assert.equal(classifyResult('516702', '').status, 'added')
  assert.equal(classifyResult('516702', '', 200).status, 'added')
  assert.equal(classifyResult('563018', JSON.stringify([{ status: 'error', msg: '重複預選' }]), 200).status, 'exists')
})

test('classify.js 是一般腳本，不用 export 也能掛到 globalThis', () => {
  assert.equal(typeof globalThis.NycuClassify.tokenUsable, 'function')
})
