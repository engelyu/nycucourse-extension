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

// 選課網規則：沒有群組、sFlag 不是 F 就是已登記等分發，重送沒有意義；停修的課也不送
test('已登記等分發、停修的課不重送', () => {
  const items = [
    { cosId: '516701', wish: '', title: '計概' },
    { cosId: '536700', wish: '', title: '實變' },
    { cosId: '515506', wish: '', title: '停修課' },
  ]
  const registered = {
    516701: { cos_id: '516701', sFlag: '1', GroupUID: null },
    536700: { cos_id: '536700', sFlag: '', GroupUID: null },
    515506: { cos_id: '515506', sFlag: 'F', PFW: 'W' },
  }
  const plan = buildPlan(items, registered)
  assert.deepEqual(plan.todo, [])
  assert.deepEqual(plan.skipped.map((s) => s.reason), ['已登記，等分發', '已登記，等分發', '已停修'])
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

// 2026-09-20：registerParams 現在會在資料不全時丟例外，自動登記必須把那一門標成失敗、繼續跑下去
test('registerParams 丟例外時只有那一門失敗', async () => {
  const { registerParams } = await import('../src/lib/register.js')
  const items = [
    { cosId: '516713', wish: '', title: '有上限無群組' },
    { cosId: '561068', wish: '', title: '志願群組課' },
  ]
  const records = {
    516713: { cos_id: '516713', cos_type_code: '2', wType: 'X', num_limit: '40', GroupUID: null },
    561068: { cos_id: '561068', cos_type_code: 'E', wType: 'E', num_limit: '70', GroupUID: 'G' },
  }
  const results = []
  for (const item of items) {
    try {
      results.push({ cosId: item.cosId, ok: true, wish: registerParams(records[item.cosId], item.wish).wish })
    } catch (err) {
      results.push({ cosId: item.cosId, ok: false, message: err.message })
    }
  }
  assert.deepEqual(results[0], { cosId: '516713', ok: true, wish: '1' }, '一般課程伺服器自己決定志願，照送')
  assert.equal(results[1].ok, false)
  assert.match(results[1].message, /志願/)
})

// 自動登記分頁（從選課頁搬到當期選課）顯示用的文字
import { formatRunTime, describeAutoItem, describeLogEntry } from '../src/lib/autoreg.js'

test('formatRunTime：月/日 時:分，沒有時間回空字串', () => {
  assert.equal(formatRunTime(new Date(2026, 8, 25, 13, 5).getTime()), '9/25 13:05')
  assert.equal(formatRunTime(0), '')
  assert.equal(formatRunTime(null), '')
})

test('describeAutoItem：課號、課名、志願；沒有志願序的寫「不需志願序」', () => {
  assert.equal(describeAutoItem({ cosId: '515044', title: '實變函數論(一)', wish: '2' }), '515044 實變函數論(一)　第 2 志願')
  assert.equal(describeAutoItem({ cosId: '515044', title: '', wish: '' }, '預排裡的課名'), '515044 預排裡的課名　不需志願序')
})

test('describeLogEntry：時間、手動或自動、結果', () => {
  const at = new Date(2026, 8, 25, 13, 0).getTime()
  assert.equal(describeLogEntry({ at, trigger: 'manual', summary: '', note: '選課系統暫停中：選課結束' }), '9/25 13:00　手動　選課系統暫停中：選課結束')
  assert.equal(describeLogEntry({ at, trigger: 'alarm', summary: '成功 1 門、失敗 0 門：實變 已登記第 2 志願', note: '' }), '9/25 13:00　自動　成功 1 門、失敗 0 門：實變 已登記第 2 志願')
})
