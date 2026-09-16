import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextRunAt, inClosedWindow, timeWarning, buildPlan, summarizeResults, DEFAULT_CLOSED } from '../src/lib/autoreg.js'

const at = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime()

test('今天還沒到時間就排今天', () => {
  const now = at(2026, 9, 17, 9, 30)
  assert.equal(nextRunAt('13:00', now, 0), at(2026, 9, 17, 13, 0))
})

test('今天已經過了時間就排明天', () => {
  const now = at(2026, 9, 17, 14, 0)
  assert.equal(nextRunAt('13:00', now, 0), at(2026, 9, 18, 13, 0))
})

test('今天已經跑過就排明天', () => {
  const now = at(2026, 9, 17, 12, 50)
  const lastRun = at(2026, 9, 17, 12, 40)
  assert.equal(nextRunAt('13:00', now, lastRun), at(2026, 9, 18, 13, 0))
})

test('昨天跑過不影響今天', () => {
  const now = at(2026, 9, 17, 9, 0)
  const lastRun = at(2026, 9, 16, 13, 0)
  assert.equal(nextRunAt('13:00', now, lastRun), at(2026, 9, 17, 13, 0))
})

test('時間格式不對時回 null', () => {
  assert.equal(nextRunAt('', at(2026, 9, 17, 9, 0), 0), null)
  assert.equal(nextRunAt('25:00', at(2026, 9, 17, 9, 0), 0), null)
})

test('選課系統關閉時段的預設是 10:00 到 12:00', () => {
  assert.deepEqual(DEFAULT_CLOSED, { from: '10:00', to: '12:00' })
  assert.equal(inClosedWindow('10:30'), true)
  assert.equal(inClosedWindow('10:00'), true)
  assert.equal(inClosedWindow('12:00'), false)
  assert.equal(inClosedWindow('13:00'), false)
  assert.equal(inClosedWindow('09:59'), false)
})

test('排在關閉時段會提醒', () => {
  assert.match(timeWarning('11:00'), /10:00/)
  assert.equal(timeWarning('13:00'), '')
})

test('已選上的課不再登記，登記中但志願不同要重登', () => {
  const items = [
    { cosId: '561068', wish: '1', title: '生死學' },
    { cosId: '563038', wish: '2', title: '體育' },
    { cosId: '516701', wish: '', title: '計概' },
  ]
  const registered = {
    516701: { cos_id: '516701', sFlag: 'F', GroupUID: null }, // 已選上
    563038: { cos_id: '563038', sFlag: '2', GroupUID: 'PE' }, // 已登記且志願相同
  }
  const plan = buildPlan(items, registered)
  assert.deepEqual(plan.todo.map((i) => i.cosId), ['561068'])
  assert.deepEqual(plan.skipped, [
    { cosId: '563038', title: '體育', reason: '已登記第 2 志願' },
    { cosId: '516701', title: '計概', reason: '已選上' },
  ])
})

test('登記中但想改志願時會重新登記', () => {
  const items = [{ cosId: '561068', wish: '1', title: '生死學' }]
  const registered = { 561068: { cos_id: '561068', sFlag: '3', GroupUID: 'GE' } }
  const plan = buildPlan(items, registered)
  assert.deepEqual(plan.todo.map((i) => i.cosId), ['561068'])
  assert.deepEqual(plan.skipped, [])
})

test('沒有設定課程時計畫是空的', () => {
  assert.deepEqual(buildPlan([], {}), { todo: [], skipped: [] })
  assert.deepEqual(buildPlan(null, null), { todo: [], skipped: [] })
})

test('summarizeResults 產生可讀的結果', () => {
  const text = summarizeResults([
    { cosId: '561068', title: '生死學', ok: true, message: '成功' },
    { cosId: '563038', title: '體育', ok: false, message: '人數已滿' },
  ])
  assert.equal(text, '成功 1 門、失敗 1 門：生死學 成功；體育 人數已滿')
  assert.equal(summarizeResults([]), '沒有需要登記的課程')
})
