import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STALE_MS, isCrawlAlive, createStateWriter } from '../src/lib/crawlState.js'

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

test('STALE_MS 在合理範圍', () => {
  assert.ok(STALE_MS >= 60_000 && STALE_MS <= 180_000)
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
