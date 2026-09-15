import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STALE_MS, SLOW_MS, isCrawlAlive, createStateWriter, describeCrawl, formatElapsed } from '../src/lib/crawlState.js'

test('formatElapsed 顯示秒與分秒', () => {
  assert.equal(formatElapsed(0), '0 秒')
  assert.equal(formatElapsed(45), '45 秒')
  assert.equal(formatElapsed(65), '1 分 05 秒')
  assert.equal(formatElapsed(-3), '0 秒')
})

test('describeCrawl 不在進行中時回傳 null', () => {
  const now = 5_000_000
  assert.equal(describeCrawl(undefined, now), null)
  assert.equal(describeCrawl({ status: 'done', startedAt: now, lastProgressAt: now }, now), null)
  assert.equal(describeCrawl({ status: 'error', startedAt: now, lastProgressAt: now }, now), null)
  assert.equal(describeCrawl({ status: 'running', startedAt: now - STALE_MS - 10, lastProgressAt: now - STALE_MS - 10 }, now), null)
})

test('describeCrawl 步驟一剛開始：連線中、無百分比', () => {
  const now = 5_000_000
  const d = describeCrawl({ status: 'running', phase: 'tree', done: 0, total: 0, startedAt: now - 3000, lastProgressAt: now - 1000 }, now)
  assert.equal(d.title, '步驟 1/2：讀取系所清單')
  assert.equal(d.detail, '連線到課程時間表…')
  assert.equal(d.percent, null)
  assert.equal(d.elapsed, '已經過 3 秒')
  assert.equal(d.slow, false)
  assert.match(d.hint, /1 到 3 分鐘/)
  assert.match(d.hint, /關閉/)
})

test('describeCrawl 步驟一已找到系所', () => {
  const now = 5_000_000
  const d = describeCrawl({ status: 'running', phase: 'tree', done: 268, total: 0, startedAt: now - 20_000, lastProgressAt: now - 500 }, now)
  assert.equal(d.detail, '已找到 268 個系所')
  assert.equal(d.percent, null)
})

test('describeCrawl 步驟二顯示百分比與系所數', () => {
  const now = 5_000_000
  const d = describeCrawl({ status: 'running', phase: 'courses', done: 120, total: 343, startedAt: now - 65_000, lastProgressAt: now - 500 }, now)
  assert.equal(d.title, '步驟 2/2：下載課程資料')
  assert.equal(d.detail, '120/343 個系所')
  assert.equal(d.percent, 34)
  assert.equal(d.elapsed, '已經過 1 分 05 秒')
})

test('describeCrawl 步驟二 total 為 0 時百分比為 0', () => {
  const now = 5_000_000
  const d = describeCrawl({ status: 'running', phase: 'courses', done: 0, total: 0, startedAt: now, lastProgressAt: now }, now)
  assert.equal(d.percent, 0)
})

test('describeCrawl 一段時間沒有進度時提示網站較慢', () => {
  const now = 5_000_000
  const d = describeCrawl({ status: 'running', phase: 'tree', done: 268, total: 0, startedAt: now - 40_000, lastProgressAt: now - SLOW_MS - 1 }, now)
  assert.equal(d.slow, true)
  assert.match(d.hint, /較慢/)
})

test('SLOW_MS 比 STALE_MS 短', () => {
  assert.ok(SLOW_MS > 0 && SLOW_MS < STALE_MS)
})

const NOW = 1_000_000_000

test('非 running 狀態都不算進行中', () => {
  assert.equal(isCrawlAlive(undefined, NOW), false)
  assert.equal(isCrawlAlive({ status: 'done', lastProgressAt: NOW }, NOW), false)
  assert.equal(isCrawlAlive({ status: 'error', lastProgressAt: NOW }, NOW), false)
})

test('最近有進度就算進行中，即使開始很久了', () => {
  assert.equal(isCrawlAlive({ status: 'running', startedAt: NOW - 10 * 60_000, lastProgressAt: NOW - 1000 }, NOW), true)
})

test('太久沒有進度視為中斷', () => {
  assert.equal(isCrawlAlive({ status: 'running', startedAt: NOW - 1000, lastProgressAt: NOW - STALE_MS - 1 }, NOW), false)
})

test('舊資料沒有 lastProgressAt 時退回用 startedAt', () => {
  assert.equal(isCrawlAlive({ status: 'running', startedAt: NOW - 1000 }, NOW), true)
  assert.equal(isCrawlAlive({ status: 'running', startedAt: NOW - STALE_MS - 1 }, NOW), false)
})

test('STALE_MS 大於單一系所最壞的無進度時間', () => {
  // 一個系所最壞：3 次請求各 30 秒逾時，加上兩次重試等待 0.5 秒與 1 秒
  assert.ok(STALE_MS > 3 * 30_000 + 500 + 1000)
  assert.ok(STALE_MS <= 180_000)
})

test('createStateWriter 依呼叫順序寫入，最後一次寫入是最終狀態', async () => {
  const writes = []
  // 第一次寫入故意最慢，模擬 storage 延遲
  const delays = [30, 5, 1, 1]
  let n = 0
  const write = async (value) => {
    const d = delays[n++] ?? 1
    await new Promise((r) => setTimeout(r, d))
    writes.push(value)
  }
  let clock = 100
  const writer = createStateWriter(write, () => clock++)
  writer.reset({ status: 'running', done: 0 })
  writer.update({ done: 1 })
  writer.update({ done: 2 })
  await writer.update({ status: 'done' })
  assert.deepEqual(writes.map((w) => [w.status, w.done]), [['running', 0], ['running', 1], ['running', 2], ['done', 2]])
  assert.ok(writes.every((w, i) => i === 0 || w.lastProgressAt > writes[i - 1].lastProgressAt))
  assert.deepEqual(writer.current(), writes.at(-1))
})

test('createStateWriter 寫入失敗不會卡住後續寫入', async () => {
  const writes = []
  let first = true
  const write = async (value) => {
    if (first) { first = false; throw new Error('quota') }
    writes.push(value)
  }
  const writer = createStateWriter(write, () => 1)
  writer.reset({ status: 'running' })
  await writer.update({ status: 'done' })
  assert.equal(writes.at(-1).status, 'done')
})
